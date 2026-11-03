// Preview by default. Apply only after reviewing the dependency report.
// Preview: node scripts/removeKindergartenAndGrade1.js --database academix
// Apply:   node scripts/removeKindergartenAndGrade1.js --database academix --apply --confirm REMOVE-KINDERGARTEN-GRADE-1-academix
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');

const LEGACY_GRADE_CODES = ['kindergarten', 'grade-1'];
const CONFIRM_PREFIX = 'REMOVE-KINDERGARTEN-GRADE-1-';

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') continue;
    if (!['--database', '--confirm'].includes(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Use --database <name>, optionally with --apply --confirm REMOVE-KINDERGARTEN-GRADE-1-<name>.');
    }
    values.set(argument, args[index + 1]);
    index += 1;
  }
  const databaseName = values.get('--database');
  if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error('Provide the expected database name with --database.');
  }
  const apply = args.includes('--apply');
  const confirmation = `${CONFIRM_PREFIX}${databaseName}`;
  if (apply && values.get('--confirm') !== confirmation) {
    throw new Error(`Applying requires --confirm ${confirmation}.`);
  }
  if (!apply && values.has('--confirm')) throw new Error('--confirm is only accepted with --apply.');
  return { databaseName, apply };
}

function safeIdentifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(value || ''))) throw new Error('Unsupported database identifier in dependency metadata.');
  return `\`${value}\``;
}

async function getLegacyGradeRows(connection, lock = false) {
  const [rows] = await connection.execute(
    `SELECT school_grade_levels.id, school_grade_levels.school_id AS schoolId,
      school_grade_levels.grade_code AS gradeCode, school_grade_levels.is_enabled AS isEnabled
    FROM school_grade_levels
    WHERE school_grade_levels.grade_code IN (?, ?)
    ORDER BY school_grade_levels.school_id, school_grade_levels.id${lock ? ' FOR UPDATE' : ''}`,
    LEGACY_GRADE_CODES
  );
  return rows;
}

async function getSectionIds(connection, gradeIds) {
  if (!gradeIds.length) return [];
  const placeholders = gradeIds.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT id FROM sections WHERE grade_level_id IN (${placeholders}) ORDER BY id`, gradeIds
  );
  return rows.map(row => row.id);
}

async function getReferenceColumns(connection) {
  const [foreignKeys] = await connection.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS referencedTable
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME IN ('school_grade_levels', 'sections')
      AND REFERENCED_COLUMN_NAME = 'id'`
  );
  const [columns] = await connection.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const references = new Map();
  foreignKeys.forEach(reference => {
    references.set(`${reference.tableName}.${reference.columnName}`, reference);
  });
  columns.forEach(column => {
    const name = String(column.columnName || '').toLowerCase();
    const referencedTable = ['grade_level_id', 'school_grade_level_id'].includes(name)
      ? 'school_grade_levels'
      : /(?:^|_)section_id$/.test(name) ? 'sections' : '';
    if (referencedTable && !references.has(`${column.tableName}.${column.columnName}`)) {
      references.set(`${column.tableName}.${column.columnName}`, { ...column, referencedTable });
    }
  });
  return [...references.values()].filter(reference =>
    reference.tableName !== 'school_grade_levels' && reference.tableName !== 'sections'
      ? true : reference.referencedTable === 'school_grade_levels'
  );
}

async function collectDependencies(connection, gradeRows) {
  const gradeIds = gradeRows.map(row => row.id);
  const sectionIds = await getSectionIds(connection, gradeIds);
  const references = await getReferenceColumns(connection);
  const dependencies = [];
  for (const reference of references) {
    const ids = reference.referencedTable === 'sections' ? sectionIds : gradeIds;
    if (!ids.length) continue;
    const placeholders = ids.map(() => '?').join(', ');
    const table = safeIdentifier(reference.tableName);
    const column = safeIdentifier(reference.columnName);
    const [[result]] = await connection.execute(
      `SELECT COUNT(*) AS rowCount FROM ${table} WHERE ${column} IN (${placeholders})`, ids
    );
    const rowCount = Number(result?.rowCount || 0);
    if (rowCount) dependencies.push({
      tableName: reference.tableName,
      columnName: reference.columnName,
      referencedTable: reference.referencedTable,
      rowCount
    });
  }
  return { sectionCount: sectionIds.length, dependencies };
}

async function runGradeCleanup(connection, { apply = false } = {}) {
  let transactionStarted = false;
  try {
    if (apply) {
      await connection.beginTransaction();
      transactionStarted = true;
    }
    const gradeRows = await getLegacyGradeRows(connection, apply);
    const { sectionCount, dependencies } = await collectDependencies(connection, gradeRows);
    const report = { gradeRows, sectionCount, dependencies, applied: false };
    if (!apply) return report;
    if (dependencies.length) {
      const detail = dependencies.map(item => `${item.tableName}.${item.columnName}: ${item.rowCount}`).join('; ');
      throw new Error(`Cleanup stopped; linked Grade-level data was found: ${detail}. No records were changed.`);
    }
    if (gradeRows.length) {
      await connection.execute(
        `DELETE FROM school_grade_levels WHERE grade_code IN (?, ?)`, LEGACY_GRADE_CODES
      );
    }
    const remaining = await getLegacyGradeRows(connection);
    if (remaining.length) throw new Error('Cleanup verification failed because Kindergarten or Grade 1 rows remain.');
    await connection.commit();
    transactionStarted = false;
    report.applied = true;
    return report;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  }
}

function printReport(report, apply) {
  process.stdout.write(`Kindergarten/Grade 1 grade rows: ${report.gradeRows.length}\n`);
  report.gradeRows.forEach(row => {
    process.stdout.write(`  ${row.gradeCode} | school ${row.schoolId} | row ${row.id} | enabled ${Boolean(row.isEnabled)}\n`);
  });
  process.stdout.write(`Sections linked to those grades: ${report.sectionCount}\n`);
  if (report.dependencies.length) {
    process.stdout.write('Linked records:\n');
    report.dependencies.forEach(item => process.stdout.write(
      `  ${item.tableName}.${item.columnName}: ${item.rowCount} row(s) via ${item.referencedTable}\n`
    ));
  } else {
    process.stdout.write('Linked records: none\n');
  }
  if (apply) process.stdout.write('Cleanup applied and verified.\n');
  else process.stdout.write('Preview only; no records were changed.\n');
}

async function main() {
  const { databaseName, apply } = parseArguments(process.argv.slice(2));
  if (databaseName !== process.env.DB_NAME) throw new Error('The requested database does not match the configured database; no records were changed.');
  const database = getDatabase();
  const connection = await database.getConnection();
  try {
    const [[identity]] = await connection.execute('SELECT DATABASE() AS databaseName');
    if (identity?.databaseName !== databaseName) throw new Error('Connected database does not match --database; no records were changed.');
    const report = await runGradeCleanup(connection, { apply });
    printReport(report, apply);
  } finally {
    connection.release();
    await database.end();
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { collectDependencies, getLegacyGradeRows, parseArguments, runGradeCleanup };
