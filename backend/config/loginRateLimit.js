const crypto = require('node:crypto');
const { ipKeyGenerator } = require('express-rate-limit');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MAX_FAILURES = 5;
const NETWORK_MAX_FAILURES = 100;
const LIMIT_MESSAGE = { message: 'Too many sign-in attempts. Please try again later.' };

function loginEmail(req) {
  const email = req.body?.schoolEmail;
  if (typeof email !== 'string') return '';
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 255 ? normalized : '';
}

function createLoginLimiter({
  windowMs = LOGIN_WINDOW_MS,
  accountMax = ACCOUNT_MAX_FAILURES,
  networkMax = NETWORK_MAX_FAILURES
} = {}) {
  const networkFailures = new Map();
  const accountFailures = new Map();
  let lastSweep = Date.now();

  function activeFailure(store, key, now) {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now) {
      store.delete(key);
      return null;
    }
    return entry || null;
  }

  function recordFailure(store, key, now) {
    const entry = activeFailure(store, key, now);
    if (entry) entry.count += 1;
    else store.set(key, { count: 1, expiresAt: now + windowMs });
  }

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep >= windowMs) {
      for (const store of [networkFailures, accountFailures]) {
        for (const [key, entry] of store) {
          if (entry.expiresAt <= now) store.delete(key);
        }
      }
      lastSweep = now;
    }

    const networkKey = ipKeyGenerator(req.ip);
    const email = loginEmail(req);
    const accountKey = email ? crypto.createHash('sha256').update(email).digest('hex') : null;
    const network = activeFailure(networkFailures, networkKey, now);
    const account = accountKey ? activeFailure(accountFailures, accountKey, now) : null;
    const blocked = network?.count >= networkMax ? network : account?.count >= accountMax ? account : null;

    if (blocked) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((blocked.expiresAt - now) / 1000))));
      return res.status(429).json(LIMIT_MESSAGE);
    }

    res.once('finish', () => {
      if (res.statusCode !== 401) return;
      const finishedAt = Date.now();
      recordFailure(networkFailures, networkKey, finishedAt);
      if (accountKey) recordFailure(accountFailures, accountKey, finishedAt);
    });
    next();
  };
}

module.exports = { createLoginLimiter, LOGIN_WINDOW_MS, ACCOUNT_MAX_FAILURES, NETWORK_MAX_FAILURES };
