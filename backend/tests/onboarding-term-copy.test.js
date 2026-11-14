const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/onboarding/school-onboarding.js'), 'utf8');
const start = source.indexOf('    function closePasteConfirmation() {');
const end = source.indexOf('    function renderAcademicTermConfigurations() {', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const toasts = [];
  const pasteButtons = [];
  const documentListeners = {};
  const container = { querySelectorAll: () => pasteButtons };
  const document = {
    getElementById: () => container,
    addEventListener(type, handler) { documentListeners[type] = handler; }
  };
  const context = {
    document,
    window: {},
    Event: class { constructor(type) { this.type = type; } },
    showAppToast: (...args) => toasts.push(args),
    SCHOOL_LEVELS: [
      { value: 'elementary', label: 'Elementary' },
      { value: 'jhs', label: 'Junior High School' },
      { value: 'shs', label: 'Senior High School' }
    ]
  };
  vm.runInNewContext(`let copiedTermDates = null; let pasteConfirmation = null;\n${source.slice(start, end)}\nthis.actions = { copyTermDates, pasteTermDates, updatePasteButtons, openPasteConfirmation };`, context);
  return { ...context, toasts, pasteButtons, documentListeners, actions: context.actions };
}

function card(level, type, dates) {
  const events = [];
  const rows = dates.map(([start, end]) => {
    const inputs = {
      '[data-period-start]': { value: start, dispatchEvent(event) { events.push(`start:${event.type}`); } },
      '[data-period-end]': { value: end, dispatchEvent(event) { events.push(`end:${event.type}`); } }
    };
    return { querySelector: selector => inputs[selector] };
  });
  const periodType = { value: type };
  const error = { hidden: false };
  const result = {
    dataset: { termLevel: level },
    querySelector: selector => ({ '[data-period-type]': periodType, '[data-term-error]': error })[selector],
    querySelectorAll: () => rows,
    rows, events, periodType, error
  };
  result.button = { closest: () => result, disabled: false };
  return result;
}

test('copy and paste preserve period structure and refresh both date inputs', () => {
  const page = setup();
  const sourceCard = card('elementary', 'three_term', [
    ['2026-11-06', '2026-12-31'], ['2027-01-01', '2027-03-31'], ['2027-04-01', '2027-06-30']
  ]);
  const target = card('jhs', 'three_term', [['', ''], ['', ''], ['', '']]);
  const incompatible = card('shs', 'semester', [['', ''], ['', '']]);
  page.pasteButtons.push(sourceCard.button, target.button, incompatible.button);

  page.actions.copyTermDates(sourceCard);
  assert.equal(sourceCard.button.disabled, true);
  assert.equal(target.button.disabled, false);
  assert.equal(incompatible.button.disabled, true);
  page.actions.pasteTermDates(target);
  assert.deepEqual(target.rows.map(row => [row.querySelector('[data-period-start]').value, row.querySelector('[data-period-end]').value]),
    [['2026-11-06', '2026-12-31'], ['2027-01-01', '2027-03-31'], ['2027-04-01', '2027-06-30']]);
  assert.deepEqual(target.events, Array.from({ length: 3 }, () => ['start:input', 'start:change', 'end:input', 'end:change']).flat());
  assert.equal(target.periodType.value, 'three_term');
  assert.equal(target.error.hidden, true);
  page.actions.pasteTermDates(incompatible);
  assert.equal(incompatible.rows[0].querySelector('[data-period-start]').value, '');
});

test('incomplete source leaves the previous copy available', () => {
  const page = setup();
  const complete = card('elementary', 'three_term', [['2026-11-06', '2026-12-31']]);
  const incomplete = card('shs', 'three_term', [['2027-01-01', '']]);
  const target = card('jhs', 'three_term', [['', '']]);
  page.pasteButtons.push(target.button);

  page.actions.copyTermDates(complete);
  page.actions.copyTermDates(incomplete);
  page.actions.pasteTermDates(target);
  assert.equal(target.rows[0].querySelector('[data-period-start]').value, '2026-11-06');
  assert.match(page.toasts.at(-2)[0], /Complete all date ranges/);
});

test('replacement confirmation cancels on button, Escape, or outside click and replaces only on confirm', () => {
  const page = setup();
  const sourceCard = card('elementary', 'three_term', [['2026-11-06', '2026-12-31']]);
  const target = card('jhs', 'three_term', [['2026-09-01', '2026-10-31']]);
  page.actions.copyTermDates(sourceCard);
  const popups = [];
  page.document.createElement = () => {
    const buttons = ['[data-paste-cancel]', '[data-paste-confirm]'].map(() => ({
      handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
      focus() { page.document.activeElement = this; }
    }));
    const popup = {
      buttons, handlers: {}, style: {}, offsetWidth: 316, offsetHeight: 150,
      setAttribute() {}, remove() { this.removed = true; },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      querySelector(selector) { return selector === '[data-paste-cancel]' ? buttons[0] : buttons[1]; },
      querySelectorAll: () => buttons,
      contains: () => false
    };
    popups.push(popup);
    return popup;
  };
  page.document.body = { appendChild() {} };
  page.window.innerWidth = 1200;
  page.window.innerHeight = 900;
  const trigger = {
    isConnected: true, contains: () => false, focus() { page.document.activeElement = this; },
    getBoundingClientRect: () => ({ left: 100, top: 400, bottom: 434 })
  };
  const currentStart = () => target.rows[0].querySelector('[data-period-start]').value;

  page.actions.openPasteConfirmation(target, trigger);
  assert.equal(popups[0].style.top, '440px');
  assert.equal(page.document.activeElement, popups[0].buttons[0]);
  popups[0].buttons[0].handlers.click();
  assert.equal(currentStart(), '2026-09-01');
  assert.equal(page.document.activeElement, trigger);

  page.actions.openPasteConfirmation(target, trigger);
  popups[1].handlers.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(currentStart(), '2026-09-01');

  page.actions.openPasteConfirmation(target, trigger);
  page.documentListeners.pointerdown({ target: {} });
  assert.equal(currentStart(), '2026-09-01');

  page.actions.openPasteConfirmation(target, trigger);
  popups[3].buttons[1].handlers.click();
  assert.equal(currentStart(), '2026-11-06');
  assert.equal(popups[3].removed, true);
});
