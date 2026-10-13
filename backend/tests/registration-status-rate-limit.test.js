const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const schoolsRoutes = require('../routes/schools');

test('registration token status, detail, and resubmission routes share rate limiting', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', schoolsRoutes);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    const urls = [
      `http://127.0.0.1:${address.port}/api/schools/registration-status`,
      `http://127.0.0.1:${address.port}/api/schools/registration-details`,
      `http://127.0.0.1:${address.port}/api/schools/registration-resubmit`
    ];
    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      const url = urls[index % urls.length];
      const body = url.endsWith('registration-resubmit')
        ? { registrationStatusToken: 'invalid' }
        : { token: 'invalid' };
      responses.push(await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }));
    }

    assert.ok(responses.slice(0, 30).every(response => response.status === 404));
    assert.equal(responses[30].status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
