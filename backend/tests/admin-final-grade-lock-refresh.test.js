const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/admin/schools.js'), 'utf8');

function extractFunction(name, nextMarker, context) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\n    ${nextMarker}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${name} should have a following function marker`);
  return vm.runInNewContext(`${source.slice(start, end)}\n${name}`, context);
}

function errorElement() { return { hidden: true, textContent: '' }; }

function k10Harness({ level = 'elementary', latest, rejectSave = true, refreshFails = false } = {}) {
  let currentError = errorElement();
  let renderedButton = null;
  let renderCount = 0;
  let toast = '';
  const button = { disabled: false };
  const form = {
    elements: {
      gradingMode: { value: 'school_specific' },
      passingGradeThreshold: { value: '82.5' },
      gradeRounding: { value: 'roundup' }
    },
    querySelector: () => button,
    contains: () => true
  };
  const context = {
    state: { tab: 'grading', k10GradingPreview: { locked: false } },
    activeK10GradingYear: () => ({ id: 10 }),
    activeDivision: () => ({ level }),
    activeSchool: () => ({ id: 1 }),
    getApiLevel: () => ({ id: level === 'jhs' ? 6 : 5 }),
    window: { EDUGNAY_API: {
      async saveK10FinalGradeRules() {
        if (rejectSave) throw new Error('Final-grade rules are locked because grades were published.');
      },
      async getDepedK10GradingPreview() {
        if (refreshFails) throw new Error('Refresh failed.');
        return latest;
      }
    } },
    renderGradingPane() {
      renderCount += 1;
      currentError = errorElement();
      renderedButton = { disabled: context.state.k10GradingPreview.locked };
    },
    showAppToast(message) { toast = message; },
    document: {
      activeElement: button,
      getElementById(id) { return id === 'k10FinalGradeRulesError' ? currentError : null; },
      querySelector() { return { tabIndex: 0, focus() {} }; }
    }
  };
  const submit = extractFunction('saveK10FinalGradeSettings', 'async function openApplyMissingDepedDefaults()', context);
  return {
    async run() { await submit({ preventDefault() {}, currentTarget: form }); },
    state: context.state,
    form,
    get currentError() { return currentError; },
    get button() { return button; },
    get renderedButton() { return renderedButton; },
    get renderCount() { return renderCount; },
    get toast() { return toast; }
  };
}

function shsHarness({ latest, rejectSave = true, refreshFails = false } = {}) {
  let currentError = errorElement();
  let renderedButton = null;
  let renderCount = 0;
  let toast = '';
  const button = { disabled: false };
  const form = {
    elements: {
      gradingMode: { value: 'school_specific', disabled: false },
      passingGradeThreshold: { value: '81.25', disabled: false },
      gradeRounding: { value: 'truncate', disabled: false }
    },
    querySelector(selector) { return selector.includes('submit') ? button : currentError; },
    contains: () => true
  };
  const context = {
    state: {
      tab: 'grading', apiAcademicYear: { id: 10, status: 'active' },
      shsGradingData: { year: { id: 10, status: 'active' }, finalGradeRules: { locked: false, supported: true } },
      shsFinalRulesSaving: false
    },
    activeDivision: () => ({ level: 'shs' }),
    activeSchool: () => ({ id: 1 }),
    window: { EDUGNAY_API: { async request(url, options) {
      if (options?.method === 'PUT') {
        if (rejectSave) throw new Error('Final-grade rules are locked because grades were published.');
        return { saved: true };
      }
      if (refreshFails) throw new Error('Refresh failed.');
      return latest;
    } } },
    renderShsGradingPane() {
      renderCount += 1;
      currentError = errorElement();
      renderedButton = { disabled: Boolean(context.state.shsGradingData.finalGradeRules.locked) };
    },
    showAppToast(message) { toast = message; },
    document: {
      activeElement: button,
      getElementById(id) { return id === 'shsFinalGradeRulesError' ? currentError : null; },
      querySelector() { return { tabIndex: 0, focus() {} }; }
    }
  };
  const submit = extractFunction('saveShsFinalGradeSettings', 'function shsPartName(code)', context);
  return {
    async run() { await submit({ preventDefault() {}, currentTarget: form }); },
    state: context.state,
    form,
    get currentError() { return currentError; },
    get button() { return button; },
    get renderedButton() { return renderedButton; },
    get renderCount() { return renderCount; },
    get toast() { return toast; }
  };
}

for (const level of ['elementary', 'jhs']) {
  test(`${level} refreshes the form to locked after a save is rejected for publication`, async () => {
    const harness = k10Harness({ level, latest: { locked: true } });
    await harness.run();
    assert.equal(harness.state.k10GradingPreview.locked, true);
    assert.equal(harness.renderCount, 1);
    assert.equal(harness.renderedButton.disabled, true);
    assert.match(harness.currentError.textContent, /locked because grades were published/);
    assert.equal(harness.toast, '');
  });
}

test('SHS refreshes the form to locked after a save is rejected for publication', async () => {
  const harness = shsHarness({ latest: {
    year: { id: 10, status: 'active' }, finalGradeRules: { locked: true, supported: true }
  } });
  await harness.run();
  assert.equal(harness.state.shsGradingData.finalGradeRules.locked, true);
  assert.equal(harness.renderCount, 1);
  assert.equal(harness.renderedButton.disabled, true);
  assert.match(harness.currentError.textContent, /locked because grades were published/);
  assert.equal(harness.toast, '');
});

test('a save error with refreshed unlocked rules preserves entered values and the error', async () => {
  const k10 = k10Harness({ latest: { locked: false } });
  await k10.run();
  assert.equal(k10.renderCount, 0);
  assert.equal(k10.form.elements.passingGradeThreshold.value, '82.5');
  assert.equal(k10.form.elements.gradeRounding.value, 'roundup');
  assert.match(k10.currentError.textContent, /locked because grades were published/);

  const shs = shsHarness({ latest: {
    year: { id: 10, status: 'active' }, finalGradeRules: { locked: false, supported: true }
  } });
  await shs.run();
  assert.equal(shs.renderCount, 0);
  assert.equal(shs.form.elements.passingGradeThreshold.value, '81.25');
  assert.equal(shs.form.elements.gradeRounding.value, 'truncate');
  assert.match(shs.currentError.textContent, /locked because grades were published/);
});

test('a failed lock-status refresh reports that the admin must reload', async () => {
  const k10 = k10Harness({ refreshFails: true });
  await k10.run();
  assert.equal(k10.renderCount, 0);
  assert.match(k10.currentError.textContent, /Lock status could not be refreshed/);
  assert.match(k10.currentError.textContent, /Reload this page/);

  const shs = shsHarness({ refreshFails: true });
  await shs.run();
  assert.equal(shs.renderCount, 0);
  assert.match(shs.currentError.textContent, /Lock status could not be refreshed/);
  assert.match(shs.currentError.textContent, /Reload this page/);
});

test('incomplete lock-status responses are treated as refresh failures', async () => {
  const k10 = k10Harness({ latest: {} });
  await k10.run();
  assert.match(k10.currentError.textContent, /Lock status could not be refreshed/);

  const shs = shsHarness({ latest: { year: { id: 10, status: 'active' } } });
  await shs.run();
  assert.match(shs.currentError.textContent, /Lock status could not be refreshed/);
});

test('successful final-grade-rule saves still refresh and show success', async () => {
  const k10 = k10Harness({ rejectSave: false, latest: { locked: false } });
  await k10.run();
  assert.equal(k10.renderCount, 1);
  assert.equal(k10.toast, 'Final grade rules saved.');

  const shs = shsHarness({ rejectSave: false, latest: {
    year: { id: 10, status: 'active' }, finalGradeRules: { locked: false, supported: true }
  } });
  await shs.run();
  assert.equal(shs.renderCount, 1);
  assert.equal(shs.toast, 'SHS final grade rules saved.');
});
