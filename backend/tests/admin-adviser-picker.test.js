const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const shared = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
const management = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/management.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = shared.indexOf(startMarker);
  const end = shared.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return shared.slice(start, end).trim();
}

const pickerSource = [
  sourceBetween('function normalize(value) {', '\n\n  function getOptionRecords('),
  sourceBetween('function getOptionRecords(state) {', '\n\n  function initialsFor('),
  sourceBetween('function splitOptionLabel(label) {', '\n\n  function syncInput('),
  sourceBetween('function syncInput(state) {', '\n\n  function setActiveOption('),
  sourceBetween('function renderOptions(state, query = \'\') {', '\n\n  function openSelect('),
  sourceBetween('function closeSelect(state) {', '\n\n  function bindSelectTriggerEvents('),
  sourceBetween('function chooseOption(state, value) {', '\n\n  function handleKeydown(')
].join('\n');

function classList() {
  const names = new Set();
  return {
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
    toggle(name, enabled) {
      if (enabled === undefined ? !names.has(name) : enabled) names.add(name);
      else names.delete(name);
    }
  };
}

function element(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    listeners: {},
    attributes: {},
    dataset: {},
    classList: classList(),
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; }
  };
}

function createPicker() {
  const context = vm.createContext({
    document: { createElement: tagName => element(tagName) },
    window: { getComputedStyle: () => ({ display: 'block' }) },
    Event: class Event { constructor(type) { this.type = type; } }
  });
  vm.runInContext(`let opened = null; ${pickerSource}\n globalThis.picker = { syncInput, renderOptions };`, context);
  return context.picker;
}

function createState(dataset) {
  const changes = [];
  const select = {
    value: '12',
    dataset,
    disabled: false,
    required: false,
    hidden: false,
    options: [
      { value: '', textContent: 'No adviser', disabled: false },
      { value: '12', textContent: 'Laurel Pineda', disabled: false },
      { value: '15', textContent: 'Maria Ramirez', disabled: false }
    ],
    dispatchEvent(event) { changes.push(event.type); }
  };
  const menu = element();
  menu.id = 'adviser-options';
  const state = {
    select,
    wrapper: element(),
    input: element('input'),
    menu,
    placeholder: 'No adviser',
    emptyText: 'No matching faculty',
    people: false,
    open: false,
    activeIndex: -1,
    visibleOptions: []
  };
  return { state, changes };
}

test('adviser picker searches a short list and can clear an assigned adviser', () => {
  const picker = createPicker();
  const { state, changes } = createState({ searchable: 'true', showEmptyOption: 'true' });
  picker.syncInput(state);

  assert.equal(state.input.readOnly, false);
  assert.equal(state.wrapper.classList.contains('is-search-opt-in'), true);
  assert.equal(state.input.value, 'Laurel Pineda');

  state.open = true;
  picker.renderOptions(state, 'mari');
  assert.deepEqual(Array.from(state.visibleOptions, option => option.label), ['Maria Ramirez']);

  picker.renderOptions(state, '');
  assert.deepEqual(Array.from(state.visibleOptions, option => option.label), ['No adviser', 'Laurel Pineda', 'Maria Ramirez']);
  state.menu.children[0].listeners.click();

  assert.equal(state.select.value, '');
  assert.equal(state.input.value, 'No adviser');
  assert.equal(state.open, false);
  assert.deepEqual(changes, ['change']);
});

test('an ordinary short dropdown remains read-only and hides its unselected empty option', () => {
  const picker = createPicker();
  const { state } = createState({});
  picker.syncInput(state);
  picker.renderOptions(state, '');

  assert.equal(state.input.readOnly, true);
  assert.equal(state.wrapper.classList.contains('is-search-opt-in'), false);
  assert.deepEqual(Array.from(state.visibleOptions, option => option.label), ['Laurel Pineda', 'Maria Ramirez']);
});

test('both section forms opt in and keep No adviser as the empty native option', () => {
  for (const id of ['createAdviser', 'editAdviser']) {
    const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/select>`))?.[0] || '';
    assert.match(select, /data-searchable="true"/);
    assert.match(select, /data-show-empty-option="true"/);
    assert.match(select, /data-search-placeholder="Search faculty…"/);
    assert.match(select, /<option value="">No adviser<\/option>/);
  }
  assert.match(html, /<label class="form-label" for="editAdviser">Assigned Adviser<\/label>/);
  assert.match(management, /select\.appendChild\(new Option\('No adviser', ''\)\)/);
});
