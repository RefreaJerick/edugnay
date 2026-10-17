const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const adminViews = path.join(root, 'views/admin');
const teacherViews = path.join(root, 'views/teacher');
const teacherNavPrefix = 'edugnay_teacher_sidebar_v1:';

function createTeacherShellHarness({
  schoolId = '10',
  session = { apiSchoolId: '10', apiUserId: '50', role: 'teacher' },
  advisorySections = [],
  teachingSections = [],
  journalSections = [],
  journalHistory = { prompts: [], entries: [] },
  narrativeReportsEnabled = true,
  journalsEnabled = true,
  sfTemplatesEnabled = true,
  failures = {},
  cachedSnapshot = null,
  pathname = '/views/teacher/edugnay-teacher-dashboard.html'
} = {}) {
  const storage = new Map();
  if (cachedSnapshot) {
    storage.set(`${teacherNavPrefix}current`, JSON.stringify({
      schoolId: cachedSnapshot.schoolId,
      teacherId: cachedSnapshot.teacherId
    }));
    storage.set(`${teacherNavPrefix}${encodeURIComponent(cachedSnapshot.schoolId)}:${encodeURIComponent(cachedSnapshot.teacherId)}`, JSON.stringify(cachedSnapshot));
  }

  const accessItems = ['reports', 'journals', 'sfTemplates'].map(feature => ({
    dataset: { teacherAccess: feature }, hidden: false
  }));
  const reportNav = {
    hidden: false,
    querySelector: () => accessItems.find(item => !item.hidden) || null
  };
  const sectionsNav = { children: [], replaceChildren(...children) { this.children = children; } };
  const listeners = new Map();
  const rootClasses = new Set();
  let lucideRenderCount = 0;
  const document = {
    documentElement: { classList: {
      add: name => rootClasses.add(name),
      remove: name => rootClasses.delete(name),
      toggle(name, force) {
        if (force) rootClasses.add(name);
        else rootClasses.delete(name);
      },
      contains: name => rootClasses.has(name)
    } },
    hidden: false,
    addEventListener: (type, listener) => listeners.set(type, listener),
    querySelectorAll(selector) {
      if (selector.includes('[data-teacher-access]')) return accessItems;
      if (selector.includes('#reports-nav')) return [reportNav];
      if (selector.includes('[data-teacher-sections-nav]')) return [sectionsNav];
      return [];
    },
    createElement() {
      return {
        children: [],
        setAttribute() {},
        append(...children) { this.children.push(...children); }
      };
    },
    createTextNode(textContent) { return { textContent }; },
    getElementById() { return null; },
    querySelector() { return null; }
  };

  let releaseSchoolReady;
  let schoolContextReady = false;
  const schoolReady = new Promise(resolve => { releaseSchoolReady = resolve; });
  const location = { pathname, search: '', href: 'http://localhost/views/teacher/current.html', redirect: '' };
  location.replace = target => { location.redirect = target; };
  const context = {
    document,
    sessionStorage: {
      get length() { return storage.size; },
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null
    },
    URL,
    URLSearchParams,
    console,
    lucide: { createIcons() { lucideRenderCount += 1; } },
    showAppToast() {},
    window: null
  };
  context.window = context;
  context.location = location;
  context.EDUGNAY_SCHOOL_READY = schoolReady;
  context.EDUGNAY_COMMUNICATION_READY = Promise.resolve();
  context.EDUGNAY_CONFIG = {
    getActiveSchoolId: () => schoolContextReady ? schoolId : null,
    getActiveSchool: () => schoolContextReady ? { id: schoolId, narrativeReportsEnabled, journalsEnabled, sfTemplatesEnabled } : null,
    getMyAdvisorySections: async () => {
      if (failures.advisory) throw new Error('advisory request failed');
      return advisorySections;
    },
    getMyTeachingSections: async () => {
      if (failures.sections) throw new Error('sections request failed');
      return teachingSections;
    },
    isNarrativeReportsEnabled: () => schoolContextReady && narrativeReportsEnabled
  };
  context.EDUGNAY_API = {
    isBackendAvailable: true,
    getCurrentUser: async () => {
      if (failures.session) {
        const error = new Error('session request failed');
        error.status = failures.sessionStatus || 500;
        throw error;
      }
      return session;
    },
    getJournalSections: async () => {
      if (failures.journals) throw new Error('journal request failed');
      return journalSections;
    },
    getJournalHistory: async () => {
      if (failures.journalHistory) throw new Error('history request failed');
      return journalHistory;
    },
    loadCommunication: async () => ({ backend: false, notifications: [] })
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/teacher/shell.js'), 'utf8'), context);
  return {
    context,
    accessItems,
    rootClasses,
    reportNav,
    sectionsNav,
    storage,
    resolveSchoolReady() {
      schoolContextReady = true;
      releaseSchoolReady();
    },
    listeners,
    location,
    get lucideRenderCount() { return lucideRenderCount; }
  };
}

function settingsItems(html) {
  const label = '<div class="nav-section-label">Settings</div>';
  const labelStart = html.indexOf(label);
  assert.notEqual(labelStart, -1, 'admin page should include a Settings section');
  const itemsStart = labelStart + label.length;
  const nextSection = html.indexOf('<div class="nav-section-label">', itemsStart);
  const section = html.slice(itemsStart, nextSection < 0 ? html.length : nextSection);
  return [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, contents]) => {
    const href = attributes.match(/\bhref="([^"]*)"/)?.[1];
    const label = contents.match(/<span\b[^>]*class="nav-label"[^>]*>([\s\S]*?)<\/span>/)?.[1]
      ?.replace(/\s+/g, ' ').trim();
    const classes = attributes.match(/\bclass="([^"]*)"/)?.[1]?.split(/\s+/) || [];
    return { href, label, active: classes.includes('active') };
  });
}

