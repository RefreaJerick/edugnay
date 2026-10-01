const assert = require('node:assert/strict');
const test = require('node:test');

const { getFrontendOrigin, getTrustProxyHops } = require('../config/deployment');
const { getSessionCookieOptions } = require('../config/session');
const { createRequestOriginGuard } = require('../middleware/requestOrigin');

test('frontend origin must be one exact http or https origin', () => {
  assert.equal(getFrontendOrigin('http://127.0.0.1:5500'), 'http://127.0.0.1:5500');
  assert.equal(getFrontendOrigin('https://school.example.com'), 'https://school.example.com');
  assert.throws(() => getFrontendOrigin('*'), /FRONTEND_ORIGIN/);
  assert.throws(() => getFrontendOrigin('https://school.example.com/path'), /FRONTEND_ORIGIN/);
  assert.throws(() => getFrontendOrigin('https://school.example.com/'), /FRONTEND_ORIGIN/);
});

test('trusted proxy hops stay disabled unless a positive hop count is configured', () => {
  assert.equal(getTrustProxyHops(''), 0);
  assert.equal(getTrustProxyHops('1'), 1);
  assert.throws(() => getTrustProxyHops('all'), /TRUST_PROXY_HOPS/);
  assert.throws(() => getTrustProxyHops('0'), /TRUST_PROXY_HOPS/);
});

test('session cookie settings keep production cookies secure and validate cross-site mode', () => {
  assert.deepEqual(getSessionCookieOptions({ NODE_ENV: 'development' }), {
    httpOnly: true, sameSite: 'lax', secure: false, path: '/'
  });
  assert.equal(getSessionCookieOptions({
    NODE_ENV: 'production', SESSION_COOKIE_SAME_SITE: 'none', SESSION_COOKIE_SECURE: 'true'
  }).secure, true);
  assert.throws(() => getSessionCookieOptions({
    NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false'
  }), /Secure in production/);
  assert.throws(() => getSessionCookieOptions({
    NODE_ENV: 'development', SESSION_COOKIE_SAME_SITE: 'none'
  }), /SameSite=None requires/);
});

test('state-changing browser requests require the configured frontend origin', () => {
  const guard = createRequestOriginGuard('https://school.example.com');

  function check(method, origin) {
    const result = { status: null, message: null, continued: false };
    const response = {
      status(code) { result.status = code; return this; },
      json(body) { result.message = body.message; return this; }
    };
    guard({ method, get: () => origin }, response, () => { result.continued = true; });
    return result;
  }

  assert.equal(check('GET').continued, true);
  assert.equal(check('POST', 'https://school.example.com').continued, true);
  assert.equal(check('PATCH', 'https://attacker.example').status, 403);
  assert.equal(check('DELETE').status, 403);
});
