const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let schoolStatus = 'active';
let events = [];
let outboxValues = [];
const connection = {
  async beginTransaction() { events.push('begin'); },
  async commit() { events.push('commit'); },
  async rollback() { events.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    if (sql.includes('registration_status AS status')) {
      return [[{ id: 2, name: 'Sample School', status: schoolStatus, notificationEmail: 'notify@example.com' }]];
    }
    if (sql.startsWith('UPDATE schools SET registration_status')) schoolStatus = values[0];
    if (sql.startsWith('UPDATE schools SET registration_status')) events.push('status');
    if (sql.startsWith('INSERT INTO audit_logs')) events.push('audit');
    if (sql.startsWith('INSERT INTO notifications')) events.push('notification');
    if (sql.startsWith('SELECT display_name AS displayName, school_email AS schoolEmail')) {
      return [[{ displayName: 'School Admin', schoolEmail: 'admin@school.academix.test' }]];
    }
    if (sql.startsWith('INSERT INTO school_registration_email_outbox')) {
      outboxValues.push(values);
      events.push('outbox');
    }
    return [[]];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
require('../workers/schoolRegistrationEmailWorker').wakeSchoolRegistrationEmailWorker = () => {};
const controller = require('../controllers/schoolsController');

async function change(action) {
  const result = { data: null, error: null };
  await controller.changeSchoolAccess(
    { params: { schoolId: '2', action }, user: { id: 9, role: 'platform_admin', schoolId: null } },
    { json(data) { result.data = data; } },
    error => { result.error = error; }
  );
  return result;
}

test('suspension and reactivation queue a notice transactionally with audit and in-app notifications', async () => {
  schoolStatus = 'active';
  events = [];
  outboxValues = [];
  const suspended = await change('suspend');
  assert.equal(suspended.error, null);
  assert.equal(suspended.data.school.registrationStatus, 'suspended');
  assert.equal(suspended.data.emailDelivery.status, 'pending');
  assert.deepEqual(events, ['begin', 'status', 'audit', 'notification', 'outbox', 'commit']);
  assert.deepEqual(outboxValues[0].slice(1, 3), ['suspended', 'notify@example.com']);
  assert.notEqual(outboxValues[0][2], outboxValues[0][5]);

  events = [];
  const reactivated = await change('reactivate');
  assert.equal(reactivated.error, null);
  assert.equal(reactivated.data.school.registrationStatus, 'active');
  assert.equal(reactivated.data.emailDelivery.status, 'pending');
  assert.deepEqual(events, ['begin', 'status', 'audit', 'notification', 'outbox', 'commit']);
  assert.deepEqual(outboxValues[1].slice(1, 3), ['reactivated', 'notify@example.com']);
});

test('an invalid school status transition is rejected without an update', async () => {
  schoolStatus = 'suspended';
  events = [];
  const result = await change('suspend');
  assert.equal(result.error.status, 409);
  assert.deepEqual(events, ['begin', 'rollback']);
});

test('school members cannot read another school logo', async () => {
  let error;
  await controller.getSchoolLogo(
    { params: { schoolId: '2' }, user: { id: 10, role: 'teacher', schoolId: 1 } },
    {},
    result => { error = result; }
  );
  assert.equal(error.status, 403);
});
