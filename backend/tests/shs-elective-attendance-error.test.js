const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
const loadStart = source.indexOf('  function localToday() {');
const loadEnd = source.indexOf('  async function loadAttendanceHistory(', loadStart);
const renderStart = source.indexOf('  function renderAttendance() {');
const renderEnd = source.indexOf('  async function openQrAttendance()', renderStart);
assert.ok(loadStart >= 0 && loadEnd > loadStart && renderStart >= 0 && renderEnd > renderStart);

function harness() {
  const button = () => ({ disabled: false, onclick: null });
  const save = button();
  const allPresent = button();
  const qr = button();
  const warningTitle = { textContent: '' };
  const warningSub = { textContent: '' };
  const warning = {
    hidden: true, style: { display: 'none' },
    querySelector(selector) { return selector === '.publish-info-title' ? warningTitle : warningSub; }
  };
  const ids = Object.fromEntries(['attendancePanelSub', 'attDate', 'attPanelTitle',
    'countP', 'countA', 'countL', 'countE'].map(id => [id, { value: '', textContent: '', innerHTML: '' }]));
  ids.qrAttendanceButton = qr;
  ids.attLockBanner = warning;
  const panel = {
    querySelector(selector) {
      return selector.includes('.top-btn.primary') ? save : allPresent;
    },
    querySelectorAll() { return []; }
  };
  const rows = [];
  const calls = [];
  let studentRows = [];
  let saveResponse = null;
  let response = { attendanceDate: '2026-11-16', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 7, attendanceStatus: 'present' }] };
  const context = vm.createContext({
    attendance: null, attendanceRequestId: 0, roster: [], electiveClass: { electiveClassId: 4, className: 'Class A',
      subjectName: 'Math', yearStartDate: '2026-06-01', yearEndDate: '2027-03-31' },
    canEdit: () => true, toast() {}, setAtt() {}, updateAttCount() {}, openQrAttendance() {},
    document: {
      getElementById(id) { return ids[id]; },
      querySelector(selector) { return selector.includes('.attendance-entry-panel') ? panel : save; },
      querySelectorAll(selector) { return selector === '#attTbody tr[data-student-id]' ? studentRows : []; }
    },
    window: {
      EDUGNAY_API: {
        async getShsElectiveAttendance() { if (response instanceof Error) throw response; return response; },
        async saveShsElectiveAttendance(...args) { calls.push(args); return saveResponse || response; }
      },
      TeacherClassViews: { renderAttendanceRows(value) { rows.push(value); } },
      lucide: { createIcons() {} }
    }
  });
  vm.runInContext(source.slice(loadStart, loadEnd) + source.slice(renderStart, renderEnd), context);
  const actions = vm.runInContext('({ loadAttendance, saveAttendance })', context);
  return { actions, context, save, allPresent, qr, warning, warningTitle, warningSub, ids, rows, calls,
    setResponse(value) { response = value; },
    setSaveResponse(value) { saveResponse = value; },
    setStudentRows(value) { studentRows = value; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('initial elective attendance failure disables actions and blocks saving', async () => {
  const h = harness();
  h.setResponse(new Error('Attendance request failed.'));
  assert.equal(await h.actions.loadAttendance('2026-11-16'), false);
  assert.equal(h.warning.style.display, 'flex');
  assert.equal(h.warningTitle.textContent, 'Attendance unavailable');
  assert.equal(h.warningSub.textContent, 'Attendance request failed.');
  assert.equal(h.rows.at(-1).empty.title, 'Attendance unavailable');
  assert.equal(h.ids.attPanelTitle.textContent, 'Attendance');
  assert.equal(h.ids.countP.textContent, '—');
  for (const button of [h.save, h.allPresent, h.qr]) {
    assert.equal(button.disabled, true);
    assert.equal(button.onclick, null);
  }
  await h.actions.saveAttendance();
  assert.equal(h.calls.length, 0);
});

test('failed date switch removes old attendance actions; retry restores them', async () => {
  const h = harness();
  assert.equal(await h.actions.loadAttendance('2026-11-16'), true);
  assert.equal(h.save.disabled, false);
  assert.equal(typeof h.save.onclick, 'function');
  h.setResponse(new Error('Background refresh failed.'));
  assert.equal(await h.actions.loadAttendance('2026-11-16', { preserve: true }), false);
  assert.notEqual(h.context.attendance, null);
  assert.equal(h.save.disabled, false);
  h.ids.attDate.value = '2026-11-15';
  h.setResponse(new Error('Selected date could not load.'));
  assert.equal(await h.actions.loadAttendance('2026-11-15'), false);
  assert.equal(h.context.attendance, null);
  assert.equal(h.ids.countP.textContent, '—');
  assert.equal(h.save.disabled, true);
  assert.equal(h.save.onclick, null);
  assert.equal(h.allPresent.onclick, null);
  await h.actions.saveAttendance();
  assert.equal(h.calls.length, 0);
  h.setResponse({ attendanceDate: '2026-11-15', currentDate: '2026-11-16', canEdit: false,
    students: [{ id: 7 }] });
  assert.equal(await h.actions.loadAttendance('2026-11-15'), true);
  assert.equal(h.warningTitle.textContent, 'Past attendance is read-only');
  assert.equal(h.save.disabled, true);
  h.setResponse({ attendanceDate: '2026-11-16', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 7 }] });
  assert.equal(await h.actions.loadAttendance('2026-11-16'), true);
  assert.equal(h.warning.style.display, 'none');
  assert.equal(h.save.disabled, false);
  assert.equal(h.allPresent.disabled, false);
  assert.equal(h.qr.disabled, false);
  h.ids.attDate.value = '2026-11-15';
  await h.actions.saveAttendance();
  assert.equal(h.calls.length, 0);
});

