const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('all timetable pages load their own role view and the shared design', () => {
  for (const [role, name] of [
    ['admin', 'timetables'], ['teacher', 'schedules'], ['student', 'schedules']
  ]) {
    const html = read(`views/${role}/edugnay-${role}-${name}.html`);
    assert.match(html, new RegExp(`data-role="${role}"`));
    assert.match(html, /timetables\.css/);
    assert.match(html, /timetables\.js/);
    assert.match(html, /id="timetable-grid"/);
    assert.match(html, /id="timetable-year"/);
    if (role !== 'admin') assert.doesNotMatch(html, /id="timetable-form"|id="timetable-delete"/);
    if (role !== 'admin') assert.doesNotMatch(html, /id="timetable-add"/);
  }
});

test('schedule pages share the Attendance-style week navigation and wide two-column layout', () => {
  const css = read('assets/css/timetables.css');
  const script = read('assets/js/timetables.js');
  for (const [role, name] of [
    ['admin', 'timetables'], ['teacher', 'schedules'], ['student', 'schedules']
  ]) {
    const html = read(`views/${role}/edugnay-${role}-${name}.html`);
    assert.match(html, /class="timetable-filters-card"|class="timetable-card timetable-filters-card"/);
    assert.match(html, /id="timetable-board" hidden/);
    assert.match(html, /class="timetable-week-controls"[\s\S]*?id="timetable-prev"[\s\S]*?id="timetable-week-label"[\s\S]*?id="timetable-next"[\s\S]*?id="timetable-today"[^>]*disabled>Today<\/button>/);
  }
  assert.match(css, /\.timetable-week-controls\s*\{[^}]*gap: 4px;[^}]*padding: 4px;[^}]*border: 1px solid var\(--gray-200\);[^}]*background: var\(--gray-50\)/);
  assert.match(css, /\.timetable-week-controls \.timetable-button\s*\{[^}]*width: 30px; height: 30px;[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /\.timetable-week-controls \.timetable-button:hover:not\(:disabled\)\s*\{[^}]*background: var\(--theme-surface\); color: var\(--theme-accent-text\)/);
  assert.match(css, /@media \(min-width: 1280px\)\s*\{[\s\S]*?\.timetable-page\s*\{[^}]*grid-template-columns: 260px minmax\(0, 1fr\)/);
  assert.match(css, /\.timetable-page > \.timetable-empty:not\(\[hidden\]\), \.timetable-page > #timetable-board:not\(\[hidden\]\)\s*\{\s*grid-column: 2/);
  assert.match(css, /\.timetable-toolbar, \.timetable-toolbar-filters\s*\{[^}]*flex-direction: column/);
  assert.match(css, /\.timetable-toolbar-actions\s*\{\s*margin-left: 0/);
  assert.match(css, /\.timetable-toolbar-actions \.timetable-button\s*\{\s*width: 100%/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.timetable-toolbar \{[^}]*flex-direction: column/);
  assert.match(css, /@media \(min-width: 561px\)\s*\{\s*\.timetable-card\[aria-label="Weekly timetable"\] > \.timetable-heading\s*\{[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.timetable-heading-title > div\s*\{\s*min-width: 0/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{\s*\.timetable-card\[aria-label="Weekly timetable"\] > \.timetable-heading\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.timetable-week-controls\s*\{[^}]*grid-template-columns: 30px minmax\(0, 1fr\) 30px auto; width: 100%;[^}]*padding: 0; border: 0; border-radius: 0; background: transparent/);
  assert.match(css, /\.timetable-week-controls \.timetable-today\s*\{[^}]*border: 1px solid var\(--gray-200\); background: var\(--gray-50\)/);
  assert.match(css, /\.timetable-week-label\s*\{\s*min-width: 0/);
  const sharedHandlers = script.slice(script.indexOf("year.addEventListener('change'"), script.indexOf("if (role === 'admin')", script.indexOf("year.addEventListener('change'")));
  assert.match(sharedHandlers, /timetable-prev'\)\.addEventListener\('click'/);
  assert.match(sharedHandlers, /timetable-next'\)\.addEventListener\('click'/);
  assert.match(sharedHandlers, /timetable-today'\)\.addEventListener\('click', \(\) => goToToday\(state\)\)/);
});

test('Today returns to the current week and school year, or stays disabled without one', async () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.todayActions = { goToToday, renderWeek };\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  let currentDate = '2026-10-25T12:00:00';
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [currentDate])); }
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', disabled: false, hidden: false });
    return elements.get(id);
  };
  let loads = 0;
  const context = {
    Date: FixedDate,
    document: { addEventListener() {}, getElementById: id => id === 'timetable-add' ? null : element(id) },
    window: { EDUGNAY_API: { async getTimetable(id) {
      loads += 1;
      assert.equal(id, '2');
      return { year: { id: 2, startDate: '2026-07-01', endDate: '2027-06-30' }, assignments: [], meetings: [] };
    } } }
  };
  vm.runInNewContext(source, context);
  const years = [
    { id: 1, startDate: '2025-07-01', endDate: '2026-06-30' },
    { id: 2, startDate: '2026-07-01', endDate: '2027-06-30' }
  ];
  const state = { role: 'teacher', years, week: '2026-10-05', data: { year: { id: 2 }, meetings: [] } };
  element('timetable-year').value = '2';
  context.todayActions.renderWeek(state);
  assert.equal(element('timetable-today').disabled, false);
  await context.todayActions.goToToday(state);
  assert.equal(state.week, '2026-10-19');
  assert.equal(element('timetable-today').disabled, true);
  assert.equal(loads, 0);

  state.week = '2026-12-28';
  currentDate = '2027-01-01T12:00:00';
  context.todayActions.renderWeek(state);
  assert.equal(element('timetable-today').disabled, true);
  state.week = '2027-01-04';
  context.todayActions.renderWeek(state);
  assert.equal(element('timetable-today').disabled, false);
  await context.todayActions.goToToday(state);
  assert.equal(state.week, '2026-12-28');

  currentDate = '2026-10-25T12:00:00';
  state.data.year = { id: 1 };
  state.week = '2025-10-20';
  element('timetable-year').value = '1';
  context.todayActions.renderWeek(state);
  assert.equal(element('timetable-today').disabled, false);
  await context.todayActions.goToToday(state);
  assert.equal(element('timetable-year').value, '2');
  assert.equal(state.week, '2026-10-19');
  assert.equal(loads, 1);
  assert.equal(element('timetable-today').disabled, true);

  state.week = '2026-10-12';
  currentDate = '2027-07-01T12:00:00';
  context.todayActions.renderWeek(state);
  assert.equal(element('timetable-today').disabled, true);
  await context.todayActions.goToToday(state);
  assert.equal(state.week, '2026-10-12');
  assert.equal(loads, 1);
});

test('two- and four-column weeks show a muted, non-interactive next Monday without extending the selected week', () => {
  const css = read('assets/css/timetables.css');
  assert.match(css, /\.timetable-day-preview\s*\{\s*display: none; background: var\(--gray-50\)/);
  assert.match(css, /\.timetable-day-preview \.timetable-day-head[^}]*color: var\(--gray-400\)/);
  assert.match(css, /@media \(min-width: 1280px\) and \(max-width: 1699px\), \(min-width: 761px\) and \(max-width: 1180px\), \(min-width: 421px\) and \(max-width: 760px\)\s*\{\s*\.timetable-day-preview\s*\{\s*display: flex/);

  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.renderTimetableWeek = renderWeek;\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  const elements = new Map();
  const context = {
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '' });
        return elements.get(id);
      }
    },
    window: {}
  };
  vm.runInNewContext(source, context);
  for (const [monday, sunday, nextMonday] of [
    ['2026-10-19', 'Oct 25', '2026-10-26'],
    ['2026-10-26', 'Nov 1', '2026-11-02'],
    ['2026-12-28', 'Jan 3', '2027-01-04']
  ]) {
    context.renderTimetableWeek({ role: 'teacher', week: monday, data: { meetings: [] } });
    const grid = elements.get('timetable-grid').innerHTML;
    const preview = grid.match(/<section class="timetable-day timetable-day-preview"[\s\S]*?<\/section>/)?.[0];
    assert.ok(preview);
    assert.match(preview, new RegExp(`datetime="${nextMonday}"`));
    assert.match(preview, /Next week/);
    assert.doesNotMatch(preview, /<button|data-meeting-id|No classes/);
    assert.equal((grid.match(/<section class="timetable-day/g) || []).length, 8);
    assert.ok(elements.get('timetable-week-label').textContent.endsWith(sunday));
  }
});

test('today uses a navy date badge and is announced only when the selected week contains today', () => {
  const css = read('assets/css/timetables.css');
  assert.match(css, /\.timetable-day\.today\s*\{\s*background: var\(--theme-surface\)/);
  assert.match(css, /\.timetable-day\.today \.timetable-day-head time\s*\{[^}]*border-radius: 999px;[^}]*background: var\(--navy\); color: var\(--white\)/);

  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.renderTimetableWeek = renderWeek;\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  let currentDate = '2026-10-19T12:00:00';
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [currentDate])); }
  }
  const elements = new Map();
  const context = {
    Date: FixedDate,
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '' });
        return elements.get(id);
      }
    },
    window: {}
  };
  vm.runInNewContext(source, context);

  for (const [day, expectedLabel] of [
    ['2026-10-19', 'Monday, Oct 19, today'],
    ['2026-10-21', 'Wednesday, Oct 21, today'],
    ['2026-10-25', 'Sunday, Oct 25, today']
  ]) {
    currentDate = `${day}T12:00:00`;
    context.renderTimetableWeek({ role: 'teacher', week: '2026-10-19', data: { meetings: [] } });
    assert.ok(elements.get('timetable-grid').innerHTML.includes(`aria-label="${expectedLabel}"`));
  }

  currentDate = '2026-10-25T12:00:00';
  context.renderTimetableWeek({ role: 'teacher', week: '2026-10-26', data: { meetings: [] } });
  assert.doesNotMatch(elements.get('timetable-grid').innerHTML, /class="timetable-day today"/);
  assert.doesNotMatch(elements.get('timetable-grid').innerHTML, /aria-label="[^"]*, today"/);
});

