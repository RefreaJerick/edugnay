const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { SF5, buildSf5Pages } = require('../config/sf5');
const databaseModule = require('../config/database');

process.env.SF_EXPORT_DIRECTORY = path.join(os.tmpdir(), 'edugnay-sf5-test-exports');
const { createExportWorkbook, getExportFilePath } = require('../config/sfExports');

const school = { schoolName: 'Sample School', depedSchoolId: '305614', region: 'VIII', division: 'Leyte', district: 'Tacloban' };
const section = { id: 8, name: 'St. Mark', academicYearId: 4, schoolLevelId: 2,
  gradeLevelId: 7, strandId: null, gradeCode: 'grade-7', academicYear: '2026-2027', gradeLevel: 'Grade 7' };
const subjects = [{ id: 11, name: 'English' }, { id: 12, name: 'Science' }];
const terms = [{ id: 21, name: 'Quarter 1' }, { id: 22, name: 'Quarter 2' }];
const assetPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf5.xlsx');
const template = { formCode: 'SF5', filePath: '/assets/templates/school-forms/sf5.xlsx', sheetName: SF5.sheetName };

function learner(index, sex = 'male') {
  return { userId: index, firstName: `Student${index}`, lastName: 'Sample', middleName: 'A',
    sex, lrn: String(100000000000 + index) };
}

function published(studentId, subjectId, academicTermId, finalGrade, sectionName = 'St. Mark') {
  return { studentId, subjectId, academicTermId, finalGrade, sectionName };
}

function completeGrades(studentId) {
  return [published(studentId, 11, 21, 80), published(studentId, 11, 22, 90, 'Old Section'),
    published(studentId, 12, 21, 91), published(studentId, 12, 22, 94)];
}

test('SF5 computes one two-decimal average from all configured subject-period grades, including retained grades', () => {
  const result = buildSf5Pages(school, section, [learner(1), learner(2, 'female')], subjects, terms,
    [...completeGrades(1), ...completeGrades(2)]);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'A13').value, '100000000001');
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B13').value, 'Sample, Student1, A');
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'F13').value, 88.75);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'F34').value, 88.75);
  assert.equal(result.breakdown[0].subjects[0].terms[1].section, 'Old Section');
  assert.deepEqual(result.breakdown[0].subjects[0].termDetails.map(term => term.term), ['Quarter 1', 'Quarter 2']);
  assert.deepEqual(result.breakdown[0].subjects[0].termDetails.map(term => term.grade), [80, 90]);
  assert.equal(result.pages[0].some(cell => /^G(?:1[3-9]|2\d|3[0-2]|3[4-9]|[4-5]\d)$/.test(cell.cellAddress)), false);
});

