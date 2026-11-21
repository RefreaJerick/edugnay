const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const journalPage = pageFs.readFileSync(path.join(root, 'views/student/edugnay-student-journal.html'), 'utf8');
const dashboardPage = pageFs.readFileSync(path.join(root, 'views/student/edugnay-student-dashboard.html'), 'utf8');

function extractAsyncFunction(source, functionName, nextMarker) {
  const start = source.indexOf(`async function ${functionName}() {`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `expected ${functionName} in page source`);
  assert.notEqual(end, -1, `expected end marker after ${functionName}`);
  return source.slice(start, end).trim();
}

const journalLoader = extractAsyncFunction(
  journalPage,
  'loadStudentJournals',
  "document.addEventListener('DOMContentLoaded', async () => {"
);
const journalSubmitter = extractAsyncFunction(
  journalPage,
  'submitEntry',
  'function renderHistory()'
);
const dashboardJournalLoader = extractAsyncFunction(
  dashboardPage,
  'loadStudentJournalCard',
  'const MATERIAL_TYPE_DISPLAY = {'
);

function createJournalApi({
  session = { id: '70', role: 'student' },
  portal = { features: { journalsEnabled: true }, journalSubjectEligible: true },
  history = { prompts: [], entries: [] },
  subjects = [{ id: '3', name: 'Values Education' }],
  prompts = [{
    id: 'prompt-1',
    subjectName: 'Values Education',
    promptText: 'Describe a kind act you witnessed.',
    minWords: 25,
    dueAt: '2099-10-23T23:59:00+08:00',
    allowLate: false,
    status: 'open',
    submissionState: 'open'
  }],
  entries = [],
  subjectError = null
} = {}) {
  const calls = [];
  const api = {
    async getCurrentUser() { calls.push('user'); return session; },
    async getPortalFeatures() { calls.push('portal'); return portal; },
    async getJournalHistory() { calls.push('history'); return history; },
    async getJournalSubjects() {
      calls.push('subjects');
      if (subjectError) throw Object.assign(new Error(subjectError.message), { status: subjectError.status });
      return subjects;
    },
    async getJournalPrompts() { calls.push('prompts'); return prompts; },
    async getJournalEntries() { calls.push('entries'); return entries; }
  };
  return { api, calls, session };
}

function createJournalPageHarness(api) {
  const panel = { innerHTML: '', inserted: [], insertAdjacentHTML(markup) { this.inserted.push(markup); } };
  const list = { innerHTML: '' };
  const draftInput = { value: '' };
  const submitBtn = { disabled: false };
  const toasts = [];
  const context = vm.createContext({
    window: {
      EDUGNAY_API: api,
      EDUGNAY_CONFIG: {
        renderPanelEmptyState: ({ title, text }) => `${title}: ${text}`,

      }
    },
    document: {
      getElementById(id) {
        return id === 'current-week-panel' ? panel
          : id === 'history-list' ? list
            : id === 'entry-textarea' ? (context.currentEntry ? null : draftInput)
              : id === 'submit-btn' ? (context.currentEntry ? null : submitBtn) : null;
      }
    },
    currentPrompt: null,
    currentEntry: null,
    pastEntries: [],
    journalWindowOpen: false,
    minimumWords: 50,
    pendingDraft: null,
    journalLoadRequestId: 0,
    journalHasRendered: false,
    journalSubmitPending: false,
    formatJournalDate: () => 'Oct 18, 2026',
    formatJournalDateRange: () => 'Oct 12–18, 2026',
    renderUnsentDraft: () => '<unsent draft>',
    renderCurrentWeekPanel() { panel.innerHTML = context.currentEntry
      ? `Submitted entry: ${context.currentEntry.entryText}`
      : `Current prompt: ${context.currentPrompt?.promptText || ''}`; },
    renderHistory() { list.innerHTML = `History: ${context.pastEntries.length}`; },
    wordCount: text => text.trim().split(/\s+/).filter(Boolean).length,
    updateWordCount() { submitBtn.disabled = context.journalSubmitPending || draftInput.value.trim().split(/\s+/).filter(Boolean).length < context.minimumWords; },
    showAppToast: (message, tone) => toasts.push({ message, tone }),
    lucide: { createIcons() {} }
  });
  vm.runInContext(`${journalLoader}\nglobalThis.runJournalLoad = loadStudentJournals;`, context);
  vm.runInContext(`${journalSubmitter}\nglobalThis.runJournalSubmit = submitEntry;`, context);
  return { context, panel, list, draftInput, submitBtn, toasts };
}

