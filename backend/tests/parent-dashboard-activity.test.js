const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../../assets/js/parent/dashboard.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../assets/css/parent/dashboard.css'), 'utf8');

function sourceBetween(start, end) {
  const first = script.indexOf(start);
  const last = script.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `missing dashboard source between ${start} and ${end}`);
  return script.slice(first, last);
}

const weekDaysSource = sourceBetween('function dashboardWeekDays(today) {', '\n\n    const today = new Date();');
const upcomingSource = sourceBetween('function getUpcomingAssignments(assignments, currentDate) {', '\n    function renderWeekCalendar() {');

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function createAssignmentFlow(request) {
  const container = { innerHTML: '' };
  const strip = { hidden: false };
  const retry = { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  const attendanceTab = { classList: classList() };
  const assignmentsTab = { classList: classList() };
  const attendancePane = { classList: classList() };
  const assignmentsPane = { classList: classList() };
  const elements = {
    'assignments-detail': container, 'day-strip': strip,
    'pane-attendance': attendancePane, 'pane-assignments': assignmentsPane,
    'retry-upcoming-assignments': retry
  };
  const context = vm.createContext({
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector === '.mini-tab' ? [attendanceTab, assignmentsTab]
        : selector === '.mini-pane' ? [attendancePane, assignmentsPane] : []
    },
    window: {
      EDUGNAY_API: { getParentChildAssignments: request },
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: ({ title, text }) => `${title}: ${text}`
      }
    },
    lucide: { createIcons() {} }
  });
  new vm.Script(`
    let assignmentsRequestId = 0;
    let currentChild = '1';
    let currentDay = 'sun';
    let activeDailyTab = 'attendance';
    let PARENT_CHILDREN_ERROR = '';
    let backendCurrentDate = '2026-11-08';
    ${upcomingSource}
    globalThis.flow = {
      load: renderUpcomingAssignments,
      tab: (name, button) => switchMiniTab(name, button),
      activate: () => { activeDailyTab = 'assignments'; },
      selectChild: id => { currentChild = id; },
      day: () => currentDay
    };
  `).runInContext(context);
  return { flow: context.flow, container, strip, retry, attendanceTab, assignmentsTab };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('attendance strip selects Sunday from the school date and spans week boundaries', () => {
  const schoolStart = script.indexOf('const [year, month, day] = backendCurrentDate.split');
  const schoolEnd = script.indexOf('          currentChild = PARENT_CHILDREN[0]', schoolStart);
  assert.ok(schoolStart >= 0 && schoolEnd > schoolStart);
  const context = vm.createContext({});
  new vm.Script(`${weekDaysSource}
    let backendCurrentDate = '2026-11-08';
    const DAYS = dashboardWeekDays(new Date(2026, 10, 7));
    let currentDay = 'sat';
    ${script.slice(schoolStart, schoolEnd)}
    globalThis.result = { days: DAYS, selected: currentDay };
  `).runInContext(context);
  assert.deepEqual(Array.from(context.result.days, day => day.key), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  assert.equal(context.result.days[6].isoDate, '2026-11-08');
  assert.equal(context.result.selected, 'sun');
  assert.equal(vm.runInContext('dashboardWeekDays(new Date(2027, 0, 3))[0].isoDate', context), '2026-12-28');
  assert.equal(vm.runInContext('dashboardWeekDays(new Date(2027, 0, 3))[6].isoDate', context), '2027-01-03');
  assert.match(script, /attendance: Object\.fromEntries\(DAYS\.map\(/);
});

test('Attendance opens first and the date strip is hidden only on the Assignments tab', async () => {
  const flow = createAssignmentFlow(async id => ({ studentId: id, currentDate: '2026-11-08', assignments: [] }));
  assert.match(html, /id="dailyActivityTitle">Attendance &amp; Assignments/);
  assert.match(html, /class="mini-tab active"[\s\S]*?Attendance/);
  assert.match(css, /\.day-strip\[hidden\]\s*\{\s*display:\s*none;/);
  assert.equal(flow.strip.hidden, false);
  flow.flow.tab('assignments', flow.assignmentsTab);
  assert.equal(flow.strip.hidden, true);
  flow.flow.tab('attendance', flow.attendanceTab);
  assert.equal(flow.strip.hidden, false);
  assert.equal(flow.flow.day(), 'sun');
  await new Promise(resolve => setImmediate(resolve));
});

test('upcoming list includes due-today work, sorts by due date, and limits results to three', async () => {
  const flow = createAssignmentFlow(async id => ({ studentId: id, currentDate: '2026-11-08', assignments: [
    { title: 'Fourth', subjectName: 'Science', dueDate: '2026-11-11', submissionStatus: 'pending' },
    { title: 'Late', subjectName: 'Math', dueDate: '2026-11-07', submissionStatus: 'not_submitted' },
    { title: 'Elective', subjectName: 'Creative Writing', electiveClassName: 'Class A', dueDate: '2026-11-10', submissionStatus: 'pending' },
    { title: 'Today', subjectName: 'Communication', communicationComponentName: 'Effective Communication', dueDate: '2026-11-08', submissionStatus: 'pending' },
    { title: 'Undated', subjectName: 'English', dueDate: null, submissionStatus: 'pending' },
    { title: 'Tomorrow', subjectName: 'English', dueDate: '2026-11-09', submissionStatus: 'submitted' }
  ] }));
  flow.flow.activate();
  await flow.flow.load();
  const content = flow.container.innerHTML;
  assert.ok(content.indexOf('Today') < content.indexOf('Tomorrow'));
  assert.ok(content.indexOf('Tomorrow') < content.indexOf('Elective'));
  assert.match(content, /Effective Communication/);
  assert.match(content, /Creative Writing · Class A/);
  assert.match(content, /Pending/);
  assert.match(content, /Submitted/);
  assert.doesNotMatch(content, /Late|Undated|Fourth/);
  assert.equal((content.match(/class="assignment-row"/g) || []).length, 3);
});

test('a previous child response cannot replace the selected child assignments', async () => {
  const first = deferred();
  const second = deferred();
  const flow = createAssignmentFlow(id => id === '1' ? first.promise : second.promise);
  flow.flow.activate();
  const previousRequest = flow.flow.load();
  flow.flow.selectChild('2');
  const currentRequest = flow.flow.load();
  second.resolve({ studentId: '2', currentDate: '2026-11-08', assignments: [
    { title: 'Current child task', subjectName: 'Science', dueDate: '2026-11-09', submissionStatus: 'pending' }
  ] });
  await currentRequest;
  first.resolve({ studentId: '1', currentDate: '2026-11-08', assignments: [
    { title: 'Previous child task', subjectName: 'English', dueDate: '2026-11-09', submissionStatus: 'pending' }
  ] });
  await previousRequest;
  assert.match(flow.container.innerHTML, /Current child task/);
  assert.doesNotMatch(flow.container.innerHTML, /Previous child task/);
});

test('failed and empty upcoming requests show useful states and allow retry', async () => {
  let fail = true;
  const flow = createAssignmentFlow(async id => {
    if (fail) throw new Error('Connection failed');
    return { studentId: id, currentDate: '2026-11-08', assignments: [] };
  });
  flow.flow.activate();
  await flow.flow.load();
  assert.match(flow.container.innerHTML, /Assignments could not be loaded/);
  assert.match(flow.container.innerHTML, /Try again/);
  fail = false;
  await flow.retry.listeners.click();
  assert.match(flow.container.innerHTML, /No upcoming assignments/);
  flow.flow.selectChild(null);
  await flow.flow.load();
  assert.match(flow.container.innerHTML, /No assignment data/);
});
