const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');

test('SHS save feedback uses the shared error styling and clears it after recovery', () => {
  const feedbackSource = source.match(/function setFeedback\(host, message, isError = false\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(feedbackSource);
  const classes = new Set();
  const status = { textContent: '', role: '', setAttribute(_name, value) { this.role = value; } };
  const feedback = { classList: { toggle(name, enabled) {
    if (enabled) classes.add(name);
    else classes.delete(name);
  } } };
  const host = { querySelector: selector => selector === '#scoreSaveStatus' ? status : feedback };
  const context = vm.createContext({});
  vm.runInContext(feedbackSource, context);
  context.setFeedback(host, 'Score not saved.', true);
  assert.equal(status.role, 'alert');
  assert.equal(classes.has('is-error'), true);
  context.setFeedback(host, 'All changes saved');
  assert.equal(status.role, 'status');
  assert.equal(classes.has('is-error'), false);
});

function scoreQueueHarness(saveScore) {
  const timers = new Map();
  let timerId = 0;
  const status = { textContent: '', setAttribute() {} };
  const retry = { hidden: true };
  const host = { querySelector: selector => selector === '#scoreSaveRetry' ? retry : status };
  const data = { items: [{ id: 4, maxScore: 25 }] };
  const context = vm.createContext({
    pendingScores: new Map(), scoreSaveChains: new Map(), scoreSaveQueue: Promise.resolve(), scoreEditVersion: 0,
    updateExportState() {},
    activeContext: { host, data }, saveScore, setFeedback: (_host, message) => { status.textContent = message; },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), Promise, Number, Math
  });
  for (const name of ['updateSaveStatus', 'validScore', 'savePendingScore', 'scheduleScoreSave', 'flushPendingScores']) {
    const body = source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
    assert.ok(body, `${name} should exist`);
    vm.runInContext(body, context);
  }
  const input = { dataset: { scoreItem: '4', studentId: '9', savedValue: '' }, value: '' };
  const fireTimers = () => {
    const callbacks = [...timers.values()].map(timer => timer.callback);
    timers.clear();
    callbacks.forEach(callback => callback());
  };
  return { context, host, data, input, timers, status, retry, fireTimers };
}

test('SHS core and elective scores save the latest value after typing without blur', async () => {
  for (const kind of ['core', 'elective']) {
    const sent = [];
    const h = scoreQueueHarness(async (_input, _data, _scope, _writable, _reload, value) => {
      sent.push(value);
      return true;
    });
    h.data.scope = { kind };
    h.input.value = '1';
    h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
    h.input.value = '12';
    h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, 600);
    assert.equal(h.status.textContent, 'Unsaved changes');
    h.fireTimers();
    assert.equal(await h.context.flushPendingScores(), true);
    assert.deepEqual(sent, ['12']);
    assert.equal(h.input.dataset.savedValue, '12');
    assert.equal(h.status.textContent, 'All changes saved');
    h.context.scheduleScoreSave(h.input, h.data, {}, () => {}, true);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(sent, ['12']);
  }
});

test('SHS period changes flush pending scores from more than one learner', async () => {
  const sent = [];
  const h = scoreQueueHarness(async (input, _data, _scope, _writable, _reload, value) => {
    sent.push(`${input.dataset.studentId}:${value}`);
    return true;
  });
  h.input.value = '7';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  const other = { dataset: { scoreItem: '4', studentId: '10', savedValue: '' }, value: '9' };
  h.context.scheduleScoreSave(other, h.data, {}, () => {});
  assert.equal(await h.context.flushPendingScores(), true);
  assert.deepEqual(sent, ['9:7', '10:9']);
  assert.equal(h.timers.size, 0);
});

test('SHS score saves stay ordered when the same field changes during a request', async () => {
  let finishFirst;
  const sent = [];
  const h = scoreQueueHarness(async (_input, _data, _scope, _writable, _reload, value) => {
    sent.push(value);
    if (value === '10') await new Promise(resolve => { finishFirst = resolve; });
    return true;
  });
  h.input.value = '10';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  h.fireTimers();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(sent, ['10']);
  h.input.value = '15';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  h.fireTimers();
  finishFirst();
  assert.equal(await h.context.flushPendingScores(), true);
  assert.deepEqual(sent, ['10', '15']);
  assert.equal(h.input.dataset.savedValue, '15');
});

