const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Phase 3 API runner is limited to the Capstone school and requires a recent verified backup', () => {
  const script = read('backend/scripts/testShsCapstoneApi.js');
  assert.match(script, /const SCHOOL_CODE = 'CAPSTONE-SHS-TEST'/);
  assert.match(script, /--school-code/);
  assert.match(script, /--backup/);
  assert.match(script, /database\/backups/);
  assert.match(script, /QA_PASSWORD/);
  assert.ok(script.indexOf('const qaPassword = process.env.QA_PASSWORD;')
    < script.indexOf("require('dotenv').config"), 'QA_PASSWORD must come from the shell, not .env.');
  assert.match(script, /apiUrl\.hostname !== '127\.0\.0\.1'/);
  assert.match(script, /apiUrl\.port === '3000'/);
  assert.match(script, /countOutsideSchool/);
  assert.match(script, /The other school’s SHS records must remain unchanged/);
  assert.doesNotMatch(script, /shs-selection\/windows|shs-program\/completion/);
  assert.match(script, /Object\.hasOwn\(program, 'readiness'\)/);
  assert.doesNotMatch(script, /DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE/i);
});

test('temporary API can bind loopback and skip background workers without changing normal defaults', () => {
  const server = read('backend/server.js');
  assert.match(server, /const host = process\.env\.HOST \|\| undefined/);
  assert.match(server, /app\.listen\(port, host/);
  assert.match(server, /DISABLE_BACKGROUND_WORKERS !== 'true'/);
  assert.match(server, /startAnnouncementEmailWorker\(\)/);
  assert.match(server, /startScheduledAnnouncementWorker\(\)/);
});
