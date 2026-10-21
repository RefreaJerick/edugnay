const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');
const { notifyParents } = require('../utils/parentNotifications');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function reportId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || !/^\d+$/.test(String(value))) throw createError('Select a valid report.');
  return id;
}

async function lockAdviserReport(connection, req) {
  const [rows] = await connection.execute(
    `SELECT reports.id, reports.report_status AS status,
      reports.ai_follow_up_suggestion AS followUpSuggestion,
      reports.student_user_id AS studentId, reports.section_id AS sectionId,
      reports.released_at AS releasedAt, reports.pending_correction AS pendingCorrection,
      reports.report_week_start_date AS weekStartDate
    FROM narrative_reports AS reports
    INNER JOIN sections ON sections.id = reports.section_id AND sections.school_id = reports.school_id
    INNER JOIN school_portal_features AS features ON features.school_id = reports.school_id
    WHERE reports.id = ? AND reports.school_id = ? AND sections.adviser_user_id = ?
      AND sections.status = 'active' AND features.narrative_reports_enabled = 1
    LIMIT 1 FOR UPDATE`,
    [reportId(req.params.reportId), Number(req.user.schoolId), Number(req.user.id)]
  );
  if (!rows.length) throw createError('Report not found for your advisory section.', 404);
  return rows[0];
}

function requireDraft(report) {
  if (report.status !== 'draft') throw createError('Only drafts can be changed or confirmed.', 409);
}

function reviewValues(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['summary', 'parentActions', 'teacherNote'].includes(key))) {
    throw createError('Provide valid report review details.');
  }
  const { summary, parentActions, teacherNote } = body;
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 1800 ||
    !Array.isArray(parentActions) || parentActions.length > 3 ||
    parentActions.some(action => typeof action !== 'string' || !action.trim() || action.length > 300) ||
    typeof teacherNote !== 'string' || teacherNote.length > 1000) {
    throw createError('The summary, actions, note, or follow-up choice is invalid.');
  }
  return {
    summary: summary.trim(), parentActions: parentActions.map(action => action.trim()),
    teacherNote: teacherNote.trim()
  };
}

