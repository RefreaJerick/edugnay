const assert = require('node:assert/strict');
const test = require('node:test');

process.env.QR_ENCRYPTION_KEY = 'test-only-fetcher-credential-key';
const databaseModule = require('../config/database');
const audit = require('../utils/auditLog');
const { codeLookup, createCodes, schoolDate, visibleCodes } = require('../config/fetcherCredentials');

const person = { id: 8, parentId: 5, isSelf: 0, fullName: 'Maria Santos',
  relationship: 'Aunt', photoFilename: '12345678-1234-1234-1234-123456789abc.jpg' };
const students = [{ studentId: 21, studentName: 'Juan Santos', sectionName: 'St. Matthew' }];
let enrollment = true;
let approved = true;
let duplicate = false;
let recorded = false;
let credential = null;
let selfRecord = null;
let failNotification = false;
let historyRows = [];
let schoolSettingsRow = { schoolYear: '2026-2027', shortName: "St. Columban's College" };
const calls = [];
const db = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async getConnection() { return this; },
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM schools') && sql.includes('AS shortName')) return [[schoolSettingsRow]];
    if (sql.includes('COUNT(*) AS count FROM pickup_records')) return [[{ count: 2 }]];
    if (sql.includes('COUNT(DISTINCT students.id) AS count')) return [[{ count: 3 }]];
    if (sql.includes('FROM pickup_records AS records')) return [historyRows];
    if (sql.includes('FROM fetchers INNER JOIN users AS parents')) {
      if (sql.includes('fetchers.is_parent_self = TRUE')) return [[selfRecord].filter(Boolean)];
      return [[values[0] === 3 && values[1] === 5 && values[2] === 8 ? person : null].filter(Boolean)];
    }
    if (sql.includes('FROM users LEFT JOIN parent_profiles')) {
      return [[{ id: 5, fullName: 'Ana Santos',
        photoFilename: '12345678-1234-1234-1234-123456789abc.jpg', contactNumber: '' }]];
    }
    if (sql.includes('INSERT INTO notifications')) {
      if (failNotification) throw new Error('Notification insert failed.');
      return [{ affectedRows: 2 }];
    }
    if (sql.includes('FROM student_parent_links AS links')) {
      return [enrollment && (!sql.includes('fetcher_authorizations') || approved) ? students : []];
    }
    if (sql.includes('INSERT INTO fetchers')) {
      selfRecord = { id: 9, parentId: 5, isSelf: 1, fullName: 'Ana Santos',
        relationship: 'Parent', photoFilename: '12345678-1234-1234-1234-123456789abc.jpg' };
      return [{ insertId: 9 }];
    }
    if (sql.includes('FROM fetcher_credentials') && sql.includes('WHERE school_id = ? AND fetcher_id = ?')) {
      return [[credential].filter(Boolean)];
    }
    if (sql.includes('INSERT INTO fetcher_credentials')) {
      credential = { id: 9, fetcherId: values[1], qrCiphertext: values[3], manualCiphertext: values[5],
        qrHash: values[2], manualHash: values[4], issuedAt: '2026-11-19', revokedAt: null };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM fetcher_credentials AS credential')) {
      const found = credential && !credential.revokedAt && values[0] === 3
        && [credential.qrHash, credential.manualHash].includes(values[1]);
      return [[found ? credential.fetcherId === 9 ? selfRecord : person : null].filter(Boolean)];
    }
    if (sql.includes('SELECT status FROM fetcher_authorizations')) {
      return [[{ status: approved ? 'approved' : 'revoked' }]];
    }
    if (sql.includes('SELECT display_name AS guardName FROM users')) return [[{ guardName: 'Security Guard' }]];
    if (sql.includes('SELECT student_user_id AS studentId FROM pickup_records')) return [[]];
    if (sql.includes('INSERT INTO pickup_records')) {
      if (duplicate || recorded) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
      recorded = true;
      return [{ insertId: 31 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
databaseModule.getDatabase = () => db;
audit.writeAuditLog = async () => {};
const controller = require('../controllers/pickupController');

function capture() {
  const result = { status: 200, body: null, error: null, headers: {} };
  return { result, res: { status(code) { result.status = code; return this; },
    set(name, value) { result.headers[name] = value; return this; },
    json(body) { result.body = body; return this; } }, next(error) { result.error = error; } };
}

async function call(handler, user, params = {}, body = {}, path = '', query = {}) {
  const output = capture();
  await handler({ user, params, body, path, query }, output.res, output.next);
  return output.result;
}

const parent = { id: 5, schoolId: 3, role: 'parent' };
const guard = { id: 7, schoolId: 3, role: 'school_guard' };

test('fetcher QR and manual codes have separate formats and hashes', () => {
  const codes = createCodes();
  const visible = visibleCodes({ qrCiphertext: codes.qrCiphertext,
    manualCiphertext: codes.manualCiphertext });
  assert.match(visible.qrPayload, /^academix:fetcher:/);
  assert.match(visible.manualCode, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){4}$/);
  assert.equal(codeLookup(visible.qrPayload).hash, codes.qrHash);
  assert.equal(codeLookup(visible.manualCode.toLowerCase()).hash, codes.manualHash);
  assert.throws(() => codeLookup('academix:attendance:old'), { status: 422 });
});

test('ID view is read only; reissue invalidates the old QR and manual codes', async () => {
  credential = null;
  enrollment = true;
  approved = true;
  const first = await call(controller.issueCredential, parent, { reference: '8' }, {}, '/credentials/8/issue');
  assert.equal(first.error, null);
  assert.equal(first.body.issued, true);
  const oldQr = first.body.qrPayload;
  const oldManual = first.body.manualCode;
  const viewed = await call(controller.getCredential, parent, { reference: '8' });
  assert.equal(viewed.body.qrPayload, oldQr);
  const next = await call(controller.issueCredential, parent, { reference: '8' }, {}, '/credentials/8/reissue');
  assert.equal(next.error, null);
  assert.notEqual(next.body.qrPayload, oldQr);
  assert.notEqual(next.body.manualCode, oldManual);
  assert.equal((await call(controller.verifyCode, guard, {}, { code: oldQr })).error.status, 422);
  assert.equal((await call(controller.verifyCode, guard, {}, { code: oldManual })).error.status, 422);
  assert.equal((await call(controller.verifyCode, guard, {}, { code: next.body.qrPayload })).body.students.length, 1);
});

test('verification and handover recheck current eligibility and school scope', async () => {
  const code = visibleCodes(credential).qrPayload;
  const otherSchool = await call(controller.verifyCode, { ...guard, schoolId: 4 }, {}, { code });
  assert.equal(otherSchool.error.status, 422);
  enrollment = false;
  const unenrolled = await call(controller.confirmPickup, guard, {}, { code, studentId: 21 });
  assert.equal(unenrolled.error.status, 409);
  enrollment = true;
  approved = false;
  const revoked = await call(controller.confirmPickup, guard, {}, { code, studentId: 21 });
  assert.equal(revoked.error.status, 409);
  approved = true;
  recorded = false;
  calls.length = 0;
  const confirmed = await call(controller.confirmPickup, guard, {}, { code, studentId: 21 });
  assert.equal(confirmed.error, null);
  assert.equal(confirmed.status, 201);
  assert.ok(calls.some(item => item.sql?.includes('FROM fetcher_authorizations') && item.sql.includes('FOR UPDATE')));
  const recordInsert = calls.find(item => item.sql?.includes('INSERT INTO pickup_records'));
  const parentAlerts = calls.find(item => item.sql?.includes('INSERT INTO notifications'));
  assert.ok(recordInsert);
  assert.deepEqual(recordInsert.values.slice(0, 8), [3, 21, 'Juan Santos', 8, 'Maria Santos', 'Aunt', 7, 'Security Guard']);
  assert.ok(parentAlerts);
  assert.match(parentAlerts.sql, /SELECT DISTINCT parents\.id, students\.id, 'pickup'/);
  assert.match(parentAlerts.sql, /parents\.account_status = 'active'/);
  assert.match(parentAlerts.sql, /CONCAT\('pickup:', \?\)/);
  assert.deepEqual(parentAlerts.values.slice(3), [31, 3, 21]);
  assert.match(parentAlerts.values[1], /^Juan Santos was picked up by Maria Santos on /);
  assert.ok(calls.indexOf(parentAlerts) < calls.indexOf('commit'));
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.fetcherId, 8);
  assert.ok(confirmed.body.pickedUpAt.endsWith('Z'));
  duplicate = true;
  const repeat = await call(controller.confirmPickup, guard, {}, { code, studentId: 21 });
  duplicate = false;
  recorded = false;
  assert.equal(repeat.error.status, 409);
});

test('a parent alert failure rolls back the handover record', async () => {
  credential = null;
  enrollment = true;
  approved = true;
  recorded = false;
  const issued = await call(controller.issueCredential, parent, { reference: '8' }, {}, '/credentials/8/issue');
  calls.length = 0;
  failNotification = true;
  const result = await call(controller.confirmPickup, guard, {}, { code: issued.body.qrPayload, studentId: 21 });
  failNotification = false;
  recorded = false;
  assert.ok(calls.some(item => item.sql?.includes('INSERT INTO notifications')));
  assert.equal(result.error.message, 'Notification insert failed.');
  assert.ok(calls.includes('rollback'));
  assert.equal(calls.includes('commit'), false);
});

test('pickup history validates dates and scopes rows to the school and linked parent', async () => {
  historyRows = [
    { id: 52, studentId: 21, studentName: 'Juan Santos', fetcherId: 8, fetcherName: 'Maria Santos',
      fetcherRelationship: 'Aunt', guardId: 7, guardName: 'Security Guard', schoolDate: '2026-11-19',
      pickedUpAt: '2026-11-19T04:00:00Z' },
    { id: 51, studentId: 22, studentName: 'Lia Santos', fetcherId: 8, fetcherName: 'Maria Santos',
      fetcherRelationship: 'Aunt', guardId: 7, guardName: 'Security Guard', schoolDate: '2026-11-19',
      pickedUpAt: '2026-11-19T03:00:00Z' }
  ];
  calls.length = 0;
  const result = await call(controller.pickupHistory, parent, {}, {}, '',
    { from: '2026-11-18', to: '2026-11-19', cursor: '60', limit: '1' });
  assert.equal(result.error, null);
  assert.equal(result.body.records.length, 1);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.equal(result.body.nextCursor, '52');
  assert.equal(result.body.timeZone, process.env.SCHOOL_TIME_ZONE || 'Asia/Manila');
  const query = calls.find(item => item.sql?.includes('FROM pickup_records AS records'));
  assert.match(query.sql, /records\.school_id = \?/);
  assert.match(query.sql, /links\.parent_user_id = \?/);
  assert.deepEqual(query.values, [3, '2026-11-18', '2026-11-19', 60, parent.id, 2]);

  calls.length = 0;
  const admin = await call(controller.pickupHistory, { ...parent, role: 'school_admin' }, {}, {}, '', {});
  assert.equal(admin.error, null);
  assert.equal(calls.find(item => item.sql?.includes('FROM pickup_records AS records')).sql.includes('links.parent_user_id'), false);
  assert.equal((await call(controller.pickupHistory, parent, {}, {}, '',
    { from: '2026-11-20', to: '2026-11-19' })).error.status, 400);
  assert.equal((await call(controller.pickupHistory, parent, {}, {}, '', { from: '2026-02-30' })).error.status, 400);
  assert.equal((await call(controller.pickupHistory, parent, {}, {}, '', { from: '2026-13-01' })).error.status, 400);
  assert.equal((await call(controller.pickupHistory, parent, {}, {}, '', { limit: '101' })).error.status, 400);
});

test('pickup date uses the configured school time zone', () => {
  const previous = process.env.SCHOOL_TIME_ZONE;
  process.env.SCHOOL_TIME_ZONE = 'Asia/Manila';
  assert.equal(schoolDate(new Date('2026-11-18T17:00:00Z')), '2026-11-19');
  if (previous === undefined) delete process.env.SCHOOL_TIME_ZONE;
  else process.env.SCHOOL_TIME_ZONE = previous;
});

test('history-name migration backfills and then requires pickup-time snapshots', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/075_add_pickup_name_snapshots.sql'), 'utf8');
  for (const column of ['student_name_at_pickup', 'fetcher_name_at_pickup',
    'fetcher_relationship_at_pickup', 'guard_name_at_pickup']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column} [^,]+ NULL`));
    assert.match(migration, new RegExp(`MODIFY COLUMN ${column} [^,]+ NOT NULL`));
  }
  assert.match(migration, /UPDATE pickup_records AS records[\s\S]*?INNER JOIN users AS students/);
  assert.match(migration, /fetchers\.is_parent_self[\s\S]*?THEN fetcher_parents\.display_name/);
  assert.match(migration, /ADD KEY idx_pickup_records_school_history \(school_id, id\)/);
  assert.match(migration, /ADD KEY idx_pickup_records_school_date \(school_id, school_date, id\)/);
});

test('a linked parent with a photo can issue their own ID without an approval row', async () => {
  credential = null;
  selfRecord = null;
  enrollment = true;
  approved = false;
  calls.length = 0;
  const issued = await call(controller.issueCredential, parent,
    { reference: 'self' }, {}, '/credentials/self/issue');
  assert.equal(issued.error, null);
  assert.equal(issued.body.fullName, 'Ana Santos');
  assert.equal(issued.body.fetcherId, 9);
  assert.ok(calls.some(item => item.sql?.includes('INSERT INTO fetchers')));
  assert.equal(calls.some(item => item.sql?.includes('INSERT INTO fetcher_authorizations')), false);
  const verified = await call(controller.verifyCode, guard, {}, { code: issued.body.manualCode });
  assert.equal(verified.error, null);
  assert.equal(verified.body.students.length, 1);
});

test('guard dashboard counts completed pickups and distinct eligible students still waiting', async () => {
  calls.length = 0;
  const result = await call(controller.todayCounts, guard);
  assert.equal(result.error, null);
  assert.equal(result.body.pickedUp, 2);
  assert.equal(result.body.awaiting, 3);
  assert.equal(result.body.schoolYear, '2026-2027');
  assert.equal(result.body.shortName, "St. Columban's College");
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  const schoolYearQuery = calls.find(item => item.sql?.includes('FROM schools') && item.sql?.includes('AS shortName'));
  assert.match(schoolYearQuery.sql, /NULLIF\(TRIM\(school_settings\.current_school_year_label\), ''\)/);
  assert.match(schoolYearQuery.sql, /SELECT active_year\.label FROM academic_years AS active_year[\s\S]*active_year\.status = 'active'/);
  assert.match(schoolYearQuery.sql, /active_year\.school_id = schools\.id/);
  assert.match(schoolYearQuery.sql, /NULLIF\(TRIM\(schools\.name\), ''\)/);
  assert.deepEqual(schoolYearQuery.values, [guard.schoolId]);
  const waitingQuery = calls.find(item => item.sql?.includes('COUNT(DISTINCT students.id) AS count'));
  assert.match(waitingQuery.sql, /NOT EXISTS \(SELECT 1 FROM pickup_records/);
  assert.match(waitingQuery.sql, /auth.status = 'approved'/);
  assert.equal(waitingQuery.values[0], guard.schoolId);
});

test('simultaneous handovers permit only one record for a student', async () => {
  credential = null;
  enrollment = true;
  approved = true;
  recorded = false;
  const issued = await call(controller.issueCredential, parent,
    { reference: '8' }, {}, '/credentials/8/issue');
  const code = issued.body.qrPayload;
  const attempts = await Promise.all([
    call(controller.confirmPickup, guard, {}, { code, studentId: 21 }),
    call(controller.confirmPickup, guard, {}, { code, studentId: 21 })
  ]);
  assert.equal(attempts.filter(item => item.status === 201 && !item.error).length, 1);
  assert.equal(attempts.filter(item => item.error?.status === 409).length, 1);
  recorded = false;
});
