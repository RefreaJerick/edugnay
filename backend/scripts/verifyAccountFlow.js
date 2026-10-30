// Run with ACCOUNT_FLOW_DB_NAME pointing to an empty, isolated Academix schema.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const testDatabaseName = process.env.ACCOUNT_FLOW_DB_NAME;
if (!/^academix_account_flow_[a-z0-9_]+$/.test(testDatabaseName || '')) {
  throw new Error('ACCOUNT_FLOW_DB_NAME must name an isolated account-flow database.');
}

process.env.DB_HOST = process.env.ACCOUNT_FLOW_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.ACCOUNT_FLOW_DB_PORT || '3307';
process.env.DB_USER = process.env.ACCOUNT_FLOW_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.ACCOUNT_FLOW_DB_PASSWORD || '';
process.env.DB_NAME = testDatabaseName;
process.env.PORT = process.env.ACCOUNT_FLOW_PORT || '39991';
process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:3000';
process.env.MAIL_HOST = 'account-flow.local';
process.env.MAIL_PORT = '2525';
process.env.MAIL_USER = 'account-flow';
process.env.MAIL_PASSWORD = 'account-flow';
process.env.MAIL_FROM = 'Account Flow <test@example.test>';

const bcrypt = require('bcrypt');
const database = require('../config/database').getDatabase();
const mail = [];
require('nodemailer').createTransport = () => ({
  async verify() { return true; },
  async sendMail(message) { mail.push(message); return { accepted: [message.to] }; }
});

const api = `http://127.0.0.1:${process.env.PORT}/api`;
const origin = process.env.FRONTEND_ORIGIN;
const results = [];

function passed(label, detail = '') {
  results.push({ step: label, status: 'PASS', detail });
  console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
}

