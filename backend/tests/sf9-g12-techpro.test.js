const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { assertXlsxPackageIntegrity } = require('./helpers/assertXlsxPackageIntegrity');
const { SF9_GRADE12_TECHPRO, buildSf9Grade12TechProPages } = require('../config/sf9');
const { createExportWorkbook, getEditableCells } = require('../config/sfExports');

const template = { formCode: 'SF9', version: SF9_GRADE12_TECHPRO.version,
  filePath: '/assets/templates/school-forms/sf9-g12-techpro.xlsx',
  sheetName: SF9_GRADE12_TECHPRO.sheetName };
const sourcePath = path.resolve(__dirname, '..', '..', 'assets/templates/school-forms/sf9-g12-techpro.xlsx');
const school = { schoolName: 'Sample School', depedSchoolId: '305614', region: 'VIII',
  division: 'Leyte', district: 'Tacloban', addressLine: 'Tacloban City' };
const section = { academicYear: '2026-2027', name: 'TechPro A', trackName: 'TechPro' };
const learner = { firstName: 'Juan', lastName: 'Dela Cruz', birthDate: '2009-01-10',
  sex: 'male', lrn: '100201000015' };
const terms = [1, 2, 3].map(sequenceNumber => ({ id: 20 + sequenceNumber, sequenceNumber }));

function records() {
  const classes = [
    { electiveClassId: 1, electiveName: 'TechPro Elective 4', trackCode: 'techpro', subjectType: 'techpro_elective',
      startTermId: 21, endTermId: 21, startTermSequenceNumber: 1, endTermSequenceNumber: 1 },
    { electiveClassId: 2, electiveName: 'TechPro Elective 5', trackCode: 'techpro', subjectType: 'techpro_elective',
      startTermId: 22, endTermId: 22, startTermSequenceNumber: 2, endTermSequenceNumber: 2 },
    { electiveClassId: 3, electiveName: 'Work Immersion for TechProTrack', trackCode: 'techpro', subjectType: 'work_immersion',
      startTermId: 23, endTermId: 23, startTermSequenceNumber: 3, endTermSequenceNumber: 3 }
  ];
  const grades = classes.map((item, index) => ({ electiveClassId: item.electiveClassId,
    academicTermId: item.startTermId, termSequenceNumber: item.startTermSequenceNumber,
    finalGrade: 88 + index }));
  return { classes, grades };
}

function build(termRecords = terms, selections = records()) {
  return buildSf9Grade12TechProPages(school, section, 'Ms. Adviser', learner,
    termRecords, selections.classes, selections.grades);
}

test('Grade 12 TechPro SF9 maps approved electives and Work Immersion to their assigned terms', () => {
  const result = build();
  const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));

  assert.equal(result.issues.some(issue => issue.severity === 'error'), false);
  assert.equal(cells.get('I18'), 12);
  assert.equal(cells.get('E19'), 'Technical Professional');
  assert.deepEqual(['B33', 'B34', 'B35'].map(address => cells.get(address)), [
    'TechPro Elective 4', 'TechPro Elective 5', 'Work Immersion for TechProTrack'
  ]);
  assert.deepEqual(['F33', 'G34', 'H35', 'I33', 'I34', 'I35', 'I38'].map(address => cells.get(address)),
    [88, 89, 90, 88, 89, 90, '']);
});

test('Grade 12 TechPro SF9 blocks over-capacity and unsupported choices, and leaves missing grades blank', () => {
  const excessElectives = records();
  excessElectives.classes.push({ ...excessElectives.classes[0], electiveClassId: 4,
    electiveName: 'Extra TechPro elective' });
  assert.ok(build(terms, excessElectives).issues.some(issue => issue.severity === 'error'
    && issue.fieldKey === 'electives'));

  const excessImmersion = records();
  excessImmersion.classes.push({ ...excessImmersion.classes[2], electiveClassId: 4,
    electiveName: 'Extra Work Immersion' });
  assert.ok(build(terms, excessImmersion).issues.some(issue => issue.severity === 'error'
    && issue.fieldKey === 'workImmersion'));

  const crossTrack = records();
  crossTrack.classes[0] = { ...crossTrack.classes[0], trackCode: 'academic', subjectType: 'academic_elective' };
  assert.ok(build(terms, crossTrack).issues.some(issue => issue.severity === 'error'
    && issue.fieldKey === 'electives'));

  const invalidTerm = records();
  invalidTerm.classes[0] = { ...invalidTerm.classes[0], startTermId: 99 };
  assert.ok(build(terms, invalidTerm).issues.some(issue => issue.severity === 'error'
    && issue.fieldKey === 'electiveTerms'));

  const missingGrade = records();
  missingGrade.grades = missingGrade.grades.filter(grade => grade.electiveClassId !== 1);
  const result = build(terms, missingGrade);
  const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(cells.get('F33'), '');
  assert.equal(cells.get('I33'), '');
  assert.ok(result.issues.some(issue => issue.severity === 'warning'
    && issue.fieldKey === 'electiveGrade' && issue.cellReference === 'F33'));
});

