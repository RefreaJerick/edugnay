const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backupSchoolLogoFiles } = require('../scripts/backupDatabase');

const testDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-school-logo-backup-'));
const sourceDirectory = path.join(testDirectory, 'source');
const backupDirectory = path.join(testDirectory, 'backups');

beforeEach(async () => {
  await fs.rm(sourceDirectory, { recursive: true, force: true });
  await fs.rm(backupDirectory, { recursive: true, force: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.mkdir(backupDirectory, { recursive: true });
});

after(async () => {
  assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
  await fs.rm(testDirectory, { recursive: true, force: true });
});

test('logo backup copies referenced files and writes a school-to-file manifest', async () => {
  const filename = '123e4567-e89b-12d3-a456-426614174000.png';
  const image = Buffer.from('school logo bytes');
  await fs.writeFile(path.join(sourceDirectory, filename), image);

  const result = await backupSchoolLogoFiles({
    schools: [
      { id: 1, name: 'SCC', logo_path: filename },
      { id: 2, name: 'SCC Second Reference', logo_path: filename }
    ],
    sourceDirectory,
    backupDirectory,
    stamp: 'test-stamp',
    createdAt: '2026-10-13T00:00:00.000Z'
  });

  assert.deepEqual(await fs.readFile(path.join(result.directory, filename)), image);
  const manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schools.length, 2);
  assert.deepEqual(manifest.schools.map(school => school.schoolId), [1, 2]);
  assert.equal(manifest.schools[0].sha256, manifest.schools[1].sha256);
});

test('logo backup rejects legacy or unsafe paths and cleans its temporary folder', async () => {
  await assert.rejects(
    backupSchoolLogoFiles({
      schools: [{ id: 1, name: 'Legacy', logo_path: '/assets/images/legacy.png' }],
      sourceDirectory,
      backupDirectory,
      stamp: 'invalid-stamp',
      createdAt: '2026-10-13T00:00:00.000Z'
    }),
    /migrate legacy logos before backing up/
  );
  assert.deepEqual(await fs.readdir(backupDirectory), []);
});

test('logo backup reports missing referenced files and leaves no partial backup', async () => {
  await assert.rejects(
    backupSchoolLogoFiles({
      schools: [{ id: 3, name: 'Missing', logo_path: '123e4567-e89b-12d3-a456-426614174000.png' }],
      sourceDirectory,
      backupDirectory,
      stamp: 'missing-stamp',
      createdAt: '2026-10-13T00:00:00.000Z'
    }),
    error => error.code === 'ENOENT'
  );
  assert.deepEqual(await fs.readdir(backupDirectory), []);
});
