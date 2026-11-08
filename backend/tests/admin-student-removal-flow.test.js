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

const removalHelpers = [
  sourceBetween('function setStudentRemovalPendingState(', 'async function removeStudentFromSection('),
  sourceBetween('async function removeStudentFromSection(', 'function closeConfirmRemoveModal('),
  sourceBetween('function closeConfirmRemoveModal(', "\ndocument.getElementById('confirmRemoveModalBackdrop')")
].join('\n');
const modalRenderer = sourceBetween('function renderSectionStudentsModal(', '\nfunction openSectionStudentsModal(');
const studentCountHelper = sourceBetween('function managementSectionStudentCount(', '\nfunction managementSectionRecords(');
const studentTabRenderer = sourceBetween('function renderStudentsTab(', '\nfunction closeSectionEditModal(');
const managementPillRenderer = sourceBetween('function renderManagementTabPills(', '\nfunction managementSetOptions(');

function classList(initiallyOpen = false) {
  const values = new Set(initiallyOpen ? ['open'] : []);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function createHarness(students, withdrawStudent) {
  const tbody = {
    _innerHTML: '',
    buttons: [],
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = value;
      const count = (value.match(/class="row-btn remove"/g) || []).length;
      this.buttons = Array.from({ length: count }, () => ({ disabled: false, textContent: 'Remove' }));
    }
  };
  const targets = {
    sectionStudentsModalTitle: { textContent: '' },
    sectionStudentsModalSub: { textContent: '' },
    sectionStudentsTableBody: tbody,
    sectionStudentsModalBackdrop: { classList: classList(true) },
    confirmRemoveModalBackdrop: { classList: classList(true) },
    confirmRemoveSubmit: { disabled: false, textContent: 'Yes, Remove' },
    teacherTabPill: { textContent: '' },
    studentTabPill: { textContent: '' }
  };
  const stats = {};
  const toasts = [];
  let sectionStudentCount = null;
  let sectionFilterCalls = 0;
  let renderSectionsCalls = 0;
  let refreshCalls = 0;

  const document = {
    getElementById(id) { return targets[id] || null; },
    querySelectorAll(selector) {
      assert.equal(selector, '#sectionStudentsTableBody .row-btn.remove');
      return tbody.buttons;
    }
  };
  const section = { id: '8', name: 'Section A', level: 'jhs', grade: 'Grade 8' };
  const context = vm.createContext({
    document,
    window: {
      EDUGNAY_API: { withdrawStudent },
      EDUGNAY_PAGE_EVENTS: { register: () => 'test-click' },
      EDUGNAY_CONFIG: { renderPanelEmptyState: ({ title }) => `<div>${title}</div>` }
    },
    showAppToast: (message, tone = 'success') => toasts.push({ message, tone }),
    getTeacherAssignmentStats: () => ({ unassigned: 0 }),
    stats,
    renderManagementStatCards(targetId, cards) { stats[targetId] = cards; },
    renderStudentGradeTabs() {},
    renderEnrolledTable() {},
    renderSectionOverviewCards() {},
    applyStudentFilters() {},
    renderSections() {
      renderSectionsCalls += 1;
      sectionStudentCount = context.flow.getData().sectionStudentCount;
    },
    filterSections() { sectionFilterCalls += 1; },
    refreshManagementViews() { refreshCalls += 1; }
  });

  vm.runInContext(`
    let STUDENTS_DATA = ${JSON.stringify(students)};
    let MANAGEMENT_ASSIGNMENT_STUDENTS = STUDENTS_DATA.filter(student => !student.sectionId);
    let pendingRemoveRequest = null;
    let studentRemovalPending = false;
    const section = ${JSON.stringify(section)};
    function managementSectionById(id) {
      return id === section.id ? { ...section, students: managementSectionStudentCount(section.id) } : null;
    }
    function managementSectionPlacement() { return 'Junior High School · Grade 8'; }
    function managementSectionRecords() { return [{ ...section, students: managementSectionStudentCount(section.id) }]; }
    function managementSchoolLevels() { return ['jhs']; }
    function managementLevelShortLabel(level) { return level; }
    function managementSectionCountForTest() { return managementSectionStudentCount(section.id); }
    ${studentCountHelper}
    ${modalRenderer}
    ${studentTabRenderer}
    ${managementPillRenderer}
    ${removalHelpers}
    globalThis.flow = {
      openList() { renderSectionStudentsModal(section.id, true); },
      remove: removeStudentFromSection,
      getData() {
        return {
          students: STUDENTS_DATA,
          assignmentStudents: MANAGEMENT_ASSIGNMENT_STUDENTS,
          assignedCount: stats['students-summary-cards']?.find(card => card.label === 'Assigned')?.value,
          unassignedCount: stats['students-summary-cards']?.find(card => card.label === 'Unassigned')?.value,
          openStudentPill: document.getElementById('studentTabPill').textContent,
          sectionStudentCount: managementSectionCountForTest()
        };
      }
    };
  `, context);

  return {
    context,
    tbody,
    targets,
    stats,
    toasts,
    get sectionStudentCount() { return sectionStudentCount; },
    get sectionFilterCalls() { return sectionFilterCalls; },
    get renderSectionsCalls() { return renderSectionsCalls; },
    get refreshCalls() { return refreshCalls; }
  };
}

