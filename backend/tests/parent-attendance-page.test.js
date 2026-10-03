const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-attendance.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(Boolean);

function createPage(api) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', innerHTML: '', hidden: false, disabled: false,
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, setAttribute() {}, replaceChildren() { this.innerHTML = ''; }
      });
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    window: {
      EDUGNAY_API: api,
      EDUGNAY_CONFIG: {
        escapeHtml: value => String(value),
        renderPanelEmptyState: ({ title }) => title
      }
    },
    lucide: { createIcons() {} }
  });
  new vm.Script(script).runInContext(context);
  return {
    elements,
    load: () => vm.runInContext('loadAttendance()', context),
    selectChild: id => vm.runInContext(`switchChild('${id}', { classList: { add() {} } })`, context)
  };
}

test('parent attendance uses API children, records, and school date', async () => {
  const page = createPage({
    isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', sectionName: 'St. Matthew' },
      { studentId: '5', displayName: 'Maya', sectionName: 'St. Luke' }
    ],
    getParentAttendance: async () => ({
      currentDate: '2026-10-02',
      records: [{ studentId: '4', subjectId: '2', subjectName: 'English', date: '2026-10-02', status: 'present' }]
    })
  });
  await page.load();
  assert.match(page.elements.get('child-switcher').innerHTML, /Juan/);
  assert.match(page.elements.get('child-switcher').innerHTML, /Maya/);
  assert.match(page.elements.get('cal-grid').innerHTML, /cal-day recorded today/);
  assert.match(page.elements.get('summary-strip').innerHTML, /Subject sessions present/);
  assert.equal(page.elements.get('attendance-load-state').hidden, true);
  page.selectChild('5');
  assert.match(page.elements.get('summary-strip').textContent, /No subject attendance/);
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
});

test('missing API configuration shows an error instead of demo attendance', async () => {
  const page = createPage({ isBackendAvailable: false });
  await page.load();
  assert.match(page.elements.get('attendance-load-message').textContent, /not configured/);
  assert.equal(page.elements.get('attendance-retry').hidden, false);
  assert.equal(page.elements.get('child-switcher').innerHTML, '');
});
