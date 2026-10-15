const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { assertXlsxPackageIntegrity } = require('./helpers/assertXlsxPackageIntegrity');
const { SF9, buildSf9Pages } = require('../config/sf9');
const { createExportWorkbook, getEditableCells } = require('../config/sfExports');

const root = path.resolve(__dirname, '..', '..');
const templatePath = path.join(root, 'assets/templates/school-forms/sf9.xlsx');
const template = { formCode: 'SF9', filePath: '/assets/templates/school-forms/sf9.xlsx', sheetName: SF9.sheetName };
const school = {
  schoolName: 'Sample School', depedSchoolId: '305614', region: 'VIII',
  division: 'Leyte', district: 'Tacloban', addressLine: 'Tacloban City'
};
const section = {
  id: 8, name: 'St. Matthew', academicYear: '2026-2027', gradeCode: 'grade-4',
  gradeLevel: 'Grade 4', strandName: null
};
const learner = {
  userId: 10, firstName: 'Juan', middleName: 'A', lastName: 'Dela Cruz',
  birthDate: '2016-01-10', sex: 'male', lrn: '100201000015'
};

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedName}="([^"]*)"`).exec(tag)?.[1] || '';
}

async function firstWorksheetXml(zip) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const workbookRelationships = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheet = /<sheet\b[^>]*\/?\s*>/.exec(workbookXml)?.[0];
  assert.ok(sheet, 'workbook must contain a worksheet');
  const relationshipId = xmlAttribute(sheet, 'r:id');
  const relationship = [...workbookRelationships.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map(match => match[0])
    .find(tag => xmlAttribute(tag, 'Id') === relationshipId);
  assert.ok(relationship, `workbook relationship ${relationshipId} must exist`);
  const target = xmlAttribute(relationship, 'Target').replace(/&amp;/g, '&');
  const worksheetPath = target.startsWith('/') ? target.slice(1)
    : path.posix.normalize(path.posix.join('xl', target));
  return zip.file(worksheetPath).async('string');
}

