const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const schoolsRoutes = require('../routes/schools');

test('registration status lookup is rate limited', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', schoolsRoutes);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/schools/registration-status`;
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid' })
      }));
    }

    assert.ok(responses.slice(0, 10).every(response => response.status === 404));
    assert.equal(responses[10].status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
