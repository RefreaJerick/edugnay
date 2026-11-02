const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/page-events.js'), 'utf8');

test('page event listeners preserve this, event, cancellation, and dynamic controls', () => {
  const listeners = new Map();
  class Element {
    constructor(attributes = {}, parentElement = null) {
      this.values = attributes;
      this.parentElement = parentElement;
      this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    }
    getAttribute(name) { return this.values[name] || null; }
    querySelectorAll() { return []; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observer = this; }
  }
  let observer;
  const document = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    querySelectorAll() { return []; }
  };
  const window = {};
  vm.runInNewContext(source, { document, window, Element, MutationObserver });
  const called = [];
  window.EDUGNAY_PAGE_EVENTS.bind({ click: {
    child: function(event) { called.push([this, event.type]); event.stopPropagation(); return false; },
    parent: function() { called.push('parent'); }
  } });
  const parent = new Element({ 'data-page-click': 'parent' });
  const child = new Element({ 'data-page-click': 'child' }, parent);
  const event = { type: 'click', target: child, cancelBubble: false,
    stopPropagation() { this.cancelBubble = true; },
    preventDefault() { this.defaultPrevented = true; } };
  listeners.get('click')(event);
  assert.deepEqual(called, [[child, 'click']]);
  assert.equal(event.defaultPrevented, true);

  const dynamic = new Element();
  const id = window.EDUGNAY_PAGE_EVENTS.register('change', function() { called.push(this); });
  dynamic.values['data-page-change'] = id;
  dynamic.attributes = [{ name: 'data-page-change', value: id }];
  observer.callback([{ addedNodes: [dynamic] }]);
  listeners.get('change')({ type: 'change', target: dynamic, cancelBubble: false });
  assert.equal(called.at(-1), dynamic);
});
