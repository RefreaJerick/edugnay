const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'views/student/edugnay-student-attendance.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(Boolean);
const shared = fs.readFileSync(path.join(root, 'assets/js/attendance-history.js'), 'utf8');

function createPage(api, attendanceEnabled = true) {
  const elements = new Map();
  const redirected = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', innerHTML: '', hidden: false, disabled: false,
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, setAttribute() {},
        querySelector() { return { addEventListener() {} }; }
      });
      return elements.get(id);
    },
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    window: {
      EDUGNAY_API: api,
      EDUGNAY_SCHOOL_READY: Promise.resolve(),
      EDUGNAY_API_PORTAL_FEATURES: { attendanceEnabled },
      EDUGNAY_CONFIG: { escapeHtml: value => String(value), renderPanelEmptyState: ({ title }) => title, isAttendanceEnabled: () => attendanceEnabled },
      lucide: { createIcons() {} },
      location: { replace: value => redirected.push(value) }
    },
    lucide: { createIcons() {} }
  });
  new vm.Script(shared).runInContext(context);
  new vm.Script(script).runInContext(context);
  vm.runInContext('attendanceHistory = window.createAttendanceHistory()', context);
  return { elements, redirected, context, load: () => vm.runInContext('loadAttendance()', context) };
}

test('student page uses the parent attendance layout without a child switcher', () => {
  assert.match(html, /parent\/attendance\.css/);
  assert.match(html, /attendance-history\.js/);
  assert.match(html, /id="summary-strip"/);
  assert.match(html, /id="cal-grid"/);
  assert.match(html, /id="flagged-list"/);
  assert.match(html, /id="dayDetailModal"/);
  assert.doesNotMatch(html, /id="child-switcher"/);
  for (const filename of fs.readdirSync(path.join(root, 'views/student')).filter(name => name.endsWith('.html'))) {
    const page = fs.readFileSync(path.join(root, 'views/student', filename), 'utf8');
    assert.match(page, /href="edugnay-student-attendance\.html"/, filename);
  }
});

test('student sees subject-session counts, calendar, flagged days, and day details', async () => {
  const page = createPage({
    isBackendAvailable: true,
    getStudentAttendance: async () => ({ currentDate: '2026-10-02', records: [
      { subjectId: '1', subjectName: 'English', date: '2026-10-02', status: 'present' },
      { subjectId: '2', subjectName: 'Math', date: '2026-10-02', status: 'absent' },
      { subjectId: '3', subjectName: 'Science', date: '2026-09-30', status: 'late' },
      { subjectId: '4', subjectName: 'Filipino', date: '2026-09-30', status: 'excused' }
    ] })
  });
  await page.load();
  assert.match(page.elements.get('summary-strip').innerHTML, /Subject sessions present/);
  assert.match(page.elements.get('summary-strip').innerHTML, /Subject sessions absent/);
  assert.match(page.elements.get('cal-grid').innerHTML, /cal-day recorded today/);
  assert.match(page.elements.get('flagged-list').innerHTML, /Absent in one or more recorded subjects/);
  vm.runInContext('attendanceHistory.selectDay(2)', page.context);
  assert.match(page.elements.get('day-detail-modal-content').innerHTML, /English/);
  assert.match(page.elements.get('day-detail-modal-content').innerHTML, /badge-red/);
  vm.runInContext('attendanceHistory.changeMonth(-1)', page.context);
  assert.match(page.elements.get('cal-month-label').textContent, /September/);
  assert.match(page.elements.get('summary-strip').innerHTML, /Subject sessions late/);
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
});

test('student empty, failure, and retry states do not show sample attendance', async () => {
  let fail = false;
  const page = createPage({
    isBackendAvailable: true,
    getStudentAttendance: async () => {
      if (fail) throw new Error('Attendance could not be loaded.');
      return { currentDate: '2026-10-02', records: [] };
    }
  });
  await page.load();
  assert.match(page.elements.get('summary-strip').textContent, /No subject attendance/);
  fail = true;
  await page.load();
  assert.equal(page.elements.get('attendance-retry').hidden, false);
  assert.match(page.elements.get('attendance-load-message').textContent, /could not be loaded/);
  fail = false;
  await page.load();
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
  const unavailable = createPage({ isBackendAvailable: false });
  await unavailable.load();
  assert.match(unavailable.elements.get('attendance-load-message').textContent, /not configured/);
});

test('student page redirects when attendance is disabled', async () => {
  let requested = false;
  const page = createPage({ isBackendAvailable: true, getStudentAttendance: async () => { requested = true; } }, false);
  await page.load();
  assert.equal(requested, false);
  assert.deepEqual(page.redirected, ['./edugnay-student-dashboard.html']);
});
