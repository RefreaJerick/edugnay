const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');

let storedDomain = 'stcolumban.edu.ph';
let occupiedEmail = '';
let savedEmail = '';
let userRow;
const calls = [];
const connection = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('school_email_domain AS schoolEmailDomain FROM schools')) return [[{ id: 1, schoolEmailDomain: storedDomain }]];
    if (sql.startsWith('SELECT id FROM users WHERE school_email')) return [values[0] === occupiedEmail ? [{ id: 77 }] : []];
    if (sql === 'SELECT school_email AS schoolEmail FROM users') return [occupiedEmail ? [{ schoolEmail: occupiedEmail }] : []];
    if (sql.startsWith('INSERT INTO users')) {
      savedEmail = values[2];
      userRow = { id: 41, schoolId: 1, role: values[1], schoolEmail: savedEmail,
        personalEmail: values[3], accountStatus: 'active', firstName: values[6], lastName: values[7],
        displayName: values[8], initials: values[9] };
      return [{ insertId: 41 }];
    }
    if (sql.startsWith('UPDATE users SET first_name')) {
      userRow = { ...userRow, firstName: values[0], lastName: values[1], personalEmail: values[2],
        displayName: values[4], initials: values[5] };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('users.school_email AS schoolEmail')) return [[userRow]];
    return [[]];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: connection.execute.bind(connection) });
const { createUser, updateUser } = require('../controllers/usersController');
const { importUsers } = require('../controllers/userImportController');

function response() {
  const result = { statusCode: 0, body: null, error: null };
  return { result, res: { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; } },
    next(error) { result.error = error; } };
}

function reset() {
  calls.length = 0;
  occupiedEmail = '';
  savedEmail = '';
  storedDomain = 'stcolumban.edu.ph';
  userRow = { id: 41, schoolId: 1, role: 'teacher', schoolEmail: 'legacy@other.example',
    personalEmail: 'jose@example.com', accountStatus: 'active', firstName: 'José', lastName: 'Dela Cruz',
    displayName: 'José Dela Cruz', initials: 'JD' };
}

test('all roles share the same normalized name and suffix rule', () => {
  const names = [['school_admin', 'adm'], ['teacher', 'fac'], ['student', 'stud'], ['parent', 'par']];
  for (const [role, suffix] of names) {
    assert.equal(schoolEmailBase('José', 'Dela Cruz', role), `j.delacruz.${suffix}`);
  }
  assert.equal(schoolEmailCandidate('j.delacruz.par', 'stcolumban.edu.ph', 2), 'j.delacruz.par2@stcolumban.edu.ph');
  assert.throws(() => storedSchoolDomain({}), { status: 503 });
});

test('manual creation ignores an entered school address and uses the saved domain', async () => {
  reset();
  const { result, res, next } = response();
  await createUser({ user: { id: 2, role: 'school_admin', schoolId: 1 }, body: {
    role: 'teacher', firstName: 'José', lastName: 'Dela Cruz', employeeNo: 'FAC-22',
    personalEmail: 'jose@example.com', schoolEmail: 'wrong@outside.example'
  } }, res, next);
  assert.equal(result.error, null);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.user.schoolEmail, 'j.delacruz.fac@stcolumban.edu.ph');
  assert.equal(result.body.user.personalEmail, 'jose@example.com');
  assert.ok(!calls.some(call => call.values?.includes('wrong@outside.example')));
});

test('manual creation adds a numeric suffix and fails if the school domain is missing', async () => {
  reset();
  occupiedEmail = 'j.delacruz.fac@stcolumban.edu.ph';
  const body = { role: 'teacher', firstName: 'José', lastName: 'Dela Cruz', employeeNo: 'FAC-22', personalEmail: 'jose@example.com' };
  const first = response();
  await createUser({ user: { id: 2, role: 'school_admin', schoolId: 1 }, body }, first.res, first.next);
  assert.equal(first.result.body.user.schoolEmail, 'j.delacruz.fac2@stcolumban.edu.ph');
  reset();
  storedDomain = null;
  const second = response();
  await createUser({ user: { id: 2, role: 'school_admin', schoolId: 1 }, body }, second.res, second.next);
  assert.equal(second.result.error.status, 503);
  assert.equal(calls.filter(call => call.sql?.startsWith('INSERT INTO users')).length, 0);
});

