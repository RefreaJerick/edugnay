const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testUploadRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-assignment-tests-'));
process.env.ASSIGNMENT_SUBMISSION_DIRECTORY = path.join(testUploadRoot, 'assignment-submissions');
process.env.MATERIAL_UPLOAD_DIRECTORY = path.join(testUploadRoot, 'learning-materials');

const databaseModule = require('../config/database');
const { uploadDirectory } = require('../config/uploads');
const { errorHandler } = require('../middleware/errorHandler');

test.after(async () => {
  await fs.rm(testUploadRoot, { recursive: true, force: true });
  await assert.rejects(fs.stat(testUploadRoot), error => error.code === 'ENOENT');
});

let submissionCount = 0;
let gradingItemFound = false;
let assignmentDeleted = false;
let submissionsDeleted = false;
let submissionFileNames = [];
let submissionFilePath = null;
let listedSubmissionRows = [];
let listedStudentSubmissionRows = [];
const assignment = {
  id: 4, schoolId: 1, sectionId: 8, subjectId: 2, academicTermId: 6,
  gradingCategoryId: 3, teacherUserId: 3, title: 'Reading response'
};

async function executeQuery(sql, params = []) {
  if (sql.includes('FROM section_teachers INNER JOIN sections')
      && sql.includes('communication_component_code <=> ?')) {
    return [[{ schoolId: assignment.schoolId, subjectCode: 'math', communicationComponentCode: null }]];
  }
  if (sql.includes("assignments.status = 'published'") && sql.includes('FROM assignments')) {
    return [Number(params[0]) === 4 && Number(params[1]) === 1 && Number(params[2]) === 8 ? [assignment] : []];
  }
  if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ?')
      && sql.includes('FROM assignments')) return [[assignment]];
  if (sql.includes('FROM assignment_submissions INNER JOIN users AS students')) return [listedSubmissionRows];
  if (sql.includes('FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? AND student_user_id = ?')) {
    return [Number(params[0]) === 1 && Number(params[1]) === 4 && Number(params[2]) === 8 ? listedStudentSubmissionRows : []];
  }
  if (sql.includes('SELECT file_name AS fileName, file_path AS filePath FROM assignment_submissions')) {
    if (Number(params[0]) !== 11 || Number(params[1]) !== 1 || Number(params[2]) !== 4
        || (params.length === 4 && Number(params[3]) !== 8)) return [[]];
    return [submissionFilePath ? [{ fileName: path.basename(submissionFilePath), filePath: submissionFilePath }] : []];
  }
  if (sql.includes('SELECT assignment_submissions.file_name AS fileName, assignment_submissions.file_path AS filePath')) {
    return [Number(params[0]) === 4 && Number(params[1]) === 1 && Number(params[2]) === 8 && submissionFilePath
      ? [{ fileName: path.basename(submissionFilePath), filePath: submissionFilePath }] : []];
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

const { deleteAssignment, downloadOwnHistoricalSubmission, downloadSubmission, listSubmissions, previewSubmission, submitAssignment } = require('../controllers/assignmentsController');

async function callDelete(user = { id: 3, schoolId: 1, role: 'teacher' }, expectedSubmissionCount = submissionCount) {
  const result = { status: 200, sent: false, body: null, error: null };
  await deleteAssignment({ params: { assignmentId: '4' }, query: { expectedSubmissionCount }, user }, {
    status(code) { result.status = code; return this; },
    send() { result.sent = true; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

async function callPreview(user = { id: 3, schoolId: 1, role: 'teacher' }, submissionId = '11', assignmentId = '4') {
  const result = { headers: null, body: null, error: null };
  await previewSubmission({ params: { assignmentId, submissionId }, user }, {
    set(headers) { result.headers = headers; return this; },
    send(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

async function callDownload(user, submissionId = '11', assignmentId = '4') {
  const result = { filePath: null, fileName: null, options: null, error: null };
  await downloadSubmission({ params: { assignmentId, submissionId }, user }, {
    download(filePath, fileName, options, callback) {
      result.filePath = filePath;
      result.fileName = fileName;
      result.options = options;
      callback();
    }
  }, error => { result.error = error; });
  return result;
}

async function callHistoricalDownload(user) {
  const result = { filePath: null, options: null, error: null };
  await downloadOwnHistoricalSubmission({ params: { assignmentId: '4' }, user }, {
    set() { return this; },
    download(filePath, fileName, options, callback) {
      result.filePath = filePath;
      result.options = options;
      callback();
    }
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

test('a student can preview and download only their own submission', async () => {
  const student = { id: 8, schoolId: 1, role: 'student' };
  await withSubmissionFile('.pdf', async () => {
    const preview = await callPreview(student);
    assert.equal(preview.error, null);
    assert.equal(preview.body.toString('ascii', 0, 5), '%PDF-');

    const download = await callDownload(student);
    assert.equal(download.error, null);
    assert.equal(path.basename(download.filePath), download.fileName);
    assert.deepEqual(download.options, { dotfiles: 'allow' });

    const teacherDownload = await callDownload({ id: 3, schoolId: 1, role: 'teacher' });
    assert.equal(teacherDownload.error, null);
    assert.deepEqual(teacherDownload.options, { dotfiles: 'allow' });

    assert.equal((await callPreview(student, '12')).error.status, 404);
    assert.equal((await callDownload(student, '12')).error.status, 404);
    assert.equal((await callDownload({ id: 9, schoolId: 1, role: 'student' })).error.status, 404);
    assert.equal((await callPreview(student, '11', '5')).error.status, 404);
    assert.equal((await callPreview({ id: 9, schoolId: 1, role: 'student' })).error.status, 404);
    assert.equal((await callPreview({ id: 8, schoolId: 2, role: 'student' })).error.status, 404);
  });
});

test('a student can download their own previous-section submission', async () => {
  await withSubmissionFile('.pdf', async () => {
    const download = await callHistoricalDownload({ id: 8, schoolId: 1, role: 'student' });
    assert.equal(download.error, null);
    assert.equal(path.basename(download.filePath), submissionFilePath);
    assert.deepEqual(download.options, { dotfiles: 'allow' });
    assert.equal((await callHistoricalDownload({ id: 9, schoolId: 1, role: 'student' })).error.status, 404);
  });
});

test('a student receives a protected URL only for their own listed file', async () => {
  listedStudentSubmissionRows = [{
    id: 11, assignmentId: 4, studentId: 8, fileName: 'work.pdf',
    filePath: 'uploads/assignment-submissions/work.pdf', submissionStatus: 'submitted'
  }];
  try {
    const result = await callListSubmissions({ id: 8, schoolId: 1, role: 'student' });
    assert.equal(result.error, null);
    assert.equal(result.body.submissions[0].fileUrl, '/api/assignments/4/submissions/11/download');
    assert.equal(Object.hasOwn(result.body.submissions[0], 'filePath'), false);
  } finally {
    listedStudentSubmissionRows = [];
  }
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
