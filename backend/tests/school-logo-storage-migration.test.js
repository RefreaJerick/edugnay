const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-school-logo-migration-'));
const storageDirectory = path.join(testDirectory, 'storage');
const assetsDirectory = path.join(testDirectory, 'assets');
process.env.SCHOOL_LOGO_DIRECTORY = storageDirectory;
const { migrateLegacySchoolLogos } = require('../scripts/migrateSchoolLogoStorage');
delete process.env.SCHOOL_LOGO_DIRECTORY;

beforeEach(async () => {
  await fs.rm(assetsDirectory, { recursive: true, force: true });
  await fs.rm(storageDirectory, { recursive: true, force: true });
});

after(async () => {
  assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
  await fs.rm(testDirectory, { recursive: true, force: true });
});

function imageBytes(extension) {
  if (extension === '.png') return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  if (extension === '.jpg' || extension === '.jpeg') return Buffer.from([255, 216, 255, 1, 2, 3]);
  const image = Buffer.alloc(16);
  image.write('RIFF', 0, 'ascii');
  image.write('WEBP', 8, 'ascii');
  return image;
}

async function writeLegacyLogo(name, extension) {
  await fs.mkdir(assetsDirectory, { recursive: true });
  const buffer = imageBytes(extension);
  await fs.writeFile(path.join(assetsDirectory, name), buffer);
  return buffer;
}

function createDatabase(rows, update = (_row, _newPath) => ({ affectedRows: 1 })) {
  return {
    async execute(sql) {
      assert.match(sql, /SELECT id, name, logo_path AS logoPath/);
      return [rows.map(row => ({ ...row }))];
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(sql, values) {
          assert.match(sql, /UPDATE schools SET logo_path = \? WHERE id = \? AND logo_path = \?/);
          const [newPath, id, oldPath] = values;
          const row = rows.find(item => item.id === id && item.logoPath === oldPath);
          if (!row) return [{ affectedRows: 0 }];
          const result = update(row, newPath);
          if (result.affectedRows === 1) row.logoPath = newPath;
          return [result];
        },
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };
}

test('dry run validates legacy images without writing files or changing database references', async () => {
  const original = await writeLegacyLogo('scc-logo.png', '.png');
  const rows = [{ id: 1, name: 'SCC', logoPath: '/assets/images/scc-logo.png' }];
  const result = await migrateLegacySchoolLogos({
    database: createDatabase(rows),
    sourceDirectory: assetsDirectory,
    storageDirectory
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].size, original.length);
  assert.deepEqual(result.migrated, []);
  assert.equal(rows[0].logoPath, '/assets/images/scc-logo.png');
  await assert.rejects(fs.access(storageDirectory), error => error.code === 'ENOENT');
});

test('apply copies PNG, JPEG, and WebP bytes, updates references, and is safe to rerun', async () => {
  const logos = [
    { id: 1, name: 'SCC', filename: 'scc.png', extension: '.png' },
    { id: 2, name: 'MNHS', filename: 'mnhs.jpeg', extension: '.jpeg' },
    { id: 3, name: 'WebP School', filename: 'webp.webp', extension: '.webp' }
  ];
  const originals = new Map();
  for (const logo of logos) originals.set(logo.id, await writeLegacyLogo(logo.filename, logo.extension));
  const rows = logos.map(logo => ({ id: logo.id, name: logo.name, logoPath: `/assets/images/${logo.filename}` }));
  const database = createDatabase(rows);

  const result = await migrateLegacySchoolLogos({ database, apply: true, sourceDirectory: assetsDirectory, storageDirectory });
  assert.equal(result.migrated.length, logos.length);
  for (const logo of logos) {
    const row = rows.find(item => item.id === logo.id);
    assert.match(row.logoPath, /^[a-f0-9-]{36}\.(png|jpg|webp)$/);
    assert.deepEqual(await fs.readFile(path.join(storageDirectory, row.logoPath)), originals.get(logo.id));
    await fs.access(path.join(assetsDirectory, logo.filename));
  }

  const rerun = await migrateLegacySchoolLogos({ database, apply: true, sourceDirectory: assetsDirectory, storageDirectory });
  assert.deepEqual(rerun.candidates, []);
  assert.deepEqual(rerun.migrated, []);
});

test('preflight reports unsafe, missing, and invalid legacy files before changing any record', async () => {
  const rows = [
    { id: 1, name: 'Unsafe', logoPath: '/assets/images/../outside.png' },
    { id: 2, name: 'Missing', logoPath: '/assets/images/missing.png' },
    { id: 3, name: 'Invalid', logoPath: '/assets/images/invalid.png' }
  ];
  await writeLegacyLogo('invalid.png', '.png');
  await fs.writeFile(path.join(assetsDirectory, 'invalid.png'), Buffer.from('not a PNG'));
  const result = await migrateLegacySchoolLogos({ database: createDatabase(rows), apply: true, sourceDirectory: assetsDirectory, storageDirectory });

  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.migrated, []);
  assert.deepEqual(rows.map(row => row.logoPath), [
    '/assets/images/../outside.png', '/assets/images/missing.png', '/assets/images/invalid.png'
  ]);
  await assert.rejects(fs.access(storageDirectory), error => error.code === 'ENOENT');
});

test('conditional database-update conflict removes the copied file and keeps the old reference', async () => {
  await writeLegacyLogo('race.png', '.png');
  const rows = [{ id: 4, name: 'Race', logoPath: '/assets/images/race.png' }];
  const database = createDatabase(rows, () => ({ affectedRows: 0 }));

  await assert.rejects(
    migrateLegacySchoolLogos({ database, apply: true, sourceDirectory: assetsDirectory, storageDirectory }),
    /reference changed after preflight/
  );
  assert.equal(rows[0].logoPath, '/assets/images/race.png');
  assert.deepEqual(await fs.readdir(storageDirectory), []);
});

test('database update failure removes the copied file and leaves the legacy image intact', async () => {
  await writeLegacyLogo('failure.png', '.png');
  const rows = [{ id: 5, name: 'Failure', logoPath: '/assets/images/failure.png' }];
  const database = createDatabase(rows, () => { throw new Error('database unavailable'); });

  await assert.rejects(
    migrateLegacySchoolLogos({ database, apply: true, sourceDirectory: assetsDirectory, storageDirectory }),
    /database unavailable/
  );
  assert.equal(rows[0].logoPath, '/assets/images/failure.png');
  assert.deepEqual(await fs.readdir(storageDirectory), []);
  await fs.access(path.join(assetsDirectory, 'failure.png'));
});
