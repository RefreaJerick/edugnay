const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('other-person avatar markup escapes names and preserves the person identity', () => {
  const source = read('assets/js/shell-common.js');
  const start = source.indexOf('function avatarHtml(');
  const end = source.indexOf('function hydrateAvatars(', start);
  assert.ok(start >= 0 && end > start);
  const avatarHtml = vm.runInNewContext(`${source.slice(start, end)}; avatarHtml`);
  const html = avatarHtml({ id: 42, displayName: 'Ada "<script>"', initials: 'AT',
    avatarUrl: '/api/users/42/avatar?v=2', role: 'student' }, { className: 'student-av', size: 'sm' });
  assert.match(html, /person-avatar--sm/);
  assert.match(html, /data-person-avatar=/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /api\/users\/42\/avatar/);
});

test('new person avatars hydrate with their own photo and size', () => {
  const source = read('assets/js/shell-common.js');
  const start = source.indexOf('function hydrateAvatars(');
  const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
  const rendered = [];
  const hydrate = vm.runInNewContext(`${source.slice(start, end)}; hydrateAvatars`, {
    renderAvatar: (element, person, options) => rendered.push({ person, options })
  });
  const attributes = new Set();
  const element = {
    matches: () => true,
    querySelectorAll: () => [],
    hasAttribute: name => attributes.has(name),
    setAttribute: name => attributes.add(name),
    removeAttribute: name => attributes.delete(name),
    dataset: { personAvatar: JSON.stringify({ id: 42, name: 'Ada', avatarUrl: '/api/users/42/avatar?v=2' }) },
    classList: { contains: name => name === 'person-avatar--sm' }
  };
  hydrate(element);
  hydrate(element);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].person.avatarUrl, '/api/users/42/avatar?v=2');
  assert.equal(rendered[0].options.size, 'sm');
});

test('profile avatars stay circular and request private photos with the signed-in session', () => {
  const profileCss = read('assets/css/profile-common.css');
  const profileRule = profileCss.match(/\.profile-avatar-wrap \.profile-avatar\.person-avatar\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(profileRule, /min-width:\s*88px/);
  assert.match(profileRule, /aspect-ratio:\s*1/);
  assert.match(profileRule, /border-radius:\s*50%/);
  assert.match(profileCss, /min-width:\s*72px/);
  assert.match(read('assets/js/shell-common.js'), /image\.crossOrigin\s*=\s*'use-credentials'/);
});

test('all audited other-person surfaces use the shared renderer', () => {
  const pages = [
    'views/admin/edugnay-admin-users.html',
    'views/admin/edugnay-admin-management.html',
    'views/admin/edugnay-admin-dashboard.html',
    'views/teacher/edugnay-teacher-sections.html',
    'views/teacher/edugnay-teacher-journals.html',
    'views/teacher/edugnay-teacher-reports.html',
    'views/student/edugnay-student-profile.html',
    'views/parent/edugnay-parent-dashboard.html',
    'views/parent/edugnay-parent-attendance.html',
    'views/parent/edugnay-parent-grades.html',
    'views/parent/edugnay-parent-reports.html',
    'views/parent/edugnay-parent-profile.html'
  ];
  for (const page of pages) assert.match(read(page), /EDUGNAY_AVATAR\.(html|render)\(/, page);
  const sections = read('views/teacher/edugnay-teacher-sections.html');
  assert.doesNotMatch(sections, /student-av av-|qr-attendance-avatar">\$\{/);
  for (const css of ['assets/css/parent/child-switcher.css', 'assets/css/parent/dashboard.css',
    'assets/css/parent/attendance.css', 'assets/css/parent/reports.css']) {
    assert.doesNotMatch(read(css), /nth-child\([^)]*\) \.child-avatar/, css);
  }
});

test('narrative report detail modals use compact shared avatar sizes', () => {
  const teacherReports = read('views/teacher/edugnay-teacher-reports.html');
  const parentReports = read('views/parent/edugnay-parent-reports.html');
  assert.match(teacherReports, /EDUGNAY_AVATAR\.render\(document\.getElementById\('rm-avatar'\), reportStudentPerson\(r\), \{ size: 'compact' \}\)/);
  assert.match(parentReports, /EDUGNAY_AVATAR\.render\(document\.getElementById\('rm-foot-avatar'\), reportTeacherPerson\(r\), \{ size: 'sm' \}\)/);
  assert.match(read('assets/css/styles.css'), /\.person-avatar--compact\s*\{\s*--avatar-size:\s*32px;/);
});
