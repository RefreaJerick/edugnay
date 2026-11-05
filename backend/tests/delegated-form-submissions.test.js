const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scripts = {
  events: fs.readFileSync(path.join(__dirname, '../../assets/js/page-events.js'), 'utf8'),
  onboarding: fs.readFileSync(path.join(__dirname, '../../assets/js/onboarding/school-onboarding.js'), 'utf8'),
  login: fs.readFileSync(path.join(__dirname, '../../assets/js/auth/login.js'), 'utf8')
};

function createPage() {
  const listeners = new Map();
  class Element {
    constructor(attributes = {}) {
      this.attributes = attributes;
      this.parentElement = null;
    }
    getAttribute(name) { return this.attributes[name] || null; }
  }
  const elements = new Map();
  const document = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    getElementById(id) { return elements.get(id); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const window = {};
  const context = { document, window, Element, MutationObserver: class {}, URL, URLSearchParams };
  vm.runInNewContext(scripts.events, context);
  function submit(form) {
    const event = {
      type: 'submit', target: form, currentTarget: document, cancelBubble: false,
      preventDefault() { this.defaultPrevented = true; }
    };
    listeners.get('submit')(event);
    assert.equal(event.defaultPrevented, true);
    return new Promise(resolve => setImmediate(resolve));
  }
  return { context, document, window, elements, Element, submit };
}

function createOnboarding({ resubmit = false, apiError = null, levels = ['elementary'], invalidTerms = false } = {}) {
  const page = createPage();
  const button = { innerHTML: 'Create school profile', textContent: 'Create school profile', disabled: false };
  const values = {
    adminPassword: 'temporary-password', notificationEmail: ' notify@example.com ',
    schoolEmail: ' office@example.com ', adminName: 'Jane Reyes', schoolName: 'Test School',
    schoolId: '', schoolAddress: '', schoolPhone: '', schoolWebsite: '',
    schoolYear: '2026-2027', schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31'
  };
  class Form extends page.Element {
    constructor() { super({ 'data-page-submit': 'p373fe32a57f4' }); }
    querySelector(selector) { return selector === '[type="submit"]' ? button : null; }
  }
  const form = new Form();
  let calls = [];
  const toasts = [];
  const stored = new Map(resubmit ? [
    ['edugnay_registration_resubmit_mode', 'true'],
    ['edugnay_registration_status_token', 'old-token']
  ] : []);
  page.elements.set('academicTermsError', { hidden: true, textContent: '' });
  page.elements.set('schoolLogo', { files: [] });
  page.elements.set('schoolLevelsError', { hidden: true });
  page.window.EDUGNAY_CONFIG = {
    grades: [{ key: 'elementary', label: 'Elementary' }],
    getSchoolTypeInfo: () => ({ value: 'elementary' }),
    validateAcademicTermConfig: () => invalidTerms ? ['Invalid academic dates'] : []
  };
  page.window.EDUGNAY_API = {
    async registerSchool(...args) { calls.push(['register', ...args]); if (apiError) throw apiError; return { registrationStatusToken: 'new-token' }; },
    async resubmitSchool(...args) { calls.push(['resubmit', ...args]); if (apiError) throw apiError; return { registrationStatusToken: 'new-token' }; }
  };
  page.window.location = { href: '' };
  page.document.querySelectorAll = selector => {
    if (selector === '#schoolLevelOptions input:checked') return levels.map(value => ({ value }));
    if (selector === '[data-term-level]' && invalidTerms) return [{
      dataset: { termLevel: 'elementary' },
      querySelector: name => name === '[data-period-type]' ? { value: 'semester' } : null,
      querySelectorAll: () => []
    }];
    return [];
  };
  page.document.querySelector = selector => selector === '[data-term-level="elementary"] [data-term-error]'
    ? { hidden: true, textContent: '' } : null;
  Object.assign(page.context, {
    sessionStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    FormData: class {
      constructor(target) { assert.equal(target, form); }
      entries() { return Object.entries(values); }
    },
    showAppToast: (message, type) => toasts.push({ message, type })
  });
  vm.runInNewContext(scripts.onboarding, page.context);
  if (resubmit) vm.runInNewContext('registrationDetailsLoaded = true', page.context);
  return { ...page, form, button, calls, toasts, stored, values };
}

test('delegated school form registers once and keeps the pending-review flow', async () => {
  const page = createOnboarding();
  await page.submit(page.form);
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0][0], 'register');
  assert.equal(page.calls[0][1].notificationEmail, 'notify@example.com');
  assert.equal(page.calls[0][1].initialAdministrator.firstName, 'Jane');
  assert.equal(page.stored.get('edugnay_registration_status_token'), 'new-token');
  assert.equal(page.window.location.href, './edugnay-registration-pending.html');
});

test('delegated rejected application resubmits once with its saved token', async () => {
  const page = createOnboarding({ resubmit: true });
  await page.submit(page.form);
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0][0], 'resubmit');
  assert.equal(page.calls[0][1], 'old-token');
  assert.equal(page.window.location.href, './edugnay-registration-pending.html');
});

