const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const databaseModule = require('../config/database');
const { createCombinedExportWorkbook, createExportWorkbook, getEditableCells } = require('../config/sfExports');

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedName}="([^"]*)"`).exec(tag)?.[1] || '';
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveOoxmlTarget(sourcePart, target) {
  return target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart), target));
}

async function worksheetPackagePath(zip, sheetName) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)]
    .map(match => match[0]).find(tag => xmlAttribute(tag, 'name') === sheetName);
  assert.ok(sheetTag, `missing sheet ${sheetName}`);
  const relationshipId = xmlAttribute(sheetTag, 'r:id');
  const relationshipsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relationshipTag = [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)]
    .map(match => match[0]).find(tag => xmlAttribute(tag, 'Id') === relationshipId);
  assert.ok(relationshipTag, `missing workbook relationship for ${sheetName}`);
  return resolveOoxmlTarget('xl/workbook.xml', xmlAttribute(relationshipTag, 'Target'));
}

function relationshipsPackagePath(partPath) {
  return path.posix.join(path.posix.dirname(partPath), '_rels', `${path.posix.basename(partPath)}.rels`);
}

async function packageRelationships(zip, partPath) {
  const relationshipFile = zip.file(relationshipsPackagePath(partPath));
  if (!relationshipFile) return [];
  const xml = await relationshipFile.async('string');
  return [...xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)].map(match => ({
    ...Object.fromEntries([...match[0].matchAll(/([\w:.-]+)=\"([^\"]*)\"/g)].map(attribute => [attribute[1], attribute[2]]))
  }));
}

async function worksheetImages(zip, worksheetPath) {
  const sheetRelationships = await packageRelationships(zip, worksheetPath);
  const hashes = [];
  for (const relation of sheetRelationships.filter(item => /\/drawing$/.test(item.Type || ''))) {
    const drawingPath = resolveOoxmlTarget(worksheetPath, relation.Target);
    const drawingRelationships = await packageRelationships(zip, drawingPath);
    for (const imageRelation of drawingRelationships.filter(item => /\/image$/.test(item.Type || ''))) {
      const imageFile = zip.file(resolveOoxmlTarget(drawingPath, imageRelation.Target));
      assert.ok(imageFile, `missing image referenced by ${drawingPath}`);
      hashes.push(sha256(await imageFile.async('nodebuffer')));
    }
  }
  return hashes.sort();
}

async function worksheetPrinterSettings(zip, worksheetPath) {
  const relation = (await packageRelationships(zip, worksheetPath))
    .find(item => /\/printerSettings$/.test(item.Type || ''));
  if (!relation) return null;
  const file = zip.file(resolveOoxmlTarget(worksheetPath, relation.Target));
  assert.ok(file, `missing printer settings for ${worksheetPath}`);
  return sha256(await file.async('nodebuffer'));
}

let learner = {
  userId: 10, profileUserId: 10, firstName: 'Juan', lastName: 'Dela Cruz',
  lrn: '100201000015', sex: 'male', birthDate: '2013-01-10', parents: []
};
let writes = 0;
let auditValues = [];
let allowSection = true;
let learnerRows = null;
let sectionQuery = null;
let sectionGradeCode = 'grade-7';
let publishedFinalGrade = 90;
let includePublishedGrade = true;
const database = {
  async execute(sql, values = []) {
    if (/SELECT sf_templates_enabled/.test(sql)) return [[{ sfTemplatesEnabled: 1 }]];
    if (/FROM school_form_templates/.test(sql)) return [[Number(values[0]) === 5 ? {
      id: 5, formCode: 'SF5', formName: 'Report on Promotion & Level of Proficiency', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf5.xlsx',
      sheetName: 'School Form 5 (SF5)', requiresAcademicTerm: 0
    } : Number(values[0]) === 2 ? {
      id: 2, formCode: 'SF2', formName: 'Daily Attendance Report of Learners', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf2.xlsx',
      sheetName: 'School Form 2 (SF2)', requiresAcademicTerm: 0
    } : Number(values[0]) === 3 ? {
      id: 3, formCode: 'SF3', formName: 'Books Issued and Returned', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf3.xlsx',
      sheetName: 'School Form 3 (SF3)', requiresAcademicTerm: 0
    } : {
      id: 1, formCode: 'SF1', formName: 'School Register', version: '1.0',
      mappingStatus: 'ready', filePath: '/assets/templates/school-forms/sf1.xlsx',
      sheetName: 'School Form 1 (SF1)', requiresAcademicTerm: 0
    }]];
    if (/FROM sections/.test(sql)) {
      sectionQuery = { sql, values };
      const current = { id: 8, schoolId: 1, name: 'St. Matthew', academicYearId: 2,
        schoolLevelId: 2, gradeLevelId: 7, gradeCode: sectionGradeCode, strandId: null,
        academicYear: '2026-2027', academicYearStatus: 'active', startDate: '2026-06-01',
        endDate: '2027-03-31', gradeLevel: 'Grade 7' };
      const historical = { ...current, id: 1, academicYearId: 1, academicYear: '2025-2026',
        academicYearStatus: 'closed', endDate: '2026-03-31' };
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
    if (/FROM published_final_grades/.test(sql)) return [includePublishedGrade ? [{
      studentId: 10, subjectId: 11, academicTermId: 21, finalGrade: publishedFinalGrade, sectionName: 'St. Matthew'
    }] : []];
    if (/FROM section_students/.test(sql)) return [learnerRows || [learner]];
    if (/FROM student_parent_links/.test(sql)) return [[]];
    if (/FROM section_teachers/.test(sql)) return [[{ id: 11, name: 'English' }]];
    if (/FROM academic_terms/.test(sql)) return [[{ id: 21, name: 'Quarter 1' }]];
    if (/INSERT INTO audit_logs/.test(sql)) {
      writes += 1;
      auditValues.push({ sql, values });
      return [{ insertId: writes }];
    }
    writes += 1;
    throw new Error(`Unexpected write: ${sql}`);
  }
};
databaseModule.getDatabase = () => database;
const controller = require('../controllers/sfTemplatesController');

test('generated preview actions stay hidden unless a generated preview is rendered', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const html = await fs.promises.readFile(path.join(root, 'views/teacher/edugnay-teacher-sf-templates.html'), 'utf8');
  const script = await fs.promises.readFile(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8');
  const styles = await fs.promises.readFile(path.join(root, 'assets/css/teacher/sf-templates.css'), 'utf8');

  assert.match(html, /<div class="sf-preview-actions" id="sfPreviewActions" hidden>/);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/css\/modal-system\.css">/);
  const previewHeader = html.slice(html.indexOf('<div class="sf-panel-head sf-preview-head">'), html.indexOf('<div class="sf-preview-content"'));
  assert.doesNotMatch(previewHeader, /Review issues|sfReviewIssues/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="sfValidationModalTitle" aria-describedby="sfValidationModalDescription"/);
  assert.match(html, /id="sfValidationModalDone" type="button">Done<\/button>/);
  assert.match(html, /Forms use supported school records; unavailable fields stay blank\. Edits apply only to the downloaded workbook and do not change AcadeMix records\. Review the draft before using it as an official record\./);
  assert.doesNotMatch(html, /Edits apply to this download only\. edUgnay records stay unchanged\./);
  assert.doesNotMatch(styles, /\.sf-preview-edit-note/);
  assert.match(styles, /\.sf-preview-head > div:first-child \{\s*flex: 1 1 auto;\s*min-width: 0;/);
  assert.match(styles, /\.sf-preview-actions \{\s*display: flex;\s*flex: 0 0 auto;\s*align-items: center;\s*justify-content: flex-end;/);
  assert.match(script, /previewActions: document\.getElementById\('sfPreviewActions'\)/);
  assert.doesNotMatch(script, /reviewIssuesButton|sfReviewIssues/);
  assert.match(script, /Calculated from published grades in edUgnay records/);
  assert.match(script, /LRN correction applies only to this download/);

  const editPersistence = script.slice(script.indexOf('function preservePreviewEdits'), script.indexOf('function changePreviewZoom'));
  const issueModal = script.slice(script.indexOf('function generatedValidationIssues'), script.indexOf('function renderSf5Breakdown'));
  const generatedPreviewContent = script.slice(script.indexOf('function renderGeneratedPreview'), script.indexOf('async function generateForm'));
  const modalLifecycle = script.slice(script.indexOf('function openValidationModal'), script.indexOf('function renderSf5Breakdown'));
  const editFeedback = script.slice(script.indexOf("sfElements.previewContent.addEventListener('input'"), script.indexOf("sfElements.previewContent.addEventListener('click'"));
  assert.match(editPersistence, /pageEdits\.flatMap[\s\S]*pageIndex/);
  assert.match(issueModal, /severity === 'error' && !issue\.canBeCorrectedInDownload/);
  assert.match(issueModal, /formCode: form\.formCode,[\s\r\n]*message: issue\.message/);
  assert.doesNotMatch(issueModal, /form\.formCode\}: \$\{issue\.message/);
  assert.match(issueModal, /formCode: form\.formCode/);
  assert.match(issueModal, /const groups = new Map\(\)/);
  assert.match(issueModal, /Array\.from\(groups, \(\[formCode, formIssues\]\)/);
  assert.match(issueModal, /sf-validation-group/);
  assert.match(issueModal, /sf-validation-issue-list/);
  assert.match(generatedPreviewContent, /data-review-issues/);
  assert.match(generatedPreviewContent, /issues\.length \? `<button/);
  assert.match(generatedPreviewContent, /Issues \(\$\{issues\.length\}\)/);
  assert.match(generatedPreviewContent, /sf-generated-toolbar/);
  assert.match(generatedPreviewContent, /sfElements\.previewContent\.innerHTML = `\$\{generatedToolbar\}/);
  assert.doesNotMatch(generatedPreviewContent, /sf-validation-summary/);
  assert.match(modalLifecycle, /classList\.add\('open'\)/);
  assert.match(modalLifecycle, /aria-hidden', 'false'/);
  assert.match(modalLifecycle, /validationModalClose\.focus\(\)/);
  assert.match(modalLifecycle, /closeValidationModal\(false\)/);
  assert.match(modalLifecycle, /appShell\.inert = true/);
  assert.match(modalLifecycle, /appShell\.inert = false/);
  assert.match(script, /sfElements\.validationModalDone\.addEventListener\('click', \(\) => closeValidationModal\(\)\)/);
  assert.match(script, /event\.key === 'Escape' && sfElements\.validationBackdrop\.classList\.contains\('open'\)/);
  assert.match(script, /event\.shiftKey && document\.activeElement === first/);
  assert.match(styles, /\.sf-validation-modal-body \{\s*flex: 1 1 auto;\s*min-height: 0;[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /\.sf-validation-modal \{[\s\S]*?max-height: calc\(100dvh - 32px\)/);
  assert.match(styles, /\.sf-validation-issue\.is-error/);
  assert.match(styles, /\.sf-validation-issue\.is-warning/);
  assert.doesNotMatch(styles, /\.sf-validation-issue-list\s*\{[^}]*overflow/);
  assert.doesNotMatch(styles, /\.sf-validation-summary/);
  assert.match(styles, /\.sf-generated-toolbar \.sf-generated-form-tabs \{[\s\S]*?overflow-x: auto;/);
  assert.match(editFeedback, /classList\.toggle\('edited', edited\)/);

  const templatePreview = script.slice(script.indexOf('async function openTemplatePreview'), script.indexOf('function setGeneratedForm'));
  const invalidation = script.slice(script.indexOf('function invalidateGeneratedPreview'), script.indexOf('function renderGeneratedPreview'));
  const generatedPreview = script.slice(script.indexOf('function renderGeneratedPreview'), script.indexOf('async function generateForm'));
  const generation = script.slice(script.indexOf('async function generateForm'), script.indexOf('async function downloadBlankCombinedWorkbook'));
  const staleExport = script.slice(script.indexOf('async function downloadGeneratedWorkbook'), script.indexOf('function startXlsxDownload'));
  const tabSwitching = script.slice(script.indexOf("sfElements.previewContent.addEventListener('click'"), script.indexOf("sfElements.list.addEventListener('click'"));
  assert.match(templatePreview, /clearValidationModal\(\)/);
  assert.match(invalidation, /clearValidationModal\(\)/);
  assert.match(invalidation, /sf-preview-empty/);
  assert.match(templatePreview, /sfElements\.previewActions\.hidden = true/);
  assert.match(invalidation, /sfElements\.previewActions\.hidden = true/);
  assert.match(generatedPreview, /sfElements\.previewActions\.hidden = false/);
  assert.ok(generation.indexOf('invalidateGeneratedPreview();') < generation.indexOf('await window.EDUGNAY_CONFIG.generate'));
  assert.match(generation, /openIssuesAfterGeneration = generatedValidationIssues\(\)\.length > 0/);
  assert.match(generation, /if \(openIssuesAfterGeneration\) openValidationModal\(sfElements\.generateButton\)/);
  assert.match(generation, /catch \(error\) \{[\s\S]*?sfState\.generated = null;[\s\S]*?showAppToast/);
  assert.match(staleExport, /error\.status === 409[\s\S]*?sfElements\.previewActions\.hidden = true/);
  assert.match(staleExport, /clearValidationModal\(\)/);
  assert.match(tabSwitching, /const issuesButton = event\.target\.closest\('\[data-review-issues\]'\)/);
  assert.match(tabSwitching, /openValidationModal\(issuesButton\)/);
  const formAndPageSwitching = tabSwitching.slice(tabSwitching.indexOf('const formTab'), tabSwitching.indexOf('const zoomButton'));
  assert.doesNotMatch(formAndPageSwitching, /openValidationModal\(/);

  const mobileGrid = styles.indexOf('.sf-preview-actions {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr);');
  const hiddenOverride = styles.indexOf('.sf-preview-actions[hidden] {\n  display: none;');
  assert.notEqual(mobileGrid, -1, 'mobile action buttons should stack without clipping');
  assert.ok(hiddenOverride > mobileGrid, 'hidden override must follow responsive display rules');
});

test('template library search covers template fields and works with both filters', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const html = await fs.promises.readFile(path.join(root, 'views/teacher/edugnay-teacher-sf-templates.html'), 'utf8');
  const script = await fs.promises.readFile(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8');
  const styles = await fs.promises.readFile(path.join(root, 'assets/css/teacher/sf-templates.css'), 'utf8');
  const searchStart = script.indexOf('function filteredTemplates() {');
  const searchEnd = script.indexOf('\nfunction renderTemplateLibrary()', searchStart);
  const searchSource = script.slice(searchStart, searchEnd);
  const templates = [
    { formCode: 'SF1', formName: 'School Register', fileName: 'SF1.xlsx', schoolLevels: ['elementary', 'jhs'] },
    { formCode: 'SF2', formName: 'Daily Attendance Report of Learners', fileName: 'SF2.xlsx', schoolLevels: ['elementary'] },
    { formCode: 'SF5', formName: 'General Average', fileName: 'SF5.xlsx', schoolLevels: ['jhs'] }
  ];
  const state = { templates };
  const elements = {
    librarySearch: { value: '' },
    codeFilter: { value: 'all' },
    levelFilter: { value: 'all' }
  };
  const levelNames = { elementary: 'Elementary', jhs: 'Junior High School', shs: 'Senior High School' };
  const filterTemplates = new Function('sfState', 'sfElements', 'schoolLevelsLabel', `${searchSource}; return filteredTemplates;`)(
    state,
    elements,
    levels => levels.map(level => levelNames[level] || level).join(', ')
  );
  const codesFor = query => {
    elements.librarySearch.value = query;
    return filterTemplates().map(template => template.formCode);
  };

  assert.match(html, /<input id="sfLibrarySearch" type="search" placeholder="Search templates\.\.\." aria-label="Search templates" autocomplete="off">/);
  assert.match(html, /<select id="sfCodeFilter" aria-label="Filter by form">/);
  assert.match(html, /<select id="sfLevelFilter" aria-label="Filter by school level">/);
  assert.doesNotMatch(html, /<span>(?:Search|Form|School level)<\/span>/);
  assert.match(script, /sfElements\.librarySearch\.addEventListener\('input', renderTemplateLibrary\)/);
  assert.match(styles, /grid-template-columns: minmax\(0, 2fr\) repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.sf-filters \{[\s\S]*?background: transparent;/);
  assert.match(styles, /\.sf-library-search-control input:focus \{[\s\S]*?border-color: var\(--blue-mid\);[\s\S]*?box-shadow:/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-filters \{\s*grid-template-columns: 1fr;/);
  assert.deepEqual(codesFor('sf2'), ['SF2']);
  assert.deepEqual(codesFor('attendance report'), ['SF2']);
  assert.deepEqual(codesFor('SF5.xlsx'), ['SF5']);
  assert.deepEqual(codesFor('junior high school'), ['SF1', 'SF5']);

  elements.librarySearch.value = 'register';
  elements.codeFilter.value = 'SF1';
  elements.levelFilter.value = 'jhs';
  assert.deepEqual(filterTemplates().map(template => template.formCode), ['SF1']);

  elements.librarySearch.value = '';
  elements.codeFilter.value = 'all';
  elements.levelFilter.value = 'all';
  assert.deepEqual(filterTemplates().map(template => template.formCode), ['SF1', 'SF2', 'SF5']);
});

test('school-form routes accept larger JSON edit batches without changing other route limits', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const server = await fs.promises.readFile(path.join(root, 'backend/server.js'), 'utf8');
  const parserSelection = server.slice(server.indexOf('const isSchoolFormGeneration'), server.indexOf('parser(req, res, next);'));
  assert.match(server, /bodyParser\.json\(\{ limit: '4mb' \}\)/);
  assert.ok(parserSelection.includes("req.path === '/api/sf-templates/combined/generate'"));
  assert.ok(parserSelection.includes('req.method === \'POST\''));
  assert.match(parserSelection, /schoolFormJsonBodyParser[\s\S]*?jsonBodyParser/);
});

async function call(handler, method, body = {}, query = {}, templateId = '1') {
  const result = { status: 200, body: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    setHeader(name, value) { result.headers ||= {}; result.headers[name] = value; return this; },
    json(value) { result.body = value; return this; },
    send(value) { result.body = value; return this; }
  };
  await handler({
    method, body, query, params: { templateId },
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

test('SF3 preview exposes only entry cells, including book details, as a draft', async () => {
  writes = 0;
  const result = await call(controller.previewTemplate, 'GET', {}, { sectionId: '8' }, '3');
  assert.equal(result.error, null);
  assert.equal(result.body.pages.length, 1);
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'C5').value, '305614');
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'K5').value, '2026-2027');
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'C7').value, 'St. Columban\u2019s College');
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'K7').value, 'Grade 7');
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'N7').value, 'St. Matthew');
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'A12').value, 1);
  assert.equal(result.body.pages[0].find(cell => cell.cellAddress === 'B12').value, 'Dela Cruz, Juan');
  assert.equal(result.body.pages[0].some(cell => /^([D-S])12$/.test(cell.cellAddress)), false);
  const editable = new Map(result.body.editableCells.map(cell => [cell.cellAddress, cell.type]));
  assert.equal(editable.get('C5'), 'text');
  assert.equal(editable.get('B12'), 'text');
  assert.equal(editable.get('D9'), 'text');
  assert.equal(editable.get('D10'), undefined);
  assert.equal(editable.get('D12'), 'dateText');
  assert.equal(editable.get('D36'), 'number');
  assert.equal(editable.has('A62'), false);
  assert.equal(editable.has('T68'), false);
  assert.ok(result.body.issues.some(issue => issue.fieldKey === 'draft'));
  assert.equal(result.body.previewFingerprint.length, 64);
  assert.equal(writes, 0);
});

test('SF1, SF2, SF3, and SF5 entry-cell schemas exclude labels and type fields correctly', async () => {
  const templates = [
    ['SF1', 'sf1.xlsx', 'School Form 1 (SF1)'],
    ['SF2', 'sf2.xlsx', 'School Form 2 (SF2)'],
    ['SF3', 'sf3.xlsx', 'School Form 3 (SF3)'],
    ['SF5', 'sf5.xlsx', 'School Form 5 (SF5)']
  ];
  const schemas = new Map();
  for (const [formCode, fileName, sheetName] of templates) {
    const cells = await getEditableCells({ formCode, filePath: `/assets/templates/school-forms/${fileName}`, sheetName });
    schemas.set(formCode, new Map(cells.map(cell => [cell.cellAddress, cell.type])));
  }

  assert.equal(schemas.get('SF1').get('H10'), 'date');
  assert.equal(schemas.get('SF1').get('B10'), 'text');
  assert.equal(schemas.get('SF2').get('D11'), 'dateText');
  assert.equal(schemas.get('SF2').get('D13'), 'text');
  assert.equal(schemas.get('SF2').get('AC13'), 'number');
  assert.equal(schemas.get('SF2').get('AH67'), 'number');
  assert.equal(schemas.get('SF3').get('D9'), 'text');
  assert.equal(schemas.get('SF3').get('D10'), undefined);
  assert.equal(schemas.get('SF3').get('D12'), 'dateText');
  assert.equal(schemas.get('SF3').get('D36'), 'number');
  assert.equal(schemas.get('SF5').get('A13'), 'text');
  assert.equal(schemas.get('SF5').get('B13'), 'text');
  assert.equal(schemas.get('SF5').get('F13'), 'number');
  assert.equal(schemas.get('SF5').get('F33'), 'number');
  assert.equal(schemas.get('SF1').has('A1'), false);
  assert.equal(schemas.get('SF2').has('A9'), false);
  assert.equal(schemas.get('SF3').has('T68'), false);
  assert.equal(schemas.get('SF5').has('M49'), false);
});

test('combined preview returns mapped data and editable-cell metadata for SF1 and SF2', async () => {
  const result = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10'
  });
  assert.equal(result.error, null);
  assert.equal(result.body.forms.map(form => form.formCode).join(','), 'SF1,SF2');
  assert.equal(result.body.previewFingerprint.length, 64);
  assert.equal(result.body.forms[0].mappedCells.find(cell => cell.cellAddress === 'B10').value, '100201000015');
  assert.equal(result.body.forms[1].pages[0].find(cell => cell.cellAddress === 'B13').value, 'Dela Cruz, Juan');
  assert.equal(writes, 0);
});

test('combined preview supports SF5 in every pair, triple, and four-form selection', async () => {
  const combinations = [
    { ids: [1, 3], codes: ['SF1', 'SF3'], month: '' },
    { ids: [2, 3], codes: ['SF2', 'SF3'], month: '2026-10' },
    { ids: [1, 2, 3], codes: ['SF1', 'SF2', 'SF3'], month: '2026-10' },
    { ids: [1, 5], codes: ['SF1', 'SF5'], month: '' },
    { ids: [2, 5], codes: ['SF2', 'SF5'], month: '2026-10' },
    { ids: [3, 5], codes: ['SF3', 'SF5'], month: '' },
    { ids: [1, 2, 5], codes: ['SF1', 'SF2', 'SF5'], month: '2026-10' },
    { ids: [1, 3, 5], codes: ['SF1', 'SF3', 'SF5'], month: '' },
    { ids: [2, 3, 5], codes: ['SF2', 'SF3', 'SF5'], month: '2026-10' },
    { ids: [1, 2, 3, 5], codes: ['SF1', 'SF2', 'SF3', 'SF5'], month: '2026-10' }
  ];

  for (const selection of combinations) {
    const result = await call(controller.previewCombinedTemplates, 'POST', {
      templateIds: selection.ids, sectionId: 8, month: selection.month
    });
    assert.equal(result.error, null);
    assert.deepEqual(result.body.forms.map(form => form.formCode), selection.codes);
    assert.equal(result.body.previewFingerprint.length, 64);
    assert.ok(result.body.forms.every(form => form.pages.length));
    const sf5Form = result.body.forms.find(form => form.formCode === 'SF5');
    if (sf5Form) {
      assert.equal(sf5Form.breakdown.length, 1);
      assert.equal(sf5Form.pages[0].find(cell => cell.cellAddress === 'F13')?.value, publishedFinalGrade, JSON.stringify(sf5Form));
    }
  }

  const missingMonth = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [2, 3], sectionId: 8
  });
  assert.match(missingMonth.error.message, /valid month/);

  const duplicate = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 1], sectionId: 8
  });
  assert.match(duplicate.error.message, /selected once/);

  sectionGradeCode = 'grade-11';
  const seniorHighSf5 = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8
  });
  assert.equal(seniorHighSf5.error?.status, 403);
  sectionGradeCode = 'grade-7';

  const closedYearSf5Package = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 1
  });
  assert.equal(closedYearSf5Package.error?.status, 403);
});

