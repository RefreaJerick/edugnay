const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8').replace(/\r\n/g, '\n');

function sourceBetween(startMarker, endMarker) {
  const start = management.indexOf(startMarker);
  const end = management.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return management.slice(start, end).trim();
}

const addCloseSource = sourceBetween('function closeSectionAddModal() {', "\ndocument.getElementById('sectionAddModalBackdrop')");
const addBackdropSource = sourceBetween("document.getElementById('sectionAddModalBackdrop').addEventListener('click',", '\n\nfunction teacherAccounts(');
const editCloseSource = sourceBetween('function closeSectionEditModal() {', "\ndocument.getElementById('sectionEditModalBackdrop')");
const editBackdropSource = sourceBetween("document.getElementById('sectionEditModalBackdrop').addEventListener('click',", '\nfunction closeSectionStudentsModal(');
const escapeHandlerSource = sourceBetween("document.addEventListener('keydown', e => {", '\n\n/*');
const saveSectionSource = sourceBetween('async function saveSectionForm(event, mode) {', "\ndocument.getElementById('createSectionForm').addEventListener");

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

function createHarness(mode, { saveSection = async () => ({ id: '8' }), refreshManagementViews = async () => {} } = {}) {
  const listeners = {};
  const addBackdrop = {
    classList: createClassList(mode === 'create' ? ['open'] : []),
    addEventListener(name, callback) { listeners[`add-backdrop:${name}`] = callback; }
  };
  const editBackdrop = {
    classList: createClassList(mode === 'edit' ? ['open'] : []),
    addEventListener(name, callback) { listeners[`edit-backdrop:${name}`] = callback; }
  };
  const submitButton = {
    disabled: false,
    textContent: mode === 'edit' ? 'Save Changes' : 'Create Section'
  };
  const form = {
    elements: {
      sectionId: { value: mode === 'edit' ? '8' : '' },
      level: { value: 'jhs' },
      grade: { value: 'Grade 7' },
      name: { value: 'Section A' },
      track: { value: '' },
      adviserId: { value: '12' },
      capacity: { value: '40' }
    },
    reportValidityCalls: 0,
    reportValidity() { this.reportValidityCalls += 1; }
  };
  const targets = {
    sectionAddModalBackdrop: addBackdrop,
    sectionEditModalBackdrop: editBackdrop,
    createSectionSubmit: mode === 'create' ? submitButton : { disabled: false, textContent: 'Create Section' },
    editSectionSubmit: mode === 'edit' ? submitButton : { disabled: false, textContent: 'Save Changes' }
  };
  const toasts = [];
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
        updateSection(...args) { apiCalls.push({ method: 'updateSection', args }); return saveSection(...args); },
        createSection(...args) { apiCalls.push({ method: 'createSection', args }); return saveSection(...args); }
      }
    },
    managementApiSectionPayload: (sectionData, sectionId) => ({ ...sectionData, sectionId }),
    refreshManagementViews: async () => {
      refreshCalls += 1;
      refreshSawModalOpen = addBackdrop.classList.contains('open') || editBackdrop.classList.contains('open');
      resolveRefreshStarted();
      return refreshManagementViews();
    },
    showAppToast: (message, tone = 'success') => toasts.push({ message, tone }),
    closeSectionMenus() {},
    closeSectionStudentsModal() {},
    closeSubjectModal() {},
    closeTeacherModal() {},
    closeDepedSubjectReview() {},
    closeStudentAssignModal() {},
    closeConfirmRemoveModal() {}
  });

  vm.runInContext(`
    let sectionSavePending = false;
    ${addCloseSource}
    ${addBackdropSource}
    ${editCloseSource}
    ${editBackdropSource}
    ${escapeHandlerSource}
    ${saveSectionSource}
    globalThis.sectionSaveFlow = {
      isPending: () => sectionSavePending,
      close: mode => mode === 'edit' ? closeSectionEditModal() : closeSectionAddModal(),
      submit: (event, mode) => saveSectionForm(event, mode),
      escape: listeners['document:keydown'],
      backdropClick: mode => listeners[(mode === 'edit' ? 'edit' : 'add') + '-backdrop:click']
    };
  `, context);

  return {
    context,
    form,
    submitButton,
    addBackdrop,
    editBackdrop,
    toasts,
    apiCalls,
    refreshStarted,
    get refreshCalls() { return refreshCalls; },
    get refreshSawModalOpen() { return refreshSawModalOpen; }
  };
}

function submitEvent(form, button) {
  return { currentTarget: form, submitter: button, prevented: false, preventDefault() { this.prevented = true; } };
}

function assertModalOpen(harness, mode, expected, message) {
  const backdrop = mode === 'edit' ? harness.editBackdrop : harness.addBackdrop;
  assert.equal(backdrop.classList.contains('open'), expected, message);
}

function tryDismiss(harness, mode) {
  harness.context.sectionSaveFlow.close(mode);
  const backdrop = mode === 'edit' ? harness.editBackdrop : harness.addBackdrop;
  harness.context.sectionSaveFlow.backdropClick(mode).call(backdrop, { target: backdrop });
  harness.context.sectionSaveFlow.escape({ key: 'Escape' });
}

