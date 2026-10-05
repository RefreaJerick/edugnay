const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let state;
let queries;

const connection = {
  async beginTransaction() { queries.push('BEGIN'); },
  async commit() { queries.push('COMMIT'); state.committed = true; },
  async rollback() { queries.push('ROLLBACK'); state.rolledBack = true; },
  release() {},
  async execute(sql) {
    queries.push(sql);
    if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ? LIMIT 1')) {
      return [state.visible ? [{
        id: 4, schoolId: 1, sectionId: 8, subjectId: 2,
        academicTermId: 6, gradingCategoryId: 3, gradingItemId: 12,
        teacherUserId: 5, title: 'test', academicYearStatus: 'active'
      }] : []];
    }
    if (sql.includes('FROM section_teachers INNER JOIN sections')) {
      return [state.assigned ? [{ id: 8, schoolId: 1 }] : []];
    }
    if (sql.includes('SELECT academic_terms.status AS academicTermStatus')) {
      return [[{ academicTermStatus: state.termStatus, academicYearStatus: 'active' }]];
    }
    if (sql.includes('SELECT 1 FROM section_teachers')) return [[{ 1: 1 }]];
    if (sql.includes('FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? FOR UPDATE')) {
      return [state.submissions ? [{ id: 20, filePath: null }] : []];
    }
    if (sql.includes('FROM grading_items WHERE id = ? AND school_id = ? FOR UPDATE')) {
      return [[{
        id: 12, sectionId: state.mismatch ? 9 : 8, subjectId: 2,
        academicTermId: 6, gradingCategoryId: 3, teacherUserId: 5,
        usedInPublishedGrades: state.published
      }]];
    }
    if (sql.startsWith('SELECT id FROM student_scores WHERE school_id = ? AND grading_item_id = ?')) {
      return [state.scores ? [{ id: 30 }] : []];
    }
    if (sql.includes('FROM journal_prompts WHERE school_id = ? AND grading_item_id = ?')) {
      return [state.journal ? [{ id: 40 }] : []];
    }
    if (sql.startsWith('DELETE FROM assignment_submissions')) return [{ affectedRows: state.submissions ? 1 : 0 }];
    if (sql.startsWith('DELETE FROM assignments')) return [{ affectedRows: 1 }];
    if (sql.startsWith('DELETE FROM student_scores')) return [{ affectedRows: state.blankRows ? 2 : 0 }];
    if (sql.startsWith('DELETE FROM grading_items')) {
      if (state.itemDeleteFails) throw new Error('Component deletion failed');
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      if (state.auditFails) throw new Error('Audit write failed');
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { deleteAssignment } = require('../controllers/assignmentsController');

async function remove(overrides = {}, user = { id: 5, schoolId: 1, role: 'teacher' }) {
  state = {
    visible: true, assigned: true, termStatus: 'active', submissions: false,
    scores: false, blankRows: false, published: false, journal: false, mismatch: false,
    itemDeleteFails: false, auditFails: false, committed: false, rolledBack: false,
    ...overrides
  };
  queries = [];
  const result = { status: null, sent: false, error: null };
  await deleteAssignment({ params: { assignmentId: '4' }, query: { expectedSubmissionCount: state.submissions ? 1 : 0 }, user }, {
    status(code) { result.status = code; return this; },
    send() { result.sent = true; },
    json() { result.sent = true; }
  }, error => { result.error = error; });
  return result;
}

test('empty linked assignment and component are deleted in one transaction', async () => {
  const result = await remove();
  assert.ifError(result.error);
  assert.equal(result.status, 204);
  assert.equal(result.sent, true);
  assert.equal(state.committed, true);
  assert.ok(queries.findIndex(sql => sql.startsWith('DELETE FROM assignments'))
    < queries.findIndex(sql => sql.startsWith('DELETE FROM grading_items')));
  assert.ok(queries.findIndex(sql => sql.startsWith('DELETE FROM student_scores'))
    < queries.findIndex(sql => sql.startsWith('DELETE FROM grading_items')));
  assert.ok(queries.some(sql => sql.startsWith('INSERT INTO audit_logs')));
  assert.equal(queries.at(-1), 'COMMIT');
});

test('blank score placeholders do not block linked-pair deletion', async () => {
  const result = await remove({ blankRows: true });
  assert.ifError(result.error);
  assert.equal(state.committed, true);
  assert.ok(queries.some(sql => sql.includes("score IS NULL AND (remarks IS NULL OR TRIM(remarks) = '')")));
});

test('submitted work and its linked score component are deleted together', async () => {
  const result = await remove({ submissions: true });
  assert.ifError(result.error);
  assert.equal(state.committed, true);
  assert.ok(queries.findIndex(sql => sql.startsWith('DELETE FROM assignment_submissions'))
    < queries.findIndex(sql => sql.startsWith('DELETE FROM assignments')));
  assert.ok(queries.findIndex(sql => sql.startsWith('DELETE FROM assignments'))
    < queries.findIndex(sql => sql.startsWith('DELETE FROM grading_items')));
});

test('a later failure rolls back submission and assignment deletion together', async () => {
  const result = await remove({ submissions: true, itemDeleteFails: true });
  assert.ok(result.error);
  assert.equal(state.committed, false);
  assert.equal(state.rolledBack, true);
  assert.ok(queries.some(sql => sql.startsWith('DELETE FROM assignment_submissions')));
});

for (const [reason, flags] of [
  ['saved scores', { scores: true }],
  ['published use', { published: true }],
  ['journal link', { journal: true }],
  ['locked period', { termStatus: 'closed' }],
  ['mismatched component', { mismatch: true }]
]) {
  test(`${reason} prevents deleting either record`, async () => {
    const result = await remove(flags);
    assert.equal(result.error?.status, 409);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
    assert.equal(queries.some(sql => sql.startsWith('DELETE FROM')), false);
  });
}

test('cross-school and unassigned-teacher requests cannot delete the pair', async () => {
  for (const flags of [{ visible: false }, { assigned: false }]) {
    const result = await remove(flags);
    assert.ok([404, 409].includes(result.error?.status));
    assert.equal(queries.some(sql => sql.startsWith('DELETE FROM')), false);
  }
  const otherTeacher = await remove({}, { id: 99, schoolId: 1, role: 'teacher' });
  assert.equal(otherTeacher.error?.status, 404);
});

for (const [reason, flags] of [
  ['component deletion failure', { itemDeleteFails: true }],
  ['audit write failure', { auditFails: true }]
]) {
  test(`${reason} rolls back both deletes`, async () => {
    const result = await remove(flags);
    assert.ok(result.error);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
    assert.equal(queries.at(-1), 'ROLLBACK');
  });
}
