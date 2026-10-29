const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'assets/js/theme.js'), 'utf8');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function createControl() {
  const events = {};
  const trigger = {
    attributes: {}, innerHTML: '',
    addEventListener(name, handler) { events[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const control = {
    querySelector(selector) { return selector === '[data-theme-trigger]' ? trigger : null; }
  };
  return { control, trigger, events };
}

function boot(saved, supportsSystem = true, controls = []) {
  const listeners = {};
  const storage = new Map(saved === undefined ? [] : [['edugnay_theme_v1', saved]]);
  const media = { matches: false, addEventListener(name, handler) { listeners.media = handler; } };
  const document = {
    documentElement: { dataset: {} },
    querySelectorAll(selector) { return selector === '[data-theme-control]' ? controls.map(item => item.control) : []; },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  const iconRenders = [];
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: supportsSystem ? () => media : undefined,
    lucide: { createIcons(options) { iconRenders.push(options.root); } },
    addEventListener(name, handler) { listeners[name] = handler; }
  };
  vm.runInNewContext(script, { window, document, Set });
  return { window, document, media, listeners, storage, iconRenders };
}

test('theme is applied before DOM readiness and invalid preferences stay Light', () => {
  for (const saved of [undefined, 'invalid']) {
    const { document } = boot(saved);
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(document.documentElement.dataset.themeMode, 'light');
  }
  assert.equal(boot('dark').document.documentElement.dataset.theme, 'dark');
});

test('System follows device changes, tabs stay in sync, and icons show the next mode', () => {
  const control = createControl();
  const state = boot('system', true, [control]);
  state.listeners.DOMContentLoaded();
  state.media.matches = true;
  state.listeners.media();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.equal(control.trigger.attributes.title, 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  state.window.ACADEMIX_THEME.setMode('light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'light');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.match(control.trigger.innerHTML, /data-lucide="moon"/);
  state.listeners.storage({ key: 'edugnay_theme_v1', newValue: 'system' });
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  state.listeners.storage({ key: 'edugnay_theme_v1', newValue: 'invalid' });
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.ok(state.iconRenders.every(icon => icon === control.trigger));
  const noMedia = boot('system', false);
  assert.equal(noMedia.document.documentElement.dataset.theme, 'light');
});

test('toggle switches immediately and makes legacy System preference explicit', () => {
  const control = createControl();
  const state = boot(undefined, true, [control]);
  state.listeners.DOMContentLoaded();
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to dark mode');
  assert.equal(control.trigger.attributes.title, 'Switch to dark mode');
  assert.match(control.trigger.innerHTML, /data-lucide="moon"/);
  control.events.click();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'dark');
  assert.equal(control.trigger.attributes['aria-label'], 'Switch to light mode');
  assert.match(control.trigger.innerHTML, /data-lucide="sun"/);
  control.events.click();
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'light');

  const systemControl = createControl();
  const systemState = boot('system', true, [systemControl]);
  systemState.listeners.DOMContentLoaded();
  systemState.media.matches = true;
  systemState.listeners.media();
  assert.equal(systemState.document.documentElement.dataset.theme, 'dark');
  systemControl.events.click();
  assert.equal(systemState.document.documentElement.dataset.theme, 'light');
  assert.equal(systemState.storage.get('edugnay_theme_v1'), 'light');
  assert.equal(systemState.window.ACADEMIX_THEME.getMode(), 'light');
});

test('printing uses Light without changing the saved choice', () => {
  const state = boot('dark');
  state.listeners.beforeprint();
  assert.equal(state.document.documentElement.dataset.theme, 'light');
  assert.equal(state.storage.get('edugnay_theme_v1'), 'dark');
  state.listeners.afterprint();
  assert.equal(state.document.documentElement.dataset.theme, 'dark');
});

test('every page has one static toggle and pre-paint theme loading', () => {
  const pages = ['index.html'];
  for (const role of fs.readdirSync(path.join(root, 'views'))) {
    const dir = path.join(root, 'views', role);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.html')) pages.push(`views/${role}/${name}`);
  }
  assert.equal(pages.length, 50);
  for (const page of pages) {
    const html = read(page);
    assert.equal((html.match(/data-theme-control/g) || []).length, 1, page);
    const button = html.match(/<button class="tb-theme-trigger"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button, page);
    assert.match(button, /aria-label="Switch to dark mode"/, page);
    assert.match(button, /title="Switch to dark mode"/, page);
    assert.match(button, /data-lucide="moon"/, page);
    assert.doesNotMatch(html, /tb-theme-menu|data-theme-menu|tb-theme-choice|academix-theme-menu|data-lucide="palette"/, page);
    assert.ok(html.indexOf('assets/js/theme.js') < html.indexOf('assets/css/styles.css'), page);
    assert.ok(html.indexOf('assets/css/theme.css') > html.indexOf('assets/css/styles.css'), page);
    if (!page.includes('onboarding') && page !== 'index.html') {
      assert.ok(html.indexOf('data-theme-control') < html.indexOf('class="tb-profile"'), page);
    }
  }
});

test('theme tokens preserve the previous light colors and keep exports separate', () => {
  const css = read('assets/css/styles.css');
  assert.match(css, /--theme-surface: #ffffff;/);
  assert.match(css, /--theme-text: #0b1f3a;/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(read('assets/js/timetable-export.js'), /ACADEMIX_THEME|data-theme/);
  assert.doesNotMatch(read('assets/css/theme.css'), /html::?-webkit-scrollbar|body::?-webkit-scrollbar/);
});

test('theme toggle stays borderless and keeps keyboard focus visible', () => {
  const css = read('assets/css/theme.css');
  assert.doesNotMatch(css, /tb-theme-menu|tb-theme-choice/);
  assert.match(css, /\.tb-theme-trigger\s*\{[^}]*border: 0;[^}]*background: transparent;/);
  assert.match(css, /\.tb-theme-trigger:hover\s*\{[^}]*background: transparent; color: var\(--theme-accent-text\)/);
  assert.match(css, /\.tb-theme-trigger:focus-visible\s*\{[^}]*outline: 2px solid var\(--theme-accent-text\)/);
  assert.match(css, /\.topbar \.tb-theme-trigger svg\s*\{ width: 20px; height: 20px; stroke-width: 1\.9; \}/);
  assert.match(css, /\.login-panel > \.tb-theme \.tb-theme-trigger\s*\{ width: 34px; height: 34px; \}/);
  assert.match(css, /\.onboarding-topbar-actions \.tb-theme-trigger\s*\{ width: 34px; height: 34px; \}/);
  assert.doesNotMatch(css, /\.tb-theme-trigger\[aria-expanded/);
});

test('assignment list headings have no fill on student or parent pages', () => {
  const css = read('assets/css/student/assignments.css');
  const header = css.match(/\.assignment-list-head\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(header, /background/);
  assert.match(header, /border-bottom: 1px solid var\(--gray-100\)/);
  for (const role of ['student', 'parent']) {
    const html = read(`views/${role}/edugnay-${role}-assignments.html`);
    assert.match(html, /class="assignment-list-head"/);
    assert.match(html, /assets\/css\/student\/assignments\.css/);
  }
});

test('shared scroll fades follow the theme and remain overflow-dependent', () => {
  const css = read('assets/css/styles.css');
  const theme = read('assets/css/theme.css');
  const script = read('assets/js/shell-common.js');
  assert.match(css, /--scroll-fade-canvas-rgb: 241, 245, 249/);
  assert.match(css, /--scroll-fade-surface-rgb: 255, 255, 255/);
  assert.match(css, /--scroll-fade-canvas-rgb: 11, 25, 45/);
  assert.match(css, /--scroll-fade-surface-rgb: 19, 38, 65/);
  assert.match(css, /rgba\(var\(--scroll-fade-canvas-rgb\), 0\.92\)/);
  assert.match(css, /rgba\(var\(--scroll-fade-surface-rgb\), 0\.94\)/);
  assert.match(css, /\.scroll-fade-wrap\.has-more-right::after\s*\{\s*opacity: 1/);
  assert.match(script, /element\.scrollWidth - element\.clientWidth - element\.scrollLeft > 4/);
  assert.match(theme, /html\s*\{ color-scheme: dark; \}/);
  assert.match(theme, /html\[data-theme="light"\] :is\(input, select, textarea, button\)\s*\{ color-scheme: light; \}/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(input, select, textarea, button\)\s*\{ color-scheme: dark; \}/);
  assert.match(theme, /@media print\s*\{\s*html\s*\{ color-scheme: light; \}/);
  assert.doesNotMatch(theme, /(?:html|body)(?:::?-webkit-scrollbar|\s*\{[^}]*scrollbar-(?:color|width))/);
});

test('dark summary cards share the panel surface and blue icons while light tints remain', () => {
  const theme = read('assets/css/theme.css');
  const shared = read('assets/css/styles.css');
  const users = read('assets/css/admin/users.css');
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card, \.rs-card\)\s*\{\s*background: var\(--panel-bg\);\s*border-color: var\(--panel-border\);/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card \.stat-card-icon, \.rs-card \.rs-icon\)\s*\{\s*background: var\(--blue-xpale\);\s*color: var\(--theme-accent-text\);/);
  assert.doesNotMatch(theme, /html\[data-theme="dark"\] :is\(\.stat-card\.(?:blue|green|gold|purple|orange|red|gray),/);
  assert.match(theme, /html\[data-theme="dark"\] :is\(\.stat-card:hover, \.rs-card:hover\)\s*\{\s*border-color: var\(--blue-pale\);/);
  assert.match(theme, /html\[data-theme="dark"\] \.rs-card\.selected,[\s\S]*?border-color: var\(--theme-accent-text\);/);
  assert.match(shared, /\.stat-card\.green\s*\{[^}]*background: var\(--surface-success-wash\)/);
  assert.match(shared, /\.stat-card\.purple\s*\{[^}]*background: var\(--surface-purple-wash\)/);
  assert.match(shared, /\.stat-card\.green \.stat-card-icon\s*\{[^}]*color: var\(--green\)/);
  assert.match(users, /\.rs-card\.stud \.rs-icon\s*\{[^}]*background: var\(--green-pale\);\s*color: var\(--green\)/);
  assert.match(users, /\.rs-card\.stud\s*\{[^}]*background: var\(--surface-success-wash\)/);
  assert.match(users, /\.rs-card\.selected\s*\{[^}]*background: var\(--blue-xpale\)/);
});
