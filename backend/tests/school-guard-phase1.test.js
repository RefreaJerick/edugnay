const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const databaseModule = require('../config/database');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const calls = [];
let user;
const connection = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('school_email_domain AS schoolEmailDomain FROM schools')) {
      return [[{ schoolEmailDomain: 'example.edu.ph' }]];
    }
    if (sql.startsWith('SELECT id FROM users WHERE school_email')) return [[]];
    if (sql.includes('LEFT JOIN school_guard_profiles') && sql.includes('employee_number = ?')) return [[]];
    if (sql.startsWith('INSERT INTO users')) {
      user = {
        id: 71, schoolId: values[0], role: values[1], schoolEmail: values[2],
        personalEmail: values[3], accountStatus: 'active', firstName: values[6],
        lastName: values[7], displayName: values[8], initials: values[9],
        schoolGuardEmployeeNumber: 'GUARD-001'
      };
      return [{ insertId: user.id }];
    }
    if (sql.startsWith('UPDATE school_guard_profiles SET employee_number')) {
      user.schoolGuardEmployeeNumber = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE users SET first_name')) {
      user = { ...user, firstName: values[0], lastName: values[1],
        personalEmail: values[2], accountStatus: values[3], displayName: values[4], initials: values[5] };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM users') && sql.includes('LEFT JOIN school_guard_profiles')) return [[user]];
    return [[{ affectedRows: 1 }]];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: connection.execute.bind(connection) });
const { createUser, updateUser } = require('../controllers/usersController');

test('school admin can create a guard with a distinct staff profile', async () => {
  calls.length = 0;
  const result = { status: null, body: null, error: null };
  await createUser({ user: { id: 1, role: 'school_admin', schoolId: 3 }, body: {
    role: 'school_guard', firstName: 'Ana', lastName: 'Santos',
    personalEmail: 'ana@example.test', employeeNo: 'guard-001'
  } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });

  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, 'school_guard');
  assert.equal(result.body.user.profile.employeeNumber, 'GUARD-001');
  assert.equal(result.body.user.schoolEmail, 'a.santos.guard@example.edu.ph');
  assert.ok(calls.some(call => call.sql?.includes('INSERT INTO school_guard_profiles')));
  assert.ok(calls.includes('commit'));
});

test('school admin can edit and deactivate a guard account', async () => {
  calls.length = 0;
  const result = { status: null, body: null, error: null };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; } };
  const req = { user: { id: 1, role: 'school_admin', schoolId: 3 }, params: { userId: '71' },
    body: { employeeNo: 'guard-002', accountStatus: 'inactive' } };
  await updateUser(req, res, error => { result.error = error; });

  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(result.body.user.accountStatus, 'inactive');
  assert.equal(result.body.user.profile.employeeNumber, 'GUARD-002');
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE school_guard_profiles SET employee_number')));
  assert.ok(calls.some(call => call.sql?.startsWith('DELETE FROM user_sessions')));
});

