const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const script = pageFs.readFileSync(path.join(root, 'assets/js/theme.js'), 'utf8');
const read = file => pageFs.readFileSync(path.join(root, file), 'utf8');

function createControl() {
  const events = {};
  const trigger = {
    attributes: {}, innerHTML: '',
    addEventListener(name, handler) { events[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const control = {
    querySelector(selector) { return selector === '[data-theme-trigger]' ? trigger : null; }
  };
  return { control, trigger, events };
}

function boot(saved, supportsSystem = true, controls = [], options = {}) {
  const listeners = {};
  const storage = new Map(saved === undefined ? [] : [['edugnay_theme_v1', saved]]);
  const session = new Map();
  if (options.profileSnapshot) session.set('edugnay_profile_display_v1', JSON.stringify(options.profileSnapshot));
  if (options.schoolAccent) session.set('edugnay_school_accent_v1', JSON.stringify(options.schoolAccent));
  const rootClasses = new Set();
  let nextTimerId = 0;
  const media = { matches: false, addEventListener(name, handler) { listeners.media = handler; } };
  const root = {
    dataset: {},
    classList: {
      add(value) { rootClasses.add(value); },
      remove(value) { rootClasses.delete(value); },
      contains(value) { return rootClasses.has(value); }
    }
  };
  const document = {
    documentElement: root,
    querySelectorAll(selector) { return selector === '[data-theme-control]' ? controls.map(item => item.control) : []; },
    addEventListener(name, handler) { listeners[name] = handler; },
    dispatchEvent(event) { listeners[event.type]?.(event); }
  };
  const iconRenders = [];
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: key => session.delete(key)
    },
    location: { pathname: options.pathname || '/' },
    setTimeout(callback) { nextTimerId += 1; listeners[`timer-${nextTimerId}`] = callback; return nextTimerId; },
    clearTimeout(id) { delete listeners[`timer-${id}`]; },
    EDUGNAY_SCHOOL_READY: options.schoolReady,
    matchMedia: supportsSystem ? () => media : undefined,
    lucide: { createIcons(options) { iconRenders.push(options.root); } },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  vm.runInNewContext(script, { window, document, Set, Event: class { constructor(type) { this.type = type; } } });
  return { window, document, media, listeners, storage, session, rootClasses, iconRenders };
}

test('theme is applied before DOM readiness and invalid preferences stay Light', () => {
  for (const saved of [undefined, 'invalid']) {
    const { document } = boot(saved);
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(document.documentElement.dataset.themeMode, 'light');
  }
  assert.equal(boot('dark').document.documentElement.dataset.theme, 'dark');
});

test('System follows device changes, tabs stay in sync, and icons show the next mode', () => {
  const control = createControl();
  const state = boot('system', true, [control]);
  state.listeners.DOMContentLoaded();
  state.media.matches = true;
  state.listeners.media();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.equal(control.trigger.attributes.title, 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  state.window.ACADEMIX_THEME.setMode('light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'light');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.match(control.trigger.innerHTML, /data-lucide="moon"/);
  state.listeners.storage({ key: 'edugnay_theme_v1', newValue: 'system' });
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  state.listeners.storage({ key: 'edugnay_theme_v1', newValue: 'invalid' });
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.ok(state.iconRenders.every(icon => icon === control.trigger));
  const noMedia = boot('system', false);
  assert.equal(noMedia.document.documentElement.dataset.theme, 'light');
});

test('toggle switches immediately and makes legacy System preference explicit', () => {
  const control = createControl();
  const state = boot(undefined, true, [control]);
  state.listeners.DOMContentLoaded();
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.equal(control.trigger.attributes.title, 'Switch to dark mode');
  assert.match(control.trigger.innerHTML, /data-lucide="moon"/);
  control.events.click();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  control.events.click();
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'light');

  const systemControl = createControl();
  const systemState = boot('system', true, [systemControl]);
  systemState.listeners.DOMContentLoaded();
  systemState.media.matches = true;
  systemState.listeners.media();
  assert.equal(systemState.document.documentElement.dataset.theme, 'dark');
  systemControl.events.click();
  assert.equal(systemState.document.documentElement.dataset.theme, 'light');
  assert.equal(systemState.storage.get('edugnay_theme_v1'), 'light');
  assert.equal(systemState.window.ACADEMIX_THEME.getMode(), 'light');
});

test('printing uses Light without changing the saved choice', () => {
  const state = boot('dark');
  state.listeners.beforeprint();
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'dark');
  state.listeners.afterprint();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
});

test('school accent palette follows school context without changing personal theme preference', () => {
  const state = boot('dark', true, [], {
    pathname: '/views/admin/edugnay-admin-dashboard.html',
    profileSnapshot: { version: 1, role: 'school_admin', userId: '7', schoolId: '12' }
  });
  assert.equal(state.rootClasses.has('school-accent-pending'), true);
  state.listeners['edugnay:school-context-updated']({ detail: { id: 12, accentPalette: 'deep-teal' } });
  assert.equal(state.document.documentElement.dataset.schoolAccent, 'deep-teal');
  assert.equal(state.rootClasses.has('school-accent-pending'), false);
  assert.deepEqual(JSON.parse(state.session.get('edugnay_school_accent_v1')), {
    version: 1, schoolId: '12', palette: 'deep-teal'
  });
  state.window.ACADEMIX_THEME.setSchoolAccent('plum');
  assert.equal(state.document.documentElement.dataset.schoolAccent, 'plum');
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'dark');
  state.window.ACADEMIX_THEME.setSchoolAccent('not-a-palette');
  assert.equal(state.document.documentElement.dataset.schoolAccent, 'default-blue');
  state.window.ACADEMIX_THEME.setSchoolAccent(null);
  assert.equal(state.document.documentElement.dataset.schoolAccent, undefined);
});

test('school accent is applied before paint only for the cached school and page role', () => {
  const profileSnapshot = { version: 1, role: 'teacher', userId: '8', schoolId: '12' };
  const schoolAccent = { version: 1, schoolId: '12', palette: 'burgundy' };
  const matching = boot(undefined, true, [], {
    pathname: '/views/teacher/edugnay-teacher-dashboard.html', profileSnapshot, schoolAccent
  });
  assert.equal(matching.document.documentElement.dataset.schoolAccent, 'burgundy');
  assert.equal(matching.rootClasses.has('school-accent-pending'), false);

  for (const mismatched of [
    { pathname: '/views/teacher/edugnay-teacher-dashboard.html', profileSnapshot, schoolAccent: { ...schoolAccent, schoolId: '13' } },
    { pathname: '/views/student/edugnay-student-dashboard.html', profileSnapshot, schoolAccent }
  ]) {
    const state = boot(undefined, true, [], mismatched);
    assert.equal(state.document.documentElement.dataset.schoolAccent, undefined);
    assert.equal(state.rootClasses.has('school-accent-pending'), true);
  }
});

test('school context refresh replaces the cached accent for that school', () => {
  const state = boot(undefined, true, [], {
    pathname: '/views/admin/edugnay-admin-dashboard.html',
    profileSnapshot: { version: 1, role: 'school_admin', userId: '7', schoolId: '12' },
    schoolAccent: { version: 1, schoolId: '12', palette: 'default-blue' }
  });
  assert.equal(state.document.documentElement.dataset.schoolAccent, 'default-blue');
  state.listeners['edugnay:school-context-updated']({ detail: { id: 12, accentPalette: 'plum' } });
  assert.equal(state.document.documentElement.dataset.schoolAccent, 'plum');
  assert.deepEqual(JSON.parse(state.session.get('edugnay_school_accent_v1')), {
    version: 1, schoolId: '12', palette: 'plum'
  });
});

test('public and platform pages ignore school context and do not hide their shell', () => {
  for (const pathname of ['/', '/views/platform/edugnay-platform-dashboard.html']) {
    const state = boot(undefined, true, [], { pathname });
    state.listeners['edugnay:school-context-updated']({ detail: { id: 12, accentPalette: 'plum' } });
    assert.equal(state.document.documentElement.dataset.schoolAccent, undefined);
    assert.equal(state.rootClasses.has('school-accent-pending'), false);
  }
});

test('an unavailable school context releases the hidden shell on page failure or timeout', () => {
  const options = {
    pathname: '/views/student/edugnay-student-dashboard.html',
    profileSnapshot: { version: 1, role: 'student', userId: '9', schoolId: '12' }
  };
  const failed = boot(undefined, true, [], options);
  failed.listeners['edugnay:page-loading-failed']();
  assert.equal(failed.rootClasses.has('school-accent-pending'), false);

  const timedOut = boot(undefined, true, [], options);
  timedOut.listeners['timer-1']();
  assert.equal(timedOut.rootClasses.has('school-accent-pending'), false);
});

test('school settings offers all approved accents and previews a real action, link, and selected item', () => {
  const settings = read('assets/js/admin/schools.js');
  const theme = read('assets/css/theme.css');
  const pageLoading = read('assets/js/page-loading.js');
  for (const palette of ['default-blue', 'deep-teal', 'forest-green', 'plum', 'burgundy']) {
    assert.match(settings, new RegExp(`value: '${palette}'`));
    assert.match(theme, new RegExp(`data-school-accent="${palette}"`));
  }
  assert.match(settings, /name="accentPalette"/);
  assert.match(settings, /class="top-btn primary" type="button">Primary button/);
  assert.match(settings, /class="school-accent-preview-link"/);
  assert.match(settings, /class="nav-item active" href="#schoolAccentPreview" aria-current="page"/);
  assert.match(settings, /class="school-accent-reset" type="button">Restore default/);
  assert.match(settings, /defaultPalette\.dispatchEvent\(new Event\('change'/);
  assert.match(settings, /settings\.accentPalette = values\.accentPalette \|\| 'default-blue'/);
  assert.match(theme, /\.timetable-button:not\(\.secondary\)/);
  assert.match(theme, /\.assignment-submit-action/);
  assert.match(theme, /outline: 2px solid var\(--theme-accent-text\)/);
  assert.match(theme, /html\.school-accent-pending body :is\(\.sidebar/);
  assert.match(pageLoading, /school-accent-pending/);
  assert.match(pageLoading, /edugnay:school-accent-ready/);
  assert.match(pageLoading, /readyRequested/);
  assert.match(pageLoading, /edugnay:page-loading-failed/);
});

test('school accent outlines links and custom focus targets without doubling native control rings', () => {
  const theme = read('assets/css/theme.css');
  const styles = read('assets/css/styles.css');

  assert.match(theme, /html\[data-school-accent\] body :is\(a, \[tabindex\]\):focus-visible:not\(button\):not\(input\):not\(select\):not\(textarea\)\s*\{[^}]*outline: 2px solid var\(--theme-accent-text\);[^}]*outline-offset: 2px;/s);
  assert.match(styles, /button:focus-visible,[\s\S]*?\[role="button"\]:focus-visible \{\s*outline: none;\s*box-shadow: 0 0 0 3px var\(--button-focus-ring\);/);
  assert.match(styles, /\.form-input:focus\s*\{[^}]*border-color: var\(--theme-accent-text\);[^}]*box-shadow: 0 0 0 3px var\(--button-focus-ring\);/s);
  assert.match(styles, /select:not\(\[multiple\]\):focus\s*\{[^}]*border-color: var\(--theme-accent-text\) !important;[^}]*box-shadow: 0 0 0 3px var\(--button-focus-ring\);/s);
});

test('school accent keeps the Narrative Reports pipeline on its solid page surface', () => {
  const theme = read('assets/css/theme.css');
  const reportsStyles = read('assets/css/adviser/narrative-reports.css');
  const gradientRule = theme.match(/html\[data-school-accent\] body \.grading-banner\s*\{([^}]*)\}/);
  const pipelineSurfaceRule = [...reportsStyles.matchAll(/\.pipeline-banner\s*\{([^}]*)\}/g)]
    .map(match => match[1])
    .filter(rule => /background:\s*var\(--surface-blue\)/.test(rule))
    .at(-1);

  assert.ok(gradientRule);
  assert.match(gradientRule[1], /background:\s*linear-gradient/);
  assert.doesNotMatch(gradientRule[1], /\.pipeline-banner|\.profile-header-card/);
  assert.ok(pipelineSurfaceRule);
});

