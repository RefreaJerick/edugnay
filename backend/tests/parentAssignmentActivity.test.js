const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');

let linkedChild = true;
let enrolledStudent = true;
let assignmentOnline = false;
let existingFilePath = null;
let activityRows = [];
let childAssignmentRows = [];
let historyRows = [];
let savedStatus = null;
let activityQueryCount = 0;
let childAssignmentQuery = null;
let historyQuery = null;

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
  if (sql.includes('FROM assignment_submissions') && sql.includes('section_students.withdrawn_at IS NOT NULL')) {
    historyQuery = { sql, values };
    return [historyRows];
  }
  if (sql.includes('assignment_submissions.file_path IS NOT NULL AS hasUploadedFile')) {
    childAssignmentQuery = { sql, values };
    return [childAssignmentRows];
  }
  if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ?') && sql.includes('FROM assignments')) {
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

const { getParentAssignmentActivity, getParentChildAssignments, getStudentAssignmentHistory, updateStudentAssignmentStatus } = require('../controllers/assignmentsController');

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

async function callChildAssignments(studentId = '42') {
  const result = { body: null, error: null };
  await getParentChildAssignments({
    params: { studentId },
    user: { id: 20, schoolId: 1, role: 'parent' }
  }, {
    json(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

test('parent assignment list scopes records to one linked child and resolves submission statuses', async () => {
  linkedChild = true;
  const today = getSchoolDate();
  const yesterday = getSchoolDate(-1);
  const tomorrow = getSchoolDate(1);
  childAssignmentRows = [
    { id: 1, sectionId: 8, subjectId: 4, academicTermId: 2, title: 'Uploaded', dueDate: today, onlineSubmissionEnabled: 1, savedStatus: 'submitted', hasUploadedFile: 1, submittedAt: `${today}T08:00:00` },
    { id: 2, sectionId: 8, subjectId: 4, academicTermId: 2, title: 'In class', dueDate: today, onlineSubmissionEnabled: 0, savedStatus: 'submitted', hasUploadedFile: 0 },
    { id: 3, sectionId: 8, subjectId: 4, academicTermId: 2, title: 'Overdue', dueDate: yesterday, onlineSubmissionEnabled: 1, savedStatus: null, hasUploadedFile: 0 },
    { id: 4, sectionId: 8, subjectId: 4, academicTermId: 2, title: 'Upcoming', dueDate: tomorrow, onlineSubmissionEnabled: 1, savedStatus: null, hasUploadedFile: 0 },
    { id: 5, sectionId: 8, subjectId: 4, academicTermId: 2, title: 'No due date', dueDate: null, onlineSubmissionEnabled: 0, savedStatus: null, hasUploadedFile: 0 }
  ];
  childAssignmentQuery = null;
  const result = await callChildAssignments();
  assert.equal(result.error, null);
  assert.equal(result.body.studentId, '42');
  assert.equal(result.body.currentDate, today);
  assert.deepEqual(result.body.assignments.map(item => item.submissionStatus), ['submitted', 'submitted', 'not_submitted', 'pending', 'pending']);
  assert.equal(result.body.assignments[0].submittedAt, `${today}T08:00:00`);
  assert.ok(result.body.assignments.every(item => !Object.hasOwn(item, 'filePath') && !Object.hasOwn(item, 'hasUploadedFile')));
  assert.deepEqual(childAssignmentQuery.values, [42, 42, 1, 20]);
  assert.match(childAssignmentQuery.sql, /section_students\.withdrawn_at IS NULL/);
  assert.match(childAssignmentQuery.sql, /assignments\.status = 'published'/);
  assert.match(childAssignmentQuery.sql, /student_parent_links\.school_id = assignments\.school_id/);
});

test('parent previous-section history includes saved statuses but no file access', async () => {
  historyRows = [{ id: 7, sectionId: 6, sectionName: 'St. Anne', subjectId: 4, academicTermId: 2,
    academicYearLabel: '2026–2027', academicTermName: 'Quarter 2', title: 'Old essay',
    description: 'Write an essay', dueDate: getSchoolDate(-1), onlineSubmissionEnabled: 0,
    savedStatus: 'submitted', hasUploadedFile: 0, fileName: null }];
  try {
    const result = await callChildAssignments();
    assert.equal(result.error, null);
    assert.equal(result.body.history.length, 1);
    assert.equal(result.body.history[0].submissionStatus, 'submitted');
    assert.equal(result.body.history[0].sectionName, 'St. Anne');
    assert.equal(Object.hasOwn(result.body.history[0], 'fileName'), false);
    assert.equal(Object.hasOwn(result.body.history[0], 'fileAvailable'), false);
    assert.deepEqual(historyQuery.values, [1, 42]);
    assert.match(historyQuery.sql, /assignments\.created_at <= section_students\.withdrawn_at/);
    assert.match(historyQuery.sql, /assignments\.status = 'published'/);
  } finally { historyRows = []; }
});

test('student previous-section history includes only their own file reference', async () => {
  historyRows = [{ id: 7, sectionId: 6, sectionName: 'St. Anne', subjectId: 4, academicTermId: 2,
    title: 'Old essay', description: 'Write an essay', onlineSubmissionEnabled: 1,
    savedStatus: 'submitted', hasUploadedFile: 1, fileName: 'essay.pdf' }];
  let body;
  try {
    await getStudentAssignmentHistory({ user: { id: 42, schoolId: 1, role: 'student' } }, {
      set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
      json(value) { body = value; return this; }
    }, error => { throw error; });
    assert.equal(body.history[0].fileName, 'essay.pdf');
    assert.equal(body.history[0].fileAvailable, true);
  } finally { historyRows = []; }
});

test('only students can request previous-section history or download', () => {
  const router = require('../routes/assignments');
  for (const path of ['/history', '/history/:assignmentId/file']) {
    const route = router.stack.find(layer => layer.route?.path === path).route;
    const guard = route.stack[0].handle;
    for (const role of ['parent', 'teacher', 'school_admin']) {
      let status;
      guard({ user: { role } }, { status(code) { status = code; return this; }, json() {} }, () => { throw new Error('Role should be rejected.'); });
      assert.equal(status, 403);
    }
  }
});

test('parent assignment list rejects an unlinked or other-school child before querying assignments', async () => {
  linkedChild = false;
  childAssignmentQuery = null;
  try {
    const result = await callChildAssignments();
    assert.equal(result.error.status, 403);
    assert.equal(childAssignmentQuery, null);
  } finally { linkedChild = true; }
});

test('parent assignment list route is parent-only', () => {
  const router = require('../routes/assignments');
  const route = router.stack.find(layer => layer.route?.path === '/children/:studentId').route;
  const guard = route.stack[0].handle;
  for (const role of ['student', 'teacher', 'school_admin']) {
    let status;
    guard({ user: { role } }, { status(code) { status = code; return this; }, json() {} }, () => { throw new Error('Role should be rejected.'); });
    assert.equal(status, 403);
  }
});

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
