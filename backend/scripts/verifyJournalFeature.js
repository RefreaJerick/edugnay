const assert = require('node:assert/strict');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');
const journals = require('../controllers/journalsController');

async function responseFrom(handler, user) {
  let body;
  let error;
  await handler({ user, query: {} }, { json(value) { body = value; } }, value => { error = value; });
  if (error) throw error;
  return body;
}

async function main() {
  const database = getDatabase();
  try {
    const [[counts]] = await database.execute(`SELECT COUNT(*) AS total,
      SUM(entries.journal_prompt_id IS NULL AND entries.owner_teacher_user_id IS NULL) AS unresolved,
      SUM(entries.journal_prompt_id IS NOT NULL AND
        (entries.owner_teacher_user_id IS NULL OR entries.owner_teacher_user_id <> prompts.created_by_user_id)) AS wrongOwner
      FROM student_journal_entries AS entries
      LEFT JOIN journal_prompts AS prompts ON prompts.school_id = entries.school_id
        AND prompts.id = entries.journal_prompt_id`);
    assert.equal(Number(counts.wrongOwner || 0), 0, 'A linked entry has the wrong teacher owner');
    const [schools] = await database.execute(`SELECT DISTINCT school_id AS schoolId FROM student_journal_entries`);
    for (const school of schools) {
      const [identities] = await database.execute(`SELECT DISTINCT owner_teacher_user_id AS teacherId FROM student_journal_entries
        WHERE school_id = ? AND owner_teacher_user_id IS NOT NULL`, [school.schoolId]);
      for (const identity of identities) {
        const teacher = await responseFrom(journals.listJournalHistory,
          { id: identity.teacherId, schoolId: school.schoolId, role: 'teacher' });
        const [ownedRows] = await database.execute('SELECT id FROM student_journal_entries WHERE school_id = ? AND owner_teacher_user_id = ?', [school.schoolId, identity.teacherId]);
        const ownedIds = new Set(ownedRows.map(row => Number(row.id)));
        assert.deepEqual(new Set(teacher.entries.map(entry => Number(entry.id))), ownedIds);
      }
      const [[feature]] = await database.execute(`SELECT school_portal_features.journals_enabled AS enabled
        FROM school_portal_features WHERE school_id = ?`, [school.schoolId]);
      if (feature?.enabled && identities.length) {
        const current = await responseFrom(journals.listJournalPrompts,
          { id: identities[0].teacherId, schoolId: school.schoolId, role: 'teacher' });
        assert.ok(current.journalPrompts.every(prompt =>
          ['open', 'late', 'deadline_passed', 'closed', 'not_open'].includes(prompt.submissionState)
          && /\+08:00$/.test(prompt.opensAt) && /\+08:00$/.test(prompt.dueAt)));
      }
      const [students] = await database.execute('SELECT DISTINCT student_user_id AS studentId FROM student_journal_entries WHERE school_id = ?', [school.schoolId]);
      for (const studentRow of students) {
        const student = await responseFrom(journals.listJournalHistory,
          { id: studentRow.studentId, schoolId: school.schoolId, role: 'student' });
        const [ownRows] = await database.execute('SELECT id FROM student_journal_entries WHERE school_id = ? AND student_user_id = ?', [school.schoolId, studentRow.studentId]);
        assert.deepEqual(new Set(student.entries.map(entry => Number(entry.id))), new Set(ownRows.map(row => Number(row.id))));
      }
      const admin = await responseFrom(journals.listJournalHistory,
        { id: 0, schoolId: school.schoolId, role: 'school_admin' });
      const [schoolRows] = await database.execute('SELECT id FROM student_journal_entries WHERE school_id = ?', [school.schoolId]);
      assert.deepEqual(new Set(admin.entries.map(entry => Number(entry.id))), new Set(schoolRows.map(row => Number(row.id))));
    }
    console.log(`Journal verification passed: ${counts.total} entries; ${counts.unresolved || 0} unresolved legacy entries retained.`);
  } finally {
    await database.end();
  }
}

main().catch(error => {
  console.error(`Journal verification failed: ${error.message}`);
  process.exitCode = 1;
});
