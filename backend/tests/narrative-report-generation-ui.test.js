const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/narrative-reports.js'), 'utf8');
const generation = script.slice(script.indexOf('  function setGenerationLoading('), script.indexOf('  function appendAction('));

function harness({ count = 7, failedIds = [], requestError, refreshError, gate } = {}) {
  const students = Array.from({ length: count }, (_, i) => ({ id: String(i + 1), displayName: `Learner ${i + 1}` }));
  let remaining = students;
  const saved = new Set();
  const requests = [], ranges = [], toasts = [], messages = {};
  const notes = students.map(student => ({ dataset: { studentId: student.id }, value: 'QA note', disabled: false }));
  let focused = null;
  const elements = Object.fromEntries(['gen-progress', 'gen-progress-detail', 'start-generation-label', 'start-generation', 'gen-close', 'gen-students']
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
  elements['gen-students'].querySelectorAll = () => notes;
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
  assert.equal(h.elements['start-generation-label'].textContent, 'Start Generation');
  assert.equal(h.elements['start-generation'].disabled, true);
  assert.equal(h.elements['gen-close'].disabled, false);
  assert.equal(h.elements['gen-modal'].classList.values.has('is-generating'), false);
  assert.equal(h.dialog.attributes['aria-labelledby'], 'gen-title');
  assert.equal(h.dialog.attributes['aria-busy'], 'false');
  assert.equal(h.focused, 'gen-close');
  assert.ok(h.notes.every(note => !note.disabled));
  assert.equal(h.toasts.length, 1);
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
    assert.equal(h.elements['start-generation-label'].textContent, 'Start Generation');
    assert.equal(h.elements['gen-close'].disabled, false);
    assert.ok(h.notes.every(note => !note.disabled));
    assert.equal(h.messages['gen-message'].error, true);
    assert.equal(h.focused, 'start-generation');
    assert.equal(h.toasts.length, options.failedIds ? 1 : 0);
  });
}
