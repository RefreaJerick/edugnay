const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const pageHtml = fs.readFileSync(path.join(root, 'views/platform/edugnay-platform-profile.html'), 'utf8');
const profileScript = fs.readFileSync(path.join(root, 'assets/js/platform/profile.js'), 'utf8');
const globalStyles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const sharedProfileStyles = fs.readFileSync(path.join(root, 'assets/css/profile-common.css'), 'utf8');
const profileRoles = ['platform', 'admin', 'teacher', 'student', 'parent'];

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.defaultValue = '';
    this.type = '';
    this.attributes = {};
    this.listeners = new Map();
    this.classNames = new Set();
    this.classList = {
      add: name => this.classNames.add(name),
      remove: name => this.classNames.delete(name),
      contains: name => this.classNames.has(name)
    };
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  dispatch(name, event = {}) {
    const dispatched = { target: this, ...event };
    (this.listeners.get(name) || []).forEach(listener => listener(dispatched));
    return dispatched;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { this.focused = true; }
}

class FakeForm extends FakeElement {
  constructor(inputs) {
    super('passwordForm');
    this.inputs = inputs;
    this.resetCount = 0;
  }

  reset() {
    this.resetCount += 1;
    this.inputs.forEach(input => {
      input.value = input.defaultValue;
      input.type = 'password';
    });
    this.dispatch('reset');
  }
}

function createProfilePage() {
  const ids = ['changePasswordModal', 'changePasswordTrigger', 'currentPasswordInput', 'newPasswordInput', 'confirmPasswordInput'];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  elements.currentPasswordInput.type = 'password';
  elements.newPasswordInput.type = 'password';
  elements.confirmPasswordInput.type = 'password';
  elements.passwordForm = new FakeForm([
    elements.currentPasswordInput,
    elements.newPasswordInput,
    elements.confirmPasswordInput
  ]);

  const documentListeners = new Map();
  const document = {
    getElementById(id) { return elements[id]; },
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, []);
      documentListeners.get(name).push(listener);
    },
    dispatch(name, event) {
      (documentListeners.get(name) || []).forEach(listener => listener(event));
    }
  };
  let eventMap;
  const apiCalls = [];
  const alerts = [];
  const toasts = [];
  let requestHandler = async () => ({});
  const context = {
    document,
    window: {
      EDUGNAY_PLATFORM: {},
      EDUGNAY_PAGE_EVENTS: { bind(mapping) { eventMap = mapping; } },
      EDUGNAY_API: {
        async request(...args) {
          apiCalls.push(args);
          return requestHandler(...args);
        }
      }
    },
    alert(message) { alerts.push(message); },
    showAppToast(...args) { toasts.push(args); }
  };
  vm.runInNewContext(profileScript, context);
  return {
    elements,
    document,
    eventMap,
    apiCalls,
    alerts,
    toasts,
    setRequestHandler(handler) { requestHandler = handler; }
  };
}

function submitEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

test('platform profile adds accessible password fields and loads the shared toggle first', () => {
  assert.match(pageHtml, /<section class="panel personal-info-panel"[\s\S]*?Personal Information[\s\S]*?<\/section>\s*<div class="profile-side-column">[\s\S]*?Account Access[\s\S]*?Security[\s\S]*?Change Password[\s\S]*?<\/div>/);
  assert.match(pageHtml, /class="config-panel-body profile-security-body"/);
  assert.match(pageHtml, /class="profile-security-copy">Use a unique password with at least 12 characters\.<\/div>/);
  assert.match(pageHtml, /aria-modal="true"[\s\S]*?aria-labelledby="platformPasswordModalTitle"/);
  assert.match(pageHtml, /Cancel[\s\S]*?Update Password/);

  const fields = [
    ['currentPasswordInput', 'Current Password', 'current-password'],
    ['newPasswordInput', 'New Password', 'new-password'],
    ['confirmPasswordInput', 'Confirm New Password', 'new-password']
  ];
  for (const [id, label, autocomplete] of fields) {
    assert.ok(pageHtml.includes(`<label class="form-label" for="${id}">${label}</label>`));
    const inputTag = pageHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(inputTag, `${id} should be present`);
    assert.match(inputTag, /type="password"/);
    assert.match(inputTag, new RegExp(`autocomplete="${autocomplete}"`));
  }

  const toggleScriptIndex = pageHtml.indexOf('assets/js/password-toggle.js');
  const profileScriptIndex = pageHtml.indexOf('assets/js/platform/profile.js');
  assert.ok(toggleScriptIndex >= 0 && toggleScriptIndex < profileScriptIndex);
});

test('all profile pages share the modal shell styles', () => {
  const backdrop = sharedProfileStyles.match(/\.modal-backdrop\s*\{([^}]*)\}/)?.[1];
  const openBackdrop = sharedProfileStyles.match(/\.modal-backdrop\.open\s*\{([^}]*)\}/)?.[1];
  const modal = sharedProfileStyles.match(/\.modal\s*\{([^}]*)\}/)?.[1];
  assert.match(backdrop, /position:\s*fixed/);
  assert.match(backdrop, /inset:\s*0/);
  assert.match(backdrop, /visibility:\s*hidden/);
  assert.match(openBackdrop, /visibility:\s*visible/);
  assert.match(modal, /max-width:\s*480px/);

  for (const role of profileRoles) {
    const page = fs.readFileSync(path.join(root, `views/${role}/edugnay-${role}-profile.html`), 'utf8');
    assert.match(page, /profile-common\.css/);
    const roleStyles = fs.readFileSync(path.join(root, `assets/css/${role}/profile.css`), 'utf8');
    assert.doesNotMatch(roleStyles, /^\.modal-backdrop\s*\{/m);
  }
});