test('admin Settings navigation is static, consistent, and correctly active on every page', () => {
  const filenames = fs.readdirSync(adminViews).filter(filename => filename.endsWith('.html'));
  const pages = filenames.filter(filename => fs.readFileSync(path.join(adminViews, filename), 'utf8')
    .includes('<div class="nav-section-label">Settings</div>'));
  const expected = [
    { label: 'School Settings', href: 'edugnay-admin-schools.html' },
    { label: 'System Config', href: 'edugnay-admin-system-config.html' },
    { label: 'Archive Data', href: 'edugnay-admin-archive.html' }
  ];

  assert.ok(pages.length > 0, 'expected admin pages with a Settings section');
  for (const filename of pages) {
    const html = fs.readFileSync(path.join(adminViews, filename), 'utf8');
    const items = settingsItems(html);
    assert.deepEqual(items.map(({ label, href }) => ({ label, href })), expected, filename);
    const activeItems = items.filter(item => item.active).map(item => item.label);
    const expectedActive = filename === 'edugnay-admin-schools.html' ? 'School Settings'
      : filename === 'edugnay-admin-system-config.html' ? 'System Config'
        : filename === 'edugnay-admin-archive.html' ? 'Archive Data' : null;
    assert.deepEqual(activeItems, expectedActive ? [expectedActive] : [], `${filename} active item`);
  }

  const adminShell = fs.readFileSync(path.join(root, 'assets/js/admin/shell.js'), 'utf8');
  assert.doesNotMatch(adminShell, /ensureAdminConfigurationNav/);
});

