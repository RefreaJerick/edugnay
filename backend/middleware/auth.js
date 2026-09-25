const { clearSessionCookie, getSessionToken, getSessionUser } = require('../config/session');

async function requireAuth(req, res, next) {
  try {
    const token = getSessionToken(req);
    const user = await getSessionUser(token);

    if (!user) {
      clearSessionCookie(res);
      return res.status(401).json({ message: 'Please sign in first.' });
    }

    req.sessionToken = token;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth };
