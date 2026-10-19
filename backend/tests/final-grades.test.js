const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
const savedGrades = [];
const pendingGrades = [];
const savedNotices = new Set();
const pendingNotices = new Set();
const publishedItems = new Set();
const pendingPublishedItems = new Set();
let assigned = true;
let failOnInsertNumber = 0;
let failOnAuditWrite = false;
let failOnNotificationWrite = false;
let failOnMarkerWrite = false;
let context = {};
let configuredTermCount = 3;
let categories = [];
let subjectProfile = null;
let subjectComponents = [];
let subjectExamParts = [];
let students = [];
let items = [];
let scores = [];
let previousScores = [];
let previousPublished = [];
let committed = false;
let rolledBack = false;
let parentTriggerEnabled = false;
let gradesEnabled = true;
let finalGradeRule = null;
let publishedK10Grades = 0;
let publishedSubjectGrades = 0;

const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('SELECT grades_enabled AS gradesEnabled FROM school_portal_features')) return [[{ gradesEnabled: gradesEnabled ? 1 : 0 }]];
    if (sql.includes('SELECT academic_terms.status AS academicTermStatus')) return [[{
      academicTermStatus: 'active', academicYearStatus: 'active',
      gradeCode: context.gradeCode, academicYearLabel: context.academicYearLabel
    }]];
    if (sql.includes('FROM parent_notification_triggers')) return [parentTriggerEnabled ? [{ enabled: 1 }] : []];
    if (sql.startsWith('SELECT id FROM academic_terms WHERE id = ?')) return [[{ id: context.academicTermId }]];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM academic_terms')) return [[{ total: configuredTermCount }]];
    if (sql.includes('SELECT COUNT(*) AS termCount FROM academic_terms')) return [[{ termCount: configuredTermCount }]];
    if (sql.includes('FROM school_year_final_grade_rules')) return [finalGradeRule ? [{ ...finalGradeRule }] : []];
    if (sql.includes('FROM published_final_grades AS grades') && sql.includes('AS gradeCount')) return [[{ gradeCount: publishedK10Grades }]];
    if (sql.includes('FROM published_final_grades') && sql.includes('academic_years.start_date DESC')) {
      return [savedGrades.map((record, index) => ({
        id: index + 1,
        schoolId: record[0],
        studentId: record[4],
        studentName: students.find(student => student.studentId === record[4])?.studentName || 'Student',
        sectionId: record[1],
        sectionName: context.sectionName,
        subjectId: record[2],
        subjectName: context.subjectName,
        academicTermId: record[3],
        academicTermName: context.academicTermName,
        academicYearId: context.academicYearId,
        academicYearLabel: context.academicYearLabel,
        finalGrade: record[5],
        publishedAt: '2026-10-18 12:00:00'
      }))];
    }
    if (sql.includes('FROM subject_grading_profiles AS profiles')) return [subjectProfile ? [{
      id: subjectProfile.id,
      configurationSource: subjectProfile.configurationSource || 'custom',
      publishedGradeCount: publishedSubjectGrades
    }] : []];
    if (sql.includes('SELECT id, code, name, component_type AS componentType, weight')) return [subjectComponents];
    if (sql.includes('SELECT id, component_id AS componentId, code, name, weight')) return [subjectExamParts];
    if (sql.includes('SELECT passing_grade_threshold AS threshold FROM school_levels')) return [[{ threshold: 75 }]];
    if (sql.includes('INSERT INTO notifications')) {
      if (/ON DUPLICATE KEY UPDATE id = id/.test(sql)) throw new Error("Column 'id' in field list is ambiguous");
      if (failOnNotificationWrite) throw new Error('Simulated notification failure.');
      pendingNotices.add(`${values.at(-1)}:${values[4]}`);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT sections.id AS sectionId') && sql.includes('FROM section_teachers')) {
      return [[assigned && Number(values.at(-1)) === Number(context.schoolId) ? context : undefined].filter(Boolean)];
    }
    if (sql.includes('FROM section_teachers')) return [[assigned ? context : undefined].filter(Boolean)];
    if (sql.includes('FROM section_students AS current_enrollment')) return [previousScores];
    if (sql.includes('FROM published_final_grades') && sql.includes('source_section.name')) return [previousPublished];
    if (sql.includes('FROM grading_categories')) return [categories];
    if (sql.includes('FROM section_students')) return [students];
    if (sql.includes('FROM grading_items')) return [items];
    if (sql.includes('FROM student_scores')) return [scores];
    if (sql.includes('INSERT INTO published_final_grades')) {
      pendingGrades.push(values);
      if (failOnInsertNumber && pendingGrades.length === failOnInsertNumber) throw new Error('Simulated database write failure.');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE grading_items SET used_in_published_grades')) {
      if (failOnMarkerWrite) throw new Error('Simulated marker write failure.');
      values.slice(5).forEach(id => pendingPublishedItems.add(id));
      return [{ affectedRows: values.length - 5 }];
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      if (failOnAuditWrite) throw new Error('Simulated activity log failure.');
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      beginTransaction: async () => {},
      commit: async () => {
        committed = true;
        savedGrades.push(...pendingGrades);
        pendingNotices.forEach(key => savedNotices.add(key));
        pendingPublishedItems.forEach(id => publishedItems.add(id));
        pendingGrades.length = 0;
        pendingNotices.clear();
        pendingPublishedItems.clear();
      },
      rollback: async () => { rolledBack = true; pendingGrades.length = 0; pendingNotices.clear(); pendingPublishedItems.clear(); },
      release: () => {}
    };
  }
};

databaseModule.getDatabase = () => database;
const grades = require('../controllers/gradesController');

