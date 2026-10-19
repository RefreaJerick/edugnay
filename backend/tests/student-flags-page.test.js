const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const teacher = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-dashboard.html'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-reports.html'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const sharedStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/styles.css'), 'utf8');
const teacherStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/teacher/dashboard.css'), 'utf8');
const adminStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/reports.css'), 'utf8');

test('both panels use live flags and the teacher keeps its section filter', () => {
  assert.match(teacher, /getTeacherStudentFlags\(\)/);
  assert.match(teacher, /TEACHER_FLAGS\.length/);
  assert.match(teacher, /filterFlaggedStudents\(\)/);
  assert.match(teacher, /No flagged students/);
  assert.match(admin, /id="report-flagged-students"/);
  assert.match(admin, /flaggedStudents: \[\]/);
  assert.match(admin, /renderFlaggedStudents\(data\)/);
  assert.doesNotMatch(admin, /Flagging criteria are not configured/);
  assert.match(shell, /requestApi\('\/attendance\/teacher-flags'\)/);
});

test('flag reasons and student labels are HTML escaped in both panels', () => {
  for (const source of [teacher, admin]) {
    assert.match(source, /assets\/css\/styles\.css/);
    assert.match(source, /escape\(student\.name\)/);
    assert.match(source, /escape\(student\.sectionName\)/);
    assert.match(source, /escape\(reason\.type === 'grade'/);
  }
  assert.match(sharedStyles, /\.badge,[\s\S]*?border-radius:\s*var\(--radius-pill\)/);
  assert.match(sharedStyles, /\.badge-red,[\s\S]*?--pill-background:\s*var\(--red-pale\)/);
  assert.match(sharedStyles, /\.badge-gold,[\s\S]*?--pill-background:\s*var\(--gold-pale\)/);
});

test('modified page inline scripts parse', () => {
  for (const [name, source] of [['teacher dashboard', teacher], ['admin reports', admin]]) {
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(Boolean);
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script, { filename: name }));
  }
});

test('flag cards use compact reasons, plain avatars, and responsive grids', () => {
  for (const source of [teacher, admin]) {
    assert.match(source, /\$\{reason\.count\} absences/);
    assert.match(source, /\$\{reason\.count\} consecutive · \$\{reason\.subject\}/);
    assert.match(source, /\$\{reason\.subject\}: \$\{reason\.grade\}/);
    assert.match(source, /class="badge badge-\$\{reason\.type === 'grade' \? 'gold' : 'red'\}"/);
    assert.match(source, /data-lucide="\$\{reason\.type === 'grade' \? 'trending-down' : 'calendar-days'\}" aria-hidden="true"/);
    assert.doesNotMatch(source, /passing \$\{reason\.threshold\}|limit \$\{reason\.threshold\}/);
    assert.equal([...source.matchAll(/studentId: 'preview-/g)].length, 4);
  }
  assert.match(teacherStyles, /\.flag-grid-single\s*\{[^}]*repeat\(auto-fit, minmax\(min\(260px, 100%\), 1fr\)\)/s);
  assert.match(adminStyles, /\.flag-grid\s*\{[^}]*repeat\(auto-fit, minmax\(min\(260px, 100%\), 1fr\)\)/s);
  assert.match(teacherStyles, /\.flag-av\s*\{[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.match(adminStyles, /\.flag-av\s*\{[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.doesNotMatch(teacherStyles, /\.flag-card\.flag-(?:attendance|academic)\s+\.flag-av/);
  assert.match(adminStyles, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(teacherStyles, /\.flag-reason\s*\{/);
  assert.doesNotMatch(adminStyles, /\.flag-reason\s*\{/);
});
