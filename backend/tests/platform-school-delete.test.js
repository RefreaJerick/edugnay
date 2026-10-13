const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const databaseModule = require('../config/database');

let state;
let calls;
let auditValues;
const connection = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO audit_logs')) auditValues = values;
    if (sql.startsWith('SELECT id, name, logo_path')) {
      return [[state.missing ? undefined : { id: 8, name: 'Test School', logoPath: null, status: state.status }].filter(Boolean)];
    }
    if (sql.startsWith('SELECT id, role, avatar_filename')) return [state.users];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM academic_years')) return [[{ total: state.years }]];
    if (sql.startsWith('SELECT 1 AS found FROM')) return [[sql.includes(`FROM ${state.activityTable} `) ? { found: 1 } : undefined].filter(Boolean)];
    if (sql.startsWith('SELECT id FROM school_registration_email_outbox')) return [state.emailQueued ? [{ id: 1 }] : []];
    if (sql.startsWith('DELETE FROM') && state.failOn && sql.includes(state.failOn)) {
      const error = new Error('Foreign key restriction');
      error.code = 'ER_ROW_IS_REFERENCED_2';
      throw error;
    }
    return [{ affectedRows: 1 }];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { deletePlatformSchool } = require('../controllers/schoolsController');

async function remove(options = {}) {
  state = { status: 'rejected', users: [{ id: 17, role: 'school_admin' }], years: 1, ...options };
  calls = [];
  auditValues = null;
  const result = {};
  await deletePlatformSchool(
    { params: { schoolId: '8' }, user: { id: 4, role: 'platform_admin' } },
    { status(code) { result.status = code; return this; }, json(data) { result.data = data; } },
    error => { result.error = error; }
  );
  return result;
}

test('deletes a registration-only rejected or suspended school and keeps a platform audit', async () => {
  for (const status of ['rejected', 'suspended']) {
    const result = await remove({ status });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 200);
    assert.equal(result.data.deletedSchoolId, 8);
    assert.ok(calls.some(sql => sql.startsWith('DELETE FROM users')));
    assert.ok(calls.some(sql => sql.startsWith('DELETE FROM schools')));
    assert.ok(calls.some(sql => sql.startsWith('INSERT INTO audit_logs')));
    assert.equal(auditValues[0], null);
    assert.equal(auditValues[1], 4);
    assert.equal(auditValues[2], 'school_deleted');
    assert.equal(auditValues[4], 8);
    assert.equal(calls.at(-1), 'commit');
  }
});

test('rejects missing and ineligible schools without deleting data', async () => {
  assert.equal((await remove({ missing: true })).error.status, 404);
  for (const status of ['pending', 'active']) {
    const result = await remove({ status });
    assert.equal(result.error.status, 409);
    assert.equal(calls.at(-1), 'rollback');
  }
});

test('rejects a malformed school ID before starting a transaction', async () => {
  state = {};
  calls = [];
  let error;
  await deletePlatformSchool({ params: { schoolId: '8x' }, user: { id: 4, role: 'platform_admin' } }, {}, result => { error = result; });
  assert.equal(error.status, 400);
  assert.deepEqual(calls, []);
});

test('blocks extra accounts, school records, and queued email', async () => {
  const cases = [
    { users: [{ id: 17, role: 'school_admin' }, { id: 18, role: 'student' }] },
    { years: 2 },
    { activityTable: 'sections' },
    { emailQueued: true }
  ];
  for (const options of cases) {
    const result = await remove(options);
    assert.equal(result.error.status, 409);
    assert.ok(!calls.some(sql => sql.startsWith('DELETE FROM schools')));
    assert.equal(calls.at(-1), 'rollback');
  }
});

test('rolls back a foreign-key failure and returns a protected-record conflict', async () => {
  const result = await remove({ failOn: 'DELETE FROM academic_terms' });
  assert.equal(result.error.status, 409);
  assert.equal(calls.at(-1), 'rollback');
  assert.ok(!calls.some(sql => sql.startsWith('DELETE FROM schools')));
});

test('platform-only route and review modal expose a separate permanent-delete confirmation', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/schools.js'), 'utf8');
  const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../views/platform/edugnay-platform-school-accounts.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/platform/school-accounts.css'), 'utf8');
  assert.match(route, /router\.delete\('\/platform\/schools\/:schoolId', requireAuth, requirePlatformAdmin, controller\.deletePlatformSchool\)/);
  assert.match(shell, /deletePlatformSchool: deleteApiPlatformSchool/);
  assert.match(page, /status === SCHOOL_STATUS_VALUES\.REJECTED \|\| status === SCHOOL_STATUS_VALUES\.SUSPENDED/);
  assert.match(page, /id="schoolDeleteConfirmModal"/);
  assert.match(page, /class="modal-context school-delete-context"/);
  assert.match(styles, /#schoolDeleteConfirmModal \.school-delete-context\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /#schoolDeleteConfirmModal \.school-delete-context \.ctx-icon\s*\{[^}]*background:\s*var\(--red-pale\)/s);
  assert.match(styles, /#schoolDeleteConfirmModal \.school-delete-context \.ctx-val\s*\{[^}]*color:\s*var\(--gray-800\)/s);
  assert.match(styles, /#schoolDeleteConfirmModal \.confirm-remove-message\s*\{[^}]*margin-top:\s*14px/s);
  assert.match(page, /await window\.EDUGNAY_API\.deletePlatformSchool\(schoolId\)/);
  assert.match(page, /This action cannot be undone\./);
  new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
