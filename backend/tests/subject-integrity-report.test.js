const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const migrationPath = path.join(root, 'backend/database/migrations/059_backfill_shs_assignment_terms.sql');
const { buildSubjectIntegrityReport, parseSchoolId, subjectReferenceQueries } = require('../scripts/reportSubjectIntegrity');

test('subject integrity report accepts only a positive school id', () => {
  assert.equal(parseSchoolId(['--school-id', '17']), 17);
  for (const args of [[], ['--school-id'], ['--school-id', '0'], ['--school-id', '-1'], ['--school-id', '1.5'], ['--school-id', 'abc']]) {
    assert.throws(() => parseSchoolId(args), /positive --school-id/);
  }
});

test('subject integrity report is read-only and scopes each data query to one school', async () => {
  const calls = [];
  const database = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      return [[]];
    }
  };

  const report = await buildSubjectIntegrityReport(database, 17);

  assert.equal(report.schoolId, '17');
  assert.deepEqual(Object.keys(report.subjectIssues), Object.keys(subjectReferenceQueries));
  assert.deepEqual(report.shsAssignmentsNeedingPeriodReview, []);
  assert.deepEqual(report.subjectForeignKeys, []);
  assert.equal(calls.length, Object.keys(subjectReferenceQueries).length + 2);
  for (const call of calls.slice(0, Object.keys(subjectReferenceQueries).length + 1)) {
    assert.match(call.sql.trim(), /^SELECT\b/i);
    assert.deepEqual(call.values, [17]);
  }
  assert.match(calls.at(-1).sql.trim(), /^SELECT\b/i);
  assert.deepEqual(calls.at(-1).values, []);
  assert.ok(calls.every(call => !/\b(UPDATE|DELETE|INSERT|REPLACE|ALTER|DROP)\b/i.test(call.sql)));
});

test('SHS assignment period repair only fills an unambiguous period', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /assignments\.academic_term_id IS NULL/);
  assert.match(migration, /assignments\.due_at IS NOT NULL/);
  assert.match(migration, /HAVING COUNT\(DISTINCT academic_terms\.id\) = 1/);
  assert.match(migration, /SET target\.academic_term_id = resolved\.academic_term_id/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+assignments/i);
});