test('SF5 supports semestral and three-term configurations without guessing missing grades', () => {
  for (const count of [2, 3]) {
    const configuredTerms = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Term ${i + 1}` }));
    const grades = configuredTerms.map(term => published(1, 11, term.id, 80 + term.id));
    const complete = buildSf5Pages(school, section, [learner(1)], [subjects[0]], configuredTerms, grades);
    assert.equal(complete.pages[0].find(cell => cell.cellAddress === 'F13').value, 81 + (count - 1) / 2);
    const incomplete = buildSf5Pages(school, section, [learner(1)], [subjects[0]], configuredTerms, grades.slice(1));
    assert.equal(incomplete.pages[0].some(cell => cell.cellAddress === 'F13'), false);
    assert.ok(incomplete.issues.some(issue => issue.fieldKey === 'generalAverage'));
  }
});

test('SF5 leaves a conflicting or incomplete learner average blank, without blocking other learners', () => {
  const grades = [...completeGrades(1), ...completeGrades(2), published(1, 11, 22, 95, 'Other Section')];
  const result = buildSf5Pages(school, section, [learner(1), learner(2, 'female')], subjects, terms, grades);
  assert.equal(result.pages[0].some(cell => cell.cellAddress === 'F13'), false);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'F34').value, 88.75);
  assert.ok(result.breakdown[0].subjects[0].missingTerms.some(term => term.reason === 'conflicting published grades'));
  assert.deepEqual(result.breakdown[0].subjects[0].termDetails.map(term => term.term), ['Quarter 1', 'Quarter 2']);
  assert.equal(result.breakdown[0].subjects[0].termDetails[1].reason, 'conflicting published grades');
  assert.equal(result.breakdown[0].subjects[0].termDetails[1].grade, null);
  assert.equal(result.issues.filter(issue => issue.fieldKey === 'generalAverage').length, 1);
});

test('SF5 adds pages while preserving its separate male and female roster slots', () => {
  const students = [...Array.from({ length: 21 }, (_, i) => learner(i + 1)),
    ...Array.from({ length: 27 }, (_, i) => learner(i + 22, 'female')), learner(49, 'unknown')];
  const result = buildSf5Pages(school, section, students, [], [], []);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B32').value, 'Sample, Student20, A');
  assert.equal(result.pages[0].find(cell => cell.cellAddress === 'B59').value, 'Sample, Student47, A');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B13').value, 'Sample, Student21, A');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'B34').value, 'Sample, Student48, A');
  assert.equal(result.pages[1].find(cell => cell.cellAddress === 'M61').value, 'School Form 5: Page 2 of 2');
  assert.ok(result.issues.some(issue => issue.fieldKey === 'sex'));
});

test('SF5 export retains the teacher-supplied image, merges, print settings, and two-decimal numeric style', async () => {
  const roster = [...Array.from({ length: 21 }, (_, i) => learner(i + 1)),
    ...Array.from({ length: 26 }, (_, i) => learner(i + 22, 'female'))];
  const pages = buildSf5Pages(school, section, roster,
    subjects, terms, roster.flatMap(item => completeGrades(item.userId))).pages;
  const original = await JSZip.loadAsync(await fs.readFile(assetPath));
  const exported = await JSZip.loadAsync(await createExportWorkbook(template, pages));
  assert.equal((await exported.file('xl/styles.xml').async('string')).includes('numFmtId="2"'), true);
  for (const part of ['xl/media/image1.png', 'xl/printerSettings/printerSettings1.bin']) {
    assert.deepEqual(await exported.file(part).async('nodebuffer'), await original.file(part).async('nodebuffer'));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exported.generateAsync({ type: 'nodebuffer' }));
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(assetPath);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [SF5.sheetName, 'SF5 Page 2']);
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.model.merges.length, 210);
    assert.equal(sheet.getImages().length, 1);
    assert.equal(sheet.pageSetup.orientation, 'landscape');
    assert.equal(sheet.pageSetup.paperSize, 9);
    assert.equal(sheet.getCell('F13').numFmt, '0.00');
    assert.equal(sheet.getCell('G13').value, null);
    assert.equal(sheet.getCell('M49').value, 'GUIDELINES:');
  }
  for (const address of ['F13', 'F32', 'F34', 'F59']) {
    const before = sourceWorkbook.worksheets[0].getCell(address);
    const after = workbook.worksheets[0].getCell(address);
    assert.deepEqual(after.font, before.font, `${address} font`);
    assert.deepEqual(after.border, before.border, `${address} border`);
    assert.deepEqual(after.alignment, before.alignment, `${address} alignment`);
  }
  assert.equal(workbook.worksheets[1].getCell('B13').value, 'Sample, Student21, A');
});

test('SF5 private export path rejects other names', () => {
  const file = 'sf5-11111111-1111-1111-1111-111111111111.xlsx';
  assert.ok(getExportFilePath(file).startsWith(path.resolve(process.env.SF_EXPORT_DIRECTORY)));
  assert.throws(() => getExportFilePath('sf4-11111111-1111-1111-1111-111111111111.xlsx'));
});

test('SF5 browser preview retains the supplied worksheet bounds and is not editable', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets', 'js', 'sf-workbook.js'), 'utf8');
  const exposed = source.replace('  window.EDUGNAY_SF_WORKBOOK = {', '  window.EDUGNAY_SF_WORKBOOK = { worksheetPreview, validateDefinition,');
  const window = {};
  vm.runInNewContext(exposed, { window, Date });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(assetPath);
  const definition = window.EDUGNAY_SF_WORKBOOK.getTemplateDefinition({ id: 'sf5-promotion-proficiency-v1' });
  assert.equal(window.EDUGNAY_SF_WORKBOOK.validateDefinition(workbook,
    { id: 'sf5-promotion-proficiency-v1', formCode: 'SF5' }).mappingStatus, 'ready');
  const preview = window.EDUGNAY_SF_WORKBOOK.worksheetPreview(workbook.worksheets[0], { id: 'sf5-promotion-proficiency-v1' });
  assert.equal(definition.mergeCount, 210);
  assert.equal(preview.rows.length, 61);
  assert.equal(preview.columnWidths.length, 25);
  assert.equal(preview.truncated, false);
  assert.equal(preview.rows.flatMap(row => row.cells).some(cell => cell.editable), false);
});

test('SF5 supports mixed active-year selections and retains individual closed-year and overflow-page support', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const page = await fs.readFile(path.join(root, 'assets', 'js', 'teacher', 'sf-templates.js'), 'utf8');
  const api = await fs.readFile(path.join(root, 'assets', 'js', 'shell-common.js'), 'utf8');
  assert.match(page, /templates\.length <= 4[\s\S]*formCodes\.every\(code => \['SF1', 'SF2', 'SF3', 'SF5'\]\.includes\(code\)\)/);
  assert.match(page, /includesSf5[\s\S]*sf5Only[\s\S]*academicYearStatus[\s\S]*gradeCode/);
  assert.match(page, /\['SF2', 'SF3', 'SF5'\]\.includes\(form\.formCode\) && form\.pages\.length > 1/);
  assert.match(page, /renderSf5Breakdown\(form\)/);
  assert.match(api, /templates\.length > 4[\s\S]*'SF1', 'SF2', 'SF3', 'SF5'/);
  assert.match(api, /breakdown: form\.breakdown \|\| \[\]/);
  assert.match(api, /getMyAdvisorySections\(template\.formCode === 'SF5'\)/);
});

test('SF5 breakdown omits the learner incomplete pill, keeps plain subject status, and preserves term order', async () => {
  const page = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets', 'js', 'teacher', 'sf-templates.js'), 'utf8');
  const styles = await fs.readFile(path.resolve(__dirname, '..', '..', 'assets', 'css', 'teacher', 'sf-templates.css'), 'utf8');
  const start = page.indexOf('function renderSf5Breakdown(form) {');
  const end = page.indexOf('\nasync function openTemplatePreview', start);
  assert.ok(start >= 0 && end > start, 'SF5 breakdown renderer is present');
  const renderer = vm.runInNewContext(`(${page.slice(start, end)})`, {
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  });
  const html = renderer({ formCode: 'SF5', selectedPage: 0, breakdown: [{ page: 1,
    name: 'Sample, Learner', generalAverage: null, subjects: [{ subject: 'English', finalGrade: null,
      terms: [{ term: 'Quarter 2', grade: 87, section: 'St. Matthew' }],
      missingTerms: [{ term: 'Quarter 1', reason: 'no published grade' }],
      termDetails: [
        { term: 'Quarter 1', grade: null, section: null, reason: 'no published grade' },
        { term: 'Quarter 2', grade: 87, section: 'St. Matthew', reason: null }
      ]
    }, { subject: 'Science', finalGrade: 91.25, terms: [], missingTerms: [], termDetails: [] }] }, {
    page: 1, name: 'Complete Learner', generalAverage: 89.25, subjects: []
  }] });
  const learnerHeads = [...html.matchAll(/<div class="sf-grade-breakdown-learner-head">([\s\S]*?)<\/div>/g)]
    .map(match => match[1]);
  assert.equal(learnerHeads.length, 2);
  assert.doesNotMatch(learnerHeads[0], /Incomplete|badge/);
  assert.match(learnerHeads[1], /sf-grade-breakdown-average">89\.25<\/span>/);
  assert.match(html, /class="sf-grade-breakdown-subject-status">Incomplete<\/span>/);
  assert.match(html, /class="sf-grade-breakdown-subject-final">91\.25<\/span>/);
  assert.match(html, /Calculated from published grades in edUgnay records/);
  assert.match(html, /Quarter 1[\s\S]*no published grade[\s\S]*Quarter 2[\s\S]*87\.00[\s\S]*St\. Matthew/);
  assert.match(html, /class="sf-grade-breakdown-term is-missing"/);
  assert.match(styles, /\.sf-grade-breakdown-subjects\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.sf-grade-breakdown-subjects\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('SF5 preview permits a closed year only for an adviser, rejects stale previews, and exposes editable cells', async () => {
  let writes = 0;
  let gradeCode = 'grade-7';
  let academicYearStatus = 'closed';
  let sectionSql = '';
  let rosterQuery = null;
  const database = { async execute(sql, values = []) {
    if (sql.includes('SELECT sf_templates_enabled')) return [[{ sfTemplatesEnabled: 1 }]];
    if (sql.includes('FROM school_form_templates')) return [[{ id: 5, formCode: 'SF5', formName: 'Report on Promotion & Level of Proficiency',
      version: '1.0', mappingStatus: 'ready', filePath: template.filePath, sheetName: SF5.sheetName, requiresAcademicTerm: 0 }]];
    if (sql.includes('FROM sections')) {
      sectionSql = sql;
      return [values[2] === 99 ? [] : [{ ...section, gradeCode,
        academicYearStatus, endDate: '2027-05-31' }]];
    }
    if (sql.includes('FROM schools')) return [[school]];
    if (sql.includes('FROM published_final_grades')) return [[published(1, 11, 21, 90)]];
    if (sql.includes('FROM section_students')) { rosterQuery = { sql, values }; return [[learner(1)]]; }
    if (sql.includes('FROM student_parent_links')) return [[]];
    if (sql.includes('FROM section_teachers')) return [[subjects[0]]];
    if (sql.includes('FROM academic_terms')) return [[terms[0]]];
    writes += 1;
    throw new Error(`Unexpected write: ${sql}`);
  } };
  databaseModule.getDatabase = () => database;
  const controller = require('../controllers/sfTemplatesController');
  const request = (body = {}, userId = 3) => ({ method: 'POST', params: { templateId: '5' },
    body: { sectionId: 8, ...body }, user: { id: userId, schoolId: 1, role: 'teacher' } });
  const invoke = async (handler, req) => {
    let result;
    let error;
    const res = { json(value) { result = value; }, status(code) { this.statusCode = code; return this; } };
    await handler(req, res, value => { error = value; });
    return { result, error, status: res.statusCode };
  };
  const preview = await invoke(controller.previewTemplate, request());
  assert.equal(preview.error, undefined);
  assert.equal(preview.result.mappedCells.find(cell => cell.cellAddress === 'F13')?.value, 90,
    JSON.stringify(preview.result.issues));
  assert.equal(preview.result.editableCells.find(cell => cell.cellAddress === 'F13')?.type, 'number');
  assert.match(sectionSql, /academic_years\.status IN \('active', 'closed'\)/);
  assert.match(rosterQuery.sql, /enrolled_at < DATE_ADD/);
  assert.deepEqual(rosterQuery.values, [1, 8, '2027-05-31', '2027-05-31']);
  assert.equal(preview.result.breakdown.length, 1);
  academicYearStatus = 'active';
  assert.equal((await invoke(controller.previewTemplate, request())).error, undefined);
  assert.match(rosterQuery.sql, /section_students\.withdrawn_at IS NULL/);
  assert.deepEqual(rosterQuery.values, [1, 8]);
  academicYearStatus = 'closed';
  assert.equal((await invoke(controller.previewTemplate, request({}, 99))).error.status, 403);
  gradeCode = 'grade-11';
  assert.equal((await invoke(controller.previewTemplate, request())).error.status, 403);
  gradeCode = 'grade-7';
  assert.equal((await invoke(controller.generateTemplate, request({ previewFingerprint: '0'.repeat(64) }))).error.status, 409);
  assert.equal(writes, 0);
});
