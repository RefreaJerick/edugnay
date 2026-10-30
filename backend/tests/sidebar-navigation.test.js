const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const adminViews = path.join(root, 'views/admin');
const teacherViews = path.join(root, 'views/teacher');
const studentViews = path.join(root, 'views/student');
const parentViews = path.join(root, 'views/parent');
const teacherNavPrefix = 'edugnay_teacher_sidebar_v1:';
const studentNavPrefix = 'edugnay_student_sidebar_v1:';
const parentNavPrefix = 'edugnay_parent_sidebar_v1:';

function createTeacherShellHarness({
  schoolId = '10',
  session = { apiSchoolId: '10', apiUserId: '50', role: 'teacher' },
  advisorySections = [],
  teachingSections = [],
  shsClasses = [],
  journalSections = [],
  journalHistory = { prompts: [], entries: [] },
  narrativeReportsEnabled = true,
  journalsEnabled = true,
  sfTemplatesEnabled = true,
  failures = {},
  cachedSnapshot = null,
  pathname = '/views/teacher/edugnay-teacher-dashboard.html',
  search = ''
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
  const sectionsNav = { children: [], renderCount: 0, replaceChildren(...children) { this.children = children; this.renderCount += 1; } };
  const sectionGroupClasses = new Set(pathname.endsWith('edugnay-teacher-sections.html') ? ['open'] : []);
  const sectionToggle = { attributes: {}, listeners: {}, setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; } };
  const sectionGroup = { querySelector: () => sectionToggle, classList: {
    toggle(name, force) {
      if (force === undefined ? !sectionGroupClasses.has(name) : force) sectionGroupClasses.add(name);
      else sectionGroupClasses.delete(name);
    },
    contains: name => sectionGroupClasses.has(name)
  } };
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
    getElementById(id) { return id === 'sections-group' ? sectionGroup : null; },
    querySelector() { return null; }
  };

  let releaseSchoolReady;
  let schoolContextReady = false;
  const schoolReady = new Promise(resolve => { releaseSchoolReady = resolve; });
  const location = { pathname, search, href: `http://localhost/views/teacher/current.html${search}`, redirect: '' };
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
    getShsTeachingClasses: async () => {
      if (failures.shsClasses) {
        const error = new Error('SHS classes unavailable');
        error.status = failures.shsClasses;
        throw error;
      }
      return { classes: shsClasses };
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
    sectionGroup,
    sectionToggle,
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

function createStudentShellHarness({
  session = { apiSchoolId: '10', apiUserId: '70', role: 'student', schoolLevel: 'jhs' },
  gradesEnabled = true,
  journalsEnabled = true,
  journalHistory = { entries: [] },
  failures = {},
  cachedSnapshot = null,
  pathname = '/views/student/edugnay-student-dashboard.html',
  deferPortal = false,
  electivesEligible = false
} = {}) {
  const storage = new Map();
  if (cachedSnapshot) {
    storage.set(`${studentNavPrefix}current`, JSON.stringify({
      schoolId: cachedSnapshot.schoolId,
      studentId: cachedSnapshot.studentId
    }));
    storage.set(`${studentNavPrefix}${encodeURIComponent(cachedSnapshot.schoolId)}:${encodeURIComponent(cachedSnapshot.studentId)}`, JSON.stringify(cachedSnapshot));
  }

  const accessItems = {
    grades: { hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } },
    journals: { hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } },
    attendance: { hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } },
    journalFeature: { hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } }
  };
  const listeners = new Map();
  const rootClasses = new Set();
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
      if (selector.includes('edugnay-student-grades.html')) return [accessItems.grades];
      if (selector.includes('edugnay-student-journal.html')) return [accessItems.journals];
      if (selector.includes('edugnay-student-attendance.html')) return [accessItems.attendance];
      if (selector.includes('.journal-feature')) return [accessItems.journalFeature];
      return [];
    },
    getElementById() { return null; },
    querySelector() { return null; }
  };
  let releasePortal;
  const portalPromise = deferPortal ? new Promise(resolve => { releasePortal = resolve; }) : null;
  let electiveSelectionCalls = 0;
  let activeFeatures = null;
  const location = { pathname, href: `http://localhost${pathname}`, redirect: '' };
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
    showAppToast() {},
    window: null
  };
  context.window = context;
  context.location = location;
  context.EDUGNAY_SCHOOL_READY = Promise.resolve();
  context.EDUGNAY_COMMUNICATION_READY = Promise.resolve();
  context.EDUGNAY_CONFIG = {
    isGradesPageEnabled: () => gradesEnabled,
    isJournalsEnabled: () => activeFeatures?.journalsEnabled ?? journalsEnabled,
    isAttendanceEnabled: () => true
  };
  context.EDUGNAY_API = {
    isBackendAvailable: true,
    enforceProfileSetup: async () => false,
    getCurrentUser: async () => {
      if (failures.session) {
        const error = new Error('session request failed');
        error.status = failures.sessionStatus || 500;
        throw error;
      }
      return session;
    },
    getPortalFeatures: async () => {
      if (failures.portal) throw new Error('portal request failed');
      if (portalPromise) return portalPromise;
      return { features: { gradesEnabled, journalsEnabled }, journalSubjectId: 3, journalSubjectName: 'English', journalSubjectEligible: true, electivesEligible };
    },
    getShsSelection: async () => {
      electiveSelectionCalls += 1;
      return {};
    },
    setPortalFeatures(features) { activeFeatures = features; },
    getJournalHistory: async () => {
      if (failures.history) throw new Error('history request failed');
      return journalHistory;
    },
    loadCommunication: async () => ({ backend: false, notifications: [] })
  };

  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/student/shell.js'), 'utf8'), context);
  return {
    context,
    accessItems,
    rootClasses,
    storage,
    listeners,
    location,
    releasePortal,
    get electiveSelectionCalls() { return electiveSelectionCalls; },
    getCachedSnapshot() {
      const pointer = JSON.parse(storage.get(`${studentNavPrefix}current`) || 'null');
      if (!pointer) return null;
      return JSON.parse(storage.get(`${studentNavPrefix}${encodeURIComponent(pointer.schoolId)}:${encodeURIComponent(pointer.studentId)}`) || 'null');
    }
  };
}

