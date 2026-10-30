const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const onboarding = fs.readFileSync(path.join(__dirname, '../../views/onboarding/edugnay-school-onboarding.html'), 'utf8');
const pending = fs.readFileSync(path.join(__dirname, '../../views/onboarding/edugnay-registration-pending.html'), 'utf8');
const platformSchoolAccounts = fs.readFileSync(path.join(__dirname, '../../views/platform/edugnay-platform-school-accounts.html'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/styles.css'), 'utf8');
const onboardingCss = fs.readFileSync(path.join(__dirname, '../../assets/css/onboarding.css'), 'utf8');
const apiShell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');

test('onboarding submits the administrator name and notification email without a manual school address', () => {
  assert.doesNotMatch(onboarding, /id="adminEmail"|values\.adminEmail|schoolEmail:\s*administratorSchoolEmail/);
  assert.match(onboarding, /sessionStorage\.setItem\('edugnay_registration_status_token', createdSchool\.registrationStatusToken\)/);
  assert.doesNotMatch(onboarding, /sessionStorage\.setItem\('edugnay_pending_registration',\s*JSON\.stringify/);
  assert.match(apiShell, /registrationStatusToken: response\.registrationStatusToken/);
  assert.match(apiShell, /requestApi\('\/schools\/registration-status'/);
  assert.match(onboarding, /getRegistrationDetails\(token\)/);
  assert.match(onboarding, /resubmitSchool\(registrationToken, registration/);
  assert.match(onboarding, /edugnay_registration_resubmit_mode/);
  assert.match(onboarding, /resubmitAdministratorLogin/);
  assert.match(apiShell, /requestApi\('\/schools\/registration-details'/);
  assert.match(apiShell, /requestApi\('\/schools\/registration-resubmit'/);
  assert.match(onboarding, /Your existing school record will be retained/);
});

const completeSavedRegistration = {
  school: {
    name: 'Mangaldan National High School',
    depedSchoolId: '123456',
    addressLine: 'Old address',
    email: 'office@mnhs.example',
    phone: '09123456789',
    website: 'https://mnhs.example',
    schoolEmailDomain: 'mnhs.academix.test'
  },
  notificationEmail: 'notify@mnhs.example',
  initialAdministrator: { firstName: 'Jane', lastName: 'Reyes' },
  administratorSchoolEmail: 'j.reyes.adm@mnhs.academix.test',
  schoolLevels: ['jhs'],
  currentSchoolYearLabel: '2026-2027',
  schoolYearStartDate: '2026-08-01',
  schoolYearEndDate: '2027-05-31',
  academicTermConfigs: [{
    schoolLevel: 'jhs',
    gradingPeriodType: 'three_term',
    academicPeriods: [
      { name: 'Term 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
      { name: 'Term 2', plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
      { name: 'Term 3', plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
    ]
  }]
};

function createRejectedRegistrationContext(getRegistrationDetails, { token = 'registration-token' } = {}) {
  const elements = new Map();
  const selectorElements = new Map();
  const levelInputs = ['elementary', 'jhs', 'shs'].map(value => ({ value, checked: false }));
  const script = onboarding.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const start = script.indexOf('function validateSavedRegistrationDetails(application) {');
  const end = script.indexOf('\n    let schoolLogoData', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          value: '', textContent: '', hidden: ['registrationLoadState', 'registrationLoadError', 'registrationLoadRetry', 'registrationResubmitNotice'].includes(id), disabled: false,
          attributes: {},
          setAttribute(name, value) { this.attributes[name] = value; },
          removeAttribute(name) { delete this.attributes[name]; }
        });
        return elements.get(id);
      },
      querySelectorAll(selector) { return selector === '#schoolLevelOptions input' ? levelInputs : []; },
      querySelector(selector) {
        if (!selectorElements.has(selector)) selectorElements.set(selector, { textContent: '' });
        return selectorElements.get(selector);
      }
    },
    sessionStorage: { getItem: key => key === 'edugnay_registration_status_token' ? token : 'true' },
    window: { EDUGNAY_API: { getRegistrationDetails } },
    SCHOOL_LEVELS: [{ value: 'elementary' }, { value: 'jhs' }, { value: 'shs' }],
    registrationResubmitMode: true,
    registrationDetailsLoaded: false,
    levelInputs,
    termDrafts: {},
    renderAcademicTermConfigurations() {}
  };
  context.document.getElementById('registrationResubmitNotice');
  vm.runInNewContext(script.slice(start, end), context);
  context.elements = elements;
  return context;
}

test('saved rejected application details populate all fields before the form is enabled', async () => {
  let resolveDetails;
  const context = createRejectedRegistrationContext(() => new Promise(resolve => { resolveDetails = resolve; }));
  const loading = vm.runInNewContext('loadRejectedRegistration()', context);

  assert.equal(context.elements.get('registrationFormFields').hidden, true);
  assert.equal(context.elements.get('registrationLoadState').hidden, false);
  assert.equal(context.elements.get('schoolOnboardingSubmit').disabled, true);
  assert.equal(context.elements.get('schoolOnboardingForm').attributes['aria-busy'], 'true');

  resolveDetails(completeSavedRegistration);
  await loading;

  for (const [id, value] of Object.entries({
    schoolName: 'Mangaldan National High School', schoolId: '123456', schoolAddress: 'Old address',
    schoolEmail: 'office@mnhs.example', schoolPhone: '09123456789', schoolWebsite: 'https://mnhs.example',
    notificationEmail: 'notify@mnhs.example', adminName: 'Jane Reyes', schoolYear: '2026-2027',
    schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31'
  })) assert.equal(context.elements.get(id).value, value, `${id} should be prefilled`);

  assert.equal(context.levelInputs.find(input => input.value === 'jhs').checked, true);
  assert.equal(context.termDrafts.jhs.gradingPeriodType, 'three_term');
  assert.deepEqual(context.termDrafts.jhs.academicPeriods, completeSavedRegistration.academicTermConfigs[0].academicPeriods);
  assert.equal(context.elements.get('adminPassword').value, '');
  assert.equal(context.elements.get('schoolLogo').value, '');
  assert.match(context.elements.get('schoolLogoHelp').textContent, /current logo will be kept/i);
  assert.equal(context.elements.get('resubmitAdministratorLogin').textContent, 'j.reyes.adm@mnhs.academix.test');
  assert.equal(context.elements.get('registrationResubmitNotice').hidden, false);
  assert.equal(context.elements.get('registrationLoadState').hidden, true);
  assert.equal(context.elements.get('registrationLoadError').hidden, true);
  assert.equal(context.elements.get('registrationLoadRetry').hidden, true);
  assert.equal(context.elements.get('registrationFormFields').hidden, false);
  assert.equal(context.elements.get('schoolOnboardingForm').attributes['aria-busy'], undefined);
  assert.equal(context.elements.get('schoolOnboardingSubmit').disabled, false);
  assert.equal(context.registrationDetailsLoaded, true);
});

test('missing, deleted, expired, and no-longer-revisable registrations never expose a blank form', async () => {
  const missingToken = createRejectedRegistrationContext(async () => completeSavedRegistration, { token: '' });
  await vm.runInNewContext('loadRejectedRegistration()', missingToken);
  assert.equal(missingToken.elements.get('registrationFormFields').hidden, true);
  assert.equal(missingToken.elements.get('registrationResubmitNotice').hidden, true);
  assert.equal(missingToken.elements.get('registrationLoadRetry').hidden, true);
  assert.match(missingToken.elements.get('registrationLoadError').textContent, /contact Platform Admin.*do not register again/i);

  for (const status of [404, 409]) {
    const context = createRejectedRegistrationContext(async () => {
      throw Object.assign(new Error('not available'), { status });
    });
    await vm.runInNewContext('loadRejectedRegistration()', context);
    assert.equal(context.elements.get('registrationFormFields').hidden, true);
    assert.equal(context.elements.get('registrationResubmitNotice').hidden, true);
    assert.equal(context.elements.get('registrationLoadRetry').hidden, true);
    assert.match(context.elements.get('registrationLoadError').textContent, /contact Platform Admin/i);
  }
});

test('temporary saved-registration load failures offer retry, which hydrates the form on success', async () => {
  let shouldFail = true;
  const context = createRejectedRegistrationContext(async () => {
    if (shouldFail) throw new Error('Saved application unavailable.');
    return completeSavedRegistration;
  });
  await vm.runInNewContext('loadRejectedRegistration()', context);
  assert.equal(context.elements.get('registrationFormFields').hidden, true);
  assert.equal(context.elements.get('registrationLoadError').hidden, false);
  assert.equal(context.elements.get('registrationLoadRetry').hidden, false);
  assert.equal(context.elements.get('schoolOnboardingSubmit').disabled, true);

  shouldFail = false;
  await vm.runInNewContext('loadRejectedRegistration()', context);
  assert.equal(context.elements.get('registrationLoadRetry').hidden, true);
  assert.equal(context.elements.get('registrationLoadError').hidden, true);
  assert.equal(context.elements.get('schoolName').value, 'Mangaldan National High School');
  assert.equal(context.elements.get('registrationFormFields').hidden, false);
  assert.equal(context.elements.get('schoolOnboardingSubmit').disabled, false);
});

test('incomplete saved-registration response stays blocked with Platform Admin guidance', async () => {
  const context = createRejectedRegistrationContext(async () => ({ school: { name: 'Incomplete School' } }));
  await vm.runInNewContext('loadRejectedRegistration()', context);
  assert.equal(context.elements.get('registrationFormFields').hidden, true);
  assert.equal(context.elements.get('registrationResubmitNotice').hidden, true);
  assert.equal(context.elements.get('registrationLoadRetry').hidden, true);
  assert.match(context.elements.get('registrationLoadError').textContent, /incomplete.*contact Platform Admin.*do not register again/i);
  assert.equal(context.elements.get('schoolOnboardingSubmit').disabled, true);
});

test('onboarding submit buttons respect their hidden attribute', () => {
  assert.match(onboardingCss, /\.onboarding-submit\[hidden\]\s*\{\s*display:\s*none\s*;/);
  assert.match(onboardingCss, /#registrationFormFields\[hidden\]\s*\{\s*display:\s*none\s*;/);
  assert.match(onboarding, /if \(registrationResubmitMode && !registrationDetailsLoaded\) return;/);
});

function createPendingPageContext({ token = 'opaque-token', registration, registrations, requestError, getStatus } = {}) {
  const elements = new Map();
  const script = pending.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const calls = { statusToken: null, statusRequests: 0, removedKeys: [], intervals: [], clearedIntervals: [], listeners: {} };
  const context = {
    document: {
      hidden: false,
      addEventListener(name, listener) { calls.listeners[name] = listener; },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          textContent: '', hidden: false, disabled: false,
          addEventListener() {}, value: '', removeAttribute() {}
        });
        return elements.get(id);
      }
    },
    sessionStorage: {
      getItem: key => key === 'edugnay_registration_status_token' ? token : null,
      removeItem: key => calls.removedKeys.push(key)
    },
    window: {
      addEventListener(name, listener) { calls.listeners[name] = listener; },
      setInterval(callback, delay) { calls.intervals.push({ callback, delay }); return calls.intervals.length; },
      clearInterval(id) { calls.clearedIntervals.push(id); },
      EDUGNAY_API: {
        async getRegistrationStatus(value) {
          calls.statusToken = value;
          calls.statusRequests += 1;
          if (getStatus) return getStatus(value, calls.statusRequests);
          if (requestError) throw requestError;
          return registrations ? registrations.shift() : registration;
        }
      }
    },
    calls,
    elements
  };
  vm.runInNewContext(script, context);
  return context;
}

test('pending registration loads the saved status from the API using only the session token', async () => {
  assert.doesNotMatch(pending, /id="pendingRegistrationCheck"|>Check status</);
  const context = createPendingPageContext({ registration: {
    schoolName: 'Mangaldan National High School',
    administratorSchoolEmail: 'j.reyes.adm@mnhs.academix.test',
    notificationEmailMasked: 'ja***@example.com',
    registrationStatus: 'active',
    submittedAt: '2026-10-01T00:00:00.000Z'
  } });
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.calls.statusToken, 'opaque-token');
  assert.equal(context.elements.get('pendingRegistrationTitle').textContent, 'Registration approved');
  assert.equal(context.elements.get('pendingSchoolName').textContent, 'Mangaldan National High School');
  assert.equal(context.elements.get('pendingAdministratorSchoolEmail').textContent, 'j.reyes.adm@mnhs.academix.test');
  assert.equal(context.elements.get('pendingNotificationEmail').textContent, 'ja***@example.com');
  assert.ok(context.calls.removedKeys.includes('edugnay_pending_registration'));
});

test('pending registration copy follows approved, rejected, and suspended backend states', async () => {
  for (const [registrationStatus, expectedTitle] of [
    ['active', 'Registration approved'],
    ['rejected', 'Registration not approved'],
    ['suspended', 'School access suspended']
  ]) {
    const context = createPendingPageContext({ registration: {
      schoolName: 'Sample School', registrationStatus,
      notificationEmailMasked: 'no***@example.com'
    } });
    await vm.runInNewContext('renderPendingRegistration()', context);
    assert.equal(context.elements.get('pendingRegistrationTitle').textContent, expectedTitle);
    assert.equal(context.elements.get('pendingRegistrationResubmit').hidden, registrationStatus !== 'rejected');
  }
});

test('rejected status links to token-backed resubmission without putting the token in the URL', () => {
  assert.match(pending, /edugnay_registration_resubmit_mode', 'true'/);
  assert.match(pending, /window\.location\.href = '\.\/edugnay-school-onboarding\.html'/);
  assert.doesNotMatch(pending, /location\.href\s*=.*registrationStatusToken|location\.href\s*=.*\?token=/);
  assert.match(platformSchoolAccounts, /Administrator login/);
  assert.match(platformSchoolAccounts, /Notification email \(delivery address\)/);
  assert.match(platformSchoolAccounts, /Accepted by Gmail SMTP — inbox delivery unconfirmed/);
  assert.match(platformSchoolAccounts, /SMTP message reference/);
  assert.match(platformSchoolAccounts, /suspended: 'Suspension email'/);
  assert.match(platformSchoolAccounts, /reactivated: 'Reactivation email'/);
  assert.match(platformSchoolAccounts, /Retry email/);
  assert.match(platformSchoolAccounts, /Inactive — registration rejected/);
  assert.match(platformSchoolAccounts, /account-login-status \$\{administratorLoginStatus\.className\}/);
  assert.match(sharedStyles, /\.account-login-status,/);
  assert.match(sharedStyles, /\.account-login-status\.pending/);
  assert.match(sharedStyles, /\.account-login-status\.rejected/);
  assert.match(sharedStyles, /\.account-login-status\.suspended/);
  assert.match(sharedStyles, /overflow-wrap: anywhere/);
});

test('pending registration does not use stale browser details when the token is missing', async () => {
  const context = createPendingPageContext({ token: '' });
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.calls.statusToken, null);
  assert.match(context.elements.get('pendingRegistrationError').textContent, /do not submit it again/);
  assert.equal(context.elements.get('pendingRegistrationRetry').hidden, true);
});

test('pending registration offers retry when the API cannot be reached', async () => {
  const context = createPendingPageContext({ requestError: { status: 503 } });
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.match(context.elements.get('pendingRegistrationError').textContent, /try again/);
  assert.equal(context.elements.get('pendingRegistrationRetry').hidden, false);
});

test('pending status polls while visible and stops after a rejection', async () => {
  const context = createPendingPageContext({ registrations: [
    { schoolName: 'Test School', registrationStatus: 'pending' },
    { schoolName: 'Test School', registrationStatus: 'rejected' }
  ] });
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.calls.intervals.length, 1);
  assert.equal(context.calls.intervals[0].delay, 60000);
  await context.calls.intervals[0].callback();
  assert.equal(context.elements.get('pendingRegistrationTitle').textContent, 'Registration not approved');
  assert.equal(context.elements.get('pendingRegistrationResubmit').hidden, false);
  assert.equal(context.calls.clearedIntervals.length, 1);
  assert.equal(context.calls.statusRequests, 2);
});

test('pending status keeps its last known state on failure and respects rate-limit backoff', async () => {
  const context = createPendingPageContext({ getStatus: async (token, count) => {
    if (count > 1) throw { status: 429, retryAfterSeconds: 120, message: 'Wait before checking again.' };
    return { schoolName: 'Test School', registrationStatus: 'pending' };
  } });
  await vm.runInNewContext('renderPendingRegistration()', context);
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.elements.get('pendingRegistrationTitle').textContent, 'Registration submitted');
  assert.match(context.elements.get('pendingRegistrationError').textContent, /Wait before checking again/);
  await vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.calls.statusRequests, 2);
});

test('pending status pauses in hidden tabs and shares an in-flight request', async () => {
  let finishRequest;
  let started = false;
  const context = createPendingPageContext({ getStatus: () => {
    if (started) return Promise.resolve({ registrationStatus: 'pending' });
    started = true;
    return new Promise(resolve => { finishRequest = resolve; });
  } });
  const first = vm.runInNewContext('renderPendingRegistration()', context);
  const second = vm.runInNewContext('renderPendingRegistration()', context);
  assert.equal(context.calls.statusRequests, 1);
  finishRequest({ registrationStatus: 'pending' });
  await Promise.all([first, second]);
  vm.runInNewContext('pendingRegistrationReady = true', context);
  context.document.hidden = true;
  context.calls.listeners.visibilitychange();
  assert.equal(context.calls.clearedIntervals.length, 1);
  context.calls.listeners.focus();
  assert.equal(context.calls.statusRequests, 1);
  context.document.hidden = false;
  context.calls.listeners.visibilitychange();
  assert.equal(context.calls.intervals.length, 2);
  assert.equal(context.calls.statusRequests, 2);
});

test('returning to the status tab during a slow request queues one fresh check', async () => {
  let finishRequest;
  const context = createPendingPageContext({ getStatus: (token, count) => count === 1
    ? new Promise(resolve => { finishRequest = resolve; })
    : { registrationStatus: 'rejected' } });
  const first = vm.runInNewContext('renderPendingRegistration()', context);
  vm.runInNewContext('pendingRegistrationReady = true', context);
  context.calls.listeners.focus();
  assert.equal(context.calls.statusRequests, 1);
  finishRequest({ registrationStatus: 'pending' });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.calls.statusRequests, 2);
  assert.equal(context.elements.get('pendingRegistrationResubmit').hidden, false);
});

