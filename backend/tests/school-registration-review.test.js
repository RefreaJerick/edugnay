const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let schoolUpdateValues;
let emailOutboxValues = [];
let schoolStatus = 'pending';
let notificationEmail = 'notify@example.com';
let retryJobStatus = 'failed';
const events = [];
const connection = {
  async beginTransaction() { events.push('begin'); },
  async commit() { events.push('commit'); },
  async rollback() { events.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    if (sql.startsWith('SELECT schools.id, schools.name, schools.registration_status')) {
      return [[{ id: 19, name: 'Sample School', registrationStatus: schoolStatus, notificationEmail }]];
    }
    if (sql.startsWith('UPDATE schools SET registration_status')) {
      schoolUpdateValues = values;
      schoolStatus = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT id, display_name AS displayName')) {
      return [[{ id: 25, displayName: 'School Admin', schoolEmail: 's.admin.adm@sample.academix.test', personalEmail: 'notify@example.com' }]];
    }
    if (sql.startsWith('INSERT INTO school_registration_email_outbox')) {
      emailOutboxValues.push(values);
      events.push('email');
    }
    if (sql.startsWith('SELECT id, status FROM school_registration_email_outbox')) {
      return retryJobStatus ? [[{ id: 80, status: retryJobStatus }]] : [[]];
    }
    if (sql.startsWith('UPDATE school_registration_email_outbox SET status')) events.push('retry');
    return [{ affectedRows: 1 }];
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const registrationEmailWorker = require('../workers/schoolRegistrationEmailWorker');
registrationEmailWorker.wakeSchoolRegistrationEmailWorker = () => {};
const { reviewSchool: controllerReviewSchool } = require('../controllers/schoolsController');
const { retrySchoolRegistrationEmail } = require('../controllers/schoolsController');

async function reviewSchool(action, reason, resetStatus = true) {
  if (resetStatus) schoolStatus = 'pending';
  schoolUpdateValues = null;
  if (resetStatus) events.length = 0;
  const result = { status: null, data: null, error: null };
  await controllerReviewSchool({
    params: { schoolId: '19', action },
    body: reason === undefined ? {} : { reason },
    user: { id: 4, role: 'platform_admin' }
  }, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('school rejection accepts a missing or whitespace-only reason and stores NULL', async () => {
  emailOutboxValues = [];
  for (const reason of [undefined, '   \t\n']) {
    const result = await reviewSchool('reject', reason);
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.equal(schoolUpdateValues[0], 'rejected');
    assert.equal(schoolUpdateValues[1], null);
    assert.equal(schoolUpdateValues[2], 19);
    assert.equal(result.data.school.rejectionReason, null);
    assert.equal(result.data.emailDelivery.status, 'pending');
    assert.equal(emailOutboxValues.at(-1)[1], 'rejected');
    assert.equal(emailOutboxValues.at(-1)[2], 'notify@example.com');
    assert.notEqual(emailOutboxValues.at(-1)[2], emailOutboxValues.at(-1)[5]);
    assert.equal(events.at(-2), 'email');
    assert.equal(events.at(-1), 'commit');
  }
});

test('school rejection trims and stores a supplied reason', async () => {
  const result = await reviewSchool('reject', '  Incomplete documents  ');
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(schoolUpdateValues[1], 'Incomplete documents');
  assert.equal(result.data.school.rejectionReason, 'Incomplete documents');
  assert.equal(emailOutboxValues.at(-1)[6], 'Incomplete documents');
});

test('approval queues one notification email and duplicate decisions cannot enqueue twice', async () => {
  emailOutboxValues = [];
  schoolStatus = 'pending';
  const approved = await reviewSchool('approve');
  assert.equal(approved.error, null);
  assert.equal(approved.data.school.registrationStatus, 'active');
  assert.equal(emailOutboxValues.length, 1);
  assert.equal(emailOutboxValues[0][1], 'approved');
  assert.equal(emailOutboxValues[0][2], 'notify@example.com');
  assert.equal(emailOutboxValues[0][6], null);

  const duplicate = await reviewSchool('approve', undefined, false);
  assert.equal(duplicate.error.status, 409);
  assert.equal(emailOutboxValues.length, 1);
});

test('platform admin can retry only a failed decision email without changing its recorded attempts', async () => {
  events.length = 0;
  retryJobStatus = 'failed';
  const result = { data: null, error: null };
  await retrySchoolRegistrationEmail({ params: { schoolId: '19' } }, {
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  assert.equal(result.error, null);
  assert.equal(result.data.emailDelivery.status, 'pending');
  assert.ok(events.includes('retry'));
  assert.equal(events.at(-1), 'commit');

  retryJobStatus = 'sent';
  const conflict = { error: null };
  await retrySchoolRegistrationEmail({ params: { schoolId: '19' } }, {}, error => { conflict.error = error; });
  assert.equal(conflict.error.status, 409);
});