test('school form validation and server failure keep the form usable', async () => {
  const noLevels = createOnboarding({ levels: [] });
  await noLevels.submit(noLevels.form);
  assert.equal(noLevels.calls.length, 0);
  assert.equal(noLevels.elements.get('schoolLevelsError').hidden, false);

  const invalidDates = createOnboarding({ invalidTerms: true });
  await invalidDates.submit(invalidDates.form);
  assert.equal(invalidDates.calls.length, 0);
  assert.equal(invalidDates.elements.get('academicTermsError').textContent, 'Invalid academic dates');

  const failed = createOnboarding({ apiError: new Error('Registration unavailable') });
  await failed.submit(failed.form);
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.button.disabled, false);
  assert.equal(failed.button.innerHTML, 'Create school profile');
  assert.deepEqual(failed.toasts, [{ message: 'Registration unavailable', type: 'error' }]);
});

function createLogin({ failEndpoint = '', resetToken = 'reset-token' } = {}) {
  const page = createPage();
  const requests = [];
  const views = new Map();
  for (const name of ['signin', 'forgot', 'sent', 'reset', 'complete']) {
    views.set(name, {
      active: false,
      classList: { toggle(className, active) { if (className === 'active') views.get(name).active = active; } },
      setAttribute() {}, querySelector() { return null; }
    });
  }
  page.document.querySelector = selector => views.get(selector.match(/data-auth-view="([^"]+)"/)?.[1]);
  function form(id, eventId) {
    const button = { textContent: 'Submit', disabled: false, dataset: {} };
    const target = new page.Element({ 'data-page-submit': eventId });
    target.querySelector = () => button;
    target.reset = () => { target.wasReset = true; };
    page.elements.set(id, target);
    return { target, button };
  }
  const forgot = form('forgotPasswordForm', 'pbc5d395dba2e');
  const reset = form('resetPasswordForm', 'p2649b5ce3f8e');
  const signin = form('signInForm', 'p5018c1f2d823');
  for (const [id, value] of Object.entries({
    resetEmailInput: ' person@example.com ', newPasswordInput: 'strong-password-123',
    confirmPasswordInput: 'strong-password-123', emailInput: 'admin@school.test',
    passwordInput: 'password'
  })) page.elements.set(id, { value, checkValidity: () => true, focus() {} });
  for (const id of ['forgotMessage', 'resetPasswordMessage', 'signInMessage']) {
    page.elements.set(id, { textContent: '', classList: { toggle() {} } });
  }
  page.elements.set('resetEmailSummary', { textContent: '' });
  page.window.EDUGNAY_APP_CONFIG = { apiBaseUrl: 'http://api.test' };
  page.window.location = { search: `?token=${resetToken}`, href: 'http://localhost/', pathname: '/', origin: 'http://localhost' };
  page.window.setTimeout = () => {};
  page.window.history = { replaceState() {} };
  page.context.sessionStorage = { length: 0, key() { return null; }, removeItem() {} };
  page.context.fetch = async (url, options) => {
    requests.push({ url, payload: JSON.parse(options.body) });
    return { ok: !(failEndpoint && url.endsWith(failEndpoint)), status: 200,
      json: async () => url.endsWith('/auth/login') ? { user: { role: 'school_admin' } } : {} };
  };
  vm.runInNewContext(scripts.login, page.context);
  return { ...page, requests, views, forgot, reset, signin };
}

test('delegated password recovery forms submit and recover after server failure', async () => {
  const success = createLogin();
  await success.submit(success.forgot.target);
  assert.equal(success.requests.length, 1);
  assert.equal(success.requests[0].url, 'http://api.test/auth/password-reset/request');
  assert.equal(success.requests[0].payload.personalEmail, 'person@example.com');
  assert.equal(success.views.get('sent').active, true);
  assert.equal(success.forgot.button.disabled, false);
  await success.submit(success.reset.target);
  assert.equal(success.requests.length, 2);
  assert.equal(success.requests[1].payload.token, 'reset-token');
  assert.equal(success.reset.target.wasReset, true);
  assert.equal(success.views.get('complete').active, true);

  const failed = createLogin({ failEndpoint: '/auth/password-reset/request' });
  await failed.submit(failed.forgot.target);
  assert.equal(failed.forgot.button.disabled, false);
  assert.match(failed.elements.get('forgotMessage').textContent, /Unable to process/);

  const failedReset = createLogin({ failEndpoint: '/auth/password-reset/confirm' });
  await failedReset.submit(failedReset.reset.target);
  assert.equal(failedReset.reset.button.disabled, false);
  assert.match(failedReset.elements.get('resetPasswordMessage').textContent, /Unable to reset/);
});

test('ordinary sign-in still submits through the same dispatcher', async () => {
  const page = createLogin();
  await page.submit(page.signin.target);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, 'http://api.test/auth/login');
  assert.equal(page.window.location.href, './views/admin/edugnay-admin-dashboard.html');
});
