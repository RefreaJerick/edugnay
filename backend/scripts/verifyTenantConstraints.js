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
  '025_journal_entry_ownership.sql',
  '038_legacy_shs_tracks_strands_and_subject_scopes.sql',
  '040_subject_year_grading_rules.sql'
];

const requiredShsConstraints = [
  'fk_school_shs_strands_track', 'fk_school_shs_strands_tenant_level', 'fk_school_shs_strands_tenant_track',
  'fk_subject_grade_scopes_school', 'fk_subject_grade_scopes_subject', 'fk_subject_grade_scopes_grade',
  'fk_subject_grade_scopes_track', 'fk_subject_grade_scopes_strand'
];
const requiredShsColumns = {
  sections: ['track_id', 'strand_id'],
  subjects: ['shs_grading_group'],
  school_shs_strands: ['school_id', 'school_level_id', 'track_id', 'strand_code', 'display_name'],
  subject_grade_scopes: ['school_id', 'subject_id', 'grade_level_id', 'track_id', 'strand_id']
};
const requiredSubjectGradingConstraints = [
  'fk_subject_grading_profiles_school', 'fk_subject_grading_profiles_year',
  'fk_subject_grading_profiles_level', 'fk_subject_grading_profiles_subject',
  'fk_subject_grading_profiles_copy', 'fk_subject_grading_components_profile',
  'fk_subject_grading_exam_parts_component', 'fk_assignments_subject_grading_component',
  'fk_assignments_subject_grading_exam_part', 'fk_grading_items_subject_grading_component',
  'fk_grading_items_subject_grading_exam_part'
];
const requiredSubjectGradingColumns = {
  subject_grading_profiles: ['school_id', 'academic_year_id', 'school_level_id', 'subject_id'],
  subject_grading_components: ['school_id', 'profile_id', 'code', 'component_type', 'weight'],
  subject_grading_exam_parts: ['school_id', 'component_id', 'code', 'weight'],
  assignments: ['subject_grading_component_id', 'subject_grading_exam_part_id'],
  grading_items: ['subject_grading_component_id', 'subject_grading_exam_part_id', 'used_in_published_grades']
};

function readExpectedSchema() {
  const sql = migrationNames.map(name => fs.readFileSync(
    path.join(__dirname, '../database/migrations', name),
    'utf8'
  )).join('\n').replace(/^[ \t]*--.*$/gm, '');

  const uniqueIndexes = [];
  for (const statement of sql.split(';')) {
    const table = /^\s*(?:ALTER TABLE|CREATE TABLE(?: IF NOT EXISTS)?)\s+`?([a-z0-9_]+)/im.exec(statement)?.[1];
    if (!table) continue;
    for (const match of statement.matchAll(/(?:ADD\s+)?UNIQUE KEY\s+([a-z0-9_]+)\s*\(([^)]+)\)/gi)) {
      uniqueIndexes.push({ table, name: match[1], columns: match[2].split(',').map(column => column.trim()) });
    }
  }

  return {
    constraints: [...sql.matchAll(/(?:ADD\s+)?CONSTRAINT\s+([a-z0-9_]+)/gi)].map(match => match[1]),
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
       OR (TABLE_NAME = 'grading_items' AND COLUMN_NAME = 'used_in_published_grades')
       OR (TABLE_NAME IN ('assignments', 'grading_items') AND COLUMN_NAME IN ('subject_grading_component_id', 'subject_grading_exam_part_id'))
       OR TABLE_NAME IN ('sections', 'subjects', 'school_shs_strands', 'subject_grade_scopes',
         'subject_grading_profiles', 'subject_grading_components', 'subject_grading_exam_parts'))`,
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
  const missingShsConstraints = requiredShsConstraints.filter(name => !installedConstraints.has(name));
  const missingSubjectGradingConstraints = requiredSubjectGradingConstraints.filter(name => !installedConstraints.has(name));
  const columnsByTable = new Map();
  columnRows.forEach(row => {
    if (!columnsByTable.has(row.tableName)) columnsByTable.set(row.tableName, new Set());
    columnsByTable.get(row.tableName).add(row.columnName);
  });
  const missingShsColumns = Object.entries(requiredShsColumns).flatMap(([table, required]) =>
    required.filter(column => !columnsByTable.get(table)?.has(column)).map(column => `${table}.${column}`)
  );
  const missingSubjectGradingColumns = Object.entries(requiredSubjectGradingColumns).flatMap(([table, required]) =>
    required.filter(column => !columnsByTable.get(table)?.has(column)).map(column => `${table}.${column}`)
  );

  console.log(`Tenant constraints checked: ${expected.constraints.length}`);
  console.log(`Required tenant columns checked: ${expected.tenantColumns.length}`);
  console.log(`Unique tenant indexes checked: ${expected.uniqueIndexes.length}`);
  console.log(`Active enrollment marker checked: ${invalidMarker ? 'invalid' : 'valid'}`);
  console.log(`Published component marker checked: ${invalidPublicationMarker ? 'invalid' : 'valid'}`);
  console.log(`Missing constraints: ${missingConstraints.length}`);
  console.log(`Missing SHS curriculum constraints: ${missingShsConstraints.length}`);
  console.log(`Missing subject-grading constraints: ${missingSubjectGradingConstraints.length}`);
  console.log(`Missing or nullable tenant columns: ${invalidColumns.length}`);
  console.log(`Missing SHS curriculum columns: ${missingShsColumns.length}`);
  console.log(`Missing subject-grading columns: ${missingSubjectGradingColumns.length}`);
  console.log(`Missing or invalid indexes: ${invalidIndexes.length}`);
  if (missingConstraints.length) console.log(`Missing: ${missingConstraints.join(', ')}`);
  if (missingShsConstraints.length) console.log(`Missing SHS constraints: ${missingShsConstraints.join(', ')}`);
  if (missingSubjectGradingConstraints.length) console.log(`Missing subject-grading constraints: ${missingSubjectGradingConstraints.join(', ')}`);
  if (invalidColumns.length) console.log(`Invalid columns: ${invalidColumns.join(', ')}`);
  if (missingShsColumns.length) console.log(`Missing SHS columns: ${missingShsColumns.join(', ')}`);
  if (missingSubjectGradingColumns.length) console.log(`Missing subject-grading columns: ${missingSubjectGradingColumns.join(', ')}`);
  if (invalidIndexes.length) console.log(`Invalid indexes: ${invalidIndexes.map(index => index.name).join(', ')}`);

  process.exitCode = missingConstraints.length || missingShsConstraints.length || missingShsColumns.length
    || missingSubjectGradingConstraints.length || missingSubjectGradingColumns.length || invalidColumns.length || invalidIndexes.length
    || invalidMarker || invalidPublicationMarker ? 1 : 0;
  await database.end();
}

main().catch(error => {
  console.error(`Tenant constraint verification failed: ${error.message}`);
  process.exitCode = 1;
});
