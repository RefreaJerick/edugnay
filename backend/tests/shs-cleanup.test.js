const assert = require('node:assert/strict');
const test = require('node:test');
const { applyCleanup, parseArguments, planCleanup, run } = require('../scripts/clearShsTestData');

test('cleanup requires an exact school and database confirmation for writes', () => {
  assert.deepEqual(parseArguments(['--school-id', '12', '--database', 'academix_test']), {
    schoolId: 12, databaseName: 'academix_test', apply: false
  });
  assert.throws(() => parseArguments(['--school-id', '12', '--database', 'academix_test', '--apply']), /CLEAR-SHS-academix_test-12/);
  assert.throws(() => parseArguments(['--school-id', '0', '--database', 'academix_test']), /positive/);
  assert.equal(parseArguments(['--school-id', '12', '--database', 'academix_test', '--apply', '--confirm', 'CLEAR-SHS-academix_test-12']).apply, true);
});

function fixture() {
  const calls = [];
  const connection = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM school_levels WHERE')) return [[{ id: 30 }]];
      if (sql.includes('FROM subjects\n') && sql.includes('EXISTS')) return [[]];
      if (sql.includes('SELECT id FROM `sections`')) return [[{ id: 40 }]];
      if (sql.includes('SELECT id FROM `subjects`')) return [[{ id: 50 }]];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [[
        { parentTable: 'sections', childTable: 'section_students', childColumn: 'section_id' },
        { parentTable: 'subjects', childTable: 'subject_grade_scopes', childColumn: 'subject_id' }
      ]];
      if (sql.includes('information_schema.COLUMNS')) return [[
        { tableName: 'sections', columnName: 'id' }, { tableName: 'sections', columnName: 'school_id' },
        { tableName: 'subjects', columnName: 'id' }, { tableName: 'subjects', columnName: 'school_id' },
        { tableName: 'section_students', columnName: 'id' }, { tableName: 'section_students', columnName: 'school_id' },
        { tableName: 'subject_grade_scopes', columnName: 'id' }, { tableName: 'subject_grade_scopes', columnName: 'school_id' }
      ]];
      if (sql.includes('SELECT id FROM `section_students`')) return [[{ id: 60 }]];
      if (sql.includes('SELECT id FROM `subject_grade_scopes`')) return [[{ id: 70 }]];
      if (sql.startsWith('DELETE FROM `')) return [{ affectedRows: values.length - (sql.includes('AND school_id') ? 1 : 0) }];
      return [[]];
    },
    async beginTransaction() { calls.push({ sql: 'BEGIN' }); },
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
    release() {}
  };
  return { connection, calls };
}

test('cleanup discovers only descendants of the selected SHS rows', async () => {
  const { connection, calls } = fixture();
  const plan = await planCleanup(connection, 12);
  assert.deepEqual([...plan.selected.keys()].sort(), ['section_students', 'sections', 'subject_grade_scopes', 'subjects']);
  assert.ok(plan.order.indexOf('section_students') < plan.order.indexOf('sections'));
  assert.ok(plan.order.indexOf('subject_grade_scopes') < plan.order.indexOf('subjects'));
  assert.ok(calls.filter(call => call.sql.includes('SELECT id FROM `')).every(call => call.values.includes(12)));
  await applyCleanup(connection, plan, 12);
  assert.ok(calls.some(call => call.sql.includes('DELETE FROM `sections`') && call.values.includes(12)));
  assert.ok(calls.some(call => call.sql.includes('DELETE FROM `subjects`') && call.values.includes(12)));
});

test('cleanup refuses a subject shared with a non-SHS section', async () => {
  const { connection, calls } = fixture();
  const original = connection.execute;
  connection.execute = (sql, values) => sql.includes('FROM section_teachers AS assignments')
    ? Promise.resolve([[{ subjectId: 50 }]])
    : original(sql, values);
  await assert.rejects(planCleanup(connection, 12), /assigned outside SHS/);
  assert.ok(!calls.some(call => call.sql.startsWith('DELETE')));
});

test('preview rolls back and never issues a DELETE', async () => {
  const { connection, calls } = fixture();
  const original = connection.execute;
  connection.execute = async (sql, values) => {
    if (sql === 'SELECT DATABASE() AS name') return [[{ name: 'academix_test' }]];
    if (sql.includes('FROM schools WHERE')) return [[{ id: 12, name: 'Test School' }]];
    return original(sql, values);
  };
  const originalWrite = process.stdout.write;
  let preview = '';
  process.stdout.write = text => { preview += text; return true; };
  try {
    await run(['--school-id', '12', '--database', 'academix_test'], { getConnection: async () => connection });
  } finally { process.stdout.write = originalWrite; }
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql.startsWith('DELETE')));
  assert.deepEqual(JSON.parse(preview).records.sections, ['40']);
  assert.deepEqual(JSON.parse(preview).records.subjects, ['50']);
});
