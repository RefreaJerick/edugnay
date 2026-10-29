const { getDatabase } = require('../config/database');
const { catalog, getCatalogEntry, matchesCatalogSnapshot, isCatalogGradeEligible, isCatalogAvailableForNewUse } = require('../config/shsApprovedCatalog');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}
function name(value, label) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > 100) fail(`${label} must be between 1 and 100 characters.`);
  return text;
}
function boolean(value) { if (typeof value !== 'boolean') fail('Active state must be true or false.'); return value; }
async function context(connection, schoolId, yearId, gradeId) {
  const [years] = await connection.execute(
    `SELECT id, label, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate
     FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1`, [yearId, schoolId]
  );
  if (!years.length) fail('School year not found.', 404);
  const [grades] = await connection.execute(
    `SELECT g.id, g.grade_code AS gradeCode FROM school_grade_levels g
     JOIN school_levels l ON l.id = g.school_level_id AND l.school_id = g.school_id
     WHERE g.id = ? AND g.school_id = ? AND g.is_enabled = TRUE
       AND l.level_code = 'shs' AND l.is_enabled = TRUE LIMIT 1`, [gradeId, schoolId]
  );
  if (!grades.length) fail('Enabled SHS grade not found.', 404);
  return { year: years[0], grade: grades[0] };
}

async function offering(connection, schoolId, offeringId) {
  const [rows] = await connection.execute(
    `SELECT o.*, y.status AS yearStatus, y.label AS schoolYearLabel, g.grade_code AS gradeCode
     FROM shs_offerings o
     JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
     JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     WHERE o.id = ? AND o.school_id = ? LIMIT 1`, [offeringId, schoolId]
  );
  if (!rows.length) fail('Offering not found.', 404);
  return rows[0];
}

async function electiveClass(connection, schoolId, classId) {
  const [rows] = await connection.execute(
    `SELECT c.*, o.academic_year_id AS academicYearId, o.subject_name AS subjectName,
       o.track_code AS trackCode, g.grade_code AS gradeCode, y.label AS schoolYearLabel,
       y.status AS yearStatus, previous_teacher.display_name AS previousTeacherName
     FROM shs_elective_classes c
     JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
     LEFT JOIN users previous_teacher ON previous_teacher.id = c.teacher_user_id
       AND previous_teacher.school_id = c.school_id
     WHERE c.id = ? AND c.school_id = ? LIMIT 1`, [classId, schoolId]
  );
  if (!rows.length) fail('Elective class not found.', 404);
  return rows[0];
}

async function teacher(connection, schoolId, teacherId) {
  const [rows] = await connection.execute(
    `SELECT id, display_name AS displayName FROM users
     WHERE id = ? AND school_id = ? AND role = 'teacher' AND account_status = 'active' LIMIT 1`,
    [teacherId, schoolId]
  );
  if (!rows.length) fail('Choose an active teacher in this school.', 404);
  return rows[0];
}

async function mismatchedImmersionMemberships(db, schoolId, yearId) {
  const codes = catalog.filter(entry => entry.assessmentGroup === 'work_immersion').map(entry => entry.code);
  const [rows] = await db.execute(
    `SELECT DISTINCT c.id AS classId, m.student_user_id AS learnerId,
       o.catalog_code AS catalogCode, t.track_code AS learnerTrackCode
     FROM shs_elective_class_students m
     JOIN shs_elective_classes c ON c.id = m.elective_class_id AND c.school_id = m.school_id
     JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN section_students ss ON ss.student_user_id = m.student_user_id AND ss.school_id = m.school_id
       AND ss.withdrawn_at IS NULL
     JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
       AND s.academic_year_id = o.academic_year_id AND s.grade_level_id = o.grade_level_id
       AND s.status = 'active' AND s.shs_curriculum_code = 'strengthened_2026'
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id AND l.level_code = 'shs'
     JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
     WHERE m.school_id = ? AND o.academic_year_id = ? AND m.withdrawn_at IS NULL
       AND o.catalog_code IN (${codes.map(() => '?').join(',')})`, [schoolId, yearId, ...codes]
  );
  const counts = new Map();
  const flagged = new Set();
  for (const row of rows) {
    const entry = getCatalogEntry(row.catalogCode);
    if (entry?.assessmentGroup !== 'work_immersion' || entry.trackCode === row.learnerTrackCode) continue;
    const classId = Number(row.classId);
    const membershipKey = `${classId}:${Number(row.learnerId)}`;
    if (flagged.has(membershipKey)) continue;
    flagged.add(membershipKey);
    counts.set(classId, (counts.get(classId) || 0) + 1);
  }
  return counts;
}

