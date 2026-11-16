const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const modalStart = source.indexOf('    function openModal(id) {');
const modalEnd = source.indexOf("    document.querySelectorAll('.modal-backdrop').forEach", modalStart);
const previewStart = source.indexOf('    function assignmentPreviewHasUnsavedScore()');
const previewEnd = source.indexOf('    function openStatusModal(id) {', previewStart);
const submissionsStart = source.indexOf('    async function openElectiveAssignmentSubmissions(');
const submissionsEnd = source.indexOf('    function assignmentPreviewHasUnsavedScore()', submissionsStart);
const coreEditStart = source.indexOf('    function canEditShsCoreAssignmentScore(');
const coreEditEnd = source.indexOf('    function getGradeStudents()', coreEditStart);
const escapeStart = source.indexOf("    document.addEventListener('keydown', event => {");
const escapeEnd = source.indexOf('    function renderAssignments() {', escapeStart);
assert.ok(modalStart >= 0 && modalEnd > modalStart && previewStart >= 0 && previewEnd > previewStart
  && escapeStart >= 0 && escapeEnd > escapeStart && submissionsStart >= 0 && submissionsEnd > submissionsStart
  && coreEditStart >= 0 && coreEditEnd > coreEditStart);

function element() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, value: '', textContent: '', href: '', max: '', title: '',
    validity: { badInput: false },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; }
  };
}

