const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let state;
let queries;

const item = {
  id: 12, sectionId: 8, subjectId: 4, academicTermId: 6,
  gradingCategoryId: 3, teacherUserId: 5, title: 'Quiz 1',
  maxScore: 20, academicTermStatus: 'active', academicYearStatus: 'active'
};

const connection = {
  async beginTransaction() { queries.push('BEGIN'); },
  async commit() { queries.push('COMMIT'); },
  async rollback() { queries.push('ROLLBACK'); },
  release() {},
  async execute(sql, values) {
    queries.push(sql);
    if (sql.includes('FROM grading_items INNER JOIN sections')) return [state.visible ? [item] : []];
    if (sql.includes('FROM section_teachers INNER JOIN sections')) {
      return [state.assigned ? [{ id: 8, schoolId: 1 }] : []];
    }
    if (sql.includes('SELECT academic_terms.status AS academicTermStatus')) {
      return [[{ academicTermStatus: state.termStatus, academicYearStatus: 'active' }]];
    }
    if (sql.includes('SELECT 1 FROM section_teachers')) return [[{ 1: 1 }]];
    if (sql.includes('FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('SELECT id, used_in_published_grades AS usedInPublishedGrades FROM grading_items')) {
      return [[{ id: 12, usedInPublishedGrades: state.published }]];
    }
    if (sql.includes('FROM assignments WHERE school_id = ? AND grading_item_id = ?')) {
      return [state.linkedAssignment ? [{ id: 10 }] : []];
    }
    if (sql.includes('max_score IS NOT NULL AND grading_item_id IS NULL')) {
      return [state.unlinkedAssignment ? [{ id: 11 }] : []];
    }
    if (sql.includes('FROM journal_prompts WHERE')) return [state.journalPrompt ? [{ id: 13 }] : []];
    if (sql.includes('SELECT COUNT(*) AS total FROM student_scores')) return [[{ total: state.scoreCount }]];
    if (sql.startsWith('DELETE FROM student_scores')) return [{ affectedRows: state.scoreCount }];
    if (sql.startsWith('DELETE FROM grading_items')) return [{ affectedRows: 1 }];
    if (sql.startsWith('INSERT INTO audit_logs')) {
      if (state.auditFails) throw new Error('Audit write failed');
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { deleteGradingItem } = require('../controllers/gradesController');

async function remove(overrides = {}, user = { id: 5, schoolId: 1, role: 'teacher' }) {
  state = {
    visible: true, assigned: true, termStatus: 'active', scoreCount: 2,
    linkedAssignment: false, unlinkedAssignment: false, journalPrompt: false,
    published: false, auditFails: false, ...overrides
  };
  queries = [];
  const result = { body: null, error: null };
  await deleteGradingItem({ params: { gradingItemId: '12' }, user }, {
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('unpublished component can be deleted after other grades in its scope were published', async () => {
  const result = await remove();
  assert.ifError(result.error);
  assert.deepEqual(result.body, { deletedGradingItemId: 12, deletedScoreCount: 2 });
  assert.ok(queries.findIndex(sql => sql.startsWith('DELETE FROM student_scores'))
    < queries.findIndex(sql => sql.startsWith('DELETE FROM grading_items')));
  assert.ok(queries.some(sql => sql.startsWith('INSERT INTO audit_logs')));
  assert.equal(queries.at(-1), 'COMMIT');
});

for (const [reason, flags] of [
  ['linked assignment', { linkedAssignment: true }],
  ['unlinked graded assignment', { unlinkedAssignment: true }],
  ['journal prompt', { journalPrompt: true }],
  ['component used in published grades', { published: true }],
  ['locked grading period', { termStatus: 'closed' }]
]) {
  test(`${reason} blocks deletion and keeps scores intact`, async () => {
    const result = await remove(flags);
    assert.equal(result.error?.status, 409);
    assert.equal(result.body, null);
    assert.equal(queries.some(sql => sql.startsWith('DELETE FROM')), false);
    assert.equal(queries.at(-1), 'ROLLBACK');
  });
}

test('another school or teacher cannot delete the component', async () => {
  for (const flags of [{ visible: false }, { assigned: false }]) {
    const result = await remove(flags);
    assert.ok([403, 404, 409].includes(result.error?.status));
    assert.equal(queries.some(sql => sql.startsWith('DELETE FROM')), false);
  }
});

test('an audit failure rolls the deletion back', async () => {
  const result = await remove({ auditFails: true });
  assert.match(result.error?.message || '', /Audit write failed/);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
