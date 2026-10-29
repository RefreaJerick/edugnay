// Prepare a school-scoped cleanup for disposable SHS development records.
// Preview is the default. This script is never called by an API or migration.
// Preview: node backend/scripts/clearShsTestData.js --school-id 12 --database academix_test
// Apply only after reviewing the preview in an isolated database:
// node backend/scripts/clearShsTestData.js --school-id 12 --database academix_test --apply --confirm CLEAR-SHS-academix_test-12
const { getDatabase } = require('../config/database');

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Provide a positive --school-id.');
  return id;
}

function parseArguments(args) {
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? null : args[index + 1];
  };
  const schoolId = positiveId(option('--school-id'));
  const databaseName = option('--database');
  if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('Provide the expected database name with --database.');
  const apply = args.includes('--apply');
  const confirmation = `CLEAR-SHS-${databaseName}-${schoolId}`;
  if (apply && option('--confirm') !== confirmation) throw new Error(`Applying requires --confirm ${confirmation}.`);
  return { schoolId, databaseName, apply };
}

async function selectIds(connection, table, clause, values) {
  const [rows] = await connection.execute(`SELECT id FROM \`${table}\` WHERE ${clause}`, values);
  return rows.map(row => String(row.id));
}

async function planCleanup(connection, schoolId) {
  const [[level]] = await connection.execute(
    "SELECT id FROM school_levels WHERE school_id = ? AND level_code = 'shs' LIMIT 1", [schoolId]
  );
  if (!level) throw new Error('This school has no SHS level. Nothing was selected.');
  const [mixedSubjects] = await connection.execute(
    `SELECT subjects.id FROM subjects
      WHERE subjects.school_id = ? AND EXISTS (
        SELECT 1 FROM subject_grade_scopes AS scopes
        INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
        WHERE scopes.school_id = subjects.school_id AND scopes.subject_id = subjects.id AND grades.school_level_id = ?
      ) AND EXISTS (
        SELECT 1 FROM subject_grade_scopes AS scopes
        INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
        WHERE scopes.school_id = subjects.school_id AND scopes.subject_id = subjects.id AND grades.school_level_id <> ?
      ) LIMIT 1`, [schoolId, level.id, level.id]
  );
  if (mixedSubjects.length) throw new Error('Some subjects are shared with another school level. Separate them before clearing SHS data.');
  const [mixedAssignments] = await connection.execute(
    `SELECT assignments.subject_id AS subjectId FROM section_teachers AS assignments
      INNER JOIN sections ON sections.id = assignments.section_id AND sections.school_id = assignments.school_id
      INNER JOIN subject_grade_scopes AS scopes ON scopes.subject_id = assignments.subject_id AND scopes.school_id = assignments.school_id
      INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
      WHERE assignments.school_id = ? AND grades.school_level_id = ? AND sections.school_level_id <> ? LIMIT 1`,
    [schoolId, level.id, level.id]
  );
  if (mixedAssignments.length) throw new Error('Some SHS subjects are assigned outside SHS. Separate them before clearing SHS data.');

  const roots = new Map([
    ['sections', await selectIds(connection, 'sections', 'school_id = ? AND school_level_id = ?', [schoolId, level.id])],
    ['subjects', await selectIds(connection, 'subjects', `school_id = ? AND (school_level_id = ? OR grade_level_id IN (
      SELECT id FROM school_grade_levels WHERE school_id = ? AND school_level_id = ?
    ) OR id IN (
      SELECT scopes.subject_id FROM subject_grade_scopes AS scopes
      INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
      WHERE scopes.school_id = ? AND grades.school_level_id = ?
    ))`, [schoolId, level.id, schoolId, level.id, schoolId, level.id])]
  ]);
  const [foreignKeys] = await connection.execute(
    `SELECT TABLE_NAME AS childTable, COLUMN_NAME AS childColumn,
      REFERENCED_TABLE_NAME AS parentTable
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE()
      AND REFERENCED_COLUMN_NAME = 'id' AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  const [columns] = await connection.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const columnSets = new Map();
  for (const column of columns) {
    if (!columnSets.has(column.tableName)) columnSets.set(column.tableName, new Set());
    columnSets.get(column.tableName).add(column.columnName);
  }
  const selected = new Map([...roots].map(([table, ids]) => [table, new Set(ids)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of foreignKeys) {
      const parentIds = [...(selected.get(key.parentTable) || [])];
      if (!parentIds.length) continue;
      if (key.childTable === 'school_settings' && key.childColumn === 'journal_subject_id') continue;
      const childColumns = columnSets.get(key.childTable);
      if (!childColumns?.has('id')) throw new Error(`Cleanup cannot safely handle ${key.childTable}; review its foreign key first.`);
      const known = selected.get(key.childTable) || new Set();
      for (let offset = 0; offset < parentIds.length; offset += 500) {
        const batch = parentIds.slice(offset, offset + 500);
        const schoolCheck = childColumns.has('school_id') ? ' AND school_id = ?' : '';
        const ids = await selectIds(connection, key.childTable,
          `\`${key.childColumn}\` IN (${batch.map(() => '?').join(',')})${schoolCheck}`,
          childColumns.has('school_id') ? [...batch, schoolId] : batch);
        for (const id of ids) if (!known.has(id)) { known.add(id); changed = true; }
      }
      if (known.size) selected.set(key.childTable, known);
    }
  }

  // A table may have more than one parent. Delete every child before any parent.
  const order = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = table => {
    if (visited.has(table)) return;
    if (visiting.has(table)) throw new Error(`Cleanup found a foreign-key cycle at ${table}.`);
    visiting.add(table);
    foreignKeys.filter(key => key.parentTable === table && selected.has(key.childTable))
      .forEach(key => visit(key.childTable));
    visiting.delete(table);
    visited.add(table);
    order.push(table);
  };
  [...selected.keys()].forEach(visit);
  const oldStrandIds = await selectIds(connection, 'school_shs_strands', 'school_id = ? AND school_level_id = ?', [schoolId, level.id]);
  const oldTrackIds = await selectIds(connection, 'school_shs_tracks', "school_id = ? AND school_level_id = ? AND track_code NOT IN ('academic', 'techpro')", [schoolId, level.id]);
  return { selected, order, columnSets, shsLevelId: level.id, oldStrandIds, oldTrackIds };
}

