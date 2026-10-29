'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const shellSource = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const start = shellSource.indexOf('const sidebarScrollbarRefreshers = [];');
const end = shellSource.indexOf("\ndocument.addEventListener('click'", start);
assert.notEqual(start, -1, 'shared sidebar scrollbar code exists');
assert.notEqual(end, -1, 'shared sidebar scrollbar code has a clear boundary');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    if (force) this.values.add(value);
    else this.values.delete(value);
    return force;
  }
}

class FakeElement {
  constructor(rect = { left: 0, top: 0, right: 300, bottom: 800, width: 300, height: 800 }) {
    this.rect = rect;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this._className = '';
    this.listeners = new Map();
    this.children = [];
    this.scrollHeight = 2000;
    this.clientHeight = 800;
    this.scrollTop = 0;
    this.offsetHeight = 32;
    this.isConnected = true;
    this.hovered = false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  set className(value) {
    this._className = String(value);
    this.classList.values = new Set(this._className.split(/\s+/).filter(Boolean));
  }

  get className() { return this._className; }
  setAttribute() {}

  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      ...properties
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  contains(target) {
    return target === this || this.children.some(child => child.contains(target));
  }

  getBoundingClientRect() { return { ...this.rect }; }
  matches(selector) { return selector === ':hover' && this.hovered; }
  setPointerCapture() {}
}

function makeHarness({ width = 1200, drawerOpen = false, rect } = {}) {
  const sidebar = new FakeElement(rect);
  const body = new FakeElement();
  if (drawerOpen) body.classList.add('drawer-open');

  const frames = [];
  const windowListeners = new Map();
  const observers = [];
  const document = {
    body,
    querySelectorAll: selector => selector === '.sidebar' ? [sidebar] : [],
    createElement: () => new FakeElement(),
    elementFromPoint: () => null
  };
  const window = {
    innerWidth: width,
    innerHeight: 800,
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    }
  };
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
  }
  window.ResizeObserver = FakeObserver;
  window.MutationObserver = FakeObserver;
  const context = { document, window, ResizeObserver: FakeObserver, MutationObserver: FakeObserver };
  vm.runInNewContext(`${shellSource.slice(start, end)}\nthis.initSidebarScrollbars = initSidebarScrollbars;`, context);

  return {
    body,
    context,
    document,
    observers,
    sidebar,
    window,
    flushFrames() {
      while (frames.length) frames.shift()();
    },
    dispatchWindow(type) {
      for (const listener of windowListeners.get(type) || []) listener();
    }
  };
}

function isShownOnDesktop(scrollbar) {
  return scrollbar.classList.contains('is-visible')
    && (scrollbar.classList.contains('is-hovered') || scrollbar.classList.contains('is-dragging'));
}

test('desktop scrollbar appears over the sidebar or rail, then hides after leaving both', () => {
  const harness = makeHarness();
  harness.context.initSidebarScrollbars();
  harness.flushFrames();
  const scrollbar = harness.body.children[0];
  const outside = new FakeElement();

  assert.equal(scrollbar.classList.contains('is-visible'), true);
  assert.equal(isShownOnDesktop(scrollbar), false);

  harness.sidebar.dispatch('pointerenter');
  harness.flushFrames();
  assert.equal(isShownOnDesktop(scrollbar), true);

  harness.sidebar.dispatch('pointerleave', { relatedTarget: scrollbar });
  scrollbar.dispatch('pointerenter');
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-hovered'), true);
  assert.equal(isShownOnDesktop(scrollbar), true);

  scrollbar.dispatch('pointerleave', { relatedTarget: outside });
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-hovered'), false);
  assert.equal(isShownOnDesktop(scrollbar), false);
});

test('desktop scrollbar reflects an existing sidebar hover when initialized', () => {
  const harness = makeHarness();
  harness.sidebar.hovered = true;
  harness.context.initSidebarScrollbars();
  harness.flushFrames();
  const scrollbar = harness.body.children[0];
  assert.equal(scrollbar.classList.contains('is-hovered'), true);
  assert.equal(isShownOnDesktop(scrollbar), true);
});

