const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = pageFs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-assignments.html'), 'utf8');
const periodHelpers = source.match(/    function latestSelectableAssignmentPeriod\(periods\) \{[\s\S]*?    async function loadBackendAssignments\(\)/)?.[0]
  .replace(/    async function loadBackendAssignments\(\)$/, '');

test('student assignments stay within the selected school year and grading period', () => {
  assert.ok(periodHelpers);
  const context = vm.createContext({
    ASSIGNMENTS: [
      { id: 'old', academicPeriodId: '2' },
      { id: 'current', academicPeriodId: '6' },
      { id: 'elective', academicPeriodId: null, electiveClassId: '51', scopeType: 'elective' }
    ],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    terms: [
      { id: 1, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, sequenceNumber: 1, status: 'closed' },
      { id: 2, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, sequenceNumber: 2, status: 'closed' },
      { id: 5, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 1, status: 'closed' },
      { id: 6, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 2, status: 'active' },
      { id: 7, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, sequenceNumber: 2, status: 'active' }
    ]
  });

  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms);`, context);
  assert.equal(context.selectedAssignmentPeriodId, '6');
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.deepEqual(Array.from(context.ASSIGNMENT_PERIODS, term => String(term.id)), ['5', '6', '1', '2']);
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'current');
  assert.deepEqual(Array.from(vm.runInContext('getAssignmentsForCurrentView().map(item => item.id)', context)), ['current']);
  assert.equal(context.ASSIGNMENT_PERIODS.some(term => term.id === 7), false);

  vm.runInContext("selectAssignmentYear('1')", context);
  assert.equal(context.selectedAssignmentYearId, '1');
  assert.equal(context.selectedAssignmentPeriodId, '2');
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'old');
  assert.deepEqual(Array.from(vm.runInContext('getAssignmentsForCurrentView().map(item => item.id)', context)), ['old']);
  vm.runInContext("selectAssignmentPeriod('5')", context);
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.equal(context.selectedAssignmentPeriodId, '5');
  vm.runInContext("selectedAssignmentPeriodId = 'missing'; setAssignmentPeriods(terms.map(term => ({ ...term, status: 'closed' })))", context);
  assert.equal(context.selectedAssignmentPeriodId, '6');
});

test('an enrolled student sees the active period before any assignments are posted', () => {
  assert.ok(periodHelpers);
  const terms = [
    { id: 11, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, status: 'closed', sequenceNumber: 1 },
    { id: 12, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, status: 'active', sequenceNumber: 2 },
    { id: 13, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, status: 'upcoming', sequenceNumber: 3 },
    { id: 22, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, status: 'active', sequenceNumber: 2 }
  ];
  const sections = [{ academicYearId: 2, schoolLevelId: 3, status: 'active', academicYearStatus: 'active' }];
  const context = vm.createContext({
    ASSIGNMENTS: [],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    terms,
    sections
  });
  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms, sections);`, context);
  assert.deepEqual(Array.from(context.ASSIGNMENT_PERIODS, term => term.id), [11, 12, 13]);
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.equal(context.selectedAssignmentPeriodId, '12');
  vm.runInContext('setAssignmentPeriods(terms, [])', context);
  assert.equal(context.ASSIGNMENT_PERIODS.length, 0);
  assert.equal(context.selectedAssignmentPeriodId, '');
});