test('teacher and student dashboards link to their full schedules', () => {
  for (const role of ['teacher', 'student']) {
    const html = read(`views/${role}/edugnay-${role}-dashboard.html`);
    assert.match(html, /class="timetable-preview"/);
    assert.match(html, new RegExp(`href="edugnay-${role}-schedules.html"`));
    assert.match(html, /<h2 id="[^"]+">Today's Schedule<\/h2>/);
    assert.match(html, /class="timetable-preview-icon" aria-hidden="true"/);
    assert.match(html, /class="panel-action" href="edugnay-(?:teacher|student)-schedules\.html">View all/);
    const previous = role === 'teacher' ? 'id="teacher-summary-cards"' : 'class="grading-banner"';
    const following = role === 'teacher' ? 'class="panel panel-sections"' : 'id="student-journal-feature"';
    assert.ok(html.indexOf(previous) < html.indexOf('class="timetable-preview"'));
    assert.ok(html.indexOf('class="timetable-preview"') < html.indexOf(following));
  }
  const css = read('assets/css/timetables.css');
  assert.match(css, /\.timetable-preview\s*\{ margin: 0; \}/);
  assert.match(css, /\.timetable-preview-icon\s*\{[^}]*background: var\(--blue-xpale\); color: var\(--theme-accent-text\)/);
  assert.match(css, /\.timetable-preview-item\s*\{[^}]*grid-template-columns: 170px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 560px\)[^\n]*\.timetable-preview-item \{ grid-template-columns: 82px minmax\(0, 1fr\)/);
  assert.match(css, /\.timetable-preview-copy\s*\{[^}]*overflow-wrap: anywhere/);
});

