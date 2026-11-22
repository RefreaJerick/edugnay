const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => pageFs.readFileSync(path.join(root, file), 'utf8');

test('other-person avatar markup escapes names and preserves the person identity', () => {
  const source = read('assets/js/shell-common.js');
  const start = source.indexOf('function avatarHtml(');
  const end = source.indexOf('function hydrateAvatars(', start);
  assert.ok(start >= 0 && end > start);
  const avatarHtml = vm.runInNewContext(`${source.slice(start, end)}; avatarHtml`);
  const html = avatarHtml({ id: 42, displayName: 'Ada "<script>"', initials: 'AT',
    avatarUrl: '/api/users/42/avatar?v=2', role: 'student' }, { className: 'student-av', size: 'sm' });
  assert.match(html, /person-avatar--sm/);
  assert.match(html, /data-person-avatar=/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /api\/users\/42\/avatar/);
});

test('new person avatars hydrate with their own photo and size', () => {
  const source = read('assets/js/shell-common.js');
  const start = source.indexOf('function hydrateAvatars(');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
  const rendered = [];
  const hydrate = vm.runInNewContext(`${source.slice(start, end)}; hydrateAvatars`, {
    renderAvatar: (element, person, options) => rendered.push({ person, options })
  });
  const attributes = new Set();
  const element = {
    matches: () => true,
    querySelectorAll: () => [],
    hasAttribute: name => attributes.has(name),
    setAttribute: name => attributes.add(name),
    removeAttribute: name => attributes.delete(name),
    dataset: { personAvatar: JSON.stringify({ id: 42, name: 'Ada', avatarUrl: '/api/users/42/avatar?v=2' }) },
    classList: { contains: name => name === 'person-avatar--sm' }
  };
  hydrate(element);
  hydrate(element);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].person.avatarUrl, '/api/users/42/avatar?v=2');
  assert.equal(rendered[0].options.size, 'sm');
});