function reset() {
  queries.length = 0;
  savedGrades.length = 0;
  pendingGrades.length = 0;
  savedNotices.clear();
  pendingNotices.clear();
  publishedItems.clear();
  pendingPublishedItems.clear();
  assigned = true;
  failOnInsertNumber = 0;
  failOnAuditWrite = false;
  failOnNotificationWrite = false;
  failOnMarkerWrite = false;
  configuredTermCount = 3;
  committed = false;
  rolledBack = false;
  parentTriggerEnabled = false;
  gradesEnabled = true;
  finalGradeRule = null;
  publishedK10Grades = 0;
  publishedSubjectGrades = 0;
  previousScores = [];
  previousPublished = [];
  context = {
    sectionId: 8, schoolId: 1, schoolLevelId: 2, academicYearId: 4,
    sectionName: 'St. Matthew', subjectId: 2, subjectName: 'English',
    academicTermId: 14, academicTermName: 'Quarter 2', termStatus: 'active',
    schoolLevelCode: 'jhs', shsGradingGroup: null,
    academicYearLabel: '2025-2026', gradingPeriodType: 'quarterly', gradeCode: 'grade-8',
    gradeRounding: 'round', passingGradeThreshold: '75.00'
  };
  subjectProfile = null;
  subjectComponents = [];
  subjectExamParts = [];
  categories = [
    { id: 1, code: 'ww', name: 'Written Work', weight: '30.00' },
    { id: 2, code: 'pt', name: 'Performance Task', weight: '50.00' },
    { id: 3, code: 'qa', name: 'Quarterly Assessment', weight: '20.00' }
  ];
  students = [
    { studentId: 101, studentName: 'Ava Cruz' },
    { studentId: 102, studentName: 'Ben Reyes' }
  ];
  items = [
    { gradingItemId: 11, title: 'Quiz', gradingCategoryId: 1, maxScore: '20.00', categorySchoolId: 1, categorySchoolLevelId: 2 },
    { gradingItemId: 12, title: 'Project', gradingCategoryId: 2, maxScore: '20.00', categorySchoolId: 1, categorySchoolLevelId: 2 },
    { gradingItemId: 13, title: 'Quarterly Test', gradingCategoryId: 3, maxScore: '10.00', categorySchoolId: 1, categorySchoolLevelId: 2 }
  ];
  scores = [
    { studentId: 101, gradingItemId: 11, score: '18.00' },
    { studentId: 101, gradingItemId: 12, score: '16.00' },
    { studentId: 101, gradingItemId: 13, score: '7.00' },
    { studentId: 102, gradingItemId: 11, score: '15.00' },
    { studentId: 102, gradingItemId: 12, score: '10.00' },
    { studentId: 102, gradingItemId: 13, score: '8.00' }
  ];
}