test('loading zero assignments still selects the enrolled section’s active period', async () => {
  const start = source.indexOf('    function latestSelectableAssignmentPeriod(periods)');
  const end = source.indexOf('    function formatDate(isoDate)', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    BACKEND_ASSIGNMENTS_ENABLED: true,
    STUDENT_ID: null,
    ASSIGNMENTS: [],
    ASSIGNMENT_HISTORY: [],
    STUDENT_SUBMISSIONS: [],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    backendAssignmentsLoading: true,
    backendAssignmentsError: '',
    console,
    window: {
      EDUGNAY_SCHOOL_READY: Promise.resolve(),
      EDUGNAY_API: {
        getCurrentUser: async () => ({ role: 'student', apiUserId: 9 }),
        getAssignments: async () => [],
        getAcademicTerms: async () => [
          { id: 12, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, status: 'active', sequenceNumber: 2 },
          { id: 22, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, status: 'active', sequenceNumber: 2 }
        ],
        getSections: async () => {
          calls.push('sections');
          return [{ academicYearId: 2, schoolLevelId: 3, status: 'active', academicYearStatus: 'active' }];
        },
        getAssignmentHistory: async () => []
      }
    }
  });
  const loaded = await vm.runInContext(`${source.slice(start, end)}; loadBackendAssignments()`, context);
  assert.equal(loaded, true);
  assert.deepEqual(calls, ['sections']);
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.equal(context.selectedAssignmentPeriodId, '12');
  assert.deepEqual(Array.from(context.ASSIGNMENT_PERIODS, term => term.id), [12]);
  assert.equal(context.backendAssignmentsError, '');
});

test('student assignment empty messages distinguish no posts from filtered results', () => {
  const start = source.indexOf('    function renderAssignments()');
  const end = source.indexOf('    function renderAssignmentHistory()', start);
  assert.ok(start >= 0 && end > start);
  const list = { innerHTML: '' };
  let inPeriod = [];
  const context = vm.createContext({
    BACKEND_ASSIGNMENTS_ENABLED: true,
    backendAssignmentsLoading: false,
    backendAssignmentsError: '',
    selectedAssignmentPeriodId: '12',
    renderAssignmentHistory() {},
    getVisibleAssignments: () => [],
    getAssignmentsInSelectedPeriod: () => inPeriod,
    document: { getElementById: () => list },
    window: { EDUGNAY_CONFIG: { renderPanelEmptyState: ({ title, text }) => `${title}: ${text}` }, lucide: null },
    lucide: { createIcons() {} }
  });
  vm.runInContext(`${source.slice(start, end)}; renderAssignments();`, context);
  assert.match(list.innerHTML, /No assignments in this grading period: No assignments have been posted for this period yet/);
  inPeriod = [{ id: '1' }];
  vm.runInContext('renderAssignments()', context);
  assert.match(list.innerHTML, /No assignments found: Try another status, subject, or search term/);
  context.selectedAssignmentPeriodId = '';
  vm.runInContext('renderAssignments()', context);
  assert.match(list.innerHTML, /No grading periods available/);
  context.backendAssignmentsError = 'Assignments could not be loaded.';
  vm.runInContext('renderAssignments()', context);
  assert.match(list.innerHTML, /Assignments unavailable: Assignments could not be loaded/);
});

