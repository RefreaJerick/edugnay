const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const start = source.indexOf('    function savePendingBackendScore(record) {');
const end = source.indexOf('    function scheduleBackendScoreSave(', start);
assert.ok(start >= 0 && end > start);

function harness({ published = false, save = async () => ({ saved: true }) } = {}) {
  const toasts = [];
  const record = { scoreId: '9:4', gradingItemId: '4', studentId: '9', value: '18', academicPeriodId: '3' };
  const context = vm.createContext({
    pendingBackendScoreSaves: new Map(), pendingBackendScoreValues: new Map([[record.scoreId, record]]),
    scoreHasSavedChanges: false, updateScoreFooter() {},
    saveBackendStudentScore: save,
    getPublishedGradesForPeriod: () => published ? [{ studentId: '9', finalGrade: 85 }] : [],
    showAppToast: message => toasts.push(message)
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, record, toasts };
}

test('Elem and JHS autosave reminds teachers only after a published-term score saves', async () => {
  for (const published of [false, true]) {
    const h = harness({ published });
    await h.context.savePendingBackendScore(h.record);
    assert.deepEqual(h.toasts, published
      ? ['Score saved. Re-publish grades to update the published result.'] : []);
  }
});

test('a failed or superseded autosave does not show the reminder', async () => {
  const failed = harness({ published: true, save: async () => { throw new Error('Save failed.'); } });
  await assert.rejects(failed.context.savePendingBackendScore(failed.record), /Save failed/);
  assert.deepEqual(failed.toasts, []);

  let finish;
  const saving = new Promise(resolve => { finish = resolve; });
  const superseded = harness({ published: true, save: () => saving });
  const first = superseded.context.savePendingBackendScore(superseded.record);
  await Promise.resolve();
  superseded.context.pendingBackendScoreValues.set(superseded.record.scoreId, { ...superseded.record, value: '19' });
  finish({ saved: true });
  await first;
  assert.deepEqual(superseded.toasts, []);
});
