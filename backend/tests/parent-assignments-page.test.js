const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'views/parent/edugnay-parent-assignments.html'), 'utf8');
const studentHtml = fs.readFileSync(path.join(root, 'views/student/edugnay-student-assignments.html'), 'utf8');
const assignmentStyles = fs.readFileSync(path.join(root, 'assets/css/student/assignments.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/parent/assignments.js'), 'utf8');

function createPage(api) {
  const elements = new Map();
  const documentListeners = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'assignmentSubjectFilter' ? 'all' : '', textContent: '', innerHTML: '', hidden: id === 'assignmentDetailModal',
      disabled: false, dataset: {}, listeners: new Map(),
      classList: { add() {}, remove() {} }, focus() {},
      addEventListener(name, handler) { this.listeners.set(name, handler); }
    });
    return elements.get(id);
  };
  const document = {
    getElementById: element,
    addEventListener(name, handler) { documentListeners.set(name, handler); }
  };
  const context = vm.createContext({ document, window: {
    EDUGNAY_API: api, EDUGNAY_SCHOOL_READY: Promise.resolve(),
    EDUGNAY_CONFIG: { escapeHtml: value => String(value), renderPanelEmptyState: ({ title }) => title },
    EDUGNAY_AVATAR: { html: child => `<span>${child.displayName}</span>` },
    lucide: { createIcons() {} }
  } });
  new vm.Script(script).runInContext(context);
  documentListeners.get('DOMContentLoaded')();
  const click = (id, dataset) => element(id).listeners.get('click')({ target: { closest: () => ({ dataset, focus() {} }) } });
  const key = (id, keyName, dataset) => {
    let prevented = false;
    element(id).listeners.get('keydown')({ key: keyName, target: { closest: () => ({ dataset }) }, preventDefault() { prevented = true; } });
    return prevented;
  };
  const change = (id, value) => { element(id).value = value; element(id).listeners.get('change')({ target: element(id) }); };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
  return { element, click, change, key, flush };
}

const terms = [
  { id: '11', academicYearId: '1', schoolLevelId: '7', academicYearLabel: '2025-2026', name: 'Quarter 4', sequenceNumber: 4, status: 'closed' },
  { id: '21', academicYearId: '2', schoolLevelId: '7', academicYearLabel: '2026-2027', name: 'Quarter 1', sequenceNumber: 1, status: 'closed' },
  { id: '22', academicYearId: '2', schoolLevelId: '7', academicYearLabel: '2026-2027', name: 'Quarter 2', sequenceNumber: 2, status: 'active' },
  { id: '23', academicYearId: '2', schoolLevelId: '7', academicYearLabel: '2026-2027', name: 'Quarter 3', sequenceNumber: 3, status: 'upcoming' },
  { id: '24', academicYearId: '2', schoolLevelId: '7', academicYearLabel: '2026-2027', name: 'Quarter 4', sequenceNumber: 4, status: 'upcoming' },
  { id: '31', academicYearId: '2', schoolLevelId: '8', academicYearLabel: '2026-2027', name: 'Semester 1', sequenceNumber: 1, status: 'active' }
];
const assignment = (id, title, status, academicTermId = '22') => ({
  id: String(id), academicTermId, title, subjectName: 'English', teacherName: 'Ms. Reyes',
  dueDate: '2026-10-14', onlineSubmissionEnabled: true, submissionStatus: status, description: 'Write a report.'
});

test('parent assignment page has read-only details and navigation on every parent page', () => {
  assert.match(html, /id="child-switcher"/);
  assert.match(html, /id="assignmentYearFilter"/);
  assert.match(html, /id="assignmentPeriodTabs"/);
  assert.match(html, /class="assignment-period-tabs" id="assignmentPeriodTabs"/);
  assert.doesNotMatch(html, /class="grade-tabs assignment-period-tabs"/);
  assert.match(html, /id="assignmentPeriodFilter"/);
  assert.ok(html.indexOf('id="child-switcher"') < html.indexOf('class="assignment-workspace"'));
  assert.ok(html.indexOf('class="assignment-controls"') < html.indexOf('class="assignment-results"'));
  assert.match(html, /id="assignmentDetailModal"/);
  assert.doesNotMatch(html, /type="file"|Submit work|Replace file/);
  for (const filename of fs.readdirSync(path.join(root, 'views/parent')).filter(name => name.endsWith('.html'))) {
    const page = fs.readFileSync(path.join(root, 'views/parent', filename), 'utf8');
    assert.match(page, /href="edugnay-parent-assignments\.html"/, filename);
  }
});