async function request(route, options = {}, cookie = '') {
  const headers = { Origin: origin, ...options.headers };
  if (cookie) headers.Cookie = cookie;
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${api}${route}`, { ...options, headers });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

function assertStatus(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.data));
}

async function login(schoolEmail, password) {
  return request('/auth/login', { method: 'POST', body: { schoolEmail, password } });
}

async function main() {
  const [[schoolCount]] = await database.execute('SELECT COUNT(*) AS count FROM schools');
  const [[userCount]] = await database.execute('SELECT COUNT(*) AS count FROM users');
  assert.equal(Number(schoolCount.count), 0, 'The isolated school table must be empty.');
  assert.equal(Number(userCount.count), 0, 'The isolated user table must be empty.');

  const platformPassword = 'TemporaryPlatformPass123!';
  const passwordHash = await bcrypt.hash(platformPassword, 12);
  await database.execute(
    `INSERT INTO users (school_id, role, school_email, personal_email, password_hash,
      account_status, first_name, last_name, display_name, initials)
     VALUES (NULL, 'platform_admin', ?, NULL, ?, 'active', 'Test', 'Platform', 'Test Platform', 'TP')`,
    ['t.platform.adm@platform.academix.test', passwordHash]
  );

  require('../server');
  let health;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { health = await request('/health'); if (health.status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assertStatus(health, 200);

  const registration = await request('/schools/register', {
    method: 'POST',
    body: {
      name: 'Mangaldan National Highschool', email: 'contact@example.test',
      notificationEmail: 'notify@example.test', schoolLevels: ['jhs'],
      currentSchoolYearLabel: '2026-2027', schoolYearStartDate: '2026-08-01',
      schoolYearEndDate: '2027-05-31',
      academicTermConfigs: [{ schoolLevel: 'jhs', gradingPeriodType: 'three_term', academicPeriods: [
        { name: 'Term 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
        { name: 'Term 2', plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
        { name: 'Term 3', plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
      ] }],
      initialAdministrator: { firstName: 'Juan', lastName: 'Reyes', temporaryPassword: 'TemporaryAdminPass123!' }
    }
  });
  assertStatus(registration, 201);
  const school = registration.data.school;
  assert.equal(school.schoolEmailDomain, 'mnhs.academix.test');
  assert.equal(school.administratorSchoolEmail, 'j.reyes.adm@mnhs.academix.test');
  const [[savedSchool]] = await database.execute('SELECT school_email_domain AS domain FROM schools WHERE id = ?', [school.id]);
  assert.equal(savedSchool.domain, school.schoolEmailDomain);
  const pendingPage = fs.readFileSync(path.join(__dirname, '../../views/onboarding/edugnay-registration-pending.html'), 'utf8');
  assert.match(pendingPage, /pendingAdministratorSchoolEmail.*registration\.administratorSchoolEmail/);
  passed('registration and pending page', school.administratorSchoolEmail);

  const pendingLogin = await login(school.administratorSchoolEmail, 'TemporaryAdminPass123!');
  assertStatus(pendingLogin, 401);
  passed('pending administrator sign-in rejected', '401');

  const platformLogin = await login('t.platform.adm@platform.academix.test', platformPassword);
  assertStatus(platformLogin, 200);
  const platformCookie = platformLogin.cookie;
  const approval = await request(`/platform/schools/${school.id}/approve`, { method: 'POST', body: {} }, platformCookie);
  assertStatus(approval, 200);
  await new Promise(resolve => setTimeout(resolve, 50));
  const approvalMessage = mail.find(message => message.subject.includes('registration was approved'));
  assert.equal(approvalMessage.to, 'notify@example.test');
  assert.match(approvalMessage.text, new RegExp(school.administratorSchoolEmail.replaceAll('.', '\\.')));
  passed('platform approval and notification', approvalMessage.to);

  const adminLogin = await login(school.administratorSchoolEmail, 'TemporaryAdminPass123!');
  assertStatus(adminLogin, 200);
  const adminCookie = adminLogin.cookie;
  passed('administrator sign-in', '200');

  const missingEmail = await request('/users', { method: 'POST', body: {
    role: 'teacher', firstName: 'No', lastName: 'Address', employeeNo: 'NO-1'
  } }, adminCookie);
  assertStatus(missingEmail, 400);
  const invalidEmail = await request('/users', { method: 'POST', body: {
    role: 'teacher', firstName: 'Bad', lastName: 'Address', employeeNo: 'BAD-1', personalEmail: 'invalid'
  } }, adminCookie);
  assertStatus(invalidEmail, 400);
  passed('missing and invalid personal email rejected', '400, 400');

  const manual = await request('/users', { method: 'POST', body: {
    role: 'teacher', firstName: 'Jane', lastName: 'Reyes', employeeNo: 'T-001',
    personalEmail: 'manual@example.test', schoolEmail: 'override@invalid.test',
    temporaryPassword: 'TemporaryTeacherPass123!'
  } }, adminCookie);
  assertStatus(manual, 201);
  const manualUser = manual.data.user;
  assert.equal(manualUser.schoolEmail, 'j.reyes.fac@mnhs.academix.test');
  assert.equal(manual.data.emailDelivery.status, 'sent');
  const manualMessage = mail.find(message => message.to === 'manual@example.test');
  assert.ok(manualMessage?.text.includes(manualUser.schoolEmail));
  passed('manual creation and credentials', `${manualUser.schoolEmail} -> ${manualMessage.to}`);

  const csv = 'firstName,lastName,personalEmail,employeeNo\nJane,Reyes,imported@example.test,T-002\n';
  const form = new FormData();
  form.set('role', 'teacher');
  form.set('csvFile', new Blob([csv], { type: 'text/csv' }), 'teachers.csv');
  const imported = await request('/users/import', { method: 'POST', body: form }, adminCookie);
  assertStatus(imported, 201);
  assert.equal(imported.data.summary.accountsCreated, 1);
  assert.equal(imported.data.summary.emailDelivery.sent, 1);
  const list = await request('/users?role=teacher', {}, adminCookie);
  assertStatus(list, 200);
  const importedUser = list.data.users.find(user => user.personalEmail === 'imported@example.test');
  assert.equal(importedUser.schoolEmail, 'j.reyes.fac2@mnhs.academix.test');
  assert.ok(mail.some(message => message.to === 'imported@example.test' && message.text.includes(importedUser.schoolEmail)));
  passed('CSV import, collision and account list', importedUser.schoolEmail);

  const invalidCsv = new FormData();
  invalidCsv.set('role', 'teacher');
  invalidCsv.set('csvFile', new Blob(['firstName,lastName,personalEmail,employeeNo\nBad,Mail,,T-003\n'], { type: 'text/csv' }), 'invalid.csv');
  const rejectedImport = await request('/users/import', { method: 'POST', body: invalidCsv }, adminCookie);
  assertStatus(rejectedImport, 422);
  passed('CSV personal-email validation', '422');

  const updated = await request(`/users/${manualUser.id}`, { method: 'PATCH', body: {
    firstName: 'Janet', personalEmail: 'updated@example.test'
  } }, adminCookie);
  assertStatus(updated, 200);
  assert.equal(updated.data.user.schoolEmail, manualUser.schoolEmail);
  assert.equal(updated.data.user.personalEmail, 'updated@example.test');
  const changedLogin = await request(`/users/${manualUser.id}`, { method: 'PATCH', body: {
    schoolEmail: 'changed@invalid.test'
  } }, adminCookie);
  assertStatus(changedLogin, 400);
  const clearedEmail = await request(`/users/${manualUser.id}`, { method: 'PATCH', body: {
    personalEmail: ''
  } }, adminCookie);
  assertStatus(clearedEmail, 400);
  const deactivated = await request(`/users/${manualUser.id}/deactivate`, { method: 'POST', body: {} }, adminCookie);
  assertStatus(deactivated, 200);
  assert.equal(deactivated.data.emailDelivery.status, 'sent');
  assert.ok(mail.some(message => message.to === 'updated@example.test' && message.subject.includes('deactivated')));
  passed('contact/name edits and status message', `${manualUser.schoolEmail} -> updated@example.test`);

  const { sendAnnouncementEmail, sendAccountStatusEmail } = require('../config/email');
  const before = mail.length;
  assert.equal((await sendAnnouncementEmail({ schoolEmail: manualUser.schoolEmail, personalEmail: null },
    { title: 'Test', body: 'Test' })).status, 'skipped');
  assert.equal((await sendAccountStatusEmail({ schoolEmail: manualUser.schoolEmail, personalEmail: null,
    accountStatus: 'active' })).status, 'skipped');
  assert.equal(mail.length, before);
  passed('legacy account with no recipient', 'skipped');

  const noRecipientTest = await request('/email/test', { method: 'POST', body: {} }, platformCookie);
  assertStatus(noRecipientTest, 400);
  process.env.MAIL_HOST = '';
  const unavailableTest = await request('/email/test', { method: 'POST', body: {} }, adminCookie);
  assertStatus(unavailableTest, 503);
  passed('SMTP test missing recipient/unavailable service', '400, 503');

  assert.ok(mail.every(message => !message.to.endsWith('@mnhs.academix.test')));
  passed('delivery recipient audit', `${mail.length} messages; no school-login recipient`);
}

main().then(async () => {
  await database.end();
  process.exit(0);
}).catch(async error => {
  console.error(`FAIL ${error.message}`);
  await database.end().catch(() => {});
  process.exit(1);
});