test('student elective assignments also follow the selected grading period', () => {
  assert.match(source, /function getAssignmentsForCurrentView\(\)\s*\{\s*return getAssignmentsInSelectedPeriod\(\);/);
  assert.doesNotMatch(source, /getAssignmentsForCurrentView\(\)[\s\S]{0,180}ASSIGNMENTS\.filter\(isElectiveAssignment\)/);
  assert.match(source, /Elective class assignments/);
  assert.match(source, /function isElectiveAssignment\(assignment\)/);
  assert.match(source, /assignmentScope/);
  assert.match(pageFs.readFileSync(path.join(__dirname, '../../assets/css/student/assignments.css'), 'utf8'), /\.assignment-scope-heading[\s\S]*?grid-column: 1 \/ -1/);
});

test('student assignment page has a responsive controls panel and desktop period tabs', () => {
  assert.match(source, /id="assignmentYearFilter"/);
  assert.match(source, /id="assignmentPeriodTabs"/);
  assert.match(source, /class="assignment-period-tabs" id="assignmentPeriodTabs"/);
  assert.doesNotMatch(source, /class="grade-tabs assignment-period-tabs"/);
  assert.match(source, /id="assignmentPeriodFilter"/);
  assert.match(source, /id="assignmentSubjectFilter"/);
  assert.match(source, /class="assignment-results"/);
});

test('student submitted-file View opens the protected preview in a new tab', () => {
  assert.match(source, /<a class="assignment-file-text-action" id="assignmentSubmittedFileView" target="_blank" rel="noopener">View<\/a>/);
  assert.match(source, /<a class="assignment-file-text-action" id="assignmentSubmittedFileDownload">Download<\/a>/);
  assert.match(source, /<label class="assignment-dropzone" id="assignmentDropzone" for="assignmentSubmissionFile">[\s\S]*?<input type="file" id="assignmentSubmissionFile"/);
  assert.doesNotMatch(source, /id="assignmentOwnPreviewModal"/);
  assert.match(source, /class="assignment-score-row" id="assignmentScoreRow" hidden>[\s\S]*?class="assignment-detail-label">SCORE/);
  assert.ok(source.indexOf('id="assignmentScoreRow"') < source.indexOf('id="assignmentSubmittedFile"'));
  assert.ok(source.indexOf('id="assignmentSubmissionForm"') < source.indexOf('id="assignmentReplacementNotice"'));

  const modalHelpers = source.match(/    function replacementLimitReached\(assignment, submission\) \{[\s\S]*?    function closeAssignmentSubmissionModal\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(modalHelpers);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, href: '', textContent: '', value: '', style: {},
      removeAttribute() {},
      classList: { add() {}, remove() {}, toggle() {} }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    ASSIGNMENTS: [{ id: '7', title: 'Homework', subject: 'Math', teacher: 'Teacher',
      onlineSubmissionEnabled: true, maxResubmissions: 1, electiveClassId: null,
      gradingItemId: '11', maxScore: 20, studentScore: 0 }],
    ASSIGNMENT_HISTORY: [
      { id: '8', title: 'Old homework', sectionName: 'St. John', academicTermName: 'Term 1',
        subjectName: 'Math', teacherName: 'Teacher', submissionStatus: 'submitted', fileAvailable: true,
        onlineSubmissionEnabled: true, gradingItemId: '14', maxScore: 25, studentScore: 5 },
      { id: '9', title: 'Old classroom task', sectionName: 'St. John', academicTermName: 'Term 1',
        subjectName: 'Math', teacherName: 'Teacher', submissionStatus: 'submitted', fileAvailable: false,
        onlineSubmissionEnabled: false, gradingItemId: '15', maxScore: 10, studentScore: 6 }
    ],
    STUDENT_SUBMISSIONS: [{ id: '12', assignmentId: '7', fileName: 'work.docx', fileUrl: '/download/12', resubmissionCount: 1 }],
    STATUS_META: { submitted: { label: 'Submitted' }, pending: { label: 'Pending' } },
    activeSubmissionAssignmentId: null,
    selectedAssignmentFile: null,
    document: { getElementById: element },
    window: { EDUGNAY_API: {
      getHistoricalSubmissionUrl: assignmentId => `/api/assignments/history/${assignmentId}/download`,
      getAssignmentSubmissionPreviewUrl: (assignmentId, submissionId) => `/api/assignments/${assignmentId}/submissions/${submissionId}/preview`,
      getAssignmentSubmissionDownloadUrl: (assignmentId, submissionId) => `/api/assignments/${assignmentId}/submissions/${submissionId}/download`
    } },
    isElectiveAssignment: () => false,
    formatDate: value => value,
    lucide: { createIcons() {} }
  });
  vm.runInContext(`${modalHelpers}; openAssignmentSubmissionModal('7');`, context);
  assert.equal(element('assignmentSubmittedFileView').href, '/api/assignments/7/submissions/12/preview');
  assert.equal(element('assignmentSubmittedFileDownload').href, '/api/assignments/7/submissions/12/download');
  assert.equal(element('assignmentSubmissionModal').hidden, false);
  assert.equal(element('assignmentSubmissionForm').hidden, true);
  assert.equal(element('assignmentSubmissionSubmit').hidden, true);
  assert.equal(element('assignmentReplacementNotice').hidden, true);
  assert.equal(element('assignmentScoreRow').hidden, false);
  assert.equal(element('assignmentScoreValue').textContent, '0 / 20');

  vm.runInContext("openAssignmentHistoryDetail('8')", context);
  assert.equal(element('assignmentReplacementNotice').hidden, true);
  assert.equal(element('assignmentHistoryDownload').hidden, false);
  assert.equal(element('assignmentHistoryDownload').href, '/api/assignments/history/8/download');
  assert.equal(element('assignmentSubmissionForm').hidden, true);
  assert.equal(element('assignmentScoreValue').textContent, '5 / 25');

  vm.runInContext("openAssignmentHistoryDetail('9')", context);
  assert.equal(element('assignmentHistoryDownload').hidden, true);
  assert.equal(element('assignmentScoreRow').hidden, true);

  vm.runInContext("openAssignmentSubmissionModal('7')", context);
  assert.equal(element('assignmentReplacementNotice').hidden, true);
  assert.equal(element('assignmentHistoryDownload').hidden, true);
  context.ASSIGNMENTS[0].maxResubmissions = 2;
  vm.runInContext("openAssignmentSubmissionModal('7')", context);
  assert.equal(element('assignmentReplacementNotice').hidden, false);
  assert.match(element('assignmentReplacementNotice').textContent, /1 replacement remaining/);
  context.ASSIGNMENTS[0].studentScore = null;
  vm.runInContext("openAssignmentSubmissionModal('7')", context);
  assert.equal(element('assignmentScoreValue').textContent, 'Not graded yet');
  context.ASSIGNMENTS[0].gradingItemId = null;
  vm.runInContext("openAssignmentSubmissionModal('7')", context);
  assert.equal(element('assignmentScoreRow').hidden, true);
});

test('student assignment page inline scripts parse', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length);
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  });
});

