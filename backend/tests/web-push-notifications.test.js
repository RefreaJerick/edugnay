const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const webPush = require('web-push');
const subscriptions = require('../controllers/pushSubscriptionsController');
const { processPushQueue } = require('../workers/pushNotificationWorker');

const root = path.join(__dirname, '../..');
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-subscription';
const body = { endpoint, keys: { p256dh: 'a'.repeat(65), auth: 'b'.repeat(22) } };

function response() {
  return { code: 200, data: null, status(value) { this.code = value; return this; },
    json(value) { this.data = value; return this; }, send() { return this; } };
}

test('subscription validation rejects unsafe endpoints and accepts browser keys', () => {
  assert.deepEqual(subscriptions.parseSubscription(body), { endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth });
  for (const unsafe of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a',
    'https://fcm.googleapis.com.evil.example/a', 'https://user@fcm.googleapis.com/a']) {
    assert.equal(subscriptions.validEndpoint(unsafe), false);
  }
  assert.throws(() => subscriptions.parseSubscription({ ...body, keys: {} }), /invalid/);
});

test('a subscription belongs to the authenticated user and current session', async () => {
  const old = { public: process.env.VAPID_PUBLIC_KEY, private: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT };
  process.env.VAPID_PUBLIC_KEY = 'public-test';
  process.env.VAPID_PRIVATE_KEY = 'private-test';
  process.env.VAPID_SUBJECT = 'mailto:qa@example.com';
  try {
    const calls = [];
    const database = { async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id FROM user_sessions')) return [[{ id: 77 }]];
      if (sql.includes('SELECT subscriptions.id')) return [[{ id: 4 }]];
      return [{ affectedRows: 1 }];
    } };
    const req = { user: { id: 9, schoolId: 26 }, sessionToken: 'token', body };
    const saved = response();
    await subscriptions.subscribe(req, saved, error => { throw error; }, database);
    assert.equal(saved.code, 201);
    assert.equal(saved.data.enabled, true);
    assert.match(calls[0].sql, /session_token_hash = \?/);
    assert.equal(calls[1].values[0], 9);
    assert.equal(calls[1].values[1], 26);
    assert.equal(calls[1].values[2], 77);
    const checked = response();
    await subscriptions.status(req, checked, error => { throw error; }, database);
    assert.equal(checked.data.enabled, true);
    assert.match(calls[2].sql, /sessions.session_token_hash = \?/);
    const removed = response();
    await subscriptions.unsubscribe(req, removed, error => { throw error; }, database);
    assert.equal(removed.code, 204);
    assert.equal(calls[3].values[1], 9);
  } finally {
    for (const [name, value] of Object.entries({ VAPID_PUBLIC_KEY: old.public,
      VAPID_PRIVATE_KEY: old.private, VAPID_SUBJECT: old.subject })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

function queueDatabase(job) {
  const calls = [];
  return { calls, async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes("SET status = 'sending'")) return [{ affectedRows: 1 }];
    if (sql.includes('SELECT deliveries.id')) return [[job]];
    return [{ affectedRows: 1 }];
  } };
}

test('worker sends a privacy-safe weekly report alert while access is still valid', async () => {
  const keys = webPush.generateVAPIDKeys();
  const old = { public: process.env.VAPID_PUBLIC_KEY, private: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT };
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:qa@example.com';
  try {
    const job = { id: 5, attempts: 1, notificationId: 19, type: 'report', title: 'Weekly report updated',
      studentId: 111, subscriptionId: 2, subscriptionUserId: 9,
      endpoint, p256dh: body.keys.p256dh, authKey: body.keys.auth,
      recipientId: 9, role: 'parent', schoolId: 26, schoolStatus: 'active', activeSessionId: 77,
      parentLinkActive: 1 };
    const database = queueDatabase(job);
    let sent;
    await processPushQueue(database, async (subscription, payload) => { sent = { subscription, data: JSON.parse(payload) }; });
    assert.equal(sent.data.title, 'Weekly report updated');
    assert.equal(sent.data.body, 'An updated weekly report is ready to view in AcadeMix.');
    assert.equal(sent.data.notificationId, '19');
    assert.doesNotMatch(JSON.stringify(sent), /student|score|journal|follow-up/i);
    assert.ok(database.calls.some(call => call.sql.includes("status = 'sent'")));

    const revoked = queueDatabase({ ...job, parentLinkActive: 0 });
    await processPushQueue(revoked, async () => { throw new Error('Must not send to a removed parent'); });
    assert.ok(revoked.calls.some(call => call.sql.includes("status = 'failed'")));

    const teacher = queueDatabase({ ...job, role: 'teacher', parentLinkActive: 0 });
    let teacherSent = false;
    await processPushQueue(teacher, async () => { teacherSent = true; });
    assert.equal(teacherSent, true);

    const expired = queueDatabase({ ...job, activeSessionId: null });
    await processPushQueue(expired, async () => { throw new Error('Must not send after session expiry'); });
    assert.ok(expired.calls.some(call => call.sql.includes("status = 'failed'")));

    const switched = queueDatabase({ ...job, subscriptionUserId: 10 });
    await processPushQueue(switched, async () => { throw new Error('Must not send after an account switch'); });
    assert.ok(switched.calls.some(call => call.sql.includes("status = 'failed'")));

    const gone = queueDatabase(job);
    await processPushQueue(gone, async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); });
    assert.ok(gone.calls.some(call => call.sql.includes('DELETE FROM push_subscriptions')));
  } finally {
    for (const [name, value] of Object.entries({ VAPID_PUBLIC_KEY: old.public,
      VAPID_PRIVATE_KEY: old.private, VAPID_SUBJECT: old.subject })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('worker maps notification types to descriptive, privacy-safe banner copy', async () => {
  const keys = webPush.generateVAPIDKeys();
  const old = { public: process.env.VAPID_PUBLIC_KEY, private: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT };
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:qa@example.com';
  try {
    const baseJob = { id: 5, attempts: 1, notificationId: 19, type: 'unknown', title: 'Unknown event',
      message: 'Secret Learner has a score of 42 in Chemistry.', studentId: 111, subscriptionId: 2,
      subscriptionUserId: 9, endpoint, p256dh: body.keys.p256dh, authKey: body.keys.auth,
      recipientId: 9, role: 'parent', schoolId: 26, schoolStatus: 'active', activeSessionId: 77,
      parentLinkActive: 1 };
    const cases = [
      [{ type: 'announcement', title: 'New announcement', message: 'Family Day schedule' },
        'New announcement', 'Family Day schedule'],
      [{ type: 'calendar_notice', title: 'No classes', message: 'Date: 2026-12-25',
        calendarNoticeDetail: 'Classes are cancelled today.' },
        'No classes', 'Dec. 25, 2026: Classes are cancelled today.'],
      [{ type: 'calendar_notice', title: 'First day', message: 'Date: 2026-01-01',
        calendarNoticeDetail: 'Welcome back.' },
        'First day', 'Jan. 1, 2026: Welcome back.'],
      [{ type: 'calendar_notice', title: 'Last day of February', message: 'Date: 2026-02-28',
        calendarNoticeDetail: 'Term ends.' },
        'Last day of February', 'Feb. 28, 2026: Term ends.'],
      [{ type: 'calendar_notice', title: 'First day of March', message: 'Date: 2026-03-01',
        calendarNoticeDetail: 'Classes resume.' },
        'First day of March', 'Mar. 1, 2026: Classes resume.'],
      [{ type: 'calendar_notice', title: 'Consultation', message: 'Date: 2026-01-01',
        calendarNoticeDetail: '' },
        'Consultation', 'Jan. 1, 2026'],
      [{ type: 'calendar_notice', title: 'Invalid date', message: 'Date: 2026-02-30',
        calendarNoticeDetail: 'See the school calendar.' },
        'Invalid date', 'Date: 2026-02-30: See the school calendar.'],
      [{ type: 'grade', title: 'Subject grade published', role: 'student' },
        'Final grade published', 'A new final grade is available in AcadeMix.'],
      [{ type: 'grade', title: 'Published grade below passing', role: 'parent' },
        'Grade alert', 'A grade update is ready to review in AcadeMix.'],
      [{ type: 'attendance', title: 'Consecutive missed subject meeting dates' },
        'Attendance alert', 'An attendance alert is ready to review in AcadeMix.'],
      [{ type: 'pickup', title: 'Student picked up',
        message: 'Juan Santos was picked up by Maria Santos on Nov 19, 2026, 1:05 PM.' },
        'Student pickup confirmed', 'Juan Santos was picked up by Maria Santos on Nov 19, 2026, 1:05 PM.'],
      [{ type: 'assignment', title: 'Assignments not completed' },
        'Assignment reminder', 'An assignment reminder is ready to review in AcadeMix.'],
      [{ type: 'journal', title: 'Journal entries not submitted' },
        'Journal reminder', 'A journal reminder is ready to review in AcadeMix.'],
      [{ type: 'report', title: 'Weekly report available' },
        'Weekly report available', 'A weekly report is ready to view in AcadeMix.'],
      [{ type: 'report', title: 'Weekly report updated' },
        'Weekly report updated', 'An updated weekly report is ready to view in AcadeMix.'],
      [{ type: 'school_account', title: 'School account awaiting review' },
        'School registration awaiting review', 'A school registration is ready for review in AcadeMix.'],
      [{ type: 'school_account', title: 'School registration resubmitted' },
        'School registration resubmitted', 'A revised registration is ready for review in AcadeMix.'],
      [{ type: 'school_account', title: 'School account approved' },
        'School account approved', 'Your school account is ready in AcadeMix.'],
      [{ type: 'school_account', title: 'School account rejected' },
        'School account rejected', 'Open AcadeMix to review the registration decision.'],
      [{ type: 'school_account', title: 'School account suspended' },
        'School account suspended', 'Open AcadeMix for details about your school account.'],
      [{ type: 'school_account', title: 'School account reactivated' },
        'School account reactivated', 'Your school account is active again.'],
      [{ type: 'grading_period_reopen', title: 'Grade access approved', role: 'teacher' },
        'Grade access approved', 'Your grade-editing access changed. Open AcadeMix for class and term details.'],
      [{ type: 'grading_period_reopen', title: 'Grade access request rejected', role: 'teacher' },
        'Grade access request rejected', 'Your grade-editing access changed. Open AcadeMix for class and term details.'],
      [{ type: 'grading_period_reopen', title: 'Grade editing deadline extended', role: 'teacher' },
        'Grade editing deadline extended', 'Your grade-editing access changed. Open AcadeMix for class and term details.'],
      [{ type: 'grading_period_reopen', title: 'Grade editing access revoked', role: 'teacher' },
        'Grade editing access revoked', 'Your grade-editing access changed. Open AcadeMix for class and term details.'],
      [{ type: 'student_transfer', title: 'New student in your section', role: 'teacher' },
        'New student in your section', 'A student was added to one of your sections. Open AcadeMix to view it.'],
      [{ type: 'future_notification', title: 'Future event' },
        'New Academix notification', 'Open AcadeMix to view it.']
    ];

    for (const [overrides, expectedTitle, expectedBody] of cases) {
      let sent;
      const database = queueDatabase({ ...baseJob, ...overrides });
      await processPushQueue(database, async (_subscription, payload) => {
        sent = JSON.parse(payload);
      });
      assert.equal(sent.title, expectedTitle);
      assert.equal(sent.body, expectedBody);
      if (overrides.type === 'pickup') assert.equal(sent.type, 'pickup');
      assert.doesNotMatch(JSON.stringify(sent), /Secret Learner|Chemistry|score of 42/);
      if (overrides.type === 'calendar_notice') {
        const select = database.calls.find(call => call.sql.includes('SELECT deliveries.id'))?.sql || '';
        assert.match(select, /calendar_notices\.detail AS calendarNoticeDetail/);
        assert.match(select, /calendar_notices\.school_id = recipients\.school_id/);
      }
    }

    let longHeadlinePayload;
    await processPushQueue(queueDatabase({ ...baseJob, type: 'announcement', title: 'New announcement',
      message: 'A'.repeat(130) }), async (_subscription, payload) => { longHeadlinePayload = JSON.parse(payload); });
    assert.equal(Array.from(longHeadlinePayload.body).length, 120);
    assert.equal(longHeadlinePayload.body, `${'A'.repeat(119)}…`);
  } finally {
    for (const [name, value] of Object.entries({ VAPID_PUBLIC_KEY: old.public,
      VAPID_PRIVATE_KEY: old.private, VAPID_SUBJECT: old.subject })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('schema queues only new saved notifications and logout removes session-bound devices', () => {
  const migration = pageFs.readFileSync(path.join(root, 'backend/database/migrations/048_web_push_notifications.sql'), 'utf8');
  assert.match(migration, /AFTER INSERT ON notifications/);
  assert.match(migration, /sessions.expires_at > NOW\(\)/);
  assert.match(migration, /FOREIGN KEY \(session_id\) REFERENCES user_sessions\(id\) ON DELETE CASCADE/);
  assert.match(migration, /UNIQUE KEY uq_push_delivery \(notification_id, subscription_id\)/);
  const release = pageFs.readFileSync(path.join(root, 'backend/controllers/narrativeReportReviewController.js'), 'utf8');
  assert.match(release, /await notifyParents\(connection,[\s\S]*?await connection.commit\(\)/);
  const auth = pageFs.readFileSync(path.join(root, 'backend/controllers/authController.js'), 'utf8');
  assert.match(auth, /if \(previousToken\) await deleteSession\(previousToken\);\s*const token = await createSession/);
});

test('service worker shows supplied safe copy and opens the correct in-scope notification page', async () => {
  const handlers = {};
  let displayed, opened;
  const scope = 'https://school.example/edugnay/';
  vm.runInNewContext(pageFs.readFileSync(path.join(root, 'push-sw.js'), 'utf8'), {
    URL, self: { registration: { scope, async showNotification(title, options) { displayed = { title, options }; } },
      addEventListener(name, handler) { handlers[name] = handler; },
      clients: { async matchAll() { return []; }, async openWindow(url) { opened = url; } } }
  });
  let task;
  handlers.push({ data: { json: () => ({ title: 'Weekly report available', notificationId: '19', role: 'parent',
    body: 'A weekly report is ready to view in AcadeMix.', summary: 'Private report text' }) }, waitUntil(value) { task = value; } });
  await task;
  assert.equal(displayed.title, 'Weekly report available');
  assert.equal(displayed.options.body, 'A weekly report is ready to view in AcadeMix.');
  assert.doesNotMatch(JSON.stringify(displayed), /Private report text/);
  handlers.notificationclick({ notification: { data: displayed.options.data, close() {} },
    waitUntil(value) { task = value; } });
  await task;
  assert.equal(opened, 'https://school.example/edugnay/views/parent/edugnay-parent-notifications.html?pushNotice=19');

  const pickupBody = 'Student picked up by Authorized Fetcher at 3:45 PM. '.repeat(5).trim();
  handlers.push({ data: { json: () => ({ title: 'Student pickup confirmed', type: 'pickup',
    notificationId: '20', role: 'parent', body: pickupBody }) }, waitUntil(value) { task = value; } });
  await task;
  assert.equal(displayed.options.body, pickupBody);

  handlers.push({ data: { json: () => ({ title: 42, body: { text: 'invalid' } }) }, waitUntil(value) { task = value; } });
  await task;
  assert.equal(displayed.title, 'New Academix notification');
  assert.equal(displayed.options.body, 'Open AcadeMix to view it.');

  handlers.push({ data: { json: () => ({ title: 'T'.repeat(100), body: 'B'.repeat(200) }) }, waitUntil(value) { task = value; } });
  await task;
  assert.equal(Array.from(displayed.title).length, 80);
  assert.equal(Array.from(displayed.options.body).length, 160);
});

test('the login return route accepts only the matching role notification page', () => {
  const page = pageFs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = page.slice(page.indexOf('    function destinationForUser('), page.indexOf('    async function checkEmail('));
  function destination(search) {
    return vm.runInNewContext(`${source}\ndestinationForUser({ role: 'parent' })`, {
      URL, URLSearchParams, DASHBOARD_BY_ROLE: { parent: './views/parent/edugnay-parent-dashboard.html' },
      window: { location: {
        search, href: 'https://school.example/edugnay/index.html', origin: 'https://school.example'
      } }
    });
  }
  const expected = 'https://school.example/edugnay/views/parent/edugnay-parent-notifications.html?pushNotice=19';
  assert.equal(destination(`?returnTo=${encodeURIComponent('/edugnay/views/parent/edugnay-parent-notifications.html?pushNotice=19')}`), expected);
  assert.equal(destination(`?returnTo=${encodeURIComponent('https://evil.example/edugnay/views/parent/edugnay-parent-notifications.html?pushNotice=19')}`), './views/parent/edugnay-parent-dashboard.html');
  assert.equal(destination(`?returnTo=${encodeURIComponent('/edugnay/views/teacher/edugnay-teacher-notifications.html?pushNotice=19')}`), './views/parent/edugnay-parent-dashboard.html');
});

async function createPushNotificationPage({
  supportsPush = true,
  permission = 'default',
  keyConfig = { enabled: true, publicKey: 'AQID' },
  failRequest = false
} = {}) {
  let onReady;
  let permissionRequested = false;
  let createdDialog;
  const calls = [];
  const handlers = {};
  const attributes = {};
  const status = {};
  const button = {
    addEventListener(type, handler) { handlers[`button:${type}`] = handler; },
    click() { return handlers['button:click']?.(); }
  };
  const closeButton = {
    addEventListener(type, handler) { handlers[`close:${type}`] = handler; },
    click() { return handlers['close:click']?.(); },
    focus() { this.focused = true; }
  };
  const trigger = {
    addEventListener(type, handler) { handlers[`trigger:${type}`] = handler; },
    setAttribute(name, value) { attributes[name] = value; },
    focus() { this.focused = true; },
    click() { return handlers['trigger:click']?.(); }
  };
  const dialog = {
    listeners: {}, open: false,
    setAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    querySelector(selector) {
      return selector === '.push-dialog-status' ? status
        : selector === '.push-toggle' ? button : closeButton;
    },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); }
  };
  const panel = { children: [], appendChild(element) { this.children.push(element); } };
  const document = {
    body: { children: [], appendChild(element) { this.children.push(element); createdDialog = element; } },
    addEventListener(type, handler) { if (type === 'DOMContentLoaded') onReady = handler; },
    querySelector(selector) { assert.equal(selector, '.notif-panel-head'); return panel; },
    createElement(tag) { return tag === 'dialog' ? dialog : trigger; }
  };
  const location = { href: 'http://127.0.0.1:3000/views/parent/edugnay-parent-notifications.html', search: '' };
  const Notification = {
    permission,
    async requestPermission() { permissionRequested = true; return 'granted'; }
  };
  const window = {
    location, isSecureContext: true,
    EDUGNAY_APP_CONFIG: { apiBaseUrl: 'http://127.0.0.1:3000/api' }
  };
  const navigator = {};
  const context = { document, location, URL, URLSearchParams, atob, setTimeout, window, navigator,
    async fetch(url, options) {
      calls.push({ url, options });
      if (failRequest) throw new Error('Offline');
      return { ok: true, status: 200, async json() { return keyConfig; } };
    }
  };
  if (supportsPush) {
    const PushManager = function PushManager() {};
    window.PushManager = PushManager;
    window.Notification = Notification;
    context.PushManager = PushManager;
    context.Notification = Notification;
    let subscription = null;
    const savedSubscription = { endpoint, toJSON() { return body; }, async unsubscribe() { subscription = null; } };
    navigator.serviceWorker = { async register() { return { pushManager: {
      async getSubscription() { return subscription; },
      async subscribe() { subscription = savedSubscription; return subscription; }
    } }; } };
  }
  vm.runInNewContext(pageFs.readFileSync(path.join(root, 'assets/js/push-notifications.js'), 'utf8'), context);
  assert.equal(createdDialog, undefined);
  onReady();
  await new Promise(resolve => setImmediate(resolve));
  return { panel, body: document.body, dialog, trigger, button, closeButton, status, calls, attributes,
    get permissionRequested() { return permissionRequested; } };
}

test('notification settings open on demand and preserve enable, disable, and focus behavior', async () => {
  const page = await createPushNotificationPage();
  assert.equal(page.panel.children.length, 1);
  assert.equal(page.panel.children[0], page.trigger);
  assert.equal(page.body.children[0], page.dialog);
  assert.match(page.dialog.innerHTML, /data-lucide="bell"/);
  assert.match(page.dialog.innerHTML, /In-app notifications remain available/);
  assert.match(page.trigger.innerHTML, /data-lucide="settings"/);
  assert.equal(page.attributes['aria-label'], 'Notification settings');
  assert.equal(page.status.textContent, 'Off on this device');
  assert.equal(page.button.textContent, 'Enable device notifications');
  assert.equal(page.button.hidden, false);

  page.trigger.click();
  assert.equal(page.dialog.open, true);
  assert.equal(page.attributes['aria-expanded'], 'true');
  assert.equal(page.closeButton.focused, true);
  assert.equal(page.permissionRequested, false);
  page.closeButton.click();
  assert.equal(page.dialog.open, false);
  assert.equal(page.attributes['aria-expanded'], 'false');
  assert.equal(page.trigger.focused, true);

  page.trigger.click();
  await page.button.click();
  assert.equal(page.permissionRequested, true);
  assert.equal(page.status.textContent, 'Enabled on this device');
  assert.equal(page.button.textContent, 'Turn off device notifications');
  assert.ok(page.calls.some(call => call.url.endsWith('/push-subscriptions') && call.options.method === 'POST'));
  await page.button.click();
  assert.equal(page.status.textContent, 'Off on this device');
  assert.ok(page.calls.some(call => call.url.endsWith('/push-subscriptions') && call.options.method === 'DELETE'));
});

test('notification settings explain denied, unsupported, unconfigured, and failed states', async () => {
  const cases = [
    [{ permission: 'denied' }, 'Blocked in browser settings'],
    [{ supportsPush: false }, 'Not supported in this browser or connection'],
    [{ keyConfig: { enabled: false, publicKey: null } }, 'Device notifications are not available right now'],
    [{ failRequest: true }, 'Device notifications could not be loaded']
  ];
  for (const [options, expectedStatus] of cases) {
    const page = await createPushNotificationPage(options);
    page.trigger.click();
    assert.equal(page.dialog.open, true);
    assert.equal(page.status.textContent, expectedStatus);
    assert.equal(page.button.hidden, true);
    assert.equal(page.permissionRequested, false);
  }
});

test('all notification pages load the shared controls and installation assets are scoped to the frontend', () => {
  const manifest = JSON.parse(pageFs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const role of ['parent', 'student', 'teacher', 'admin', 'platform']) {
    const page = pageFs.readFileSync(path.join(root, `views/${role}/edugnay-${role}-notifications.html`), 'utf8');
    assert.match(page, /assets\/js\/push-notifications\.js/);
    assert.match(page, /class="notif-panel-head"/);
    assert.match(page, /manifest\.webmanifest/);
  }
  const script = pageFs.readFileSync(path.join(root, 'assets/js/push-notifications.js'), 'utf8');
  assert.match(script, /new URL\('\.\.\/\.\.\/', window\.location\.href\)/);
  assert.match(script, /Notification\.requestPermission\(\)/);
  assert.match(script, /registration\.pushManager\.subscribe\(/);
  const styles = pageFs.readFileSync(path.join(root, 'assets/css/notifications.css'), 'utf8');
  assert.match(styles, /\.push-settings-dialog\s*\{/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.push-settings-dialog/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /settingsTrigger\.focus\(\)/);
  for (const file of ['index.html', ...['parent', 'student', 'teacher', 'admin', 'platform']
    .map(role => `views/${role}/edugnay-${role}-notifications.html`)]) {
    const html = pageFs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: file });
    }
  }
});