function harness({ canEdit = true, preview, save, refresh, mode = 'k10', termStatus = 'active',
  yearStatus = 'active', policy = {}, legacyCommunication = false, publishedGrades = false } = {}) {
  const ids = ['assignmentSubmissionsModal', 'assignmentSubmissionPreviewModal',
    'assignmentSubmissionPreviewStudent', 'assignmentSubmissionPreviewFileName',
    'assignmentSubmissionPreviewPosition', 'assignmentSubmissionPreviewScoreInput',
    'assignmentSubmissionPreviewMaxScore', 'assignmentSubmissionPreviewScoreRow',
    'assignmentSubmissionPreviewScoreUnavailable', 'assignmentSubmissionPreviewScoreFeedback',
    'assignmentSubmissionPreviewSave', 'assignmentSubmissionPreviewPrevious', 'assignmentSubmissionPreviewNext',
    'assignmentSubmissionPreviewCloseTop',
    'assignmentSubmissionPreviewFrame', 'assignmentSubmissionPreviewMessage',
    'assignmentSubmissionPreviewMessageText', 'assignmentSubmissionPreviewDownload',
    'academicPeriodSelect'];
  const elements = Object.fromEntries(ids.map(id => [id, Object.assign(element(), { id })]));
  elements.assignmentSubmissionsModal.classList.add('open');
  elements.academicPeriodSelect.value = 'term-1';
  const listInputs = new Map([[1, element()], [2, element()]]);
  const submissions = [
    { id: 101, studentId: 1, studentName: 'First Student', fileName: 'first.pdf', fileUrl: '/first' },
    { id: 102, studentId: 2, studentName: 'Second Student', fileName: 'second.pdf', fileUrl: '/second' }
  ];
  const assignment = { id: '11', categoryId: 3, gradingItemId: 99, maxScore: 20, academicPeriodId: 'term-1' };
  const records = [];
  const workspace = { items: [{ id: 99, usedInPublishedGrades: true }], scores: records,
    term: { id: 'term-1', status: termStatus },
    scope: { policy, yearStatus, legacyCommunication },
    published: publishedGrades ? [{ studentId: 1, finalGrade: 85 }] : [] };
  const saves = [];
  const toasts = [];
  const revoked = [];
  const created = [];
  let gradebookRefreshes = 0;
  let allowDiscard = false;
  const api = {
    getAssignmentSubmissionDownloadUrl: (_assignmentId, submissionId) => `/download/${submissionId}`,
    getAssignmentSubmissionPreview: preview || (async () => ({ contentType: 'application/pdf', buffer: new Uint8Array([1]) })),
    saveStudentScore: async values => {
      saves.push(values);
      if (save) return save(values);
      return { gradingItemId: values.gradingItemId, studentId: values.studentId, score: values.score };
    },
    saveShsScore: async values => {
      saves.push(values);
      if (save) return save(values);
      return { gradingItemId: values.gradingItemId, studentId: values.studentId, score: values.score };
    },
    getShsGradeWorkspace: async () => workspace
  };
  const context = vm.createContext({
    assignmentPreviewState: null, assignmentPreviewObjectUrl: null, assignmentPreviewRequestId: 0,
    teacherDeletePending: false, materialUploadInProgress: false, qrAttendanceSaving: false,
    pendingTeacherDelete: null, qrAttendanceReturnFocus: null,
    BACKEND_SUBMISSIONS: new Map([['11', submissions]]), BACKEND_STUDENT_SCORES: records,
    BACKEND_GRADING_ITEMS: [{ id: 99, usedInPublishedGrades: true }],
    BACKEND_TERMS: [{ id: 'term-1', status: termStatus }],
    shsCoreSubmissionWorkspace: mode === 'core' ? workspace : null,
    electiveReviewWorkspace: { scores: records, term: { status: termStatus }, scope: { policy: {} },
      published: workspace.published },
    CURRENT_SECTION_ID: 4, CURRENT_SUBJECT_ID: 5, CURRENT_COMMUNICATION_COMPONENT_CODE: '',
    BACKEND_GRADE_ERROR: '', Blob, alert() {}, resetMaterialUploadForm() {}, stopQrScanner() {},
    document: {
      getElementById(id) { return elements[id]; },
      querySelector(selector) {
        const match = selector.match(/data-submission-student-id="(\d+)"/);
        return match ? listInputs.get(Number(match[1])) : null;
      }
    },
    window: { EDUGNAY_API: api, confirm: () => allowDiscard, setTimeout() {},
      EDUGNAY_CONFIG: { escapeHtml: value => String(value), formatDateTime: value => String(value) },
      EDUGNAY_PAGE_EVENTS: { register: () => 'handler' },
      AcademixElectiveClass: { getAssignment: () => assignment, getClass: () => ({ electiveClassId: 6 }), canEdit: () => canEdit },
      AcademixShsGradebook: { refresh: async () => { gradebookRefreshes++; } } },
    lucide: { createIcons() {} }, showAppToast: message => toasts.push(message),
    loadElectiveAssignmentReview: async () => ({ assignment, submissions }),
    URL: {
      createObjectURL() { const url = `blob:preview-${created.length + 1}`; created.push(url); return url; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    getTeacherAssignments: () => [assignment],
    getGradeStudents: () => [{ id: 1, displayName: 'First Student' }, { id: 2, displayName: 'Second Student' }],
    getAssignmentScoreRecords: () => records,
    getBackendGradingItemForAssignment: () => ({ id: 99, usedInPublishedGrades: true }),
    getPublishedGradesForPeriod: () => workspace.published,
    isBackendGradeMode: () => true,
    isElectiveClassPage: () => mode === 'elective',
    USE_SHS_CORE_GRADEBOOK: mode === 'core',
    hasScoreEditingAccess: () => canEdit,
    requireScoreEditingAccess: () => canEdit,
    renderScoreTable() {}, switchAcademicPeriod: refresh || (async () => {}),
    openAssignmentSubmissionsModal() {}, openElectiveAssignmentSubmissions() {}
  });
  vm.runInContext(source.slice(coreEditStart, coreEditEnd)
    + source.slice(modalStart, modalEnd) + source.slice(previewStart, previewEnd), context);
  const flow = vm.runInContext('({ openAssignmentSubmissionPreview, saveAssignmentPreviewScore, advanceAssignmentSubmissionPreview, previousAssignmentSubmissionPreview, closeAssignmentSubmissionPreview, saveAssignmentSubmissionScore })', context);
  return { flow, context, workspace, elements, records, saves, toasts, revoked, created, listInputs,
    get gradebookRefreshes() { return gradebookRefreshes; },
    allowDiscard(value) { allowDiscard = value; } };
}

for (const mode of ['core', 'elective']) {
  test(`published ${mode} submissions list renders an editable score field only in the active term`, async () => {
    for (const termStatus of ['active', 'closed']) {
      const h = harness({ mode, termStatus });
      let rendered;
      h.context.window.TeacherClassViews = { renderAssignmentSubmissions: value => { rendered = value; } };
      vm.runInContext(source.slice(submissionsStart, submissionsEnd), h.context);
      await vm.runInContext(mode === 'core'
        ? 'openAssignmentSubmissionsModal(11)' : 'openElectiveAssignmentSubmissions(11)', h.context);
      const score = rendered.columns.find(column => column.key === 'score').render(rendered.rows[0]);
      assert.equal(score.includes('disabled'), termStatus !== 'active');
    }
  });
}

test('core assignment scoring matches the SHS gradebook read-only rules', async () => {
  for (const options of [
    { yearStatus: 'closed' }, { policy: null }, { legacyCommunication: true }, { termStatus: 'closed' }
  ]) {
    const h = harness({ mode: 'core', ...options });
    let rendered;
    h.context.window.TeacherClassViews = { renderAssignmentSubmissions: value => { rendered = value; } };
    vm.runInContext(source.slice(submissionsStart, submissionsEnd), h.context);
    await vm.runInContext('openAssignmentSubmissionsModal(11)', h.context);
    const score = rendered.columns.find(column => column.key === 'score').render(rendered.rows[0]);
    assert.match(score, /disabled/);
    await h.flow.openAssignmentSubmissionPreview(11, 101);
    assert.equal(h.elements.assignmentSubmissionPreviewScoreInput.disabled, true);
  }
});

test('an open core submission preview stops saving if the term becomes read-only', async () => {
  const h = harness({ mode: 'core' });
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  h.workspace.term.status = 'closed';
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '8'; input.oninput();
  assert.equal(await h.flow.saveAssignmentPreviewScore(), false);
  assert.equal(h.saves.length, 0);
  assert.equal(input.disabled, true);
  assert.match(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, /read-only/);
});

test('preview saves in place, saves before Next, and finishes at the last file', async () => {
  const h = harness();
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  assert.equal(h.elements.assignmentSubmissionPreviewStudent.textContent, 'First Student');
  assert.equal(h.elements.assignmentSubmissionPreviewPosition.textContent, '1 of 2');
  assert.equal(h.elements.assignmentSubmissionPreviewNext.textContent, 'Next submission');
  assert.equal(h.elements.assignmentSubmissionPreviewPrevious.disabled, true);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '6'; input.oninput();
  assert.equal(await h.flow.saveAssignmentPreviewScore(), true);
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.listInputs.get(1).value, '6');
  input.value = '7'; input.oninput();
  await Promise.all([h.flow.advanceAssignmentSubmissionPreview(), h.flow.advanceAssignmentSubmissionPreview()]);
  assert.equal(h.context.assignmentPreviewState.index, 1);
  assert.equal(h.elements.assignmentSubmissionPreviewPosition.textContent, '2 of 2');
  assert.equal(h.elements.assignmentSubmissionPreviewPrevious.disabled, false);
  assert.equal(h.listInputs.get(1).value, '7');
  input.value = '9'; input.oninput();
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState, null);
  assert.equal(h.elements.assignmentSubmissionPreviewModal.classList.contains('open'), false);
  assert.equal(h.elements.assignmentSubmissionsModal.classList.contains('open'), true);
  assert.equal(h.listInputs.get(2).value, '9');
  assert.deepEqual(h.saves.map(item => item.score), [6, 7, 9]);
  assert.equal(h.revoked.length, 2);
});