test('combined SF5 preview includes incomplete-grade warnings and enforces adviser access', async () => {
  includePublishedGrade = false;
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8
  });
  assert.equal(preview.error, null);
  const sf5 = preview.body.forms.find(form => form.formCode === 'SF5');
  assert.equal(sf5.breakdown[0].generalAverage, null);
  assert.equal(sf5.issues.some(issue => issue.fieldKey === 'generalAverage' && issue.severity === 'warning'), true);
  includePublishedGrade = true;

  allowSection = false;
  const unauthorized = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8
  });
  allowSection = true;
  assert.equal(unauthorized.error?.status, 403);
  assert.equal(writes, 0);
});

test('combined export puts SF1 and SF2 in one workbook and keeps SF1 edits', async () => {
  auditValues = [];
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10'
  });
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10',
    previewFingerprint: preview.body.previewFingerprint,
    forms: [
      { templateId: 1, edits: [{ cellAddress: 'C10', value: 'Updated student name' }] },
      { templateId: 2, edits: [] }
    ]
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.match(result.headers['Content-Disposition'], /SF1_SF2_Grade-7-St\.-Matthew_2026-10\.xlsx/);
  assert.equal(writes, 1);
  assert.match(auditValues[0]?.sql || '', /manual_edit_count/);
  assert.equal(auditValues[0]?.values.at(-1), 1);
  assert.equal(auditValues.flatMap(record => record.values).includes('Updated student name'), false);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.body);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['School Form 1 (SF1)', 'School Form 2 (SF2)']);
  assert.equal(workbook.getWorksheet('School Form 1 (SF1)').getCell('C10').value, 'Updated student name');
  assert.equal(workbook.getWorksheet('School Form 2 (SF2)').getCell('B13').value, 'Dela Cruz, Juan');
});