test('teacher sidebar uses a school- and teacher-scoped session snapshot before refreshing navigation', () => {
  const filenames = fs.readdirSync(teacherViews).filter(filename => filename.endsWith('.html'));
  const pages = filenames.filter(filename => fs.readFileSync(path.join(teacherViews, filename), 'utf8')
    .includes('id="reports-nav"'));
  const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  const teacherShell = fs.readFileSync(path.join(root, 'assets/js/teacher/shell.js'), 'utf8');
  const commonShell = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');

  assert.ok(pages.length > 0, 'expected teacher pages with a Reports navigation group');
  assert.doesNotMatch(styles, /teacher-nav-ready|#reports-nav\s+\[data-teacher-access\][^{]*\{\s*visibility:\s*hidden/,
    'the teacher menu must not be hidden or replaced by reserved blank link slots while loading');
  assert.doesNotMatch(styles, /\.sidebar\s+\[data-teacher-access\]\[hidden\]/,
    'root access classes are the single source of sidebar visibility');
  assert.match(styles, /html\.teacher-nav-hide-reports .*data-teacher-access="reports"[\s\S]*?display:\s*none !important/,
    'a same-session cached permission result can be applied before the first paint');
  assert.match(teacherShell, /function getTeacherSidebarCacheKey\(schoolId, teacherId\)[\s\S]*?String\(schoolId\)[\s\S]*?String\(teacherId\)/);
  assert.match(teacherShell, /function readTeacherSidebarSnapshot\(\)[\s\S]*?String\(snapshot\.schoolId\) !== String\(pointer\.schoolId\)/);
  assert.match(teacherShell, /const INITIAL_TEACHER_SIDEBAR_SNAPSHOT = readTeacherSidebarSnapshot\(\);\s*setTeacherSidebarPrepaintState\(INITIAL_TEACHER_SIDEBAR_SNAPSHOT\);/);
  assert.match(teacherShell, /if \(window\.lucide\) window\.lucide\.createIcons\(\);\s*let cachedSnapshot = INITIAL_TEACHER_SIDEBAR_SNAPSHOT;\s*if \(cachedSnapshot\) applyTeacherSidebarSnapshot\(cachedSnapshot\);[\s\S]*?await window\.EDUGNAY_SCHOOL_READY/);
  assert.match(teacherShell, /if \(!teacherSidebarSnapshotsMatch\(cachedSnapshot, snapshot\)\)\s*\{\s*applyTeacherSidebarSnapshot\(snapshot, \{ previousSnapshot: cachedSnapshot, sectionsError \}\);/);
  assert.match(teacherShell, /function guardTeacherPageAccess\(\)[\s\S]*?teacherCanAccess\(restrictedFeature\)/);
  assert.match(teacherShell, /function teacherCanAccess\(feature\)[\s\S]*?if \(feature === 'journals'\) return teacherJournalAccess;[\s\S]*?if \(feature === 'sfTemplates'\) return teacherSfTemplatesAccess/);
  assert.doesNotMatch(teacherShell.match(/function teacherCanAccess\(feature\)\s*\{[\s\S]*?\n\}/)?.[0] || '', /cachedSnapshot|teacherNavigationCanAccess/);
  assert.match(commonShell, /function clearTeacherSidebarCache\(\)[\s\S]*?startsWith\(EDUGNAY_TEACHER_NAV_CACHE_PREFIX\)/);
  assert.match(commonShell, /let currentUserRequest = null;[\s\S]*?if \(currentUserRequest\) return currentUserRequest/);
  assert.match(commonShell, /async function getMyAdvisorySections\(includeClosed = false\)\s*\{\s*const session = readFrontendSession\(\) \|\| await getCurrentUser\(\)/);
  assert.match(commonShell, /async function confirmLogout\(\)[\s\S]*?clearTeacherSidebarCache\(\)/);
  assert.match(commonShell, /if \(error\.status === 401\)[\s\S]*?clearTeacherSidebarCache\(\)/);
  const loginPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(loginPage, /function clearTeacherSidebarCacheForSignIn\(\)[\s\S]*?edugnay_teacher_sidebar_v1:[\s\S]*?clearTeacherSidebarCacheForSignIn\(\);/);

  for (const filename of pages) {
    const html = fs.readFileSync(path.join(teacherViews, filename), 'utf8');
    const reportsNav = html.match(/<div class="nav-section" id="reports-nav">([\s\S]*?)<\/div>\s*<div class="nav-section">/);
    assert.ok(reportsNav, `${filename} should have a complete Reports group`);
    const labels = [...reportsNav[1].matchAll(/data-teacher-access="([^"]+)"[\s\S]*?<span class="nav-label">([^<]+)/g)]
      .map(([, access, label]) => `${access}:${label.trim()}`);
    assert.deepEqual(labels, [
      'reports:Narrative Reports',
      'journals:Student Journals',
      'sfTemplates:SF Templates'
    ], `${filename} Reports link order`);
  }
});

test('cached teacher navigation renders immediately, then removes a freshly revoked link', async () => {
  const cachedSnapshot = {
    version: 1,
    schoolId: '10',
    teacherId: '50',
    access: { reports: true, journals: true, sfTemplates: true },
    sections: [{ id: '501', grade: 'Grade 7', name: 'Rizal' }]
  };
  const harness = createTeacherShellHarness({
    cachedSnapshot,
    pathname: '/views/teacher/edugnay-teacher-journals.html',
    advisorySections: [{ id: '601' }],
    teachingSections: [{ id: '501', gradeLevelName: 'Grade 7', name: 'Rizal', status: 'active', academicYearStatus: 'active' }]
  });

  assert.equal(harness.context.EDUGNAY_CONFIG.getActiveSchoolId(), null, 'school context has not loaded when the cached menu is read');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports'), false, 'cached adviser access is reflected before the page can paint');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), false, 'cached Journal access is reflected before the page can paint');
  const initialization = harness.listeners.get('DOMContentLoaded')();
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), false, 'cached Journal visibility is applied before refresh begins');
  assert.equal(harness.sectionsNav.children.length, 1);
  harness.context.navigate('journals');
  assert.equal(harness.location.href, 'http://localhost/views/teacher/current.html', 'cached visibility does not grant live navigation access');

  harness.resolveSchoolReady();
  await initialization;

  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), true, 'fresh denial removes the stale Journal link');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), true, 'fresh permissions immediately refresh prepaint visibility state');
  assert.equal(harness.location.redirect, './edugnay-teacher-dashboard.html', 'fresh page guard blocks the Journal page');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports'), false, 'fresh adviser access keeps Narrative Reports visible');
  const savedPointer = JSON.parse(harness.storage.get(`${teacherNavPrefix}current`));
  assert.equal(savedPointer.teacherId, '50');
});

