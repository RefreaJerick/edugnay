const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let linked = true;
let currentSection = true;
let gradesEnabled = 1;
let gradeCode = 'grade-3';
let schoolLevelCode = 'elementary';
let savedRules = {};
let extraEnrollmentRows = [];
let extraTerms = [];
let publishedGrades;
const student = { id: 101, displayName: 'Juan Dela Cruz' };
const section = {
  sectionId: 8,
  sectionName: 'St. Matthew',
  academicYearId: 4,
  academicYearLabel: '2026-2027',
  academicYearStatus: 'active',
  academicYearStartDate: '2026-06-01',
  enrollmentWithdrawnAt: null,
  schoolLevelId: 2,
  gradingPeriodType: 'quarterly',
  passingGradeThreshold: '75.00',
  sectionStatus: 'active'
};
const historicalSection = {
  ...section,
  sectionId: 7,
  sectionName: 'St. Luke',
  academicYearId: 3,
  academicYearLabel: '2025-2026',
  academicYearStatus: 'closed',
  academicYearStartDate: '2025-06-01',
  enrollmentWithdrawnAt: '2026-05-30 00:00:00',
  sectionStatus: 'inactive'
};
const terms = [
  { id: 14, academicYearId: 4, schoolLevelId: 2, name: 'Quarter 2', sequenceNumber: 2, status: 'active' },
  { id: 15, academicYearId: 4, schoolLevelId: 2, name: 'Quarter 3', sequenceNumber: 3, status: 'upcoming' },
  { id: 12, academicYearId: 3, schoolLevelId: 2, name: 'Quarter 1', sequenceNumber: 1, status: 'closed' }
];
const subjects = [
  { sectionId: 8, subjectId: 2, subjectName: 'English' },
  { sectionId: 8, subjectId: 3, subjectName: 'Mathematics' },
  { sectionId: 7, subjectId: 4, subjectName: 'Science' }
];
const basePublishedGrades = [{
  id: 5,
  sectionId: 8,
  sectionName: 'St. Matthew',
  subjectId: 2,
  subjectName: 'English',
  academicTermId: 14,
  academicTermName: 'Quarter 2',
  academicTermSequenceNumber: 2,
  gradingPeriodType: 'quarterly',
  passingGradeThreshold: '75.00',
  academicYearId: 4,
  academicYearLabel: '2026-2027',
  academicYearStatus: 'active',
  finalGrade: '78.00',
  publishedAt: '2026-09-28T08:00:00.000Z'
}];

publishedGrades = basePublishedGrades;

function resetScenario() {
  linked = true;
  currentSection = true;
  gradesEnabled = 1;
  gradeCode = 'grade-3';
  schoolLevelCode = 'elementary';
  savedRules = {};
  extraEnrollmentRows = [];
  extraTerms = [];
  publishedGrades = basePublishedGrades;
}