test('combined exports include SF3 for both pairs and all three forms', async () => {
  const combinations = [
    { ids: [1, 3], codes: ['SF1', 'SF3'], month: '' },
    { ids: [2, 3], codes: ['SF2', 'SF3'], month: '2026-10' },
    { ids: [1, 2, 3], codes: ['SF1', 'SF2', 'SF3'], month: '2026-10' }
  ];

  for (const selection of combinations) {
    const preview = await call(controller.previewCombinedTemplates, 'POST', {
      templateIds: selection.ids, sectionId: 8, month: selection.month
    });
    const result = await call(controller.generateCombinedTemplates, 'POST', {
      templateIds: selection.ids,
      sectionId: 8,
      month: selection.month,
      previewFingerprint: preview.body.previewFingerprint,
      forms: preview.body.forms.map(form => ({
        templateId: form.templateId,
        edits: {
          SF1: [{ cellAddress: 'C10', value: `Updated ${selection.codes.join('/')}` }],
          SF2: [{ cellAddress: 'D11', value: '10/01/2026' }, { cellAddress: 'D13', value: 'A' }],
          SF3: [{ cellAddress: 'D9', value: 'Updated book title' }, { cellAddress: 'D12', value: '2026-11-08' }]
        }[form.formCode] || []
      }))
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.match(result.headers['Content-Disposition'], new RegExp(`${selection.codes.join('_')}_Grade-7-St\\.-Matthew_`));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body);
    const sheetNames = selection.codes.map(code => ({
      SF1: 'School Form 1 (SF1)', SF2: 'School Form 2 (SF2)', SF3: 'School Form 3 (SF3)'
    }[code]));
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), sheetNames);
    if (selection.codes.includes('SF1')) {
      assert.equal(workbook.getWorksheet('School Form 1 (SF1)').getCell('C10').value, `Updated ${selection.codes.join('/')}`);
    }
    if (selection.codes.includes('SF2')) {
      assert.equal(workbook.getWorksheet('School Form 2 (SF2)').getCell('B13').value, 'Dela Cruz, Juan');
      assert.equal(workbook.getWorksheet('School Form 2 (SF2)').getCell('D11').value, '10/01/2026');
      assert.equal(workbook.getWorksheet('School Form 2 (SF2)').getCell('D13').value, 'A');
    }
    if (selection.codes.includes('SF3')) {
      assert.equal(workbook.getWorksheet('School Form 3 (SF3)').getCell('B12').value, 'Dela Cruz, Juan');
      assert.equal(workbook.getWorksheet('School Form 3 (SF3)').getCell('D9').value, 'Updated book title');
      assert.equal(workbook.getWorksheet('School Form 3 (SF3)').getCell('D12').value, '11/08/2026');
    }
  }
});

