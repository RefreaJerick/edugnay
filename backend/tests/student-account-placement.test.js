const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcrypt');
const databaseModule = require('../config/database');
const emailModule = require('../config/email');
const qrModule = require('../config/qrCredentials');
const auditModule = require('../utils/auditLog');

const state = { sectionGradeCode: 'grade-2', queries: [], emails: [], nextUserId: 70 };
const student = {
  id: 70, schoolId: 5, role: 'student', schoolEmail: 'new.student@school.example',
  personalEmail: 'new.student@example.com', accountStatus: 'active', honorific: null,
  firstName: 'New', lastName: 'Student', displayName: 'New Student', initials: 'NS',
  avatarFilename: null, avatarVersion: null, setupCompletedAt: null, lastLoginAt: null,
  createdAt: '2026-11-03T00:00:00.000Z', lrn: '123456789012'
};

function sectionRow() {
  return {
    id: 101, schoolId: 5, name: 'Section A', capacity: 30, sectionStatus: 'active',
    academicYearLabel: '2026-2027', academicYearStatus: 'active', schoolLevelCode: 'elementary',
    levelEnabled: 1, gradeCode: state.sectionGradeCode, gradeLevelName: 'Grade 2', gradeEnabled: 1,
    shsCurriculumCode: null, strandId: null, trackCode: null
  };
}

function handleQuery(sql, values = []) {
  state.queries.push({ sql, values });
  if (sql.includes('SELECT school_email_domain AS schoolEmailDomain FROM schools')) {
    return [[{ schoolEmailDomain: 'school.example' }]];
  }
  if (sql.startsWith('SELECT id, school_email_domain AS schoolEmailDomain FROM schools')) {
    return [[{ id: 5, schoolEmailDomain: 'school.example' }]];
  }
  if (sql.startsWith('SELECT school_email AS schoolEmail FROM users')) return [[]];
  if (sql.includes('SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE')) {
    return [[{ id: values[0] }]];
  }
  if (sql.includes('FROM sections') && sql.includes('gradeLevelName')) return [[sectionRow()]];
  if (sql.includes('SELECT COUNT(*) AS studentCount FROM section_students')) return [[{ studentCount: 0 }]];
  if (sql.includes('SELECT id FROM users WHERE school_email')) return [[]];
  if (sql.startsWith('INSERT INTO users')) return [{ insertId: state.nextUserId++ }];
  if (sql.includes('users.id,') && sql.includes('FROM users')) return [[{ ...student, id: state.nextUserId - 1 }]];
  if (sql.startsWith('SELECT personal_email AS personalEmail FROM users')) return [[]];
  if (sql.includes('SELECT student_profiles.lrn FROM student_profiles')) return [[]];
  if (sql.startsWith('SELECT school_email AS schoolEmail FROM users')) return [[]];
  return [{ affectedRows: 1 }];
}

const connection = {
  async beginTransaction() { state.queries.push({ event: 'begin' }); },
  async commit() { state.queries.push({ event: 'commit' }); },
  async rollback() { state.queries.push({ event: 'rollback' }); },
  release() {},
  execute: handleQuery
};
const database = { execute: handleQuery, getConnection: async () => connection, end: async () => {} };
databaseModule.getDatabase = () => database;
emailModule.sendAccountCreatedEmail = async (user, password) => {
  state.emails.push({ user, password });
  return { status: 'sent' };
};
qrModule.issueStudentQrCredential = async (db, schoolId, studentId) => {
  await db.execute('INSERT INTO student_qr_credentials (school_id, student_user_id) VALUES (?, ?)', [schoolId, studentId]);
};
auditModule.writeAuditLog = async () => {};

const { createUser } = require('../controllers/usersController');
const { importUsers } = require('../controllers/userImportController');

function reset(gradeCode = 'grade-2') {
  state.sectionGradeCode = gradeCode;
  state.queries.length = 0;
  state.emails.length = 0;
  state.nextUserId = 70;
}