test('SHS invalid scores block a period reload; clearing a score saves a blank value', async () => {
  const sent = [];
  const h = scoreQueueHarness(async (_input, _data, _scope, _writable, _reload, value) => {
    sent.push(value);
    return true;
  });
  h.input.value = '26';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  assert.equal(h.timers.size, 0);
  assert.equal(await h.context.flushPendingScores(), false);
  assert.match(h.status.textContent, /Score not saved/);
  h.input.value = '10';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  assert.equal(await h.context.flushPendingScores(), true);
  assert.deepEqual(sent, ['10']);
  h.input.value = '';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  assert.equal(await h.context.flushPendingScores(), true);
  assert.deepEqual(sent, ['10', '']);
});

test('SHS failed scores remain visible for retry', async () => {
  let attempts = 0;
  const h = scoreQueueHarness(async () => ++attempts > 1);
  h.input.value = '8';
  h.context.scheduleScoreSave(h.input, h.data, {}, () => {});
  assert.equal(await h.context.flushPendingScores(), false);
  assert.equal(h.retry.hidden, false);
  const record = h.context.pendingScores.get('9:4');
  record.failed = false;
  record.promise = null;
  assert.equal(await h.context.savePendingScore(record), true);
  assert.equal(h.context.pendingScores.size, 0);
  assert.equal(h.retry.hidden, true);
  assert.equal(attempts, 2);
});