function createDashboardJournalHarness(api) {
  const card = {
    innerHTML: '',
    classList: { add() {}, remove() {} },
    closest() { return { setAttribute() {} }; }
  };
  const context = vm.createContext({
    window: {
      EDUGNAY_API: api,
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: ({ title, text }) => `${title}: ${text}`,

      },
      lucide: { createIcons() {} }
    },
    document: { getElementById: id => id === 'student-journal-card' ? card : null },
    JOURNAL: [],
    renderStudentJournal() { card.innerHTML = `Current prompt: ${context.JOURNAL[0]?.prompt || ''}`; },
    lucide: { createIcons() {} }
  });
  vm.runInContext(`${dashboardJournalLoader}\nglobalThis.runDashboardJournalLoad = loadStudentJournalCard;`, context);
  return { context, card };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('JHS journal prompt loads on Dashboard and My Journal without schoolLevel in the session', async () => {
  const dashboardApi = createJournalApi();
  const dashboard = createDashboardJournalHarness(dashboardApi.api);
  await dashboard.context.runDashboardJournalLoad();

  const journalApi = createJournalApi();
  const journal = createJournalPageHarness(journalApi.api);
  await journal.context.runJournalLoad();

  assert.equal(Object.hasOwn(dashboardApi.session, 'schoolLevel'), false);
  assert.equal(Object.hasOwn(journalApi.session, 'schoolLevel'), false);
  assert.equal(dashboard.context.JOURNAL[0].prompt, 'Describe a kind act you witnessed.');
  assert.match(dashboard.card.innerHTML, /Describe a kind act you witnessed/);
  assert.equal(journal.context.currentPrompt.promptText, 'Describe a kind act you witnessed.');
  assert.match(journal.panel.innerHTML, /Describe a kind act you witnessed/);
  assert.ok(dashboardApi.calls.indexOf('subjects') < dashboardApi.calls.indexOf('prompts'));
  assert.ok(journalApi.calls.indexOf('subjects') < journalApi.calls.indexOf('prompts'));
});

test('student without active JHS enrollment sees no past entries or current prompts', async () => {
  const api = createJournalApi({
    history: {
      prompts: [],
      entries: [{
        id: 'past-1', promptId: 'old-prompt', journalSubjectName: 'Values Education',
        submittedAt: '2025-06-12T05:00:00.000Z', entryText: 'A past reflection.', score: null, maxScore: 25
      }]
    },
    portal: { features: { journalsEnabled: true }, journalSubjectEligible: false }
  });
  const journal = createJournalPageHarness(api.api);
  await journal.context.runJournalLoad();

  assert.equal(journal.context.currentPrompt, null);
  assert.equal(journal.context.pastEntries.length, 0);
  assert.match(journal.panel.innerHTML, /eligible Junior High School students/);
  assert.equal(journal.panel.inserted.length, 0);
  assert.equal(api.calls.includes('prompts'), false);
  assert.equal(api.calls.includes('entries'), false);
  assert.equal(api.calls.includes('history'), false);
});

test('disabled school Journals do not request or show student history', async () => {
  const api = createJournalApi({
    portal: { features: { journalsEnabled: false }, journalSubjectEligible: false },
    history: {
      prompts: [],
      entries: [{
        id: 'past-1', promptId: 'old-prompt', journalSubjectName: 'Values Education',
        submittedAt: '2025-06-12T05:00:00.000Z', entryText: 'A past reflection.', score: null, maxScore: 25
      }]
    }
  });
  const journal = createJournalPageHarness(api.api);
  await journal.context.runJournalLoad();

  assert.equal(journal.context.pastEntries.length, 0);
  assert.match(journal.panel.innerHTML, /eligible Junior High School students/);
  assert.equal(api.calls.includes('history'), false);
  assert.equal(api.calls.includes('subjects'), false);
  assert.equal(api.calls.includes('prompts'), false);
});

