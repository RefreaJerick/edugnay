const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');
const { sendSchoolRegistrationDecisionEmail } = require('../config/email');

test('approval sends the generated login address to the personal notification email', async () => {
  const names = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalTransport = nodemailer.createTransport;
  const sent = [];
  Object.assign(process.env, {
    MAIL_HOST: 'smtp.example.test', MAIL_PORT: '587', MAIL_USER: 'test',
    MAIL_PASSWORD: 'test', MAIL_FROM: 'Academix <no-reply@example.test>'
  });
  nodemailer.createTransport = () => ({ sendMail: async message => { sent.push(message); } });
  try {
    const user = { displayName: 'Jane Reyes', schoolEmail: 'j.reyes.adm@mnhs.academix.test', personalEmail: 'jane@example.com' };
    const school = { name: 'Mangaldan National High School' };
    assert.deepEqual(await sendSchoolRegistrationDecisionEmail(user, school, true), { status: 'sent' });
    assert.equal(sent[0].to, 'jane@example.com');
    assert.match(sent[0].text, /j\.reyes\.adm@mnhs\.academix\.test/);
  } finally {
    nodemailer.createTransport = originalTransport;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