test('Grade 12 TechPro SF9 template and export preserve the supplied layout and adviser edits', async () => {
  const sourceBytes = await fs.readFile(sourcePath);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  await assertXlsxPackageIntegrity(sourceZip);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceBytes);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [SF9_GRADE12_TECHPRO.sheetName]);
  const originalSheet = workbook.worksheets[0];
  assert.equal(originalSheet.model.merges.length, 129);
  assert.equal(originalSheet.getImages().length, 1);
  assert.equal(originalSheet.pageSetup.printArea, 'A2:AD53');
  assert.equal(originalSheet.pageSetup.orientation, 'landscape');
  assert.deepEqual(['B33', 'B34', 'B35', 'I17', 'C18', 'I38'].map(address => originalSheet.getCell(address).value),
    [null, null, null, null, null, null]);

  const workbookXml = await sourceZip.file('xl/workbook.xml').async('string');
  const worksheetName = SF9_GRADE12_TECHPRO.sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(workbookXml, new RegExp(`<sheet\\b[^>]*name="${worksheetName}"`));
  const worksheetPath = Object.keys(sourceZip.files).find(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  assert.ok(worksheetPath);
  const worksheetXml = await sourceZip.file(worksheetPath).async('string');
  assert.doesNotMatch(worksheetXml, /<f\b|#REF!/);
  const sharedStrings = await sourceZip.file('xl/sharedStrings.xml').async('string');
  assert.doesNotMatch(sharedStrings, /ABC ELEMENTARY SCHOOL|RONKYLE SORIANO|NICOLE REYES/);

  const definitionSource = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets/js/sf-workbook.js'), 'utf8');
  const exposed = definitionSource.replace('  window.EDUGNAY_SF_WORKBOOK = {',
    '  window.EDUGNAY_SF_WORKBOOK = { worksheetPreview, validateDefinition,');
  const window = {};
  vm.runInNewContext(exposed, { window, Date });
  assert.equal(window.EDUGNAY_SF_WORKBOOK.validateDefinition(workbook, { id: 'sf9-g12-techpro-v1', formCode: 'SF9' }).mappingStatus,
    'ready');
  const preview = window.EDUGNAY_SF_WORKBOOK.worksheetPreview(originalSheet,
    { id: 'sf9-g12-techpro-v1', formCode: 'SF9' });
  assert.equal(preview.rows.length, 53);
  assert.equal(preview.columnWidths.length, 30);
  assert.equal(preview.truncated, false);

  const generated = build();
  const editable = new Map((await getEditableCells(template, generated.pages[0]))
    .map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editable.get('B33'), 'text');
  assert.equal(editable.get('F33'), 'number');
  assert.equal(editable.get('B35'), 'text');
  assert.equal(editable.get('H35'), 'number');
  assert.equal(editable.get('I38'), 'number');
  assert.equal(editable.has('B32'), false);
  assert.equal(editable.has('K35'), false);

  const editedPages = generated.pages[0].map(cell => cell.cellAddress === 'I38' ? { ...cell, value: 86 } : cell);
  const exportedBytes = await createExportWorkbook(template, editedPages);
  const exportedZip = await JSZip.loadAsync(exportedBytes);
  await assertXlsxPackageIntegrity(exportedZip);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(exportedBytes);
  const sheet = exported.getWorksheet(SF9_GRADE12_TECHPRO.sheetName);
  assert.equal(sheet.model.merges.length, originalSheet.model.merges.length);
  assert.equal(sheet.getImages().length, originalSheet.getImages().length);
  assert.equal(sheet.pageSetup.printArea, originalSheet.pageSetup.printArea);
  assert.equal(sheet.getCell('B33').value, 'TechPro Elective 4');
  assert.equal(sheet.getCell('H35').value, 90);
  assert.equal(sheet.getCell('I38').value, 86);
  assert.deepEqual(await exportedZip.file('xl/styles.xml').async('nodebuffer'),
    await sourceZip.file('xl/styles.xml').async('nodebuffer'));
});
