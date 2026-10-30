const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { getSchoolContext } = require('../controllers/schoolContextController');
const calendar = require('../controllers/calendarNoticesController');
const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');

function response() {
  return {
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
    send() { return this; }
  };
}

test('school context returns only the authenticated school and its current periods', async () => {
  const calls = [];
  database = { async execute(sql, params) {
    calls.push(params);
    if (sql.includes('FROM schools')) return [[{ id: 7, name: 'Test School', shortName: 'TS', schoolType: 'jhs', schoolYear: '2026-2027', schoolEmailDomain: 'ts.academix.test', gradesEnabled: 1, logoPath: null }]];
    if (sql.includes('FROM school_levels')) return [[{ id: 3, levelCode: 'jhs', displayName: 'Junior High School', gradingPeriodType: 'quarterly', isEnabled: 1 }]];
    return [[{ id: 11, schoolLevel: 'jhs', name: 'Quarter 1', sequence: 1, status: 'active' }]];
  } };
  const res = response();
  let failure;
  await getSchoolContext({ user: { schoolId: 7 } }, res, error => { failure = error; });
  assert.equal(failure, undefined);
  assert.equal(res.data.school.id, 7);
  assert.equal(res.data.school.schoolEmailDomain, 'ts.academix.test');
  assert.equal(res.data.school.divisions.jhs.academicPeriods[0].name, 'Quarter 1');
  assert.deepEqual(calls, [[7], [7], [7, '2026-2027']]);
});

test('shared shell omits a missing school-year suffix instead of displaying null', () => {
  const source = shell.match(/function applyActiveSchoolToShell\(\) \{[\s\S]*?\n\}/)[0];
  const render = schoolYear => {
    const activePeriod = { textContent: '', dataset: {} };
    const schoolContext = { textContent: '' };
    const yearElement = { textContent: '' };
    const school = { id: 7, name: 'Test School', shortName: 'TS', schoolType: 'elementary', schoolLevels: [], activeDivision: 'elem', schoolYear };
    const context = {
      window: {
        EDUGNAY_API_SCHOOL_CONTEXT: school,
        EDUGNAY_CONFIG: {
          getActiveSchool: () => school,
          getSchoolTypeInfo: () => ({ label: 'Elementary' }),
          getCurrentAcademicPeriod: () => null,
          isGradesPageEnabled: () => false
        }
      },
      document: {
        body: { dataset: {} },
        querySelectorAll(selector) {
          if (selector === '[data-active-academic-period]') return [activePeriod];
          if (selector === '[data-school-context]') return [schoolContext];
          if (selector === '[data-school-year]') return [yearElement];
          return [];
        }
      }
    };
    vm.runInNewContext(`${source}\napplyActiveSchoolToShell();`, context);
    return { activePeriod: activePeriod.textContent, schoolContext: schoolContext.textContent, year: yearElement.textContent };
  };

  assert.deepEqual(render(null), {
    activePeriod: 'No active grading period',
    schoolContext: 'Elementary',
    year: ''
  });
  assert.deepEqual(render('2026-2027'), {
    activePeriod: 'No active grading period · S.Y. 2026-2027',
    schoolContext: 'Elementary · 2026-2027',
    year: '2026-2027'
  });
});

test('calendar listing uses the signed-in school and preserves local date', async () => {
  database = { async execute(sql, params) {
    assert.match(sql, /WHERE school_id = \?/);
    assert.match(sql, /DATE_FORMAT\(holiday_date, '%Y-%m-%d'\)/);
    assert.deepEqual(params, [7]);
    return [[{ id: 4, date: '2026-10-14', title: 'No classes', detail: '', type: 'holiday', appliesTo: 'all' }]];
  } };
  const res = response();
  await calendar.listCalendarNotices({ user: { schoolId: 7 } }, res, error => { throw error; });
  assert.equal(res.data.notices[0].date, '2026-10-14');
});

test('communication waits for calendar notices before building same-day notifications', async () => {
  const source = shell.match(/async function loadApiCommunication\(role\) \{[\s\S]*?\n\}\n\nasync function getApiPlatformSchools/)[0]
    .replace(/\n\nasync function getApiPlatformSchools$/, '');
  let releaseCalendar;
  const calendarReady = new Promise(resolve => { releaseCalendar = resolve; });
  const context = {
    EDUGNAY_API_BASE_URL: 'http://127.0.0.1:3000/api',
    window: { EDUGNAY_SCHOOL_READY: Promise.resolve(), EDUGNAY_CALENDAR_READY: calendarReady },
    getApiNotifications: async () => [],
    getApiTasks: async () => [],
    getApiAnnouncements: async () => [],
    getTodayCalendarNotifications: () => [{ id: 'calendar-1' }]
  };
  const load = vm.runInNewContext(`${source}\nloadApiCommunication`, context);
  let settled = false;
  const result = load('parent').then(value => { settled = true; return value; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  releaseCalendar();
  assert.equal((await result).notifications[0].id, 'calendar-1');
});

test('calendar notification uses the local school date, not a UTC date string', () => {
  const source = shell.match(/function getTodayCalendarNotifications\(\) \{[\s\S]*?\n\}\n\nasync function loadApiCommunication/)[0]
    .replace(/\n\nasync function loadApiCommunication$/, '');
  const context = {
    Date: class { getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 14; } },
    window: {
      EDUGNAY_API_SCHOOL_CONTEXT: { id: 7 },
      EDUGNAY_CALENDAR_NOTICES: [
        { id: 1, date: '2026-10-14', title: 'No classes' },
        { id: 2, date: '2026-10-13', title: 'Yesterday' }
      ]
    },
    isSyntheticNotificationRead: () => false
  };
  const getToday = vm.runInNewContext(`${source}\ngetTodayCalendarNotifications`, context);
  const notices = getToday();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'No classes');
  assert.equal(notices[0].createdAt, '2026-10-14T00:00:00');
});