test('platform school refresh preserves the last list on failure and serializes forced refreshes', async () => {
  const start = platformSchoolAccounts.indexOf('async function refreshSchoolAccounts(force = false) {');
  const end = platformSchoolAccounts.indexOf('\n    function renderSchoolAccountTabs', start);
  assert.ok(start > -1 && end > start);
  let finishFirst;
  let calls = 0;
  let renders = 0;
  const controls = { schoolAccountRefresh: { disabled: false }, schoolAccountRefreshError: { hidden: true } };
  const context = {
    schoolAccountRefreshPromise: null, schoolAccountQueuedRefresh: null,
    schoolAccountPollTimer: null, schoolAccountLastReturnAt: 0, schoolAccountPollingReady: true,
    schoolAccountRecords: [{ id: 'old' }], schoolAccountState: { filter: 'pending', query: 'Test' },
    PLATFORM: { getSchoolRecords() {
      calls += 1;
      return calls === 1 ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve([{ id: 'new' }]);
    } },
    document: { hidden: false, getElementById: id => controls[id] },
    window: { setInterval: (callback, delay) => { controls.interval = { callback, delay }; return 1; }, clearInterval: () => { controls.interval = null; } },
    renderSchoolAccounts() { renders += 1; }
  };
  vm.runInNewContext(platformSchoolAccounts.slice(start, end), context);
  const first = vm.runInNewContext('refreshSchoolAccounts()', context);
  const second = vm.runInNewContext('refreshSchoolAccounts(true)', context);
  assert.equal(calls, 1);
  finishFirst([{ id: 'old' }]);
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(context.schoolAccountRecords[0].id, 'new');
  assert.equal(context.schoolAccountState.filter, 'pending');
  assert.equal(context.schoolAccountState.query, 'Test');
  assert.equal(renders, 2);
  vm.runInNewContext('startSchoolAccountPolling()', context);
  assert.equal(controls.interval.delay, 60000);
  context.document.hidden = true;
  vm.runInNewContext('stopSchoolAccountPolling()', context);
  assert.equal(controls.interval, null);
  context.PLATFORM.getSchoolRecords = async () => { throw new Error('offline'); };
  await assert.rejects(vm.runInNewContext('refreshSchoolAccounts()', context), /offline/);
  assert.equal(context.schoolAccountRecords[0].id, 'new');
  assert.equal(controls.schoolAccountRefreshError.hidden, false);
  context.PLATFORM.getSchoolRecords = async () => [{ id: 'recovered' }];
  await vm.runInNewContext('refreshSchoolAccounts()', context);
  assert.equal(context.schoolAccountRecords[0].id, 'recovered');
  assert.equal(controls.schoolAccountRefreshError.hidden, true);
});

