const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let linked = true;
let currentSection = true;
let gradesEnabled = 1;
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
const publishedGrades = [{
  id: 5,
  sectionId: 8,
  sectionName: 'St. Matthew',
  subjectId: 2,
  subjectName: 'English',
  academicTermId: 14,
  academicTermName: 'Quarter 2',
  academicTermSequenceNumber: 2,
  gradingPeriodType: 'quarterly',
  academicYearId: 4,
  academicYearLabel: '2026-2027',
  academicYearStatus: 'active',
  finalGrade: '78.00',
  publishedAt: '2026-09-28T08:00:00.000Z'
}];

const database = {
  async execute(sql) {
    if (sql.includes('FROM student_parent_links')) return [[linked ? { linked: 1 } : undefined].filter(Boolean)];
    if (sql.includes('FROM school_portal_features')) return [[{ gradesEnabled }]];
    if (sql.includes('FROM users WHERE')) return [[student]];
    if (sql.includes('FROM section_students') && sql.includes('section_teachers')) return [subjects];
    if (sql.includes('FROM section_students') && sql.includes('academic_terms')) return [terms];
    if (sql.includes('FROM section_students')) return [currentSection ? [section, historicalSection] : [historicalSection]];
    if (sql.includes('FROM published_final_grades')) return [publishedGrades];
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
  assert.deepEqual(result.data.overview.current.terms.map(term => term.status), ['active', 'upcoming']);
  assert.deepEqual(result.data.overview.current.subjects.map(subject => subject.subjectName), ['English', 'Mathematics']);
  assert.equal(result.data.overview.publishedGrades.length, 1);
  assert.equal(result.data.overview.publishedGrades[0].finalGrade, 78);
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
