const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const calls = [];
let committed = false;
let triggerRows = [];
let attendanceHistory = [];
let assignmentRows = [];
let journalRows = [];

const database = {
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM parent_notification_triggers AS triggers')) return [[{ enabled: 1, threshold: 2 }]];
    if (sql.includes('FROM parent_notification_triggers WHERE')) return [triggerRows];
    if (sql.includes('FROM school_attendance_settings')) return [[{ absenceThreshold: 2, threshold: 2 }]];
    if (sql.includes('FROM school_portal_features')) return [[{ gradesEnabled: 1, attendanceEnabled: 0, journalsEnabled: 1, narrativeReportsEnabled: 1 }]];
    if (sql.includes('FROM attendance_sessions AS sessions')) return [attendanceHistory];
    if (sql.includes('FROM assignments\n')) return [assignmentRows];
    if (sql.includes('FROM journal_prompts AS prompts')) return [journalRows];
    if (sql.includes('SELECT display_name AS name FROM users')) return [[{ name: 'Juan Dela Cruz' }]];
    if (sql.includes('SELECT name FROM subjects')) return [[{ name: 'English' }]];
    if (sql.startsWith('INSERT INTO')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      beginTransaction: async () => {}, commit: async () => { committed = true; },
      rollback: async () => {}, release: () => {}
    };
  }
};
databaseModule.getDatabase = () => database;
const settings = require('../controllers/parentNotificationTriggersController');
const { notifyConsecutiveAbsences } = require('../utils/parentNotifications');
const { runParentNotificationChecks } = require('../workers/parentNotificationWorker');
const notifications = require('../controllers/notificationsController');

async function call(handler, body = {}, user = { id: 3, role: 'school_admin', schoolId: 1 }) {
  let responseData;
  let error;
  await handler({ body, user }, {
    set: () => {}, json: data => { responseData = data; }
  }, value => { error = value; });
  return { responseData, error };
}

function reset() {
  calls.length = 0;
  committed = false;
  triggerRows = [];
  attendanceHistory = [];
  assignmentRows = [];
  journalRows = [];
}

test('admin settings default off and use only the session school', async () => {
  reset();
  const { responseData, error } = await call(settings.getSettings);
  assert.equal(error, undefined);
  assert.equal(responseData.triggers.length, 5);
  assert.ok(responseData.triggers.every(item => !item.enabled));
  assert.equal(responseData.triggers.find(item => item.code === 'consecutive_absences').available, true);
  assert.equal(responseData.triggers.find(item => item.code === 'narrative_report_released').available, false);
  const configPage = require('fs').readFileSync(require('path').join(__dirname, '../../views/admin/edugnay-admin-system-config.html'), 'utf8');
  assert.match(configPage, /label: 'Consecutive missed class dates'/);
  assert.equal(calls[0].values[0], 1);
});

test('admin saves validated settings transactionally; report trigger remains unavailable', async () => {
  reset();
  const triggers = [
    { code: 'grade_below_threshold', enabled: true, threshold: null },
    { code: 'consecutive_absences', enabled: true, threshold: null },
    { code: 'assignment_not_completed', enabled: false, threshold: 2 },
    { code: 'narrative_report_released', enabled: false, threshold: null },
    { code: 'journal_not_submitted', enabled: false, threshold: 2 }
  ];
  const saved = await call(settings.updateSettings, { triggers, schoolId: 999 });
  assert.equal(saved.error, undefined);
  assert.equal(saved.responseData.triggers.find(item => item.code === 'consecutive_absences').available, true);
  assert.equal(committed, true);
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO parent_notification_triggers')).length, 5);
  assert.ok(calls.filter(call => call.sql.includes('INSERT INTO parent_notification_triggers')).every(call => call.values[0] === 1));
  assert.ok(calls.some(call => call.sql.includes('FROM school_portal_features')));
  assert.ok(calls.filter(call => call.sql.includes('FROM school_portal_features')).every(call => !/attendance_enabled/i.test(call.sql)));

  reset();
  triggers[3].enabled = true;
  const denied = await call(settings.updateSettings, { triggers });
  assert.equal(denied.error.status, 409);
  assert.equal(committed, false);

  triggers[3].enabled = false;
  triggers[2].threshold = 0;
  const invalid = await call(settings.updateSettings, { triggers });
  assert.equal(invalid.error.status, 400);
  assert.equal(committed, false);
});

test('report-release notifications become configurable only when the release gate is enabled', async () => {
  const previous = process.env.AI_REPORTS_RELEASE_ENABLED;
  try {
    process.env.AI_REPORTS_RELEASE_ENABLED = 'true';
    reset();
    const loaded = await call(settings.getSettings);
    const reportSetting = loaded.responseData.triggers.find(item => item.code === 'narrative_report_released');
    assert.equal(reportSetting.available, true);
    assert.equal(reportSetting.enabled, false);

    const triggers = [
      { code: 'grade_below_threshold', enabled: false, threshold: null },
      { code: 'consecutive_absences', enabled: false, threshold: null },
      { code: 'assignment_not_completed', enabled: false, threshold: 2 },
      { code: 'narrative_report_released', enabled: true, threshold: null },
      { code: 'journal_not_submitted', enabled: false, threshold: 2 }
    ];
    const saved = await call(settings.updateSettings, { triggers });
    assert.equal(saved.error, undefined);
    assert.equal(saved.responseData.triggers.find(item => item.code === 'narrative_report_released').available, true);
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_RELEASE_ENABLED;
    else process.env.AI_REPORTS_RELEASE_ENABLED = previous;
  }
});