test('combined exports include SF5 in all seven combinations and preserve editable SF1 data', async () => {
  const combinations = [
    { ids: [1, 5], codes: ['SF1', 'SF5'], month: '' },
    { ids: [2, 5], codes: ['SF2', 'SF5'], month: '2026-10' },
    { ids: [3, 5], codes: ['SF3', 'SF5'], month: '' },
    { ids: [1, 2, 5], codes: ['SF1', 'SF2', 'SF5'], month: '2026-10' },
    { ids: [1, 3, 5], codes: ['SF1', 'SF3', 'SF5'], month: '' },
    { ids: [2, 3, 5], codes: ['SF2', 'SF3', 'SF5'], month: '2026-10' },
    { ids: [1, 2, 3, 5], codes: ['SF1', 'SF2', 'SF3', 'SF5'], month: '2026-10' }
  ];
  const sheetNames = {
    SF1: 'School Form 1 (SF1)', SF2: 'School Form 2 (SF2)',
    SF3: 'School Form 3 (SF3)', SF5: 'School Form 5 (SF5)'
  };

  for (const selection of combinations) {
    const preview = await call(controller.previewCombinedTemplates, 'POST', {
      templateIds: selection.ids, sectionId: 8, month: selection.month
    });
    assert.equal(preview.error, null);
    assert.ok(preview.body.forms.find(form => form.formCode === 'SF5').breakdown.length);
    const result = await call(controller.generateCombinedTemplates, 'POST', {
      templateIds: selection.ids,
      sectionId: 8,
      month: selection.month,
      previewFingerprint: preview.body.previewFingerprint,
      forms: preview.body.forms.map(form => ({
        templateId: form.templateId,
        edits: {
          SF1: [{ cellAddress: 'C10', value: `Updated ${selection.codes.join('/')}` }],
          SF2: [{ cellAddress: 'D13', value: 'A' }],
          SF3: [{ cellAddress: 'D9', value: 'Updated book title' }, { cellAddress: 'D12', value: '2026-11-08' }],
          SF5: [{ cellAddress: 'F13', value: '82.75' }]
        }[form.formCode] || []
      }))
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.match(result.headers['Content-Disposition'], /-draft\.xlsx/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), selection.codes.map(code => sheetNames[code]));
    assert.equal(workbook.getWorksheet(sheetNames.SF5).getCell('F13').value, 82.75);
    assert.equal(workbook.getWorksheet(sheetNames.SF5).getCell('F13').numFmt, '0.00');
    if (selection.codes.includes('SF1')) {
      assert.equal(workbook.getWorksheet(sheetNames.SF1).getCell('C10').value, `Updated ${selection.codes.join('/')}`);
    }
    if (selection.codes.includes('SF2')) assert.equal(workbook.getWorksheet(sheetNames.SF2).getCell('D13').value, 'A');
    if (selection.codes.includes('SF3')) {
      assert.equal(workbook.getWorksheet(sheetNames.SF3).getCell('D9').value, 'Updated book title');
      assert.equal(workbook.getWorksheet(sheetNames.SF3).getCell('D12').value, '11/08/2026');
    }
  }
});

test('combined generation rejects labels, invalid page indexes, and values of the wrong type', async () => {
  const cases = [
    { ids: [1, 2], month: '2026-10', formCode: 'SF2', edit: { cellAddress: 'A9', value: 'Not an entry cell' } },
    { ids: [1, 3], month: '', formCode: 'SF3', edit: { cellAddress: 'T68', value: 'Replace the printed footer' } },
    { ids: [1, 5], month: '', formCode: 'SF5', edit: { cellAddress: 'M49', value: 'Replace the guidance' } },
    { ids: [1, 3], month: '', formCode: 'SF3', edit: { cellAddress: 'D12', value: 'not-a-date' } },
    { ids: [1, 5], month: '', formCode: 'SF5', edit: { cellAddress: 'F13', value: 'not-a-number' } },
    { ids: [1, 3], month: '', formCode: 'SF3', edit: { cellAddress: 'D9', value: { unexpected: 'object' } } },
    { ids: [1, 3], month: '', formCode: 'SF3', edit: { pageIndex: 1, cellAddress: 'D9', value: 'No such page' } }
  ];

  for (const selection of cases) {
    const preview = await call(controller.previewCombinedTemplates, 'POST', {
      templateIds: selection.ids, sectionId: 8, month: selection.month
    });
    writes = 0;
    const result = await call(controller.generateCombinedTemplates, 'POST', {
      templateIds: selection.ids,
      sectionId: 8,
      month: selection.month,
      previewFingerprint: preview.body.previewFingerprint,
      forms: preview.body.forms.map(form => ({
        templateId: form.templateId,
        edits: form.formCode === selection.formCode ? [selection.edit] : []
      }))
    });
    assert.equal(result.error?.status, 400);
    assert.equal(writes, 0);
  }
});

test('SF5 combined workbook templates preserve official sheets, images, styles, and print settings', async () => {
  const formSheets = {
    SF1: 'School Form 1 (SF1)', SF2: 'School Form 2 (SF2)',
    SF3: 'School Form 3 (SF3)', SF5: 'School Form 5 (SF5)'
  };
  const combinations = [
    ['SF1', 'SF5'], ['SF2', 'SF5'], ['SF3', 'SF5'],
    ['SF1', 'SF2', 'SF5'], ['SF1', 'SF3', 'SF5'], ['SF2', 'SF3', 'SF5'],
    ['SF1', 'SF2', 'SF3', 'SF5']
  ];
  const templateDirectoryPath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms');
  const officialSf5Zip = await JSZip.loadAsync(await fs.promises.readFile(path.join(templateDirectoryPath, 'sf5.xlsx')));
  const officialSf5Path = await worksheetPackagePath(officialSf5Zip, formSheets.SF5);
  const officialSf5Baseline = {
    worksheetHash: sha256(await officialSf5Zip.file(officialSf5Path).async('nodebuffer')),
    images: await worksheetImages(officialSf5Zip, officialSf5Path),
    printerSettings: await worksheetPrinterSettings(officialSf5Zip, officialSf5Path)
  };
  let sharedStyleHash = null;
  const formBaselines = new Map();

  for (const codes of combinations) {
    const combinedName = `${codes.map(code => code.toLowerCase()).join('-')}.xlsx`;
    const combinedBytes = await fs.promises.readFile(path.join(templateDirectoryPath, combinedName));
    const combinedZip = await JSZip.loadAsync(combinedBytes);
    const combinedWorkbookXml = await combinedZip.file('xl/workbook.xml').async('string');
    const combinedSheetNames = [...combinedWorkbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)]
      .map(match => xmlAttribute(match[0], 'name'));
    assert.deepEqual(combinedSheetNames, codes.map(code => formSheets[code]));
    const currentStyleHash = sha256(await combinedZip.file('xl/styles.xml').async('nodebuffer'));
    if (sharedStyleHash === null) sharedStyleHash = currentStyleHash;
    else assert.equal(currentStyleHash, sharedStyleHash, 'combined templates should share the official styles');

    for (const code of codes) {
      const combinedSheetPath = await worksheetPackagePath(combinedZip, formSheets[code]);
      const combinedImages = await worksheetImages(combinedZip, combinedSheetPath);
      const currentForm = {
        worksheetHash: sha256(await combinedZip.file(combinedSheetPath).async('nodebuffer')),
        images: combinedImages,
        printerSettings: await worksheetPrinterSettings(combinedZip, combinedSheetPath)
      };
      if (code === 'SF5') assert.deepEqual(currentForm, officialSf5Baseline);
      const baseline = formBaselines.get(code);
      if (baseline) {
        assert.equal(currentForm.worksheetHash, baseline.worksheetHash, `${code} layout and merged cells should match across combinations`);
        assert.deepEqual(currentForm.images, baseline.images, `${code} images should be preserved across combinations`);
        assert.equal(currentForm.printerSettings, baseline.printerSettings, `${code} print settings should match across combinations`);
      } else {
        formBaselines.set(code, currentForm);
      }
    }
  }
});

