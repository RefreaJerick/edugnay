const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const databaseModule = require('../config/database');
const { SF2, monthInYear, buildSf2Pages } = require('../config/sf2');
process.env.SF_EXPORT_DIRECTORY = path.join(os.tmpdir(), 'academix-sf2-test-exports');
const { createExportWorkbook, getExportFilePath } = require('../config/sfExports');

const section = { id: 8, schoolId: 1, name: 'St. Matthew', academicYearId: 2,
  schoolLevelId: 2, academicYear: '2026-2027', startDate: '2026-06-01',
  endDate: '2027-05-31', gradeLevel: 'Grade 7' };
const school = { schoolName: 'School One', depedSchoolId: '305614' };
let learners = [{ userId: 10, firstName: 'Juan', lastName: 'Dela Cruz', sex: 'male' }];
let adviserAllowed = true;
let writes = 0;
let downloadableFile = null;
databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    if (/SELECT sf_templates_enabled/.test(sql)) return [[{ sfTemplatesEnabled: 1 }]];
    if (/FROM school_form_exports/.test(sql)) return [downloadableFile && values[0] === 13 && values[1] === 1 && values[2] === 3
      ? [{ filePath: downloadableFile, formCode: 'SF2' }] : []];
    if (/FROM school_form_templates/.test(sql)) return [[{
      id: 2, formCode: 'SF2', formName: 'Daily Attendance Report of Learners', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf2.xlsx',
      sheetName: SF2.sheetName, requiresAcademicTerm: 0
    }]];
    if (/FROM sections/.test(sql)) return [adviserAllowed ? [section] : []];
    if (/FROM schools/.test(sql)) return [[school]];
    if (/FROM section_students/.test(sql)) {
      assert.deepEqual(values.slice(0, 2), [1, 8]);
      assert.match(sql, /section_students\.school_id = \?/);
      return [learners];
    }
    writes += 1;
    throw new Error(`Unexpected write: ${sql}`);
  }
});
const controller = require('../controllers/sfTemplatesController');

async function call(handler, month = '2026-10', method = 'GET', fingerprint = '') {
  const result = { status: 200, body: null, error: null };
  const response = { status(code) { result.status = code; return this; }, json(body) { result.body = body; } };
  await handler({ method, params: { templateId: '2' },
    query: { sectionId: '8', month }, body: { sectionId: 8, month, previewFingerprint: fingerprint },
    user: { id: 3, schoolId: 1 } }, response, error => { result.error = error; });
  return result;
}

test('SF2 accepts only months inside the active academic year', () => {
  assert.equal(monthInYear('2026-10', section), true);
  assert.equal(monthInYear('2026-05', section), false);
  assert.equal(monthInYear('2027-06', section), false);
  assert.equal(monthInYear('2026-13', section), false);
});

test('SF2 download paths accept only private generated filenames', () => {
  assert.match(getExportFilePath('sf2-11111111-1111-1111-1111-111111111111.xlsx'), /sf2-11111111-1111-1111-1111-111111111111\.xlsx$/);
  assert.throws(() => getExportFilePath('other-11111111-1111-1111-1111-111111111111.xlsx'));
});

test('authorized SF2 download serves a file stored inside a hidden private directory', async () => {
  const fileName = `sf2-${randomUUID()}.xlsx`;
  const filePath = getExportFilePath(fileName);
  const contents = Buffer.from('private workbook test');
  downloadableFile = fileName;
  await fs.writeFile(filePath, contents);
  const app = express();
  app.get('/download/:exportId', (req, res, next) => {
    req.user = { id: Number(req.query.userId || 3), schoolId: 1 };
    controller.downloadExport(req, res, next);
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const allowed = await fetch(`${base}/download/13`);
    assert.equal(allowed.status, 200);
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), contents);
    const denied = await fetch(`${base}/download/13?userId=4`);
    assert.equal(denied.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(filePath);
    downloadableFile = null;
  }
});

test('SF2 preview is read-only and marks unavailable fields as draft-only', async () => {
  writes = 0;
  const result = await call(controller.previewTemplate);
  assert.equal(result.error, null);
  assert.equal(result.body.pages.length, 1);
  assert.equal(result.body.mappedCells.find(cell => cell.cellAddress === 'B13').value, 'Dela Cruz, Juan');
  assert.equal(result.body.mappedCells.find(cell => cell.cellAddress === 'X6').value, 'October 2026');
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'draft'));
  assert.equal(result.body.mappedCells.some(cell => /^D1[1-9]$/.test(cell.cellAddress) || cell.cellAddress === 'AH65'), false);
  assert.equal(writes, 0);
});

test('invalid month and another adviser section are denied before export', async () => {
  assert.equal((await call(controller.previewTemplate, '2026-05')).error?.status, 400);
  adviserAllowed = false;
  assert.equal((await call(controller.previewTemplate)).error?.status, 403);
  adviserAllowed = true;
});

