const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const commonSource = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const teacherShellSource = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
const pageMap = commonSource.match(/const API_NOTIFICATION_PAGE_BY_TYPE = \{[\s\S]*?\n\};/)?.[0];
const normalizerStart = commonSource.indexOf('function normalizeApiNotification(record) {');
const normalizerEnd = commonSource.indexOf('\nasync function getApiNotifications', normalizerStart);
const normalizer = commonSource.slice(normalizerStart, normalizerEnd);

function normalize(record) {
  const context = vm.createContext({
    window: { location: { origin: 'https://school.example' } },
    URL,
    String,
    Boolean,
    Number,
    record
  });
  return vm.runInContext(`${pageMap}\n${normalizer}\nnormalizeApiNotification(record)`, context, { timeout: 1000 });
}

test('student-transfer notification links to its validated teacher section', () => {
  const notification = normalize({
    id: 17,
    type: 'student_transfer',
    title: 'New student in your section',
    message: 'Jerick was transferred from St. Matthew to St. Mark.',
    targetPath: '/views/teacher/edugnay-teacher-sections.html?sectionId=9',
    createdAt: '2026-10-14T10:00:00Z',
    isRead: false
  });

  assert.deepEqual(JSON.parse(JSON.stringify(notification.link)), { page: 'section', section: '9' });
  assert.equal(notification.icon, 'users-round');
  assert.equal(notification.tone, 'blue');
  assert.equal(notification.type, 'Student transfer');
  assert.equal(notification.read, false);
});

test('invalid student-transfer target paths stay on the notifications page', () => {
  const notification = normalize({
    id: 18,
    type: 'student_transfer',
    targetPath: 'https://attacker.example/views/teacher/edugnay-teacher-sections.html?sectionId=9'
  });

  assert.deepEqual(JSON.parse(JSON.stringify(notification.link)), { page: 'notifications' });
});

test('teacher notification panel refreshes on open and when its tab becomes visible', () => {
  assert.match(commonSource, /function toggleNotifDropdown\(\)[\s\S]*?EDUGNAY_REFRESH_NOTIFICATIONS\(\)/);
  assert.match(teacherShellSource, /document\.addEventListener\('visibilitychange',[\s\S]*?refreshTeacherNotifications\(\)/);
});
