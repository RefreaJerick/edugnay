const crypto = require('node:crypto');
const { getDatabase } = require('../config/database');
const { getCatalogEntry, matchesCatalogSnapshot } = require('../config/shsApprovedCatalog');
const { confirmationStatus, evaluateCompletion, subjectGradeStatus } = require('../config/shsCompletion');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function parseId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function evidenceHash(evidence) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(evidence))).digest('hex');
}

async function getYear(db, schoolId, yearId) {
  const [rows] = await db.execute(
    `SELECT id, label, status, start_date AS startDate, YEAR(start_date) AS startYear
     FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1`, [schoolId, yearId]
  );
  if (!rows.length) fail('School year not found.', 404);
  return rows[0];
}

async function findLearnerGrade12(db, schoolId, yearId, studentId = null) {
  const values = [schoolId, yearId];
  const learnerFilter = studentId ? ' AND ss.student_user_id = ?' : '';
  if (studentId) values.push(studentId);
  const [rows] = await db.execute(
    `SELECT s.id AS sectionId, s.academic_year_id AS academicYearId,
      s.school_level_id AS schoolLevelId, s.grade_level_id AS gradeLevelId,
      s.track_id AS trackId, s.name AS sectionName, g.grade_code AS gradeCode,
      t.track_code AS trackCode, ss.student_user_id AS studentId,
      u.display_name AS studentName, y.label AS yearLabel,
      YEAR(y.start_date) AS startYear
     FROM section_students ss
     JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
     JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
     JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
     JOIN users u ON u.id = ss.student_user_id AND u.school_id = ss.school_id AND u.role = 'student'
     LEFT JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
     WHERE ss.school_id = ? AND s.academic_year_id = ? AND s.status = 'active'
       AND ss.withdrawn_at IS NULL AND g.grade_code = 'grade-12'
       AND s.shs_curriculum_code = 'strengthened_2026' AND l.level_code = 'shs'${learnerFilter}
     ORDER BY u.last_name, u.first_name`, values
  );
  return rows;
}

async function findGrade11Section(db, schoolId, studentId, grade12StartDate) {
  const [rows] = await db.execute(
    `SELECT s.id AS sectionId, s.academic_year_id AS academicYearId,
      s.school_level_id AS schoolLevelId, s.grade_level_id AS gradeLevelId,
      g.grade_code AS gradeCode, t.track_code AS trackCode, s.name AS sectionName, y.label AS yearLabel,
      y.status AS yearStatus
     FROM section_students ss
     JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
     JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
     JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
     LEFT JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
     WHERE ss.school_id = ? AND ss.student_user_id = ? AND g.grade_code = 'grade-11'
       AND s.shs_curriculum_code = 'strengthened_2026' AND l.level_code = 'shs'
       AND y.start_date < ?
     ORDER BY y.start_date DESC LIMIT 1`, [schoolId, studentId, grade12StartDate]
  );
  return rows[0] || null;
}

async function termList(db, schoolId, yearId, levelId) {
  const [rows] = await db.execute(
    `SELECT id, name, sequence_number AS sequenceNumber
     FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ?
     ORDER BY sequence_number, id`, [schoolId, yearId, levelId]
  );
  return rows;
}

async function loadCoreSubjects(db, schoolId, section, studentId, terms) {
  if (!section) return [];
  const [subjects] = await db.execute(
    `SELECT sub.id AS subjectId, sub.name AS subjectName,
      sub.instructional_hours AS instructionalHours
     FROM section_teachers st
     JOIN subjects sub ON sub.id = st.subject_id AND sub.school_id = st.school_id
     WHERE st.school_id = ? AND st.section_id = ? AND sub.shs_subject_type = 'core'
     GROUP BY sub.id, sub.name, sub.instructional_hours ORDER BY sub.name`,
    [schoolId, section.sectionId]
  );
  const result = [];
  for (const subject of subjects) {
    const [grades] = await db.execute(
      `SELECT p.academic_term_id AS academicTermId, p.final_grade AS finalGrade,
        p.publication_version AS publicationVersion, p.published_at AS publishedAt
       FROM published_final_grades p
       JOIN academic_terms term ON term.id = p.academic_term_id AND term.school_id = p.school_id
         AND term.academic_year_id = ?
       WHERE p.school_id = ? AND p.section_id = ? AND p.subject_id = ?
         AND p.shs_elective_class_id IS NULL AND p.student_user_id = ?`,
      [section.academicYearId, schoolId, section.sectionId, subject.subjectId, studentId]
    );
    result.push({ ...subject, instructionalHours: Number(subject.instructionalHours || 0),
      gradeStatus: subjectGradeStatus(terms, grades), evidence: grades.map(row => ({ ...row, finalGrade: Number(row.finalGrade) })) });
  }
  return result;
}

