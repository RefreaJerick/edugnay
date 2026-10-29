const assert = require('node:assert/strict');
const test = require('node:test');

const { studentCanAccessJournal } = require('../utils/studentJournalAccess');

test('student Journal eligibility requires the active JHS section and its assigned journal subject', async () => {
  let query;
  const database = {
    async execute(sql, values) {
      query = { sql, values };
      return [[{ eligible: 1 }]];
    }
  };
  assert.equal(await studentCanAccessJournal(database, 4, 12), true);
  assert.deepEqual(query.values, [4, 12]);
  for (const condition of [
    "student.account_status = 'active'", "year.status = 'active'",
    "level.level_code = 'jhs'", 'enrollment.withdrawn_at IS NULL',
    "section.status = 'active'", 'features.journals_enabled = TRUE',
    'journal_subject.subject_id = settings.journal_subject_id',
    'assignment.section_id = section.id', 'assignment.subject_id = subject.id'
  ]) assert.ok(query.sql.includes(condition), condition);
});

test('student Journal eligibility denies a student without a matching current assignment', async () => {
  const database = { async execute() { return [[]]; } };
  assert.equal(await studentCanAccessJournal(database, 4, 12), false);
});
