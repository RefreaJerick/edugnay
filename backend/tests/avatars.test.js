const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalDirectory = process.env.AVATAR_DIRECTORY;
const testDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-avatar-test-'));
process.env.AVATAR_DIRECTORY = testDirectory;
const { AVATAR_ERROR, avatarDirectory, avatarFields, avatarType, deleteAvatar, saveAvatar } = require('../config/avatars');
if (originalDirectory === undefined) delete process.env.AVATAR_DIRECTORY;
else process.env.AVATAR_DIRECTORY = originalDirectory;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('avatar files use private storage, generated names, and reject unsafe paths', async () => {
  assert.equal(avatarDirectory, testDirectory);
  try {
    const filename = await saveAvatar({ mimetype: 'image/png', buffer: png, originalname: '../photo.svg' });
    assert.match(filename, /^[a-f0-9-]{36}\.png$/);
    assert.deepEqual(await fs.readFile(path.join(testDirectory, filename)), png);
    await deleteAvatar('../other-file.png');
    await deleteAvatar(filename);
    await assert.rejects(fs.access(path.join(testDirectory, filename)), { code: 'ENOENT' });
  } finally {
    assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
    await fs.rm(testDirectory, { recursive: true, force: true });
  }
});

test('avatar type checks actual bytes, MIME type, and size', () => {
  assert.equal(avatarType({ mimetype: 'image/png', buffer: png }), '.png');
  for (const file of [
    { mimetype: 'image/svg+xml', buffer: png },
    { mimetype: 'image/png', buffer: Buffer.from('not an image') },
    { mimetype: 'image/jpeg', buffer: png },
    { mimetype: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }
  ]) {
    assert.throws(() => avatarType(file), error => error.status === 400 && error.message === AVATAR_ERROR);
  }
});

test('avatar response exposes a versioned URL, never a disk filename', () => {
  assert.deepEqual(avatarFields({ id: 5, avatarFilename: null, avatarVersion: 0 }), {
    hasAvatar: false, avatarUrl: null, avatarVersion: 0
  });
  const fields = avatarFields({ id: 5, avatarFilename: '123e4567-e89b-12d3-a456-426614174000.jpg', avatarVersion: 3 });
  assert.deepEqual(fields, { hasAvatar: true, avatarUrl: '/api/users/5/avatar?v=3', avatarVersion: 3 });
  assert.equal(JSON.stringify(fields).includes('.jpg'), false);
  assert.equal(avatarFields({ id: 5, avatarFilename: '../secret.jpg', avatarVersion: 3 }).avatarUrl, null);
});