test('guard role is school scoped and keeps broad school routes closed', () => {
  const schema = read('backend/database/schema.sql');
  const migration = read('backend/database/migrations/074_add_school_guard_fetcher_foundation.sql');
  const pickupHistoryMigration = read('backend/database/migrations/075_add_pickup_name_snapshots.sql');
  for (const sql of [schema, migration]) {
    assert.match(sql, /'school_guard'\) AND school_id IS NOT NULL/);
    for (const table of ['school_guard_profiles', 'fetchers', 'fetcher_authorizations', 'fetcher_credentials', 'pickup_records']) {
      assert.match(sql, new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(`));
    }
  }
  assert.match(schema, /UNIQUE KEY uq_pickup_records_school_day \(school_id, student_user_id, school_date\)/);
  assert.match(pickupHistoryMigration, /guard_name_at_pickup/);
  assert.match(schema, /student_name_at_pickup VARCHAR\(220\) NOT NULL/);
  const authorize = read('backend/middleware/authorize.js');
  assert.match(authorize, /requireSchoolGuard = requireRole\('school_guard'\)/);
  assert.doesNotMatch(authorize, /const roles = \[[^\]]*'school_guard'/);
  assert.match(read('assets/js/auth/login.js'), /school_guard: '\.\/views\/guard\/edugnay-guard-dashboard\.html'/);
  assert.match(read('views/guard/edugnay-guard-dashboard.html'), /<title>Dashboard \| AcadeMix<\/title>/);
});

test('guard dashboard matches role dashboard layout and keeps pickup controls intact', () => {
  const html = read('views/guard/edugnay-guard-dashboard.html');
  const css = read('assets/css/guard/dashboard.css');
  const fetcherCss = read('assets/css/fetchers.css');

  for (const component of [
    'shell', 'sidebar', 'topbar', 'main', 'dashboard-grid guard-dashboard-grid',
    'dash-col-left', 'dash-col-right', 'stat-card blue', 'panel guard-panel'
  ]) {
    assert.ok(html.includes(`class="${component}"`), `missing shared ${component} component`);
  }
  for (const id of [
    'tbProfileTrigger', 'tbProfileDropdown', 'guardWelcome', 'guardSchoolYear', 'guardPickedCount', 'guardAwaitingCount',
    'guardCameraPlaceholder',
    'weekCalendarGrid', 'weekRangeLabel', 'guardStartScan', 'guardStopScan',
    'guardCodeForm', 'guardCodeInput', 'guardVerified', 'guardFetcherPhoto', 'guardStudents',
    'guardPickupFrom', 'guardPickupTo', 'guardPickupToday', 'guardPickupHistory', 'guardPickupCount', 'guardPickupMore'
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `missing guard control ${id}`);
  }
  assert.match(html, /guard-panel-content guard-scanner dashboard-grid[\s\S]*?dash-col-left[\s\S]*?guardCameraPlaceholder[\s\S]*?guardScannerVideo[\s\S]*?guardStartScan[\s\S]*?dash-col-right[\s\S]*?guardCodeForm[\s\S]*?Before you confirm/);
  assert.match(html, /class="panel">[\s\S]*?id="guardCameraPlaceholder"[\s\S]*?id="guardScannerVideo"/);
  assert.match(html, /role="list" aria-label="Steps before confirming handover"[\s\S]*?role="listitem">[\s\S]*?class="panel-sub">1\. Scan the QR code or enter the code\.[\s\S]*?role="listitem">[\s\S]*?class="panel-sub">2\. Check that the person matches the ID\.[\s\S]*?role="listitem">[\s\S]*?class="panel-sub">3\. Confirm the student, then hand them over\./);
  assert.doesNotMatch(html, /class="badge badge-navy">[123]/);
  assert.doesNotMatch(html, /guardCameraState|Camera off"[^>]*badge/);
  assert.match(html, /guardCodeForm" class="guard-code-form"[\s\S]*?class="form-label" for="guardCodeInput">Manual code[\s\S]*?class="guard-actions school-field"[\s\S]*?class="form-input guard-code-input"[\s\S]*?type="submit" class="top-btn primary">Verify/);
  assert.match(css, /\.guard-code-form \{[^}]*gap: 10px;/);
  assert.match(css, /\.guard-code-input \{[^}]*flex: 1 1 220px;[^}]*min-width: 0;/);
  assert.match(fetcherCss, /\.pickup-history-filters \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(fetcherCss, /\.pickup-history-filters \.pickup-history-today \{[^}]*height: 42px;[^}]*min-height: 42px;/);
  assert.match(css, /\.guard-scanner video \{[^}]*margin: 0 auto;/);
  assert.match(html, /class="school-field academic-range-group" data-academic-range[\s\S]*?id="guardPickupFrom" type="date"[\s\S]*?id="guardPickupTo" type="date"/);
  assert.match(html, /id="guardPickupToday"[^>]*>Today<\/button>/);
  assert.doesNotMatch(html, /guardPickupDate/);
  assert.doesNotMatch(html, /Show history|guardPickupApply/);
  assert.match(html, /id="guardSchoolYearCard" role="group" aria-label="School year">/);
  assert.match(html, /id="guardSchoolYear">—<\/span>/);
  assert.match(read('assets/js/guard/dashboard.js'), /updateSchoolYear\(data\.schoolYear \|\| activeSchool\?\.schoolYear\)/);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*?\.guard-stats \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(html, /data-page-click="sab86664ca3f5"/);
  assert.match(html, /data-page-click="sc48f42f1ec91"/);
  assert.match(html, /data-theme-control/);
  assert.match(html, /assets\/js\/page-events\.js/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Outfit:[\s\S]*Plus\+Jakarta\+Sans/);
  assert.match(html, /data-page-title="Dashboard"/);
  assert.match(html, /<strong class="page-title" data-page-title-target>Dashboard<\/strong>/);
  assert.doesNotMatch(html, /Guard Dashboard/);
  assert.match(html, /assets\/css\/admin\/dashboard\.css/);
  assert.match(html, /assets\/js\/academic-date-picker\.js/);
  assert.match(html, /assets\/js\/portal-header-init\.js/);
  assert.match(html, /assets\/css\/academic-range-picker\.css/);
  assert.match(html, /href="edugnay-guard-profile\.html"[\s\S]*?My Profile/);
  assert.doesNotMatch(html, /Toast sounds/);
  assert.match(css, /\.guard-stats\s*\{[^}]*display:\s*grid/s);
  assert.doesNotMatch(css, /\.dashboard-grid\.guard-dashboard-grid|\.guard-week-panel/);
  assert.doesNotMatch(css, /\.guard-(?:shell|sidebar|topbar)\b/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});

test('guard dashboard renders only after a guard session is confirmed', async () => {
  const script = read('assets/js/guard/dashboard.js');
  for (const role of ['school_guard', 'teacher']) {
    const calls = [];
    let denyCamera = false;
    const stream = { getTracks: () => [{ stop() {} }] };
    const brand = { textContent: '' };
    const documentListeners = {};
    const rangePickers = [];
    const elements = {
      guardWelcome: { textContent: '' }, guardError: { hidden: true, textContent: '' },
      guardSchoolYearCard: { hidden: false },
      guardSchoolYear: { textContent: '—' },
      guardCameraPlaceholder: { hidden: false },
      guardScannerVideo: { hidden: true, srcObject: null, async play() {} },
      guardPickupHistory: { children: [], innerHTML: '', replaceChildren(...items) { this.children = [...items]; } },
      guardPickupFrom: { value: '', dispatchEvent() {}, addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; } },
      guardPickupTo: { value: '', dispatchEvent() {}, addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; } },
      guardPickupMore: { hidden: false, addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; } },
      guardPickupToday: { addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; } },
      guardPickupCount: { textContent: '' }
    };
    const element = id => elements[id] ||= { textContent: '', hidden: false,
      value: '', children: [], addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; }, append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; } };
    const state = { redirected: false, ready: false };
    await vm.runInNewContext(script, {
      URLSearchParams,
      document: { getElementById: element, addEventListener(name, handler) { documentListeners[name] = handler; },
        querySelector: selector => selector === '.pickup-history-section' ? {} : null,
        querySelectorAll(selector) { return selector === '.brand-sub:not([data-platform-brand])' ? [brand] : []; },
        createElement(tag) { return { tagName: tag, children: [], append(...items) { this.children.push(...items); } }; } },
      window: {
        EDUGNAY_APP_CONFIG: { apiBaseUrl: '/api' },
        EDUGNAY_API: { getCurrentUser: async () => ({ role, firstName: 'Ana' }) },
        EDUGNAY_CONFIG: { renderPanelEmptyState: options => `<div class="panel-empty-state">${options.title}</div>` },
        EDUGNAY_PICKUP_HISTORY: {
          today: () => '2026-11-19',
          countLabel: count => `${count} handovers`,
          render: () => ''
        },
        EDUGNAY_AVATAR: { hydrate() {} },
        EDUGNAY_PAGE_LOADING: { ready: () => { state.ready = true; } },
        location: { replace: () => { state.redirected = true; } },
        BarcodeDetector: class {
          static async getSupportedFormats() { return ['qr_code']; }
          async detect() { return []; }
        },
        initAcademicRangePickers(section, options) { rangePickers.push({ section, options }); },
        addEventListener() {}
      },
      navigator: { mediaDevices: { async getUserMedia() {
        if (denyCamera) throw Object.assign(new Error('Camera blocked.'), { name: 'NotAllowedError' });
        return stream;
      } } },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      queueMicrotask,
      Event,
      showAppToast: (message, type) => (state.toasts ||= []).push({ message, type }),
      fetch: async url => {
        calls.push(url);
        return { ok: true, json: async () => url.includes('/today')
          ? { schoolDate: '2026-11-19', schoolYear: '2026-2027', shortName: 'St. Columban’s College', pickedUp: 2, awaiting: 3 }
          : { records: [], timeZone: 'Asia/Manila',
            nextCursor: url.includes('from=2026-11-19') ? '52' : null } };
      }
    });
    assert.equal(state.ready, true);
    assert.equal(state.redirected, role !== 'school_guard');
    if (role === 'school_guard') {
      assert.equal(rangePickers[0].options.startSelector, '#guardPickupFrom');
      assert.equal(rangePickers[0].options.endSelector, '#guardPickupTo');
      assert.equal(rangePickers[0].options.allowSameDay, true);
      assert.equal(elements.guardWelcome.textContent, 'Welcome back, Ana!');
      assert.equal(elements.guardSchoolYear.textContent, '2026-2027');
      assert.equal(elements.guardSchoolYearCard.hidden, false);
      elements.guardSchoolYear.textContent = '';
      documentListeners['edugnay:school-context-updated']({ detail: {} });
      assert.equal(elements.guardSchoolYear.textContent, '—');
      assert.equal(elements.guardSchoolYearCard.hidden, false);
      documentListeners['edugnay:school-context-updated']({ detail: { schoolYear: '2026-2027' } });
      assert.equal(elements.guardSchoolYear.textContent, '2026-2027');
      assert.equal(brand.textContent, 'St. Columban’s College');
      assert.equal(elements.guardPickedCount.textContent, 2);
      assert.equal(elements.guardPickupFrom.value, '2026-11-19');
      assert.equal(elements.guardPickupTo.value, '2026-11-19');
      assert.equal((elements.weekCalendarGrid.innerHTML.match(/class="week-day(?:\s|")/g) || []).length, 7);
      assert.match(elements.weekRangeLabel.textContent, /\w+ \d+ – \w+ \d+/);
      assert.ok(calls.some(url => url.includes('/pickup/history?limit=50&from=2026-11-19&to=2026-11-19')));
      assert.match(elements.guardPickupHistory.innerHTML, /panel-empty-state/);
      assert.match(elements.guardPickupHistory.innerHTML, /No pickups found for this date/);
      assert.equal(elements.guardPickupMore.hidden, false);

      elements.guardPickupFrom.value = '2026-11-18';
      elements.guardPickupTo.value = '2026-11-18';
      elements.guardPickupFrom.listeners.change();
      elements.guardPickupTo.listeners.change();
      await new Promise(resolve => setTimeout(resolve, 0));
      const changedDateRequest = calls.find(url => url.includes('/pickup/history?limit=50&from=2026-11-18&to=2026-11-18'));
      assert.ok(changedDateRequest);
      assert.doesNotMatch(changedDateRequest, /cursor=/);
      assert.equal(elements.guardPickupMore.hidden, true);

      const callsBeforeToday = calls.length;
      elements.guardPickupToday.listeners.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(elements.guardPickupFrom.value, '2026-11-19');
      assert.equal(elements.guardPickupTo.value, '2026-11-19');
      const todayRequest = calls.slice(callsBeforeToday).find(url => url.includes('/pickup/history?limit=50&from=2026-11-19&to=2026-11-19'));
      assert.ok(todayRequest);
      assert.doesNotMatch(todayRequest, /cursor=/);

      await elements.guardStartScan.listeners.click();
      assert.equal(elements.guardCameraPlaceholder.hidden, true);
      await elements.guardStopScan.listeners.click();
      assert.equal(elements.guardCameraPlaceholder.hidden, false);

      denyCamera = true;
      await elements.guardStartScan.listeners.click();
      assert.ok(state.toasts.some(toast => toast.message === 'Camera permission was not granted.' && toast.type === 'error'));
    }
  }
});

test('admin guard form sends the staff number and rejects a duplicate', () => {
  const script = read('assets/js/admin/users.js');
  const formCode = script.split('    function getAccountFormData() {')[1]
    .split('    function openBackendCredentialDeliveryModal(')[0];
  const values = {
    accountRole: 'guard', accountUserId: '', accountFirstName: 'Ana', accountLastName: 'Santos',
    accountPersonalEmail: 'ana@example.test', accountEmployeeNo: 'guard-001'
  };
  const context = vm.createContext({
    document: { getElementById: id => ({ value: values[id] || '' }) },
    accountFieldValue: id => values[id] || '',
    ROLE_OPT_TO_TABLE: { guard: 'school_guard' },
    linkedStudents: [],
    USERS: [{ id: '9', role: 'teacher', employeeNo: 'GUARD-001' }]
  });
  vm.runInContext(`function getAccountFormData() {${formCode}`, context);
  const account = vm.runInContext('getAccountFormData()', context);
  assert.equal(account.role, 'school_guard');
  assert.equal(account.employeeNo, 'GUARD-001');
  assert.equal(vm.runInContext('validateAccountFormData(getAccountFormData())', context),
    'That employee number is already assigned to another staff account.');
});
