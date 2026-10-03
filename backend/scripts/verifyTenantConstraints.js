const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');

const migrationNames = [
  '019_active_section_enrollments.sql',
  '020_add_core_tenant_constraints.sql',
  '021_add_feature_tenant_constraints.sql',
  '022_add_child_tenant_constraints.sql',
  '023_link_assignment_grading_items.sql',
  '024_track_published_grading_items.sql',
  '025_journal_entry_ownership.sql'
];

function readExpectedSchema() {
  const sql = migrationNames.map(name => fs.readFileSync(
    path.join(__dirname, '../database/migrations', name),
    'utf8'
  )).join('\n');

  const uniqueIndexes = [];
  for (const statement of sql.split(';')) {
    const table = /^\s*ALTER TABLE\s+([a-z0-9_]+)/im.exec(statement)?.[1];
    if (!table) continue;
    for (const match of statement.matchAll(/ADD UNIQUE KEY\s+([a-z0-9_]+)\s*\(([^)]+)\)/gi)) {
      uniqueIndexes.push({ table, name: match[1], columns: match[2].split(',').map(column => column.trim()) });
    }
  }

  return {
    constraints: [...sql.matchAll(/ADD CONSTRAINT\s+([a-z0-9_]+)/gi)].map(match => match[1]),
    tenantColumns: [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_]+)\s+ADD COLUMN school_id/gi)]
      .map(match => match[1]),
    uniqueIndexes
  };
}

async function main() {
  const database = getDatabase();
  const expected = readExpectedSchema();
  const [constraintRows] = await database.query(
    `SELECT CONSTRAINT_NAME AS name
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = ?`,
    [process.env.DB_NAME]
  );
  const [columnRows] = await database.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
      IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND (COLUMN_NAME = 'school_id'
       OR (TABLE_NAME = 'section_students' AND COLUMN_NAME = 'active_marker')
       OR (TABLE_NAME = 'grading_items' AND COLUMN_NAME = 'used_in_published_grades'))`,
    [process.env.DB_NAME]
  );
  const [indexRows] = await database.query(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
      COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position, NON_UNIQUE AS nonUnique
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`,
    [process.env.DB_NAME]
  );

  const installedConstraints = new Set(constraintRows.map(row => row.name));
  const tenantColumns = new Map(columnRows.filter(row => row.columnName === 'school_id')
    .map(row => [row.tableName, row.isNullable]));
  const activeMarker = columnRows.find(row => row.tableName === 'section_students' && row.columnName === 'active_marker');
  const publicationMarker = columnRows.find(row => row.tableName === 'grading_items' && row.columnName === 'used_in_published_grades');
  const indexes = new Map();
  for (const row of indexRows) {
    const key = `${row.tableName}.${row.indexName}`;
    if (!indexes.has(key)) indexes.set(key, []);
    indexes.get(key).push(row);
  }
  const missingConstraints = expected.constraints.filter(name => !installedConstraints.has(name));
  const invalidColumns = expected.tenantColumns.filter(table => tenantColumns.get(table) !== 'NO');
  const invalidIndexes = expected.uniqueIndexes.filter(index => {
    const rows = (indexes.get(`${index.table}.${index.name}`) || []).sort((a, b) => a.position - b.position);
    return rows.length !== index.columns.length || rows.some((row, position) =>
      Number(row.nonUnique) !== 0 || row.columnName !== index.columns[position]);
  });
  const invalidMarker = !activeMarker || !String(activeMarker.extra).includes('STORED GENERATED');
  const invalidPublicationMarker = !publicationMarker || publicationMarker.isNullable !== 'NO'
    || Number(publicationMarker.defaultValue) !== 0;

  console.log(`Tenant constraints checked: ${expected.constraints.length}`);
  console.log(`Required tenant columns checked: ${expected.tenantColumns.length}`);
  console.log(`Unique tenant indexes checked: ${expected.uniqueIndexes.length}`);
  console.log(`Active enrollment marker checked: ${invalidMarker ? 'invalid' : 'valid'}`);
  console.log(`Published component marker checked: ${invalidPublicationMarker ? 'invalid' : 'valid'}`);
  console.log(`Missing constraints: ${missingConstraints.length}`);
  console.log(`Missing or nullable tenant columns: ${invalidColumns.length}`);
  console.log(`Missing or invalid indexes: ${invalidIndexes.length}`);
  if (missingConstraints.length) console.log(`Missing: ${missingConstraints.join(', ')}`);
  if (invalidColumns.length) console.log(`Invalid columns: ${invalidColumns.join(', ')}`);
  if (invalidIndexes.length) console.log(`Invalid indexes: ${invalidIndexes.map(index => index.name).join(', ')}`);

  process.exitCode = missingConstraints.length || invalidColumns.length || invalidIndexes.length
    || invalidMarker || invalidPublicationMarker ? 1 : 0;
  await database.end();
}

main().catch(error => {
  console.error(`Tenant constraint verification failed: ${error.message}`);
  process.exitCode = 1;
});
