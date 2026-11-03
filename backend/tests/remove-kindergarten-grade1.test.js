const assert = require('node:assert/strict');
const test = require('node:test');
const { parseArguments, runGradeCleanup } = require('../scripts/removeKindergartenAndGrade1');

function createConnection({ linkedSections = [], linkedRecords = {} } = {}) {
  const gradeRows = [
    { id: 393, schoolId: 26, gradeCode: 'kindergarten', isEnabled: 0 },
    { id: 394, schoolId: 26, gradeCode: 'grade-1', isEnabled: 0 }
  ];
  const events = [];
  return {
    events,
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    async execute(sql, values = []) {
      events.push({ sql, values });
      if (sql.startsWith('DELETE FROM school_grade_levels')) {
        gradeRows.length = 0;
        return [{ affectedRows: 2 }];
      }
      if (sql.includes('FROM school_grade_levels')) return [gradeRows.filter(row => row.gradeCode === 'kindergarten' || row.gradeCode === 'grade-1')];
      if (sql.includes('FROM sections WHERE grade_level_id')) return [linkedSections];
      if (sql.includes('FROM information_schema.KEY_COLUMN_USAGE')) return [[
        { tableName: 'sections', columnName: 'grade_level_id', referencedTable: 'school_grade_levels' },
        { tableName: 'section_students', columnName: 'section_id', referencedTable: 'sections' },
        { tableName: 'subjects', columnName: 'grade_level_id', referencedTable: 'school_grade_levels' }
      ]];
      if (sql.includes('FROM information_schema.COLUMNS')) return [[
        { tableName: 'sections', columnName: 'grade_level_id' },
        { tableName: 'section_students', columnName: 'section_id' },
        { tableName: 'subjects', columnName: 'grade_level_id' }
      ]];
      if (sql.includes('SELECT COUNT(*) AS rowCount FROM')) {
        const table = sql.match(/FROM `([^`]+)`/)?.[1];
        const column = sql.match(/WHERE `([^`]+)` IN/)?.[1];
        return [[{ rowCount: linkedRecords[`${table}.${column}`] || 0 }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('migration confirmation requires the intended database name', () => {
  assert.deepEqual(parseArguments(['--database', 'academix']), { databaseName: 'academix', apply: false });
  assert.throws(() => parseArguments(['--database', 'academix', '--apply']), /requires --confirm/);
  assert.deepEqual(parseArguments([
    '--database', 'academix', '--apply', '--confirm', 'REMOVE-KINDERGARTEN-GRADE-1-academix'
  ]), { databaseName: 'academix', apply: true });
});

test('preview reports grade-linked sections and their records without writing', async () => {
  const connection = createConnection({
    linkedSections: [{ id: 501 }],
    linkedRecords: { 'sections.grade_level_id': 1, 'section_students.section_id': 3 }
  });
  const report = await runGradeCleanup(connection);
  assert.equal(report.gradeRows.length, 2);
  assert.equal(report.sectionCount, 1);
  assert.deepEqual(report.dependencies.map(item => [item.tableName, item.rowCount]), [
    ['sections', 1], ['section_students', 3]
  ]);
  assert.equal(connection.events.includes('begin'), false);
  assert.equal(connection.events.some(event => typeof event === 'object' && event.sql.startsWith('DELETE')), false);
});

test('apply stops and rolls back with a linked-record report', async () => {
  const connection = createConnection({ linkedSections: [{ id: 501 }], linkedRecords: { 'sections.grade_level_id': 1 } });
  await assert.rejects(runGradeCleanup(connection, { apply: true }), /sections\.grade_level_id: 1.*No records were changed/);
  assert.deepEqual(connection.events.filter(event => typeof event === 'string'), ['begin', 'rollback']);
  assert.equal(connection.events.some(event => typeof event === 'object' && event.sql.startsWith('DELETE')), false);
});

test('apply removes only the two unlinked grade rows and verifies the result', async () => {
  const connection = createConnection();
  const report = await runGradeCleanup(connection, { apply: true });
  assert.equal(report.applied, true);
  assert.equal(report.gradeRows.length, 2);
  assert.deepEqual(connection.events.filter(event => typeof event === 'string'), ['begin', 'commit']);
  assert.equal(connection.events.filter(event => typeof event === 'object' && event.sql.startsWith('DELETE FROM school_grade_levels')).length, 1);
});