async function list(req, res, next) {
  try {
    const db = getDatabase();
    const schoolId = req.user.schoolId;
    const [years] = await db.execute(
      `SELECT id, label, status
       FROM academic_years WHERE school_id = ? ORDER BY start_date DESC`, [schoolId]);
    const [grades] = await db.execute(
      `SELECT g.id, g.grade_code AS code, g.display_name AS label FROM school_grade_levels g
       JOIN school_levels l ON l.id = g.school_level_id AND l.school_id = g.school_id
       WHERE g.school_id = ? AND g.is_enabled = TRUE AND l.is_enabled = TRUE AND l.level_code = 'shs'
       ORDER BY g.grade_code`, [schoolId]);
    const [tracks] = await db.execute(
      `SELECT t.track_code AS code, t.display_name AS label FROM school_shs_tracks t
       JOIN school_levels l ON l.id = t.school_level_id AND l.school_id = t.school_id
       WHERE t.school_id = ? AND t.is_enabled = TRUE AND l.level_code = 'shs'
         AND t.track_code IN ('academic', 'techpro') ORDER BY t.track_code`, [schoolId]);
    const [teachers] = await db.execute(
      `SELECT id, display_name AS name FROM users WHERE school_id = ? AND role = 'teacher'
       AND account_status = 'active' ORDER BY display_name`, [schoolId]);
    const yearId = req.query.academicYearId ? id(req.query.academicYearId, 'school year ID') : years.find(y => y.status === 'active')?.id || years[0]?.id;
    if (yearId && !years.some(year => Number(year.id) === Number(yearId))) fail('School year not found.', 404);
    if (!yearId) return res.json({ years, grades, tracks, teachers, catalog, year: null, offerings: [], classes: [] });
    const [offerings] = await db.execute(
      `SELECT o.id, o.grade_level_id AS gradeLevelId, g.grade_code AS gradeCode,
        o.catalog_version AS catalogVersion, o.catalog_code AS catalogCode,
        o.track_code AS trackCode, o.subject_type AS subjectType,
        o.subject_name AS subjectName, o.instructional_hours AS instructionalHours,
        o.is_active AS isActive
       FROM shs_offerings o JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
       WHERE o.school_id = ? AND o.academic_year_id = ? ORDER BY g.grade_code, o.subject_name`, [schoolId, yearId]);
    const [classes] = await db.execute(
      `SELECT c.id, c.offering_id AS offeringId, c.class_name AS className, c.capacity,
        c.teacher_user_id AS teacherId, t.display_name AS teacherName,
        (t.account_status = 'active') AS teacherActive,
        c.is_active AS classActive, o.is_active AS offeringActive,
        o.catalog_version AS catalogVersion, o.catalog_code AS catalogCode,
        o.track_code AS trackCode, o.subject_type AS subjectType,
        o.subject_name AS subjectName, o.instructional_hours AS instructionalHours,
        o.grade_level_id AS gradeLevelId, g.grade_code AS gradeCode,
        (SELECT COUNT(*) FROM shs_elective_class_students e WHERE e.school_id = c.school_id
          AND e.elective_class_id = c.id AND e.withdrawn_at IS NULL) AS enrolledCount,
        (SELECT COUNT(*) FROM scheduled_classes sc JOIN timetable_meetings m
          ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
          WHERE sc.school_id = c.school_id AND sc.shs_elective_class_id = c.id) AS meetingCount
       FROM shs_elective_classes c
       JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
       JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
       JOIN users t ON t.id = c.teacher_user_id AND t.school_id = c.school_id
       WHERE c.school_id = ? AND o.academic_year_id = ? ORDER BY o.subject_name, c.class_name`, [schoolId, yearId]);
    const trackReviewCounts = await mismatchedImmersionMemberships(db, schoolId, yearId);
    const selectedYear = years.find(y => Number(y.id) === Number(yearId));
    const annotateCatalog = item => {
      const entry = getCatalogEntry(item.catalogCode);
      const catalogValid = matchesCatalogSnapshot(entry, {
        catalogVersion: item.catalogVersion,
        trackCode: item.trackCode,
        subjectType: item.subjectType,
        subjectName: item.subjectName,
        instructionalHours: item.instructionalHours,
        gradeCode: item.gradeCode
      });
      return { ...item, catalogValid, catalogGradeEligible: isCatalogGradeEligible(entry, item.gradeCode),
        catalogAvailableForNewUse: isCatalogAvailableForNewUse(entry),
        catalogHoursUnit: entry?.hoursUnit || null,
        catalogHoursUnitByGrade: entry?.hoursUnitByGrade || null,
        catalogVerificationStatus: entry?.verificationStatus || 'unknown',
        catalogVerificationNote: entry?.verificationNote || null,
        catalogGroup: entry?.catalogGroup || null,
        clusterCode: entry?.clusterCode || null, clusterName: entry?.clusterName || null,
        trackLabel: entry?.trackLabel || null };
    };
    res.json({ years, grades, tracks, teachers, catalog, year: selectedYear,
      offerings: offerings.map(annotateCatalog),
      classes: classes.map(item => ({ ...annotateCatalog(item),
        trackReviewCount: trackReviewCounts.get(Number(item.id)) || 0 })) });
  } catch (error) { next(error); }
}

