const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const sharedSelect = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
const shsProgram = fs.readFileSync(path.join(root, 'assets/js/admin/shs-program.js'), 'utf8').replace(/\r\n/g, '\n');
const page = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-shs-program.html'), 'utf8');
const modalStyles = fs.readFileSync(path.join(root, 'assets/css/modal-system.css'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end).trim();
}

const searchableSelectSource = sourceBetween(sharedSelect, 'function initializeSearchableSelectSupport() {', '\nfunction toggleNotifDropdown()');
const setOptionsSource = sourceBetween(shsProgram, 'function setOptions(', '\n\n  function visibleOfferings(');
const openSource = sourceBetween(shsProgram, 'function open(mode, id = null) {', '\n\n  function renderCatalogChoices(');
const submitSource = sourceBetween(shsProgram, 'async function submit(event) {', '\n\n  async function init(');

function classList() {
  const tokens = new Set();
  return {
    add(token) { tokens.add(token); },
    remove(token) { tokens.delete(token); },
    toggle(token, force) {
      const shouldAdd = force === undefined ? !tokens.has(token) : force;
      if (shouldAdd) tokens.add(token);
      else tokens.delete(token);
      return shouldAdd;
    },
    contains(token) { return tokens.has(token); }
  };
}

function createModalHarness() {
  const fields = {};
  const selects = new Set(['shs-teacher', 'shs-dialog-grade', 'shs-single-term', 'shs-start-term', 'shs-end-term']);
  for (const id of [
    'shs-form', 'shs-offering-layout', 'shs-dialog', 'shs-class-offering-field', 'shs-catalog-search',
    'shs-dialog-grade', 'shs-class-name', 'shs-teacher', 'shs-capacity', 'shs-single-term-field',
    'shs-term-range-fields', 'shs-single-term', 'shs-start-term', 'shs-end-term', 'shs-class-offering',
    'shs-dialog-title', 'shs-dialog-subtitle', 'shs-dialog-error', 'shs-dialog-overlay', 'shs-save'
  ]) {
    fields[id] = {
      value: '',
      textContent: '',
      hidden: id === 'shs-dialog-overlay',
      required: false,
      disabled: false,
      classList: classList(),
      options: [],
      focus() {},
      replaceChildren(...children) {
        this.options = children;
        if (!children.some(option => String(option.value) === String(this.value))) this.value = children[0]?.value || '';
      }
    };
  }
  fields['shs-capacity'].value = '40';
  fields['shs-form'].reset = () => {
    fields['shs-class-name'].value = '';
    fields['shs-teacher'].value = '';
    fields['shs-capacity'].value = '40';
    fields['shs-single-term'].value = '';
    fields['shs-start-term'].value = '';
    fields['shs-end-term'].value = '';
  };
  fields['shs-form'].reportValidity = () => true;

  const apiCalls = [];
  const loadedYears = [];
  const toasts = [];
  const state = {
    data: {
      year: { id: 2027 },
      years: [], grades: [], tracks: [],
      teachers: [{ id: 14, name: 'Alicia Cruz' }, { id: 15, name: 'Ben Santos' }],
      terms: [{ id: 31, name: 'Term 1' }, { id: 32, name: 'Term 2' }],
      offerings: [{ id: 5, subjectName: 'Basic Calculus', gradeCode: 'grade-12', subjectType: 'academic_elective' }],
      classes: [{ id: 66, offeringId: 5, className: 'Group A', teacherId: 14, capacity: 40, startTermId: 31, endTermId: 31 }],
      catalog: []
    },
    mode: '', offeringId: null, classId: null, returnFocus: null, previousOverflow: '', catalogCodes: new Set()
  };

  const context = vm.createContext({
    state,
    Option: class Option {
      constructor(text, value) { this.textContent = text; this.value = String(value); }
    },
    document: {
      activeElement: { focus() {} },
      body: { style: { overflow: '' } },
      querySelectorAll(selector) {
        assert.equal(selector, '.shs-class-field');
        return [fields['shs-class-name'], fields['shs-teacher'], fields['shs-capacity'], fields['shs-single-term-field']];
      }
    },
    window: { EDUGNAY_API: {} },
    $: id => fields[id],
    api: () => ({
      createShsClass: async values => apiCalls.push({ method: 'create', values }),
      updateShsClass: async (classId, values) => apiCalls.push({ method: 'update', classId, values })
    }),
    renderCatalogChoices() {},
    close() {},
    async load(yearId) { loadedYears.push(yearId); },
    showAppToast: message => toasts.push(message)
  });
  vm.runInContext(`
    ${setOptionsSource}
    ${openSource}
    ${submitSource}
    globalThis.flow = { open, submit };
  `, context);

  return { context, fields, apiCalls, loadedYears, toasts, selects };
}

