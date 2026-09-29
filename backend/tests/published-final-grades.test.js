const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
let linkedStudentExists = true;
let gradePortalEnabled = true;
let gradeRows = [];

databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('FROM school_portal_features')) return [[{ gradesEnabled: gradePortalEnabled }]];
    if (sql.includes('FROM published_final_grades')) return [gradeRows];
    if (sql.includes('FROM student_parent_links')) return [linkedStudentExists ? [{ 1: 1 }] : []];
    throw new Error(`Unexpected query: ${sql}`);
  }
});

const grades = require('../controllers/gradesController');

function reset() {
  queries.length = 0;
  linkedStudentExists = true;
  gradePortalEnabled = true;
  gradeRows = [];
}

async function call(role, query = {}, user = {}) {
  const result = { data: null, error: null };
  await grades.listPublishedFinalGrades({
    user: { id: 5, schoolId: 1, role, ...user },
    query
  }, {
    set() { return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('students can read only their own published grades', async () => {
  reset();
  gradeRows = [{
    id: 9, schoolId: 1, studentId: 5, studentName: 'Ava Cruz', sectionId: 8,
    sectionName: 'St. Matthew', subjectId: 2, subjectName: 'English',
    academicTermId: 14, academicTermName: 'Quarter 2', academicYearId: 4,
    academicYearLabel: '2026-2027', finalGrade: '88.00', publishedAt: '2026-09-27 10:00:00'
  }];

  const result = await call('student');
  assert.equal(result.error, null);
  assert.equal(result.data.finalGrades[0].finalGrade, 88);
  assert.equal(result.data.finalGrades[0].studentId, '5');
  const gradeQuery = queries.find(query => query.sql.includes('FROM published_final_grades'));
  assert.match(gradeQuery.sql, /published_final_grades\.school_id = \?/);
  assert.match(gradeQuery.sql, /published_final_grades\.student_user_id = \?/);
  assert.deepEqual(gradeQuery.values.slice(0, 2), [1, 5]);

  reset();
  const denied = await call('student', { studentId: '6' });
  assert.equal(denied.error?.status, 403);
  assert.equal(queries.length, 0);
});

test('parents can read linked children and selected child IDs are checked against the link table', async () => {
  reset();
  gradeRows = [{ id: 10, schoolId: 1, studentId: 22, finalGrade: '91.50' }];

  const result = await call('parent', { studentId: '22' });
  assert.equal(result.error, null);
  assert.equal(result.data.finalGrades[0].finalGrade, 91.5);
  assert.match(queries[1].sql, /student_parent_links\.parent_user_id = \?/);
  assert.deepEqual(queries[1].values, [1, 5, 22]);
  assert.match(queries[2].sql, /published_final_grades\.student_user_id = \?/);
  assert.deepEqual(queries[2].values.slice(0, 2), [1, 22]);

  reset();
  linkedStudentExists = false;
  const denied = await call('parent', { studentId: '22' });
  assert.equal(denied.error?.status, 403);
  assert.equal(queries.length, 2);
});

test('parent without a selected child gets only linked children without duplicate link rows', async () => {
  reset();
  const result = await call('parent');

  assert.equal(result.error, null);
  assert.deepEqual(result.data, { finalGrades: [] });
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /EXISTS \(/);
  assert.match(queries[1].sql, /student_parent_links\.student_user_id = published_final_grades\.student_user_id/);
  assert.doesNotMatch(queries[1].sql, /student_scores/);
});

test('students and parents cannot read published grades while their school Grades portal is disabled', async () => {
  reset();
  gradePortalEnabled = false;

  for (const role of ['parent', 'student']) {
    const result = await call(role);
    assert.equal(result.error?.status, 403);
  }
  assert.equal(queries.filter(query => query.sql.includes('FROM published_final_grades')).length, 0);
  assert.equal(queries.filter(query => query.sql.includes('FROM student_parent_links')).length, 0);
});

test('teachers are limited to assigned section and subject grade records', async () => {
  reset();

  const result = await call('teacher', { sectionId: '8', subjectId: '2', academicTermId: '14' });
  assert.equal(result.error, null);
  assert.match(queries[0].sql, /section_teachers\.section_id = published_final_grades\.section_id/);
  assert.match(queries[0].sql, /section_teachers\.subject_id = published_final_grades\.subject_id/);
  assert.match(queries[0].sql, /section_teachers\.teacher_user_id = \?/);
  assert.deepEqual(queries[0].values, [1, 5, 8, 2, 14]);
});

test('school admins are restricted to their session school and user filters stay parameterized', async () => {
  reset();

  const result = await call('school_admin', { studentId: '22', academicYearId: '4' });
  assert.equal(result.error, null);
  assert.match(queries[0].sql, /published_final_grades\.school_id = \?/);
  assert.match(queries[0].sql, /published_final_grades\.student_user_id = \?/);
  assert.match(queries[0].sql, /sections\.academic_year_id = \?/);
  assert.deepEqual(queries[0].values, [1, 22, 4]);

  reset();
  const injectedSchool = await call('school_admin', { schoolId: '99' });
  assert.equal(injectedSchool.error?.status, 400);
  assert.equal(queries.length, 0);
});

test('platform admins and malformed filters are rejected before grade queries', async () => {
  reset();
  assert.equal((await call('platform_admin')).error?.status, 403);
  assert.equal((await call('student', { academicTermId: '0' })).error?.status, 400);
  assert.equal(queries.length, 0);
});

test('grade reads preserve closed-term and former-enrollment history', async () => {
  reset();
  await call('student');
  const gradeQuery = queries.find(query => query.sql.includes('FROM published_final_grades'));

  assert.match(gradeQuery.sql, /INNER JOIN academic_terms/);
  assert.match(gradeQuery.sql, /INNER JOIN academic_years/);
  assert.doesNotMatch(gradeQuery.sql, /academic_terms\.status\s*=\s*'active'/);
  assert.doesNotMatch(gradeQuery.sql, /section_students/);
  assert.doesNotMatch(gradeQuery.sql, /student_scores/);
});
