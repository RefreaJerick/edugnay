const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');
const { sendSchoolRegistrationDecisionEmail, sendSchoolAccessStatusEmail } = require('../config/email');

test('registration decision emails use the personal notification email and omit or include an optional reason', async () => {
  const names = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalTransport = nodemailer.createTransport;
  const sent = [];
  Object.assign(process.env, {
    MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'test',
    MAIL_PASSWORD: 'test', MAIL_FROM: 'Academix <no-reply@example.test>'
  });
  nodemailer.createTransport = () => ({ sendMail: async message => {
    sent.push(message);
    return { messageId: `<test-${sent.length}@example.test>`, response: '250 2.0.0 accepted\r\n' };
  } });
  try {
    const user = { displayName: 'Jane Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test', personalEmail: 'jane@example.com' };
    const school = { name: 'Mangaldan National High School' };
    assert.deepEqual(await sendSchoolRegistrationDecisionEmail(user, school, true), {
      status: 'sent', messageId: '<test-1@example.test>', smtpResponse: '250 2.0.0 accepted', smtpResponseCode: '250'
    });
    assert.equal(sent[0].to, 'jane@example.com');
    assert.match(sent[0].text, /j\.reyes\.adm@mnhs\.academix\.test/);

    assert.equal((await sendSchoolRegistrationDecisionEmail(user, school, false, null)).messageId, '<test-2@example.test>');
    assert.equal(sent[1].to, 'jane@example.com');
    assert.match(sent[1].text, /was not approved at this time\./);
    assert.doesNotMatch(sent[1].text, /Reason:/);

    assert.equal((await sendSchoolRegistrationDecisionEmail(user, school, false, 'Incomplete documents')).smtpResponseCode, '250');
    assert.equal(sent[2].to, 'jane@example.com');
    assert.match(sent[2].text, /Reason: Incomplete documents/);

    assert.equal((await sendSchoolAccessStatusEmail(user, school, 'suspended')).messageId, '<test-4@example.test>');
    assert.equal(sent[3].to, 'jane@example.com');
    assert.match(sent[3].subject, /suspended/i);
    assert.match(sent[3].text, /cannot sign in while access remains suspended/i);
    assert.match(sent[3].text, /contact the Platform Admin/i);
    assert.doesNotMatch(sent[3].text, /password/i);

    assert.equal((await sendSchoolAccessStatusEmail(user, school, 'reactivated')).messageId, '<test-5@example.test>');
    assert.equal(sent[4].to, 'jane@example.com');
    assert.match(sent[4].subject, /restored/i);
    assert.match(sent[4].text, /may access Academix again/i);
    assert.doesNotMatch(sent[4].text, /password/i);

    user.personalEmail = '';
    assert.deepEqual(await sendSchoolAccessStatusEmail(user, school, 'suspended'), { status: 'skipped' });
    delete user.personalEmail;
    assert.deepEqual(await sendSchoolAccessStatusEmail(user, school, 'reactivated'), { status: 'skipped' });
    assert.equal(sent.length, 5);
  } finally {
    nodemailer.createTransport = originalTransport;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('SMTP response metadata is sanitized and sensitive server error messages are not returned', async () => {
  const emailPath = require.resolve('../config/email');
  const names = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalTransport = nodemailer.createTransport;
  delete require.cache[emailPath];
  const isolatedEmail = require(emailPath);
  Object.assign(process.env, {
    MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'test',
    MAIL_PASSWORD: 'test', MAIL_FROM: 'Academix <no-reply@example.test>'
  });
  nodemailer.createTransport = () => ({ sendMail: async () => ({
    messageId: '<reference@example.test>\r\nInjected: no',
    response: '250 2.0.0 accepted\r\nInjected: no'
  }) });
  try {
    const result = await isolatedEmail.sendSchoolAccessStatusEmail(
      { displayName: 'Jane Reyes', personalEmail: 'jane@example.com' },
      { name: 'Mangaldan National High School' },
      'reactivated'
    );
    assert.deepEqual(result, {
      status: 'sent',
      messageId: '<reference@example.test> Injected: no',
      smtpResponse: '250 2.0.0 accepted Injected: no',
      smtpResponseCode: '250'
    });
  } finally {
    nodemailer.createTransport = originalTransport;
    delete require.cache[emailPath];
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('SMTP failure logging exposes only a sanitized error code', async () => {
  const emailPath = require.resolve('../config/email');
  const names = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalTransport = nodemailer.createTransport;
  const originalError = console.error;
  const logs = [];
  delete require.cache[emailPath];
  const isolatedEmail = require(emailPath);
  Object.assign(process.env, {
    MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'test',
    MAIL_PASSWORD: 'test', MAIL_FROM: 'Academix <no-reply@example.test>'
  });
  nodemailer.createTransport = () => ({ sendMail: async () => {
    throw Object.assign(new Error('private server detail for jane@example.com'), { code: 'EAUTH' });
  } });
  console.error = (...args) => logs.push(args.join(' '));
  try {
    assert.deepEqual(await isolatedEmail.sendEmail({
      to: 'jane@example.com', subject: 'test', text: 'test body'
    }), { status: 'failed', errorCode: 'EAUTH' });
    assert.match(logs[0], /EAUTH/);
    assert.doesNotMatch(logs[0], /jane@example\.com|private server detail/);
  } finally {
    nodemailer.createTransport = originalTransport;
    console.error = originalError;
    delete require.cache[emailPath];
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
