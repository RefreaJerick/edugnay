const { randomUUID } = require('node:crypto');
const { getDatabase } = require('../config/database');
const {
  sendSchoolRegistrationDecisionEmail,
  sendSchoolAccessStatusEmail,
  sanitizeSmtpValue,
  smtpResponseCode
} = require('../config/email');

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 10000;
const CLAIM_TIMEOUT_MINUTES = 5;
let workerTimer;
let processing = false;
let missingTableReported = false;
let missingMetadataReported = false;

async function sendQueuedEmail(database, job, claimToken) {
  const user = {
    displayName: job.administratorName,
    schoolEmail: job.administratorLogin,
    personalEmail: job.recipientEmail
  };
  const school = { name: job.schoolName, administratorSchoolEmail: job.administratorLogin };
  const result = job.decision === 'suspended' || job.decision === 'reactivated'
    ? await sendSchoolAccessStatusEmail(user, school, job.decision)
    : await sendSchoolRegistrationDecisionEmail(user, school, job.decision === 'approved', job.rejectionReason);

  if (result.status === 'sent') {
    const messageId = sanitizeSmtpValue(result.messageId);
    const smtpResponse = sanitizeSmtpValue(result.smtpResponse);
    const responseCode = sanitizeSmtpValue(result.smtpResponseCode || smtpResponseCode(smtpResponse), 3);
    console.info('School account email accepted by SMTP', JSON.stringify({
      outboxId: job.id,
      event: job.decision,
      messageId,
      smtpResponseCode: responseCode
    }));
    await database.execute(
      `UPDATE school_registration_email_outbox
      SET status = 'sent', sent_at = NOW(), smtp_message_id = ?, smtp_response = ?,
        last_error = NULL, claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [messageId, smtpResponse, job.id, claimToken]
    );
    return;
  }

  if (result.status === 'skipped') {
    await database.execute(
      `UPDATE school_registration_email_outbox
      SET status = 'skipped', last_error = 'missing_or_invalid_notification_email',
        claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  if (result.status === 'not_configured') {
    await database.execute(
      `UPDATE school_registration_email_outbox
      SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
        next_attempt_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE), last_error = 'smtp_not_configured',
        claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  const failed = job.attempts >= MAX_ATTEMPTS * (Number(job.manualRetries || 0) + 1);
  const retrySeconds = Math.min(3600, 60 * (2 ** Math.max(0, job.attempts - 1)));
  const errorCode = String(result.errorCode || 'smtp_failed').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  console.error('School account email SMTP attempt failed', JSON.stringify({
    outboxId: job.id,
    event: job.decision,
    errorCode: errorCode || 'smtp_failed'
  }));
  await database.execute(
    `UPDATE school_registration_email_outbox
    SET status = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
      last_error = ?, claim_token = NULL, claimed_at = NULL
    WHERE id = ? AND status = 'sending' AND claim_token = ?`,
    [failed ? 'failed' : 'pending', retrySeconds, errorCode || 'smtp_failed', job.id, claimToken]
  );
}

async function processSchoolRegistrationEmailQueue() {
  if (processing) return false;
  processing = true;
  let moreJobs = false;

  try {
    const database = getDatabase();
    await database.execute('SELECT smtp_message_id, smtp_response FROM school_registration_email_outbox LIMIT 0');
    await database.execute(
      `UPDATE school_registration_email_outbox
      SET status = 'failed', last_error = 'smtp_outcome_unknown', claim_token = NULL, claimed_at = NULL
      WHERE status = 'sending' AND claimed_at < DATE_SUB(NOW(), INTERVAL ${CLAIM_TIMEOUT_MINUTES} MINUTE)`
    );

    const claimToken = randomUUID();
    const [claim] = await database.execute(
      `UPDATE school_registration_email_outbox
      SET status = 'sending', claim_token = ?, claimed_at = NOW(), attempts = attempts + 1
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY id LIMIT ${BATCH_SIZE}`,
      [claimToken]
    );
    if (!claim.affectedRows) return false;

    const [jobs] = await database.execute(
      `SELECT id, decision, recipient_email AS recipientEmail, school_name AS schoolName,
        administrator_name AS administratorName, administrator_login AS administratorLogin,
        rejection_reason AS rejectionReason, attempts, manual_retries AS manualRetries
      FROM school_registration_email_outbox
      WHERE claim_token = ? ORDER BY id`,
      [claimToken]
    );

    for (const job of jobs) await sendQueuedEmail(database, job, claimToken);
    moreJobs = jobs.length === BATCH_SIZE;
    return moreJobs;
  } finally {
    processing = false;
    if (moreJobs) setImmediate(wakeSchoolRegistrationEmailWorker);
  }
}

function wakeSchoolRegistrationEmailWorker() {
  setImmediate(() => {
    processSchoolRegistrationEmailQueue().catch(error => {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        if (!missingTableReported) {
          console.error('School registration email outbox is missing. Apply migration 031_school_registration_email_outbox.sql.');
          missingTableReported = true;
        }
        return;
      }
      if (error.code === 'ER_BAD_FIELD_ERROR' && /smtp_message_id|smtp_response/i.test(error.message || '')) {
        if (!missingMetadataReported) {
          console.error('School account email diagnostics are unavailable. Apply migration 033_school_registration_email_smtp_metadata.sql before starting the worker.');
          missingMetadataReported = true;
        }
        return;
      }
      console.error('School registration email worker could not process queued messages.');
    });
  });
}

function startSchoolRegistrationEmailWorker() {
  if (workerTimer) return;
  wakeSchoolRegistrationEmailWorker();
  workerTimer = setInterval(wakeSchoolRegistrationEmailWorker, POLL_INTERVAL_MS);
  workerTimer.unref?.();
}

module.exports = {
  processSchoolRegistrationEmailQueue,
  sendQueuedEmail,
  startSchoolRegistrationEmailWorker,
  wakeSchoolRegistrationEmailWorker
};
