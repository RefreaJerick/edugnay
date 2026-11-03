const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-sf-templates.html'), 'utf8').replace(/\r\n/g, '\n');
const pageStyles = fs.readFileSync(path.join(root, 'assets/css/teacher/sf-templates.css'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');

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
  assert.match(pageStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.sf-template-list \{\s*max-height: min\(50vh, 400px\);/);
  assert.match(sharedStyles, /\.sf-main-sheet-tabs, \.sf-sheet-tabs, \.sf-generated-form-tabs, \.day-strip,[\s\S]*?\.sf-template-list/);
});

test('Template Library has bottom padding outside its scrollable rows', () => {
  assert.match(pageStyles, /\.sf-library-panel \{\s*padding-bottom: 14px;\s*\}/);
});
