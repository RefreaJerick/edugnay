const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controller = fs.readFileSync(path.join(__dirname, '../controllers/shsGradesController.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../routes/shsGrades.js'), 'utf8');
const source = controller.match(/async function deleteItem\([\s\S]*?(?=\r?\nasync function saveScore\()/)?.[0];

test('SHS score component deletion protects published and assignment-linked items', async () => {
  assert.ok(source);
  assert.match(route, /router\.delete\('\/items\/:itemId', controller\.deleteItem\)/);
  assert.match(controller, /AS assignmentId/);
  for (const blocked of [
    { usedInPublishedGrades: 1, assignmentId: null },
    { usedInPublishedGrades: 0, assignmentId: 8 }
  ]) {
    const changes = [];
    const connection = {
      async beginTransaction() { changes.push('begin'); },
      async execute() { throw new Error('Deletion query should not run'); },
      async rollback() { changes.push('rollback'); },
      release() { changes.push('release'); }
    };
    const context = vm.createContext({
      getDatabase: () => ({ getConnection: async () => connection }),
      resolveScope: async () => ({ schoolId: 1, subjectName: 'Mathematics', className: 'Section B' }),
      lockYear: async () => {}, assertTerm: async () => {},
      loadItems: async () => [{ id: 4, title: 'Quiz', ...blocked }],
      id: value => Number(value),
      fail: (message, status) => { const error = new Error(message); error.status = status; throw error; },
      writeAuditLog: async () => {}
    });
    vm.runInContext(source, context);
    let error;
    await context.deleteItem({ params: { itemId: '4' }, query: { sectionId: '2', subjectId: '3', academicTermId: '5' }, user: { schoolId: 1 } },
      {}, failure => { error = failure; });
    assert.equal(error?.status, 409);
    assert.deepEqual(changes, ['begin', 'rollback', 'release']);
  }
});

test('SHS score component deletion removes saved scores and records the action', async () => {
  const changes = [];
  const connection = {
    async beginTransaction() { changes.push('begin'); },
    async execute(sql) {
      if (sql.includes('FROM journal_prompts')) return [[]];
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 2 }]];
      if (sql.startsWith('DELETE FROM student_scores')) { changes.push('scores'); return [{ affectedRows: 2 }]; }
      if (sql.startsWith('DELETE FROM grading_items')) { changes.push('item'); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async commit() { changes.push('commit'); },
    async rollback() { changes.push('rollback'); },
    release() { changes.push('release'); }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    resolveScope: async () => ({ schoolId: 1, subjectName: 'Mathematics', className: 'Section B' }),
    lockYear: async () => {}, assertTerm: async () => {},
    loadItems: async () => [{ id: 4, title: 'Quiz', usedInPublishedGrades: 0, assignmentId: null }],
    id: value => Number(value),
    fail: (message, status) => { const error = new Error(message); error.status = status; throw error; },
    writeAuditLog: async (_db, _req, action, _type, _id, details) => {
      assert.equal(action, 'shs_grading_item_deleted');
      assert.equal(details.deletedScoreCount, 2);
      changes.push('audit');
    }
  });
  vm.runInContext(source, context);
  let body;
  await context.deleteItem({ params: { itemId: '4' }, query: { sectionId: '2', subjectId: '3', academicTermId: '5' }, user: { schoolId: 1 } },
    { json(value) { body = value; } }, error => { throw error; });
  assert.equal(body.deletedScoreCount, 2);
  assert.deepEqual(changes, ['begin', 'scores', 'item', 'audit', 'commit', 'release']);
});