test('teacher journal review uses each student photo and student fallback through navigation and review refresh', async () => {
  const source = read('assets/js/teacher/journals.js').replace(/\r\n/g, '\n');
  const renderStart = source.indexOf('function populateModal(s, preserveAssessment = false) {');
  const renderEnd = source.indexOf('\n}\n\n/*', renderStart) + 2;
  const navigateStart = source.indexOf('function navigateEntry(dir) {');
  const navigateEnd = source.indexOf('\n}\n\n/*', navigateStart) + 2;
  const reviewStart = source.indexOf('async function markReviewed() {');
  const reviewEnd = source.indexOf('\n}\n\n/*', reviewStart) + 2;
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.ok(navigateStart >= 0 && navigateEnd > navigateStart);
  assert.ok(reviewStart >= 0 && reviewEnd > reviewStart);

  const photoStudent = { id: '101', displayName: 'Alyssa Lim', initials: 'AL', avatarUrl: '/api/users/101/avatar?v=3' };
  const fallbackStudent = { id: '102', displayName: 'Ethan Lim', initials: 'EL', avatarUrl: null };
  const entries = [
    { studentId: '101', submitted: true, reviewed: false, score: 12, maxScore: 50, entryId: 'entry-101', entryText: 'Entry A' },
    { studentId: '102', submitted: true, reviewed: false, score: 14, maxScore: 50, entryId: 'entry-102', entryText: 'Entry B' }
  ];
  const elements = Object.fromEntries([
    'modal-avatar', 'modal-student-name', 'modal-meta', 'modal-prompt', 'modal-score-input',
    'markReviewedBtn', 'journal-ai-panel', 'journal-ai-assess', 'modal-status-note', 'journal-mobile-status-note',
    'modal-nav-label', 'prevBtn', 'nextBtn'
  ].map(id => [id, {}]));
  elements['modal-entry-body'] = { classList: { add() {}, remove() {} } };
  elements['modal-score-input'].style = {};
  elements['modal-score-input'].value = '';
  elements['journal-ai-panel'].hidden = false;
  const avatarCalls = [];
  const assessmentLoads = [];
  const refreshedEntry = { id: 'entry-102', studentId: '102', sectionId: 'section', score: 20, reviewed: true };
  const reviewedEntryIds = [];
  let pendingReview = null;
  let returnSavedEntry = true;
  let failEntryFetch = false;
  let entryFetches = 0;
  let summaryRenders = 0;
  let tableRenders = 0;
  const toasts = [];
  elements.journalModal = { classList: { remove() {} }, setAttribute() {} };
  let context;
  context = vm.createContext({
    SECTIONS: { section: { id: 'section', label: 'Grade 7 · St. John', prompt: { promptText: 'Weekly prompt' }, entries: [], students: entries } },
    STUDENT_BY_ID: { '101': photoStudent, '102': fallbackStudent },
    currentSection: 'section', currentPromptId: 'prompt-1', activeStudentIds: ['101', '102'], activeStudentIndex: 0,
    journalAiRubric: { enabled: true }, assessmentRequestId: 0, activeModalEntryId: null,
    window: { EDUGNAY_AVATAR: { render(element, person, options) { avatarCalls.push({ element, person, options }); } }, EDUGNAY_API: {
      async reviewJournalEntry(id) { reviewedEntryIds.push(id); return pendingReview || (returnSavedEntry ? refreshedEntry : null); },
      async getJournalEntries() { entryFetches++; if (failEntryFetch) throw new Error('Refresh failed'); return [refreshedEntry]; }
    } },
    document: { getElementById: id => elements[id], querySelector: selector => selector === '.score-max-label' ? { textContent: '' } : null },
    renderAssessment() {}, loadJournalAssessment: id => assessmentLoads.push(id),
    renderJournalSummary() { summaryRenders++; },
    renderTable() { tableRenders++; vm.runInContext("activeStudentIds = ['101']", context); },
    loadTeacherJournals() { throw new Error('Full-page reload should not run'); },
    showAppToast(message) { toasts.push(message); },
    lucide: { createIcons() {} }, parseFloat
  });

  const populateModal = vm.runInContext(`${source.slice(renderStart, renderEnd)}; populateModal`, context);
  const navigateEntry = vm.runInContext(`${source.slice(navigateStart, navigateEnd)}; navigateEntry`, context);
  const markReviewed = vm.runInContext(`${source.slice(reviewStart, reviewEnd)}; markReviewed`, context);
  const closeStart = source.indexOf('function closeModal(id) {');
  const closeEnd = source.indexOf('\n}\n\ndocument.querySelectorAll', closeStart) + 2;
  const closeModal = vm.runInContext(`${source.slice(closeStart, closeEnd)}; closeModal`, context);
  populateModal(entries[0]);
  assert.match(elements['journal-mobile-status-note'].innerHTML, /Not yet reviewed/);
  navigateEntry(1);
  elements['modal-score-input'].value = '20';
  const requestIdBeforeReview = vm.runInContext('assessmentRequestId', context);
  await markReviewed();
  assert.deepEqual(assessmentLoads, ['entry-101', 'entry-102']);
  assert.equal(vm.runInContext('assessmentRequestId', context), requestIdBeforeReview);
  assert.equal(elements['modal-nav-label'].textContent, '2 / 2');
  assert.equal(elements['modal-score-input'].value, 20);
  assert.equal(elements['journal-mobile-status-note'].innerHTML, elements['modal-status-note'].innerHTML);
  assert.equal(entryFetches, 0);
  assert.equal(summaryRenders, 1);
  assert.equal(tableRenders, 1);
  populateModal(entries[1]);
  assert.match(elements['journal-mobile-status-note'].className, /is-reviewed/);
  assert.match(elements['journal-mobile-status-note'].innerHTML, /Reviewed/);

  assert.equal(avatarCalls.length, 4);
  assert.equal(avatarCalls[0].person.avatarUrl, '/api/users/101/avatar?v=3');
  assert.equal(avatarCalls[0].person.initials, 'AL');
  assert.equal(avatarCalls[1].person.avatarUrl, null);
  assert.equal(avatarCalls[1].person.initials, 'EL');
  assert.equal(avatarCalls[2].person.avatarUrl, null);
  for (const call of avatarCalls) {
    assert.equal(call.options.role, 'student');
    assert.equal(call.options.size, 'lg');
    assert.equal(call.element, elements['modal-avatar']);
  }

  returnSavedEntry = false;
  await markReviewed();
  assert.equal(entryFetches, 1);
  assert.equal(summaryRenders, 2);
  assert.equal(tableRenders, 2);

  failEntryFetch = true;
  await markReviewed();
  assert.equal(entryFetches, 2);
  assert.equal(summaryRenders, 2);
  assert.equal(tableRenders, 2);
  assert.match(toasts.at(-1), /Review saved, but the page could not refresh/);

  failEntryFetch = false;
  returnSavedEntry = true;
  vm.runInContext("activeStudentIds = ['101', '102']; activeStudentIndex = 0", context);
  populateModal(entries[0]);
  elements['modal-score-input'].value = '12';
  let resolveReview;
  pendingReview = new Promise(resolve => { resolveReview = resolve; });
  const saveFirstStudent = markReviewed();
  closeModal('journalModal');
  assert.equal(vm.runInContext('activeModalEntryId', context), null);
  vm.runInContext('activeStudentIndex = 1', context);
  populateModal(entries[1]);
  pendingReview = null;
  resolveReview({ id: 'entry-101', studentId: '101', sectionId: 'section', score: 12, reviewed: true });
  await saveFirstStudent;
  assert.equal(elements['modal-student-name'].textContent, 'Ethan Lim');
  assert.equal(elements['modal-nav-label'].textContent, '2 / 2');
  assert.equal(vm.runInContext('activeStudentIds[activeStudentIndex]', context), '102');
  await markReviewed();
  assert.deepEqual(reviewedEntryIds.slice(-2), ['entry-101', 'entry-102']);

  pendingReview = new Promise(resolve => { resolveReview = resolve; });
  const saveBeforeClosing = markReviewed();
  closeModal('journalModal');
  const avatarCountBeforeCompletion = avatarCalls.length;
  pendingReview = null;
  resolveReview(refreshedEntry);
  await saveBeforeClosing;
  assert.equal(avatarCalls.length, avatarCountBeforeCompletion);
  assert.equal(vm.runInContext('activeModalEntryId', context), null);
});