test('Previous saves an edited score, returns to the prior file, and stops at the first file', async () => {
  const h = harness();
  await h.flow.openAssignmentSubmissionPreview(11, 102);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '12'; input.oninput();
  await Promise.all([h.flow.previousAssignmentSubmissionPreview(), h.flow.previousAssignmentSubmissionPreview()]);
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.elements.assignmentSubmissionPreviewStudent.textContent, 'First Student');
  assert.equal(h.elements.assignmentSubmissionPreviewPosition.textContent, '1 of 2');
  assert.equal(h.elements.assignmentSubmissionPreviewPrevious.disabled, true);
  assert.equal(h.listInputs.get(2).value, '12');
  assert.deepEqual(h.saves.map(item => item.score), [12]);
  await h.flow.previousAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
});

test('Previous keeps the current file open when its edited score is invalid or fails to save', async () => {
  let failSave = true;
  const h = harness({ save: async values => {
    if (failSave) throw new Error('Save failed.');
    return { gradingItemId: values.gradingItemId, studentId: values.studentId, score: values.score };
  } });
  await h.flow.openAssignmentSubmissionPreview(11, 102);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '21'; input.oninput();
  await h.flow.previousAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 1);
  assert.equal(h.saves.length, 0);
  assert.match(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, /0 to 20/);
  input.value = '8'; input.oninput();
  await h.flow.previousAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 1);
  assert.equal(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, 'Save failed.');
  failSave = false;
  await h.flow.previousAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.listInputs.get(2).value, '8');
});