test('combined export rejects stale previews before auditing or sending a workbook', async () => {
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10'
  });
  const original = learner;
  learner = { ...learner, lrn: '100201000016' };
  writes = 0;
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10',
    previewFingerprint: preview.body.previewFingerprint,
    forms: [{ templateId: 1, edits: [] }, { templateId: 2, edits: [] }]
  });
  assert.equal(result.error?.status, 409);
  assert.equal(writes, 0);
  learner = original;
});

test('combined SF5 export rejects changes to published grades after preview', async () => {
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8
  });
  const originalGrade = publishedFinalGrade;
  publishedFinalGrade = 89;
  writes = 0;
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8,
    previewFingerprint: preview.body.previewFingerprint,
    forms: preview.body.forms.map(form => ({ templateId: form.templateId, edits: [] }))
  });
  publishedFinalGrade = originalGrade;
  assert.equal(result.error?.status, 409);
  assert.equal(writes, 0);
});

test('combined export keeps SF2 extra pages and original workbook styles', async () => {
  const sourcePath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf1-sf2.xlsx');
  const sourceZip = await JSZip.loadAsync(await fs.promises.readFile(sourcePath));
  const output = await createCombinedExportWorkbook([
    { formCode: 'SF1', pages: [[{ cellAddress: 'B10', value: '100201000015', type: 'text' }]] },
    { formCode: 'SF2', pages: [
      [{ cellAddress: 'A91', value: 'School Form 2 : Page 1 of 2', type: 'text' }],
      [{ cellAddress: 'A91', value: 'School Form 2 : Page 2 of 2', type: 'text' }]
    ] }
  ]);
  const exportZip = await JSZip.loadAsync(output);
  assert.ok((await sourceZip.file('xl/styles.xml').async('nodebuffer'))
    .equals(await exportZip.file('xl/styles.xml').async('nodebuffer')));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'School Form 1 (SF1)', 'School Form 2 (SF2)', 'SF2 Page 2'
  ]);
  assert.equal(workbook.worksheets[2].pageSetup.printTitlesRow, '10:12');
  assert.equal(workbook.worksheets[2].getImages().length, 1);
  assert.equal(workbook.worksheets[2].getCell('A91').value, 'School Form 2 : Page 2 of 2');
});

