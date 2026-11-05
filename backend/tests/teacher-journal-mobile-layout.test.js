const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const journalScript = fs.readFileSync(path.join(root, 'assets/js/teacher/journals.js'), 'utf8').replace(/\r\n/g, '\n');
const journalCss = fs.readFileSync(path.join(root, 'assets/css/teacher/journals.css'), 'utf8').replace(/\r\n/g, '\n');
const renderStart = journalScript.indexOf('function renderTable() {');
const renderEnd = journalScript.indexOf('\nfunction openEntry(', renderStart);
const renderTableSource = journalScript.slice(renderStart, renderEnd);

function renderJournalRow(entry, student) {
  assert.notEqual(renderStart, -1, 'expected renderTable in teacher journals script');
  assert.notEqual(renderEnd, -1, 'expected openEntry after renderTable');

  const events = [];
  const openedStudents = [];
  const elements = {
    noPromptState: { innerHTML: '', style: {} },
    'search-input': { value: '' },
    'status-filter': { value: 'all' },
    'table-footer': { textContent: '', style: {} },
    'journal-tbody': { innerHTML: '' }
  };
  const toolbar = { style: {} };
  const tableWrap = { style: {} };
  const context = vm.createContext({
    SECTIONS: { section: { prompt: {}, students: [entry] } },
    STUDENT_BY_ID: { [entry.studentId]: student },
    currentSection: 'section',
    activeStudentIds: [],
    window: {
      EDUGNAY_CONFIG: {
        escapeHtml(value) {
          return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },
        renderPanelEmptyState: ({ title }) => `<div>${title}</div>`
      },
      EDUGNAY_AVATAR: { html: () => '<span class="student-av">CB</span>' },
      EDUGNAY_PAGE_EVENTS: {
        register(_type, handler) {
          events.push(handler);
          return `event-${events.length}`;
        }
      },
      lucide: { createIcons() {} }
    },
    document: {
      getElementById: id => elements[id],
      querySelector: selector => selector === '.toolbar' ? toolbar : tableWrap
    },
    lucide: { createIcons() {} },
    openEntry: studentId => openedStudents.push(studentId)
  });

  vm.runInContext(`${renderTableSource}\nrenderTable();`, context);
  return { html: elements['journal-tbody'].innerHTML, events, openedStudents };
}

test('teacher journal rows render student summaries and retain accessible Review actions', () => {
  const { html, events, openedStudents } = renderJournalRow({
    studentId: 'student-1',
    submitted: true,
    reviewed: false,
    late: false,
    score: 47,
    maxScore: 50,
    entryText: 'A journal excerpt with <script>unsafe</script> text.'
  }, { displayName: 'A Very Long Learner Name That Should Wrap' });

  for (const label of ['#', 'Student', 'Journal excerpt', 'Submitted', 'Score', 'Status', 'Action']) {
    assert.ok(html.includes(`data-label="${label}"`), `expected ${label} field label`);
  }
  assert.match(html, /A Very Long Learner Name That Should Wrap/);
  assert.match(html, /A journal excerpt with &lt;script&gt;unsafe&lt;\/script&gt; text\./);
  assert.match(html, /class="journal-mobile-status journal-mobile-status--pending"[\s\S]*?Pending review/);
  assert.doesNotMatch(html, /journal-mobile-status-dot/);
  assert.match(html, /class="row-btn primary"/);
  assert.match(html, /aria-label="Review A Very Long Learner Name That Should Wrap"/);
  assert.match(html, /class="journal-review-eye" data-lucide="eye"/);
  assert.match(html, /class="journal-review-text">Review<\/span>/);
  assert.match(html, /class="journal-review-chevron" data-lucide="chevron-right"/);

  events[0]({});
  events[1]({ stopPropagation() {} });
  assert.deepEqual(openedStudents, ['student-1', 'student-1']);
});

