const { randomUUID } = require('node:crypto');
const { getDatabase } = require('../config/database');
const semaphore = require('../config/semaphore');

const BATCH_SIZE = 5;
const MAX_SEND_ATTEMPTS = 4;
const POLL_INTERVAL_MS = 30000;
let timer;
let processing = false;
let missingTableReported = false;

function clearPayloadSql() {
  return 'recipient_phone = NULL, message_body = NULL, claim_token = NULL, claimed_at = NULL';
}

async function processNarrativeReportSmsQueue(database = getDatabase(), provider = semaphore) {
  if (processing || !provider.isSemaphoreConfigured()) return false;
  processing = true;
  try {
    await database.execute(`UPDATE narrative_report_sms_outbox
      SET status = 'uncertain', ${clearPayloadSql()}, last_error_code = 'worker_interrupted'
      WHERE status = 'sending' AND claimed_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)`);
    await database.execute(`UPDATE narrative_report_sms_outbox
      SET claim_token = NULL, claimed_at = NULL
      WHERE status = 'queued' AND claimed_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)`);
    await database.execute(`UPDATE narrative_report_sms_outbox
      SET status = 'uncertain', ${clearPayloadSql()}, last_error_code = 'provider_status_timeout'
      WHERE status = 'queued' AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)`);

    let sendClaimedAny = false;
    for (let messageIndex = 0; messageIndex < BATCH_SIZE; messageIndex += 1) {
      const sendClaimToken = randomUUID();
      const [sendClaim] = await database.execute(`UPDATE narrative_report_sms_outbox
        SET status = 'sending', claim_token = ?, claimed_at = CURRENT_TIMESTAMP, attempts = attempts + 1
        WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY id LIMIT 1`, [sendClaimToken]);
      if (!sendClaim.affectedRows) break;
      sendClaimedAny = true;

      const [jobs] = await database.execute(`SELECT id, recipient_phone AS recipientPhone,
        message_body AS messageBody, recipient_last4 AS recipientLast4, attempts
        FROM narrative_report_sms_outbox WHERE status = 'sending' AND claim_token = ? ORDER BY id LIMIT 1`, [sendClaimToken]);
      const job = jobs[0];
      if (!job) continue;

      let result;
      try {
        result = await provider.sendSemaphoreSms({ number: job.recipientPhone, message: job.messageBody });
      } catch {
        result = { outcome: 'uncertain', errorCode: 'network_error' };
      }
      if (result.outcome === 'sent') {
        await database.execute(`UPDATE narrative_report_sms_outbox
          SET status = 'sent', semaphore_message_id = ?, sent_at = CURRENT_TIMESTAMP,
            ${clearPayloadSql()}, last_error_code = NULL
          WHERE id = ? AND claim_token = ?`, [result.providerMessageId || null, job.id, sendClaimToken]);
      } else if (result.outcome === 'queued' && result.providerMessageId) {
        await database.execute(`UPDATE narrative_report_sms_outbox
          SET status = 'queued', semaphore_message_id = ?, next_status_check_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE),
            ${clearPayloadSql()}, last_error_code = NULL
          WHERE id = ? AND claim_token = ?`, [result.providerMessageId, job.id, sendClaimToken]);
      } else if (result.outcome === 'retryable' && Number(job.attempts) < MAX_SEND_ATTEMPTS) {
        const delaySeconds = Number.isFinite(Number(result.retryAfterSeconds)) && Number(result.retryAfterSeconds) > 0
          ? Math.min(3600, Math.ceil(Number(result.retryAfterSeconds)))
          : Math.min(900, 60 * (2 ** Math.max(0, Number(job.attempts) - 1)));
        await database.execute(`UPDATE narrative_report_sms_outbox
          SET status = 'pending', next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
            claim_token = NULL, claimed_at = NULL, last_error_code = ?
          WHERE id = ? AND claim_token = ?`, [delaySeconds, result.errorCode || 'rate_limited', job.id, sendClaimToken]);
      } else {
        const uncertain = result.outcome === 'uncertain';
        await database.execute(`UPDATE narrative_report_sms_outbox
          SET status = ?, ${clearPayloadSql()}, last_error_code = ?
          WHERE id = ? AND claim_token = ?`, [uncertain ? 'uncertain' : 'failed',
          result.errorCode || (uncertain ? 'uncertain_provider_result' : 'provider_rejected'), job.id, sendClaimToken]);
      }
    }

    const pollClaimToken = randomUUID();
    const [pollClaim] = await database.execute(`UPDATE narrative_report_sms_outbox
      SET claim_token = ?, claimed_at = CURRENT_TIMESTAMP
      WHERE status = 'queued' AND next_status_check_at <= CURRENT_TIMESTAMP AND claim_token IS NULL
      ORDER BY id LIMIT ${BATCH_SIZE}`, [pollClaimToken]);
    if (pollClaim.affectedRows) {
      const [jobs] = await database.execute(`SELECT id, semaphore_message_id AS providerMessageId
        FROM narrative_report_sms_outbox WHERE status = 'queued' AND claim_token = ? ORDER BY id`, [pollClaimToken]);
      for (const job of jobs) {
        let result;
        try {
          result = await provider.getSemaphoreMessageStatus(job.providerMessageId);
        } catch {
          result = { outcome: 'unknown' };
        }
        if (result.outcome === 'sent') {
          await database.execute(`UPDATE narrative_report_sms_outbox
            SET status = 'sent', sent_at = CURRENT_TIMESTAMP, claim_token = NULL, claimed_at = NULL, last_error_code = NULL
            WHERE id = ? AND claim_token = ?`, [job.id, pollClaimToken]);
        } else if (result.outcome === 'failed') {
          await database.execute(`UPDATE narrative_report_sms_outbox
            SET status = 'failed', claim_token = NULL, claimed_at = NULL, last_error_code = ?
            WHERE id = ? AND claim_token = ?`, [result.errorCode || 'provider_failed', job.id, pollClaimToken]);
        } else {
          await database.execute(`UPDATE narrative_report_sms_outbox
            SET next_status_check_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE), claim_token = NULL, claimed_at = NULL,
              last_error_code = ? WHERE id = ? AND claim_token = ?`, [result.errorCode || null, job.id, pollClaimToken]);
        }
      }
    }
    return Boolean(sendClaimedAny || pollClaim.affectedRows);
  } finally {
    processing = false;
  }
}

function startNarrativeReportSmsWorker() {
  if (timer || !semaphore.isSemaphoreConfigured()) return;
  const run = () => processNarrativeReportSmsQueue().catch(error => {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      if (!missingTableReported) console.error('Apply migration 066_narrative_report_sms.sql to enable report SMS delivery.');
      missingTableReported = true;
    } else console.error('Narrative report SMS worker failed:', error.message);
  });
  run();
  timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref?.();
}

module.exports = { processNarrativeReportSmsQueue, startNarrativeReportSmsWorker };