test('returning to the same SHS score tab keeps its mounted table', async () => {
  const show = source.match(/function show\(host, scope\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(show);
  const host = {};
  let mounts = 0;
  const context = vm.createContext({
    activeContext: { host, scope: { sectionId: '7', subjectId: '4' } }, pendingMount: null,
    mount: async () => { mounts++; return true; }, Promise
  });
  vm.runInContext(show, context);
  assert.equal(await context.show(host, { sectionId: '7', subjectId: '4' }), true);
  assert.equal(mounts, 0);
  await context.show(host, { sectionId: '7', subjectId: '5' });
  assert.equal(mounts, 1);
});

test('refresh waits for an in-progress SHS score tab load', async () => {
  const refresh = source.match(/async function refresh\(\) \{[\s\S]*?(?=\n  function show\()/)?.[0];
  assert.ok(refresh);
  let finishLoad;
  const pending = new Promise(resolve => { finishLoad = resolve; });
  let reloads = 0;
  const context = vm.createContext({ pendingMount: { promise: pending }, activeContext: null });
  vm.runInContext(refresh, context);
  const updating = context.refresh();
  context.activeContext = { data: { term: { id: 3 } }, reload: async termId => { reloads++; return termId === 3; } };
  finishLoad(true);
  assert.equal(await updating, true);
  assert.equal(reloads, 1);
});

test('saving an SHS score updates calculated cells without reloading the table', async () => {
  const save = source.match(/async function saveScore\([\s\S]*?(?=\n  function setPublishPreview\()/)?.[0];
  assert.ok(save);
  const metrics = [{ textContent: '' }, { textContent: '', classList: { add() {}, remove() {} } }];
  const row = { dataset: { studentId: '9' }, querySelectorAll: () => metrics };
  const host = { querySelectorAll: () => [row] };
  const data = {
    term: { id: 3 }, scope: { kind: 'core', policy: { components: [{ code: 'written' }] } },
    items: [{ id: 4, maxScore: 25 }], scores: [], students: [], published: []
  };
  const input = { dataset: { scoreItem: '4', studentId: '9' }, value: '20', disabled: false,
    parentElement: { querySelector: () => null } };
  let reloads = 0;
  let headerUpdates = 0;
  const feedback = [];
  const toasts = [];
  const context = vm.createContext({
    activeContext: { host, data }, resultsVersion: 0,
    api: () => ({ saveShsScore: async () => ({ saved: true }), getShsGradeWorkspace: async () => ({
      scores: [{ studentId: 9, gradingItemId: 4, score: 20 }],
      students: [{ studentId: 9, componentAverages: { written: 80 }, termGrade: 84 }], published: []
    }) }),
    finalGradeTone: () => 'grade-pass',
    setFeedback: (_host, message) => feedback.push(message),
    toast: message => toasts.push(message),
    window: { TeacherClassViews: { updateSectionHeaderFromGradebook() { headerUpdates++; } } }
  });
  vm.runInContext(save, context);
  await context.saveScore(input, data, { sectionId: 7 }, true, () => { reloads++; });
  assert.equal(reloads, 0);
  assert.equal(input.disabled, false);
  assert.equal(metrics[0].textContent, 80);
  assert.equal(metrics[1].textContent, 84);
  assert.equal(headerUpdates, 1);
  assert.ok(feedback.includes('All changes saved'));
  assert.deepEqual(toasts, []);
});

test('core and elective score saves remind teachers whenever the term has published grades', async () => {
  const save = source.match(/async function saveScore\([\s\S]*?(?=\n  function setPublishPreview\()/)?.[0];
  for (const kind of ['core', 'elective']) {
    for (const published of [false, true]) {
      const grades = published ? [{ studentId: 9, finalGrade: 85 }] : [];
      const data = {
        term: { id: 3 }, scope: { kind, policy: { components: [] } },
        items: [{ id: 4, usedInPublishedGrades: false }], scores: [], students: [], published: grades
      };
      const input = { dataset: { scoreItem: '4', studentId: '9' }, value: '20', disabled: false };
      const toasts = [];
      const context = vm.createContext({
        activeContext: { host: { querySelectorAll: () => [] }, data }, resultsVersion: 0,
        api: () => ({ saveShsScore: async () => ({}), getShsGradeWorkspace: async () => ({
          scores: [], students: [], published: grades
        }) }),
        setFeedback() {}, toast: message => toasts.push(message),
        window: { TeacherClassViews: { updateSectionHeaderFromGradebook() {} },
          AcademixElectiveClass: { updateHeaderGradeStatus() {} } }
      });
      vm.runInContext(save, context);
      await context.saveScore(input, data, { sectionId: 7 }, true, () => {});
      assert.deepEqual(toasts, published
        ? ['Score saved. Re-publish grades to update the published result.'] : []);
    }
  }
});

test('a failed SHS score save does not show the republish reminder', async () => {
  const save = source.match(/async function saveScore\([\s\S]*?(?=\n  function setPublishPreview\()/)?.[0];
  const data = { term: { id: 3 }, items: [{ id: 4, usedInPublishedGrades: true }],
    published: [{ studentId: 9, finalGrade: 85 }] };
  const input = { dataset: { scoreItem: '4', studentId: '9' }, value: '20', disabled: false,
    focus() {} };
  const toasts = [];
  const context = vm.createContext({
    api: () => ({ saveShsScore: async () => { throw new Error('Save failed.'); } }),
    toast: (message, type) => toasts.push({ message, type })
  });
  vm.runInContext(save, context);
  await context.saveScore(input, data, { sectionId: 7 }, true, () => {});
  assert.deepEqual(toasts, [{ message: 'Save failed.', type: 'error' }]);
});

test('SHS re-publishing needs no reason and refreshes the elective Students grade source', async () => {
  const publish = source.match(/async function publish\([\s\S]*?(?=\n  function render\()/)?.[0];
  assert.ok(publish);
  for (const kind of ['core', 'elective']) {
    let payload;
    let synced;
    const fresh = { scope: { kind }, term: { id: 3 }, published: [{ finalGrade: 91 }] };
    const context = vm.createContext({
      activeContext: null,
      document: { getElementById: () => ({ disabled: false }) },
      api: () => ({ publishShsGrades: async values => { payload = values; } }),
      toast() {},
      window: {
        closeModal() {},
        TeacherClassViews: { syncShsPublishedGrades: data => { synced = data; } },
        AcademixElectiveClass: { syncShsPublishedGrades: data => { synced = data; } }
      }
    });
    vm.runInContext(publish, context);
    await context.publish({ term: { id: 3 }, published: [{ finalGrade: 85 }] }, { sectionId: 7 }, true,
      async () => { context.activeContext = { data: fresh }; return true; }, true);
    assert.deepEqual({ ...payload }, { sectionId: 7, academicTermId: 3 });
    assert.equal(synced, kind === 'elective' ? fresh : undefined);
  }
});

test('a failed results refresh keeps the successfully saved score visible', async () => {
  const save = source.match(/async function saveScore\([\s\S]*?(?=\n  function setPublishPreview\()/)?.[0];
  const data = { term: { id: 3 }, items: [{ id: 4, maxScore: 25 }] };
  const input = { dataset: { scoreItem: '4', studentId: '9' }, value: '20', disabled: false,
    parentElement: { querySelector: () => null } };
  const messages = [];
  const context = vm.createContext({
    activeContext: { host: {}, data }, resultsVersion: 0,
    api: () => ({ saveShsScore: async () => ({ saved: true }),
      getShsGradeWorkspace: async () => { throw new Error('Offline'); } }),
    setFeedback: (_host, message) => messages.push(message),
    toast: message => messages.push(message)
  });
  vm.runInContext(save, context);
  await context.saveScore(input, data, { sectionId: 7 }, true, () => { assert.fail('A score save must not reload the table.'); });
  assert.equal(input.value, '20');
  assert.equal(input.disabled, false);
  assert.ok(messages.some(message => /Score saved.*could not refresh/.test(message)));
});
