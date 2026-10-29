const { getDatabase } = require('../config/database');
const { meetingsConflict, normalizeClassIds, validateRecordedChoices } = require('../config/shsSelection');
const { getCatalogEntry, matchesCatalogSnapshot, isCatalogGradeEligible, isCatalogAvailableForNewUse } = require('../config/shsApprovedCatalog');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value, label = 'ID') { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail(`Invalid ${label}.`); return n; }
function enabled(req, res, next) {
  if (process.env.SHS_SELECTION_ENABLED !== 'true') return res.status(404).json({ message: 'Elective selection is not available.' });
  next();
}
const execute = (db, sql, args = []) => db.execute(sql, args).then(([rows]) => rows);

async function placement(db, schoolId, studentId, yearId = null) {
  const rows = await execute(db,
    `SELECT s.id AS sectionId, s.name AS sectionName, s.academic_year_id AS yearId, s.grade_level_id AS gradeId,
      g.grade_code AS gradeCode, g.display_name AS gradeName, t.track_code AS trackCode,
      y.label AS schoolYear, y.status AS yearStatus, u.display_name AS studentName,
      DATE_FORMAT(y.start_date, '%Y-%m-%d') AS yearStart, DATE_FORMAT(y.end_date, '%Y-%m-%d') AS yearEnd
     FROM section_students ss JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
     JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
     JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
     JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
     JOIN users u ON u.id = ss.student_user_id AND u.school_id = ss.school_id
     WHERE ss.school_id = ? AND ss.student_user_id = ? AND ss.withdrawn_at IS NULL
       AND s.status = 'active' AND s.shs_curriculum_code = 'strengthened_2026'
       AND l.level_code = 'shs' AND u.role = 'student' AND u.account_status = 'active'
       AND (? IS NULL OR s.academic_year_id = ?)
     ORDER BY (y.status = 'active') DESC, y.start_date DESC LIMIT 2`,
    [schoolId, studentId, yearId, yearId]);
  if (!rows.length) fail('School staff must assign you to an active Grade 11 or Grade 12 SHS section before you can record electives.', 409);
  if (rows.length > 1 && Number(rows[0].yearId) === Number(rows[1].yearId)) fail('This learner has more than one active SHS section.', 409);
  if (!['grade-11', 'grade-12'].includes(rows[0].gradeCode)) fail('Elective choices are available only for Grade 11 and Grade 12.', 409);
  return rows[0];
}

