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
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.testRange = { validDate, displayDate, moveDate, nextSelection, canApply, yearBounds, setCalendarYear, inclusiveDayCount, updateSelectionSummary, updateFields, apply, close, setState(range, element) { openRange = range; popup = element; } };\n})();'), context);
const { validDate, displayDate, moveDate, nextSelection, canApply, yearBounds, setCalendarYear, inclusiveDayCount, updateSelectionSummary, updateFields, apply, close, setState } = context.window.testRange;

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
  assert.equal(displayDate('2026-10-23'), 'Oct 23, 2026');
  assert.equal(displayDate('invalid'), '');
  assert.equal(moveDate('2026-12-31', 1), '2027-01-01');
  assert.equal(moveDate('2028-03-01', -1), '2028-02-29');
});

test('range calendar year entry preserves the selected month and day within school-year bounds', () => {
  const range = {
    start: '', end: '', yearStart: '2024-01-01', yearEnd: '2026-12-31',
    active: '2024-02-29', year: 2024, month: 1, error: ''
  };
  assert.deepEqual({ ...yearBounds(range) }, { min: 2024, max: 2026 });
  assert.equal(setCalendarYear(range, '2025'), true);
  assert.equal(range.active, '2025-02-28');
  assert.equal(range.year, 2025);
  assert.equal(range.month, 1);
  assert.equal(range.start, '');
  assert.equal(range.end, '');
  assert.equal(setCalendarYear(range, '2027'), false);
  assert.equal(range.active, '2025-02-28');

  const bounded = {
    yearStart: '2026-08-15', yearEnd: '2027-05-31',
    active: '2026-04-01', year: 2026, month: 3, error: ''
  };
  assert.equal(setCalendarYear(bounded, '2026'), true);
  assert.equal(bounded.active, '2026-08-15');
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
  assert.equal(button.text.textContent, 'Oct 14, 2027 – Select end date');
  range.endInput.value = '2027-10-16';
  updateFields(range);
  assert.equal(button.text.textContent, 'Oct 14, 2027 – Oct 16, 2027');
  assert.match(button.attributes['aria-label'], /Quarter 1: Oct 14, 2027 – Oct 16, 2027/);
  range.startInput.disabled = true;
  updateFields(range);
  assert.equal(button.disabled, true);
});

test('live range counter uses inclusive days and hides for incomplete or invalid ranges', () => {
  const selection = { textContent: '' };
  const counter = { textContent: '', hidden: true };
  const range = { start: '2026-01-06', end: '2026-01-08', yearStart: '', yearEnd: '' };
  assert.equal(inclusiveDayCount(range), 3);
  updateSelectionSummary(range, selection, counter);
  assert.equal(selection.textContent, 'Jan 06, 2026 – Jan 08, 2026');
  assert.equal(counter.textContent, '3 days');
  assert.equal(counter.hidden, false);

  range.end = '2026-01-10';
  updateSelectionSummary(range, selection, counter);
  assert.equal(counter.textContent, '5 days');
  range.start = '2026-12-30';
  range.end = '2027-01-02';
  updateSelectionSummary(range, selection, counter);
  assert.equal(counter.textContent, '4 days');

  range.end = '';
  updateSelectionSummary(range, selection, counter);
  assert.equal(selection.textContent, 'Dec 30, 2026 – Select end date');
  assert.equal(counter.textContent, '');
  assert.equal(counter.hidden, true);

  range.start = '2026-10-16';
  range.end = '2026-10-16';
  assert.equal(inclusiveDayCount(range), null);
  range.end = '2027-06-01';
  range.yearStart = '2026-08-01';
  range.yearEnd = '2027-05-31';
  updateSelectionSummary(range, selection, counter);
  assert.equal(counter.hidden, true);
  assert.equal(canApply(range), false);
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
  assert.equal(button.text.textContent, 'Oct 14, 2027 – Oct 16, 2027');
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
  assert.match(source, /data-range-year min="1" max="9999" step="1"/);
  assert.match(source, /aria-label="Year"/);
  assert.match(source, /popup\.addEventListener\('input', onPopupInput\)/);
  assert.match(source, /popup\.addEventListener\('change', onPopupChange\)/);
  assert.match(source, /data-range-day-count aria-live="polite" hidden/);
  assert.match(source, /<div class="academic-range-selection"><span>Selected dates<\/span><strong data-range-selection><\/strong><\/div>/);
  assert.match(source, /<div class="academic-range-actions"><span class="academic-range-day-count" data-range-day-count aria-live="polite" hidden><\/span><button type="button" class="academic-range-cancel"/);
  const selectionCard = source.match(/<div class="academic-range-selection">[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(selectionCard, /data-range-day-count/);
  assert.match(source, /academic-range-month-year"><strong data-range-month><\/strong><input class="academic-range-year-input"/);
  assert.match(rangeStyles, /\.academic-range-month-year\s*\{[\s\S]*?gap: 8px;/);
  assert.match(rangeStyles, /\.academic-range-year-input\s*\{[\s\S]*?width: 52px;[\s\S]*?border: 1px solid var\(--gray-200\)[\s\S]*?background: var\(--gray-50\)[\s\S]*?color: var\(--gray-800\)[\s\S]*?text-align: center;/);
  assert.match(rangeStyles, /\.academic-range-year-input:focus-visible\s*\{[\s\S]*?border-color: var\(--theme-accent-text\)[\s\S]*?box-shadow: 0 0 0 3px var\(--button-focus-ring/);
  assert.match(rangeStyles, /\.academic-range-actions \.academic-range-day-count\s*\{\s*margin-right: auto;\s*color: var\(--gray-500\);\s*font-size: 11px;\s*font-weight: 600;\s*white-space: nowrap;/);
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