test('profile avatars stay circular and request private photos with the signed-in session', () => {
  const profileCss = read('assets/css/profile-common.css');
  const profileRule = profileCss.match(/\.profile-avatar-wrap \.profile-avatar\.person-avatar\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(profileRule, /min-width:\s*88px/);
  assert.match(profileRule, /aspect-ratio:\s*1/);
  assert.match(profileRule, /border-radius:\s*50%/);
  assert.match(profileCss, /min-width:\s*72px/);
  assert.match(read('assets/js/shell-common.js'), /image\.crossOrigin\s*=\s*'use-credentials'/);
});

test('all audited other-person surfaces use the shared renderer', () => {
  const pages = [
    'views/admin/edugnay-admin-users.html',
    'views/admin/edugnay-admin-management.html',
    'assets/js/admin/student-multi-select.js',
    'views/teacher/edugnay-teacher-sections.html',
    'views/teacher/edugnay-teacher-journals.html',
    'views/student/edugnay-student-profile.html',
    'views/parent/edugnay-parent-dashboard.html',
    'views/parent/edugnay-parent-attendance.html',
    'views/parent/edugnay-parent-grades.html',
    'views/parent/edugnay-parent-profile.html'
  ];
  for (const page of pages) assert.match(read(page), /EDUGNAY_AVATAR\.(html|render)\(/, page);
  const sections = read('views/teacher/edugnay-teacher-sections.html');
  assert.doesNotMatch(sections, /student-av av-|qr-attendance-avatar">\$\{/);
  for (const css of ['assets/css/parent/child-switcher.css', 'assets/css/parent/dashboard.css',
    'assets/css/parent/attendance.css', 'assets/css/parent/reports.css']) {
    assert.doesNotMatch(read(css), /nth-child\([^)]*\) \.child-avatar/, css);
  }
});

test('narrative report pages do not show demo people', () => {
  const teacherReports = read('views/teacher/edugnay-teacher-reports.html');
  const parentReports = read('views/parent/edugnay-parent-reports.html');
  assert.match(teacherReports, /generation-state/);
  assert.match(parentReports, /parentReportChildSwitcher/);
  assert.match(parentReports, /parent-report-list/);
  assert.doesNotMatch(teacherReports, /reportStudentPerson|generateReports/);
  assert.doesNotMatch(parentReports, /reportTeacherPerson|getReportsForStudent/);
  assert.match(read('assets/css/styles.css'), /\.person-avatar--compact\s*\{\s*--avatar-size:\s*43px;/);
});
