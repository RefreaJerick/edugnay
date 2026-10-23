const { randomUUID } = require('node:crypto');
const webPush = require('web-push');
const { getDatabase } = require('../config/database');

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
let timer;
let processing = false;
let missingTableReported = false;

function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

async function processPushQueue(database = getDatabase(), send = webPush.sendNotification) {
  if (processing || !configured()) return false;
  processing = true;
  try {
    webPush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    await database.execute(`UPDATE notification_push_deliveries SET status = 'pending', claim_token = NULL, claimed_at = NULL
      WHERE status = 'sending' AND claimed_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`);
    const claimToken = randomUUID();
    const [claim] = await database.execute(`UPDATE notification_push_deliveries
      SET status = 'sending', claim_token = ?, claimed_at = NOW(), attempts = attempts + 1
      WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY id LIMIT ${BATCH_SIZE}`, [claimToken]);
    if (!claim.affectedRows) return false;
    const [jobs] = await database.execute(`SELECT deliveries.id, deliveries.attempts,
        notices.id AS notificationId, notices.type, notices.title, notices.related_student_user_id AS studentId,
        subscriptions.id AS subscriptionId, subscriptions.user_id AS subscriptionUserId,
        subscriptions.endpoint, subscriptions.p256dh, subscriptions.auth_key AS authKey,
        recipients.id AS recipientId, recipients.role, recipients.school_id AS schoolId,
        schools.registration_status AS schoolStatus, sessions.id AS activeSessionId,
        EXISTS (SELECT 1 FROM student_parent_links AS links
          INNER JOIN users AS students ON students.id = links.student_user_id
            AND students.school_id = links.school_id AND students.account_status = 'active'
          WHERE links.parent_user_id = recipients.id AND links.school_id = recipients.school_id
            AND links.student_user_id = notices.related_student_user_id) AS parentLinkActive
      FROM notification_push_deliveries AS deliveries
      INNER JOIN notifications AS notices ON notices.id = deliveries.notification_id
      INNER JOIN push_subscriptions AS subscriptions ON subscriptions.id = deliveries.subscription_id
      LEFT JOIN users AS recipients ON recipients.id = notices.user_id AND recipients.account_status = 'active'
      LEFT JOIN schools ON schools.id = recipients.school_id
      LEFT JOIN user_sessions AS sessions ON sessions.id = subscriptions.session_id
        AND sessions.user_id = recipients.id AND sessions.expires_at > NOW()
      WHERE deliveries.claim_token = ? ORDER BY deliveries.id`, [claimToken]);
    for (const job of jobs) {
      const eligible = job.recipientId && String(job.subscriptionUserId) === String(job.recipientId) && job.activeSessionId &&
        (job.role === 'platform_admin' || job.schoolStatus === 'active') &&
        (!job.studentId || job.role !== 'parent' || job.parentLinkActive);
      if (!eligible) {
        await database.execute(`UPDATE notification_push_deliveries SET status = 'failed', claim_token = NULL, claimed_at = NULL
          WHERE id = ? AND claim_token = ?`, [job.id, claimToken]);
        continue;
      }
      const title = job.type === 'report' && job.title === 'Weekly report updated'
        ? 'Weekly report updated' : job.type === 'report' ? 'Weekly report available' : 'New Academix notification';
      const payload = JSON.stringify({ title, body: 'Open Academix to view it.',
        notificationId: String(job.notificationId), role: job.role });
      try {
        await send({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.authKey } }, payload,
          { TTL: 3600, urgency: 'normal' });
        await database.execute(`UPDATE notification_push_deliveries
          SET status = 'sent', sent_at = NOW(), claim_token = NULL, claimed_at = NULL
          WHERE id = ? AND claim_token = ?`, [job.id, claimToken]);
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await database.execute('DELETE FROM push_subscriptions WHERE id = ?', [job.subscriptionId]);
          continue;
        }
        const retry = !error.statusCode || error.statusCode === 429 || error.statusCode >= 500;
        await database.execute(`UPDATE notification_push_deliveries
          SET status = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
            claim_token = NULL, claimed_at = NULL WHERE id = ? AND claim_token = ?`,
          [retry && job.attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
            Math.min(3600, 60 * 2 ** Math.max(0, job.attempts - 1)), job.id, claimToken]);
      }
    }
    return jobs.length === BATCH_SIZE;
  } finally { processing = false; }
}

function startPushNotificationWorker() {
  if (timer || !configured()) return;
  const run = () => processPushQueue().catch(error => {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      if (!missingTableReported) console.error('Apply migration 048_web_push_notifications.sql to enable push delivery.');
      missingTableReported = true;
    } else console.error('Push notification worker failed:', error.message);
  });
  run();
  timer = setInterval(run, 10000);
  timer.unref?.();
}

module.exports = { processPushQueue, startPushNotificationWorker };
