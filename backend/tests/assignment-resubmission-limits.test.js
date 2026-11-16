const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-replacements-'));
process.env.ASSIGNMENT_SUBMISSION_DIRECTORY = path.join(testRoot, 'submissions');
const databaseModule = require('../config/database');
const { uploadDirectory } = require('../config/uploads');

let maxResubmissions = null;
let stored = null;
let assignmentLock = Promise.resolve();

databaseModule.getDatabase = () => ({
  async getConnection() {
    let releaseLock;
    return {
      async beginTransaction() {},
      async execute(sql, values) {
        if (sql.startsWith('SELECT id FROM assignments') && sql.includes('FOR UPDATE')) {
          const previousLock = assignmentLock;
          assignmentLock = new Promise(resolve => { releaseLock = resolve; });
          await previousLock;
          return [[{ id: 4 }]];
        }
        if (sql.includes('FROM assignments LEFT JOIN sections') && sql.includes("assignments.status = 'published'")) {
          return [[{ id: 4, schoolId: 1, onlineSubmissionEnabled: 1, maxResubmissions,
            electiveClassId: null, academicYearStatus: 'active' }]];
        }
        if (sql.includes('FROM assignment_submissions') && sql.includes('FOR UPDATE')) {
          return [stored ? [{ filePath: stored.filePath, resubmissionCount: stored.resubmissionCount }] : []];
        }
        if (sql.startsWith('INSERT INTO assignment_submissions')) {
          stored = { filePath: values[4], resubmissionCount: 0 };
          return [{ insertId: 1 }];
        }
        if (sql.startsWith('UPDATE assignment_submissions')) {
          stored = { filePath: values[1], resubmissionCount: values[3] };
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      async commit() { releaseLock?.(); releaseLock = null; },
      async rollback() { releaseLock?.(); releaseLock = null; },
      release() {}
    };
  }
});

const { submitAssignment } = require('../controllers/assignmentsController');

test.after(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

async function upload() {
  const filename = `${randomUUID()}.pdf`;
  const filePath = path.join(uploadDirectory, filename);
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(filePath, '%PDF-1.4\n');
  const result = { status: null, body: null, error: null, filePath };
  await submitAssignment({
    params: { assignmentId: '4' }, user: { id: 8, schoolId: 1, role: 'student' },
    file: { filename, path: filePath, originalname: 'work.pdf', size: 9 }
  }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('first upload is free, replacements use the limit, and rejected files are removed', async () => {
  maxResubmissions = 1;
  stored = null;
  const first = await upload();
  assert.equal(first.error, null);
  assert.equal(first.body.resubmissionCount, 0);
  const second = await upload();
  assert.equal(second.error, null);
  assert.equal(second.body.resubmissionCount, 1);
  await assert.rejects(fs.stat(first.filePath), { code: 'ENOENT' });
  const rejected = await upload();
  assert.equal(rejected.error?.status, 409);
  assert.equal(stored.resubmissionCount, 1);
  assert.equal(stored.filePath, path.basename(second.filePath));
  await assert.rejects(fs.stat(rejected.filePath), { code: 'ENOENT' });
});

test('zero blocks replacements, while raising or clearing the limit reopens them', async () => {
  maxResubmissions = 0;
  stored = null;
  assert.equal((await upload()).error, null);
  assert.equal((await upload()).error?.status, 409);
  maxResubmissions = 1;
  assert.equal((await upload()).body.resubmissionCount, 1);
  maxResubmissions = null;
  assert.equal((await upload()).body.resubmissionCount, 2);
});

test('an existing file starts with zero known replacements; a status-only row is a first upload', async () => {
  maxResubmissions = 1;
  stored = { filePath: `${randomUUID()}.pdf`, resubmissionCount: 0 };
  assert.equal((await upload()).body.resubmissionCount, 1);
  stored = { filePath: null, resubmissionCount: 0 };
  assert.equal((await upload()).body.resubmissionCount, 0);
});

test('two simultaneous replacements cannot both use the last attempt', async () => {
  maxResubmissions = 1;
  stored = { filePath: `${randomUUID()}.pdf`, resubmissionCount: 0 };
  const results = await Promise.all([upload(), upload()]);
  assert.equal(results.filter(result => result.error === null).length, 1);
  assert.equal(results.filter(result => result.error?.status === 409).length, 1);
  assert.equal(stored.resubmissionCount, 1);
});
