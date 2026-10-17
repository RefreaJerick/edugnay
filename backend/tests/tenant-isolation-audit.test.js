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
    'subject_grading_profiles', 'subject_grading_components', 'subject_grading_exam_parts',
    'subject_grading_assignments', 'subject_grading_items',
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
      if (sql.includes('information_schema.COLUMNS')) {
        const columns = new Set(['sections.track_id']);
        TENANT_ISOLATION_CHECKS.forEach(check => {
          check.requiresColumns?.forEach(column => columns.add(column));
          check.requiresTables?.forEach(table => columns.add(`${table}.id`));
        });
        return [[...columns].map(value => {
          const [tableName, columnName] = value.split('.');
          return { tableName, columnName };
        })];
      }
      if (sql.startsWith('SELECT COUNT')) {
        const count = calls.filter(statement => statement.sql?.startsWith('SELECT COUNT')).length;
        return [[{ mismatchCount: count === 1 ? 2 : 0 }]];
      }
      return [[{ recordId: 7 }]];
    }
  };

  const result = await runTenantIsolationAudit(database, 5);
  assert.equal(result.checkCount, TENANT_ISOLATION_CHECKS.filter(check => !check.unlessColumns?.length).length);
  assert.equal(result.totalMismatches, 2);
  assert.deepEqual(result.checks[0].samples, [{ recordId: 7 }]);
  assert.equal(calls.filter(call => Array.isArray(call.values)).length, 1);
  assert.deepEqual(calls.find(call => Array.isArray(call.values)).values, [5]);
});

test('tenant audit remains usable before the track-strand migration is applied', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('information_schema.COLUMNS')) {
        const columns = new Set(['sections.strand_id', 'school_shs_tracks.id']);
        return [[...columns].map(value => {
          const [tableName, columnName] = value.split('.');
          return { tableName, columnName };
        })];
      }
      return [[{ mismatchCount: 0 }]];
    }
  };
  const result = await runTenantIsolationAudit(database);
  assert.ok(result.checks.some(check => check.name === 'sections_legacy_track_placement'));
  assert.equal(result.checks.some(check => check.name === 'sections'), false);
  assert.equal(result.checks.some(check => check.name === 'explicit_shs_scope_ownership'), false);
  assert.ok(calls.every(sql => !sql.includes('school_shs_strands') && !sql.includes('subject_grade_scopes')));
});
