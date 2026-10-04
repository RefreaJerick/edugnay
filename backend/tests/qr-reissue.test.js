const assert = require('node:assert/strict');
const test = require('node:test');

process.env.QR_ENCRYPTION_KEY = 'test-only-qr-encryption-key';
const { encryptQrToken, hashQrToken } = require('../config/qrCredentials');
const databaseModule = require('../config/database');

const credential = {
  id: 9, schoolId: 1, studentId: 4, credentialStatus: 'active',
  tokenHash: hashQrToken('old-token'), tokenCiphertext: encryptQrToken('old-token')
};
const events = [];
let studentActive = true;
const database = {
  async execute(sql, values = []) {
    if (sql.includes("FROM users WHERE users.id = ?") && sql.includes("users.role = 'student'")) {
      return [studentActive && values[0] === 4 && values[1] === 1 ? [{ id: 4, schoolId: 1, displayName: 'Student' }] : []];
    }
    if (sql.includes('FROM student_qr_credentials WHERE school_id = ?')) return [[{
      id: credential.id, credentialStatus: credential.credentialStatus,
      tokenCiphertext: credential.tokenCiphertext, issuedAt: '2026-10-04'
    }]];
    if (sql.includes('INSERT INTO student_qr_credentials')) {
      credential.tokenHash = values[2];
      credential.tokenCiphertext = values[3];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM attendance_sessions') && sql.includes('INNER JOIN sections')) {
      return [[{ id: 21, schoolId: 1, sectionId: 8, subjectId: 1, sectionName: 'St. Matthew' }]];
    }
    if (sql.includes('FROM school_portal_features')) return [[{ attendanceEnabled: true }]];
    if (sql.includes('FROM student_qr_credentials') && sql.includes('INNER JOIN users')) {
      return [values[0] === credential.tokenHash ? [{
        id: credential.id, studentId: 4, credentialStatus: 'active', schoolId: 1,
        displayName: 'Student', initials: 'ST'
      }] : []];
    }
    if (sql.includes('FROM section_students') && sql.includes('withdrawn_at IS NULL')) return [[{ 1: 1 }]];
    if (sql.includes('SELECT id FROM qr_scan_events')) return [[]];
    if (sql.includes('INSERT INTO qr_scan_events')) { events.push(values); return [{ affectedRows: 1 }]; }
    if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async getConnection() { return this; }
};
databaseModule.getDatabase = () => database;
const { getStudentQr, regenerateStudentQr, scanQrAttendance } = require('../controllers/qrAttendanceController');

async function call(handler, req) {
  const result = { status: 200, data: null, error: null };
  await handler(req, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

test('viewing a QR is read-only; confirmed reissue invalidates the old scan and accepts the new one', async () => {
  const admin = { id: 2, schoolId: 1, role: 'school_admin' };
  const oldHash = credential.tokenHash;
  const viewed = await call(getStudentQr, { user: admin, params: { studentId: '4' } });
  assert.equal(viewed.error, null);
  assert.equal(viewed.data.qrPayload, 'academix:attendance:old-token');
  assert.equal(credential.tokenHash, oldHash);

  const reissued = await call(regenerateStudentQr, { user: admin, params: { studentId: '4' } });
  assert.equal(reissued.error, null);
  assert.notEqual(credential.tokenHash, oldHash);
  assert.match(reissued.data.qrPayload, /^academix:attendance:/);

  const teacher = { id: 3, schoolId: 1, role: 'teacher' };
  const oldScan = await call(scanQrAttendance, {
    user: teacher, params: { sessionId: '21' }, body: { qrToken: 'academix:attendance:old-token' }
  });
  assert.equal(oldScan.status, 422);
  const newScan = await call(scanQrAttendance, {
    user: teacher, params: { sessionId: '21' }, body: { qrToken: reissued.data.qrPayload }
  });
  assert.equal(newScan.status, 200);
  assert.equal(newScan.data.scanned, true);
  assert.equal(events.length, 2);
});

test('another school cannot reissue or view this student QR', async () => {
  const otherAdmin = { id: 7, schoolId: 2, role: 'school_admin' };
  const oldHash = credential.tokenHash;
  const viewed = await call(getStudentQr, { user: otherAdmin, params: { studentId: '4' } });
  const reissued = await call(regenerateStudentQr, { user: otherAdmin, params: { studentId: '4' } });
  assert.equal(viewed.error?.status, 404);
  assert.equal(reissued.error?.status, 404);
  assert.equal(credential.tokenHash, oldHash);
});

test('inactive students and non-admin teachers cannot reissue a student QR', async () => {
  const oldHash = credential.tokenHash;
  studentActive = false;
  const inactive = await call(regenerateStudentQr, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { studentId: '4' }
  });
  studentActive = true;
  const teacher = await call(regenerateStudentQr, {
    user: { id: 3, schoolId: 1, role: 'teacher' }, params: { studentId: '4' }
  });
  assert.equal(inactive.error?.status, 404);
  assert.equal(teacher.error?.status, 403);
  assert.equal(credential.tokenHash, oldHash);
});
