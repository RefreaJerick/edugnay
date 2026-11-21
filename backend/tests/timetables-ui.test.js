const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => pageFs.readFileSync(path.join(root, file), 'utf8');

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
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.todayActions = { goToToday, renderWeek };\n  document.addEventListener('DOMContentLoaded', async () => {"
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
  assert.match(css, /@media \(max-width: 340px\)\s*\{\s*\.timetable-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(css, /@media \(min-width: 1280px\) and \(max-width: 1699px\), \(min-width: 761px\) and \(max-width: 1180px\), \(min-width: 341px\) and \(max-width: 760px\)\s*\{\s*\.timetable-day-preview\s*\{\s*display: flex/);

  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.renderTimetableWeek = renderWeek;\n  document.addEventListener('DOMContentLoaded', async () => {"
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
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.renderTimetableWeek = renderWeek;\n  document.addEventListener('DOMContentLoaded', async () => {"
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

test('teacher and student dashboards omit today schedules but keep full schedule navigation', () => {
  for (const role of ['teacher', 'student']) {
    const html = read('views/' + role + '/edugnay-' + role + '-dashboard.html');
    assert.doesNotMatch(html, /timetable-preview|Today's Schedule|Loading today's classes/);
    assert.match(html, new RegExp('href="edugnay-' + role + '-schedules.html"'));
  }
  assert.doesNotMatch(read('assets/js/timetables.js'), /initPreview|timetable-preview/);
  assert.doesNotMatch(read('assets/css/timetables.css'), /timetable-preview/);
});

test('student, parent, and teacher dashboard announcement previews cap visible items at three', () => {
  const dashboards = [
    ['student', 'ANNOUNCEMENTS'],
    ['parent', 'DASHBOARD_ANNOUNCEMENTS'],
    ['teacher', 'TEACHER_DASHBOARD_ANNOUNCEMENTS']
  ];
  for (const [role, source] of dashboards) {
    const html = read('views/' + role + '/edugnay-' + role + '-dashboard.html');
    const match = html.match(/const visibleAnnouncements = ([^;\r\n]+);/);
    assert.ok(match, role + ' dashboard should build a visible announcement list');
    assert.ok(match[1].startsWith(source + '.filter('), role + ' access filtering should happen before limiting');
    assert.ok(match[1].indexOf('.filter(') < match[1].indexOf('.slice(0, 3)'), role + ' should limit the filtered list');
    assert.match(html, /visibleAnnouncements\.map\(item =>/);
    assert.match(html, /View all/);

    const evaluate = items => vm.runInNewContext(match[1], {
      ANNOUNCEMENTS: items,
      DASHBOARD_ANNOUNCEMENTS: items,
      TEACHER_DASHBOARD_ANNOUNCEMENTS: items,
      studentCanAccess: access => access?.visible !== false,
      teacherCanAccess: access => access?.visible !== false,
      window: { EDUGNAY_CONFIG: { isNarrativeReportsEnabled: () => false } }
    });
    for (const count of [0, 1, 3, 5]) {
      const items = Array.from({ length: count }, (_, index) => ({ id: String(index) }));
      assert.deepEqual(Array.from(evaluate(items), item => item.id), items.slice(0, 3).map(item => item.id));
    }
    const orderedItems = [
      { id: 'pinned first', pinned: true },
      { id: 'hidden by access', access: { visible: false } },
      { id: 'visible second' },
      { id: 'visible third' },
      { id: 'visible fourth' }
    ];
    assert.deepEqual(
      Array.from(evaluate(orderedItems), item => item.id),
      ['pinned first', 'visible second', 'visible third']
    );
  }
  assert.match(read('views/parent/edugnay-parent-dashboard.html'), /This Week/);
});

test('admin meeting form retains native date and time values for existing picker enhancement', () => {
  const html = read('views/admin/edugnay-admin-timetables.html');
  assert.match(html, /academic-date-picker\.js/);
  assert.match(html, /name="startDate" type="date" required/);
  assert.match(html, /name="endDate" type="date" required/);
  assert.match(html, /id="timetable-date-fields"/);
  assert.match(html, /id="timetable-elective-term-summary" hidden aria-live="polite" aria-atomic="true"/);
  assert.match(html, /<span>Class term<\/span>/);
  assert.match(html, /id="timetable-elective-term-range"/);
  assert.match(html, /id="timetable-elective-term-note"/);
  assert.match(html, /name="startTime" type="time" required/);
  assert.match(html, /name="endTime" type="time" required/);
});

test('SHS meeting dialog shows assigned term dates, preserves saved dates, and keeps regular dates editable', () => {
  const script = read('assets/js/timetables.js');
  const source = script.replace(
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.updateElectiveTermSummary = updateElectiveTermSummary;\n  document.addEventListener('DOMContentLoaded', async () => {"
  );
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: false, disabled: false, required: false });
    return elements.get(id);
  };
  const context = { Date, document: { addEventListener() {}, getElementById: element }, window: {} };
  vm.runInNewContext(source, context);
  const classes = [
    {
      electiveClassId: 10, startTermId: 1, endTermId: 1, startTermName: 'Term 1', endTermName: 'Term 1',
      startTermSequence: 1, endTermSequence: 1, firstTermStartDate: '2026-11-06', lastTermEndDate: '2026-12-31',
      startDate: null, endDate: null
    },
    {
      electiveClassId: 20, startTermId: 1, endTermId: 3, startTermName: 'Term 1', endTermName: 'Term 3',
      startTermSequence: 1, endTermSequence: 3, firstTermStartDate: '2026-11-06', lastTermEndDate: '2027-06-30',
      startDate: '2026-11-11', endDate: '2026-12-02'
    },
    {
      electiveClassId: 30, startTermId: 1, endTermId: 1, startTermName: 'Term 1', endTermName: 'Term 1',
      startTermSequence: 1, endTermSequence: 1, firstTermStartDate: null, lastTermEndDate: null,
      startDate: null, endDate: null
    },
    {
      electiveClassId: 40, startTermId: 1, endTermId: 1, startTermName: 'Term 1', endTermName: 'Term 1',
      startTermSequence: 1, endTermSequence: 1, firstTermStartDate: '2026-05-31', lastTermEndDate: '2026-12-31',
      startDate: null, endDate: null
    }
  ];
  const state = {
    data: { year: { startDate: '2026-06-01', endDate: '2027-06-30' }, electiveClasses: classes },
    editingMeeting: null
  };
  element('timetable-owner-type').value = 'elective';
  element('timetable-elective-class').value = '10';
  context.updateElectiveTermSummary(state);
  assert.equal(element('timetable-date-fields').hidden, true);
  assert.equal(element('timetable-elective-term-summary').hidden, false);
  assert.equal(element('timetable-start-date').disabled, true);
  assert.equal(element('timetable-end-date').disabled, true);
  assert.match(element('timetable-elective-term-range').textContent, /Term 1 · Nov 6–Dec 31, 2026/);
  assert.equal(element('timetable-elective-term-note').textContent, 'New meetings will cover the full term.');
  assert.equal(element('timetable-save').disabled, false);

  element('timetable-elective-class').value = '20';
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-range').textContent, /Term 1–Term 3 · Nov 6, 2026–Jun 30, 2027/);
  assert.equal(element('timetable-elective-term-note').textContent, 'New meetings will cover the full term.');
  assert.equal(element('timetable-save').disabled, false);

  element('timetable-elective-class').value = '30';
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-range').textContent, /^$/);
  assert.match(element('timetable-elective-term-note').textContent, /no valid assigned term dates/i);
  assert.equal(element('timetable-save').disabled, true);

  element('timetable-elective-class').value = '40';
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-note').textContent, /no valid assigned term dates/i);
  assert.equal(element('timetable-save').disabled, true);

  element('timetable-elective-class').value = '20';
  state.editingMeeting = { startDate: classes[1].startDate, endDate: classes[1].endDate };
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-range').textContent, /Term 1–Term 3/);
  assert.match(element('timetable-elective-term-note').textContent, /keep its saved dates: Nov 11.{1}Dec 2, 2026/i);
  assert.equal(element('timetable-save').disabled, false);

  element('timetable-elective-class').value = '10';
  state.editingMeeting = { startDate: '2026-11-11', endDate: '2026-12-02' };
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-note').textContent, /keep its saved dates: Nov 11.{1}Dec 2, 2026/i);
  assert.equal(element('timetable-save').disabled, false);
  state.editingMeeting = { startDate: '2026-10-01', endDate: '2026-12-02' };
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-note').textContent, /outside this class term.*Review the class term/i);
  assert.equal(element('timetable-save').disabled, true);

  element('timetable-elective-class').value = '';
  state.editingMeeting = null;
  context.updateElectiveTermSummary(state);
  assert.match(element('timetable-elective-term-range').textContent, /^$/);
  assert.match(element('timetable-elective-term-note').textContent, /choose an SHS class/i);
  assert.equal(element('timetable-save').disabled, true);

  element('timetable-owner-type').value = 'section';
  context.updateElectiveTermSummary(state);
  assert.equal(element('timetable-date-fields').hidden, false);
  assert.equal(element('timetable-elective-term-summary').hidden, true);
  assert.equal(element('timetable-start-date').disabled, false);
  assert.equal(element('timetable-end-date').disabled, false);
  assert.equal(element('timetable-start-date').required, true);
  assert.equal(element('timetable-end-date').required, true);
  assert.equal(element('timetable-save').disabled, false);
  assert.match(script, /timetable-elective-class'\)\.addEventListener\('change', \(\) => updateElectiveTermSummary\(state\)\)/);
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
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.dialogChoices = { renderDialogSections, renderDialogSubjects, openDialog };\n  document.addEventListener('DOMContentLoaded', async () => {"
  );
  class Select {
    constructor() { this.options = []; this.value = ''; this.disabled = false; }
    replaceChildren(...options) { this.options = options; this.value = ''; }
  }
  const elements = new Map([
    ['timetable-dialog-section', new Select()],
    ['timetable-assignment', new Select()],
    ['timetable-elective-class', new Select()]
  ]);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '' });
    return elements.get(id);
  };
  const dayOptions = [1, 2, 3, 4, 5, 6, 7].map(value => ({ value: String(value), checked: false, disabled: false }));
  const form = {
    elements: { assignmentId: element('timetable-assignment'), startTime: {}, endTime: {}, startDate: {}, endDate: {}, room: {} },
    reset() {}, querySelectorAll: () => dayOptions
  };
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
  assert.equal(dayOptions[0].checked, true);
  assert.equal(dayOptions[0].disabled, true);
  assert.equal(dayOptions[1].disabled, false);
  assert.equal(element('timetable-weekdays-note').hidden, false);
});

test('timetable events separate subject, time, class, and optional role details', () => {
  const script = read('assets/js/timetables.js');
  const css = read('assets/css/timetables.css');
  const source = script.replace(
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.renderTimetableEvent = eventHtml;\n  document.addEventListener('DOMContentLoaded', async () => {"
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

test('admin meeting drag moves a recurring card, preserves its details, and keeps click to edit', async () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.dragActions = { initMeetingDrag, moveMeeting };\n  document.addEventListener('DOMContentLoaded', async () => {"
  );
  const listeners = new Map();
  const listen = (map, type, handler) => map.set(type, [...(map.get(type) || []), handler]);
  const emit = (map, type, event) => (map.get(type) || []).forEach(handler => handler(event));
  const classes = () => {
    const values = new Set();
    return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
  };
  const gridListeners = new Map();
  const days = [1, 2, 3, 4, 5, 6, 7].map(value => ({ dataset: { weekday: String(value) }, classList: classes() }));
  const previews = [];
  const card = { dataset: { meetingId: '42' }, classList: classes(), focused: false,
    focus() { this.focused = true; }, closest(selector) {
      return selector === '[data-meeting-id]' ? this : selector === '.timetable-day[data-weekday]' ? days[0] : null;
    }, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 50 }; },
    cloneNode() {
      const preview = { classList: classes(), style: {}, tabIndex: 0, inert: false, attributes: {},
        removeAttribute(name) { delete this.attributes[name]; },
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.removed = true; } };
      previews.push(preview);
      return preview;
    } };
  days.forEach(day => { day.closest = selector => selector === '.timetable-day[data-weekday]' ? day : null; });
  const grid = { classList: classes(), contains: node => node === card || days.includes(node),
    addEventListener: (type, handler) => listen(gridListeners, type, handler),
    querySelector(selector) {
      if (selector === '.is-drop-target') return days.find(day => day.classList.contains('is-drop-target')) || null;
      const number = Number(selector.match(/data-weekday="(\d)"/)?.[1]);
      return days[number - 1] || null;
    } };
  const elements = new Map([['timetable-grid', grid], ['timetable-drag-status', { textContent: '' }]]);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false });
    return elements.get(id);
  };
  const saves = [];
  const electiveSaves = [];
  const toasts = [];
  let failure = null;
  let reloads = 0;
  const timers = [];
  const context = {
    document: { body: { appendChild(preview) { preview.appended = true; } },
      addEventListener: (type, handler) => listen(listeners, type, handler),
      getElementById: element, elementFromPoint: x => x === 30 ? null : days[x === 20 ? 1 : 0], querySelector: () => card },
    window: { innerWidth: 800, innerHeight: 600, EDUGNAY_API: {
      async saveTimetableMeeting(assignmentId, meetingId, values) {
        saves.push({ assignmentId, meetingId, values });
        if (failure) throw failure;
      },
      async saveElectiveTimetableMeeting(classId, meetingId, values) {
        electiveSaves.push({ classId, meetingId, values });
        if (failure) throw failure;
      },
      async getTimetable() { reloads += 1; return { year: null, assignments: [], meetings: [] }; }
    } },
    setTimeout(callback, delay) { const timer = { callback, delay, canceled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.canceled = true; },
    showAppToast(message, type = 'success') { toasts.push([message, type]); }
  };
  vm.runInNewContext(source, context);
  const meeting = { id: 42, assignmentId: 5, weekday: 1, subjectName: 'English', startTime: '09:00', endTime: '10:00',
    startDate: '2026-06-01', endDate: '2027-03-31', room: '204' };
  const state = { role: 'admin', data: { year: { status: 'active' }, meetings: [meeting] } };
  context.dragActions.initMeetingDrag(state);

  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, target: card, clientX: 0, clientY: 0 });
  assert.equal(previews.length, 0);
  emit(listeners, 'pointermove', { pointerId: 1, clientX: 20, clientY: 0, preventDefault() {} });
  assert.equal(previews.length, 1);
  assert.equal(previews[0].appended, true);
  assert.equal(previews[0].style.width, '100px');
  assert.equal(previews[0].style.transform, 'translate3d(20px, 8px, 0)');
  assert.equal(previews[0].attributes['aria-hidden'], 'true');
  assert.equal(previews[0].tabIndex, -1);
  assert.equal(previews[0].inert, true);
  assert.equal(days[1].classList.contains('is-drop-target'), true);
  emit(listeners, 'pointerup', { pointerId: 1 });
  assert.equal(previews[0].removed, true);
  let clickBlocked = false;
  emit(gridListeners, 'click', { preventDefault() { clickBlocked = true; }, stopImmediatePropagation() {} });
  assert.equal(clickBlocked, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0])), { assignmentId: 5, meetingId: 42, values: {
    weekday: 2, startTime: '09:00', endTime: '10:00', startDate: '2026-06-01', endDate: '2027-03-31', room: '204'
  } });
  assert.equal(reloads, 1);
  assert.deepEqual(toasts, [['Class meeting moved to Tuesday.', 'success']]);
  assert.equal(card.focused, true);
  assert.equal(grid.classList.contains('is-dragging'), false);
  timers.filter(timer => timer.delay === 0).forEach(timer => timer.callback());

  state.data = { year: { status: 'active' }, meetings: [meeting] };
  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 6, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointerup', { pointerId: 6 });
  assert.equal(previews.length, 1);
  let normalClickBlocked = false;
  emit(gridListeners, 'click', { preventDefault() { normalClickBlocked = true; }, stopImmediatePropagation() {} });
  assert.equal(normalClickBlocked, false);

  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 8, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointermove', { pointerId: 8, clientX: 20, clientY: 0, preventDefault() {} });
  emit(listeners, 'pointermove', { pointerId: 8, clientX: 30, clientY: 0, preventDefault() {} });
  emit(listeners, 'pointerup', { pointerId: 8 });
  assert.equal(saves.length, 1);
  assert.equal(previews[1].removed, true);

  state.data = { year: { status: 'active' }, meetings: [meeting] };
  failure = new Error('Schedule conflict on Tuesday.');
  emit(gridListeners, 'pointerdown', { pointerType: 'pen', button: 0, pointerId: 2, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointermove', { pointerId: 2, clientX: 20, clientY: 0, preventDefault() {} });
  emit(listeners, 'pointerup', { pointerId: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.deepEqual(toasts.at(-1), ['Schedule conflict on Tuesday.', 'error']);
  assert.equal(previews[2].removed, true);

  state.data.year.status = 'archived';
  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 3, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointermove', { pointerId: 3, clientX: 20, clientY: 0, preventDefault() {} });
  emit(listeners, 'pointerup', { pointerId: 3 });
  assert.equal(saves.length, 2);

  state.data.year.status = 'active';
  state.movePending = true;
  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 7, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointermove', { pointerId: 7, clientX: 20, clientY: 0, preventDefault() {} });
  emit(listeners, 'pointerup', { pointerId: 7 });
  assert.equal(saves.length, 2);
  state.movePending = false;

  emit(gridListeners, 'touchstart', { touches: [{ identifier: 4, clientX: 0, clientY: 0 }], target: card });
  let scrollBlocked = false;
  emit(gridListeners, 'touchmove', { touches: [{ identifier: 4, clientX: 20, clientY: 0 }], preventDefault() { scrollBlocked = true; } });
  assert.equal(scrollBlocked, false);
  assert.equal(timers.at(-1).canceled, true);
  assert.equal(saves.length, 2);
  assert.equal(previews.length, 3);

  emit(gridListeners, 'touchstart', { touches: [{ identifier: 5, clientX: 0, clientY: 100 }], target: card });
  timers.at(-1).callback();
  assert.equal(previews[3].style.transform, 'translate3d(8px, 26px, 0)');
  emit(gridListeners, 'touchmove', { touches: [{ identifier: 5, clientX: 20, clientY: 120 }], preventDefault() { scrollBlocked = true; } });
  assert.equal(scrollBlocked, true);
  assert.equal(previews[3].style.transform, 'translate3d(20px, 46px, 0)');
  emit(gridListeners, 'touchend', { changedTouches: [{ identifier: 5 }], preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves.length, 3);
  assert.equal(previews[3].removed, true);

  state.data = { year: { status: 'active' }, meetings: [meeting] };
  failure = null;
  emit(gridListeners, 'keydown', { target: card, key: ' ', preventDefault() {} });
  assert.equal(previews.length, 4);
  emit(gridListeners, 'keydown', { target: card, key: 'ArrowRight', preventDefault() {} });
  emit(gridListeners, 'keydown', { target: card, key: 'Enter', preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves.at(-1).values.weekday, 2);

  state.data = { year: { status: 'active' }, meetings: [meeting] };
  const beforeCancel = saves.length;
  emit(gridListeners, 'keydown', { target: card, key: ' ', preventDefault() {} });
  emit(gridListeners, 'keydown', { target: card, key: 'ArrowRight', preventDefault() {} });
  emit(gridListeners, 'keydown', { target: card, key: 'Escape', preventDefault() {} });
  assert.equal(saves.length, beforeCancel);
  assert.equal(days[1].classList.contains('is-drop-target'), false);

  state.data = { year: { status: 'active' }, meetings: [meeting] };
  emit(gridListeners, 'pointerdown', { pointerType: 'mouse', button: 0, pointerId: 9, target: card, clientX: 0, clientY: 0 });
  emit(listeners, 'pointermove', { pointerId: 9, clientX: 20, clientY: 0, preventDefault() {} });
  state.cancelDrag();
  assert.equal(previews[4].removed, true);
  assert.equal(days[1].classList.contains('is-drop-target'), false);

  const css = read('assets/css/timetables.css');
  assert.match(css, /\.timetable-drag-preview\s*\{[^}]*pointer-events: none/);

  await context.dragActions.moveMeeting(state, { ...meeting, electiveClassId: 8, assignmentId: null }, 3);
  assert.equal(electiveSaves.length, 1);
  assert.equal(electiveSaves[0].values.weekday, 3);
});

test('timetable surfaces use shared design tokens and Academix modal structure', () => {
  const css = read('assets/css/timetables.css');
  const html = read('views/admin/edugnay-admin-timetables.html');
  assert.match(css, /\.timetable-dialog\s*\{\s*width: min\(480px, calc\(100vw - 32px\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[^\n]*\.timetable-dialog\s*\{\s*width: min\(480px, calc\(100vw - 20px\)\)/);
  assert.match(css, /\.timetable-confirm-dialog\s*\{\s*width: min\(440px, calc\(100vw - 32px\)\)/);
  assert.match(css, /\.timetable-card\s*\{[^}]*border-radius: var\(--panel-radius\)/);
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

test('admin meeting form offers seven keyboard-accessible day buttons', () => {
  const html = read('views/admin/edugnay-admin-timetables.html');
  const css = read('assets/css/timetables.css');
  assert.match(html, /<fieldset class="timetable-weekdays">/);
  assert.deepEqual([...html.matchAll(/type="checkbox" name="weekdays" value="([1-7])" aria-label="[A-Za-z]+"/g)].map(match => match[1]),
    ['1', '2', '3', '4', '5', '6', '7']);
  assert.match(css, /\.timetable-weekday-options input:checked \+ span/);
  assert.match(css, /\.timetable-weekday-options input:focus-visible \+ span/);
  assert.match(css, /\.timetable-weekday-options input\[type="checkbox"\]\s*\{[^}]*width: 1px !important; height: 1px !important; min-height: 1px !important;[^}]*clip-path: inset\(50%\)/);
  assert.doesNotMatch(html, /id="timetable-error"/);
});

test('meeting removal uses the custom confirmation modal and keeps cancel, escape, and failure paths safe', () => {
  const script = read('assets/js/timetables.js');
  assert.doesNotMatch(script, /window\.(?:confirm|alert)\s*\(/);
  assert.match(script, /timetable-delete'\)\.addEventListener\('click', \(\) => openDeleteConfirmation\(state\)\)/);
  assert.match(script, /timetable-delete-cancel'\)\.addEventListener\('click', \(\) => closeDeleteConfirmation\(state\)\)/);
  assert.match(script, /timetable-confirm-overlay'\)\.addEventListener\('click', event =>\s*\{\s*if \(event\.target === event\.currentTarget\) closeDeleteConfirmation\(state\);/);
  assert.match(script, /if \(!document\.getElementById\('timetable-confirm-overlay'\)\.hidden\) closeDeleteConfirmation\(state\);\s*else if \(!document\.getElementById\('timetable-dialog-overlay'\)\.hidden\) closeDialog\(state\);/);
  assert.match(script, /async function deleteMeeting\(state\)[\s\S]*?await api\(\)\.deleteTimetableMeeting\(state\.editingId\);[\s\S]*?closeDeleteConfirmation\(state, false, true\);\s*closeDialog\(state\);\s*await load\(state\);/);
  assert.match(script, /catch \(error\) \{\s*state\.deletePending = false;\s*closeDeleteConfirmation\(state, false, true\);\s*const message = error\.message \|\| 'The meeting could not be removed\.';\s*showAppToast\(message, 'error'\);/);
  assert.match(script, /function closeDeleteConfirmation\(state, restoreFocus = true, force = false\)[\s\S]*?if \(restoreFocus\) state\.deleteReturnFocus\?\.focus\?\.\(\);/);

  const cancelFlow = script.match(/function closeDeleteConfirmation\(state, restoreFocus = true, force = false\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(cancelFlow, /timetable-dialog-overlay|closeDialog\(/, 'cancel only closes the confirmation and leaves editing open');
  const deleteFlow = script.match(/async function deleteMeeting\(state\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function load/)?.[1] || '';
  const failureFlow = deleteFlow.match(/catch \(error\) \{([\s\S]*?)\r?\n    \} finally/)?.[1] || '';
  assert.doesNotMatch(failureFlow, /closeDialog\(/, 'failed removal leaves the meeting editor open');
  assert.match(failureFlow, /showAppToast\(message, 'error'\)/);
  assert.doesNotMatch(failureFlow, /timetable-error'\)/);
});

test('timetable actions toast their outcomes without changing dialog or navigation behavior', async () => {
  const source = read('assets/js/timetables.js').replace(
    "  document.addEventListener('DOMContentLoaded', async () => {",
    "  globalThis.timetableActions = { saveMeeting, deleteMeeting, closeDialog, renderWeek };\n  document.addEventListener('DOMContentLoaded', async () => {"
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
    const calls = { save: 0, remove: 0, reload: 0, payload: null };
    let failure = null;
    const context = {
      document: {
        body: { style: { overflow: '' } },
        addEventListener() {},
        getElementById: element
      },
      window: { EDUGNAY_API: {
        async saveTimetableMeeting(_assignmentId, _meetingId, values) { calls.save += 1; calls.payload = values; if (failure) throw failure; },
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
    const dayOptions = [1, 2, 3].map(value => ({ value: String(value), checked: value === 1, focus() {} }));
    const form = { values: { assignmentId: '2' }, reportValidity: () => true,
      querySelectorAll: selector => selector.includes(':checked') ? dayOptions.filter(option => option.checked) : dayOptions,
      querySelector: () => dayOptions[0] };
    if (editingId) state.editingMeeting = { weekday: 1 };
    const event = { currentTarget: form, preventDefault() {} };
    return { actions: context.timetableActions, state, event, element, calls, toasts, dayOptions,
      fail(error) { failure = error; } };
  }

  for (const [editingId, message] of [[null, '1 class meeting added.'], [10, 'Class meeting updated.']]) {
    const app = setup(editingId);
    await app.actions.saveMeeting(app.state, app.event);
    assert.deepEqual(app.toasts, [[message, 'success']]);
    assert.equal(app.calls.save, 1);
    assert.equal(app.calls.reload, 1);
    assert.equal(app.element('timetable-dialog-overlay').hidden, true);
  }

  const multiple = setup();
  multiple.dayOptions[1].checked = multiple.dayOptions[2].checked = true;
  await multiple.actions.saveMeeting(multiple.state, multiple.event);
  assert.deepEqual(Array.from(multiple.calls.payload.weekdays), [1, 2, 3]);
  assert.deepEqual(multiple.toasts, [['3 class meetings added.', 'success']]);

  const copied = setup(10);
  copied.dayOptions[1].checked = copied.dayOptions[2].checked = true;
  await copied.actions.saveMeeting(copied.state, copied.event);
  assert.equal(copied.calls.payload.weekday, 1);
  assert.deepEqual(Array.from(copied.calls.payload.copyToWeekdays), [2, 3]);
  assert.deepEqual(copied.toasts, [['Class meeting updated and 2 days added.', 'success']]);

  const noDays = setup();
  noDays.dayOptions[0].checked = false;
  await noDays.actions.saveMeeting(noDays.state, noDays.event);
  assert.equal(noDays.calls.save, 0);
  assert.deepEqual(noDays.toasts, [['Choose at least one day.', 'error']]);

  const saveFailure = setup();
  saveFailure.fail(new Error('Meeting conflicts with another class.'));
  await saveFailure.actions.saveMeeting(saveFailure.state, saveFailure.event);
  assert.deepEqual(saveFailure.toasts, [['Meeting conflicts with another class.', 'error']]);
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

  assert.ok(Object.values(counts).every(count => count > 0));
  const common = read('assets/js/shell-common.js');
  assert.doesNotMatch(common, /dashboard\.after\(link\)|const page = role === 'admin'/,
    'schedule links must not be injected after page load');
});
