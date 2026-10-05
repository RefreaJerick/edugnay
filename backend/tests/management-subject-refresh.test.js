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

test('inactive subject spacing is limited to the Subjects panel', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(css, /#panel-subjects > #inactiveSubjectsPanel\s*\{\s*margin-top:\s*20px;/);
  assert.match(css, /#inactiveSubjectsPanel \.inactive-subject-meta\s*\{[^}]*flex-direction:\s*column;/);
});
