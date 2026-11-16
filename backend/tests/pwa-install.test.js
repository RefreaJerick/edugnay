const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('install assets reach each portal page without adding offline data caching', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = fs.readFileSync(path.join(root, icon.src));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  for (const file of ['index.html', 'views/onboarding/edugnay-school-onboarding.html']) {
    assert.match(read(file), /manifest\.webmanifest/);
    assert.match(read(file), /pwa-install\.js/);
  }
  assert.match(read('views/onboarding/edugnay-school-onboarding.html'), /data-install-app/);
  for (const role of ['admin', 'platform', 'teacher', 'student', 'parent']) {
    for (const name of fs.readdirSync(path.join(root, 'views', role)).filter(name => name.endsWith('.html'))) {
      const html = read(`views/${role}/${name}`);
      assert.match(html, /manifest\.webmanifest/, name);
      assert.match(html, /pwa-install\.js/, name);
    }
  }
  assert.doesNotMatch(read('push-sw.js'), /addEventListener\(['"]fetch['"]|caches\.open|cache\.put/);
});

function loadInstallPage({ standalone = false, apple = false, portal = true } = {}) {
  const windowEvents = {};
  const documentEvents = {};
  const registrations = [];
  const controls = [];
  const onboardingButton = { hidden: false, addEventListener(name, handler) { this[name] = handler; } };
  const dropdown = portal ? {
    querySelector() { return {}; },
    insertBefore(button) { controls.push(button); }
  } : null;
  let dialog;
  const document = {
    currentScript: { src: 'https://school.example/assets/js/pwa-install.js' },
    addEventListener(name, handler) { documentEvents[name] = handler; },
    getElementById(id) { return id === 'tbProfileDropdown' ? dropdown : dialog; },
    querySelectorAll() { return portal ? controls : [onboardingButton]; },
    createElement(tag) {
      if (tag === 'button') return { hidden: false, addEventListener(name, handler) { this[name] = handler; }, setAttribute() {} };
      const close = { addEventListener() {}, focus() {} };
      dialog = { setAttribute() {}, querySelector(selector) {
        return selector === 'p' ? this.copy ||= {} : close;
      }, showModal() { this.open = true; }, close() { this.open = false; } };
      return dialog;
    },
    body: { appendChild() {} }
  };
  const window = {
    isSecureContext: true,
    matchMedia() { return { matches: standalone }; },
    addEventListener(name, handler) { windowEvents[name] = handler; }
  };
  const navigator = {
    userAgent: apple ? 'iPhone' : 'Windows',
    serviceWorker: { register(url, options) { registrations.push({ url, options }); return Promise.resolve({}); } }
  };
  vm.runInNewContext(read('assets/js/pwa-install.js'), { document, window, navigator, URL });
  documentEvents.DOMContentLoaded();
  return { windowEvents, controls: portal ? controls : [onboardingButton], registrations,
    get dialog() { return dialog; } };
}

test('the install control opens the browser prompt and hides after installation', async () => {
  const page = loadInstallPage();
  const button = page.controls[0];
  assert.equal(button.hidden, false);
  let prevented = false;
  let prompted = false;
  page.windowEvents.beforeinstallprompt({
    preventDefault() { prevented = true; },
    prompt() { prompted = true; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  await button.click();
  assert.equal(prevented, true);
  assert.equal(prompted, true);
  await button.click();
  assert.match(page.dialog.copy.textContent, /browser menu/);
  page.windowEvents.appinstalled();
  assert.equal(button.hidden, true);
  page.windowEvents.load();
  await Promise.resolve();
  assert.equal(page.registrations.length, 1);
  assert.equal(page.registrations[0].url, 'https://school.example/push-sw.js');
  assert.equal(page.registrations[0].options.scope, '/');
});

test('onboarding provides browser instructions when a prompt is unavailable', async () => {
  const page = loadInstallPage({ apple: true, portal: false });
  await page.controls[0].click();
  assert.equal(page.dialog.open, true);
  assert.match(page.dialog.copy.textContent, /Safari.*Share.*Add to Home Screen/);
  assert.equal(loadInstallPage({ standalone: true }).controls[0].hidden, true);
});