test('student due badges use the school date and leave submitted past work unmarked', () => {
  const helper = source.match(/    function showAssignmentDueBadge\(item\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(helper);
  const badge = { hidden: true, textContent: '', classList: { toggle() {} } };
  const context = vm.createContext({ document: { getElementById: () => badge }, Date });
  vm.runInContext(helper, context);
  for (const [dueDate, status, label] of [
    ['2026-11-16', 'pending', 'Today'],
    ['2026-11-17', 'pending', 'Tomorrow'],
    ['2026-11-15', 'pending', 'Overdue']
  ]) {
    context.showAssignmentDueBadge({ dueDate, schoolCurrentDate: '2026-11-16', status });
    assert.equal(badge.textContent, label);
    assert.equal(badge.hidden, false);
  }
  context.showAssignmentDueBadge({ dueDate: '2026-11-15', schoolCurrentDate: '2026-11-16', status: 'submitted' });
  assert.equal(badge.hidden, true);
});

test('student file drop validates one supported file within the upload limit', () => {
  const helpers = source.match(/    function validateAssignmentSubmission\(\) \{[\s\S]*?(?=    async function submitStudentAssignment\(\))/)?.[0];
  assert.ok(helpers);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      disabled: true, textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }
    });
    return elements.get(id);
  };
  const context = vm.createContext({ selectedAssignmentFile: null, document: { getElementById: element } });
  vm.runInContext(helpers, context);
  const drop = files => context.handleAssignmentDrop({ preventDefault() {}, dataTransfer: { files } });
  drop([{ name: 'work.pdf', size: 100 }]);
  assert.equal(element('assignmentSubmissionSubmit').disabled, false);
  assert.equal(element('assignmentDropzoneText').textContent, 'work.pdf');
  drop([{ name: 'work.pdf', size: 11 * 1024 * 1024 }]);
  assert.equal(element('assignmentSubmissionSubmit').disabled, true);
  assert.match(element('assignmentSubmissionFileHint').textContent, /smaller than 10 MB/);
  drop([{ name: 'work.txt', size: 100 }]);
  assert.match(element('assignmentSubmissionFileHint').textContent, /supported file type/);
  drop([{ name: 'one.pdf', size: 100 }, { name: 'two.pdf', size: 100 }]);
  assert.match(element('assignmentSubmissionFileHint').textContent, /one file at a time/);
});

