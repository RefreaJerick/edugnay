const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.ASSIGNMENT_SUBMISSION_DIRECTORY = os.tmpdir();
process.env.MATERIAL_UPLOAD_DIRECTORY = os.tmpdir();
process.env.SF_EXPORT_DIRECTORY = os.tmpdir();

const databaseModule = require('../config/database');
const database = databaseModule.getDatabase();

async function expectDenied(label, handler, request, status) {
  let error;
  let responded = false;
  const response = {
    status() { return this; },
    set() { return this; },
    json() { responded = true; return this; },
    send() { responded = true; return this; }
  };
  await handler(request, response, nextError => { error = nextError; });
  assert.equal(error?.status, status, `${label}: expected HTTP ${status}, got ${error?.status || 'success'}`);
  assert.equal(responded, false, `${label}: returned protected data`);
  console.log(`PASS ${label}`);
}

async function expectEmpty(label, handler, request, field) {
  let result;
  let error;
  await handler(request, {
    set() { return this; },
    json(body) { result = body; return this; }
  }, nextError => { error = nextError; });
  assert.ifError(error);
  assert.deepEqual(result?.[field], [], `${label}: returned another school's records`);
  console.log(`PASS ${label}`);
}

async function expectForeignKeyRejection(connection, label, sql, values) {
  await assert.rejects(
    connection.execute(sql, values),
    error => error.code === 'ER_NO_REFERENCED_ROW_2',
    `${label}: the database accepted a cross-school relationship`
  );
  console.log(`PASS ${label}`);
}

