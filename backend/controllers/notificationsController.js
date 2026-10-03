const { getDatabase } = require('../config/database');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function limit(value) {
  if (value === undefined) return 50;
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result < 1 || result > 100) throw createError('Notification limit is invalid.');
  return result;
}

async function listNotifications(req, res, next) {
  try {
    const [rows] = await getDatabase().execute(
      `SELECT id, type, title, message, target_path AS targetPath, read_at AS readAt, created_at AS createdAt
      FROM notifications WHERE user_id = ? AND (
        related_student_user_id IS NULL OR (? = 'parent' AND EXISTS (
          SELECT 1 FROM student_parent_links AS links
          INNER JOIN users AS students ON students.id = links.student_user_id
            AND students.school_id = ? AND students.role = 'student' AND students.account_status = 'active'
          WHERE links.school_id = ? AND links.parent_user_id = ?
            AND links.student_user_id = notifications.related_student_user_id
        ))
      ) ORDER BY created_at DESC LIMIT ?`,
      [req.user.id, req.user.role, req.user.schoolId, req.user.schoolId, req.user.id, limit(req.query.limit)]
    );
    res.json({ notifications: rows.map(row => ({ ...row, isRead: Boolean(row.readAt) })) });
  } catch (error) { next(error); }
}

async function markNotificationRead(req, res, next) {
  try {
    const notificationId = parseId(req.params.notificationId, 'notification ID');
    const [result] = await getDatabase().execute('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [notificationId, req.user.id]);
    if (!result.affectedRows) throw createError('Notification was not found.', 404);
    res.status(204).send();
  } catch (error) { next(error); }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    await getDatabase().execute('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
    res.status(204).send();
  } catch (error) { next(error); }
}

module.exports = { listNotifications, markAllNotificationsRead, markNotificationRead };
