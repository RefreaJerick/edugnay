const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let sectionRows = [];
let assignmentRows = [];
const calls = [];

databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('SELECT section_teachers.section_id AS sectionId')) return [assignmentRows];
    if (sql.includes('FROM sections')) return [sectionRows];
    throw new Error(`Unexpected query: ${sql}`);
  }
});

const { listSections } = require('../controllers/sectionsController');

function section(id, name) {
  return {
    id, schoolId: 1, academicYearId: 4, academicYearLabel: '2026-2027', academicYearStatus: 'active',
    schoolLevelId: 2, schoolLevelCode: 'jhs', schoolLevelName: 'Junior High School',
    gradeLevelId: 7, gradeCode: 'grade-7', gradeLevelName: 'Grade 7', strandId: null,
    strandCode: null, strandName: null, name, capacity: 40, studentCount: 10,
    adviserUserId: 3, adviserName: 'Teacher', status: 'active'
  };
}

async function callList({ role = 'teacher', scope = 'teaching' } = {}) {
  const result = { body: null, error: null };
  await listSections(
    { user: { id: 3, schoolId: 1, role }, query: scope ? { scope } : {} },
    { json(body) { result.body = body; return this; } },
    error => { result.error = error; }
  );
  return result;
}

test('teaching scope requires a subject assignment and returns assigned subjects once per section', async () => {
  calls.length = 0;
  sectionRows = [section(8, 'St. Matthew')];
  assignmentRows = [
    { sectionId: 8, subjectId: 2, subjectCode: 'ENG', subjectName: 'English' },
    { sectionId: 8, subjectId: 3, subjectCode: 'MATH', subjectName: 'Mathematics' }
  ];
  const result = await callList();

  assert.equal(result.error, null);
  assert.equal(result.body.sections.length, 1);
  assert.deepEqual(result.body.sections[0].subjectAssignments.map(item => item.subjectName), ['English', 'Mathematics']);
  assert.match(calls[0].sql, /EXISTS \(\s*SELECT 1 FROM section_teachers/);
  assert.match(calls[0].sql, /section_teachers\.teacher_user_id = \?/);
  assert.match(calls[0].sql, /subjects\.is_active = TRUE/);
  assert.match(calls[0].sql, /academic_years\.status = 'active'/);
  assert.deepEqual(calls[0].values, [1, 3]);
  assert.deepEqual(calls[1].values, [1, 1, 3, 8]);
});

test('teaching scope returns no adviser-only section', async () => {
  calls.length = 0;
  sectionRows = [];
  assignmentRows = [];
  const result = await callList();

  assert.equal(result.error, null);
  assert.deepEqual(result.body.sections, []);
  assert.equal(calls.length, 1);
});

test('general teacher section list keeps adviser access for advisory features', async () => {
  calls.length = 0;
  sectionRows = [section(10, 'St. John')];
  const result = await callList({ scope: '' });

  assert.equal(result.error, null);
  assert.equal(result.body.sections.length, 1);
  assert.match(calls[0].sql, /sections\.adviser_user_id = \?/);
  assert.deepEqual(calls[0].values, [1, 3, 3]);
});

test('non-teachers cannot request the teaching scope', async () => {
  calls.length = 0;
  const result = await callList({ role: 'school_admin' });

  assert.equal(result.error?.status, 403);
  assert.equal(result.body, null);
  assert.equal(calls.length, 0);
});
