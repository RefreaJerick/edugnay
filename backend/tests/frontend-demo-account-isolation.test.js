const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const parentReports = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-reports.html'), 'utf8');
const parentReportsScript = fs.readFileSync(path.join(__dirname, '../../assets/js/parent/narrative-reports.js'), 'utf8');
const adminUsers = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-users.html'), 'utf8');
const adminProfile = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-profile.html'), 'utf8');
const parentProfile = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-profile.html'), 'utf8');
const studentProfile = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-profile.html'), 'utf8');
const studentMaterials = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-materials.html'), 'utf8');
const teacherProfile = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-profile.html'), 'utf8');
const signIn = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

test('shared shell ignores browser record storage and uses API identity', () => {
  assert.doesNotMatch(shell, /function readJson\(|function writeJson\(|edugnay_users|edugnay_schools/);
  assert.match(shell, /function getSchools\(\) \{\s*return window\.EDUGNAY_API_SCHOOL_CONTEXT/);
  assert.match(shell, /userId: String\(user\.id\)/);
  assert.doesNotMatch(shell, /Number\(user\.schoolId\) === 1 \? 'scc'/);
  assert.match(shell, /function setCurrentUserShellStatus\(label, roleLabel = ''\)/);
  assert.match(shell, /setCurrentUserShellStatus\('Account unavailable', 'Connection issue'\)/);
  assert.doesNotMatch(signIn, /LEGACY_USER_ID_BY_EMAIL|schoolId === 1 \? 'scc'|sessionStorage\.setItem\('edugnay_session'/);
  assert.doesNotMatch(shell, /localStorage\.setItem\(storageKey/);
});

test('default record arrays are empty, including reports', () => {
  assert.doesNotMatch(shell, /const DEFAULT_USERS\s*=/);
  assert.doesNotMatch(shell, /const DEFAULT_REPORTS\s*=|makeDemoReport/);
});

test('parent reports use linked-child backend data without demo records', () => {
  assert.match(parentReports, /parentReportChildSwitcher/);
  assert.match(parentReports, /parent-report-list/);
  assert.match(parentReportsScript, /getParentChildren\(\)/);
  assert.match(parentReportsScript, /reports\/parent\/children/);
  assert.doesNotMatch(parentReports, /getReportsForStudent|makeDemoParentChildren/);
  assert.doesNotMatch(parentReportsScript, /makeDemoParentChildren|DEFAULT_REPORTS/);
});

test('admin account list keeps a visible backend load error and disables local account fallback', () => {
  assert.doesNotMatch(adminUsers, /LOCAL_USERS|EDUGNAY_CONFIG\.(getUsers|getUserById|createUser|updateUser|deleteUser)/);
  assert.match(adminUsers, /usersLoading \|\| usersLoadError/);
  assert.match(adminUsers, /Try again when the connection is ready\./);
  assert.doesNotMatch(parentProfile, /localParent|EDUGNAY_PARENT\.currentUser/);
  assert.doesNotMatch(studentProfile, /localStudent|EDUGNAY_STUDENT\.currentUser/);
  assert.match(studentMaterials, /let MATERIAL_RECORDS = \[\];/);
});

test('account profile pages use live identity and assignments instead of SCC demo details', () => {
  assert.match(adminProfile, /id="admin-profile-load-notice"/);
  assert.match(adminProfile, /renderAdminProfile\(\{ displayName: 'Loading profile\.\.\.', schoolEmail: '', profile: \{\} \}\)/);
  assert.match(adminProfile, /setAdminProfileLoadState\('Profile unavailable'/);
  assert.match(adminProfile, /renderAdminAccessDetails\(adminApiUser\)/);

  assert.match(teacherProfile, /id="teacher-profile-load-notice"/);
  assert.doesNotMatch(teacherProfile, /const EMPLOYMENT_DETAILS = \[\];/);
  assert.match(teacherProfile, /window\.EDUGNAY_CONFIG\.getMyTeachingSections\(\)/);
  assert.match(teacherProfile, /setTeacherProfileLoadState\('Profile unavailable'/);
  assert.match(teacherProfile, /teacherSections\.map\(section => \[section\.grade, section\.name\]/);

  assert.match(parentProfile, /parentApiUser/);
  assert.match(studentProfile, /const student = studentApiUser;/);
});

test('updated account profile inline scripts parse', () => {
  for (const [name, html] of [['admin profile', adminProfile], ['teacher profile', teacherProfile], ['parent profile', parentProfile], ['student profile', studentProfile]]) {
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1].trim())
      .filter(Boolean);
    assert.ok(scripts.length, `${name} should include inline behavior`);
    scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source), `${name} script ${index + 1} should parse`));
  }
});
