const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { assertXlsxPackageIntegrity } = require('./helpers/assertXlsxPackageIntegrity');
const { SF9_GRADE12_ACADEMIC, buildSf9Grade12AcademicPages } = require('../config/sf9');
const { createExportWorkbook, getEditableCells, getExportFilePath } = require('../config/sfExports');

const template = { formCode: 'SF9', version: SF9_GRADE12_ACADEMIC.version,
  filePath: '/assets/templates/school-forms/sf9-g12-academic.xlsx',
  sheetName: SF9_GRADE12_ACADEMIC.sheetName };
const sourcePath = path.resolve(__dirname, '..', '..', 'assets/templates/school-forms/sf9-g12-academic.xlsx');
const school = { schoolName: 'Sample School', depedSchoolId: '305614', region: 'VIII',
  division: 'Leyte', district: 'Tacloban', addressLine: 'Tacloban City' };
const section = { academicYear: '2026-2027', name: 'Academic A', trackName: 'Academic' };
const learner = { firstName: 'Juan', lastName: 'Dela Cruz', birthDate: '2009-01-10',
  sex: 'male', lrn: '100201000015' };
const terms = [1, 2, 3].map(sequenceNumber => ({ id: 20 + sequenceNumber, sequenceNumber }));

function records(count = 9, starts = Array.from({ length: count }, (_, index) => Math.floor(index / 3) + 1)) {
  const electives = Array.from({ length: count }, (_, index) => {
    const start = starts[index];
    return { electiveClassId: index + 1, electiveName: `Elective ${index + 1}`,
      startTermId: 20 + start, endTermId: 20 + start,
      startTermSequenceNumber: start, endTermSequenceNumber: start };
  });
  const grades = electives.map((elective, index) => ({ electiveClassId: elective.electiveClassId,
    academicTermId: elective.startTermId, termSequenceNumber: elective.startTermSequenceNumber,
    finalGrade: 80 + index }));
  return { electives, grades };
}

function build(termRecords = terms, electiveRecords = records()) {
  return buildSf9Grade12AcademicPages(school, section, 'Ms. Adviser', learner,
    termRecords, electiveRecords.electives, electiveRecords.grades);
}

test('Grade 12 Academic SF9 fits nine approved electives into three rows per term', () => {
  const result = build();
  const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(result.issues.some(issue => issue.severity === 'error'), false);
  assert.deepEqual(['B33', 'B36', 'B39'].map(address => cells.get(address)),
    ['Elective 1', 'Elective 4', 'Elective 7']);
  assert.deepEqual(['F33', 'G36', 'H39', 'I33', 'I36', 'I39'].map(address => cells.get(address)),
    [80, 83, 86, 80, 83, 86]);
  assert.equal(cells.get('G33'), '');
  assert.equal(cells.get('I43'), '');
  assert.equal(cells.get('I18'), 12);
  assert.equal(cells.get('C17'), 'Dela Cruz, Juan');
});

test('Grade 12 Academic SF9 blocks excess electives, overloaded terms, and irregular schedules', () => {
  assert.ok(build(terms, records(10)).issues.some(issue => issue.severity === 'error' && /only nine rows/.test(issue.message)));
  assert.ok(build(terms, records(9, [1, 1, 1, 1, 2, 2, 3, 3, 3])).issues
    .some(issue => issue.severity === 'error' && /Term 1 has 4/.test(issue.message)));
  for (const schedule of [terms.slice(0, 2), [terms[0], terms[1], { ...terms[2], sequenceNumber: 2 }],
    [...terms, { id: 24, sequenceNumber: 4 }]]) {
    assert.ok(build(schedule).issues.some(issue => issue.severity === 'error' && issue.fieldKey === 'terms'));
  }
  const invalidSpan = records();
  invalidSpan.electives[0].startTermId = 999;
  assert.ok(build(terms, invalidSpan).issues.some(issue => issue.severity === 'error' && issue.fieldKey === 'electiveTerms'));
});

