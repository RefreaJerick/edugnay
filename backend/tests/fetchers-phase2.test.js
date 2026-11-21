const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
const avatars = require('../config/avatars');
const audit = require('../utils/auditLog');

let linkedChildren = [{ studentId: 21, studentName: 'Juan Santos',
  gradeLevel: 'Grade 8', sectionName: 'St. Matthew' }];
let parentActive = true;
let fetcher = { id: 8, schoolId: 3, parentId: 5, isParentSelf: 0,
  fullName: 'Maria Santos', relationship: 'Aunt', contactNumber: '09123456789',
  photoFilename: '12345678-1234-1234-1234-123456789abc.jpg' };
let authorization = { id: 12, status: 'pending', studentId: 21, fetcherId: 8,
  parentId: 5, fullName: 'Maria Santos', photoFilename: fetcher.photoFilename };
let parentPhoto = null;
let failInsert = false;
let listedFetchers = [];
const deletedPhotos = [];
const calls = [];
const connection = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('SELECT DISTINCT students.id AS studentId')) return [linkedChildren];
    if (sql.includes("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'parent'")) {
      return [parentActive ? [{ id: values[0] }] : []];
    }
    if (sql.includes("SELECT display_name AS studentName FROM users WHERE id = ? AND school_id = ? AND role = 'student'")) {
      return [linkedChildren.filter(child => child.studentId === values[0]).map(child => ({ studentName: child.studentName }))];
    }
    if (sql.includes('avatar_filename AS avatarFilename') && sql.includes("role = 'parent'")) {
      return [[{ avatarFilename: parentPhoto, avatarVersion: 2 }]];
    }
    if (sql.includes('FROM fetchers') && sql.includes('is_parent_self = FALSE') && sql.includes('LEFT JOIN')) return [listedFetchers];
    if (sql.includes('FROM fetchers WHERE id = ? AND school_id = ? AND parent_user_id = ?')) {
      return [[values[1] === 3 && values[2] === 5 ? fetcher : null].filter(Boolean)];
    }
    if (sql.includes('FROM fetchers WHERE id = ? AND school_id = ? AND is_parent_self = FALSE')) {
      return [[values[1] === 3 ? { parentId: 5, photoFilename: fetcher.photoFilename } : null].filter(Boolean)];
    }
    if (sql.includes('FROM fetcher_authorizations AS authorizations') && sql.includes('FOR UPDATE')) {
      return [[values[1] === 3 ? authorization : null].filter(Boolean)];
    }
    if (sql.includes('FROM fetcher_authorizations') && sql.includes('FOR UPDATE')) return [[authorization]];
    if (sql.startsWith('INSERT INTO fetchers')) {
      if (failInsert) throw new Error('database write failed');
      return [{ insertId: 8 }];
    }
    if (sql.startsWith('UPDATE fetcher_authorizations SET status = ?')) authorization.status = values[0];
    return [{ affectedRows: 1 }];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: connection.execute.bind(connection) });
avatars.avatarType = () => '.jpg';
avatars.saveAvatar = async () => 'photo.jpg';
avatars.deleteAvatar = async filename => { deletedPhotos.push(filename); };
audit.writeAuditLog = async () => {};
const controller = require('../controllers/fetchersController');

function capture() {
  const result = { status: 200, body: null, error: null };
  return { result, res: {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; }
  }, next(error) { result.error = error; } };
}

function parentRequest(body = {}, extras = {}) {
  return { user: { id: 5, role: 'parent', schoolId: 3 }, body, ...extras };
}

test('parent fetcher list includes the active grade and section for linked children', async () => {
  calls.length = 0;
  const response = capture();
  await controller.listMine(parentRequest(), response.res, response.next);
  assert.equal(response.result.error, null);
  assert.deepEqual(response.result.body.children, [{ studentId: 21, studentName: 'Juan Santos',
    gradeLevel: 'Grade 8', sectionName: 'St. Matthew' }]);
  const childrenQuery = calls.find(call => call.sql?.includes('SELECT DISTINCT students.id AS studentId'));
  assert.match(childrenQuery.sql, /current_year\.status = 'active'/);
  assert.match(childrenQuery.sql, /current_enrollment\.withdrawn_at IS NULL/);
});

test('fetcher photo URL changes only when the saved photo changes', async () => {
  listedFetchers = [{ ...fetcher, authorizationId: 12, studentId: 21,
    status: 'approved', reviewedAt: null }];
  try {
    const first = capture();
    await controller.listMine(parentRequest(), first.res, first.next);
    const originalUrl = first.result.body.fetchers[0].photoUrl;
    assert.match(originalUrl, /^\/api\/fetchers\/8\/photo\?v=[a-f0-9]{12}$/);

    const unchanged = capture();
    await controller.listMine(parentRequest(), unchanged.res, unchanged.next);
    assert.equal(unchanged.result.body.fetchers[0].photoUrl, originalUrl);

    listedFetchers[0].photoFilename = '87654321-4321-4321-4321-cba987654321.jpg';
    const replaced = capture();
    await controller.listMine(parentRequest(), replaced.res, replaced.next);
    assert.notEqual(replaced.result.body.fetchers[0].photoUrl, originalUrl);
  } finally {
    listedFetchers = [];
  }
});

