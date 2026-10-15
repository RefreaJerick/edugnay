const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { SF8, buildSf8Pages } = require('../config/sf8');
const { createCombinedExportWorkbook, createExportWorkbook, getEditableCells, getExportFilePath } = require('../config/sfExports');

const templateDirectory = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
const school = {
  schoolName: 'AcadeMix School', depedSchoolId: '305614', region: 'VIII', division: 'Leyte', district: 'Tacloban'
};
const section = {
  name: 'St. Matthew', academicYear: '2026-2027', gradeLevel: 'Grade 7', strandName: null
};

function student(number, sex = 'male') {
  return {
    userId: number,
    firstName: `Learner${number}`,
    lastName: 'Sample',
    middleName: 'A',
    lrn: String(100000000000 + number),
    sex,
    birthDate: '2013-01-10'
  };
}

function sf8Template() {
  return { formCode: 'SF8', filePath: '/assets/templates/school-forms/sf8.xlsx', sheetName: SF8.sheetName };
}

test('SF8 fills school and sex-grouped roster cells while leaving health assessment fields blank', () => {
  const result = buildSf8Pages(school, section, [student(1), student(2, 'female'), student(3, 'unknown')]);
  const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(cells.get('E5'), school.schoolName);
  assert.equal(cells.get('C7'), school.depedSchoolId);
  assert.equal(cells.get('F7'), section.gradeLevel);
  assert.equal(cells.get('H7'), section.name);
  assert.equal(cells.get('O7'), section.academicYear);
  assert.equal(cells.get('B12'), '100000000001');
  assert.equal(cells.get('C12'), 'Sample, Learner1, A');
  assert.equal(cells.get('G12'), '2013-01-10');
  assert.equal(cells.get('B65'), '100000000002');
  assert.equal(cells.get('C65'), 'Sample, Learner2, A');
  for (const address of ['H12', 'I12', 'J12', 'K12', 'L12', 'M12', 'N12', 'O12', 'C114', 'B119']) {
    assert.equal(cells.has(address), false, address);
  }
  assert.equal(cells.has('C13'), false);
  assert.ok(result.issues.some(issue => issue.fieldKey === 'sex' && /Learner3/.test(issue.message)));
  assert.ok(result.issues.some(issue => issue.fieldKey === 'draft'));
});

test('SF8 warns when school or learner details are missing and when the roster is empty', () => {
  const empty = buildSf8Pages({}, section, []);
  assert.equal(empty.pages.length, 1);
  assert.ok(empty.issues.some(issue => issue.fieldKey === 'roster'));
  assert.ok(empty.issues.some(issue => issue.fieldKey === 'schoolId'));
  assert.ok(empty.issues.some(issue => issue.fieldKey === 'schoolName'));

  const incompleteLearner = student(4);
  incompleteLearner.firstName = '';
  incompleteLearner.lastName = '';
  incompleteLearner.lrn = null;
  incompleteLearner.sex = '';
  incompleteLearner.birthDate = null;
  const result = buildSf8Pages(school, section, [incompleteLearner]);
  assert.equal(result.pages[0].some(cell => /^([BCG])12$/.test(cell.cellAddress)), false);
  for (const fieldKey of ['name', 'lrn', 'sex', 'birthDate']) {
    assert.ok(result.issues.some(issue => issue.fieldKey === fieldKey), fieldKey);
  }
});

test('SF8 adds roster pages independently for the 52 male and 44 female slots', () => {
  const learners = [
    ...Array.from({ length: SF8.maleSlots + 1 }, (_, index) => student(index + 1)),
    ...Array.from({ length: SF8.femaleSlots + 1 }, (_, index) => student(index + 100, 'female'))
  ];
  const result = buildSf8Pages(school, section, learners);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B63').value, '100000000052');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B12').value, '100000000053');
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B108').value, '100000000143');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B65').value, '100000000144');
});

test('SF8 exposes health inputs, summaries, and sign-off cells but protects labels and numbering formulas', async () => {
  const cells = await getEditableCells(sf8Template(), []);
  const schema = new Map(cells.map(cell => [cell.cellAddress, cell.type]));
  assert.equal(schema.get('E5'), 'text');
  assert.equal(schema.get('C7'), 'text');
  assert.equal(schema.get('B12'), 'text');
  assert.equal(schema.get('C12'), 'text');
  assert.equal(schema.get('G12'), 'date');
  assert.equal(schema.get('H12'), 'number');
  assert.equal(schema.get('I12'), 'number');
  assert.equal(schema.get('J12'), 'number');
  assert.equal(schema.get('K12'), 'number');
  assert.equal(schema.get('L12'), 'number');
  assert.equal(schema.get('M12'), 'text');
  assert.equal(schema.get('N12'), 'text');
  assert.equal(schema.get('O12'), 'text');
  assert.equal(schema.get('C114'), 'number');
  assert.equal(schema.get('N116'), 'number');
  assert.equal(schema.get('B119'), 'text');
  for (const address of ['A9', 'A12', 'A114', 'A118', 'D12', 'M118']) assert.equal(schema.has(address), false, address);
});