test('student journal keeps rendered content during a slow or failed refresh', async () => {
  const { api } = createJournalApi();
  const journal = createJournalPageHarness(api);
  await journal.context.runJournalLoad();
  const currentPanel = journal.panel.innerHTML;
  const currentHistory = journal.list.innerHTML;
  const gate = deferred();
  api.getCurrentUser = () => gate.promise;

  const refresh = journal.context.runJournalLoad();
  assert.equal(journal.panel.innerHTML, currentPanel);
  assert.equal(journal.list.innerHTML, currentHistory);
  gate.reject(new Error('Connection lost'));
  await refresh;
  assert.equal(journal.panel.innerHTML, currentPanel);
  assert.equal(journal.list.innerHTML, currentHistory);
  assert.equal(journal.toasts.at(-1).tone, 'error');
});

test('successful submission stays read-only if refresh fails and ignores an older refresh', async () => {
  const { api } = createJournalApi();
  const journal = createJournalPageHarness(api);
  await journal.context.runJournalLoad();
  journal.draftInput.value = 'reflection '.repeat(25);
  const entry = { id: 'entry-1', promptId: 'prompt-1', entryText: journal.draftInput.value.trim(), score: null, submittedAt: '2026-10-18T12:00:00+08:00' };
  api.submitJournalEntry = async () => {
    api.getJournalEntries = async () => [entry];
    return entry;
  };
  const oldGate = deferred();
  const newGate = deferred();
  let userCalls = 0;
  api.getCurrentUser = () => (++userCalls === 1 ? oldGate.promise : newGate.promise);
  const olderRefresh = journal.context.runJournalLoad();
  const submission = journal.context.runJournalSubmit();
  await new Promise(resolve => setImmediate(resolve));

  assert.match(journal.panel.innerHTML, /Submitted entry: reflection/);
  assert.equal(journal.list.innerHTML, 'History: 0');
  assert.equal(journal.submitBtn.disabled, true);
  assert.equal(journal.context.pendingDraft, null);
  newGate.reject(new Error('Refresh failed'));
  await submission;
  oldGate.resolve({ id: '70', role: 'student' });
  await olderRefresh;
  assert.match(journal.panel.innerHTML, /Submitted entry: reflection/);
  assert.equal(journal.context.currentEntry.id, 'entry-1');
  assert.equal(journal.toasts[0].tone, 'success');
  assert.equal(journal.toasts[1].tone, 'error');
});

test('background refresh keeps submission disabled until the server responds', async () => {
  const { api } = createJournalApi();
  const journal = createJournalPageHarness(api);
  await journal.context.runJournalLoad();
  journal.draftInput.value = 'reflection '.repeat(25);
  const entry = { id: 'entry-1', promptId: 'prompt-1', entryText: journal.draftInput.value.trim(), score: null };
  const gate = deferred();
  let submitCalls = 0;
  api.submitJournalEntry = () => { submitCalls += 1; return gate.promise; };

  const submission = journal.context.runJournalSubmit();
  await journal.context.runJournalLoad();
  assert.equal(journal.submitBtn.disabled, true);
  await journal.context.runJournalSubmit();
  assert.equal(submitCalls, 1);
  api.getJournalEntries = async () => [entry];
  gate.resolve(entry);
  await submission;
  assert.match(journal.panel.innerHTML, /Submitted entry: reflection/);
});

test('failed submission retains the draft and allows retry', async () => {
  const { api } = createJournalApi();
  const journal = createJournalPageHarness(api);
  await journal.context.runJournalLoad();
  journal.draftInput.value = 'reflection '.repeat(25);
  api.submitJournalEntry = async () => { throw new Error('Submission failed'); };

  await journal.context.runJournalSubmit();
  assert.equal(journal.context.currentEntry, null);
  assert.equal(journal.draftInput.value, 'reflection '.repeat(25));
  assert.equal(journal.submitBtn.disabled, false);
  assert.equal(journal.toasts.at(-1).tone, 'error');
});

test('confirmed loss of journal access clears the previous entry and history', async () => {
  const { api } = createJournalApi();
  const journal = createJournalPageHarness(api);
  await journal.context.runJournalLoad();
  api.getPortalFeatures = async () => ({ features: { journalsEnabled: false }, journalSubjectEligible: false });

  await journal.context.runJournalLoad();
  assert.match(journal.panel.innerHTML, /Journals are unavailable/);
  assert.equal(journal.list.innerHTML, '');
  assert.equal(journal.context.currentEntry, null);
});
