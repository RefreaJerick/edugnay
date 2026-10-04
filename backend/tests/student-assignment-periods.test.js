const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-assignments.html'), 'utf8');
const periodHelpers = source.match(/    function setAssignmentPeriods\(terms\) \{[\s\S]*?    async function loadBackendAssignments\(\)/)?.[0]
  .replace(/    async function loadBackendAssignments\(\)$/, '');

test('student assignments stay within the selected school year and grading period', () => {
  assert.ok(periodHelpers);
  const context = vm.createContext({
    ASSIGNMENTS: [
      { id: 'old', academicPeriodId: '2' },
      { id: 'current', academicPeriodId: '6' }
    ],
    ASSIGNMENT_PERIODS: [],
    selectedAssignmentPeriodId: '',
    terms: [
      { id: 2, academicYearId: 1, academicYearLabel: '2025-2026', schoolLevelId: 3, sequenceNumber: 2, status: 'closed' },
      { id: 5, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 1, status: 'closed' },
      { id: 6, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 3, sequenceNumber: 2, status: 'active' },
      { id: 7, academicYearId: 2, academicYearLabel: '2026-2027', schoolLevelId: 4, sequenceNumber: 2, status: 'active' }
    ]
  });

  vm.runInContext(`${periodHelpers}; setAssignmentPeriods(terms);`, context);
  assert.equal(context.selectedAssignmentPeriodId, '6');
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'current');
  assert.equal(context.ASSIGNMENT_PERIODS.some(term => term.id === 7), false);

  vm.runInContext("selectedAssignmentPeriodId = '2'", context);
  assert.equal(vm.runInContext('getAssignmentsInSelectedPeriod()[0].id', context), 'old');
});
