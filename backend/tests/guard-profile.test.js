const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const page = fs.readFileSync(path.join(root, 'views/guard/edugnay-guard-profile.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'assets/js/guard/profile.js'), 'utf8');

class Element {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name)
    };
  }

  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }
  querySelector() { return this.submitButton; }
  reset() { this.resetCount = (this.resetCount || 0) + 1; }
}

function createHarness({ role = 'school_guard', request } = {}) {
  const ids = Object.fromEntries([
    'guardProfileForm', 'guardPasswordForm', 'guardPasswordModal', 'guard-profile-load-notice',
    'guard-profile-load-error', 'guard-profile-name', 'guard-profile-email', 'guardProfileFullName',
    'guardProfileEmail', 'guardProfileEmployeeNo', 'guardProfileContact', 'guardAccountStatus',
    'guardCurrentPassword', 'guardNewPassword', 'guardConfirmPassword'
  ].map(id => [id, new Element()]));
  const profileSubmit = new Element();
  const passwordSubmit = new Element();
  ids.guardProfileForm.submitButton = profileSubmit;
  ids.guardPasswordForm.submitButton = passwordSubmit;
  const profileTrigger = new Element();
  const profileName = new Element();
  const calls = [];
  const toasts = [];
  let eventMap;
  let readyCalls = 0;
  let redirect = null;
  const user = {
    role, displayName: 'Cardo Dalisay', schoolEmail: 'cardo@example.test', accountStatus: 'active',
    profile: { employeeNumber: 'GUARD-001', contactNumber: '09171234567' }
  };
  const documentListeners = {};
  const document = {
    getElementById: id => ids[id],
    querySelector(selector) {
      if (selector === '[data-page-click="guardProfilePasswordOpen"]') return profileTrigger;
      if (selector === '.tb-profile-name') return profileName;
      return null;
    },
    addEventListener(name, listener) { (documentListeners[name] ||= []).push(listener); },
    dispatch(name, event = {}) { (documentListeners[name] || []).forEach(listener => listener(event)); }
  };
  const api = async (url, options = {}) => {
    calls.push([url, options]);
    if (request) return request(url, options, user);
    if (url === '/users/me/profile' && !options.method) return { user };
    if (url === '/users/me/profile') {
      const profile = { ...user.profile, ...JSON.parse(options.body) };
      return { user: { ...user, profile } };
    }
    return {};
  };
  const window = {
    EDUGNAY_SCHOOL_READY: Promise.resolve(),
    EDUGNAY_API: { request: api },
    EDUGNAY_PAGE_LOADING: { ready() { readyCalls += 1; } },
    EDUGNAY_PAGE_EVENTS: { bind(mapping) { eventMap = mapping; } },
    location: { replace(url) { redirect = url; } }
  };
  const context = vm.createContext({
    document, window,
    showAppToast: (...args) => toasts.push(args)
  });
  vm.runInContext(source, context);
  return {
    ids, profileSubmit, passwordSubmit, profileTrigger, profileName, calls, toasts,
    document, eventMap: () => eventMap, readyCalls: () => readyCalls, redirect: () => redirect
  };
}

function submitEvent() { return { preventDefault() { this.prevented = true; } }; }

test('guard profile uses the shared profile, avatar, header, and modal components', () => {
  assert.match(page, /assets\/css\/profile-common\.css/);
  assert.match(page, /assets\/css\/admin\/profile\.css/);
  assert.match(page, /assets\/js\/portal-header-init\.js/);
  assert.match(page, /assets\/js\/guard\/profile\.js/);
  assert.match(page, /id="avatarFileInput"/);
  assert.match(page, /id="guardPasswordModal"[^>]*aria-hidden="true"/);
  assert.match(page, /id="guardProfileContact"/);
  assert.match(page, /id="guardProfileEmployeeNo"[^>]*disabled/);
  assert.doesNotMatch(page, /<style\b/i);
});

test('guard profile loads account details and saves only the editable contact number', async () => {
  const app = createHarness();
  app.document.dispatch('DOMContentLoaded');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(app.ids.guardProfileFullName.value, 'Cardo Dalisay');
  assert.equal(app.ids.guardProfileEmail.value, 'cardo@example.test');
  assert.equal(app.ids.guardProfileEmployeeNo.value, 'GUARD-001');
  assert.equal(app.ids.guardProfileContact.value, '09171234567');
  assert.equal(app.profileName.textContent, 'Cardo Dalisay');
  assert.equal(app.readyCalls(), 1);

  app.ids.guardProfileContact.value = '09170000000';
  await app.eventMap().submit.guardProfileSave(submitEvent());
  assert.equal(app.calls.at(-1)[0], '/users/me/profile');
  assert.equal(app.calls.at(-1)[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(app.calls.at(-1)[1].body), { contactNumber: '09170000000' });
  assert.equal(app.ids.guardProfileContact.value, '09170000000');
  assert.deepEqual(app.toasts.at(-1), ['Contact info updated.']);
});

test('guard password changes validate, use the shared endpoint, and close accessibly', async () => {
  const app = createHarness();
  app.document.dispatch('DOMContentLoaded');
  await new Promise(resolve => setImmediate(resolve));

  app.eventMap().click.guardProfilePasswordOpen();
  assert.equal(app.ids.guardPasswordModal.classList.contains('open'), true);
  assert.equal(app.ids.guardPasswordModal.attributes['aria-hidden'], 'false');
  assert.equal(app.ids.guardCurrentPassword.focused, true);

  app.ids.guardCurrentPassword.value = 'current-password';
  app.ids.guardNewPassword.value = 'short';
  app.ids.guardConfirmPassword.value = 'short';
  await app.eventMap().submit.guardProfilePasswordSave(submitEvent());
  assert.deepEqual(app.toasts.at(-1), ['Use a password with at least 12 characters.', 'error']);
  assert.equal(app.calls.some(([url]) => url === '/auth/change-password'), false);

  app.ids.guardNewPassword.value = 'a-long-new-password';
  app.ids.guardConfirmPassword.value = 'a-long-new-password';
  await app.eventMap().submit.guardProfilePasswordSave(submitEvent());
  assert.equal(app.calls.at(-1)[0], '/auth/change-password');
  assert.equal(app.calls.at(-1)[1].method, 'POST');
  assert.deepEqual(JSON.parse(app.calls.at(-1)[1].body), {
    currentPassword: 'current-password', newPassword: 'a-long-new-password'
  });
  assert.equal(app.ids.guardPasswordModal.classList.contains('open'), false);
  assert.equal(app.ids.guardPasswordModal.attributes['aria-hidden'], 'true');
  assert.equal(app.ids.guardPasswordForm.resetCount, 1);
  assert.equal(app.profileTrigger.focused, true);
  assert.deepEqual(app.toasts.at(-1), ['Password updated. You have been signed out on other devices.']);
});

test('non-guard accounts are redirected away from the guard profile', async () => {
  const app = createHarness({ role: 'parent' });
  app.document.dispatch('DOMContentLoaded');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.redirect(), '../../index.html');
});
