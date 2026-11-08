const assert = require('node:assert/strict');
const test = require('node:test');

const semaphore = require('../config/semaphore');
const { queueReleasedReportSms, reportSmsMessage } = require('../utils/narrativeReportSms');
const workerPath = '../workers/narrativeReportSmsWorker';
const { processNarrativeReportSmsQueue } = require(workerPath);

function loadFreshWorker() {
  const resolvedPath = require.resolve(workerPath);
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function fakeResponse(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[name.toLowerCase()] || null },
    async json() { return payload; }
  };
}

test('Philippine mobile numbers normalize to Semaphore international format', () => {
  assert.equal(semaphore.normalizePhilippineMobile('0917 123 4567'), '639171234567');
  assert.equal(semaphore.normalizePhilippineMobile('+63 (917) 123-4567'), '639171234567');
  assert.equal(semaphore.normalizePhilippineMobile('639171234567'), '639171234567');
  assert.equal(semaphore.normalizePhilippineMobile('9171234567'), '639171234567');
  assert.equal(semaphore.normalizePhilippineMobile('02 8123 4567'), null);
  assert.equal(semaphore.normalizePhilippineMobile('091712345'), null);
  assert.equal(semaphore.normalizePhilippineMobile('abc09171234567'), null);
  assert.equal(semaphore.normalizePhilippineMobile(null), null);
});

test('released report SMS includes full parent-facing content without truncation or internal notes', async () => {
  const longSummary = `Student progress. ${'A detailed observation. '.repeat(80)}`;
  const message = reportSmsMessage({
    studentName: '  Juan Dela Cruz  ', weekStartDate: '2026-10-12', weekEndDate: '2026-10-17',
    summary: longSummary, parentActions: ['Read together.', 'Check the weekly practice.'],
    teacherNote: 'PRIVATE', sourceDetails: 'PRIVATE'
  });
  assert.match(message, /^Weekly Narrative Report for Juan Dela Cruz/);
  assert.match(message, /Reporting week: 2026-10-12 to 2026-10-17/);
  assert.ok(message.includes(longSummary.trim()));
  assert.match(message, /- Read together\.\n- Check the weekly practice\./);
  assert.doesNotMatch(message, /PRIVATE|teacherNote|sourceDetails/);
  assert.ok(message.length > 1600, 'long report text is preserved for multipart delivery');

  const calls = [];
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const result = await queueReleasedReportSms({
      async execute(sql, values = []) {
        calls.push({ sql, values });
        if (sql.includes('FROM school_parent_notification_settings')) return [[{ enabled: 1 }]];
        if (sql.startsWith('SELECT DISTINCT parents.id')) return [[
          { parentUserId: 10, contactNumber: '09171234567' },
          { parentUserId: 11, contactNumber: null },
          { parentUserId: 12, contactNumber: 'not-a-phone' }
        ]];
        return [{ affectedRows: 1 }];
      }
    }, {
      schoolId: 7, releaseId: 44, studentId: 3, studentName: 'Juan Dela Cruz',
      weekStartDate: '2026-10-12', weekEndDate: '2026-10-17',
      summary: longSummary, parentActions: ['Read together.']
    });
    assert.deepEqual(result, { queued: 1, skipped: 2 });
  });
  const inserts = calls.filter(call => call.sql.startsWith('INSERT INTO narrative_report_sms_outbox'));
  assert.equal(inserts.length, 3);
  assert.deepEqual(inserts.map(call => call.values[6]), ['pending', 'skipped', 'skipped']);
  assert.equal(inserts[0].values[0], 7);
  assert.equal(inserts[0].values[1], 44);
  assert.equal(inserts[0].values[2], 10);
  assert.equal(inserts[0].values[3], '639171234567');
  assert.equal(inserts[0].values[5].length > 1600, true);
  assert.equal(inserts[1].values[8], 'missing_phone');
  assert.equal(inserts[2].values[8], 'invalid_phone');
  assert.match(inserts[0].sql, /ON DUPLICATE KEY UPDATE id = id/);
  assert.ok(calls.find(call => call.sql.startsWith('SELECT DISTINCT parents.id')).sql.includes("parents.account_status = 'active'"));
  assert.ok(calls.find(call => call.sql.startsWith('SELECT DISTINCT parents.id')).sql.includes("students.account_status = 'active'"));
});