test('teacher journal mobile status summaries cover submission and review states', () => {
  const common = { studentId: 'student-2', reviewed: false, late: false, score: null, maxScore: 50, entryText: '' };
  const notSubmitted = renderJournalRow({ ...common, submitted: false, late: true }, { displayName: 'Learner' }).html;
  const pending = renderJournalRow({ ...common, submitted: true }, { displayName: 'Learner' }).html;
  const reviewed = renderJournalRow({ ...common, submitted: true, reviewed: true }, { displayName: 'Learner' }).html;
  const latePending = renderJournalRow({ ...common, submitted: true, late: true }, { displayName: 'Learner' }).html;
  const lateReviewed = renderJournalRow({ ...common, submitted: true, reviewed: true, late: true }, { displayName: 'Learner' }).html;

  assert.match(notSubmitted, /class="journal-mobile-status journal-mobile-status--not-submitted"[\s\S]*?Not submitted/);
  assert.match(notSubmitted, /class="badge badge-gray">Not submitted<\/span>/);
  assert.match(pending, /class="journal-mobile-status journal-mobile-status--pending"[\s\S]*?Pending review/);
  assert.match(reviewed, /class="journal-mobile-status journal-mobile-status--reviewed"[\s\S]*?Reviewed/);
  assert.match(reviewed, /class="badge badge-green"[\s\S]*?Reviewed/);
  assert.match(latePending, /class="journal-mobile-status journal-mobile-status--pending"[\s\S]*?Pending review · Late/);
  assert.match(lateReviewed, /class="journal-mobile-status journal-mobile-status--reviewed"[\s\S]*?Reviewed · Late/);
});

test('teacher journal rows use individual student cards only at the mobile breakpoint', () => {
  assert.match(journalCss, /\.table-wrap\s*\{\s*overflow-x:\s*auto;\s*\}/);

  const mobileRules = journalCss.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(mobileRules, 'expected the existing 760px mobile breakpoint');
  assert.match(mobileRules, /\.table-wrap\s*\{\s*overflow-x:\s*hidden;/);
  assert.match(mobileRules, /#journal-tbody\s*\{[^}]*display:\s*grid;[^}]*gap:\s*10px;[^}]*padding:\s*12px;/s);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr:not\(\.panel-empty-row\)\s*\{[^}]*display:\s*grid;/s);
  assert.match(mobileRules, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+36px/);
  assert.match(mobileRules, /grid-template-areas:\s*"student score action"/);
  assert.match(mobileRules, /border:\s*1px solid var\(--gray-200\);[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*var\(--theme-surface\)/s);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr\s*>\s*td\.journal-row-number,\s*#journal-tbody\s*>\s*tr\s*>\s*td\.journal-submitted-cell,\s*#journal-tbody\s*>\s*tr\s*>\s*td\.journal-excerpt-cell,\s*#journal-tbody\s*>\s*tr\s*>\s*td\.journal-status-cell\s*\{\s*display:\s*none;/);
  assert.match(mobileRules, /\.journal-student-cell \.student-name\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(mobileRules, /\.journal-mobile-status\s*\{[^}]*display:\s*flex;[^}]*color:\s*var\(--gray-500\)/s);
  assert.match(mobileRules, /\.journal-mobile-status--pending\s*\{\s*color:\s*var\(--theme-warning-strong\);/);
  assert.match(mobileRules, /\.journal-mobile-status--reviewed\s*\{\s*color:\s*var\(--theme-success-text\);/);
  assert.doesNotMatch(journalCss, /\.journal-mobile-status-dot/);
  assert.match(mobileRules, /\.journal-review-eye,\s*\.journal-review-text\s*\{\s*display:\s*none;/);
  assert.match(mobileRules, /\.journal-review-cell \.journal-review-chevron\s*\{\s*display:\s*block;/);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr\s*>\s*td\.journal-review-cell \.row-btn\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr\s*>\s*td\.journal-review-cell \.row-btn:hover:not\(:disabled\)\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr\s*>\s*td\.journal-review-cell \.row-btn:focus-visible[\s\S]*?box-shadow:\s*0 0 0 3px var\(--button-focus-ring\)/s);
  assert.match(mobileRules, /#journal-tbody\s*>\s*tr:not\(\.panel-empty-row\):hover \.journal-review-chevron[\s\S]*?transform:\s*translateX\(2px\)/);
  assert.match(mobileRules, /\.table-wrap\s*>\s*table\s*>\s*thead\s*\{[^}]*clip-path:\s*inset\(50%\)/s);
});
