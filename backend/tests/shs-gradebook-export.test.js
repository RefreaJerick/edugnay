const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');
const exporter = source.match(/function exportScoresCsv\([\s\S]*?\r?\n  \}(?=\r?\n\r?\n  function renderTable)/)?.[0];
const downloader = source.match(/async function downloadScoresCsv\([\s\S]*?\r?\n  \}(?=\r?\n\r?\n  function exportScoresCsv)/)?.[0];

test('SHS export stays unavailable when search has no visible learner', async () => {
  const visibleSource = source.match(/function visibleScoreRows\([\s\S]*?\n  \}/)?.[0];
  const stateSource = source.match(/function updateExportState\([\s\S]*?\n  \}/)?.[0];
  assert.ok(visibleSource && stateSource && downloader);
  for (const kind of ['core', 'elective']) {
    const row = { hidden: true, style: {} };
    const button = { disabled: false, title: '' };
    const host = { querySelector: () => button, querySelectorAll: () => [row] };
    const data = { items: [{ id: 1 }], students: [{ studentId: 9 }], term: { id: 3 }, scope: { kind } };
    let fetches = 0;
    const context = vm.createContext({
      activeContext: { host, data }, pendingScores: new Map(), exportPending: false,
      pendingExports: new WeakSet(),
      scoreEditVersion: 0, flushPendingScores: async () => true,
      api: () => ({ getShsGradeWorkspace: async () => { fetches++; return data; } }),
      toast() {}, exportScoresCsv() {}
    });
    vm.runInContext(`${visibleSource}; ${stateSource}; ${downloader}`, context);
    context.updateExportState(host);
    assert.equal(button.disabled, true);
    assert.equal(button.title, 'No student scores to export.');
    assert.equal(await context.downloadScoresCsv(host, data, {}, button), false);
    assert.equal(fetches, 0);
    row.hidden = false;
    context.updateExportState(host);
    assert.equal(button.disabled, false);
  }
});

test('finishing an old export does not disable export in the current term or class', async () => {
  for (const change of ['term', 'class']) {
    const visibleSource = source.match(/function visibleScoreRows\([\s\S]*?\n  \}/)?.[0];
    const stateSource = source.match(/function updateExportState\([\s\S]*?\n  \}/)?.[0];
    assert.ok(visibleSource && stateSource && downloader);
    const button = { disabled: false, title: '' };
    const row = { hidden: false, style: {} };
    const host = { querySelector: () => button, querySelectorAll: () => [row] };
    const firstData = { term: { id: 1 }, items: [{ id: 1 }], students: [{}], scope: { sectionId: 'A' } };
    const nextData = change === 'term'
      ? { term: { id: 2 }, items: [{ id: 1 }], students: [{}], scope: { sectionId: 'A' } }
      : { term: { id: 1 }, items: [{ id: 1 }], students: [{}], scope: { sectionId: 'B' } };
    const responses = [];
    const downloads = [];
    const context = vm.createContext({
      activeContext: { host, data: firstData }, pendingScores: new Map(), pendingExports: new WeakSet(),
      scoreEditVersion: 0, flushPendingScores: async () => true,
      api: () => ({ getShsGradeWorkspace: () => new Promise(resolve => responses.push(resolve)) }),
      exportScoresCsv: (_host, data) => downloads.push(data), toast() {}, Promise
    });
    vm.runInContext(`${visibleSource}; ${stateSource}; ${downloader}`, context);

    const oldExport = context.downloadScoresCsv(host, firstData, firstData.scope, button);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.disabled, true);

    context.activeContext = { host, data: nextData };
    context.updateExportState(host);
    assert.equal(button.disabled, false, `a ${change} switch should release the new gradebook`);

    const currentExport = context.downloadScoresCsv(host, nextData, nextData.scope, button);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.disabled, true, 'the current export remains marked as pending');

    responses[0]({ term: firstData.term, items: firstData.items, students: firstData.students, scope: firstData.scope });
    assert.equal(await oldExport, false, 'the old gradebook must not download');
    assert.equal(button.disabled, true, 'old cleanup must not release the current export');

    responses[1]({ term: nextData.term, items: nextData.items, students: nextData.students, scope: nextData.scope });
    assert.equal(await currentExport, true);
    assert.equal(button.disabled, false);
    assert.deepEqual(downloads, [{ term: nextData.term, items: nextData.items, students: nextData.students, scope: nextData.scope }]);
  }
});