test('registration accepts a linked enrolled child and rejects an unlinked child', async () => {
  calls.length = 0;
  const invalid = capture();
  await controller.createFetcher(parentRequest({ fullName: 'Maria Santos', relationship: 'Aunt',
    contactNumber: '09123456789', studentIds: '[99]' }, { file: {} }), invalid.res, invalid.next);
  assert.equal(invalid.result.error.status, 403);
  assert.equal(calls.some(call => call.sql?.startsWith('INSERT INTO fetchers')), false);

  calls.length = 0;
  const valid = capture();
  await controller.createFetcher(parentRequest({ fullName: 'Maria Santos', relationship: 'Aunt',
    contactNumber: '09123456789', studentIds: '[21]' }, { file: {} }), valid.res, valid.next);
  assert.equal(valid.result.error, null);
  assert.equal(valid.result.status, 201);
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO fetcher_authorizations')));
  assert.ok(calls.includes('commit'));
});

test('failed registration rolls back and removes the saved photo', async () => {
  calls.length = 0;
  deletedPhotos.length = 0;
  failInsert = true;
  const result = capture();
  await controller.createFetcher(parentRequest({ fullName: 'Maria Santos', relationship: 'Aunt',
    contactNumber: '09123456789', studentIds: '[21]' }, { file: {} }), result.res, result.next);
  failInsert = false;
  assert.equal(result.result.error.message, 'database write failed');
  assert.ok(calls.includes('rollback'));
  assert.deepEqual(deletedPhotos, ['photo.jpg']);
});

test('approval rechecks the current parent link and editing identity resets approval', async () => {
  calls.length = 0;
  linkedChildren = [];
  const stale = capture();
  await controller.decideAuthorization({ user: { id: 2, role: 'school_admin', schoolId: 3 },
    params: { authorizationId: '12', decision: 'approve' }, body: {} }, stale.res, stale.next);
  assert.equal(stale.result.error.status, 403);
  assert.equal(calls.some(call => call.sql?.startsWith('UPDATE fetcher_authorizations SET status = ?')), false);

  linkedChildren = [{ studentId: 21, studentName: 'Juan Santos' }];
  calls.length = 0;
  const approved = capture();
  await controller.decideAuthorization({ user: { id: 2, role: 'school_admin', schoolId: 3 },
    params: { authorizationId: '12', decision: 'approve' }, body: {} }, approved.res, approved.next);
  assert.equal(approved.result.error, null);
  assert.equal(authorization.status, 'approved');

  calls.length = 0;
  const edited = capture();
  await controller.updateFetcher(parentRequest({ contactNumber: '09999999999' },
    { params: { fetcherId: '8' } }), edited.res, edited.next);
  assert.equal(edited.result.error, null);
  assert.ok(calls.some(call => call.sql?.includes("SET status = 'pending'")));
  assert.ok(calls.some(call => call.sql?.includes('UPDATE fetcher_credentials SET revoked_at = NOW()')));
});

test('parent eligibility needs a photo and active linked enrollment', async () => {
  const missingPhoto = capture();
  await controller.listMine(parentRequest(), missingPhoto.res, missingPhoto.next);
  assert.equal(missingPhoto.result.body.self.eligible, false);
  parentPhoto = '12345678-1234-1234-1234-123456789abc.jpg';
  const ready = capture();
  await controller.listMine(parentRequest(), ready.res, ready.next);
  assert.equal(ready.result.body.self.eligible, true);
  linkedChildren = [];
  const unlinked = capture();
  await controller.listMine(parentRequest(), unlinked.res, unlinked.next);
  assert.equal(unlinked.result.body.self.eligible, false);
});

test('a parent can revoke and resubmit one child request', async () => {
  linkedChildren = [{ studentId: 21, studentName: 'Juan Santos' }];
  authorization.status = 'approved';
  calls.length = 0;
  const revoked = capture();
  await controller.revokeChild(parentRequest({}, { params: { fetcherId: '8', studentId: '21' } }),
    revoked.res, revoked.next);
  assert.equal(revoked.result.error, null);
  assert.equal(revoked.result.body.status, 'revoked');
  assert.ok(calls.some(call => call.sql?.includes("SET status = 'revoked'")));

  authorization.status = 'revoked';
  calls.length = 0;
  const resubmitted = capture();
  await controller.requestChild(parentRequest({}, { params: { fetcherId: '8', studentId: '21' } }),
    resubmitted.res, resubmitted.next);
  assert.equal(resubmitted.result.error, null);
  assert.equal(resubmitted.result.body.status, 'pending');
  assert.ok(calls.some(call => call.sql?.includes("SET status = 'pending'")));
  assert.ok(calls.includes('commit'));
});

test('school admin can reject a pending child request', async () => {
  authorization.status = 'pending';
  calls.length = 0;
  const rejected = capture();
  await controller.decideAuthorization({ user: { id: 2, role: 'school_admin', schoolId: 3 },
    params: { authorizationId: '12', decision: 'reject' }, body: {} },
  rejected.res, rejected.next);
  assert.equal(rejected.result.error, null);
  assert.equal(rejected.result.body.status, 'rejected');
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE fetcher_authorizations SET status = ?')
    && call.values[0] === 'rejected' && call.values[2] === 12));
});

test('fetcher photo cannot be read by another parent or another school', async () => {
  for (const user of [{ id: 6, role: 'parent', schoolId: 3 }, { id: 2, role: 'school_admin', schoolId: 4 }]) {
    const result = capture();
    await controller.getPhoto({ user, params: { fetcherId: '8' } }, result.res, result.next);
    assert.equal(result.result.error.status, 404);
  }
});
