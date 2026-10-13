const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() { this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = false; this.classList = { toggle() {} }; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  fire(type, event = {}) { this.listeners[type]?.(event); }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children = []; this.textContent = ''; }
  setAttribute(name, value) { this[name] = value; }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const matches = [];
    const walk = element => {
      for (const child of element.children) {
        if (selector === 'input' && child.type === 'checkbox') matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function setup() {
  const elements = Object.fromEntries(['trigger', 'dropdown', 'summary', 'search', 'list', 'clear', 'done'].map(name => [name, new Element()]));
  elements.dropdown.hidden = true;
  const root = {
    querySelector: selector => elements[selector.match(/^\[data-student-(.*)\]$/)?.[1]],
    contains: target => Object.values(elements).includes(target)
  };
  const document = { listeners: {}, createElement: () => new Element(), addEventListener(type, callback) { this.listeners[type] = callback; }, fire(type, event) { this.listeners[type]?.(event); } };
  const window = { EDUGNAY_AVATAR: { render() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../assets/js/admin/student-multi-select.js'), 'utf8'), { window, document });
  const changes = [];
  const picker = window.createStudentMultiSelect(root, ids => changes.push(Array.from(ids)));
  picker.setStudents([
    { id: '11', displayName: 'Ana Cruz', schoolEmail: 'a.cruz.stud@example.test' },
    { id: '12', displayName: 'Ben Reyes', schoolEmail: 'b.reyes.stud@example.test' }
  ], '11');
  return { picker, document, ...elements, changes };
}

test('picker opens with quick-assign preselection and keeps checks while searching', () => {
  const { picker, trigger, dropdown, search, list, summary } = setup();
  assert.equal(dropdown.hidden, true);
  assert.equal(summary.textContent, '1 student selected');
  trigger.fire('click');
  assert.equal(dropdown.hidden, false);
  assert.equal(trigger['aria-expanded'], 'true');
  assert.equal(search.focused, true);
  search.value = 'Ben';
  search.fire('input');
  assert.equal(list.children.length, 1);
  const checkbox = list.children[0].children[0];
  checkbox.checked = true;
  checkbox.fire('change');
  assert.deepEqual(Array.from(picker.getSelectedIds()), [11, 12]);
  assert.equal(summary.textContent, '2 students selected');
  search.value = 'Ana';
  search.fire('input');
  assert.equal(list.children[0].children[0].checked, true);
});

test('student choices show a checkbox, avatar, name, and email on separate lines', () => {
  const { list } = setup();
  const [checkbox, avatar, identity] = list.children[0].children;
  assert.equal(checkbox.type, 'checkbox');
  assert.equal(avatar.className, 'student-multi-avatar');
  assert.equal(identity.className, 'student-multi-identity');
  assert.equal(identity.children[0].textContent, 'Ana Cruz');
  assert.equal(identity.children[1].textContent, 'a.cruz.stud@example.test');
});

test('Clear, Done, outside click, and Escape close or reset as expected', () => {
  const { picker, document, trigger, dropdown, clear, done, summary, search, list } = setup();
  trigger.fire('click');
  clear.fire('click');
  assert.deepEqual(Array.from(picker.getSelectedIds()), []);
  assert.equal(summary.textContent, 'Select students');
  assert.equal(list.children[0].children[0].checked, false);
  assert.equal(dropdown.hidden, false);
  done.fire('click');
  assert.equal(dropdown.hidden, true);
  assert.equal(trigger.focused, true);
  trigger.fire('click');
  document.fire('click', { target: new Element() });
  assert.equal(dropdown.hidden, true);
  trigger.fire('click');
  let prevented = false;
  let stopped = false;
  document.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(dropdown.hidden, true);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  trigger.fire('click');
  search.fire('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('picker disables actions during submission and keeps an empty-state message', () => {
  const { picker, trigger, search, list, clear, done } = setup();
  picker.setDisabled(true);
  assert.equal(trigger.disabled, true);
  assert.equal(search.disabled, true);
  assert.equal(done.disabled, true);
  assert.ok(list.querySelectorAll('input').every(input => input.disabled));
  picker.setDisabled(false);
  assert.equal(clear.disabled, false);
  picker.setStudents([]);
  assert.equal(list.children[0].textContent, 'No unassigned students available.');
  search.value = 'nobody';
  search.fire('input');
  assert.equal(list.children[0].textContent, 'No students match your search.');
});
