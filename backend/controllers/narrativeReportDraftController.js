const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');
const { buildWeeklyEvidence } = require('./narrativeReportEvidenceController');
const { generateWithQuota, requireAiEvidenceApproval } = require('../services/aiReportUsage');

const MAX_GENERATION_BATCH = 5;

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function positiveId(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function periodKey(startDate) {
  return `week:${startDate}`;
}

function periodLabel({ startDate, endDate }) {
  const format = date => new Intl.DateTimeFormat('en-PH', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`));
  return `Week of ${format(startDate)} to ${format(endDate)}`;
}

function selectedStudents(body, evidence) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['sectionId', 'startDate', 'studentIds', 'notesByStudent', 'regenerateDrafts'].includes(key)) ||
    body.regenerateDrafts !== undefined && typeof body.regenerateDrafts !== 'boolean') {
    throw createError('Provide valid weekly report generation details.');
  }
  const roster = new Map(evidence.students.map(student => [student.id, student]));
  const ids = body.studentIds === undefined ? [...roster.keys()] : body.studentIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_GENERATION_BATCH) {
    throw createError(`Select between one and ${MAX_GENERATION_BATCH} learners for each generation request.`);
  }
  const normalizedIds = ids.map(id => positiveId(id));
  if (normalizedIds.some(id => !id) || new Set(normalizedIds).size !== normalizedIds.length ||
    normalizedIds.some(id => !roster.has(String(id)))) {
    throw createError('Select learners from the assigned section and report week.');
  }
  const notes = body.notesByStudent || {};
  if (!notes || typeof notes !== 'object' || Array.isArray(notes) ||
    Object.entries(notes).some(([id, note]) => !normalizedIds.includes(positiveId(id)) || typeof note !== 'string' || note.length > 1000)) {
    throw createError('Adviser notes must belong to selected learners and be at most 1000 characters each.');
  }
  return { students: normalizedIds.map(id => roster.get(String(id))), notes, regenerate: body.regenerateDrafts === true };
}

function sourceReferences(student, journalApplicable = false) {
  const references = [];
  const add = (type, value) => {
    const id = positiveId(value);
    if (id) references.push({ type, id });
  };
  student.attendance.sources.forEach(source => {
    if (source.recordId) add('attendance_record', source.recordId);
    else add('attendance_session', source.sessionId);
  });
  student.assignments.sources.slice(0, 20).forEach(source => {
    add('assignment', source.assignmentId);
    if (source.submissionId) add('assignment_submission', source.submissionId);
  });
  if (journalApplicable) {
    student.journal.sources.filter(source => ['submitted', 'reviewed'].includes(source.status)).slice(-3)
      .forEach(source => add('journal_entry', source.entryId));
  }
  student.academicRecords
    .forEach(source => add('published_final_grade', source.gradeId));
  (student.academicScores || []).forEach(score => add('student_score', score.scoreId));
  return [...new Map(references.map(ref => [`${ref.type}:${ref.id}`, ref])).values()];
}

async function existingReport(database, schoolId, studentId, key, lock = false) {
  const [rows] = await database.execute(
    `SELECT id, section_id AS sectionId, teacher_note AS teacherNote, report_status AS status,
      released_at AS releasedAt
    FROM narrative_reports WHERE school_id = ? AND student_user_id = ? AND report_period_key = ?
    LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, studentId, key]
  );
  return rows[0] || null;
}

function skipReason(existing, sectionId, regenerate) {
  if (!existing) return null;
  if (Number(existing.sectionId) !== Number(sectionId)) return 'another_section';
  if (existing.releasedAt) return 'released_correction_manual_only';
  if (existing.status === 'confirmed') return 'already_confirmed';
  if (existing.status !== 'draft') return 'not_editable';
  return regenerate ? null : 'draft_exists';
}