test('dashboard schedule previews contain no temporary sample content', () => {
  for (const role of ['student', 'teacher']) {
    const html = read(`views/${role}/edugnay-${role}-dashboard.html`);
    assert.match(html, /Today's Schedule/);
    assert.doesNotMatch(html, /timetable-preview-sample|Sample preview|Sample Teacher/);
  }
  assert.doesNotMatch(read('assets/js/timetables.js'), /previewSchedule|timetable-preview-sample/);
});

test('dashboard preview shows every class today in time order with role-specific details', async () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.initDashboardPreview = initPreview;\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  const meetings = [
    { weekday: 1, startDate: '2026-10-01', endDate: '2026-12-31', startTime: '16:00', endTime: '17:00', subjectName: 'Science', gradeName: 'Grade 8', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: null },
    { weekday: 1, startDate: '2026-10-01', endDate: '2026-12-31', startTime: '08:00', endTime: '09:00', subjectName: 'Technology and Livelihood Education (TLE)', gradeName: 'Grade 8', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: 'Lab 1' },
    { weekday: 1, startDate: '2026-10-01', endDate: '2026-12-31', startTime: '10:00', endTime: '11:00', subjectName: 'Math & Arts', gradeName: 'Grade 8', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: null },
    { weekday: 1, startDate: '2026-10-26', endDate: '2026-10-26', startTime: '12:00', endTime: '13:00', subjectName: 'History', gradeName: 'Grade 8', sectionName: 'St. Peter', teacherName: 'Maya Santos', room: null },
    { weekday: 2, startDate: '2026-10-01', endDate: '2026-12-31', startTime: '09:00', endTime: '10:00', subjectName: 'Tomorrow', teacherName: 'Another Teacher' },
    { weekday: 1, startDate: '2026-11-01', endDate: '2026-12-31', startTime: '13:00', endTime: '14:00', subjectName: 'Not effective yet' },
    { weekday: 1, startDate: '2026-10-01', endDate: '2026-10-25', startTime: '14:00', endTime: '15:00', subjectName: 'Expired' }
  ];
  async function render(role, data = meetings, fail = false, search = '') {
    const list = { innerHTML: '', setAttribute(name, value) { this[name] = value; } };
    const preview = { hidden: false, querySelector: () => list };
    const NativeDate = Date;
    class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-10-26T18:00:00'])); } }
    const context = { Date: FixedDate, URLSearchParams, document: { addEventListener() {} }, window: {
      location: { pathname: `/views/${role}/edugnay-${role}-dashboard.html`, search },
      EDUGNAY_API: { getCurrentUser: async () => ({ role }), getTimetable: async () => {
        if (fail) throw new Error('Offline');
        return { meetings: data };
      } },
      EDUGNAY_CONFIG: { renderPanelEmptyState: ({ title }) => `<div class="panel-empty-state">${title}</div>` }
    } };
    vm.runInNewContext(source, context);
    await context.initDashboardPreview(preview);
    return list.innerHTML;
  }

  for (const role of ['student', 'teacher']) {
    const html = await render(role);
    assert.equal((html.match(/role="listitem"/g) || []).length, 4);
    assert.ok(html.indexOf('Technology and Livelihood') < html.indexOf('Math &amp; Arts'));
    assert.ok(html.indexOf('Math &amp; Arts') < html.indexOf('History'));
    assert.ok(html.indexOf('History') < html.indexOf('Science'));
    assert.match(html, /8:00 AM/);
    assert.match(html, /9:00 AM/);
    assert.doesNotMatch(html, /Tomorrow|Not effective yet|Expired|Oct 26/);
    assert.match(html, /Lab 1/);
    if (role === 'student') {
      assert.match(html, /Maya Santos/);
      assert.doesNotMatch(html, /Grade 8|St\. Peter/);
    } else {
      assert.match(html, /Grade 8 · St\. Peter/);
      assert.doesNotMatch(html, /Maya Santos/);
    }
    assert.match(await render(role, []), /No classes today/);
    assert.match(await render(role, [], false, '?previewSchedule=1'), /No classes today/);
    assert.match(await render(role, [], true), /Schedule unavailable/);
  }
});

