const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');

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
  const metrics = [{ textContent: '' }, { textContent: '', append(node) { this.detail = node.textContent; } }];
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
    publishedGradeFor: () => null,
    setFeedback: (_host, message) => feedback.push(message),
    toast: message => toasts.push(message),
    window: { TeacherClassViews: { updateSectionHeaderFromGradebook() { headerUpdates++; } } },
    document: { createElement: () => ({}) }
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

test('correcting a published SHS score keeps the republish notice', async () => {
  const save = source.match(/async function saveScore\([\s\S]*?(?=\n  function setPublishPreview\()/)?.[0];
  const data = {
    term: { id: 3 }, scope: { kind: 'core', policy: { components: [] } },
    items: [{ id: 4, usedInPublishedGrades: true }], scores: [], students: [], published: []
  };
  const input = { dataset: { scoreItem: '4', studentId: '9' }, value: '20', disabled: false,
    parentElement: { querySelector: () => ({ value: 'Corrected source record' }) } };
  const toasts = [];
  const context = vm.createContext({
    activeContext: { host: { querySelectorAll: () => [] }, data }, resultsVersion: 0,
    api: () => ({ correctShsScore: async () => ({}), getShsGradeWorkspace: async () => ({
      scores: [], students: [], published: []
    }) }),
    setFeedback() {}, toast: message => toasts.push(message),
    window: { TeacherClassViews: { updateSectionHeaderFromGradebook() {} } }
  });
  vm.runInContext(save, context);
  await context.saveScore(input, data, { sectionId: 7 }, true, () => {});
  assert.deepEqual(toasts, ['Score correction recorded. Republish grades to update the published result.']);
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