test('past-month roster is explicitly flagged as assignment history, not enrollment', async () => {
  const result = await call(controller.previewTemplate, '2026-09');
  assert.equal(result.error, null);
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'historicalRoster'));
});

test('SF2 preview fingerprint rejects changed roster', async () => {
  const preview = await call(controller.previewTemplate);
  const original = learners;
  learners = [{ ...original[0], lastName: 'Changed' }];
  writes = 0;
  const result = await call(controller.generateTemplate, '2026-10', 'POST', preview.body.previewFingerprint);
  assert.equal(result.error?.status, 409);
  assert.equal(writes, 0);
  learners = original;
});

test('SF2 does not guess sex and paginates both groups', () => {
  const records = [
    ...Array.from({ length: 23 }, (_, index) => ({ firstName: `Male${index}`, lastName: 'A', sex: 'male' })),
    ...Array.from({ length: 27 }, (_, index) => ({ firstName: `Female${index}`, lastName: 'B', sex: 'female' })),
    { firstName: 'Unknown', lastName: 'C', sex: null }
  ];
  const result = buildSf2Pages(school, section, '2026-10', records);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'A13').value, 22);
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B35').value, 'B, Female25');
  assert.equal(result.pages.flat().some(cell => String(cell.value).includes('Unknown')), false);
  assert.ok(result.issues.some(issue => issue.fieldKey === 'sex'));
});

test('SF2 export preserves official layout and leaves attendance/enrollment blank', async () => {
  const records = Array.from({ length: 50 }, (_, index) => ({
    firstName: `Student${index}`, lastName: 'Sample', sex: index < 23 ? 'male' : 'female'
  }));
  const pages = buildSf2Pages(school, section, '2026-10', records).pages;
  const source = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets/templates/school-forms/sf2.xlsx'));
  const output = await createExportWorkbook({ formCode: 'SF2', filePath: 'sf2.xlsx', sheetName: SF2.sheetName }, pages);
  const originalZip = await JSZip.loadAsync(source);
  const exportZip = await JSZip.loadAsync(output);
  assert.deepEqual(await exportZip.file('xl/styles.xml').async('nodebuffer'), await originalZip.file('xl/styles.xml').async('nodebuffer'));
  for (const part of ['xl/media/image1.png', 'xl/printerSettings/printerSettings2.bin', 'xl/drawings/drawing2.xml']) {
    assert.deepEqual(await exportZip.file(part).async('nodebuffer'), await originalZip.file(part).async('nodebuffer'));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.equal(workbook.worksheets.length, 2);
  for (const [index, sheet] of workbook.worksheets.entries()) {
    assert.equal(sheet.model.merges.length, 179);
    assert.equal(sheet.pageSetup.printTitlesRow, '10:12');
    assert.equal(sheet.getCell('A91').value, `School Form 2 :  Page ${index + 1} of 2`);
    assert.equal(sheet.getCell('D11').value, null);
    assert.equal(sheet.getCell('D13').value, null);
    assert.equal(sheet.getCell('AC13').value, null);
    assert.equal(sheet.getCell('AH65').value, null);
    assert.equal(sheet.getCell('AC89').value, '                          (Signature of Teacher over Printed Name)');
  }
});

test('SF2 browser preview covers the complete official sheet', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets/js/sf-workbook.js'), 'utf8');
  const exposed = source.replace('  window.EDUGNAY_SF_WORKBOOK = {', '  window.EDUGNAY_SF_WORKBOOK = { worksheetPreview,');
  const window = {};
  vm.runInNewContext(exposed, { window, Date });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.resolve(__dirname, '..', '..', 'assets/templates/school-forms/sf2.xlsx'));
  const template = { id: 'sf2-daily-attendance-v1', formCode: 'SF2' };
  const definition = window.EDUGNAY_SF_WORKBOOK.getTemplateDefinition(template);
  const preview = window.EDUGNAY_SF_WORKBOOK.worksheetPreview(workbook.worksheets[0], template);
  assert.equal(definition.mergeCount, 179);
  assert.equal(preview.rows.length, 93);
  assert.equal(preview.columnWidths.length, 36);
  assert.equal(preview.truncated, false);
  assert.equal(preview.rows[1].cells[0].text.includes('School Form 2'), true);
  const zip = await JSZip.loadAsync(await fs.readFile(path.resolve(__dirname, '..', '..', 'assets/templates/school-forms/sf2.xlsx')));
  const xml = await zip.file('xl/worksheets/sheet2.xml').async('string');
  for (const address of Object.keys(definition.anchors)) {
    const cell = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>`).exec(xml)?.[0];
    assert.match(cell || '', /\bs="\d+"/, `${address} must retain official formatting`);
  }
});