test('edit and create show progress, block dismissal and duplicate submits, then close after refresh', async () => {
  for (const mode of ['edit', 'create']) {
    const saveResponse = deferred();
    const refreshResponse = deferred();
    const harness = createHarness(mode, {
      saveSection: () => saveResponse.promise,
      refreshManagementViews: () => refreshResponse.promise
    });
    const originalLabel = mode === 'edit' ? 'Save Changes' : 'Create Section';
    const progressLabel = mode === 'edit' ? 'Saving…' : 'Creating…';
    const event = submitEvent(harness.form, harness.submitButton);
    const submission = harness.context.sectionSaveFlow.submit(event, mode);

    assert.equal(event.prevented, true);
    assert.equal(harness.apiCalls.length, 1);
    assert.equal(harness.apiCalls[0].method, mode === 'edit' ? 'updateSection' : 'createSection');
    assert.equal(harness.context.sectionSaveFlow.isPending(), true);
    assertModalOpen(harness, mode, true);
    assert.equal(harness.submitButton.disabled, true);
    assert.equal(harness.submitButton.textContent, progressLabel);

    tryDismiss(harness, mode);
    assertModalOpen(harness, mode, true);
    await harness.context.sectionSaveFlow.submit(submitEvent(harness.form, harness.submitButton), mode);
    assert.equal(harness.apiCalls.length, 1, 'a duplicate submit does not start another save');

    saveResponse.resolve({ id: '8' });
    await harness.refreshStarted;
    assert.equal(harness.refreshSawModalOpen, true, 'the modal stays open while refreshing');
    assert.equal(harness.submitButton.disabled, true);
    assert.equal(harness.submitButton.textContent, progressLabel);
    assert.equal(harness.toasts.length, 0, 'success feedback waits for the refreshed list');
    tryDismiss(harness, mode);
    assertModalOpen(harness, mode, true);

    refreshResponse.resolve();
    await submission;
    assertModalOpen(harness, mode, false);
    assert.equal(harness.context.sectionSaveFlow.isPending(), false);
    assert.equal(harness.refreshCalls, 1);
    assert.equal(harness.submitButton.disabled, false);
    assert.equal(harness.submitButton.textContent, originalLabel);
    assert.deepEqual(harness.toasts.at(-1), {
      message: mode === 'edit' ? 'Section updated.' : 'Section created.',
      tone: 'success'
    });
  }
});

test('failed section saves keep the modal open and restore the button for both forms', async () => {
  for (const mode of ['edit', 'create']) {
    const harness = createHarness(mode, { saveSection: async () => { throw new Error('Save failed'); } });
    const originalLabel = mode === 'edit' ? 'Save Changes' : 'Create Section';
    const originalName = harness.form.elements.name.value;

    await harness.context.sectionSaveFlow.submit(submitEvent(harness.form, harness.submitButton), mode);

    assertModalOpen(harness, mode, true);
    assert.equal(harness.context.sectionSaveFlow.isPending(), false);
    assert.equal(harness.submitButton.disabled, false);
    assert.equal(harness.submitButton.textContent, originalLabel);
    assert.equal(harness.form.elements.name.value, originalName);
    assert.equal(harness.refreshCalls, 0);
    assert.deepEqual(harness.toasts.at(-1), { message: 'Save failed', tone: 'error' });
    tryDismiss(harness, mode);
    assertModalOpen(harness, mode, false, 'dismissal works again after failure');
  }
});

test('saved section closes with an information toast when list refresh fails', async () => {
  const harness = createHarness('edit', {
    refreshManagementViews: async () => { throw new Error('Refresh failed'); }
  });

  await harness.context.sectionSaveFlow.submit(submitEvent(harness.form, harness.submitButton), 'edit');

  assertModalOpen(harness, 'edit', false);
  assert.equal(harness.apiCalls.length, 1);
  assert.equal(harness.refreshCalls, 1);
  assert.equal(harness.refreshSawModalOpen, true);
  assert.deepEqual(harness.toasts.at(-1), {
    message: 'Section saved, but the list could not refresh. Reload the page to verify it.',
    tone: 'info'
  });
});

test('section adviser entry points in card and table views share the edit modal flow', () => {
  assert.match(management, /card\.querySelector\('\.assign-adviser'\)[\s\S]*?openSectionEditModal\(card\)/);
  assert.match(management, /tbody\.querySelectorAll\('\.row-btn\.edit'\)[\s\S]*?openSectionEditModal\(button\.closest\('tr'\)\)/);
  assert.match(html, /id="createSectionSubmit"[^>]*>Create Section/);
  assert.match(html, /id="editSectionSubmit"[^>]*>Save Changes/);
  assert.equal((html.match(/data-page-click="p104d763fb19f"/g) || []).length, 2);
  assert.equal((html.match(/data-page-click="p4a49ac32633d"/g) || []).length, 2);
  assert.match(management, /p104d763fb19f: function\(event\) \{ closeSectionAddModal\(\) \}/);
  assert.match(management, /p4a49ac32633d: function\(event\) \{ closeSectionEditModal\(\) \}/);
});
