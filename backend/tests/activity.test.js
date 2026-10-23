const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const databaseModule = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');
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
  assert.deepEqual(saved.values, [4, 12, 'section_created', 'section', 88, '{"summary":"St. Matthew"}']);
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

test('all twelve activity categories are accepted and filtered by stored action types', async () => {
  queries.length = 0;
  rows = [];
  const categories = [
    'accounts', 'class_management', 'announcements', 'narrative_reports', 'assignments',
    'learning_materials', 'school_configuration', 'reopen_requests', 'grades', 'attendance', 'school_forms', 'archives'
  ];
  for (const category of categories) {
    const result = await call(activity.listSchoolActivity, {
      user: { id: 7, schoolId: 4, role: 'school_admin' }, query: { category }
    });
    assert.equal(result.error, null, `${category} should be supported`);
    assert.match(queries.at(-1).sql, /audit_logs\.action_type IN/);
    assert.equal(queries.at(-1).values[0], 4);
  }
  assert.equal(queries.length, 12);
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
  assert.equal(result.data.activities[0].title, 'regenerated a report draft for Grade 5 · St. John');
  assert.equal(result.data.activities[0].detail, '· Week of Oct 19, 2026');
  assert.equal(result.data.activities[0].category, 'narrative_reports');
  assert.equal(result.data.activities[1].title, 'released a weekly report to parents');
  assert.equal(result.data.activities[1].detail, '· Week of Oct 19, 2026');
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
  assert.equal(events[0].title, 'created an assignment');
  assert.equal(events[0].detail, ': Reading task · English · Grade 5 · St. John (Draft)');
  assert.equal(events[0].category, 'assignments');
  assert.equal(events[1].title, 'updated and published an assignment');
  assert.equal(events[2].title, 'deleted an assignment');
  assert.equal(events[2].category, 'assignments');
  assert.equal(events[3].title, 'uploaded a learning material');
  assert.equal(events[3].category, 'learning_materials');
  assert.equal(events[4].title, 'moved a learning material to draft');
  assert.equal(events[5].detail, ': Old handout · English · Grade 5 · St. John (Draft)');
  assert.equal(events[6].title, 'closed an assignment');
  assert.equal(events[7].title, 'moved an assignment to draft');
  assert.equal(events[8].title, 'published a learning material');
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
  assert.equal(result.data.hasMore, true);
  assert.ok(result.data.nextCursor);
  assert.match(queries[0].sql, /audit_logs\.entity_type = 'school'/);
  assert.match(queries[0].sql, /audit_logs\.action_type IN/);
  assert.deepEqual(queries[0].values.slice(0, 2), ['school_suspended', 'school_reactivated']);
  assert.ok(!queries[0].values.includes('user_deleted'));
});

test('platform activity rejects school-only categories and malformed cursors', async () => {
  queries.length = 0;
  const category = await call(activity.listPlatformActivity, { query: { category: 'accounts' } });
  const cursor = await call(activity.listPlatformActivity, { query: { cursor: 'invalid!' } });
  assert.equal(category.error.status, 400);
  assert.equal(cursor.error.status, 400);
  assert.equal(queries.length, 0);
});