async function saveReviewDraft(req, database = getDatabase()) {
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const report = await lockAdviserReport(connection, req);
    requireDraft(report);
    const values = reviewValues(req.body);
    await connection.execute(
      `UPDATE narrative_reports SET teacher_edited_summary = ?, teacher_note = ?
      WHERE id = ? AND school_id = ? AND report_status = 'draft'`,
      [values.summary, values.teacherNote || null, report.id, Number(req.user.schoolId)]
    );
    await connection.execute('DELETE FROM report_recommendations WHERE narrative_report_id = ?', [report.id]);
    for (const [index, action] of values.parentActions.entries()) {
      await connection.execute(
        'INSERT INTO report_recommendations (narrative_report_id, recommendation_text, display_order) VALUES (?, ?, ?)',
        [report.id, action, index + 1]
      );
    }
    await writeAuditLog(connection, req, 'narrative_report_draft_reviewed', 'narrative_reports', report.id,
      { sectionId: Number(report.sectionId), studentId: Number(report.studentId) });
    await connection.commit();
    transactionStarted = false;
    return { reportId: String(report.id), status: 'draft' };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function confirmDraft(req, database = getDatabase()) {
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    const choice = req.body?.followUpDecision ?? null;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== 'followUpDecision') || ![null, 'accept', 'dismiss'].includes(choice)) {
      throw createError('Provide a valid follow-up choice.');
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const report = await lockAdviserReport(connection, req);
    requireDraft(report);
    if (report.followUpSuggestion && !['accept', 'dismiss'].includes(choice)) {
      throw createError('Accept or dismiss the internal follow-up suggestion before confirming.');
    }
    if (!report.followUpSuggestion && choice !== null) throw createError('This report has no follow-up suggestion.');
    await connection.execute(
      `UPDATE narrative_reports SET report_status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP,
        is_at_risk = ? WHERE id = ? AND school_id = ? AND report_status = 'draft'`,
      [choice === 'accept', report.id, Number(req.user.schoolId)]
    );
    await writeAuditLog(connection, req, 'narrative_report_confirmed_held', 'narrative_reports', report.id,
      { sectionId: Number(report.sectionId), studentId: Number(report.studentId), released: false });
    await connection.commit();
    transactionStarted = false;
    return { reportId: String(report.id), status: 'confirmed', released: false };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function reopenConfirmedReport(req, database = getDatabase()) {
  const reason = req.body?.reason;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
    Object.keys(req.body).some(key => key !== 'reason') ||
    typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw createError('Enter a correction reason of at most 500 characters.');
  }
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const report = await lockAdviserReport(connection, req);
    if (report.status !== 'confirmed' || report.pendingCorrection) {
      throw createError('Only a confirmed report without an open correction can be reopened.', 409);
    }
    await connection.execute(
      `UPDATE narrative_reports SET report_status = 'draft', confirmed_at = NULL,
        is_at_risk = FALSE, pending_correction = ?
      WHERE id = ? AND school_id = ? AND report_status = 'confirmed'`,
      [Boolean(report.releasedAt), report.id, Number(req.user.schoolId)]
    );
    await writeAuditLog(connection, req, 'narrative_report_reopened', 'narrative_reports', report.id,
      { sectionId: Number(report.sectionId), studentId: Number(report.studentId),
        previouslyReleased: Boolean(report.releasedAt), reason: reason.trim() });
    await connection.commit();
    transactionStarted = false;
    return { reportId: String(report.id), status: 'draft', pendingCorrection: Boolean(report.releasedAt) };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function releaseConfirmedReport(req, database = getDatabase()) {
  if (process.env.AI_REPORTS_RELEASE_ENABLED !== 'true') {
    throw createError('Report release is not enabled for this school.', 503);
  }
  if (req.body != null && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
    throw createError('Report release does not accept additional data.');
  }
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const report = await lockAdviserReport(connection, req);
    if (report.status !== 'confirmed') throw createError('Confirm this report before releasing it.', 409);
    if (report.releasedAt && !report.pendingCorrection) {
      await connection.commit();
      transactionStarted = false;
      return { reportId: String(report.id), status: 'released', alreadyReleased: true };
    }
    const [[previousRelease]] = await connection.execute(
      `SELECT version_number AS versionNumber FROM narrative_report_releases
      WHERE school_id = ? AND narrative_report_id = ?
      ORDER BY version_number DESC LIMIT 1`,
      [Number(req.user.schoolId), report.id]
    );
    if (Boolean(report.releasedAt) !== Boolean(previousRelease)) {
      throw createError('Release history is incomplete. Contact the school administrator.', 409);
    }
    const versionNumber = Number(previousRelease?.versionNumber || 0) + 1;
    const [result] = await connection.execute(
      `UPDATE narrative_reports SET released_at = CURRENT_TIMESTAMP, pending_correction = FALSE
      WHERE id = ? AND school_id = ? AND report_status = 'confirmed'
        AND (released_at IS NULL OR pending_correction = TRUE)`,
      [report.id, Number(req.user.schoolId)]
    );
    if (!result.affectedRows) throw createError('This report could not be released. Reload and try again.', 409);
    const [[released]] = await connection.execute(
      `SELECT COALESCE(teacher_edited_summary, generated_summary) AS summary, released_at AS releasedAt
      FROM narrative_reports WHERE id = ? AND school_id = ?`,
      [report.id, Number(req.user.schoolId)]
    );
    const [actions] = await connection.execute(
      `SELECT recommendation_text AS text FROM report_recommendations
      WHERE narrative_report_id = ? ORDER BY display_order`, [report.id]
    );
    const [[adviser]] = await connection.execute(
      'SELECT display_name AS displayName FROM users WHERE id = ? AND school_id = ? LIMIT 1',
      [Number(req.user.id), Number(req.user.schoolId)]
    );
    if (!adviser) throw createError('Releasing adviser not found.', 404);
    await connection.execute(
      `INSERT INTO narrative_report_releases
        (school_id, narrative_report_id, version_number, summary, parent_actions, released_at, released_by_user_id, released_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(req.user.schoolId), report.id, versionNumber, released.summary,
        JSON.stringify(actions.map(action => action.text)), released.releasedAt, Number(req.user.id), adviser.displayName]
    );
    const [[student]] = await connection.execute(
      "SELECT display_name AS displayName FROM users WHERE id = ? AND school_id = ? AND role = 'student' LIMIT 1",
      [Number(report.studentId), Number(req.user.schoolId)]
    );
    if (!student) throw createError('Report learner not found.', 404);
    const targetPath = `/views/parent/edugnay-parent-reports.html?studentId=${encodeURIComponent(report.studentId)}&reportId=${encodeURIComponent(report.id)}`;
    await writeAuditLog(connection, req, 'narrative_report_released_to_parents', 'narrative_reports', report.id,
      { sectionId: Number(report.sectionId), studentId: Number(report.studentId),
        weekStartDate: report.weekStartDate, versionNumber });
    await notifyParents(connection, {
      schoolId: Number(req.user.schoolId), studentId: Number(report.studentId), code: 'narrative_report_released',
      eventKey: versionNumber === 1
        ? `narrative-report:${report.id}:released`
        : `narrative-report:${report.id}:released:v${versionNumber}`,
      title: versionNumber === 1 ? 'Weekly report available' : 'Weekly report updated',
      message: versionNumber === 1
        ? `A new weekly progress report for ${student.displayName} is available.`
        : `A corrected weekly progress report for ${student.displayName} is available.`,
      targetPath
    });
    await connection.commit();
    transactionStarted = false;
    return { reportId: String(report.id), status: 'released', versionNumber, alreadyReleased: false };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function saveReview(req, res, next) {
  try {
    const result = await saveReviewDraft(req);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

async function confirmReview(req, res, next) {
  try {
    const result = await confirmDraft(req);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

async function releaseReview(req, res, next) {
  try {
    const result = await releaseConfirmedReport(req);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

async function reopenReview(req, res, next) {
  try {
    const result = await reopenConfirmedReport(req);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

function releaseActions(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); }
  catch { return []; }
}

async function readReleaseHistory(database, req) {
  const id = reportId(req.params.reportId);
  const schoolId = Number(req.user.schoolId);
  const teacher = req.user.role === 'teacher';
  const [reports] = await database.execute(
    `SELECT reports.id FROM narrative_reports AS reports
    INNER JOIN sections ON sections.id = reports.section_id AND sections.school_id = reports.school_id
    WHERE reports.id = ? AND reports.school_id = ?
      ${teacher ? 'AND sections.status = \'active\' AND sections.adviser_user_id = ?' : ''}
    LIMIT 1`,
    teacher ? [id, schoolId, Number(req.user.id)] : [id, schoolId]
  );
  if (!reports.length) throw createError('Report history not found.', 404);
  const [rows] = await database.execute(
    `SELECT releases.version_number AS versionNumber, releases.summary,
      releases.parent_actions AS parentActions,
      DATE_FORMAT(releases.released_at, '%Y-%m-%dT%H:%i:%s') AS releasedAt,
      releases.released_by_name AS adviserName
    FROM narrative_report_releases AS releases
    WHERE releases.school_id = ? AND releases.narrative_report_id = ?
    ORDER BY releases.version_number DESC`, [schoolId, id]
  );
  const [reopens] = await database.execute(
    `SELECT DATE_FORMAT(log.created_at, '%Y-%m-%dT%H:%i:%s') AS reopenedAt,
      log.details, actors.display_name AS adviserName
    FROM audit_logs AS log
    LEFT JOIN users AS actors ON actors.id = log.actor_user_id AND actors.school_id = log.school_id
    WHERE log.school_id = ? AND log.entity_type = 'narrative_reports'
      AND log.entity_id = ? AND log.action_type = 'narrative_report_reopened'
    ORDER BY log.id DESC`, [schoolId, id]
  );
  return {
    reportId: String(id),
    releases: rows.map(row => ({
      versionNumber: Number(row.versionNumber), summary: row.summary,
      parentActions: releaseActions(row.parentActions), releasedAt: row.releasedAt,
      adviserName: row.adviserName || null
    })),
    reopens: reopens.map(row => {
      let details = row.details;
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch { details = {}; }
      }
      return { reopenedAt: row.reopenedAt, adviserName: row.adviserName || null,
        reason: String(details?.reason || '') };
    })
  };
}

async function getReleaseHistory(req, res, next) {
  try {
    const result = await readReleaseHistory(getDatabase(), req);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) { next(error); }
}

async function listSchoolReleaseHistory(req, res, next) {
  try {
    const schoolId = Number(req.user.schoolId);
    const [rows] = await getDatabase().execute(
      `SELECT reports.id AS reportId, students.display_name AS learnerName,
        sections.name AS sectionName, reports.report_week_start_date AS weekStartDate,
        MAX(releases.version_number) AS latestVersion, MAX(releases.released_at) AS latestReleaseAt
      FROM narrative_report_releases AS releases
      INNER JOIN narrative_reports AS reports ON reports.id = releases.narrative_report_id
        AND reports.school_id = releases.school_id
      INNER JOIN users AS students ON students.id = reports.student_user_id AND students.school_id = reports.school_id
      INNER JOIN sections ON sections.id = reports.section_id AND sections.school_id = reports.school_id
      WHERE releases.school_id = ?
      GROUP BY reports.id, students.display_name, sections.name, reports.report_week_start_date
      ORDER BY latestReleaseAt DESC, reports.id DESC LIMIT 50`, [schoolId]
    );
    res.set('Cache-Control', 'no-store');
    res.json({ reports: rows.map(row => ({
      reportId: String(row.reportId), learnerName: row.learnerName,
      sectionName: row.sectionName, weekStartDate: row.weekStartDate,
      latestVersion: Number(row.latestVersion), latestReleaseAt: row.latestReleaseAt
    })) });
  } catch (error) { next(error); }
}

module.exports = {
  saveReview, confirmReview, releaseReview, reopenReview, getReleaseHistory, listSchoolReleaseHistory,
  saveReviewDraft, confirmDraft, reopenConfirmedReport, releaseConfirmedReport, readReleaseHistory, reviewValues
};