function submitEvent(form) {
  return { currentTarget: form, preventDefault() {} };
}

test('shared searchable select reads people mode and search messages from select metadata', () => {
  assert.match(searchableSelectSource, /select\.dataset\.searchableType === 'people'/);
  assert.match(searchableSelectSource, /settings\.searchPlaceholder \|\| select\.dataset\.searchPlaceholder \|\| 'Search options\.\.\.'/);
  assert.match(searchableSelectSource, /settings\.emptyText \|\| select\.dataset\.searchEmptyText \|\| 'No matching options'/);
  assert.match(searchableSelectSource, /state\.searchable = state\.people \|\| getOptionRecords\(state\)\.filter\(option => option\.value\)\.length > 10/);
  assert.match(searchableSelectSource, /people \? 'searchable-select-people' : 'searchable-select-plain'/);
  assert.match(searchableSelectSource, /if \(!state\.searchable\) return;[\s\S]*?renderOptions\(state, input\.value\)/);
  assert.match(searchableSelectSource, /if \(event\.key === 'Enter' && state\.open\)[\s\S]*?chooseOption\(state, option\.value\)/);
  assert.match(searchableSelectSource, /root\.querySelectorAll\?\.\('select'\)\.forEach\(select => createSearchableSelect\(select\)\)/);
});

test('SHS Add/Edit Class teacher field opts into the shared people picker without custom styles', () => {
  const teacherField = page.match(/<select id="shs-teacher"[^>]*><\/select>/)?.[0] || '';
  assert.match(teacherField, /name="teacherId"/);
  assert.match(teacherField, /data-searchable-type="people"/);
  assert.ok(teacherField.includes(`data-search-placeholder="Search teachers${String.fromCodePoint(0x2026)}"`));
  assert.match(teacherField, /data-search-empty-text="No matching teachers"/);
  assert.match(page, /<label for="shs-teacher">Assigned teacher<\/label>/);
  assert.match(modalStyles, /\.searchable-select-option-avatar\s*\{/);
  assert.match(modalStyles, /\.searchable-select-input\s*\{/);
});

test('Add and Edit Class use current teacher options, preserve the edit selection, and submit the same IDs', async () => {
  const harness = createModalHarness();
  const { flow } = harness.context;
  const teacher = harness.fields['shs-teacher'];
  const form = harness.fields['shs-form'];

  flow.open('class', 5);
  assert.equal(teacher.required, true);
  assert.deepEqual(teacher.options.map(option => option.value), ['', '14', '15']);
  assert.deepEqual(teacher.options.map(option => option.textContent), ['Choose a teacher', 'Alicia Cruz', 'Ben Santos']);
  teacher.value = '15';
  harness.fields['shs-class-name'].value = 'Group B';
  harness.fields['shs-single-term'].value = '31';
  await flow.submit(submitEvent(form));
  assert.deepEqual(JSON.parse(JSON.stringify(harness.apiCalls[0])), {
    method: 'create',
    values: { className: 'Group B', teacherId: 15, capacity: 40, startTermId: 31, endTermId: 31, offeringId: 5 }
  });

  flow.open('edit', 66);
  assert.equal(teacher.value, '14', 'the saved teacher is selected when editing');
  assert.equal(teacher.required, true);
  harness.fields['shs-single-term'].value = '32';
  await flow.submit(submitEvent(form));
  assert.deepEqual(JSON.parse(JSON.stringify(harness.apiCalls[1])), {
    method: 'update',
    classId: 66,
    values: { className: 'Group A', teacherId: 14, capacity: 40, startTermId: 32, endTermId: 32 }
  });
  assert.deepEqual(harness.loadedYears, [2027, 2027]);
  assert.equal(harness.toasts.length, 2);
});
