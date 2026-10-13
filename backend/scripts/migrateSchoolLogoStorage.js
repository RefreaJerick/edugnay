const fs = require('node:fs/promises');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');
const { logoDirectory, logoExtension, saveSchoolLogo } = require('../config/schoolLogos');

const assetsDirectory = path.resolve(__dirname, '..', '..', 'assets', 'images');
const legacyPathPattern = /^\/assets\/images\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:png|jpe?g|webp))$/i;
const mimeTypesByExtension = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function getLegacyLogoSource(logoPath, sourceDirectory) {
  const match = legacyPathPattern.exec(String(logoPath || ''));
  if (!match) throw new Error('logo_path is not a safe legacy image path');

  const sourcePath = path.resolve(sourceDirectory, match[1]);
  if (path.dirname(sourcePath) !== path.resolve(sourceDirectory)) {
    throw new Error('logo_path resolves outside the legacy image directory');
  }

  const extension = path.extname(sourcePath).toLowerCase();
  const mimetype = mimeTypesByExtension[extension];
  if (!mimetype) throw new Error('legacy image extension is not supported');
  return { sourcePath, mimetype };
}

async function migrateLegacySchoolLogos({
  database,
  apply = false,
  sourceDirectory = assetsDirectory,
  storageDirectory = logoDirectory,
  saveLogo = saveSchoolLogo
} = {}) {
  if (!database) throw new Error('A database connection is required.');

  const [rows] = await database.execute(
    `SELECT id, name, logo_path AS logoPath
     FROM schools
     WHERE logo_path LIKE '/assets/images/%'
     ORDER BY id`
  );
  const candidates = [];
  const errors = [];

  for (const school of rows) {
    try {
      const source = getLegacyLogoSource(school.logoPath, sourceDirectory);
      const buffer = await fs.readFile(source.sourcePath);
      logoExtension({ buffer, mimetype: source.mimetype });
      candidates.push({ ...school, ...source, buffer });
    } catch (error) {
      errors.push({ schoolId: school.id, schoolName: school.name, message: error.message });
    }
  }

  if (errors.length || !apply) {
    return {
      mode: apply ? 'apply' : 'dry-run',
      candidates: candidates.map(({ id, name, logoPath, buffer }) => ({ id, name, logoPath, size: buffer.length })),
      migrated: [],
      errors
    };
  }

  const migrated = [];
  for (const candidate of candidates) {
    let newLogoName;
    let connection;
    let transactionStarted = false;
    let committed = false;

    try {
      newLogoName = await saveLogo({ mimetype: candidate.mimetype, buffer: candidate.buffer });
      if (!newLogoName) throw new Error('could not save the logo file');

      connection = await database.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const [result] = await connection.execute(
        'UPDATE schools SET logo_path = ? WHERE id = ? AND logo_path = ?',
        [newLogoName, candidate.id, candidate.logoPath]
      );
      if (result.affectedRows !== 1) throw new Error('school logo reference changed after preflight');

      await connection.commit();
      committed = true;
      migrated.push({ id: candidate.id, name: candidate.name, logoPath: newLogoName });
    } catch (error) {
      if (connection && transactionStarted && !committed) await connection.rollback().catch(() => {});
      if (newLogoName && !committed) await fs.unlink(path.join(storageDirectory, newLogoName)).catch(() => {});
      throw new Error(`Failed to migrate school ${candidate.id} (${candidate.name}): ${error.message}`, { cause: error });
    } finally {
      connection?.release();
    }
  }

  return {
    mode: 'apply',
    candidates: candidates.map(({ id, name, logoPath, buffer }) => ({ id, name, logoPath, size: buffer.length })),
    migrated,
    errors
  };
}

async function main(args = process.argv.slice(2)) {
  const invalidArguments = args.filter(argument => !['--apply', '--dry-run'].includes(argument));
  if (invalidArguments.length || (args.includes('--apply') && args.includes('--dry-run'))) {
    throw new Error('Use either --dry-run (the default) or --apply.');
  }

  const database = getDatabase();
  try {
    const result = await migrateLegacySchoolLogos({ database, apply: args.includes('--apply') });
    console.log(`School logo migration (${result.mode}): ${result.candidates.length} legacy logo(s) found.`);
    for (const candidate of result.candidates) {
      console.log(`School ${candidate.id} (${candidate.name}): ${candidate.logoPath} (${candidate.size} bytes)`);
    }
    for (const issue of result.errors) {
      console.error(`School ${issue.schoolId} (${issue.schoolName}): ${issue.message}`);
    }
    for (const item of result.migrated) {
      console.log(`Migrated school ${item.id} (${item.name}) to ${item.logoPath}.`);
    }
    if (result.errors.length) throw new Error(`${result.errors.length} legacy logo(s) need attention; no files were migrated.`);
    if (!args.includes('--apply')) console.log('No changes made. Re-run with --apply to copy files and update database references.');
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`School logo migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getLegacyLogoSource, migrateLegacySchoolLogos };
