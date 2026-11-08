const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');

function sourceBetween(startMarker, endMarker) {
  const start = management.indexOf(startMarker);
  const end = management.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return management.slice(start, end).trim();
}

const removalHelpers = sourceBetween('function setTeacherRemovalPendingState(', '\nasync function removeStudentFromSection(');
const closeModalSource = sourceBetween('function closeConfirmRemoveModal(', "\ndocument.getElementById('confirmRemoveModalBackdrop')");
const backdropHandlerSource = sourceBetween(
  "document.getElementById('confirmRemoveModalBackdrop').addEventListener('click',",
  "\ndocument.getElementById('assignStudentForm').addEventListener"
);
const escapeHandlerSource = sourceBetween("document.addEventListener('keydown', e => {", '\n\n/*');
const submitHandlerSource = sourceBetween(
  "document.getElementById('removeStudentForm').addEventListener('submit', async function (event) {",
  '\n\nfunction openImportStudentsModal('
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

function createHarness(assignments, removeTeacherAssignment = async () => {}) {
  const listeners = {};
  const submitButton = { disabled: false, textContent: 'Yes, Unassign' };
  const backdrop = {
    classList: classList(['open']),
    addEventListener(name, callback) { listeners[`backdrop:${name}`] = callback; }
  };
  const form = { dataset: { removeType: 'teacher', targetId: '8|22' }, addEventListener(name, callback) { listeners[`form:${name}`] = callback; } };
  const targets = {
    confirmRemoveSubmit: submitButton,
    confirmRemoveModalBackdrop: backdrop,
    confirmRemoveType: { value: 'teacher' },
    confirmRemoveTargetId: { value: '8|22' },
    removeStudentId: { value: '' },
    removeStudentForm: form,
    teacherTabPill: { textContent: '' }
  };
  const section = { id: '8', teacherAssignments: assignments.map(assignment => ({ ...assignment })) };
  const teacherSection = { sectionId: '8', subjects: section.teacherAssignments };
  const viewState = {
    removeButtons: section.teacherAssignments.map(() => ({ disabled: false, textContent: 'Remove' })),
    renderedTeachers: section.teacherAssignments.map(assignment => assignment.teacherName),
    teacherAssigned: section.teacherAssignments.length,
    subjectAssigned: section.teacherAssignments.length,
    teacherUnassigned: 3 - section.teacherAssignments.length,
    modalWasOpenWhenTeacherListRendered: false
  };
  const toasts = [];
  const apiCalls = [];
  const renderCalls = { managementPills: 0, subjects: 0, subjectFilters: 0, teachers: 0 };
  let refreshCalls = 0;

  const context = vm.createContext({
    document: {
      getElementById(id) { return targets[id] || null; },
      querySelectorAll(selector) {
        assert.equal(selector, '#panel-teachers .section-block .row-btn.remove');
        return viewState.removeButtons;
      },
      addEventListener(name, callback) { listeners[`document:${name}`] = callback; }
    },
    listeners,
    window: {
      EDUGNAY_API: {
        removeTeacherAssignment(...args) { apiCalls.push(args); return removeTeacherAssignment(...args); }
      }
    },
    SECTION_RECORDS: [section],
    TEACHER_ASSIGNMENTS_DATA: [teacherSection],
    viewState,
    renderManagementTabPills() {
      renderCalls.managementPills += 1;
      viewState.teacherUnassigned = 3 - section.teacherAssignments.length;
      targets.teacherTabPill.textContent = `${viewState.teacherUnassigned} open`;
    },
    renderSubjects() {
      renderCalls.subjects += 1;
      viewState.subjectAssigned = section.teacherAssignments.length;
    },
    filterSubjects() { renderCalls.subjectFilters += 1; },
    renderTeacherAssignments() {
      renderCalls.teachers += 1;
      viewState.modalWasOpenWhenTeacherListRendered = backdrop.classList.contains('open');
      viewState.teacherAssigned = section.teacherAssignments.length;
      viewState.renderedTeachers = section.teacherAssignments.map(assignment => assignment.teacherName);
      viewState.removeButtons = section.teacherAssignments.map(() => ({ disabled: false, textContent: 'Remove' }));
    },
    refreshManagementViews() { refreshCalls += 1; },
    showAppToast: (message, tone = 'success') => toasts.push({ message, tone }),
    closeSectionMenus() {},
    closeSectionAddModal() {},
    closeSectionEditModal() {},
    closeSectionStudentsModal() {},
    closeSubjectModal() {},
    closeTeacherModal() {},
    closeDepedSubjectReview() {},
    closeStudentAssignModal() {},
    closeImportStudentsModal() {}
  });

  vm.runInContext(`
    let pendingRemoveRequest = {
      type: 'teacher', sectionId: '8', assignmentId: '101', subjectId: '22', submitLabel: 'Yes, Unassign'
    };
    let studentRemovalPending = false;
    let teacherRemovalPending = false;
    ${removalHelpers}
    ${closeModalSource}
    ${backdropHandlerSource}
    ${escapeHandlerSource}
    ${submitHandlerSource}
    globalThis.flow = {
      submit(event) { return listeners['form:submit'].call(document.getElementById('removeStudentForm'), event); },
      close: closeConfirmRemoveModal,
      escape: listeners['document:keydown'],
      backdropClick: listeners['backdrop:click'],
      isPending: () => teacherRemovalPending,
      getData() {
        return {
          assignments: SECTION_RECORDS[0].teacherAssignments,
          teacherSubjects: TEACHER_ASSIGNMENTS_DATA[0].subjects,
          ...viewState,
          teacherPill: document.getElementById('teacherTabPill').textContent,
          modalOpen: document.getElementById('confirmRemoveModalBackdrop').classList.contains('open'),
          pendingRequest: pendingRemoveRequest
        };
      }
    };
  `, context);

  return {
    context,
    targets,
    backdrop,
    submitButton,
    form,
    toasts,
    apiCalls,
    renderCalls,
    get refreshCalls() { return refreshCalls; },
    get modalWasOpenWhenTeacherListRendered() { return viewState.modalWasOpenWhenTeacherListRendered; }
  };
}

function submitEvent(button) {
  return { submitter: button, prevented: false, preventDefault() { this.prevented = true; } };
}

function assignment(id, subjectId, teacherId, teacherName) {
  return { assignmentId: String(id), subjectId: String(subjectId), communicationComponentCode: null, teacherId: String(teacherId), teacherName };
}

test('teacher removal disables every row and shows progress only on the confirmation button', async () => {
  const response = deferred();
  const harness = createHarness([
    assignment(101, 22, 55, 'Maria Ramirez'),
    assignment(102, 23, 56, 'Juan Santos')
  ], () => response.promise);
  const event = submitEvent(harness.submitButton);
  const submission = harness.context.flow.submit(event);

  assert.equal(event.prevented, true);
  assert.deepEqual(harness.apiCalls, [['8', '101']]);
  assert.equal(harness.context.flow.isPending(), true);
  assert.equal(harness.backdrop.classList.contains('open'), true);
  assert.deepEqual(harness.context.flow.getData().removeButtons.map(button => button.disabled), [true, true]);
  assert.deepEqual(harness.context.flow.getData().removeButtons.map(button => button.textContent), ['Remove', 'Remove']);
  assert.equal(harness.submitButton.disabled, true);
  assert.equal(harness.submitButton.textContent, 'Removing…');

  harness.context.flow.close();
  harness.context.flow.backdropClick.call(harness.backdrop, { target: harness.backdrop });
  harness.context.flow.escape({ key: 'Escape' });
  assert.equal(harness.backdrop.classList.contains('open'), true);

  await harness.context.flow.submit(submitEvent(harness.submitButton));
  assert.equal(harness.apiCalls.length, 1, 'a repeated submit does not send another removal');
  response.resolve();
  await submission;

  const data = harness.context.flow.getData();
  assert.equal(harness.backdrop.classList.contains('open'), false);
  assert.equal(data.pendingRequest, null);
  assert.equal(data.assignments.length, 1);
  assert.equal(data.assignments[0].teacherName, 'Juan Santos');
  assert.equal(data.teacherSubjects.length, 1);
  assert.deepEqual(data.renderedTeachers, ['Juan Santos']);
  assert.equal(data.teacherAssigned, 1);
  assert.equal(data.subjectAssigned, 1);
  assert.equal(data.teacherUnassigned, 2);
  assert.equal(data.teacherPill, '2 open');
  assert.equal(harness.modalWasOpenWhenTeacherListRendered, true, 'the teacher list updates before the confirmation closes');
  assert.deepEqual(harness.renderCalls, { managementPills: 1, subjects: 1, subjectFilters: 1, teachers: 1 });
  assert.equal(harness.refreshCalls, 0);
  assert.equal(harness.submitButton.disabled, false);
  assert.equal(harness.submitButton.textContent, 'Yes, Unassign');
  assert.deepEqual(harness.toasts.at(-1), { message: 'Teacher assignment removed.', tone: 'success' });
});

test('failed teacher removal keeps the confirmation open and restores every button state', async () => {
  const harness = createHarness([
    assignment(101, 22, 55, 'Maria Ramirez'),
    assignment(102, 23, 56, 'Juan Santos')
  ], async () => { throw new Error('Network unavailable'); });
  harness.context.flow.getData().removeButtons[1].disabled = true;

  await harness.context.flow.submit(submitEvent(harness.submitButton));

  const data = harness.context.flow.getData();
  assert.equal(harness.context.flow.isPending(), false);
  assert.equal(data.modalOpen, true);
  assert.equal(data.assignments.length, 2);
  assert.deepEqual(data.removeButtons.map(button => button.disabled), [false, true]);
  assert.deepEqual(data.removeButtons.map(button => button.textContent), ['Remove', 'Remove']);
  assert.equal(harness.submitButton.disabled, false);
  assert.equal(harness.submitButton.textContent, 'Yes, Unassign');
  assert.deepEqual(harness.toasts.at(-1), { message: 'Network unavailable', tone: 'error' });
  assert.equal(harness.refreshCalls, 0);

  harness.context.flow.close();
  assert.equal(harness.context.flow.getData().modalOpen, false, 'dismissal works again after failure');
});

test('removing the last assigned teacher leaves the slot unassigned and updates counts', async () => {
  const harness = createHarness([assignment(101, 22, 55, 'Maria Ramirez')]);

  await harness.context.flow.submit(submitEvent(harness.submitButton));

  const data = harness.context.flow.getData();
  assert.equal(data.modalOpen, false);
  assert.equal(data.assignments.length, 0);
  assert.deepEqual(data.renderedTeachers, []);
  assert.equal(data.teacherAssigned, 0);
  assert.equal(data.subjectAssigned, 0);
  assert.equal(data.teacherUnassigned, 3);
  assert.equal(data.teacherPill, '3 open');
  assert.equal(data.removeButtons.length, 0);
  assert.equal(harness.refreshCalls, 0);
});

test('teacher removal updates the existing assignment state without a broad refresh', () => {
  const helper = sourceBetween('async function removeTeacherAssignmentInPlace(', '\nasync function removeStudentFromSection(');

  assert.match(helper, /if \(teacherRemovalPending\) return/);
  assert.match(helper, /setTeacherRemovalPendingState\(request, true\)/);
  assert.match(helper, /updateTeacherAssignmentAfterRemoval\(request\)/);
  assert.doesNotMatch(helper, /refreshManagementViews\(\)/);
  assert.match(helper, /closeConfirmRemoveModal\(true\)/);
});
