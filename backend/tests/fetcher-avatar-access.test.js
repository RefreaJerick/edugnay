const assert = require('node:assert/strict');
const test = require('node:test');
const { canViewAvatar } = require('../controllers/avatarsController');

test('school guards can view student avatars only from their own school', async () => {
  const database = { execute: async () => { throw new Error('Unexpected avatar access query.'); } };
  const guard = { id: 10, schoolId: 4, role: 'school_guard' };
  const student = { id: 20, schoolId: 4, role: 'student' };

  assert.equal(await canViewAvatar(database, guard, student), true);
  assert.equal(await canViewAvatar(database, guard, { ...student, schoolId: 5 }), false);
  assert.equal(await canViewAvatar(database, guard, { ...student, role: 'parent' }), false);
});
