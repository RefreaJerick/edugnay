const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

for (const page of ['edugnay-admin-management.html', 'edugnay-admin-dashboard.html']) {
  test(`${page} uses the shared bulk picker and endpoint`, () => {
    const html = fs.readFileSync(path.join(__dirname, '../../views/admin', page), 'utf8');
    assert.match(html, /student-multi-select\.js/);
    assert.match(html, /data-student-search/);
    assert.match(html, /data-student-list/);
    assert.match(html, /data-student-trigger/);
    assert.match(html, /data-student-dropdown hidden/);
    assert.match(html, /data-student-clear/);
    assert.match(html, /data-student-done/);
    assert.doesNotMatch(html, /data-student-selected/);
    assert.match(html, /createStudentMultiSelect/);
    assert.match(html, /enrollStudentsBulk\(section\.id, studentIds\)/);
    assert.doesNotMatch(html, /id="(?:studentSelect|modalStudent)"/);
  });
}

test('management quick assign preselects the chosen unassigned student', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
  assert.match(html, /managementRenderStudentOptions\(matchedStudent\?\.id \|\| ''\)/);
  assert.match(html, /openStudentAssignModal\('\$\{student\.id\}'\)/);
});

test('bounded SF-style choice panels scroll within assignment dialogs without changing move modal overflow', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/modal-system.css'), 'utf8');
  const management = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
  assert.match(css, /\.student-multi-list\s*\{[^}]*max-height:\s*220px;[^}]*overflow-y:\s*auto;/);
  assert.match(css, /\.student-multi-dropdown\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /#studentAssignModalBackdrop\.is-assigning \.modal-body\s*\{\s*overflow-y:\s*auto !important;/);
  assert.match(management, /classList\.add\('open', 'is-assigning'\)/);
  assert.match(management, /classList\.remove\('is-assigning'\)/);
});

test('student choices retain the school-level selected and keyboard-focus styling', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../assets/css/modal-system.css'), 'utf8');
  assert.match(css, /\.student-multi-option:has\(input:checked\)\s*\{[^}]*border-color:\s*var\(--blue-mid\);[^}]*background:\s*var\(--blue-xpale\);/);
  assert.match(css, /\.student-multi-option:has\(input:focus-visible\)\s*\{[^}]*box-shadow:/);
  assert.match(css, /\.student-multi-identity > \*\s*\{[^}]*overflow-wrap:\s*anywhere;/);
});