test('SHS export fetches current results and stops without a download on failure or class change', async () => {
  assert.ok(downloader);
  const data = { term: { id: 3 } };
  const host = {};
  const button = { disabled: false };
  const downloads = [];
  const notices = [];
  let fetchResult = { term: { id: 3 }, students: [] };
  let fetches = 0;
  const context = vm.createContext({
    activeContext: { data },
    pendingScores: new Map(), scoreEditVersion: 0,
    pendingExports: new WeakSet(), visibleScoreRows: () => [{}], updateExportState() {},
    flushPendingScores: async () => true,
    api: () => ({ getShsGradeWorkspace: async values => {
      fetches++;
      assert.equal(values.academicTermId, 3);
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    } }),
    exportScoresCsv: (_host, fresh) => downloads.push(fresh),
    toast: (message, type) => notices.push({ message, type })
  });
  vm.runInContext(downloader, context);
  assert.equal(await context.downloadScoresCsv(host, data, { sectionId: 2 }, button), true);
  assert.deepEqual(downloads, [fetchResult]);
  assert.equal(button.disabled, false);
  fetchResult = new Error('Offline');
  assert.equal(await context.downloadScoresCsv(host, data, {}, button), false);
  assert.equal(downloads.length, 1);
  assert.deepEqual(notices.at(-1), { message: 'Offline', type: 'error' });
  fetchResult = { term: { id: 3 } };
  context.activeContext = { data: {} };
  assert.equal(await context.downloadScoresCsv(host, data, {}, button), false);
  assert.equal(downloads.length, 1);
  context.activeContext = { data };
  context.flushPendingScores = async () => false;
  assert.equal(await context.downloadScoresCsv(host, data, {}, button), false);
  assert.equal(downloads.length, 1);
  context.flushPendingScores = async () => true;
  let finishFetch;
  fetchResult = new Promise(resolve => { finishFetch = resolve; });
  const originalApi = context.api;
  context.api = () => ({ getShsGradeWorkspace: async () => await fetchResult });
  const exporting = context.downloadScoresCsv(host, data, {}, button);
  await Promise.resolve();
  context.scoreEditVersion++;
  finishFetch({ term: { id: 3 }, students: [] });
  context.api = originalApi;
  fetchResult = { term: { id: 3 }, students: [] };
  assert.equal(await exporting, true);
  assert.equal(downloads.length, 2);
  assert.equal(fetches, 3, 'a score edited during the fetch requires a fresh request');
});

test('SHS score CSV retains full category names and escapes spreadsheet formulas', async () => {
  assert.ok(exporter);
  const header = {
    querySelector(selector) {
      return ({
        '.comp-head-type': { dataset: { categoryName: 'Written/Oral Works' }, textContent: 'WW' },
        '.comp-head-name': { textContent: 'Quiz 1' },
        '.comp-head-max': { textContent: '/ 25' }
      })[selector];
    }
  };
  const row = {
    hidden: false,
    dataset: { studentId: '9' },
    querySelectorAll(selector) {
      return selector.includes('score-input') ? [{ dataset: { scoreItem: '1' }, value: '5' }]
        : [{ textContent: '70' }, { textContent: '70' }];
    }
  };
  const hiddenRow = { hidden: true };
  const host = { querySelectorAll(selector) {
    return ({ '#scoreTheadRow .comp-head-cell': [header],
      '#scoreTheadRow .score-average-header': [{ textContent: 'WW Avg' }],
      '#scoreTbody tr[data-student-id]': [row, hiddenRow] })[selector] || [];
  } };
  const item = { id: 1, title: 'Quiz 1', maxScore: 25, componentCode: 'written' };
  const displayed = { items: [item], term: { id: 1 },
    scope: { policy: { components: [{ code: 'written', name: 'Written/Oral Works' }] } } };
  const fresh = {
    scope: { yearLabel: '2026-2027', className: 'Section B', subjectName: 'Mathematics',
      policy: { components: [{ code: 'written', name: 'Written/Oral Works' }] } },
    term: { id: 1, name: 'Term 1' }, items: [item],
    students: [{ studentId: 9, studentName: '=HYPERLINK("bad")',
      componentAverages: { written: 80 }, termGrade: 85 }],
    scores: [{ studentId: 9, gradingItemId: 1, score: 20 }]
  };
  let blob;
  let download;
  let clicked = false;
  const context = vm.createContext({
    visibleScoreRows: host => host.querySelectorAll('#scoreTbody tr[data-student-id]').filter(row => !row.hidden),
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    Blob,
    document: { createElement() { return { click() { clicked = true; }, set download(value) { download = value; } }; } },
    setTimeout() {}, toast() {}
  });
  vm.runInContext(exporter, context);
  context.exportScoresCsv(host, fresh, displayed);
  assert.equal(clicked, true);
  assert.match(download, /Section-B-Mathematics-Term-1-scores\.csv$/);
  const csv = await blob.text();
  assert.match(csv, /Written\/Oral Works: Quiz 1 \/ 25/);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /"WW Avg","Final Grade"/);
  assert.match(csv, /"20","80","85"/);
  assert.doesNotMatch(csv, /"5","70","70"/);
  clicked = false;
  assert.throws(() => context.exportScoresCsv(host, { ...fresh, term: { id: 2 } }, displayed), /Score Recording changed/);
  assert.equal(clicked, false);
  assert.throws(() => context.exportScoresCsv(host, { ...fresh,
    scope: { ...fresh.scope, policy: { components: [{ code: 'performance' }] } } }, displayed), /Grading rules changed/);
  assert.equal(clicked, false);
  assert.throws(() => context.exportScoresCsv(host, { ...fresh, students: [] }, displayed), /Score Recording changed/);
  assert.equal(clicked, false);
});
