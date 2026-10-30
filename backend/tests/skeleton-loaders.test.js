const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const shell = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const attendanceShared = fs.readFileSync(path.join(root, 'assets/js/attendance-history.js'), 'utf8');

function functionSource(name, nextMarker) {
  const start = shell.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = shell.indexOf(nextMarker, start);
  assert.ok(end > start, `${name} has a following marker`);
  return shell.slice(start, end).trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function makeRenderer() {
  const source = [
    "const PANEL_SKELETON_KINDS = new Set(['cards', 'child-switcher', 'stat-cards', 'section-cards', 'table-rows', 'list', 'calendar', 'profile', 'modal', 'tabs', 'chart', 'donut', 'line']);",
    functionSource('renderPanelSkeleton', '\n  function initializeDeclaredPanelSkeletons')
  ].join('\n');
  const context = vm.createContext({ escapeHtml });
  new vm.Script(`${source}; globalThis.render = renderPanelSkeleton;`).runInContext(context);
  return context.render;
}

function htmlPages() {
  const pages = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && entry.name.endsWith('.html')) pages.push(filename);
    }
  }
  visit(root);
  return pages;
}

test('shared skeleton renderer creates explicit shapes without nested dashboard grids', () => {
  const render = makeRenderer();
  const kinds = ['cards', 'child-switcher', 'stat-cards', 'section-cards', 'list', 'calendar', 'profile', 'modal', 'tabs', 'chart', 'donut', 'line'];
  for (const kind of kinds) {
    const html = render({ kind, label: '<Loading & waiting>', rows: 2, columns: 3 });
    assert.match(html, new RegExp(`panel-skeleton--${kind}`));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /&lt;Loading &amp; waiting&gt;/);
    assert.doesNotMatch(html, /data-lucide=/);
  }

  const statCards = render({ kind: 'stat-cards', rows: 3 });
  assert.equal((statCards.match(/class="stat-card panel-skeleton-stat-card"/g) || []).length, 3);
  assert.ok(/\.panel-skeleton--stat-cards[\s\S]*?display:\s*contents/.test(styles), 'stat card skeleton wrapper uses host grid');
  assert.ok(/\.panel-skeleton--section-cards[\s\S]*?display:\s*contents/.test(styles), 'class card skeleton wrapper uses host grid');
  assert.match(styles, /\.panel-skeleton--list,\s*\.panel-skeleton--list \.panel-skeleton-visual\s*\{\s*display:\s*contents/);
  for (const kind of ['cards', 'child-switcher', 'stat-cards', 'section-cards', 'calendar', 'list', 'tabs']) {
    const html = render({ kind, label: `Loading ${kind}` });
    assert.match(html, new RegExp(`<span class="panel-skeleton-status" role="status"[^>]*>Loading ${kind}</span>`));
  }

  const calendar = render({ kind: 'calendar', rows: 2 });
  assert.equal((calendar.match(/class="cal-day panel-skeleton-calendar-day"/g) || []).length, 35);
  assert.doesNotMatch(calendar, /panel-skeleton-weekdays|panel-skeleton-days/);
  assert.doesNotMatch(shell + styles, /panel-skeleton-table-head|panel-skeleton-table-row|panel-skeleton-weekdays|panel-skeleton-days/);

  const tabs = render({ kind: 'tabs', rows: 3 });
  assert.equal((tabs.match(/class="panel-skeleton-tab(?: is-active)?"/g) || []).length, 3);
  const chart = render({ kind: 'chart', columns: 4 });
  assert.equal((chart.match(/class="panel-skeleton-chart-bar"/g) || []).length, 4);
  assert.match(render({ kind: 'list' }), /class="panel-skeleton-row"/);
  assert.match(render({ kind: 'list', rowInset: 'flush' }), /class="panel-skeleton-row panel-skeleton-row--flush"/);
  assert.match(styles, /\.panel-skeleton-row\s*\{[^}]*padding:\s*12px 20px/);
  assert.match(styles, /\.panel-skeleton-row--flush\s*\{\s*padding-right:\s*0;\s*padding-left:\s*0;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.panel-skeleton-row\s*\{\s*padding-right:\s*14px;\s*padding-left:\s*14px;/);
});

test('parent child switcher skeletons use the real child-card layout on every selector page', () => {
  const render = makeRenderer();
  const html = render({ kind: 'child-switcher', label: 'Loading linked children', rows: 2 });
  assert.equal((html.match(/class="child-card panel-skeleton-child-card"/g) || []).length, 2);
  assert.match(html, /panel-skeleton-child-avatar/);
  assert.match(html, /panel-skeleton-child-name/);
  assert.match(html, /panel-skeleton-child-section/);
  assert.match(html, /panel-skeleton-status" role="status"[^>]*Loading linked children/);

  const childSwitcherStyles = fs.readFileSync(path.join(root, 'assets/css/parent/child-switcher.css'), 'utf8');
  assert.match(childSwitcherStyles, /\.panel-skeleton--child-switcher,[\s\S]*?display:\s*contents/);
  assert.match(childSwitcherStyles, /\.child-card\s*\{[\s\S]*?min-width:\s*210px/);
  assert.match(childSwitcherStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.child-card\s*\{\s*min-width:\s*190px/);

  const pages = [
    ['dashboard', 'views/parent/edugnay-parent-dashboard.html'],
    ['attendance', 'views/parent/edugnay-parent-attendance.html'],
    ['grades', 'views/parent/edugnay-parent-grades.html'],
    ['assignments', 'views/parent/edugnay-parent-assignments.html'],
    ['reports', 'views/parent/edugnay-parent-reports.html']
  ].map(([name, filename]) => [name, fs.readFileSync(path.join(root, filename), 'utf8')]);
  for (const [name, page] of pages) {
    assert.match(page, /data-skeleton-kind="child-switcher"[^>]*data-skeleton-label="Loading linked children"/, `${name} declares the shared child skeleton`);
    assert.match(page, /child-switcher\.css\?v=20261030-child-switcher/, `${name} loads the shared child-switcher styles`);
  }
  const assignmentsScript = fs.readFileSync(path.join(root, 'assets/js/parent/assignments.js'), 'utf8');
  assert.match(assignmentsScript, /kind: 'child-switcher', label: 'Loading linked children'/);
  assert.match(pages.find(([name]) => name === 'grades')[1], /kind: 'child-switcher', label: 'Loading linked children'/);
  assert.match(pages.find(([name]) => name === 'attendance')[1], /kind: 'child-switcher', label: 'Loading linked children'/);
  const dashboard = pages.find(([name]) => name === 'dashboard')[1];
  assert.match(dashboard, /kind: 'child-switcher', label: 'Loading linked children'/);
  const reports = pages.find(([name]) => name === 'reports')[1];
  assert.match(reports, /id="parent-reports-message" role="status"><\/p>/);
});

test('sidebar brand subtitles are not treated as loading page content', () => {
  const views = htmlPages().filter(filename => filename.startsWith(path.join(root, 'views')));
  for (const filename of views) {
    const html = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(html, /class="brand-sub"[^>]*data-skeleton-kind=/, `${path.relative(root, filename)} keeps shell branding static`);
  }
});

test('table skeletons stay in table bodies and preserve the requested row and column count', () => {
  const render = makeRenderer();
  const html = render({ kind: 'table-rows', label: 'Loading <students>', rows: 3, columns: 5 });
  assert.equal((html.match(/<tr\b/g) || []).length, 3);
  assert.equal((html.match(/<td\b/g) || []).length, 15);
  assert.match(html, /role="status" aria-live="polite" aria-busy="true" aria-label="Loading &lt;students&gt;"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<div class="panel-skeleton/);
});

test('empty states remain empty states and loading is never inferred from their text', () => {
  const source = functionSource('renderPanelEmptyState', '\n\n  Object.assign(window.EDUGNAY_API');
  const context = vm.createContext({ escapeHtml, queuePanelEmptyIconRender() {}, window: { lucide: null } });
  new vm.Script(`${source}; globalThis.render = renderPanelEmptyState;`).runInContext(context);
  const loadingLabel = context.render({ icon: 'loader-circle', title: 'Loading attendance', text: 'Please wait.' });
  assert.match(loadingLabel, /panel-empty-state/);
  assert.doesNotMatch(loadingLabel, /panel-skeleton/);
  const empty = context.render({ icon: 'calendar', title: 'No attendance', text: 'Nothing has been recorded.' });
  assert.match(empty, /panel-empty-state/);
  assert.match(empty, /No attendance/);
  for (const removed of ['inferPanelSkeletonKind', 'loadingKindFromLabel', 'upgradeLoadingPlaceholder', 'initializeLoadingSkeletons']) {
    assert.doesNotMatch(shell, new RegExp(`function ${removed}\\b`));
  }
  assert.doesNotMatch(shell, /new MutationObserver\([^)]*upgradeLoadingPlaceholder/);
});

test('declared static skeletons render only from explicit region attributes', () => {
  const source = functionSource('initializeDeclaredPanelSkeletons', 'function renderPanelEmptyState');
  const render = makeRenderer();
  const elements = [];
  const makeElement = (kind, label, rows = '', rowInset = '') => {
    const attrs = new Map([['data-skeleton-kind', kind], ['data-skeleton-label', label], ['data-skeleton-rows', String(rows)]]);
    if (rowInset) attrs.set('data-skeleton-row-inset', rowInset);
    return {
      textContent: label,
      innerHTML: '',
      getAttribute(name) { return attrs.get(name) ?? null; },
      removeAttribute(name) { attrs.delete(name); },
      attrs
    };
  };
  elements.push(makeElement('section-cards', 'Loading classes', 2));
  elements.push(makeElement('line', 'Loading profile name'));
  elements.push(makeElement('list', "Loading today's classes", 3, 'flush'));
  const document = { readyState: 'complete', querySelectorAll: () => elements };
  const context = vm.createContext({ document, renderPanelSkeleton: render });
  new vm.Script(`${source}; initializeDeclaredPanelSkeletons();`).runInContext(context);
  assert.match(elements[0].innerHTML, /panel-skeleton--section-cards/);
  assert.match(elements[1].innerHTML, /panel-skeleton--line/);
  assert.match(elements[2].innerHTML, /panel-skeleton-row--flush/);
  assert.equal(elements[0].attrs.has('data-skeleton-kind'), false);
  assert.equal(elements[2].attrs.has('data-skeleton-row-inset'), false);
  assert.doesNotMatch(source, /MutationObserver|loadingKindFromLabel|inferPanelSkeletonKind/);
  assert.match(source, /querySelectorAll\('\[data-skeleton-kind\]'\)/);
});

test('all portal pages load versioned shared styles and skeleton renderer', () => {
  const pages = htmlPages();
  assert.equal(pages.length, 49);
  const views = pages.filter(filename => filename.startsWith(path.join(root, 'views')));
  assert.equal(views.length, 48);
  for (const filename of views) {
    const html = fs.readFileSync(filename, 'utf8');
    assert.ok(/assets\/css\/styles\.css\?v=2/.test(html), `${path.relative(root, filename)} uses the shared stylesheet`);
    assert.ok(/assets\/js\/shell-common\.js\?v=10/.test(html), `${path.relative(root, filename)} uses the shared skeleton renderer`);
  }
  const declared = views.map(filename => fs.readFileSync(filename, 'utf8')).join('\n');
  assert.match(declared, /data-skeleton-kind="line"/);
  assert.match(declared, /data-skeleton-kind="section-cards"/);
  assert.match(declared, /data-skeleton-kind="tabs"/);
  assert.match(attendanceShared, /renderPanelSkeleton\(\{ kind: 'calendar', label: 'Loading attendance calendar' \}\)/);
});

test('dashboard grids and teacher selection panels use explicit, container-matched shapes', () => {
  const teacher = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-dashboard.html'), 'utf8');
  const platform = fs.readFileSync(path.join(root, 'views/platform/edugnay-platform-dashboard.html'), 'utf8');
  const teacherClass = fs.readFileSync(path.join(root, 'assets/js/teacher/elective-class.js'), 'utf8');
  const shsGradebook = fs.readFileSync(path.join(root, 'assets/js/teacher/shs-gradebook.js'), 'utf8');

  assert.match(teacher, /teacher-summary-cards[\s\S]*renderPanelSkeleton\(\{ kind: 'stat-cards'/);
  assert.match(teacher, /sectionCardsContainer[\s\S]*renderPanelSkeleton\(\{ kind: 'section-cards'/);
  assert.match(admin, /renderPanelSkeleton\(\{ kind: 'stat-cards'/);
  assert.match(platform, /renderPanelSkeleton\(\{ kind: 'stat-cards'/);
  assert.match(teacher, /renderTeacherQuickActions\(\);/);
  assert.match(teacher, /renderWeekCalendar\(\);/);

  assert.match(teacherClass, /renderStudents\(\{ columns, loading: true \}\)/);
  assert.match(teacherClass, /renderAttendanceRows\(\{ loading: true \}\)/);
  assert.match(teacherClass, /renderAssignments\(\[\], \{ loading: true/);
  assert.match(teacherClass, /renderMaterials\(\[\], \{ loading: true/);
  assert.match(shsGradebook, /renderScoreTable\(\{[\s\S]{0,80}loading: true/);
  assert.doesNotMatch(teacherClass + shsGradebook, /icon:\s*'loader-circle'/);
});

test('student dashboard pads the journal placeholder and renders its week calendar before data loads', () => {
  const dashboard = fs.readFileSync(path.join(root, 'views/student/edugnay-student-dashboard.html'), 'utf8');
  assert.match(dashboard, /class="journal-card"[^>]*data-skeleton-kind="profile"[^>]*data-skeleton-label="Loading weekly journal"/);
  assert.doesNotMatch(dashboard, /timetable-preview|Loading today's classes/);
  const startup = dashboard.slice(
    dashboard.indexOf("document.addEventListener('DOMContentLoaded', async () => {"),
    dashboard.indexOf('function renderWeekCalendar()')
  );
  assert.ok(startup.indexOf('renderWeekCalendar();') < startup.indexOf('await window.EDUGNAY_SCHOOL_READY'));
  assert.match(dashboard, /card\.closest\('\.journal-feature'\)\?\.setAttribute\('hidden', ''\)/);
});

test('profile and data-loaded modal paths replace loading copy with explicit skeletons', () => {
  const adminManagement = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-management.html'), 'utf8');
  const adminSchools = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-schools.html'), 'utf8');
  const adminProfile = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-profile.html'), 'utf8');
  const teacherProfile = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-profile.html'), 'utf8');
  const parentProfile = fs.readFileSync(path.join(root, 'views/parent/edugnay-parent-profile.html'), 'utf8');
  const studentProfile = fs.readFileSync(path.join(root, 'views/student/edugnay-student-profile.html'), 'utf8');

  assert.match(adminManagement, /renderPanelSkeleton\(\{ kind: 'modal', label: 'Loading subject defaults'/);
  assert.match(adminSchools, /renderPanelSkeleton\(\{ kind: 'profile', label: 'Loading school settings'/);
  assert.match(adminSchools, /label: 'Loading subject assessment rules'/);
  assert.doesNotMatch(adminProfile, /renderAdminProfile\(\{ displayName: 'Loading profile/);
  assert.doesNotMatch(teacherProfile, /renderTeacherProfile\(\{ displayName: 'Loading profile/);
  assert.match(parentProfile, /renderPanelSkeleton\(\{ kind: 'cards', label: 'Loading linked children'/);
  assert.match(studentProfile, /function setStudentSkeleton\(/);
  assert.match(studentProfile, /setStudentSkeleton\('student-record-adviser', 'Loading adviser'\)/);
});

test('skeleton colors follow the theme and reduced motion disables shimmer', () => {
  assert.match(styles, /background: linear-gradient\([^;]+var\(--gray-100\)[^;]+var\(--theme-surface-soft\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.panel-skeleton-shape\s*\{\s*animation:\s*none/);
});
