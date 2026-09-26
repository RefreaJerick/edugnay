const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDatabase } = require('../config/database');
const { isEmailConfigured, sendPasswordResetEmail } = require('../config/email');
const {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  setSessionCookie
} = require('../config/session');

const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_RESET_DURATION_MS = 60 * 60 * 1000;

function invalidCredentials(res) {
  return res.status(401).json({ message: 'Invalid school email or password.' });
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function login(req, res, next) {
  try {
    const schoolEmail = String(req.body.schoolEmail || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!schoolEmail || !password || schoolEmail.length > 255 || password.length > 128) {
      return invalidCredentials(res);
    }

    const database = getDatabase();
    const [users] = await database.execute(
      `SELECT
        id,
        school_id AS schoolId,
        role,
        school_email AS schoolEmail,
        personal_email AS personalEmail,
        account_status AS accountStatus,
        first_name AS firstName,
        last_name AS lastName,
        display_name AS displayName,
        initials,
        setup_completed_at AS setupCompletedAt,
        password_hash AS passwordHash
      FROM users
      WHERE school_email = ?
      LIMIT 1`,
      [schoolEmail]
    );

    const user = users[0];
    if (!user || user.accountStatus !== 'active' || !(await bcrypt.compare(password, user.passwordHash))) {
      return invalidCredentials(res);
    }

    const token = await createSession(user.id);
    await database.execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    delete user.passwordHash;
    setSessionCookie(res, token);

    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    await deleteSession(req.sessionToken);
    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword || currentPassword.length > 128 || newPassword.length > 128) {
      return res.status(400).json({ message: 'Current password and new password are required.' });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from your current password.' });
    }

    const database = getDatabase();
    const [users] = await database.execute(
      'SELECT password_hash AS passwordHash FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    const user = users[0];

    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await database.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);

    await deleteSessionsForUser(req.user.id);
    const token = await createSession(req.user.id);
    setSessionCookie(res, token);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function requestPasswordReset(req, res, next) {
  try {
    const schoolEmail = String(req.body.schoolEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(schoolEmail) || schoolEmail.length > 255) {
      return res.status(204).send();
    }
    if (!isEmailConfigured()) {
      const error = new Error('Password reset email is unavailable. Please try again later.');
      error.status = 503;
      throw error;
    }

    const database = getDatabase();
    const [users] = await database.execute(
      `SELECT id, school_email AS schoolEmail, personal_email AS personalEmail, display_name AS displayName
      FROM users
      WHERE school_email = ? AND account_status = 'active'
      LIMIT 1`,
      [schoolEmail]
    );
    const user = users[0];
    if (!user) return res.status(204).send();

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_DURATION_MS);
    await database.execute('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await database.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );

    const delivery = await sendPasswordResetEmail(user, token);
    if (delivery.status !== 'sent') {
      await database.execute('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
      const error = new Error('Password reset email is unavailable. Please try again later.');
      error.status = 503;
      throw error;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

async function confirmPasswordReset(req, res, next) {
  let connection;
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (!token || token.length > 128 || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
      const error = new Error('This reset link is missing, expired, or invalid.');
      error.status = 400;
      throw error;
    }

    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [tokens] = await connection.execute(
      `SELECT user_id AS userId
      FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
      LIMIT 1 FOR UPDATE`,
      [hashResetToken(token)]
    );
    const reset = tokens[0];
    if (!reset) {
      const error = new Error('This reset link is missing, expired, or invalid.');
      error.status = 400;
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, reset.userId]);
    await connection.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?', [hashResetToken(token)]);
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [reset.userId]);
    await connection.commit();
    res.status(204).send();
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

function getCurrentUser(req, res) {
  res.status(200).json({ user: req.user });
}

module.exports = { changePassword, confirmPasswordReset, getCurrentUser, login, logout, requestPasswordReset };
