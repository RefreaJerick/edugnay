const bcrypt = require('bcrypt');
const { getDatabase } = require('../config/database');
const {
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie
} = require('../config/session');

function invalidCredentials(res) {
  return res.status(401).json({ message: 'Invalid school email or password.' });
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

function getCurrentUser(req, res) {
  res.status(200).json({ user: req.user });
}

module.exports = { getCurrentUser, login, logout };