async function requestFor(db, schoolId, yearId, gradeId, studentId, lock = false) {
  const rows = await execute(db,
    `SELECT * FROM shs_selection_requests WHERE school_id = ? AND academic_year_id = ?
      AND grade_level_id = ? AND student_user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, yearId, gradeId, studentId]);
  return rows[0] || null;
}

function choiceAuditDetails(place, classCount, extra = {}) {
  const gradeName = place.gradeName || `Grade ${String(place.gradeCode || '').replace(/^grade-/, '')}`;
  const schoolYear = String(place.schoolYear || '').trim();
  const sectionName = String(place.sectionName || '').trim();
  const summary = [gradeName, sectionName, schoolYear ? `S.Y. ${schoolYear}` : '',
    `${classCount} class${classCount === 1 ? '' : 'es'}`].filter(Boolean).join(', ');
  return {
    studentName: place.studentName || '',
    gradeName,
    sectionName,
    sectionId: Number(place.sectionId),
    schoolYear,
    pathwayCode: place.trackCode || '',
    classCount,
    summary,
    ...extra
  };
}

function sameClassIds(left, right) {
  return left.length === right.length && left.every(classId => right.includes(classId));
}

async function classRows(db, schoolId, yearId, gradeId, lockIds = [], countExcludeStudentId = null) {
  if (lockIds.length) await execute(db,
    `SELECT id FROM shs_elective_classes WHERE school_id = ? AND id IN (${lockIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
    [schoolId, ...lockIds]);
  const classes = await execute(db,
    `SELECT c.id, c.class_name AS className, c.capacity, c.is_active AS classActive,
      o.catalog_version AS catalogVersion, o.catalog_code AS catalogCode, o.track_code AS trackCode,
      o.subject_name AS subjectName, o.subject_type AS subjectType,
      o.instructional_hours AS instructionalHours, o.is_active AS offeringActive,
      g.grade_code AS gradeCode,
      t.display_name AS teacherName, t.account_status AS teacherStatus, t.role AS teacherRole,
      (SELECT COUNT(*) FROM shs_elective_class_students e WHERE e.school_id = c.school_id
        AND e.elective_class_id = c.id AND e.withdrawn_at IS NULL
        AND (? IS NULL OR e.student_user_id <> ?)) AS enrolledCount
     FROM shs_elective_classes c JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     JOIN users t ON t.id = c.teacher_user_id AND t.school_id = c.school_id
     WHERE c.school_id = ? AND o.academic_year_id = ? AND o.grade_level_id = ? ORDER BY o.subject_name, c.class_name`,
    [countExcludeStudentId, countExcludeStudentId, schoolId, yearId, gradeId]);
  const meetings = await execute(db,
    `SELECT c.id AS classId, m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
      TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
      DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room
     FROM shs_elective_classes c JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN scheduled_classes sc ON sc.shs_elective_class_id = c.id AND sc.school_id = c.school_id
     JOIN timetable_meetings m ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
     WHERE c.school_id = ? AND o.academic_year_id = ? AND o.grade_level_id = ?`, [schoolId, yearId, gradeId]);
  return classes.map(item => {
    const entry = getCatalogEntry(item.catalogCode);
    const grade = Number(String(item.gradeCode).replace(/^grade-/, ''));
    const catalogValid = matchesCatalogSnapshot(entry, {
      catalogVersion: item.catalogVersion,
      trackCode: item.trackCode,
      subjectType: item.subjectType,
      subjectName: item.subjectName,
      instructionalHours: item.instructionalHours,
      gradeCode: grade
    });
    return {
      ...item,
      catalogValid,
      catalogGradeEligible: isCatalogGradeEligible(entry, grade),
      catalogAvailableForNewUse: isCatalogAvailableForNewUse(entry),
      catalogGroup: entry?.catalogGroup || null,
      clusterCode: entry?.clusterCode || null,
      clusterName: entry?.clusterName || null,
      trackLabel: entry?.trackLabel || null,
      hoursUnit: entry?.hoursUnit || null,
      hoursUnitByGrade: entry?.hoursUnitByGrade || null,
      assessmentGroup: entry?.assessmentGroup || null,
      meetings: meetings.filter(m => Number(m.classId) === Number(item.id))
    };
  });
}

async function homeMeetings(db, schoolId, sectionId, studentId, yearId, excludeClassIds = []) {
  const excludedClasses = excludeClassIds.length
    ? `AND c.id NOT IN (${excludeClassIds.map(() => '?').join(',')})` : '';
  return execute(db,
    `SELECT m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
      TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
      DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, sub.name AS subjectName
     FROM timetable_meetings m JOIN scheduled_classes sc ON sc.id = m.scheduled_class_id AND sc.school_id = m.school_id
     LEFT JOIN section_teachers a ON a.id = sc.assignment_id AND a.school_id = sc.school_id
     LEFT JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id
     LEFT JOIN shs_elective_classes c ON c.id = sc.shs_elective_class_id AND c.school_id = sc.school_id
     LEFT JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     WHERE m.school_id = ? AND (a.section_id = ? OR (o.academic_year_id = ? ${excludedClasses} AND EXISTS
       (SELECT 1 FROM shs_elective_class_students e WHERE e.school_id = m.school_id
         AND e.elective_class_id = c.id AND e.student_user_id = ? AND e.withdrawn_at IS NULL)))`,
    [schoolId, sectionId, yearId, ...excludeClassIds, studentId]);
}

async function validateChoices(db, schoolId, studentId, place, values, options = {}) {
  let selectedIds;
  try { selectedIds = normalizeClassIds(values); }
  catch (error) { fail(error.message); }
  const lockIds = [...new Set([...selectedIds, ...(options.lockClassIds || [])].map(Number))].sort((a, b) => a - b);
  const classes = await classRows(db, schoolId, place.yearId, place.gradeId, options.lock ? lockIds : [],
    options.countExcludeStudentId || null);
  const existing = await homeMeetings(db, schoolId, place.sectionId, studentId, place.yearId,
    options.excludeClassIds || []);
  const validation = validateRecordedChoices(selectedIds, classes, existing);
  if (validation.error) fail(validation.error, 409);
  const allowedLegacyIds = new Set((options.allowLegacyClassIds || []).map(Number));
  const wrongTrackImmersion = validation.selected.find(item => item.assessmentGroup === 'work_immersion'
    && item.trackCode !== place.trackCode);
  if (wrongTrackImmersion) {
    const intendedTrack = wrongTrackImmersion.trackCode === 'academic' ? 'Academic' : 'TechPro';
    fail(`${wrongTrackImmersion.subjectName} is intended for the ${intendedTrack} track.`, 409);
  }
  if (validation.selected.some(item => !item.catalogAvailableForNewUse))
    fail('A selected subject is waiting for DepEd source verification and cannot be added to new choices yet.', 409);
  if (validation.selected.some(item => !item.catalogValid && !allowedLegacyIds.has(Number(item.id))))
    fail('A selected subject no longer matches the approved catalog. Ask school staff to review it.', 409);
  if (validation.selected.some(item => !item.catalogGradeEligible && !allowedLegacyIds.has(Number(item.id))))
    fail('A selected subject is no longer listed for this grade. Ask school staff to review the existing setup.', 409);
  if (place.gradeCode === 'grade-12' && place.trackCode === 'techpro') {
    const selectedImmersions = validation.selected.filter(item => item.assessmentGroup === 'work_immersion'
      && item.trackCode === 'techpro' && item.catalogValid && item.catalogGradeEligible);
    if (selectedImmersions.length !== 1) {
      const hasEligibleOffering = classes.some(item => item.assessmentGroup === 'work_immersion'
        && item.trackCode === 'techpro' && item.catalogValid && item.catalogGradeEligible
        && item.catalogAvailableForNewUse);
      if (!hasEligibleOffering) {
        fail('Grade 12 TechPro requires one Work Immersion class, but no eligible class is offered. Ask school staff to add one before saving choices.', 409);
      }
      fail('Grade 12 TechPro choices must include exactly one eligible TechPro Work Immersion class.', 409);
    }
  }
  return validation.selected;
}

async function choiceData(db, schoolId, studentId, yearId = null) {
  const place = await placement(db, schoolId, studentId, yearId);
  const [request, choiceRows] = await Promise.all([
    requestFor(db, schoolId, place.yearId, place.gradeId, studentId),
    execute(db, `SELECT rc.elective_class_id AS classId FROM shs_selection_request_classes rc
      JOIN shs_selection_requests r ON r.id = rc.request_id AND r.school_id = rc.school_id
      WHERE r.school_id = ? AND r.academic_year_id = ? AND r.grade_level_id = ? AND r.student_user_id = ?`,
    [schoolId, place.yearId, place.gradeId, studentId])
  ]);
  const classIds = choiceRows.map(row => Number(row.classId));
  const confirmed = request?.status === 'approved';
  const [classes, existing] = await Promise.all([
    classRows(db, schoolId, place.yearId, place.gradeId, [], confirmed ? studentId : null),
    homeMeetings(db, schoolId, place.sectionId, studentId, place.yearId, confirmed ? classIds : [])
  ]);
  const chosenClasses = classes.filter(item => classIds.includes(Number(item.id)));
  const shownClasses = classes.map(item => {
    const otherChoices = chosenClasses.filter(choice => Number(choice.id) !== Number(item.id));
    let unavailableReason = !item.catalogValid ? 'Subject setup needs staff review'
      : item.assessmentGroup === 'work_immersion' && item.trackCode !== place.trackCode
        ? `For ${item.trackCode === 'academic' ? 'Academic' : 'TechPro'} track students only`
      : !item.catalogAvailableForNewUse ? 'Waiting for DepEd source verification; not available for new choices'
      : !item.catalogGradeEligible ? 'Not listed for this grade; ask school staff to review the existing setup'
        : !item.classActive || !item.offeringActive ? 'Class or subject is paused'
      : item.teacherStatus !== 'active' || (item.teacherRole && item.teacherRole !== 'teacher') ? 'Assigned teacher is inactive'
        : Number(item.enrolledCount) >= Number(item.capacity) ? 'No seats available'
          : meetingsConflict(item.meetings || [], existing) ? 'Overlaps another class on the learner’s schedule'
            : otherChoices.some(choice => choice.catalogCode === item.catalogCode) ? 'This subject is already selected'
              : meetingsConflict(item.meetings || [], otherChoices.flatMap(choice => choice.meetings || []))
                ? 'Overlaps another selected class' : null;
    return { ...item, unavailableReason };
  });
  const shownById = new Map(shownClasses.map(item => [Number(item.id), item]));
  const savedClasses = classIds.map(classId => shownById.get(Number(classId))).filter(Boolean);
  const hasEmptySubmittedRequest = request && !classIds.length
    && ['pending', 'rejected', 'not_recorded', ''].includes(request.status);
  const dataIssue = Boolean(request && ((request.status === 'approved' && !classIds.length)
    || savedClasses.length !== classIds.length));
  return {
    placement: place,
    selection: request && { id: Number(request.id), status: hasEmptySubmittedRequest ? 'not_recorded' : request.status,
      decisionReason: request.decision_reason, revision: Number(request.revision), classIds, savedClasses, dataIssue },
    classes: shownClasses
  };
}

async function studentView(req, res, next) {
  try { res.json(await choiceData(getDatabase(), req.user.schoolId, req.user.id)); }
  catch (error) { next(error); }
}

async function saveChoices(connection, req, studentId, yearId, classIds, actorType) {
  const schoolId = req.user.schoolId;
  const initial = await placement(connection, schoolId, studentId, yearId);
  if (initial.yearStatus !== 'active') fail('Choices can only be changed during an active school year.', 409);
  await connection.beginTransaction();
  let started = true;
  try {
    const years = await execute(connection,
      'SELECT status FROM academic_years WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, initial.yearId]);
    if (years[0]?.status !== 'active') fail('Archived school years are read-only.', 409);
    const place = await placement(connection, schoolId, studentId, initial.yearId);
    if (Number(place.gradeId) !== Number(initial.gradeId) || Number(place.sectionId) !== Number(initial.sectionId)) {
      fail('The learner’s section or grade changed. Reload and try again.', 409);
    }
    const request = await requestFor(connection, schoolId, place.yearId, place.gradeId, studentId, true);
    if (request?.status === 'approved') fail('Confirmed choices must be changed by school staff.', 409);
    const previousRows = request ? await execute(connection,
      'SELECT elective_class_id AS classId FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?',
      [schoolId, request.id]) : [];
    const previousIds = previousRows.map(row => Number(row.classId));
    const submittedIds = classIds.map(Number);
    const selected = await validateChoices(connection, schoolId, studentId, place, classIds, {
      lock: true, allowLegacyClassIds: previousIds
    });
    if (actorType === 'student' && request?.status === 'pending' && sameClassIds(previousIds, submittedIds)) {
      await connection.commit(); started = false;
      return { id: Number(request.id), status: 'pending', revision: Number(request.revision), unchanged: true };
    }
    let requestId, revision;
    const wasSaved = Boolean(request && request.status !== 'not_recorded' && previousIds.length);
    if (request) {
      requestId = Number(request.id);
      revision = Number(request.revision) + 1;
      await execute(connection, `UPDATE shs_selection_requests SET status = 'pending', revision = ?,
        decision_reason = NULL, reviewed_by_user_id = NULL, reviewed_at = NULL
        WHERE school_id = ? AND id = ?`, [revision, schoolId, requestId]);
      await execute(connection, 'DELETE FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?', [schoolId, requestId]);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO shs_selection_requests (school_id, academic_year_id, grade_level_id, student_user_id, pathway_code)
         VALUES (?, ?, ?, ?, ?)`, [schoolId, place.yearId, place.gradeId, studentId, place.trackCode]);
      requestId = Number(result.insertId);
      revision = 1;
    }
    for (const item of selected) await execute(connection,
      'INSERT INTO shs_selection_request_classes (school_id, request_id, elective_class_id) VALUES (?, ?, ?)',
      [schoolId, requestId, Number(item.id)]);
    const action = actorType === 'student' ? (wasSaved ? 'revised' : 'submitted') : (wasSaved ? 'admin_updated' : 'admin_recorded');
    await execute(connection, `INSERT INTO shs_selection_history
      (school_id, request_id, actor_user_id, action, revision, details) VALUES (?, ?, ?, ?, ?, ?)`,
    [schoolId, requestId, req.user.id, action, revision,
      JSON.stringify({ classIds: selected.map(item => Number(item.id)) })]);
    const actionType = actorType === 'student'
      ? (wasSaved ? 'shs_selection_revised' : 'shs_selection_submitted')
      : (wasSaved ? 'shs_selection_admin_updated' : 'shs_selection_admin_recorded');
    await writeAuditLog(connection, req, actionType, 'shs_selection_request', requestId,
      choiceAuditDetails(place, selected.length));
    await connection.commit(); started = false;
    return { id: requestId, status: 'pending', revision };
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  }
}

async function submit(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    let classIds;
    try { classIds = normalizeClassIds(req.body?.classIds); } catch (error) { fail(error.message); }
    const result = await saveChoices(connection, req, req.user.id, null, classIds, 'student');
    res.json(result);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

async function adminList(req, res, next) {
  try {
    const db = getDatabase(), schoolId = req.user.schoolId;
    const yearId = id(req.query.academicYearId, 'school year ID');
    const years = await execute(db, 'SELECT id, label, status FROM academic_years WHERE school_id = ? AND id = ?', [schoolId, yearId]);
    if (!years.length) fail('School year not found.', 404);
    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = 25;
    const search = String(req.query.search || '').trim().slice(0, 100);
    const grade = String(req.query.grade || '');
    const status = String(req.query.status || '');
    const savedLinkQuery = `SELECT 1 FROM shs_selection_request_classes rc
      WHERE rc.school_id = r.school_id AND rc.request_id = r.id`;
    const hasSavedLinks = `EXISTS (${savedLinkQuery})`;
    const noSavedLinks = `NOT EXISTS (${savedLinkQuery})`;
    const where = [
      'ss.school_id = ?', 's.academic_year_id = ?', 'ss.withdrawn_at IS NULL',
      "u.role = 'student'", "u.account_status = 'active'", "g.grade_code IN ('grade-11', 'grade-12')",
      "l.level_code = 'shs'", "s.shs_curriculum_code = 'strengthened_2026'"
    ];
    const args = [schoolId, yearId];
    if (grade) {
      if (!['grade-11', 'grade-12'].includes(grade)) fail('Choose Grade 11 or Grade 12.');
      where.push('g.grade_code = ?'); args.push(grade);
    }
    if (status === 'not_recorded') where.push(`(r.id IS NULL OR r.status = 'not_recorded'
      OR ((r.status IN ('pending', 'rejected') OR r.status = '') AND ${noSavedLinks}))`);
    else if (status === 'pending' || status === 'rejected') {
      where.push(`r.status = ? AND ${hasSavedLinks}`); args.push(status);
    } else if (status === 'approved') { where.push('r.status = ?'); args.push(status); }
    else if (status && status !== 'all') fail('Choose a valid choice status.');
    if (search) { where.push('u.display_name LIKE ?'); args.push(`%${search}%`); }
    const joins = `FROM section_students ss
      JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
      JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
      JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
      JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
      JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
      JOIN users u ON u.id = ss.student_user_id AND u.school_id = ss.school_id
      LEFT JOIN shs_selection_requests r ON r.school_id = ss.school_id AND r.academic_year_id = s.academic_year_id
        AND r.grade_level_id = s.grade_level_id AND r.student_user_id = ss.student_user_id`;
    const predicate = where.join(' AND ');
    const counts = await execute(db, `SELECT COUNT(DISTINCT u.id) AS total ${joins} WHERE ${predicate}`, args);
    const total = Number(counts[0]?.total || 0);
    const students = await execute(db,
      `SELECT u.id AS studentId, u.display_name AS studentName, s.id AS sectionId, s.name AS sectionName,
        g.id AS gradeId, g.grade_code AS gradeCode, t.track_code AS trackCode,
        r.id AS requestId,
        CASE WHEN (r.status IN ('pending', 'rejected') OR r.status = '') AND ${noSavedLinks}
          THEN 'not_recorded' ELSE r.status END AS requestStatus,
        CASE WHEN r.status = 'approved' AND ${noSavedLinks} THEN 1 ELSE 0 END AS dataIssue,
        r.revision,
        r.decision_reason AS note, DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i') AS updatedAt
       ${joins} WHERE ${predicate}
       GROUP BY u.id, u.display_name, s.id, s.name, g.id, g.grade_code, t.track_code,
         r.id, r.status, r.revision, r.decision_reason, r.updated_at
       ORDER BY g.grade_code, u.display_name, s.name LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize]);
    res.json({ year: years[0], students: students.map(item => ({ ...item,
      studentId: Number(item.studentId), requestId: item.requestId == null ? null : Number(item.requestId),
      status: item.requestStatus || 'not_recorded', dataIssue: Boolean(Number(item.dataIssue || 0)),
      revision: Number(item.revision || 0) })),
      page, pageSize, total, pages: Math.ceil(total / pageSize) });
  } catch (error) { next(error); }
}

async function staffStudentChoices(req, res, next) {
  try {
    const studentId = id(req.params.studentId, 'student ID');
    const yearId = id(req.query.academicYearId, 'school year ID');
    const year = await execute(getDatabase(), 'SELECT id, label, status FROM academic_years WHERE school_id = ? AND id = ?',
      [req.user.schoolId, yearId]);
    if (!year.length) fail('School year not found.', 404);
    const result = await choiceData(getDatabase(), req.user.schoolId, studentId, yearId);
    res.json({ ...result, year: year[0], canEdit: year[0].status === 'active' });
  } catch (error) { next(error); }
}

async function recordStudentChoices(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    const studentId = id(req.params.studentId, 'student ID');
    const yearId = id(req.query.academicYearId, 'school year ID');
    let classIds;
    try { classIds = normalizeClassIds(req.body?.classIds); } catch (error) { fail(error.message); }
    const result = await saveChoices(connection, req, studentId, yearId, classIds, 'staff');
    res.json(result);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

async function syncMemberships(connection, req, request, oldIds, selected) {
  const newIds = selected.map(item => Number(item.id));
  const removed = oldIds.filter(classId => !newIds.includes(Number(classId)));
  if (removed.length) await execute(connection,
    `UPDATE shs_elective_class_students SET withdrawn_at = NOW()
     WHERE school_id = ? AND student_user_id = ? AND withdrawn_at IS NULL
       AND elective_class_id IN (${removed.map(() => '?').join(',')})`,
    [req.user.schoolId, request.student_user_id, ...removed]);
  for (const classId of newIds) await execute(connection,
    `INSERT INTO shs_elective_class_students (school_id, elective_class_id, student_user_id)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE withdrawn_at = NULL`,
    [req.user.schoolId, classId, request.student_user_id]);
}

async function decide(req, res, next) {
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    const schoolId = req.user.schoolId, requestId = id(req.params.requestId, 'request ID');
    const decision = String(req.body?.decision || ''), reason = String(req.body?.reason || '').trim();
    if (!['approved', 'rejected'].includes(decision)) fail('Choose Confirm or Return for correction.');
    if (decision === 'rejected' && (!reason || reason.length > 500)) fail('Add a note of up to 500 characters for the learner.');
    const lookup = await execute(connection,
      'SELECT academic_year_id AS yearId FROM shs_selection_requests WHERE school_id = ? AND id = ?', [schoolId, requestId]);
    if (!lookup.length) fail('Choice record not found.', 404);
    await connection.beginTransaction(); started = true;
    const years = await execute(connection,
      'SELECT status FROM academic_years WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, lookup[0].yearId]);
    if (years[0]?.status !== 'active') fail('Archived school years are read-only.', 409);
    const request = (await execute(connection,
      'SELECT * FROM shs_selection_requests WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, requestId]))[0];
    if (!request || request.status !== 'pending') fail('Only choices waiting for review can be changed.', 409);
    const place = await placement(connection, schoolId, request.student_user_id, request.academic_year_id);
    if (Number(place.gradeId) !== Number(request.grade_level_id)) fail('The learner’s grade or section has changed.', 409);
    const rows = await execute(connection,
      'SELECT elective_class_id AS classId FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?',
      [schoolId, requestId]);
    const classIds = rows.map(row => Number(row.classId));
    if (!classIds.length) fail('This request has no saved classes and cannot be reviewed.', 409);
    if (decision === 'approved') {
      const selected = await validateChoices(connection, schoolId, request.student_user_id, place, classIds,
        { lock: true, countExcludeStudentId: request.student_user_id, excludeClassIds: classIds });
      await syncMemberships(connection, req, request, [], selected);
    }
    await execute(connection,
      `UPDATE shs_selection_requests SET status = ?, decision_reason = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
       WHERE school_id = ? AND id = ?`, [decision, decision === 'rejected' ? reason : null, req.user.id, schoolId, requestId]);
    await execute(connection,
      `INSERT INTO shs_selection_history (school_id, request_id, actor_user_id, action, revision, details)
       VALUES (?, ?, ?, ?, ?, ?)`, [schoolId, requestId, req.user.id, decision, request.revision,
        JSON.stringify({ note: decision === 'rejected' ? reason : null, classIds })]);
    await writeAuditLog(connection, req, decision === 'approved' ? 'shs_selection_recorded' : 'shs_selection_returned',
      'shs_selection_request', requestId,
      choiceAuditDetails(place, classIds.length, decision === 'rejected' ? { note: reason } : {}));
    await connection.commit(); started = false;
    res.json({ id: requestId, status: decision });
  } catch (error) {
    if (started) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

async function changeApproved(req, res, next) {
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    const schoolId = req.user.schoolId, requestId = id(req.params.requestId, 'request ID');
    let classIds;
    try { classIds = normalizeClassIds(req.body?.classIds); } catch (error) { fail(error.message); }
    const lookup = await execute(connection,
      'SELECT academic_year_id AS yearId FROM shs_selection_requests WHERE school_id = ? AND id = ?', [schoolId, requestId]);
    if (!lookup.length) fail('Choice record not found.', 404);
    await connection.beginTransaction(); started = true;
    const years = await execute(connection,
      'SELECT status FROM academic_years WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, lookup[0].yearId]);
    if (years[0]?.status !== 'active') fail('Archived school years are read-only.', 409);
    const request = (await execute(connection,
      'SELECT * FROM shs_selection_requests WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, requestId]))[0];
    if (!request || request.status !== 'approved') fail('Only confirmed choices can be corrected here.', 409);
    const place = await placement(connection, schoolId, request.student_user_id, request.academic_year_id);
    if (Number(place.gradeId) !== Number(request.grade_level_id)) fail('The learner’s grade or section has changed.', 409);
    const oldRows = await execute(connection,
      'SELECT elective_class_id AS classId FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?',
      [schoolId, requestId]);
    const oldIds = oldRows.map(row => Number(row.classId));
    if (!oldIds.length) fail('Confirmed choices have no saved classes; review this record before editing.', 409);
    const selected = await validateChoices(connection, schoolId, request.student_user_id, place, classIds,
      { lock: true, lockClassIds: oldIds, allowLegacyClassIds: oldIds,
        countExcludeStudentId: request.student_user_id, excludeClassIds: oldIds });
    await syncMemberships(connection, req, request, oldIds, selected);
    await execute(connection, 'DELETE FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?', [schoolId, requestId]);
    for (const item of selected) await execute(connection,
      'INSERT INTO shs_selection_request_classes (school_id, request_id, elective_class_id) VALUES (?, ?, ?)',
      [schoolId, requestId, Number(item.id)]);
    const revision = Number(request.revision) + 1;
    await execute(connection,
      `UPDATE shs_selection_requests SET revision = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
       WHERE school_id = ? AND id = ?`, [revision, req.user.id, schoolId, requestId]);
    await execute(connection,
      `INSERT INTO shs_selection_history (school_id, request_id, actor_user_id, action, revision, details)
       VALUES (?, ?, ?, 'admin_changed', ?, ?)`, [schoolId, requestId, req.user.id, revision,
        JSON.stringify({ oldClassIds: oldIds, classIds: selected.map(item => Number(item.id)) })]);
    await writeAuditLog(connection, req, 'shs_selection_recorded_choices_changed', 'shs_selection_request', requestId,
      choiceAuditDetails(place, selected.length));
    await connection.commit(); started = false;
    res.json({ id: requestId, status: 'approved', revision });
  } catch (error) {
    if (started) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error.status = 409;
    next(error);
  } finally { connection.release(); }
}

async function clearApproved(req, res, next) {
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    const schoolId = req.user.schoolId, requestId = id(req.params.requestId, 'request ID');
    const lookup = await execute(connection,
      'SELECT academic_year_id AS yearId FROM shs_selection_requests WHERE school_id = ? AND id = ?', [schoolId, requestId]);
    if (!lookup.length) fail('Choice record not found.', 404);
    const statusColumn = await execute(connection,
      `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shs_selection_requests' AND COLUMN_NAME = 'status'`);
    if (!String(statusColumn[0]?.columnType || '').includes("'not_recorded'")) {
      fail('Choices cannot be cleared yet. Contact the system administrator to finish the school setup.', 409);
    }
    await connection.beginTransaction(); started = true;
    const years = await execute(connection,
      'SELECT status FROM academic_years WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, lookup[0].yearId]);
    if (years[0]?.status !== 'active') fail('Archived school years are read-only.', 409);
    const request = (await execute(connection,
      'SELECT * FROM shs_selection_requests WHERE school_id = ? AND id = ? FOR UPDATE', [schoolId, requestId]))[0];
    if (!request || request.status !== 'approved') fail('Only confirmed choices can be cleared.', 409);
    const place = await placement(connection, schoolId, request.student_user_id, request.academic_year_id);
    if (Number(place.gradeId) !== Number(request.grade_level_id)) fail('The learner’s grade or section has changed.', 409);
    const rows = await execute(connection,
      'SELECT elective_class_id AS classId FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?',
      [schoolId, requestId]);
    const oldIds = rows.map(row => Number(row.classId));
    if (!oldIds.length) fail('Confirmed choices have no saved classes; review this record before clearing.', 409);
    await syncMemberships(connection, req, request, oldIds, []);
    await execute(connection, 'DELETE FROM shs_selection_request_classes WHERE school_id = ? AND request_id = ?', [schoolId, requestId]);
    const revision = Number(request.revision) + 1;
    await execute(connection,
      `UPDATE shs_selection_requests SET status = 'not_recorded', revision = ?, decision_reason = NULL,
        reviewed_by_user_id = NULL, reviewed_at = NULL WHERE school_id = ? AND id = ?`,
      [revision, schoolId, requestId]);
    await execute(connection,
      `INSERT INTO shs_selection_history (school_id, request_id, actor_user_id, action, revision, details)
       VALUES (?, ?, ?, 'cleared', ?, ?)`,
      [schoolId, requestId, req.user.id, revision, JSON.stringify({ oldClassIds: oldIds, classIds: [] })]);
    await writeAuditLog(connection, req, 'shs_selection_choices_cleared', 'shs_selection_request', requestId,
      choiceAuditDetails(place, oldIds.length));
    await connection.commit(); started = false;
    res.json({ id: requestId, status: 'not_recorded', revision, classIds: [] });
  } catch (error) {
    if (started) await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

module.exports = {
  enabled, studentView, submit, adminList, staffStudentChoices, recordStudentChoices,
  decide, changeApproved, clearApproved
};
