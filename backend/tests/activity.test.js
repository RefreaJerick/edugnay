const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
const { writeAuditLog, structuredActivityDetails } = require('../utils/auditLog');
const queries = [];
let rows = [];
databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    queries.push({ sql, values });
    return [rows];
  }
});

const activity = require('../controllers/activityController');

test('audit writes use the session actor and school with parameterized, safe details', async () => {
  let saved;
  const connection = {
    async execute(sql, values) { saved = { sql, values }; }
  };
  await writeAuditLog(connection, { user: { id: 12, schoolId: 4 } }, 'section_created', 'section', 88, { summary: 'St. Matthew' });

  assert.match(saved.sql, /VALUES \(\?, \?, \?, \?, \?, \?\)/);
  assert.deepEqual(saved.values, [4, 12, 'section_created', 'section', 88, '{"summary":"St. Matthew","sectionName":"St. Matthew"}']);
  assert.deepEqual(structuredActivityDetails('student_moved', { summary: 'Jordan Lee Â· Cedar â†’ Maple' }), {
    summary: 'Jordan Lee Â· Cedar â†’ Maple', studentName: 'Jordan Lee',
    sourceSectionName: 'Cedar', targetSectionName: 'Maple'
  });
});

async function call(handler, { user, query = {} } = {}) {
  const result = { data: null, error: null, headers: {} };
  await handler({ user, query }, {
    set(name, value) { result.headers[name] = value; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

test('school activity uses only the signed-in school and returns a stable next cursor', async () => {
  queries.length = 0;
  rows = [
    { id: '81', schoolId: 4, actionType: 'attendance_confirmed', entityType: 'attendance_session', details: { summary: 'St. Matthew · English' }, createdAt: '2026-09-30T01:20:00.000Z', cursorCreatedAt: '2026-09-30 09:20:00', actor: 'Maria Reyes' },
    { id: '80', schoolId: 4, actionType: 'attendance_confirmed', entityType: 'attendance_session', details: '{}', createdAt: '2026-09-30T01:10:00.000Z', cursorCreatedAt: '2026-09-30 09:10:00', actor: 'Maria Reyes' }
  ];
  const cursor = Buffer.from(JSON.stringify({ createdAt: '2026-09-29 09:10:00', id: '75' })).toString('base64url');
  const result = await call(activity.listSchoolActivity, {
    user: { id: 7, schoolId: 4, role: 'school_admin' },
    query: { limit: '1', category: 'attendance', date: '7', search: 'English', cursor, schoolId: '999' }
  });

  assert.equal(result.error, null);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.data.activities.length, 1);
  assert.equal(result.data.activities[0].actor, 'Maria Reyes');
  assert.equal(result.data.activities[0].category, 'attendance');
  assert.equal(result.data.hasMore, true);
  assert.ok(result.data.nextCursor);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /audit_logs\.school_id = \?/);
  assert.deepEqual(queries[0].values.slice(0, 3), [4, 'attendance_confirmed', 'qr_credential_regenerated']);
  assert.ok(!queries[0].values.includes('999'));
});

test('school activity rejects unsupported categories and malformed cursors before querying', async () => {
  queries.length = 0;
  const user = { id: 7, schoolId: 4, role: 'school_admin' };
  const category = await call(activity.listSchoolActivity, { user, query: { category: 'alerts' } });
  const cursor = await call(activity.listSchoolActivity, { user, query: { cursor: 'not-a-cursor!' } });

  assert.equal(category.error.status, 400);
  assert.equal(cursor.error.status, 400);
  assert.equal(queries.length, 0);
});

test('all activity categories are accepted and filtered by stored action types', async () => {
  queries.length = 0;
  rows = [];
  const categories = Object.keys(activity.CATEGORIES);
  for (const category of categories) {
    const result = await call(activity.listSchoolActivity, {
      user: { id: 7, schoolId: 4, role: 'school_admin' }, query: { category }
    });
    assert.equal(result.error, null, `${category} should be supported`);
    assert.match(queries.at(-1).sql, /audit_logs\.action_type IN/);
    assert.equal(queries.at(-1).values[0], 4);
  }
  assert.equal(queries.length, categories.length);
});

test('every registered school and platform activity has a clear action label', () => {
  const registered = new Set([
    ...Object.values(activity.CATEGORIES).flat(),
    ...Object.values(activity.PLATFORM_CATEGORIES).flat()
  ]);
  for (const actionType of registered) {
    assert.ok(activity.ACTION_LABELS[actionType], `${actionType} should have an action label`);
    const event = activity.formatActivity({
      id: 1, actionType, entityType: 'record', details: {}, actor: 'Test Admin', createdAt: '2026-10-28T00:00:00.000Z'
    });
    assert.ok(event.title, `${actionType} should produce a title`);
    assert.notEqual(event.title, 'recorded an activity', `${actionType} should not use the unknown-action fallback`);
  }
});

test('messages use only useful context and do not repeat action summaries', () => {
  const account = activity.formatActivity({
    id: 1, actionType: 'user_created', entityType: 'user', actor: 'Alex Test Admin',
    details: { displayName: 'Jordan Lee', role: 'student', summary: 'Jordan Lee Â· student' }
  });
  assert.equal(account.title, 'created an account for Jordan Lee');
  assert.equal(account.detail, 'Student');

  const importEvent = activity.formatActivity({
    id: 5, actionType: 'users_imported', entityType: 'user_import',
    details: { accountCount: 2, role: 'student' }
  });
  assert.equal(importEvent.title, 'imported accounts');
  assert.equal(importEvent.detail, '2 students');

  const schoolResubmission = activity.formatActivity({
    id: 6, schoolName: 'Sample School', actionType: 'school_registration_resubmitted', entityType: 'school',
    details: { summary: 'Sample School registration resubmitted', source: 'school_record' }
  });
  assert.equal(schoolResubmission.actor, 'Sample School');
  assert.equal(schoolResubmission.title, 'resubmitted its registration');
  assert.equal(schoolResubmission.detail, '');

  const offering = activity.formatActivity({
    id: 2, actionType: 'shs_offering_activated', entityType: 'shs_offering', actor: 'Alex Test Admin',
    details: { summary: 'Added 1 approved SHS subject(s)' }
  });
  assert.equal(offering.title, 'added 1 approved SHS subject');
  assert.equal(offering.detail, '');

  const grading = activity.formatActivity({
    id: 3, actionType: 'shs_grading_defaults_restored', entityType: 'shs_offering', actor: 'Alex Test Admin',
    details: { summary: 'Restored default SHS grading rule' }
  });
  assert.equal(grading.title, 'restored SHS grading defaults');
  assert.equal(grading.detail, '');

  const moved = activity.formatActivity({
    id: 4, actionType: 'student_moved', entityType: 'section_student', actor: 'Alex Test Admin',
    details: { summary: 'Jordan Lee Â· Cedar â†’ Maple' }
  });
  assert.equal(moved.title, 'moved Jordan Lee from Cedar to Maple');
});

test('teacher assignment messages name the teacher change and its subject once', () => {
  const assigned = activity.formatActivity({
    id: 1, actionType: 'teacher_assigned', entityType: 'section_teacher',
    details: { teacherName: 'Maya Santos', subjectName: 'English', sectionName: 'St. Peter' }
  });
  assert.equal(assigned.title, 'assigned Maya Santos to English');
  assert.equal(assigned.detail, '');

  const updated = activity.formatActivity({
    id: 2, actionType: 'teacher_assignment_updated', entityType: 'section_teacher',
    details: { previousTeacher: 'Carlo Reyes', teacherName: 'Maya Santos', subjectName: 'English' }
  });
  assert.equal(updated.title, 'changed the teacher for English');
  assert.equal(updated.detail, 'From Carlo Reyes to Maya Santos');
});

test('representative SHS, announcement, settings, and grading events show accurate saved context', () => {
  const score = activity.formatActivity({
    id: 1, actionType: 'shs_score_saved', entityType: 'grading_item', details: {
      studentName: 'Jordan Lee', itemName: 'Quarterly exam', subjectName: 'Oral Communication',
      className: 'STEM A', gradeCode: 'grade-11', schoolYear: '2026-2027', score: 86, maxScore: 100
    }
  });
  assert.equal(score.title, "saved Jordan Lee's score for Quarterly exam");
  assert.equal(score.detail, '86 / 100');

  const correction = activity.formatActivity({
    id: 2, actionType: 'shs_score_corrected', entityType: 'grading_item', details: {
      studentName: 'Jordan Lee', itemName: 'Quarterly exam', subjectName: 'Oral Communication',
      className: 'STEM A', oldScore: 80, newScore: 86
    }
  });
  assert.equal(correction.title, "corrected Jordan Lee's published score for Quarterly exam");
  assert.equal(correction.detail, '80 to 86');

  const published = activity.formatActivity({
    id: 3, actionType: 'shs_grades_published', entityType: 'academic_term', details: {
      subjectName: 'Oral Communication', className: 'STEM A', gradeCode: 'grade-11',
      schoolYear: '2026-2027', studentCount: 1, publicationVersion: 2
    }
  });
  assert.equal(published.title, 'published grades for STEM A');
  assert.equal(published.detail, '1 learner');

  const announcement = activity.formatActivity({
    id: 4, actionType: 'announcement_published', entityType: 'announcement',
    details: structuredActivityDetails('announcement_published', { summary: 'Enrollment schedule' })
  });
  assert.equal(announcement.title, 'published an announcement');
  assert.equal(announcement.detail, 'Enrollment schedule');

  const reportWeek = activity.formatActivity({
    id: 5, actionType: 'narrative_report_week_updated', entityType: 'school_settings',
    details: { weekStartDay: 1, weekEndDay: 5 }
  });
  assert.equal(reportWeek.detail, 'Report week: Monday to Friday');

  const attendanceSettings = activity.formatActivity({
    id: 6, actionType: 'attendance_settings_updated', entityType: 'school_attendance_settings',
    details: { thresholds: [5, 3], countExcusedAbsences: false, allowEditPastAttendance: true }
  });
  assert.equal(attendanceSettings.detail, '4 settings changed');

  const reopen = activity.formatActivity({
    id: 7, actionType: 'grading_period_reopen_approved', entityType: 'grading_period_reopen_request',
    details: structuredActivityDetails('grading_period_reopen_approved', {
      summary: 'Taylor Kim Â· Mathematics Â· Grade 8 - Cedar Â· Quarter 2'
    })
  });
  assert.equal(reopen.title, 'approved a grade editing request');
  assert.equal(reopen.detail, 'Mathematics · Quarter 2');
});

test('enrollment and SHS choice activity has readable context in its activity category', async () => {
  rows = [
    { id: 30, schoolId: 4, actionType: 'student_enrolled', entityType: 'section_student',
      details: { studentName: 'Jerick Refrea', sectionName: 'St. Peter', gradeName: 'Grade 8', schoolYear: '2026-2027' },
      createdAt: '2026-10-27T10:00:00.000Z', actor: 'Alex Test Admin' },
    { id: 29, schoolId: 4, actionType: 'student_enrolled', entityType: 'section_student',
      details: { summary: 'Elective QA Student ? QA-only ? 2026-2027' },
      createdAt: '2026-10-27T09:00:00.000Z', actor: 'Alex Test Admin' },
    ...[
      ['shs_selection_submitted', 'submitted elective choices'],
      ['shs_selection_revised', 'revised elective choices'],
      ['shs_selection_admin_recorded', 'recorded elective choices for Jordan Lee'],
      ['shs_selection_admin_updated', 'updated elective choices for Jordan Lee'],
      ['shs_selection_recorded', 'confirmed elective choices for Jordan Lee'],
      ['shs_selection_returned', "returned Jordan Lee's choices for correction"],
      ['shs_selection_recorded_choices_changed', "updated Jordan Lee's confirmed elective choices"]
    ].map(([actionType], index) => ({ id: String(28 - index), schoolId: 4, actionType,
      entityType: 'shs_selection_request', details: {
        studentName: 'Jordan Lee', gradeName: 'Grade 11', sectionName: 'QA-only',
        schoolYear: '2027-2028', classCount: 2,
        ...(actionType === 'shs_selection_returned' ? { note: 'Check the chosen classes.' } : {})
      }, createdAt: '2026-10-27T08:00:00.000Z', actor: 'School Staff' })),
    ...[
      ['shs_selection_approved', 'confirmed elective choices'],
      ['shs_selection_admin_changed', 'updated confirmed elective choices'],
      ['shs_selection_request', 'updated elective choices']
    ].map(([actionType], index) => ({ id: String(21 - index), schoolId: 4, actionType,
      entityType: 'shs_selection_request', details: {},
      createdAt: '2026-10-27T07:00:00.000Z', actor: 'School Staff' }))
  ];
  const result = await call(activity.listSchoolActivity, {
    user: { id: 7, schoolId: 4 }, query: { category: 'shs_program', search: 'Jordan Lee' }
  });

  assert.equal(result.error, null);
  const events = result.data.activities;
  assert.equal(events[0].title, 'enrolled Jerick Refrea in St. Peter');
  assert.equal(events[0].detail, '');
  assert.equal(events[1].title, 'enrolled Elective QA Student in QA-only');
  assert.equal(events[1].detail, '');
  for (const event of events.slice(2, 9)) {
    assert.equal(event.category, 'shs_program');
    assert.equal(event.detail, '2 classes');
    assert.doesNotMatch(`${event.title} ${event.detail}`, /recorded an activity|\?/);
  }
  assert.deepEqual(events.slice(2, 9).map(event => event.title), [
    'submitted elective choices for Jordan Lee',
    'updated elective choices for Jordan Lee',
    'recorded elective choices for Jordan Lee',
    'updated elective choices for Jordan Lee',
    'confirmed elective choices for Jordan Lee',
    "returned Jordan Lee's elective choices for correction",
    "updated Jordan Lee's confirmed elective choices"
  ]);
  assert.doesNotMatch(events[7].detail, /School's note/);
  assert.ok(queries.at(-1).values.includes('shs_selection_submitted'));
  assert.ok(queries.at(-1).values.includes('shs_selection_recorded_choices_changed'));
  assert.ok(queries.at(-1).values.includes('shs_selection_approved'));
  assert.ok(queries.at(-1).values.includes('shs_selection_admin_changed'));
  assert.deepEqual(events.slice(9).map(event => event.title), [
    'confirmed elective choices', 'updated confirmed elective choices', 'updated elective choices'
  ]);
  assert.ok(events.slice(9).every(event => event.category === 'shs_program'));
  assert.match(queries.at(-1).sql, /JSON_EXTRACT\(audit_logs\.details, '\$\.studentName'\)/);
});

test('clearing confirmed choices has a distinct activity message', async () => {
  rows = [{ id: 31, schoolId: 4, actionType: 'shs_selection_choices_cleared', entityType: 'shs_selection_request',
    details: { studentName: 'Jordan Lee', gradeName: 'Grade 11', sectionName: 'QA-only', schoolYear: '2027-2028', classCount: 2 },
    createdAt: '2026-10-27T08:00:00.000Z', actor: 'School Staff' }];
  const result = await call(activity.listSchoolActivity, { user: { id: 7, schoolId: 4 }, query: { category: 'shs_program' } });
  assert.equal(result.error, null);
  assert.equal(result.data.activities[0].title, "cleared Jordan Lee's confirmed elective choices");
  assert.equal(result.data.activities[0].detail, '2 classes removed');
});

test('SHS activity messages keep only concise identifying context', () => {
  const approvedSubject = activity.formatActivity({
    id: 1, actionType: 'shs_offering_activated', entityType: 'shs_offering', actor: 'Alex Test Admin',
    details: { subjectCount: 1, subjects: [{ subjectName: 'Creative Composition 1' }],
      gradeCode: 'grade-11', trackCode: 'academic', schoolYear: '2026-2027' }
  });
  assert.equal(approvedSubject.title, 'added Creative Composition 1 as an approved SHS subject');
  assert.equal(approvedSubject.detail, 'Grade 11 · Academic track');

  const createdClass = activity.formatActivity({
    id: 2, actionType: 'shs_elective_class_created', entityType: 'shs_elective_class', actor: 'Alex Test Admin',
    details: { className: 'Capstone QA AE034', subjectName: 'Business 1 (Basic Accounting)',
      teacherName: 'Maya Santos', capacity: 40, gradeCode: 'grade-11', trackCode: 'academic',
      schoolYearLabel: '2026-2027' }
  });
  assert.equal(createdClass.title, 'created SHS class Capstone QA AE034');
  assert.equal(createdClass.detail, 'Business 1 (Basic Accounting)');
  assert.equal(`${createdClass.title} ${createdClass.detail}`.split('Capstone QA AE034').length - 1, 1);

  const changedClass = activity.formatActivity({
    id: 7, actionType: 'shs_elective_class_updated', entityType: 'shs_elective_class', actor: 'Alex Test Admin',
    details: { className: 'Capstone QA AE034', subjectName: 'Business 1 (Basic Accounting)',
      teacherName: 'Maya Santos', capacity: 40, schoolYearLabel: '2026-2027',
      changes: { teacherName: { from: 'Carlo Reyes', to: 'Maya Santos' }, capacity: { from: 35, to: 40 } } }
  });
  assert.equal(changedClass.title, 'updated SHS class Capstone QA AE034');
  assert.equal(changedClass.detail, 'Teacher changed from Carlo Reyes to Maya Santos');

  const olderUpdate = activity.formatActivity({
    id: 8, actionType: 'shs_elective_class_updated', entityType: 'shs_elective_class',
    details: { className: 'Capstone QA AE011', teacherName: 'Maya Santos', capacity: 40 }
  });
  assert.equal(olderUpdate.title, 'updated SHS class Capstone QA AE011');
  assert.equal(olderUpdate.detail, '');

  const pausedClass = activity.formatActivity({
    id: 3, actionType: 'shs_elective_class_updated', entityType: 'shs_elective_class', actor: 'Alex Test Admin',
    details: { className: 'Capstone QA AE034', subjectName: 'Business 1 (Basic Accounting)',
      wasActive: true, isActive: false }
  });
  assert.equal(pausedClass.title, 'paused SHS class Capstone QA AE034');

  const schedule = activity.formatActivity({
    id: 4, actionType: 'shs_timetable_meeting_created', entityType: 'timetable_meeting', actor: 'Alex Test Admin',
    details: { className: 'Capstone QA AE012', subjectName: 'Creative Composition 1',
      teacherName: 'Maya Santos', gradeCode: 'grade-11', trackCode: 'academic',
      schoolYearLabel: '2026-2027', weekday: 3, startTime: '13:00', endTime: '14:00',
      startDate: '2026-10-15', endDate: '2027-06-30' }
  });
  assert.equal(schedule.title, 'scheduled a meeting for Capstone QA AE012');
  assert.equal(schedule.detail, 'Wednesday, 1:00-2:00 PM');

  const oldChoice = activity.formatActivity({
    id: 5, actionType: 'shs_selection_recorded', entityType: 'shs_selection_request', actor: 'Alex Test Admin',
    details: { summary: 'Grade 11 ? QA-only ? Pathway: academic ? S.Y. 2026-2027 ? 1 class' }
  });
  assert.equal(oldChoice.detail, '1 class');
  assert.doesNotMatch(oldChoice.detail, /Pathway|\?/);

  const oldClass = activity.formatActivity({
    id: 6, actionType: 'shs_elective_class_created', entityType: 'shs_elective_class',
    details: { summary: 'Created SHS class: Capstone QA AE034' }
  });
  assert.equal(oldClass.title, 'created SHS class Capstone QA AE034');
  assert.equal(oldClass.detail, '');
});

test('SHS grading and completion messages identify the saved record and learner', () => {
  const rule = activity.formatActivity({
    id: 1, actionType: 'shs_grading_rule_saved', entityType: 'shs_offering', details: {
      subjectName: 'Contemporary Literature 1', gradeCode: 'grade-11', schoolYear: '2026-2027',
      summary: 'Saved custom SHS grading rule'
    }
  });
  assert.equal(rule.title, 'saved grading rules for Contemporary Literature 1');
  assert.equal(rule.detail, 'Grade 11');

  const item = activity.formatActivity({
    id: 2, actionType: 'shs_grading_item_created', entityType: 'grading_item', details: {
      itemName: 'Quarterly exam', subjectName: 'Contemporary Literature 1', className: 'Capstone QA AE011',
      gradeCode: 'grade-11', schoolYear: '2026-2027'
    }
  });
  assert.equal(item.title, 'added score component “Quarterly exam”');
  assert.equal(item.detail, 'Contemporary Literature 1 · Capstone QA AE011');

  const completion = activity.formatActivity({
    id: 3, actionType: 'shs_completion_confirmed', entityType: 'shs_completion_confirmation', details: {
      studentName: 'Jordan Lee', sectionName: 'Grade 12 - Cedar', schoolYearLabel: '2026-2027',
      pathwayCode: 'academic', version: 2
    }
  });
  assert.equal(completion.title, 'confirmed Grade 12 completion for Jordan Lee');
  assert.equal(completion.detail, 'Cedar');
});

test('all activity feeds render escaped context inline and omit the separate detail line', () => {
  const activityPage = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-activity.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-dashboard.html'), 'utf8');
  const platformActivityPage = fs.readFileSync(path.join(__dirname, '../../views/platform/edugnay-platform-activity.html'), 'utf8');
  const platformDashboard = fs.readFileSync(path.join(__dirname, '../../views/platform/edugnay-platform-dashboard.html'), 'utf8');
  assert.match(activityPage, /safe\(item\.title/);
  assert.match(activityPage, /safe\(item\.detail\)/);
  assert.match(dashboard, /escapeHtml\(item\.title \|\|/);
  assert.match(dashboard, /escapeHtml\(item\.detail\)/);
  assert.match(platformActivityPage, /escapeHtml\(activity\.title/);
  assert.match(platformActivityPage, /escapeHtml\(context\)/);
  assert.match(platformDashboard, /escapeHtml\(activity\.title/);
  assert.match(platformDashboard, /escapeHtml\(detail\)/);
  for (const html of [activityPage, dashboard, platformActivityPage, platformDashboard]) {
    assert.match(html, /class="act-text"/);
    assert.doesNotMatch(html, /act-detail/);
  }
  assert.equal((activityPage.match(/safe\(item\.detail\)/g) || []).length, 1);
  assert.equal((dashboard.match(/escapeHtml\(item\.detail\)/g) || []).length, 1);
  assert.equal((platformActivityPage.match(/escapeHtml\(context\)/g) || []).length, 1);
  assert.equal((platformDashboard.match(/escapeHtml\(detail\)/g) || []).length, 1);
  assert.match(platformActivityPage, /const schoolName = String\(activity\.schoolName/);
  assert.match(platformDashboard, /const schoolName = String\(activity\.schoolName/);
  assert.match(platformActivityPage, /!String\(activity\.detail \|\| ''\)\.toLocaleLowerCase\(\)\.includes\(schoolName\.toLocaleLowerCase\(\)\)/);
  assert.match(platformDashboard, /!String\(activity\.detail \|\| ''\)\.toLocaleLowerCase\(\)\.includes\(schoolName\.toLocaleLowerCase\(\)\)/);
  for (const css of [
    fs.readFileSync(path.join(__dirname, '../../assets/css/admin/activity.css'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../assets/css/admin/dashboard.css'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../assets/css/platform/dashboard.css'), 'utf8')
  ]) assert.doesNotMatch(css, /act-detail/);
});

test('activity records use known category labels and a safe fallback for unknown actions', async () => {
  rows = [
    { id: 1, schoolId: 4, actionType: 'academic_year_archived', entityType: 'academic_year', details: { summary: 'S.Y. 2025-2026' }, createdAt: '2026-09-30T01:20:00.000Z', actor: 'Maria Reyes' },
    { id: 2, schoolId: 4, actionType: 'school_form_generated', entityType: 'school_form_export', details: { form_code: 'SF1' }, createdAt: '2026-09-30T01:15:00.000Z', actor: 'Maria Reyes' },
    { id: 3, schoolId: 4, actionType: 'unexpected_event', entityType: 'custom_record', details: null, createdAt: '2026-09-30T01:10:00.000Z', actor: null }
  ];
  const result = await call(activity.listSchoolActivity, { user: { id: 7, schoolId: 4 }, query: {} });

  assert.equal(result.error, null);
  assert.equal(result.data.activities[0].category, 'archives');
  assert.equal(result.data.activities[0].detail, 'S.Y. 2025-2026');
  assert.equal(result.data.activities[1].detail, 'SF1');
  assert.equal(result.data.activities[2].category, 'system');
  assert.equal(result.data.activities[2].actor, 'System');
});

test('narrative report activity names the action, section, and report week when available', async () => {
  rows = [
    { id: 10, schoolId: 4, actionType: 'narrative_report_draft_regenerated', entityType: 'narrative_reports',
      details: { sectionId: 15, reportWeekStartDate: '2026-10-19' }, sectionGrade: 'Grade 5',
      sectionName: 'St. John', createdAt: '2026-10-23T01:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 9, schoolId: 4, actionType: 'narrative_report_released_to_parents', entityType: 'narrative_reports',
      details: { sectionId: 15, weekStartDate: '2026-10-19' }, sectionGrade: null,
      sectionName: null, createdAt: '2026-10-23T00:00:00.000Z', actor: 'Maya Santos' },
    { id: 8, schoolId: 4, actionType: 'parent_notification_triggers_updated', entityType: 'parent_notification_triggers',
      details: { summary: 'Parent notification settings updated' }, createdAt: '2026-10-22T23:00:00.000Z', actor: 'Alex Test Admin' }
  ];
  const result = await call(activity.listSchoolActivity, { user: { id: 7, schoolId: 4 }, query: {} });
  assert.equal(result.error, null);
  assert.equal(result.data.activities[0].title, 'regenerated a report draft for Grade 5, St. John');
  assert.equal(result.data.activities[0].detail, 'Week of Oct 19, 2026');
  assert.equal(result.data.activities[0].category, 'narrative_reports');
  assert.equal(result.data.activities[1].title, 'released a weekly report to parents');
  assert.equal(result.data.activities[1].detail, 'Week of Oct 19, 2026');
  assert.equal(result.data.activities[2].title, 'updated parent notification settings');
  assert.equal(result.data.activities[2].detail, '');
  assert.match(queries.at(-1).sql, /LEFT JOIN sections AS activity_sections/);
});

test('activity search can find a report by section or grade name', async () => {
  queries.length = 0;
  rows = [];
  const result = await call(activity.listSchoolActivity, {
    user: { id: 7, schoolId: 4 }, query: { category: 'narrative_reports', search: 'St. John' }
  });
  assert.equal(result.error, null);
  assert.match(queries[0].sql, /activity_sections\.name LIKE \?/);
  assert.match(queries[0].sql, /school_grade_levels\.display_name LIKE \?/);
  assert.deepEqual(queries[0].values.slice(0, 7), [4,
    'narrative_report_draft_generated', 'narrative_report_draft_regenerated', 'narrative_report_draft_reviewed',
    'narrative_report_confirmed_held', 'narrative_report_reopened', 'narrative_report_released_to_parents']);
  assert.equal(queries[0].values.at(-6), '%St. John%');
});

test('assignment and learning material activity uses clear labels and saved item context', async () => {
  rows = [
    { id: 16, schoolId: 4, actionType: 'assignment_created', entityType: 'assignment',
      details: { summary: 'Reading task · English · Grade 5 · St. John', status: 'draft' }, createdAt: '2026-10-23T03:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 15, schoolId: 4, actionType: 'assignment_updated', entityType: 'assignment',
      details: { summary: 'Reading task · English · Grade 5 · St. John', status: 'published', fromStatus: 'draft', toStatus: 'published', statusChanged: true, detailsChanged: true }, createdAt: '2026-10-23T02:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 14, schoolId: 4, actionType: 'assignment_deleted', entityType: 'assignment',
      details: { summary: 'Old task · English · Grade 5 · St. John', status: 'closed' }, createdAt: '2026-10-23T01:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 13, schoolId: 4, actionType: 'learning_material_uploaded', entityType: 'learning_material',
      details: { summary: 'Chapter 2 · English · Grade 5 · St. John', status: 'published' }, createdAt: '2026-10-22T03:00:00.000Z', actor: 'Maya Santos' },
    { id: 12, schoolId: 4, actionType: 'learning_material_visibility_changed', entityType: 'learning_material',
      details: { summary: 'Chapter 2 · English · Grade 5 · St. John', status: 'draft', fromStatus: 'published', toStatus: 'draft' }, createdAt: '2026-10-22T02:00:00.000Z', actor: 'Maya Santos' },
    { id: 11, schoolId: 4, actionType: 'learning_material_deleted', entityType: 'learning_material',
      details: { summary: 'Old handout · English · Grade 5 · St. John', status: 'draft' }, createdAt: '2026-10-22T01:00:00.000Z', actor: 'Maya Santos' },
    { id: 10, schoolId: 4, actionType: 'assignment_updated', entityType: 'assignment',
      details: { summary: 'Task · English · Grade 5 · St. John', status: 'closed', fromStatus: 'published', toStatus: 'closed', statusChanged: true, detailsChanged: false }, createdAt: '2026-10-21T03:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 9, schoolId: 4, actionType: 'assignment_updated', entityType: 'assignment',
      details: { summary: 'Task · English · Grade 5 · St. John', status: 'draft', fromStatus: 'closed', toStatus: 'draft', statusChanged: true, detailsChanged: false }, createdAt: '2026-10-21T02:00:00.000Z', actor: 'Carlo Reyes' },
    { id: 8, schoolId: 4, actionType: 'learning_material_visibility_changed', entityType: 'learning_material',
      details: { summary: 'Chapter 2 · English · Grade 5 · St. John', status: 'published', fromStatus: 'draft', toStatus: 'published' }, createdAt: '2026-10-21T01:00:00.000Z', actor: 'Maya Santos' }
  ];
  const result = await call(activity.listSchoolActivity, { user: { id: 7, schoolId: 4 }, query: {} });
  assert.equal(result.error, null);
  const events = result.data.activities;
  assert.equal(events[0].title, 'created draft assignment “Reading task”');
  assert.equal(events[0].detail, 'English · Grade 5 · St. John');
  assert.equal(events[0].category, 'assignments');
  assert.equal(events[1].title, 'updated assignment “Reading task” and published it');
  assert.equal(events[2].title, 'deleted assignment “Old task”');
  assert.equal(events[2].detail, 'English · Grade 5 · St. John');
  assert.equal(events[2].category, 'assignments');
  assert.equal(events[3].title, 'uploaded learning material “Chapter 2”');
  assert.equal(events[3].detail, 'English · Grade 5 · St. John');
  assert.equal(events[3].category, 'learning_materials');
  assert.equal(events[4].title, 'moved learning material “Chapter 2” to draft');
  assert.equal(events[5].title, 'deleted learning material “Old handout”');
  assert.equal(events[5].detail, 'English · Grade 5 · St. John');
  assert.equal(events[6].title, 'closed assignment “Task”');
  assert.equal(events[7].title, 'moved assignment “Task” to draft');
  assert.equal(events[8].title, 'published learning material “Chapter 2”');

  const createdPublishedAssignment = activity.formatActivity({
    id: 7, actionType: 'assignment_created', entityType: 'assignment',
    details: { title: 'Published task', status: 'published' }
  });
  assert.equal(createdPublishedAssignment.title, 'created assignment “Published task”');
  assert.doesNotMatch(createdPublishedAssignment.title, /published/);

  const uploadedPublishedMaterial = activity.formatActivity({
    id: 6, actionType: 'learning_material_uploaded', entityType: 'learning_material',
    details: { title: 'Published handout', status: 'published' }
  });
  assert.equal(uploadedPublishedMaterial.title, 'uploaded learning material “Published handout”');
  assert.doesNotMatch(uploadedPublishedMaterial.title, /published/);

  const assignmentCreatedWithComponent = activity.formatActivity({
    id: 4, actionType: 'assignment_created', entityType: 'assignment',
    details: {
      title: 'Test Assignment', status: 'published', subjectName: 'Contemporary Literature 1',
      className: 'Capstone QA AE011', scopeType: 'elective', electiveClassId: 41,
      scoreComponentCreated: true, gradingItemId: 82
    }
  });
  assert.equal(assignmentCreatedWithComponent.title, 'created assignment “Test Assignment”');
  assert.equal(assignmentCreatedWithComponent.detail, 'Contemporary Literature 1 · Capstone QA AE011');

  const assignmentLinkedLater = activity.formatActivity({
    id: 3, actionType: 'assignment_updated', entityType: 'assignment',
    details: { title: 'Test Assignment', scoreComponentCreated: true, detailsChanged: false, statusChanged: false }
  });
  assert.equal(assignmentLinkedLater.title, 'linked “Test Assignment” to Score Recording');

  const legacyDamagedSeparators = activity.formatActivity({
    id: 5, actionType: 'assignment_created', entityType: 'assignment',
    details: { summary: 'Unit plan ?? English ?? Grade 5 ?? St. John, Status: Published', status: 'published' }
  });
  assert.equal(legacyDamagedSeparators.title, 'created assignment “Unit plan”');
  assert.equal(legacyDamagedSeparators.detail, 'English · Grade 5 · St. John');
});

test('activity details stay concise without truncating names or listing group items', () => {
  const longItemName = 'A Long Assignment Name That Must Remain Fully Visible';
  const longSectionName = 'St. John of the Cross Elementary School Section';
  const assignment = activity.formatActivity({
    id: 1, actionType: 'assignment_created', entityType: 'assignment',
    details: { title: longItemName, status: 'draft', subjectName: 'English', sectionGrade: 'Grade 5', sectionName: longSectionName }
  });
  assert.equal(assignment.title, `created draft assignment “${longItemName}”`);
  assert.equal(assignment.detail, `English · Grade 5 · ${longSectionName}`);
  assert.doesNotMatch(assignment.detail, /status|published|Score Recording/i);

  const group = activity.formatActivity({
    id: 2, actionType: 'shs_selection_choices_cleared', entityType: 'shs_selection_request',
    details: { studentName: longItemName, classCount: 12, subjects: Array.from({ length: 12 }, (_, index) => `Subject ${index + 1}`) }
  });
  assert.equal(group.title, `cleared ${longItemName}'s confirmed elective choices`);
  assert.equal(group.detail, '12 classes removed');
  assert.doesNotMatch(group.detail, /Subject/);
});

test('assignment and learning material filters are available on the admin Activity page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-activity.html'), 'utf8');
  assert.match(html, /data-tag="assignments"[^>]*>Assignments<\/button>/);
  assert.match(html, /data-tag="learning_materials"[^>]*>Learning materials<\/button>/);
});

test('assignment and learning material search uses their saved item context', async () => {
  queries.length = 0;
  rows = [];
  const result = await call(activity.listSchoolActivity, {
    user: { id: 7, schoolId: 4 }, query: { category: 'assignments', search: 'English' }
  });
  assert.equal(result.error, null);
  assert.deepEqual(queries[0].values.slice(0, 4), [4, 'assignment_created', 'assignment_updated', 'assignment_deleted']);
  assert.match(queries[0].sql, /JSON_UNQUOTE\(JSON_EXTRACT\(audit_logs\.details, '\$\.summary'\)\) LIKE \?/);
  assert.equal(queries[0].values.at(-5), '%English%');

  await call(activity.listSchoolActivity, {
    user: { id: 7, schoolId: 4 }, query: { category: 'grades' }
  });
  assert.equal(queries.at(-1).values.includes('assignment_deleted'), false);
});

test('platform activity queries school account events only and pages them', async () => {
  queries.length = 0;
  rows = [
    { id: '23', schoolId: 2, schoolName: 'Sample School', actionType: 'school_suspended', entityType: 'school',
      details: { summary: 'Sample School' }, createdAt: '2026-10-01T02:00:00.000Z',
      cursorCreatedAt: '2026-10-01 10:00:00', actor: 'Platform Admin' },
    { id: '22', schoolId: 2, schoolName: 'Sample School', actionType: 'school_registration_approved', entityType: 'school',
      details: { summary: 'Sample School' }, createdAt: '2026-09-30T02:00:00.000Z',
      cursorCreatedAt: '2026-09-30 10:00:00', actor: 'Platform Admin' }
  ];
  const result = await call(activity.listPlatformActivity, { query: { limit: '1', category: 'access' } });
  assert.equal(result.error, null);
  assert.equal(result.data.activities[0].category, 'access');
  assert.equal(result.data.activities[0].schoolName, 'Sample School');
  assert.equal(result.data.hasMore, true);
  assert.ok(result.data.nextCursor);
  assert.match(queries[0].sql, /audit_logs\.entity_type = 'school'/);
  assert.match(queries[0].sql, /audit_logs\.action_type IN/);
  assert.deepEqual(queries[0].values.slice(0, 2), ['school_suspended', 'school_reactivated']);
  assert.ok(!queries[0].values.includes('user_deleted'));
});

test('platform registration activity includes resubmissions with school-specific wording', async () => {
  queries.length = 0;
  rows = [{ id: '24', schoolId: 2, schoolName: 'Sample School', actionType: 'school_registration_resubmitted',
    entityType: 'school', details: { summary: 'Sample School registration resubmitted', source: 'school_record' },
    createdAt: '2026-10-02T02:00:00.000Z', cursorCreatedAt: '2026-10-02 10:00:00', actor: null }];
  const result = await call(activity.listPlatformActivity, { query: { category: 'registrations' } });
  assert.equal(result.error, null);
  assert.equal(result.data.activities[0].actor, 'Sample School');
  assert.equal(result.data.activities[0].title, 'registration was resubmitted');
  assert.equal(result.data.activities[0].detail, '');
  assert.ok(queries[0].values.includes('school_registration_resubmitted'));
});

test('platform activity rejects school-only categories and malformed cursors', async () => {
  queries.length = 0;
  const category = await call(activity.listPlatformActivity, { query: { category: 'accounts' } });
  const cursor = await call(activity.listPlatformActivity, { query: { cursor: 'invalid!' } });
  assert.equal(category.error.status, 400);
  assert.equal(cursor.error.status, 400);
  assert.equal(queries.length, 0);
});
