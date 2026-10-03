const fs = require('node:fs/promises');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');

function serialize(_key, value) {
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return { type: 'Buffer', base64: Buffer.from(value.data).toString('base64') };
  }
  return value;
}

async function main() {
  const database = getDatabase();
  const connection = await database.getConnection();
  const snapshot = { createdAt: new Date().toISOString(), database: process.env.DB_NAME, tables: {} };
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [tables] = await connection.query('SHOW FULL TABLES WHERE Table_type = ?', ['BASE TABLE']);
    if (!tables.length) throw new Error('The database has no tables to back up.');
    const tableKey = Object.keys(tables[0])[0];
    for (const item of tables) {
      const tableName = item[tableKey];
      const [[definition]] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
      snapshot.tables[tableName] = { createSql: definition['Create Table'], rows };
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await database.end();
  }

  const backupDirectory = path.join(__dirname, '../database/backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `database-snapshot-${stamp}.json`);
  const temporaryPath = `${backupPath}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(snapshot, serialize, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, backupPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  console.log(`Database snapshot saved to ${backupPath}`);
}

main().catch(error => {
  console.error(`Database snapshot failed: ${error.message}`);
  process.exitCode = 1;
});
