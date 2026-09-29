const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
databaseModule.getDatabase = () => ({
  async execute(sql, values) {
    queries.push({ sql, values });
    return [[]];
  }
});

const grades = require('../controllers/gradesController');

async function call(handler, role, query = {}) {
  const result = { data: null, error: null };
  await handler({ user: { id: 5, schoolId: 1, role }, query }, {
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('students and parents cannot read unpublished grading items or raw scores', async () => {
  queries.length = 0;

  for (const role of ['student', 'parent']) {
    for (const handler of [grades.listGradingItems, grades.listStudentScores]) {
      const result = await call(handler, role);
      assert.equal(result.error?.status, 403);
    }
  }

  assert.equal(queries.length, 0);
});

test('teacher reads are limited to owned grading items with an active section-subject assignment', async () => {
  queries.length = 0;

  await call(grades.listGradingItems, 'teacher', { sectionId: '8' });
  await call(grades.listStudentScores, 'teacher', { studentId: '12' });

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /grading_items\.teacher_user_id = \?/);
    assert.match(query.sql, /section_teachers\.subject_id = grading_items\.subject_id/);
    assert.match(query.sql, /section_teachers\.teacher_user_id = \?/);
    assert.deepEqual(query.values.slice(0, 3), [1, 5, 5]);
  }
  assert.equal(queries[0].values[3], 8);
  assert.equal(queries[1].values[3], 12);
});

test('school-admin reads remain scoped to the admin school', async () => {
  queries.length = 0;

  await call(grades.listGradingItems, 'school_admin');
  await call(grades.listStudentScores, 'school_admin');

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /sections\.school_id = \?/);
    assert.deepEqual(query.values, [1]);
    assert.doesNotMatch(query.sql, /section_teachers/);
  }
});