test('platform rejection submits an empty optional reason without a validation toast', async () => {
  const start = platformSchoolAccounts.indexOf('async function rejectSchoolRegistration() {');
  const end = platformSchoolAccounts.indexOf('\n    function closeSchoolAccountModal()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const calls = { schoolId: null, action: null, reason: null, toastMessages: [] };
  const elements = {
    schoolAccountRejectionReason: { value: ' \t\n ' },
    schoolAccountRejectConfirm: { disabled: false, textContent: 'Reject registration' }
  };
  const context = {
    document: { getElementById: id => elements[id] },
    schoolAccountState: { selectedSchoolId: 19 },
    window: { EDUGNAY_API: { async changePlatformSchool(schoolId, action, reason) {
      calls.schoolId = schoolId;
      calls.action = action;
      calls.reason = reason;
      return { id: schoolId };
    } } },
    showAppToast: message => calls.toastMessages.push(message),
    closeSchoolRejectionModal() {},
    closeSchoolAccountModal() {},
    async refreshSchoolAccounts() {}
  };

  await vm.runInNewContext(`${platformSchoolAccounts.slice(start, end)}\nrejectSchoolRegistration()`, context);
  assert.equal(calls.schoolId, 19);
  assert.equal(calls.action, 'reject');
  assert.equal(calls.reason, '');
  assert.deepEqual(calls.toastMessages, ['School registration rejected.']);
});

test('report dashboards do not present unavailable reports as empty backend counts', () => {
  const teacherDashboard = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
  const parentDashboard = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-dashboard.html'), 'utf8');
  const parentReports = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-reports.html'), 'utf8');
  assert.match(teacherDashboard, /EDUGNAY_API\.request\('\/reports\/weekly-drafts\/pending-count'\)/);
  assert.match(teacherDashboard, /label: 'Reports to Confirm'/);
  assert.match(teacherDashboard, /value: TEACHER_PENDING_REPORTS_ERROR \? '—' : TEACHER_PENDING_REPORTS/);
  assert.match(parentDashboard, /showReportState\('error', 'Reports unavailable'/);
  assert.match(parentDashboard, /No shared report yet/);
  assert.doesNotMatch(parentReports, /reports\[\]|frontend report generation|frontend report array/);
});
