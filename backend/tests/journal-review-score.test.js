const assert = require('node:assert/strict');
const test = require('node:test');

const database = require('../config/database');
const grades = require('../controllers/gradesController');
let calls;
let state;

const connection = {
  async beginTransaction() { calls.push('BEGIN'); },
  async commit() { calls.push('COMMIT'); },
  async rollback() { calls.push('ROLLBACK'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM school_portal_features')) return [[{ id: 7, subjectId: 4 }]];
    if (sql.includes('INNER JOIN journal_prompts ON journal_prompts.id = student_journal_entries.journal_prompt_id')) {
      return [state.visible ? [{ id: 11, studentId: 9, sectionId: 8, gradingItemId: 12 }] : []];
    }
    if (sql.includes('FROM section_teachers\n')) return [state.assigned ? [{ id: 1 }] : []];
    if (sql.startsWith('UPDATE student_journal_entries')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM student_journal_entries\n  INNER JOIN journal_subjects')) {
      return [[{ id: 11, journalSubjectId: 7, studentId: 9, sectionId: 8,
        entryText: 'A reflection', status: 'reviewed', score: 47, maxScore: 50 }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

database.getDatabase = () => ({ getConnection: async () => connection });
grades.upsertStudentScore = async (_connection, _user, _itemId, _studentId, body) => {
  calls.push('SCORE');
  return { score: body.score };
};
const { reviewJournalEntry } = require('../controllers/journalsController');

async function review(overrides = {}, user = { id: 5, schoolId: 1, role: 'teacher' }) {
  state = { visible: true, assigned: true, ...overrides };
  calls = [];
  const result = {};
  await reviewJournalEntry({ user, params: { entryId: '11' }, body: { score: 47, ...overrides.body } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('journal review saves a score without querying or returning comments', async () => {
  const result = await review();
  assert.ifError(result.error);
  assert.equal(result.status, 200);
  assert.equal(result.body.entry.score, 47);
  assert.equal(Object.hasOwn(result.body.entry, 'feedback'), false);
  assert.equal(calls.some(call => call.sql?.includes('journal_feedback')), false);
  assert.equal(calls.at(-1), 'COMMIT');
});

test('a legacy comment field cannot revive journal comments', async () => {
  const result = await review({ body: { feedbackText: 'Old client comment' } });
  assert.ifError(result.error);
  assert.equal(calls.some(call => call.sql?.includes('journal_feedback')), false);
  assert.equal(Object.hasOwn(result.body.entry, 'feedback'), false);
});

test('unassigned and out-of-school teachers cannot review', async () => {
  for (const flags of [{ assigned: false }, { visible: false }]) {
    const result = await review(flags);
    assert.ok(result.error);
    assert.equal(calls.includes('SCORE'), false);
    assert.equal(calls.at(-1), 'ROLLBACK');
  }
});
