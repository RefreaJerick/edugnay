const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { getSchoolContext } = require('../controllers/schoolContextController');
const calendar = require('../controllers/calendarNoticesController');
const shell = pageFs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');

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
    if (sql.includes('FROM schools')) return [[{ id: 7, name: 'Test School', shortName: 'TS', schoolType: 'jhs', schoolYear: '2026-2027', schoolEmailDomain: 'ts.academix.test', accentPalette: 'deep-teal', gradesEnabled: 1, logoPath: null }]];
    if (sql.includes('FROM school_levels')) return [[{ id: 3, levelCode: 'jhs', displayName: 'Junior High School', gradingPeriodType: 'quarterly', isEnabled: 1 }]];
    return [[{ id: 11, schoolLevel: 'jhs', name: 'Quarter 1', sequence: 1, status: 'active' }]];
  } };
  const res = response();
  let failure;
  await getSchoolContext({ user: { schoolId: 7 } }, res, error => { failure = error; });
  assert.equal(failure, undefined);
  assert.equal(res.data.school.id, 7);
  assert.equal(res.data.school.schoolEmailDomain, 'ts.academix.test');
  assert.equal(res.data.school.accentPalette, 'deep-teal');
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
      cacheSchoolBrandSnapshot() {},
      schoolBrandCacheSuppressed: false,
      window: {
        EDUGNAY_API_SCHOOL_CONTEXT: school,
        EDUGNAY_CONFIG: {
          getActiveSchool: () => school,
          getSchoolTypeInfo: () => ({ label: 'Elementary' }),
          getCurrentAcademicPeriod: () => { throw new Error('an active division must not supply a dashboard period'); },
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
      const html = pageFs.readFileSync(path.join(directory, filename), 'utf8');
      assert.doesNotMatch(html, /ST\. COLUMBAN'S COLLEGE/);
      for (const [, content] of html.matchAll(/<div class="brand-sub"[^>]*>([\s\S]*?)<\/div>/g)) {
        assert.equal(content.trim(), '', role + '/' + filename + ' should not show a school before context loads');
      }
      if (html.includes('shell-common.js')) {
        assert.doesNotMatch(html, /shell-common\.js\?v=11/, role + '/' + filename + ' should fetch the updated shell');
        const shellVersion = role === 'student' && filename === 'edugnay-student-dashboard.html' ? 13 : 12;
        assert.match(html, new RegExp(`shell-common\\.js\\?v=${shellVersion}`), role + '/' + filename + ' should use the expected shell version');
      }
    }
  }
});

test('shared active-period label uses its explicit school level instead of the school default', () => {
  const source = shell.match(/function applyActiveSchoolToShell\(\) \{[\s\S]*?\n\}/)[0];
  const activePeriod = { textContent: '', dataset: { schoolLevel: 'shs' } };
  const requestedLevels = [];
  const school = { id: 7, name: 'Test School', shortName: 'TS', schoolType: 'combined', schoolLevels: [], activeDivision: 'elem', schoolYear: '2026-2027' };
  const context = {
    cacheSchoolBrandSnapshot() {},
    schoolBrandCacheSuppressed: false,
    window: {
      EDUGNAY_API_SCHOOL_CONTEXT: school,
      EDUGNAY_CONFIG: {
        getActiveSchool: () => school,
        getSchoolTypeInfo: () => ({ label: 'Combined' }),
        getCurrentAcademicPeriod(schoolId, schoolLevel) {
          requestedLevels.push([schoolId, schoolLevel]);
          return schoolLevel === 'shs' ? { name: 'Term 2' } : { name: 'Quarter 3' };
        },
        isGradesPageEnabled: () => true
      }
    },
    document: {
      body: { dataset: {} },
      querySelectorAll(selector) {
        return selector === '[data-active-academic-period]' ? [activePeriod] : [];
      }
    }
  };

  vm.runInNewContext(`${source}\napplyActiveSchoolToShell();`, context);

  assert.equal(activePeriod.textContent, 'Term 2 · S.Y. 2026-2027');
  assert.deepEqual(requestedLevels, [[7, 'shs']]);
});