test('older elective attendance responses cannot replace the latest selected date', async () => {
  const h = harness();
  const older = deferred();
  const newer = deferred();
  h.setResponse(older.promise);
  const oldLoad = h.actions.loadAttendance('2026-11-14');
  h.setResponse(newer.promise);
  const newLoad = h.actions.loadAttendance('2026-11-15');
  newer.resolve({ attendanceDate: '2026-11-15', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 7 }] });
  assert.equal(await newLoad, true);
  older.resolve({ attendanceDate: '2026-11-14', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 8 }] });
  assert.equal(await oldLoad, false);
  assert.equal(h.context.attendance.attendanceDate, '2026-11-15');
  assert.equal(h.ids.attDate.value, '2026-11-15');

  const failing = deferred();
  h.setResponse(failing.promise);
  const failedLoad = h.actions.loadAttendance('2026-11-14');
  h.setResponse({ attendanceDate: '2026-11-16', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 7 }] });
  assert.equal(await h.actions.loadAttendance('2026-11-16'), true);
  failing.reject(new Error('Old request failed.'));
  assert.equal(await failedLoad, false);
  assert.equal(h.context.attendance.attendanceDate, '2026-11-16');
  assert.equal(h.warning.style.display, 'none');
  assert.equal(h.save.disabled, false);
});

test('an older attendance save response cannot replace a newly selected date', async () => {
  const h = harness();
  assert.equal(await h.actions.loadAttendance('2026-11-16'), true);
  h.setStudentRows([{ dataset: { studentId: '7' }, querySelector(selector) {
    return selector === '.att-btn.selected' ? { textContent: 'P' } : { value: '' };
  } }]);
  const saving = deferred();
  h.setSaveResponse(saving.promise);
  const save = h.actions.saveAttendance();
  assert.equal(h.calls.length, 1);
  h.setResponse({ attendanceDate: '2026-11-15', currentDate: '2026-11-16', canEdit: false,
    students: [{ id: 7 }] });
  assert.equal(await h.actions.loadAttendance('2026-11-15'), true);
  saving.resolve({ attendanceDate: '2026-11-16', currentDate: '2026-11-16', canEdit: true,
    students: [{ id: 7 }] });
  await save;
  assert.equal(h.context.attendance.attendanceDate, '2026-11-15');
  assert.equal(h.ids.attDate.value, '2026-11-15');
  assert.equal(h.save.disabled, true);
});
