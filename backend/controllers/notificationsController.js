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
      FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [req.user.id, limit(req.query.limit)]
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
