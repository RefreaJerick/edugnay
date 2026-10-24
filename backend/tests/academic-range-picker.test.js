const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/js/academic-range-picker.js'), 'utf8');
const sharedSource = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'views/onboarding/edugnay-school-onboarding.html'), 'utf8');
const schools = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-schools.html'), 'utf8');
const rangeStyles = fs.readFileSync(path.join(root, 'assets/css/academic-range-picker.css'), 'utf8');
const context = { window: {}, Event: class Event { constructor(type) { this.type = type; } } };
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.testRange = { validDate, displayDate, moveDate, nextSelection, canApply, updateFields, apply, close, setState(range, element) { openRange = range; popup = element; } };\n})();'), context);
const { validDate, displayDate, moveDate, nextSelection, canApply, updateFields, apply, close, setState } = context.window.testRange;

function fakeButton() {
  const text = { textContent: '' };
  const attributes = {};
  return {
    text, attributes, disabled: false, classList: { toggle() {} },
    querySelector: () => text,
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener() {}
  };
}

test('calendar keeps exact dates across months, years, and leap days', () => {
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2027-02-29'), false);
  assert.equal(displayDate('2026-10-23'), '23/10/2026');
  assert.equal(moveDate('2026-12-31', 1), '2027-01-01');
  assert.equal(moveDate('2028-03-01', -1), '2028-02-29');
});

test('range choice stages both endpoints and rejects reversed or out-of-year dates', () => {
  const base = { start: '', end: '', step: 'start', yearStart: '2026-08-01', yearEnd: '2027-05-31' };
  const start = nextSelection(base, '2026-10-16');
  assert.equal(start.start, '2026-10-16');
  assert.equal(start.step, 'end');
  assert.equal(canApply(start), false);
  const invalidEnd = nextSelection(start, '2026-10-16');
  assert.equal(invalidEnd.end, '');
  assert.match(invalidEnd.error, /after the start date/);
  const complete = nextSelection(start, '2026-12-31');
  assert.equal(canApply(complete), true);
  assert.equal(nextSelection(complete, '2027-06-01').end, '2026-12-31');
  const newStart = nextSelection({ ...complete, step: 'start' }, '2027-01-01');
  assert.equal(newStart.end, '');
  assert.equal(canApply(newStart), false);
  const earlierStart = nextSelection({ ...complete, step: 'start' }, '2026-10-01');
  assert.equal(earlierStart.end, '');
});