test('school accent gives the Teacher Classes section header a solid palette shade', () => {
  const theme = read('assets/css/theme.css');
  const gradientRule = theme.match(/html\[data-school-accent\] body \.grading-banner\s*\{([^}]*)\}/);

  assert.ok(gradientRule);
  assert.match(gradientRule[1], /background:\s*linear-gradient/);
  assert.doesNotMatch(gradientRule[1], /\.section-header|\.profile-header-card/);
  assert.match(theme, /html\[data-school-accent\] body \.section-header \{ background: var\(--school-accent-sidebar\); \}/);
});

test('school accent keeps shared profile header cards on a solid palette shade', () => {
  const theme = read('assets/css/theme.css');
  const gradientRule = theme.match(/html\[data-school-accent\] body \.grading-banner\s*\{\s*background: linear-gradient/);

  assert.ok(gradientRule);
  assert.doesNotMatch(gradientRule[0], /profile-header-card/);
  assert.match(theme, /html\[data-school-accent\] body \.profile-header-card \{ background: var\(--school-accent-sidebar\); \}/);
});

test('school portal overview banners use a solid palette shade', () => {
  const theme = read('assets/css/theme.css');
  const sharedGradientRule = theme.match(/html\[data-school-accent\] body \.grading-banner\s*\{([^}]*)\}/);

  assert.ok(sharedGradientRule);
  assert.match(sharedGradientRule[1], /background:\s*linear-gradient/);
  assert.doesNotMatch(sharedGradientRule[1], /\.portal-overview|\.profile-header-card/);
  assert.match(theme, /html\[data-school-accent\] body \.portal-overview \{ background: var\(--school-accent-sidebar\); \}/);
});

