const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const selectSupport = source.slice(source.indexOf('function initializeSearchableSelectSupport()'), source.indexOf('\nfunction toggleNotifDropdown()'));

test('searchable select labels focus and name the visible control without native scrolling', () => {
  assert.match(selectSupport, /const labels = Array\.from\(select\.labels \|\| \[\]\)/);
  assert.match(selectSupport, /input\.setAttribute\('aria-labelledby', labelledBy\)/);
  assert.match(selectSupport, /associatedLabel\.addEventListener\('click', event => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?input\.focus\(\{ preventScroll: true \}\);[\s\S]*?openSelect\(state\);/);
  assert.match(selectSupport, /if \(wrapper\.contains\(event\.target\)\) return/);
  assert.match(selectSupport, /if \(select\.disabled\) return/);
});

test('the native select remains the value source and selection dispatches one change event', () => {
  assert.match(selectSupport, /select\.value = option\.value;[\s\S]*?state\.select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(selectSupport, /new MutationObserver\(records => records\.forEach\(record => record\.addedNodes\.forEach/);
});
