const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { updateSchoolSettings } = require('../controllers/schoolsController');

async function saveWithDeadlocks(deadlocks) {
  const calls = [];
  const school = { id: 12, name: 'Current School', email: 'school@example.com' };
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async execute(sql) {
      if (sql.includes('FROM schools LEFT JOIN school_settings')) return [[school]];
      if (sql.startsWith('UPDATE schools SET name=')) {
        calls.push('update');
        if (deadlocks-- > 0) throw Object.assign(new Error('Deadlock'), { code: 'ER_LOCK_DEADLOCK' });
      }
      return [{}];
    }
  };
  database = { getConnection: async () => connection, execute: connection.execute.bind(connection) };
  let response;
  let failure;
  await updateSchoolSettings(
    { user: { id: 31, role: 'school_admin', schoolId: 12 }, body: { name: 'Updated School' } },
    { status(code) { this.code = code; return this; }, json(data) { response = { status: this.code, data }; } },
    error => { failure = error; }
  );
  return { calls, response, failure };
}

test('school settings retries one deadlock and responds after commit', async () => {
  const { calls, response, failure } = await saveWithDeadlocks(1);
  assert.equal(failure, undefined);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.filter(call => ['begin', 'update', 'rollback', 'commit'].includes(call)),
    ['begin', 'update', 'rollback', 'begin', 'update', 'commit']);
  assert.equal(calls.at(-1), 'release');
});

test('school settings stops after a second deadlock', async () => {
  const { calls, response, failure } = await saveWithDeadlocks(2);
  assert.equal(response, undefined);
  assert.equal(failure.code, 'ER_LOCK_DEADLOCK');
  assert.equal(calls.filter(call => call === 'rollback').length, 2);
  assert.equal(calls.filter(call => call === 'commit').length, 0);
});
