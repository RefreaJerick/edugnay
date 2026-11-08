const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = pageFs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
const management = pageFs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');
const refresh = html.split('async function refreshManagementViews() {')[1]
  .split('function managementApiSectionPayload(')[0];

test('management refresh reapplies the active subject filter after rendering subjects', async () => {
  const calls = [];
  const context = { MANAGEMENT_API_ENABLED: true, managementDataLoading: true };
  for (const name of [
    'loadManagementApiData', 'syncManagementStudentRecords', 'renderManagementGradeFilters',
    'renderTeacherOptions', 'renderManagementSubjectTabs', 'renderManagementTabPills',
    'renderSections', 'renderSubjects', 'filterSubjects', 'renderTeacherAssignments', 'renderStudentsTab'
  ]) context[name] = () => { calls.push(name); };

  await vm.runInNewContext(`(async function refreshManagementViews() {${refresh})()`, context);

  assert.ok(calls.indexOf('loadManagementApiData') < calls.indexOf('renderManagementSubjectTabs'));
  assert.equal(calls.indexOf('filterSubjects'), calls.indexOf('renderSubjects') + 1);
  assert.equal(context.managementDataLoading, false, 'loading guards are released before filters rerun');
});

test('Class Management leaves data regions blank and shows a retry action when loading fails', () => {
  const source = management.slice(
    management.indexOf('let managementDataLoading = false;'),
    management.indexOf('\nfunction switchMgmtTab(')
  );
  const targets = new Map();
  const feedback = { hidden: true, innerHTML: '' };
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!targets.has(selector)) targets.set(selector, { innerHTML: '' });
        return targets.get(selector);
      },
      getElementById(id) { return id === 'managementLoadError' ? feedback : null; }
    },
    window: {
      EDUGNAY_CONFIG: {
        renderPanelEmptyState: options => `${options.title}: ${options.text}`
      }
    },
    lucide: { createIcons() {} }
  });
  new vm.Script(`${source}; globalThis.loadingState = {
    regions: MANAGEMENT_LOADING_REGIONS,
    render: renderManagementLoadingState,
    fail: showManagementLoadError,
    isLoading: () => managementDataLoading
  };`).runInContext(context);

  context.loadingState.render();
  assert.equal(context.loadingState.regions.length, 11);
  for (const selector of context.loadingState.regions) {
    assert.equal(targets.get(selector).innerHTML, '', `${selector} is blank while loading`);
  }
  assert.equal(context.loadingState.isLoading(), true);

  context.loadingState.fail({ message: 'Temporary connection error' });
  for (const target of targets.values()) assert.equal(target.innerHTML, '', 'failure leaves data regions blank');
  assert.equal(feedback.hidden, false);
  assert.match(feedback.innerHTML, /Class management unavailable/);
  assert.match(feedback.innerHTML, /Temporary connection error/);
  assert.match(feedback.innerHTML, />Retry</);
  assert.match(html, /id="managementLoadError" role="alert" hidden/);
  assert.match(management, /g5a9c210f6c2: function\(event\) \{ event\.preventDefault\(\); window\.location\.reload\(\); \}/);
});

