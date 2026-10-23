const { createHash } = require('node:crypto');
const { getDatabase } = require('../config/database');

function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function endpointHash(endpoint) {
  return createHash('sha256').update(endpoint).digest();
}

function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
        host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
        host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

function parseSubscription(body) {
  const endpoint = body?.endpoint;
  if (!validEndpoint(endpoint) || !body.keys ||
    !/^[A-Za-z0-9_-]{20,255}$/.test(body.keys.p256dh || '') ||
    !/^[A-Za-z0-9_-]{10,255}$/.test(body.keys.auth || '')) {
    const error = new Error('This device subscription is invalid.');
    error.status = 400;
    throw error;
  }
  return { endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
}

async function pushKey(req, res) {
  res.json({ enabled: pushConfigured(), publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null });
}

async function status(req, res, next, database = getDatabase()) {
  try {
    const endpoint = req.body?.endpoint;
    if (!validEndpoint(endpoint)) return res.json({ enabled: false });
    const [[row]] = await database.execute(
      `SELECT subscriptions.id FROM push_subscriptions AS subscriptions
      INNER JOIN user_sessions AS sessions ON sessions.id = subscriptions.session_id
        AND sessions.user_id = subscriptions.user_id AND sessions.expires_at > NOW()
      WHERE subscriptions.endpoint_hash = ? AND subscriptions.user_id = ?
        AND sessions.session_token_hash = ? LIMIT 1`,
      [endpointHash(endpoint), req.user.id, createHash('sha256').update(req.sessionToken).digest('hex')]
    );
    res.json({ enabled: Boolean(row) });
  } catch (error) { next(error); }
}

async function subscribe(req, res, next, database = getDatabase()) {
  try {
    if (!pushConfigured()) return res.status(503).json({ message: 'Device notifications are not configured yet.' });
    const subscription = parseSubscription(req.body);
    const hash = createHash('sha256').update(req.sessionToken).digest('hex');
    const [[session]] = await database.execute(
      'SELECT id FROM user_sessions WHERE user_id = ? AND session_token_hash = ? AND expires_at > NOW() LIMIT 1',
      [req.user.id, hash]
    );
    if (!session) return res.status(401).json({ message: 'Please sign in again.' });
    await database.execute(
      `INSERT INTO push_subscriptions (user_id, school_id, session_id, endpoint, endpoint_hash, p256dh, auth_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), school_id = VALUES(school_id),
        session_id = VALUES(session_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth_key = VALUES(auth_key)`,
      [req.user.id, req.user.schoolId || null, session.id, subscription.endpoint,
        endpointHash(subscription.endpoint), subscription.p256dh, subscription.auth]
    );
    res.status(201).json({ enabled: true });
  } catch (error) { next(error); }
}

async function unsubscribe(req, res, next, database = getDatabase()) {
  try {
    const endpoint = req.body?.endpoint;
    if (!validEndpoint(endpoint)) return res.status(204).send();
    await database.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?',
      [endpointHash(endpoint), req.user.id]);
    res.status(204).send();
  } catch (error) { next(error); }
}

module.exports = { pushKey, status, subscribe, unsubscribe, validEndpoint, parseSubscription };
