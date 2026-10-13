const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const onboarding = fs.readFileSync(path.join(__dirname, '../../views/onboarding/edugnay-school-onboarding.html'), 'utf8');
const pending = fs.readFileSync(path.join(__dirname, '../../views/onboarding/edugnay-registration-pending.html'), 'utf8');
const apiShell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');

test('onboarding submits the administrator name and notification email without a manual school address', () => {
  assert.doesNotMatch(onboarding, /id="adminEmail"|values\.adminEmail|schoolEmail:\s*administratorSchoolEmail/);
  assert.match(onboarding, /sessionStorage\.setItem\('edugnay_registration_status_token', createdSchool\.registrationStatusToken\)/);
  assert.doesNotMatch(onboarding, /sessionStorage\.setItem\('edugnay_pending_registration',\s*JSON\.stringify/);
  assert.match(apiShell, /registrationStatusToken: response\.registrationStatusToken/);
  assert.match(apiShell, /requestApi\('\/schools\/registration-status'/);
});

function createPendingPageContext({ token = 'opaque-token', registration, requestError } = {}) {
  const elements = new Map();
  const script = pending.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const calls = { statusToken: null, removedKeys: [] };
  const context = {
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          textContent: '', hidden: false, disabled: false,
          addEventListener() {}
        });
        return elements.get(id);
      }
    },
    sessionStorage: {
      getItem: key => key === 'edugnay_registration_status_token' ? token : null,
      removeItem: key => calls.removedKeys.push(key)
    },
    window: {
      EDUGNAY_API: {
        async getRegistrationStatus(value) {
          calls.statusToken = value;
          if (requestError) throw requestError;
          return registration;
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
  }
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

test('report dashboards do not present unavailable reports as empty backend counts', () => {
  const teacherDashboard = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
  const parentDashboard = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-dashboard.html'), 'utf8');
  const parentReports = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-reports.html'), 'utf8');
  assert.doesNotMatch(teacherDashboard, /TEACHER_ADVISORY_REPORTS|PENDING_REPORTS|Reports to Confirm/);
  assert.match(parentDashboard, /showEmptyReport\('Narrative reports unavailable'/);
  assert.doesNotMatch(parentDashboard, /No weekly report yet/);
  assert.doesNotMatch(parentReports, /reports\[\]|frontend report generation|frontend report array/);
});