const database = {
  async execute(sql, params = []) {
    if (sql.includes('FROM student_parent_links')) return [[linked ? { linked: 1 } : undefined].filter(Boolean)];
    if (sql.includes('FROM school_portal_features')) return [[{ gradesEnabled }]];
    if (sql.includes('FROM users WHERE')) return [[student]];
    if (sql.includes('FROM school_year_final_grade_rules')) {
      const rows = [];
      for (let index = 1; index < params.length; index += 2) {
        const academicYearId = params[index];
        const schoolLevelId = params[index + 1];
        const rule = savedRules[`${academicYearId}:${schoolLevelId}`];
        if (rule) rows.push({ academicYearId, schoolLevelId, ...rule });
      }
      return [rows];
    }
    if (sql.includes('SELECT COUNT(*) AS termCount FROM academic_terms')) return [[{ termCount: 3 }]];
    if (sql.includes('FROM published_final_grades AS grades')) return [[{ gradeCount: 1 }]];
    if (sql.includes('FROM section_students') && sql.includes('section_teachers')) return [subjects];
    if (sql.includes('FROM section_students') && sql.includes('academic_terms')) return [[...terms, ...extraTerms]];
    if (sql.includes('FROM section_students')) {
      const current = { ...section, gradeCode, schoolLevelCode, schoolId: 1 };
      const historical = { ...historicalSection, gradeCode, schoolLevelCode, schoolId: 1 };
      return [currentSection
        ? [current, historical, ...extraEnrollmentRows]
        : [historical, ...extraEnrollmentRows]];
    }
    if (sql.includes('FROM published_final_grades')) return [publishedGrades.map(grade => ({
      schoolId: 1,
      schoolLevelId: 2,
      schoolLevelCode,
      gradeCode,
      ...grade
    }))];
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => database;
const grades = require('../controllers/gradesController');

async function callOverview({ role = 'student', id = 101, query = {} } = {}) {
  const result = { status: 200, data: null, error: null, headers: {} };
  await grades.getFinalGradesOverview(
    { user: { id, schoolId: 1, role }, query },
    {
      set(name, value) { result.headers[name] = value; return this; },
      json(data) { result.data = data; return this; }
    },
    error => { result.error = error; }
  );
  return result;
}

test.beforeEach(resetScenario);

test('student grade overview returns assigned subjects, configured terms, and published snapshots only', async () => {
  linked = true;
  currentSection = true;
  const result = await callOverview();

  assert.equal(result.error, null);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.data.overview.student.id, '101');
  assert.equal(result.data.overview.academicYears[0].id, '4');
  assert.equal(result.data.overview.academicYears[0].sections[0].id, '8');
  assert.equal(result.data.overview.academicYears[1].id, '3');
  assert.equal(result.data.overview.academicYears[1].sections[0].subjects[0].subjectName, 'Science');
  assert.equal(result.data.overview.current.sectionId, '8');
  assert.equal(result.data.overview.current.passingGradeThreshold, 75);
  assert.equal(result.data.overview.academicYears[0].sections[0].passingGradeThreshold, 75);
  assert.deepEqual(result.data.overview.current.terms.map(term => term.status), ['active', 'upcoming']);
  assert.deepEqual(result.data.overview.current.subjects.map(subject => subject.subjectName), ['English', 'Mathematics']);
  assert.equal(result.data.overview.publishedGrades.length, 1);
  assert.equal(result.data.overview.publishedGrades[0].finalGrade, 78);
  assert.equal(result.data.overview.publishedGrades[0].passingGradeThreshold, 75);
});

test('parent grade overview requires a linked student', async () => {
  linked = false;
  const result = await callOverview({ role: 'parent', id: 7, query: { studentId: '101' } });

  assert.equal(result.error?.status, 403);
  assert.equal(result.data, null);
  linked = true;
});

test('parent receives overview only for a linked child', async () => {
  linked = true;
  const result = await callOverview({ role: 'parent', id: 7, query: { studentId: '101' } });

  assert.equal(result.error, null);
  assert.equal(result.data.overview.student.id, '101');
  assert.equal(result.data.overview.current.sectionId, '8');
});

test('student cannot request another student overview', async () => {
  const result = await callOverview({ role: 'student', id: 101, query: { studentId: '102' } });

  assert.equal(result.error?.status, 403);
  assert.equal(result.data, null);
});

test('student with no active enrollment still receives published history', async () => {
  currentSection = false;
  const result = await callOverview();

  assert.equal(result.error, null);
  assert.equal(result.data.overview.current, null);
  assert.equal(result.data.overview.publishedGrades.length, 1);
  currentSection = true;
});

test('overview is blocked when the school Grades portal is disabled', async () => {
  gradesEnabled = 0;
  const result = await callOverview();

  assert.equal(result.error?.status, 403);
  assert.equal(result.data, null);
  gradesEnabled = 1;
});

test('school-specific threshold applies to current, historical, and published K-10 grades', async () => {
  gradeCode = 'grade-8';
  schoolLevelCode = 'jhs';
  savedRules = {
    '4:2': { gradingMode: 'school_specific', passingGradeThreshold: '83.00', gradeRounding: 'roundup' },
    '5:2': { gradingMode: 'school_specific', passingGradeThreshold: '83.00', gradeRounding: 'roundup' }
  };
  extraEnrollmentRows = [{
    ...historicalSection,
    sectionId: 9,
    sectionName: 'St. Peter',
    academicYearId: 5,
    academicYearLabel: '2027-2028',
    academicYearStatus: 'closed',
    academicYearStartDate: '2027-06-01',
    schoolId: 1,
    schoolLevelCode: 'jhs',
    gradeCode: 'grade-8'
  }];
  extraTerms = [{ id: 20, academicYearId: 5, schoolLevelId: 2, name: 'Trimester 1', sequenceNumber: 1, status: 'closed' }];
  publishedGrades = [
    { ...basePublishedGrades[0], finalGrade: '80.00', schoolId: 1, schoolLevelCode: 'jhs', gradeCode: 'grade-8' },
    {
      ...basePublishedGrades[0],
      id: 6,
      sectionId: 9,
      sectionName: 'St. Peter',
      academicTermId: 20,
      academicTermName: 'Trimester 1',
      academicYearId: 5,
      academicYearLabel: '2027-2028',
      academicYearStatus: 'closed',
      finalGrade: '82.00',
      schoolId: 1,
      schoolLevelCode: 'jhs',
      gradeCode: 'grade-8'
    }
  ];

  const result = await callOverview();
  const parentResult = await callOverview({ role: 'parent', id: 7, query: { studentId: '101' } });
  const years = result.data.overview.academicYears;

  assert.equal(result.error, null);
  assert.equal(parentResult.error, null);
  assert.equal(result.data.overview.current.passingGradeThreshold, 83);
  assert.equal(parentResult.data.overview.current.passingGradeThreshold, 83);
  assert.equal(years.find(year => year.id === '5').sections[0].passingGradeThreshold, 83);
  assert.deepEqual(result.data.overview.publishedGrades.map(grade => grade.passingGradeThreshold), [83, 83]);
});

test('DepEd K-10 method uses its 75 passing threshold when no school-specific rule is saved', async () => {
  gradeCode = 'grade-5';
  schoolLevelCode = 'elementary';

  const result = await callOverview();

  assert.equal(result.error, null);
  assert.equal(result.data.overview.current.passingGradeThreshold, 75);
  assert.equal(result.data.overview.publishedGrades[0].passingGradeThreshold, 75);
});

test('Grade 1 keeps the school-level threshold while Grade 5 uses its DepEd final-grade rule', async () => {
  gradeCode = 'grade-1';
  schoolLevelCode = 'elementary';
  savedRules = {
    '4:2': { gradingMode: 'school_specific', passingGradeThreshold: '83.00', gradeRounding: 'roundup' }
  };
  extraEnrollmentRows = [{
    ...section,
    sectionId: 9,
    sectionName: 'St. Peter',
    schoolId: 1,
    schoolLevelCode: 'elementary',
    gradeCode: 'grade-5'
  }];

  const result = await callOverview();
  const currentYear = result.data.overview.academicYears.find(year => year.id === '4');

  assert.equal(result.error, null);
  assert.equal(currentYear.sections.find(item => item.id === '8').passingGradeThreshold, 75);
  assert.equal(currentYear.sections.find(item => item.id === '9').passingGradeThreshold, 83);
  assert.equal(result.data.overview.publishedGrades[0].passingGradeThreshold, 75);
});

test('Grade 2–3 published displays use their SY 2026–27 DepEd passing threshold', async () => {
  for (const code of ['grade-2', 'grade-3']) {
    resetScenario();
    gradeCode = code;
    const result = await callOverview();
    assert.equal(result.error, null, code);
    assert.equal(result.data.overview.current.passingGradeThreshold, 75, code);
    assert.equal(result.data.overview.publishedGrades[0].passingGradeThreshold, 75, code);
    for (const internalField of ['gradeCode', 'schoolLevelCode', 'schoolLevelId']) {
      assert.equal(Object.hasOwn(result.data.overview.publishedGrades[0], internalField), false, internalField);
    }
  }
});

test('Grade 2–3 and Grade 4–6 displays share the school-specific Elementary threshold', async () => {
  gradeCode = 'grade-2';
  savedRules = { '4:2': { gradingMode: 'school_specific', passingGradeThreshold: '83.00', gradeRounding: 'roundup' } };
  extraEnrollmentRows = [{
    ...section, sectionId: 9, sectionName: 'Grade 5 - St. Peter', schoolId: 1,
    schoolLevelCode: 'elementary', gradeCode: 'grade-5'
  }];
  publishedGrades = [
    { ...basePublishedGrades[0], gradeCode: 'grade-2' },
    { ...basePublishedGrades[0], id: 6, gradeCode: 'grade-5', finalGrade: '80.00' }
  ];

  const result = await callOverview();
  const parentResult = await callOverview({ role: 'parent', id: 7, query: { studentId: '101' } });
  const currentSections = result.data.overview.academicYears.find(year => year.id === '4').sections;

  assert.equal(result.error, null);
  assert.equal(parentResult.error, null);
  assert.equal(currentSections.find(item => item.id === '8').passingGradeThreshold, 83);
  assert.equal(currentSections.find(item => item.id === '9').passingGradeThreshold, 83);
  assert.equal(result.data.overview.current.passingGradeThreshold, 83);
  assert.equal(parentResult.data.overview.current.passingGradeThreshold, 83);
  assert.deepEqual(result.data.overview.publishedGrades.map(grade => grade.passingGradeThreshold), [83, 83]);
  assert.deepEqual(parentResult.data.overview.publishedGrades.map(grade => grade.passingGradeThreshold), [83, 83]);
});
