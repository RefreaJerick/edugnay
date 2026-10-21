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
  const queries = [];
  database = { async execute(sql, params) {
    queries.push(sql);
    scopes.push(params);
    if (sql.includes('FROM school_attendance_settings')) return [[{ maxUnexcusedAbsences: 4,
      consecutiveAbsencesAlert: 2, countExcusedAbsences: 0,
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
  assert.doesNotMatch(queries[0], /late_count_as_absence/i);
  assert.equal(body.settings.maxUnexcusedAbsences, 4);
  assert.equal(body.settings.lateCountAsAbsence, undefined);
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
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  const sharedShell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
  assert.match(page, /Attendance status codes/);
  assert.match(page, /Attendance codes unavailable/);
  assert.match(page, /school-attendance-overview[\s\S]*?school-attendance-code-grid[\s\S]*?school-attendance-threshold-grid/);
  assert.match(page, /school-toggle-list school-attendance-access-grid/);
  assert.match(page, /Save attendance rules/);
  assert.doesNotMatch(page, /Attendance statuses will appear here when the school sets them/);
  assert.doesNotMatch(page, /name="attendanceEnabled"/);
  assert.doesNotMatch(page, /lateCountAsAbsence|late_count_as_absence|Late count equals one absence|late records equivalent to one absence/i);
  assert.doesNotMatch(sharedShell, /lateCountAsAbsence/);
  assert.match(styles, /\.school-attendance-pane form\s*\{[^}]*max-width:\s*none;/s);
  assert.doesNotMatch(styles, /container-name:\s*attendance-form|@container attendance-form/);
  assert.match(styles, /\.school-attendance-overview\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(styles, /@media \(min-width:\s*1440px\)[\s\S]*?\.school-attendance-overview\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /\.school-attendance-threshold-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(page, /id="absence-threshold-label">Absence-day limit/);
  assert.match(page, /Flag after this many dates with an absence in any subject\. Each date counts once\. Excused absences do not count\./);
  assert.match(page, /Flag after this many dates with an absence in any subject\. Each date counts once\. Excused absences also count\./);
  assert.match(page, /excusedToggle\.addEventListener\('change', updateAbsenceThresholdCopy\)/);
  assert.match(page, /<label for="consecutiveAbsencesAlert">Consecutive missed class dates/);
  assert.match(page, /Flag after this many recorded class dates missed in a row for the same subject\./);
  assert.match(styles, /\.school-attendance-threshold-field\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+72px;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.school-attendance-threshold-field\s*>\s*input\s*\{[^}]*width:\s*72px;/s);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.school-attendance-threshold-field\s*\{\s*grid-template-columns:\s*1fr;\s*align-items:\s*stretch;/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.school-attendance-threshold-field\s*>\s*input\s*\{\s*width:\s*100%;/);
  assert.match(styles, /\.school-attendance-access-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.school-attendance-access-grid\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('attendance settings reject out-of-range thresholds before writing', async () => {
  database = { getConnection() { throw new Error('unexpected write'); } };
  let status;
  await controller.updateAttendanceSettings({ user: { schoolId: 8 }, body: {
    maxUnexcusedAbsences: 256, consecutiveAbsencesAlert: 2,
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
    async execute(sql, params) { writes.push({ sql, params }); return [{}]; },
    release() {}
  };
  database = {
    async getConnection() { return connection; },
    async execute(sql) {
      if (sql.includes('FROM school_attendance_settings')) return [[{
        maxUnexcusedAbsences: 6, consecutiveAbsencesAlert: 3,
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
  const settingsWrite = writes.find(({ sql }) => sql.includes('INSERT INTO school_attendance_settings'));
  assert.ok(settingsWrite);
  assert.doesNotMatch(settingsWrite.sql, /late_count_as_absence/i);
  assert.deepEqual(settingsWrite.params, [8, 6, 3, true, false]);
  assert.ok(writes.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
  assert.ok(writes.every(({ sql }) => !sql.includes('attendance_status_codes')));
  assert.deepEqual(body.settings.statusCodes.map(code => code.key), ['P', 'A', 'L', 'E']);
  assert.equal(body.settings.maxUnexcusedAbsences, 6);
  assert.equal(body.settings.lateCountAsAbsence, undefined);
});
