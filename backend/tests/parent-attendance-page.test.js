const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-attendance.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function loadAttendance'));
const shared = fs.readFileSync(path.join(__dirname, '../../assets/js/attendance-history.js'), 'utf8');

function createPage(api) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const listeners = {};
        const classNames = new Set();
        elements.set(id, {
          textContent: '', innerHTML: '', hidden: false, disabled: false, listeners,
          classList: {
            add(name) { classNames.add(name); },
            remove(name) { classNames.delete(name); },
            toggle(name, enabled) { if (enabled) classNames.add(name); else classNames.delete(name); },
            contains(name) { return classNames.has(name); }
          },
          addEventListener(type, listener) { listeners[type] = listener; }, setAttribute() {}, replaceChildren() { this.innerHTML = ''; },
          querySelector() { return { addEventListener() {} }; }
        });
      }
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    window: {
      EDUGNAY_API: api,
      lucide: { createIcons() {} },
      EDUGNAY_AVATAR: { html: person => `<span>${String(person.displayName || '')}</span>` },
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: ({ title, text }) => `${title}: ${text}`,
        renderPanelSkeleton: ({ kind, label }) => `<div class="panel-skeleton panel-skeleton--${kind}" role="status" aria-busy="true">${label}</div>`
      }
    },
    lucide: { createIcons() {} }
  });
  new vm.Script(shared).runInContext(context);
  new vm.Script(script).runInContext(context);
  vm.runInContext('attendanceHistory = window.createAttendanceHistory({ hasSelection: false })', context);
  return {
    elements,
    load: () => vm.runInContext('loadAttendance()', context),
    selectChild: id => vm.runInContext(`switchChild('${id}')`, context)
  };
}

test('parent attendance uses API children, records, and school date', async () => {
  assert.match(html, /css\/timetables\.css/);
  assert.match(html, /class="timetable-week-controls"/);
  assert.match(html, /id="cal-today"/);
  const page = createPage({
    isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', sectionName: 'St. Matthew' },
      { studentId: '5', displayName: 'Maya', sectionName: 'St. Luke' }
    ],
    getParentAttendance: async () => ({
      currentDate: '2026-10-18',
      records: [
        { studentId: '4', subjectId: '2', subjectName: 'English', date: '2026-10-18', status: 'present' },
        { studentId: '4', subjectId: '3', subjectName: 'Science', date: '2026-10-18', status: 'late' }
      ]
    })
  });
  await page.load();
  assert.match(page.elements.get('child-switcher').innerHTML, /Juan/);
  assert.match(page.elements.get('child-switcher').innerHTML, /Maya/);
  const calendar = page.elements.get('cal-grid').innerHTML;
  assert.match(calendar, /<button class="cal-day recorded today"\s+data-attendance-day="18"/);
  assert.match(calendar, /data-attendance-day="18"[^>]*><div class="cal-day-num">18<\/div><div class="cal-day-dot"><\/div>/);
  assert.match(calendar, /class="cal-day weekend " disabled data-attendance-day="4"/);
  assert.match(calendar, /class="cal-day future " disabled data-attendance-day="19"/);
  assert.match(page.elements.get('summary-strip').innerHTML, /attendance-stat-label-full">Subject sessions present/);
  assert.match(page.elements.get('summary-strip').innerHTML, /attendance-stat-label-compact">Present/);
  assert.doesNotMatch(page.elements.get('summary-strip').innerHTML, /stat-card-trend/);
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
  page.elements.get('cal-grid').listeners.click({ target: { closest: () => ({ dataset: { attendanceDay: '18' } }) } });
  assert.equal(page.elements.get('dayDetailModal').classList.contains('open'), true);
  const detail = page.elements.get('day-detail-modal-content').innerHTML;
  assert.match(detail, /English/);
  assert.match(detail, /Science/);
  assert.match(detail, /badge-green/);
  assert.match(detail, /badge-orange/);
  assert.doesNotMatch(detail, /day-detail-banner|subject-dot|ddb-icon/);
  page.selectChild('5');
  assert.equal(page.elements.get('summary-strip').hidden, true);
  assert.equal(page.elements.get('summary-strip').textContent, '');
  assert.match(page.elements.get('cal-month-label').textContent, /October 2026/);
  const emptyCalendar = page.elements.get('cal-grid').innerHTML;
  assert.equal((emptyCalendar.match(/data-attendance-day=/g) || []).length, 31);
  assert.match(emptyCalendar, /class="cal-day [^"]*today"/);
  assert.doesNotMatch(emptyCalendar, /cal-day recorded|cal-day-dot|No attendance calendar/);
  assert.equal(page.elements.get('cal-prev').disabled, false);
  assert.equal(page.elements.get('cal-next').disabled, false);
  assert.equal(page.elements.get('cal-today').disabled, true);
  page.elements.get('cal-next').listeners.click();
  assert.match(page.elements.get('cal-month-label').textContent, /November 2026/);
  assert.equal(page.elements.get('cal-today').disabled, false);
  page.elements.get('cal-today').listeners.click();
  assert.match(page.elements.get('cal-month-label').textContent, /October 2026/);
  assert.equal(page.elements.get('cal-today').disabled, true);
  page.elements.get('cal-grid').listeners.click({ target: { closest: () => ({ dataset: { attendanceDay: '16' } }) } });
  assert.equal(page.elements.get('dayDetailModal').classList.contains('open'), true);
  assert.match(page.elements.get('day-detail-modal-content').innerHTML, /No attendance records: No subject attendance is available for this day\./);
  page.selectChild('4');
  assert.equal(page.elements.get('summary-strip').hidden, false);
  assert.match(page.elements.get('summary-strip').innerHTML, /attendance-stat-label-full">Subject sessions present/);
});

test('parent attendance and dashboard retain SHS class records', async () => {
  const record = { studentId: '4', subjectId: null, electiveClassId: '88',
    subjectName: 'Creative Writing', className: 'Class A', date: '2026-10-18', status: 'late' };
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', sectionName: 'A' }],
    getParentAttendance: async () => ({ currentDate: '2026-10-18', records: [record] })
  });
  await page.load();
  assert.match(page.elements.get('cal-grid').innerHTML, /cal-day recorded today/);
  page.elements.get('cal-grid').listeners.click({ target: { closest: () => ({ dataset: { attendanceDay: '18' } }) } });
  assert.match(page.elements.get('day-detail-modal-content').innerHTML, /Creative Writing · Class A/);

  const dashboard = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-dashboard.html'), 'utf8');
  const helper = dashboard.match(/function getDashboardAttendance[\s\S]*?(?=\n\s*const CHILD_DASHBOARD_RECORDS)/)?.[0];
  assert.ok(helper);
  const context = vm.createContext({ backendAttendanceRecords: [record],
    ATTENDANCE_SUBJECT_META: {} });
  const result = vm.runInContext(`${helper}\ngetDashboardAttendance('4', '2026-10-18')`, context);
  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects[0].name, 'Creative Writing · Class A');
});

