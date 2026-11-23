'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, answerFor, attendanceStatus, CONFIRMATION } =
  require('../scripts/seedSaintColumbanStJohnJournalAttendance');

function fixture({ failScore = false, existingPrompt = 0 } = {}) {
  const students = Array.from({ length: 40 }, (_, i) => ({ id: i + 100, name: `Student ${i}` }));
  const subjects = Array.from({ length: 9 }, (_, i) => ({
    id: i + 200, name: i === 8 ? 'Values Education' : `Subject ${i}`,
    code: `subject-${i}`, teacherId: i + 300
  }));
  const values = subjects[8];
  const meetings = subjects.slice(0, 3).map(s => ({ subjectId: s.id, subject: s.name,
    teacherId: s.teacherId }));
  const saved = { items: [], prompts: [], entries: [], scores: [], sessions: [], records: [],
    grades: [], audits: [], rubric: [] };
  const actions = { snapshots: 0, begins: 0, commits: 0, rollbacks: 0 };
  let nextId = 1000;
  const c = {
    async query(sql) {
      assert.match(sql, /FOREIGN_KEY_CHECKS/);
      return [[{ db: 'academix', fk: 1 }]];
    },
    async execute(sql, params = []) {
      assert.equal((sql.match(/\?/g) || []).length, params.length,
        `SQL placeholder mismatch: ${sql.slice(0, 90)}`);
      if (sql.includes('FROM sections s JOIN schools')) return [[{ id: 12, levelId: 13, yearId: 14 }]];
      if (sql.includes('FROM academic_terms WHERE')) return [[{ id: 15 }]];
      if (sql.includes('FROM section_students e')) return [students];
      if (sql.includes('FROM section_teachers st JOIN subjects')) return [subjects];
      if (sql.includes('FROM school_settings settings')) return [[{ id: 16 }]];
      if (sql.includes('FROM subject_grading_profiles p')) return [[{ id: 17 }]];
      if (sql.includes('FROM grading_items') && sql.includes("domain_code='affective'")) return [[{ id: 18 }]];
      if (sql.includes('AS entries') && sql.includes('AS attendance')) return [[{
        entries: saved.entries.length, scores: saved.scores.length,
        attendance: saved.records.length, grades: saved.grades.length
      }]];
      if (sql.includes('FROM student_scores') && sql.includes('grading_item_id=?')) {
        return [students.map((s, i) => ({ studentId: s.id, score: i < 5 ? 5 : 16 }))];
      }
      if (sql.includes('FROM published_final_grades WHERE') && sql.includes('publication_version AS version')
        && saved.grades.length) {
        return [saved.grades.map(g => ({ studentId: g.params[6], grade: g.params[0],
          version: 2, publishedAt: '2026-11-18 11:05:00' }))];
      }
      if (sql.includes('FROM published_final_grades WHERE') && sql.includes('DATE_FORMAT')) {
        return [students.map((s, i) => ({ studentId: s.id, grade: i < 5 ? 70 : 85, version: 1,
          publishedAt: '2026-11-18 11:05:00' }))];
      }
      if (sql.includes('AS prompts') && sql.includes('AS sessions')) {
        return [[{ prompts: existingPrompt, items: 0, sessions: 0 }]];
      }
      if (sql.includes('FROM journal_ai_rubrics')) return [[]];
      if (sql.includes('FROM timetable_meetings tm')) {
        assert.match(sql, /tm\.start_time < '10:54:00'/);
        return [meetings];
      }
      if (sql.includes('FROM attendance_status_codes')) return [[{ code: 'present' },
        { code: 'late' }, { code: 'absent' }]];
      if (sql.includes('FROM notifications WHERE event_key LIKE')) return [[{ n: 40 }]];
      if (sql.includes('SELECT id FROM sections WHERE') && sql.includes('FOR UPDATE')) return [[{ id: 12 }]];
      if (sql.includes('INSERT INTO journal_ai_rubrics')) { saved.rubric.push(params); return [{ affectedRows: 1 }]; }
      for (const [needle, key] of [
        ['INSERT INTO grading_items', 'items'], ['INSERT INTO journal_prompts', 'prompts'],
        ['INSERT INTO student_journal_entries', 'entries'], ['INSERT INTO student_scores', 'scores'],
        ['INSERT INTO attendance_sessions', 'sessions'], ['INSERT INTO attendance_records', 'records'],
        ['UPDATE published_final_grades', 'grades'], ['INSERT INTO audit_logs', 'audits']
      ]) {
        if (sql.includes(needle)) {
          if (key === 'scores' && failScore && saved.scores.length === 5) throw new Error('score failed');
          const id = nextId++;
          saved[key].push({ id, params, sql });
          return [{ insertId: id, affectedRows: 1 }];
        }
      }
      throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    },
    async beginTransaction() { actions.begins++; },
    async commit() { actions.commits++; },
    async rollback() { actions.rollbacks++; },
    release() {}
  };
  const database = { async getConnection() { return c; } };
  const snapshot = () => { actions.snapshots++; return 'available-test-snapshot'; };
  const calculate = async (_c, user, scope) => {
    assert.equal(user.id, values.teacherId);
    assert.equal(scope.subjectId, values.id);
    return { issues: [], passingGradeThreshold: 75, domainRuleVersion: 'deped_values_domains_2026',
      gradingItemIds: [saved.items[0].id], students: students.map((s, i) => ({
        studentId: s.id, finalGrade: i < 5 ? 70 : 85
      })) };
  };
  return { database, snapshot, calculate, saved, actions, meetings };
}