test('calendar create rejects impossible dates without writing', async () => {
  database = { getConnection() { throw new Error('unexpected database write'); } };
  const res = response();
  await calendar.createCalendarNotice({ user: { schoolId: 7 }, body: { date: '2026-02-30', title: 'Bad date' } },
    res, error => { throw error; });
  assert.equal(res.code, 400);
});

test('calendar delete scopes the target to the signed-in school', async () => {
  const queries = [];
  const connection = {
    async beginTransaction() {},
    async rollback() {},
    async execute(sql, params) { queries.push([sql, params]); return [{ affectedRows: 0 }]; },
    release() {}
  };
  database = { getConnection: async () => connection };
  const res = response();
  await calendar.deleteCalendarNotice({ user: { schoolId: 7 }, params: { noticeId: '52' } },
    res, error => { throw error; });
  assert.equal(res.code, 404);
  assert.deepEqual(queries[0][1], [52, 7]);
});

test('calendar create and delete commit school-scoped changes', async () => {
  const queries = [];
  let commits = 0;
  const connection = {
    async beginTransaction() {},
    async commit() { commits += 1; },
    async rollback() { throw new Error('unexpected rollback'); },
    async execute(sql, params) {
      queries.push([sql, params]);
      if (sql.includes('INSERT INTO holidays')) return [{ insertId: 53 }];
      if (sql.includes('DELETE FROM holidays')) return [{ affectedRows: 1 }];
      return [{}];
    },
    release() {}
  };
  database = { getConnection: async () => connection };
  const created = response();
  await calendar.createCalendarNotice({ user: { id: 3, schoolId: 7 },
    body: { date: '2026-10-14', title: 'No classes', detail: 'Local event' } },
  created, error => { throw error; });
  assert.equal(created.code, 201);
  assert.equal(created.data.notice.date, '2026-10-14');
  assert.deepEqual(queries[0][1], [7, '2026-10-14', 'No classes', 'Local event']);
  const removed = response();
  await calendar.deleteCalendarNotice({ user: { id: 3, schoolId: 7 }, params: { noticeId: '53' } },
    removed, error => { throw error; });
  assert.equal(removed.code, 204);
  assert.deepEqual(queries[2][1], [53, 7]);
  assert.equal(commits, 2);
});

test('school portal sidebars begin without a tenant name and load the shared shell update', () => {
  for (const role of ['admin', 'teacher', 'student', 'parent']) {
    const directory = path.join(__dirname, '../../views', role);
    for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(directory, filename), 'utf8');
      assert.doesNotMatch(html, /ST\. COLUMBAN'S COLLEGE/);
      for (const [, content] of html.matchAll(/<div class="brand-sub"[^>]*>([\s\S]*?)<\/div>/g)) {
        assert.equal(content.trim(), '', role + '/' + filename + ' should not show a school before context loads');
      }
      if (html.includes('shell-common.js')) {
        assert.doesNotMatch(html, /shell-common\.js\?v=10/, role + '/' + filename + ' should fetch the updated shell');
        assert.match(html, /shell-common\.js\?v=11/, role + '/' + filename + ' should use the updated shell version');
      }
    }
  }
});

test('school-context events apply the current short name immediately and clear stale names', () => {
  const setContextSource = shell.match(/function setApiSchoolContext\(school, features = null\) \{[\s\S]*?\n\}/)[0];
  const applySource = shell.match(/function applyActiveSchoolToShell\(\) \{[\s\S]*?\n\}/)[0];
  const brand = { textContent: '' };
  const listeners = new Map();
  const document = {
    body: { dataset: {} },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); },
    querySelectorAll(selector) {
      return selector === '.brand-sub:not([data-platform-brand])' ? [brand] : [];
    }
  };
  const window = {
    EDUGNAY_API_SCHOOL_CONTEXT: null,
    EDUGNAY_CONFIG: {
      getActiveSchool: () => window.EDUGNAY_API_SCHOOL_CONTEXT,
      getSchoolTypeInfo: () => ({ label: 'Junior High School' }),
      getCurrentAcademicPeriod: () => null,
      isGradesPageEnabled: () => true
    }
  };
  const context = {
    document,
    window,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    }
  };
  vm.runInNewContext(
    setContextSource + '\n' + applySource + '\ndocument.addEventListener(\'edugnay:school-context-updated\', applyActiveSchoolToShell);',
    context
  );

  vm.runInNewContext('applyActiveSchoolToShell();', context);
  assert.equal(brand.textContent, '');

  context.setApiSchoolContext({ id: 12, name: 'Current School', shortName: 'CURRENT SCHOOL', schoolType: 'jhs', schoolLevels: [] });
  assert.equal(brand.textContent, 'CURRENT SCHOOL');

  context.setApiSchoolContext(null);
  assert.equal(brand.textContent, '');

  brand.textContent = 'PLATFORM ADMINISTRATION';
  document.body.dataset.platformPortal = 'true';
  vm.runInNewContext('applyActiveSchoolToShell();', context);
  assert.equal(brand.textContent, 'PLATFORM ADMINISTRATION');
});

test('the school label updates before shared startup waits for the account request', () => {
  const readyHandlerStart = shell.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
  assert.notEqual(readyHandlerStart, -1);
  const readyHandler = shell.slice(readyHandlerStart);
  const labelUpdate = readyHandler.indexOf('applyActiveSchoolToShell();');
  const accountWait = readyHandler.indexOf('await getCurrentUser()');
  assert.notEqual(labelUpdate, -1);
  assert.notEqual(accountWait, -1);
  assert.ok(labelUpdate < accountWait, 'the sidebar name should not wait for /auth/me');
});