async function invoke(handler, req) {
  const result = { status: null, body: null, error: null };
  await handler(req, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('student account can be created without a section', async () => {
  for (const sectionId of [undefined, '']) {
    reset();
    const body = { role: 'student', firstName: 'New', lastName: 'Student',
      personalEmail: 'new.student@example.com', lrn: '123456789012' };
    if (sectionId !== undefined) body.sectionId = sectionId;
    const result = await invoke(createUser, {
      user: { role: 'school_admin', schoolId: 5 }, body
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 201);
    assert.equal(state.queries.some(query => query.sql?.startsWith('INSERT INTO section_students')), false);
    assert.ok(state.queries.some(query => query.event === 'commit'));
  }
});

test('individual and imported accounts email a usable, easy-to-type password', async () => {
  reset();
  const created = await invoke(createUser, {
    user: { role: 'school_admin', schoolId: 5 },
    body: { role: 'student', firstName: 'New', lastName: 'Student',
      personalEmail: 'new.student@example.com', lrn: '123456789012' }
  });
  assert.equal(created.error, null);
  assert.equal(created.status, 201);

  const csv = Buffer.from('firstName,lastName,personalEmail,lrn\nOther,Learner,other.learner@example.com,123456789013\n');
  const imported = await invoke(importUsers, {
    user: { role: 'school_admin', schoolId: 5 }, body: { role: 'student' }, file: { buffer: csv }
  });
  assert.equal(imported.error, null);
  assert.equal(imported.status, 201);

  const inserts = state.queries.filter(query => query.sql?.startsWith('INSERT INTO users'));
  assert.equal(state.emails.length, 2);
  assert.equal(inserts.length, 2);
  for (const [index, email] of state.emails.entries()) {
    assert.match(email.password, /^[abcdefghjkmnpqrstuvwxyz]{4}(?:-[abcdefghjkmnpqrstuvwxyz]{4}){2}$/);
    assert.equal(email.password.length, 14);
    assert.equal(email.user.personalEmail, index === 0
      ? 'new.student@example.com' : 'other.learner@example.com');
    assert.equal(await bcrypt.compare(email.password, inserts[index].values[4]), true);
  }
  assert.notEqual(state.emails[0].password, state.emails[1].password);
});

test('an administrator-supplied temporary password stays unchanged', async () => {
  reset();
  const password = 'a-long-test-password';
  const result = await invoke(createUser, {
    user: { role: 'school_admin', schoolId: 5 },
    body: { role: 'student', firstName: 'New', lastName: 'Student',
      personalEmail: 'new.student@example.com', lrn: '123456789012', temporaryPassword: password }
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(state.emails[0].password, password);
});

test('student account creation rejects invalid or old Kindergarten and Grade 1 section IDs', async () => {
  for (const gradeCode of ['kindergarten', 'grade-1']) {
    reset(gradeCode);
    const rejected = await invoke(createUser, {
      user: { role: 'school_admin', schoolId: 5 },
      body: { role: 'student', firstName: 'New', lastName: 'Student', personalEmail: 'new.student@example.com',
        lrn: '123456789012', sectionId: '101' }
    });
    assert.equal(rejected.error?.status, 400, gradeCode);
    assert.equal(state.queries.some(query => query.sql?.startsWith('INSERT INTO users')), false, gradeCode);
    assert.deepEqual(state.queries.filter(query => query.event).map(query => query.event), ['begin', 'rollback'], gradeCode);
  }

  reset();
  const invalid = await invoke(createUser, {
    user: { role: 'school_admin', schoolId: 5 },
    body: { role: 'student', firstName: 'New', lastName: 'Student', personalEmail: 'new.student@example.com',
      lrn: '123456789012', sectionId: 'not-a-section' }
  });
  assert.equal(invalid.error?.status, 400);
  assert.equal(state.queries.some(query => query.event === 'begin'), false);
});

test('student account and Grade 2 enrollment are written in the same transaction', async () => {
  reset('grade-2');
  const result = await invoke(createUser, {
    user: { role: 'school_admin', schoolId: 5 },
    body: { role: 'student', firstName: 'New', lastName: 'Student', personalEmail: 'new.student@example.com',
      lrn: '123456789012', sectionId: '101', temporaryPassword: 'a-long-test-password' }
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  const eventNames = state.queries.map(query => query.event || query.sql.split(' ')[0]);
  assert.ok(eventNames.indexOf('INSERT') < eventNames.lastIndexOf('INSERT'));
  const enrollment = state.queries.find(query => query.sql?.startsWith('INSERT INTO section_students'));
  assert.deepEqual(enrollment.values, [5, 101, 70]);
  assert.ok(state.queries.findIndex(query => query.sql?.startsWith('INSERT INTO section_students'))
    < state.queries.findIndex(query => query.event === 'commit'));
});

test('student CSV import creates unassigned accounts from four columns transactionally', async () => {
  reset('grade-2');
  const csv = Buffer.from('firstName,lastName,personalEmail,lrn\nNew,Student,new.student@example.com,123456789012\nUnassigned,Learner,unassigned@example.com,123456789013\n');
  const result = await invoke(importUsers, {
    user: { role: 'school_admin', schoolId: 5 }, body: { role: 'student' }, file: { buffer: csv }
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(result.body.summary.accountsCreated, 2);
  assert.equal(state.queries.some(query => query.sql?.startsWith('INSERT INTO section_students')), false);
  assert.ok(state.queries.some(query => query.event === 'commit'));
});

test('student CSV import rejects sectionId as an unexpected column', async () => {
  reset('grade-2');
  const csv = Buffer.from('firstName,lastName,personalEmail,lrn,sectionId\nNew,Student,new.student@example.com,123456789012,101\n');
  const result = await invoke(importUsers, {
    user: { role: 'school_admin', schoolId: 5 }, body: { role: 'student' }, file: { buffer: csv }
  });
  assert.equal(result.error?.status, 400);
  assert.match(result.error?.message || '', /Unexpected column: sectionId/);
  assert.equal(state.queries.some(query => query.sql?.startsWith('INSERT INTO users')), false);
});
