const test = require('node:test');
const assert = require('node:assert/strict');
const databaseConfig = require('../config/database');
const auditLog = require('../utils/auditLog');
const auditEntries = [];

const state = {
  years: new Map([
    ['1:9', { id: 9, label: '2025-2026', status: 'active' }],
    ['1:10', { id: 10, label: '2026-2027', status: 'active' }],
    ['1:11', { id: 11, label: '2027-2028', status: 'active' }],
    ['2:10', { id: 10, label: '2026-2027', status: 'active' }]
  ]),
  levels: new Map([[1, 3], [2, 30]]),
  rules: new Map(), published: new Set(), communication: new Set(), writes: 0, lockedYears: []
};
const key = (schoolId, yearId) => `${schoolId}:${yearId}`;
const ruleKey = (schoolId, yearId, levelId) => `${schoolId}:${yearId}:${levelId}`;
const db = {
  async execute(sql, values) {
    if (sql.includes('SELECT id, label, status FROM academic_years')) {
      if (sql.includes('FOR UPDATE')) state.lockedYears.push(key(values[0], values[1]));
      const year = state.years.get(key(values[0], values[1]));
      return [year ? [year] : []];
    }
    if (sql.includes("FROM school_levels WHERE school_id = ? AND level_code = 'shs'")) {
      const levelId = state.levels.get(values[0]);
      return [levelId ? [{ id: levelId }] : []];
    }
    if (sql.includes('FROM school_year_final_grade_rules')) {
      const rule = state.rules.get(ruleKey(...values));
      return [rule ? [rule] : []];
    }
    if (sql.includes('FROM published_final_grades p') && sql.includes('SELECT 1'))
      return [state.published.has(key(values[0], values[1])) ? [{ exists: 1 }] : []];
    if (sql.includes('FROM shs_communication_component_grades p') && sql.includes('SELECT 1'))
      return [state.communication.has(key(values[0], values[1])) ? [{ exists: 1 }] : []];
    if (sql.includes('INSERT INTO school_year_final_grade_rules')) {
      state.writes += 1;
      state.rules.set(ruleKey(values[0], values[1], values[2]), {
        gradingMode: values[3], passingGradeThreshold: values[4], gradeRounding: values[5]
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM shs_grading_profiles') || sql.includes('FROM subjects s')
      || sql.includes('FROM shs_offerings o') || sql.includes('SELECT DISTINCT p.subject_id')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return { execute: db.execute.bind(db), beginTransaction: async () => {}, commit: async () => {},
      rollback: async () => {}, release: () => {} };
  }
};
databaseConfig.getDatabase = () => db;
auditLog.writeAuditLog = async (...args) => { auditEntries.push(args); };
const settings = require('../controllers/shsGradingSettingsController');
const { loadShsPolicy } = require('../utils/shsGradingProfiles');
const { calculateTermGrade, calculateSubjectFinal } = require('../config/shsGrading');
const { subjectGradeStatus } = require('../config/shsCompletion');
const { averageCommunicationGrades } = require('../config/shsCommunication');
const { buildLearnerChecklist } = require('../controllers/shsCompletionController');

async function save(schoolId, body) {
  let data; let error;
  await settings.saveFinalGradeRules({ user: { schoolId, role: 'school_admin' }, body },
    { json: value => { data = value; } }, cause => { error = cause; });
  return { data, error };
}
async function list(schoolId, yearId) {
  let data; let error;
  await settings.list({ user: { schoolId, role: 'school_admin' }, query: { academicYearId: yearId } },
    { json: value => { data = value; } }, cause => { error = cause; });
  assert.equal(error, undefined);
  return data.finalGradeRules;
}

test('SHS rules default by school year and school-specific saves stay tenant and year scoped', async () => {
  assert.deepEqual(await list(1, 10), {
    gradingMode: 'deped_policy', gradingMethod: 'adjusted_2026', supported: true, passingGradeThreshold: 75,
    gradeRounding: 'round', source: 'deped_default', locked: false
  });
  assert.equal((await list(1, 11)).gradingMethod, 'zero_based');
  assert.equal((await list(1, 9)).supported, false);
  const saved = await save(1, { academicYearId: 10, gradingMode: 'school_specific',
    passingGradeThreshold: 80.25, gradeRounding: 'roundup' });
  assert.deepEqual(saved.data, { saved: true });
  assert.equal((await list(1, 10)).gradingMethod, 'school_direct');
  assert.equal((await list(1, 10)).passingGradeThreshold, 80.25);
  assert.equal((await list(1, 11)).passingGradeThreshold, 75);
  assert.equal((await list(2, 10)).passingGradeThreshold, 75);
  assert.deepEqual(state.lockedYears.at(-1), '1:10');
  assert.equal(auditEntries.at(-1)[2], 'shs_final_grade_rules_saved');
  const restored = await save(1, { academicYearId: 10, gradingMode: 'deped_policy',
    passingGradeThreshold: 12, gradeRounding: 'truncate' });
  assert.equal(restored.error, undefined);
  assert.equal((await list(1, 10)).gradingMethod, 'adjusted_2026');
  assert.deepEqual(state.rules.get('1:10:3'), {
    gradingMode: 'deped_policy', passingGradeThreshold: 75, gradeRounding: 'round'
  });
});

test('SHS save rejects invalid data and locked years without writing', async () => {
  const before = state.writes;
  for (const body of [
    { academicYearId: 10, gradingMode: 'unknown' },
    { academicYearId: 10, gradingMode: 'school_specific', passingGradeThreshold: 100.01, gradeRounding: 'round' },
    { academicYearId: 10, gradingMode: 'school_specific', passingGradeThreshold: 75.001, gradeRounding: 'round' },
    { academicYearId: 10, gradingMode: 'school_specific', passingGradeThreshold: 75, gradeRounding: 'other' }
  ]) assert.equal((await save(1, body)).error?.status, 400);
  assert.equal((await save(1, { academicYearId: 999, gradingMode: 'deped_policy' })).error?.status, 404);
  assert.equal((await save(1, { academicYearId: 9, gradingMode: 'deped_policy' })).error?.status, 409);
  state.years.get('1:11').status = 'archived';
  assert.equal((await save(1, { academicYearId: 11, gradingMode: 'deped_policy' })).error?.status, 409);
  state.years.get('1:11').status = 'active';
  state.published.add('1:10');
  assert.equal((await save(1, { academicYearId: 10, gradingMode: 'deped_policy' })).error?.status, 409);
  state.published.clear();
  state.communication.add('1:10');
  assert.equal((await save(1, { academicYearId: 10, gradingMode: 'deped_policy' })).error?.status, 409);
  state.communication.clear();
  assert.equal(state.writes, before);
});

test('saved SHS method drives term grades, final rounding, and passing status', async () => {
  const scope = { kind: 'core', schoolId: 1, yearId: 10, levelId: 3, subjectId: 5,
    group: 'core', yearLabel: '2026-2027', gradeCode: 'grade-11' };
  const items = [
    { id: 1, title: 'Written', componentCode: 'written', maxScore: 100 },
    { id: 2, title: 'Performance', componentCode: 'performance', maxScore: 100 },
    { id: 3, title: 'Summative 1', componentCode: 'examination', examPartCode: 'summative_test_1', maxScore: 100 },
    { id: 4, title: 'Summative 2', componentCode: 'examination', examPartCode: 'summative_test_2', maxScore: 100 },
    { id: 5, title: 'Term exam', componentCode: 'examination', examPartCode: 'term_exam', maxScore: 100 }
  ];
  const scores = new Map(items.map(item => [item.id, 70.01]));
  const deped = await loadShsPolicy(db, scope);
  assert.deepEqual(calculateTermGrade(deped, items, scores), { initialGrade: 70.01, termGrade: 75 });
  await save(1, { academicYearId: 10, gradingMode: 'school_specific',
    passingGradeThreshold: 71, gradeRounding: 'roundup' });
  const custom = await loadShsPolicy(db, scope);
  assert.equal(custom.method, 'school_direct');
  assert.equal(custom.passingGradeThreshold, 71);
  assert.deepEqual(calculateTermGrade(custom, items, scores), { initialGrade: 70.01, termGrade: 71 });
  assert.equal(calculateSubjectFinal([70, 71], 'roundup'), 71);
  assert.equal(calculateSubjectFinal([70, 71], 'truncate'), 70);
  assert.equal(averageCommunicationGrades(70, 71, 'truncate'), 70);
  const terms = [{ id: 1, name: 'Term 1' }, { id: 2, name: 'Term 2' }];
  const grades = [{ academicTermId: 1, finalGrade: 70 }, { academicTermId: 2, finalGrade: 71 }];
  assert.equal(subjectGradeStatus(terms, grades, custom).passed, true);
  assert.equal(subjectGradeStatus(terms, grades, { passingGradeThreshold: 72, gradeRounding: 'truncate' }).passed, false);
});

test('SHS completion evaluates Grade 11 and Grade 12 with each year’s own saved rule', async () => {
  await save(1, { academicYearId: 10, gradingMode: 'school_specific',
    passingGradeThreshold: 80, gradeRounding: 'truncate' });
  await save(1, { academicYearId: 11, gradingMode: 'school_specific',
    passingGradeThreshold: 75, gradeRounding: 'round' });
  const queries = [];
  const completionDb = { async execute(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('FROM school_year_final_grade_rules')) return db.execute(sql, values);
    if (sql.includes('FROM section_students ss')) return [[{
      sectionId: 7, academicYearId: 10, schoolLevelId: 3, gradeLevelId: 11,
      gradeCode: 'grade-11', trackCode: 'academic', sectionName: 'Grade 11 A', yearLabel: '2026-2027'
    }]];
    if (sql.includes('FROM academic_terms WHERE school_id')) return [values[1] === 10
      ? [{ id: 1, name: 'Term 1', sequenceNumber: 1 }, { id: 2, name: 'Term 2', sequenceNumber: 2 }]
      : [{ id: 3, name: 'Term 1', sequenceNumber: 1 }, { id: 4, name: 'Term 2', sequenceNumber: 2 }]];
    if (sql.includes('FROM section_teachers st')) return [[{
      subjectId: 5, subjectName: 'Communication', subjectCode: 'shs-core-communication', instructionalHours: 160
    }]];
    if (sql.includes('FROM published_final_grades p') && sql.includes('p.shs_elective_class_id = ?')) return [[
      { academicTermId: 3, finalGrade: 74 }, { academicTermId: 4, finalGrade: 75 }
    ]];
    if (sql.includes('FROM published_final_grades p') && sql.includes('p.section_id')) return [[
      { academicTermId: 1, finalGrade: 79 }, { academicTermId: 2, finalGrade: 80 }
    ]];
    if (sql.includes('FROM shs_selection_requests')) return [values[1] === 11
      ? [{ id: 20, pathwayCode: 'academic', status: 'approved' }] : []];
    if (sql.includes('FROM shs_selection_request_classes')) return [[{
      classId: 40, className: 'Creative Writing', startTermSequence: 1, endTermSequence: 2,
      catalogCode: 'AE039', catalogVersion: 1, subjectType: 'academic_elective',
      subjectName: 'Creative Writing', instructionalHours: 160, trackCode: 'academic', memberActive: 1
    }]];
    if (sql.includes('FROM scheduled_classes sc')) return [[]];
    if (sql.includes('FROM shs_verified_prior_electives')) return [[]];
    throw new Error(`Unexpected completion query: ${sql}`);
  } };
  const learner = { studentId: 99, academicYearId: 11, schoolLevelId: 3,
    gradeLevelId: 12, gradeCode: 'grade-12', yearLabel: '2027-2028',
    trackCode: 'academic', sectionId: 8, sectionName: 'Grade 12 A', studentName: 'Student' };
  const result = await buildLearnerChecklist(completionDb, 1,
    { id: 11, startDate: '2027-06-01', startYear: 2027 }, learner);
  assert.deepEqual(result.evidence.coreSubjects[0].gradeStatus,
    { complete: true, passed: false, finalGrade: 79, detail: 'Final grade 79 is below 80.' });
  assert.equal(result.evidence.grade12Request.classes[0].gradeStatus.finalGrade, 75);
  assert.equal(result.evidence.grade12Request.classes[0].gradeStatus.passed, true);
  assert.deepEqual(queries.filter(item => item.sql.includes('FROM school_year_final_grade_rules'))
    .map(item => item.values[1]), [10, 11]);
});
