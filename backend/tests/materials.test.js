const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { after } = require('node:test');
const express = require('express');

const testUploadDirectory = path.join(os.tmpdir(), `.academix-material-tests-${crypto.randomUUID()}`);
process.env.MATERIAL_UPLOAD_DIRECTORY = testUploadDirectory;
after(async () => fs.rm(testUploadDirectory, { recursive: true, force: true }));

const databaseModule = require('../config/database');
const { materialUploadDirectory } = require('../config/uploads');

let assigned = true;
let lastQuery = '';
let lastValues = [];
let committed = false;
let rolledBack = false;
let failMaterialDelete = false;
let studentEnrolled = true;
const material = {
  id: 42, schoolId: 1, sectionId: 8, subjectId: 2, teacherUserId: 3,
  title: 'Test material', type: 'pdf', mimeType: 'application/pdf',
  originalFileName: 'sample.pdf', storedFileName: '00000000-0000-0000-0000-000000000042.pdf',
  fileSizeBytes: 30, status: 'published', subjectName: 'Values Education', teacherName: 'Ms. Reyes'
};
const database = {
  async execute(sql, values) {
    lastQuery = sql;
    lastValues = values;
    if (sql.includes('FROM section_teachers')) return [assigned ? [{ id: 8 }] : []];
    if (sql.includes('FROM academic_terms')) return [[]];
    if (sql.includes('INSERT INTO learning_materials')) return [{ insertId: 42 }];
    if (sql.includes('DELETE FROM learning_materials')) {
      if (failMaterialDelete) throw new Error('Database delete failed.');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM learning_materials AS materials')) {
      if (sql.includes('LIMIT 1') && (values[1] !== material.schoolId
        || (sql.includes("materials.status = 'published'") && material.status !== 'published')
        || (sql.includes('FROM section_students') && !studentEnrolled))) return [[]];
      return [[material]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      beginTransaction: async () => {},
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {}
    };
  }
};
databaseModule.getDatabase = () => database;
const controller = require('../controllers/materialsController');

async function requestMaterial(user, headers = {}, query = '') {
  const app = express();
  app.get('/material/:materialId', (req, res, next) => {
    req.user = user;
    controller.openMaterial(req, res, next);
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/material/42${query}`, { headers });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function call(handler, req) {
  const result = { status: 200, data: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; return this; },
    end() { return this; }
  };
  await handler(req, response, error => { result.error = error; });
  return result;
}

test('teacher list is scoped to their own assigned school and subject', async () => {
  const result = await call(controller.listMaterials, {
    user: { id: 3, schoolId: 1, role: 'teacher' }, query: { sectionId: '8', subjectId: '2' }
  });
  assert.equal(result.error, null);
  assert.match(lastQuery, /materials\.school_id = \?/);
  assert.match(lastQuery, /section_teachers\.teacher_user_id = \?/);
  assert.deepEqual(lastValues, [1, 3, 3, 8, 2]);
  assert.equal(result.data.materials[0].storedFileName, undefined);
});

test('student list is published and enrollment scoped', async () => {
  const result = await call(controller.listMaterials, {
    user: { id: 12, schoolId: 1, role: 'student' }, query: {}
  });
  assert.equal(result.error, null);
  assert.match(lastQuery, /materials\.status = 'published'/);
  assert.match(lastQuery, /section_students\.student_user_id = \?/);
  assert.deepEqual(lastValues, [1, 12]);
});

test('assigned student can open a PDF from the private dot-directory', async () => {
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/pdf/);
    assert.match(response.headers.get('content-disposition'), /^inline/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '%PDF-1.4\nTest material');
    const teacherResponse = await requestMaterial({ id: 3, schoolId: 1, role: 'teacher' });
    assert.equal(teacherResponse.status, 200);
    assert.equal(await teacherResponse.text(), '%PDF-1.4\nTest material');
  } finally { await fs.rm(filePath, { force: true }); }
});

test('assigned student can explicitly download a PDF from the private dot-directory', async () => {
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' }, {}, '?download=1');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="sample\.pdf"/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '%PDF-1.4\nTest material');
  } finally { await fs.rm(filePath, { force: true }); }
});

test('assigned student can open an image from the private dot-directory', async () => {
  const original = { type: material.type, mimeType: material.mimeType, storedFileName: material.storedFileName };
  material.type = 'png';
  material.mimeType = 'image/png';
  material.storedFileName = `${crypto.randomUUID()}.png`;
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, 'Image material');
  try {
    const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/);
    assert.match(response.headers.get('content-disposition'), /^inline/);
    assert.equal(await response.text(), 'Image material');
  } finally {
    await fs.rm(filePath, { force: true });
    Object.assign(material, original);
  }
});

test('assigned student can download an Office file from the private dot-directory', async () => {
  const original = { type: material.type, mimeType: material.mimeType,
    originalFileName: material.originalFileName, storedFileName: material.storedFileName };
  material.type = 'docx';
  material.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  material.originalFileName = 'lesson.docx';
  material.storedFileName = `${crypto.randomUUID()}.docx`;
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, 'Office material');
  try {
    const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="lesson\.docx"/);
    assert.equal(await response.text(), 'Office material');
  } finally {
    await fs.rm(filePath, { force: true });
    Object.assign(material, original);
  }
});

test('video byte ranges still stream from the private dot-directory', async () => {
  const original = { type: material.type, mimeType: material.mimeType, storedFileName: material.storedFileName };
  material.type = 'mp4';
  material.mimeType = 'video/mp4';
  material.storedFileName = `${crypto.randomUUID()}.mp4`;
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, '0123456789');
  try {
    const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' }, { Range: 'bytes=2-5' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await response.text(), '2345');
  } finally {
    await fs.rm(filePath, { force: true });
    Object.assign(material, original);
  }
});

test('material files remain scoped to published, enrolled, same-school access', async () => {
  const filePath = path.join(materialUploadDirectory, material.storedFileName);
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    studentEnrolled = false;
    assert.equal((await requestMaterial({ id: 12, schoolId: 1, role: 'student' })).status, 404);
    studentEnrolled = true;
    material.status = 'draft';
    assert.equal((await requestMaterial({ id: 12, schoolId: 1, role: 'student' })).status, 404);
    material.status = 'published';
    assert.equal((await requestMaterial({ id: 12, schoolId: 2, role: 'student' })).status, 404);
    assert.equal((await requestMaterial({ id: 12, schoolId: 2, role: 'student' }, {}, '?download=1')).status, 404);
    assigned = false;
    assert.equal((await requestMaterial({ id: 3, schoolId: 1, role: 'teacher' })).status, 404);
  } finally {
    assigned = true;
    studentEnrolled = true;
    material.status = 'published';
    await fs.rm(filePath, { force: true });
  }
});

test('a missing material file returns a clean not-found response', async () => {
  const response = await requestMaterial({ id: 12, schoolId: 1, role: 'student' });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: 'The material file is unavailable.' });
});

test('unassigned teacher is rejected before multipart upload', async () => {
  assigned = false;
  const result = await call(controller.authorizeUpload, {
    user: { id: 4, schoolId: 1, role: 'teacher' }, params: { sectionId: '8', subjectId: '2' }
  });
  assert.equal(result.error?.status, 403);
  assigned = true;
});

test('valid upload commits metadata and hides private file path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academix-material-'));
  const filePath = path.join(directory, 'sample.pdf');
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  committed = false;
  try {
    const result = await call(controller.createMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' },
      materialSectionId: 8, materialSubjectId: 2,
      body: { title: 'Test material', status: 'published' },
      file: { path: filePath, filename: '00000000-0000-0000-0000-000000000042.pdf',
        originalname: 'sample.pdf', size: 20 }
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 201);
    assert.equal(committed, true);
    assert.equal(result.data.material.storedFileName, undefined);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('invalid upload rolls back and removes the newly stored file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academix-material-'));
  const filePath = path.join(directory, 'invalid.pdf');
  await fs.writeFile(filePath, '<html>not a PDF</html>');
  rolledBack = false;
  try {
    const result = await call(controller.createMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' },
      materialSectionId: 8, materialSubjectId: 2,
      body: { title: 'Invalid', status: 'published' },
      file: { path: filePath, filename: '00000000-0000-0000-0000-000000000042.pdf',
        originalname: 'invalid.pdf', size: 22 }
    });
    assert.equal(result.error?.status, 400);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('teacher removal permanently deletes the uploaded file and owned database row', async () => {
  const originalFileName = material.storedFileName;
  const fileName = `${crypto.randomUUID()}.pdf`;
  const filePath = path.join(materialUploadDirectory, fileName);
  material.storedFileName = fileName;
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    const result = await call(controller.deleteMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' }, params: { materialId: '42' }
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 204);
    assert.match(lastQuery, /DELETE FROM learning_materials WHERE id = \? AND school_id = \? AND teacher_user_id = \?/);
    assert.deepEqual(lastValues, [42, 1, 3]);
    await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  } finally {
    material.storedFileName = originalFileName;
    await fs.rm(filePath, { force: true });
  }
});

test('a failed database delete leaves the uploaded file intact', async () => {
  const originalFileName = material.storedFileName;
  const fileName = `${crypto.randomUUID()}.pdf`;
  const filePath = path.join(materialUploadDirectory, fileName);
  material.storedFileName = fileName;
  failMaterialDelete = true;
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    const result = await call(controller.deleteMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' }, params: { materialId: '42' }
    });
    assert.match(result.error?.message || '', /Database delete failed/);
    await fs.stat(filePath);
  } finally {
    failMaterialDelete = false;
    material.storedFileName = originalFileName;
    await fs.rm(filePath, { force: true });
  }
});

test('unassigned teacher cannot delete a material or its file', async () => {
  const originalFileName = material.storedFileName;
  const fileName = `${crypto.randomUUID()}.pdf`;
  const filePath = path.join(materialUploadDirectory, fileName);
  material.storedFileName = fileName;
  assigned = false;
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  try {
    const result = await call(controller.deleteMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' }, params: { materialId: '42' }
    });
    assert.equal(result.error?.status, 404);
    await fs.stat(filePath);
    assert.doesNotMatch(lastQuery, /DELETE FROM learning_materials/);
  } finally {
    assigned = true;
    material.storedFileName = originalFileName;
    await fs.rm(filePath, { force: true });
  }
});

test('invalid stored paths are rejected before file or database deletion', async () => {
  const originalFileName = material.storedFileName;
  material.storedFileName = '../../outside.pdf';
  try {
    const result = await call(controller.deleteMaterial, {
      user: { id: 3, schoolId: 1, role: 'teacher' }, params: { materialId: '42' }
    });
    assert.equal(result.error?.status, 500);
    assert.doesNotMatch(lastQuery, /DELETE FROM learning_materials/);
  } finally { material.storedFileName = originalFileName; }
});