async function activate(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const yearId = id(req.body.academicYearId, 'school year ID');
    const gradeId = id(req.body.gradeLevelId, 'grade ID');
    const codes = Array.isArray(req.body.catalogCodes) ? req.body.catalogCodes : [req.body.catalogCode];
    if (!codes.length || codes.length > 100 || codes.some(code => typeof code !== 'string')
      || new Set(codes).size !== codes.length) fail('Choose distinct approved subjects.');
    const entries = codes.map(code => getCatalogEntry(code));
    if (entries.some(entry => !entry)) fail('Choose approved catalog subjects.');
    if (entries.some(entry => !isCatalogAvailableForNewUse(entry)))
      fail('One or more subjects are waiting for DepEd source verification and cannot be added yet.', 409);
    const { year, grade } = await context(connection, schoolId, yearId, gradeId);
    if (year.status === 'archived') fail('Archived school years are read-only.', 409);
    const gradeNumber = Number(grade.gradeCode.replace('grade-', ''));
    if (entries.some(entry => !isCatalogGradeEligible(entry, gradeNumber))) fail('A subject is not approved for the selected grade.');
    const [tracks] = await connection.execute(
      `SELECT track_code AS trackCode FROM school_shs_tracks WHERE school_id = ? AND is_enabled = TRUE`,
      [schoolId]
    );
    const enabledTracks = new Set(tracks.map(track => track.trackCode));
    if (entries.some(entry => !enabledTracks.has(entry.trackCode)))
      fail('Enable the required SHS track in School Settings first.', 409);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [yearId, schoolId]);
    const locked = await context(connection, schoolId, yearId, gradeId);
    if (locked.year.status === 'archived') fail('Archived school years are read-only.', 409);
    const added = [];
    for (const entry of entries) {
      const [result] = await connection.execute(
        `INSERT INTO shs_offerings (school_id, academic_year_id, grade_level_id,
          catalog_version, catalog_code, track_code, subject_type, subject_name, instructional_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [schoolId, yearId, gradeId, entry.version, entry.code, entry.trackCode, entry.type, entry.name, entry.hours]
      );
      added.push({ id: result.insertId, code: entry.code, name: entry.name });
    }
    await writeAuditLog(connection, req, 'shs_offering_activated', 'shs_offering', added[0].id,
      { summary: `Added ${added.length} approved SHS subject(s)`, subjectCount: added.length,
        subjects: added.map(item => ({ subjectName: item.name })), gradeCode: grade.gradeCode,
        trackCode: new Set(entries.map(entry => entry.trackCode)).size === 1 ? entries[0].trackCode : null,
        schoolYear: year.label, catalogCodes: added.map(item => item.code) });
    await connection.commit(); started = false;
    res.status(201).json({ id: added[0].id, added });
  } catch (error) {
    if (started) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

async function setOfferingActive(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const offeringId = id(req.params.offeringId, 'offering ID');
    const active = boolean(req.body.isActive);
    const current = await offering(connection, schoolId, offeringId);
    if (current.yearStatus === 'archived') fail('Archived school years are read-only.', 409);
    const currentCatalog = getCatalogEntry(current.catalog_code);
    if (active && !isCatalogAvailableForNewUse(currentCatalog))
      fail('This subject is waiting for DepEd source verification and cannot be reactivated yet.', 409);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [current.academic_year_id, schoolId]);
    if ((await offering(connection, schoolId, offeringId)).yearStatus === 'archived') fail('Archived school years are read-only.', 409);
    await connection.execute('UPDATE shs_offerings SET is_active = ? WHERE id = ? AND school_id = ?', [active, offeringId, schoolId]);
    await writeAuditLog(connection, req, 'shs_offering_updated', 'shs_offering', offeringId, {
      summary: active ? 'Activated' : 'Paused', subjectName: current.subject_name, isActive: active,
      gradeCode: current.gradeCode, trackCode: current.track_code, schoolYearLabel: current.schoolYearLabel
    });
    await connection.commit(); started = false; res.json({ id: offeringId, isActive: active });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function createClass(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const offeringId = id(req.body.offeringId, 'offering ID');
    const teacherId = id(req.body.teacherId, 'teacher ID');
    const className = name(req.body.className, 'Class name');
    const capacity = id(req.body.capacity, 'capacity');
    if (capacity > 500) fail('Capacity cannot exceed 500.');
    const current = await offering(connection, schoolId, offeringId);
    if (current.yearStatus === 'archived' || !current.is_active) fail('This offering is read-only.', 409);
    if (!isCatalogAvailableForNewUse(getCatalogEntry(current.catalog_code)))
      fail('This subject is waiting for DepEd source verification; new classes cannot be added yet.', 409);
    const assignedTeacher = await teacher(connection, schoolId, teacherId);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [current.academic_year_id, schoolId]);
    const locked = await offering(connection, schoolId, offeringId);
    if (locked.yearStatus === 'archived' || !locked.is_active) fail('This offering is read-only.', 409);
    if (!isCatalogAvailableForNewUse(getCatalogEntry(locked.catalog_code)))
      fail('This subject is waiting for DepEd source verification; new classes cannot be added yet.', 409);
    await teacher(connection, schoolId, teacherId);
    const [result] = await connection.execute(
      `INSERT INTO shs_elective_classes (school_id, offering_id, teacher_user_id, class_name, capacity)
       VALUES (?, ?, ?, ?, ?)`, [schoolId, offeringId, teacherId, className, capacity]
    );
    await writeAuditLog(connection, req, 'shs_elective_class_created', 'shs_elective_class', result.insertId, {
      summary: className, className, subjectName: current.subject_name,
      teacherName: assignedTeacher.displayName, capacity, gradeCode: current.gradeCode,
      trackCode: current.track_code, schoolYearLabel: current.schoolYearLabel
    });
    await connection.commit(); started = false; res.status(201).json({ id: result.insertId });
  } catch (error) { if (started) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') error.status = 409; next(error); } finally { connection.release(); }
}

async function updateClass(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const classId = id(req.params.classId, 'class ID');
    const current = await electiveClass(connection, schoolId, classId);
    if (current.yearStatus === 'archived') fail('Archived school years are read-only.', 409);
    const teacherId = req.body.teacherId === undefined ? Number(current.teacher_user_id) : id(req.body.teacherId, 'teacher ID');
    const className = req.body.className === undefined ? current.class_name : name(req.body.className, 'Class name');
    const capacity = req.body.capacity === undefined ? Number(current.capacity) : id(req.body.capacity, 'capacity');
    const active = req.body.isActive === undefined ? Boolean(current.is_active) : boolean(req.body.isActive);
    if (capacity > 500) fail('Capacity cannot exceed 500.');
    const assignedTeacher = await teacher(connection, schoolId, teacherId);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [current.academicYearId, schoolId]);
    if ((await electiveClass(connection, schoolId, classId)).yearStatus === 'archived') fail('Archived school years are read-only.', 409);
    await teacher(connection, schoolId, teacherId);
    const [members] = await connection.execute(
      `SELECT COUNT(*) AS total FROM shs_elective_class_students WHERE school_id = ? AND elective_class_id = ? AND withdrawn_at IS NULL`, [schoolId, classId]
    );
    if (capacity < Number(members[0].total)) fail('Capacity cannot be below current enrollment.', 409);
    if (teacherId !== Number(current.teacher_user_id)) {
      const { assertElectiveTeacherScheduleAvailable } = require('./timetablesController');
      await assertElectiveTeacherScheduleAvailable(connection, schoolId, current.academicYearId, classId, teacherId);
    }
    await connection.execute(
      `UPDATE shs_elective_classes SET teacher_user_id = ?, class_name = ?, capacity = ?, is_active = ?
       WHERE id = ? AND school_id = ?`, [teacherId, className, capacity, active, classId, schoolId]
    );
    const changes = {};
    if (className !== current.class_name) changes.className = { from: current.class_name, to: className };
    if (teacherId !== Number(current.teacher_user_id)) {
      changes.teacherName = { from: current.previousTeacherName || '', to: assignedTeacher.displayName };
    }
    if (capacity !== Number(current.capacity)) changes.capacity = { from: Number(current.capacity), to: capacity };
    await writeAuditLog(connection, req, 'shs_elective_class_updated', 'shs_elective_class', classId, {
      summary: className, className, subjectName: current.subjectName,
      teacherName: assignedTeacher.displayName, capacity, gradeCode: current.gradeCode,
      trackCode: current.trackCode, schoolYearLabel: current.schoolYearLabel,
      wasActive: Boolean(current.is_active), isActive: active, changes
    });
    await connection.commit(); started = false; res.json({ id: classId });
  } catch (error) { if (started) await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') error.status = 409; next(error); } finally { connection.release(); }
}

async function deleteClass(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const classId = id(req.params.classId, 'class ID');
    const current = await electiveClass(connection, schoolId, classId);
    if (current.yearStatus === 'archived') fail('Archived school years are read-only.', 409);

    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [current.academicYearId, schoolId]);
    const [lockedClass] = await connection.execute(
      'SELECT id FROM shs_elective_classes WHERE id = ? AND school_id = ? FOR UPDATE', [classId, schoolId]
    );
    if (!lockedClass.length) fail('Elective class not found.', 404);
    if ((await electiveClass(connection, schoolId, classId)).yearStatus === 'archived') fail('Archived school years are read-only.', 409);

    const [referenceRows] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM scheduled_classes WHERE school_id = ? AND shs_elective_class_id = ?) AS timetableRecords,
        (SELECT COUNT(*) FROM shs_elective_class_students WHERE school_id = ? AND elective_class_id = ?) AS membershipRecords,
        (SELECT COUNT(*) FROM shs_selection_request_classes WHERE school_id = ? AND elective_class_id = ?) AS choiceRecords,
        (SELECT COUNT(*) FROM assignments WHERE school_id = ? AND shs_elective_class_id = ?) AS assignmentRecords,
        (SELECT COUNT(*) FROM grading_items WHERE school_id = ? AND shs_elective_class_id = ?) AS assessmentRecords,
        (SELECT COUNT(*) FROM published_final_grades WHERE school_id = ? AND shs_elective_class_id = ?) AS publishedGrades,
        (SELECT COUNT(*) FROM shs_grade_publication_history WHERE school_id = ? AND shs_elective_class_id = ?) AS gradeHistory,
        (SELECT COUNT(*) FROM attendance_sessions WHERE school_id = ? AND shs_elective_class_id = ?) AS attendanceRecords,
        (SELECT COUNT(*) FROM learning_materials WHERE school_id = ? AND shs_elective_class_id = ?) AS materialRecords`,
      Array.from({ length: 9 }, () => [schoolId, classId]).flat()
    );
    const references = referenceRows[0] || {};
    const [choiceHistory] = await connection.execute(
      `SELECT COUNT(*) AS total FROM shs_selection_history
       WHERE school_id = ? AND (
         JSON_CONTAINS(details, JSON_ARRAY(?), '$.classIds')
         OR JSON_CONTAINS(details, JSON_ARRAY(?), '$.oldClassIds')
       )`, [schoolId, classId, classId]
    );
    if (Object.values(references).some(value => Number(value) > 0) || Number(choiceHistory[0]?.total) > 0) {
      fail('This class has linked timetable, learner, or learning records and cannot be deleted. Pause the class instead to keep its history.', 409);
    }

    await writeAuditLog(connection, req, 'shs_elective_class_deleted', 'shs_elective_class', classId,
      { summary: current.class_name, className: current.class_name, subjectName: current.subjectName,
        gradeCode: current.gradeCode, trackCode: current.trackCode, schoolYearLabel: current.schoolYearLabel });
    const [result] = await connection.execute(
      'DELETE FROM shs_elective_classes WHERE id = ? AND school_id = ?', [classId, schoolId]
    );
    if (!result.affectedRows) fail('Elective class not found.', 404);
    await connection.commit(); started = false;
    res.status(204).end();
  } catch (error) {
    if (started) await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

module.exports = { list, mismatchedImmersionMemberships, activate, setOfferingActive, createClass, updateClass, deleteClass };