test('cold teacher navigation shows the existing menu and icons before data loads', async () => {
  const harness = createTeacherShellHarness({ teachingSections: [] });
  const initialization = harness.listeners.get('DOMContentLoaded')();

  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports-group'), true, 'an unverified Reports group collapses without leaving a gap');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-sf-templates'), true, 'unverified links do not flash before access is checked');
  assert.equal(harness.lucideRenderCount, 1, 'static sidebar icons render before access and page-data requests');
  harness.resolveSchoolReady();
  await initialization;

  assert.equal(harness.sectionsNav.children.length, 1);
  assert.equal(harness.sectionsNav.children[0].textContent, 'No subject sections assigned');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports'), true, 'the adviser-only Reports link remains hidden');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), true, 'the Journal link remains hidden without an assignment');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-sf-templates'), false, 'school-enabled SF Templates becomes visible after context loads');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports-group'), false, 'the group appears without reserving space while unverified');
});

test('teacher sidebar cache is isolated by tenant and teacher, and survives refresh failures safely', async () => {
  const wrongSchoolSnapshot = {
    version: 1,
    schoolId: '99',
    teacherId: '50',
    access: { reports: true, journals: true, sfTemplates: true },
    sections: [{ id: '999', grade: 'Grade 9', name: 'Wrong School' }]
  };
  const tenantHarness = createTeacherShellHarness({
    cachedSnapshot: wrongSchoolSnapshot,
    teachingSections: [{ id: '101', gradeLevelName: 'Grade 4', name: 'New School', status: 'active', academicYearStatus: 'active' }]
  });
  const tenantInitialization = tenantHarness.listeners.get('DOMContentLoaded')();
  assert.equal(tenantHarness.sectionsNav.children[0].children[1].textContent, 'Grade 9 – Wrong School', 'the last menu is shown while the current identity is checked');
  tenantHarness.resolveSchoolReady();
  await tenantInitialization;
  assert.equal(tenantHarness.sectionsNav.children.length, 1);
  assert.equal(tenantHarness.sectionsNav.children[0].children[1].textContent, 'Grade 4 – New School');

  const sameSchoolSnapshot = { ...wrongSchoolSnapshot, schoolId: '10' };
  const switchHarness = createTeacherShellHarness({
    cachedSnapshot: sameSchoolSnapshot,
    session: { apiSchoolId: '10', apiUserId: '51', role: 'teacher' },
    teachingSections: [{ id: '102', gradeLevelName: 'Grade 5', name: 'New Teacher', status: 'active', academicYearStatus: 'active' }]
  });
  const switchInitialization = switchHarness.listeners.get('DOMContentLoaded')();
  assert.equal(switchHarness.sectionsNav.children[0].children[1].textContent, 'Grade 9 – Wrong School');
  switchHarness.resolveSchoolReady();
  await switchInitialization;
  assert.equal(switchHarness.sectionsNav.children[0].children[1].textContent, 'Grade 5 – New Teacher');
  assert.equal(switchHarness.storage.has(`${teacherNavPrefix}10:50`), false, 'old teacher cache is removed on identity mismatch');
  assert.equal(JSON.parse(switchHarness.storage.get(`${teacherNavPrefix}current`)).teacherId, '51');

  const outageHarness = createTeacherShellHarness({
    cachedSnapshot: sameSchoolSnapshot,
    failures: { session: true }
  });
  const outageInitialization = outageHarness.listeners.get('DOMContentLoaded')();
  assert.equal(outageHarness.rootClasses.has('teacher-nav-hide-journals'), false, 'last verified menu remains stable during a temporary outage');
  outageHarness.resolveSchoolReady();
  await outageInitialization;
  outageHarness.context.navigate('journals');
  assert.equal(outageHarness.location.href, 'http://localhost/views/teacher/current.html', 'a cached link cannot navigate without refreshed live authorization');
  assert.equal(outageHarness.rootClasses.has('teacher-nav-hide-journals'), false);
});

test('fresh school feature settings remove stale cached links and guard the feature page', async () => {
  const cachedSnapshot = {
    version: 1,
    schoolId: '10',
    teacherId: '50',
    access: { reports: false, journals: false, sfTemplates: true },
    sections: []
  };
  const harness = createTeacherShellHarness({
    cachedSnapshot,
    journalsEnabled: false,
    sfTemplatesEnabled: false,
    failures: { journals: true },
    pathname: '/views/teacher/edugnay-teacher-sf-templates.html'
  });

  assert.equal(harness.rootClasses.has('teacher-nav-hide-sf-templates'), false, 'the last verified menu appears immediately');
  const initialization = harness.listeners.get('DOMContentLoaded')();
  harness.resolveSchoolReady();
  await initialization;

  assert.equal(harness.rootClasses.has('teacher-nav-hide-sf-templates'), true, 'the refreshed school setting hides SF Templates');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), true, 'the refreshed school setting hides Journals');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports-group'), true, 'the empty Reports group collapses without a gap');
  assert.equal(harness.location.redirect, './edugnay-teacher-dashboard.html', 'the refreshed setting guards the SF Templates page');
});