async function loadRequest(db, schoolId, section, studentId) {
  if (!section) return null;
  const [rows] = await db.execute(
    `SELECT id, pathway_code AS pathwayCode, status FROM shs_selection_requests
     WHERE school_id = ? AND academic_year_id = ? AND grade_level_id = ? AND student_user_id = ? LIMIT 1`,
    [schoolId, section.academicYearId, section.gradeLevelId, studentId]
  );
  if (!rows.length) return null;
  const request = rows[0];
  const [classes] = await db.execute(
    `SELECT c.id AS classId, c.class_name AS className, c.is_active AS classActive,
      c.teacher_user_id AS teacherId, t.account_status AS teacherStatus,
      o.catalog_code AS catalogCode, o.catalog_version AS catalogVersion,
      o.subject_type AS subjectType, o.subject_name AS subjectName,
      o.instructional_hours AS instructionalHours, o.track_code AS trackCode,
      o.is_active AS offeringActive,
      EXISTS (SELECT 1 FROM shs_elective_class_students member
        WHERE member.school_id = c.school_id AND member.elective_class_id = c.id
          AND member.student_user_id = ? AND member.withdrawn_at IS NULL) AS memberActive
     FROM shs_selection_request_classes choice
     JOIN shs_elective_classes c ON c.id = choice.elective_class_id AND c.school_id = choice.school_id
     JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN users t ON t.id = c.teacher_user_id AND t.school_id = c.school_id
     WHERE choice.school_id = ? AND choice.request_id = ? ORDER BY o.subject_name, c.class_name`,
    [studentId, schoolId, request.id]
  );
  for (const item of classes) {
    item.instructionalHours = Number(item.instructionalHours);
    const [meetings] = await db.execute(
      `SELECT m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
        TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
        DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate
       FROM scheduled_classes sc JOIN timetable_meetings m
         ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
       WHERE sc.school_id = ? AND sc.shs_elective_class_id = ? ORDER BY m.weekday, m.start_time`,
      [schoolId, item.classId]
    );
    const terms = await termList(db, schoolId, section.academicYearId, section.schoolLevelId);
    const [grades] = await db.execute(
      `SELECT academic_term_id AS academicTermId, final_grade AS finalGrade,
        publication_version AS publicationVersion, published_at AS publishedAt
       FROM published_final_grades p JOIN academic_terms term
         ON term.id = p.academic_term_id AND term.school_id = p.school_id
          AND term.academic_year_id = ?
       WHERE p.school_id = ? AND p.shs_elective_class_id = ?
         AND p.section_id IS NULL AND p.subject_id IS NULL AND p.student_user_id = ?`,
      [section.academicYearId, schoolId, item.classId, studentId]
    );
    item.meetings = meetings;
    item.gradeStatus = subjectGradeStatus(terms, grades);
    item.evidence = grades.map(row => ({ ...row, finalGrade: Number(row.finalGrade) }));
    const entry = getCatalogEntry(item.catalogCode);
    item.catalogMatched = matchesCatalogSnapshot(entry, {
      catalogVersion: item.catalogVersion,
      subjectType: item.subjectType,
      subjectName: item.subjectName,
      instructionalHours: item.instructionalHours,
      trackCode: entry?.trackCode,
      gradeCode: section.gradeCode
    });
  }
  return { ...request, classes };
}

