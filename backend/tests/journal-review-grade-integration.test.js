const assert = require('node:assert/strict');
const test = require('node:test');

const database = require('../config/database');
const calls = [];
const connection = {
  async beginTransaction() { calls.push('BEGIN'); },
  async commit() { calls.push('COMMIT'); },
  async rollback() { calls.push('ROLLBACK'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM school_portal_features')) return [[{ id: 7, subjectId: 4 }]];
    if (sql.includes('INNER JOIN journal_prompts ON journal_prompts.id = student_journal_entries.journal_prompt_id')) {
      return [[{ id: 11, studentId: 9, sectionId: 8, gradingItemId: 12 }]];
    }
    if (sql.includes('SELECT section_teachers.id FROM section_teachers')) return [[{ id: 1 }]];
    if (sql.includes('FROM grading_items INNER JOIN sections')) {
      return [[{ id: 12, sectionId: 8, subjectId: 4, academicTermId: 6, teacherUserId: 5, maxScore: 50, academicYearStatus: 'active' }]];
    }
    if (sql.includes('SELECT academic_terms.status AS academicTermStatus')) {
      return [[{ academicTermStatus: 'active', academicYearStatus: 'active' }]];
    }
    if (sql.includes('SELECT 1 FROM section_teachers')) return [[{ 1: 1 }]];
    if (sql.startsWith('SELECT student_user_id AS studentId FROM section_students')) return [[{ studentId: 9 }]];
    if (sql.startsWith('INSERT INTO student_scores')) return [{ affectedRows: 1 }];
    if (sql.startsWith('SELECT id, grading_item_id AS gradingItemId')) return [[{ id: 20, score: 23 }]];
    if (sql.startsWith('UPDATE student_journal_entries')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM student_journal_entries\n  INNER JOIN journal_subjects')) {
      return [[{ id: 11, journalSubjectId: 7, studentId: 9, sectionId: 8, entryText: 'Reflection', status: 'reviewed', score: 23, maxScore: 50 }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

database.getDatabase = () => ({ getConnection: async () => connection });
const { reviewJournalEntry } = require('../controllers/journalsController');

test('real grade helper saves a journal score without feedback', async () => {
  const result = {};
  await reviewJournalEntry({
    user: { id: 5, schoolId: 1, role: 'teacher' },
    params: { entryId: '11' },
    body: { score: 23 }
  }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });

  assert.ifError(result.error);
  assert.equal(result.status, 200);
  assert.equal(result.body.studentScore.score, 23);
  assert.equal(Object.hasOwn(result.body.entry, 'feedback'), false);
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO student_scores')));
  assert.equal(calls.some(call => call.sql?.includes('journal_feedback')), false);
  assert.equal(calls.at(-1), 'COMMIT');
});
