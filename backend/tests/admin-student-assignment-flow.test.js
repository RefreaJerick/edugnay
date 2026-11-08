const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');

test('Class Management keeps manual student assignment and removes CSV auto-sort', () => {
  assert.match(html, /data-page-click="p327607e8aaf5"[\s\S]*?Assign Student/);
  assert.doesNotMatch(html, /Import Students|Import and Auto-Sort Students|importStudentsForm|csvFileInput|csvPreview/);
  assert.doesNotMatch(management, /openImportStudentsModal|previewCSV|createImportedStudentAccount|auto-sorted into/);
});

function sourceBetween(startMarker, endMarker) {
  const start = management.indexOf(startMarker);
  const end = management.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return management.slice(start, end).trim();
}

const closeModalSource = sourceBetween('function closeStudentAssignModal() {', '\n\nfunction openMoveStudentModal(');
const escapeHandlerSource = sourceBetween("document.addEventListener('keydown', e => {", '\n\n/*');
const submitHandlerSource = sourceBetween(
  "document.getElementById('assignStudentForm').addEventListener('submit', async function (event) {",
  '\n\nlet pendingMovePreview'
);

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) { tokens.forEach(token => values.add(token)); },
    remove(...tokens) { tokens.forEach(token => values.delete(token)); },
    contains(token) { return values.has(token); }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function createHarness({ enrollStudentsBulk, refreshManagementViews = async () => {} }) {
  const listeners = {};
  const backdrop = {
    classList: createClassList(['open', 'is-assigning']),
    addEventListener(name, callback) { listeners[`backdrop:${name}`] = callback; }
  };
  const submitButton = { disabled: false, textContent: 'Save Assignment' };
  const form = { addEventListener(name, callback) { listeners[`form:${name}`] = callback; } };
  const sectionSelect = { value: '8' };
  const targets = {
    studentAssignModalBackdrop: backdrop,
    studentModalSubmitBtn: submitButton,
    assignStudentForm: form,
    studentSectionSelect: sectionSelect
  };
  const toasts = [];
  const pickerStates = [];
  const section = { id: '8', level: 'jhs', grade: 'Grade 8', trackId: '', strandId: '', needsCurriculumSetup: false };
  let selectedStudentIds = ['15'];
  let apiCalls = 0;
  let refreshCalls = 0;
  let refreshSawModalOpen = false;
  let resolveRefreshStarted;
  const refreshStarted = new Promise(resolve => { resolveRefreshStarted = resolve; });

  const context = vm.createContext({
    document: {
      getElementById(id) { return targets[id] || null; },
      addEventListener(name, callback) { listeners[`document:${name}`] = callback; }
    },
    listeners,
    window: { EDUGNAY_API: { enrollStudentsBulk(...args) { apiCalls += 1; return enrollStudentsBulk(...args); } } },
    managementStudentPicker: {
      getSelectedIds() { return selectedStudentIds; },
      setDisabled(disabled) { pickerStates.push(disabled); }
    },
    managementAssignState: { level: 'jhs', grade: 'Grade 8', track: '', strand: '' },
    managementSectionById: id => String(id) === section.id ? section : null,
    managementTrackOptions: () => [],
    managementStrandRequired: () => false,
    managementGradeKey: value => String(value).toLowerCase(),
    showAppToast: (message, tone = 'success') => toasts.push({ message, tone }),
    refreshManagementViews: async () => {
      refreshCalls += 1;
      refreshSawModalOpen = backdrop.classList.contains('open');
      resolveRefreshStarted();
      return refreshManagementViews();
    },
    closeSectionMenus() {},
    closeSectionAddModal() {},
    closeSectionEditModal() {},
    closeSectionStudentsModal() {},
    closeSubjectModal() {},
    closeTeacherModal() {},
    closeDepedSubjectReview() {},
    closeConfirmRemoveModal() {}
  });

  vm.runInContext(`
    let studentAssignmentPending = false;
    ${closeModalSource}
    ${escapeHandlerSource}
    ${submitHandlerSource}
    globalThis.assignmentFlow = {
      isPending: () => studentAssignmentPending,
      close: closeStudentAssignModal,
      submit: listeners['form:submit'],
      escape: listeners['document:keydown'],
      backdropClick: listeners['backdrop:click']
    };
  `, context);

  return {
    context,
    targets,
    toasts,
    pickerStates,
    backdrop,
    get apiCalls() { return apiCalls; },
    get refreshCalls() { return refreshCalls; },
    get refreshSawModalOpen() { return refreshSawModalOpen; },
    refreshStarted,
    setSelectedStudentIds(ids) { selectedStudentIds = ids; }
  };
}

function submitEvent(button) {
  return { submitter: button, prevented: false, preventDefault() { this.prevented = true; } };
}