test('Class Management keeps data regions blank during a slow load and renders results on success', async () => {
  const startupStart = management.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  const startup = management.slice(startupStart, management.indexOf('\n\nwindow.EDUGNAY_PAGE_EVENTS.bind', startupStart));
  const refreshStart = management.indexOf('async function refreshManagementViews() {');
  const refreshFunction = management.slice(refreshStart, management.indexOf('\nfunction managementApiSectionPayload(', refreshStart));
  const loadingHelpers = management.slice(
    management.indexOf('let managementDataLoading = false;'),
    management.indexOf('\nfunction switchMgmtTab(')
  );
  const targets = new Map();
  const getTarget = selector => {
    if (!targets.has(selector)) targets.set(selector, { innerHTML: '' });
    return targets.get(selector);
  };
  let releaseSchool;
  const schoolReady = new Promise(resolve => { releaseSchool = resolve; });
  const feedback = { hidden: true, innerHTML: '' };
  const context = vm.createContext({
    document: {
      addEventListener(name, handler) { if (name === 'DOMContentLoaded') context.initialize = handler; },
      querySelector: getTarget,
      getElementById(id) { return id === 'managementLoadError' ? feedback : getTarget(`#${id}`); }
    },
    window: {
      EDUGNAY_SCHOOL_READY: schoolReady,
      EDUGNAY_PAGE_LOADING: { ready() {} },
      EDUGNAY_CONFIG: {
        renderPanelEmptyState: options => `empty:${options.title}:${options.text}`
      },
      createStudentMultiSelect: () => ({}),
      initSearchableSelect() {}
    },
    lucide: { createIcons() {} },
    handleManagementStudentChange() {},
    updateSectionFormFields() {},
    loadManagementApiData: async () => {},
    renderManagementGradeFilters() {},
    renderTeacherOptions() {},
    renderManagementTabPills() {},
    filterSubjects() {},
    renderManagementSubjectTabs() { getTarget('#subjectGradeTabs').innerHTML = 'empty:subject filters'; },
    renderSections() {
      getTarget('#sections-summary-cards').innerHTML = 'empty:section totals';
      getTarget('#sectionCardView').innerHTML = 'empty:sections';
      getTarget('#sectionTableView tbody').innerHTML = 'empty:section table';
    },
    renderSubjects() {
      getTarget('#subjects-summary-cards').innerHTML = 'empty:subject totals';
      getTarget('#subjectTableBody').innerHTML = 'empty:subjects';
    },
    renderTeacherAssignments() {
      getTarget('#teacher-summary-cards').innerHTML = 'empty:assignment totals';
    },
    renderStudentsTab() {
      getTarget('#students-summary-cards').innerHTML = 'empty:student totals';
      getTarget('#studentGradeTabs').innerHTML = 'empty:student filters';
      getTarget('#enrolledBody').innerHTML = 'empty:enrolled students';
      getTarget('#panel-students .sc-list').innerHTML = 'empty:section enrollment';
    }
  });
  new vm.Script(`${loadingHelpers}\n${refreshFunction}\n${startup}\nglobalThis.managementRegions = MANAGEMENT_LOADING_REGIONS;`).runInContext(context);

  const load = context.initialize();
  assert.equal(context.managementRegions.length, 11);
  for (const selector of context.managementRegions) assert.equal(targets.get(selector).innerHTML, '');
  assert.equal(vm.runInContext('managementDataLoading', context), true);

  releaseSchool({ id: 1 });
  await load;
  assert.equal(vm.runInContext('managementDataLoading', context), false);
  assert.equal(targets.get('#sectionCardView').innerHTML, 'empty:sections');
  assert.equal(targets.get('#subjectTableBody').innerHTML, 'empty:subjects');
  assert.equal(feedback.hidden, true);

  for (const name of ['filterSections', 'filterSubjects', 'filterTeacherBlocks', 'applyStudentFilters']) {
    const start = management.indexOf(`function ${name}(`);
    const body = management.slice(start, management.indexOf('\n}', start));
    assert.match(body, /if \(managementDataLoading\) return;/, `${name} ignores input while data loads`);
  }
  assert.match(management, /function setSectionView\(view\)/);
});