test('combined export groups SF2 and SF3 overflow pages with their original forms', async () => {
  const output = await createCombinedExportWorkbook([
    { formCode: 'SF1', pages: [[{ cellAddress: 'B10', value: '100201000015', type: 'text' }]] },
    { formCode: 'SF2', pages: [
      [{ cellAddress: 'A91', value: 'SF2 page 1 marker', type: 'text' }],
      [{ cellAddress: 'A91', value: 'SF2 page 2 marker', type: 'text' }]
    ] },
    { formCode: 'SF3', pages: [
      [{ cellAddress: 'T68', value: 'SF3 page 1 marker', type: 'text' }],
      [{ cellAddress: 'T68', value: 'SF3 page 2 marker', type: 'text' }]
    ] }
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'School Form 1 (SF1)', 'School Form 2 (SF2)', 'SF2 Page 2',
    'School Form 3 (SF3)', 'SF3 Page 2'
  ]);
  assert.equal(workbook.getWorksheet('SF2 Page 2').getCell('A91').value, 'SF2 page 2 marker');
  assert.equal(workbook.getWorksheet('SF3 Page 2').getCell('T68').value, 'SF3 page 2 marker');
  assert.deepEqual(workbook.getWorksheet('SF2 Page 2').pageSetup, workbook.getWorksheet('School Form 2 (SF2)').pageSetup);
  assert.deepEqual(workbook.getWorksheet('SF3 Page 2').pageSetup, workbook.getWorksheet('School Form 3 (SF3)').pageSetup);
  assert.equal(workbook.getWorksheet('SF2 Page 2').getImages().length, workbook.getWorksheet('School Form 2 (SF2)').getImages().length);
  assert.equal(workbook.getWorksheet('SF3 Page 2').getImages().length, workbook.getWorksheet('School Form 3 (SF3)').getImages().length);
});