test('only the student dashboard includes the active grading period card', () => {
  const dashboardHtml = role => fs.readFileSync(
    path.join(__dirname, '../../views', role, `edugnay-${role}-dashboard.html`), 'utf8');

  const studentHtml = dashboardHtml('student');
  assert.match(studentHtml, /class="grading-period-card"[\s\S]*?data-active-academic-period/);
  const studentDashboardScript = pageFs.readFileSync(
    path.join(__dirname, '../../assets/js/student/dashboard.js'), 'utf8');
  assert.match(studentDashboardScript,
    /const sections = await window\.EDUGNAY_API\.getSections\(\);\s*const currentSection = sections\.find\(section => section\.academicYearStatus === 'active'\);\s*if \(dashboardPeriod\) \{\s*dashboardPeriod\.dataset\.schoolLevel = currentSection\?\.level \|\| '';\s*window\.refreshEdUgnayShellContext\?\.\(\);/,
    'the student dashboard resolves the displayed period from the enrolled section in the active year');
  for (const role of ['admin', 'teacher', 'parent']) {
    const html = dashboardHtml(role);
    assert.doesNotMatch(html, /data-active-academic-period/);
    assert.doesNotMatch(html, /class="grading-period-card"/);
  }
  for (const role of ['teacher', 'parent']) {
    const script = pageFs.readFileSync(path.join(__dirname, '../../assets/js', role, 'dashboard.js'), 'utf8');
    assert.doesNotMatch(script, /dashboardPeriod|data-active-academic-period/,
      `${role} dashboard must not update a removed period card`);
  }
});

test('school-context events apply and cache the current short name without clearing a verified name during a missing context', () => {
  const setContextSource = shell.match(/function setApiSchoolContext\(school, features = null\) \{[\s\S]*?\n\}/)[0];
  const applySource = shell.match(/function applyActiveSchoolToShell\(\) \{[\s\S]*?\n\}/)[0];
  const brand = { textContent: '' };
  const listeners = new Map();
  let cachedShortName = '';
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
    schoolBrandCacheSuppressed: false,
    cacheSchoolBrandSnapshot(school) { cachedShortName = school.shortName; },
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
  assert.equal(cachedShortName, 'CURRENT SCHOOL');

  context.setApiSchoolContext(null);
  assert.equal(brand.textContent, 'CURRENT SCHOOL', 'a temporary missing context should not erase the verified sidebar name');

  brand.textContent = 'PLATFORM ADMINISTRATION';
  document.body.dataset.platformPortal = 'true';
  vm.runInNewContext('applyActiveSchoolToShell();', context);
  assert.equal(brand.textContent, 'PLATFORM ADMINISTRATION');
});

test('sidebar school name restores only from a role and school matched cache before markup paint', () => {
  const helperStart = shell.indexOf('function isSchoolPortalRole(role) {');
  const helperEnd = shell.indexOf('\nfunction saveProfileDisplaySnapshot(session) {', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = shell.slice(helperStart, helperEnd);

  function createBrandHarness({ role = 'teacher', accountRole = role, schoolId = '12', cachedSchoolId = schoolId, cachedRole = role, shortName = 'QA SCHOOL' } = {}) {
    const storage = new Map([
      ['edugnay_school_brand_v1', JSON.stringify({ version: 1, role: cachedRole, schoolId: cachedSchoolId, shortName })]
    ]);
    const labels = [];
    const observers = [];
    class TestMutationObserver {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
    const document = {
      documentElement: {},
      querySelectorAll(selector) { return selector === '.brand-sub:not([data-platform-brand])' ? labels : []; },
      addEventListener() {}
    };
    const context = vm.createContext({
      document,
      sessionStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key)
      },
      MutationObserver: TestMutationObserver
    });
    vm.runInContext(`const EDUGNAY_SCHOOL_BRAND_CACHE_KEY = 'edugnay_school_brand_v1';
      const portalRoleForCurrentPage = '${role}';
      let cachedProfileDisplaySnapshot = { version: 1, role: '${accountRole}', userId: '7', schoolId: '${schoolId}' };
      let cachedSchoolBrandObserver = null;
      let schoolBrandCacheSuppressed = false;
      ${helperSource}`, context);
    return {
      storage, labels, observers, context,
      addLabel() {
        const label = { textContent: '' };
        labels.push(label);
        observers.filter(observer => !observer.disconnected).forEach(observer => observer.callback());
        return label;
      }
    };
  }

  const matching = createBrandHarness();
  const matchingLabel = matching.addLabel();
  assert.equal(matchingLabel.textContent, 'QA SCHOOL', 'matching cache is restored as soon as sidebar markup is inserted');
  vm.runInContext("cacheSchoolBrandSnapshot({ id: 12, shortName: 'Renamed School' })", matching.context);
  assert.equal(matchingLabel.textContent, 'Renamed School', 'fresh context replaces the visible cached name');
  assert.deepEqual(JSON.parse(matching.storage.get('edugnay_school_brand_v1')), {
    version: 1, role: 'teacher', schoolId: '12', shortName: 'Renamed School'
  });

  for (const options of [
    { cachedSchoolId: '13' },
    { cachedRole: 'student' },
    { role: 'student', accountRole: 'teacher' },
    { shortName: ' ' }
  ]) {
    const mismatched = createBrandHarness(options);
    assert.equal(mismatched.addLabel().textContent, '', 'mismatched or invalid saved identity stays blank');
  }

  const platform = createBrandHarness({ role: 'platform_admin', accountRole: 'platform_admin' });
  assert.equal(platform.addLabel().textContent, '', 'platform branding does not restore a school name');
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