test('desktop scrollbar requires overflow and stays visible while its thumb is dragged', () => {
  const noOverflow = makeHarness();
  noOverflow.sidebar.scrollHeight = noOverflow.sidebar.clientHeight;
  noOverflow.context.initSidebarScrollbars();
  noOverflow.flushFrames();
  noOverflow.sidebar.dispatch('pointerenter');
  noOverflow.flushFrames();
  assert.equal(noOverflow.body.children[0].classList.contains('is-visible'), false);

  const harness = makeHarness();
  harness.context.initSidebarScrollbars();
  harness.flushFrames();
  const scrollbar = harness.body.children[0];
  const thumb = scrollbar.children[0];
  const outside = new FakeElement();
  harness.sidebar.dispatch('pointerenter');
  harness.flushFrames();
  thumb.dispatch('pointerdown', { button: 0, pointerId: 1, clientY: 80 });
  assert.equal(scrollbar.classList.contains('is-dragging'), true);

  harness.sidebar.dispatch('pointerleave', { relatedTarget: outside });
  scrollbar.dispatch('pointerleave', { relatedTarget: outside });
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-hovered'), false);
  assert.equal(isShownOnDesktop(scrollbar), true);

  harness.document.elementFromPoint = () => outside;
  thumb.dispatch('pointerup', { pointerId: 1, clientX: 500, clientY: 400 });
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-dragging'), false);
  assert.equal(isShownOnDesktop(scrollbar), false);
});

test('mobile scrollbar remains hidden with a closed drawer and visible for an open scrollable drawer', () => {
  const harness = makeHarness({
    width: 980,
    rect: { left: -280, top: 0, right: 0, bottom: 800, width: 280, height: 800 }
  });
  harness.context.initSidebarScrollbars();
  harness.flushFrames();
  const scrollbar = harness.body.children[0];
  assert.equal(scrollbar.classList.contains('is-visible'), false);

  harness.body.classList.add('drawer-open');
  harness.sidebar.rect = { left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 };
  harness.sidebar.dispatch('transitionend', { propertyName: 'transform' });
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-visible'), true);

  harness.body.classList.remove('drawer-open');
  harness.sidebar.rect = { left: -280, top: 0, right: 0, bottom: 800, width: 280, height: 800 };
  harness.sidebar.dispatch('transitionend', { propertyName: 'transform' });
  harness.flushFrames();
  assert.equal(scrollbar.classList.contains('is-visible'), false);
});

test('scroll position refreshes after resize and content changes without changing other scrollbars', () => {
  const harness = makeHarness();
  harness.context.initSidebarScrollbars();
  harness.flushFrames();
  const scrollbar = harness.body.children[0];

  harness.sidebar.scrollTop = 600;
  harness.sidebar.dispatch('scroll');
  harness.flushFrames();
  assert.equal(scrollbar.style.left, '292px');
  assert.equal(scrollbar.children[0].style.transform, 'translateY(240px)');

  harness.sidebar.rect = { left: 10, top: 20, right: 310, bottom: 620, width: 300, height: 600 };
  harness.sidebar.clientHeight = 600;
  harness.sidebar.scrollHeight = 1800;
  harness.dispatchWindow('resize');
  harness.flushFrames();
  assert.equal(scrollbar.style.left, '302px');
  assert.equal(scrollbar.style.top, '20px');
  assert.equal(scrollbar.style.height, '600px');
  assert.equal(scrollbar.children[0].style.transform, 'translateY(200px)');

  harness.sidebar.scrollHeight = 2400;
  const mutationObserver = harness.observers.at(-1);
  mutationObserver.callback();
  harness.flushFrames();
  assert.equal(scrollbar.children[0].style.height, '150px');
  assert.equal(scrollbar.children[0].style.transform, 'translateY(150px)');
  assert.match(styles, /\.sidebar\s*\{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-width: none;/);
});

test('CSS gates desktop visibility on hover or dragging and preserves the open mobile drawer behavior', () => {
  assert.match(styles, /\.sidebar-scrollbar\.is-visible\.is-hovered,\s*\.sidebar-scrollbar\.is-visible\.is-dragging\s*\{[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;[\s\S]*?pointer-events: auto;/);
  assert.match(styles, /body\.drawer-open \.sidebar-scrollbar\.is-visible\s*\{[\s\S]*?display: block;[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;[\s\S]*?pointer-events: auto;/);
});
