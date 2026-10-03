const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const commonSource = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
const sectionsSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
const sfSource = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sf-templates.js'), 'utf8');

test('teacher section callers use the subject-assignment scope', () => {
  assert.match(commonSource, /getApiSections\(\{ scope: 'teaching' \}\)/);
  assert.match(dashboardSource, /EDUGNAY_CONFIG\.getMyTeachingSections\(\)/);
  assert.doesNotMatch(dashboardSource, /EDUGNAY_API\.getSectionTeachers\(section\.id\)/);
});

test('direct section access stops before subject APIs when no assignment exists', () => {
  assert.match(sectionsSource, /This section has no subject assigned to your account\./);
  const guard = sectionsSource.indexOf("if (!hasValidBackendSubjectAssignment())");
  const attendanceRequest = sectionsSource.indexOf('getSectionAttendanceHistory(section.id, CURRENT_SUBJECT_ID)');
  assert.ok(guard >= 0 && attendanceRequest > guard);
});

test('student names open a section-scoped details modal with guardian contact details', () => {
  assert.match(sectionsSource, /data-student-details=/);
  assert.match(sectionsSource, /const row = event\.target\.closest\('tr\[data-student-id\]'\)/);
  assert.match(sectionsSource, /openTeacherStudentDetails\(row\.dataset\.studentId, row\.querySelector\('\[data-student-details\]'\)\)/);
  assert.match(sectionsSource, /EDUGNAY_API\.getSectionStudentDetails\(CURRENT_SECTION_ID, studentId\)/);
  assert.match(sectionsSource, /teacherStudentDetailsModal/);
  assert.match(sectionsSource, /Parents and guardians/);
  assert.match(sectionsSource, /Student number \(LRN\)/);
  assert.match(sectionsSource, /\['Enrollment status', student\.enrollmentStatus\]/);
});

test('SF templates keep the separate adviser-only section source', () => {
  assert.match(sfSource, /getMyAdvisorySections\(\)/);
});

test('QR attendance quick action requires a teacher section and subject choice', () => {
  assert.match(dashboardSource, /openTeacherQrAttendanceModal\(this\)/);
  assert.doesNotMatch(dashboardSource, /edugnay-teacher-sections\.html\?tab=attendance&action=qr/);
  assert.match(dashboardSource, /target\.searchParams\.set\('sectionId', section\.sectionId\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('subjectId', assignment\.subjectId\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('tab', 'attendance'\)/);
  assert.match(dashboardSource, /target\.searchParams\.set\('action', 'qr'\)/);
});

test('assignment modal follows the selected subject and saves its ID', () => {
  assert.doesNotMatch(sectionsSource, /id="assignSubjectInput"[^>]*value="Values Education"/);
  assert.match(sectionsSource, /subjectId: CURRENT_SUBJECT_ID,/);
  assert.doesNotMatch(sectionsSource, /getElementById\('assignSubjectInput'\)\.value\.trim\(\)/);

  const updateSource = sectionsSource.match(/function updateSectionSubjectControl\(\) \{[\s\S]*?\n  \}\n\n  function renderScoreTable/)[0]
    .replace(/\n\n  function renderScoreTable$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, replaceChildren() {}, addEventListener() {}, value: '', textContent: '', hidden: false
    });
    return elements.get(id);
  };
  const context = {
    document: {
      getElementById: element,
      createElement: () => ({ value: '', textContent: '' }),
      querySelectorAll: () => []
    },
    CURRENT_SUBJECT: 'English',
    CURRENT_SUBJECT_ID: '17',
    CURRENT_SUBJECT_ASSIGNMENT: { subjectId: '17', subjectName: 'English' },
    CURRENT_TEACHER_SUBJECT_ASSIGNMENTS: [{ subjectId: '17', subjectName: 'English' }],
    CURRENT_SECTION: 'Grade 7 - St. Matthew'
  };
  vm.runInNewContext(`${updateSource}; updateSectionSubjectControl();`, context);
  assert.equal(element('assignSubjectInput').value, 'English');
  assert.equal(element('sectionSubjectSelect').value, '17');

  context.CURRENT_SUBJECT_ASSIGNMENT = null;
  context.CURRENT_SUBJECT_ID = '';
  context.CURRENT_SUBJECT = 'Subject unavailable';
  vm.runInNewContext('updateSectionSubjectControl();', context);
  assert.equal(element('assignSubjectInput').value, '');
});

