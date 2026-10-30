// Safe API checks for the named Capstone SHS test school. No records are reset or deleted.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const qaPassword = process.env.QA_PASSWORD;
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const bcrypt = require('bcrypt');
const { getDatabase } = require('../config/database');

const SCHOOL_CODE = 'CAPSTONE-SHS-TEST';
const SCHOOL_DOMAIN = 'capstone-shs-test.academix.invalid';
const QA_STUDENT_EMAIL = `phase3-qa@${SCHOOL_DOMAIN}`;
const apiBase = process.env.QA_API_BASE || 'http://127.0.0.1:3001/api';
const apiUrl = new URL(apiBase);
const frontendOrigin = process.env.QA_FRONTEND_ORIGIN || 'http://127.0.0.1:3000';
const db = getDatabase();

if (apiUrl.protocol !== 'http:' || apiUrl.hostname !== '127.0.0.1' || !apiUrl.port || apiUrl.port === '3000') {
  throw new Error('QA_API_BASE must use http://127.0.0.1 on a port other than 3000.');
}

const shsCountQueries = [
  ['strengthenedSections', "SELECT COUNT(*) AS count FROM sections WHERE school_id <> ? AND shs_curriculum_code = 'strengthened_2026'"],
  ['offerings', 'SELECT COUNT(*) AS count FROM shs_offerings WHERE school_id <> ?'],
  ['electiveClasses', 'SELECT COUNT(*) AS count FROM shs_elective_classes WHERE school_id <> ?'],
  ['choiceRequests', 'SELECT COUNT(*) AS count FROM shs_selection_requests WHERE school_id <> ?'],
  ['memberships', 'SELECT COUNT(*) AS count FROM shs_elective_class_students WHERE school_id <> ?'],
  ['electiveAssessments', 'SELECT COUNT(*) AS count FROM grading_items WHERE school_id <> ? AND shs_elective_class_id IS NOT NULL'],
  ['electiveGrades', 'SELECT COUNT(*) AS count FROM published_final_grades WHERE school_id <> ? AND shs_elective_class_id IS NOT NULL'],
  ['electiveGradeHistory', 'SELECT COUNT(*) AS count FROM shs_grade_publication_history WHERE school_id <> ?'],
  ['electiveAssignments', 'SELECT COUNT(*) AS count FROM assignments WHERE school_id <> ? AND shs_elective_class_id IS NOT NULL'],
  ['electiveAttendance', 'SELECT COUNT(*) AS count FROM attendance_sessions WHERE school_id <> ? AND shs_elective_class_id IS NOT NULL'],
  ['electiveMaterials', 'SELECT COUNT(*) AS count FROM learning_materials WHERE school_id <> ? AND shs_elective_class_id IS NOT NULL']
];

