const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const databaseModule = require('../config/database');

const queries = [];
let currentStatus = 'rejected';
let databaseConnection;
let decisionEmailValues = null;
const connection = {
  async beginTransaction() { queries.push({ event: 'begin' }); },
  async commit() { queries.push({ event: 'commit' }); },
  async rollback() { queries.push({ event: 'rollback' }); },
  release() {},
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('SELECT schools.id, schools.name, schools.school_email_domain AS schoolEmailDomain')) {
      return [[{
        id: 19, name: 'Old School Name', schoolEmailDomain: 'mnhs.academix.test',
        registrationStatus: currentStatus, rejectionReason: 'Missing documents',
        logoPath: null, currentSchoolYearLabel: '2026-2027'
      }]];
    }
    if (sql.startsWith('SELECT schools.id, schools.name, schools.registration_status AS registrationStatus')) {
      return [[{ id: 19, name: 'Mangaldan National High School', registrationStatus: currentStatus, notificationEmail: 'new-contact@example.com' }]];
    }
    if (sql.startsWith('SELECT id, school_email AS schoolEmail')) {
      return [[{ id: 25, schoolEmail: 'j.reyes.adm@mnhs.academix.test' }]];
    }
    if (sql.startsWith('SELECT id FROM academic_years')) return [[{ id: 40 }]];
    if (sql.startsWith('SELECT id FROM school_levels')) return [[{ id: 30 }]];
    if (sql.startsWith('SELECT id, sequence_number AS sequenceNumber FROM academic_terms')) {
      return [[{ id: 51, sequenceNumber: 1 }, { id: 52, sequenceNumber: 2 }, { id: 53, sequenceNumber: 3 }]];
    }
    if (sql.startsWith('UPDATE schools SET registration_status')) {
      currentStatus = sql.includes("registration_status = 'pending'") ? 'pending' : values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT id, display_name AS displayName') && sql.includes("role = 'platform_admin'")) return [[]];
    if (sql.startsWith('SELECT id, display_name AS displayName')) {
      return [[{ id: 25, displayName: 'Jane Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test', personalEmail: 'new-contact@example.com' }]];
    }
    if (sql.startsWith('INSERT INTO school_registration_email_outbox')) {
      decisionEmailValues = values;
      return [{ affectedRows: 1, insertId: 91 }];
    }
    return [{ affectedRows: 1, insertId: 90 }];
  }
};

databaseConnection = connection;
databaseModule.getDatabase = () => ({ getConnection: async () => databaseConnection });
const emailWorker = require('../workers/schoolRegistrationEmailWorker');
emailWorker.wakeSchoolRegistrationEmailWorker = () => {};
const controller = require('../controllers/schoolsController');

function payload() {
  return {
    name: 'Mangaldan National High School',
    shortName: 'MANGALDAN NATIONAL HIGH SCHOOL',
    depedSchoolId: '123456',
    addressLine: 'New address',
    phone: '09123456789',
    email: 'office@mnhs.example',
    notificationEmail: 'new-contact@example.com',
    website: 'https://mnhs.example',
    currentSchoolYearLabel: '2027-2028',
    schoolYearStartDate: '2027-08-01',
    schoolYearEndDate: '2028-05-31',
    schoolLevels: ['jhs'],
    academicTermConfigs: [{
      schoolLevel: 'jhs', gradingPeriodType: 'three_term',
      academicPeriods: [
        { name: 'Term 1', plannedStartDate: '2027-08-01', plannedEndDate: '2027-10-31' },
        { name: 'Term 2', plannedStartDate: '2027-11-01', plannedEndDate: '2028-02-28' },
        { name: 'Term 3', plannedStartDate: '2028-03-01', plannedEndDate: '2028-05-31' }
      ]
    }],
    initialAdministrator: {
      firstName: 'Jane', lastName: 'Reyes',
      temporaryPassword: 'a-new-long-temporary-password'
    }
  };
}

async function resubmit({ data = payload(), token = 'a'.repeat(64) } = {}) {
  const result = { status: null, headers: {}, data: null, error: null };
  await controller.resubmitSchoolRegistration({
    body: { payload: JSON.stringify({ ...data, registrationStatusToken: token }) }
  }, {
    set(name, value) { result.headers[name] = value; return this; },
    status(code) { result.status = code; return this; },
    json(body) { result.data = body; }
  }, error => { result.error = error; });
  return result;
}

