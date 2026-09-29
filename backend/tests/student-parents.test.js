const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const calls = [];

databaseModule.getDatabase = () => ({
  async execute(sql, values) {
    calls.push({ sql, values });
    if (!sql.includes('FROM student_parent_links')) throw new Error('Unexpected database query');
    if (values[0] !== 1 || values[1] !== 6) return [[]];
    return [[{
      parentId: 9,
      displayName: 'Rosa Lim',
      initials: 'RL',
      personalEmail: 'rosa.lim@example.com',
      contactNumber: '09171234567',
      relationship: 'mother'
    }]];
  }
});

const { getMyParents } = require('../controllers/usersController');

async function call(user) {
  const result = { data: null, error: null };
  await getMyParents({ user }, {
    status() { return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('a student receives only parent links for their session identity and school', async () => {
  calls.length = 0;
  const result = await call({ id: 6, schoolId: 1, role: 'student' });

  assert.equal(result.error, null);
  assert.deepEqual(result.data.parents, [{
    parentId: '9',
    displayName: 'Rosa Lim',
    initials: 'RL',
    personalEmail: 'rosa.lim@example.com',
    contactNumber: '09171234567',
    relationship: 'mother'
  }]);
  assert.deepEqual(calls[0].values, [1, 6]);
  assert.match(calls[0].sql, /parents\.school_id = \?/);
  assert.match(calls[0].sql, /parents\.role = 'parent'/);
});

test('a student with no parent links receives an empty list', async () => {
  calls.length = 0;
  const result = await call({ id: 7, schoolId: 1, role: 'student' });

  assert.equal(result.error, null);
  assert.deepEqual(result.data.parents, []);
  assert.deepEqual(calls[0].values, [1, 7]);
});

test('a non-student cannot read the student parent endpoint', async () => {
  calls.length = 0;
  const result = await call({ id: 2, schoolId: 1, role: 'school_admin' });

  assert.equal(result.data, null);
  assert.equal(result.error.status, 403);
  assert.equal(calls.length, 0);
});

test('parent links from another school are not returned', async () => {
  calls.length = 0;
  const result = await call({ id: 6, schoolId: 2, role: 'student' });

  assert.equal(result.error, null);
  assert.deepEqual(result.data.parents, []);
  assert.deepEqual(calls[0].values, [2, 6]);
});
