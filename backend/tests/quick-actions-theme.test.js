const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Quick Actions icons use panel-heading colors only in Dark mode', () => {
  const css = read('assets/css/styles.css');
  const light = css.match(/\.qa-icon\s*\{([^}]+)\}/)?.[1];
  const dark = css.match(/html\[data-theme="dark"\] \.qa-icon\s*\{([^}]+)\}/)?.[1];

  assert.ok(light, 'shared icon style exists');
  assert.match(light, /background:\s*var\(--gray-100\)/);
  assert.match(light, /color:\s*var\(--theme-accent-text\)/);
  assert.ok(dark, 'Dark-mode icon override exists');
  assert.match(dark, /background:\s*var\(--blue-xpale\)/);
  assert.match(dark, /color:\s*var\(--theme-accent-text\)/);
  assert.match(css, /\.qa-item:hover \.qa-icon\s*\{[^}]*background:\s*var\(--blue-pale\)/);

  for (const role of ['admin', 'teacher', 'platform']) {
    const page = read(`views/${role}/edugnay-${role}-dashboard.html`);
    assert.match(page, /href="\.\.\/\.\.\/assets\/css\/styles\.css"/);
    assert.match(page, /class="qa-icon"/);
  }
});
