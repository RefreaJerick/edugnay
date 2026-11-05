const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '../..');
const journalCss = fs.readFileSync(path.join(root, 'assets/css/teacher/journals.css'), 'utf8').replace(/\r\n/g, '\n');

test('journal submission schedule keeps equal full-width controls in a two-column grid at every width', () => {
  const baseGrid = journalCss.match(/\.settings-row-2\s*\{([^}]*)\}/)?.[1];
  assert.ok(baseGrid, 'expected the submission schedule grid');
  assert.match(baseGrid, /display:\s*grid/);
  assert.match(baseGrid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

  const mobileGrid = journalCss.match(/@media\s*\(max-width:\s*520px\)[\s\S]*?\.settings-row-2\s*\{([^}]*)\}/)?.[1];
  assert.ok(mobileGrid, 'expected the journal settings mobile grid rule');
  assert.match(mobileGrid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

  const fieldRule = journalCss.match(/\.settings-row-2\s+\.settings-select,\s*\.settings-row-2\s+\.settings-input\s*\{([^}]*)\}/)?.[1];
  assert.ok(fieldRule, 'expected shared select and input dimensions');
  assert.match(fieldRule, /width:\s*100%/);
  assert.match(fieldRule, /min-width:\s*0/);
  assert.match(fieldRule, /height:\s*42px/);
  assert.match(fieldRule, /box-sizing:\s*border-box/);
  assert.doesNotMatch(fieldRule, /width:\s*180px/);

  const dateControlRule = journalCss.match(/\.settings-row-2\s+\.academic-date-control\s*\{([^}]*)\}/)?.[1];
  assert.ok(dateControlRule, 'expected the enhanced time control to fill its grid cell');
  assert.match(dateControlRule, /width:\s*100%/);
  assert.match(dateControlRule, /min-width:\s*0/);
});

test('journal schedule time picker matches the other controls and keeps its focus surface', () => {
  const dateFieldRule = journalCss.match(/\.settings-row-2\s+\.academic-date-control\s*>\s*\.academic-date-field\.is-compact\s*\{([^}]*)\}/)?.[1];
  assert.ok(dateFieldRule, 'expected the schedule time picker styling');
  assert.match(dateFieldRule, /box-sizing:\s*border-box/);
  assert.match(dateFieldRule, /height:\s*42px/);
  assert.match(dateFieldRule, /min-height:\s*42px/);
  assert.match(dateFieldRule, /font:\s*400\s+13px\/1\.35\s+'Plus Jakarta Sans',\s*sans-serif/);
  assert.match(dateFieldRule, /background-color:\s*var\(--gray-50\)/);

  assert.match(journalCss, /\.settings-row-2\s+\.academic-date-control\s*>\s*\.academic-date-field\.is-compact:focus-visible,[\s\S]*?\.settings-row-2\s+\.academic-date-control\s*>\s*\.academic-date-field\.is-compact\[aria-expanded='true'\]\s*\{[^}]*background:\s*var\(--theme-surface\);[^}]*box-shadow:\s*0 0 0 3px rgba\(29, 92, 180, \.1\)/);
});
