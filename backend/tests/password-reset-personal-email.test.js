const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');

process.env.MAIL_HOST = 'smtp.example.test';
process.env.MAIL_PORT = '587';
process.env.MAIL_USER = 'test-user';
process.env.MAIL_PASSWORD = 'test-password';
process.env.MAIL_FROM = 'Academix <no-reply@example.test>';
process.env.MAIL_SECURE = 'false';
process.env.FRONTEND_ORIGIN = 'http://localhost:5500';

let sentMessages = [];
let failEmailDelivery = false;
nodemailer.createTransport = () => ({
  async sendMail(message) {
    sentMessages.push(message);
    if (failEmailDelivery) throw new Error('Test email failure');
  }
});

const databaseModule = require('../config/database');
const emailModule = require('../config/email');

let users;
let resetTokens;
let queries;

databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    queries.push({ sql, values });

    if (sql.startsWith('SELECT id, personal_email')) {
      const user = users.find(account => account.personalEmail === values[0] && account.accountStatus === 'active');
      return [user ? [{ id: user.id, personalEmail: user.personalEmail, displayName: user.displayName }] : []];
    }
    if (sql.startsWith('DELETE FROM password_reset_tokens WHERE user_id')) {
      resetTokens = resetTokens.filter(token => token.userId !== values[0]);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO password_reset_tokens')) {
      resetTokens.push({ userId: values[0], tokenHash: values[1], expiresAt: values[2] });
      return [{ insertId: 1 }];
    }
    if (sql.startsWith('DELETE FROM password_reset_tokens WHERE token_hash')) {
      resetTokens = resetTokens.filter(token => token.tokenHash !== values[0]);
      return [{ affectedRows: 1 }];
    }

    throw new Error(`Unexpected query: ${sql}`);
  }
});

const { requestPasswordReset } = require('../controllers/authController');

function reset() {
  users = [{
    id: 12,
    schoolId: 1,
    personalEmail: 'maria.reyes@gmail.com',
    schoolEmail: 'maria.reyes@school.example',
    displayName: 'Maria Reyes',
    accountStatus: 'active'
  }, {
    id: 31,
    schoolId: 2,
    personalEmail: 'teacher.two@gmail.com',
    schoolEmail: 'teacher.two@other-school.example',
    displayName: 'Teacher Two',
    accountStatus: 'active'
  }];
  resetTokens = [];
  queries = [];
  sentMessages = [];
  failEmailDelivery = false;
}

async function callRequest(body) {
  const result = { status: null, error: null };
  await requestPasswordReset({ body }, {
    status(code) { result.status = code; return this; },
    send() { result.sent = true; return this; }
  }, error => { result.error = error; });
  return result;
}

test('sends the reset link to the matched personal email', async () => {
  reset();
  const result = await callRequest({ personalEmail: ' Maria.Reyes@Gmail.com ' });

  assert.equal(result.status, 204);
  assert.equal(result.error, null);
  assert.match(queries[0].sql, /WHERE personal_email = \? AND account_status = 'active'/);
  assert.doesNotMatch(queries[0].sql, /school_email/);
  assert.deepEqual(queries[0].values, ['maria.reyes@gmail.com']);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'maria.reyes@gmail.com');
  assert.match(sentMessages[0].subject, /reset your Academix password/i);
  assert.equal(resetTokens.length, 1);
});

test('a school email does not find the account for password recovery', async () => {
  reset();
  const result = await callRequest({ personalEmail: 'maria.reyes@school.example' });

  assert.equal(result.status, 204);
  assert.equal(result.error, null);
  assert.equal(sentMessages.length, 0);
  assert.equal(resetTokens.length, 0);
});

test('the submitted personal email selects only its matching account across schools', async () => {
  reset();
  const result = await callRequest({ personalEmail: 'teacher.two@gmail.com' });

  assert.equal(result.status, 204);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'teacher.two@gmail.com');
  assert.equal(resetTokens.length, 1);
  assert.equal(resetTokens[0].userId, 31);
});

test('missing, unknown, and accounts without a saved personal email reveal no account status', async () => {
  reset();
  const missing = await callRequest({});
  const unknown = await callRequest({ personalEmail: 'unknown@gmail.com' });
  users[0].personalEmail = null;
  const noSavedAddress = await callRequest({ personalEmail: 'maria.reyes@school.example' });

  assert.deepEqual([missing.status, unknown.status, noSavedAddress.status], [204, 204, 204]);
  assert.deepEqual([missing.error, unknown.error, noSavedAddress.error], [null, null, null]);
  assert.equal(sentMessages.length, 0);
  assert.equal(resetTokens.length, 0);
});

test('does not accept the old schoolEmail request field', async () => {
  reset();
  const result = await callRequest({ schoolEmail: 'maria.reyes@school.example' });

  assert.equal(result.status, 204);
  assert.equal(queries.length, 0);
  assert.equal(sentMessages.length, 0);
});

test('removes the newly created reset token when email delivery fails', async () => {
  reset();
  failEmailDelivery = true;
  const originalConsoleError = console.error;
  console.error = () => {};

  let result;
  try {
    result = await callRequest({ personalEmail: 'maria.reyes@gmail.com' });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.error.status, 503);
  assert.equal(resetTokens.length, 0);
  assert.equal(sentMessages.length, 1);
});

test('password-reset email helper never falls back to the school email', async () => {
  reset();
  const result = await emailModule.sendPasswordResetEmail({
    displayName: 'Maria Reyes',
    personalEmail: null,
    schoolEmail: 'maria.reyes@school.example'
  }, 'token');

  assert.equal(result.status, 'skipped');
  assert.equal(sentMessages.length, 0);
});