test('DepEd catalog review is available on Subjects and refreshes the managed subject list after apply', () => {
  const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  const mainEnd = html.indexOf('</main>');
  const reviewModal = html.indexOf('id="depedSubjectReviewModal"');

  assert.match(html, /id="reviewDepedSubjects"[^>]*hidden/);
  assert.match(html, /reviewDepedButton\.hidden = !managementSchoolLevels\(\)\.some\(level => \['elementary', 'jhs', 'shs'\]\.includes\(level\)\)/);
  assert.ok(mainEnd >= 0 && reviewModal > mainEnd, 'review modal is outside the hidden Subjects panel');
  assert.match(html, /window\.EDUGNAY_API\.getDepedSubjectPreview\(\)/);
  assert.match(html, /window\.EDUGNAY_API\.applyDepedSubjectDefaults\(\)/);
  assert.match(html, /await refreshManagementViews\(\)/);
  assert.match(html, /No eligible grades/);
  assert.match(html, /edugnay-admin-schools\.html#academic-structure/);
  assert.match(css, /\.deped-subject-modal \.modal\s*\{[^}]*width:\s*min\(1100px, 100%\);[^}]*max-width:\s*1100px;/s);
  assert.match(css, /\.deped-subject-review-body \.term-modal-message\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.deped-subject-grade-list\s*\{\s*grid-template-columns: 1fr;/);
});

test('subject modal uses Strengthened SHS type, track, and hours fields', () => {
  const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(html, /<div class="modal" role="dialog" aria-modal="true" aria-labelledby="subjectModalTitle">/);
  assert.match(html, /id="subjectGradeScopeLabel">Grade levels<\/label>/);
  assert.match(html, /for="subjectShsGroup">Subject type<\/label>/);
  assert.match(html, /for="subjectShsTrack">Track<\/label>/);
  assert.match(html, /for="subjectShsHours">Instructional hours<\/label>/);
  assert.doesNotMatch(html, /for="subjectShsStrand">/);
  assert.match(html, /textContent = subject \? 'Edit Subject' : 'Add New Subject'/);
  assert.doesNotMatch(html, /id="subjectModalSub"|document\.getElementById\('subjectModalSub'\)|Legacy SHS curriculum|These tags determine|Strand \(optional\)/);
  assert.match(css, /#subjectModalBackdrop \.modal\s*\{\s*max-width:\s*640px;/);
  assert.match(css, /#subjectModalBackdrop #createSubjectForm > \.form-row-2,[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?#subjectModalBackdrop \.form-row-2\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('subject grade groups preserve checkbox values, selection, and SHS field behavior', () => {
  const grades = [
    { id: 2, levelCode: 'elementary', gradeCode: 'grade-2', displayName: 'Grade 2' },
    { id: 3, levelCode: 'elementary', gradeCode: 'grade-3', displayName: 'Grade 3' },
    { id: 7, levelCode: 'jhs', gradeCode: 'grade-7', displayName: 'Grade 7' },
    { id: 11, levelCode: 'shs', gradeCode: 'grade-11', displayName: 'Grade 11' },
    { id: 12, levelCode: 'shs', gradeCode: 'grade-12', displayName: 'Grade 12' }
  ];
  const contexts = {
    all: { key: 'all', mode: 'all', gradeOptions: grades },
    elementary: { key: 'elementary', mode: 'division', gradeOptions: grades.slice(0, 2) },
    'elementary:grade-2': { key: 'elementary:grade-2', mode: 'grade', gradeOptions: grades.slice(0, 1) },
    shs: { key: 'shs', mode: 'division', gradeOptions: grades.slice(3) }
  };
  const target = { innerHTML: '' };
  const contextInput = { value: '' };
  const panel = { hidden: true };
  const groupSelect = { value: '' };
  const trackSelect = { value: '' };
  const hoursSelect = { value: '' };
  const inputPattern = /<input type="checkbox" name="gradeLevelIds" value="(\d+)" data-level-code="([^"]+)" data-grade-code="([^"]+)"\s+(checked\s+)?data-page-change="g9914d313cdd7">/g;
  const checks = () => Array.from(target.innerHTML.matchAll(inputPattern), ([, value, levelCode, gradeCode, checked]) => ({
    value: Number(value), levelCode, gradeCode, checked: Boolean(checked)
  }));
  const state = { contextValue: 'all', contextStrand: 'all', subject: null };
  const context = vm.createContext({
    activeSubjectGrade: 'all',
    subjectModalState: state,
    getSubjectModalContext: value => contexts[value],
    managementLevelLabel: value => ({ elementary: 'Elementary', jhs: 'Junior High School', shs: 'Senior High School' })[value],
    managementSetOptions() {},
    managementTrackOptions: () => [],
    document: {
      getElementById(id) {
        return ({
          subjectGradeChecks: target, subjectModalContext: contextInput,
          subjectShsFields: panel, subjectShsGroup: groupSelect,
          subjectShsTrack: trackSelect, subjectShsHours: hoursSelect
        })[id];
      },
      querySelectorAll() {
        return checks().filter(input => input.checked).map(input => ({
          value: String(input.value),
          dataset: { levelCode: input.levelCode, gradeCode: input.gradeCode }
        }));
      }
    }
  });
  const start = management.indexOf('function renderSubjectGradeChecks(');
  const end = management.indexOf('\nfunction openSubjectModal(', start);
  new vm.Script(management.slice(start, end)).runInContext(context);

  context.renderSubjectGradeChecks('all');
  assert.equal((target.innerHTML.match(/class="grade-check-group"/g) || []).length, 3);
  assert.match(target.innerHTML, /Elementary<\/div>[\s\S]*Grade 2/);
  assert.match(target.innerHTML, /Junior High School<\/div>[\s\S]*Grade 7/);
  assert.match(target.innerHTML, /Senior High School<\/div>[\s\S]*Grade 11/);
  assert.doesNotMatch(target.innerHTML, /Elementary · Grade 2/);
  assert.equal(checks().map(input => input.value).join(','), '2,3,7,11,12');
  assert.ok(checks().every(input => input.checked));
  assert.equal(panel.hidden, false);

  const subject = { gradeLevelIds: [2, 11] };
  context.renderSubjectGradeChecks('elementary', subject);
  assert.equal(contextInput.value, 'elementary');
  assert.equal(checks().map(input => input.value).join(','), '2,3');
  assert.equal(checks().filter(input => input.checked).map(input => input.value).join(','), '2');
  assert.equal(panel.hidden, true);

  const selectionStart = management.indexOf('  const context = getSubjectModalContext(subjectModalState.contextValue, subjectModalState.contextStrand);',
    management.indexOf("document.getElementById('createSubjectForm').addEventListener('submit'"));
  const selectionEnd = management.indexOf('  if (!gradeLevelIds.length)', selectionStart);
  new vm.Script('function savedGradeIds(form) {' + management.slice(selectionStart, selectionEnd) +
    ' return gradeLevelIds; }').runInContext(context);
  const form = { querySelectorAll: () => checks().filter(input => input.checked).map(input => ({ value: String(input.value) })) };
  context.renderSubjectGradeChecks('all');
  state.contextValue = 'all';
  state.subject = null;
  assert.equal(Array.from(context.savedGradeIds(form)).join(','), '2,3,7,11,12', 'new subjects keep the default grade selection');

  context.renderSubjectGradeChecks('all', subject);
  state.subject = subject;
  assert.equal(Array.from(context.savedGradeIds(form)).join(','), '2,11', 'editing all levels keeps only saved grades');

  context.renderSubjectGradeChecks('elementary', subject);
  state.contextValue = 'elementary';
  assert.equal(Array.from(context.savedGradeIds(form)).join(','), '11,2', 'editing preserves a grade outside the visible level');

  context.renderSubjectGradeChecks('elementary:grade-2', subject);
  state.contextValue = 'elementary:grade-2';
  assert.equal(checks().map(input => input.value).join(','), '2');
  assert.equal(Array.from(context.savedGradeIds(form)).join(','), '11,2', 'single-grade editing preserves other grades');

  context.renderSubjectGradeChecks('shs', subject);
  assert.equal(checks().filter(input => input.checked).map(input => input.value).join(','), '11');
  assert.equal(panel.hidden, false);
  target.innerHTML = target.innerHTML.replace('data-grade-code="grade-11" checked ', 'data-grade-code="grade-11" ');
  context.updateSubjectShsFields();
  assert.equal(panel.hidden, true, 'clearing the last SHS grade hides SHS fields');

  const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(css, /#subjectModalBackdrop \.grade-check-grid\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?#subjectModalBackdrop \.grade-check-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
});

test('inactive subject cards show their saved school level and grade', () => {
  const mapping = html.split('function managementApiSubjectRecord(subject) {')[1]
    .split('async function loadManagementApiData()')[0];
  const rendering = html.split('function renderInactiveSubjects() {')[1]
    .split('function managementFilterMatches(')[0];
  const panel = { hidden: true };
  const list = { innerHTML: '', querySelectorAll: () => [] };
  const context = vm.createContext({
    MANAGEMENT_API_ENABLED: true,
    MANAGEMENT_API_CONTEXT: { inactiveSubjects: [] },
    managementGradeKey: grade => String(grade).toLowerCase(),
    managementLevelLabel: level => level === 'elementary' ? 'Elementary' : 'Junior High School',
    managementSchoolLevels: () => ['elementary', 'jhs'],
    managementGradeOptions: () => ['Grade 4'],
    document: { getElementById: id => id === 'inactiveSubjectsPanel' ? panel : list },
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value) } }
  });
  vm.runInContext(`function managementApiSubjectRecord(subject) {${mapping} function renderInactiveSubjects() {${rendering}`, context);
  context.MANAGEMENT_API_CONTEXT.inactiveSubjects = [
    { id: 1, name: 'English', code: 'eng', schoolLevelCode: 'jhs', schoolLevelName: 'Junior High School', gradeLevelName: 'Grade 7' },
    { id: 2, name: 'Music', code: 'music', schoolLevelCode: 'elementary', schoolLevelName: 'Elementary' },
    { id: 3, name: 'Values', code: 'values' }
  ].map(subject => context.managementApiSubjectRecord({ ...subject, isActive: false }));

  context.renderInactiveSubjects();

  assert.equal(panel.hidden, false);
  assert.match(list.innerHTML, /<span>eng<\/span>\s*<span class="inactive-subject-placement">Junior High School · Grade 7<\/span>/);
  assert.match(list.innerHTML, /<span>music<\/span>\s*<span class="inactive-subject-placement">Elementary · All grades<\/span>/);
  assert.match(list.innerHTML, /<span>values<\/span>\s*<span class="inactive-subject-placement">All school levels<\/span>/);
  assert.doesNotMatch(list.innerHTML, /Inactive; linked records preserved/);
  assert.equal((list.innerHTML.match(/data-restore-subject/g) || []).length, 3);
});

test('Elementary and JHS subject cards and removal details omit type labels while SHS keeps its classification', () => {
  const mapping = html.split('function managementApiSubjectRecord(subject) {')[1]
    .split('async function loadManagementApiData()')[0];
  const display = html.split('function managementSubjectTypeForDisplay(')[1]
    .split('function managementApiSubjectRecord(subject) {')[0];
  const context = vm.createContext({
    activeSubjectGrade: 'all',
    managementGradeKey: value => String(value || '').trim().toLowerCase(),
    managementLevelLabel: value => value === 'shs' ? 'Senior High School' : value
  });
  vm.runInContext(`function managementSubjectTypeForDisplay(${display}function managementApiSubjectRecord(subject) {${mapping}`, context);
  const unclassified = context.managementApiSubjectRecord({
    id: 1,
    name: 'Legacy subject',
    code: 'legacy-shs',
    schoolLevelCode: 'shs',
    gradeScopes: [{ schoolLevelCode: 'shs', gradeLevelName: 'Grade 11', trackId: null, strandId: null }]
  });
  const core = context.managementApiSubjectRecord({
    id: 2,
    name: 'Core subject',
    code: 'core-shs',
    shsSubjectType: 'core',
    gradeScopes: [{ schoolLevelCode: 'shs', gradeLevelName: 'Grade 11', trackId: null, strandId: null }]
  });
  const elementary = context.managementApiSubjectRecord({
    id: 3,
    name: 'English',
    code: 'eng',
    type: 'Core Subject',
    schoolLevelCode: 'elementary',
    gradeScopes: [{ schoolLevelCode: 'elementary', gradeLevelName: 'Grade 4' }]
  });
  const jhs = context.managementApiSubjectRecord({
    id: 4,
    name: 'Mathematics',
    code: 'math',
    type: 'Core Subject',
    schoolLevelCode: 'jhs',
    gradeScopes: [{ schoolLevelCode: 'jhs', gradeLevelName: 'Grade 7' }]
  });
  const legacyElementary = context.managementApiSubjectRecord({
    id: 5,
    name: 'Legacy English',
    code: 'eng-old',
    type: 'Core Subject',
    shsGradingGroup: 'core',
    schoolLevelCode: 'elementary',
    gradeScopes: [{ schoolLevelCode: 'elementary', gradeLevelName: 'Grade 4' }]
  });
  const sharedJhsShs = context.managementApiSubjectRecord({
    id: 6,
    name: 'Shared subject',
    code: 'shared',
    schoolLevelCode: 'jhs',
    shsGradingGroup: 'core',
    gradeScopes: [
      { schoolLevelCode: 'jhs', gradeLevelName: 'Grade 10' },
      { schoolLevelCode: 'shs', gradeLevelName: 'Grade 11' }
    ]
  });
  assert.equal(unclassified.type, 'Needs Strengthened SHS setup');
  assert.equal(unclassified.shsSubjectType, null);
  assert.equal(core.type, 'Core subject');
  assert.equal(elementary.type, '');
  assert.equal(jhs.type, '');
  assert.equal(legacyElementary.type, '');
  assert.equal(context.managementSubjectDescriptor(elementary), 'eng');
  assert.equal(context.managementSubjectDescriptor(jhs, 'Configured subject'), 'math');
  assert.equal(context.managementSubjectDescriptor(legacyElementary), 'eng-old');
  assert.equal(context.managementSubjectDescriptor(sharedJhsShs), 'shared');
  assert.equal(context.managementSubjectDescriptor(sharedJhsShs, '', 'jhs'), 'shared');
  assert.equal(context.managementSubjectDescriptor(sharedJhsShs, '', 'shs:grade11'), 'shared · Needs Strengthened SHS setup');
  assert.equal(context.managementSubjectDescriptor(core), 'core-shs · Core subject');
  assert.equal(context.managementSubjectDescriptor(unclassified), 'legacy-shs · Needs Strengthened SHS setup');
  assert.match(html, /const descriptor = managementSubjectDescriptor\(subject\)/);
  assert.match(html, /context: managementSubjectDescriptor\(subject, 'Subject details'\)/);
});

test('Class Management inline scripts parse', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(scripts.length, 'Class Management has inline scripts');
  scripts.forEach((source, index) => new vm.Script(source, { filename: `admin-management.inline-${index + 1}.js` }));
});

test('subject cards share a gap between details and actions', () => {
  const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(css, /#panel-subjects > #inactiveSubjectsPanel\s*\{\s*margin-top:\s*20px;/);
  assert.match(css, /#inactiveSubjectsPanel \.inactive-subject-meta\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.subject-card\s*\{[^}]*column-gap:\s*16px;/);
  assert.doesNotMatch(css, /#inactiveSubjectsPanel \.inactive-subject-card\s*\{[^}]*column-gap:/);
});
