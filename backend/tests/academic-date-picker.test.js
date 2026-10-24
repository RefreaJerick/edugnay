const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/js/academic-date-picker.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets/css/academic-range-picker.css'), 'utf8');
const context = { window: {}, Event: class Event { constructor(type, options) { this.type = type; this.options = options; } } };
const instrumented = source.replace(/\}\)\(\);\s*$/, `window.__academicDatePickerTest = {
  validDate, validMonth, parseDateTime, parseTime, displayDate, displayDateTime, displayTime, inBounds, valueFor,
  isValidValue, loadDraft, draftSummary, apply, close, onPopupKeydown, sync, wrapValueSetter,
  setState(state, element) { active = state; popup = element; }
};
})();`);
vm.runInNewContext(instrumented, context);
const picker = context.window.__academicDatePickerTest;

function fakeState(type, value, draft) {
  const events = [];
  const attributes = {};
  const button = {
    isConnected: true,
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    focus() {}
  };
  const state = {
    type,
    date: draft.date,
    monthValue: draft.monthValue,
    hour: draft.hour,
    minute: draft.minute,
    cleared: false,
    input: {
      type,
      value,
      required: true,
      min: '',
      max: '',
      dispatchEvent(event) { events.push(event.type); }
    },
    wrapper: { classList: { remove() {} } },
    button,
    errorNode: { hidden: false },
    events,
    attributes
  };
  return state;
}

test('date values stay timezone-safe and display in day/month/year order', () => {
  assert.equal(picker.validDate('2028-02-29'), true);
  assert.equal(picker.validDate('2027-02-29'), false);
  assert.equal(picker.displayDate('2027-10-04'), '04/10/2027');
  assert.equal(picker.parseDateTime('2027-10-04T00:05').hour, 0);
  assert.equal(picker.displayDateTime('2027-10-04T00:05'), '04/10/2027 · 12:05 AM');
  assert.equal(picker.displayDateTime('2027-10-04T13:45'), '04/10/2027 · 01:45 PM');
});

test('time-only values keep HH:mm storage and display in 12-hour form', () => {
  assert.deepEqual({ ...picker.parseTime('00:05') }, { hour: 0, minute: 5 });
  assert.equal(picker.parseTime('23:60'), null);
  assert.equal(picker.displayTime('00:05'), '12:05 AM');
  assert.equal(picker.displayTime('12:00'), '12:00 PM');
  assert.equal(picker.displayTime('23:59'), '11:59 PM');

  const state = fakeState('time', '', { hour: 9, minute: 0 });
  state.input.required = false;
  picker.loadDraft(state);
  assert.equal(state.cleared, true);
  assert.equal(picker.valueFor(state), '');
  assert.equal(picker.draftSummary(state), 'Select a time');
});

test('month values and date bounds use the input formats and include their endpoints', () => {
  assert.equal(picker.validMonth('2027-02'), true);
  assert.equal(picker.validMonth('2027-13'), false);
  assert.equal(picker.inBounds('2027-02', '2027-02', '2027-11'), true);
  assert.equal(picker.inBounds('2027-12', '2027-02', '2027-11'), false);
  assert.equal(picker.inBounds('2027-10-04T09:00', '2027-10-04T09:00', '2027-10-04T17:00'), true);
  const dateState = fakeState('date', '', { date: '2027-02-01' });
  dateState.input.min = '2027-02-02';
  assert.equal(picker.isValidValue(dateState, '2027-02-01'), false);
  const timeState = fakeState('datetime-local', '', { date: '2027-10-04', hour: 18, minute: 0 });
  timeState.input.min = '2027-10-04T09:00';
  timeState.input.max = '2027-10-04T17:00';
  assert.equal(picker.isValidValue(timeState, '2027-10-04T18:00'), false);

  const timeOnlyState = fakeState('time', '', { hour: 17, minute: 0 });
  timeOnlyState.input.min = '09:00';
  timeOnlyState.input.max = '17:00';
  assert.equal(picker.isValidValue(timeOnlyState, '17:00'), true);
  assert.equal(picker.isValidValue(timeOnlyState, '17:01'), false);
});