test('combined SF5 exports apply two-decimal styles and keep SF5 overflow pages grouped', async () => {
  const templatePath = path.resolve(__dirname, '..', '..', 'assets', 'templates', 'school-forms', 'sf3-sf5.xlsx');
  const sourceZip = await JSZip.loadAsync(await fs.promises.readFile(templatePath));
  const sourceSf3Path = await worksheetPackagePath(sourceZip, 'School Form 3 (SF3)');
  const sourceStyles = await sourceZip.file('xl/styles.xml').async('nodebuffer');
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.load(await fs.promises.readFile(templatePath));
  const output = await createCombinedExportWorkbook([
    { formCode: 'SF5', pages: [
      [{ cellAddress: 'F13', value: 90.25, type: 'number' }, { cellAddress: 'M61', value: 'SF5 page 1 of 2', type: 'text' }],
      [{ cellAddress: 'F13', value: 89.5, type: 'number' }, { cellAddress: 'M61', value: 'SF5 page 2 of 2', type: 'text' }]
    ] },
    { formCode: 'SF3', pages: [
      [{ cellAddress: 'T68', value: 'SF3 page 1 of 2', type: 'text' }],
      [{ cellAddress: 'T68', value: 'SF3 page 2 of 2', type: 'text' }]
    ] }
  ]);
  const outputZip = await JSZip.loadAsync(output);
  const outputSf3Path = await worksheetPackagePath(outputZip, 'School Form 3 (SF3)');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);

  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
    'School Form 3 (SF3)', 'SF3 Page 2', 'School Form 5 (SF5)', 'SF5 Page 2'
  ]);
  assert.equal(workbook.getWorksheet('School Form 5 (SF5)').getCell('F13').numFmt, '0.00');
  assert.equal(workbook.getWorksheet('SF5 Page 2').getCell('F13').numFmt, '0.00');
  assert.equal(workbook.getWorksheet('SF5 Page 2').getCell('F13').value, 89.5);
  assert.deepEqual(workbook.getWorksheet('School Form 3 (SF3)').getCell('B12').style,
    sourceWorkbook.getWorksheet('School Form 3 (SF3)').getCell('B12').style);
  assert.deepEqual(workbook.getWorksheet('SF3 Page 2').getCell('B12').style,
    sourceWorkbook.getWorksheet('School Form 3 (SF3)').getCell('B12').style);
  assert.deepEqual(workbook.getWorksheet('SF3 Page 2').pageSetup, workbook.getWorksheet('School Form 3 (SF3)').pageSetup);
  assert.equal(workbook.getWorksheet('SF5 Page 2').getImages().length, workbook.getWorksheet('School Form 5 (SF5)').getImages().length);
  assert.equal(await worksheetPrinterSettings(outputZip, outputSf3Path), await worksheetPrinterSettings(sourceZip, sourceSf3Path));
  assert.ok((await outputZip.file('xl/styles.xml').async('nodebuffer')).length > sourceStyles.length);
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

