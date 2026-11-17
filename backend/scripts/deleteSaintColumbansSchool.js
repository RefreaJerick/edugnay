'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createInterface } = require('node:readline/promises');

const execFileAsync = promisify(execFile);
const SCHOOL_NAME = "Saint Columban's College";
const DATABASE_NAME = 'academix';
const PROTECTED_TABLES = new Set(['school_form_templates', 'school_form_template_mappings']);
const FILE_COLUMNS = [
  ['schools', 'logo_path', 'school-logo'],
  ['users', 'avatar_filename', 'avatar'],
  ['announcements', 'image_path', 'announcement-image'],
  ['assignment_submissions', 'file_path', 'assignment-submission'],
  ['learning_materials', 'stored_file_name', 'learning-material'],
  ['school_form_exports', 'file_path', 'school-form-export']
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function parseArgs(args) {
  const options = { apply: false };
  const valueOptions = new Set(['--snapshot-id', '--rds-instance-id', '--region']);

  for (let index = 0; index < args.length; index += 1) {
    const [rawName, inlineValue] = args[index].split(/=(.*)/s, 2);
    if (rawName === '--apply') {
      assert(inlineValue === undefined, '--apply does not take a value.');
      options.apply = true;
      continue;
    }
    assert(valueOptions.has(rawName), `Unknown option: ${rawName}`);
    const value = inlineValue === undefined ? args[++index] : inlineValue;
    assert(value && !value.startsWith('--'), `${rawName} requires a value.`);
    options[rawName.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
  }

  if (options.apply) {
    assert(options.snapshotId, 'Applying requires --snapshot-id for an available RDS snapshot.');
    assert(options.rdsInstanceId, 'Applying requires --rds-instance-id.');
    assert(options.region && /^[a-z0-9-]+$/.test(options.region), 'Applying requires a valid --region.');
  } else {
    assert(!options.snapshotId && !options.rdsInstanceId && !options.region,
      'Snapshot options are only valid with --apply.');
  }

  return options;
}

function buildDeleteOrder(tableCounts, foreignKeys) {
  const tables = Object.keys(tableCounts).filter(table => Number(tableCounts[table]) > 0);
  const tableSet = new Set(tables);
  const childrenByParent = new Map(tables.map(table => [table, new Set()]));
  const parentsByChild = new Map(tables.map(table => [table, new Set()]));

  for (const foreignKey of foreignKeys) {
    if (foreignKey.parentTable === foreignKey.childTable
      || !tableSet.has(foreignKey.parentTable) || !tableSet.has(foreignKey.childTable)) continue;
    childrenByParent.get(foreignKey.parentTable).add(foreignKey.childTable);
    parentsByChild.get(foreignKey.childTable).add(foreignKey.parentTable);
  }

  const ready = tables.filter(table => parentsByChild.get(table).size === 0).sort();
  const parentFirst = [];
  while (ready.length) {
    const table = ready.shift();
    parentFirst.push(table);
    for (const child of childrenByParent.get(table)) {
      parentsByChild.get(child).delete(table);
      if (parentsByChild.get(child).size === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  assert(parentFirst.length === tables.length, 'The selected school records contain a foreign-key cycle; no records or files were changed.');
  return parentFirst.reverse();
}

function getStorageDirectories({ projectRoot, home = os.homedir(), env = process.env }) {
  const privateDirectory = (key, folder) => path.resolve(env[key] || path.join(home, '.academix', 'uploads', folder));
  return {
    schoolLogo: path.resolve(env.SCHOOL_LOGO_DIRECTORY || path.join(home, '.academix', 'uploads', 'school-logos')),
    avatar: privateDirectory('AVATAR_DIRECTORY', 'avatars'),
    announcementImage: path.resolve(env.ANNOUNCEMENT_IMAGE_DIRECTORY || path.join(home, '.academix', 'uploads', 'announcements')),
    assignmentSubmission: privateDirectory('ASSIGNMENT_SUBMISSION_DIRECTORY', 'assignment-submissions'),
    learningMaterial: privateDirectory('MATERIAL_UPLOAD_DIRECTORY', 'learning-materials'),
    schoolFormExport: privateDirectory('SF_EXPORT_DIRECTORY', 'sf-exports'),
    legacyAssignmentSubmission: path.resolve(projectRoot, 'backend', 'uploads', 'assignment-submissions'),
    legacySchoolFormExport: path.resolve(projectRoot, 'backend', 'uploads', 'sf-exports')
  };
}

function resolveManagedFile(table, column, value, directories) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  let directoryKey;
  let fileName = raw;
  let legacyPrefix = '';
  let validName;

  if (table === 'schools' && column === 'logo_path') {
    directoryKey = 'schoolLogo';
    validName = /^[a-f0-9-]{36}\.(png|jpg|webp)$/i;
  } else if (table === 'users' && column === 'avatar_filename') {
    directoryKey = 'avatar';
    validName = /^[a-f0-9-]{36}\.(png|jpg|webp)$/i;
  } else if (table === 'announcements' && column === 'image_path') {
    directoryKey = 'announcementImage';
    validName = /^[a-f0-9-]{36}\.(png|jpg|webp)$/i;
  } else if (table === 'learning_materials' && column === 'stored_file_name') {
    directoryKey = 'learningMaterial';
    validName = /^[a-f0-9-]{36}\.(pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|png|mp4)$/i;
  } else if (table === 'assignment_submissions' && column === 'file_path') {
    legacyPrefix = 'uploads/assignment-submissions/';
    directoryKey = 'assignmentSubmission';
    validName = /^[a-z0-9][a-z0-9._ -]{0,249}\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;
  } else if (table === 'school_form_exports' && column === 'file_path') {
    legacyPrefix = 'uploads/sf-exports/';
    directoryKey = 'schoolFormExport';
    validName = /^sf(?:1|2|3|5|8|9|10)-[a-f0-9-]{36}\.xlsx$/i;
  } else {
    return { error: `No managed upload directory is configured for ${table}.${column}.` };
  }

  const normalized = raw.replace(/^\/+/, '');
  if (legacyPrefix && normalized.startsWith(legacyPrefix)) {
    fileName = normalized.slice(legacyPrefix.length);
    directoryKey = table === 'assignment_submissions' ? 'legacyAssignmentSubmission' : 'legacySchoolFormExport';
  }
  if (!validName.test(fileName) || path.basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    return { error: `Unsupported stored upload path in ${table}.${column}.` };
  }

  const directory = directories[directoryKey];
  const filePath = path.resolve(directory, fileName);
  if (path.dirname(filePath) !== path.resolve(directory)) {
    return { error: `Stored upload path escapes its configured directory in ${table}.${column}.` };
  }
  return { path: filePath, fileName, directory };
}

async function verifyRdsTarget({ region, snapshotId, instanceId, databaseName, databaseHost, awsJson }) {
  assert(databaseName === DATABASE_NAME, `DB_NAME must be ${DATABASE_NAME}.`);
  assert(region && /^[a-z0-9-]+$/.test(region), 'A valid AWS region is required.');
  assert(snapshotId && /^[A-Za-z][A-Za-z0-9-]{0,254}$/.test(snapshotId), 'Use a manual RDS snapshot identifier.');
  assert(instanceId && /^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(instanceId), 'Use the RDS DB instance identifier.');

  const [snapshotResponse, instanceResponse] = await Promise.all([
    awsJson(['rds', 'describe-db-snapshots', '--db-snapshot-identifier', snapshotId, '--snapshot-type', 'manual', '--region', region, '--output', 'json']),
    awsJson(['rds', 'describe-db-instances', '--db-instance-identifier', instanceId, '--region', region, '--output', 'json'])
  ]);
  const snapshots = snapshotResponse.DBSnapshots || [];
  const instances = instanceResponse.DBInstances || [];
  assert(snapshots.length === 1, 'AWS did not return exactly one snapshot with the supplied identifier.');
  assert(snapshots[0].SnapshotType === 'manual', 'Use a manual RDS snapshot for this deletion.');
  assert(snapshots[0].Status === 'available', 'The RDS snapshot must have status available.');
  assert(snapshots[0].DBInstanceIdentifier === instanceId, 'The RDS snapshot belongs to a different DB instance.');
  assert(instances.length === 1, 'AWS did not return exactly one DB instance with the supplied identifier.');
  assert(instances[0].DBInstanceStatus === 'available', 'The target RDS DB instance is not available.');
  assert(instances[0].Engine === 'mariadb', 'The target RDS DB instance is not MariaDB.');

  const endpoint = String(instances[0].Endpoint?.Address || '').toLowerCase();
  const configuredHost = String(databaseHost || '').trim().replace(/^\w+:\/\//, '').split('/')[0]
    .replace(/:\d+$/, '').toLowerCase();
  assert(endpoint && configuredHost === endpoint,
    'DB_HOST does not match the endpoint of the RDS instance that owns the snapshot.');
  return { snapshotId: snapshots[0].DBSnapshotIdentifier, instanceId, endpoint };
}

function awsJson(args) {
  return execFileAsync('aws', args, { windowsHide: true, maxBuffer: 1024 * 1024 })
    .then(({ stdout }) => JSON.parse(stdout))
    .catch(error => {
      if (error instanceof SyntaxError) throw new Error(`AWS CLI returned invalid JSON: ${error.message}`);
      throw new Error(`AWS CLI failed: ${error.stderr || error.message}`);
    });
}

async function loadSchemaMetadata(connection) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, ENGINE AS engine
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
  );
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS position,
       COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable,
       CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const [keyRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
       COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS referencedTable,
       REFERENCED_COLUMN_NAME AS referencedColumn, ORDINAL_POSITION AS position
     FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`
  );

  const tables = new Map(tableRows.map(row => [row.tableName, {
    name: row.tableName,
    engine: row.engine,
    columns: new Set(),
    columnDefinitions: new Map(),
    primaryKey: []
  }]));
  for (const row of columnRows) {
    const table = tables.get(row.tableName);
    if (!table) continue;
    table.columns.add(row.columnName);
    table.columnDefinitions.set(row.columnName, row);
  }

  const foreignKeysByName = new Map();
  for (const row of keyRows) {
    if (row.constraintName === 'PRIMARY') {
      tables.get(row.tableName)?.primaryKey.push(row.columnName);
      continue;
    }
    if (!row.referencedTable) continue;
    const key = `${row.tableName}:${row.constraintName}`;
    if (!foreignKeysByName.has(key)) {
      foreignKeysByName.set(key, {
        childTable: row.tableName,
        parentTable: row.referencedTable,
        childColumns: [],
        parentColumns: []
      });
    }
    const foreignKey = foreignKeysByName.get(key);
    foreignKey.childColumns.push(row.columnName);
    foreignKey.parentColumns.push(row.referencedColumn);
  }

  for (const table of tables.values()) {
    table.primaryKey = [...new Set(table.primaryKey)];
    table.columns = new Set(table.columns);
  }
  return { tables, foreignKeys: [...foreignKeysByName.values()] };
}

function getReachableTables(tables, foreignKeys) {
  const reachable = new Set(['schools']);
  for (const table of tables.values()) {
    if (table.columns.has('school_id') && !PROTECTED_TABLES.has(table.name)) reachable.add(table.name);
  }

  const queue = [...reachable];
  while (queue.length) {
    const parent = queue.shift();
    for (const foreignKey of foreignKeys) {
      if (foreignKey.parentTable !== parent || PROTECTED_TABLES.has(foreignKey.childTable)) continue;
      if (!reachable.has(foreignKey.childTable)) {
        reachable.add(foreignKey.childTable);
        queue.push(foreignKey.childTable);
      }
    }
  }
  return [...reachable].filter(name => tables.has(name) && !PROTECTED_TABLES.has(name)).sort();
}

function matchingColumns(leftAlias, leftColumns, rightAlias, rightColumns) {
  return leftColumns.map((column, index) =>
    `${leftAlias}.${quoteIdentifier(column)} = ${rightAlias}.${quoteIdentifier(rightColumns[index])}`
  ).join(' AND ');
}

function getParentScopeJoin(parent, scopeNames, alias = 'p', schoolId) {
  const tempName = scopeNames.get(parent.name);
  if (tempName) {
    return {
      join: ` JOIN ${quoteIdentifier(tempName)} AS ps ON ${matchingColumns(alias, parent.primaryKey, 'ps', parent.primaryKey)}`,
      where: [],
      values: []
    };
  }
  assert(parent.columns.has('school_id'), `Cannot safely scope indirectly linked table ${parent.name} because it has no primary key.`);
  const where = [`${alias}.${quoteIdentifier('school_id')} = ?`];
  const values = [schoolId];
  if (parent.name === 'users') {
    where.push(`${alias}.${quoteIdentifier('role')} <> ?`);
    values.push('platform_admin');
  }
  return { join: '', where, values };
}

function getDirectCondition(table, schoolId, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const where = [`${prefix}${quoteIdentifier('school_id')} = ?`];
  const values = [schoolId];
  if (table.name === 'users') {
    where.push(`${prefix}${quoteIdentifier('role')} <> ?`);
    values.push('platform_admin');
  }
  return { where, values };
}

async function createScopeTables(connection, tables, reachable) {
  const scopeNames = new Map();
  for (const [index, name] of reachable.entries()) {
    const table = tables.get(name);
    if (!table.primaryKey.length) continue;
    const tempName = `__scdel_${index}`;
    const columns = table.primaryKey.map(quoteIdentifier).join(', ');
    const definitions = table.primaryKey.map(column => {
      const detail = table.columnDefinitions.get(column);
      assert(detail && /^[A-Za-z0-9_(), ]+$/.test(detail.columnType), `Unsupported primary-key type in ${name}.${column}.`);
      const characterSet = detail.characterSet ? ` CHARACTER SET ${quoteIdentifier(detail.characterSet)}` : '';
      const collation = detail.collation ? ` COLLATE ${quoteIdentifier(detail.collation)}` : '';
      return `${quoteIdentifier(column)} ${detail.columnType} NOT NULL${characterSet}${collation}`;
    });
    await connection.query(`CREATE TEMPORARY TABLE ${quoteIdentifier(tempName)} (${definitions.join(', ')}, PRIMARY KEY (${columns})) ENGINE=InnoDB`);
    scopeNames.set(name, tempName);
  }
  return scopeNames;
}

async function addDirectRows(connection, tables, reachable, scopeNames, schoolId) {
  const directCounts = new Map();
  for (const name of reachable) {
    const table = tables.get(name);
    if (!table.columns.has('school_id')) continue;
    const condition = getDirectCondition(table, schoolId);
    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)} WHERE ${condition.where.join(' AND ')}`,
      condition.values
    );
    directCounts.set(name, Number(countRows[0].rowCount));
    const tempName = scopeNames.get(name);
    if (!tempName) continue;
    const pk = table.primaryKey.map(quoteIdentifier).join(', ');
    await connection.execute(
      `INSERT IGNORE INTO ${quoteIdentifier(tempName)} (${pk})
       SELECT ${pk} FROM ${quoteIdentifier(name)} WHERE ${condition.where.join(' AND ')}`,
      condition.values
    );
  }
  return directCounts;
}

async function addRootSchool(connection, scopeNames, schoolId) {
  const tempName = scopeNames.get('schools');
  assert(tempName, 'The schools table has no primary key.');
  await connection.execute(`INSERT IGNORE INTO ${quoteIdentifier(tempName)} (id) VALUES (?)`, [schoolId]);
}

function getRelationSql(child, parent, foreignKey, scopeNames, schoolId) {
  const childAlias = 'c';
  const parentAlias = 'p';
  const parentScope = getParentScopeJoin(parent, scopeNames, parentAlias, schoolId);
  const joins = [
    `JOIN ${quoteIdentifier(parent.name)} AS ${parentAlias} ON ${matchingColumns(childAlias, foreignKey.childColumns, parentAlias, foreignKey.parentColumns)}`,
    parentScope.join
  ].filter(Boolean).join('');
  const where = [...parentScope.where];
  const values = [...parentScope.values];
  if (child.columns.has('school_id')) {
    where.push(`${childAlias}.${quoteIdentifier('school_id')} = ?`);
    values.push(schoolId);
  }
  if (child.name === 'users') {
    where.push(`${childAlias}.${quoteIdentifier('role')} <> ?`);
    values.push('platform_admin');
  }
  return { joins, where, values, childAlias, parentAlias, parentScope };
}

async function populateIndirectRows(connection, tables, foreignKeys, reachable, scopeNames, schoolId) {
  const reachableSet = new Set(reachable);
  const crossTenantLinks = new Set();
  const activeKeys = foreignKeys.filter(key => reachableSet.has(key.parentTable)
    && reachableSet.has(key.childTable) && !PROTECTED_TABLES.has(key.childTable));
  let changed;

  do {
    changed = 0;

    for (const foreignKey of activeKeys) {
      const child = tables.get(foreignKey.childTable);
      const parent = tables.get(foreignKey.parentTable);
      const parentTemp = scopeNames.get(parent.name);
      if (!parentTemp && !parent.columns.has('school_id')) continue;
      const relation = getRelationSql(child, parent, foreignKey, scopeNames, schoolId);

      if (child.columns.has('school_id')) {
        const outsideWhere = [...relation.parentScope.where, `(${relation.childAlias}.${quoteIdentifier('school_id')} IS NULL OR ${relation.childAlias}.${quoteIdentifier('school_id')} <> ?)`];
        const [outsideRows] = await connection.execute(
          `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(child.name)} AS ${relation.childAlias}
           ${relation.joins} WHERE ${outsideWhere.join(' AND ')}`,
          [...relation.parentScope.values, schoolId]
        );
        if (Number(outsideRows[0].rowCount) > 0) crossTenantLinks.add(child.name);
      }

      if (!scopeNames.has(child.name)) {
        if (child.columns.has('school_id')) continue;
        const [rows] = await connection.execute(
          `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(child.name)} AS ${relation.childAlias}
           ${relation.joins} WHERE ${relation.where.join(' AND ') || '1 = 1'}`,
          relation.values
        );
        assert(Number(rows[0].rowCount) === 0,
          `Indirect table ${child.name} has related rows but no primary key; no records or files were changed.`);
        continue;
      }

      const pk = child.primaryKey.map(quoteIdentifier).join(', ');
      const [result] = await connection.execute(
        `INSERT IGNORE INTO ${quoteIdentifier(scopeNames.get(child.name))} (${pk})
         SELECT DISTINCT ${relation.childAlias}.${pk.split(', ').join(`, ${relation.childAlias}.`)}
         FROM ${quoteIdentifier(child.name)} AS ${relation.childAlias} ${relation.joins}
         WHERE ${relation.where.join(' AND ') || '1 = 1'}`,
        relation.values
      );
      changed += Number(result.affectedRows || 0);
    }
  } while (changed > 0);

  assert(crossTenantLinks.size === 0,
    `Foreign keys from other or unscoped records point into this school's data: ${[...crossTenantLinks].sort().join(', ')}. No records or files were changed.`);
}

async function getTableCounts(connection, tables, reachable, scopeNames, directCounts) {
  const counts = {};
  for (const name of reachable) {
    const tempName = scopeNames.get(name);
    let count = directCounts.get(name) || 0;
    if (tempName) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(tempName)}`);
      count = Number(row.rowCount);
    }
    if (count > 0) counts[name] = count;
  }
  for (const name of Object.keys(counts)) {
    assert(tables.get(name)?.engine === 'InnoDB', `Table ${name} is not InnoDB; a full rollback cannot be guaranteed.`);
  }
  return counts;
}

function primaryJoin(table, alias, scopeAlias) {
  return matchingColumns(alias, table.primaryKey, scopeAlias, table.primaryKey);
}

async function collectFileReferences(connection, tables, scopeNames, directCounts, directories, schoolId) {
  const referencesByPath = new Map();
  const unsupported = [];

  for (const [tableName, column, kind] of FILE_COLUMNS) {
    const table = tables.get(tableName);
    if (!table?.columns.has(column)) continue;
    let sql;
    let values = [];
    const tempName = scopeNames.get(tableName);
    if (tempName) {
      sql = `SELECT t.${quoteIdentifier(column)} AS fileValue FROM ${quoteIdentifier(tableName)} AS t
        JOIN ${quoteIdentifier(tempName)} AS s ON ${primaryJoin(table, 't', 's')}
        WHERE t.${quoteIdentifier(column)} IS NOT NULL`;
    } else if (directCounts.get(tableName) && table.columns.has('school_id')) {
      const condition = getDirectCondition(table, schoolId, 't');
      sql = `SELECT t.${quoteIdentifier(column)} AS fileValue FROM ${quoteIdentifier(tableName)} AS t
        WHERE ${condition.where.join(' AND ')} AND t.${quoteIdentifier(column)} IS NOT NULL`;
      values = condition.values;
    } else {
      continue;
    }

    const [rows] = await connection.execute(sql, values);
    const rawValues = [...new Set(rows.map(row => String(row.fileValue)))];
    for (const value of rawValues) {
      const resolved = resolveManagedFile(tableName, column, value, directories);
      if (!resolved || resolved.error) {
        unsupported.push({ table: tableName, column, value, error: resolved?.error || 'Empty file reference.' });
        continue;
      }
      const key = path.resolve(resolved.path);
      if (!referencesByPath.has(key)) referencesByPath.set(key, { path: key, fileName: resolved.fileName, references: [] });
      referencesByPath.get(key).references.push({ table: tableName, column, value, kind });
    }
  }

  const files = [];
  for (const file of referencesByPath.values()) {
    const shared = await hasOutsideReference(connection, tables, scopeNames, file.references, schoolId);
    let status = shared ? 'shared' : 'will-remove';
    try {
      const stats = await fs.lstat(file.path);
      assert(stats.isFile(), `Uploaded path is not a regular file: ${file.fileName}.`);
    } catch (error) {
      if (error.code === 'ENOENT') status = 'missing';
      else throw error;
    }
    files.push({ ...file, status });
  }
  for (const file of unsupported) files.push({ ...file, status: 'unsupported', references: [{ table: file.table, column: file.column, value: file.value }] });
  return files.sort((left, right) => String(left.path || left.value).localeCompare(String(right.path || right.value)));
}

async function hasOutsideReference(connection, tables, scopeNames, references, schoolId) {
  const group = new Map();
  for (const reference of references) {
    const key = `${reference.table}.${reference.column}`;
    if (!group.has(key)) group.set(key, { table: reference.table, column: reference.column, values: new Set() });
    group.get(key).values.add(reference.value);
  }

  for (const entry of group.values()) {
    const table = tables.get(entry.table);
    const values = new Set(entry.values);
    const legacyPrefix = entry.table === 'assignment_submissions' ? 'uploads/assignment-submissions/'
      : entry.table === 'school_form_exports' ? 'uploads/sf-exports/' : '';
    if (legacyPrefix) {
      for (const value of entry.values) {
        const normalized = String(value).replace(/^\/+/, '');
        if (normalized.startsWith(legacyPrefix)) {
          values.add(normalized);
          values.add(`/${normalized}`);
        }
      }
    }
    const candidates = [...values];
    for (let offset = 0; offset < candidates.length; offset += 400) {
      const batch = candidates.slice(offset, offset + 400);
      const conditions = [`t.${quoteIdentifier(entry.column)} IN (${batch.map(() => '?').join(', ')})`];
      const parameters = [...batch];
      const tempName = scopeNames.get(entry.table);
      if (tempName) {
        conditions.push(`NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tempName)} AS s WHERE ${primaryJoin(table, 't', 's')})`);
      } else if (table.columns.has('school_id')) {
        conditions.push('(t.`school_id` IS NULL OR t.`school_id` <> ?)');
        parameters.push(schoolId);
      } else {
        return true;
      }
      const [[row]] = await connection.execute(
        `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(entry.table)} AS t WHERE ${conditions.join(' AND ')}`,
        parameters
      );
      if (Number(row.rowCount) > 0) return true;
    }
  }
  return false;
}

async function askForConfirmation(phrase, ask) {
  if (ask) return (await ask(phrase)) === phrase;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(`Type ${phrase} to continue: `)) === phrase;
  } finally {
    prompt.close();
  }
}

async function stageFiles(files, runId, staged) {
  const missing = [];
  for (const file of files.filter(item => item.status === 'will-remove')) {
    const quarantinePath = path.join(path.dirname(file.path), `.${path.basename(file.path)}.school-delete-${runId}.pending`);
    try {
      await fs.rename(file.path, quarantinePath);
      staged.push({ sourcePath: file.path, quarantinePath, fileName: file.fileName });
    } catch (error) {
      if (error.code === 'ENOENT') missing.push(file.fileName);
      else throw error;
    }
  }
  return missing;
}

async function restoreFiles(staged) {
  const errors = [];
  for (const file of [...staged].reverse()) {
    try {
      await fs.lstat(file.sourcePath);
      errors.push(`${file.fileName}: original path is already occupied`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push(`${file.fileName}: ${error.message}`);
        continue;
      }
      try {
        await fs.rename(file.quarantinePath, file.sourcePath);
      } catch (restoreError) {
        errors.push(`${file.fileName}: ${restoreError.message}`);
      }
    }
  }
  return errors;
}

async function verifyScopedRowsGone(connection, tables, reachable, scopeNames, schoolId) {
  const remaining = [];
  for (const name of reachable) {
    const table = tables.get(name);
    const tempName = scopeNames.get(name);
    if (tempName) {
      const [[row]] = await connection.query(
        `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)} AS t
         JOIN ${quoteIdentifier(tempName)} AS s ON ${primaryJoin(table, 't', 's')}`
      );
      if (Number(row.rowCount) > 0) remaining.push(name);
    }
    if (table.columns.has('school_id')) {
      const condition = getDirectCondition(table, schoolId);
      const [rows] = await connection.execute(
        `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)} WHERE ${condition.where.join(' AND ')}`,
        condition.values
      );
      if (Number(rows[0].rowCount) > 0) remaining.push(name);
    }
  }
  const [[schoolRow]] = await connection.execute('SELECT COUNT(*) AS rowCount FROM schools WHERE id = ?', [schoolId]);
  if (Number(schoolRow.rowCount) > 0) remaining.push('schools');
  assert(remaining.length === 0,
    `Verification found remaining school records in: ${[...new Set(remaining)].sort().join(', ')}.`);
}

async function readForeignKeyChecks(connection) {
  const [[row]] = await connection.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
  return Number(row.enabled);
}

async function dropScopeTables(connection, scopeNames) {
  for (const name of scopeNames.values()) {
    await connection.query(`DROP TEMPORARY TABLE IF EXISTS ${quoteIdentifier(name)}`).catch(() => {});
  }
}

async function buildManifest(connection, school, options = {}) {
  const databaseName = options.databaseName || process.env.DB_NAME;
  assert(databaseName === DATABASE_NAME, `Refusing to use database ${databaseName || '(unset)'}; expected ${DATABASE_NAME}.`);
  const [[context]] = await connection.query('SELECT DATABASE() AS databaseName');
  assert(context.databaseName === DATABASE_NAME, `Connected database is ${context.databaseName || '(none)'}, not ${DATABASE_NAME}.`);

  const schema = await loadSchemaMetadata(connection);
  const reachable = getReachableTables(schema.tables, schema.foreignKeys);
  const scopeNames = await createScopeTables(connection, schema.tables, reachable);
  await addRootSchool(connection, scopeNames, school.id);

  const [[platformAdminRows]] = await connection.execute(
    "SELECT COUNT(*) AS rowCount FROM users WHERE school_id = ? AND role = 'platform_admin'", [school.id]
  );
  assert(Number(platformAdminRows.rowCount) === 0,
    'A platform account is attached to this school ID. No accounts, records, or files were changed.');

  const directCounts = await addDirectRows(connection, schema.tables, reachable, scopeNames, school.id);
  await populateIndirectRows(connection, schema.tables, schema.foreignKeys, reachable, scopeNames, school.id);
  const counts = await getTableCounts(connection, schema.tables, reachable, scopeNames, directCounts);
  const deleteOrder = buildDeleteOrder(counts, schema.foreignKeys);
  const directories = getStorageDirectories({ projectRoot: path.resolve(__dirname, '..', '..') });
  const files = await collectFileReferences(connection, schema.tables, scopeNames, directCounts, directories, school.id);
  const protectedCounts = {};
  for (const name of PROTECTED_TABLES) {
    if (!schema.tables.has(name)) continue;
    const [[row]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)}`);
    protectedCounts[name] = Number(row.rowCount);
  }
  return { schema, reachable, scopeNames, directCounts, counts, deleteOrder, files, protectedCounts };
}

