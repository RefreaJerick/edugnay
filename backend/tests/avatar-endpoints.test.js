const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-avatar-endpoints-'));
after(async () => {
  assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
  await fs.rm(testDirectory, { recursive: true, force: true });
});
process.env.AVATAR_DIRECTORY = testDirectory;
const avatars = require('../config/avatars');
delete process.env.AVATAR_DIRECTORY;

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { canViewAvatar, getAvatar, removeMyAvatar, uploadMyAvatar } = require('../controllers/avatarsController');
const { deleteUser } = require('../controllers/usersController');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function call(handler, req) {
  const result = { status: 200, data: null, error: null, headers: null };
  const res = {
    status(code) { result.status = code; return this; },
    set(headers) { result.headers = headers; return this; },
    json(data) { result.data = data; return this; },
    send(data) { result.data = data; return this; },
    end() { return this; }
  };
  await handler(req, res, error => { result.error = error; });
  return result;
}

test('only the owner can change a photo; replacement and removal update the version', async () => {
  const user = { id: 7, avatarFilename: null, avatarVersion: 0 };
  const connection = {
    async beginTransaction() {},
    async execute(sql, values) {
      if (sql.startsWith('SELECT')) return [[{ ...user }]];
      if (sql.startsWith('UPDATE')) {
        user.avatarFilename = sql.includes('= NULL') ? null : values[0];
        user.avatarVersion += 1;
        return [{ affectedRows: 1 }];
      }
      throw new Error('Unexpected query');
    },
    async commit() {}, async rollback() {}, release() {}
  };
  database = { getConnection: async () => connection };
  const req = { user: { id: 7 }, params: { userId: '99' },
    file: { mimetype: 'image/png', buffer: png } };
  const first = await call(uploadMyAvatar, req);
  assert.equal(first.error, null);
  assert.equal(first.data.avatar.avatarVersion, 1);
  assert.equal(first.data.avatar.hasAvatar, true);
  const firstFilename = user.avatarFilename;
  assert.deepEqual(await fs.readFile(path.join(testDirectory, firstFilename)), png);

  const second = await call(uploadMyAvatar, req);
  assert.equal(second.error, null);
  assert.equal(second.data.avatar.avatarVersion, 2);
  assert.notEqual(user.avatarFilename, firstFilename);
  await assert.rejects(fs.access(path.join(testDirectory, firstFilename)), { code: 'ENOENT' });

  const lastFilename = user.avatarFilename;
  const removed = await call(removeMyAvatar, { user: { id: 7 } });
  assert.equal(removed.status, 204);
  assert.equal(user.avatarFilename, null);
  assert.equal(user.avatarVersion, 3);
  await assert.rejects(fs.access(path.join(testDirectory, lastFilename)), { code: 'ENOENT' });
});

test('failed database commit never leaves a new file or changes the stored photo', async () => {
  const previous = avatars.avatarDirectory;
  const oldFilename = await avatars.saveAvatar({ mimetype: 'image/png', buffer: png });
  const connection = {
    async beginTransaction() {},
    async execute(sql) {
      if (sql.includes('FOR UPDATE')) return [[{ id: 8, avatarFilename: oldFilename }]];
      if (sql.startsWith('SELECT')) return [[{ id: 8, avatarVersion: 2 }]];
      return [{ affectedRows: 1 }];
    },
    async commit() { throw new Error('commit failed'); },
    async rollback() {}, release() {}
  };
  database = { getConnection: async () => connection };
  const before = await fs.readdir(previous);
  const result = await call(uploadMyAvatar, { user: { id: 8 }, file: { mimetype: 'image/png', buffer: png } });
  assert.equal(result.error.message, 'commit failed');
  assert.deepEqual(await fs.readdir(previous), before);
  await avatars.deleteAvatar(oldFilename);
});

test('avatar access denies other schools and unrelated users', async () => {
  let calls = 0;
  const denied = { execute: async () => { calls += 1; return [[]]; } };
  const owner = { id: 20, schoolId: 2, role: 'student' };
  assert.equal(await canViewAvatar(denied, { id: 1, schoolId: 1, role: 'school_admin' }, owner), false);
  assert.equal(await canViewAvatar(denied, { id: 1, schoolId: null, role: 'platform_admin' }, owner), false);
  assert.equal(calls, 0);
  assert.equal(await canViewAvatar(denied, { id: 9, schoolId: 2, role: 'parent' }, owner), false);
  assert.equal(calls, 1);
  assert.equal(await canViewAvatar({ execute: async () => [[{ 1: 1 }]] },
    { id: 9, schoolId: 2, role: 'parent' }, owner), true);
  assert.equal(await canViewAvatar(denied,
    { id: 9, schoolId: 2, role: 'parent' }, { id: 21, schoolId: 2, role: 'teacher' }), false);
  assert.equal(await canViewAvatar({ execute: async sql => {
    assert.match(sql, /narrative_reports AS reports/);
    assert.match(sql, /reports\.report_status = 'confirmed'/);
    return [[{ 1: 1 }]];
  } }, { id: 9, schoolId: 2, role: 'parent' }, { id: 21, schoolId: 2, role: 'teacher' }), true);
});

test('account deletion removes its stored photo after the database commit', async () => {
  const filename = await avatars.saveAvatar({ mimetype: 'image/png', buffer: png });
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.startsWith('SELECT id FROM schools')) return [[{ id: 2 }]];
      if (sql.includes('FROM users WHERE id = ? AND school_id = ? FOR UPDATE')) {
        return [[{ id: 20, schoolId: 2, role: 'teacher', displayName: 'Teacher', avatarFilename: filename }]];
      }
      if (sql.includes('FROM student_parent_links')) return [[]];
      if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
      if (sql.startsWith('DELETE FROM users')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected query');
    }
  };
  database = { getConnection: async () => connection };
  const result = await call(deleteUser, {
    user: { id: 2, schoolId: 2, role: 'school_admin' }, params: { userId: '20' }
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 204);
  await assert.rejects(fs.access(path.join(testDirectory, filename)), { code: 'ENOENT' });
});

test('private image responses require a permitted relationship and handle missing files', async () => {
  const filename = '123e4567-e89b-12d3-a456-426614174000.png';
  const owner = { id: 20, schoolId: 2, role: 'student', avatarFilename: filename };
  database = { execute: async sql => sql.includes('FROM users') ? [[owner]] : [[]] };
  const denied = await call(getAvatar, { params: { userId: '20' }, user: { id: 1, schoolId: 1, role: 'school_admin' } });
  assert.equal(denied.error.status, 404);
  assert.equal(denied.data, null);
  const missing = await call(getAvatar, { params: { userId: '20' }, user: { id: 20, schoolId: 2, role: 'student' } });
  assert.equal(missing.error.status, 404);
  await fs.writeFile(path.join(testDirectory, filename), png, { flag: 'wx' });
  const allowed = await call(getAvatar, { params: { userId: '20' }, user: { id: 20, schoolId: 2, role: 'student' } });
  assert.equal(allowed.error, null);
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.data, png);
  assert.equal(allowed.headers['Content-Type'], 'image/png');
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store');
  assert.equal(allowed.headers['X-Content-Type-Options'], 'nosniff');
});
