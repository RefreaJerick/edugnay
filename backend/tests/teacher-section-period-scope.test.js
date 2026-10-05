const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
const loadGradeData = html.split('  async function loadBackendGradeData() {')[1]
  .split('  async function loadBackendAttendanceData() {')[0];
const lookupTerm = html.split('  function getBackendTermId(academicPeriodId) {')[1]
  .split('  function getPublishedGradesForPeriod(')[0];

test('teacher grading periods belong only to the selected section year and level', async () => {
  const terms = [
    ...[1, 2, 3, 4].map(number => ({ id: number, academicYearId: 10, schoolLevelId: 7, name: `Quarter ${number}`, sequenceNumber: number, status: number === 2 ? 'active' : 'closed' })),
    ...[1, 2].map(number => ({ id: number + 20, academicYearId: 11, schoolLevelId: 7, name: `Quarter ${number}`, sequenceNumber: number, status: number === 2 ? 'active' : 'closed' })),
    { id: 31, academicYearId: 10, schoolLevelId: 8, name: 'Semester 1', sequenceNumber: 1, status: 'active' }
  ];
  const requests = [];
  const context = vm.createContext({
    window: { EDUGNAY_API: {
      isBackendAvailable: true,
      getCurrentUser: async () => ({ role: 'teacher', apiUserId: 5 }),
      getAcademicTerms: async filters => {
        requests.push(filters);
        return terms.filter(term => term.academicYearId === filters.academicYearId && term.schoolLevelId === filters.schoolLevelId);
      },
      getGradingCategories: async () => [], getAssignments: async () => [],
      getGradingItems: async () => [], getStudentScores: async () => [],
      getFinalGrades: async () => [], getAssignmentSubmissions: async () => []
    } },
    console: { warn() {} }, hasValidBackendSubjectAssignment: () => true,
    refreshAssignmentCategoryOptions() {}, STUDENTS: []
  });
  vm.runInContext(`
    let CURRENT_BACKEND_SECTION = { id: 8, academicYearId: 10, schoolLevelId: 7 };
    let CURRENT_SUBJECT_ASSIGNMENT = { subjectId: 17 };
    let CURRENT_TEACHER_ID = '5';
    let BACKEND_GRADE_CONTEXT = null, BACKEND_GRADE_ERROR = '';
    let BACKEND_ASSIGNMENTS = [], BACKEND_GRADING_ITEMS = [], BACKEND_STUDENT_SCORES = [];
    let BACKEND_PUBLISHED_GRADES = [], BACKEND_CATEGORIES = [], BACKEND_TERMS = [];
    let ACADEMIC_PERIODS = [], ACTIVE_ACADEMIC_PERIOD_ID = '';
    const BACKEND_SUBMISSIONS = new Map();
    function isBackendGradeMode() { return Boolean(BACKEND_GRADE_CONTEXT); }
    function getBackendTermId(academicPeriodId) {${lookupTerm}
    async function loadBackendGradeData() {${loadGradeData}
  `, context);

  assert.equal(await vm.runInContext('loadBackendGradeData()', context), true);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { academicYearId: 10, schoolLevelId: 7 });
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(ACADEMIC_PERIODS.map(term => term.name))', context)),
    ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']);
  assert.equal(vm.runInContext('ACTIVE_ACADEMIC_PERIOD_ID', context), '2');
  assert.equal(vm.runInContext('getBackendTermId(22)', context), null);

  vm.runInContext('CURRENT_BACKEND_SECTION.academicYearId = 11', context);
  assert.equal(await vm.runInContext('loadBackendGradeData()', context), true);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), { academicYearId: 11, schoolLevelId: 7 });
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(ACADEMIC_PERIODS.map(term => term.id))', context)), ['21', '22']);
  assert.equal(vm.runInContext('ACTIVE_ACADEMIC_PERIOD_ID', context), '22');

  vm.runInContext('CURRENT_BACKEND_SECTION.academicYearId = 12', context);
  assert.equal(await vm.runInContext('loadBackendGradeData()', context), false);
  assert.match(vm.runInContext('BACKEND_GRADE_ERROR', context), /No grading periods are configured/);
  assert.equal(vm.runInContext('ACADEMIC_PERIODS.length', context), 0);
  assert.equal(vm.runInContext('getBackendTermId(2)', context), null);
});
