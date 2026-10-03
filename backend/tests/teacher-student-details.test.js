const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const calls = [];
let studentRows = [];
let parentRows = [];

databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM section_students')) return [studentRows];
    if (sql.includes('FROM student_parent_links')) return [parentRows];
    throw new Error(`Unexpected query: ${sql}`);
  }
});

const { getSectionStudentDetails } = require('../controllers/sectionsController');

async function call(user = { id: 12, schoolId: 1, role: 'teacher' }) {
  const result = { body: null, error: null };
  await getSectionStudentDetails(
    { user, params: { sectionId: '8', studentId: '17' } },
    { json(body) { result.body = body; return this; } },
    error => { result.error = error; }
  );
  return result;
}

test('an assigned teacher can read the current section student and linked guardian contacts', async () => {
  calls.length = 0;
  studentRows = [{
    studentId: 17,
    displayName: 'Carlo Mendoza',
    schoolEmail: 'carlo@example.school',
    studentNumber: '123456789012',
    gradeLevel: 'Grade 7',
    sectionName: 'St. Matthew',
    schoolYear: '2026-2027'
  }];
  parentRows = [{
    displayName: 'Rosa Mendoza',
    relationship: 'mother',
    contactNumber: '09171234567',
    email: 'rosa@example.com'
  }];

  const result = await call();

  assert.equal(result.error, null);
  assert.deepEqual(result.body, {
    student: {
      id: '17',
      displayName: 'Carlo Mendoza',
      schoolEmail: 'carlo@example.school',
      studentNumber: '123456789012',
      gradeLevel: 'Grade 7',
      sectionName: 'St. Matthew',
      schoolYear: '2026-2027',
      enrollmentStatus: 'Enrolled'
    },
    parents: parentRows
  });
  assert.match(calls[0].sql, /section_students\.school_id = \?/);
  assert.match(calls[0].sql, /section_students\.withdrawn_at IS NULL/);
  assert.match(calls[0].sql, /academic_years\.status = 'active'/);
  assert.match(calls[0].sql, /section_teachers\.teacher_user_id = \?/);
  assert.match(calls[0].sql, /subjects\.is_active = TRUE/);
  assert.deepEqual(calls[0].values, [1, 8, 17, 12]);
  assert.match(calls[1].sql, /student_parent_links\.school_id = \?/);
  assert.match(calls[1].sql, /parents\.school_id = student_parent_links\.school_id/);
  assert.deepEqual(calls[1].values, [1, 17]);
});

test('student and guardian details are not returned when the teacher lacks a section subject assignment', async () => {
  calls.length = 0;
  studentRows = [];
  parentRows = [];

  const result = await call();

  assert.equal(result.body, null);
  assert.equal(result.error.status, 404);
  assert.equal(calls.length, 1);
});

test('a teacher cannot retrieve a student detail from another school', async () => {
  calls.length = 0;
  studentRows = [];
  parentRows = [];

  const result = await call({ id: 12, schoolId: 2, role: 'teacher' });

  assert.equal(result.body, null);
  assert.equal(result.error.status, 404);
  assert.deepEqual(calls[0].values, [2, 8, 17, 12]);
  assert.equal(calls.length, 1);
});

test('non-teachers cannot read student or guardian details', async () => {
  calls.length = 0;

  const result = await call({ id: 4, schoolId: 1, role: 'school_admin' });

  assert.equal(result.body, null);
  assert.equal(result.error.status, 403);
  assert.equal(calls.length, 0);
});
