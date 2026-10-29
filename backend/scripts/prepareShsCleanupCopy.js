// Copies the reviewed backup's schema and current development data into a NEW,
// explicitly named database. Never overwrites an existing database.
// node scripts/prepareShsCleanupCopy.js <snapshot.json> <database_name>
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function main() {
  const [, , snapshotFile, target] = process.argv;
  if (!snapshotFile || !/^academix_phase2_isolated_[a-z0-9_]+$/.test(target || '')) {
    throw new Error('Provide a snapshot path and a new academix_phase2_isolated_* database name.');
  }
  const snapshot = JSON.parse(await fs.readFile(path.resolve(snapshotFile), 'utf8'));
  if (snapshot.database !== process.env.DB_NAME || snapshot.database === target) throw new Error('Snapshot source does not match the configured database.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', multipleStatements: false
  });
  try {
    const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [target]);
    if (existing.length) throw new Error('The isolated database already exists; refusing to overwrite it.');
    await connection.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query(`USE \`${target}\``);
    for (const [table, data] of Object.entries(snapshot.tables)) {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsupported table name: ${table}`);
      await connection.query(data.createSql);
    }
    for (const [table, data] of Object.entries(snapshot.tables)) {
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
         ORDER BY ORDINAL_POSITION`, [target, table]
      );
      const fields = columns.map(column => `\`${column.name}\``).join(', ');
      if (data.rows.length) {
        await connection.query(`INSERT INTO \`${target}\`.\`${table}\` (${fields}) SELECT ${fields} FROM \`${snapshot.database}\`.\`${table}\``);
      }
      const [[count]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${target}\`.\`${table}\``);
      if (Number(count.total) !== data.rows.length) throw new Error(`Copy verification failed for ${table}.`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    process.stdout.write(`Verified isolated copy ${target}: ${Object.keys(snapshot.tables).length} tables; school records unchanged.\n`);
  } finally { await connection.end(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
