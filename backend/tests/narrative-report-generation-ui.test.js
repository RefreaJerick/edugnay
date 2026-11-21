const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/narrative-reports.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/adviser/narrative-reports.css'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-reports.html'), 'utf8');
const generation = script.slice(script.indexOf('  function modalGenerationCandidates('), script.indexOf('  function appendAction('));

test('generation list uses two columns with scrollbar space and one mobile column', () => {
  assert.match(styles, /#gen-modal \.gen-student-notes\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*padding-right:\s*14px;/s);
  assert.match(styles, /#gen-modal\.is-compact-list \.gen-modal\s*\{[^}]*max-width:\s*600px;/);
  assert.match(styles, /#gen-modal\.is-compact-list \.gen-student-notes\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  const generationStyles = styles.slice(styles.indexOf('/* Weekly report generation dialog. */'));
  assert.match(generationStyles, /@media \(max-width:\s*760px\)[\s\S]*?#gen-modal \.gen-student-notes\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(page, /id="gen-journal-source" hidden/);
  assert.match(page, /id="pipeline-journal" hidden/);
  assert.match(page, /data-lucide="user-check" aria-hidden="true"><\/i>Confirmed attendance/);
  assert.match(page, /data-lucide="clipboard-check" aria-hidden="true"><\/i>Assignment completion/);
  assert.match(page, /id="gen-journal-source" hidden><i data-lucide="notebook-pen" aria-hidden="true"><\/i>Journal reflections/);
  assert.match(styles, /#gen-modal \.gen-included li svg\s*\{[^}]*color:\s*var\(--theme-accent-text\);/);
});

test('generation has compact progress and result views', () => {
  assert.match(styles, /#gen-modal\.is-generating \.gen-modal\s*\{[^}]*width:\s*min\(600px,\s*calc\(100vw\s*-\s*20px\)\);[^}]*max-width:\s*600px;/);
  assert.match(styles, /#gen-modal\.is-result \.gen-modal\s*\{[^}]*max-width:\s*600px;/);
  assert.match(page, /id="gen-result"[^>]*hidden/);
  assert.match(page, /id="gen-view-reports"/);
  assert.match(page, /id="gen-back-to-form"/);
});

function harness({ count = 7, failedIds = [], blockedIds = [], requestError, refreshError, gate } = {}) {
  const students = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), displayName: `Learner ${i + 1}` }));
  let remaining = students;
  const saved = new Set();
  const requests = [], ranges = [], toasts = [], messages = {};
  const renderedIcons = [];
  const notes = students.map(student => ({ dataset: { studentId: student.id }, value: 'QA note', disabled: false }));
  let focused = null;
  let closed = null;
  const elements = Object.fromEntries(['gen-progress', 'gen-progress-detail', 'start-generation-label', 'start-generation', 'gen-draft-count', 'gen-count', 'gen-close', 'gen-cancel', 'gen-students', 'gen-result', 'gen-result-title', 'gen-result-icon', 'gen-result-summary', 'gen-result-failures', 'gen-view-reports', 'gen-back-to-form', 'gen-result-close', 'weekly-reports-title']
    .map(id => [id, {
      id, hidden: true, disabled: false, attributes: {}, textContent: id === 'gen-cancel' ? 'Cancel' : '',
      setAttribute(key, value) { this.attributes[key] = value; },
      replaceChildren() { this.children = []; },
      append(child) { (this.children ||= []).push(child); },
      focus() { focused = id; }
    }]));
  elements['gen-result-close'].hidden = false;
  elements['weekly-reports-title'].scrollIntoView = options => { elements['weekly-reports-title'].scrollOptions = options; };
  const dialog = {
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
    focus() { focused = 'dialog'; }
  };
  elements['gen-modal'] = {
    classList: {
      values: new Set(),
      add(...names) { names.forEach(name => this.values.add(name)); },
      remove(...names) { names.forEach(name => this.values.delete(name)); },
      toggle(name, value) { value ? this.values.add(name) : this.values.delete(name); }
    },
    querySelector: () => dialog
  };
  elements['gen-students'].querySelectorAll = selector => selector === '.gen-student-note-row' ? [] : notes;
  const state = { busy: false, generationEnabled: true, evidence: { section: { id: '16' }, reportWeek: { startDate: '2026-10-19' } } };
  const context = {
    state, $: id => elements[id], generationCandidates: () => remaining,
    document: { createElement(tag) { return { tag, children: [], setAttribute() {}, append(...items) { this.children.push(...items); } }; } },
    window: { lucide: { createIcons() {
      const match = elements['gen-result-icon'].innerHTML.match(/data-lucide="([^"]+)"|class="lucide lucide-([^"]+)"/);
      if (match) renderedIcons.push(match[1] || match[2]);
    } } },
    studentInitials: student => student.displayName.split(' ').map(part => part[0]).join(''),
    closeModal: id => { closed = id; },
    setMessage(id, text, error) { messages[id] = { text, error }; },
    showAppToast: message => toasts.push(message),
    async loadWeek() {
      if (refreshError) { state.evidence = null; return; }
      remaining = students.filter(student => !saved.has(student.id));
    },
    api: { async request(url, options) {
      const body = JSON.parse(options.body);
      requests.push(body);
      ranges.push(elements['gen-progress-detail'].textContent);
      if (requests.length === 1 && gate) await gate;
      if (requestError) throw Object.assign(new Error('Provider unavailable'), { status: 503 });
      const results = body.studentIds.map(id => {
        if (blockedIds.includes(id)) return { studentId: String(id), status: 'skipped', reason: 'another_section', message: 'This learner already has a report for this week in another section.' };
        if (failedIds.includes(id)) return { studentId: String(id), status: 'error', message: 'Generation failed' };
        saved.add(String(id));
        return { studentId: String(id), status: 'generated' };
      });
      return { results, progress: { generated: results.filter(result => result.status === 'generated').length } };
    } }
  };
  const actions = vm.runInNewContext(`${generation}\n({ generate, backToGenerationForm, viewGeneratedReports })`, context);
  return { ...actions, elements, dialog, notes, state, requests, ranges, toasts, messages, renderedIcons,
    get focused() { return focused; }, get closed() { return closed; } };
}

test('generation switches to two columns at four learners and back below four', () => {
  const values = new Set();
  const setGenerationListLayout = vm.runInNewContext(
    `${script.slice(script.indexOf('  function setGenerationListLayout('), script.indexOf('  function setGenerationLoading('))}\nsetGenerationListLayout`,
    { $: () => ({ classList: { add: name => values.add(name), remove: name => values.delete(name) } }) }
  );
  for (const count of [1, 2, 3]) {
    setGenerationListLayout(count);
    assert.equal(values.has('is-compact-list'), true);
  }
  setGenerationListLayout(4);
  assert.equal(values.has('is-compact-list'), false);
  setGenerationListLayout(3);
  assert.equal(values.has('is-compact-list'), true);
});

test('generation shows real batch ranges, locks controls, and prevents duplicate requests', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const h = harness({ gate });
  const pending = h.generate();
  assert.equal(h.elements['gen-progress'].hidden, false);
  assert.equal(h.elements['start-generation-label'].textContent, 'Generating...');
  assert.equal(h.elements['start-generation'].attributes['aria-busy'], 'true');
  assert.equal(h.elements['gen-close'].disabled, true);
  assert.equal(h.elements['gen-modal'].classList.values.has('is-generating'), true);
  assert.equal(h.dialog.attributes['aria-labelledby'], 'gen-loading-title');
  assert.equal(h.dialog.attributes['aria-busy'], 'true');
  assert.equal(h.focused, 'dialog');
  assert.ok(h.notes.every(note => note.disabled));
  await h.generate();
  assert.equal(h.requests.length, 1);
  finish();
  await pending;
  assert.deepEqual(h.ranges, ['Processing learners 1–5 of 7.', 'Processing learners 6–7 of 7.']);
  assert.equal(h.elements['gen-progress'].hidden, true);
  assert.equal(h.elements['start-generation-label'].textContent, 'Generate 0 drafts');
  assert.equal(h.elements['gen-draft-count'].textContent, '0 drafts will be created');
  assert.equal(h.elements['start-generation'].disabled, true);
  assert.equal(h.elements['gen-close'].disabled, false);
  assert.equal(h.elements['gen-modal'].classList.values.has('is-generating'), false);
  assert.equal(h.elements['gen-modal'].classList.values.has('is-success'), true);
  assert.equal(h.elements['gen-result-title'].textContent, 'Reports generated');
  assert.equal(h.renderedIcons.at(-1), 'check');
  assert.equal(h.elements['gen-result-summary'].textContent, '7 drafts generated. Review them in the weekly reports list.');
  assert.equal(h.elements['gen-view-reports'].hidden, false);
  assert.equal(h.elements['gen-result-close'].hidden, true);
  assert.equal(h.elements['gen-back-to-form'].hidden, true);
  assert.equal(h.dialog.attributes['aria-labelledby'], 'gen-result-title');
  assert.equal(h.dialog.attributes['aria-busy'], 'false');
  assert.equal(h.focused, 'gen-view-reports');
  assert.ok(h.notes.every(note => !note.disabled));
  assert.equal(h.toasts.length, 1);
  assert.equal(h.requests[0].notesByStudent['1'], 'QA note');
});

test('generation uses singular progress and result copy for one learner', async () => {
  const h = harness({ count: 1 });
  await h.generate();
  assert.deepEqual(h.ranges, ['Processing learner 1 of 1.']);
  assert.equal(h.focused, 'gen-view-reports');
  assert.equal(h.elements['gen-result-summary'].textContent, '1 draft generated. Review it in the weekly reports list.');
  assert.equal(h.elements['gen-progress'].hidden, true);
});

test('View reports closes the modal and focuses the weekly reports list', async () => {
  const h = harness({ count: 1 });
  await h.generate();
  h.viewGeneratedReports();
  assert.equal(h.closed, 'gen-modal');
  assert.equal(h.focused, 'weekly-reports-title');
  assert.equal(h.elements['weekly-reports-title'].scrollOptions.block, 'start');
});

for (const [name, options] of [
  ['partial failure', { failedIds: [2] }],
  ['total provider failure', { requestError: true }],
  ['unexpected refresh failure', { refreshError: true }]
]) {
  test(`generation clears its loading state after ${name}`, async () => {
    const h = harness(options);
    await h.generate();
    assert.equal(h.state.busy, false);
    assert.equal(h.elements['gen-progress'].hidden, true);
    assert.equal(h.elements['start-generation'].attributes['aria-busy'], 'false');
    assert.equal(h.elements['start-generation-label'].textContent,
      options.failedIds ? 'Generate 1 draft' : 'Generate 7 drafts');
    assert.equal(h.elements['gen-close'].disabled, false);
    assert.ok(h.notes.every(note => !note.disabled));
    assert.equal(h.elements['gen-result'].hidden, false);
    assert.equal(h.elements['gen-result-close'].hidden, options.failedIds ? true
      : options.refreshError ? false : options.requestError ? false : true);
    assert.equal(h.focused, options.refreshError ? 'gen-result-close'
      : options.requestError ? 'gen-back-to-form' : 'gen-view-reports');
    assert.equal(h.toasts.length, options.failedIds || options.refreshError ? 1 : 0);
  });
}

test('a protected report cannot be retried from the result screen', async () => {
  const h = harness({ count: 1, blockedIds: [1] });
  await h.generate();
  assert.equal(h.elements['gen-result-title'].textContent, 'No reports generated');
  assert.equal(h.renderedIcons.at(-1), 'exclamation-mark');
  assert.match(h.elements['gen-result-icon'].innerHTML, /<path d="M12 15V4m0 16h\.01"><\/path>/);
  assert.equal(h.elements['gen-result-close'].hidden, false);
  assert.equal(h.elements['gen-back-to-form'].hidden, true);
  assert.equal(h.elements['gen-result-failures'].children[0].children[1].children[1].textContent,
    'This learner already has a report for this week in another section.');
});

test('mixed results show generated reports and retry only failed learners', async () => {
  const h = harness({ count: 3, failedIds: [2], blockedIds: [3] });
  await h.generate();
  assert.equal(h.elements['gen-result-title'].textContent, 'Some reports generated');
  assert.equal(h.renderedIcons.at(-1), 'exclamation-mark');
  assert.match(h.elements['gen-result-icon'].innerHTML, /<path d="M12 15V4m0 16h\.01"><\/path>/);
  assert.equal(h.elements['gen-view-reports'].hidden, false);
  assert.equal(h.elements['gen-result-close'].hidden, true);
  assert.equal(h.elements['gen-back-to-form'].hidden, false);
  h.backToGenerationForm();
  assert.equal(h.elements['start-generation-label'].textContent, 'Generate 1 draft');
  await h.generate();
  assert.deepEqual(h.requests[1].studentIds, [2]);
  assert.equal(h.requests[1].notesByStudent['2'], 'QA note');
});

test('learner note rows start closed, allow one open row, and keep text when closed', () => {
  class Element {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.hidden = false;
      this.value = '';
      this.listeners = {};
      this.ownText = '';
    }
    set textContent(value) { this.ownText = value; }
    get textContent() { return this.ownText || this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    replaceChildren() { this.children = []; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    focus() { this.focused = true; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(child => [child, ...child.allDescendants()]);
      return descendants.filter(child => selector === 'span' ? child.tagName === 'span'
        : selector === '.gen-note-toggle' ? child.className === 'gen-note-toggle'
          : selector === '.gen-student-note-name' ? child.className === 'gen-student-note-name'
            : selector === '.gen-student-note-editor:not([hidden])' ? child.className === 'gen-student-note-editor' && !child.hidden
              : selector === 'textarea' && child.tagName === 'textarea');
    }
    allDescendants() { return this.children.flatMap(child => [child, ...child.allDescendants()]); }
  }
  const elements = Object.fromEntries(['gen-subtitle', 'gen-count', 'gen-draft-count', 'gen-students', 'gen-journal-source', 'gen-cancel', 'gen-result']
    .map(id => [id, new Element()]));
  elements['gen-modal'] = { classList: {
    values: new Set(),
    add(name) { this.values.add(name); },
    remove(name) { this.values.delete(name); }
  } };
  elements['gen-cancel'].textContent = 'Close';
  const students = [{ id: '1', displayName: 'Alyssa Lim', avatarUrl: '/api/users/1/avatar?v=2' }, { id: '2', displayName: 'Ethan Lim' }];
  const avatarCalls = [];
  const state = { busy: false, generationEnabled: true, evidence: {
    section: { gradeLevel: 'Grade 11', name: 'Section B', journalApplicable: false },
    reportWeek: { startDate: '2026-11-16', endDate: '2026-11-22' }
  } };
  const source = script.slice(script.indexOf('  function showGeneration('), script.indexOf('  function setGenerationLoading('));
  const showGeneration = vm.runInNewContext(`${source}\nshowGeneration`, {
    state,
    $: id => elements[id], generationCandidates: () => students,
    document: { createElement: tag => new Element(tag) },
    window: { EDUGNAY_AVATAR: { render(element, person, options) { avatarCalls.push({ element, person, options }); } } },
    studentInitials: student => student.displayName.split(' ').map(part => part[0]).join(''),
    formatDate: date => date,
    setGenerationLoading() {}, setMessage() {}, openModal() {}
  });
  showGeneration();
  assert.equal(elements['gen-modal'].classList.values.has('is-compact-list'), true);
  assert.equal(elements['gen-result'].hidden, true);
  assert.equal(elements['gen-cancel'].textContent, 'Cancel');
  const [first, second] = elements['gen-students'].children;
  const firstEditor = first.querySelector('.gen-student-note-editor:not([hidden])') || first.children[1];
  const secondEditor = second.children[1];
  const firstToggle = first.querySelector('.gen-note-toggle');
  const secondToggle = second.querySelector('.gen-note-toggle');
  assert.equal(elements['gen-draft-count'].textContent, '2 drafts will be created');
  assert.equal(elements['gen-journal-source'].hidden, true);
  assert.equal(avatarCalls.length, 2);
  assert.equal(avatarCalls[0].person.avatarUrl, '/api/users/1/avatar?v=2');
  assert.equal(avatarCalls[1].person.avatarUrl, undefined);
  assert.equal(avatarCalls[0].options.size, 'compact');
  assert.equal(elements['gen-subtitle'].textContent, 'Grade 11 · Section B · 2026-11-16–2026-11-22');
  assert.equal(firstEditor.hidden, true);
  assert.equal(secondEditor.hidden, true);
  firstToggle.listeners.click();
  assert.equal(firstToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(firstEditor.hidden, false);
  const note = firstEditor.querySelector('textarea');
  note.value = 'Keep this observation';
  secondToggle.listeners.click();
  assert.equal(firstEditor.hidden, true);
  assert.equal(secondEditor.hidden, false);
  assert.equal(firstToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(note.value, 'Keep this observation');
  secondToggle.listeners.click();
  assert.equal(secondEditor.hidden, true);
  assert.equal(elements['gen-students'].querySelectorAll('textarea').length, 2);
  state.evidence.section.journalApplicable = true;
  showGeneration();
  assert.equal(elements['gen-journal-source'].hidden, false);
});