test('student year dropdown, mobile periods, and desktop tabs render from the same selection', () => {
  assert.ok(periodHelpers);
  const elements = new Map(['assignmentYearFilter', 'assignmentPeriodFilter', 'assignmentPeriodTabs'].map(id => [id, {
    value: '', innerHTML: '', disabled: false
  }]));
  const context = vm.createContext({
    ASSIGNMENTS: [{ academicPeriodId: '6' }, { academicPeriodId: '2' }],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    backendAssignmentsError: '',
    document: { getElementById: id => elements.get(id) },
    window: { lucide: { createIcons() {} } },
    escapeHtml: value => String(value),
    terms: [
      { id: 2, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, name: 'Semester 2', sequenceNumber: 2, status: 'closed' },
      { id: 5, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Semester 1', sequenceNumber: 1, status: 'closed' },
      { id: 6, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Semester 2', sequenceNumber: 2, status: 'active' },
      { id: 7, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, name: 'Quarter 2', sequenceNumber: 2, status: 'active' }
    ]
  });
  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms); renderPeriodFilter();`, context);
  assert.match(elements.get('assignmentYearFilter').innerHTML, /2026-2027[\s\S]*2025-2026/);
  assert.match(elements.get('assignmentPeriodFilter').innerHTML, /Semester 1[\s\S]*Semester 2/);
  assert.doesNotMatch(elements.get('assignmentPeriodFilter').innerHTML, /Quarter/);
  assert.match(elements.get('assignmentPeriodTabs').innerHTML, /data-academic-period-id="6" aria-selected="true"/);
  assert.match(elements.get('assignmentPeriodTabs').innerHTML, /Semester 1[\s\S]*Semester 2/);
  context.ASSIGNMENT_PERIODS = [];
  context.backendAssignmentsError = 'Assignments could not be loaded.';
  vm.runInContext('renderPeriodFilter()', context);
  assert.match(elements.get('assignmentYearFilter').innerHTML, /School years unavailable/);
  assert.match(elements.get('assignmentPeriodFilter').innerHTML, /Grading periods unavailable/);
});

test('student quarter controls are ordered and lock upcoming periods', () => {
  assert.ok(periodHelpers);
  const elements = new Map(['assignmentYearFilter', 'assignmentPeriodFilter', 'assignmentPeriodTabs'].map(id => [id, {
    value: '', innerHTML: '', disabled: false
  }]));
  const context = vm.createContext({
    ASSIGNMENTS: [{ academicPeriodId: '32' }],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    backendAssignmentsError: '',
    document: { getElementById: id => elements.get(id) },
    window: { lucide: { createIcons() {} } },
    escapeHtml: value => String(value),
    terms: [
      { id: 34, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 4', sequenceNumber: 4, status: 'upcoming' },
      { id: 33, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 3', sequenceNumber: 3, status: 'upcoming' },
      { id: 32, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 2', sequenceNumber: 2, status: 'active' },
      { id: 31, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 1', sequenceNumber: 1, status: 'closed' }
    ]
  });

  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms); renderPeriodFilter();`, context);
  const mobileOptions = elements.get('assignmentPeriodFilter').innerHTML;
  const tabs = elements.get('assignmentPeriodTabs').innerHTML;
  assert.match(mobileOptions, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(mobileOptions, /value="33" disabled/);
  assert.match(mobileOptions, /value="34" disabled/);
  assert.match(tabs, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(tabs, /data-lucide="lock"/);
  assert.match(tabs, /aria-disabled="true" disabled aria-selected="false" aria-label="Quarter 3, not started"/);
  assert.match(tabs, /aria-disabled="true" disabled aria-selected="false" aria-label="Quarter 4, not started"/);
  assert.equal(context.selectedAssignmentPeriodId, '32');
  vm.runInContext("selectAssignmentPeriod('33')", context);
  assert.equal(context.selectedAssignmentPeriodId, '32');
});
