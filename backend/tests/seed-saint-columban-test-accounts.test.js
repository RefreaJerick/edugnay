'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONFIRMATION_PHRASE,
  TEST_ACCOUNTS,
  assertStaticAccountList,
  makeSchoolEmail,
  parseArgs,
  run,
  validatePassword
} = require('../scripts/seedSaintColumbanTestAccounts');

function createFakeDatabase(options = {}) {
  const state = {
    schools: options.schools || [{
      id: 42,
      name: "Saint Columban's College",
      schoolEmailDomain: 'stcolumban.academix.test',
      registrationStatus: 'active'
    }],
    existingUsers: options.existingUsers || [],
    existingLrns: options.existingLrns || [],
    existingEmployeeNumbers: options.existingEmployeeNumbers || [],
    calls: [],
    insertedUsers: [],
    insertedStudents: [],
    insertedTeachers: [],
    insertedQrCredentials: [],
    nextId: 500,
    foreignKeyChecks: 1,
    transactionStarted: false,
    committed: false,
    rolledBack: false,
    released: false
  };

  const connection = {
    async query(sql) {
      state.calls.push({ method: 'query', sql });
      if (sql.startsWith('SET SESSION FOREIGN_KEY_CHECKS')) return [[], []];
      if (sql.includes('@@FOREIGN_KEY_CHECKS')) return [[{ enabled: state.foreignKeyChecks }], []];
      if (sql.includes('FROM users')) return [state.existingUsers, []];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, values = []) {
      state.calls.push({ method: 'execute', sql, values });
      if (sql.includes('FROM schools WHERE name = ?')) return [state.schools, []];
      if (sql.includes('FROM student_profiles WHERE lrn IN')) return [state.existingLrns, []];
      if (sql.includes('employee_number AS employeeNo')) return [state.existingEmployeeNumbers, []];
      if (sql.startsWith('INSERT INTO users')) {
        const account = {
          id: state.nextId++, schoolId: values[0], role: values[1], schoolEmail: values[2],
          personalEmail: values[3], passwordHash: values[4], firstName: values[5], lastName: values[6]
        };
        state.insertedUsers.push(account);
        return [{ insertId: account.id }, []];
      }
      if (sql.startsWith('INSERT INTO student_profiles')) {
        state.insertedStudents.push({ userId: values[0], lrn: values[1] });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('INSERT INTO teacher_profiles')) {
        state.insertedTeachers.push({ userId: values[0], employeeNo: values[1] });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SELECT COUNT(*) AS rowCount FROM users')) return [[{ rowCount: state.insertedUsers.length }], []];
      if (sql.includes('SELECT COUNT(*) AS rowCount FROM student_profiles')) return [[{ rowCount: state.insertedStudents.length }], []];
      if (sql.includes('SELECT COUNT(*) AS rowCount FROM student_qr_credentials')) return [[{ rowCount: state.insertedQrCredentials.length }], []];
      if (sql.includes('SELECT COUNT(*) AS rowCount FROM teacher_profiles')) return [[{ rowCount: state.insertedTeachers.length }], []];
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async beginTransaction() {
      state.calls.push({ method: 'beginTransaction' });
      state.transactionStarted = true;
    },
    async commit() {
      state.calls.push({ method: 'commit' });
      state.committed = true;
      state.transactionStarted = false;
    },
    async rollback() {
      state.calls.push({ method: 'rollback' });
      state.rolledBack = true;
      state.transactionStarted = false;
    },
    release() {
      state.released = true;
    }
  };

  return {
    state,
    database: { async getConnection() { return connection; } },
    issueQr: async (_connection, schoolId, studentId) => {
      state.insertedQrCredentials.push({ schoolId, studentId });
      return { token: 'not-printed', payload: 'not-printed' };
    }
  };
}

const dbEnv = {
  DB_NAME: 'academix',
  STC_TEST_PASSWORD: 'stcolumban2026',
  QR_ENCRYPTION_KEY: 'test-key'
};

test('fixed account list contains 10 students and 5 distinct Filipino teacher/student names', () => {
  assertStaticAccountList();
  assert.equal(TEST_ACCOUNTS.length, 15);
  assert.equal(new Set(TEST_ACCOUNTS.map(account => account.displayName.toLowerCase())).size, 15);
  assert.equal(TEST_ACCOUNTS.filter(account => account.role === 'student').length, 10);
  assert.equal(TEST_ACCOUNTS.filter(account => account.role === 'teacher').length, 5);
  assert.ok(TEST_ACCOUNTS.filter(account => account.role === 'student').every(account => /^\d{12}$/.test(account.lrn)));
});

test('preview resolves one active target school and creates no records', async () => {
  const fake = createFakeDatabase();
  const output = [];
  const result = await run({ apply: false }, {
    database: fake.database,
    dbEnv,
    issueStudentQrCredential: fake.issueQr,
    log: value => output.push(value)
  });

  assert.equal(result.preview.school.id, 42);
  assert.equal(result.preview.totalAccounts, 15);
  assert.deepEqual(result.preview.recordsToCreate, {
    users: 15, student_profiles: 10, student_qr_credentials: 10, teacher_profiles: 5
  });
  assert.deepEqual(fake.state.insertedUsers, []);
  assert.deepEqual(fake.state.insertedStudents, []);
  assert.deepEqual(fake.state.insertedTeachers, []);
  assert.equal(fake.state.calls.some(call => call.method === 'beginTransaction'), false);
  assert.equal(output[0].accounts.some(account => 'password' in account), false);
  assert.equal(fake.state.released, true);
});

test('apply creates exactly the scoped accounts and profiles in one transaction', async () => {
  const fake = createFakeDatabase();
  const hashes = [];
  const output = [];
  const result = await run({ apply: true }, {
    database: fake.database,
    dbEnv,
    hashPassword: async password => { hashes.push(password); return `hash:${password}`; },
    issueStudentQrCredential: fake.issueQr,
    confirm: async phrase => phrase === CONFIRMATION_PHRASE,
    log: value => output.push(value)
  });

  assert.equal(result.mode, 'complete');
  assert.equal(result.totalCreated, 15);
  assert.equal(result.verified, true);
  assert.equal(result.foreignKeyChecks, 1);
  assert.equal(fake.state.insertedUsers.length, 15);
  assert.equal(fake.state.insertedStudents.length, 10);
  assert.equal(fake.state.insertedQrCredentials.length, 10);
  assert.equal(fake.state.insertedTeachers.length, 5);
  assert.deepEqual(hashes, ['stcolumban2026']);
  assert.ok(fake.state.insertedUsers.every(user => user.passwordHash === 'hash:stcolumban2026'));
  assert.equal(fake.state.committed, true);
  assert.equal(fake.state.rolledBack, false);
  assert.equal(JSON.stringify(output).includes('stcolumban2026'), false);
});

test('apply does not write when confirmation is wrong', async () => {
  const fake = createFakeDatabase();
  await assert.rejects(() => run({ apply: true }, {
    database: fake.database,
    dbEnv,
    issueStudentQrCredential: fake.issueQr,
    confirm: async () => false,
    log() {}
  }), /Confirmation did not match/);
  assert.equal(fake.state.calls.some(call => call.method === 'beginTransaction'), false);
  assert.equal(fake.state.insertedUsers.length, 0);
});

test('preflight refuses a missing or ambiguous active target school', async () => {
  for (const schools of [[], [
    { id: 42, name: "Saint Columban's College", schoolEmailDomain: 'one.test', registrationStatus: 'active' },
    { id: 43, name: "Saint Columban's College", schoolEmailDomain: 'two.test', registrationStatus: 'active' }
  ]]) {
    const fake = createFakeDatabase({ schools });
    await assert.rejects(() => run({ apply: false }, {
      database: fake.database, dbEnv, issueStudentQrCredential: fake.issueQr, log() {}
    }), /Expected one active school/);
  }
});

test('preflight refuses already-used fake personal emails', async () => {
  const fake = createFakeDatabase({ existingUsers: [{
    schoolEmail: 'someone@stcolumban.academix.test', personalEmail: 'stc-test-student-01@example.test'
  }] });
  await assert.rejects(() => run({ apply: false }, {
    database: fake.database, dbEnv, issueStudentQrCredential: fake.issueQr, log() {}
  }), /Test accounts already exist/);
  assert.equal(fake.state.insertedUsers.length, 0);
});

test('failure during account creation rolls back the transaction', async () => {
  const fake = createFakeDatabase();
  let qrCalls = 0;
  await assert.rejects(() => run({ apply: true }, {
    database: fake.database,
    dbEnv,
    hashPassword: async () => 'hash:test',
    issueStudentQrCredential: async () => {
      qrCalls += 1;
      if (qrCalls === 2) throw new Error('QR issuance failed');
    },
    confirm: async () => true,
    log() {}
  }), /QR issuance failed/);
  assert.equal(fake.state.rolledBack, true);
  assert.equal(fake.state.committed, false);
});

test('school email generation adds a suffix on collisions', () => {
  const used = new Set(['m.santos.stud@stcolumban.academix.test']);
  const email = makeSchoolEmail(TEST_ACCOUNTS[0], 'stcolumban.academix.test', used);
  assert.equal(email, 'm.santos.stud2@stcolumban.academix.test');
});

test('arguments and shared test password are validated', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--preview']), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  assert.throws(() => parseArgs(['--apply', '--preview']), /Choose either/);
  assert.throws(() => validatePassword('short'), /12 to 128 characters/);
  assert.equal(validatePassword('stcolumban2026'), 'stcolumban2026');
});