test('admin meeting form retains native date and time values for existing picker enhancement', () => {
  const html = read('views/admin/edugnay-admin-timetables.html');
  assert.match(html, /academic-date-picker\.js/);
  assert.match(html, /name="startDate" type="date" required/);
  assert.match(html, /name="endDate" type="date" required/);
  assert.match(html, /name="startTime" type="time" required/);
  assert.match(html, /name="endTime" type="time" required/);
});

test('meeting dialog separates section, subject, and assigned teacher without long dash labels', () => {
  const html = read('views/admin/edugnay-admin-timetables.html');
  assert.match(html, /id="timetable-dialog-section" required/);
  assert.match(html, /id="timetable-assignment" name="assignmentId" required disabled/);
  assert.match(html, /id="timetable-assigned-teacher"[^>]*readonly/);
  assert.doesNotMatch(html.match(/<form id="timetable-form">[\s\S]*?<\/form>/)?.[0] || '', /—/);

  const script = read('assets/js/timetables.js');
  assert.match(script, /timetable-dialog-section'\)\.addEventListener\('change', event =>\s*\{\s*renderDialogSubjects\(state, event\.currentTarget\.value\)/);
  assert.match(script, /const assignmentId = state\.editingAssignmentId \|\| values\.assignmentId/);
});

test('meeting assignment choices follow the section and prefill existing meetings', () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.dialogChoices = { renderDialogSections, renderDialogSubjects, openDialog };\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  class Select {
    constructor() { this.options = []; this.value = ''; this.disabled = false; }
    replaceChildren(...options) { this.options = options; this.value = ''; }
  }
  const elements = new Map([
    ['timetable-dialog-section', new Select()],
    ['timetable-assignment', new Select()]
  ]);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '' });
    return elements.get(id);
  };
  const form = { elements: { assignmentId: element('timetable-assignment'), weekday: {}, startTime: {}, endTime: {}, startDate: {}, endDate: {}, room: {} }, reset() {} };
  elements.set('timetable-form', form);
  elements.set('timetable-dialog', { querySelector: () => ({ focus() {} }) });
  let currentDate = '2026-10-25T12:00:00';
  const NativeDate = Date;
  class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [currentDate])); } }
  const context = {
    Date: FixedDate,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    document: { body: { style: { overflow: '' } }, activeElement: { focus() {} }, addEventListener() {}, getElementById: element },
    window: {}
  };
  vm.runInNewContext(source, context);
  const state = { role: 'admin', data: { year: { startDate: '2026-07-01', endDate: '2027-06-30' }, assignments: [
    { assignmentId: 1, sectionId: 10, gradeName: 'Grade 5', sectionName: 'St. John', sectionStatus: 'active', subjectName: 'English', teacherName: 'Carlo Reyes' },
    { assignmentId: 2, sectionId: 20, gradeName: 'Grade 8', sectionName: 'St. Peter', sectionStatus: 'active', subjectName: 'English', teacherName: 'Maya Santos' },
    { assignmentId: 3, sectionId: 20, gradeName: 'Grade 8', sectionName: 'St. Peter', sectionStatus: 'active', subjectName: 'English', teacherName: 'Ana Cruz' },
    { assignmentId: 4, sectionId: 20, gradeName: 'Grade 8', sectionName: 'St. Peter', sectionStatus: 'active', subjectName: 'Science', teacherName: 'Maya Santos' }
  ] } };

  context.dialogChoices.renderDialogSections(state);
  assert.equal(element('timetable-dialog-section').options.length, 3);
  context.dialogChoices.openDialog(state, '2');
  assert.equal(element('timetable-dialog-section').value, '20');
  assert.equal(element('timetable-assignment').value, '2');
  assert.equal(element('timetable-assigned-teacher').value, 'Maya Santos');
  assert.deepEqual(element('timetable-assignment').options.map(option => option.text),
    ['Choose a subject', 'English (Maya Santos)', 'English (Ana Cruz)', 'Science']);

  element('timetable-dialog-section').value = '10';
  context.dialogChoices.renderDialogSubjects(state, '10');
  assert.equal(element('timetable-assignment').value, '');
  assert.equal(element('timetable-assigned-teacher').value, '');
  assert.deepEqual(element('timetable-assignment').options.map(option => option.text), ['Choose a subject', 'English']);
  context.dialogChoices.renderDialogSubjects(state, '');
  assert.equal(element('timetable-assignment').disabled, true);

  state.data.assignments[2].sectionStatus = 'inactive';
  context.dialogChoices.openDialog(state, '', { id: 99, assignmentId: 3, weekday: 1, startTime: '09:00', endTime: '10:00' });
  assert.equal(element('timetable-dialog-section').value, '20');
  assert.equal(element('timetable-assignment').value, '3');
  assert.equal(element('timetable-assigned-teacher').value, 'Ana Cruz');
  assert.equal(element('timetable-dialog-section').disabled, true);
  assert.equal(element('timetable-assignment').disabled, true);
  assert.equal(state.editingAssignmentId, 3);
});