test('mock answers are distinct and at least 15 words', () => {
  const answers = Array.from({ length: 40 }, (_, i) => answerFor(i));
  assert.equal(new Set(answers).size, 40);
  assert.ok(answers.every(a => a.split(/\s+/).length >= 15));
  assert.ok(answerFor(0, 5).split(/\s+/).length >= 15);
  assert.deepEqual(Array.from({ length: 40 }, (_, i) => attendanceStatus(i))
    .reduce((counts, status) => ({ ...counts, [status]: counts[status] + 1 }),
      { present: 0, late: 0, absent: 0 }), { present: 36, late: 2, absent: 2 });
});

test('preview and cancelled apply do not write or snapshot', async () => {
  const f = fixture();
  const preview = await run({ database: f.database, snapshot: f.snapshot, calculate: f.calculate });
  assert.equal(preview.attendanceRecords, 120);
  await run({ apply: true, confirm: async () => false,
    database: f.database, snapshot: f.snapshot, calculate: f.calculate });
  assert.equal(f.actions.snapshots, 0);
  assert.equal(f.actions.begins, 0);
});

test('apply inserts journal and scheduled attendance, then updates only Values grades', async () => {
  const f = fixture();
  const result = await run({ apply: true, confirm: async phrase => phrase === CONFIRMATION,
    database: f.database, snapshot: f.snapshot, calculate: f.calculate });
  assert.equal(result.verified, true);
  assert.equal(f.actions.snapshots, 1);
  assert.equal(f.actions.commits, 1);
  assert.equal(f.saved.entries.length, 40);
  assert.equal(f.saved.scores.length, 40);
  assert.equal(f.saved.records.length, 120);
  assert.equal(f.saved.grades.length, 40);
  assert.ok(f.saved.grades.every(g => g.sql.includes('published_at=?') &&
    g.sql.includes('publication_version=publication_version+1')));
  assert.ok(f.saved.sessions.every(s => s.params[5] < '2026-11-18 10:59:00'));
});

test('existing journal stops before snapshot; insert failure rolls back', async () => {
  const existing = fixture({ existingPrompt: 1 });
  await assert.rejects(run({ apply: true, confirm: async () => true,
    database: existing.database, snapshot: existing.snapshot }), /already exists/);
  assert.equal(existing.actions.snapshots, 0);
  const failed = fixture({ failScore: true });
  await assert.rejects(run({ apply: true, confirm: async () => true,
    database: failed.database, snapshot: failed.snapshot,
    calculate: failed.calculate }), /score failed/);
  assert.equal(failed.actions.snapshots, 1);
  assert.equal(failed.actions.rollbacks, 1);
  assert.equal(failed.actions.commits, 0);
});

test('snapshot failure prevents a transaction and writes', async () => {
  const f = fixture();
  await assert.rejects(run({ apply: true, confirm: async () => true,
    database: f.database, snapshot: () => { throw new Error('snapshot unavailable'); },
    calculate: f.calculate }), /snapshot unavailable/);
  assert.equal(f.actions.begins, 0);
  assert.equal(f.saved.items.length, 0);
});
