const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');

let linkedChild = true;
let enrolledStudent = true;
let assignmentOnline = false;
let existingFilePath = null;
let activityRows = [];
let savedStatus = null;
let activityQueryCount = 0;

function getSchoolDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offset));
  return date.toISOString().slice(0, 10);
}

const assignment = {
  id: 12,
  schoolId: 1,
  sectionId: 8,
  subjectId: 4,
  teacherUserId: 3,
  title: 'Reflection Essay',
  onlineSubmissionEnabled: 0
};

async function executeQuery(sql, values = []) {
  if (sql.includes('SELECT users.id FROM users')) return [linkedChild ? [{ id: 42 }] : []];
  if (sql.includes('FROM assignments') && sql.includes('DATE(assignments.due_at) = ?')) {
    activityQueryCount += 1;
    return [activityRows];
  }
  if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ? LIMIT 1')) {
    return [[{ ...assignment, onlineSubmissionEnabled: assignmentOnline ? 1 : 0 }]];
  }
  if (sql.includes('SELECT online_submission_enabled AS onlineSubmissionEnabled FROM assignments')) {
    return [[{ onlineSubmissionEnabled: assignmentOnline ? 1 : 0 }]];
  }
  if (sql.includes('FROM section_students') && sql.includes('SELECT section_students.student_user_id')) {
    return [enrolledStudent ? [{ studentId: 42 }] : []];
  }
  if (sql.includes('SELECT file_path AS filePath FROM assignment_submissions')) {
    return [existingFilePath ? [{ filePath: existingFilePath }] : []];
  }
  if (sql.includes('INSERT INTO assignment_submissions')) {
    savedStatus = values[3] || null;
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected query: ${sql}`);
}

databaseModule.getDatabase = () => ({
  execute: executeQuery,
  async getConnection() {
    return {
      execute: executeQuery,
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {}
    };
  }
});

const { getParentAssignmentActivity, updateStudentAssignmentStatus } = require('../controllers/assignmentsController');

async function callActivity(studentId = '42', date = getSchoolDate()) {
  const result = { body: null, error: null };
  await getParentAssignmentActivity({
    query: { studentId, date },
    user: { id: 20, schoolId: 1, role: 'parent' }
  }, {
    json(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

async function callStatus(status = 'submitted', studentId = '42') {
  const result = { body: null, error: null };
  await updateStudentAssignmentStatus({
    params: { assignmentId: '12', studentId },
    body: { status },
    user: { id: 3, schoolId: 1, role: 'teacher' }
  }, {
    json(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

test('parent assignment activity returns safe per-child submission states', async () => {
  linkedChild = true;
  const today = getSchoolDate();
  const yesterday = getSchoolDate(-1);
  activityRows = [
    { assignmentId: 1, subjectId: 4, subjectName: 'English', title: 'Uploaded work', dueDate: today, onlineSubmissionEnabled: 1, savedStatus: 'submitted', filePath: 'private/path.pdf', submittedAt: `${today}T08:00:00` },
    { assignmentId: 2, subjectId: 4, subjectName: 'English', title: 'Online work', dueDate: today, onlineSubmissionEnabled: 1, savedStatus: null, filePath: null, submittedAt: null },
    { assignmentId: 3, subjectId: 7, subjectName: 'Science', title: 'Manual status', dueDate: today, onlineSubmissionEnabled: 0, savedStatus: 'submitted', filePath: null, submittedAt: null },
    { assignmentId: 4, subjectId: 7, subjectName: 'Science', title: 'Overdue work', dueDate: yesterday, onlineSubmissionEnabled: 0, savedStatus: null, filePath: null, submittedAt: null }
  ];
  activityQueryCount = 0;

  const result = await callActivity('42', today);

  assert.equal(result.error, null);
  assert.deepEqual(result.body.assignments.map(item => item.submissionStatus), ['submitted', 'pending', 'submitted', 'not_submitted']);
  assert.equal(Object.hasOwn(result.body.assignments[0], 'filePath'), false);
  assert.equal(activityQueryCount, 1);
});

test('parent cannot request assignment activity for an unlinked child', async () => {
  linkedChild = false;
  activityQueryCount = 0;

  const result = await callActivity('42', getSchoolDate());

  assert.equal(result.error.status, 403);
  assert.equal(activityQueryCount, 0);
  linkedChild = true;
});

test('teacher can save an offline assignment status for an enrolled student', async () => {
  assignmentOnline = false;
  enrolledStudent = true;
  existingFilePath = null;
  savedStatus = null;

  const result = await callStatus('submitted');

  assert.equal(result.error, null);
  assert.equal(result.body.submissionStatus, 'submitted');
  assert.equal(savedStatus, 'submitted');
});

test('teacher cannot manually overwrite an online file submission status', async () => {
  assignmentOnline = true;
  existingFilePath = null;

  const result = await callStatus('not_submitted');

  assert.equal(result.error.status, 409);
  assignmentOnline = false;
});

test('teacher cannot save an offline status for a student outside the section', async () => {
  enrolledStudent = false;

  const result = await callStatus('submitted');

  assert.equal(result.error.status, 404);
  enrolledStudent = true;
});

test('teacher cannot manually replace a record that contains an uploaded file', async () => {
  existingFilePath = 'uploads/assignment-submissions/student.pdf';

  const result = await callStatus('not_submitted');

  assert.equal(result.error.status, 409);
  existingFilePath = null;
});
