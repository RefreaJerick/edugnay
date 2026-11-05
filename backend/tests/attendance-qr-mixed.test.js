const assert = require('node:assert/strict');
const test = require('node:test');

const { hashQrToken } = require('../config/qrCredentials');
const databaseModule = require('../config/database');
const access = require('../utils/shsTeachingAccess');

const electiveClass = {
  id: 7, schoolId: 1, className: 'Elective A', subjectName: 'Literature',
  yearStartDate: '2025-01-01', yearEndDate: '2027-12-31',
  academicYearStartDate: '2025-01-01', academicYearEndDate: '2027-12-31'
};
access.assertElectiveTeacher = async (_db, user, classId) => {
  if (user.schoolId !== 1 || user.id !== 3 || classId !== 7) {
    const error = new Error('Class not found.');
    error.status = 404;
    throw error;
  }
  return electiveClass;
};
access.getElectiveRoster = async () => [{ studentId: 4, displayName: 'Student', initials: 'ST' }];

let session;
let events;
let records;
let nextId = 20;
let queries;
let transactionEnd = Promise.resolve();
let releaseTransaction;
function reset() {
  session = null;
  events = [];
  records = [];
  queries = [];
  transactionEnd = Promise.resolve();
}
reset();

const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('FROM student_qr_credentials c JOIN users')) {
      return [values[0] === hashQrToken('valid-token') ? [{
        id: 9, studentId: 4, credentialStatus: 'active', schoolId: 1,
        displayName: 'Student', initials: 'ST'
      }] : []];
    }
    if (sql.includes('FROM shs_elective_class_students WHERE')) return [[{ 1: 1 }]];
    if (sql.includes('FROM attendance_sessions WHERE id = ?')) {
      return [session?.status === 'draft' && Number(values[0]) === session.id ? [{
        schoolId: 1, electiveClassId: 7, attendanceDate: values[2]
      }] : []];
    }
    if (sql.includes('SELECT id FROM attendance_sessions')) return [session ? [{ id: session.id }] : []];
    if (sql.includes('FROM attendance_sessions')) return [session ? [{ ...session }] : []];
    if (sql.includes('INSERT INTO attendance_sessions')) {
      session = { id: ++nextId, method: sql.includes("'qr'") ? 'qr' : 'manual', status: sql.includes("'draft'") ? 'draft' : 'confirmed' };
      return [{ insertId: session.id }];
    }
    if (sql.includes('UPDATE attendance_sessions')) {
      session.status = 'confirmed';
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT id FROM qr_scan_events')) {
      return [events.some(event => event.studentId === Number(values[2])) ? [{ id: 1 }] : []];
    }
    if (/SELECT scanned_student_user_id AS studentId\s+FROM qr_scan_events/.test(sql)) {
      return [events.map(event => ({ studentId: event.studentId }))];
    }
    if (sql.includes('INSERT INTO qr_scan_events')) {
      events.push({ studentId: Number(values[3]) });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM attendance_records WHERE')) return [records];
    if (sql.includes('INSERT INTO attendance_records')) {
      records = [{ studentId: Number(values[2]), attendanceStatus: values[3], remarks: values[4] }];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() { return this; },
  async beginTransaction() {
    const previous = transactionEnd;
    let release;
    transactionEnd = new Promise(resolve => { release = resolve; });
    await previous;
    releaseTransaction = release;
  },
  async commit() { releaseTransaction(); },
  async rollback() { releaseTransaction(); },
  release() {}
};
databaseModule.getDatabase = () => database;
const attendance = require('../controllers/attendanceController');
const qr = require('../controllers/qrAttendanceController');
const teacher = { id: 3, schoolId: 1, role: 'teacher' };

async function call(handler, params, body = {}, query = {}) {
  const result = { status: 200 };
  await handler({ user: teacher, params, body, query }, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

test('elective first scan is atomic and manual save confirms the same session', async () => {
  reset();
  const invalid = await call(qr.startElectiveQrAttendance, { classId: '7' }, { qrToken: 'invalid-token' });
  assert.equal(invalid.error?.status, 422);
  assert.equal(session, null);
  assert.equal(events.length, 0);

  const first = await call(qr.startElectiveQrAttendance, { classId: '7' }, { qrToken: 'valid-token' });
  assert.equal(first.error, undefined);
  assert.equal(first.data.scanResult.scanned, true);
  assert.equal(session.status, 'draft');
  const sessionId = session.id;

  const draft = await call(attendance.getElectiveAttendance, { classId: '7' });
  assert.equal(draft.data.students[0].attendanceStatus, 'present');

  const saved = await call(attendance.saveElectiveAttendance, { classId: '7' }, {
    attendanceDate: first.data.attendanceDate,
    records: [{ studentId: 4, status: 'late' }]
  });
  assert.equal(saved.error, undefined);
  assert.equal(session.id, sessionId);
  assert.equal(session.status, 'confirmed');
  assert.equal(saved.data.students[0].attendanceStatus, 'late');
  assert.equal(events.length, 1);
});

test('elective QR confirmation allows later manual correction and rejects a second QR confirmation', async () => {
  reset();
  const first = await call(qr.startElectiveQrAttendance, { classId: '7' }, { qrToken: 'valid-token' });
  assert.equal(first.error, undefined);
  const attempts = await Promise.all([0, 1].map(() =>
    call(qr.confirmElectiveQrAttendance, { sessionId: String(session.id) }, {
      records: [{ studentId: 4, status: 'present' }]
    })));
  assert.equal(attempts.filter(attempt => !attempt.error).length, 1);
  assert.equal(attempts.filter(attempt => attempt.error?.status === 404).length, 1);
  assert.equal(session.status, 'confirmed');

  const corrected = await call(attendance.saveElectiveAttendance, { classId: '7' }, {
    attendanceDate: first.data.attendanceDate,
    records: [{ studentId: 4, status: 'late' }]
  });
  assert.equal(corrected.error, undefined);
  assert.equal(corrected.data.students[0].attendanceStatus, 'late');
  assert.equal(events.length, 1);
});
