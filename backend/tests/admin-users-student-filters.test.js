const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const updateFilter = html.split('    function updateStudentFilters() {')[1]
  .split('    function getFilteredUsers() {')[0];

test('section and grade filters only appear for students and reset when leaving', () => {
  assert.match(html, /id="sectionFilter"[^>]*\bhidden\b/);

  const grade = { value: 'all', hidden: true, disabled: false, innerHTML: '' };
  const section = { value: 'all', hidden: true, disabled: false };
  const context = vm.createContext({
    document: { getElementById: id => ({ gradeLevelFilter: grade, sectionFilter: section })[id] },
    USERS: [], getStudentGradeLevels: () => [], gradeLevelSortValue: () => 0
  });
  vm.runInContext(`let activeRole = 'all'; function updateStudentFilters() {${updateFilter}`, context);

  vm.runInContext("activeRole = 'student'; updateStudentFilters()", context);
  assert.equal(grade.hidden, false);
  assert.equal(section.hidden, false);
  assert.equal(grade.disabled, false);
  assert.equal(section.disabled, false);

  grade.value = 'Grade 7';
  section.value = 'section-1';
  for (const role of ['all', 'school_admin', 'teacher', 'parent']) {
    vm.runInContext(`activeRole = '${role}'; updateStudentFilters()`, context);
    assert.equal(grade.value, 'all');
    assert.equal(section.value, 'all');
    assert.equal(grade.hidden, true);
    assert.equal(section.hidden, true);
    assert.equal(grade.disabled, true);
    assert.equal(section.disabled, true);
  }

  vm.runInContext("activeRole = 'student'; updateStudentFilters()", context);
  assert.equal(section.hidden, false);
  assert.equal(section.value, 'all');
});
