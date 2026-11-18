const { randomUUID } = require('node:crypto');
const webPush = require('web-push');
const { getDatabase } = require('../config/database');

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const GENERIC_PUSH_TITLE = 'New Academix notification';
const GENERIC_PUSH_BODY = 'Open AcadeMix to view it.';
const ANNOUNCEMENT_HEADLINE_MAX_LENGTH = 120;
const CALENDAR_PUSH_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
let timer;
let processing = false;
let missingTableReported = false;

function configured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function cleanPushText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  const characters = Array.from(value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim());
  if (characters.length <= maximumLength) return characters.join('');
  return `${characters.slice(0, maximumLength - 1).join('').trimEnd()}…`;
}

function calendarPushDate(message) {
  const text = String(message || '');
  const match = /^Date: (\d{4}-\d{2}-\d{2})$/.exec(text);
  if (!match) return text;
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) return text;
  return `${CALENDAR_PUSH_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function pushCopyFor(notification) {
  const generic = { title: GENERIC_PUSH_TITLE, body: GENERIC_PUSH_BODY };
  switch (notification.type) {
    case 'announcement':
      return {
        title: 'New announcement',
        body: cleanPushText(notification.message, ANNOUNCEMENT_HEADLINE_MAX_LENGTH) || GENERIC_PUSH_BODY
      };
    case 'calendar_notice': {
      const date = calendarPushDate(notification.message);
      const detail = cleanPushText(notification.calendarNoticeDetail, ANNOUNCEMENT_HEADLINE_MAX_LENGTH);
      return {
        title: cleanPushText(notification.title, 80) || 'School calendar notice',
        body: cleanPushText(date ? `${date}${detail ? `: ${detail}` : ''}` : detail || notification.message,
          ANNOUNCEMENT_HEADLINE_MAX_LENGTH)
          || GENERIC_PUSH_BODY
      };
    }
    case 'grade':
      if (notification.title === 'Subject grade published') {
        return { title: 'Final grade published', body: 'A new final grade is available in AcadeMix.' };
      }
      if (notification.title === 'Published grade below passing') {
        return { title: 'Grade alert', body: 'A grade update is ready to review in AcadeMix.' };
      }
      return generic;
    case 'attendance':
      return { title: 'Attendance alert', body: 'An attendance alert is ready to review in AcadeMix.' };
    case 'assignment':
      return { title: 'Assignment reminder', body: 'An assignment reminder is ready to review in AcadeMix.' };
    case 'journal':
      return { title: 'Journal reminder', body: 'A journal reminder is ready to review in AcadeMix.' };
    case 'report':
      if (notification.title === 'Weekly report updated') {
        return { title: 'Weekly report updated', body: 'An updated weekly report is ready to view in AcadeMix.' };
      }
      if (notification.title === 'Weekly report available') {
        return { title: 'Weekly report available', body: 'A weekly report is ready to view in AcadeMix.' };
      }
      return generic;
    case 'school_account': {
      const schoolAccountCopy = {
        'School account awaiting review': {
          title: 'School registration awaiting review',
          body: 'A school registration is ready for review in AcadeMix.'
        },
        'School registration resubmitted': {
          title: 'School registration resubmitted',
          body: 'A revised registration is ready for review in AcadeMix.'
        },
        'School account approved': {
          title: 'School account approved', body: 'Your school account is ready in AcadeMix.'
        },
        'School account rejected': {
          title: 'School account rejected', body: 'Open AcadeMix to review the registration decision.'
        },
        'School account suspended': {
          title: 'School account suspended', body: 'Open AcadeMix for details about your school account.'
        },
        'School account reactivated': {
          title: 'School account reactivated', body: 'Your school account is active again.'
        }
      };
      return schoolAccountCopy[notification.title] || generic;
    }
    case 'grading_period_reopen':
      if (['Grade access approved', 'Grade access request rejected',
        'Grade editing deadline extended', 'Grade editing access revoked'].includes(notification.title)) {
        return {
          title: notification.title,
          body: 'Your grade-editing access changed. Open AcadeMix for class and term details.'
        };
      }
      return generic;
    case 'student_transfer':
      if (notification.title === 'New student in your section') {
        return {
          title: 'New student in your section',
          body: 'A student was added to one of your sections. Open AcadeMix to view it.'
        };
      }
      return generic;
    default:
      return generic;
  }
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
        notices.id AS notificationId, notices.type, notices.title, notices.message,
        calendar_notices.detail AS calendarNoticeDetail,
        notices.related_student_user_id AS studentId,
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
      LEFT JOIN holidays AS calendar_notices ON notices.type = 'calendar_notice'
        AND calendar_notices.id = CAST(SUBSTRING_INDEX(notices.event_key, ':', -1) AS UNSIGNED)
        AND calendar_notices.school_id = recipients.school_id
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
      const { title, body } = pushCopyFor(job);
      const payload = JSON.stringify({ title, body,
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