async function loadPriorHistory(db, schoolId, studentId) {
  const [rows] = await db.execute(
    `SELECT h.id, h.catalog_version AS catalogVersion, h.catalog_code AS catalogCode,
      h.instructional_hours AS instructionalHours, h.final_grade AS finalGrade,
      h.grade_source AS gradeSource, h.verified_by_user_id AS verifiedBy,
      verifier.display_name AS verifiedByName, h.verified_at AS verifiedAt
     FROM shs_verified_prior_electives h
     JOIN users verifier ON verifier.id = h.verified_by_user_id AND verifier.school_id = h.school_id
     WHERE h.school_id = ? AND h.student_user_id = ? ORDER BY h.catalog_code`, [schoolId, studentId]
  );
  return rows.map(row => {
    const entry = getCatalogEntry(row.catalogCode);
    return { ...row, verifiedBy: Number(row.verifiedBy), instructionalHours: Number(row.instructionalHours), finalGrade: row.finalGrade == null ? null : Number(row.finalGrade),
      catalogMatched: Boolean(entry && entry.type === 'academic_elective' && matchesCatalogSnapshot(entry, {
        catalogVersion: row.catalogVersion,
        subjectType: entry.type,
        subjectName: entry.name,
        instructionalHours: row.instructionalHours,
        trackCode: entry.trackCode,
        gradeCode: 11
      })),
      verifiedByName: row.verifiedByName || null };
  });
}

async function buildLearnerChecklist(db, schoolId, year, learner) {
  const grade12 = learner;
  const grade11 = await findGrade11Section(db, schoolId, learner.studentId, year.startDate);
  const grade11Terms = grade11 ? await termList(db, schoolId, grade11.academicYearId, grade11.schoolLevelId) : [];
  const grade12Terms = await termList(db, schoolId, grade12.academicYearId, grade12.schoolLevelId);
  const coreSubjects = await loadCoreSubjects(db, schoolId, grade11, learner.studentId, grade11Terms);
  const grade11Request = await loadRequest(db, schoolId, grade11, learner.studentId);
  const grade12Request = await loadRequest(db, schoolId, grade12, learner.studentId);
  const priorHistory = await loadPriorHistory(db, schoolId, learner.studentId);
  const result = evaluateCompletion({ grade12StartYear: Number(year.startYear),
    grade11TrackCode: grade11?.trackCode || null, grade12TrackCode: grade12.trackCode || null,
    coreSubjects,
    grade11Request: grade11Request && { ...grade11Request, trackCode: grade11.trackCode },
    grade12Request: grade12Request && { ...grade12Request, trackCode: grade12.trackCode },
    priorHistory });
  result.ready = result.checks.every(check => check.passed);
  const evidence = {
    studentId: Number(learner.studentId), grade12YearId: Number(year.id), grade12SectionId: Number(grade12.sectionId),
    grade11SectionId: grade11 ? Number(grade11.sectionId) : null,
    pathwayCode: result.pathwayCode, checks: result.checks,
    coreSubjects: coreSubjects.map(item => ({ subjectId: Number(item.subjectId), instructionalHours: item.instructionalHours,
      gradeStatus: item.gradeStatus, evidence: item.evidence })),
    grade11Request: grade11Request && { id: Number(grade11Request.id), pathwayCode: grade11Request.pathwayCode,
      status: grade11Request.status, classes: grade11Request.classes.map(item => ({ classId: Number(item.classId),
        catalogCode: item.catalogCode, instructionalHours: item.instructionalHours, gradeStatus: item.gradeStatus, evidence: item.evidence })) },
    grade12Request: grade12Request && { id: Number(grade12Request.id), pathwayCode: grade12Request.pathwayCode,
      status: grade12Request.status, classes: grade12Request.classes.map(item => ({ classId: Number(item.classId),
        catalogCode: item.catalogCode, instructionalHours: item.instructionalHours, memberActive: Boolean(item.memberActive),
        gradeStatus: item.gradeStatus, evidence: item.evidence })) },
    priorHistory: priorHistory.map(item => ({ catalogVersion: item.catalogVersion, catalogCode: item.catalogCode,
      instructionalHours: item.instructionalHours, finalGrade: item.finalGrade, gradeSource: item.gradeSource,
      verifiedBy: Number(item.verifiedBy) || item.verifiedBy, verifiedAt: item.verifiedAt, catalogMatched: item.catalogMatched }))
  };
  return { ...result, studentId: String(learner.studentId), studentName: learner.studentName,
    grade12YearId: String(year.id), grade12YearLabel: year.label,
    grade11YearLabel: grade11?.yearLabel || null, grade12TrackCode: grade12.trackCode,
    grade12SectionName: grade12.sectionName, grade11SectionName: grade11?.sectionName || null,
    confirmation: null, evidence, evidenceHash: evidenceHash(evidence), schoolYearStatus: year.status };
}