test('rejected application details are token-protected, safe, and never cached', async () => {
  const detailConnection = {
    release() {},
    async execute(sql) {
      if (sql.includes('schools.registration_status AS registrationStatus')) return [[{
        id: 19, name: 'Old School Name', shortName: 'OLD SCHOOL', schoolCode: null,
        depedSchoolId: 'old-id', addressLine: 'Old address', phone: null, email: 'office@old.example',
        website: null, schoolEmailDomain: 'mnhs.academix.test', registrationStatus: 'rejected',
        notificationEmail: 'old-contact@example.com', currentSchoolYearLabel: '2026-2027'
      }]];
      if (sql.startsWith('SELECT first_name AS firstName')) return [[{ firstName: 'Jane', lastName: 'Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test' }]];
      if (sql.startsWith('SELECT level_code AS schoolLevel')) return [[{ schoolLevel: 'jhs', storedPeriodType: 'trimestral' }]];
      if (sql.startsWith('SELECT school_levels.level_code AS schoolLevel')) return [[
        { schoolLevel: 'jhs', name: 'Term 1', sequenceNumber: 1, plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
        { schoolLevel: 'jhs', name: 'Term 2', sequenceNumber: 2, plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
        { schoolLevel: 'jhs', name: 'Term 3', sequenceNumber: 3, plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
      ]];
      if (sql.startsWith('SELECT DATE_FORMAT(start_date')) return [[{ schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31' }]];
      return [[]];
    }
  };
  databaseConnection = detailConnection;
  const result = { headers: {}, data: null, error: null };
  await controller.getRegistrationDetails({ body: { token: 'b'.repeat(64) } }, {
    set(name, value) { result.headers[name] = value; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  assert.equal(result.error, null);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(result.data.application.school, {
    name: 'Old School Name', shortName: 'OLD SCHOOL', schoolCode: null,
    depedSchoolId: 'old-id', addressLine: 'Old address', phone: null,
    email: 'office@old.example', website: null, schoolEmailDomain: 'mnhs.academix.test'
  });
  assert.equal(result.data.application.school.schoolEmailDomain, 'mnhs.academix.test');
  assert.equal(result.data.application.notificationEmail, 'old-contact@example.com');
  assert.deepEqual(result.data.application.initialAdministrator, { firstName: 'Jane', lastName: 'Reyes' });
  assert.equal(result.data.application.academicTermConfigs[0].gradingPeriodType, 'three_term');
  assert.deepEqual(result.data.application.academicTermConfigs[0].academicPeriods, [
    { name: 'Term 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
    { name: 'Term 2', plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
    { name: 'Term 3', plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
  ]);
  assert.deepEqual(result.data.application.schoolLevels, ['jhs']);
  assert.equal(result.data.application.currentSchoolYearLabel, '2026-2027');
  assert.equal(result.data.application.schoolYearStartDate, '2026-08-01');
  assert.equal(result.data.application.schoolYearEndDate, '2027-05-31');
  assert.equal(result.data.application.initialAdministrator.firstName, 'Jane');
  assert.equal(result.data.application.administratorSchoolEmail, 'j.reyes.adm@mnhs.academix.test');
  assert.equal(result.data.application.initialAdministrator.temporaryPassword, undefined);
  assert.equal(result.data.application.registrationStatusToken, undefined);
  assert.equal(result.data.application.id, undefined);
});

test('registration details return a no-store not-found response for missing, expired, or deleted applications', async () => {
  let queryCount = 0;
  databaseConnection = {
    release() {},
    async execute() { queryCount += 1; return [[]]; }
  };
  const result = { headers: {}, error: null };
  await controller.getRegistrationDetails({ body: { token: 'c'.repeat(64) } }, {
    set(name, value) { result.headers[name] = value; return this; },
    json() { assert.fail('A missing registration must not return details.'); }
  }, error => { result.error = error; });

  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.error.status, 404);
  assert.equal(queryCount, 1);
});

test('registration details reject applications that are no longer pending revision', async () => {
  let queryCount = 0;
  databaseConnection = {
    release() {},
    async execute() {
      queryCount += 1;
      return [[{
        id: 19, registrationStatus: 'pending'
      }]];
    }
  };
  const result = { headers: {}, error: null };
  await controller.getRegistrationDetails({ body: { token: 'd'.repeat(64) } }, {
    set(name, value) { result.headers[name] = value; return this; },
    json() { assert.fail('A pending registration must not return revision details.'); }
  }, error => { result.error = error; });

  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.error.status, 409);
  assert.equal(queryCount, 1);
});

test('resubmission updates the existing rejected school and rotates its token without changing identifiers', async () => {
  queries.length = 0;
  currentStatus = 'rejected';
  databaseConnection = connection;
  const result = await resubmit();
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.data.school.id, 19);
  assert.equal(result.data.school.schoolEmailDomain, 'mnhs.academix.test');
  assert.equal(result.data.school.administratorSchoolEmail, 'j.reyes.adm@mnhs.academix.test');
  assert.equal(result.data.school.registrationStatus, 'pending');
  assert.match(result.data.registrationStatusToken, /^[a-f0-9]{64}$/);

  const schoolUpdate = queries.find(item => item.sql?.startsWith('UPDATE schools SET name'));
  assert.deepEqual(schoolUpdate.values.slice(0, 8), [
    'Mangaldan National High School', 'MANGALDAN NATIONAL HIGH SCHOOL', 'jhs',
    '123456', 'New address', '09123456789', 'office@mnhs.example', 'https://mnhs.example'
  ]);
  assert.equal(queries.find(item => item.sql?.startsWith('UPDATE school_settings')).values[0], 'new-contact@example.com');
  const administratorUpdate = queries.find(item => item.sql?.startsWith('UPDATE users SET first_name'));
  assert.match(administratorUpdate.sql, /personal_email = \?, password_hash = \?, account_status = 'pending'/);
  assert.doesNotMatch(administratorUpdate.sql, /school_email\s*=/);
  assert.equal(administratorUpdate.values[4], 'new-contact@example.com');
  const audit = queries.find(item => item.sql?.startsWith('INSERT INTO audit_logs'));
  assert.deepEqual(JSON.parse(audit.values[2]).previousRejectionReason, 'Missing documents');
  const tokenUpdate = queries.find(item => item.sql?.startsWith('UPDATE schools SET registration_status'));
  assert.equal(tokenUpdate.values[0], crypto.createHash('sha256').update(result.data.registrationStatusToken).digest('hex'));
  assert.ok(!queries.some(item => item.values?.includes(result.data.registrationStatusToken)));
  assert.equal(queries.at(-1).event, 'commit');
});

test('invalid tokens and applications that are no longer rejected cannot be resubmitted', async () => {
  queries.length = 0;
  const invalid = await resubmit({ token: 'invalid' });
  assert.equal(invalid.error.status, 404);
  assert.equal(queries.length, 0);

  currentStatus = 'active';
  databaseConnection = connection;
  const active = await resubmit();
  assert.equal(active.error.status, 409);
  assert.ok(queries.some(item => item.event === 'rollback'));
});

test('rejected application can be resubmitted and later approved on the same account', async () => {
  currentStatus = 'rejected';
  databaseConnection = connection;
  queries.length = 0;
  decisionEmailValues = null;
  const resubmitted = await resubmit();
  assert.equal(resubmitted.error, null);
  assert.equal(currentStatus, 'pending');

  const approval = { data: null, error: null };
  await controller.reviewSchool({
    params: { schoolId: '19', action: 'approve' },
    body: {},
    user: { id: 4, role: 'platform_admin', schoolId: null }
  }, {
    status() { return this; },
    json(data) { approval.data = data; }
  }, error => { approval.error = error; });

  assert.equal(approval.error, null);
  assert.equal(approval.data.school.id, 19);
  assert.equal(approval.data.school.registrationStatus, 'active');
  assert.match(resubmitted.data.school.administratorSchoolEmail, /j\.reyes\.adm@mnhs\.academix\.test/);
  assert.equal(decisionEmailValues[1], 'approved');
  assert.equal(decisionEmailValues[2], 'new-contact@example.com');
  assert.notEqual(decisionEmailValues[2], decisionEmailValues[5]);
  assert.ok(queries.some(item => item.sql?.startsWith('UPDATE users SET account_status') && item.values[0] === 'active'));
});