test('disabled school SMS does not query parents or enqueue messages', async () => {
  const calls = [];
  const result = await queueReleasedReportSms({
    async execute(sql, values) {
      calls.push({ sql, values });
      return [[{ enabled: 0 }]];
    }
  }, { schoolId: 7, releaseId: 44, studentId: 3, studentName: 'Learner',
    weekStartDate: '2026-10-12', weekEndDate: '2026-10-17', summary: 'Report', parentActions: [] });
  assert.deepEqual(result, { queued: 0, skipped: 0 });
  assert.equal(calls.length, 1);
});

test('Semaphore sends the full message with the approved sender and classifies provider outcomes', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'secret-key', async () => {
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return fakeResponse(200, [{ message_id: 81, status: 'PENDING' }]);
    };
    const bodyText = `Weekly Narrative Report\n${'Full text. '.repeat(40)}`;
    const queued = await semaphore.sendSemaphoreSms({ number: '+63 917 123 4567', message: bodyText, fetchImpl });
    assert.deepEqual(queued, { outcome: 'queued', providerMessageId: '81' });
    assert.equal(request.url, 'https://api.semaphore.co/api/v4/messages');
    const form = new URLSearchParams(request.options.body);
    assert.equal(form.get('apikey'), 'secret-key');
    assert.equal(form.get('number'), '639171234567');
    assert.equal(form.get('sendername'), 'AcadeMix');
    assert.equal(form.get('message'), bodyText);

    const throttled = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => fakeResponse(429, {}, { 'retry-after': '75' }) });
    assert.deepEqual(throttled, { outcome: 'retryable', errorCode: 'rate_limited', retryAfterSeconds: 75 });
    const failed = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => fakeResponse(400, { message: 'Rejected' }) });
    assert.equal(failed.outcome, 'failed');
    const uncertainHttp = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => fakeResponse(503, {}) });
    assert.equal(uncertainHttp.outcome, 'uncertain');
    const uncertainNetwork = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => { throw new Error('network failure'); } });
    assert.deepEqual(uncertainNetwork, { outcome: 'uncertain', errorCode: 'network_error' });
    const timeoutError = Object.assign(new Error('request timed out'), { name: 'AbortError' });
    const uncertainTimeout = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => { throw timeoutError; } });
    assert.deepEqual(uncertainTimeout, { outcome: 'uncertain', errorCode: 'request_timeout' });
    const uncertainBodyTimeout = await semaphore.sendSemaphoreSms({ number: '09171234567', message: 'Report',
      fetchImpl: async () => ({ ...fakeResponse(200, null), async json() { throw timeoutError; } }) });
    assert.equal(uncertainBodyTimeout.outcome, 'uncertain');
    const refunded = await semaphore.getSemaphoreMessageStatus('81', async () => fakeResponse(200, [{ message_id: 81, status: 'Refunded' }]));
    assert.deepEqual(refunded, { outcome: 'failed', errorCode: 'provider_failed' });
  });
});