test('a corrected SF1 LRN only changes the downloaded combined workbook', async () => {
  const original = learner;
  learner = { ...learner, lrn: 'invalid' };
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10'
  });
  assert.equal(preview.body.forms.find(form => form.formCode === 'SF1').issues
    .some(issue => issue.fieldKey === 'lrn' && issue.canBeCorrectedInDownload), true);

  writes = 0;
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [1, 2], sectionId: 8, month: '2026-10',
    previewFingerprint: preview.body.previewFingerprint,
    forms: preview.body.forms.map(form => ({
      templateId: form.templateId,
      edits: form.formCode === 'SF1' ? [{ cellAddress: 'B10', value: '100201000016' }] : []
    }))
  });

  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.body);
  assert.equal(workbook.getWorksheet('School Form 1 (SF1)').getCell('B10').value, '100201000016');
  assert.equal(learner.lrn, 'invalid', 'the saved student profile must not be changed');
  learner = original;
});

test('edits follow overflow pages in the combined workbook', async () => {
  learnerRows = Array.from({ length: 25 }, (_, index) => ({
    ...learner,
    userId: index + 10,
    lrn: String(100201000000 + index),
    firstName: `Student${index + 1}`
  }));
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [2, 3], sectionId: 8, month: '2026-10'
  });
  const sf2 = preview.body.forms.find(form => form.formCode === 'SF2');
  const sf3 = preview.body.forms.find(form => form.formCode === 'SF3');
  assert.equal(sf2.pages.length, 2);
  assert.equal(sf3.pages.length, 2);
  writes = 0;
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [2, 3], sectionId: 8, month: '2026-10',
    previewFingerprint: preview.body.previewFingerprint,
    forms: preview.body.forms.map(form => ({
      templateId: form.templateId,
      edits: form.formCode === 'SF3'
        ? [{ pageIndex: 1, cellAddress: 'D9', value: 'Second-page book title' }]
        : form.formCode === 'SF2' ? [{ pageIndex: 1, cellAddress: 'D13', value: 'X' }] : []
    }))
  });

  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.body);
  assert.equal(workbook.getWorksheet('SF3 Page 2').getCell('D9').value, 'Second-page book title');
  assert.equal(workbook.getWorksheet('SF2 Page 2').getCell('D13').value, 'X');
  learnerRows = null;
});

test('clearing an SF5 average affects only the exported workbook', async () => {
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8
  });
  const sf5 = preview.body.forms.find(form => form.formCode === 'SF5');
  assert.equal(sf5.breakdown[0].generalAverage, publishedFinalGrade);
  writes = 0;
  const result = await call(controller.generateCombinedTemplates, 'POST', {
    templateIds: [1, 5], sectionId: 8,
    previewFingerprint: preview.body.previewFingerprint,
    forms: preview.body.forms.map(form => ({
      templateId: form.templateId,
      edits: form.formCode === 'SF5' ? [{ cellAddress: 'F13', value: '' }] : []
    }))
  });
  assert.equal(result.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.body);
  assert.equal(workbook.getWorksheet('School Form 5 (SF5)').getCell('F13').value, null);
  assert.equal(publishedFinalGrade, 90);
  assert.equal(sf5.breakdown[0].generalAverage, 90);
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

test('school-form edit payload lengths and counts are bounded', async () => {
  const preview = await call(controller.previewCombinedTemplates, 'POST', {
    templateIds: [1, 3], sectionId: 8
  });
  const invalidRequests = [
    [{ cellAddress: 'D9', value: 'x'.repeat(501) }],
    Array.from({ length: 5001 }, () => ({ cellAddress: 'D9', value: 'duplicate' }))
  ];

  for (const edits of invalidRequests) {
    writes = 0;
    const result = await call(controller.generateCombinedTemplates, 'POST', {
      templateIds: [1, 3], sectionId: 8,
      previewFingerprint: preview.body.previewFingerprint,
      forms: preview.body.forms.map(form => ({
        templateId: form.templateId,
        edits: form.formCode === 'SF3' ? edits : []
      }))
    });
    assert.equal(result.error?.status, 400);
    assert.equal(writes, 0);
  }
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

test('individual SF2, SF3, and SF5 XLSX exports apply valid edits while retaining labels and styles', async () => {
  const cases = [
    {
      formCode: 'SF2', fileName: 'sf2.xlsx', sheetName: 'School Form 2 (SF2)',
      edits: [{ cellAddress: 'D11', value: '2026-10-01', type: 'dateText' }, { cellAddress: 'D13', value: 'X', type: 'text' }],
      assertions: sheet => {
        assert.equal(sheet.getCell('D11').value, '10/01/2026');
        assert.equal(sheet.getCell('D13').value, 'X');
      }
    },
    {
      formCode: 'SF3', fileName: 'sf3.xlsx', sheetName: 'School Form 3 (SF3)',
      edits: [{ cellAddress: 'D9', value: 'Mathematics', type: 'text' }, { cellAddress: 'D12', value: '2026-11-08', type: 'dateText' }],
      assertions: sheet => {
        assert.equal(sheet.getCell('D9').value, 'Mathematics');
        assert.equal(sheet.getCell('D10').value, 'Date');
        assert.equal(sheet.getCell('D12').value, '11/08/2026');
      }
    },
    {
      formCode: 'SF5', fileName: 'sf5.xlsx', sheetName: 'School Form 5 (SF5)',
      edits: [{ cellAddress: 'B13', value: 'Dela Cruz, Juan', type: 'text' }, { cellAddress: 'F13', value: 88.25, type: 'number' }],
      assertions: sheet => {
        assert.equal(sheet.getCell('B13').value, 'Dela Cruz, Juan');
        assert.equal(sheet.getCell('F13').value, 88.25);
        assert.equal(sheet.getCell('F13').numFmt, '0.00');
        assert.equal(sheet.getCell('M49').value, 'GUIDELINES:');
      }
    }
  ];

  for (const form of cases) {
    const output = await createExportWorkbook({
      formCode: form.formCode,
      filePath: `/assets/templates/school-forms/${form.fileName}`,
      sheetName: form.sheetName
    }, [form.edits]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output);
    form.assertions(workbook.getWorksheet(form.sheetName));
  }
});