test('student and parent previous-section work share an accessible accordion card style', () => {
  for (const page of [html, studentHtml]) {
    assert.match(page, /<details class="assignment-history" id="assignmentHistory" hidden>/);
    assert.match(page, /class="assignment-history-title">Previous section work/);
    assert.match(page, /class="assignment-history-count" id="assignmentHistoryCount"/);
  }
  assert.match(assignmentStyles, /\.assignment-history > summary::-webkit-details-marker/);
  assert.match(assignmentStyles, /\.assignment-history\[open\] > summary::before/);
  assert.match(assignmentStyles, /\.assignment-history > summary:focus-visible/);
  assert.match(assignmentStyles, /\.assignment-history-count[\s\S]*?border-radius: var\(--radius-pill\)/);
  assert.match(assignmentStyles, /\.assignment-history \.assignment-list[\s\S]*?border-top: 1px solid var\(--panel-divider\)/);
  assert.match(assignmentStyles, /@media \(max-width: 760px\)[\s\S]*?\.assignment-history > summary/);
});

test('parent page displays selected child, periods, status filters, and read-only details', async () => {
  const elective = { ...assignment(8, 'Elective research project', 'pending', null),
    scopeType: 'elective', electiveClassId: '51', electiveClassName: 'Academic 11-A', subjectName: 'Contemporary Literature' };
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7', gradeLevel: 'Grade 7', sectionName: 'St. Matthew' }],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [assignment(1, 'Essay', 'pending'), assignment(2, 'Quiz', 'submitted'), assignment(3, 'Old task', 'not_submitted', '11'), elective] })
  });
  await page.flush();
  assert.match(page.element('child-switcher').innerHTML, /Juan/);
  assert.match(page.element('child-switcher').innerHTML, /<div class="child-info"><div class="child-name">Juan<\/div>/);
  assert.match(page.element('assignmentPeriodFilter').innerHTML, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(page.element('assignmentPeriodFilter').innerHTML, /value="21">Quarter 1/);
  assert.match(page.element('assignmentPeriodFilter').innerHTML, /value="23" disabled/);
  assert.match(page.element('assignmentPeriodFilter').innerHTML, /value="24" disabled/);
  assert.doesNotMatch(page.element('assignmentPeriodFilter').innerHTML, /Semester 1/);
  assert.equal(page.element('assignmentPeriodFilter').value, '22');
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /data-lucide="lock"/);
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /aria-disabled="true" disabled aria-selected="false" aria-label="Quarter 3, not started"/);
  assert.match(page.element('assignmentList').innerHTML, /Essay/);
  assert.match(page.element('assignmentList').innerHTML, /Quiz/);
  assert.match(page.element('assignmentList').innerHTML, /Elective class assignments/);
  assert.match(page.element('assignmentList').innerHTML, /Elective class · Academic 11-A/);
  assert.match(page.element('assignmentList').innerHTML, /Elective research project/);
  assert.doesNotMatch(page.element('assignmentList').innerHTML, /Old task/);
  page.click('assignmentFilters', { status: 'submitted' });
  assert.doesNotMatch(page.element('assignmentList').innerHTML, /Essay/);
  assert.match(page.element('assignmentList').innerHTML, /Quiz/);
  page.change('assignmentYearFilter', '1');
  page.click('assignmentFilters', { status: 'all' });
  assert.match(page.element('assignmentList').innerHTML, /Old task/);
  page.click('assignmentList', { assignmentId: '3' });
  assert.equal(page.element('assignmentDetailStatus').textContent, 'Not submitted');
  assert.equal(page.element('assignmentDetailInstructions').textContent, 'Write a report.');
  assert.equal(page.element('assignmentDetailModal').hidden, false);
});

test('parent can view elective assignments when the child has no grading periods', async () => {
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7' }],
    getAcademicTerms: async () => [],
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [{
      ...assignment(9, 'Elective portfolio', 'pending', null), scopeType: 'elective',
      electiveClassId: '52', electiveClassName: 'TechPro 11-B'
    }] })
  });
  await page.flush();
  assert.match(page.element('assignmentList').innerHTML, /Elective class assignments/);
  assert.match(page.element('assignmentList').innerHTML, /Elective portfolio/);
  assert.doesNotMatch(page.element('assignmentList').innerHTML, /No grading periods available/);
});

test('period selection stays synchronized between desktop tabs and the mobile dropdown', async () => {
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7' }],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [] })
  });
  await page.flush();
  page.click('assignmentPeriodTabs', { academicPeriodId: '22' });
  assert.equal(page.element('assignmentPeriodFilter').value, '22');
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /data-academic-period-id="22" aria-selected="true"/);
  page.change('assignmentPeriodFilter', '23');
  assert.equal(page.element('assignmentPeriodFilter').value, '22');
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /data-academic-period-id="22" aria-selected="true"/);
  page.change('assignmentYearFilter', '1');
  assert.equal(page.element('assignmentPeriodFilter').value, '11');
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /Quarter 4/);
});

