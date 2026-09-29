const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
const { errorHandler } = require('../middleware/errorHandler');

let submissionCount = 0;
let gradingItemFound = false;
let assignmentDeleted = false;
let submissionFilePath = null;
const assignment = {
  id: 4, schoolId: 1, sectionId: 8, subjectId: 2, academicTermId: 6,
  gradingCategoryId: 3, teacherUserId: 3, title: 'Reading response'
};

async function executeQuery(sql) {
  if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ? LIMIT 1')) return [[assignment]];
  if (sql.includes('SELECT file_name AS fileName, file_path AS filePath FROM assignment_submissions')) {
    return [submissionFilePath ? [{ fileName: path.basename(submissionFilePath), filePath: submissionFilePath }] : []];
  }
  if (sql.includes('SELECT COUNT(*) AS total FROM assignment_submissions')) return [[{ total: submissionCount }]];
  if (sql.includes('FROM grading_items WHERE')) return [gradingItemFound ? [{ id: 12 }] : []];
  if (sql.startsWith('DELETE FROM assignments')) {
    assignmentDeleted = true;
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected query: ${sql}`);
}

databaseModule.getDatabase = () => ({
  execute: executeQuery,
  async getConnection() {
    return { execute: executeQuery, release() {} };
  }
});

const { deleteAssignment, previewSubmission } = require('../controllers/assignmentsController');

async function callDelete(user = { id: 3, schoolId: 1, role: 'teacher' }) {
  const result = { status: 200, sent: false, error: null };
  await deleteAssignment({ params: { assignmentId: '4' }, user }, {
    status(code) { result.status = code; return this; },
    send() { result.sent = true; }
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

async function withSubmissionFile(extension, callback) {
  const uploadDirectory = path.resolve(__dirname, '../uploads/assignment-submissions');
  await fs.mkdir(uploadDirectory, { recursive: true });
  const temporaryDirectory = await fs.mkdtemp(path.join(uploadDirectory, 'preview-test-'));
  const fileName = `submission${extension}`;
  const filePath = path.join(temporaryDirectory, fileName);
  submissionFilePath = `uploads/assignment-submissions/${path.basename(temporaryDirectory)}/${fileName}`;
  try {
    await fs.writeFile(filePath, extension === '.pdf' ? '%PDF-1.7\nPreview test' : 'test document');
    await callback();
  } finally {
    submissionFilePath = null;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test('assignment deletion is blocked when student submissions exist', async () => {
  submissionCount = 1;
  gradingItemFound = false;
  assignmentDeleted = false;
  const result = await callDelete();
  assert.equal(result.error.status, 409);
  assert.equal(assignmentDeleted, false);
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
