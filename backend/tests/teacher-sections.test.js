const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let sectionRows = [];
let assignmentRows = [];
let sectionTeacherRows = [];
const calls = [];

databaseModule.getDatabase = () => ({
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('SELECT section_teachers.section_id AS sectionId')) return [assignmentRows];
    if (sql.includes('SELECT section_teachers.id AS assignmentId')) return [sectionTeacherRows];
    if (sql.includes('FROM sections')) return [sectionRows];
    throw new Error(`Unexpected query: ${sql}`);
  }
});

const { listSectionTeachers, listSections } = require('../controllers/sectionsController');

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

async function callListSectionTeachers({ role = 'student' } = {}) {
  const result = { body: null, error: null };
  await listSectionTeachers(
    { user: { id: 30, schoolId: 1, role }, params: { sectionId: '8' } },
    { json(body) { result.body = body; return this; } },
    error => { result.error = error; }
  );
  return result;
}

test('section teacher assignments return component names and preserve teacher and adviser details', async () => {
  calls.length = 0;
  sectionRows = [{ ...section(8, 'QA-only'), schoolLevelCode: 'shs', adviserUserId: 10 }];
  sectionTeacherRows = [
    { assignmentId: 1, teacherId: 10, teacherName: 'Maya Santos', teacherEmail: 'maya@example.test', initials: 'MS', avatarFilename: null, avatarVersion: 0,
      subjectId: 20, subjectCode: 'shs-core-communication', subjectName: 'Effective Communication / Mabisang Komunikasyon', communicationComponentCode: 'english' },
    { assignmentId: 2, teacherId: 11, teacherName: 'Carlo Reyes', teacherEmail: 'carlo@example.test', initials: 'CR', avatarFilename: null, avatarVersion: 0,
      subjectId: 20, subjectCode: 'shs-core-communication', subjectName: 'Effective Communication / Mabisang Komunikasyon', communicationComponentCode: 'filipino' },
    { assignmentId: 3, teacherId: 12, teacherName: 'Ana Cruz', teacherEmail: 'ana@example.test', initials: 'AC', avatarFilename: null, avatarVersion: 0,
      subjectId: 21, subjectCode: 'shs-core-science', subjectName: 'General Science', communicationComponentCode: null }
  ];

  const result = await callListSectionTeachers();

  assert.equal(result.error, null);
  assert.equal(result.body.section.adviserUserId, 10);
  assert.deepEqual(result.body.teachers.map(item => [item.communicationComponentCode, item.communicationComponentName]), [
    ['english', 'Effective Communication'], ['filipino', 'Mabisang Komunikasyon'], [null, null]
  ]);
  assert.deepEqual(result.body.teachers.map(item => [item.teacherName, item.teacherEmail, item.subjectName]), [
    ['Maya Santos', 'maya@example.test', 'Effective Communication / Mabisang Komunikasyon'],
    ['Carlo Reyes', 'carlo@example.test', 'Effective Communication / Mabisang Komunikasyon'],
    ['Ana Cruz', 'ana@example.test', 'General Science']
  ]);
});

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
  sectionRows = [{ ...section(21, 'QA-only'), gradeCode: 'grade-11', gradeLevelName: 'Grade 11',
    schoolLevelCode: 'shs', trackCode: 'academic', shsCurriculumCode: 'strengthened_2026' }];
  const result = await callList({ scope: '' });

  assert.equal(result.error, null);
  assert.equal(result.body.sections.length, 1);
  assert.equal(result.body.sections[0].shsCurriculumCode, 'strengthened_2026');
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