async function deleteScopedRows(connection, plan, schoolId) {
  let totalDeleted = 0;
  for (const name of plan.deleteOrder) {
    const expected = Number(plan.counts[name]);
    const table = plan.schema.tables.get(name);
    const tempName = plan.scopeNames.get(name);
    let result;
    if (tempName) {
      result = (await connection.execute(
        `DELETE t FROM ${quoteIdentifier(name)} AS t
         JOIN ${quoteIdentifier(tempName)} AS s ON ${matchingColumns('t', table.primaryKey, 's', table.primaryKey)}`
      ))[0];
    } else {
      const condition = getDirectCondition(table, schoolId);
      result = (await connection.execute(
        `DELETE FROM ${quoteIdentifier(name)} WHERE ${condition.where.join(' AND ')}`,
        condition.values
      ))[0];
    }
    assert(Number(result.affectedRows) === expected,
      `Delete count for ${name} changed from ${expected} to ${result.affectedRows}; the transaction will roll back.`);
    totalDeleted += Number(result.affectedRows);
    assert(await readForeignKeyChecks(connection) === 1, 'Foreign-key checks were disabled during deletion.');
  }
  return totalDeleted;
}

async function verifyProtectedTables(connection, protectedCounts) {
  for (const [name, expected] of Object.entries(protectedCounts)) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)}`);
    assert(Number(row.rowCount) === expected, `Protected global table ${name} changed; the transaction will roll back.`);
  }
}

function formatPlan(school, plan, mode) {
  const counts = Object.fromEntries(Object.entries(plan.counts).sort(([left], [right]) => left.localeCompare(right)));
  const fileCounts = { willRemove: 0, shared: 0, missing: 0, unsupported: 0 };
  for (const file of plan.files) {
    if (file.status === 'will-remove') fileCounts.willRemove += 1;
    else if (file.status === 'shared') fileCounts.shared += 1;
    else if (file.status === 'missing') fileCounts.missing += 1;
    else fileCounts.unsupported += 1;
  }
  return {
    mode,
    database: DATABASE_NAME,
    school: { id: school.id, name: school.name },
    totalRecords: Object.values(counts).reduce((sum, count) => sum + count, 0),
    tableCounts: counts,
    files: {
      ...fileCounts,
      references: plan.files.map(file => ({
        file: file.fileName || path.basename(file.path || '') || file.value || '',
        status: file.status,
        records: (file.references || []).map(reference => `${reference.table}.${reference.column}`)
      }))
    },
    preservedTables: Object.keys(plan.protectedCounts).sort(),
    confirmationPhrase: `DELETE ${school.id} ${school.name}`
  };
}

async function run(options, dependencies = {}) {
  const dbEnv = dependencies.dbEnv || process.env;
  assert(dbEnv.DB_NAME === DATABASE_NAME, `DB_NAME must be ${DATABASE_NAME}.`);
  if (options.apply) {
    await (dependencies.verifyRdsTarget || verifyRdsTarget)({
      region: options.region,
      snapshotId: options.snapshotId,
      instanceId: options.rdsInstanceId,
      databaseName: dbEnv.DB_NAME,
      databaseHost: dbEnv.DB_HOST,
      awsJson: dependencies.awsJson || awsJson
    });
  }

  const database = dependencies.database || require('../config/database').getDatabase();
  let connection;
  let transactionStarted = false;
  let staged = [];
  let missingDuringStage = [];
  let plan;
  let school;

  try {
    connection = await database.getConnection();
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
    assert(await readForeignKeyChecks(connection) === 1, 'Could not enable foreign-key checks.');
    await connection.beginTransaction();
    transactionStarted = true;

    const [schools] = await connection.execute(
      `SELECT id, name FROM schools WHERE name = ? ORDER BY id LIMIT 2${options.apply ? ' FOR UPDATE' : ''}`,
      [SCHOOL_NAME]
    );
    assert(schools.length === 1, `Expected exactly one school named ${SCHOOL_NAME}; found ${schools.length}.`);
    school = schools[0];
    plan = await buildManifest(connection, school, { databaseName: dbEnv.DB_NAME, databaseHost: dbEnv.DB_HOST });
    const preview = formatPlan(school, plan, options.apply ? 'apply-preflight' : 'preview');
    console.log(JSON.stringify(preview, null, 2));

    if (!options.apply) {
      await connection.rollback();
      transactionStarted = false;
      return { preview };
    }

    assert(!plan.files.some(file => file.status === 'unsupported'),
      'Unsupported uploaded-file references exist. Review the preview and storage paths; no records or files were changed.');
    assert(await readForeignKeyChecks(connection) === 1, 'Foreign-key checks must remain enabled.');
    const confirm = dependencies.confirmDelete || askForConfirmation;
    assert(await confirm(preview.confirmationPhrase), 'Confirmation did not match; the transaction was rolled back.');

    missingDuringStage = await stageFiles(plan.files, crypto.randomUUID(), staged);
    const totalDeleted = await deleteScopedRows(connection, plan, school.id);
    await verifyScopedRowsGone(connection, plan.schema.tables, plan.reachable, plan.scopeNames, school.id);
    await verifyProtectedTables(connection, plan.protectedCounts);
    assert(await readForeignKeyChecks(connection) === 1, 'Foreign-key checks must remain enabled through verification.');

    await connection.commit();
    transactionStarted = false;

    const removedFiles = [];
    const pendingFileCleanup = [];
    for (const file of staged) {
      try {
        await fs.unlink(file.quarantinePath);
        removedFiles.push(file.fileName);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        pendingFileCleanup.push({ file: file.fileName, path: file.quarantinePath, error: error.message });
      }
    }

    await verifyPostCommit(connection, plan, school.id);
    const result = {
      mode: 'complete',
      school: { id: school.id, name: school.name },
      totalDeleted,
      tableCounts: preview.tableCounts,
      files: {
        removed: removedFiles.length,
        preservedShared: preview.files.shared,
        alreadyMissing: preview.files.missing + missingDuringStage.length,
        cleanupPending: pendingFileCleanup
      },
      foreignKeyChecks: await readForeignKeyChecks(connection),
      verified: true
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    if (transactionStarted && staged.length) {
      const restoreErrors = await restoreFiles(staged);
      if (restoreErrors.length) error.message += ` File restore needs attention: ${restoreErrors.join('; ')}.`;
    }
    throw error;
  } finally {
    if (connection && plan?.scopeNames) await dropScopeTables(connection, plan.scopeNames);
    connection?.release();
    if (!dependencies.database) await database.end();
  }
}

async function verifyPostCommit(connection, plan, schoolId) {
  const [[school]] = await connection.execute('SELECT COUNT(*) AS rowCount FROM schools WHERE id = ?', [schoolId]);
  assert(Number(school.rowCount) === 0, 'Post-commit verification found the school row still present.');
  for (const [name, table] of plan.schema.tables) {
    if (!table.columns.has('school_id')) continue;
    const condition = getDirectCondition(table, schoolId);
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)} WHERE ${condition.where.join(' AND ')}`,
      condition.values
    );
    assert(Number(rows[0].rowCount) === 0, `Post-commit verification found school_id=${schoolId} rows in ${name}.`);
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const options = parseArgs(process.argv.slice(2));
  await run(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`School deletion stopped: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCHOOL_NAME,
  buildDeleteOrder,
  formatPlan,
  getReachableTables,
  getStorageDirectories,
  askForConfirmation,
  restoreFiles,
  parseArgs,
  resolveManagedFile,
  run,
  stageFiles,
  verifyRdsTarget
};