function workerDatabase(initialRows) {
  const rows = initialRows.map(row => ({
    status: 'pending', attempts: 0, nextAttemptAt: 0, nextStatusCheckAt: 0,
    claimToken: null, recipientPhone: '639171234567', messageBody: 'Full report', ...row
  }));
  const calls = [];
  const database = {
    rows,
    calls,
    async execute(sql, values = []) {
      calls.push({ sql, values });
      const update = (row, changes) => Object.assign(row, changes);
      if (sql.includes("WHERE status = 'sending' AND claimed_at <")) return [{ affectedRows: 0 }];
      if (sql.includes("WHERE status = 'queued' AND claimed_at <")) return [{ affectedRows: 0 }];
      if (sql.includes("created_at < DATE_SUB")) return [{ affectedRows: 0 }];
      if (sql.includes("WHERE status = 'pending'")) {
        const token = values[0];
        const claimed = rows.filter(row => row.status === 'pending' && row.nextAttemptAt <= Date.now()).slice(0, 1);
        claimed.forEach(row => update(row, { status: 'sending', claimToken: token, attempts: row.attempts + 1 }));
        return [{ affectedRows: claimed.length }];
      }
      if (sql.includes("FROM narrative_report_sms_outbox WHERE status = 'sending'")) {
        return [rows.filter(row => row.status === 'sending' && row.claimToken === values[0])
          .map(row => ({ id: row.id, recipientPhone: row.recipientPhone, messageBody: row.messageBody,
            recipientLast4: '4567', attempts: row.attempts }))];
      }
      if (sql.includes("WHERE status = 'queued' AND next_status_check_at")) {
        const token = values[0];
        const claimed = rows.filter(row => row.status === 'queued' && row.nextStatusCheckAt <= Date.now() && !row.claimToken).slice(0, 5);
        claimed.forEach(row => update(row, { claimToken: token }));
        return [{ affectedRows: claimed.length }];
      }
      if (sql.includes("FROM narrative_report_sms_outbox WHERE status = 'queued' AND claim_token")) {
        return [rows.filter(row => row.status === 'queued' && row.claimToken === values[0])
          .map(row => ({ id: row.id, providerMessageId: row.providerMessageId }))];
      }
      if (sql.includes("SET status = 'sent'")) {
        const isSendUpdate = sql.includes('semaphore_message_id = ?');
        const [providerMessageId, id, token] = isSendUpdate ? values : [null, values[0], values[1]];
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { status: 'sent', ...(isSendUpdate ? { providerMessageId } : {}), sentAt: Date.now(),
          recipientPhone: null, messageBody: null, claimToken: null });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes("SET status = 'queued'")) {
        const [providerMessageId, id, token] = values;
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { status: 'queued', providerMessageId, nextStatusCheckAt: Date.now() + 120000,
          recipientPhone: null, messageBody: null, claimToken: null });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes("SET status = 'pending'")) {
        const [delaySeconds, errorCode, id, token] = values;
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { status: 'pending', nextAttemptAt: Date.now() + delaySeconds * 1000,
          claimToken: null, lastErrorCode: errorCode });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes('SET status = ?')) {
        const [status, errorCode, id, token] = values;
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { status, lastErrorCode: errorCode, recipientPhone: null, messageBody: null, claimToken: null });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes("SET status = 'failed'")) {
        const [errorCode, id, token] = values;
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { status: 'failed', lastErrorCode: errorCode, claimToken: null });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.includes('SET next_status_check_at = DATE_ADD')) {
        const [errorCode, id, token] = values;
        const row = rows.find(item => item.id === id && item.claimToken === token);
        if (row) update(row, { nextStatusCheckAt: Date.now() + 120000, claimToken: null, lastErrorCode: errorCode });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      throw new Error(`Unexpected worker query: ${sql}`);
    }
  };
  return database;
}

test('SMS worker finishes one send before claiming the next message', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const database = workerDatabase([
      { id: 10, messageBody: 'First parent report' },
      { id: 11, messageBody: 'Second parent report' },
      { id: 12, messageBody: 'Third parent report' }
    ]);
    let pendingClaimCount = 0;
    let sends = 0;
    const interruptBeforeSecondClaim = {
      ...database,
      async execute(sql, values = []) {
        if (sql.includes("WHERE status = 'pending'")) {
          pendingClaimCount += 1;
          if (pendingClaimCount === 2) {
            throw new Error('simulated worker interruption');
          }
        }
        return database.execute(sql, values);
      }
    };
    const provider = {
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms({ message }) {
        sends += 1;
        assert.equal(message, 'First parent report');
        assert.deepEqual(database.rows.filter(row => row.status === 'sending').map(row => row.id), [10]);
        return { outcome: 'sent', providerMessageId: 'sms-first' };
      },
      async getSemaphoreMessageStatus() { return { outcome: 'unknown' }; }
    };

    await assert.rejects(processNarrativeReportSmsQueue(interruptBeforeSecondClaim, provider), /simulated worker interruption/);
    assert.equal(sends, 1);
    assert.equal(database.rows[0].status, 'sent');
    assert.equal(database.rows[0].messageBody, null);
    for (const row of database.rows.slice(1)) {
      assert.equal(row.status, 'pending');
      assert.notEqual(row.messageBody, null);
      assert.equal(row.claimToken, null);
    }
  });
});