test('assignment creation uses the selected subject ID even if a label is stale', async () => {
  const addSource = sectionsSource.match(/async function addAssignment\(\) \{[\s\S]*?\n  \}\n\n  function resetAssignmentForm/)[0]
    .replace(/\n\n  function resetAssignmentForm$/, '');
  let saved;
  const fields = {
    assignTitleInput: { value: 'Reading response' },
    assignSubjectInput: { value: 'Values Education' },
    assignInstructionsInput: { value: '' },
    assignDueInput: { value: '2026-10-09' },
    assignOnlineSubmissionInput: { checked: false },
    assignGradingInput: { checked: false },
    academicPeriodSelect: { value: 'q1' }
  };
  const context = {
    document: { getElementById: id => fields[id] },
    window: { EDUGNAY_CONFIG: { createAssignment: values => { saved = values; } } },
    CURRENT_SUBJECT_ASSIGNMENT: { subjectId: 'english' },
    CURRENT_SUBJECT_ID: 'english',
    CURRENT_SECTION_ID: 'grade-7',
    CURRENT_TEACHER_ID: 'teacher-1',
    TEACHER_SECTION_SCHOOL_ID: 'school-1',
    isBackendGradeMode: () => false,
    resetAssignmentForm() {}, closeModal() {}, renderAssignments() {}, renderScoreTable() {}
  };
  await vm.runInNewContext(`${addSource}; addAssignment();`, context);
  assert.equal(saved.subjectId, 'english');
});

test('delete modal allows a new component even when its subject has published grades', () => {
  const openSource = sectionsSource.match(/function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
    .replace(/\n\n  async function confirmTeacherDelete$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const component = { id: '12', sectionId: '8', subjectId: '4', academicTermId: '6', usedInPublishedGrades: false };
  const context = {
    document: { getElementById: element },
    window: { lucide: { createIcons() {} } },
    BACKEND_GRADING_ITEMS: [component],
    BACKEND_STUDENT_SCORES: [{ gradingItemId: '12', score: 5 }],
    BACKEND_ASSIGNMENTS: [],
    BACKEND_PUBLISHED_GRADES: [{ sectionId: '8', subjectId: '4', academicTermId: '6' }],
    openModal() {}
  };
  vm.runInNewContext(`${openSource}; openTeacherDeleteModal('scoreComponent', '12', 'New quiz');`, context);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /1 saved student score record/);

  component.usedInPublishedGrades = true;
  vm.runInNewContext("openTeacherDeleteModal('scoreComponent', '12', 'New quiz');", context);
  assert.equal(element('teacherDeleteConfirmButton').disabled, true);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /used in published grades/);
});

test('linked score component opens the combined assignment deletion confirmation', () => {
  const openSource = sectionsSource.match(/function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
    .replace(/\n\n  async function confirmTeacherDelete$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element },
    window: { lucide: { createIcons() {} } },
    BACKEND_GRADING_ITEMS: [{ id: '12', name: 'Quiz', usedInPublishedGrades: false }],
    BACKEND_ASSIGNMENTS: [{ id: '4', title: 'test', gradingItemId: '12' }],
    BACKEND_STUDENT_SCORES: [{ gradingItemId: '12', score: null, remarks: null }], BACKEND_SUBMISSIONS: new Map(),
    openModal() {}
  };
  vm.runInNewContext(`${openSource}; openTeacherDeleteModal('scoreComponent', '12', 'Quiz');`, context);
  assert.equal(element('teacherDeleteConfirmTitle').textContent, 'Delete assignment and component?');
  assert.equal(element('teacherDeleteConfirmName').textContent, 'Quiz');
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.equal(element('teacherDeleteConfirmButton').textContent, 'Delete Both');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'Its linked assignment will also be deleted.');
  vm.runInNewContext("openTeacherDeleteModal('assignment', '4', 'test');", context);
  assert.equal(element('teacherDeleteConfirmName').textContent, 'test');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'Its linked score component will also be deleted.');
  assert.match(sectionsSource, /data-delete-assignment=.*?Delete Assignment & Component/s);
  assert.match(sectionsSource, /if \(request\.kind === 'assignment'\) \{[\s\S]*?EDUGNAY_API\.deleteAssignment\(request\.id\)/);
});

test('modified teacher page scripts still parse', () => {
  for (const html of [dashboardSource, sectionsSource]) {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(Boolean);
    scripts.forEach(source => new vm.Script(source));
  }
});