test('Apply writes the selected date, month, local date-time, or time and fires existing events once', () => {
  const popup = { hidden: false };
  const cases = [
    ['date', '', { date: '2027-10-04' }, '2027-10-04'],
    ['month', '', { date: '2027-10-01', monthValue: '2027-10' }, '2027-10'],
    ['datetime-local', '', { date: '2027-10-04', hour: 13, minute: 45 }, '2027-10-04T13:45'],
    ['time', '', { hour: 0, minute: 5 }, '00:05'],
    ['time', '', { hour: 23, minute: 59 }, '23:59']
  ];
  for (const [type, initial, draft, expected] of cases) {
    const state = fakeState(type, initial, draft);
    picker.setState(state, popup);
    picker.apply();
    assert.equal(state.input.value, expected);
    assert.deepEqual(state.events, ['input', 'change']);
    assert.equal(popup.hidden, true);
  }
});

test('Cancel discards draft values and required fields cannot apply an empty choice', () => {
  const popup = { hidden: false };
  const state = fakeState('date', '2027-10-01', { date: '2027-10-02' });
  picker.setState(state, popup);
  picker.close();
  assert.equal(state.input.value, '2027-10-01');
  assert.deepEqual(state.events, []);

  const time = fakeState('time', '11:30', { hour: 17, minute: 15 });
  picker.setState(time, popup);
  picker.close();
  assert.equal(time.input.value, '11:30');
  assert.deepEqual(time.events, []);

  const empty = fakeState('date', '', { date: '2027-10-02' });
  empty.cleared = true;
  assert.equal(picker.isValidValue(empty, picker.valueFor(empty)), false);
  const optionalClear = fakeState('date', '2027-10-01', { date: '2027-10-02' });
  optionalClear.input.required = false;
  optionalClear.cleared = true;
  assert.equal(picker.isValidValue(optionalClear, picker.valueFor(optionalClear)), true);
  picker.setState(optionalClear, popup);
  picker.apply();
  assert.equal(optionalClear.input.value, '');
  assert.deepEqual(optionalClear.events, ['input', 'change']);

  const optionalTimeClear = fakeState('time', '23:59', { hour: 9, minute: 0 });
  optionalTimeClear.input.required = false;
  optionalTimeClear.cleared = true;
  picker.setState(optionalTimeClear, popup);
  picker.apply();
  assert.equal(optionalTimeClear.input.value, '');
  assert.deepEqual(optionalTimeClear.events, ['input', 'change']);
});

test('Escape cancels a time-only draft and keeps the previously saved value', () => {
  const popup = { hidden: false };
  const state = fakeState('time', '23:59', { hour: 0, minute: 5 });
  picker.setState(state, popup);
  let prevented = false;
  picker.onPopupKeydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(popup.hidden, true);
  assert.equal(state.input.value, '23:59');
  assert.deepEqual(state.events, []);
});

test('direct code changes to the native value refresh the visible field', () => {
  class Input {
    constructor() {
      this._value = '';
      this.type = 'date';
      this.required = false;
      this.disabled = false;
      this.hidden = false;
      this.validity = { valid: true };
    }
    get value() { return this._value; }
    set value(value) { this._value = String(value); }
    matches() { return false; }
    getAttribute() { return null; }
  }
  context.window.HTMLInputElement = Input;
  const text = { textContent: '' };
  const state = {
    input: new Input(),
    button: {
      isConnected: true,
      classList: { toggle() {} },
      querySelector: () => text,
      setAttribute() {},
      removeAttribute() {}
    },
    wrapper: { classList: { toggle() {}, remove() {} } },
    errorNode: { hidden: true }
  };
  picker.wrapValueSetter(state.input, state);
  state.input.value = '2028-02-29';
  assert.equal(state.input.value, '2028-02-29');
  assert.equal(picker.displayDate(state.input.value), '29/02/2028');
  assert.equal(text.textContent, '29/02/2028');
});

