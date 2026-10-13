const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { sendAnnouncementEmail } = require('../config/email');

const source = fs.readFileSync(path.join(__dirname, '../workers/announcementEmailWorker.js'), 'utf8');
const worker = source.slice(source.indexOf('async function sendQueuedEmail('),
  source.indexOf('async function processAnnouncementEmailQueue('));

test('announcement queue marks a legacy user without personal email skipped, not retried', async () => {
  const queries = [];
  const database = { async execute(sql, values) { queries.push({ sql, values }); } };
  const sendQueuedEmail = vm.runInNewContext(`${worker}\nsendQueuedEmail`, { sendAnnouncementEmail, MAX_ATTEMPTS: 5 });
  await sendQueuedEmail(database, {
    id: 7, attempts: 1, schoolStatus: 'active', recipientId: 4,
    announcementStatus: 'published', title: 'Notice', body: 'Body',
    schoolEmail: 'student@mnhs.academix.test', personalEmail: null
  }, 'claim');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /status = 'skipped'/);
  assert.match(queries[0].sql, /last_error = 'missing_email'/);
  assert.doesNotMatch(queries[0].sql, /next_attempt_at/);
});
