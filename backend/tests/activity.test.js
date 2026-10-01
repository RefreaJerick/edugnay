const assert = require('node:assert/strict');
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

test('all nine activity categories are accepted and filtered by stored action types', async () => {
  queries.length = 0;
  rows = [];
  const categories = [
    'accounts', 'class_management', 'announcements', 'school_configuration',
    'reopen_requests', 'grades', 'attendance', 'school_forms', 'archives'
  ];
  for (const category of categories) {
    const result = await call(activity.listSchoolActivity, {
      user: { id: 7, schoolId: 4, role: 'school_admin' }, query: { category }
    });
    assert.equal(result.error, null, `${category} should be supported`);
    assert.match(queries.at(-1).sql, /audit_logs\.action_type IN/);
    assert.equal(queries.at(-1).values[0], 4);
  }
  assert.equal(queries.length, 9);
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
