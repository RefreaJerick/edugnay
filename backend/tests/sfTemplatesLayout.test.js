const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-sf-templates.html'), 'utf8').replace(/\r\n/g, '\n');
const pageStyles = fs.readFileSync(path.join(root, 'assets/css/teacher/sf-templates.css'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
const pageScript = fs.readFileSync(path.join(root, 'assets/js/teacher/sf-templates.js'), 'utf8');

test('SF Templates notice follows the library and generator panels', () => {
  const workspaceEnd = html.indexOf('</aside>\n      </div>', html.indexOf('<div class="sf-workspace">'));
  const notice = html.indexOf('<div class="sf-info-banner" role="note">');
  const preview = html.indexOf('<section class="sf-panel sf-preview-panel"');

  assert.ok(workspaceEnd >= 0, 'two-panel workspace should be present');
  assert.ok(notice > workspaceEnd && notice < preview, 'notice should follow both panels and precede workbook preview');
});

test('template rows have a bounded, keyboard-accessible scroll area', () => {
  assert.match(html, /<div class="sf-template-list" id="sfTemplateList" role="region" aria-label="Available form templates" tabindex="0"><\/div>/);
  assert.match(pageStyles, /\.sf-template-list \{\s*min-height: 220px;\s*max-height: min\(60vh, 370px\);\s*overflow-y: auto;/);
  assert.match(pageStyles, /\.sf-template-list:focus-visible \{\s*outline: 2px solid var\(--blue-mid\);/);
  assert.match(pageStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-template-list \{[^}]*max-height: min\(50vh, 400px\);/);
  assert.match(sharedStyles, /\.sf-main-sheet-tabs, \.sf-sheet-tabs, \.sf-generated-form-tabs, \.day-strip,[\s\S]*?\.sf-template-list/);
});

test('mobile template rows use separate cards and keep details above their actions', () => {
  assert.match(pageStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-template-list \{[\s\S]*?display: grid;[\s\S]*?gap: 10px;[\s\S]*?max-height: min\(50vh, 400px\);[\s\S]*?padding: 12px 14px 0;/);
  assert.match(pageStyles, /\.sf-template-list > \.sf-template-row \{\s*padding: 12px;\s*border: 1px solid var\(--panel-border\);\s*border-radius: var\(--panel-radius\);\s*background: var\(--theme-surface\);\s*\}/);
  assert.match(pageStyles, /\.sf-template-row \{\s*grid-template-columns: 36px minmax\(0, 1fr\);\s*align-items: start;\s*row-gap: 8px;/);
  assert.match(pageStyles, /\.sf-template-row > div:nth-child\(3\),\s*\.sf-template-actions\s*\{\s*grid-column: 1 \/ -1;/);
  assert.match(pageStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-template-actions \{\s*justify-content: flex-end;/);
});

test('form and level filters stay side by side on tablet and mobile', () => {
  assert.match(pageStyles, /\.sf-filters \{\s*display: grid;\s*grid-template-columns: minmax\(0, 2fr\) repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(pageStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-filters \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*\}[\s\S]*?\.sf-library-search \{\s*grid-column: 1 \/ -1;/);
});

test('Template Library has bottom padding outside its scrollable rows', () => {
  assert.match(pageStyles, /\.sf-library-panel \{\s*padding-bottom: 14px;\s*\}/);
});

test('dark workbook previews brighten only black text on dark or unfilled cells', () => {
  const rendererStart = pageScript.indexOf('function isDarkThemeReadableCell(cell) {');
  const rendererEnd = pageScript.indexOf('\nfunction getWorkbookScale', rendererStart);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'workbook preview renderer should be available');
  const renderers = new Function('escapeHtml', 'cellStyle', 'columnLabel', `${pageScript.slice(rendererStart, rendererEnd)}; return { isDarkThemeReadableCell, workbookTable };`)(
    value => String(value ?? ''),
    () => '',
    number => String(number)
  );
  const renderCell = style => ({ address: 'A1', text: 'Label', rowSpan: 1, columnSpan: 1, style, editable: false, edited: false });
  const cases = [
    [{ fontColor: '#000000' }, true],
    [{ fontColor: '#404040', backgroundColor: '#132641' }, true],
    [{ fontColor: '#000000', backgroundColor: '#f1f3f5' }, false],
    [{ fontColor: '#0066cc', backgroundColor: '#132641' }, false],
    [{ fontColor: '#302020', backgroundColor: '#f1f3f5' }, false]
  ];

  cases.forEach(([style, expected]) => {
    assert.equal(renderers.isDarkThemeReadableCell(renderCell(style)), expected, JSON.stringify(style));
  });

  const html = renderers.workbookTable({ columnWidths: [80], rows: [{ number: 1, height: 20, cells: [renderCell({ fontColor: '#000000' })] }] }, false, 1);
  assert.match(html, /class="sf-workbook-cell sf-workbook-cell--dark-readable/);
  assert.match(pageStyles, /html\[data-theme="dark"\] \.sf-workbook-cell--dark-readable\s*\{\s*color: var\(--gray-700\) !important;/);
  assert.doesNotMatch(pageStyles, /html\[data-theme="light"\] \.sf-workbook-cell--dark-readable/);
  assert.match(pageScript, /if \(style\.fontColor\) values\.push\(`color:\$\{style\.fontColor\}`\)/);
});
