const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const controller = require('../controllers/attendanceSettingsController');
const schoolContextController = require('../controllers/schoolContextController');

test('attendance settings and status codes are read only for the signed-in school', async () => {
  const scopes = [];
  database = { async execute(sql, params) {
    scopes.push(params);
    if (sql.includes('FROM school_attendance_settings')) return [[{ maxUnexcusedAbsences: 4,
      consecutiveAbsencesAlert: 2, lateCountAsAbsence: 3, countExcusedAbsences: 0,
      allowEditPastAttendance: 1 }]];
    return [[
      { id: 'present', name: 'Present', description: 'Attended', displayKey: 'P', tone: 'present' },
      { id: 'absent', name: 'Absent', description: 'Did not attend', displayKey: 'A', tone: 'absent' },
      { id: 'late', name: 'Late', description: 'Arrived late', displayKey: 'L', tone: 'late' },
      { id: 'excused', name: 'Excused', description: 'Excuse recorded', displayKey: 'E', tone: 'excused' }
    ]];
  } };
  let body;
  await controller.getAttendanceSettings({ user: { schoolId: 8 } },
    { json(value) { body = value; } }, error => { throw error; });
  assert.deepEqual(scopes, [[8], [8]]);
  assert.equal(body.settings.maxUnexcusedAbsences, 4);
  assert.deepEqual(body.settings.statusCodes.map(code => code.key), ['P', 'A', 'L', 'E']);
});

test('school context reports Attendance enabled when the legacy value is false', async () => {
  database = { async execute(sql) {
    if (sql.includes('FROM schools')) return [[{
      id: 8, name: 'School', registrationStatus: 'active', schoolYear: '2026-2027',
      attendanceEnabled: 0
    }]];
    if (sql.includes('FROM school_levels')) return [[]];
    if (sql.includes('FROM academic_terms')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  let response;
  await schoolContextController.getSchoolContext({ user: { schoolId: 8 } }, {
    json(value) { response = value; }
  }, error => { throw error; });
  assert.equal(response.school.attendanceEnabled, true);
});

test('attendance rules show fixed codes without offering code setup controls', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  assert.match(page, /Attendance status codes/);
  assert.match(page, /Attendance codes unavailable/);
  assert.match(page, /Save attendance rules/);
  assert.doesNotMatch(page, /Attendance statuses will appear here when the school sets them/);
  assert.doesNotMatch(page, /name="attendanceEnabled"/);
});

test('attendance settings reject out-of-range thresholds before writing', async () => {
  database = { getConnection() { throw new Error('unexpected write'); } };
  let status;
  await controller.updateAttendanceSettings({ user: { schoolId: 8 }, body: {
    maxUnexcusedAbsences: 256, consecutiveAbsencesAlert: 2, lateCountAsAbsence: 3,
    countExcusedAbsences: false, allowEditPastAttendance: true
  } }, { status(code) { status = code; return this; }, json() {} }, error => { throw error; });
  assert.equal(status, 400);
});

test('saving attendance thresholds leaves the fixed status codes unchanged', async () => {
  const writes = [];
  const codeRows = [
    { id: 'present', name: 'Present', description: 'Attended', displayKey: 'P', tone: 'present' },
    { id: 'absent', name: 'Absent', description: 'Did not attend', displayKey: 'A', tone: 'absent' },
    { id: 'late', name: 'Late', description: 'Arrived late', displayKey: 'L', tone: 'late' },
    { id: 'excused', name: 'Excused', description: 'Excuse recorded', displayKey: 'E', tone: 'excused' }
  ];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql) { writes.push(sql); return [{}]; },
    release() {}
  };
  database = {
    async getConnection() { return connection; },
    async execute(sql) {
      if (sql.includes('FROM school_attendance_settings')) return [[{
        maxUnexcusedAbsences: 6, consecutiveAbsencesAlert: 3, lateCountAsAbsence: 4,
        countExcusedAbsences: 1, allowEditPastAttendance: 0
      }]];
      return [codeRows];
    }
  };
  let body;
  await controller.updateAttendanceSettings({ user: { schoolId: 8, id: 12 }, body: {
    maxUnexcusedAbsences: 6, consecutiveAbsencesAlert: 3, lateCountAsAbsence: 4,
    countExcusedAbsences: true, allowEditPastAttendance: false
  } }, { json(value) { body = value; } }, error => { throw error; });
  assert.ok(writes.some(sql => sql.includes('INSERT INTO school_attendance_settings')));
  assert.ok(writes.some(sql => sql.includes('INSERT INTO audit_logs')));
  assert.ok(writes.every(sql => !sql.includes('attendance_status_codes')));
  assert.deepEqual(body.settings.statusCodes.map(code => code.key), ['P', 'A', 'L', 'E']);
  assert.equal(body.settings.maxUnexcusedAbsences, 6);
});