test('manual creation requires a valid personal email before writing an account', async () => {
  for (const personalEmail of [undefined, '', 'not-an-email']) {
    reset();
    const { result, res, next } = response();
    await createUser({ user: { id: 2, role: 'school_admin', schoolId: 1 }, body: {
      role: 'teacher', firstName: 'Jose', lastName: 'Dela Cruz', employeeNo: 'FAC-22', personalEmail
    } }, res, next);
    assert.equal(result.error.status, 400);
    assert.equal(calls.filter(call => call.sql?.startsWith('INSERT INTO users')).length, 0);
  }
});

test('editing names preserves a legacy login; changing the login is rejected', async () => {
  reset();
  const req = { user: { id: 2, role: 'school_admin', schoolId: 1 }, params: { userId: '41' },
    body: { firstName: 'New', schoolEmail: 'legacy@other.example' } };
  const first = response();
  await updateUser(req, first.res, first.next);
  assert.equal(first.result.error, null);
  assert.equal(first.result.body.user.schoolEmail, 'legacy@other.example');
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE users SET first_name') && !call.sql.includes('school_email')));
  reset();
  const second = response();
  await updateUser({ ...req, body: { schoolEmail: 'new@stcolumban.edu.ph' } }, second.res, second.next);
  assert.equal(second.result.error.status, 400);
  assert.equal(calls.filter(call => call.sql?.startsWith('UPDATE users')).length, 0);
});

test('an existing personal email cannot be cleared; a legacy account without one remains editable', async () => {
  reset();
  const req = { user: { id: 2, role: 'school_admin', schoolId: 1 }, params: { userId: '41' } };
  const clearing = response();
  await updateUser({ ...req, body: { personalEmail: '' } }, clearing.res, clearing.next);
  assert.equal(clearing.result.error.status, 400);
  assert.equal(calls.filter(call => call.sql?.startsWith('UPDATE users')).length, 0);

  reset();
  userRow.personalEmail = null;
  const editing = response();
  await updateUser({ ...req, body: { firstName: 'New' } }, editing.res, editing.next);
  assert.equal(editing.result.error, null);
  assert.equal(editing.result.body.user.personalEmail, null);
  assert.equal(editing.result.body.user.schoolEmail, 'legacy@other.example');
});

test('CSV import uses the same address rule and keeps personal email separate', async () => {
  reset();
  const csv = 'firstName,lastName,personalEmail,employeeNo\nJosé,Dela Cruz,jose@example.com,FAC-22\n';
  const { result, res, next } = response();
  await importUsers({ user: { role: 'school_admin', schoolId: 1 }, body: { role: 'teacher' },
    file: { buffer: Buffer.from(csv) } }, res, next);
  assert.equal(result.error, null);
  assert.equal(result.statusCode, 201);
  assert.equal(savedEmail, 'j.delacruz.fac@stcolumban.edu.ph');
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO users') && call.values.includes('jose@example.com')));
});

test('CSV import rejects a missing personal email without creating users', async () => {
  reset();
  const csv = 'firstName,lastName,personalEmail,employeeNo\nJose,Dela Cruz,,FAC-22\n';
  const { result, res, next } = response();
  await importUsers({ user: { role: 'school_admin', schoolId: 1 }, body: { role: 'teacher' },
    file: { buffer: Buffer.from(csv) } }, res, next);
  assert.equal(result.error, null);
  assert.equal(result.statusCode, 422);
  assert.equal(calls.filter(call => call.sql?.startsWith('INSERT INTO users')).length, 0);
});

test('CSV import uses a numeric suffix and refuses a school without a stored domain', async () => {
  reset();
  const csv = 'firstName,lastName,personalEmail,employeeNo\nJose,Dela Cruz,jose@example.com,FAC-22\n';
  occupiedEmail = 'j.delacruz.fac@stcolumban.edu.ph';
  const first = response();
  await importUsers({ user: { role: 'school_admin', schoolId: 1 }, body: { role: 'teacher' },
    file: { buffer: Buffer.from(csv) } }, first.res, first.next);
  assert.equal(first.result.error, null);
  assert.equal(savedEmail, 'j.delacruz.fac2@stcolumban.edu.ph');

  reset();
  storedDomain = null;
  const second = response();
  await importUsers({ user: { role: 'school_admin', schoolId: 1 }, body: { role: 'teacher' },
    file: { buffer: Buffer.from(csv) } }, second.res, second.next);
  assert.equal(second.result.error.status, 503);
  assert.equal(calls.filter(call => call.sql?.startsWith('INSERT INTO users')).length, 0);
});