function createParentShellHarness({
  cachedSnapshot = null,
  session = { apiSchoolId: '10', apiUserId: '80', role: 'parent' },
  gradesEnabled = true,
  reportsEnabled = true,
  schoolFailure = false,
  sessionFailure = null,
  pathname = '/views/parent/edugnay-parent-dashboard.html'
} = {}) {
  const storage = new Map();
  if (cachedSnapshot) {
    storage.set(`${parentNavPrefix}current`, JSON.stringify({
      schoolId: cachedSnapshot.schoolId, parentId: cachedSnapshot.parentId
    }));
    storage.set(`${parentNavPrefix}${cachedSnapshot.schoolId}:${cachedSnapshot.parentId}`, JSON.stringify(cachedSnapshot));
  }
  const rootClasses = new Set();
  const listeners = new Map();
  const reportHero = { hidden: false };
  const document = {
    documentElement: { classList: {
      toggle(name, hide) { if (hide) rootClasses.add(name); else rootClasses.delete(name); },
      contains: name => rootClasses.has(name)
    } },
    addEventListener(type, callback) { listeners.set(type, callback); },
    querySelectorAll(selector) { return selector.includes('.report-hero') ? [reportHero] : []; },
    getElementById() { return null; },
    querySelector() { return null; }
  };
  let finishSchool;
  let failSchool;
  let school = null;
  const schoolReady = new Promise((resolve, reject) => {
    finishSchool = resolve;
    failSchool = reject;
  });
  const location = { pathname, href: `http://localhost${pathname}`, redirect: '' };
  location.replace = target => { location.redirect = target; };
  const context = {
    document, location, console: { warn() {} }, showAppToast() {}, window: null,
    sessionStorage: {
      get length() { return storage.size; },
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
      key: index => [...storage.keys()][index] ?? null
    },
    EDUGNAY_SCHOOL_READY: schoolReady,
    EDUGNAY_CONFIG: {
      getActiveSchool: () => school,
      getInitials: () => 'PL',
      isGradesPageEnabled: () => Boolean(school?.gradesPageEnabled),
      isNarrativeReportsEnabled: () => Boolean(school?.narrativeReportsEnabled)
    },
    EDUGNAY_API: {
      isBackendAvailable: true,
      loadCommunication: async () => ({ backend: false }),
      enforceProfileSetup: async () => false,
      getCurrentUser: async () => {
        if (sessionFailure) throw Object.assign(new Error('session failed'), { status: sessionFailure });
        return session;
      }
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/parent/shell.js'), 'utf8'), context);
  return {
    context, storage, rootClasses, listeners, location, reportHero,
    resolveSchoolReady() {
      if (schoolFailure) failSchool(new Error('school failed'));
      else {
        school = { id: session?.apiSchoolId || '10', gradesPageEnabled: gradesEnabled,
          narrativeReportsEnabled: reportsEnabled };
        finishSchool();
      }
    },
    getCachedSnapshot() {
      const pointer = JSON.parse(storage.get(`${parentNavPrefix}current`) || 'null');
      return pointer ? JSON.parse(storage.get(`${parentNavPrefix}${pointer.schoolId}:${pointer.parentId}`) || 'null') : null;
    }
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

test('every admin sidebar has one direct Class Management link and no submenu', () => {
  const filenames = fs.readdirSync(adminViews).filter(filename => filename.endsWith('.html'));
  for (const filename of filenames) {
    const html = fs.readFileSync(path.join(adminViews, filename), 'utf8');
    const start = html.indexOf('<aside class="sidebar"');
    assert.notEqual(start, -1, filename);
    const sidebar = html.slice(start, html.indexOf('</aside>', start));
    const links = [...sidebar.matchAll(/<a\b[^>]*href="(?:\.\/)?edugnay-admin-management\.html"[^>]*>[\s\S]*?<\/a>/g)];
    assert.equal(links.length, 1, filename);
    assert.match(links[0][0], /class="nav-item(?: active)?"/);
    assert.match(links[0][0], /onclick="localStorage\.removeItem\('managementTab'\)"/);
    assert.match(links[0][0], /<span class="nav-label">Class Management<\/span>/);
    assert.equal(links[0][0].includes('class="nav-item active"'), filename === 'edugnay-admin-management.html', filename);
    assert.doesNotMatch(sidebar, /classMgmtGroup|nav-group-toggle|nav-children|nav-child|nav-chevron/, filename);
    assert.ok(sidebar.indexOf('Manage Users') < sidebar.indexOf('Class Management'), filename);
    assert.ok(sidebar.indexOf('Class Management') < sidebar.indexOf('Timetables'), filename);
  }
  const adminShell = fs.readFileSync(path.join(root, 'assets/js/admin/shell.js'), 'utf8');
  assert.doesNotMatch(adminShell, /function toggleNavGroup/);
});

test('Class Management tabs still switch and School Settings can open Subjects', () => {
  const html = fs.readFileSync(path.join(adminViews, 'edugnay-admin-management.html'), 'utf8');
  const schoolSettings = fs.readFileSync(path.join(adminViews, 'edugnay-admin-schools.html'), 'utf8');
  for (const tab of ['sections', 'subjects', 'teachers', 'students']) {
    assert.match(html, new RegExp(`class="mgmt-tab(?: active)?" data-tab="${tab}"`));
    assert.match(html, new RegExp(`id="panel-${tab}"`));
  }
  assert.match(html, /class="mgmt-panel active" id="panel-sections"/);
  assert.match(schoolSettings, /href="edugnay-admin-management\.html" onclick="localStorage\.setItem\('managementTab','subjects'\)"/);

  const start = html.indexOf('const mgmtTitles = {');
  const end = html.indexOf('function updateSectionFormFields()', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  function loadTabs(savedTab) {
    const makeItem = active => {
      const classes = new Set(active ? ['active'] : []);
      return { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
    };
    const names = ['sections', 'subjects', 'teachers', 'students'];
    const tabs = Object.fromEntries(names.map(name => [name, makeItem(name === 'sections')]));
    const panels = Object.fromEntries(names.map(name => [name, makeItem(name === 'sections')]));
    const pageTitle = { textContent: '' };
    let stored = savedTab;
    const context = {
      document: {
        querySelectorAll: selector => selector === '.mgmt-tab' ? Object.values(tabs) : Object.values(panels),
        querySelector: selector => tabs[selector.match(/data-tab="([^"]+)"/)?.[1]],
        getElementById: id => id === 'pageTitle' ? pageTitle : panels[id.slice('panel-'.length)]
      },
      localStorage: { getItem: () => stored, removeItem: () => { stored = null; } },
      window: { scrollTo() {} }
    };
    vm.runInNewContext(source, context);
    return { tabs, panels, pageTitle, context, stored: () => stored };
  }

  const direct = loadTabs(null);
  assert.equal(direct.tabs.sections.classList.contains('active'), true);
  direct.context.switchMgmtTab('teachers', direct.tabs.teachers);
  assert.equal(direct.tabs.teachers.classList.contains('active'), true);
  assert.equal(direct.panels.teachers.classList.contains('active'), true);
  assert.equal(direct.tabs.sections.classList.contains('active'), false);

  const subjects = loadTabs('subjects');
  assert.equal(subjects.tabs.subjects.classList.contains('active'), true);
  assert.equal(subjects.panels.subjects.classList.contains('active'), true);
  assert.match(subjects.pageTitle.textContent, /Subjects$/);
  assert.equal(subjects.stored(), null);
  const invalid = loadTabs('unknown');
  assert.equal(invalid.tabs.sections.classList.contains('active'), true);
  assert.equal(invalid.stored(), null);
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
  assert.match(teacherShell, /if \(window\.lucide\) window\.lucide\.createIcons\(\);\s*let cachedSnapshot = INITIAL_TEACHER_SIDEBAR_SNAPSHOT;\s*if \(cachedSnapshot\) applyTeacherSidebarSnapshot\(cachedSnapshot, \{[\s\S]*?teacherClassesRestoredBeforePaint[\s\S]*?await window\.EDUGNAY_SCHOOL_READY/);
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
  assert.match(loginPage, /function clearPortalCachesForSignIn\(\)[\s\S]*?edugnay_teacher_sidebar_v1:[\s\S]*?clearPortalCachesForSignIn\(\);/);

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

test('student navigation pre-paints cached access on every portal page', () => {
  const filenames = fs.readdirSync(studentViews).filter(filename => filename.endsWith('.html'));
  const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  const studentShell = fs.readFileSync(path.join(root, 'assets/js/student/shell.js'), 'utf8');
  const commonShell = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const loginPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.ok(filenames.length > 0, 'expected student portal pages');
  for (const filename of filenames) {
    const html = fs.readFileSync(path.join(studentViews, filename), 'utf8');
    assert.match(html, /assets\/js\/student\/shell\.js/, `${filename} should use the shared student shell`);
    assert.match(html, /data-student-access="electives"/, `${filename} should use the shared elective access state`);
    assert.match(html, /href="edugnay-student-electives\.html"[^>]*data-student-access="electives"/,
      `${filename} should link eligible students to My Electives`);
  }
  assert.match(styles, /html\.student-nav-hide-grades[\s\S]*?edugnay-student-grades\.html[\s\S]*?display:\s*none !important/);
  assert.match(styles, /html\.student-nav-hide-journals[\s\S]*?edugnay-student-journal\.html[\s\S]*?display:\s*none !important/);
  assert.match(styles, /html\.student-nav-hide-electives \.sidebar a\[data-student-access="electives"\][\s\S]*?display:\s*none !important/);
  assert.match(studentShell, /let cachedStudentSidebarSnapshot = readStudentSidebarSnapshot\(\);/);
  assert.match(studentShell, /setStudentSidebarPrepaintState\(cachedStudentSidebarSnapshot\);/);
  assert.match(studentShell, /student-nav-hide-electives/);
  assert.match(studentShell, /electives: Boolean\(portalElectivesEligible && identity/);
  assert.doesNotMatch(studentShell, /getShsSelection\(\)/, 'the shared sidebar must not probe elective selection');
  assert.match(commonShell, /electivesEligible: Boolean\(response\?\.electivesEligible\)/);
  assert.doesNotMatch(studentShell, /student-electives-available/);
  assert.match(commonShell, /function clearStudentSidebarCache\(\)/);
  assert.match(commonShell, /confirmLogout\(\)[\s\S]*?clearStudentSidebarCache\(\)/);
  assert.match(commonShell, /if \(error\.status === 401\)[\s\S]*?clearStudentSidebarCache\(\)/);
  assert.match(loginPage, /edugnay_student_sidebar_v1:/);
});

test('student sidebar uses a cached snapshot only for pre-paint, then refreshes it from live access', async () => {
  const cachedSnapshot = {
    version: 1,
    role: 'student',
    schoolId: '10',
    studentId: '70',
    access: { grades: false, journals: true }
  };
  const harness = createStudentShellHarness({
    cachedSnapshot,
    gradesEnabled: true,
    journalsEnabled: false,
    deferPortal: true,
    pathname: '/views/student/edugnay-student-journal.html'
  });

  assert.equal(harness.rootClasses.has('student-nav-hide-grades'), true, 'cached grade visibility applies before page initialization');
  assert.equal(harness.rootClasses.has('student-nav-hide-journals'), true, 'Journal stays hidden until current eligibility is verified');
  assert.equal(harness.rootClasses.has('student-nav-hide-electives'), true, 'older snapshots without elective access hide the link until checked');
  harness.context.navigate('journal');
  assert.equal(harness.location.href, `http://localhost${harness.location.pathname}`, 'cached visibility does not grant Journal access');

  const initialization = harness.listeners.get('DOMContentLoaded')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.rootClasses.has('student-nav-hide-journals'), true, 'Journal stays hidden while fresh portal permissions are pending');
  harness.releasePortal({
    features: { gradesEnabled: true, journalsEnabled: false },
    journalSubjectId: 3,
    journalSubjectName: 'English',
    journalSubjectEligible: true,
    electivesEligible: true
  });
  await initialization;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.rootClasses.has('student-nav-hide-grades'), false, 'fresh grade access replaces the cached state');
  assert.equal(harness.rootClasses.has('student-nav-hide-journals'), true, 'fresh Journal denial removes the stale cached link');
  assert.equal(harness.rootClasses.has('student-nav-hide-electives'), false, 'portal features confirm elective access');
  assert.equal(harness.accessItems.grades.hidden, false);
  assert.equal(harness.accessItems.journals.hidden, true);
  assert.equal(harness.location.redirect, './edugnay-student-dashboard.html', 'fresh access still guards the Journal page');
  assert.deepEqual(harness.getCachedSnapshot().access, { grades: true, journals: false, electives: true });
});

test('student elective navigation refreshes from portal features and fails closed', async () => {
  const cachedSnapshot = {
    version: 1,
    role: 'student',
    schoolId: '10',
    studentId: '70',
    access: { grades: true, journals: true, electives: true }
  };
  const allowed = createStudentShellHarness({ cachedSnapshot, electivesEligible: true });
  assert.equal(allowed.rootClasses.has('student-nav-hide-electives'), false, 'cached elective access pre-paints the link');
  const initialization = allowed.listeners.get('DOMContentLoaded')();
  await new Promise(resolve => setImmediate(resolve));
  await initialization;
  assert.equal(allowed.rootClasses.has('student-nav-hide-electives'), false, 'eligible SHS students see My Electives');
  assert.equal(allowed.getCachedSnapshot().access.electives, true);
  assert.equal(allowed.electiveSelectionCalls, 0, 'the sidebar never requests elective selection data');

  const denied = createStudentShellHarness({ cachedSnapshot, electivesEligible: false });
  assert.equal(denied.rootClasses.has('student-nav-hide-electives'), false, 'the last verified state is used before refresh');
  const denialInitialization = denied.listeners.get('DOMContentLoaded')();
  await denialInitialization;
  assert.equal(denied.rootClasses.has('student-nav-hide-electives'), true, 'the link hides after portal features denies access');
  assert.equal(denied.getCachedSnapshot().access.electives, false);

  const failed = createStudentShellHarness({ cachedSnapshot, failures: { portal: true } });
  const failedInitialization = failed.listeners.get('DOMContentLoaded')();
  await failedInitialization;
  assert.equal(failed.rootClasses.has('student-nav-hide-electives'), true, 'a failed portal-features request hides the link');
  assert.equal(failed.getCachedSnapshot().access.electives, false);
  assert.equal(failed.electiveSelectionCalls, 0);

  for (const pathname of [
    '/views/student/edugnay-student-dashboard.html',
    '/views/student/edugnay-student-assignments.html'
  ]) {
    const jhs = createStudentShellHarness({ pathname, electivesEligible: false });
    await jhs.listeners.get('DOMContentLoaded')();
    assert.equal(jhs.rootClasses.has('student-nav-hide-electives'), true, `${pathname} keeps My Electives hidden for JHS`);
    assert.equal(jhs.electiveSelectionCalls, 0, `${pathname} makes no elective-selection request`);
  }
});

test('student sidebar cache is discarded on account changes and session expiry', async () => {
  const cachedSnapshot = {
    version: 1,
    role: 'student',
    schoolId: '10',
    studentId: '70',
    access: { grades: true, journals: true, electives: true }
  };
  const switchHarness = createStudentShellHarness({
    cachedSnapshot,
    session: { apiSchoolId: '10', apiUserId: '71', role: 'student', schoolLevel: 'jhs' },
    gradesEnabled: false,
    journalsEnabled: false
  });
  const switchInitialization = switchHarness.listeners.get('DOMContentLoaded')();
  await switchInitialization;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(switchHarness.storage.has(`${studentNavPrefix}10:70`), false, 'old student snapshot is removed after identity mismatch');
  assert.equal(switchHarness.getCachedSnapshot().studentId, '71');
  assert.equal(switchHarness.rootClasses.has('student-nav-hide-grades'), true);
  assert.equal(switchHarness.rootClasses.has('student-nav-hide-journals'), true);
  assert.equal(switchHarness.rootClasses.has('student-nav-hide-electives'), true, 'the new student link stays hidden without their own eligibility');
  assert.equal(switchHarness.getCachedSnapshot().access.electives, false);

  const expiredHarness = createStudentShellHarness({ cachedSnapshot, failures: { session: true, sessionStatus: 401 } });
  const expiredInitialization = expiredHarness.listeners.get('DOMContentLoaded')();
  await expiredInitialization;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(expiredHarness.rootClasses.has('student-nav-hide-grades'), true, 'expired sessions fail closed before showing cached links');
  assert.equal(expiredHarness.rootClasses.has('student-nav-hide-journals'), true);
  assert.equal(expiredHarness.rootClasses.has('student-nav-hide-electives'), true);
  assert.equal([...expiredHarness.storage.keys()].some(key => key.startsWith(studentNavPrefix)), false, 'session expiry clears the student sidebar cache');
});

test('parent feature links use shared prepaint classes on every portal page', () => {
  const pages = fs.readdirSync(parentViews).filter(filename => filename.endsWith('.html'));
  const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  const parentShell = fs.readFileSync(path.join(root, 'assets/js/parent/shell.js'), 'utf8');
  const commonShell = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const loginPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(pages.length > 0);
  for (const filename of pages) {
    const html = fs.readFileSync(path.join(parentViews, filename), 'utf8');
    assert.match(html, /assets\/js\/parent\/shell\.js/, `${filename} loads the parent shell`);
  }
  assert.match(styles, /html\.parent-nav-hide-grades .*edugnay-parent-grades\.html[\s\S]*?display:\s*none !important/);
  assert.match(styles, /html\.parent-nav-hide-reports .*edugnay-parent-reports\.html[\s\S]*?display:\s*none !important/);
  assert.match(parentShell, /let cachedParentSidebarSnapshot = readParentSidebarSnapshot\(\);\s*setParentSidebarPrepaintState\(cachedParentSidebarSnapshot\);/);
  assert.match(commonShell, /function clearParentSidebarCache\(\)/);
  assert.match(commonShell, /confirmLogout\(\)[\s\S]*?clearParentSidebarCache\(\)/);
  assert.match(commonShell, /if \(error\.status === 401\)[\s\S]*?clearParentSidebarCache\(\)/);
  assert.match(loginPage, /edugnay_parent_sidebar_v1:/);
  assert.match(commonShell, /if \(pageName\.startsWith\('edugnay-parent-'\)\) return;/);
});

test('parent sidebar starts hidden on first visit and refreshes cached access without a flash', async () => {
  const cold = createParentShellHarness({ gradesEnabled: false, reportsEnabled: true });
  assert.equal(cold.rootClasses.has('parent-nav-hide-grades'), true);
  assert.equal(cold.rootClasses.has('parent-nav-hide-reports'), true);
  const coldInit = cold.listeners.get('DOMContentLoaded')();
  cold.resolveSchoolReady();
  await coldInit;
  assert.equal(cold.rootClasses.has('parent-nav-hide-grades'), true);
  assert.equal(cold.rootClasses.has('parent-nav-hide-reports'), false);
  assert.deepEqual(cold.getCachedSnapshot().access, { grades: false, reports: true });

  const cached = createParentShellHarness({
    cachedSnapshot: cold.getCachedSnapshot(), gradesEnabled: true, reportsEnabled: false,
    pathname: '/views/parent/edugnay-parent-reports.html'
  });
  assert.equal(cached.rootClasses.has('parent-nav-hide-grades'), true);
  assert.equal(cached.rootClasses.has('parent-nav-hide-reports'), false);
  const init = cached.listeners.get('DOMContentLoaded')();
  assert.equal(cached.rootClasses.has('parent-nav-hide-reports'), false, 'cached menu holds during the request');
  cached.resolveSchoolReady();
  await init;
  assert.equal(cached.rootClasses.has('parent-nav-hide-grades'), false);
  assert.equal(cached.rootClasses.has('parent-nav-hide-reports'), true);
  assert.equal(cached.location.redirect, './edugnay-parent-dashboard.html');
  assert.deepEqual(cached.getCachedSnapshot().access, { grades: true, reports: false });

  const gradesPage = createParentShellHarness({
    gradesEnabled: false, pathname: '/views/parent/edugnay-parent-grades.html'
  });
  const gradesInit = gradesPage.listeners.get('DOMContentLoaded')();
  gradesPage.resolveSchoolReady();
  await gradesInit;
  assert.equal(gradesPage.location.redirect, './edugnay-parent-dashboard.html');
});

test('parent sidebar isolates accounts and keeps verified access through a temporary failure', async () => {
  const snapshot = { version: 1, role: 'parent', schoolId: '10', parentId: '80',
    access: { grades: true, reports: false } };
  const switched = createParentShellHarness({
    cachedSnapshot: snapshot, session: { apiSchoolId: '10', apiUserId: '81', role: 'parent' },
    gradesEnabled: false, reportsEnabled: true
  });
  switched.listeners.get('edugnay:current-user-updated')({ detail: { apiSchoolId: '10', apiUserId: '81', role: 'parent' } });
  assert.equal(switched.rootClasses.has('parent-nav-hide-grades'), true);
  assert.equal(switched.rootClasses.has('parent-nav-hide-reports'), true);
  assert.equal(switched.storage.has(`${parentNavPrefix}10:80`), false);
  const switchedInit = switched.listeners.get('DOMContentLoaded')();
  switched.resolveSchoolReady();
  await switchedInit;
  assert.equal(switched.getCachedSnapshot().parentId, '81');
  assert.equal(switched.rootClasses.has('parent-nav-hide-reports'), false);

  const otherSchool = createParentShellHarness({
    cachedSnapshot: snapshot, session: { apiSchoolId: '11', apiUserId: '80', role: 'parent' }
  });
  otherSchool.listeners.get('edugnay:current-user-updated')({
    detail: { apiSchoolId: '11', apiUserId: '80', role: 'parent' }
  });
  assert.equal(otherSchool.rootClasses.has('parent-nav-hide-grades'), true);
  const otherSchoolInit = otherSchool.listeners.get('DOMContentLoaded')();
  otherSchool.resolveSchoolReady();
  await otherSchoolInit;
  assert.equal(otherSchool.getCachedSnapshot().schoolId, '11');
  assert.equal(otherSchool.storage.has(`${parentNavPrefix}10:80`), false);

  const outage = createParentShellHarness({ cachedSnapshot: snapshot, schoolFailure: true });
  const outageInit = outage.listeners.get('DOMContentLoaded')();
  outage.resolveSchoolReady();
  await outageInit;
  assert.equal(outage.rootClasses.has('parent-nav-hide-grades'), false);
  assert.equal(outage.rootClasses.has('parent-nav-hide-reports'), true);
  assert.deepEqual(outage.getCachedSnapshot().access, snapshot.access);

  const accountOutage = createParentShellHarness({ cachedSnapshot: snapshot, sessionFailure: 500 });
  const accountOutageInit = accountOutage.listeners.get('DOMContentLoaded')();
  accountOutage.resolveSchoolReady();
  await accountOutageInit;
  assert.equal(accountOutage.rootClasses.has('parent-nav-hide-grades'), false);
  assert.deepEqual(accountOutage.getCachedSnapshot().access, snapshot.access);

  const expired = createParentShellHarness({ cachedSnapshot: snapshot, sessionFailure: 401 });
  const expiredInit = expired.listeners.get('DOMContentLoaded')();
  expired.resolveSchoolReady();
  await expiredInit;
  assert.equal(expired.rootClasses.has('parent-nav-hide-grades'), true);
  assert.equal(expired.rootClasses.has('parent-nav-hide-reports'), true);
  assert.equal(expired.getCachedSnapshot(), null);
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
  assert.equal(harness.sectionsNav.children[0].textContent, 'No classes assigned');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports'), true, 'the adviser-only Reports link remains hidden');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-journals'), true, 'the Journal link remains hidden without an assignment');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-sf-templates'), false, 'school-enabled SF Templates becomes visible after context loads');
  assert.equal(harness.rootClasses.has('teacher-nav-hide-reports-group'), false, 'the group appears without reserving space while unverified');
});

test('My Classes sidebar includes SHS assignments and keeps their saved links stable', async () => {
  const shsClass = { electiveClassId: '77', gradeName: 'Grade 12', className: 'Immersion A', subjectName: 'Work Immersion' };
  const harness = createTeacherShellHarness({
    teachingSections: [], shsClasses: [shsClass],
    pathname: '/views/teacher/edugnay-teacher-sections.html', search: '?classId=77'
  });
  const initialization = harness.listeners.get('DOMContentLoaded')();
  harness.resolveSchoolReady();
  await initialization;
  assert.equal(harness.sectionsNav.children.length, 1);
  assert.equal(harness.sectionsNav.children[0].className, 'nav-child active');
  assert.match(harness.sectionsNav.children[0].href, /edugnay-teacher-sections\.html\?classId=77$/);
  assert.equal(harness.sectionsNav.children[0].children[0].className, 'teacher-section-nav-dot');
  assert.equal(harness.sectionsNav.children[0].children[1].textContent, 'Grade 12 · Immersion A');

  const saved = JSON.parse(harness.storage.get(`${teacherNavPrefix}10:50`));
  assert.equal(saved.shsClasses.length, 1);
  assert.equal(Object.hasOwn(saved.shsClasses[0], 'subject'), false, 'new snapshots keep only fields needed for navigation');
  const refresh = createTeacherShellHarness({ cachedSnapshot: saved, shsClasses: [shsClass] });
  const refreshInitialization = refresh.listeners.get('DOMContentLoaded')();
  assert.equal(refresh.sectionsNav.children.length, 1, 'saved class appears before the fresh request');
  refresh.resolveSchoolReady();
  await refreshInitialization;
  assert.equal(refresh.sectionsNav.children.length, 1);

  const outage = createTeacherShellHarness({ cachedSnapshot: saved, failures: { shsClasses: 500 } });
  outage.context.restoreTeacherClassesNavigation();
  const retainedLink = outage.sectionsNav.children[0];
  const outageInitialization = outage.listeners.get('DOMContentLoaded')();
  outage.resolveSchoolReady();
  await outageInitialization;
  assert.equal(outage.sectionsNav.children[0], retainedLink, 'temporary API failure keeps the saved class link in place');

  const denied = createTeacherShellHarness({ cachedSnapshot: saved, failures: { shsClasses: 404 } });
  const deniedInitialization = denied.listeners.get('DOMContentLoaded')();
  denied.resolveSchoolReady();
  await deniedInitialization;
  assert.equal(denied.sectionsNav.children[0].textContent, 'No classes assigned');
  assert.deepEqual(JSON.parse(denied.storage.get(`${teacherNavPrefix}10:50`)).shsClasses, []);
});

test('My Classes restores short labels and the open state before page initialization', async () => {
  const saved = {
    version: 1, schoolId: '10', teacherId: '50',
    access: { reports: false, journals: false, sfTemplates: true },
    sections: [{ id: '8', grade: 'Grade 8', name: 'St. Peter', subjects: ['English', 'Mathematics', 'Science'] }],
    shsClasses: [{ id: '77', grade: 'Grade 12', name: 'Immersion A', subject: 'Work Immersion' }],
    classesExpanded: true
  };
  const harness = createTeacherShellHarness({
    cachedSnapshot: saved,
    teachingSections: [{ id: '8', gradeLevelName: 'Grade 8', name: 'St. Peter',
      subjectAssignments: [{ subjectName: 'English' }, { subjectName: 'Mathematics' }, { subjectName: 'Science' }] }],
    shsClasses: [{ electiveClassId: '77', gradeName: 'Grade 12', className: 'Immersion A', subjectName: 'Work Immersion' }]
  });
  harness.context.restoreTeacherClassesNavigation();
  assert.equal(harness.sectionGroup.classList.contains('open'), true);
  assert.equal(harness.sectionToggle.attributes['aria-expanded'], 'true');
  assert.equal(harness.sectionToggle.attributes.tabindex, '0');
  assert.equal(harness.sectionsNav.children[0].children[1].textContent, 'Grade 8 · St. Peter');
  assert.equal(harness.sectionsNav.children[1].children[0].className, 'teacher-section-nav-dot');
  assert.equal(harness.sectionsNav.children[1].children[1].textContent, 'Grade 12 · Immersion A', 'older cached subject names are ignored in the sidebar');
  const firstLink = harness.sectionsNav.children[0];
  const initialRenderCount = harness.sectionsNav.renderCount;
  const initialization = harness.listeners.get('DOMContentLoaded')();
  assert.equal(harness.sectionsNav.children[0], firstLink, 'DOMContentLoaded does not rebuild saved links');
  harness.resolveSchoolReady();
  await initialization;
  assert.equal(harness.sectionsNav.renderCount, initialRenderCount, 'unchanged API assignments do not rebuild links');
  assert.equal(harness.sectionGroup.classList.contains('open'), true);

  let prevented = false;
  harness.sectionToggle.listeners.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(harness.sectionGroup.classList.contains('open'), false);
  assert.equal(harness.sectionToggle.attributes['aria-expanded'], 'false');
  const nextPage = createTeacherShellHarness({ cachedSnapshot: JSON.parse(harness.storage.get(`${teacherNavPrefix}10:50`)),
    pathname: '/views/teacher/edugnay-teacher-sections.html' });
  nextPage.context.restoreTeacherClassesNavigation();
  assert.equal(nextPage.sectionGroup.classList.contains('open'), false, 'a saved collapsed state overrides the page default');
  assert.equal(nextPage.sectionsNav.children.length, 2);
});

test('older My Classes snapshots use page defaults and every teacher sidebar restores beside its markup', () => {
  const oldSnapshot = {
    version: 1, schoolId: '10', teacherId: '50',
    access: { reports: false, journals: false, sfTemplates: false },
    sections: [{ id: '8', grade: 'Grade 8', name: 'St. Peter' }]
  };
  const onClassesPage = createTeacherShellHarness({ cachedSnapshot: oldSnapshot,
    pathname: '/views/teacher/edugnay-teacher-sections.html' });
  onClassesPage.context.restoreTeacherClassesNavigation();
  assert.equal(onClassesPage.sectionGroup.classList.contains('open'), true);
  const onDashboard = createTeacherShellHarness({ cachedSnapshot: oldSnapshot });
  onDashboard.context.restoreTeacherClassesNavigation();
  assert.equal(onDashboard.sectionGroup.classList.contains('open'), false);
  for (const filename of fs.readdirSync(teacherViews).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(teacherViews, filename), 'utf8');
    if (!html.includes('data-teacher-sections-nav')) continue;
    const navIndex = html.indexOf('data-teacher-sections-nav');
    assert.ok(html.slice(navIndex, navIndex + 320).includes('restoreTeacherClassesNavigation();'), `${filename} restores its nav while parsing`);
  }
});

test('teacher sidebar cache is isolated by tenant and teacher, and survives refresh failures safely', async () => {
  const wrongSchoolSnapshot = {
    version: 1,
    schoolId: '99',
    teacherId: '50',
    access: { reports: true, journals: true, sfTemplates: true },
    sections: [{ id: '999', grade: 'Grade 9', name: 'Wrong School' }],
    classesExpanded: true
  };
  const tenantHarness = createTeacherShellHarness({
    cachedSnapshot: wrongSchoolSnapshot,
    teachingSections: [{ id: '101', gradeLevelName: 'Grade 4', name: 'New School', status: 'active', academicYearStatus: 'active' }]
  });
  tenantHarness.context.restoreTeacherClassesNavigation();
  assert.equal(tenantHarness.sectionGroup.classList.contains('open'), true);
  const tenantInitialization = tenantHarness.listeners.get('DOMContentLoaded')();
  assert.equal(tenantHarness.sectionsNav.children[0].children[1].textContent, 'Grade 9 · Wrong School', 'the last menu is shown while the current identity is checked');
  tenantHarness.resolveSchoolReady();
  await tenantInitialization;
  assert.equal(tenantHarness.sectionsNav.children.length, 1);
  assert.equal(tenantHarness.sectionsNav.children[0].children[1].textContent, 'Grade 4 · New School');
  assert.equal(tenantHarness.sectionGroup.classList.contains('open'), false, 'new identity uses the page default');

  const sameSchoolSnapshot = { ...wrongSchoolSnapshot, schoolId: '10' };
  const switchHarness = createTeacherShellHarness({
    cachedSnapshot: sameSchoolSnapshot,
    session: { apiSchoolId: '10', apiUserId: '51', role: 'teacher' },
    teachingSections: [{ id: '102', gradeLevelName: 'Grade 5', name: 'New Teacher', status: 'active', academicYearStatus: 'active' }]
  });
  const switchInitialization = switchHarness.listeners.get('DOMContentLoaded')();
  assert.equal(switchHarness.sectionsNav.children[0].children[1].textContent, 'Grade 9 · Wrong School');
  switchHarness.resolveSchoolReady();
  await switchInitialization;
  assert.equal(switchHarness.sectionsNav.children[0].children[1].textContent, 'Grade 5 · New Teacher');
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