function assignedStudent(id, name) {
  return {
    id: String(id), displayName: name, schoolEmail: `${name.toLowerCase().replaceAll(' ', '.')}@school.test`,
    sectionId: '8', schoolLevel: 'jhs', gradeLevel: 'Grade 8', trackId: null, track: '', strandId: null, strand: ''
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test('student removal disables every row and shows progress only on the confirmation button', async () => {
  const response = deferred();
  let requests = 0;
  const harness = createHarness([assignedStudent(1, 'Alex Rivera'), assignedStudent(2, 'Sam Rivera')], () => {
    requests += 1;
    return response.promise;
  });
  harness.context.flow.openList();
  const request = { sectionId: '8', submitLabel: 'Yes, Remove' };

  const pending = harness.context.flow.remove(request, harness.context.flow.getData().students[0]);
  assert.equal(requests, 1);
  assert.deepEqual(harness.tbody.buttons.map(button => button.disabled), [true, true]);
  assert.deepEqual(harness.tbody.buttons.map(button => button.textContent), ['Remove', 'Remove']);
  assert.equal(harness.targets.confirmRemoveSubmit.disabled, true);
  assert.equal(harness.targets.confirmRemoveSubmit.textContent, 'Removing…');
  assert.equal(harness.targets.sectionStudentsModalBackdrop.classList.contains('open'), true);
  assert.equal(harness.targets.confirmRemoveModalBackdrop.classList.contains('open'), true);

  await harness.context.flow.remove(request, harness.context.flow.getData().students[0]);
  assert.equal(requests, 1, 'a repeated submit does not send another request');
  response.resolve();
  await pending;
});

test('successful removal updates the open roster and local enrollment counts without a broad refresh', async () => {
  const response = deferred();
  const harness = createHarness([assignedStudent(1, 'Alex Rivera'), assignedStudent(2, 'Sam Rivera')], () => response.promise);
  harness.context.flow.openList();
  const student = harness.context.flow.getData().students[0];
  const request = { sectionId: '8', submitLabel: 'Yes, Remove' };
  const pending = harness.context.flow.remove(request, student);

  response.resolve();
  await pending;

  const data = harness.context.flow.getData();
  assert.equal(harness.targets.sectionStudentsModalBackdrop.classList.contains('open'), true);
  assert.equal(harness.targets.confirmRemoveModalBackdrop.classList.contains('open'), false);
  assert.match(harness.tbody.innerHTML, /Sam Rivera/);
  assert.doesNotMatch(harness.tbody.innerHTML, /Alex Rivera/);
  assert.match(harness.targets.sectionStudentsModalSub.textContent, /1 enrolled/);
  assert.equal(data.students[0].sectionId, null);
  assert.equal(data.students[0].schoolLevel, '');
  assert.equal(data.assignmentStudents.some(record => record.id === '1'), true);
  assert.equal(data.assignedCount, 1);
  assert.equal(data.unassignedCount, 1);
  assert.equal(data.openStudentPill, '1 open');
  assert.equal(data.sectionStudentCount, 1);
  assert.equal(harness.sectionStudentCount, 1);
  assert.equal(harness.sectionFilterCalls, 1);
  assert.equal(harness.renderSectionsCalls, 1);
  assert.equal(harness.refreshCalls, 0);
  assert.equal(harness.targets.confirmRemoveSubmit.disabled, false);
  assert.equal(harness.targets.confirmRemoveSubmit.textContent, 'Yes, Remove');
});

test('failed removal keeps the row and both dialogs open, restores controls, and shows the error', async () => {
  const harness = createHarness([assignedStudent(1, 'Alex Rivera'), assignedStudent(2, 'Sam Rivera')], async () => {
    throw new Error('Network unavailable');
  });
  harness.context.flow.openList();
  const student = harness.context.flow.getData().students[0];
  const originalMarkup = harness.tbody.innerHTML;
  harness.tbody.buttons[1].disabled = true;
  const request = { sectionId: '8', submitLabel: 'Yes, Remove' };

  await harness.context.flow.remove(request, student);

  assert.equal(harness.targets.sectionStudentsModalBackdrop.classList.contains('open'), true);
  assert.equal(harness.targets.confirmRemoveModalBackdrop.classList.contains('open'), true);
  assert.equal(harness.tbody.innerHTML, originalMarkup);
  assert.equal(student.sectionId, '8');
  assert.deepEqual(harness.tbody.buttons.map(button => button.disabled), [false, true]);
  assert.deepEqual(harness.tbody.buttons.map(button => button.textContent), ['Remove', 'Remove']);
  assert.equal(harness.targets.confirmRemoveSubmit.disabled, false);
  assert.equal(harness.targets.confirmRemoveSubmit.textContent, 'Yes, Remove');
  assert.deepEqual(harness.toasts.at(-1), { message: 'Network unavailable', tone: 'error' });
  assert.equal(harness.refreshCalls, 0);
});

test('removing the last student leaves the list open with an empty state and zero enrolled', async () => {
  const harness = createHarness([assignedStudent(1, 'Alex Rivera')], async () => {});
  harness.context.flow.openList();
  const student = harness.context.flow.getData().students[0];
  const request = { sectionId: '8', submitLabel: 'Yes, Remove' };

  await harness.context.flow.remove(request, student);

  const data = harness.context.flow.getData();
  assert.equal(harness.targets.sectionStudentsModalBackdrop.classList.contains('open'), true);
  assert.equal(harness.targets.confirmRemoveModalBackdrop.classList.contains('open'), false);
  assert.match(harness.tbody.innerHTML, /No students enrolled/);
  assert.match(harness.targets.sectionStudentsModalSub.textContent, /0 enrolled/);
  assert.equal(data.sectionStudentCount, 0);
  assert.equal(data.assignedCount, 0);
  assert.equal(data.unassignedCount, 1);
  assert.equal(data.openStudentPill, '1 open');
});

test('the student submit branch delegates to the in-place helper instead of refreshing all management data', () => {
  const branchStart = management.indexOf("const studentId = document.getElementById('removeStudentId').value || targetId;");
  const branchEnd = management.indexOf('\n\n});', branchStart);
  assert.notEqual(branchStart, -1);
  assert.notEqual(branchEnd, -1);
  const studentBranch = management.slice(branchStart, branchEnd);
  assert.match(studentBranch, /await removeStudentFromSection\(pendingRemoveRequest \|\| \{\}, student\)/);
  assert.doesNotMatch(studentBranch, /refreshManagementViews\(\)|closeSectionStudentsModal\(\)/);
});
