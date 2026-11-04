const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = pageFs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const css = pageFs.readFileSync(path.join(__dirname, '../../assets/css/admin/users.css'), 'utf8');
const usersScript = pageFs.readFileSync(path.join(__dirname, '../../assets/js/admin/users.js'), 'utf8');
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

test('phone account cards hide metadata while keeping identity, role, and actions', () => {
  assert.match(html, /class="table-wrap user-account-table-wrap"/);
  for (const header of ['User', 'Role', 'Status', 'Actions']) {
    assert.match(html, new RegExp(`<th scope="col">${header}<\\/th>`));
  }
  assert.match(html, /<th scope="col" id="gradeLinkHeading">Grade \/ Link<\/th>/);
  assert.match(html, /id="sortDateAdded"/);
  assert.match(usersScript, /const showGradeLinkColumn = !\['school_admin', 'teacher'\]\.includes\(activeRole\)/);
  assert.match(css, /#userTable #gradeLinkHeading,\s*#userTable \.account-scope-cell,\s*#userTable #sortDateAdded,\s*#userTable \.account-date-cell\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(css, /thead th:nth-child\(3\),\s*tbody td:nth-child\(3\),\s*thead th:nth-child\(5\),\s*tbody td:nth-child\(5\)/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?#userTable tbody tr\[data-user-id\]\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /#userTable tbody tr\[data-user-id\] \.account-role-cell\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
  assert.match(css, /#userTable tbody tr\[data-user-id\] \.account-scope-cell,\s*#userTable tbody tr\[data-user-id\] \.account-status-cell,\s*#userTable tbody tr\[data-user-id\] \.account-date-cell\s*\{\s*display:\s*none;/);
  assert.match(css, /#userTable tbody tr\[data-user-id\] \.account-actions-cell\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*grid-row:\s*2;/s);
  assert.match(css, /#userTable \.user-email\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
  assert.match(usersScript, /\['Date added', formatAccountDate\(user\.createdAt\)\]/);
  assert.match(usersScript, /\['Grade level', user\.gradeLevel\]/);
  assert.match(usersScript, /user-details-status \$\{user\.status\}/);
  assert.match(usersScript, /openUserDetailsModal\(this\.dataset\.userId, this\)/);
  assert.match(usersScript, /row\.addEventListener\('keydown'[\s\S]*?\['Enter', ' '\]/);
  assert.match(usersScript, /\.row-btn\.deactivate, \.row-btn\.reactivate/);
  assert.match(usersScript, /\.user-menu-item\.edit/);
  assert.match(usersScript, /\.user-menu-item\.delete/);
});
