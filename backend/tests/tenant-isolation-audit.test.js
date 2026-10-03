const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TENANT_ISOLATION_CHECKS,
  runTenantIsolationAudit
} = require('../utils/tenantIsolationAudit');

test('tenant audit covers the high-risk school relationships with read-only queries', () => {
  const names = TENANT_ISOLATION_CHECKS.map(check => check.name);
  assert.equal(new Set(names).size, names.length);
  for (const required of [
    'student_parent_links', 'sections', 'section_students', 'section_teachers',
    'assignments', 'grading_items', 'published_final_grades', 'attendance_sessions',
    'announcements', 'learning_materials', 'journals', 'narrative_reports',
    'school_form_exports', 'explicit_tenant_columns'
  ]) {
    assert.ok(names.includes(required), `${required} must be audited`);
  }
  for (const check of TENANT_ISOLATION_CHECKS) {
    assert.match(check.sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(check.sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
  }
});

test('tenant audit counts mismatches and loads samples only for failed checks', async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT COUNT')) return [[{ mismatchCount: calls.length === 1 ? 2 : 0 }]];
      return [[{ recordId: 7 }]];
    }
  };

  const result = await runTenantIsolationAudit(database, 5);
  assert.equal(result.checkCount, TENANT_ISOLATION_CHECKS.length);
  assert.equal(result.totalMismatches, 2);
  assert.deepEqual(result.checks[0].samples, [{ recordId: 7 }]);
  assert.equal(calls.filter(call => Array.isArray(call.values)).length, 1);
  assert.deepEqual(calls.find(call => Array.isArray(call.values)).values, [5]);
});
