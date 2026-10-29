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

test('DepEd catalog review is available on Subjects and refreshes the managed subject list after apply', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
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
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
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
  assert.match(html, /context: managementSubjectDescriptor\(subject, 'Configured subject'\)/);
});

test('Class Management inline scripts parse', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(scripts.length, 'Class Management has inline scripts');
  scripts.forEach((source, index) => new vm.Script(source, { filename: `admin-management.inline-${index + 1}.js` }));
});

test('subject cards share a gap between details and actions', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/management.css'), 'utf8');
  assert.match(css, /#panel-subjects > #inactiveSubjectsPanel\s*\{\s*margin-top:\s*20px;/);
  assert.match(css, /#inactiveSubjectsPanel \.inactive-subject-meta\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(css, /\.subject-card\s*\{[^}]*column-gap:\s*16px;/);
  assert.doesNotMatch(css, /#inactiveSubjectsPanel \.inactive-subject-card\s*\{[^}]*column-gap:/);
});
