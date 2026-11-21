const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { requireSchoolContextAccess, requireSchoolUser } = require('../middleware/authorize');
const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { getSchoolContext } = require('../controllers/schoolContextController');
const root = path.join(__dirname, '../..');
const route = fs.readFileSync(path.join(root, 'backend/routes/schools.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8').replace(/\r\n/g, '\n');

function runMiddleware(middleware, role, schoolId) {
  const result = { allowed: false, status: null, body: null };
  middleware(
    { user: role ? { role, schoolId } : null },
    {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; }
    },
    () => { result.allowed = true; }
  );
  return result;
}

test('school context access permits guards only with a valid school ID', () => {
  assert.equal(runMiddleware(requireSchoolContextAccess, 'school_guard', 7).allowed, true);
  assert.equal(runMiddleware(requireSchoolContextAccess, 'teacher', 7).allowed, true);

  for (const [role, schoolId] of [['school_guard', null], ['school_guard', 0], ['platform_admin', 7]]) {
    const result = runMiddleware(requireSchoolContextAccess, role, schoolId);
    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
  }

  assert.equal(runMiddleware(requireSchoolUser, 'school_guard', 7).allowed, false,
    'guard access stays limited to the school context route');
});

test('only the school context route uses the guard-specific access check', () => {
  assert.match(route, /router\.get\('\/school\/context', requireAuth, requireSchoolContextAccess, getSchoolContext\)/);
  assert.match(route, /router\.get\('\/school\/calendar-notices', requireAuth, requireSchoolUser,/);
});

test('guard school context returns only the fields needed by its shell', async () => {
  let queryCount = 0;
  database = { async execute() {
    queryCount += 1;
    return [[{
      id: 7, name: 'Test School', shortName: 'TS', schoolType: 'jhs', schoolYear: '2026-2027',
      logoPath: null, accentPalette: 'deep-teal', email: 'private@example.test', address: 'Private address'
    }]];
  } };
  const res = {
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; }
  };
  let failure;
  await getSchoolContext({ user: { role: 'school_guard', schoolId: 7 } }, res, error => { failure = error; });

  assert.equal(failure, undefined);
  assert.equal(queryCount, 1, 'guard context does not load academic periods');
  assert.deepEqual(Object.keys(res.data.school).sort(), [
    'accentPalette', 'activeDivision', 'attendanceEnabled', 'divisions', 'gradesPageEnabled', 'id',
    'journalsEnabled', 'logoUrl', 'name', 'narrativeReportsEnabled', 'schoolLevels', 'schoolType',
    'schoolYear', 'sfTemplatesEnabled', 'shortName'
  ].sort());
  assert.equal(res.data.school.shortName, 'TS');
  assert.equal(res.data.school.accentPalette, 'deep-teal');
  assert.equal(Object.hasOwn(res.data.school, 'email'), false);
  assert.equal(Object.hasOwn(res.data.school, 'address'), false);
});

test('guard pages load shared school context without requesting calendar notices', async () => {
  const start = shell.indexOf('window.EDUGNAY_CALENDAR_READY = Promise.resolve();');
  const end = shell.indexOf('\nfunction readFrontendSession()', start);
  assert.ok(start >= 0 && end > start, 'shared school readiness block should exist');
  const source = shell.slice(start, end);

  async function load(pathname) {
    const calls = { context: 0, calendar: 0 };
    const school = { id: 7, shortName: 'Test School' };
    const context = vm.createContext({
      EDUGNAY_API_BASE_URL: '/api',
      window: { location: { pathname } },
      document: { readyState: 'complete', addEventListener() {} },
      getApiSchoolContext: async () => { calls.context += 1; return school; },
      loadApiCalendarNotices: async () => { calls.calendar += 1; return []; },
      showAppToast() {}
    });
    vm.runInContext(source, context);
    const loadedSchool = await context.window.EDUGNAY_SCHOOL_READY;
    await context.window.EDUGNAY_CALENDAR_READY;
    return { calls, loadedSchool };
  }

  const guard = await load('/views/guard/edugnay-guard-profile.html');
  assert.equal(guard.calls.context, 1);
  assert.equal(guard.calls.calendar, 0);
  assert.equal(guard.loadedSchool.shortName, 'Test School');

  const admin = await load('/views/admin/edugnay-admin-profile.html');
  assert.equal(admin.calls.context, 1);
  assert.equal(admin.calls.calendar, 1, 'other school portals keep loading calendar notices');
});
