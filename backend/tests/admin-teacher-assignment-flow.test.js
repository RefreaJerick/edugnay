const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = management.indexOf(startMarker);
  const end = management.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return management.slice(start, end).trim();
}

const teacherModalSource = sourceBetween('function openTeacherModal(context) {', '\nfunction previewTeacher(');
const escapeHandlerSource = sourceBetween("document.addEventListener('keydown', e => {", '\n\n/*');
const submitHandlerSource = sourceBetween(
  "document.getElementById('assignTeacherForm').addEventListener('submit', async event => {",
  '\n\nfunction filterTeacherBlocks('
);

function classList(initial = []) {
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

function createHarness({ assignTeacher = async () => {}, updateTeacherAssignment = async () => {}, refreshManagementViews = async () => {}, currentAssignments = [] } = {}) {
  const listeners = {};
  const backdrop = {
    classList: classList(),
    addEventListener(name, callback) { listeners[`backdrop:${name}`] = callback; }
  };
  const targets = {
    teacherModalBackdrop: backdrop,
    teacherPreview: { classList: classList() },
    teacherCtxVal: { textContent: '' },
    teacherAssignmentSectionId: { value: '' },
    teacherAssignmentSubjectId: { value: '' },
    teacherAssignmentCommunicationComponentCode: { value: '' },
    teacherSelect: { value: '', disabled: false },
    teacherAssignmentSubmit: { disabled: false, textContent: 'Save Assignment' },
    assignTeacherForm: { addEventListener(name, callback) { listeners[`form:${name}`] = callback; } }
  };
  const section = { id: '8', teacherAssignments: currentAssignments };
  const toasts = [];
  const alerts = [];
  const selectStates = [];
  const apiCalls = [];
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
    window: {
      EDUGNAY_API: {
        assignTeacher(...args) { apiCalls.push({ method: 'assignTeacher', args }); return assignTeacher(...args); },
        updateTeacherAssignment(...args) { apiCalls.push({ method: 'updateTeacherAssignment', args }); return updateTeacherAssignment(...args); }
      },
      syncSearchableSelect(select) { selectStates.push(select.disabled); }
    },
    renderTeacherOptions() {},
    managementSectionById(id) { return String(id) === section.id ? section : null; },
    refreshManagementViews: async () => {
      refreshCalls += 1;
      refreshSawModalOpen = backdrop.classList.contains('open');
      resolveRefreshStarted();
      return refreshManagementViews();
    },
    showAppToast: (message, tone = 'success') => toasts.push({ message, tone }),
    alert: message => alerts.push(message),
    closeSectionMenus() {},
    closeSectionAddModal() {},
    closeSectionEditModal() {},
    closeSectionStudentsModal() {},
    closeSubjectModal() {},
    closeDepedSubjectReview() {},
    closeStudentAssignModal() {},
    closeConfirmRemoveModal() {}
  });

  vm.runInContext(`
    let teacherAssignmentPending = false;
    let teacherTargetSection = '8';
    let teacherTargetSubjectId = '22';
    let teacherTargetCommunicationComponentCode = null;
    ${teacherModalSource}
    ${escapeHandlerSource}
    ${submitHandlerSource}
    globalThis.flow = {
      isPending: () => teacherAssignmentPending,
      open: openTeacherModal,
      close: closeTeacherModal,
      submit: listeners['form:submit'],
      escape: listeners['document:keydown'],
      backdropClick: listeners['backdrop:click']
    };
  `, context);

  return {
    context,
    targets,
    backdrop,
    toasts,
    alerts,
    selectStates,
    apiCalls,
    get refreshCalls() { return refreshCalls; },
    get refreshSawModalOpen() { return refreshSawModalOpen; },
    refreshStarted
  };
}

function submitEvent(button) {
  return { submitter: button, prevented: false, preventDefault() { this.prevented = true; } };
}

test('teacher assignment stays open and shows progress until the list refresh finishes', async () => {
  const response = deferred();
  const refreshResponse = deferred();
  const harness = createHarness({
    assignTeacher: () => response.promise,
    refreshManagementViews: () => refreshResponse.promise
  });
  harness.context.flow.open('Grade 8 · Section A · English');
  harness.targets.teacherSelect.value = '56';
  const event = submitEvent(harness.targets.teacherAssignmentSubmit);
  const submission = harness.context.flow.submit(event);

  assert.equal(event.prevented, true);
  assert.equal(harness.apiCalls.length, 1);
  assert.equal(harness.apiCalls[0].method, 'assignTeacher');
  assert.equal(harness.context.flow.isPending(), true);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.targets.teacherAssignmentSubmit.disabled, true);
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Assigning…');
  assert.equal(harness.targets.teacherSelect.disabled, true);
  assert.equal(harness.selectStates.at(-1), true, 'the searchable picker mirrors the disabled select');

  harness.context.flow.close();
  harness.context.flow.backdropClick.call(harness.backdrop, { target: harness.backdrop });
  harness.context.flow.escape({ key: 'Escape' });
  await harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));
  assert.equal(harness.apiCalls.length, 1, 'a repeated submit does not send another assignment');
  assert.equal(harness.backdrop.classList.contains('open'), true);

  response.resolve();
  await harness.refreshStarted;
  assert.equal(harness.refreshSawModalOpen, true);
  assert.equal(harness.backdrop.classList.contains('open'), true, 'the modal stays open during refresh');
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Assigning…');
  assert.equal(harness.toasts.length, 0, 'success feedback waits for the refreshed list');
  harness.context.flow.close();
  harness.context.flow.escape({ key: 'Escape' });
  assert.equal(harness.backdrop.classList.contains('open'), true);

  refreshResponse.resolve();
  await submission;
  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.equal(harness.context.flow.isPending(), false);
  assert.equal(harness.refreshCalls, 1);
  assert.equal(harness.targets.teacherAssignmentSubmit.disabled, false);
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Save Assignment');
  assert.equal(harness.targets.teacherSelect.disabled, false);
  assert.equal(harness.selectStates.at(-1), false);
  assert.deepEqual(harness.toasts.at(-1), { message: 'Teacher assignment saved.', tone: 'success' });
});

