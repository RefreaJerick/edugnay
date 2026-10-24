const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const scrollbarCss = css.split('/* Only scrollable content inside a page gets the dropdown scrollbar.')[1];

test('internal panels share one scrollbar target list and style', () => {
  assert.ok(scrollbarCss, 'shared internal scrollbar rules exist');
  const selectors = [...scrollbarCss.matchAll(/:is\(([^)]*)\)(?:::-webkit-scrollbar(?:-track|-thumb(?::hover)?)?)?\s*\{/g)]
    .map(match => match[1].replace(/\s+/g, ' ').trim());
  assert.equal(selectors.length, 5);
  assert.ok(selectors.every(selector => selector === selectors[0]), 'each scrollbar rule targets the same panels');
  for (const name of ['.tb-notif-list', '.push-settings-dialog', '.modal-body', '.review-body',
    '.journal-history-list', '.student-multi-list', '.table-wrap', '.csv-preview-scroll',
    '.sf-workbook-viewport', '.onboarding-form-area']) {
    assert.ok(selectors[0].includes(name), `${name} is covered`);
  }
  assert.match(scrollbarCss, /scrollbar-width:\s*thin;/);
  assert.match(scrollbarCss, /::-webkit-scrollbar\s*\{\s*width:\s*6px;\s*height:\s*6px;/);
});

test('browser, sidebar, and hidden tab scrollbars stay outside the shared style', () => {
  const selectors = scrollbarCss.match(/:is\(([^)]*)\)/)[1].split(',').map(selector => selector.trim());
  for (const excluded of ['html', 'body', '.main', '.sidebar', '.profile-tab-bar', '.mgmt-tabs']) {
    assert.ok(!selectors.includes(excluded), `${excluded} keeps its existing scrollbar`);
  }
  assert.match(css, /\.sidebar\s*::-webkit-scrollbar\s*\{/);
  assert.match(fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-management.html'), 'utf8'),
    /class="csv-preview-scroll"[^>]*overflow:auto/);
});