test('all profile Security cards use the compact shared button layout', () => {
  for (const role of profileRoles) {
    const page = fs.readFileSync(path.join(root, `views/${role}/edugnay-${role}-profile.html`), 'utf8');
    assert.match(page, /class="config-panel-body profile-security-body"/);
    assert.match(page, /class="profile-security-copy">Use a unique password with at least 12 characters\.<\/div>/);
    assert.ok(page.indexOf('assets/css/profile-common.css') > page.indexOf('assets/css/styles.css'));
  }

  assert.match(sharedProfileStyles, /\.config-panel-body\.profile-security-body\s*\{[^}]*display:\s*flex[^}]*gap:\s*12px/s);
  assert.match(sharedProfileStyles, /\.profile-security-copy\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1 1 auto/s);
  assert.match(sharedProfileStyles, /\.config-panel-body\.profile-security-body \.top-btn\s*\{[^}]*flex:\s*0 0 auto[^}]*width:\s*auto[^}]*white-space:\s*nowrap/s);
  assert.match(globalStyles, /@media \(max-width: 580px\)\s*\{\s*\.top-btn \{ width: 100%;/);
});

test('short and mismatched new passwords are rejected before the API call', async () => {
  const page = createProfilePage();
  const submit = page.eventMap.submit.p3d74c63c8476;

  page.elements.newPasswordInput.value = 'short';
  page.elements.confirmPasswordInput.value = 'short';
  const shortEvent = submitEvent();
  assert.equal(await submit(shortEvent), false);
  assert.equal(shortEvent.prevented, true);
  assert.equal(page.alerts.at(-1), 'Use a password with at least 12 characters.');
  assert.equal(page.apiCalls.length, 0);

  page.elements.newPasswordInput.value = 'long-enough-password';
  page.elements.confirmPasswordInput.value = 'different-password';
  await submit(submitEvent());
  assert.equal(page.alerts.at(-1), 'New password and confirmation do not match.');
  assert.equal(page.apiCalls.length, 0);
});

test('valid password change sends the expected payload and closes and resets the modal', async () => {
  const page = createProfilePage();
  const { elements, eventMap } = page;
  eventMap.click.p0f58b0be77b6({});
  assert.equal(elements.changePasswordModal.classList.contains('open'), true);
  assert.equal(elements.changePasswordModal.getAttribute('aria-hidden'), 'false');
  assert.equal(elements.currentPasswordInput.focused, true);

  elements.currentPasswordInput.value = 'old-password-value';
  elements.newPasswordInput.value = 'new-password-value';
  elements.confirmPasswordInput.value = 'new-password-value';
  elements.newPasswordInput.type = 'text';
  await eventMap.submit.p3d74c63c8476(submitEvent());

  assert.equal(page.apiCalls[0][0], '/auth/change-password');
  assert.equal(page.apiCalls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(page.apiCalls[0][1].body), {
    currentPassword: 'old-password-value',
    newPassword: 'new-password-value'
  });
  assert.equal(elements.changePasswordModal.classList.contains('open'), false);
  assert.equal(elements.changePasswordModal.getAttribute('aria-hidden'), 'true');
  assert.equal(elements.passwordForm.resetCount, 1);
  assert.deepEqual([elements.currentPasswordInput.value, elements.newPasswordInput.value, elements.confirmPasswordInput.value], ['', '', '']);
  assert.deepEqual([elements.currentPasswordInput.type, elements.newPasswordInput.type, elements.confirmPasswordInput.type], ['password', 'password', 'password']);
  assert.equal(elements.changePasswordTrigger.focused, true);
  assert.deepEqual(page.toasts[0], ['Password updated. You have been signed out on other devices.']);
});

test('API errors keep the modal and values available and show an error toast', async () => {
  const page = createProfilePage();
  page.setRequestHandler(async () => { throw new Error('Current password is incorrect.'); });
  page.eventMap.click.p0f58b0be77b6({});
  page.elements.currentPasswordInput.value = 'old-password-value';
  page.elements.newPasswordInput.value = 'new-password-value';
  page.elements.confirmPasswordInput.value = 'new-password-value';

  await page.eventMap.submit.p3d74c63c8476(submitEvent());

  assert.equal(page.elements.changePasswordModal.classList.contains('open'), true);
  assert.equal(page.elements.newPasswordInput.value, 'new-password-value');
  assert.deepEqual(page.toasts[0], ['Current password is incorrect.', 'error']);
});

test('close, cancel, backdrop, and Escape reset the form and hide passwords', () => {
  const page = createProfilePage();
  const { elements, eventMap, document } = page;
  const close = eventMap.click.p0dcd2c4737b7;

  for (const closeModal of [
    () => close({}),
    () => elements.changePasswordModal.dispatch('click', { target: elements.changePasswordModal }),
    () => document.dispatch('keydown', { key: 'Escape' })
  ]) {
    eventMap.click.p0f58b0be77b6({});
    elements.currentPasswordInput.value = 'current-value';
    elements.newPasswordInput.value = 'new-password-value';
    elements.confirmPasswordInput.value = 'new-password-value';
    elements.currentPasswordInput.type = 'text';
    closeModal();
    assert.equal(elements.changePasswordModal.classList.contains('open'), false);
    assert.equal(elements.changePasswordModal.getAttribute('aria-hidden'), 'true');
    assert.deepEqual([elements.currentPasswordInput.value, elements.newPasswordInput.value, elements.confirmPasswordInput.value], ['', '', '']);
    assert.deepEqual([elements.currentPasswordInput.type, elements.newPasswordInput.type, elements.confirmPasswordInput.type], ['password', 'password', 'password']);
  }
  assert.equal(elements.passwordForm.resetCount, 3);
});