test('existing academic-term rules reject overlaps and permit gaps', () => {
  const start = sharedSource.indexOf('function isValidDateValue(value) {');
  const end = sharedSource.indexOf('function getAcademicPeriodReminder(', start);
  assert.ok(start >= 0 && end > start);
  const rules = {
    ACADEMIC_PERIOD_TYPES: { quarterly: { label: 'Quarterly', periodNames: ['Quarter 1', 'Quarter 2'] } }
  };
  vm.runInNewContext(sharedSource.slice(start, end), rules);
  const values = {
    schoolYear: '2026-2027', schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31',
    gradingPeriodType: 'quarterly',
    academicPeriods: [
      { name: 'Quarter 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
      { name: 'Quarter 2', plannedStartDate: '2026-11-02', plannedEndDate: '2027-01-31' }
    ]
  };
  assert.equal(rules.validateAcademicTermConfig(values).length, 0);
  values.academicPeriods[1].plannedStartDate = '2026-10-31';
  assert.match(rules.validateAcademicTermConfig(values).join(' '), /overlaps/);
  values.academicPeriods[1].plannedStartDate = '2026-11-02';
  values.academicPeriods[1].plannedEndDate = '2027-06-01';
  assert.match(rules.validateAcademicTermConfig(values).join(' '), /after the school year/);
});

test('one visible control shows empty, partial, saved, and locked ranges', () => {
  const button = fakeButton();
  const range = {
    startInput: { value: '', disabled: false }, endInput: { value: '', disabled: false },
    button, name: 'Quarter 1'
  };
  updateFields(range);
  assert.equal(button.text.textContent, 'Select start and end dates');
  range.startInput.value = '2027-10-14';
  updateFields(range);
  assert.equal(button.text.textContent, '14/10/2027 – Select end date');
  range.endInput.value = '2027-10-16';
  updateFields(range);
  assert.equal(button.text.textContent, '14/10/2027 – 16/10/2027');
  assert.match(button.attributes['aria-label'], /Quarter 1: 14\/10\/2027 – 16\/10\/2027/);
  range.startInput.disabled = true;
  updateFields(range);
  assert.equal(button.disabled, true);
});

test('Apply saves both dates and Cancel leaves the saved values unchanged', () => {
  const events = [];
  const button = fakeButton();
  button.isConnected = true;
  button.focus = () => {};
  const range = {
    startInput: { value: '2027-10-01', disabled: false, dispatchEvent(event) { events.push(`start:${event.type}`); } },
    endInput: { value: '2027-10-08', disabled: false, dispatchEvent(event) { events.push(`end:${event.type}`); } },
    name: 'Quarter 1', button, trigger: button, start: '2027-10-14', end: '2027-10-16'
  };
  const popup = { hidden: false, querySelector: () => ({ disabled: false }) };
  setState(range, popup);
  close();
  assert.equal(range.startInput.value, '2027-10-01');
  assert.equal(range.endInput.value, '2027-10-08');
  assert.deepEqual(events, []);
  setState(range, popup);
  apply();
  assert.equal(range.startInput.value, '2027-10-14');
  assert.equal(range.endInput.value, '2027-10-16');
  assert.equal(button.text.textContent, '14/10/2027 – 16/10/2027');
  assert.deepEqual(events, ['start:input', 'start:change', 'end:input', 'end:change']);
  assert.equal(popup.hidden, true);
});

test('enhancement keeps the native date pair as a fallback and the saved values as inputs', () => {
  const startInput = { value: '', required: true, disabled: false, dataset: {}, addEventListener() {} };
  const endInput = { value: '', required: true, disabled: false, dataset: {}, addEventListener() {} };
  const fallback = { hidden: false };
  const group = { querySelector: () => fallback, appendChild(button) { this.button = button; } };
  const form = { dataset: {}, addEventListener() {} };
  const row = {
    querySelector(selector) {
      return { start: startInput, end: endInput, name: { value: 'Term 2' }, '[data-academic-range]': group }[selector];
    },
    closest: () => form
  };
  context.document = { createElement: () => fakeButton() };
  context.window.initAcademicRangePickers({ querySelectorAll: () => [row] }, {
    rowSelector: 'row', startSelector: 'start', endSelector: 'end', nameSelector: 'name'
  });
  assert.equal(group.button.text.textContent, 'Select start and end dates');
  assert.equal(fallback.hidden, true);
  assert.equal(startInput.required, false);
  assert.equal(endInput.required, false);
  assert.equal(startInput.dataset.academicRangeEnhanced, 'true');
});

test('both term screens use the shared picker while school-year and extension dates stay native', () => {
  assert.match(onboarding, /initAcademicRangePickers\?\.\(container,[\s\S]*?startSelector: '\[data-period-start\]'[\s\S]*?endSelector: '\[data-period-end\]'/);
  assert.match(schools, /initAcademicRangePickers\?\.\(termsForm,[\s\S]*?startSelector: '\[data-term-period-start\]'[\s\S]*?endSelector: '\[data-term-period-end\]'/);
  assert.match(onboarding, /<label>Date range<\/label>[\s\S]*?academic-range-native-pair/);
  assert.match(schools, /<label>Date range<\/label>[\s\S]*?academic-range-native-pair/);
  assert.match(schools, /period\.status === 'upcoming' \? '' : 'disabled'/);
  assert.match(onboarding, /id="schoolYearStartDate"[^>]*type="date"/);
  assert.match(schools, /id="termSchoolYearStart" type="date"/);
  assert.match(schools, /id="extendedEndDate" type="date"/);
});

test('onboarding puts school-year fields beside the period cards and stacks them on narrow screens', () => {
  assert.match(onboarding, /onboarding-academic-layout[\s\S]*?onboarding-school-year-card[\s\S]*?id="schoolYear"[\s\S]*?id="schoolYearStartDate"[\s\S]*?id="schoolYearEndDate"[\s\S]*?id="academicTermConfigurations"/);
  assert.match(rangeStyles, /\.onboarding-academic-layout\s*\{[\s\S]*?grid-template-columns: minmax\(200px, \.9fr\) minmax\(0, 1\.8fr\)/);
  assert.match(rangeStyles, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.onboarding-academic-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(rangeStyles, /\.onboarding-academic-layout \.onboarding-period-row\s*\{[\s\S]*?grid-template-columns: minmax\(100px, \.65fr\) minmax\(0, 1\.35fr\)/);
});

test('both edited pages and the picker have valid JavaScript syntax', () => {
  new vm.Script(source);
  for (const html of [onboarding, schools]) {
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (match[1].trim()) new vm.Script(match[1]);
    }
  }
});
