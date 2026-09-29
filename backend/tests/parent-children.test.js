const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const calls = [];
databaseModule.getDatabase = () => ({
  async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes("role = 'parent'")) return [[{ id: 9 }]];
    if (sql.includes('FROM student_parent_links AS links')) return [[{
      studentId: 6, displayName: 'Juan Dela Cruz', initials: 'JC',
      relationship: 'mother', sectionId: 8, sectionName: 'St. Matthew',
      gradeLevel: 'Grade 7', lrn: '123', adviserName: 'Ms. Maria Reyes'
    }]];
    throw new Error('Unexpected database query');
  }
});
const { getParentChildren } = require('../controllers/usersController');

async function call(user, params = {}) {
  const result = { data: null, error: null };
  await getParentChildren({ user, params }, {
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('a parent reads only their own database-linked children', async () => {
  calls.length = 0;
  const result = await call({ id: 9, schoolId: 1, role: 'parent' });
  assert.equal(result.error, null);
  assert.equal(result.data.children[0].studentId, '6');
  assert.equal(result.data.children[0].sectionName, 'St. Matthew');
  assert.deepEqual(calls[0].values, [9, 1]);
  assert.deepEqual(calls[1].values, [1, 9]);
});

test('a parent cannot request another parent’s children', async () => {
  calls.length = 0;
  const result = await call({ id: 9, schoolId: 1, role: 'parent' }, { userId: '10' });
  assert.equal(result.data, null);
  assert.equal(result.error.status, 403);
  assert.equal(calls.length, 0);
});

test('a school admin can view parent links from their school', async () => {
  calls.length = 0;
  const result = await call({ id: 2, schoolId: 1, role: 'school_admin' }, { userId: '9' });
  assert.equal(result.error, null);
  assert.equal(result.data.children[0].displayName, 'Juan Dela Cruz');
  assert.deepEqual(calls[0].values, [9, 1]);
});
