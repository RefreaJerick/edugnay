const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const helper = source.match(/function apiResponseError\(response, data, fallback\) \{[\s\S]*?\n\}/)?.[0];

test('API errors distinguish rate limiting, session expiry, and service failures', () => {
  assert.ok(helper);
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  const response = (status, retryAfter) => ({ status, headers: { get: () => retryAfter } });

  const limited = context.apiResponseError(response(429, '125'), null, 'Failed');
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfterSeconds, 125);
  assert.match(limited.message, /3 minutes/);

  const expired = context.apiResponseError(response(401), { message: 'Please sign in first.' }, 'Failed');
  assert.equal(expired.message, 'Please sign in first.');

  const unavailable = context.apiResponseError(response(503), null, 'Server unavailable.');
  assert.equal(unavailable.message, 'Server unavailable.');
});
