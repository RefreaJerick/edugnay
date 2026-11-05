const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { updateSchoolSettings } = require('../controllers/schoolsController');

async function saveWithDeadlocks(deadlocks, accentPalette) {
  const calls = [];
  const school = { id: 12, name: 'Current School', email: 'school@example.com', schoolEmailDomain: 'cs.academix.test', accentPalette: 'default-blue' };
  let updateSql = '';
  let settingsUpdateSql = '';
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async execute(sql, params) {
      if (sql.includes('FROM schools LEFT JOIN school_settings')) return [[school]];
      if (sql.startsWith('UPDATE schools SET name=')) {
        updateSql = sql;
        calls.push('update');
        if (deadlocks-- > 0) throw Object.assign(new Error('Deadlock'), { code: 'ER_LOCK_DEADLOCK' });
      }
      if (sql.includes('UPDATE school_settings SET')) {
        settingsUpdateSql = sql;
        school.accentPalette = params[1];
      }
      return [{}];
    }
  };
  database = { getConnection: async () => connection, execute: connection.execute.bind(connection) };
  let response;
  let failure;
  const body = { name: 'Updated School' };
  if (accentPalette !== undefined) body.accentPalette = accentPalette;
  await updateSchoolSettings(
    { user: { id: 31, role: 'school_admin', schoolId: 12 }, body },
    { status(code) { this.code = code; return this; }, json(data) { response = { status: this.code, data }; } },
    error => { failure = error; }
  );
  return { calls, response, failure, updateSql, settingsUpdateSql };
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

test('editing school contact settings never changes its login domain', async () => {
  const { response, updateSql } = await saveWithDeadlocks(0);
  assert.doesNotMatch(updateSql, /school_email_domain/);
  assert.equal(response.data.school.schoolEmailDomain, 'cs.academix.test');
});

test('school admin can save an approved accent palette for the school', async () => {
  const { response, failure, settingsUpdateSql } = await saveWithDeadlocks(0, 'deep-teal');
  assert.equal(failure, undefined);
  assert.equal(response.data.school.accentPalette, 'deep-teal');
  assert.match(settingsUpdateSql, /accent_palette=\?/);
});

test('school settings rejects unknown accent palette names before writing', async () => {
  const { response, failure, calls } = await saveWithDeadlocks(0, 'neon-orange');
  assert.equal(response, undefined);
  assert.equal(failure.status, 400);
  assert.match(failure.message, /available school accent colors/);
  assert.deepEqual(calls, [], 'invalid palette values should be rejected before opening a DB connection');
});

test('school settings cannot change the current academic year label', async () => {
  let failure;
  await updateSchoolSettings(
    { user: { id: 31, role: 'school_admin', schoolId: 12 }, body: { currentSchoolYearLabel: '2027-2028' } },
    { status() { return this; }, json() { assert.fail('Year label changes require activation.'); } },
    error => { failure = error; }
  );
  assert.equal(failure.status, 400);
});

test('only a school admin can change school branding settings', async () => {
  let failure;
  await updateSchoolSettings(
    { user: { id: 32, role: 'teacher', schoolId: 12 }, body: { accentPalette: 'plum' } },
    { status() { return this; }, json() { assert.fail('A teacher must not update school settings.'); } },
    error => { failure = error; }
  );
  assert.equal(failure.status, 403);
});
