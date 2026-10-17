const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
const refresh = html.split('async function refreshManagementViews() {')[1]
  .split('function managementApiSectionPayload(')[0];

test('management refresh reapplies the active subject filter after rendering subjects', async () => {
  const calls = [];
  const context = { MANAGEMENT_API_ENABLED: true };
  for (const name of [
    'loadManagementApiData', 'syncManagementStudentRecords', 'renderManagementGradeFilters',
    'renderTeacherOptions', 'renderManagementSubjectTabs', 'renderManagementTabPills',
    'renderSections', 'renderSubjects', 'filterSubjects', 'renderTeacherAssignments', 'renderStudentsTab'
  ]) context[name] = () => { calls.push(name); };

  await vm.runInNewContext(`(async function refreshManagementViews() {${refresh})()`, context);

  assert.ok(calls.indexOf('loadManagementApiData') < calls.indexOf('renderManagementSubjectTabs'));
  assert.equal(calls.indexOf('filterSubjects'), calls.indexOf('renderSubjects') + 1);
});

test('subject modal uses concise copy and responsive field layout while keeping strand sharing explicit', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(html, /<div class="modal" role="dialog" aria-modal="true" aria-labelledby="subjectModalTitle">/);
  assert.match(html, /id="subjectGradeScopeLabel">Grade levels<\/label>/);
  assert.match(html, /for="subjectShsGroup">Grading type<\/label>/);
  assert.match(html, /for="subjectShsTrack">Track<\/label>/);
  assert.match(html, /for="subjectShsStrand">Strand<\/label>/);
  assert.match(html, /subjectShsWeightSummary/);
  assert.match(html, /getShsGradingTypes\(\)/);
  assert.match(html, /All strands in this track/);
  assert.match(html, /textContent = subject \? 'Edit Subject' : 'Add New Subject'/);
  assert.doesNotMatch(html, /id="subjectModalSub"|document\.getElementById\('subjectModalSub'\)|Legacy SHS curriculum|These tags determine|Strand \(optional\)/);
  assert.match(css, /#subjectModalBackdrop \.modal\s*\{\s*max-width:\s*640px;/);
  assert.match(css, /\.subject-shs-weight-summary\s*\{/);
  assert.match(css, /#subjectModalBackdrop #createSubjectForm > \.form-row-2,[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?#subjectModalBackdrop \.form-row-2\s*\{\s*grid-template-columns:\s*1fr;/);
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

test('legacy SHS subjects without an explicit group are not mislabeled as Core', () => {
  const mapping = html.split('function managementApiSubjectRecord(subject) {')[1]
    .split('async function loadManagementApiData()')[0];
  const context = vm.createContext({
    managementGradeKey: value => String(value || '').trim().toLowerCase(),
    managementLevelLabel: value => value === 'shs' ? 'Senior High School' : value
  });
  vm.runInContext(`function managementApiSubjectRecord(subject) {${mapping}`, context);
  const unclassified = context.managementApiSubjectRecord({
    id: 1,
    name: 'Legacy subject',
    schoolLevelCode: 'shs',
    gradeScopes: [{ schoolLevelCode: 'shs', gradeLevelName: 'Grade 11', trackId: null, strandId: null }]
  });
  const core = context.managementApiSubjectRecord({
    id: 2,
    name: 'Core subject',
    shsGradingGroup: 'core',
    gradeScopes: [{ schoolLevelCode: 'shs', gradeLevelName: 'Grade 11', trackId: null, strandId: null }]
  });
  assert.equal(unclassified.type, 'Needs SHS classification');
  assert.equal(unclassified.shsGradingGroup, null);
  assert.equal(core.type, 'Core subject');
});

test('inactive subject spacing is limited to the Subjects panel', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(css, /#panel-subjects > #inactiveSubjectsPanel\s*\{\s*margin-top:\s*20px;/);
  assert.match(css, /#inactiveSubjectsPanel \.inactive-subject-meta\s*\{[^}]*flex-direction:\s*column;/);
});
