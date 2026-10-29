const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
const key = 'edugnay_profile_display_v1';
const legacyKey = 'edugnay_student_profile_display_v1';
const roles = [
  { role: 'student', folder: 'student', userId: '7', schoolId: '2', name: 'Jerick Refrea', initials: 'JR' },
  { role: 'teacher', folder: 'teacher', userId: '8', schoolId: '2', name: 'Maya Santos', initials: 'MS' },
  { role: 'school_admin', folder: 'admin', userId: '9', schoolId: '2', name: 'Admin Santos', initials: 'AS' },
  { role: 'parent', folder: 'parent', userId: '10', schoolId: '2', name: 'Parent Santos', initials: 'PS' },
  { role: 'platform_admin', folder: 'platform', userId: '11', schoolId: '', name: 'Platform Admin', initials: 'PA' }
];

function snapshotFor(account) {
  return {
    version: 1, role: account.role, userId: account.userId, schoolId: account.schoolId,
    displayName: account.name, initials: account.initials,
    avatarUrl: `/api/users/${account.userId}/avatar?v=1`
  };
}

function createHarness(account, storedSnapshot = null, storedKey = key) {
  const storage = new Map(storedSnapshot ? [[storedKey, JSON.stringify(storedSnapshot)]] : []);
  const classes = new Set();
  const name = { textContent: 'Loading account...' };
  const role = { textContent: '' };
  const avatar = { textContent: '' };
  const trigger = { setAttribute(attribute, value) { this[attribute] = value; } };
  const nodes = {
    '.tb-profile-name': [name], '.tb-profile-role': [role],
    '.tb-avatar': [avatar], '.tb-profile-trigger .tb-avatar': [avatar],
    '.tb-profile-trigger': [trigger]
  };
  const document = {
    documentElement: { classList: {
      add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value)
    } },
    querySelectorAll: selector => nodes[selector] || [],
    dispatchEvent() {},
    addEventListener() {}
  };
  const context = vm.createContext({
    document,
    location: { pathname: `/views/${account.folder}/edugnay-${account.folder}-dashboard.html`, hostname: 'localhost' },
    sessionStorage: {
      getItem: value => storage.get(value) ?? null,
      setItem: (value, data) => storage.set(value, data),
      removeItem: value => storage.delete(value),
      get length() { return storage.size; },
      key: index => [...storage.keys()][index] ?? null
    },
    window: { location: {} }, CustomEvent: class {},
    EDUGNAY_API_BASE_URL: 'http://localhost:3000/api',
    renderAvatar: (element, person) => { element.person = person; element.textContent = person.initials; }
  });

  const displayStart = source.indexOf('const EDUGNAY_PROFILE_ROLE_LABELS = {');
  const displayEnd = source.indexOf('let appToastTimer;', displayStart);
  const sessionStart = source.indexOf('function saveFrontendSession(session) {');
  const sessionEnd = source.indexOf('function renderAvatar(', sessionStart);
  const userStart = source.indexOf('async function getCurrentUser() {');
  const userEnd = source.indexOf('function applyCurrentUserToShell(', userStart);
  const applyEnd = source.indexOf('\nfunction setCurrentUserShellStatus(', userEnd);
  assert.ok(displayStart >= 0 && displayEnd > displayStart && sessionStart >= 0
    && sessionEnd > sessionStart && userStart >= 0 && userEnd > userStart && applyEnd > userEnd);

  vm.runInContext(`const EDUGNAY_PROFILE_DISPLAY_KEY = '${key}';
    const EDUGNAY_LEGACY_STUDENT_PROFILE_DISPLAY_KEY = '${legacyKey}';
    const EDUGNAY_SESSION_STORAGE_KEY = 'edugnay_session';
    const EDUGNAY_API_BASE_URL = 'http://localhost:3000/api';
    ${source.slice(displayStart, displayEnd)}
    ${source.slice(sessionStart, sessionEnd)}
    let currentUserRequest = null;
    ${source.slice(userStart, userEnd)}
    ${source.slice(userEnd, applyEnd)}`, context);
  return { context, storage, classes, name, role, avatar, trigger };
}