test('assignment keeps the modal open, shows Assigning, blocks dismissal, and ignores duplicate submits while pending', async () => {
  const response = deferred();
  const refreshResponse = deferred();
  const harness = createHarness({
    enrollStudentsBulk: () => response.promise,
    refreshManagementViews: () => refreshResponse.promise
  });
  const event = submitEvent(harness.targets.studentModalSubmitBtn);
  const submission = harness.context.assignmentFlow.submit(event);

  assert.equal(event.prevented, true);
  assert.equal(harness.apiCalls, 1);
  assert.equal(harness.context.assignmentFlow.isPending(), true);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.targets.studentModalSubmitBtn.disabled, true);
  assert.equal(harness.targets.studentModalSubmitBtn.textContent, 'Assigning…');
  assert.deepEqual(harness.pickerStates, [true]);

  harness.context.assignmentFlow.close();
  harness.context.assignmentFlow.backdropClick.call(harness.backdrop, { target: harness.backdrop });
  harness.context.assignmentFlow.escape({ key: 'Escape' });
  assert.equal(harness.backdrop.classList.contains('open'), true);

  await harness.context.assignmentFlow.submit(submitEvent(harness.targets.studentModalSubmitBtn));
  assert.equal(harness.apiCalls, 1, 'a repeated submit does not start another assignment');

  response.resolve();
  await harness.refreshStarted;
  assert.equal(harness.backdrop.classList.contains('open'), true, 'the modal stays open during the list refresh');
  assert.equal(harness.context.assignmentFlow.isPending(), true);
  assert.equal(harness.targets.studentModalSubmitBtn.disabled, true);
  assert.equal(harness.targets.studentModalSubmitBtn.textContent, 'Assigning…');
  assert.deepEqual(harness.pickerStates, [true]);
  assert.equal(harness.refreshSawModalOpen, true);
  assert.equal(harness.toasts.length, 0, 'the success toast waits until the refreshed list is ready');

  harness.context.assignmentFlow.close();
  harness.context.assignmentFlow.backdropClick.call(harness.backdrop, { target: harness.backdrop });
  harness.context.assignmentFlow.escape({ key: 'Escape' });
  assert.equal(harness.backdrop.classList.contains('open'), true);

  refreshResponse.resolve();
  await submission;
  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.equal(harness.context.assignmentFlow.isPending(), false);
  assert.equal(harness.refreshCalls, 1);
  assert.equal(harness.refreshSawModalOpen, true);
  assert.equal(harness.targets.studentModalSubmitBtn.disabled, false);
  assert.equal(harness.targets.studentModalSubmitBtn.textContent, 'Save Assignment');
  assert.deepEqual(harness.pickerStates, [true, false]);
  assert.match(harness.toasts.at(-1).message, /1 student assigned to section/);
});

test('failed assignment keeps the modal open and restores the button, picker, and dismiss actions', async () => {
  const harness = createHarness({ enrollStudentsBulk: async () => { throw new Error('Assignment failed'); } });

  await harness.context.assignmentFlow.submit(submitEvent(harness.targets.studentModalSubmitBtn));

  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.context.assignmentFlow.isPending(), false);
  assert.equal(harness.targets.studentModalSubmitBtn.disabled, false);
  assert.equal(harness.targets.studentModalSubmitBtn.textContent, 'Save Assignment');
  assert.deepEqual(harness.pickerStates, [true, false]);
  assert.deepEqual(harness.toasts.at(-1), { message: 'Assignment failed', tone: 'error' });

  harness.context.assignmentFlow.close();
  assert.equal(harness.backdrop.classList.contains('open'), false);
});

test('invalid assignment does not enter the pending state or send a request', async () => {
  const harness = createHarness({ enrollStudentsBulk: async () => {} });
  harness.setSelectedStudentIds([]);

  await harness.context.assignmentFlow.submit(submitEvent(harness.targets.studentModalSubmitBtn));

  assert.equal(harness.apiCalls, 0);
  assert.equal(harness.context.assignmentFlow.isPending(), false);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.targets.studentModalSubmitBtn.disabled, false);
  assert.equal(harness.targets.studentModalSubmitBtn.textContent, 'Save Assignment');
  assert.deepEqual(harness.pickerStates, []);
});

test('successful assignment stays closed and reports a refresh problem if the view refresh fails', async () => {
  const harness = createHarness({
    enrollStudentsBulk: async () => {},
    refreshManagementViews: async () => { throw new Error('Refresh failed'); }
  });

  await harness.context.assignmentFlow.submit(submitEvent(harness.targets.studentModalSubmitBtn));

  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.equal(harness.apiCalls, 1);
  assert.equal(harness.refreshCalls, 1);
  assert.equal(harness.refreshSawModalOpen, true);
  assert.deepEqual(harness.toasts.at(-1), {
    message: 'Student assignment saved, but the list could not refresh. Reload the page to verify it.',
    tone: 'info'
  });
});

test('Cancel, close, and backdrop controls use the assignment modal close guard', () => {
  assert.equal((html.match(/data-page-click="p1a0385c98765"/g) || []).length, 2);
  assert.match(management, /p1a0385c98765: function\(event\) \{ closeStudentAssignModal\(\) \}/);
  assert.match(management, /studentAssignModalBackdrop'\)\.addEventListener\('click',[\s\S]*?closeStudentAssignModal\(\)/);
  assert.match(management, /closeStudentAssignModal\(\); closeConfirmRemoveModal\(\)/);
});

