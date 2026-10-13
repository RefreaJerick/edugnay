const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const controller = require('../controllers/attendanceSettingsController');

test('attendance settings and status codes are read only for the signed-in school', async () => {
  const scopes = [];
  database = { async execute(sql, params) {
    scopes.push(params);
    if (sql.includes('FROM school_attendance_settings')) return [[{ maxUnexcusedAbsences: 4,
      consecutiveAbsencesAlert: 2, lateCountAsAbsence: 3, countExcusedAbsences: 0,
      allowEditPastAttendance: 1 }]];
    return [[{ id: 'present', name: 'Present', description: 'Attended', displayKey: 'P', tone: 'present' }]];
  } };
  let body;
  await controller.getAttendanceSettings({ user: { schoolId: 8 } },
    { json(value) { body = value; } }, error => { throw error; });
  assert.deepEqual(scopes, [[8], [8]]);
  assert.equal(body.settings.maxUnexcusedAbsences, 4);
  assert.equal(body.settings.statusCodes[0].key, 'P');
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
