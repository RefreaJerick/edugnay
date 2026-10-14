const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { SF3, buildSf3Pages } = require('../config/sf3');

process.env.SF_EXPORT_DIRECTORY = path.join(os.tmpdir(), 'academix-sf3-test-exports');
const { createExportWorkbook, getExportFilePath } = require('../config/sfExports');

const school = { schoolName: 'School One', depedSchoolId: '305614' };
const section = { name: 'St. Matthew', academicYear: '2026-2027', gradeLevel: 'Grade 7' };
const template = { formCode: 'SF3', filePath: '/assets/templates/school-forms/sf3.xlsx', sheetName: SF3.sheetName };
const assetPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf3.xlsx');

function learner(index, sex) {
  return { firstName: `Student${index}`, lastName: 'Sample', middleName: 'A', sex };
}

test('SF3 roster separates recorded sex, warns when sex is missing, and leaves book fields blank', () => {
  const result = buildSf3Pages(school, section, [learner(1, 'male'), learner(2, 'female'), learner(3, null)]);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'A12').value, 1);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B12').value, 'Sample, Student1, A');
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'A37').value, 1);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B37').value, 'Sample, Student2, A');
  assert.equal(result.pages[0].some(cell => /^[D-S](?:1[2-9]|[2-5]\d)$/.test(cell.cellAddress)), false);
  assert.equal(result.pages[0].some(cell => String(cell.value).includes('Student3')), false);
  assert.ok(result.issues.some(issue => issue.fieldKey === 'draft'));
  assert.ok(result.issues.some(issue => issue.fieldKey === 'sex'));
});

test('SF3 adds pages when a recorded-sex roster exceeds its printed slots', () => {
  const learners = [
    ...Array.from({ length: 25 }, (_, index) => learner(index + 1, 'male')),
    ...Array.from({ length: 24 }, (_, index) => learner(index + 26, 'female')),
    learner(50, 'unknown')
  ];
  const result = buildSf3Pages(school, section, learners);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'A35').value, 24);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'A59').value, 23);
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'A12').value, 25);
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B12').value, 'Sample, Student25, A');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'A37').value, 24);
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'T68').value, 'School Form 3: Page 2 of 2');
  assert.equal(result.issues.filter(issue => issue.fieldKey === 'sex').length, 1);
});

test('SF3 handles a missing school ID and an empty roster with clear draft issues', () => {
  const result = buildSf3Pages({ schoolName: 'School One' }, section, []);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'C5').value, '');
  assert.ok(result.issues.some(issue => issue.fieldKey === 'schoolId'));
  assert.ok(result.issues.some(issue => issue.fieldKey === 'roster'));
});

test('SF3 export preserves the official workbook and writes independent, blank roster pages', async () => {
  const learners = [
    ...Array.from({ length: 25 }, (_, index) => learner(index + 1, 'male')),
    ...Array.from({ length: 23 }, (_, index) => learner(index + 26, 'female'))
  ];
  const pages = buildSf3Pages(school, section, learners).pages;
  const source = await fs.readFile(assetPath);
  const output = await createExportWorkbook(template, pages);
  const sourceZip = await JSZip.loadAsync(source);
  const exportZip = await JSZip.loadAsync(output);
  assert.deepEqual(await exportZip.file('xl/styles.xml').async('nodebuffer'), await sourceZip.file('xl/styles.xml').async('nodebuffer'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [SF3.sheetName, 'SF3 Page 2']);
  for (const [index, sheet] of workbook.worksheets.entries()) {
    assert.equal(sheet.model.merges.length, 74);
    assert.equal(sheet.getImages().length, 1);
    assert.equal(sheet.pageSetup.printArea, 'A1:T67');
    assert.equal(sheet.pageSetup.orientation, 'landscape');
    assert.equal(sheet.getCell('D12').value, null);
    assert.equal(sheet.getCell('S59').value, null);
    assert.equal(sheet.getCell('T68').value, `School Form 3: Page ${index + 1} of 2`);
  }
  assert.equal(workbook.worksheets[1].getCell('B13').value, null);
  assert.equal(workbook.worksheets[1].getCell('B37').value, null);
  assert.equal(workbook.worksheets[1].getCell('B12').value, 'Sample, Student25, A');
});

test('SF3 browser preview uses the complete official print area and formatted anchors', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets', 'js', 'sf-workbook.js'), 'utf8');
  const exposed = source.replace('  window.EDUGNAY_SF_WORKBOOK = {', '  window.EDUGNAY_SF_WORKBOOK = { worksheetPreview,');
  const window = {};
  vm.runInNewContext(exposed, { window, Date });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(assetPath);
  const definition = window.EDUGNAY_SF_WORKBOOK.getTemplateDefinition({ id: 'sf3-books-issued-returned-v1' });
  const preview = window.EDUGNAY_SF_WORKBOOK.worksheetPreview(workbook.worksheets[0], { id: 'sf3-books-issued-returned-v1' });
  assert.equal(definition.mergeCount, 74);
  assert.equal(preview.rows.length, 68);
  assert.equal(preview.columnWidths.length, 20);
  assert.equal(preview.truncated, false);
  const zip = await JSZip.loadAsync(await fs.readFile(assetPath));
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const address of Object.keys(definition.anchors)) {
    const cell = new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*>`).exec(xml)?.[0];
    assert.match(cell || '', /\bs="\d+"/, `${address} must retain official formatting`);
  }
});

test('SF3 generated export paths remain inside private storage', () => {
  const valid = 'sf3-11111111-1111-1111-1111-111111111111.xlsx';
  const directory = path.resolve(process.env.SF_EXPORT_DIRECTORY);
  assert.ok(getExportFilePath(valid).startsWith(`${directory}${path.sep}`));
  assert.ok(getExportFilePath(`../${valid}`).startsWith(`${directory}${path.sep}`));
  assert.throws(() => getExportFilePath('../other.xlsx'));
});