test('school accent keeps the Journal Settings header on the neutral surface', () => {
  const theme = read('assets/css/theme.css');
  const journals = read('assets/css/teacher/journals.css');
  const pendingRule = theme.match(/html\.school-accent-pending body :is\(([^)]*)\)/);
  const neutralHeaderRule = [...journals.matchAll(/\.settings-drawer-head\s*\{([^}]*)\}/g)]
    .map(match => match[1])
    .find(rule => /background:\s*var\(--theme-surface\)/.test(rule));

  assert.doesNotMatch(theme, /html\[data-school-accent\] body \.settings-drawer-head\s*\{[^}]*background:/);
  assert.ok(neutralHeaderRule);
  assert.match(neutralHeaderRule, /border-bottom:\s*1px solid var\(--gray-200\);/);
  assert.ok(pendingRule);
  assert.match(pendingRule[1], /.settings-drawer-head/);
});

test('every page has one static toggle and pre-paint theme loading', () => {
  const pages = ['index.html'];
  for (const role of fs.readdirSync(path.join(root, 'views'))) {
    const dir = path.join(root, 'views', role);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.html')) pages.push(`views/${role}/${name}`);
  }
  assert.equal(pages.length, 50);
  for (const page of pages) {
    const html = read(page);
    assert.equal((html.match(/data-theme-control/g) || []).length, 1, page);
    const button = html.match(/<button class="tb-theme-trigger"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button, page);
    assert.match(button, /aria-label="Switch to dark mode"/, page);
    assert.match(button, /title="Switch to dark mode"/, page);
    assert.match(button, /data-lucide="moon"/, page);
    assert.doesNotMatch(html, /tb-theme-menu|data-theme-menu|tb-theme-choice|academix-theme-menu|data-lucide="palette"/, page);
    assert.ok(html.indexOf('assets/js/theme.js') < html.indexOf('assets/css/styles.css'), page);
    assert.ok(html.indexOf('assets/css/theme.css') > html.indexOf('assets/css/styles.css'), page);
    if (!page.includes('onboarding') && page !== 'index.html') {
      assert.ok(html.indexOf('data-theme-control') < html.indexOf('class="tb-profile"'), page);
    }
  }
});

