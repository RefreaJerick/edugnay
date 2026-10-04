const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getSessionToken, getSessionUser } = require('./session');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 1200;
const NETWORK_MAX_REQUESTS = 30000;

function sendRateLimitResponse(req, res, options, windowMs) {
  console.warn(`API rate limit reached: ${req.method} ${req.path}`);
  res.status(options.statusCode).json({
    ...options.message,
    retryAfterSeconds: Number(res.getHeader('Retry-After')) || Math.ceil(windowMs / 1000)
  });
}

function createApiRateLimit(limit = MAX_REQUESTS, resolveSessionUser = getSessionUser, windowMs = WINDOW_MS) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => req.path === '/health',
    async keyGenerator(req) {
      const token = getSessionToken(req);
      if (token) {
        const user = await resolveSessionUser(token);
        if (user) {
          req.user = user;
          req.sessionToken = token;
          return `user:${user.id}`;
        }
      }
      return `ip:${ipKeyGenerator(req.ip)}`;
    },
    message: { message: 'Too many requests. Please try again in a few minutes.' },
    handler(req, res, next, options) { sendRateLimitResponse(req, res, options, windowMs); }
  });
}

const apiRateLimit = createApiRateLimit();
function createNetworkRateLimit(limit = NETWORK_MAX_REQUESTS) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    skip: req => req.path === '/health',
    message: { message: 'Too many requests from this network. Please try again later.' },
    handler(req, res, next, options) { sendRateLimitResponse(req, res, options, WINDOW_MS); }
  });
}
const networkRateLimit = createNetworkRateLimit();

module.exports = { apiRateLimit, networkRateLimit, createApiRateLimit, createNetworkRateLimit, WINDOW_MS, MAX_REQUESTS, NETWORK_MAX_REQUESTS };