test('period labels follow the selected child school level, including semesters', async () => {
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', schoolLevelId: '7' },
      { studentId: '5', displayName: 'Maya', schoolLevelId: '8' }
    ],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async id => ({ studentId: id, assignments: [] })
  });
  await page.flush();
  page.click('child-switcher', { studentId: '5' });
  await page.flush();
  assert.match(page.element('assignmentPeriodFilter').innerHTML, /Semester 1/);
  assert.doesNotMatch(page.element('assignmentPeriodFilter').innerHTML, /Quarter/);
  assert.match(page.element('assignmentPeriodTabs').innerHTML, /Semester 1/);
});

test('configured periods without assignments remain selectable and show a period empty state', async () => {
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7' }],
    getAcademicTerms: async () => terms.map(term => term.id === '23' ? { ...term, status: 'closed' } : term),
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [assignment(1, 'Essay', 'pending')] })
  });
  await page.flush();
  page.change('assignmentPeriodFilter', '23');
  assert.match(page.element('assignmentList').innerHTML, /No assignments in this grading period/);
});

test('period selection defaults to the latest configured period when none is active', async () => {
  const closedTerms = terms.map(term => ({ ...term, status: 'closed' }));
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7' }],
    getAcademicTerms: async () => closedTerms,
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [] })
  });
  await page.flush();
  assert.equal(page.element('assignmentPeriodFilter').value, '24');
});

test('period selection falls back to the newest non-upcoming period', async () => {
  const termsWithOnlyFuturePeriodsInLatestYear = terms.map(term =>
    term.academicYearId === '2' ? { ...term, status: 'upcoming' } : { ...term, status: 'closed' });
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [{ studentId: '4', displayName: 'Juan', schoolLevelId: '7' }],
    getAcademicTerms: async () => termsWithOnlyFuturePeriodsInLatestYear,
    getParentChildAssignments: async () => ({ studentId: '4', assignments: [] })
  });
  await page.flush();
  assert.equal(page.element('assignmentYearFilter').value, '1');
  assert.equal(page.element('assignmentPeriodFilter').value, '11');
});

test('parent page ignores an older child response and retries a failed request', async () => {
  let resolveFirst;
  let failSecond = true;
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', schoolLevelId: '7' },
      { studentId: '5', displayName: 'Maya', schoolLevelId: '7' }
    ],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async id => {
      if (id === '4') return new Promise(resolve => { resolveFirst = resolve; });
      if (failSecond) throw new Error('Connection lost');
      return { studentId: '5', assignments: [assignment(5, 'Maya task', 'submitted')] };
    }
  });
  await page.flush();
  page.click('child-switcher', { studentId: '5' });
  await page.flush();
  assert.match(page.element('assignmentList').innerHTML, /Assignments unavailable/);
  failSecond = false;
  page.element('assignmentRetry').listeners.get('click')();
  await page.flush();
  resolveFirst({ studentId: '4', assignments: [assignment(4, 'Juan task', 'pending')] });
  await page.flush();
  assert.match(page.element('assignmentList').innerHTML, /Maya task/);
  assert.doesNotMatch(page.element('assignmentList').innerHTML, /Juan task/);
});

test('parent child switcher supports Enter and Space keyboard selection', async () => {
  const requested = [];
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', schoolLevelId: '7' },
      { studentId: '5', displayName: 'Maya', schoolLevelId: '7' }
    ],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async id => {
      requested.push(id);
      return { studentId: id, assignments: [assignment(id, `${id} task`, 'pending')] };
    }
  });
  await page.flush();
  assert.equal(page.key('child-switcher', ' ', { studentId: '5' }), true);
  await page.flush();
  assert.equal(requested.at(-1), '5');
  assert.match(page.element('assignmentList').innerHTML, /5 task/);
});

test('previous-section submissions stay separate from current assignments and follow the selected child', async () => {
  const page = createPage({ isBackendAvailable: true,
    getParentChildren: async () => [
      { studentId: '4', displayName: 'Juan', schoolLevelId: '7' },
      { studentId: '5', displayName: 'Maya', schoolLevelId: '7' }
    ],
    getAcademicTerms: async () => terms,
    getParentChildAssignments: async id => ({ studentId: id, assignments: [], history: id === '4'
      ? [{ id: '77', title: 'Previous essay', sectionName: 'St. Anne', academicYearLabel: '2026-2027',
        academicTermName: 'Quarter 2', subjectName: 'English', submissionStatus: 'submitted' }] : [] })
  });
  await page.flush();
  assert.equal(page.element('assignmentHistory').hidden, false);
  assert.equal(page.element('assignmentHistoryCount').textContent, '1');
  assert.match(page.element('assignmentHistoryList').innerHTML, /Previous essay/);
  assert.match(page.element('assignmentList').innerHTML, /No assignments/);
  page.click('child-switcher', { studentId: '5' });
  await page.flush();
  assert.equal(page.element('assignmentHistory').hidden, true);
  assert.doesNotMatch(page.element('assignmentHistoryList').innerHTML, /Maya task/);
});
