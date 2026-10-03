const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let state;
let queries;

const prompt = {
  id: 13, sectionId: 8, subjectId: 4, gradingItemId: 12,
  teacherUserId: 5, academicTermId: 6, usedInPublishedGrades: 0,
  title: 'Weekly journal'
};

const connection = {
  async beginTransaction() { queries.push('BEGIN'); },
  async commit() { queries.push('COMMIT'); },
  async rollback() { queries.push('ROLLBACK'); },
  release() {},
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('FROM journal_prompts INNER JOIN journal_subjects')) return [state.visible ? [{ ...prompt, usedInPublishedGrades: state.published }] : []];
    if (sql.includes('FROM section_teachers\n')) return [state.assigned ? [{ id: 1 }] : []];
    if (sql.includes('SELECT academic_terms.status AS academicTermStatus')) return [[{ academicTermStatus: state.termStatus, academicYearStatus: 'active' }]];
    if (sql.includes('SELECT 1 FROM section_teachers')) return [state.assigned ? [{ 1: 1 }] : []];
    if (sql.includes('FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('FROM student_journal_entries WHERE')) return [state.entries ? [{ id: 1 }] : []];
    if (sql.includes('FROM student_scores WHERE')) return [state.scores ? [{ id: 1 }] : []];
    if (sql.includes('FROM assignments WHERE')) return [state.assignments ? [{ id: 1 }] : []];
    if (sql.startsWith('DELETE FROM') || sql.startsWith('INSERT INTO audit_logs')) {
      if (state.failAudit && sql.startsWith('INSERT INTO audit_logs')) throw new Error('Audit failed');
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: (...args) => connection.execute(...args) });
const { deleteJournalPrompt, listJournalHistory } = require('../controllers/journalsController');

async function remove(overrides = {}, user = { id: 5, schoolId: 1, role: 'teacher' }) {
  state = { visible: true, assigned: true, termStatus: 'active', published: false, entries: false, scores: false, assignments: false, ...overrides };
  queries = [];
  const result = {};
  await deleteJournalPrompt({ user, params: { promptId: '13' } }, { json(body) { result.body = body; } }, error => { result.error = error; });
  return result;
}

test('unused journal prompt and its linked score component are deleted together', async () => {
  const result = await remove();
  assert.ifError(result.error);
  assert.deepEqual(result.body, { deletedPromptId: 13, deletedGradingItemId: 12 });
  const sql = queries.map(call => call.sql || call);
  assert.ok(sql.indexOf('DELETE FROM journal_prompts WHERE id = ? AND school_id = ?') < sql.indexOf('DELETE FROM grading_items WHERE id = ? AND school_id = ?'));
  assert.equal(sql.at(-1), 'COMMIT');
});

for (const [name, flags] of [
  ['published grade', { published: true }],
  ['student entry', { entries: true }],
  ['saved score', { scores: true }],
  ['linked assignment', { assignments: true }],
  ['locked term', { termStatus: 'closed' }]
]) {
  test(`${name} prevents journal deletion`, async () => {
    const result = await remove(flags);
    assert.equal(result.error?.status, 409);
    assert.equal(queries.some(call => call.sql?.startsWith('DELETE FROM')), false);
    assert.equal(queries.at(-1), 'ROLLBACK');
  });
}

test('other school and unassigned teacher cannot delete a journal prompt', async () => {
  assert.equal((await remove({ visible: false })).error?.status, 404);
  assert.equal((await remove({ assigned: false })).error?.status, 403);
  assert.equal(queries.some(call => call.sql?.startsWith('DELETE FROM')), false);
});

test('audit failure rolls back both deletions', async () => {
  const result = await remove({ failAudit: true });
  assert.match(result.error?.message || '', /Audit failed/);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('school admin can delete an unused prompt without being its teacher', async () => {
  const result = await remove({ assigned: false }, { id: 7, schoolId: 1, role: 'school_admin' });
  assert.ifError(result.error);
  assert.equal(queries.at(-1), 'COMMIT');
});

test('history marks old subject inactive and scopes teacher and student queries', async () => {
  state = {};
  queries = [];
  connection.execute = async (sql, values = []) => {
    queries.push({ sql, values });
    if (sql.includes('FROM school_settings')) return [[{ subjectId: 4 }]];
    if (sql.includes('FROM journal_prompts\n')) return [[{
      id: 13, journalSubjectId: 2, subjectId: 1, sectionId: 8, sectionName: 'St. Matthew', subjectName: 'Values Education',
      gradingItemId: 12, componentTeacherUserId: 5, componentTitle: 'Weekly journal', usedInPublishedGrades: 1,
      entryCount: 1, recordedScoreCount: 1, maxScore: 50, weekStartDate: '2026-09-28', promptText: 'Reflect', minWords: 50, status: 'open'
    }]];
    if (sql.includes('FROM student_journal_entries\n')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  for (const role of ['teacher', 'student']) {
    const result = {};
    await listJournalHistory({ user: { id: 5, schoolId: 1, role }, query: { sectionId: '8' } }, { json(body) { result.body = body; } }, error => { result.error = error; });
    assert.ifError(result.error);
    assert.equal(result.body.prompts[0].effectiveStatus, 'inactive');
    const promptQuery = queries.find(call => call.sql.includes('FROM journal_prompts\n'));
    assert.deepEqual(promptQuery.values.slice(0, 2), [1, 8]);
    assert.match(promptQuery.sql, role === 'teacher' ? /created_by_user_id/ : /student_user_id/);
    if (role === 'teacher') {
      assert.match(promptQuery.sql, /journal_prompts\.created_by_user_id = \?/);
      const entryQuery = queries.find(call => call.sql.includes('FROM student_journal_entries\n'));
      assert.match(entryQuery.sql, /student_journal_entries\.owner_teacher_user_id = \?/);
      assert.doesNotMatch(entryQuery.sql, /journal_prompt_id IS NULL|FROM section_teachers/);
    }
    queries = [];
  }
});

test('journal history views and browser API parse', () => {
  for (const page of [
    '../../views/admin/edugnay-admin-schools.html',
    '../../views/teacher/edugnay-teacher-journals.html',
    '../../views/teacher/edugnay-teacher-sections.html',
    '../../views/student/edugnay-student-journal.html'
  ]) {
    const html = fs.readFileSync(path.join(__dirname, page), 'utf8');
    for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (source.trim()) new vm.Script(source, { filename: page });
    }
  }
  new vm.Script(fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8'));
});

test('school and teacher history use the shared modal card design', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-journals.html'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/modal-system.css'), 'utf8');
  for (const html of [teacher, admin]) {
    for (const name of ['journal-history-modal', 'journal-history-list', 'journal-history-card',
      'journal-history-card-head', 'journal-history-status', 'journal-history-card-meta',
      'journal-history-entry-action', 'journal-history-delete', 'data-view-journal-entries']) {
      assert.ok(html.includes(name), `Missing shared history class: ${name}`);
    }
    assert.match(html, /View submitted entries \(\$\{entries\.length\}\)/);
    assert.match(html, /journal-history-viewer\.js/);
    assert.match(html, /groupLegacyEntries\(/);
    assert.match(html, /Submission week of/);
    assert.match(html, /Original prompt text unavailable\./);
    assert.match(html, /Past entries/);
    assert.doesNotMatch(html, /Earlier entries|View earlier entries|Saved before prompts were linked/);
    assert.match(html, /Loading journal history/);
    assert.match(html, /Journal history unavailable/);
  }
  assert.match(styles, /\.journal-history-list\s*\{[^}]*overflow-y: auto/s);
  assert.match(styles, /\.journal-history-card-content\s*\{[^}]*background: var\(--blue-xpale\)/s);
  assert.match(styles, /\.journal-history-card-content\s*\{[^}]*border: 1px solid var\(--blue-pale\)/s);
  assert.match(styles, /\.journal-history-card-content\s*\{[^}]*font-style: italic/s);
  assert.match(styles, /\.journal-entry-viewer-grid/);
  assert.match(styles, /journal-entry-viewer\.is-detail/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});