test('SF8 private exports are accepted only by the protected school-form export path', () => {
  assert.match(getExportFilePath('sf8-11111111-1111-1111-1111-111111111111.xlsx'), /sf8-11111111-1111-1111-1111-111111111111\.xlsx$/);
  assert.throws(() => getExportFilePath('sf4-11111111-1111-1111-1111-111111111111.xlsx'));
});

test('SF8 export retains the supplied layout and images while applying only workbook edits', async () => {
  const sourcePath = path.join(templateDirectory, 'sf8.xlsx');
  const sourceZip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const sourceStyles = await sourceZip.file('xl/styles.xml').async('nodebuffer');
  const pages = buildSf8Pages(school, section, [student(1)]).pages;
  pages[0].push(
    { cellAddress: 'G12', value: '2014-06-05', type: 'date' },
    { cellAddress: 'I12', value: 21.4, type: 'number' },
    { cellAddress: 'M12', value: 'Normal', type: 'text' },
    { cellAddress: 'N12', value: 'Age appropriate', type: 'text' }
  );
  const output = await createExportWorkbook(sf8Template(), pages);
  const outputZip = await JSZip.loadAsync(output);
  assert.ok(sourceStyles.equals(await outputZip.file('xl/styles.xml').async('nodebuffer')));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [SF8.sheetName]);
  const sheet = workbook.getWorksheet(SF8.sheetName);
  assert.equal(sheet.getCell('I12').value, 21.4);
  assert.equal(sheet.getCell('M12').value, 'Normal');
  assert.equal(sheet.getCell('N12').value, 'Age appropriate');
  assert.equal(sheet.getCell('G12').value.toISOString().slice(0, 10), '2014-06-05');
  assert.equal(sheet.getCell('G13').value, null);
  for (const address of ['G12', 'G13', 'G63', 'G65', 'G108']) {
    assert.equal(sheet.getCell(address).numFmt, 'mm/dd/yyyy', address);
  }
  assert.equal(sheet.getCell('G12').border.bottom.style, 'thin');
  assert.equal(sheet.getCell('G108').border.bottom.style, 'medium');
  assert.equal(sheet.getCell('A12').value.formula, 'IF(C12="","",ROWS($C$11:C12))');
  assert.equal(sheet.model.merges.length, 132);
  assert.equal(sheet.getImages().length, 2);
  assert.equal(sheet.pageSetup.scale, 65);
  assert.equal(sheet.pageSetup.printTitlesRow, '9:10');
  assert.equal(sheet.getCell('I12').style.font.name, 'Arial Narrow');
});

test('SF8 combined exports work for every two to five form selection and retain overflow pages', async () => {
  const formIds = ['SF1', 'SF2', 'SF3', 'SF5'];
  const sheetNames = {
    SF1: 'School Form 1 (SF1)',
    SF2: 'School Form 2 (SF2)',
    SF3: 'School Form 3 (SF3)',
    SF5: 'School Form 5 (SF5)',
    SF8: SF8.sheetName
  };
  for (let mask = 1; mask < 16; mask += 1) {
    const codes = [...formIds.filter((_, index) => mask & (1 << index)), 'SF8'];
    const forms = codes.map(formCode => {
      const pages = formCode === 'SF8' ? buildSf8Pages(school, section, [student(mask)]).pages : [[]];
      if (formCode === 'SF8') pages[0].push({ cellAddress: 'G12', value: '2014-06-05', type: 'date' });
      return { formCode, pages };
    });
    const buffer = await createCombinedExportWorkbook(forms);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), codes.map(code => sheetNames[code]));
    const sheet = workbook.getWorksheet(SF8.sheetName);
    assert.equal(sheet.getImages().length, 2, codes.join(','));
    assert.equal(sheet.getCell('G12').numFmt, 'mm/dd/yyyy', codes.join(','));
    assert.equal(sheet.getCell('G12').value.toISOString().slice(0, 10), '2014-06-05', codes.join(','));
  }

  const overflow = buildSf8Pages(school, section, [
    ...Array.from({ length: 53 }, (_, index) => student(index + 1)),
    ...Array.from({ length: 45 }, (_, index) => student(index + 100, 'female'))
  ]).pages;
  overflow[1].push({ cellAddress: 'G65', value: '2015-02-03', type: 'date' });
  const buffer = await createCombinedExportWorkbook([
    { formCode: 'SF1', pages: [[]] },
    { formCode: 'SF8', pages: overflow }
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['School Form 1 (SF1)', SF8.sheetName, 'SF8 Page 2']);
  assert.equal(workbook.getWorksheet('SF8 Page 2').getCell('B12').value, '100000000053');
  assert.equal(workbook.getWorksheet('SF8 Page 2').getCell('G12').value.toISOString().slice(0, 10), '2013-01-10');
  assert.equal(workbook.getWorksheet('SF8 Page 2').getCell('G12').numFmt, 'mm/dd/yyyy');
  assert.equal(workbook.getWorksheet('SF8 Page 2').getCell('G65').value.toISOString().slice(0, 10), '2015-02-03');
  assert.equal(workbook.getWorksheet('SF8 Page 2').getCell('G65').numFmt, 'mm/dd/yyyy');
  assert.equal(workbook.getWorksheet('SF8 Page 2').getImages().length, 2);
  assert.equal(workbook.getWorksheet('SF8 Page 2').pageSetup.scale, 65);
});
