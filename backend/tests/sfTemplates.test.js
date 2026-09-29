const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');
const databaseModule = require('../config/database');
const { createExportWorkbook } = require('../config/sfExports');

let learner = {
  userId: 10, profileUserId: 10, firstName: 'Juan', lastName: 'Dela Cruz',
  lrn: '100201000015', sex: 'male', birthDate: '2013-01-10', parents: []
};
let writes = 0;
let allowSection = true;
let learnerRows = null;
const database = {
  async execute(sql) {
    if (/SELECT sf_templates_enabled/.test(sql)) return [[{ sfTemplatesEnabled: 1 }]];
    if (/FROM school_form_templates/.test(sql)) return [[{
      id: 1, formCode: 'SF1', formName: 'School Register', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf1.xlsx',
      sheetName: 'School Form 1 (SF1)', requiresAcademicTerm: 0
    }]];
    if (/FROM sections/.test(sql)) return [allowSection ? [{
      id: 8, schoolId: 1, name: 'St. Matthew', academicYearId: 2,
      schoolLevelId: 2, academicYear: '2026-2027', gradeLevel: 'Grade 7'
    }] : []];
    if (/FROM schools/.test(sql)) return [[{
      schoolName: 'St. Columban’s College', depedSchoolId: '305614',
      region: 'VIII', division: 'Leyte', district: 'Tacloban'
    }]];
    if (/FROM section_students/.test(sql)) return [learnerRows || [learner]];
    if (/FROM student_parent_links/.test(sql)) return [[]];
    writes += 1;
    throw new Error(`Unexpected write: ${sql}`);
  }
};
databaseModule.getDatabase = () => database;
const controller = require('../controllers/sfTemplatesController');

async function call(handler, method, body = {}, query = {}) {
  const result = { status: 200, body: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return this; }
  };
  await handler({
    method, body, query, params: { templateId: '1' },
    user: { id: 3, schoolId: 1 }
  }, response, error => { result.error = error; });
  return result;
}

test('preview is read-only and returns server-mapped SF1 values', async () => {
  writes = 0;
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  assert.equal(result.error, null);
  assert.equal(result.body.previewFingerprint.length, 64);
  assert.equal(result.body.mappedCells.find(cell => cell.cellAddress === 'B10').value, '100201000015');
  assert.equal(writes, 0);
});

test('missing student profile remains visible as a blocking issue', async () => {
  const original = learner;
  learner = { ...learner, profileUserId: null, lrn: null, sex: null, birthDate: null };
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  assert.equal(result.error, null);
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'studentProfile' && issue.severity === 'error'));
  learner = original;
});

test('stale preview cannot create an export', async () => {
  const preview = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  const original = learner;
  learner = { ...learner, lrn: '100201000016' };
  writes = 0;
  const result = await call(controller.generateTemplate, 'POST', {
    sectionId: 8, previewFingerprint: preview.body.previewFingerprint
  });
  assert.equal(result.error?.status, 409);
  assert.equal(writes, 0);
  learner = original;
});

test('a non-adviser cannot preview another section', async () => {
  allowSection = false;
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  assert.equal(result.error?.status, 403);
  allowSection = true;
});

test('blocking data cannot create an export even with a fresh preview', async () => {
  const original = learner;
  learner = { ...learner, lrn: 'invalid' };
  const preview = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  writes = 0;
  const result = await call(controller.generateTemplate, 'POST', {
    sectionId: 8, previewFingerprint: preview.body.previewFingerprint
  });
  assert.equal(result.status, 422);
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'lrn'));
  assert.equal(writes, 0);
  learner = original;
});

test('more than 49 learners blocks export before any write', async () => {
  learnerRows = Array.from({ length: 50 }, (_, index) => ({
    ...learner, userId: index + 1, lrn: String(100201000000 + index)
  }));
  const preview = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  writes = 0;
  const result = await call(controller.generateTemplate, 'POST', {
    sectionId: 8, previewFingerprint: preview.body.previewFingerprint
  });
  assert.equal(result.status, 422);
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'learners'));
  assert.equal(writes, 0);
  learnerRows = null;
});

test('invalid edited dates are rejected before export', async () => {
  const preview = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  writes = 0;
  const result = await call(controller.generateTemplate, 'POST', {
    sectionId: 8, previewFingerprint: preview.body.previewFingerprint,
    edits: [{ cellAddress: 'H10', value: '02/30/2026' }]
  });
  assert.equal(result.error?.status, 400);
  assert.equal(writes, 0);
});

test('XLSX export changes mapped cells without changing other workbook parts', async () => {
  const template = {
    filePath: '/assets/templates/school-forms/sf1.xlsx',
    sheetName: 'School Form 1 (SF1)'
  };
  const source = await fs.promises.readFile(path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf1.xlsx'));
  const output = await createExportWorkbook(template, [
    { cellAddress: 'B10', value: '100201000015', type: 'text' },
    { cellAddress: 'C10', value: 'Dela Cruz, Juan', type: 'text' }
  ]);
  const originalZip = await JSZip.loadAsync(source);
  const exportZip = await JSZip.loadAsync(output);
  const names = Object.keys(originalZip.files).filter(name => !originalZip.files[name].dir);
  assert.deepEqual(Object.keys(exportZip.files).filter(name => !exportZip.files[name].dir).sort(), names.sort());
  for (const name of names) {
    if (name === 'xl/worksheets/sheet1.xml') continue;
    const before = await originalZip.file(name).async('nodebuffer');
    const after = await exportZip.file(name).async('nodebuffer');
    assert.ok(before.equals(after), `${name} changed`);
  }
  const sheet = await exportZip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet, /100201000015/);
  assert.match(sheet, /Dela Cruz, Juan/);
});
