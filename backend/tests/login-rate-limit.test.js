const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createLoginLimiter } = require('../config/loginRateLimit');

async function withLoginServer(limits, run, { successDelayMs = 0 } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/api/auth/login', createLoginLimiter(limits), async (req, res) => {
    if (req.body.password === 'correct' && successDelayMs) {
      await new Promise(resolve => setTimeout(resolve, successDelayMs));
    }
    res.sendStatus(req.body.password === 'correct' ? 200 : req.body.password === 'error' ? 503 : 401);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    await run((schoolEmail, password = 'wrong', ip = '192.0.2.10') => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ schoolEmail, password })
    }));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('simultaneous valid sign-ins from one IP do not hit the failed-attempt limit', async () => {
  await withLoginServer({}, async login => {
    const responses = await Promise.all(Array.from({ length: 110 }, (_, index) =>
      login(`student${index}@school.test`, 'correct')));
    assert.deepEqual(new Set(responses.map(response => response.status)), new Set([200]));
    assert.equal((await login('student111@school.test')).status, 401);
  }, { successDelayMs: 100 });
});

test('simultaneous wrong passwords count once they finish', async () => {
  await withLoginServer({ accountMax: 2, networkMax: 20 }, async login => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => login('student@school.test')));
    assert.ok(responses.some(response => response.status === 401));
    assert.equal((await login('student@school.test')).status, 429);
  });
});

test('IPv6 addresses in the same subnet share the network failure limit', async () => {
  await withLoginServer({ accountMax: 5, networkMax: 2 }, async login => {
    assert.equal((await login('one@school.test', 'wrong', '2001:db8:1234:5600::1')).status, 401);
    assert.equal((await login('two@school.test', 'wrong', '2001:db8:1234:56ff::2')).status, 401);
    assert.equal((await login('three@school.test', 'correct', '2001:db8:1234:5600::3')).status, 429);
  });
});

test('five failed attempts affect one normalized email, not other accounts or IPs', async () => {
  await withLoginServer({}, async login => {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await login(index % 2 ? ' Student@School.Test ' : 'student@school.test', 'wrong', `192.0.2.${index + 10}`)).status, 401);
    }
    const blocked = await login('student@school.test');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.equal((await login('teacher@school.test', 'correct')).status, 200);
  });
});

test('100 failed attempts from one IP block its next attempt only', async () => {
  await withLoginServer({}, async login => {
    for (let index = 0; index < 100; index += 1) {
      assert.equal((await login(`student${index}@school.test`)).status, 401, `attempt ${index + 1}`);
    }
    const blocked = await login('next@school.test', 'wrong');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.equal((await login('next@school.test', 'correct', '192.0.2.11')).status, 200);
  });
});

test('successful logins, server errors, and account-limit responses do not spend the IP quota', async () => {
  await withLoginServer({ accountMax: 2, networkMax: 3 }, async login => {
    for (let index = 0; index < 4; index += 1) {
      assert.equal((await login('good@school.test', 'correct')).status, 200);
      assert.equal((await login('error@school.test', 'error')).status, 503);
    }
    assert.equal((await login('one@school.test')).status, 401);
    assert.equal((await login('one@school.test')).status, 401);
    assert.equal((await login('one@school.test')).status, 429);
    assert.equal((await login('two@school.test')).status, 401);
    assert.equal((await login('three@school.test')).status, 429);
  });
});

test('unusable emails use the IP limit and the allowance resets after the window', async () => {
  await withLoginServer({ windowMs: 100, accountMax: 1, networkMax: 2 }, async login => {
    assert.equal((await login('')).status, 401);
    assert.equal((await login('x'.repeat(256))).status, 401);
    assert.equal((await login('student@school.test')).status, 429);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await login('student@school.test')).status, 401);
  });
});

test('one email can retry after its own window resets', async () => {
  await withLoginServer({ windowMs: 100, accountMax: 1, networkMax: 10 }, async login => {
    assert.equal((await login('student@school.test')).status, 401);
    assert.equal((await login('student@school.test')).status, 429);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await login('student@school.test')).status, 401);
  });
});