test('theme tokens preserve the previous light colors and keep exports separate', () => {
  const css = read('assets/css/styles.css');
  assert.match(css, /--theme-surface: #ffffff;/);
  assert.match(css, /--theme-text: #0b1f3a;/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(read('assets/js/timetable-export.js'), /ACADEMIX_THEME|data-theme/);
  assert.doesNotMatch(read('assets/css/theme.css'), /html::?-webkit-scrollbar|body::?-webkit-scrollbar/);
});

test('theme toggle stays borderless and keeps keyboard focus visible', () => {
  const css = read('assets/css/theme.css');
  assert.doesNotMatch(css, /tb-theme-menu|tb-theme-choice/);
  assert.match(css, /\.tb-theme-trigger\s*\{[^}]*border: 0;[^}]*background: transparent;/);
  assert.match(css, /\.tb-theme-trigger:hover\s*\{[^}]*background: transparent; color: var\(--theme-accent-text\)/);
  assert.match(css, /\.tb-theme-trigger:focus-visible\s*\{[^}]*outline: 2px solid var\(--theme-accent-text\)/);
  assert.match(css, /\.topbar \.tb-theme-trigger svg\s*\{ width: 20px; height: 20px; stroke-width: 1\.9; \}/);
  assert.match(css, /\.login-panel > \.tb-theme \.tb-theme-trigger\s*\{ width: 34px; height: 34px; \}/);
  assert.match(css, /\.onboarding-topbar-actions \.tb-theme-trigger\s*\{ width: 34px; height: 34px; \}/);
  assert.doesNotMatch(css, /\.tb-theme-trigger\[aria-expanded/);
});

test('assignment list headings have no fill on student or parent pages', () => {
  const css = read('assets/css/student/assignments.css');
  const header = css.match(/\.assignment-list-head\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(header, /background/);
  assert.match(header, /border-bottom: 1px solid var\(--gray-100\)/);
  for (const role of ['student', 'parent']) {
    const html = read(`views/${role}/edugnay-${role}-assignments.html`);
    assert.match(html, /class="assignment-list-head"/);
    assert.match(html, /assets\/css\/student\/assignments\.css/);
  }
});

test('shared scroll fades follow the theme and remain overflow-dependent', () => {
  const css = read('assets/css/styles.css');
  const theme = read('assets/css/theme.css');
  const script = read('assets/js/shell-common.js');
  assert.match(css, /--scroll-fade-canvas-rgb: 241, 245, 249/);
  assert.match(css, /--scroll-fade-surface-rgb: 255, 255, 255/);
  assert.match(css, /--scroll-fade-canvas-rgb: 11, 25, 45/);
  assert.match(css, /--scroll-fade-surface-rgb: 19, 38, 65/);
  assert.match(css, /rgba\(var\(--scroll-fade-canvas-rgb\), 0\.92\)/);
  assert.match(css, /rgba\(var\(--scroll-fade-surface-rgb\), 0\.94\)/);
  assert.match(css, /\.scroll-fade-wrap\.has-more-right::after\s*\{\s*opacity: 1/);
  assert.match(script, /element\.scrollWidth - element\.clientWidth - element\.scrollLeft > 4/);
  assert.match(theme, /html\s*\{ color-scheme: dark; \}/);
  assert.match(theme, /html\[data-theme="light"\] :is\(input, select, textarea, button\)\s*\{ color-scheme: light; \}/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(input, select, textarea, button\)\s*\{ color-scheme: dark; \}/);
  assert.match(theme, /@media print\s*\{\s*html\s*\{ color-scheme: light; \}/);
  assert.doesNotMatch(theme, /(?:html|body)(?:::?-webkit-scrollbar|\s*\{[^}]*scrollbar-(?:color|width))/);
});

test('dark summary cards share the panel surface and blue icons while light tints remain', () => {
  const theme = read('assets/css/theme.css');
  const shared = read('assets/css/styles.css');
  const users = read('assets/css/admin/users.css');
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card, \.rs-card\)\s*\{\s*background: var\(--panel-bg\);\s*border-color: var\(--panel-border\);/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card \.stat-card-icon, \.rs-card \.rs-icon\)\s*\{\s*background: var\(--blue-xpale\);\s*color: var\(--theme-accent-text\);/);
  assert.doesNotMatch(theme, /html\[data-theme="dark"\] :is\(\.stat-card\.(?:blue|green|gold|purple|orange|red|gray),/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card:hover, \.rs-card:hover\)\s*\{\s*border-color: var\(--blue-pale\);/);
  assert.match(theme, /html\[data-theme="dark"\] \.rs-card\.selected,[\s\S]*?border-color: var\(--theme-accent-text\);/);
  assert.match(shared, /\.stat-card\.green\s*\{[^}]*background: var\(--surface-success-wash\)/);
  assert.match(shared, /\.stat-card\.purple\s*\{[^}]*background: var\(--surface-purple-wash\)/);
  assert.match(shared, /\.stat-card\.green \.stat-card-icon\s*\{[^}]*color: var\(--green\)/);
  assert.match(users, /\.rs-card\.stud \.rs-icon\s*\{[^}]*background: var\(--green-pale\);\s*color: var\(--green\)/);
  assert.match(users, /\.rs-card\.stud\s*\{[^}]*background: var\(--surface-success-wash\)/);
  assert.match(users, /\.rs-card\.selected\s*\{[^}]*background: var\(--blue-xpale\)/);
});

test('summary cards share the responsive value and icon arrangement', () => {
  const shared = read('assets/css/styles.css');
  const archiveScript = read('assets/js/admin/archive.js');
  const adminManagement = read('views/admin/edugnay-admin-management.html');
  const adminReports = read('views/admin/edugnay-admin-reports.html');
  const adminArchive = read('views/admin/edugnay-admin-archive.html');
  const adminUsers = read('views/admin/edugnay-admin-users.html');
  const teacherJournals = read('views/teacher/edugnay-teacher-journals.html');
  const studentAttendance = read('views/student/edugnay-student-attendance.html');
  const parentAttendance = read('views/parent/edugnay-parent-attendance.html');
  const adminDashboard = read('views/admin/edugnay-admin-dashboard.html');
  const teacherDashboard = read('views/teacher/edugnay-teacher-dashboard.html');
  const platformDashboard = read('views/platform/edugnay-platform-dashboard.html');
  const platformDashboardCss = read('assets/css/platform/dashboard.css');

  assert.match(shared, /@media \(min-width: 521px\)\s*\{/);
  assert.match(shared, /\.summary-card-layout > \.stat-card,[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 38px;/);
  assert.match(shared, /\.summary-card-layout > \.stat-card \.stat-card-num,[\s\S]*?grid-column: 1;/);
  assert.match(shared, /\.summary-card-layout > \.stat-card \.stat-card-top,[\s\S]*?grid-column: 2;/);
  assert.match(shared, /\.summary-card-layout > \.rs-card \.rs-info\s*\{\s*display: contents;/);

  for (const [page, id] of [
    [adminManagement, 'sections-summary-cards'],
    [adminManagement, 'subjects-summary-cards'],
    [adminManagement, 'teacher-summary-cards'],
    [adminManagement, 'students-summary-cards'],
    [adminReports, 'report-stat-grid'],
    [adminArchive, 'archive-summary-cards'],
    [teacherJournals, 'journal-summary-strip'],
    [studentAttendance, 'summary-strip'],
    [parentAttendance, 'summary-strip']
  ]) {
    assert.match(page, new RegExp(`class="[^"]*summary-card-layout[^"]*" id="${id}"`));
  }
  assert.match(adminUsers, /class="role-summary summary-card-layout"/);
  assert.match(adminDashboard, /class="stat-grid summary-card-layout" id="admin-summary-cards"/);
  assert.match(teacherDashboard, /class="stat-grid teacher-summary-grid summary-card-layout" id="teacher-summary-cards"/);
  assert.match(platformDashboard, /class="stat-grid summary-card-layout" id="platform-summary-cards"/);
  assert.match(platformDashboardCss, /\.platform-dashboard \.stat-card\s*\{\s*min-height: auto;/);
  assert.match(archiveScript, /function formatArchivePercent\(value, unavailableLabel = 'Not available'\)/);
  assert.match(archiveScript, /value: formatArchivePercent\(summary\.averagePassRate, '—'\)/);
  assert.match(archiveScript, /formatArchivePercent\(rate\)/);
});
