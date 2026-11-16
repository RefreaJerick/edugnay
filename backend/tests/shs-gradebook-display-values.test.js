const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controller = fs.readFileSync(path.join(__dirname, '../controllers/shsGradesController.js'), 'utf8');
const workspaceSource = controller.match(/async function workspace\([\s\S]*?(?=async function insertItem\()/)?.[0];

test('SHS core and elective workspaces display whole scores without trailing zeroes', async () => {
  assert.ok(workspaceSource);
  for (const kind of ['core', 'elective']) {
    const scope = { kind, schoolId: 1, sectionId: 2, subjectId: 3, classId: 4,
      communicationComponentCode: null, policy: null, group: 'academic', yearLabel: '2026-2027', gradeCode: 'grade-11' };
    const database = { execute: async () => [[]] };
    const context = vm.createContext({
      getDatabase: () => database,
      resolveScope: async () => scope,
      loadTerms: async () => [{ id: 7, status: 'active' }],
      assertTerm: async () => ({ id: 7, name: 'Term 1', status: 'active' }),
      roster: async () => [],
      loadItems: async () => [{ id: 10, title: 'Task', maxScore: '25.00' }],
      loadScores: async () => [
        { gradingItemId: 10, studentId: 11, score: '12.00' },
        { gradingItemId: 10, studentId: 12, score: '12.50' },
        { gradingItemId: 10, studentId: 13, score: null }
      ],
      policyBlockReason: () => null
    });
    vm.runInContext(workspaceSource, context);
    let response;
    let failure;
    await context.workspace({ user: { id: 5, schoolId: 1 }, query: {} },
      { json(value) { response = value; } }, error => { failure = error; });
    assert.ifError(failure);
    assert.equal(response.items[0].maxScore, 25);
    assert.deepEqual(Array.from(response.scores, row => row.score), [12, 12.5, null]);
  }
});
