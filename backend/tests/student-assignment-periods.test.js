const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-assignments.html'), 'utf8');
const periodHelpers = source.match(/    function latestSelectableAssignmentPeriod\(periods\) \{[\s\S]*?    async function loadBackendAssignments\(\)/)?.[0]
  .replace(/    async function loadBackendAssignments\(\)$/, '');

test('student assignments stay within the selected school year and grading period', () => {
  assert.ok(periodHelpers);
  const context = vm.createContext({
    ASSIGNMENTS: [
      { id: 'old', academicPeriodId: '2' },
      { id: 'current', academicPeriodId: '6' },
      { id: 'elective', academicPeriodId: null, electiveClassId: '51', scopeType: 'elective' }
    ],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    terms: [
      { id: 1, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, sequenceNumber: 1, status: 'closed' },
      { id: 2, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, sequenceNumber: 2, status: 'closed' },
      { id: 5, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 1, status: 'closed' },
      { id: 6, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 2, status: 'active' },
      { id: 7, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, sequenceNumber: 2, status: 'active' }
    ]
  });

  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms);`, context);
  assert.equal(context.selectedAssignmentPeriodId, '6');
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.deepEqual(Array.from(context.ASSIGNMENT_PERIODS, term => String(term.id)), ['5', '6', '1', '2']);
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'current');
  assert.deepEqual(Array.from(vm.runInContext('getAssignmentsForCurrentView().map(item => item.id)', context)), ['current']);
  assert.equal(context.ASSIGNMENT_PERIODS.some(term => term.id === 7), false);

  vm.runInContext("selectAssignmentYear('1')", context);
  assert.equal(context.selectedAssignmentYearId, '1');
  assert.equal(context.selectedAssignmentPeriodId, '2');
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'old');
  assert.deepEqual(Array.from(vm.runInContext('getAssignmentsForCurrentView().map(item => item.id)', context)), ['old']);
  vm.runInContext("selectAssignmentPeriod('5')", context);
  assert.equal(context.selectedAssignmentYearId, '2');
  assert.equal(context.selectedAssignmentPeriodId, '5');
  vm.runInContext("selectedAssignmentPeriodId = 'missing'; setAssignmentPeriods(terms.map(term => ({ ...term, status: 'closed' })))", context);
  assert.equal(context.selectedAssignmentPeriodId, '6');
});

test('student elective assignments also follow the selected grading period', () => {
  assert.match(source, /function getAssignmentsForCurrentView\(\)\s*\{\s*return getAssignmentsInSelectedPeriod\(\);/);
  assert.doesNotMatch(source, /getAssignmentsForCurrentView\(\)[\s\S]{0,180}ASSIGNMENTS\.filter\(isElectiveAssignment\)/);
  assert.match(source, /Elective class assignments/);
  assert.match(source, /function isElectiveAssignment\(assignment\)/);
  assert.match(source, /assignmentScope/);
  assert.match(fs.readFileSync(path.join(__dirname, '../../assets/css/student/assignments.css'), 'utf8'), /\.assignment-scope-heading[\s\S]*?grid-column: 1 \/ -1/);
});

test('student assignment page has a responsive controls panel and desktop period tabs', () => {
  assert.match(source, /id="assignmentYearFilter"/);
  assert.match(source, /id="assignmentPeriodTabs"/);
  assert.match(source, /class="assignment-period-tabs" id="assignmentPeriodTabs"/);
  assert.doesNotMatch(source, /class="grade-tabs assignment-period-tabs"/);
  assert.match(source, /id="assignmentPeriodFilter"/);
  assert.match(source, /id="assignmentSubjectFilter"/);
  assert.match(source, /class="assignment-results"/);
});

test('student assignment page inline scripts parse', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length);
  scripts.forEach((match, index) => {
    assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  });
});

test('student year dropdown, mobile periods, and desktop tabs render from the same selection', () => {
  assert.ok(periodHelpers);
  const elements = new Map(['assignmentYearFilter', 'assignmentPeriodFilter', 'assignmentPeriodTabs'].map(id => [id, {
    value: '', innerHTML: '', disabled: false
  }]));
  const context = vm.createContext({
    ASSIGNMENTS: [{ academicPeriodId: '6' }, { academicPeriodId: '2' }],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    backendAssignmentsError: '',
    document: { getElementById: id => elements.get(id) },
    window: { lucide: { createIcons() {} } },
    escapeHtml: value => String(value),
    terms: [
      { id: 2, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, name: 'Semester 2', sequenceNumber: 2, status: 'closed' },
      { id: 5, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Semester 1', sequenceNumber: 1, status: 'closed' },
      { id: 6, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Semester 2', sequenceNumber: 2, status: 'active' },
      { id: 7, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, name: 'Quarter 2', sequenceNumber: 2, status: 'active' }
    ]
  });
  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms); renderPeriodFilter();`, context);
  assert.match(elements.get('assignmentYearFilter').innerHTML, /2026-2027[\s\S]*2025-2026/);
  assert.match(elements.get('assignmentPeriodFilter').innerHTML, /Semester 1[\s\S]*Semester 2/);
  assert.doesNotMatch(elements.get('assignmentPeriodFilter').innerHTML, /Quarter/);
  assert.match(elements.get('assignmentPeriodTabs').innerHTML, /data-academic-period-id="6" aria-selected="true"/);
  assert.match(elements.get('assignmentPeriodTabs').innerHTML, /Semester 1[\s\S]*Semester 2/);
});

test('student quarter controls are ordered and lock upcoming periods', () => {
  assert.ok(periodHelpers);
  const elements = new Map(['assignmentYearFilter', 'assignmentPeriodFilter', 'assignmentPeriodTabs'].map(id => [id, {
    value: '', innerHTML: '', disabled: false
  }]));
  const context = vm.createContext({
    ASSIGNMENTS: [{ academicPeriodId: '32' }],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentYearId: '',
    selectedAssignmentPeriodId: '',
    backendAssignmentsError: '',
    document: { getElementById: id => elements.get(id) },
    window: { lucide: { createIcons() {} } },
    escapeHtml: value => String(value),
    terms: [
      { id: 34, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 4', sequenceNumber: 4, status: 'upcoming' },
      { id: 33, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 3', sequenceNumber: 3, status: 'upcoming' },
      { id: 32, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 2', sequenceNumber: 2, status: 'active' },
      { id: 31, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, name: 'Quarter 1', sequenceNumber: 1, status: 'closed' }
    ]
  });

  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms); renderPeriodFilter();`, context);
  const mobileOptions = elements.get('assignmentPeriodFilter').innerHTML;
  const tabs = elements.get('assignmentPeriodTabs').innerHTML;
  assert.match(mobileOptions, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(mobileOptions, /value="33" disabled/);
  assert.match(mobileOptions, /value="34" disabled/);
  assert.match(tabs, /Quarter 1[\s\S]*Quarter 2[\s\S]*Quarter 3[\s\S]*Quarter 4/);
  assert.match(tabs, /data-lucide="lock"/);
  assert.match(tabs, /aria-disabled="true" disabled aria-selected="false" aria-label="Quarter 3, not started"/);
  assert.match(tabs, /aria-disabled="true" disabled aria-selected="false" aria-label="Quarter 4, not started"/);
  assert.equal(context.selectedAssignmentPeriodId, '32');
  vm.runInContext("selectAssignmentPeriod('33')", context);
  assert.equal(context.selectedAssignmentPeriodId, '32');
});
