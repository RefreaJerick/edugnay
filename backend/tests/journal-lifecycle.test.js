const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
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
    if (sql.includes('FROM section_teachers\n')) return [state.assigned ? [{ id: 1 }] : []];
    if (sql.startsWith('SELECT id, max_score AS maxScore FROM grading_items')) return [[{ id: 12, maxScore: 50 }]];
    if (sql.startsWith('UPDATE journal_prompts SET prompt_status')) return [{ affectedRows: 0 }];
    if (sql.startsWith('INSERT INTO journal_prompts')) return [{ insertId: 13 }];
    if (sql.includes('FROM journal_prompts INNER JOIN sections')) {
      return [[{ id: 13, sectionId: 8, minWords: 2, status: 'open',
        notOpenYet: state.notOpenYet ? 1 : 0, pastDeadline: state.pastDeadline ? 1 : 0,
        allowLate: state.allowLate ? 1 : 0 }]];
    }
    if (sql.startsWith('SELECT journal_prompts.id, journal_prompts.section_id AS sectionId')) {
      return [[{ id: 13, sectionId: 8, gradingItemId: 12, status: 'open' }]];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM student_journal_entries')) return [[{ total: state.entryCount || 0 }]];
    if (sql.startsWith('UPDATE journal_prompts SET prompt_text')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM journal_prompts\n  INNER JOIN journal_subjects')) {
      return [[{ id: 13, journalSubjectId: 7, subjectId: 4, sectionId: 8,
        maxScore: 50, minWords: 2, allowLate: false, status: 'open', submissionState: 'open' }]];
    }
    if (sql.includes('FROM section_students\n')) return [state.enrolled ? [{ id: 8 }] : []];
    if (sql.startsWith('INSERT INTO student_journal_entries')) return [{ insertId: 21, affectedRows: state.windowClosedAtInsert ? 0 : 1 }];
    if (sql.includes('FROM student_journal_entries\n  INNER JOIN journal_subjects')) {
      return [[{ id: 21, promptId: 13, journalSubjectId: 7, studentId: 9, sectionId: 8,
        entryText: 'My reflection', status: 'submitted', score: null, maxScore: 50 }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({
  getConnection: async () => connection,
  execute: (...args) => connection.execute(...args)
});
const journals = require('../controllers/journalsController');

async function call(handler, { role, id, body = {}, params = {}, query = {} }) {
  calls = [];
  state = { assigned: true, enrolled: true, ...body.__testState };
  const requestBody = { ...body };
  delete requestBody.__testState;
  const result = {};
  await handler({ user: { id, schoolId: 1, role }, body: requestBody, params, query }, {
    status(code) { result.status = code; return this; },
    json(bodyValue) { result.body = bodyValue; }
  }, error => { result.error = error; });
  return result;
}

const promptBody = {
  sectionId: 8, gradingItemId: 12, weekStartDate: '2026-10-05', promptText: 'Reflect this week',
  opensAt: '2026-10-05T08:00', dueAt: '2026-10-09T23:59', minWords: 2, allowLate: false
};

test('teacher creates a section-scoped prompt and the API returns database window state', async () => {
  const result = await call(journals.createJournalPrompt, { role: 'teacher', id: 5, body: promptBody });
  assert.ifError(result.error);
  assert.equal(result.status, 201);
  assert.equal(result.body.journalPrompt.submissionState, 'open');
  const insert = calls.find(item => item.sql?.startsWith('INSERT INTO journal_prompts'));
  assert.equal(insert.values.at(-1), 5);
  const query = calls.find(item => item.sql?.includes('FROM journal_prompts\n  INNER JOIN journal_subjects')).sql;
  assert.match(query, /UTC_TIMESTAMP\(\) \+ INTERVAL 8 HOUR/);
  assert.match(query, /DATE_FORMAT\(journal_prompts\.due_at, .+\+08:00/);
});

test('teacher cannot create a prompt without the subject assignment', async () => {
  const result = await call(journals.createJournalPrompt, { role: 'teacher', id: 5,
    body: { ...promptBody, __testState: { assigned: false } } });
  assert.equal(result.error?.status, 403);
  assert.equal(calls.some(item => item.sql?.startsWith('INSERT INTO journal_prompts')), false);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('teacher can edit an unused prompt but not one with submissions', async () => {
  const editable = await call(journals.updateJournalPrompt, { role: 'teacher', id: 5,
    params: { promptId: '13' }, body: promptBody });
  assert.ifError(editable.error);
  assert.equal(calls.some(item => item.sql?.startsWith('UPDATE journal_prompts SET prompt_text')), true);
  const used = await call(journals.updateJournalPrompt, { role: 'teacher', id: 5,
    params: { promptId: '13' }, body: { ...promptBody, __testState: { entryCount: 1 } } });
  assert.equal(used.error?.status, 409);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('student submission writes the prompt creator as owner and rechecks the database clock', async () => {
  const result = await call(journals.submitJournalEntry, { role: 'student', id: 9,
    body: { promptId: 13, entryText: 'My reflection' } });
  assert.ifError(result.error);
  assert.equal(result.status, 201);
  const insert = calls.find(item => item.sql?.startsWith('INSERT INTO student_journal_entries'));
  assert.match(insert.sql, /journal_prompts\.created_by_user_id/);
  assert.match(insert.sql, /journal_prompts\.opens_at <= \(UTC_TIMESTAMP\(\) \+ INTERVAL 8 HOUR\)/);
  assert.match(insert.sql, /journal_prompts\.due_at >= \(UTC_TIMESTAMP\(\) \+ INTERVAL 8 HOUR\)/);
  assert.equal(calls.at(-1), 'COMMIT');
});

test('not-open, expired, unenrolled, and boundary-crossing submissions are rejected', async () => {
  for (const [flags, status] of [
    [{ notOpenYet: true }, 409], [{ pastDeadline: true }, 409],
    [{ enrolled: false }, 403], [{ windowClosedAtInsert: true }, 409]
  ]) {
    const result = await call(journals.submitJournalEntry, { role: 'student', id: 9,
      body: { promptId: 13, entryText: 'My reflection', __testState: flags } });
    assert.equal(result.error?.status, status, JSON.stringify(flags));
    assert.equal(calls.at(-1), 'ROLLBACK');
  }
});

test('late submission is allowed only when the prompt permits it', async () => {
  const result = await call(journals.submitJournalEntry, { role: 'student', id: 9,
    body: { promptId: 13, entryText: 'My reflection', __testState: { pastDeadline: true, allowLate: true } } });
  assert.ifError(result.error);
  assert.equal(result.status, 201);
});

test('current teacher entries require both recorded ownership and current assignment', async () => {
  const result = await call(journals.listJournalEntries, { role: 'teacher', id: 5 });
  assert.ifError(result.error);
  const query = calls.find(item => item.sql?.includes('FROM student_journal_entries\n  INNER JOIN journal_subjects'));
  assert.match(query.sql, /student_journal_entries\.owner_teacher_user_id = \?/);
  assert.match(query.sql, /FROM section_teachers/);
  assert.doesNotMatch(query.sql, /journal_prompt_id IS NULL/);
  assert.deepEqual(query.values.slice(0, 3), [1, 7, 1]);
  assert.equal(query.values[3], 5);
});

test('owner migration backfills linked entries and leaves prompt-less entries unresolved', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/025_journal_entry_ownership.sql'), 'utf8');
  assert.match(migration, /prompts\.id = entries\.journal_prompt_id/);
  assert.match(migration, /SET entries\.owner_teacher_user_id = prompts\.created_by_user_id/);
  assert.doesNotMatch(migration, /section_teachers/);
});

test('student journal uses server window state and preserves an unsent draft', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-journal.html'), 'utf8');
  assert.match(page, /currentPrompt\?\.submissionState === 'open'/);
  assert.match(page, /currentPrompt\?\.submissionState === 'late'/);
  assert.match(page, /function renderUnsentDraft\(\)/);
  assert.match(page, /setInterval\(refreshJournalWindow, 60000\)/);
  assert.doesNotMatch(page, /function isPromptOpen|Date\.now\(\)/);
});
