const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { getPrivateStorageDirectory } = require('../config/privateStorage');

function withStorageSetting(value, callback) {
  const key = 'TEST_PRIVATE_STORAGE_DIRECTORY';
  const original = process.env[key];
  process.env[key] = value;
  try { callback(key); }
  finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

test('private storage accepts a directory outside the project workspace', () => {
  const directory = path.join(os.tmpdir(), 'academix-private-storage-test');
  withStorageSetting(directory, key => {
    assert.equal(getPrivateStorageDirectory(key, 'unused'), path.resolve(directory));
  });
});

test('private storage rejects the project workspace and a drive root', () => {
  withStorageSetting(path.resolve(__dirname, '..'), key => {
    assert.throws(() => getPrivateStorageDirectory(key, 'unused'), /outside the project workspace/);
  });
  withStorageSetting(path.parse(__dirname).root, key => {
    assert.throws(() => getPrivateStorageDirectory(key, 'unused'), /outside the project workspace/);
  });
});