async function runShellInit(harness, loadCurrentUser) {
  let ready;
  harness.context.document.addEventListener = (name, callback) => {
    if (name === 'DOMContentLoaded') ready = callback;
  };
  Object.assign(harness.context, {
    initToastSoundToggle() {}, isPublicPage: () => false,
    getCurrentUser: loadCurrentUser,
    setCurrentUserShellStatus(label) { harness.name.textContent = label; },
    clearTeacherSidebarCache() {}, clearStudentSidebarCache() {}, clearParentSidebarCache() {},
    showAppToast() {}, applyCurrentDateToGradingBanners() {}, applyActiveSchoolToShell() {},
    applyGradePortalAccess() {}, applyPageTitleToTopbar() {}, initScrollFades() {}, initSidebarScrollbars() {}
  });
  const initStart = source.lastIndexOf("document.addEventListener('DOMContentLoaded', async () => {");
  assert.ok(initStart >= 0);
  vm.runInContext(source.slice(initStart), harness.context);
  await ready();
}

test('all portal roles restore the verified profile chip before account refresh', async () => {
  for (const account of roles) {
    const harness = createHarness(account, snapshotFor(account));
    assert.equal(harness.classes.has('profile-chip-page'), true, account.role);
    assert.equal(harness.classes.has('profile-chip-restoring'), true, account.role);
    vm.runInContext('restoreProfileChip()', harness.context);
    assert.equal(harness.name.textContent, account.name, account.role);
    assert.equal(harness.role.textContent, ({
      platform_admin: 'Platform Administrator', school_admin: 'Administrator',
      teacher: 'Faculty', student: 'Student', parent: 'Parent'
    })[account.role], account.role);
    assert.equal(harness.avatar.textContent, account.initials, account.role);
    assert.equal(harness.avatar.person.avatarUrl, `/api/users/${account.userId}/avatar?v=1`, account.role);
    assert.equal(harness.avatar.person.role, account.role, account.role);
    assert.equal(harness.classes.has('profile-chip-restoring'), false, account.role);
    assert.equal(harness.classes.has('profile-chip-restored'), true, account.role);

    let respond;
    harness.context.requestApi = () => new Promise(resolve => { respond = resolve; });
    const pending = vm.runInContext('getCurrentUser()', harness.context);
    assert.equal(harness.name.textContent, account.name, account.role);
    respond({ user: {
      id: Number(account.userId) + 100, schoolId: account.schoolId ? Number(account.schoolId) : null,
      role: account.role, displayName: `Updated ${account.name}`, initials: 'UP', avatarUrl: null
    } });
    const fresh = await pending;
    vm.runInContext('applyCurrentUserToShell(window.EDUGNAY_SESSION)', harness.context);
    assert.equal(fresh.displayName, `Updated ${account.name}`, account.role);
    assert.equal(harness.name.textContent, `Updated ${account.name}`, account.role);
    assert.equal(harness.avatar.textContent, 'UP', account.role);
    assert.equal(JSON.parse(harness.storage.get(key)).userId, String(Number(account.userId) + 100), account.role);
  }
});

test('legacy student display snapshots still restore and migrate to the shared key', () => {
  const account = roles[0];
  const harness = createHarness(account, snapshotFor(account), legacyKey);
  vm.runInContext('restoreProfileChip()', harness.context);
  assert.equal(harness.name.textContent, account.name);
  harness.context.saveFrontendSession({
    apiUserId: account.userId, apiSchoolId: account.schoolId, role: account.role,
    displayName: account.name, initials: account.initials, avatarUrl: null
  });
  assert.equal(harness.storage.has(legacyKey), false);
  assert.equal(JSON.parse(harness.storage.get(key)).role, 'student');
});

test('missing or mismatched snapshots are rejected; fresh identity replaces old display data', () => {
  for (const account of roles) {
    const other = roles.find(candidate => candidate.role !== account.role);
    const harness = createHarness(account, snapshotFor(other));
    assert.equal(harness.classes.has('profile-chip-restoring'), false, account.role);
    vm.runInContext('restoreProfileChip()', harness.context);
    assert.equal(harness.name.textContent, 'Loading account...', account.role);
    assert.equal(harness.storage.has(key), false, account.role);
  }

  const account = roles[1];
  for (const stale of [
    { ...account, userId: '99' },
    { ...account, schoolId: '99' }
  ]) {
    const harness = createHarness(account, snapshotFor(stale));
    vm.runInContext('restoreProfileChip()', harness.context);
    assert.equal(harness.name.textContent, stale.name, 'the cached display may render while identity is being checked');
    harness.context.saveFrontendSession({
      apiUserId: account.userId, apiSchoolId: account.schoolId, role: account.role,
      displayName: 'Verified Maya Santos', initials: 'VM', avatarUrl: null
    });
    vm.runInContext('applyCurrentUserToShell(window.EDUGNAY_SESSION)', harness.context);
    assert.equal(harness.name.textContent, 'Verified Maya Santos', 'fresh identity replaces stale display data');
    assert.equal(JSON.parse(harness.storage.get(key)).userId, account.userId);
    assert.equal(JSON.parse(harness.storage.get(key)).schoolId, account.schoolId);
  }

  const invalid = createHarness(roles[0], { ...snapshotFor(roles[0]), version: 2 });
  vm.runInContext('restoreProfileChip()', invalid.context);
  assert.equal(invalid.name.textContent, 'Loading account...');
});