test('failed attendance request clears children and offers retry without sample data', async () => {
  let fail = false;
  const page = createPage({
    isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan' }],
    getParentAttendance: async () => {
      if (fail) throw new Error('Attendance could not be loaded.');
      return { currentDate: '2026-10-02', records: [] };
    }
  });
  await page.load();
  fail = true;
  await page.load();
  assert.equal(page.elements.get('child-switcher').innerHTML, '');
  assert.equal(page.elements.get('attendance-retry').hidden, false);
  assert.match(page.elements.get('attendance-load-message').textContent, /Attendance could not be loaded/);
  fail = false;
  await page.load();
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
  assert.match(page.elements.get('child-switcher').innerHTML, /Juan/);
});

test('invalid school date does not fall back to the device date', async () => {
  const page = createPage({
    isBackendAvailable: true,
    getParentChildren: async () => [],
    getParentAttendance: async () => ({ currentDate: '2026-02-30', records: [] })
  });
  await page.load();
  assert.match(page.elements.get('attendance-load-message').textContent, /response is incomplete/);
  assert.equal(page.elements.get('attendance-retry').hidden, false);
});

test('parent with no linked children sees the empty state', async () => {
  const page = createPage({
    isBackendAvailable: true,
    getParentChildren: async () => [],
    getParentAttendance: async () => ({ currentDate: '2026-10-02', records: [] })
  });
  await page.load();
  assert.match(page.elements.get('child-switcher').innerHTML, /No linked children/);
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
  assert.equal(page.elements.get('summary-strip').hidden, false);
  assert.equal(page.elements.get('summary-strip').textContent, 'Select a linked child to view attendance.');
  assert.equal(page.elements.get('cal-prev').disabled, true);
  assert.equal(page.elements.get('cal-next').disabled, true);
  assert.equal(page.elements.get('cal-today').disabled, true);
});

test('missing API configuration shows an error instead of demo attendance', async () => {
  const page = createPage({ isBackendAvailable: false });
  await page.load();
  assert.match(page.elements.get('attendance-load-message').textContent, /not configured/);
  assert.equal(page.elements.get('attendance-retry').hidden, false);
  assert.equal(page.elements.get('child-switcher').innerHTML, '');
});
