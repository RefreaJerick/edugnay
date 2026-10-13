const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');

const names = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const originalTransport = nodemailer.createTransport;
const sent = [];
Object.assign(process.env, {
  MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'test',
  MAIL_PASSWORD: 'test', MAIL_FROM: 'Academix <no-reply@example.test>'
});
nodemailer.createTransport = () => ({
  sendMail: async message => {
    sent.push(message);
    return { messageId: `<test-${sent.length}@example.test>`, response: '250 2.0.0 accepted' };
  },
  verify: async () => true
});

const email = require('../config/email');
const { sendTestEmail } = require('../controllers/emailController');

test.after(() => {
  nodemailer.createTransport = originalTransport;
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});

test('account, status, announcement, and registration mail never uses a school login as recipient', async () => {
  sent.length = 0;
  const user = { displayName: 'Jane Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test', personalEmail: null,
    accountStatus: 'active' };
  const senders = [
    () => email.sendAccountCreatedEmail(user, 'temporary-password'),
    () => email.sendAccountStatusEmail(user),
    () => email.sendAnnouncementEmail(user, { title: 'Notice', body: 'Body' }),
    () => email.sendSchoolRegistrationSubmittedEmail(user, { name: 'School' }),
    () => email.sendSchoolRegistrationDecisionEmail(user, { name: 'School' }, true)
  ];
  for (const send of senders) assert.deepEqual(await send(), { status: 'skipped' });
  assert.equal(sent.length, 0);

  user.personalEmail = 'not-an-email';
  for (const send of senders) assert.deepEqual(await send(), { status: 'skipped' });
  assert.equal(sent.length, 0);

  user.personalEmail = 'jane@example.com';
  for (const send of senders) assert.equal((await send()).status, 'sent');
  assert.equal(sent.length, senders.length);
  assert.ok(sent.every(message => message.to === 'jane@example.com'));
  assert.match(sent[0].text, /j\.reyes\.adm@mnhs\.academix\.test/);
});

test('SMTP test requires a personal recipient before checking the server', async () => {
  sent.length = 0;
  const result = { error: null, status: null };
  const res = { status(status) { result.status = status; return this; }, send() {} };
  const next = error => { result.error = error; };
  const user = { displayName: 'Jane Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test' };

  await sendTestEmail({ user }, res, next);
  assert.equal(result.error.status, 400);
  assert.match(result.error.message, /personal email/i);
  assert.equal(sent.length, 0);

  result.error = null;
  user.personalEmail = 'jane@example.com';
  await sendTestEmail({ user }, res, next);
  assert.equal(result.error, null);
  assert.equal(result.status, 204);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'jane@example.com');
});