async function applyCleanup(connection, plan, schoolId) {
  const subjectIds = [...(plan.selected.get('subjects') || [])];
  for (let offset = 0; offset < subjectIds.length; offset += 500) {
    const batch = subjectIds.slice(offset, offset + 500);
    await connection.execute(`UPDATE school_settings SET journal_subject_id = NULL
      WHERE school_id = ? AND journal_subject_id IN (${batch.map(() => '?').join(',')})`, [schoolId, ...batch]);
  }
  for (const table of plan.order) {
    const ids = [...plan.selected.get(table)];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const schoolCheck = plan.columnSets.get(table)?.has('school_id') ? ' AND school_id = ?' : '';
      const [result] = await connection.execute(
        `DELETE FROM \`${table}\` WHERE id IN (${batch.map(() => '?').join(',')})${schoolCheck}`,
        schoolCheck ? [...batch, schoolId] : batch
      );
      if (result.affectedRows !== batch.length) throw new Error(`Cleanup count changed in ${table}; all changes were rolled back.`);
    }
  }
  await connection.execute(
    `DELETE FROM school_shs_strands WHERE school_id = ? AND school_level_id = ?`, [schoolId, plan.shsLevelId]
  );
  await connection.execute(
    `DELETE FROM school_shs_tracks WHERE school_id = ? AND school_level_id = ?
      AND track_code NOT IN ('academic', 'techpro')`, [schoolId, plan.shsLevelId]
  );
}

async function run(args = process.argv.slice(2), pool = getDatabase()) {
  const { schoolId, databaseName, apply } = parseArguments(args);
  const connection = await pool.getConnection();
  try {
    const [[database]] = await connection.execute('SELECT DATABASE() AS name');
    if (database?.name !== databaseName) throw new Error('The connected database does not match --database.');
    const [[school]] = await connection.execute('SELECT id, name FROM schools WHERE id = ? LIMIT 1', [schoolId]);
    if (!school) throw new Error('School not found.');
    await connection.beginTransaction();
    const plan = await planCleanup(connection, schoolId);
    const counts = Object.fromEntries([...plan.selected].map(([table, ids]) => [table, ids.size]));
    counts.school_shs_strands = plan.oldStrandIds.length;
    counts.old_school_shs_tracks = plan.oldTrackIds.length;
    const records = Object.fromEntries([...plan.selected].map(([table, ids]) => [table, [...ids]]));
    records.school_shs_strands = plan.oldStrandIds;
    records.old_school_shs_tracks = plan.oldTrackIds;
    process.stdout.write(`${JSON.stringify({ database: databaseName, schoolId, schoolName: school.name, apply, counts, records }, null, 2)}\n`);
    if (apply) {
      await applyCleanup(connection, plan, schoolId);
      await connection.commit();
    } else {
      await connection.rollback();
    }
    return counts;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

if (require.main === module) run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { applyCleanup, parseArguments, planCleanup, run };
