const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
const { uploadDirectory } = require('../config/uploads');
const { errorHandler } = require('../middleware/errorHandler');

let submissionCount = 0;
let gradingItemFound = false;
let assignmentDeleted = false;
let submissionsDeleted = false;
let submissionFileNames = [];
let submissionFilePath = null;
let listedSubmissionRows = [];
const assignment = {
  id: 4, schoolId: 1, sectionId: 8, subjectId: 2, academicTermId: 6,
  gradingCategoryId: 3, teacherUserId: 3, title: 'Reading response'
};

async function executeQuery(sql) {
  if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ? LIMIT 1')) return [[assignment]];
  if (sql.includes('FROM assignment_submissions INNER JOIN users AS students')) return [listedSubmissionRows];
  if (sql.includes('SELECT file_name AS fileName, file_path AS filePath FROM assignment_submissions')) {
    return [submissionFilePath ? [{ fileName: path.basename(submissionFilePath), filePath: submissionFilePath }] : []];
  }
  if (sql.includes('FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? FOR UPDATE')) {
    return [Array.from({ length: submissionCount }, (_, index) => ({ id: index + 1, filePath: submissionFileNames[index] || null }))];
  }
  if (sql.includes('FROM grading_items WHERE')) return [gradingItemFound ? [{ id: 12 }] : []];
  if (sql.startsWith('DELETE FROM assignment_submissions')) {
    submissionsDeleted = true;
    return [{ affectedRows: submissionCount }];
  }
  if (sql.startsWith('DELETE FROM assignments')) {
    assignmentDeleted = true;
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1 }];
  throw new Error(`Unexpected query: ${sql}`);
}