test('attendance alerts only on the threshold crossing in the same subject', async () => {
  reset();
  attendanceHistory = [
    { sessionId: 20, date: '2026-10-03', status: 'absent' },
    { sessionId: 19, date: '2026-10-01', status: 'absent' },
    { sessionId: 18, date: '2026-09-30', status: 'present' }
  ];
  await notifyConsecutiveAbsences(database, 1, 8, 2, 6);
  const notice = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  assert.equal(notice.values[0], 'attendance');
  assert.equal(notice.values[4], 'absence:8:2:6:19');
  assert.deepEqual(notice.values.slice(-3), [1, 1, 6]);
  const triggerQuery = calls.find(call => call.sql.includes('FROM parent_notification_triggers AS triggers'));
  assert.ok(triggerQuery);
  assert.doesNotMatch(triggerQuery.sql, /features\.attendance_enabled/i);

  reset();
  attendanceHistory = [
    { sessionId: 21, date: '2026-10-05', status: 'absent' },
    { sessionId: 20, date: '2026-10-03', status: 'absent' },
    { sessionId: 19, date: '2026-10-01', status: 'absent' }
  ];
  await notifyConsecutiveAbsences(database, 1, 8, 2, 6);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO notifications')), false);
});

test('parent absence alerts count distinct fully missed subject dates', async () => {
  reset();
  attendanceHistory = [
    { sessionId: 21, date: '2026-10-03', status: 'absent' },
    { sessionId: 20, date: '2026-10-03', status: 'absent' }
  ];
  await notifyConsecutiveAbsences(database, 1, 8, 2, 6);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO notifications')), false);

  reset();
  attendanceHistory = [
    { sessionId: 21, date: '2026-10-03', status: 'absent' },
    { sessionId: 20, date: '2026-10-03', status: 'present' },
    { sessionId: 19, date: '2026-10-01', status: 'absent' },
    { sessionId: 18, date: '2026-09-30', status: 'absent' }
  ];
  await notifyConsecutiveAbsences(database, 1, 8, 2, 6);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO notifications')), false);

  reset();
  attendanceHistory = [
    { sessionId: 22, date: '2026-10-03', status: 'absent' },
    { sessionId: 21, date: '2026-10-03', status: 'absent' },
    { sessionId: 19, date: '2026-10-01', status: 'absent' }
  ];
  await notifyConsecutiveAbsences(database, 1, 8, 2, 6);
  assert.equal(calls.find(call => call.sql.includes('INSERT INTO notifications')).values[4], 'absence:8:2:6:19');
  assert.match(calls.find(call => call.sql.includes('FROM attendance_sessions AS sessions')).sql, /DATE_FORMAT\(sessions\.attendance_date/);
});

test('overdue checks skip unknown offline statuses and notify after an exact missed streak', async () => {
  reset();
  assignmentRows = [
    { id: 4, schoolId: 1, sectionId: 8, subjectId: 2, studentId: 6, studentName: 'Juan', subjectName: 'English', onlineSubmissionEnabled: 0, savedStatus: 'not_submitted', threshold: 2 },
    { id: 3, schoolId: 1, sectionId: 8, subjectId: 2, studentId: 6, studentName: 'Juan', subjectName: 'English', onlineSubmissionEnabled: 0, savedStatus: 'not_submitted', threshold: 2 },
    { id: 2, schoolId: 1, sectionId: 8, subjectId: 2, studentId: 6, studentName: 'Juan', subjectName: 'English', onlineSubmissionEnabled: 0, savedStatus: 'submitted', threshold: 2 }
  ];
  await runParentNotificationChecks(database);
  assert.equal(calls.filter(call => call.sql.includes('INSERT INTO notifications')).length, 1);
  assert.ok(calls.some(call => call.sql.includes('section_students.enrolled_at <= assignments.due_at')));

  reset();
  assignmentRows = [{ id: 4, schoolId: 1, sectionId: 8, subjectId: 2, studentId: 6, onlineSubmissionEnabled: 0, savedStatus: null, threshold: 1 }];
  await runParentNotificationChecks(database);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO notifications')), false);
});

test('journal checks require a completed missed streak and current enrollment', async () => {
  reset();
  journalRows = [
    { id: 7, schoolId: 1, sectionId: 8, journalSubjectId: 2, studentId: 6, studentName: 'Juan', entryId: null, threshold: 2 },
    { id: 6, schoolId: 1, sectionId: 8, journalSubjectId: 2, studentId: 6, studentName: 'Juan', entryId: null, threshold: 2 },
    { id: 5, schoolId: 1, sectionId: 8, journalSubjectId: 2, studentId: 6, studentName: 'Juan', entryId: 9, threshold: 2 }
  ];
  await runParentNotificationChecks(database);
  const notice = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  assert.equal(notice.values[0], 'journal');
  assert.equal(notice.values[4], 'journal-streak:8:2:6:6');
  assert.ok(calls.some(call => call.sql.includes('section_students.enrolled_at <= prompts.due_at')));
});

test('notification reads restrict child-linked notices to current parent links', async () => {
  reset();
  database.execute = async (sql, values = []) => {
    calls.push({ sql, values });
    return [[]];
  };
  let response;
  await notifications.listNotifications(
    { user: { id: 4, role: 'parent', schoolId: 1 }, query: {} },
    { json: data => { response = data; } },
    error => { throw error; }
  );
  assert.deepEqual(response, { notifications: [] });
  assert.ok(calls[0].sql.includes('links.school_id = ?'));
  assert.ok(calls[0].sql.includes('links.parent_user_id = ?'));
  assert.deepEqual(calls[0].values.slice(0, 5), [4, 'parent', 1, 1, 4]);
});