async function request(route, options = {}, cookie = '') {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Origin: frontendOrigin,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

async function call(route, options = {}, cookie = '') {
  const result = await request(route, options, cookie);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${options.method || 'GET'} ${route}: ${result.status} ${result.body.message || JSON.stringify(result.body)}`);
  }
  return result;
}

async function expectStatus(route, status, cookie) {
  const result = await request(route, {}, cookie);
  assert.equal(result.status, status, `${route} should return ${status}, got ${result.status}.`);
  return result;
}

async function login(localName, role, schoolId) {
  if (!qaPassword) throw new Error('Set QA_PASSWORD temporarily in the shell; it is never read from .env.');
  const result = await call('/auth/login', {
    method: 'POST', body: JSON.stringify({ schoolEmail: `${localName}@${SCHOOL_DOMAIN}`, password: qaPassword })
  });
  const user = result.body.user;
  assert.ok(user?.id, `The ${localName} test account did not return a user.`);
  assert.equal(Number(user.schoolId), Number(schoolId), `${localName} must belong to ${SCHOOL_CODE}.`);
  assert.equal(user.role, role, `${localName} has the wrong role.`);
  assert.ok(user.schoolEmail.endsWith(`@${SCHOOL_DOMAIN}`), `${localName} must use the test-school email domain.`);
  return { cookie: result.cookie, user };
}

async function countOutsideSchool(schoolId) {
  const result = {};
  for (const [key, sql] of shsCountQueries) {
    const [rows] = await db.execute(sql, [schoolId]);
    result[key] = Number(rows[0].count);
  }
  return result;
}

async function stateForSchool(schoolId) {
  const tables = {
    strengthenedSections: "SELECT COUNT(*) AS count FROM sections WHERE school_id = ? AND shs_curriculum_code = 'strengthened_2026'",
    offerings: 'SELECT COUNT(*) AS count FROM shs_offerings WHERE school_id = ?',
    classes: 'SELECT COUNT(*) AS count FROM shs_elective_classes WHERE school_id = ?',
    choices: 'SELECT COUNT(*) AS count FROM shs_selection_requests WHERE school_id = ?',
    memberships: 'SELECT COUNT(*) AS count FROM shs_elective_class_students WHERE school_id = ?',
    publishedGrades: 'SELECT COUNT(*) AS count FROM published_final_grades WHERE school_id = ? AND shs_elective_class_id IS NOT NULL',
    publicationHistory: 'SELECT COUNT(*) AS count FROM shs_grade_publication_history WHERE school_id = ?'
  };
  const state = {};
  for (const [key, sql] of Object.entries(tables)) {
    const [rows] = await db.execute(sql, [schoolId]);
    state[key] = Number(rows[0].count);
  }
  return state;
}

async function schoolScope() {
  const [schools] = await db.execute(
    `SELECT id, school_code AS schoolCode, school_email_domain AS emailDomain, registration_status AS status
     FROM schools WHERE school_code = ?`, [SCHOOL_CODE]);
  assert.equal(schools.length, 1, `Expected exactly one ${SCHOOL_CODE} school.`);
  const school = schools[0];
  assert.equal(school.emailDomain, SCHOOL_DOMAIN);
  assert.equal(school.status, 'active');
  const outside = await countOutsideSchool(school.id);
  assert.ok(Object.values(outside).every(count => count === 0),
    `The temporary gate could expose SHS records from another school: ${JSON.stringify(outside)}`);
  const [years] = await db.execute(
    `SELECT id, label, status FROM academic_years WHERE school_id = ? AND status = 'active'`, [school.id]);
  assert.equal(years.length, 1, 'The test school must have one active school year.');
  return { school, year: years[0], outside, capstone: await stateForSchool(school.id) };
}

function backupPathFromArgs(args) {
  const index = args.indexOf('--backup');
  if (index < 0 || !args[index + 1]) throw new Error('Pass --backup <verified snapshot path> before running API checks.');
  const backupPath = path.resolve(args[index + 1]);
  const backupRoot = path.resolve(__dirname, '../database/backups');
  const relative = path.relative(backupRoot, backupPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The backup must be inside backend/database/backups.');
  }
  const snapshot = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (!snapshot.createdAt || !snapshot.tables?.schools?.rows?.some(row => row.school_code === SCHOOL_CODE)) {
    throw new Error('The backup is not a readable snapshot containing the named Capstone test school.');
  }
  const age = Date.now() - Date.parse(snapshot.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > 7 * 24 * 60 * 60 * 1000) {
    throw new Error('Create a fresh, verified backup before these tests (maximum age: seven days).');
  }
  return { backupPath, snapshot };
}

async function verifyGateOff(scope) {
  const admin = await login('admin', 'school_admin', scope.school.id);
  const teacher = await login('teacher', 'teacher', scope.school.id);
  const student = await login('academic', 'student', scope.school.id);
  await expectStatus('/shs-selection/mine', 404, student.cookie);
  await expectStatus(`/shs-selection/students?academicYearId=${scope.year.id}`, 404, admin.cookie);
  await expectStatus('/shs-teaching/classes', 404, teacher.cookie);
  await expectStatus('/shs-grades/workspace', 404, teacher.cookie);
  console.log(JSON.stringify({ mode: 'gate-off', schoolCode: SCHOOL_CODE,
    studentChoicesBlocked: true, staffChoicesBlocked: true, teachingBlocked: true, gradingBlocked: true,
    otherSchoolShsCounts: scope.outside }, null, 2));
}

async function verifyGateOn(scope) {
  const admin = await login('admin', 'school_admin', scope.school.id);
  const teacher = await login('teacher', 'teacher', scope.school.id);
  const academic = await login('academic', 'student', scope.school.id);
  const techpro = await login('techpro', 'student', scope.school.id);
  const parent = await login('parent', 'parent', scope.school.id);
  const unrelatedParent = await login('unrelatedparent', 'parent', scope.school.id);

  const program = (await call(`/shs-program?academicYearId=${scope.year.id}`, {}, admin.cookie)).body;
  assert.ok(Array.isArray(program.classes));
  assert.equal(Object.hasOwn(program, 'readiness'), false);
  const studentChoices = (await call('/shs-selection/mine', {}, academic.cookie)).body;
  assert.ok(['grade-11', 'grade-12'].includes(studentChoices.placement?.gradeCode));
  assert.equal(studentChoices.placement?.yearStatus, 'active');
  assert.equal(Object.hasOwn(studentChoices, 'window'), false);
  assert.ok(Array.isArray(studentChoices.classes));

  const staffList = (await call(`/shs-selection/students?academicYearId=${scope.year.id}&page=1`, {}, admin.cookie)).body;
  assert.equal(staffList.pageSize, 25);
  assert.ok(Array.isArray(staffList.students));
  assert.ok(staffList.students.every(item => item.status
    && ['not_recorded', 'pending', 'approved', 'rejected'].includes(item.status)));

  const teacherClasses = (await call('/shs-teaching/classes', {}, teacher.cookie)).body.classes;
  const academicClasses = (await call('/shs-teaching/classes', {}, academic.cookie)).body.classes;
  const techproClasses = (await call('/shs-teaching/classes', {}, techpro.cookie)).body.classes;
  assert.ok(Array.isArray(teacherClasses) && Array.isArray(academicClasses) && Array.isArray(techproClasses));
  const academicIds = new Set(academicClasses.map(item => Number(item.electiveClassId)));
  const techproIds = new Set(techproClasses.map(item => Number(item.electiveClassId)));
  assert.ok([...academicIds].every(id => !techproIds.has(id)), 'Learners on different test tracks must not share memberships.');

  const targetStudentId = academic.user.id;
  const ownGrades = (await call('/final-grades', {}, academic.cookie)).body.finalGrades || [];
  const parentGrades = (await call(`/final-grades?studentId=${targetStudentId}`, {}, parent.cookie)).body.finalGrades || [];
  const teacherGrades = (await call('/final-grades', {}, teacher.cookie)).body.finalGrades || [];
  assert.ok(ownGrades.every(grade => Number(grade.studentId) === Number(targetStudentId)));
  assert.ok(parentGrades.every(grade => Number(grade.studentId) === Number(targetStudentId)));
  assert.ok(teacherGrades.every(grade => grade.schoolId && (grade.sectionId || grade.electiveClassId)));
  await expectDenied(() => call(`/final-grades?studentId=${targetStudentId}`, {}, unrelatedParent.cookie), [403]);

  const academicSchedule = (await call(`/timetables?academicYearId=${scope.year.id}`, {}, academic.cookie)).body;
  const teacherSchedule = (await call(`/timetables?academicYearId=${scope.year.id}`, {}, teacher.cookie)).body;
  assert.ok(Array.isArray(academicSchedule.meetings));
  assert.ok(Array.isArray(teacherSchedule.meetings));
  const changed = await countOutsideSchool(scope.school.id);
  assert.deepEqual(changed, scope.outside, 'The other school’s SHS records must remain unchanged.');
  console.log(JSON.stringify({ mode: 'gate-on-read-only', schoolCode: SCHOOL_CODE,
    activeYear: scope.year.label, programClasses: program.classes.length,
    eligibleStudentClasses: studentChoices.classes.length, staffRows: staffList.total,
    teacherClasses: teacherClasses.length, academicMemberClasses: academicIds.size,
    techProMemberClasses: techproIds.size, ownGrades: ownGrades.length,
    linkedParentGrades: parentGrades.length, teacherGrades: teacherGrades.length,
    scheduleMeetings: academicSchedule.meetings.length, otherSchoolShsCounts: changed }, null, 2));
}

async function expectDenied(action, statuses) {
  try { await action(); } catch (error) {
    assert.ok(statuses.some(status => error.message.includes(`: ${status} `)), error.message);
    return;
  }
  throw new Error(`Expected an access denial (${statuses.join(', ')}).`);
}

function lrnCandidate() {
  return String(100_000_000_000 + crypto.randomInt(0, 899_999_999_999));
}

async function ensureQaStudent(scope) {
  if (!qaPassword) throw new Error('Set QA_PASSWORD temporarily in the shell; it is never read from .env.');
  const connection = await db.getConnection();
  let transaction = false;
  try {
    await connection.beginTransaction(); transaction = true;
    const [[section]] = await connection.execute(
      `SELECT s.id AS sectionId, g.id AS gradeId FROM sections s
       JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
       JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
       JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
       JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
       WHERE s.school_id = ? AND s.shs_curriculum_code = 'strengthened_2026'
         AND s.status = 'active' AND l.level_code = 'shs' AND g.grade_code = 'grade-12'
         AND t.track_code = 'academic' AND y.id = ? AND y.status = 'active'
       ORDER BY s.id LIMIT 1 FOR UPDATE`, [scope.school.id, scope.year.id]);
    if (!section) throw new Error('No active Grade 12 Academic home section exists in the Capstone test school.');
    const [existingRows] = await connection.execute(
      'SELECT id, role, account_status FROM users WHERE school_id = ? AND school_email = ? FOR UPDATE',
      [scope.school.id, QA_STUDENT_EMAIL]);
    let studentId;
    if (existingRows.length) {
      const existing = existingRows[0];
      if (existing.role !== 'student' || existing.account_status !== 'active') {
        throw new Error('The existing Phase 3 test account is not an active student; it was not changed.');
      }
      studentId = Number(existing.id);
      const [enrollments] = await connection.execute(
        `SELECT ss.section_id FROM section_students ss JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
         WHERE ss.school_id = ? AND ss.student_user_id = ? AND ss.withdrawn_at IS NULL
           AND s.academic_year_id = ? AND s.grade_level_id = ?`,
        [scope.school.id, studentId, scope.year.id, section.gradeId]);
      if (!enrollments.length) throw new Error('The existing Phase 3 test student is not assigned to the active Grade 12; it was not changed.');
    } else {
      const passwordHash = await bcrypt.hash(qaPassword, 12);
      const [created] = await connection.execute(
        `INSERT INTO users (school_id, role, school_email, password_hash, account_status,
          first_name, last_name, display_name, initials, setup_completed_at)
         VALUES (?, 'student', ?, ?, 'active', 'Phase3 QA', 'Learner', 'Phase3 QA Learner', 'PQ', NOW())`,
        [scope.school.id, QA_STUDENT_EMAIL, passwordHash]);
      studentId = Number(created.insertId);
      let lrn = lrnCandidate();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [matches] = await connection.execute('SELECT user_id FROM student_profiles WHERE lrn = ?', [lrn]);
        if (!matches.length) break;
        lrn = lrnCandidate();
      }
      await connection.execute('INSERT INTO student_profiles (user_id, lrn) VALUES (?, ?)', [studentId, lrn]);
      await connection.execute('INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)',
        [scope.school.id, section.sectionId, studentId]);
    }
    await connection.commit(); transaction = false;
    return { studentId, sectionId: Number(section.sectionId), created: !existingRows.length };
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function hasMembership(schoolId, classId, studentId) {
  const [rows] = await db.execute(
    `SELECT withdrawn_at AS withdrawnAt FROM shs_elective_class_students
     WHERE school_id = ? AND elective_class_id = ? AND student_user_id = ?`, [schoolId, classId, studentId]);
  return Boolean(rows[0] && rows[0].withdrawnAt == null);
}

async function exerciseChoiceFlow(scope) {
  const admin = await login('admin', 'school_admin', scope.school.id);
  const studentResult = await ensureQaStudent(scope);
  const student = await login('phase3-qa', 'student', scope.school.id);
  assert.equal(Number(student.user.id), studentResult.studentId);
  const [yearId] = [Number(scope.year.id)];
  let choices = (await call('/shs-selection/mine', {}, student.cookie)).body;
  assert.equal(choices.placement.gradeCode, 'grade-12');
  assert.equal(Number(choices.placement.yearId), yearId);
  const available = choices.classes.filter(item => !item.unavailableReason)
    .sort((a, b) => String(a.catalogCode).localeCompare(String(b.catalogCode)) || Number(a.id) - Number(b.id));
  const primary = available[0];
  const alternate = available.find(item => item.catalogCode !== primary?.catalogCode);
  assert.ok(primary && alternate, 'At least two available classes in different subjects are required for this test.');

  let selection = choices.selection;
  if (!selection || selection.status === 'rejected') {
    const saved = await call('/shs-selection/mine', { method: 'PUT',
      body: JSON.stringify({ classIds: [Number(primary.id)] }) }, student.cookie);
    assert.equal(saved.body.status, 'pending');
    choices = (await call('/shs-selection/mine', {}, student.cookie)).body;
    selection = choices.selection;
  } else if (selection.status === 'pending' && !selection.classIds.includes(Number(primary.id))) {
    const saved = await call('/shs-selection/mine', { method: 'PUT',
      body: JSON.stringify({ classIds: [Number(primary.id)] }) }, student.cookie);
    assert.equal(saved.body.status, 'pending');
    choices = (await call('/shs-selection/mine', {}, student.cookie)).body;
    selection = choices.selection;
  }

  assert.ok(selection, 'The Phase 3 test learner must have a saved choice.');
  let requestId = Number(selection.id);
  let selectedClassId = Number(selection.classIds[0]);
  if (selection.status === 'pending') {
    assert.equal(await hasMembership(scope.school.id, selectedClassId, studentResult.studentId), false,
      'A pending choice must not create elective access.');
    const adminList = (await call(`/shs-selection/students?academicYearId=${yearId}&search=Phase3%20QA`, {}, admin.cookie)).body;
    const learnerRow = adminList.students.find(row => Number(row.studentId) === studentResult.studentId);
    assert.equal(learnerRow?.status, 'pending');
    const detail = (await call(`/shs-selection/students/${studentResult.studentId}/choices?academicYearId=${yearId}`,
      {}, admin.cookie)).body;
    assert.equal(detail.selection.status, 'pending');
    assert.ok(detail.selection.classIds.includes(selectedClassId));
    const pendingMaterials = (await call(`/materials?electiveClassId=${selectedClassId}`, {}, student.cookie)).body.materials;
    const pendingClasses = (await call('/shs-teaching/classes', {}, student.cookie)).body.classes;
    const pendingSchedule = (await call(`/timetables?academicYearId=${yearId}`, {}, student.cookie)).body;
    const pendingGrades = (await call('/final-grades', {}, student.cookie)).body.finalGrades;
    assert.ok(!pendingMaterials.some(item => Number(item.electiveClassId) === selectedClassId));
    assert.ok(!pendingClasses.some(item => Number(item.electiveClassId) === selectedClassId));
    assert.ok(!pendingSchedule.meetings.some(item => Number(item.electiveClassId) === selectedClassId));
    assert.ok(!pendingGrades.some(item => Number(item.electiveClassId) === selectedClassId));
    const decision = await call(`/shs-selection/requests/${requestId}/decision`, { method: 'POST',
      body: JSON.stringify({ decision: 'approved' }) }, admin.cookie);
    assert.equal(decision.body.status, 'approved');
  } else {
    assert.equal(selection.status, 'approved', 'Only a previously recorded test account may resume this flow.');
  }

  assert.equal(await hasMembership(scope.school.id, selectedClassId, studentResult.studentId), true,
    'Confirmed choices should create the matching elective membership.');
  let roster = (await call(`/shs-teaching/classes/${selectedClassId}/roster`, {}, admin.cookie)).body;
  assert.ok(roster.students.some(row => Number(row.studentId) === studentResult.studentId));

  choices = (await call('/shs-selection/mine', {}, student.cookie)).body;
  selection = choices.selection;
  requestId = Number(selection.id);
  const currentClassId = Number(selection.classIds[0]);
  if (currentClassId !== Number(alternate.id)) {
    const corrected = await call(`/shs-selection/requests/${requestId}/classes`, { method: 'PUT',
      body: JSON.stringify({ classIds: [Number(alternate.id)] }) }, admin.cookie);
    assert.equal(corrected.body.status, 'approved');
    assert.equal(await hasMembership(scope.school.id, currentClassId, studentResult.studentId), false,
      'The replaced membership should be marked withdrawn.');
    assert.equal(await hasMembership(scope.school.id, Number(alternate.id), studentResult.studentId), true);
  }
  const studentClasses = (await call('/shs-teaching/classes', {}, student.cookie)).body.classes;
  assert.ok(studentClasses.some(item => Number(item.electiveClassId) === Number(alternate.id)));
  assert.ok(!studentClasses.some(item => Number(item.electiveClassId) === currentClassId && currentClassId !== Number(alternate.id)));
  roster = (await call(`/shs-teaching/classes/${alternate.id}/roster`, {}, admin.cookie)).body;
  assert.ok(roster.students.some(row => Number(row.studentId) === studentResult.studentId));
  const after = await countOutsideSchool(scope.school.id);
  assert.deepEqual(after, scope.outside, 'The test flow must not write SHS records for another school.');
  console.log(JSON.stringify({ mode: 'choice-flow', schoolCode: SCHOOL_CODE,
    qaStudentCreated: studentResult.created, grade: choices.placement.gradeCode,
    year: scope.year.label, firstConfirmedClass: selectedClassId,
    currentClassAfterStaffCorrection: Number(alternate.id),
    membershipCorrectionVerified: true, otherSchoolShsCounts: after }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const { backupPath: backup, snapshot } = backupPathFromArgs(args);
  const scope = await schoolScope();
  assert.equal(snapshot.database, process.env.DB_NAME, 'The backup must belong to the configured development database.');
  const backupSchool = snapshot.tables.schools.rows.find(row => row.school_code === SCHOOL_CODE);
  if (!backupSchool || String(backupSchool.id) !== String(scope.school.id)) {
    throw new Error('The verified backup does not match the current Capstone test school.');
  }
  const backupShsState = {
    requests: snapshot.tables.shs_selection_requests.rows.filter(row => Number(row.school_id) === Number(scope.school.id)).length,
    classes: snapshot.tables.shs_elective_classes.rows.filter(row => Number(row.school_id) === Number(scope.school.id)).length
  };
  assert.ok(backupShsState.requests > 0 && backupShsState.classes > 0, 'Backup must contain the current Capstone SHS test data.');
  const activeMode = args.includes('--verify-gate-off') ? 'gate-off'
    : args.includes('--verify-gate-on') ? 'gate-on'
      : args.includes('--exercise-choice-flow') ? 'choice-flow' : null;
  assert.ok(activeMode, 'Choose --verify-gate-off, --verify-gate-on, or --exercise-choice-flow.');
  if (activeMode === 'gate-off') await verifyGateOff(scope);
  else if (activeMode === 'gate-on') await verifyGateOn(scope);
  else {
    if (!args.includes('--write') || !args.includes('--school-code') || args[args.indexOf('--school-code') + 1] !== SCHOOL_CODE) {
      throw new Error(`Write mode requires --write --school-code ${SCHOOL_CODE}.`);
    }
    if (process.env.SHS_SELECTION_ENABLED !== 'true') {
      throw new Error('Run write mode only against the separate API process with SHS_SELECTION_ENABLED=true.');
    }
    await exerciseChoiceFlow(scope);
  }
  await db.end();
}

main().catch(async error => {
  console.error(error.message);
  await db.end().catch(() => {});
  process.exitCode = 1;
});
