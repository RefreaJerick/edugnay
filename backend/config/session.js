const crypto = require('crypto');
const { getDatabase } = require('./database');

const SESSION_COOKIE_NAME = 'academix_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getSessionToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const sessionCookie = cookies.find(cookie => cookie.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!sessionCookie) return null;

  try {
    return decodeURIComponent(sessionCookie.split('=').slice(1).join('='));
  } catch {
    return null;
  }
}

async function createSession(userId) {
  const database = getDatabase();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await database.execute('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  await database.execute(
    'INSERT INTO user_sessions (user_id, session_token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, hashSessionToken(token), expiresAt]
  );

  return token;
}

async function deleteSession(token) {
  if (!token) return;

  const database = getDatabase();
  await database.execute('DELETE FROM user_sessions WHERE session_token_hash = ?', [hashSessionToken(token)]);
}

async function deleteSessionsForUser(userId) {
  const database = getDatabase();
  await database.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
}

async function getSessionUser(token) {
  if (!token) return null;

  const database = getDatabase();
  const [users] = await database.execute(
    `SELECT
      users.id,
      users.school_id AS schoolId,
      users.role,
      users.school_email AS schoolEmail,
      users.personal_email AS personalEmail,
      users.account_status AS accountStatus,
      users.first_name AS firstName,
      users.last_name AS lastName,
      users.display_name AS displayName,
      users.initials,
      users.setup_completed_at AS setupCompletedAt
    FROM user_sessions
    INNER JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.session_token_hash = ?
      AND user_sessions.expires_at > NOW()
      AND users.account_status = 'active'
    LIMIT 1`,
    [hashSessionToken(token)]
  );

  return users[0] || null;
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DURATION_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });
}

module.exports = {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  getSessionToken,
  getSessionUser,
  setSessionCookie
};