async function saveDraft({ database, req, student, evidence, draft, teacherNote, regenerate }) {
  const schoolId = Number(req.user.schoolId);
  const teacherId = Number(req.user.id);
  const sectionId = Number(evidence.section.id);
  const key = periodKey(evidence.reportWeek.startDate);
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const existing = await existingReport(connection, schoolId, Number(student.id), key, true);
    const reason = skipReason(existing, sectionId, regenerate);
    if (reason) {
      await connection.rollback();
      transactionStarted = false;
      return { status: 'skipped', reason };
    }
    let reportId;
    if (existing) {
      reportId = Number(existing.id);
      await connection.execute(
        `UPDATE narrative_reports SET teacher_user_id = ?, teacher_note = ?, ai_model = ?,
          generated_summary = ?, teacher_edited_summary = NULL, ai_follow_up_suggestion = ?,
          report_week_start_date = ?, report_week_end_date = ?, report_period_label = ?,
          is_at_risk = FALSE, generated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ? AND report_status = 'draft'`,
        [teacherId, teacherNote || null, draft.model, draft.summary, draft.followUpSuggestion,
          evidence.reportWeek.startDate, evidence.reportWeek.endDate, periodLabel(evidence.reportWeek), reportId, schoolId]
      );
      await connection.execute('DELETE FROM report_recommendations WHERE narrative_report_id = ?', [reportId]);
      await connection.execute('DELETE FROM report_data_sources WHERE narrative_report_id = ?', [reportId]);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO narrative_reports (
          school_id, student_user_id, section_id, teacher_user_id,
          report_week_start_date, report_week_end_date, report_period_key, report_period_label,
          teacher_note, ai_model, generated_summary, ai_follow_up_suggestion, report_status, is_at_risk
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', FALSE)`,
        [schoolId, Number(student.id), sectionId, teacherId,
          evidence.reportWeek.startDate, evidence.reportWeek.endDate, key, periodLabel(evidence.reportWeek),
          teacherNote || null, draft.model, draft.summary, draft.followUpSuggestion]
      );
      reportId = Number(result.insertId);
    }
    for (const [index, action] of draft.parentActions.entries()) {
      await connection.execute(
        'INSERT INTO report_recommendations (narrative_report_id, recommendation_text, display_order) VALUES (?, ?, ?)',
        [reportId, action, index + 1]
      );
    }
    const references = sourceReferences(student, evidence.section.journalApplicable);
    if (references.length) {
      await connection.execute(
        `INSERT INTO report_data_sources (narrative_report_id, source_type, source_record_id) VALUES ${references.map(() => '(?, ?, ?)').join(', ')}`,
        references.flatMap(ref => [reportId, ref.type, ref.id])
      );
    }
    await writeAuditLog(connection, req, existing ? 'narrative_report_draft_regenerated' : 'narrative_report_draft_generated',
      'narrative_reports', reportId, { sectionId, studentId: Number(student.id), reportWeekStartDate: evidence.reportWeek.startDate });
    await connection.commit();
    transactionStarted = false;
    return { status: 'generated', reportId: String(reportId), regenerated: Boolean(existing) };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function processWeeklyGeneration(req, {
  database = getDatabase(), evidenceBuilder = buildWeeklyEvidence, ai
} = {}) {
  const generate = ai || (input => generateWithQuota({
    database, schoolId: Number(req.user.schoolId), ...input
  }));
  const body = req.body || {};
  const sectionId = positiveId(body.sectionId);
  if (!sectionId) throw createError('Select an advisory section.');
  const evidence = await evidenceBuilder({
    schoolId: req.user?.schoolId, teacherId: req.user?.id,
    sectionId, startDate: body.startDate, database
  });
  const selection = selectedStudents(body, evidence);
  const results = [];
  for (const student of selection.students) {
    let outcome;
    try {
      const key = periodKey(evidence.reportWeek.startDate);
      const existing = await existingReport(database, Number(req.user.schoolId), Number(student.id), key);
      const reason = skipReason(existing, sectionId, selection.regenerate);
      if (reason) outcome = { status: 'skipped', reason };
      else {
        if ((student.lowScoreReasons || []).reduce((count, flag) => count + flag.scores.length, 0) > 20) {
          throw createError('More than 20 flagged academic scores are recorded this week. Review them before generating this report.', 422);
        }
        const teacherNote = Object.hasOwn(selection.notes, student.id)
          ? selection.notes[student.id].trim() : existing?.teacherNote || '';
        const draft = await generate({ student, reportWeek: evidence.reportWeek, teacherNote,
          journalApplicable: evidence.section.journalApplicable });
        outcome = await saveDraft({ database, req, student, evidence, draft, teacherNote, regenerate: selection.regenerate });
      }
    } catch (error) {
      outcome = { status: 'error', message: [422, 429, 503].includes(error.status)
        ? error.message : 'Draft generation failed for this learner.' };
    }
    results.push({ studentId: student.id, ...outcome, processed: results.length + 1, total: selection.students.length });
  }
  return {
    section: evidence.section, reportWeek: evidence.reportWeek,
    results, progress: {
      total: results.length,
      generated: results.filter(result => result.status === 'generated').length,
      skipped: results.filter(result => result.status === 'skipped').length,
      failed: results.filter(result => result.status === 'error').length
    }
  };
}

async function generateWeeklyDrafts(req, res, next) {
  try {
    if (process.env.AI_REPORTS_GENERATION_ENABLED !== 'true') throw createError('AI report generation is not enabled.', 503);
    if (!process.env.OPENAI_API_KEY) throw createError('AI generation is not configured.', 503);
    const database = getDatabase();
    await requireAiEvidenceApproval(database, Number(req.user.schoolId));
    const result = await processWeeklyGeneration(req, { database });
    res.set('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (error) { next(error); }
}

async function readWeeklyDrafts(database, evidence, { schoolId }) {
    const [rows] = await database.execute(
      `SELECT id, student_user_id AS studentId, teacher_note AS teacherNote, ai_model AS aiModel,
        generated_summary AS generatedSummary, teacher_edited_summary AS editedSummary,
        ai_follow_up_suggestion AS followUpSuggestion,
        report_status AS status, is_at_risk AS isAtRisk, released_at AS releasedAt,
        pending_correction AS pendingCorrection,
        DATE_FORMAT(report_week_start_date, '%Y-%m-%d') AS reportWeekStartDate,
        DATE_FORMAT(report_week_end_date, '%Y-%m-%d') AS reportWeekEndDate,
        DATE_FORMAT(generated_at, '%Y-%m-%dT%H:%i:%s') AS generatedAt,
        DATE_FORMAT(confirmed_at, '%Y-%m-%dT%H:%i:%s') AS confirmedAt
      FROM narrative_reports WHERE school_id = ? AND section_id = ? AND report_period_key = ?`,
      [Number(schoolId), Number(evidence.section.id), periodKey(evidence.reportWeek.startDate)]
    );
    const eligible = evidence.students ? new Set(evidence.students.map(student => student.id)) : null;
    const reports = rows.filter(row => !eligible || eligible.has(String(row.studentId))).map(row => ({
      id: String(row.id), studentId: String(row.studentId), teacherNote: row.teacherNote,
      aiModel: row.aiModel, generatedSummary: row.generatedSummary, editedSummary: row.editedSummary,
      followUpSuggestion: row.followUpSuggestion,
      isAtRisk: Boolean(row.isAtRisk), status: row.status, generatedAt: row.generatedAt,
      releasedAt: row.releasedAt, pendingCorrection: Boolean(row.pendingCorrection),
      confirmedAt: row.confirmedAt,
      reportWeekStartDate: row.reportWeekStartDate, reportWeekEndDate: row.reportWeekEndDate,
      parentActions: [], sources: []
    }));
    if (reports.length) {
      const ids = reports.map(report => Number(report.id));
      const placeholders = ids.map(() => '?').join(', ');
      const [actions] = await database.execute(
        `SELECT narrative_report_id AS reportId, recommendation_text AS text
          FROM report_recommendations WHERE narrative_report_id IN (${placeholders}) ORDER BY display_order`, ids
      );
      const [sources] = await database.execute(
        `SELECT narrative_report_id AS reportId, source_type AS type, source_record_id AS recordId
          FROM report_data_sources WHERE narrative_report_id IN (${placeholders}) ORDER BY id`, ids
      );
      const byId = new Map(reports.map(report => [report.id, report]));
      actions.forEach(action => byId.get(String(action.reportId))?.parentActions.push(action.text));
      sources.forEach(source => byId.get(String(source.reportId))?.sources.push({
        type: source.type, recordId: source.recordId == null ? null : String(source.recordId)
      }));
    }
    return reports;
}

async function loadWeeklyDrafts({ database, schoolId, teacherId, sectionId, startDate }) {
  const selectedSectionId = positiveId(sectionId);
  if (!selectedSectionId || typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    Number.isNaN(Date.parse(`${startDate}T00:00:00.000Z`)) ||
    new Date(`${startDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== startDate) {
    throw createError('Select a valid section and report week start date.');
  }
  const [sections] = await database.execute(
    `SELECT sections.id, sections.name, school_grade_levels.display_name AS gradeLevel,
      academic_years.id AS academicYearId, academic_years.label AS academicYearLabel,
      features.narrative_reports_enabled AS reportsEnabled
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      AND academic_years.school_id = sections.school_id AND academic_years.status = 'active'
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
    LEFT JOIN school_portal_features AS features ON features.school_id = sections.school_id
    WHERE sections.id = ? AND sections.school_id = ? AND sections.adviser_user_id = ?
      AND sections.status = 'active' LIMIT 1`,
    [selectedSectionId, Number(schoolId), Number(teacherId)]
  );
  const section = sections[0];
  if (!section) throw createError('Advisory section not found.', 404);
  if (Number(section.reportsEnabled) !== 1) throw createError('Narrative Reports are not enabled for this school.', 403);
  const reports = await readWeeklyDrafts(database, { section: { id: String(section.id) }, reportWeek: { startDate } }, { schoolId });
  return {
    section: {
      id: String(section.id), name: section.name, gradeLevel: section.gradeLevel,
      academicYearId: String(section.academicYearId), academicYearLabel: section.academicYearLabel
    },
    reportWeek: { startDate, endDate: reports[0]?.reportWeekEndDate || null },
    reports
  };
}

async function listWeeklyDrafts(req, res, next) {
  try {
    const result = await loadWeeklyDrafts({
      database: getDatabase(), schoolId: req.user?.schoolId, teacherId: req.user?.id,
      sectionId: req.query.sectionId, startDate: req.query.startDate
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

module.exports = {
  MAX_GENERATION_BATCH, generateWeeklyDrafts, listWeeklyDrafts, loadWeeklyDrafts, processWeeklyGeneration, readWeeklyDrafts,
  selectedStudents, sourceReferences
};
