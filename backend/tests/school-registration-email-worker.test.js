const assert = require('node:assert/strict');
const test = require('node:test');
const email = require('../config/email');
const databaseModule = require('../config/database');

const workerPath = require.resolve('../workers/schoolRegistrationEmailWorker');
const originalSender = email.sendSchoolRegistrationDecisionEmail;
const originalAccessSender = email.sendSchoolAccessStatusEmail;

async function withSender(sender, callback) {
  email.sendSchoolRegistrationDecisionEmail = sender;
  delete require.cache[workerPath];
  const worker = require(workerPath);
  try {
    await callback(worker);
  } finally {
    email.sendSchoolRegistrationDecisionEmail = originalSender;
    delete require.cache[workerPath];
  }
}

async function withSenders(decisionSender, accessSender, callback) {
  email.sendSchoolRegistrationDecisionEmail = decisionSender;
  email.sendSchoolAccessStatusEmail = accessSender;
  delete require.cache[workerPath];
  const worker = require(workerPath);
  try {
    await callback(worker);
  } finally {
    email.sendSchoolRegistrationDecisionEmail = originalSender;
    email.sendSchoolAccessStatusEmail = originalAccessSender;
    delete require.cache[workerPath];
  }
}

function job(overrides = {}) {
  return {
    id: 4,
    decision: 'approved',
    recipientEmail: 'notify@example.com',
    schoolName: 'Mangaldan National High School',
    administratorName: 'J. Reyes',
    administratorLogin: 'j.reyes.adm@mnhs.academix.test',
    rejectionReason: null,
    attempts: 1,
    manualRetries: 0,
    ...overrides
  };
}

test('decision worker sends only to the saved notification recipient and records SMTP acceptance', async () => {
  const calls = [];
  const updates = [];
  const logMessages = [];
  const originalInfo = console.info;
  console.info = (...args) => logMessages.push(args.join(' '));
  await withSender(async (...args) => {
    calls.push(args);
    return { status: 'sent', messageId: '<outbox-4@example.test>', smtpResponse: '250 2.0.0 queued', smtpResponseCode: '250' };
  }, async worker => {
    try {
      await worker.sendQueuedEmail({ async execute(sql, values) { updates.push({ sql, values }); } }, job(), 'claim');
    } finally {
      console.info = originalInfo;
    }
  });
  assert.equal(calls[0][0].personalEmail, 'notify@example.com');
  assert.equal(calls[0][0].schoolEmail, 'j.reyes.adm@mnhs.academix.test');
  assert.notEqual(calls[0][0].personalEmail, calls[0][0].schoolEmail);
  assert.match(updates[0].sql, /status = 'sent'/);
  assert.match(updates[0].sql, /sent_at = NOW\(\)/);
  assert.match(updates[0].sql, /smtp_message_id = \?, smtp_response = \?/);
  assert.deepEqual(updates[0].values, ['<outbox-4@example.test>', '250 2.0.0 queued', 4, 'claim']);
  assert.match(logMessages[0], /outboxId.:4/);
  assert.match(logMessages[0], /event.:.approved/);
  assert.match(logMessages[0], /outbox-4@example\.test/);
  assert.doesNotMatch(logMessages[0], /notify@example\.com|Jane Reyes|j\.reyes/);
});

test('suspension and reactivation events use the access-status email sender and saved recipient', async () => {
  const calls = [];
  const updates = [];
  await withSenders(
    async () => { throw new Error('Registration sender should not be used'); },
    async (...args) => {
      calls.push(args);
      return { status: 'sent', messageId: `<${args[2]}@example.test>`, smtpResponse: '250 accepted', smtpResponseCode: '250' };
    },
    async worker => {
      for (const decision of ['suspended', 'reactivated']) {
        await worker.sendQueuedEmail(
          { async execute(sql, values) { updates.push({ sql, values }); } },
          job({ decision }),
          `claim-${decision}`
        );
      }
    }
  );
  assert.deepEqual(calls.map(call => call[0].personalEmail), ['notify@example.com', 'notify@example.com']);
  assert.deepEqual(calls.map(call => call[2]), ['suspended', 'reactivated']);
  assert.equal(calls[0][0].schoolEmail, 'j.reyes.adm@mnhs.academix.test');
  assert.ok(updates.every(update => /status = 'sent'/.test(update.sql)));
  assert.deepEqual(updates.map(update => update.values.slice(0, 2)), [
    ['<suspended@example.test>', '250 accepted'],
    ['<reactivated@example.test>', '250 accepted']
  ]);
});

test('missing recipient is marked skipped without retrying', async () => {
  const updates = [];
  await withSender(async () => ({ status: 'skipped' }), async worker => {
    await worker.sendQueuedEmail({ async execute(sql, values) { updates.push({ sql, values }); } }, job({ recipientEmail: null }), 'claim');
  });
  assert.match(updates[0].sql, /status = 'skipped'/);
  assert.match(updates[0].sql, /missing_or_invalid_notification_email/);
  assert.doesNotMatch(updates[0].sql, /next_attempt_at/);
});

test('unconfigured SMTP remains queued without consuming an attempt', async () => {
  const updates = [];
  await withSender(async () => ({ status: 'not_configured' }), async worker => {
    await worker.sendQueuedEmail({ async execute(sql, values) { updates.push({ sql, values }); } }, job(), 'claim');
  });
  assert.match(updates[0].sql, /status = 'pending'/);
  assert.match(updates[0].sql, /attempts = GREATEST\(attempts - 1, 0\)/);
  assert.match(updates[0].sql, /smtp_not_configured/);
});

test('transient SMTP failures retry and become visible after five attempts', async () => {
  for (const [attempts, expectedStatus] of [[2, 'pending'], [5, 'failed']]) {
    const updates = [];
    await withSender(async () => ({ status: 'failed', errorCode: 'ECONNECTION' }), async worker => {
      await worker.sendQueuedEmail({ async execute(sql, values) { updates.push({ sql, values }); } }, job({ attempts }), 'claim');
    });
    assert.equal(updates[0].values[0], expectedStatus);
    assert.equal(updates[0].values[2], 'ECONNECTION');
  }
});

test('manual retry grants another attempt window while preserving the lifetime attempt count', async () => {
  const updates = [];
  await withSender(async () => ({ status: 'failed' }), async worker => {
    await worker.sendQueuedEmail(
      { async execute(sql, values) { updates.push({ sql, values }); } },
      job({ attempts: 6, manualRetries: 1 }),
      'claim'
    );
  });
  assert.equal(updates[0].values[0], 'pending');
});

test('stale sending claims become outcome-unknown failures instead of being resent automatically', async () => {
  const originalGetDatabase = databaseModule.getDatabase;
  const statements = [];
  databaseModule.getDatabase = () => ({
    async execute(sql) {
      statements.push(sql);
      if (sql.includes("SET status = 'sending'")) return [{ affectedRows: 0 }];
      return [[]];
    }
  });
  delete require.cache[workerPath];
  const worker = require(workerPath);
  try {
    await worker.processSchoolRegistrationEmailQueue();
  } finally {
    databaseModule.getDatabase = originalGetDatabase;
    delete require.cache[workerPath];
  }
  assert.match(statements[0], /SELECT smtp_message_id, smtp_response/);
  assert.match(statements[1], /SET status = 'failed', last_error = 'smtp_outcome_unknown'/);
  assert.doesNotMatch(statements[1], /SET status = 'pending'/);
});
