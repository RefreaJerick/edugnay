const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const databaseModule = require('../config/database');

const queries = [];
let occupiedDomain = '';
let occupiedUserEmail = '';
let statusLookupRecord = null;
let lastRegistrationTokenHash = null;
let failAttendanceCodeSeed = false;
const connection = {
  async beginTransaction() { queries.push('begin'); },
  async commit() { queries.push('commit'); },
  async rollback() { queries.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO schools')) {
      if (occupiedDomain && values.includes(occupiedDomain)) {
        const error = new Error('Duplicate school domain');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      lastRegistrationTokenHash = values.find(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) || null;
      return [{ insertId: 20 }];
    }
    if (sql.startsWith('INSERT INTO attendance_status_codes')) {
      if (failAttendanceCodeSeed) throw new Error('Attendance code seed failed');
      return [{ affectedRows: 4 }];
    }
    if (sql.startsWith('SELECT schools.name AS schoolName')) {
      return [[statusLookupRecord && values[0] === lastRegistrationTokenHash ? statusLookupRecord : undefined].filter(Boolean)];
    }
    if (sql.startsWith('SELECT id FROM schools WHERE school_email_domain')) return [[{ id: 10 }]];
    if (sql.startsWith('SELECT id FROM users WHERE school_email')) return [[values[0] === occupiedUserEmail ? { id: 11 } : undefined].filter(Boolean)];
    if (sql.startsWith('INSERT INTO school_levels')) return [{ insertId: 30 }];
    if (sql.startsWith('INSERT INTO academic_years')) return [{ insertId: 40 }];
    if (sql.startsWith('INSERT INTO users')) return [{ insertId: 50 }];
    if (sql.includes("role = 'platform_admin'")) return [[]];
    return [[]];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { getRegistrationStatus, registerSchool } = require('../controllers/schoolsController');

function registration() {
  return {
    name: 'Sample School', email: 'school@example.com', notificationEmail: 'notify@example.com',
    schoolLevels: ['jhs'], currentSchoolYearLabel: '2026-2027',
    schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31',
    academicTermConfigs: [{
      schoolLevel: 'jhs', gradingPeriodType: 'three_term', academicPeriods: [
        { name: 'Term 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
        { name: 'Term 2', plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
        { name: 'Term 3', plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
      ]
    }],
    initialAdministrator: {
      firstName: 'School', lastName: 'Admin',
      temporaryPassword: 'a-long-test-password'
    }
  };
}

async function call(body) {
  const result = { code: null, data: null, error: null };
  await registerSchool({ body }, {
    status(code) { result.code = code; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('SHS registration seeds Academic and TechPro without strands', async () => {
  queries.length = 0;
  const body = registration();
  body.schoolLevels = ['shs'];
  body.academicTermConfigs[0].schoolLevel = 'shs';
  const result = await call(body);
  assert.equal(result.error, null);
  const tracks = queries.filter(query => query.sql?.startsWith('INSERT INTO school_shs_tracks'));
  assert.deepEqual(tracks.map(query => query.values[2]), ['academic', 'techpro']);
  assert.ok(!queries.some(query => query.sql?.includes('INSERT INTO school_shs_strands')));
});

test('registration saves the school, academic periods, and pending administrator together', async () => {
  queries.length = 0;
  const result = await call(registration());
  assert.equal(result.error, null);
  assert.equal(result.code, 201);
  assert.equal(result.data.school.id, 20);
  assert.equal(result.data.school.schoolEmailDomain, 'ss.academix.test');
  assert.equal(result.data.school.administratorSchoolEmail, 's.admin.adm@ss.academix.test');
  assert.match(result.data.registrationStatusToken, /^[a-f0-9]{64}$/);
  const schoolInsert = queries.find(item => item.sql?.startsWith('INSERT INTO schools'));
  assert.ok(schoolInsert.values.includes(crypto.createHash('sha256').update(result.data.registrationStatusToken).digest('hex')));
  assert.ok(!schoolInsert.values.includes(result.data.registrationStatusToken));
  assert.match(schoolInsert.sql, /registration_status_token_expires_at/);
  assert.match(schoolInsert.sql, /INTERVAL 90 DAY/);
  assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO schools') && item.values.includes('ss.academix.test')));
  const attendanceCodeInsert = queries.find(item => item.sql?.startsWith('INSERT INTO attendance_status_codes'));
  assert.ok(attendanceCodeInsert);
  assert.match(attendanceCodeInsert.sql, /VALUES \(\?, \?, \?, \?, \?, \?, TRUE\), \(\?, \?, \?, \?, \?, \?, TRUE\), \(\?, \?, \?, \?, \?, \?, TRUE\), \(\?, \?, \?, \?, \?, \?, TRUE\)/);
  assert.deepEqual(attendanceCodeInsert.values, [
    20, 'present', 'Present', 'Student attended class.', 'P', 'present',
    20, 'absent', 'Absent', 'Student did not attend class.', 'A', 'absent',
    20, 'late', 'Late', 'Student arrived after attendance was taken.', 'L', 'late',
    20, 'excused', 'Excused', 'Student absence has a recorded excuse.', 'E', 'excused'
  ]);
  assert.equal(queries.filter(item => item.sql?.startsWith('INSERT INTO academic_terms')).length, 3);
  assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO academic_years')));
  assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO users') && item.values.includes('s.admin.adm@ss.academix.test') && item.values.includes('notify@example.com')));
  assert.equal(queries.at(-1), 'commit');
});

test('registration rolls back when seeding fixed attendance codes fails', async () => {
  queries.length = 0;
  failAttendanceCodeSeed = true;
  try {
    const result = await call(registration());
    assert.ok(result.error);
    assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO attendance_status_codes')));
    assert.equal(queries.at(-1), 'rollback');
    assert.ok(!queries.includes('commit'));
  } finally {
    failAttendanceCodeSeed = false;
  }
});

test('registration domain comes from the school name, not its contact address', async () => {
  queries.length = 0;
  const body = registration();
  body.name = 'Mangaldan National Highschool';
  body.email = 'contact@personal.example';
  const result = await call(body);
  assert.equal(result.error, null);
  assert.equal(result.data.school.schoolEmailDomain, 'mnhs.academix.test');
  assert.equal(result.data.school.administratorSchoolEmail, 's.admin.adm@mnhs.academix.test');
});

test('registration gives a new school a distinct stable domain when an acronym is taken', async () => {
  queries.length = 0;
  occupiedDomain = 'ss.academix.test';
  try {
    const result = await call(registration());
    assert.equal(result.error, null);
    assert.match(result.data.school.schoolEmailDomain, /^ss-[a-f0-9]{6}\.academix\.test$/);
    assert.equal(result.data.school.administratorSchoolEmail, `s.admin.adm@${result.data.school.schoolEmailDomain}`);
    assert.equal(queries.filter(item => item.sql?.startsWith('INSERT INTO schools')).length, 2);
    assert.equal(queries.at(-1), 'commit');
  } finally {
    occupiedDomain = '';
  }
});

test('registration adds a numeric suffix when the administrator login is taken', async () => {
  queries.length = 0;
  occupiedUserEmail = 's.admin.adm@ss.academix.test';
  try {
    const result = await call(registration());
    assert.equal(result.error, null);
    assert.equal(result.data.school.administratorSchoolEmail, 's.admin.adm2@ss.academix.test');
    assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO users') && item.values.includes(result.data.school.administratorSchoolEmail)));
  } finally {
    occupiedUserEmail = '';
  }
});

test('registration ignores a legacy manually supplied administrator address', async () => {
  queries.length = 0;
  const body = registration();
  body.initialAdministrator.schoolEmail = 'someone@unrelated.example';
  const result = await call(body);
  assert.equal(result.error, null);
  assert.equal(result.data.school.administratorSchoolEmail, 's.admin.adm@ss.academix.test');
  assert.ok(!queries.some(item => item.values?.includes('someone@unrelated.example')));
});

test('registration rejects an incomplete period structure before writing', async () => {
  queries.length = 0;
  const body = registration();
  body.academicTermConfigs[0].academicPeriods.pop();
  const result = await call(body);
  assert.equal(result.error.status, 400);
  assert.equal(queries.length, 0);
});

async function callRegistrationStatus(token) {
  const result = { headers: {}, data: null, error: null };
  await getRegistrationStatus({ body: { token } }, {
    set(name, value) { result.headers[name] = value; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('registration status returns only the safe current status fields and never caches the response', async () => {
  const token = 'a'.repeat(64);
  lastRegistrationTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  statusLookupRecord = {
    schoolName: 'Mangaldan National High School', registrationStatus: 'active',
    administratorSchoolEmail: 'j.reyes.adm@mnhs.academix.test', notificationEmail: 'jane@example.com',
    submittedAt: new Date('2026-10-01T00:00:00Z'), approvedAt: new Date('2026-10-02T00:00:00Z'), rejectedAt: null
  };
  queries.length = 0;
  try {
    const result = await callRegistrationStatus(token);
    assert.equal(result.error, null);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.deepEqual(Object.keys(result.data.registration).sort(), [
      'administratorSchoolEmail', 'approvedAt', 'notificationEmailMasked', 'registrationStatus', 'rejectedAt', 'schoolName', 'submittedAt'
    ].sort());
    assert.equal(result.data.registration.schoolName, 'Mangaldan National High School');
    assert.equal(result.data.registration.registrationStatus, 'active');
    assert.equal(result.data.registration.notificationEmailMasked, 'ja***@example.com');
    assert.equal(result.data.registration.administratorSchoolEmail, 'j.reyes.adm@mnhs.academix.test');
    assert.equal(result.data.registration.notificationEmail, undefined);
    assert.match(queries.find(item => item.sql?.startsWith('SELECT schools.name AS schoolName')).sql, /registration_status_token_expires_at > NOW\(\)/);
    assert.equal(queries.at(-1).values[0], lastRegistrationTokenHash);
  } finally {
    statusLookupRecord = null;
  }
});

test('registration status lookup reflects pending and rejected decisions from the database', async () => {
  const token = 'c'.repeat(64);
  lastRegistrationTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    for (const registrationStatus of ['pending', 'rejected']) {
      statusLookupRecord = {
        schoolName: 'Sample School', registrationStatus,
        administratorSchoolEmail: 's.admin.adm@ss.academix.test', notificationEmail: 'notify@example.com',
        submittedAt: null, approvedAt: null, rejectedAt: null
      };
      const result = await callRegistrationStatus(token);
      assert.equal(result.error, null);
      assert.equal(result.data.registration.registrationStatus, registrationStatus);
    }
  } finally {
    statusLookupRecord = null;
  }
});

test('invalid and expired registration status tokens return the same not-found response', async () => {
  queries.length = 0;
  const invalid = await callRegistrationStatus('not-a-token');
  assert.equal(invalid.error.status, 404);
  assert.equal(invalid.error.message, 'Registration status could not be found.');
  assert.equal(invalid.headers['Cache-Control'], 'no-store');
  assert.equal(queries.length, 0);

  lastRegistrationTokenHash = crypto.createHash('sha256').update('b'.repeat(64)).digest('hex');
  statusLookupRecord = null;
  const expired = await callRegistrationStatus('b'.repeat(64));
  assert.equal(expired.error.status, 404);
  assert.equal(expired.error.message, invalid.error.message);
  statusLookupRecord = null;
});

test('registration status migration only adds nullable lookup fields and preserves existing rows', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/030_add_registration_status_lookup.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN registration_status_token_hash CHAR\(64\) NULL/);
  assert.match(migration, /ADD COLUMN registration_status_token_expires_at DATETIME NULL/);
  assert.match(migration, /ADD UNIQUE KEY uq_schools_registration_status_token_hash/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  assert.match(schema, /registration_status_token_hash CHAR\(64\) NULL/);
  assert.match(schema, /registration_status_token_expires_at DATETIME NULL/);
});