async function call(handler, { role = 'teacher', schoolId = 1, query = {}, body = {} } = {}) {
  const result = { status: 200, data: null, error: null };
  await handler({ user: { id: 5, schoolId, role }, query, body }, {
    status(code) { result.status = code; return this; },
    set() { return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

const scope = { sectionId: '8', subjectId: '2', academicTermId: '14' };

function configureEarlyGradeProfile(gradeCode = 'grade-2') {
  context.schoolLevelCode = 'elementary';
  context.gradeCode = gradeCode;
  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'trimestral';
  subjectProfile = { id: 40, configurationSource: 'custom' };
  subjectComponents = [
    { id: 101, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: '20.00' },
    { id: 102, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: '50.00' },
    { id: 103, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: '30.00' }
  ];
  subjectExamParts = [
    { id: 201, componentId: 103, code: 'summative-test-1', name: 'Summative Test 1', weight: '50.00' },
    { id: 202, componentId: 103, code: 'summative-test-2', name: 'Summative Test 2', weight: '50.00' }
  ];
  students = [
    { studentId: 101, studentName: 'Ava Cruz' },
    { studentId: 102, studentName: 'Ben Reyes' }
  ];
  items = [
    { gradingItemId: 11, title: 'Written work', subjectGradingComponentId: 101, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 12, title: 'Performance task', subjectGradingComponentId: 102, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 13, title: 'Summative Test 1', subjectGradingComponentId: 103, subjectGradingExamPartId: 201, maxScore: '10.00', componentSchoolId: 1 },
    { gradingItemId: 14, title: 'Summative Test 2', subjectGradingComponentId: 103, subjectGradingExamPartId: 202, maxScore: '10.00', componentSchoolId: 1 }
  ];
  scores = [
    { studentId: 101, gradingItemId: 11, score: '18.00' }, { studentId: 101, gradingItemId: 12, score: '16.00' },
    { studentId: 101, gradingItemId: 13, score: '7.00' }, { studentId: 101, gradingItemId: 14, score: '8.00' },
    { studentId: 102, gradingItemId: 11, score: '15.00' }, { studentId: 102, gradingItemId: 12, score: '10.00' },
    { studentId: 102, gradingItemId: 13, score: '6.00' }, { studentId: 102, gradingItemId: 14, score: '7.00' }
  ];
}

test('preview calculates weighted category percentages and applies school rounding', async () => {
  reset();
  const result = await call(grades.previewFinalGrades, { query: scope });

  assert.equal(result.error, null);
  assert.equal(result.data.preview.readyToPublish, true);
  assert.equal(result.data.preview.students[0].finalGrade, 81);
  assert.deepEqual(result.data.preview.students[0].categoryAverages.map(item => item.percentage), [90, 80, 70]);
  assert.equal(result.data.preview.students[0].isPassing, true);
  assert.equal(result.data.preview.students[1].finalGrade, 64);
  assert.equal(result.data.preview.students[1].isPassing, false);
});

test('Grades 4-10 preview weights exam parts, applies the 2026 transmutation, then uses direct grades from 2027-28', async () => {
  reset();
  context.schoolLevelCode = 'elementary';
  context.gradeCode = 'grade-4';
  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'trimestral';
  subjectProfile = { id: 40 };
  subjectComponents = [
    { id: 101, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: '20.00' },
    { id: 102, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: '50.00' },
    { id: 103, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: '30.00' }
  ];
  subjectExamParts = [
    { id: 201, componentId: 103, code: 'summative-test-1', name: 'Summative Test 1', weight: '30.00' },
    { id: 202, componentId: 103, code: 'summative-test-2', name: 'Summative Test 2', weight: '30.00' },
    { id: 203, componentId: 103, code: 'term-exam', name: 'Term Exam', weight: '40.00' }
  ];
  items = [
    { gradingItemId: 11, title: 'Written work', subjectGradingComponentId: 101, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 12, title: 'Performance task', subjectGradingComponentId: 102, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 13, title: 'Summative Test 1', subjectGradingComponentId: 103, subjectGradingExamPartId: 201, maxScore: '10.00', componentSchoolId: 1 },
    { gradingItemId: 14, title: 'Summative Test 2', subjectGradingComponentId: 103, subjectGradingExamPartId: 202, maxScore: '10.00', componentSchoolId: 1 },
    { gradingItemId: 15, title: 'Term Exam', subjectGradingComponentId: 103, subjectGradingExamPartId: 203, maxScore: '10.00', componentSchoolId: 1 }
  ];
  scores = [
    { studentId: 101, gradingItemId: 11, score: '18.00' },
    { studentId: 101, gradingItemId: 12, score: '16.00' },
    { studentId: 101, gradingItemId: 13, score: '7.00' },
    { studentId: 101, gradingItemId: 14, score: '8.00' },
    { studentId: 101, gradingItemId: 15, score: '9.00' },
    { studentId: 102, gradingItemId: 11, score: '15.00' },
    { studentId: 102, gradingItemId: 12, score: '10.00' },
    { studentId: 102, gradingItemId: 13, score: '6.00' },
    { studentId: 102, gradingItemId: 14, score: '7.00' },
    { studentId: 102, gradingItemId: 15, score: '8.00' }
  ];

  const preview2026 = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(preview2026.error, null);
  assert.equal(preview2026.data.preview.students[0].initialGrade, 82.3);
  assert.equal(preview2026.data.preview.students[0].finalGrade, 85);
  assert.equal(preview2026.data.preview.gradingMethod, 'deped_2026_transmutation');
  assert.equal(preview2026.data.preview.readyToPublish, true);

  context.academicYearLabel = '2027-2028';
  const preview2027 = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(preview2027.error, null);
  assert.equal(preview2027.data.preview.students[0].finalGrade, 82);
  assert.equal(preview2027.data.preview.gradingMethod, 'deped_zero_based');

  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'quarterly';
  const incompatibleDepedPreview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(incompatibleDepedPreview.data.preview.readyToPublish, false);
  assert.equal(incompatibleDepedPreview.data.preview.students[0].finalGrade, null);
  assert.equal(incompatibleDepedPreview.data.preview.issues.some(issue => issue.code === 'incompatible_period_structure'), true);
  assert.match(incompatibleDepedPreview.data.preview.periodStructureWarning, /three-term school year/);
  const blockedPublication = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(blockedPublication.error?.status, 409);
  assert.equal(savedGrades.length, 0);

  finalGradeRule = { gradingMode: 'school_specific', passingGradeThreshold: '83.00', gradeRounding: 'roundup' };
  const schoolSpecificPreview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(schoolSpecificPreview.error, null);
  assert.equal(schoolSpecificPreview.data.preview.gradingMethod, 'school_direct');
  assert.equal(schoolSpecificPreview.data.preview.periodStructureCompatible, true);
  assert.equal(schoolSpecificPreview.data.preview.students[0].initialGrade, 82.3);
  assert.equal(schoolSpecificPreview.data.preview.students[0].finalGrade, 83);
  assert.equal(schoolSpecificPreview.data.preview.students[0].isPassing, true);
  assert.equal(schoolSpecificPreview.data.preview.readyToPublish, true);
  const schoolSpecificPublication = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(schoolSpecificPublication.error, null);
  assert.deepEqual(
    schoolSpecificPublication.data.grades.map(student => student.finalGrade),
    schoolSpecificPreview.data.preview.students.map(student => student.finalGrade)
  );
  assert.deepEqual(savedGrades.map(values => values[5]), [83, 62]);

  for (const rule of ['round', 'truncate']) {
    finalGradeRule.gradeRounding = rule;
    const rounded = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(rounded.data.preview.students[0].finalGrade, 82);
    assert.equal(rounded.data.preview.students[0].isPassing, false);
  }
});

test('Grades 4-10 publication requires an item for each configured exam part', async () => {
  reset();
  context.schoolLevelCode = 'jhs';
  context.gradeCode = 'grade-8';
  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'trimestral';
  subjectProfile = { id: 40 };
  subjectComponents = [
    { id: 101, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: '20.00' },
    { id: 102, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: '50.00' },
    { id: 103, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: '30.00' }
  ];
  subjectExamParts = [
    { id: 201, componentId: 103, code: 'summative-test-1', name: 'Summative Test 1', weight: '30.00' },
    { id: 202, componentId: 103, code: 'summative-test-2', name: 'Summative Test 2', weight: '30.00' },
    { id: 203, componentId: 103, code: 'term-exam', name: 'Term Exam', weight: '40.00' }
  ];
  items = [
    { gradingItemId: 11, title: 'Written work', subjectGradingComponentId: 101, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 12, title: 'Performance task', subjectGradingComponentId: 102, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 13, title: 'Summative Test 1', subjectGradingComponentId: 103, subjectGradingExamPartId: 201, maxScore: '10.00', componentSchoolId: 1 },
    { gradingItemId: 14, title: 'Summative Test 2', subjectGradingComponentId: 103, subjectGradingExamPartId: 202, maxScore: '10.00', componentSchoolId: 1 }
  ];
  const result = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(result.error, null);
  assert.equal(result.data.preview.readyToPublish, false);
  assert.ok(result.data.preview.issues.some(issue => issue.code === 'exam_part_without_items' && issue.categoryCode === 'term-exam'));
});

test('Configured Grades 2–3 setups use the 2026 adjusted transmutation method', async () => {
  for (const gradeCode of ['grade-2', 'grade-3']) {
    reset();
    context.schoolLevelCode = 'elementary';
    context.gradeCode = gradeCode;
    context.academicYearLabel = '2026-2027';
    context.gradingPeriodType = 'trimestral';
    finalGradeRule = null;
    subjectProfile = { id: 40 };
    subjectComponents = [
      { id: 101, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: '20.00' },
      { id: 102, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: '50.00' },
      { id: 103, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: '30.00' }
    ];
    subjectExamParts = [
      { id: 201, componentId: 103, code: 'summative-test-1', name: 'Summative Test 1', weight: '50.00' },
      { id: 202, componentId: 103, code: 'summative-test-2', name: 'Summative Test 2', weight: '50.00' }
    ];
    students = [
      { studentId: 101, studentName: 'Ava Cruz' },
      { studentId: 102, studentName: 'Ben Reyes' },
      { studentId: 103, studentName: 'Cleo Santos' },
      { studentId: 104, studentName: 'Dani Ramos' }
    ];
    items = [
      { gradingItemId: 11, title: 'Written work', subjectGradingComponentId: 101, maxScore: '20.00', componentSchoolId: 1 },
      { gradingItemId: 12, title: 'Performance task', subjectGradingComponentId: 102, maxScore: '20.00', componentSchoolId: 1 },
      { gradingItemId: 13, title: 'Summative Test 1', subjectGradingComponentId: 103, subjectGradingExamPartId: 201, maxScore: '10.00', componentSchoolId: 1 },
      { gradingItemId: 14, title: 'Summative Test 2', subjectGradingComponentId: 103, subjectGradingExamPartId: 202, maxScore: '10.00', componentSchoolId: 1 }
    ];
    scores = [
      { studentId: 101, gradingItemId: 11, score: '18' }, { studentId: 101, gradingItemId: 12, score: '16' },
      { studentId: 101, gradingItemId: 13, score: '7' }, { studentId: 101, gradingItemId: 14, score: '8' },
      { studentId: 102, gradingItemId: 11, score: '14' }, { studentId: 102, gradingItemId: 12, score: '14' },
      { studentId: 102, gradingItemId: 13, score: '7' }, { studentId: 102, gradingItemId: 14, score: '7' },
      { studentId: 103, gradingItemId: 11, score: '12' }, { studentId: 103, gradingItemId: 12, score: '12' },
      { studentId: 103, gradingItemId: 13, score: '6' }, { studentId: 103, gradingItemId: 14, score: '6' },
      { studentId: 104, gradingItemId: 11, score: '0' }, { studentId: 104, gradingItemId: 12, score: '14' },
      { studentId: 104, gradingItemId: 13, score: '7' }, { studentId: 104, gradingItemId: 14, score: '7' }
    ];

    const result = await call(grades.previewFinalGrades, { query: scope });
    const preview = result.data.preview;
    assert.equal(result.error, null, gradeCode);
    assert.equal(preview.readyToPublish, true, gradeCode);
    assert.equal(preview.gradingMethod, 'deped_2026_transmutation');
    assert.equal(preview.passingGradeThreshold, 75);
    assert.equal(preview.missingScoreCount, 0);
    assert.deepEqual(preview.categories.map(category => category.weight), [20, 50, 30]);
    assert.deepEqual(preview.categories[2].examParts.map(part => part.weight), [50, 50]);
    assert.equal(preview.students[0].initialGrade, 80.5);
    assert.equal(preview.students[0].finalGrade, 83);
    assert.equal(preview.students[1].initialGrade, 70);
    assert.equal(preview.students[1].finalGrade, 75);
    assert.equal(preview.students[1].isPassing, true);
    assert.equal(preview.students[2].initialGrade, 60);
    assert.equal(preview.students[2].finalGrade, 72);
    assert.equal(preview.students[2].isPassing, false);
    assert.equal(preview.students[3].finalGrade, 71);
    assert.equal(preview.readyToPublish, true, 'a recorded zero is a valid score');

    const publication = await call(grades.publishFinalGrades, { body: scope });
    assert.equal(publication.error, null, gradeCode);
    assert.deepEqual(publication.data.grades.map(grade => grade.finalGrade), preview.students.map(student => student.finalGrade));
    assert.deepEqual(savedGrades.map(record => record[5]), preview.students.map(student => student.finalGrade));
    const teacherGrades = await call(grades.listPublishedFinalGrades, { role: 'teacher', query: { sectionId: scope.sectionId } });
    const adminGrades = await call(grades.listPublishedFinalGrades, { role: 'school_admin', query: { sectionId: scope.sectionId } });
    assert.deepEqual(teacherGrades.data.finalGrades.map(grade => grade.finalGrade), preview.students.map(student => student.finalGrade));
    assert.deepEqual(adminGrades.data.finalGrades.map(grade => grade.finalGrade), preview.students.map(student => student.finalGrade));
  }
});

test('Grades 2–3 use saved school-specific final-grade rules and publish the exact preview', async () => {
  for (const gradeCode of ['grade-2', 'grade-3']) {
    reset();
    configureEarlyGradeProfile(gradeCode);
    context.gradingPeriodType = 'quarterly';
    configuredTermCount = 2;
    finalGradeRule = { gradingMode: 'school_specific', passingGradeThreshold: 80, gradeRounding: 'roundup' };

    const result = await call(grades.previewFinalGrades, { query: scope });
    const preview = result.data.preview;
    assert.equal(result.error, null, gradeCode);
    assert.equal(preview.gradingMethod, 'school_direct', gradeCode);
    assert.equal(preview.passingGradeThreshold, 80, gradeCode);
    assert.equal(preview.gradeRounding, 'roundup', gradeCode);
    assert.equal(preview.periodStructureCompatible, true, gradeCode);
    assert.equal(preview.students[0].initialGrade, 80.5, gradeCode);
    assert.equal(preview.students[0].finalGrade, 81, gradeCode);
    assert.equal(preview.students[0].isPassing, true, gradeCode);
    assert.equal(preview.students[1].initialGrade, 59.5, gradeCode);
    assert.equal(preview.students[1].finalGrade, 60, gradeCode);
    assert.equal(preview.students[1].isPassing, false, gradeCode);

    const publication = await call(grades.publishFinalGrades, { body: scope });
    assert.equal(publication.error, null, gradeCode);
    assert.deepEqual(publication.data.grades.map(grade => grade.finalGrade), preview.students.map(student => student.finalGrade));
    assert.deepEqual(savedGrades.map(record => record[5]), preview.students.map(student => student.finalGrade));
  }
});

test('Grade 2–3 require only configured exam parts, and can add a term exam profile before scores', async () => {
  reset();
  context.schoolLevelCode = 'elementary';
  context.gradeCode = 'grade-3';
  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'trimestral';
  subjectProfile = { id: 40 };
  subjectComponents = [
    { id: 101, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: '20.00' },
    { id: 102, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: '50.00' },
    { id: 103, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: '30.00' }
  ];
  subjectExamParts = [
    { id: 201, componentId: 103, code: 'summative-test-1', name: 'Summative Test 1', weight: '30.00' },
    { id: 202, componentId: 103, code: 'summative-test-2', name: 'Summative Test 2', weight: '30.00' },
    { id: 203, componentId: 103, code: 'term-exam', name: 'Term Exam', weight: '40.00' }
  ];
  items = [
    { gradingItemId: 11, title: 'Written work', subjectGradingComponentId: 101, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 12, title: 'Performance task', subjectGradingComponentId: 102, maxScore: '20.00', componentSchoolId: 1 },
    { gradingItemId: 13, title: 'Summative Test 1', subjectGradingComponentId: 103, subjectGradingExamPartId: 201, maxScore: '10.00', componentSchoolId: 1 },
    { gradingItemId: 14, title: 'Summative Test 2', subjectGradingComponentId: 103, subjectGradingExamPartId: 202, maxScore: '10.00', componentSchoolId: 1 }
  ];
  let result = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(result.data.preview.readyToPublish, false);
  assert.ok(result.data.preview.issues.some(issue => issue.code === 'exam_part_without_items' && issue.categoryCode === 'term-exam'));

  items.push({ gradingItemId: 15, title: 'Term Exam', subjectGradingComponentId: 103, subjectGradingExamPartId: 203, maxScore: '10.00', componentSchoolId: 1 });
  scores.push(
    { studentId: 101, gradingItemId: 14, score: '8' },
    { studentId: 102, gradingItemId: 14, score: '7' },
    { studentId: 101, gradingItemId: 15, score: '8' },
    { studentId: 102, gradingItemId: 15, score: '7' }
  );
  result = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(result.data.preview.readyToPublish, true, JSON.stringify({
    issues: result.data.preview.issues,
    missing: result.data.preview.students.map(student => ({ name: student.studentName, missing: student.missingItems, invalid: student.invalidScores }))
  }));
  assert.equal(result.data.preview.categories[2].examParts.length, 3);
});

test('legacy Grades 2–3 DepEd-default splits block new publication until reviewed', async () => {
  for (const gradeCode of ['grade-2', 'grade-3']) {
    reset();
    configureEarlyGradeProfile(gradeCode);
    subjectProfile.configurationSource = 'deped_default';
    const originalScores = scores.map(score => ({ ...score }));

    const preview = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(preview.error, null, gradeCode);
    assert.equal(preview.data.preview.readyToPublish, false, gradeCode);
    assert.ok(preview.data.preview.issues.some(issue => issue.code === 'early_grade_exam_setup_review_required'), gradeCode);

    const publication = await call(grades.publishFinalGrades, { body: scope });
    assert.equal(publication.error?.status, 409, gradeCode);
    assert.equal(savedGrades.length, 0, gradeCode);
    assert.deepEqual(scores, originalScores, 'blocking publication does not alter recorded scores');

    subjectProfile.configurationSource = 'custom';
    const confirmedPreview = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(confirmedPreview.data.preview.readyToPublish, true, gradeCode);
    assert.equal(confirmedPreview.data.preview.issues.some(issue => issue.code === 'early_grade_exam_setup_review_required'), false, gradeCode);
  }

  reset();
  configureEarlyGradeProfile('grade-2');
  subjectComponents = subjectComponents.filter(component => component.componentType !== 'examination');
  const missingExamParts = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(missingExamParts.data.preview.readyToPublish, false);
  assert.ok(missingExamParts.data.preview.issues.some(issue => issue.code === 'early_grade_exam_setup_required'));

  reset();
  configureEarlyGradeProfile('grade-2');
  subjectProfile.configurationSource = 'deped_default';
  publishedSubjectGrades = 1;
  const alreadyPublished = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(alreadyPublished.error, null);
  assert.equal(alreadyPublished.data.preview.issues.some(issue => issue.code === 'early_grade_exam_setup_review_required'), false);
});

test('The DepEd method requires three terms when no school-specific rule is selected', async () => {
  reset();
  context.schoolLevelCode = 'elementary';
  context.gradeCode = 'grade-2';
  context.academicYearLabel = '2026-2027';
  context.gradingPeriodType = 'trimestral';
  configuredTermCount = 2;
  finalGradeRule = null;

  const result = await call(grades.previewFinalGrades, { query: scope });
  const preview = result.data.preview;

  assert.equal(preview.gradingMethod, 'deped_2026_transmutation');
  assert.equal(preview.passingGradeThreshold, 75);
  assert.equal(preview.periodStructureCompatible, false);
  assert.ok(preview.issues.some(issue => issue.code === 'incompatible_period_structure'));
  assert.equal(preview.readyToPublish, false);
});

test('Kindergarten, Grade 1, and out-of-scope future Grade 2–3 terms cannot publish numerical grades', async () => {
  for (const [gradeCode, year] of [['kindergarten', '2026-2027'], ['grade-1', '2026-2027'], ['grade-2', '2027-2028'], ['grade-3', '2027-2028']]) {
    reset();
    context.schoolLevelCode = 'elementary';
    context.gradeCode = gradeCode;
    context.academicYearLabel = year;
    const preview = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(preview.error?.status, 409, `${gradeCode} ${year}`);
    assert.match(preview.error.message, /descriptive reporting|not available/);
    const publication = await call(grades.publishFinalGrades, { body: scope });
    assert.equal(publication.error?.status, 409, `${gradeCode} ${year}`);
    assert.equal(savedGrades.length, 0);
  }
});

test('descriptive grades and out-of-scope Grade 2–3 years cannot record numerical scores', async () => {
  const user = { role: 'school_admin', schoolId: 1 };
  const scopeForWrite = { sectionId: 8, subjectId: 2, academicTermId: 14 };

  reset();
  context.gradeCode = 'grade-2';
  context.academicYearLabel = '2026-2027';
  await assert.doesNotReject(grades.assertGradeWriteAccess(database, user, scopeForWrite));

  for (const [gradeCode, academicYearLabel] of [
    ['kindergarten', '2026-2027'], ['grade-1', '2026-2027'],
    ['grade-2', '2027-2028'], ['grade-3', '2027-2028']
  ]) {
    reset();
    context.gradeCode = gradeCode;
    context.academicYearLabel = academicYearLabel;
    await assert.rejects(grades.assertGradeWriteAccess(database, user, scopeForWrite), { status: 409 });
  }
});

test('Grade 2 publication rechecks changed scores, requires transfer review, and supports republishing', async () => {
  reset();
  configureEarlyGradeProfile();
  const beforeChange = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(beforeChange.data.preview.students[0].finalGrade, 83);

  scores.find(record => record.studentId === 101 && record.gradingItemId === 11).score = '0.00';
  previousScores = [{ studentId: 101, sourceSectionName: 'St. Anne', itemTitle: 'Quiz', score: '17.00', maxScore: '20.00' }];
  const freshPreview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(freshPreview.error, null);
  assert.equal(freshPreview.data.preview.students[0].finalGrade, 73);
  assert.deepEqual(freshPreview.data.preview.transferReviewStudentIds, [101]);

  const blocked = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(blocked.error?.status, 409);
  assert.equal(savedGrades.length, 0);

  const published = await call(grades.publishFinalGrades, { body: { ...scope, transferReviewAcknowledged: true } });
  assert.equal(published.error, null);
  assert.deepEqual(published.data.grades.map(grade => grade.finalGrade), freshPreview.data.preview.students.map(student => student.finalGrade));
  assert.equal(savedGrades[0][5], freshPreview.data.preview.students[0].finalGrade);

  const republished = await call(grades.publishFinalGrades, { body: { ...scope, transferReviewAcknowledged: true } });
  assert.equal(republished.error, null);
  assert.equal(savedGrades.length, 4);
});

test('Grade 2 publication rejects cross-school access and rolls back a partial write failure', async () => {
  reset();
  configureEarlyGradeProfile();
  const crossSchoolPreview = await call(grades.previewFinalGrades, { schoolId: 99, query: scope });
  assert.equal(crossSchoolPreview.error?.status, 404);
  const crossSchoolPublish = await call(grades.publishFinalGrades, { schoolId: 99, body: scope });
  assert.equal(crossSchoolPublish.error?.status, 404);
  assert.equal(savedGrades.length, 0);

  reset();
  configureEarlyGradeProfile();
  failOnInsertNumber = 2;
  const failed = await call(grades.publishFinalGrades, { body: scope });
  assert.match(failed.error?.message || '', /Simulated database write failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
});

test('Grade 2 cannot preview without assignment or publish in a closed term', async () => {
  reset();
  configureEarlyGradeProfile();
  assigned = false;
  const unassigned = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(unassigned.error?.status, 404);

  reset();
  configureEarlyGradeProfile();
  context.termStatus = 'closed';
  const closedTerm = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(closedTerm.error?.status, 409);
  assert.equal(savedGrades.length, 0);
  assert.equal(rolledBack, true);
});

test('legacy SHS subject groups apply their curriculum weights during grade calculation', async () => {
  const expected = {
    core: [25, 50, 25],
    academic_other: [25, 45, 30],
    academic_immersion: [35, 40, 25],
    other_other: [20, 60, 20],
    other_immersion: [20, 60, 20]
  };
  for (const [group, weights] of Object.entries(expected)) {
    reset();
    context.schoolLevelCode = 'shs';
    context.shsGradingGroup = group;
    const result = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(result.error, null);
    assert.deepEqual(result.data.preview.categories.map(category => category.weight), weights);
    assert.deepEqual(result.data.preview.students[0].categoryAverages.map(category => category.weight), weights);
  }
});

test('legacy SHS previews show the weighted initial score and publish its transmuted quarterly grade', async () => {
  reset();
  context.schoolLevelCode = 'shs';
  context.shsGradingGroup = 'core';
  context.gradeRounding = 'truncate';
  const result = await call(grades.previewFinalGrades, { query: scope });
  const preview = result.data.preview;
  assert.equal(preview.gradingScale, 'legacy_shs_transmutation');
  assert.equal(preview.students[0].initialGrade, 80);
  assert.equal(preview.students[0].finalGrade, 87);
  assert.equal(preview.students[0].isPassing, true);
});

test('unclassified legacy SHS subjects cannot calculate or publish grades', async () => {
  reset();
  context.schoolLevelCode = 'shs';
  context.shsGradingGroup = null;
  const preview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(preview.error, null);
  assert.equal(preview.data.preview.readyToPublish, false);
  assert.ok(preview.data.preview.issues.some(issue => issue.code === 'unclassified_shs_subject'));
  assert.equal(preview.data.preview.students[0].finalGrade, null);

  const publish = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(publish.error?.status, 409);
  assert.equal(savedGrades.length, 0);
});

test('unclassified Academic and TVL sections cannot publish SHS grades', async () => {
  reset();
  context.schoolLevelCode = 'shs';
  context.shsGradingGroup = 'core';
  context.trackCode = 'academic';
  context.strandId = null;
  const preview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(preview.data.preview.readyToPublish, false);
  assert.ok(preview.data.preview.issues.some(issue => issue.code === 'unclassified_shs_section'));
  assert.equal(preview.data.preview.students[0].finalGrade, null);
});

test('transferred scores require review acknowledgment before publication', async () => {
  reset();
  previousScores = [{ studentId: 101, sourceSectionName: 'St. Anne', itemTitle: 'Quiz', score: '17.00', maxScore: '20.00' }];
  const preview = await call(grades.previewFinalGrades, { query: scope });
  assert.deepEqual(preview.data.preview.transferReviewStudentIds, [101]);
  const rejected = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(rejected.error?.status, 409);
  assert.equal(committed, false);
  const accepted = await call(grades.publishFinalGrades, { body: { ...scope, transferReviewAcknowledged: true } });
  assert.equal(accepted.error, null);
  assert.equal(accepted.data.publishedCount, 2);
});

test('teacher-scoped previous work endpoint returns scores and prior published grades', async () => {
  reset();
  previousScores = [{ studentId: 101, sourceSectionName: 'St. Anne', itemTitle: 'Quiz', score: '17.00', maxScore: '20.00' }];
  previousPublished = [{ studentId: 102, sourceSectionName: 'St. Mark', finalGrade: '84.00' }];
  const result = await call(grades.getTransferReview, { query: scope });
  assert.equal(result.error, null);
  assert.equal(result.data.scores[0].score, 17);
  assert.equal(result.data.publishedGrades[0].finalGrade, 84);
  assigned = false;
  const unauthorized = await call(grades.getTransferReview, { query: scope });
  assert.equal(unauthorized.error?.status, 403);
});

test('previously published source grades remain official and are excluded from destination publication', async () => {
  reset();
  previousPublished = [{ studentId: 101, sourceSectionName: 'St. Anne', finalGrade: '87.00' }];
  const preview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(preview.data.preview.retainedPublishedCount, 1);
  assert.equal(preview.data.preview.students[0].finalGrade, 87);
  assert.equal(preview.data.preview.students[0].retainedPublishedGrade, true);
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(result.error, null);
  assert.equal(result.data.publishedCount, 1);
  assert.equal(result.data.retainedPublishedCount, 1);
  assert.equal(savedGrades.length, 1);
  assert.equal(savedGrades[0][4], 102);
});

test('preview follows round, roundup, and truncate settings', async () => {
  reset();
  students = [students[0]];
  items.forEach(item => { item.maxScore = '100.00'; });
  scores = items.map(item => ({ studentId: 101, gradingItemId: item.gradingItemId, score: '80.20' }));

  for (const [rule, expected] of [['round', 80], ['roundup', 81], ['truncate', 80]]) {
    context.gradeRounding = rule;
    const result = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(result.data.preview.students[0].finalGrade, expected);
  }
});

test('blank and absent score records block publication, but an explicit zero is valid', async () => {
  reset();
  scores = scores.filter(record => !(record.studentId === 102 && record.gradingItemId === 13));
  const preview = await call(grades.previewFinalGrades, { query: scope });

  assert.equal(preview.data.preview.readyToPublish, false);
  assert.equal(preview.data.preview.missingScoreCount, 1);
  assert.deepEqual(preview.data.preview.students[1].missingItems, [{ gradingItemId: 13, title: 'Quarterly Test' }]);
  assert.equal(preview.data.preview.students[1].finalGrade, null);

  const publish = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(publish.error?.status, 409);
  assert.equal(savedGrades.length, 0);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);

  reset();
  scores.find(record => record.studentId === 102 && record.gradingItemId === 13).score = '0.00';
  const zeroScorePreview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(zeroScorePreview.data.preview.readyToPublish, true);
  assert.equal(zeroScorePreview.data.preview.missingScoreCount, 0);
});

test('publish saves all student grades atomically using the authenticated teacher identity', async () => {
  reset();
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.equal(result.error, null);
  assert.equal(result.data.published, true);
  assert.equal(result.data.publishedCount, 2);
  assert.equal(savedGrades.length, 2);
  assert.ok(savedGrades.every(values => values[0] === 1 && values[1] === 8 && values[2] === 2 && values[3] === 14 && values[6] === 5));
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  const studentNotices = queries.filter(query => query.sql.includes('INSERT INTO notifications') && query.sql.includes('SELECT students.id'));
  assert.equal(studentNotices.length, 2);
  assert.deepEqual(studentNotices.map(query => query.values.at(-1)), [101, 102]);
  assert.ok(studentNotices.every(query => query.values[3] === '/views/student/edugnay-student-grades.html' && query.values.at(-2) === 1));
  assert.equal(savedNotices.size, 2);
  assert.deepEqual([...publishedItems], [11, 12, 13]);
  assert.match(queries.find(query => query.sql.includes('INSERT INTO published_final_grades')).sql, /ON DUPLICATE KEY UPDATE/);
  const audit = queries.find(query => query.sql.includes('INSERT INTO audit_logs'));
  assert.ok(audit);
  assert.equal(audit.values[2], 'final_grades_published');
});

test('publication notifies linked parents only for a below-passing final grade', async () => {
  reset();
  parentTriggerEnabled = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(result.error, null);
  const notices = queries.filter(item => item.sql.includes('INSERT INTO notifications') && item.sql.includes('student_parent_links'));
  assert.equal(notices.length, 1);
  assert.equal(notices[0].values[0], 'grade');
  assert.equal(notices[0].values.at(-1), 102);
  assert.match(notices[0].sql, /ON DUPLICATE KEY UPDATE event_key = event_key/);
  assert.equal(savedNotices.size, 3);
  assert.equal(committed, true);
});

test('republishing the same subject and term keeps the parent alert deduplicated', async () => {
  reset();
  parentTriggerEnabled = true;
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal(savedNotices.size, 3);
  assert.equal(savedGrades.length, 4);
});

test('republishing marks a newly added component only after the new grades commit', async () => {
  reset();
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  items.push({ gradingItemId: 14, title: 'New quiz', gradingCategoryId: 1, maxScore: '10.00', categorySchoolId: 1, categorySchoolLevelId: 2 });
  scores.push({ studentId: 101, gradingItemId: 14, score: '9.00' });
  scores.push({ studentId: 102, gradingItemId: 14, score: '8.00' });
  assert.equal(publishedItems.has(14), false);
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal(publishedItems.has(14), true);
});

test('marker failure rolls back grade publication and component protection', async () => {
  reset();
  failOnMarkerWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.match(result.error?.message || '', /marker write failure/);
  assert.equal(savedGrades.length, 0);
  assert.equal(publishedItems.size, 0);
  assert.equal(rolledBack, true);
});

test('disabled Grades page suppresses student and parent grade notifications', async () => {
  reset();
  gradesEnabled = false;
  parentTriggerEnabled = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(result.error, null);
  assert.equal(savedGrades.length, 2);
  assert.equal(queries.some(query => query.sql.includes('INSERT INTO notifications')), false);
  assert.equal(savedNotices.size, 0);
});

test('a notification write failure rolls grade publication back', async () => {
  reset();
  parentTriggerEnabled = true;
  failOnNotificationWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.match(result.error?.message, /notification failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(savedNotices.size, 0);
});

test('unassigned teachers and closed terms cannot preview or publish grades', async () => {
  reset();
  assigned = false;
  const unassigned = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(unassigned.error?.status, 404);
  assert.equal(queries.filter(query => query.sql.includes('FROM grading_categories')).length, 0);

  reset();
  context.termStatus = 'closed';
  const closedTerm = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(closedTerm.error?.status, 409);
  assert.equal(savedGrades.length, 0);
  assert.equal(rolledBack, true);
});

test('only teachers can access the grade preview and publish handlers', async () => {
  reset();

  for (const role of ['student', 'parent', 'school_admin', 'platform_admin']) {
    const preview = await call(grades.previewFinalGrades, { role, query: scope });
    const publish = await call(grades.publishFinalGrades, { role, body: scope });
    assert.equal(preview.error?.status, 403);
    assert.equal(publish.error?.status, 403);
  }

  assert.equal(queries.length, 0);
  assert.equal(savedGrades.length, 0);
});

test('invalid score values and incomplete grading categories block publication', async () => {
  reset();
  scores[0].score = '21.00';
  const invalidScore = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(invalidScore.data.preview.readyToPublish, false);
  assert.equal(invalidScore.data.preview.invalidScoreCount, 1);
  assert.equal(invalidScore.data.preview.students[0].finalGrade, null);

  reset();
  items = items.filter(item => item.gradingCategoryId !== 3);
  const missingCategoryItems = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(missingCategoryItems.data.preview.readyToPublish, false);
  assert.ok(missingCategoryItems.data.preview.issues.some(issue => issue.code === 'category_without_items'));

  reset();
  categories[0].weight = '29.00';
  const invalidWeights = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(invalidWeights.data.preview.readyToPublish, false);
  assert.ok(invalidWeights.data.preview.issues.some(issue => issue.code === 'invalid_category_weights'));
});

test('a failed snapshot write rolls the entire publish operation back', async () => {
  reset();
  failOnInsertNumber = 2;
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.match(result.error?.message, /Simulated database write failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(pendingGrades.length, 0);
});

test('a failed activity log write also rolls back grade publication', async () => {
  reset();
  failOnAuditWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.match(result.error?.message, /activity log failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(pendingGrades.length, 0);
});

test('publishing rejects client-supplied school, publisher, or grade values', async () => {
  reset();
  const result = await call(grades.publishFinalGrades, {
    body: { ...scope, schoolId: 99, publishedByUserId: 99, grades: [{ studentId: 101, finalGrade: 100 }] }
  });

  assert.equal(result.error?.status, 400);
  assert.equal(queries.length, 0);
  assert.equal(savedGrades.length, 0);
});