async function attachConfirmation(db, schoolId, checklist) {
  const [rows] = await db.execute(
    `SELECT c.id, c.pathway_code AS pathwayCode, c.evidence_hash AS evidenceHash,
      c.confirmation_version AS confirmationVersion, c.confirmed_at AS confirmedAt,
      admin.display_name AS confirmedBy
     FROM shs_completion_confirmations c
     JOIN users admin ON admin.id = c.confirmed_by_user_id AND admin.school_id = c.school_id
     WHERE c.school_id = ? AND c.student_user_id = ? AND c.grade12_academic_year_id = ? LIMIT 1`,
    [schoolId, checklist.studentId, checklist.grade12YearId]
  );
  const prior = rows[0] || null;
  checklist.confirmation = prior ? { ...prior, status: confirmationStatus(checklist, prior) } : null;
  return checklist;
}

async function list(req, res, next) {
  try {
    const db = getDatabase(); const schoolId = req.user.schoolId;
    const yearId = parseId(req.query.academicYearId, 'school year ID');
    const year = await getYear(db, schoolId, yearId);
    const learners = await findLearnerGrade12(db, schoolId, yearId);
    const candidates = [];
    for (const learner of learners) {
      candidates.push(await attachConfirmation(db, schoolId, await buildLearnerChecklist(db, schoolId, year, learner)));
    }
    res.set('Cache-Control', 'no-store');
    res.json({ year: { id: String(year.id), label: year.label, status: year.status }, candidates });
  } catch (error) { next(error); }
}

async function confirm(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const studentId = parseId(req.params.studentId, 'student ID');
    const yearId = parseId(req.body.academicYearId, 'school year ID');
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [yearId, schoolId]);
    const year = await getYear(connection, schoolId, yearId);
    if (year.status === 'archived') fail('Archived school years are read-only for completion confirmation.', 409);
    const learners = await findLearnerGrade12(connection, schoolId, yearId, studentId);
    if (!learners.length) fail('This learner is not enrolled in an active Strengthened SHS Grade 12 section for the selected year.', 404);
    const checklist = await buildLearnerChecklist(connection, schoolId, year, learners[0]);
    if (!checklist.ready) fail(`Completion cannot be confirmed: ${checklist.checks.filter(check => !check.passed).map(check => check.label + ': ' + check.detail).join(' ')}`, 409);
    const [previousRows] = await connection.execute(
      `SELECT id, confirmation_version AS confirmationVersion FROM shs_completion_confirmations
       WHERE school_id = ? AND student_user_id = ? AND grade12_academic_year_id = ? FOR UPDATE`, [schoolId, studentId, yearId]
    );
    const version = Number(previousRows[0]?.confirmationVersion || 0) + 1;
    const [history] = await connection.execute(
      `INSERT INTO shs_completion_confirmation_history
        (school_id, student_user_id, grade12_academic_year_id, pathway_code, evidence_hash,
         evidence_snapshot, confirmation_version, confirmed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, studentId, yearId, checklist.pathwayCode, checklist.evidenceHash,
        JSON.stringify(checklist.evidence), version, req.user.id]
    );
    await connection.execute(
      `INSERT INTO shs_completion_confirmations
        (school_id, student_user_id, grade12_academic_year_id, pathway_code, evidence_hash,
         confirmation_version, latest_history_id, confirmed_by_user_id, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE pathway_code = VALUES(pathway_code), evidence_hash = VALUES(evidence_hash),
         confirmation_version = VALUES(confirmation_version), latest_history_id = VALUES(latest_history_id),
         confirmed_by_user_id = VALUES(confirmed_by_user_id), confirmed_at = NOW()`,
      [schoolId, studentId, yearId, checklist.pathwayCode, checklist.evidenceHash, version, history.insertId, req.user.id]
    );
    await writeAuditLog(connection, req, 'shs_completion_confirmed', 'shs_completion_confirmation', history.insertId,
      { studentId, studentName: checklist.studentName, academicYearId: yearId,
        schoolYearLabel: checklist.grade12YearLabel, gradeName: 'Grade 12',
        sectionName: checklist.grade12SectionName, pathwayCode: checklist.pathwayCode,
        version, evidenceHash: checklist.evidenceHash });
    await connection.commit(); started = false;
    res.json({ confirmed: true, version, confirmedAt: new Date().toISOString(), evidenceHash: checklist.evidenceHash });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

module.exports = { list, confirm, buildLearnerChecklist, evidenceHash };