async function main() {
  const connection = await database.getConnection();
  let started = false;
  let attackerSchoolId;
  try {
    const [[target]] = await connection.execute(
      `SELECT schools.id AS schoolId,
        (SELECT id FROM users WHERE school_id = schools.id AND role = 'student' LIMIT 1) AS studentId,
        (SELECT id FROM users WHERE school_id = schools.id AND role = 'parent' LIMIT 1) AS parentId,
        (SELECT id FROM users WHERE school_id = schools.id AND role = 'teacher' LIMIT 1) AS teacherId,
        (SELECT id FROM assignments WHERE school_id = schools.id LIMIT 1) AS assignmentId,
        (SELECT id FROM attendance_sessions WHERE school_id = schools.id LIMIT 1) AS attendanceSessionId,
        (SELECT id FROM announcements WHERE school_id = schools.id LIMIT 1) AS announcementId,
        (SELECT id FROM learning_materials WHERE school_id = schools.id LIMIT 1) AS materialId,
        (SELECT submissions.id FROM assignment_submissions AS submissions
          INNER JOIN assignments ON assignments.id = submissions.assignment_id
          WHERE assignments.school_id = schools.id LIMIT 1) AS submissionId,
        (SELECT submissions.assignment_id FROM assignment_submissions AS submissions
          INNER JOIN assignments ON assignments.id = submissions.assignment_id
          WHERE assignments.school_id = schools.id LIMIT 1) AS submissionAssignmentId,
        (SELECT id FROM school_form_exports WHERE school_id = schools.id AND export_status = 'generated' LIMIT 1) AS exportId,
        (SELECT id FROM notifications WHERE user_id IN
          (SELECT id FROM users WHERE school_id = schools.id) LIMIT 1) AS notificationId
      FROM schools WHERE registration_status = 'active'
        AND EXISTS (SELECT 1 FROM sections WHERE school_id = schools.id)
        AND EXISTS (SELECT 1 FROM published_final_grades WHERE school_id = schools.id)
      ORDER BY schools.id LIMIT 1`
    );
    if (!target || !target.studentId || !target.parentId || !target.teacherId
      || !target.assignmentId || !target.attendanceSessionId || !target.announcementId
      || !target.materialId || !target.submissionId || !target.exportId || !target.notificationId) {
      throw new Error('The two-school test needs an active school with users and saved academic, file, and notification records.');
    }
    const [[teaching]] = await connection.execute(
      `SELECT section_teachers.section_id AS sectionId, section_teachers.subject_id AS subjectId
      FROM section_teachers INNER JOIN sections ON sections.id = section_teachers.section_id
        AND sections.school_id = section_teachers.school_id
      WHERE section_teachers.school_id = ? LIMIT 1`,
      [target.schoolId]
    );
    if (!teaching) throw new Error('The two-school test needs a teacher section and subject assignment.');

    await connection.beginTransaction();
    started = true;
    const marker = crypto.randomUUID();
    const [school] = await connection.execute(
      "INSERT INTO schools (name, registration_status) VALUES (?, 'active')",
      [`Isolation test ${marker}`]
    );
    attackerSchoolId = school.insertId;
    await connection.execute(
      'INSERT INTO school_portal_features (school_id, grades_enabled, attendance_enabled, sf_templates_enabled) VALUES (?, TRUE, TRUE, TRUE)',
      [attackerSchoolId]
    );

    const identities = {};
    for (const role of ['school_admin', 'teacher', 'student', 'parent']) {
      const [account] = await connection.execute(
        `INSERT INTO users (school_id, role, school_email, password_hash,
          first_name, last_name, display_name, initials)
        VALUES (?, ?, ?, ?, 'Isolation', 'Test', 'Isolation Test', 'IT')`,
        [attackerSchoolId, role, `${role}-${marker}@isolation.invalid`, 'disabled-test-password']
      );
      const token = crypto.randomBytes(32).toString('base64url');
      await connection.execute(
        'INSERT INTO user_sessions (user_id, session_token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [account.insertId, crypto.createHash('sha256').update(token).digest('hex')]
      );
      identities[role] = { token, id: account.insertId };
    }

    const testDatabase = {
      execute: (...args) => connection.execute(...args),
      getConnection: async () => ({
        execute: (...args) => connection.execute(...args),
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
        release() {}
      })
    };
    databaseModule.getDatabase = () => testDatabase;
    const { getSessionUser } = require('../config/session');
    const users = require('../controllers/usersController');
    const sections = require('../controllers/sectionsController');
    const attendance = require('../controllers/attendanceController');
    const grades = require('../controllers/gradesController');
    const announcements = require('../controllers/announcementsController');
    const qr = require('../controllers/qrAttendanceController');
    const notifications = require('../controllers/notificationsController');
    const assignments = require('../controllers/assignmentsController');
    const materials = require('../controllers/materialsController');
    const exports = require('../controllers/sfTemplatesController');
    const schools = require('../controllers/schoolsController');
    const journals = require('../controllers/journalsController');

    for (const role of Object.keys(identities)) {
      const user = await getSessionUser(identities[role].token);
      assert.equal(user?.schoolId, attackerSchoolId);
      assert.equal(user?.role, role);
      identities[role] = { ...user, token: identities[role].token };
    }
    console.log('PASS second-school session identities');
    await connection.execute("UPDATE schools SET registration_status = 'suspended' WHERE id = ?", [attackerSchoolId]);
    assert.equal(await getSessionUser(identities.teacher.token), null);
    await connection.execute("UPDATE schools SET registration_status = 'active' WHERE id = ?", [attackerSchoolId]);
    console.log('PASS suspended school session denied');

    const admin = identities.school_admin;
    const teacher = identities.teacher;
    const student = identities.student;
    const parent = identities.parent;
    const targetStudent = String(target.studentId);
    const targetSection = String(teaching.sectionId);
    const targetSubject = String(teaching.subjectId);
    await expectDenied('admin cannot read another school account', users.getUser,
      { user: admin, params: { userId: targetStudent } }, 404);
    await expectDenied('parent cannot read another school student', users.getUser,
      { user: parent, params: { userId: targetStudent } }, 403);
    await expectDenied('admin cannot read another school parent links', users.getParentChildren,
      { user: admin, params: { userId: String(target.parentId) } }, 404);
    await expectDenied('teacher cannot read another school section', sections.getSection,
      { user: teacher, params: { sectionId: targetSection } }, 404);
    await expectDenied('teacher cannot read another school attendance', attendance.getSectionAttendance,
      { user: teacher, params: { sectionId: targetSection, subjectId: targetSubject }, query: {} }, 404);
    await expectDenied('student cannot select another school grade owner', grades.listPublishedFinalGrades,
      { user: student, query: { studentId: targetStudent } }, 403);
    await expectDenied('parent cannot select another school grade owner', grades.listPublishedFinalGrades,
      { user: parent, query: { studentId: targetStudent } }, 403);
    await expectEmpty('admin grade list excludes another school', grades.listPublishedFinalGrades,
      { user: admin, query: { studentId: targetStudent } }, 'finalGrades');
    await expectEmpty('admin announcement list excludes another school', announcements.listAnnouncements,
      { user: admin, query: {} }, 'announcements');
    await expectEmpty('admin journal history excludes another school', journals.listJournalHistory,
      { user: admin, query: { sectionId: targetSection } }, 'entries');
    await expectEmpty('teacher journal history excludes another school', journals.listJournalHistory,
      { user: teacher, query: { sectionId: targetSection } }, 'entries');
    await expectEmpty('student journal history excludes another school', journals.listJournalHistory,
      { user: student, query: { sectionId: targetSection } }, 'entries');
    await expectDenied('admin cannot open another school announcement image', announcements.getAnnouncementImage,
      { user: admin, params: { announcementId: String(target.announcementId) } }, 404);
    await expectDenied('admin cannot read another school student QR', qr.getStudentQr,
      { user: admin, params: { studentId: targetStudent } }, 404);
    await expectDenied('admin cannot open another school logo', schools.getSchoolLogo,
      { user: admin, params: { schoolId: String(target.schoolId) } }, 403);
    await expectDenied('admin cannot preview another school submission', assignments.previewSubmission,
      { user: admin, params: { assignmentId: String(target.submissionAssignmentId), submissionId: String(target.submissionId) } }, 404);
    await expectDenied('student cannot list another school assignment submissions', assignments.listSubmissions,
      { user: student, params: { assignmentId: String(target.assignmentId) } }, 404);
    await expectDenied('teacher cannot access another school upload section', materials.authorizeUpload,
      { user: teacher, params: { sectionId: targetSection, subjectId: targetSubject } }, 403);
    await expectDenied('student cannot open another school material', materials.openMaterial,
      { user: student, params: { materialId: String(target.materialId) } }, 404);
    await expectDenied('teacher cannot download another school form export', exports.downloadExport,
      { user: teacher, params: { exportId: String(target.exportId) } }, 404);
    await expectDenied('admin cannot delete another school assignment', assignments.deleteAssignment,
      { user: admin, params: { assignmentId: String(target.assignmentId) } }, 404);
    await expectDenied('student cannot mark another school notification read', notifications.markNotificationRead,
      { user: student, params: { notificationId: String(target.notificationId) } }, 404);
    await expectEmpty('parent attendance excludes another school', attendance.getParentAttendance,
      { user: parent }, 'records');
    await expectEmpty('student notifications exclude another school', notifications.listNotifications,
      { user: student, query: {} }, 'notifications');

    await expectForeignKeyRejection(connection, 'cross-school parent link blocked',
      'INSERT INTO student_parent_links (school_id, student_user_id, parent_user_id, relationship) VALUES (?, ?, ?, ?)',
      [target.schoolId, target.studentId, parent.id, 'guardian']);
    await expectForeignKeyRejection(connection, 'cross-school enrollment blocked',
      'INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)',
      [target.schoolId, teaching.sectionId, student.id]);
    await expectForeignKeyRejection(connection, 'cross-school teacher assignment blocked',
      'INSERT INTO section_teachers (school_id, section_id, teacher_user_id, subject_id) VALUES (?, ?, ?, ?)',
      [target.schoolId, teaching.sectionId, teacher.id, teaching.subjectId]);
    await expectForeignKeyRejection(connection, 'cross-school assignment submission blocked',
      "INSERT INTO assignment_submissions (school_id, assignment_id, student_user_id, submission_status) VALUES (?, ?, ?, 'pending')",
      [target.schoolId, target.assignmentId, student.id]);
    await expectForeignKeyRejection(connection, 'cross-school attendance record blocked',
      "INSERT INTO attendance_records (school_id, attendance_session_id, student_user_id, attendance_status, marked_by_user_id) VALUES (?, ?, ?, 'present', ?)",
      [target.schoolId, target.attendanceSessionId, student.id, target.teacherId]);

    console.log('Two-school isolation checks passed. Test school, accounts, and sessions will be rolled back.');
  } finally {
    try {
      if (started) {
        await connection.rollback();
        const [[remaining]] = await connection.execute('SELECT COUNT(*) AS count FROM schools WHERE id = ?', [attackerSchoolId]);
        assert.equal(remaining.count, 0, 'The temporary test school was not rolled back.');
        console.log('PASS temporary test school rolled back');
      }
    } finally {
      connection.release();
      await database.end();
    }
  }
}

main().catch(error => {
  console.error(`Two-school isolation test failed: ${error.message}`);
  process.exitCode = 1;
});