test('changing a teacher uses the existing update endpoint', async () => {
  const updateCalls = [];
  const harness = createHarness({
    currentAssignments: [{ assignmentId: '91', subjectId: '22', communicationComponentCode: null, teacherId: '55' }],
    updateTeacherAssignment: async (...args) => updateCalls.push(args)
  });
  harness.context.flow.open();
  harness.targets.teacherSelect.value = '56';

  await harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));

  assert.deepEqual(updateCalls, [['8', '91', '56']]);
  assert.equal(harness.apiCalls[0].method, 'updateTeacherAssignment');
  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.deepEqual(harness.toasts.at(-1), { message: 'Teacher assignment saved.', tone: 'success' });
});

test('failed teacher assignment keeps the modal open and restores controls', async () => {
  const harness = createHarness({ assignTeacher: async () => { throw new Error('Assignment failed'); } });
  harness.context.flow.open();
  harness.targets.teacherSelect.value = '56';

  await harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));

  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.context.flow.isPending(), false);
  assert.equal(harness.targets.teacherAssignmentSubmit.disabled, false);
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Save Assignment');
  assert.equal(harness.targets.teacherSelect.disabled, false);
  assert.deepEqual(harness.toasts.at(-1), { message: 'Assignment failed', tone: 'error' });
  harness.context.flow.close();
  assert.equal(harness.backdrop.classList.contains('open'), false, 'dismissal works again after failure');
});

test('saved teacher assignment closes after a failed refresh and shows an information message', async () => {
  const harness = createHarness({ refreshManagementViews: async () => { throw new Error('Refresh failed'); } });
  harness.context.flow.open();
  harness.targets.teacherSelect.value = '56';

  await harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));

  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.deepEqual(harness.toasts.at(-1), {
    message: 'Teacher assignment saved, but the list could not refresh. Reload the page to verify it.',
    tone: 'info'
  });
});

test('invalid teacher assignment does not enter the pending state', async () => {
  const harness = createHarness();
  harness.context.flow.open();

  await harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));

  assert.equal(harness.apiCalls.length, 0);
  assert.equal(harness.refreshCalls, 0);
  assert.equal(harness.context.flow.isPending(), false);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.targets.teacherAssignmentSubmit.disabled, false);
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Save Assignment');
  assert.equal(harness.targets.teacherSelect.disabled, false);
  assert.equal(harness.alerts.length, 1);
});

test('selecting the already-assigned teacher waits for refresh without sending a change request', async () => {
  const refreshResponse = deferred();
  const harness = createHarness({
    currentAssignments: [{ assignmentId: '91', subjectId: '22', communicationComponentCode: null, teacherId: '55' }],
    refreshManagementViews: () => refreshResponse.promise
  });
  harness.context.flow.open();
  harness.targets.teacherSelect.value = '55';
  const submission = harness.context.flow.submit(submitEvent(harness.targets.teacherAssignmentSubmit));
  await harness.refreshStarted;

  assert.equal(harness.apiCalls.length, 0);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.equal(harness.targets.teacherAssignmentSubmit.textContent, 'Assigning…');
  assert.equal(harness.targets.teacherSelect.disabled, true);

  refreshResponse.resolve();
  await submission;
  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.equal(harness.toasts.length, 0);
});

test('Cancel and close controls use the guarded teacher-modal close action', () => {
  assert.equal((html.match(/data-page-click="p3f50fc860b08"/g) || []).length, 2);
  assert.match(html, /id="teacherAssignmentSubmit"[^>]*>Save Assignment/);
  assert.match(management, /p3f50fc860b08: function\(event\) \{ closeTeacherModal\(\) \}/);
  assert.match(teacherModalSource, /teacherModalBackdrop'\)\.addEventListener\('click',[\s\S]*?closeTeacherModal\(\)/);
  assert.match(escapeHandlerSource, /closeTeacherModal\(\)/);
});