test('the existing submissions-list score input still saves and clears scores', async () => {
  const h = harness();
  const input = element();
  input.max = '20';
  input.value = '4';
  await h.flow.saveAssignmentSubmissionScore('11', '1', input);
  assert.equal(h.records[0].score, 4);
  input.value = '';
  await h.flow.saveAssignmentSubmissionScore('11', '1', input);
  assert.equal(h.records[0].score, null);
  assert.equal(h.listInputs.get(1).value, '');
});

for (const mode of ['core', 'elective']) {
  test(`published ${mode} assignment scores save and clear from the list and preview`, async () => {
    const h = harness({ mode, publishedGrades: true });
    const listInput = element();
    listInput.max = '20';
    listInput.value = '8';
    await h.flow.saveAssignmentSubmissionScore('11', '1', listInput);
    assert.equal(h.records[0].score, 8);
    await h.flow.openAssignmentSubmissionPreview(11, 101);
    const previewInput = h.elements.assignmentSubmissionPreviewScoreInput;
    assert.equal(previewInput.disabled, false);
    previewInput.value = '10'; previewInput.oninput();
    assert.equal(await h.flow.saveAssignmentPreviewScore(), true);
    assert.equal(h.records[0].score, 10);
    previewInput.value = ''; previewInput.oninput();
    assert.equal(await h.flow.saveAssignmentPreviewScore(), true);
    assert.equal(h.records[0].score, null);
    assert.equal(h.listInputs.get(1).value, '');
    assert.deepEqual(h.saves.map(item => item.score), [8, 10, null]);
    assert.equal(h.gradebookRefreshes, 3);
    assert.deepEqual(h.toasts, Array(3).fill('Score saved. Re-publish grades to update the published result.'));
  });

  test(`${mode} assignment scoring remains read-only outside the active term`, async () => {
    const h = harness({ mode, termStatus: 'closed' });
    await h.flow.openAssignmentSubmissionPreview(11, 101);
    assert.equal(h.elements.assignmentSubmissionPreviewScoreInput.disabled, true);
    const listInput = element();
    listInput.max = '20';
    listInput.value = '8';
    await h.flow.saveAssignmentSubmissionScore('11', '1', listInput);
    assert.equal(h.saves.length, 0);
  });
}

test('Elem and JHS assignment score saves show the reminder only for a published term', async () => {
  for (const publishedGrades of [false, true]) {
    const h = harness({ publishedGrades });
    const input = element();
    input.max = '20';
    input.value = '8';
    await h.flow.saveAssignmentSubmissionScore('11', '1', input);
    assert.deepEqual(h.toasts, publishedGrades
      ? ['Score saved. Re-publish grades to update the published result.'] : []);
  }
});

test('failed assignment score saves never show a published-grade reminder', async () => {
  const h = harness({ publishedGrades: true, save: async () => { throw new Error('Save failed.'); } });
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '8'; input.oninput();
  assert.equal(await h.flow.saveAssignmentPreviewScore(), false);
  assert.deepEqual(h.toasts, []);
});

