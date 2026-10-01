const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
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
let sectionQuery = null;
const database = {
  async execute(sql, values = []) {
    if (/SELECT sf_templates_enabled/.test(sql)) return [[{ sfTemplatesEnabled: 1 }]];
    if (/FROM school_form_templates/.test(sql)) return [[{
      id: 1, formCode: 'SF1', formName: 'School Register', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf1.xlsx',
      sheetName: 'School Form 1 (SF1)', requiresAcademicTerm: 0
    }]];
    if (/FROM sections/.test(sql)) {
      sectionQuery = { sql, values };
      const current = { id: 8, schoolId: 1, name: 'St. Matthew', academicYearId: 2,
        schoolLevelId: 2, academicYear: '2026-2027', gradeLevel: 'Grade 7' };
      const historical = { ...current, id: 1, academicYearId: 1, academicYear: '2025-2026' };
      if (/sections.id = \?/.test(sql)) {
        if (!allowSection) return [[]];
        return [values[0] === 1 && !/academic_years.status = 'active'/.test(sql) ? [historical]
          : values[0] === 8 ? [current] : []];
      }
      return [[...(/academic_years.status = 'active'/.test(sql) ? [] : [historical]), current]];
    }
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

test('advisory choices contain only current-year sections for the signed-in teacher', async () => {
  const result = await call(controller.getTemplateDetails, 'GET');
  assert.equal(result.error, null);
  assert.deepEqual(result.body.sections.map(section => section.id), [8]);
  assert.match(sectionQuery.sql, /sections.adviser_user_id = \?/);
  assert.match(sectionQuery.sql, /academic_years.status = 'active'/);
  assert.deepEqual(sectionQuery.values, [1, 3]);
});

test('a historical advisory section cannot be previewed directly', async () => {
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '1' });
  assert.equal(result.error?.status, 403);
  assert.match(sectionQuery.sql, /academic_years.status = 'active'/);
  assert.deepEqual(sectionQuery.values, [1, 1, 3]);
});

test('SF1 preserves a foreign birthplace without requiring a province', async () => {
  const original = learner;
  learner = { ...learner, birthPlace: 'Jabriya', birthPlaceRegion: null, birthCountry: 'Kuwait' };
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  assert.equal(result.error, null);
  assert.equal(result.body.mappedCells.find(cell => cell.cellAddress === 'J10').value, 'Jabriya, Kuwait');
  assert.equal(result.body.issues.some(issue => issue.fieldKey === 'birthCountry'), false);
  learner = original;
});

test('SF1 retains an old birthplace and flags its unconfirmed country', async () => {
  const original = learner;
  learner = { ...learner, legacyBirthPlace: 'Pangasinan' };
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' });
  assert.equal(result.body.mappedCells.find(cell => cell.cellAddress === 'J10').value, 'Pangasinan');
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'birthCountry'));
  learner = original;
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

test('SF1 preview shows birth dates as mm/dd/yyyy', async () => {
  const source = await fs.promises.readFile(path.resolve(__dirname, '..', '..', 'assets', 'js', 'sf-workbook.js'), 'utf8');
  const exposed = source.replace('  window.EDUGNAY_SF_WORKBOOK = {', '  window.EDUGNAY_SF_WORKBOOK = { worksheetPreview,');
  assert.notEqual(exposed, source);
  const window = {};
  vm.runInNewContext(exposed, { window, Date });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf1.xlsx'));
  const sheet = workbook.getWorksheet('School Form 1 (SF1)');
  for (let row = 10; row <= 58; row += 1) {
    assert.equal(sheet.getCell(`H${row}`).numFmt, 'mm/dd/yyyy');
  }
  sheet.getCell('H10').value = new Date(Date.UTC(2005, 3, 7));
  sheet.getCell('H11').value = null;
  const preview = window.EDUGNAY_SF_WORKBOOK.worksheetPreview(sheet, { id: 'sf1-school-register-v1' });
  assert.equal(preview.rows[9].cells.find(cell => cell.address === 'H10').text, '04/07/2005');
  assert.equal(preview.rows[10].cells.find(cell => cell.address === 'H11').text, '');
});

test('XLSX export changes mapped cells without changing other workbook parts', async () => {
  const template = {
    filePath: '/assets/templates/school-forms/sf1.xlsx',
    sheetName: 'School Form 1 (SF1)'
  };
  const source = await fs.promises.readFile(path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf1.xlsx'));
  const output = await createExportWorkbook(template, [
    { cellAddress: 'B10', value: '100201000015', type: 'text' },
    { cellAddress: 'C10', value: 'Dela Cruz, Juan', type: 'text' },
    { cellAddress: 'H10', value: '2005-04-07', type: 'date' },
    { cellAddress: 'H11', value: null, type: 'date' }
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  const worksheet = workbook.getWorksheet(template.sheetName);
  assert.equal(worksheet.getCell('H10').value.toISOString().slice(0, 10), '2005-04-07');
  assert.equal(worksheet.getCell('H10').numFmt, 'mm/dd/yyyy');
  assert.equal(worksheet.getCell('H11').value, null);
});
