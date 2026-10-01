const { randomUUID } = require('node:crypto');
const { getDatabase } = require('../config/database');
const { isEmailConfigured, sendAnnouncementEmail } = require('../config/email');

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 10000;
const CLAIM_TIMEOUT_MINUTES = 5;
let workerTimer;
let processing = false;
let missingTableReported = false;

async function sendQueuedEmail(database, job, claimToken) {
  if (!job.recipientId || job.announcementStatus !== 'published') {
    await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'skipped', last_error = 'recipient_unavailable', claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  const result = await sendAnnouncementEmail(
    { displayName: job.displayName, schoolEmail: job.schoolEmail, personalEmail: job.personalEmail },
    { title: job.title, body: job.body, authorName: job.authorName }
  );

  if (result.status === 'sent') {
    await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'sent', sent_at = NOW(), last_error = NULL, claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  if (result.status === 'skipped') {
    await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'skipped', last_error = 'missing_email', claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  if (result.status === 'not_configured') {
    await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
        next_attempt_at = DATE_ADD(NOW(), INTERVAL 60 SECOND), last_error = 'mail_not_configured',
        claim_token = NULL, claimed_at = NULL
      WHERE id = ? AND status = 'sending' AND claim_token = ?`,
      [job.id, claimToken]
    );
    return;
  }

  const failed = job.attempts >= MAX_ATTEMPTS;
  const retrySeconds = Math.min(3600, 60 * (2 ** Math.max(0, job.attempts - 1)));
  await database.execute(
    `UPDATE announcement_email_outbox
    SET status = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
      last_error = 'smtp_failed', claim_token = NULL, claimed_at = NULL
    WHERE id = ? AND status = 'sending' AND claim_token = ?`,
    [failed ? 'failed' : 'pending', retrySeconds, job.id, claimToken]
  );
}

async function processAnnouncementEmailQueue() {
  if (processing || !isEmailConfigured()) return false;
  processing = true;
  let moreJobs = false;

  try {
    const database = getDatabase();
    await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'pending', claim_token = NULL, claimed_at = NULL
      WHERE status = 'sending' AND claimed_at < DATE_SUB(NOW(), INTERVAL ${CLAIM_TIMEOUT_MINUTES} MINUTE)`
    );

    const claimToken = randomUUID();
    const [claim] = await database.execute(
      `UPDATE announcement_email_outbox
      SET status = 'sending', claim_token = ?, claimed_at = NOW(), attempts = attempts + 1
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY id LIMIT ${BATCH_SIZE}`,
      [claimToken]
    );
    if (!claim.affectedRows) return false;

    const [jobs] = await database.execute(
      `SELECT queued.id, queued.attempts,
        announcements.status AS announcementStatus, announcements.title, announcements.body,
        authors.display_name AS authorName,
        recipients.id AS recipientId, recipients.display_name AS displayName,
        recipients.school_email AS schoolEmail, recipients.personal_email AS personalEmail
      FROM announcement_email_outbox AS queued
      LEFT JOIN announcements ON announcements.id = queued.announcement_id
      LEFT JOIN users AS authors ON authors.id = announcements.author_user_id
      LEFT JOIN users AS recipients ON recipients.id = queued.user_id
        AND recipients.school_id = announcements.school_id AND recipients.account_status = 'active'
      WHERE queued.claim_token = ? ORDER BY queued.id`,
      [claimToken]
    );

    for (const job of jobs) await sendQueuedEmail(database, job, claimToken);
    moreJobs = jobs.length === BATCH_SIZE;
    return moreJobs;
  } finally {
    processing = false;
    if (moreJobs) setImmediate(wakeAnnouncementEmailWorker);
  }
}

function wakeAnnouncementEmailWorker() {
  setImmediate(() => {
    processAnnouncementEmailQueue().catch(error => {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        if (!missingTableReported) {
          console.error('Announcement email queue table is missing. Apply migration 014_add_announcement_email_outbox.sql.');
          missingTableReported = true;
        }
        return;
      }
      console.error('Announcement email worker could not process queued messages.');
    });
  });
}

function startAnnouncementEmailWorker() {
  if (workerTimer) return;
  wakeAnnouncementEmailWorker();
  workerTimer = setInterval(wakeAnnouncementEmailWorker, POLL_INTERVAL_MS);
  workerTimer.unref?.();
}

module.exports = { startAnnouncementEmailWorker, wakeAnnouncementEmailWorker };
