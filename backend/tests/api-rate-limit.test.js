const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createApiRateLimit, createNetworkRateLimit, MAX_REQUESTS } = require('../config/apiRateLimit');
const { requireAuth } = require('../middleware/auth');

test('normal API traffic has room above the old 300-request limit', () => {
  assert.ok(MAX_REQUESTS > 300);
});

test('ordinary browsing does not stop at the former 300-request ceiling', async () => {
  const app = express();
  app.use('/api', createApiRateLimit());
  app.get('/api/users', (req, res) => res.sendStatus(200));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/users`;
    for (let index = 0; index < 320; index += 1) {
      assert.equal((await fetch(url)).status, 200, `request ${index + 1}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('signed-in users on one network have separate quotas', async () => {
  const app = express();
  app.use('/api', createApiRateLimit(2, async token => ({ id: token })));
  app.get('/api/users', (req, res) => res.json({ userId: req.user?.id || null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/users`;
    const get = token => fetch(url, { headers: { Cookie: `academix_session=${token}` } });
    assert.equal((await get('student-one')).status, 200);
    assert.equal((await get('student-one')).status, 200);
    assert.equal((await get('student-two')).status, 200);
    assert.equal((await get('student-one')).status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('authentication reuses the verified user from the limiter', async () => {
  let lookups = 0;
  const app = express();
  app.use('/api', createApiRateLimit(2, async () => { lookups += 1; return { id: 7, role: 'student' }; }));
  app.get('/api/me', requireAuth, (req, res) => res.json({ id: req.user.id }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/me`, {
      headers: { Cookie: 'academix_session=verified-token' }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, 7);
    assert.equal(lookups, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a shared network ceiling still protects the API', async () => {
  const app = express();
  app.use('/api', createNetworkRateLimit(2), createApiRateLimit(10, async token => ({ id: token })));
  app.get('/api/health', (req, res) => res.sendStatus(200));
  app.get('/api/users', (req, res) => res.sendStatus(200));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = token => fetch(`${base}/api/users`, { headers: { Cookie: `academix_session=${token}` } });
    assert.equal((await get('one')).status, 200);
    assert.equal((await get('two')).status, 200);
    assert.equal((await get('three')).status, 429);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a user can retry after the quota window resets without restarting', async () => {
  const app = express();
  app.use('/api', createApiRateLimit(1, async () => null, 100));
  app.get('/api/users', (req, res) => res.sendStatus(200));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/users`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 429);
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('health stays available and a full general quota gives a clear retry response', async () => {
  const app = express();
  app.use('/api', createApiRateLimit(2));
  app.get('/api/health', (req, res) => res.json({ ready: true }));
  app.get('/api/users', (req, res) => res.json({ users: [] }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/users`)).status, 200);
    assert.equal((await fetch(`${base}/api/users`)).status, 200);
    const limited = await fetch(`${base}/api/users`);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match((await limited.json()).message, /Too many requests/);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a sensitive endpoint keeps its own stricter limit', async () => {
  const app = express();
  const loginLimit = rateLimit({ windowMs: 900000, limit: 1 });
  app.use('/api', createApiRateLimit(10));
  app.post('/api/auth/login', loginLimit, (req, res) => res.sendStatus(200));
  app.get('/api/users', (req, res) => res.sendStatus(200));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status, 429);
    assert.equal((await fetch(`${base}/api/users`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