test('separate SMS workers claim distinct messages and process at most five sends each', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const database = workerDatabase(Array.from({ length: 12 }, (_, index) => ({
      id: index + 20,
      messageBody: `Parent report ${index + 1}`
    })));
    const sendsByMessage = new Map();
    const sendsByWorker = new Map();
    const providerFor = workerId => ({
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms({ message }) {
        sendsByMessage.set(message, (sendsByMessage.get(message) || 0) + 1);
        sendsByWorker.set(workerId, (sendsByWorker.get(workerId) || 0) + 1);
        await new Promise(resolve => setTimeout(resolve, 1));
        return { outcome: 'sent', providerMessageId: `sms-${message}` };
      },
      async getSemaphoreMessageStatus() { return { outcome: 'unknown' }; }
    });
    const firstWorker = loadFreshWorker();
    const secondWorker = loadFreshWorker();

    const results = await Promise.all([
      firstWorker.processNarrativeReportSmsQueue(database, providerFor('first')),
      secondWorker.processNarrativeReportSmsQueue(database, providerFor('second'))
    ]);

    assert.deepEqual(results, [true, true]);
    assert.equal(sendsByMessage.size, 10);
    assert.ok([...sendsByMessage.values()].every(count => count === 1));
    assert.ok(sendsByWorker.get('first') > 0);
    assert.ok(sendsByWorker.get('second') > 0);
    assert.ok([...sendsByWorker.values()].every(count => count <= 5));
    assert.equal(database.rows.filter(row => row.status === 'sent').length, 10);
    assert.equal(database.rows.filter(row => row.status === 'pending').length, 2);
    assert.ok(database.rows.filter(row => row.status === 'pending').every(row => row.messageBody));
  });
});

test('SMS worker marks uncertain sends and never automatically sends them again', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const database = workerDatabase([{ id: 1 }]);
    let sends = 0;
    const provider = {
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms() { sends += 1; return { outcome: 'uncertain', errorCode: 'request_timeout' }; },
      async getSemaphoreMessageStatus() { throw new Error('must not poll without a provider id'); }
    };
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(database.rows[0].status, 'uncertain');
    assert.equal(database.rows[0].messageBody, null);
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(sends, 1);
  });
});

test('SMS worker polls accepted messages without sending them again', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const database = workerDatabase([{ id: 2 }]);
    let sends = 0;
    let polls = 0;
    const provider = {
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms() { sends += 1; return { outcome: 'queued', providerMessageId: 'sms-2' }; },
      async getSemaphoreMessageStatus(id) { polls += 1; assert.equal(id, 'sms-2'); return { outcome: 'sent' }; }
    };
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(database.rows[0].status, 'queued');
    database.rows[0].nextStatusCheckAt = 0;
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(database.rows[0].status, 'sent');
    assert.equal(sends, 1);
    assert.equal(polls, 1);
  });
});

test('SMS worker retries provider rate limits after the requested delay', async () => {
  await withEnv('SEMAPHORE_API_KEY', 'test-key', async () => {
    const database = workerDatabase([{ id: 3 }]);
    let sends = 0;
    const provider = {
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms() {
        sends += 1;
        return sends === 1
          ? { outcome: 'retryable', errorCode: 'rate_limited', retryAfterSeconds: 45 }
          : { outcome: 'sent', providerMessageId: 'sms-3' };
      },
      async getSemaphoreMessageStatus() { return { outcome: 'unknown' }; }
    };
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(database.rows[0].status, 'pending');
    assert.equal(database.rows[0].nextAttemptAt - Date.now() >= 44000, true);
    const retryUpdate = database.calls.find(call => call.sql.includes("SET status = 'pending'"));
    assert.equal(retryUpdate.values[0], 45);
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(sends, 1);
    database.rows[0].nextAttemptAt = 0;
    await processNarrativeReportSmsQueue(database, provider);
    assert.equal(sends, 2);
    assert.equal(database.rows[0].status, 'sent');

    const exhausted = workerDatabase([{ id: 4, attempts: 3 }]);
    const exhaustedProvider = {
      isSemaphoreConfigured: () => true,
      async sendSemaphoreSms() { return { outcome: 'retryable', errorCode: 'rate_limited' }; },
      async getSemaphoreMessageStatus() { return { outcome: 'unknown' }; }
    };
    await processNarrativeReportSmsQueue(exhausted, exhaustedProvider);
    assert.equal(exhausted.rows[0].status, 'failed');
  });
});