test('timetable events separate subject, time, class, and optional role details', () => {
  const script = read('assets/js/timetables.js');
  const css = read('assets/css/timetables.css');
  const source = script.replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.renderTimetableEvent = eventHtml;\n  document.addEventListener('DOMContentLoaded', () => {"
  );
  const context = { document: { addEventListener() {} }, window: {} };
  vm.runInNewContext(source, context);
  const item = {
    id: 42, subjectName: 'Advanced Biology and Environmental Science', startTime: '09:00', endTime: '10:00',
    gradeName: 'Grade 12', sectionName: 'St. Peter Senior High', teacherName: 'Maya Santos', room: 'Science Laboratory 204'
  };

  const admin = context.renderTimetableEvent(item, { role: 'admin', data: { year: { status: 'active' } } });
  assert.match(admin, /^<button class="timetable-event"[^>]*data-meeting-id="42"/);
  assert.ok(admin.indexOf('timetable-event-subject') < admin.indexOf('timetable-event-time'));
  assert.ok(admin.indexOf('timetable-event-time') < admin.indexOf('timetable-event-class'));
  assert.match(admin, /timetable-event-time">9:00 AM - 10:00 AM/);
  assert.match(admin, /timetable-event-class">Grade 12 · St\. Peter Senior High/);
  assert.match(admin, /timetable-event-meta">Room: Science Laboratory 204/);
  assert.doesNotMatch(admin, /Teacher: Maya Santos/);

  const student = context.renderTimetableEvent(item, { role: 'student', data: { year: { status: 'active' } } });
  assert.match(student, /^<div class="timetable-event">/);
  assert.doesNotMatch(student, /timetable-event-class|Grade 12|St\. Peter Senior High/);
  assert.match(student, /timetable-event-meta">Teacher: Maya Santos/);
  assert.match(student, /timetable-event-meta">Room: Science Laboratory 204/);
  const noRoom = context.renderTimetableEvent({ ...item, room: '' }, { role: 'teacher', data: { year: { status: 'active' } } });
  assert.doesNotMatch(noRoom, /timetable-event-meta/);
  assert.match(noRoom, /timetable-event-class">Grade 12 · St\. Peter Senior High/);
  assert.match(noRoom, /^<div class="timetable-event">/);
  assert.match(css, /\.timetable-event-subject\s*\{[^}]*font-size: 12px; font-weight: 800/);
  assert.match(css, /\.timetable-event-time\s*\{[^}]*color: var\(--theme-accent-text\);[^}]*font-weight: 700/);
  assert.match(css, /\.timetable-event-class, \.timetable-event-meta\s*\{[^}]*min-width: 0;[^}]*color: var\(--gray-600\)/);
  assert.match(css, /\.timetable-event\s*\{[^}]*overflow-wrap: anywhere/);
});

test('timetable surfaces use shared design tokens and Academix modal structure', () => {
  const css = read('assets/css/timetables.css');
  const html = read('views/admin/edugnay-admin-timetables.html');
  assert.match(css, /\.timetable-dialog\s*\{\s*width: min\(480px, calc\(100vw - 32px\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[^\n]*\.timetable-dialog\s*\{\s*width: min\(480px, calc\(100vw - 20px\)\)/);
  assert.match(css, /\.timetable-confirm-dialog\s*\{\s*width: min\(440px, calc\(100vw - 32px\)\)/);
  assert.match(css, /\.timetable-card, \.timetable-preview\s*\{[^}]*border-radius: var\(--panel-radius\)/);
  assert.match(css, /\.timetable-field select, \.timetable-field input\s*\{[^}]*min-height: 42px/);
  assert.match(css, /\.timetable-button\s*\{[^}]*min-height: var\(--button-height\)/);
  assert.match(css, /\.timetable-button\[hidden\]\s*\{\s*display: none/);
  assert.match(html, /class="modal-backdrop timetable-dialog-overlay" id="timetable-dialog-overlay"/);
  assert.match(html, /class="modal timetable-dialog" id="timetable-dialog" role="dialog"/);
  assert.match(html, /class="modal-head"[\s\S]*?class="modal-heading-icon"[\s\S]*?data-lucide="calendar-days"/);
  assert.match(html, /class="modal-body timetable-dialog-body"/);
  assert.match(html, /class="modal-foot timetable-dialog-actions"/);
  assert.match(html, /class="btn btn-cancel" id="timetable-cancel"/);
  assert.match(html, /class="btn btn-save" id="timetable-save"/);
  assert.match(html, /class="row-btn remove" id="timetable-delete" type="button" hidden/);
  assert.match(html, /class="row-btn remove" id="timetable-delete-confirm" type="button"/);
  assert.match(html, /class="modal-backdrop timetable-confirm-overlay" id="timetable-confirm-overlay"/);
  assert.match(html, /class="modal timetable-confirm-dialog" id="timetable-confirm-dialog" role="alertdialog"/);
  assert.match(html, /id="timetable-delete-confirm" type="button">Remove meeting<\/button>/);
  assert.match(css, /\.timetable-dialog-actions \.row-btn\.remove, \.timetable-confirm-actions \.row-btn\.remove\s*\{[^}]*min-height: var\(--button-height\);[^}]*padding: 9px var\(--button-pad-x\);[^}]*border-radius: var\(--button-radius\);[^}]*font-size: 12\.5px/);
  assert.match(css, /\.timetable-confirm-overlay\s*\{\s*z-index: 310 !important/);
  assert.match(css, /\.timetable-dialog-overlay\[hidden\], \.timetable-confirm-overlay\[hidden\]\s*\{\s*display: none !important/);
  const managementHtml = read('views/admin/edugnay-admin-management.html');
  assert.match(managementHtml, /class="row-btn remove"/);
  assert.match(css, /\.timetable-dialog-actions #timetable-delete\s*\{\s*margin-right: auto/);
  assert.match(css, /#timetable-delete\[hidden\]\s*\{\s*display: none/);
});

test('meeting removal uses the custom confirmation modal and keeps cancel, escape, and failure paths safe', () => {
  const script = read('assets/js/timetables.js');
  assert.doesNotMatch(script, /window\.(?:confirm|alert)\s*\(/);
  assert.match(script, /timetable-delete'\)\.addEventListener\('click', \(\) => openDeleteConfirmation\(state\)\)/);
  assert.match(script, /timetable-delete-cancel'\)\.addEventListener\('click', \(\) => closeDeleteConfirmation\(state\)\)/);
  assert.match(script, /timetable-confirm-overlay'\)\.addEventListener\('click', event =>\s*\{\s*if \(event\.target === event\.currentTarget\) closeDeleteConfirmation\(state\);/);
  assert.match(script, /if \(!document\.getElementById\('timetable-confirm-overlay'\)\.hidden\) closeDeleteConfirmation\(state\);\s*else if \(!document\.getElementById\('timetable-dialog-overlay'\)\.hidden\) closeDialog\(state\);/);
  assert.match(script, /async function deleteMeeting\(state\)[\s\S]*?await api\(\)\.deleteTimetableMeeting\(state\.editingId\);[\s\S]*?closeDeleteConfirmation\(state, false, true\);\s*closeDialog\(state\);\s*await load\(state\);/);
  assert.match(script, /catch \(error\) \{\s*state\.deletePending = false;\s*closeDeleteConfirmation\(state, false, true\);\s*const message = error\.message \|\| 'The meeting could not be removed\.';\s*document\.getElementById\('timetable-error'\)\.textContent = message;/);
  assert.match(script, /function closeDeleteConfirmation\(state, restoreFocus = true, force = false\)[\s\S]*?if \(restoreFocus\) state\.deleteReturnFocus\?\.focus\?\.\(\);/);

  const cancelFlow = script.match(/function closeDeleteConfirmation\(state, restoreFocus = true, force = false\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(cancelFlow, /timetable-dialog-overlay|closeDialog\(/, 'cancel only closes the confirmation and leaves editing open');
  const deleteFlow = script.match(/async function deleteMeeting\(state\) \{([\s\S]*?)\n  \}\n\n  async function load/)?.[1] || '';
  const failureFlow = deleteFlow.match(/catch \(error\) \{([\s\S]*?)\n    \} finally/)?.[1] || '';
  assert.doesNotMatch(failureFlow, /closeDialog\(/, 'failed removal leaves the meeting editor open');
  assert.match(failureFlow, /timetable-error'\)\.textContent/);
});

test('timetable actions toast their outcomes without changing dialog or navigation behavior', async () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', () => {",
    "  globalThis.timetableActions = { saveMeeting, deleteMeeting, closeDialog, renderWeek };\n  document.addEventListener('DOMContentLoaded', () => {"
  );

  function setup(editingId = null) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        hidden: false, disabled: false, textContent: '', value: '',
        focus() {}, removeAttribute() {}
      });
      return elements.get(id);
    };
    const toasts = [];
    const calls = { save: 0, remove: 0, reload: 0 };
    let failure = null;
    const context = {
      document: {
        body: { style: { overflow: '' } },
        addEventListener() {},
        getElementById: element
      },
      window: { EDUGNAY_API: {
        async saveTimetableMeeting() { calls.save += 1; if (failure) throw failure; },
        async deleteTimetableMeeting() { calls.remove += 1; if (failure) throw failure; },
        async getTimetable() { calls.reload += 1; return { year: null, assignments: [], meetings: [] }; }
      } },
      FormData: class {
        constructor(form) { this.values = form.values; }
        [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
      },
      showAppToast(message, type = 'success') { toasts.push([message, type]); }
    };
    vm.runInNewContext(source, context);
    const state = {
      role: 'admin', data: { year: null, assignments: [], meetings: [] }, week: '2026-10-19',
      editingId, editingAssignmentId: editingId ? '2' : null, deletePending: false,
      previousBodyOverflow: '', dialogReturnFocus: { focus() {} }
    };
    const form = { values: { assignmentId: '2', weekday: '1' }, reportValidity: () => true };
    const event = { currentTarget: form, preventDefault() {} };
    return { actions: context.timetableActions, state, event, element, calls, toasts,
      fail(error) { failure = error; } };
  }

  for (const [editingId, message] of [[null, 'Class meeting added.'], [10, 'Class meeting updated.']]) {
    const app = setup(editingId);
    await app.actions.saveMeeting(app.state, app.event);
    assert.deepEqual(app.toasts, [[message, 'success']]);
    assert.equal(app.calls.save, 1);
    assert.equal(app.calls.reload, 1);
    assert.equal(app.element('timetable-dialog-overlay').hidden, true);
  }

  const saveFailure = setup();
  saveFailure.fail(new Error('Meeting conflicts with another class.'));
  await saveFailure.actions.saveMeeting(saveFailure.state, saveFailure.event);
  assert.deepEqual(saveFailure.toasts, [['Meeting conflicts with another class.', 'error']]);
  assert.equal(saveFailure.element('timetable-error').textContent, 'Meeting conflicts with another class.');
  assert.equal(saveFailure.element('timetable-dialog-overlay').hidden, false);
  assert.equal(saveFailure.calls.reload, 0);

  const removal = setup(10);
  await removal.actions.deleteMeeting(removal.state);
  assert.deepEqual(removal.toasts, [['Class meeting removed.', 'success']]);
  assert.equal(removal.calls.remove, 1);
  assert.equal(removal.calls.reload, 1);
  assert.equal(removal.element('timetable-dialog-overlay').hidden, true);

  const removeFailure = setup(10);
  removeFailure.fail(new Error('Meeting could not be removed.'));
  await removeFailure.actions.deleteMeeting(removeFailure.state);
  assert.deepEqual(removeFailure.toasts, [['Meeting could not be removed.', 'error']]);
  assert.equal(removeFailure.element('timetable-error').textContent, 'Meeting could not be removed.');
  assert.equal(removeFailure.element('timetable-dialog-overlay').hidden, false);
  assert.equal(removeFailure.element('timetable-confirm-overlay').hidden, true);
  assert.equal(removeFailure.calls.reload, 0);

  const navigation = setup();
  navigation.state.role = 'teacher';
  navigation.actions.renderWeek(navigation.state);
  navigation.element('timetable-section').value = '2';
  navigation.actions.renderWeek(navigation.state);
  navigation.actions.closeDialog(navigation.state);
  assert.deepEqual(navigation.toasts, []);
});

test('schedule pages use the compact toolbar, icon headers, neutral count pill, and Class Management subject-card layout', () => {
  const css = read('assets/css/timetables.css');
  for (const [role, page] of [
    ['admin', 'timetables'], ['teacher', 'schedules'], ['student', 'schedules']
  ]) {
    const html = read(`views/${role}/edugnay-${role}-${page}.html`);
    assert.doesNotMatch(html, /timetable-hero/);
    assert.match(html, /timetable-heading-icon[^>]*aria-hidden="true"/);
    if (role !== 'admin') assert.match(html, /Weekly schedule/);
  }

  const adminHtml = read('views/admin/edugnay-admin-timetables.html');
  assert.match(adminHtml, /class="timetable-toolbar-filters"[\s\S]*?timetable-field[\s\S]*?timetable-field[\s\S]*?timetable-field[\s\S]*?<\/div>\s*<div class="timetable-toolbar-actions"><button class="timetable-button" id="timetable-add" type="button" disabled/);
  assert.match(adminHtml, /class="badge badge-gray" id="timetable-unscheduled-count"/);
  assert.match(adminHtml, /data-lucide="book-open"/);
  assert.match(css, /\.timetable-toolbar\s*\{[^}]*gap: 10px; padding: 12px/);
  assert.match(css, /\.timetable-toolbar-filters\s*\{[^}]*flex: 1 1 auto;[^}]*gap: 12px/);
  assert.match(css, /\.timetable-field\s*\{[^}]*flex: 0 1 240px;[^}]*min-width: 190px/);
  assert.match(css, /\.timetable-toolbar-actions\s*\{[^}]*gap: 12px; margin-left: 24px/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.timetable-toolbar\s*\{[^}]*flex-direction: column/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.timetable-toolbar-actions \.timetable-button\s*\{\s*width: 100%/);
  assert.match(css, /\.timetable-unscheduled-item\s*\{[^}]*padding: 16px;[^}]*border-radius: var\(--radius-md\);[^}]*background: var\(--theme-surface\)/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.timetable-unscheduled\s*\{\s*grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.timetable-unscheduled\s*\{\s*grid-template-columns: 1fr/);
});

test('empty unscheduled-subject results use the shared Academix empty-state component', () => {
  const script = read('assets/js/timetables.js');
  const sharedShell = read('assets/js/shell-common.js');
  assert.match(script, /window\.EDUGNAY_CONFIG\.renderPanelEmptyState\(\{\s*icon: 'calendar-check',\s*title: 'All subjects are scheduled',\s*text: 'Every subject assignment matching these filters already has a meeting\.'\s*\}\)/);
  assert.match(sharedShell, /function renderPanelEmptyState\(options = \{\}\)/);
});

test('read-only pages check the signed-in role before loading schedule data', () => {
  const script = read('assets/js/timetables.js');
  assert.match(script, /const currentUser = await api\(\)\.getCurrentUser\(\)/);
  assert.match(script, /currentUser\?\.role !== \(role === 'admin' \? 'school_admin' : role\)/);
  assert.match(script, /currentUser\?\.role !== expectedRole/);
});

test('every administrator, teacher, and student sidebar contains one static schedule link', () => {
  const sidebarPages = [];
  for (const role of ['admin', 'teacher', 'student']) {
    const directory = path.join(root, 'views', role);
    for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.html'))) {
      const html = read(`views/${role}/${filename}`);
      const sidebar = html.match(/<aside\b[^>]*class="[^"]*sidebar[^"]*"[\s\S]*?<\/aside>/)?.[0];
      if (sidebar) sidebarPages.push({ role, filename, sidebar });
    }
  }

  const counts = { admin: 0, teacher: 0, student: 0 };
  for (const { role, filename, sidebar } of sidebarPages) {
    const href = role === 'admin' ? 'edugnay-admin-timetables.html' : `edugnay-${role}-schedules.html`;
    const links = [...sidebar.matchAll(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>[\\s\\S]*?<\\/a>`, 'g'))];
    assert.equal(links.length, 1, `${role}/${filename} should have one static schedule link`);
    const active = /class="[^"]*\bactive\b/.test(links[0][0]);
    assert.equal(active, filename === (role === 'admin' ? 'edugnay-admin-timetables.html' : `edugnay-${role}-schedules.html`),
      `${role}/${filename} active schedule link`);
    counts[role] += 1;

    if (role === 'admin') {
      const mainStart = sidebar.indexOf('>Main</div>');
      const reportsStart = sidebar.indexOf('>Reports</div>');
      const classMgmtStart = sidebar.indexOf('Class Management');
      const scheduleStart = sidebar.indexOf(links[0][0]);
      assert.ok(mainStart >= 0 && classMgmtStart > mainStart && scheduleStart > classMgmtStart
        && (reportsStart < 0 || scheduleStart < reportsStart), `${role}/${filename} link should follow Class Management in Main`);
    } else {
      const dashboardStart = sidebar.indexOf('Dashboard</span>');
      const scheduleStart = sidebar.indexOf(links[0][0]);
      assert.ok(dashboardStart >= 0 && scheduleStart > dashboardStart, `${role}/${filename} link should follow Dashboard`);
    }
  }

  assert.deepEqual(counts, { admin: 12, teacher: 9, student: 10 });
  const common = read('assets/js/shell-common.js');
  assert.doesNotMatch(common, /dashboard\.after\(link\)|const page = role === 'admin'/,
    'schedule links must not be injected after page load');
});
