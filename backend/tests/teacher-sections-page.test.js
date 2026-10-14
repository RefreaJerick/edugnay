const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const commonSource = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
const sectionsSource = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
const sectionsStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/teacher/sections.css'), 'utf8');
const sfSource = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sf-templates.js'), 'utf8');

function createTransferNoticeContext(state) {
  const makeElement = tagName => ({
    tagName,
    children: [],
    listeners: {},
    className: '',
    hidden: false,
    setAttribute() {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    classList: { toggle(name, enabled) { this[name] = enabled; } },
    textContent: ''
  });
  const notice = makeElement('div');
  const scope = { sectionId: '8', subjectId: '4', academicTermId: '2' };
  const functionSource = sectionsSource.split('  function renderTransferReviewNotice(scope) {')[1]
    .split('\n  async function ensureTransferReviewLoaded')[0];
  let reviewCount = 0;
  let retryCount = 0;
  const transferReviewCache = new Map([['8:4:2', state]]);
  const context = vm.createContext({
    document: { getElementById: () => notice, createElement: makeElement },
    window: { lucide: { createIcons() {} } },
    TRANSFER_REVIEW_CACHE: transferReviewCache,
    transferReviewKey: () => '8:4:2',
    ensureTransferReviewLoaded: () => { retryCount += 1; },
    openTransferReviewModal: () => { reviewCount += 1; }
  });
  vm.runInContext(`function renderTransferReviewNotice(scope) {${functionSource}`, context);
  context.renderTransferReviewNotice(scope);
  return { notice, transferReviewCache, reviewCount: () => reviewCount, retryCount: () => retryCount };
}

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

test('notification links can open an active advisory section without a subject assignment', () => {
  assert.match(sectionsSource, /if \(!selectedSection\) \{[\s\S]*?getMyAdvisorySections\(\)/);
  assert.match(sectionsSource, /selectedSection = advisorySection/);
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

test('SF templates keep the separate adviser-only section source, including closed-year SF5', () => {
  assert.match(sfSource, /getMyAdvisorySections\(true\)/);
});

test('score rows have no individual transfer link and the review modal uses scoped responsive styling', () => {
  assert.doesNotMatch(sectionsSource, /transfer-review-link|Prior grade final/);
  assert.match(sectionsSource, /transferReviewNotice[\s\S]*?textContent = 'Review'[\s\S]*?openTransferReviewModal\(\)/);
  assert.match(sectionsSource, /class="modal transfer-review-modal"/);
  assert.match(sectionsSource, /class="modal-body transfer-review-content" id="transferReviewContent"/);
  assert.doesNotMatch(sectionsSource, /id="transferReviewContent"[^>]*style=/);
  assert.match(sectionsSource, /class="transfer-review-row-heading"/);
  assert.match(sectionsSource, /class="transfer-review-detail"/);
});

test('transfer review notice has a gap above it and keeps responsive side margins', () => {
  assert.match(sectionsStyles, /\.transfer-review-notice\s*\{[^}]*margin:\s*12px 20px 12px;/);
  assert.match(sectionsStyles, /@media \(max-width: 760px\)\s*\{\s*\.transfer-review-notice\s*\{\s*margin-right:\s*15px;\s*margin-left:\s*15px;/);
});

test('transfer review notice handles loading, retry, empty, and full review states', () => {
  const loading = createTransferNoticeContext({ loading: true });
  assert.equal(loading.notice.hidden, false);
  assert.match(loading.notice.children[1].textContent, /Checking previous section work/);

  const failed = createTransferNoticeContext({ error: 'Network error' });
  assert.equal(failed.notice.classList['is-error'], true);
  const retry = failed.notice.children[2].children[0];
  assert.equal(retry.textContent, 'Retry');
  retry.listeners.click();
  assert.equal(failed.retryCount(), 1);
  assert.equal(failed.transferReviewCache.has('8:4:2'), false);

  const empty = createTransferNoticeContext({ data: { scores: [], publishedGrades: [] } });
  assert.equal(empty.notice.hidden, true);

  const ready = createTransferNoticeContext({ data: {
    scores: [{ studentId: 7 }], publishedGrades: [{ studentId: 7 }, { studentId: 9 }]
  } });
  assert.equal(ready.notice.hidden, false);
  assert.match(ready.notice.children[1].textContent, /2 transferred students have previous work/);
  ready.notice.children[2].children[0].listeners.click();
  assert.equal(ready.reviewCount(), 1);
});

test('transfer review modal renders score and published-grade cards with a safe empty state', () => {
  const functionSource = sectionsSource.split('  function openTransferReviewModal() {')[1]
    .split('\n  function renderScoreTable(')[0];
  const content = { innerHTML: '' };
  let openedModal = '';
  let reviewData = {
    scores: [{ studentId: 7, sourceSectionName: 'St. Mark', itemTitle: 'Quiz & test', score: 25, maxScore: 25, categoryName: 'Written Work' }],
    publishedGrades: [{ studentId: 7, sourceSectionName: 'St. John', finalGrade: 91 }]
  };
  const context = vm.createContext({
    BACKEND_GRADE_CONTEXT: { sectionId: '8', subjectId: '4' },
    document: {
      getElementById(id) { return id === 'academicPeriodSelect' ? { value: 'period-2' } : content; }
    },
    window: { EDUGNAY_CONFIG: { escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') } },
    TRANSFER_REVIEW_CACHE: new Map([['8:4:2', { data: reviewData }]]),
    transferReviewScope: () => ({ sectionId: '8', subjectId: '4', academicTermId: '2' }),
    transferReviewKey: () => '8:4:2',
    getGradeStudents: () => [{ id: 7, displayName: 'Test & Demo' }],
    openModal: id => { openedModal = id; }
  });
  vm.runInNewContext(`function openTransferReviewModal() {${functionSource}`, context);
  context.openTransferReviewModal();
  assert.equal(openedModal, 'transferReviewModal');
  assert.match(content.innerHTML, /Test &amp; Demo/);
  assert.match(content.innerHTML, /Quiz &amp; test: 25 \/ 25/);
  assert.match(content.innerHTML, /Final grade: 91/);
  assert.match(content.innerHTML, /St\. Mark/);
  assert.match(content.innerHTML, /St\. John/);

  reviewData = { scores: [], publishedGrades: [] };
  context.TRANSFER_REVIEW_CACHE.set('8:4:2', { data: reviewData });
  context.openTransferReviewModal();
  assert.match(content.innerHTML, /No previous work was found for this subject and period/);
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
    window: { EDUGNAY_API: { createAssignment: async values => { saved = values; return { id: '42', ...values }; } } },
    CURRENT_SUBJECT_ASSIGNMENT: { subjectId: 'english' },
    CURRENT_SUBJECT_ID: 'english',
    CURRENT_SECTION_ID: 'grade-7',
    CURRENT_TEACHER_ID: 'teacher-1',
    TEACHER_SECTION_SCHOOL_ID: 'school-1',
    BACKEND_GRADE_CONTEXT: { sectionId: 'grade-7', subjectId: 'english' },
    BACKEND_ASSIGNMENTS: [],
    getBackendTermId: () => 'q1',
    isBackendGradeMode: () => true,
    showAppToast() {},
    resetAssignmentForm() {}, closeModal() {}, renderAssignments() {}, renderScoreTable() {}
  };
  await vm.runInNewContext(`${addSource}; addAssignment();`, context);
  assert.equal(saved.subjectId, 'english');
});

test('delete modal allows a new component even when its subject has published grades', () => {
  const openSource = sectionsSource.match(/async function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
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

test('linked score component opens the combined assignment deletion confirmation', async () => {
  const openSource = sectionsSource.match(/async function openTeacherDeleteModal\(kind, id, name\) \{[\s\S]*?\n  \}\n\n  async function confirmTeacherDelete/)[0]
    .replace(/\n\n  async function confirmTeacherDelete$/, '');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = {
    document: { getElementById: element },
    window: { lucide: { createIcons() {} }, EDUGNAY_API: { getAssignmentSubmissions: async () => [] } },
    BACKEND_GRADING_ITEMS: [{ id: '12', name: 'Quiz', usedInPublishedGrades: false }],
    BACKEND_ASSIGNMENTS: [{ id: '4', title: 'test', gradingItemId: '12' }],
    BACKEND_STUDENT_SCORES: [{ gradingItemId: '12', score: null, remarks: null }], BACKEND_SUBMISSIONS: new Map(),
    openModal() {}
  };
  await vm.runInNewContext(`${openSource}; openTeacherDeleteModal('scoreComponent', '12', 'Quiz');`, context);
  assert.equal(element('teacherDeleteConfirmTitle').textContent, 'Delete assignment and component?');
  assert.equal(element('teacherDeleteConfirmName').textContent, 'Quiz');
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.equal(element('teacherDeleteConfirmButton').textContent, 'Delete Both');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'This will permanently remove the assignment and its linked score component.');
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '4', 'test');", context);
  assert.equal(element('teacherDeleteConfirmName').textContent, 'test');
  assert.equal(element('teacherDeleteConfirmDescription').textContent, 'This will permanently remove the assignment and its linked score component.');
  assert.match(sectionsSource, /data-delete-assignment=.*?Delete Assignment & Component/s);
  assert.match(sectionsSource, /if \(request\.kind === 'assignment'\) \{[\s\S]*?EDUGNAY_API\.deleteAssignment\(request\.id, request\.expectedSubmissionCount\)/);

  context.window.EDUGNAY_API.getAssignmentSubmissions = async () => [{ id: 1 }, { id: 2 }];
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '4', 'test');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /2 student submission records/);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /uploaded files/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);
  assert.equal(context.pendingTeacherDelete.expectedSubmissionCount, 2);

  context.BACKEND_ASSIGNMENTS = [{ id: '5', title: 'Ungraded task' }];
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '5', 'Ungraded task');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /2 student submission records/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, false);

  context.window.EDUGNAY_API.getAssignmentSubmissions = async () => { throw new Error('Offline'); };
  context.showAppToast = () => {};
  await vm.runInNewContext("openTeacherDeleteModal('assignment', '5', 'Ungraded task');", context);
  assert.match(element('teacherDeleteConfirmDescription').textContent, /Could not check current submissions/);
  assert.equal(element('teacherDeleteConfirmButton').disabled, true);
});

test('a changed submission count reopens the delete warning', async () => {
  const confirmSource = sectionsSource.match(/async function confirmTeacherDelete\(\) \{[\s\S]*?\n  \}\n\n  document\.getElementById\('teacherDeleteConfirmButton'\)/)[0]
    .replace(/\n\n  document\.getElementById\('teacherDeleteConfirmButton'\)$/, '');
  const button = { disabled: false, textContent: 'Delete Assignment' };
  const refreshed = [];
  const context = {
    pendingTeacherDelete: { kind: 'assignment', id: '4', gradingItemId: null, expectedSubmissionCount: 2 },
    teacherDeletePending: false,
    document: { getElementById: id => id === 'teacherDeleteConfirmButton' ? button : { textContent: 'Wrong task' } },
    window: { EDUGNAY_API: { async deleteAssignment(id, count) {
      assert.equal(id, '4');
      assert.equal(count, 2);
      throw { status: 409, message: 'Submissions changed. Review the updated count and confirm deletion again.' };
    } } },
    showAppToast() {},
    openTeacherDeleteModal: (...args) => refreshed.push(args)
  };
  await vm.runInNewContext(`${confirmSource}; confirmTeacherDelete();`, context);
  assert.deepEqual(refreshed, [['assignment', '4', 'Wrong task']]);
  assert.equal(context.teacherDeletePending, false);
});

test('modified teacher page scripts still parse', () => {
  for (const html of [dashboardSource, sectionsSource]) {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(Boolean);
    scripts.forEach(source => new vm.Script(source));
  }
});
