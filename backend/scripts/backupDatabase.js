const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');
const { logoDirectory } = require('../config/schoolLogos');

async function backupSchoolLogoFiles({ schools, sourceDirectory = logoDirectory, backupDirectory, stamp, createdAt }) {
  const finalDirectory = path.join(backupDirectory, `school-logos-${stamp}`);
  const temporaryDirectory = await fs.mkdtemp(path.join(backupDirectory, `.school-logos-${stamp}-`));
  const manifest = { createdAt, schools: [] };
  const copiedFiles = new Map();

  try {
    for (const school of schools) {
      const filename = school.logo_path;
      if (!filename) continue;
      if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename) || path.basename(filename) !== filename) {
        throw new Error(`School ${school.id} has an unsupported logo_path; migrate legacy logos before backing up.`);
      }

      const sourcePath = path.resolve(sourceDirectory, filename);
      if (path.dirname(sourcePath) !== path.resolve(sourceDirectory)) {
        throw new Error(`School ${school.id} has a logo_path outside the configured logo directory.`);
      }
      const image = await fs.readFile(sourcePath);
      let sha256 = copiedFiles.get(filename);
      if (!sha256) {
        await fs.writeFile(path.join(temporaryDirectory, filename), image, { flag: 'wx' });
        sha256 = crypto.createHash('sha256').update(image).digest('hex');
        copiedFiles.set(filename, sha256);
      }
      manifest.schools.push({ schoolId: school.id, schoolName: school.name, filename, sha256 });
    }

    await fs.writeFile(path.join(temporaryDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await fs.rename(temporaryDirectory, finalDirectory);
    return { directory: finalDirectory, manifest };
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

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
  let logoBackup;
  try {
    logoBackup = await backupSchoolLogoFiles({
      schools: snapshot.tables.schools?.rows || [],
      backupDirectory,
      stamp,
      createdAt: snapshot.createdAt
    });
    await fs.writeFile(temporaryPath, JSON.stringify(snapshot, serialize, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, backupPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    if (logoBackup) await fs.rm(logoBackup.directory, { recursive: true, force: true });
    throw error;
  }
  console.log(`Database snapshot saved to ${backupPath}`);
  console.log(`Referenced school logos saved to ${logoBackup.directory}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Database snapshot failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { backupSchoolLogoFiles };