test('Grade 12 Academic SF9 leaves missing or conflicting grades blank and supports multi-term electives', () => {
  const entries = records();
  entries.grades = entries.grades.filter(grade => grade.electiveClassId !== 1);
  entries.grades.push({ ...entries.grades[0], finalGrade: 92 });
  const cells = new Map(build(terms, entries).pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(cells.get('F33'), '');
  assert.equal(cells.get('I33'), '');
  assert.equal(cells.get('F34'), '');
  assert.equal(cells.get('I34'), '');

  const spanning = records();
  spanning.electives[0].endTermId = 22;
  spanning.electives[0].endTermSequenceNumber = 2;
  spanning.grades.push({ electiveClassId: 1, academicTermId: 22, termSequenceNumber: 2, finalGrade: 90 });
  const spanCells = new Map(build(terms, spanning).pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.deepEqual(['F33', 'G33', 'I33'].map(address => spanCells.get(address)), [80, 90, 85]);
});

test('Grade 12 Academic SF9 template and export preserve the form layout and adviser edits', async () => {
  const sourceBytes = await fs.readFile(sourcePath);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  await assertXlsxPackageIntegrity(sourceZip);
  const sourceXml = await sourceZip.file('xl/worksheets/sheet2.xml')?.async('string');
  assert.ok(sourceXml);
  assert.doesNotMatch(sourceXml, /<f\b|#REF!/);
  const stringsXml = await sourceZip.file('xl/sharedStrings.xml').async('string');
  assert.doesNotMatch(stringsXml, /ABC ELEMENTARY SCHOOL|NICOLE REYES/);
  const source = new ExcelJS.Workbook();
  await source.xlsx.load(sourceBytes);
  assert.deepEqual(source.worksheets.map(sheet => sheet.name), [SF9_GRADE12_ACADEMIC.sheetName]);
  const originalSheet = source.worksheets[0];
  assert.equal(originalSheet.model.merges.length, 127);
  assert.equal(originalSheet.getImages().length, 1);
  assert.equal(originalSheet.pageSetup.printArea, 'A2:AD53');
  assert.equal(originalSheet.pageSetup.orientation, 'landscape');
  assert.equal(originalSheet.getCell('B33').value, null);

  const generated = build();
  const editable = new Map((await getEditableCells(template, generated.pages[0]))
    .map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editable.get('B33'), 'text');
  assert.equal(editable.get('F33'), 'number');
  assert.equal(editable.get('I43'), 'number');
  assert.equal(editable.has('B32'), false);
  const page = generated.pages[0].map(cell => cell.cellAddress === 'I43' ? { ...cell, value: 86 } : cell);
  const exported = await createExportWorkbook(template, [page]);
  const outputZip = await JSZip.loadAsync(exported);
  await assertXlsxPackageIntegrity(outputZip);
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(exported);
  assert.deepEqual(output.worksheets.map(sheet => sheet.name), source.worksheets.map(sheet => sheet.name));
  const sheet = output.worksheets[0];
  assert.equal(sheet.model.merges.length, originalSheet.model.merges.length);
  assert.equal(sheet.getImages().length, originalSheet.getImages().length);
  assert.equal(sheet.pageSetup.printArea, originalSheet.pageSetup.printArea);
  assert.equal(sheet.getCell('B33').value, 'Elective 1');
  assert.equal(sheet.getCell('F33').value, 80);
  assert.equal(sheet.getCell('I43').value, 86);
  assert.deepEqual(await outputZip.file('xl/styles.xml').async('nodebuffer'),
    await sourceZip.file('xl/styles.xml').async('nodebuffer'));
  assert.match(getExportFilePath('sf9-123e4567-e89b-12d3-a456-426614174000.xlsx'), /sf9-123e4567/);
  assert.throws(() => getExportFilePath('../invalid.xlsx'), /invalid/);
});