test('all audited calendar pages load the shared picker and preserve the native controls', () => {
  const pages = [
    'views/onboarding/edugnay-school-onboarding.html',
    'views/admin/edugnay-admin-schools.html',
    'views/admin/edugnay-admin-announcements.html',
    'views/admin/edugnay-admin-dashboard.html',
    'views/admin/edugnay-admin-system-config.html',
    'views/teacher/edugnay-teacher-dashboard.html',
    'views/teacher/edugnay-teacher-sections.html',
    'views/teacher/edugnay-teacher-journals.html',
    'views/teacher/edugnay-teacher-sf-templates.html',
    'views/platform/edugnay-platform-dashboard.html',
    'views/student/edugnay-student-profile.html'
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /academic-date-picker\.js/, `${page} loads the picker`);
    assert.match(html, /academic-range-picker\.css/, `${page} loads the shared picker styles`);
  }
  assert.match(source, /input\.parentNode\.insertBefore\(wrapper, input\)/);
  assert.match(source, /input\.classList\.add\('academic-date-native-input'\)/);
  assert.match(source, /input\.addEventListener\('reset'|form\.addEventListener\('reset'/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /Object\.defineProperty\(input, 'value'/);
  assert.match(styles, /\.academic-date-time/);
  assert.match(styles, /\.academic-month-grid/);
  assert.match(source, /input\[type="time"\]/);
  assert.match(source, /popup\.classList\.toggle\('is-time-only', isTimeOnly\)/);
  assert.match(source, /popup\.querySelector\('\.academic-range-navigation'\)\.hidden = isTimeOnly/);
  assert.match(source, /isTimeOnly\s*\?\s*popup\.querySelector\('\[data-time-hour\]'\)/);
  const fields = [
    ['views/onboarding/edugnay-school-onboarding.html', /id="schoolYearStartDate"[^>]*type="date"/, /id="schoolYearEndDate"[^>]*type="date"/],
    ['views/admin/edugnay-admin-schools.html', /id="termSchoolYearStart" type="date"/, /id="termSchoolYearEnd" type="date"/, /id="holidayDate"[^>]*type="date"/, /id="extendedEndDate" type="date"/],
    ['views/admin/edugnay-admin-announcements.html', /id="editAnnouncementSchedule" type="datetime-local"/, /type="datetime-local" name="schedule"/],
    ['views/admin/edugnay-admin-dashboard.html', /type="datetime-local" name="schedule"/, /id="adminTodoDueDate" name="dueDate" type="date"/],
    ['views/admin/edugnay-admin-system-config.html', /id="approveReopenExpiresAt" type="datetime-local"/, /id="extendReopenExpiresAt" type="datetime-local"/],
    ['views/teacher/edugnay-teacher-dashboard.html', /id="teacherTodoDueDate" type="date"/],
    ['views/teacher/edugnay-teacher-sections.html', /id="assignDueInput"/, /id="editAssignmentDueInput"/, /id="attDate" onchange="loadAttendanceForDate/],
    ['views/teacher/edugnay-teacher-journals.html', /type="time" id="settings-deadline"/, /id="settings-deadline"[^>]*data-academic-date-compact="true"/],
    ['views/teacher/edugnay-teacher-sf-templates.html', /id="sfGenerateMonth" type="month"/],
    ['views/platform/edugnay-platform-dashboard.html', /id="platformTodoDueDate" name="dueDate" type="date"/],
    ['views/student/edugnay-student-profile.html', /name="birthDate" id="student-birth-date"/]
  ];
  for (const [page, ...patterns] of fields) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const pattern of patterns) assert.match(html, pattern, `${page} retains its date field`);
  }
  const journalPage = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-journals.html'), 'utf8');
  assert.match(journalPage, /const deadline = document\.getElementById\('settings-deadline'\)\.value/);
  assert.match(journalPage, /dueDateForWeek\(settingsWeekStart, day, deadline\)/);
});

test('picker scripts and inline scripts on every affected page parse', () => {
  new vm.Script(source);
  const pages = [
    'views/onboarding/edugnay-school-onboarding.html',
    'views/admin/edugnay-admin-schools.html',
    'views/admin/edugnay-admin-announcements.html',
    'views/admin/edugnay-admin-dashboard.html',
    'views/admin/edugnay-admin-system-config.html',
    'views/teacher/edugnay-teacher-dashboard.html',
    'views/teacher/edugnay-teacher-sections.html',
    'views/teacher/edugnay-teacher-journals.html',
    'views/teacher/edugnay-teacher-sf-templates.html',
    'views/platform/edugnay-platform-dashboard.html',
    'views/student/edugnay-student-profile.html'
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: page });
    }
  }
});
