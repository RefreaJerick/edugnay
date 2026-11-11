const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const toggleScript = fs.readFileSync(path.join(root, 'assets/js/password-toggle.js'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const loginScript = fs.readFileSync(path.join(root, 'assets/js/auth/login.js'), 'utf8');
const onboardingScript = fs.readFileSync(path.join(root, 'assets/js/onboarding/school-onboarding.js'), 'utf8');
const passwordPages = [
  'index.html',
  'views/onboarding/edugnay-school-onboarding.html',
  'views/admin/edugnay-admin-profile.html',
  'views/teacher/edugnay-teacher-profile.html',
  'views/student/edugnay-student-profile.html',
  'views/parent/edugnay-parent-profile.html'
];

function getDescendants(element) {
  return element.children.flatMap(child => [child, ...getDescendants(child)]);
}

function matches(element, selector) {
  if (selector === 'input[type="password"]') return element.tagName === 'INPUT' && element.type === 'password';
  if (selector === 'input[data-password-toggle-enhanced]') return element.tagName === 'INPUT' && element.dataset.passwordToggleEnhanced === 'true';
  if (selector === '.password-toggle') return element.className === 'password-toggle';
  if (selector === '[data-password-icon="show"]') return element.dataset.passwordIcon === 'show';
  if (selector === '[data-password-icon="hide"]') return element.dataset.passwordIcon === 'hide';
  return false;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    this.value = '';
    this.defaultValue = '';
  }

  append(...elements) {
    elements.forEach(element => {
      if (element.parentNode) {
        const siblings = element.parentNode.children;
        siblings.splice(siblings.indexOf(element), 1);
      }
      element.parentNode = this;
      this.children.push(element);
    });
  }

  insertBefore(element, reference) {
    const index = this.children.indexOf(reference);
    element.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, element);
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  dispatch(name) { (this.listeners.get(name) || []).forEach(listener => listener({ type: name, target: this })); }
  click() { this.dispatch('click'); }
  querySelectorAll(selector) { return getDescendants(this).filter(element => matches(element, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    if (selector === '.form-group, .onboarding-field') return this.fieldGroup || null;
    for (let element = this.parentNode; element; element = element.parentNode) {
      if (selector === '.password-field' && element.className === 'password-field') return element;
    }
    return null;
  }
}

class FakeForm extends FakeElement {
  constructor() { super('form'); }

  reset() {
    this.dispatch('reset');
    this.querySelectorAll('input[data-password-toggle-enhanced]').forEach(input => {
      input.value = input.defaultValue;
    });
  }
}

function createTogglePage() {
  const formSizes = [1, 2, 1, 3, 3, 3, 3];
  const forms = formSizes.map(() => new FakeForm());
  const inputs = [];
  let fieldIndex = 0;
  formSizes.forEach((size, formIndex) => {
    for (let index = 0; index < size; index += 1) {
      const label = new FakeElement('label');
      label.textContent = ['Current Password', 'New Password', 'Confirm Password'][index] || 'Password';
      const group = new FakeElement('div');
      group.className = 'form-group';
      const input = new FakeElement('input');
      input.type = 'password';
      input.id = `password-${fieldIndex}`;
      input.name = `password${fieldIndex}`;
      input.labels = [label];
      input.form = forms[formIndex];
      input.fieldGroup = group;
      group.append(label, input);
      forms[formIndex].append(group);
      inputs.push(input);
      fieldIndex += 1;
    }
  });

  const document = {
    readyState: 'complete',
    createElement(tagName) { return new FakeElement(tagName); },
    querySelectorAll(selector) { return selector === 'input[type="password"]' ? inputs.filter(input => input.type === 'password') : []; },
    addEventListener() {}
  };
  let iconRenderCount = 0;
  const window = { lucide: { createIcons() { iconRenderCount += 1; } } };
  const context = { document, window, HTMLInputElement: FakeElement };
  vm.runInNewContext(toggleScript, context);
  return { context, forms, inputs, iconRenderCount: () => iconRenderCount };
}

test('all password screens load the shared toggle and its responsive styles', () => {
  const passwordInputs = passwordPages.flatMap(relativePath => {
    const page = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(page, /password-toggle\.js/, `${relativePath} should load the shared toggle`);
    return page.match(/<input\b[^>]*\btype=["']password["']/g) || [];
  });

  assert.equal(passwordInputs.length, 16);
  assert.match(sharedStyles, /\.password-toggle:focus-visible/);
  assert.match(sharedStyles, /@media \(max-width: 520px\)/);
  assert.match(sharedStyles, /::-ms-reveal/);
  assert.match(loginScript, /EDUGNAY_PASSWORD_TOGGLE\?\.hide\(passwordInput\)/);
  assert.match(onboardingScript, /EDUGNAY_PASSWORD_TOGGLE\?\.hide\(adminPasswordInput\)/);
});

test('toggle changes visibility without changing value and restores hidden state on reset', () => {
  const page = createTogglePage();
  assert.equal(page.inputs.length, 16);
  assert.equal(page.iconRenderCount(), 1);
  page.inputs.forEach(input => {
    const button = input.closest('.password-field')?.querySelector('.password-toggle');
    assert.ok(button, `${input.id} should have a custom toggle`);
    assert.equal(button.type, 'button');
    assert.match(button.getAttribute('aria-label'), /^Show /);
  });

  const input = page.inputs[0];
  const wrapper = input.closest('.password-field');
  const button = wrapper.querySelector('.password-toggle');
  const showIcon = button.querySelector('[data-password-icon="show"]');
  const hideIcon = button.querySelector('[data-password-icon="hide"]');
  input.value = 'autofilled-value';

  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Show Current Password');
  assert.equal(button.getAttribute('aria-controls'), input.id);
  assert.equal(showIcon.hidden, false);
  assert.equal(hideIcon.hidden, true);
  button.click();
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'autofilled-value');
  assert.equal(button.getAttribute('aria-label'), 'Hide Current Password');
  assert.equal(showIcon.hidden, true);
  assert.equal(hideIcon.hidden, false);

  button.click();
  assert.equal(input.type, 'password');
  assert.equal(button.getAttribute('aria-label'), 'Show Current Password');

  page.inputs.slice(1, 4).forEach(otherInput => {
    otherInput.closest('.password-field').querySelector('.password-toggle').click();
    assert.equal(otherInput.type, 'text');
  });
  page.forms[1].reset();
  page.inputs.slice(1, 3).forEach(otherInput => assert.equal(otherInput.type, 'password'));

  const emptyInput = page.inputs[15];
  const emptyButton = emptyInput.closest('.password-field').querySelector('.password-toggle');
  emptyButton.click();
  assert.equal(emptyInput.type, 'text');
  assert.equal(emptyInput.value, '');

  const onboardingInput = page.inputs[3];
  page.context.window.EDUGNAY_PASSWORD_TOGGLE.hide(onboardingInput);
  assert.equal(onboardingInput.type, 'password');
});