test('invalid and failed scores keep the current submission and protect unsaved work', async () => {
  const h = harness({ save: async () => { throw new Error('Save failed.'); } });
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '21'; input.oninput();
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.saves.length, 0);
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.match(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, /0 to 20/);
  input.value = '8'; input.oninput();
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, 'Save failed.');
  h.flow.closeAssignmentSubmissionPreview();
  assert.equal(h.elements.assignmentSubmissionPreviewModal.classList.contains('open'), true);
  h.allowDiscard(true);
  h.flow.closeAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState, null);
});

test('a score rejection still shows its error if refreshing the grade period fails', async () => {
  const error = Object.assign(new Error('Score editing is locked.'), { status: 409 });
  const h = harness({ save: async () => { throw error; }, refresh: async () => { throw new Error('Refresh failed.'); } });
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '8'; input.oninput();
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.elements.assignmentSubmissionPreviewScoreFeedback.textContent, 'Score editing is locked.');
});

test('read-only scoring and unsupported files still allow download and finish', async () => {
  const h = harness({ canEdit: false, preview: async () => ({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: new Uint8Array([1]) }) });
  await h.flow.openAssignmentSubmissionPreview(11, 102);
  assert.equal(h.elements.assignmentSubmissionPreviewScoreInput.disabled, true);
  assert.equal(h.elements.assignmentSubmissionPreviewSave.hidden, true);
  assert.equal(h.elements.assignmentSubmissionPreviewDownload.hidden, false);
  assert.equal(h.elements.assignmentSubmissionPreviewDownload.href, '/download/102');
  assert.equal(h.elements.assignmentSubmissionPreviewNext.textContent, 'Finish');
  await h.flow.previousAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
  assert.equal(h.saves.length, 0);
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 1);
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.saves.length, 0);
  assert.equal(h.context.assignmentPreviewState, null);
});

test('closing during a pending preview ignores its late response', async () => {
  let resolvePreview;
  const h = harness({ preview: () => new Promise(resolve => { resolvePreview = resolve; }) });
  const opening = h.flow.openAssignmentSubmissionPreview(11, 101);
  await h.flow.advanceAssignmentSubmissionPreview();
  assert.equal(h.context.assignmentPreviewState.index, 0);
  h.flow.closeAssignmentSubmissionPreview();
  resolvePreview({ contentType: 'application/pdf', buffer: new Uint8Array([1]) });
  await opening;
  assert.equal(h.created.length, 0);
  assert.equal(h.context.assignmentPreviewState, null);
});

test('Escape targets the preview above the submissions list and respects unsaved scores', async () => {
  const h = harness();
  await h.flow.openAssignmentSubmissionPreview(11, 101);
  const input = h.elements.assignmentSubmissionPreviewScoreInput;
  input.value = '5'; input.oninput();
  let keydown;
  h.context.document.addEventListener = (_name, handler) => { keydown = handler; };
  h.context.document.querySelector = selector => {
    if (selector === '#assignmentSubmissionPreviewModal.open'
      && h.elements.assignmentSubmissionPreviewModal.classList.contains('open')) return h.elements.assignmentSubmissionPreviewModal;
    if (selector === '.modal-backdrop.open') return h.elements.assignmentSubmissionsModal;
    return null;
  };
  h.context.closeAssignmentMenus = () => {};
  h.context.closeScoreComponentMenu = () => {};
  vm.runInContext(source.slice(escapeStart, escapeEnd), h.context);
  keydown({ key: 'Escape' });
  assert.equal(h.elements.assignmentSubmissionPreviewModal.classList.contains('open'), true);
  assert.equal(h.elements.assignmentSubmissionsModal.classList.contains('open'), true);
  h.allowDiscard(true);
  keydown({ key: 'Escape' });
  assert.equal(h.elements.assignmentSubmissionPreviewModal.classList.contains('open'), false);
  assert.equal(h.elements.assignmentSubmissionsModal.classList.contains('open'), true);
});