databaseModule.getDatabase = () => ({
  execute: executeQuery,
  async getConnection() {
    return { execute: executeQuery, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  }
});

const { deleteAssignment, listSubmissions, previewSubmission, submitAssignment } = require('../controllers/assignmentsController');

async function callDelete(user = { id: 3, schoolId: 1, role: 'teacher' }, expectedSubmissionCount = submissionCount) {
  const result = { status: 200, sent: false, body: null, error: null };
  await deleteAssignment({ params: { assignmentId: '4' }, query: { expectedSubmissionCount }, user }, {
    status(code) { result.status = code; return this; },
    send() { result.sent = true; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

async function callPreview(user = { id: 3, schoolId: 1, role: 'teacher' }) {
  const result = { headers: null, body: null, error: null };
  await previewSubmission({ params: { assignmentId: '4', submissionId: '11' }, user }, {
    set(headers) { result.headers = headers; return this; },
    send(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

async function callListSubmissions(user = { id: 3, schoolId: 1, role: 'teacher' }) {
  const result = { body: null, error: null };
  await listSubmissions({ params: { assignmentId: '4' }, user }, {
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

async function withSubmissionFile(extension, callback) {
  await fs.mkdir(uploadDirectory, { recursive: true });
  const fileName = `${randomUUID()}${extension}`;
  const filePath = path.join(uploadDirectory, fileName);
  submissionFilePath = fileName;
  try {
    await fs.writeFile(filePath, extension === '.pdf' ? '%PDF-1.7\nPreview test' : 'test document');
    await callback();
  } finally {
    submissionFilePath = null;
    await fs.rm(filePath, { force: true });
  }
}

test('assignment submission rejects content that does not match its extension', async () => {
  const fileName = `${randomUUID()}.pdf`;
  const filePath = path.join(uploadDirectory, fileName);
  await fs.writeFile(filePath, 'not a PDF');
  const result = { error: null };
  await submitAssignment({
    params: { assignmentId: '4' }, user: { id: 8, schoolId: 1, role: 'student' },
    file: { path: filePath, filename: fileName, originalname: 'work.pdf', size: 9 }
  }, {}, error => { result.error = error; });
  assert.equal(result.error?.status, 400);
  assert.match(result.error?.message, /contents do not match/);
  await assert.rejects(fs.stat(filePath), error => error.code === 'ENOENT');
});

test('assignment deletion removes submitted records and their private files', async () => {
  submissionCount = 2;
  gradingItemFound = false;
  assignmentDeleted = false;
  submissionsDeleted = false;
  await fs.mkdir(uploadDirectory, { recursive: true });
  submissionFileNames = [randomUUID() + '.pdf', randomUUID() + '.pdf'];
  const filePaths = submissionFileNames.map(name => path.join(uploadDirectory, name));
  try {
    await Promise.all(filePaths.map(filePath => fs.writeFile(filePath, '%PDF-1.7\nTest')));
    const result = await callDelete();
    assert.ifError(result.error);
    assert.equal(result.status, 204);
    assert.equal(submissionsDeleted, true);
    assert.equal(assignmentDeleted, true);
    for (const filePath of filePaths) {
      await assert.rejects(fs.stat(filePath), error => error.code === 'ENOENT');
    }
  } finally {
    submissionFileNames = [];
    await Promise.all(filePaths.map(filePath => fs.rm(filePath, { force: true })));
  }
});

test('changed submission count prevents deletion until the teacher confirms again', async () => {
  submissionCount = 2;
  submissionsDeleted = false;
  assignmentDeleted = false;
  const result = await callDelete(undefined, 1);
  assert.match(result.error?.message || '', /Submissions changed/);
  assert.equal(submissionsDeleted, false);
  assert.equal(assignmentDeleted, false);
});

test('deletion requires a reviewed submission count', async () => {
  assignmentDeleted = false;
  let rejection;
  await deleteAssignment({ params: { assignmentId: '4' }, query: {}, user: { id: 3, schoolId: 1, role: 'teacher' } }, {}, error => { rejection = error; });
  assert.equal(rejection?.status, 400);
  assert.equal(assignmentDeleted, false);
});

test('a missing uploaded file does not prevent confirmed deletion', async () => {
  submissionCount = 1;
  submissionFileNames = [randomUUID() + '.pdf'];
  try {
    const result = await callDelete();
    assert.ifError(result.error);
    assert.equal(result.status, 204);
  } finally { submissionFileNames = []; }
});

test('file cleanup failure is reported after database deletion succeeds', async () => {
  submissionCount = 1;
  submissionFileNames = [randomUUID() + '.pdf'];
  const originalUnlink = fs.unlink;
  fs.unlink = async () => { const error = new Error('Denied'); error.code = 'EPERM'; throw error; };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await callDelete();
    assert.ifError(result.error);
    assert.equal(result.status, 200);
    assert.equal(result.body.fileCleanupPending, true);
    assert.equal(assignmentDeleted, true);
  } finally {
    fs.unlink = originalUnlink;
    console.error = originalError;
    submissionFileNames = [];
  }
});

test('an invalid stored file path is never followed during deletion', async () => {
  submissionCount = 1;
  submissionFileNames = ['../unexpected.pdf'];
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await callDelete();
    assert.ifError(result.error);
    assert.equal(result.status, 200);
    assert.equal(result.body.fileCleanupPending, true);
  } finally {
    console.error = originalError;
    submissionFileNames = [];
  }
});

test('assignment deletion is blocked when a matching score item exists', async () => {
  submissionCount = 0;
  gradingItemFound = true;
  assignmentDeleted = false;
  const result = await callDelete();
  assert.equal(result.error.status, 409);
  assert.equal(assignmentDeleted, false);
});

test('an owned assignment without submissions or score items can be deleted', async () => {
  submissionCount = 0;
  gradingItemFound = false;
  assignmentDeleted = false;
  const result = await callDelete();
  assert.equal(result.error, null);
  assert.equal(result.status, 204);
  assert.equal(result.sent, true);
  assert.equal(assignmentDeleted, true);
});

test('a teacher cannot delete another teacher’s assignment', async () => {
  submissionCount = 0;
  gradingItemFound = false;
  assignmentDeleted = false;
  const result = await callDelete({ id: 99, schoolId: 1, role: 'teacher' });
  assert.equal(result.error.status, 404);
  assert.equal(assignmentDeleted, false);
});

test('an assigned teacher receives a private inline PDF preview', async () => {
  await withSubmissionFile('.pdf', async () => {
    const result = await callPreview();
    assert.equal(result.error, null);
    assert.equal(result.headers['Content-Type'], 'application/pdf');
    assert.equal(result.headers['Content-Disposition'], 'inline; filename="assignment-submission-preview.pdf"');
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal(result.body.toString('ascii', 0, 5), '%PDF-');
  });
});

test('a teacher cannot preview another teacher’s submission', async () => {
  await withSubmissionFile('.pdf', async () => {
    const result = await callPreview({ id: 99, schoolId: 1, role: 'teacher' });
    assert.equal(result.error.status, 404);
    assert.equal(result.body, null);
  });
});

test('submission listing hides stored server paths and returns a protected file URL', async () => {
  listedSubmissionRows = [{
    id: 11, assignmentId: 4, studentId: 8, studentName: 'Student Example',
    fileName: 'work.pdf', filePath: 'uploads/assignment-submissions/work.pdf',
    fileSizeBytes: 512, submissionStatus: 'submitted', submittedAt: '2026-09-29T10:00:00.000Z'
  }];
  try {
    const result = await callListSubmissions();
    assert.equal(result.error, null);
    assert.equal(result.body.submissions[0].fileUrl, '/api/assignments/4/submissions/11/download');
    assert.equal(Object.hasOwn(result.body.submissions[0], 'filePath'), false);
  } finally {
    listedSubmissionRows = [];
  }
});

test('Office preview reports when LibreOffice is not installed or configured', async () => {
  const originalPath = process.env.LIBREOFFICE_PATH;
  await withSubmissionFile('.docx', async () => {
    process.env.LIBREOFFICE_PATH = path.join(os.tmpdir(), 'academix-missing-libreoffice.exe');
    try {
      const result = await callPreview();
      assert.equal(result.error.status, 503);
      assert.match(result.error.message, /LibreOffice/);
      let responseStatus = 0;
      let responseBody = null;
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        errorHandler(result.error, { originalUrl: '/api/assignments/4/submissions/11/preview' }, {
          status(code) { responseStatus = code; return this; },
          json(body) { responseBody = body; }
        });
      } finally {
        console.error = originalConsoleError;
      }
      assert.equal(responseStatus, 503);
      assert.match(responseBody.message, /LibreOffice/);
    } finally {
      if (originalPath === undefined) delete process.env.LIBREOFFICE_PATH;
      else process.env.LIBREOFFICE_PATH = originalPath;
    }
  });
});