function subjects(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Subject ${index + 1}` }));
}

function terms(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 21, name: `Term ${index + 1}` }));
}

function gradesFor(subjectList, termList) {
  return subjectList.flatMap(subject => termList.map((term, index) => ({
    studentId: learner.userId,
    subjectId: subject.id,
    academicTermId: term.id,
    finalGrade: 80 + index * 2,
    sectionName: index === 0 ? 'Previous Section' : section.name
  })));
}

test('SF9 calculates subject and general averages only from complete published period grades', () => {
  for (const termCount of [2, 3, 4]) {
    const subjectList = subjects(2);
    const termList = terms(termCount);
    const result = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList,
      gradesFor(subjectList, termList));
    const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));
    const average = 80 + (termCount - 1);

    assert.equal(cells.get('J32'), average);
    assert.equal(cells.get('J33'), average);
    assert.equal(result.averageCellAddress, 'J42');
    assert.equal(cells.get('J42'), average);
    assert.equal(cells.get('I18'), 4);
    assert.equal(cells.get('F31'), termCount === 4 ? 'Q1' : 'Term 1');
    assert.equal(cells.get('G31'), termCount === 4 ? 'Q2' : 'Term 2');
    assert.equal(cells.get('H31'), termCount === 4 ? 'Q3' : termCount === 3 ? 'Term 3' : '');
    assert.equal(cells.get('I31'), termCount === 4 ? 'Q4' : '');
    assert.equal(result.issues.some(issue => issue.fieldKey === 'grade'), false);
  }

  for (const grade of [4, 7, 10]) {
    const gradeSection = { ...section, gradeCode: `grade-${grade}`, gradeLevel: `Grade ${grade}` };
    const result = buildSf9Pages(school, gradeSection, 'Ms. Adviser', learner, subjects(1), terms(4),
      gradesFor(subjects(1), terms(4)));
    assert.equal(new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value])).get('I18'), grade);
  }

  const subjectList = subjects(1);
  const termList = terms(4);
  const grades = gradesFor(subjectList, termList);
  const missing = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList, grades.slice(1));
  const missingCells = new Map(missing.pages[0].map(cell => [cell.cellAddress, cell.value]));
  assert.equal(missingCells.get('F32'), '');
  assert.equal(missingCells.get('J32'), '');
  assert.equal(missingCells.get('J42'), '');
  assert.ok(missing.issues.some(issue => /no published grade/.test(issue.message)));

  const conflict = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList,
    [...grades, { ...grades[0], sectionName: 'Conflicting Previous Section' }]);
  assert.ok(conflict.issues.some(issue => /conflicting published grades/.test(issue.message)));
});

test('SF9 places all assigned subjects before a dynamically positioned average row', () => {
  const subjectList = subjects(12);
  const termList = terms(4);
  const result = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList,
    gradesFor(subjectList, termList));
  const cells = new Map(result.pages[0].map(cell => [cell.cellAddress, cell.value]));

  assert.equal(cells.get('B41'), 'Subject 10');
  assert.equal(cells.get('B42'), 'Subject 11');
  assert.equal(cells.get('B43'), 'Subject 12');
  assert.equal(result.averageCellAddress, 'J44');
  assert.equal(cells.get('J44'), 83);
  assert.equal(cells.has('J42'), true);
  assert.equal(cells.has('J43'), true);
});

test('SF9 entry-cell validation keeps labels protected and supports overflow subject rows', async () => {
  const tenSubjects = subjects(10);
  const mappedTen = buildSf9Pages(school, section, 'Ms. Adviser', learner, tenSubjects, terms(4),
    gradesFor(tenSubjects, terms(4))).pages[0];
  const editableTen = new Map((await getEditableCells(template, mappedTen)).map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editableTen.get('C17'), 'text');
  assert.equal(editableTen.get('F32'), 'number');
  assert.equal(editableTen.get('J42'), 'number');
  assert.equal(editableTen.has('F30'), false);
  assert.equal(editableTen.has('A32'), false);
  assert.equal(editableTen.has('B14'), false);

  const twelveSubjects = subjects(12);
  const mappedTwelve = buildSf9Pages(school, section, 'Ms. Adviser', learner, twelveSubjects, terms(4),
    gradesFor(twelveSubjects, terms(4))).pages[0];
  const editableTwelve = new Map((await getEditableCells(template, mappedTwelve)).map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editableTwelve.get('F42'), 'number');
  assert.equal(editableTwelve.get('J43'), 'number');
  assert.equal(editableTwelve.get('J44'), 'number');
});

test('SF9 browser preview extends subject rows and the print area for overflow subjects', async () => {
  const source = await fs.readFile(path.join(root, 'assets/js/sf-workbook.js'), 'utf8');
  const exposed = source.replace('  window.EDUGNAY_SF_WORKBOOK = {',
    '  window.EDUGNAY_SF_WORKBOOK = { extendSf9PreviewRows, worksheetPreview,');
  const window = {};
  vm.runInNewContext(exposed, { window, Date });
  const browser = window.EDUGNAY_SF_WORKBOOK;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const worksheet = workbook.getWorksheet(SF9.sheetName);
  const extraRows = browser.extendSf9PreviewRows(worksheet, 12);
  for (let index = 0; index < 12; index += 1) worksheet.getCell(`B${32 + index}`).value = `Subject ${index + 1}`;
  const preview = browser.worksheetPreview(worksheet,
    { id: 'sf9-learner-performance-v1', formCode: 'SF9', previewRows: 52 + extraRows },
    ['B42', 'B43', 'J44']);

  assert.equal(extraRows, 2);
  assert.equal(worksheet.pageSetup.printArea, 'A2:AD54');
  assert.equal(preview.rows.length, 54);
  assert.equal(preview.rows[41].cells.find(cell => cell.address === 'B42').text, 'Subject 11');
  assert.equal(preview.rows[42].cells.find(cell => cell.address === 'B43').text, 'Subject 12');
  assert.equal(preview.rows[43].cells.find(cell => cell.address === 'J44').editable, true);
});

test('SF9 manual preview edits are written to the XLSX only', async () => {
  const subjectList = subjects(1);
  const termList = terms(2);
  const generated = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList,
    gradesFor(subjectList, termList));
  const editable = new Map((await getEditableCells(template, generated.pages[0]))
    .map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editable.get('C18'), 'text');
  assert.equal(editable.get('I18'), 'number');
  assert.equal(editable.get('R5'), 'number');
  assert.equal(editable.has('F30'), false);

  const editedPage = generated.pages[0].map(cell => {
    if (cell.cellAddress === 'C18') return { ...cell, value: '999999999999' };
    if (cell.cellAddress === 'I18') return { ...cell, value: 7, type: 'number' };
    return cell;
  });
  editedPage.push({ cellAddress: 'R5', value: 18, type: 'number' });
  const bytes = await createExportWorkbook(template, [editedPage]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet(SF9.sheetName);

  assert.equal(sheet.getCell('C18').value, '999999999999');
  assert.equal(sheet.getCell('I18').value, 7);
  assert.equal(sheet.getCell('R5').value, 18);
  assert.equal(learner.lrn, '100201000015');
  assert.equal(generated.pages[0].find(cell => cell.cellAddress === 'C18').value, learner.lrn);
});

test('SF9 source and generated workbook preserve its image, layout, and print setup without broken references', async () => {
  const sourceBytes = await fs.readFile(templatePath);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  await assertXlsxPackageIntegrity(sourceZip);
  assert.match(await sourceZip.file('xl/workbook.xml').async('string'), /firstSheet="0"/);
  const sourceXml = await firstWorksheetXml(sourceZip);
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(sourceBytes);
  const sourceSheet = sourceWorkbook.getWorksheet(SF9.sheetName);
  assert.equal(sourceWorkbook.worksheets.length, 1);
  assert.equal(sourceSheet.getImages().length, 1);
  assert.equal(sourceSheet.pageSetup.orientation, 'landscape');
  assert.equal(sourceSheet.pageSetup.printArea, 'A2:AD52');
  assert.equal(sourceSheet.model.merges.length, 125);

  const addresses = [...sourceXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g)].map(match => match[1]);
  assert.equal(new Set(addresses).size, addresses.length, 'source template cell references must be unique');
  assert.doesNotMatch(sourceXml, /<f\b|#REF!|<x14:dataValidations\b/);
  for (const address of ['B12', 'B15', 'C17', 'C18', 'I17', 'K17', 'J42']) {
    assert.equal(sourceSheet.getCell(address).value, null, `${address} should not contain sample learner or school data`);
  }

  const subjectList = subjects(12);
  const termList = terms(4);
  const mapped = buildSf9Pages(school, section, 'Ms. Adviser', learner, subjectList, termList,
    gradesFor(subjectList, termList));
  const exportedBytes = await createExportWorkbook(template, mapped.pages);
  const exportedZip = await JSZip.loadAsync(exportedBytes);
  await assertXlsxPackageIntegrity(exportedZip);
  assert.match(await exportedZip.file('xl/workbook.xml').async('string'), /firstSheet="0"/);
  const exportedXml = await firstWorksheetXml(exportedZip);
  const exportedCellAddresses = [...exportedXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"/g)]
    .map(match => match[1]);
  assert.equal(new Set(exportedCellAddresses).size, exportedCellAddresses.length,
    'SF9 overflow rows must not duplicate worksheet cell references');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exportedBytes);
  const sheet = workbook.getWorksheet(SF9.sheetName);

  assert.doesNotMatch(exportedXml, /<f\b|#REF!/);
  assert.equal(sheet.getImages().length, 1);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.printArea, 'A2:AD54');
  assert.equal(sheet.getCell('B43').value, 'Subject 12');
  assert.equal(sheet.getCell('J44').value, mapped.generalAverage);
  assert.equal(sheet.getCell('F31').value, 'Q1');
  assert.equal(sheet.getCell('G31').value, 'Q2');
  assert.equal(sheet.getCell('H31').value, 'Q3');
  assert.equal(sheet.getCell('I31').value, 'Q4');
  assert.deepEqual(await exportedZip.file('xl/styles.xml').async('nodebuffer'),
    await sourceZip.file('xl/styles.xml').async('nodebuffer'));
});

test('SF9 learner selection and preview stay adviser-only, level-limited, and separate from combined forms', async () => {
  const rootFiles = await Promise.all([
    fs.readFile(path.join(root, 'backend/routes/sfTemplates.js'), 'utf8'),
    fs.readFile(path.join(root, 'backend/controllers/sfTemplatesController.js'), 'utf8'),
    fs.readFile(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8'),
    fs.readFile(path.join(root, 'assets/js/shell-common.js'), 'utf8'),
    fs.readFile(path.join(root, 'views/teacher/edugnay-teacher-sf-templates.html'), 'utf8')
  ]);
  const [routes, controller, page, api, html] = rootFiles;

  assert.match(routes, /get\('\/sf-templates\/:templateId\/learners', requireAuth, requireTeacher, controller\.listSf9Learners\)/);
  assert.match(controller, /sections\.school_id = \? AND sections\.adviser_user_id = \?/);
  assert.match(controller, /studentId = parseId\([\s\S]*?'learner ID'\)/);
  assert.match(controller, /learners\.find\(record => Number\(record\.userId\) === studentId\)/);
  assert.match(controller, /grade-\(\?:\[4-9\]\|10\)/);
  assert.match(page, /sf9Only[\s\S]*academicYearStatus/);
  assert.match(page, /section\.status === 'active' && section\.academicYearStatus === 'active'/);
  assert.match(page, /section\.status === 'archived' && section\.academicYearStatus === 'closed'/);
  assert.match(page, /!formCodes\.includes\('SF9'\)/);
  assert.match(api, /studentId=\$\{encodeURIComponent\(values\.studentId \|\| ''\)\}/);
  assert.match(html, /id="sfGenerateLearner"/);
});

test('advisory class eligibility follows API status as templates change', async () => {
  const page = await fs.readFile(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8');
  const availableSectionsSource = page.match(/function availableSections\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(availableSectionsSource);

  const sections = [
    { id: 'active-grade-7', status: 'active', academicYearStatus: 'active', gradeCode: 'grade-7' },
    { id: 'closed-grade-7', status: 'archived', academicYearStatus: 'closed', gradeCode: 'grade-7' },
    { id: 'active-grade-3', status: 'active', academicYearStatus: 'active', gradeCode: 'grade-3' },
    { id: 'active-grade-11', status: 'active', academicYearStatus: 'active', gradeCode: 'grade-11' }
  ];
  const eligibleIds = templates => vm.runInNewContext(
    `${availableSectionsSource}; availableSections().map(section => section.id);`,
    { sfState: { sections }, selectedTemplates: () => templates }
  );

  assert.deepEqual(eligibleIds([{ formCode: 'SF9' }]), ['active-grade-7', 'closed-grade-7']);
  assert.deepEqual(eligibleIds([{ formCode: 'SF3' }, { formCode: 'SF5' }]), ['active-grade-7', 'active-grade-3']);
  assert.deepEqual(eligibleIds([{ formCode: 'SF9' }]), ['active-grade-7', 'closed-grade-7']);
  assert.deepEqual(eligibleIds([{ formCode: 'SF5' }]), ['active-grade-7', 'closed-grade-7', 'active-grade-3']);
  assert.deepEqual(eligibleIds([{ formCode: 'SF3' }]), ['active-grade-7', 'active-grade-3', 'active-grade-11']);
});

test('incompatible SF9 selections show an error toast while supported combinations remain unchanged', async () => {
  const page = await fs.readFile(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8');
  const listenerSource = page.match(/sfElements\.templateList\.addEventListener\('change', event => \{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(listenerSource);

  const templates = [
    { id: 'sf1', formCode: 'SF1' },
    { id: 'sf2', formCode: 'SF2' },
    { id: 'sf3', formCode: 'SF3' },
    { id: 'sf5', formCode: 'SF5' },
    { id: 'sf8', formCode: 'SF8' },
    { id: 'sf9', formCode: 'SF9' }
  ];
  const inputs = templates.map(template => ({ value: template.id, checked: false, matches: () => true }));
  let changeHandler;
  const toastMessages = [];
  const sfElements = {
    templateList: {
      addEventListener: (_eventName, handler) => { changeHandler = handler; },
      querySelectorAll: () => inputs
    }
  };
  const selectedTemplates = () => inputs
    .filter(input => input.checked)
    .map(input => templates.find(template => template.id === input.value));
  vm.runInNewContext(listenerSource, {
    sfElements,
    sfState: { selectedTemplateIds: [] },
    selectedTemplates,
    updateTemplatePicker() {},
    invalidateGeneratedPreview() {},
    renderSectionOptions() {},
    updateMonthField() {},
    updateSf9LearnerOptions() {},
    updateGenerateButton() {},
    showAppToast: (...args) => toastMessages.push(args)
  });

  const select = id => {
    const input = inputs.find(record => record.value === id);
    input.checked = !input.checked;
    changeHandler({ target: input });
  };
  const selectedCodes = () => selectedTemplates().map(template => template.formCode);

  select('sf3');
  select('sf5');
  assert.deepEqual(selectedCodes(), ['SF3', 'SF5']);
  assert.equal(toastMessages.length, 0);

  select('sf9');
  assert.deepEqual(selectedCodes(), ['SF9']);
  assert.deepEqual(toastMessages.at(-1), ['The selected form cannot be combined with other forms.', 'error']);

  select('sf3');
  assert.deepEqual(selectedCodes(), ['SF9']);
  assert.equal(toastMessages.length, 2);

  select('sf9');
  assert.deepEqual(selectedCodes(), []);
  assert.equal(toastMessages.length, 2);
});
