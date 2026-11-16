const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/narrative-reports.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/adviser/narrative-reports.css'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-reports.html'), 'utf8');
const generation = script.slice(script.indexOf('  function setGenerationLoading('), script.indexOf('  function appendAction('));

test('generation list uses two columns with scrollbar space and one mobile column', () => {
  assert.match(styles, /#gen-modal \.gen-student-notes\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*padding-right:\s*14px;/s);
  const generationStyles = styles.slice(styles.indexOf('/* Weekly report generation dialog. */'));
  assert.match(generationStyles, /@media \(max-width:\s*760px\)[\s\S]*?#gen-modal \.gen-student-notes\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(page, /id="gen-journal-source" hidden/);
  assert.match(page, /id="pipeline-journal" hidden/);
  assert.match(page, /data-lucide="user-check" aria-hidden="true"><\/i>Confirmed attendance/);
  assert.match(page, /data-lucide="clipboard-check" aria-hidden="true"><\/i>Assignment completion/);
  assert.match(page, /id="gen-journal-source" hidden><i data-lucide="notebook-pen" aria-hidden="true"><\/i>Journal reflections/);
  assert.match(styles, /#gen-modal \.gen-included li svg\s*\{[^}]*color:\s*var\(--theme-accent-text\);/);
});

function harness({ count = 7, failedIds = [], requestError, refreshError, gate } = {}) {
  const students = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), displayName: `Learner ${i + 1}` }));
  let remaining = students;
  const saved = new Set();
  const requests = [], ranges = [], toasts = [], messages = {};
  const notes = students.map(student => ({ dataset: { studentId: student.id }, value: 'QA note', disabled: false }));
  let focused = null;
  const elements = Object.fromEntries(['gen-progress', 'gen-progress-detail', 'start-generation-label', 'start-generation', 'gen-draft-count', 'gen-count', 'gen-close', 'gen-students']
    .map(id => [id, {
      id, hidden: true, disabled: false, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      focus() { focused = id; }
    }]));
  const dialog = {
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
    focus() { focused = 'dialog'; }
  };
  elements['gen-modal'] = {
    classList: { values: new Set(), toggle(name, value) { value ? this.values.add(name) : this.values.delete(name); } },
    querySelector: () => dialog
  };
  elements['gen-students'].querySelectorAll = selector => selector === '.gen-student-note-row' ? [] : notes;
  const state = { busy: false, generationEnabled: true, evidence: { section: { id: '16' }, reportWeek: { startDate: '2026-10-19' } } };
  const context = {
    state, $: id => elements[id], generationCandidates: () => remaining,
    setMessage(id, text, error) { messages[id] = { text, error }; },
    showAppToast: message => toasts.push(message),
    async loadWeek() {
      if (refreshError) throw new Error('Refresh failed');
      remaining = students.filter(student => !saved.has(student.id));
    },
    api: { async request(url, options) {
      const body = JSON.parse(options.body);
      requests.push(body);
      ranges.push(elements['gen-progress-detail'].textContent);
      if (requests.length === 1 && gate) await gate;
      if (requestError) throw Object.assign(new Error('Provider unavailable'), { status: 503 });
      const results = body.studentIds.map(id => {
        if (failedIds.includes(id)) return { studentId: String(id), status: 'error', message: 'Generation failed' };
        saved.add(String(id));
        return { studentId: String(id), status: 'generated' };
      });
      return { results, progress: { generated: results.filter(result => result.status === 'generated').length } };
    } }
  };
  const generate = vm.runInNewContext(`${generation}\ngenerate`, context);
  return { generate, elements, dialog, notes, state, requests, ranges, toasts, messages, get focused() { return focused; } };
}

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
  assert.equal(h.dialog.attributes['aria-labelledby'], 'gen-title');
  assert.equal(h.dialog.attributes['aria-busy'], 'false');
  assert.equal(h.focused, 'gen-close');
  assert.ok(h.notes.every(note => !note.disabled));
  assert.equal(h.toasts.length, 1);
  assert.equal(h.requests[0].notesByStudent['1'], 'QA note');
});

test('generation uses singular progress copy for one learner and restores focus to the close control when all are done', async () => {
  const h = harness({ count: 1 });
  await h.generate();
  assert.deepEqual(h.ranges, ['Processing learner 1 of 1.']);
  assert.equal(h.focused, 'gen-close');
  assert.equal(h.elements['gen-progress'].hidden, true);
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
    assert.equal(h.messages['gen-message'].error, true);
    assert.equal(h.focused, 'start-generation');
    assert.equal(h.toasts.length, options.failedIds ? 1 : 0);
  });
}

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
  const elements = Object.fromEntries(['gen-subtitle', 'gen-count', 'gen-draft-count', 'gen-students', 'gen-journal-source']
    .map(id => [id, new Element()]));
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
