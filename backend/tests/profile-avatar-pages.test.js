const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const pages = ['admin', 'teacher', 'student', 'parent', 'platform'];

test('all profile pages use the shared saved-photo controls', () => {
  for (const role of pages) {
    const html = fs.readFileSync(path.join(root, `views/${role}/edugnay-${role}-profile.html`), 'utf8');
    for (const id of ['profileAvatar', 'avatarEditTrigger', 'avatarRemoveBtn', 'avatarFileInput', 'avatarMenu', 'avatarUploadBtn']) {
      assert.match(html, new RegExp(`id="${id}"`), `${role} is missing ${id}`);
    }
    const menu = html.match(/<div class="avatar-menu" id="avatarMenu"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
    assert.match(menu, /class="avatar-menu-item avatar-menu-item-danger" id="avatarRemoveBtn"[^>]*hidden/);
    assert.doesNotMatch(html, /class="profile-avatar-remove"/);
    assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
    assert.doesNotMatch(html, /FileReader|Change Avatar Color|handleAvatarUpload|onclick="toggleAvatarMenu/);
  }
  const styles = fs.readFileSync(path.join(root, 'assets/css/profile-common.css'), 'utf8');
  const fallbackAvatarRule = styles.match(/\.profile-avatar\s*\{([^}]+)\}/)?.[1] || '';
  const avatarRule = styles.match(/\.profile-avatar-wrap \.profile-avatar\.person-avatar\s*\{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(fallbackAvatarRule, /border\s*:/);
  assert.doesNotMatch(avatarRule, /border\s*:/);
});

test('profile photo actions show saved state and preserve it on failures', async () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const start = source.indexOf('function initProfileAvatar() {');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded', initProfileAvatar);", start);
  assert.ok(start >= 0 && end > start);
  const code = source.slice(start, end + "document.addEventListener('DOMContentLoaded', initProfileAvatar);".length);

  class Element {
    constructor() {
      this.listeners = {};
      this.attributes = {};
      this.hidden = false;
      this.parentElement = { appendChild: child => { this.status = child; }, classList: { toggle() {} } };
      this.classList = { toggle() {} };
    }
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    fire(name, event = {}) { return Promise.all((this.listeners[name] || []).map(handler => handler(event))); }
    setAttribute(name, value) { this.attributes[name] = value; }
    contains(target) { return target === this; }
    click() { this.clicked = true; }
    focus() { this.focused = true; }
  }

  const ids = Object.fromEntries(['profileAvatar', 'avatarEditTrigger', 'avatarMenu', 'avatarUploadBtn',
    'avatarRemoveBtn', 'avatarFileInput'].map(id => [id, new Element()]));
  ids.avatarMenu.hidden = true;
  ids.avatarRemoveBtn.hidden = true;
  let user = { apiUserId: 4, role: 'teacher', displayName: 'Maria Reyes', initials: 'MR', hasAvatar: false, avatarUrl: null };
  let uploadResult = { avatar: { hasAvatar: true, avatarUrl: '/api/users/4/avatar?v=1', avatarVersion: 1 } };
  let removeFails = false;
  const renders = [];
  const toasts = [];
  const document = {
    listeners: {},
    getElementById: id => ids[id],
    createElement: () => new Element(),
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
    fire(name, event = {}) { return Promise.all((this.listeners[name] || []).map(handler => handler(event))); }
  };
  const context = {
    document,
    window: { EDUGNAY_SESSION: user },
    EDUGNAY_API_BASE_URL: 'http://localhost:3000/api',
    renderAvatar: (element, person) => renders.push(person),
    readFrontendSession: () => user,
    saveFrontendSession: updated => { user = updated; },
    applyCurrentUserToShell: updated => document.fire('edugnay:current-user-updated', { detail: updated }),
    refreshCurrentUserAvatar: () => {},
    requestApiMultipart: async () => {
      if (uploadResult instanceof Error) throw uploadResult;
      return uploadResult;
    },
    requestApi: async () => { if (removeFails) throw new Error('Network failed'); },
    showAppToast: (message, type) => toasts.push({ message, type }),
    FormData,
    console
  };
  vm.runInNewContext(code, context);
  await document.fire('DOMContentLoaded');
  assert.equal(ids.avatarRemoveBtn.hidden, true);
  await ids.avatarEditTrigger.fire('click');
  assert.equal(ids.avatarMenu.hidden, false);
  await document.fire('keydown', { key: 'Escape' });
  assert.equal(ids.avatarMenu.hidden, true);

  ids.avatarFileInput.files = [new Blob(['invalid'], { type: 'image/svg+xml' })];
  await ids.avatarFileInput.fire('change');
  assert.equal(user.hasAvatar, false);
  assert.equal(toasts.at(-1).type, 'error');

  ids.avatarFileInput.files = [new Blob(['valid'], { type: 'image/png' })];
  await ids.avatarFileInput.fire('change');
  assert.equal(user.avatarUrl, '/api/users/4/avatar?v=1');
  assert.equal(ids.avatarRemoveBtn.hidden, false);
  assert.equal(renders.at(-1).avatarUrl, user.avatarUrl);
  assert.equal(toasts.at(-1).message, 'Profile photo saved.');

  uploadResult = new Error('Upload failed');
  ids.avatarFileInput.files = [new Blob(['valid'], { type: 'image/png' })];
  await ids.avatarFileInput.fire('change');
  assert.equal(user.avatarUrl, '/api/users/4/avatar?v=1');
  assert.equal(toasts.at(-1).type, 'error');

  removeFails = true;
  ids.avatarMenu.hidden = false;
  await ids.avatarRemoveBtn.fire('click');
  assert.equal(ids.avatarMenu.hidden, true);
  assert.equal(user.hasAvatar, true);
  removeFails = false;
  await ids.avatarRemoveBtn.fire('click');
  assert.equal(user.hasAvatar, false);
  assert.equal(ids.avatarRemoveBtn.hidden, true);
  assert.equal(renders.at(-1).avatarUrl, null);
});
