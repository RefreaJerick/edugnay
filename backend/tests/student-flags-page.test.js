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

test('teacher summary swaps the attention card for a backend-backed adviser draft count', () => {
  assert.match(teacher, /getMyAdvisorySections\(\)/);
  assert.match(teacher, /TEACHER_ADVISORY_SECTIONS\.length > 0 &&\s*window\.EDUGNAY_CONFIG\.isNarrativeReportsEnabled\(\)/);
  assert.match(teacher, /EDUGNAY_API\.request\('\/reports\/weekly-drafts\/pending-count'\)/);
  assert.match(teacher, /tone: 'gold', icon: 'hourglass', label: 'Reports to Confirm'/);
  assert.match(teacher, /value: TEACHER_PENDING_REPORTS_ERROR \? '—' : TEACHER_PENDING_REPORTS/);
  assert.match(teacher, /tone: 'red', icon: 'alert-triangle', label: 'Needs Attention'/);
  assert.match(teacher, /sub: TEACHER_FLAGS_ERROR \|\| 'Flagged students\.'/);
  assert.match(sharedStyles, /\.stat-card\.gold\s*\{[^}]*var\(--surface-warning-wash\)/);
});

test('teacher summary renders the right third card for adviser, non-adviser, and report errors', () => {
  const start = teacher.indexOf('function renderTeacherDashboardData() {');
  const end = teacher.indexOf('const sectionList =', start);
  assert.ok(start > 0 && end > start);
  const summaryCode = teacher.slice(start, end);
  const render = ({ adviser = false, enabled = true, count = 0, error = '' } = {}) => {
    const summaryList = { innerHTML: '' };
    const context = {
      document: { getElementById: () => summaryList },
      window: { EDUGNAY_CONFIG: {
        isNarrativeReportsEnabled: () => enabled,
        escapeHtml: value => String(value).replaceAll('<', '&lt;')
      } },
      TEACHER_SUMMARY_CARDS: [
        { tone: 'green', icon: 'graduation-cap', label: 'Total Students', records: [] },
        { tone: 'purple', icon: 'school', label: 'Sections Handled', records: [] }
      ],
      TEACHER_SECTIONS: [], TEACHER_SECTIONS_ERROR: '',
      TEACHER_ADVISORY_SECTIONS: adviser ? [{ id: '22' }] : [],
      TEACHER_PENDING_REPORTS: count, TEACHER_PENDING_REPORTS_ERROR: error,
      TEACHER_FLAGS: [{ id: '4' }], TEACHER_FLAGS_ERROR: ''
    };
    vm.runInNewContext(`${summaryCode}\n}\nrenderTeacherDashboardData();`, context);
    return summaryList.innerHTML;
  };

  assert.match(render({ adviser: true, count: 3 }), /stat-card gold[\s\S]*?stat-card-num">3<[\s\S]*?Reports to Confirm/);
  assert.match(render({ adviser: true, count: 0 }), /stat-card gold[\s\S]*?stat-card-num">0</);
  assert.match(render({ adviser: true, error: 'Reports unavailable' }), /stat-card-num">—<[\s\S]*?Reports unavailable/);
  for (const options of [{ adviser: false }, { adviser: true, enabled: false }]) {
    const html = render(options);
    assert.match(html, /stat-card red[\s\S]*?stat-card-num">1<[\s\S]*?Needs Attention[\s\S]*?Flagged students\./);
    assert.doesNotMatch(html, /Reports to Confirm/);
  }
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
    assert.match(source, /\$\{reason\.count\} dates with a recorded/);
    assert.match(source, /\$\{reason\.count\} missed \$\{reason\.subject\} meeting dates in a row/);
    assert.match(source, /\$\{reason\.subject\}: \$\{reason\.grade\}/);
    assert.match(source, /class="badge badge-\$\{\['grade', 'low_scores'\]\.includes\(reason\.type\) \? 'gold' : 'red'\}"/);
    assert.match(source, /data-lucide="\$\{\['grade', 'low_scores'\]\.includes\(reason\.type\) \? 'trending-down' : 'calendar-days'\}" aria-hidden="true"/);
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