test('sign-in, sign-out and expired sessions clear the shared display snapshot', async () => {
  const account = roles[0];
  const harness = createHarness(account, snapshotFor(account));
  const clearStart = source.indexOf('async function confirmLogout() {');
  const clearEnd = source.indexOf('function applyActiveSchoolToShell()', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  harness.context.requestApi = async () => {};
  harness.context.clearTeacherSidebarCache = () => {};
  harness.context.clearStudentSidebarCache = () => {};
  harness.context.clearParentSidebarCache = () => {};
  harness.context.isPublicPage = () => false;
  vm.runInContext(source.slice(clearStart, clearEnd), harness.context);
  await harness.context.confirmLogout();
  assert.equal(harness.storage.has(key), false);

  const login = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(login, /edugnay_profile_display_v1/);
  assert.match(login, /edugnay_student_profile_display_v1/);
  const loginCleanupStart = login.indexOf('function clearPortalCachesForSignIn() {');
  const loginCleanupEnd = login.indexOf('\n    async function checkEmail(', loginCleanupStart);
  assert.ok(loginCleanupStart >= 0 && loginCleanupEnd > loginCleanupStart);
  assert.doesNotThrow(() => new vm.Script(login.slice(loginCleanupStart, loginCleanupEnd)));

  const expired = createHarness(account, snapshotFor(account));
  vm.runInContext('restoreProfileChip()', expired.context);
  const unauthorized = Object.assign(new Error('expired'), { status: 401 });
  await runShellInit(expired, async () => { throw unauthorized; });
  assert.equal(expired.storage.has(key), false);
  assert.equal(expired.name.textContent, 'Account unavailable');
});

test('temporary account-load failures preserve an already restored chip', async () => {
  const account = roles[2];
  const harness = createHarness(account, snapshotFor(account));
  vm.runInContext('restoreProfileChip()', harness.context);
  await runShellInit(harness, async () => { throw new Error('offline'); });
  assert.equal(harness.name.textContent, account.name);
  assert.equal(harness.storage.has(key), true);
});

test('every signed-in portal header restores its chip before main content', () => {
  const portalDirs = ['student', 'teacher', 'admin', 'parent', 'platform'];
  let checked = 0;
  for (const role of portalDirs) {
    const directory = path.join(root, 'views', role);
    for (const page of fs.readdirSync(directory).filter(file => file.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(directory, page), 'utf8');
      if (!html.includes('assets/js/shell-common.js')) continue;
      assert.match(html, /assets\/js\/shell-common\.js/);
      assert.match(html, /<\/header>\s*<script>restoreProfileChip\(\);<\/script>/,
        `${role}/${page} should restore directly after its header`);
      checked += 1;
    }
  }
  assert.equal(checked, 47);

  const styles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  assert.match(styles, /html\.profile-chip-page \.tb-profile-trigger \{ width: 215px; \}/);
  assert.match(styles, /html\.profile-chip-page \.tb-profile-name \{ overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(styles, /html\.profile-chip-page \.tb-profile-trigger \{ width: auto; \}/);

  const parentShell = fs.readFileSync(path.join(root, 'assets/js/parent/shell.js'), 'utf8');
  assert.match(parentShell, /function renderParentIdentity\(\) \{[\s\S]*?if \(!parent && document\.documentElement\.classList\.contains\('profile-chip-restored'\)\) return;/);
  for (const role of ['admin', 'teacher']) {
    const profilePage = fs.readFileSync(path.join(root, `views/${role}/edugnay-${role}-profile.html`), 'utf8');
    assert.doesNotMatch(profilePage, /\.profile-header-name, \.tb-profile-name/);
    assert.match(profilePage, /if \(user\.id\) document\.querySelectorAll\('\.tb-profile-name'\)/);
  }
  const studentProfile = fs.readFileSync(path.join(root, 'views/student/edugnay-student-profile.html'), 'utf8');
  assert.match(studentProfile, /if \(!document\.documentElement\.classList\.contains\('profile-chip-restored'\)\) \{\s*setStudentText\('student-topbar-name'/);
});
