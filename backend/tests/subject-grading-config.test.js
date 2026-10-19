const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const auditLogModule = require('../utils/auditLog');
const controllerPath = require.resolve('../controllers/subjectGradingController');

const SCHOOL_ID = 4;
const LEVEL_ID = 2;
const SUBJECTS = [
  { id: 21, subjectCode: 'english-elementary', name: 'English', gradeCodes: 'grade-4' },
  { id: 22, subjectCode: 'local-elective', name: 'Local elective', gradeCodes: 'grade-5' }
];
const EARLY_SUBJECTS = [
  { id: 23, subjectCode: 'english-grade-2', name: 'English', gradeCodes: 'grade-2' },
  { id: 24, subjectCode: 'science-grade-3', name: 'Science', gradeCodes: 'grade-3' }
];
const EXTRA_ENGLISH_GRADE3 = { id: 25, subjectCode: 'english-grade-3', name: 'English', gradeCodes: 'grade-3' };

function createDatabase({ published = false, publishedSubjectIds = [], linkedComponentIds = [], linkedExamPartIds = [], earlyGrades = false, includeEnglishGrade3 = false, academicYearLabel = '2026-2027', teacherGradeCode = 'grade-4' } = {}) {
  const profiles = new Map();
  const components = new Map();
  const examParts = new Map();
  const finalGradeRules = new Map();
  const statements = [];
  const linkedComponents = new Set(linkedComponentIds);
  const linkedParts = new Set(linkedExamPartIds);
  const publishedSubjects = new Set(publishedSubjectIds);
  const subjectRows = earlyGrades ? [...SUBJECTS, ...EARLY_SUBJECTS, ...(includeEnglishGrade3 ? [EXTRA_ENGLISH_GRADE3] : [])] : SUBJECTS;
  const counters = { nextProfileId: 100, nextComponentId: 200, nextPartId: 300, rollbacks: 0, commits: 0 };
  const key = (schoolId, yearId, levelId, subjectId) => `${schoolId}:${yearId}:${levelId}:${subjectId}`;

  async function execute(sql, rawParams = []) {
    const params = rawParams || [];
    const placeholderCount = (sql.match(/\?/g) || []).length;
    assert.equal(params.length, placeholderCount, `SQL bind count mismatch: ${sql}`);
    statements.push({ sql, params });

    if (sql.includes('SELECT sections.id AS sectionId') && sql.includes('FROM section_teachers')) {
      return [[{
        sectionId: 8, schoolId: SCHOOL_ID, academicYearId: 10, schoolLevelId: LEVEL_ID,
        gradeCode: teacherGradeCode, academicYearLabel, levelCode: 'elementary', gradingPeriodType: 'trimestral'
      }]];
    }
    if (sql.includes('SELECT academic_years.id AS academicYearId')) {
      if (Number(params[2]) !== SCHOOL_ID) return [[]];
      return [[{
        academicYearId: Number(params[1]), academicYearLabel, startDate: '2026-06-01',
        schoolLevelId: Number(params[0]), levelCode: 'elementary', gradingPeriodType: 'trimestral', academicYearStatus: 'active'
      }]];
    }
    if (sql.includes('SELECT COUNT(*) AS termCount')) return [[{ termCount: 3 }]];
    if (sql.includes('FROM school_year_final_grade_rules')) {
      const rule = finalGradeRules.get(`${params[0]}:${params[1]}:${params[2]}`);
      return [rule ? [{ ...rule }] : []];
    }
    if (sql.includes('GROUP_CONCAT(DISTINCT enabled_grades.grade_code')) {
      const allowedGradeCodes = new Set(params.slice(0, -2));
      return [subjectRows.filter(subject => String(subject.gradeCodes || '').split(',').some(code => allowedGradeCodes.has(code)))];
    }
    if (sql.includes('SELECT COUNT(*) AS gradeCount') && sql.includes('FROM published_final_grades')) {
      return [[{ gradeCount: published || publishedSubjects.has(Number(params[3])) ? 1 : 0 }]];
    }
    if (sql.includes('FROM subject_grading_profiles AS profiles')) {
      return [[...profiles.values()]
        .filter(profile => profile.schoolId === Number(params[0]) && ['custom', 'copied_custom'].includes(profile.configurationSource))
        .map(profile => ({ id: profile.id, schoolLevelId: profile.schoolLevelId, subjectId: profile.subjectId, configurationSource: profile.configurationSource }))];
    }
    if (sql.includes('SELECT id, school_id AS schoolId') && sql.includes('FROM subject_grading_profiles')) {
      const profile = profiles.get(key(...params.map(Number)));
      return [profile ? [{ ...profile }] : []];
    }
    if (sql.includes('SELECT id, school_level_id AS schoolLevelId FROM subjects')) {
      return [[{ id: Number(params[0]), schoolLevelId: LEVEL_ID }]];
    }
    if (sql.includes('SELECT id, subject_code AS subjectCode, school_level_id AS subjectSchoolLevelId')) {
      const subject = subjectRows.find(item => item.id === Number(params[0]));
      if (Number(params[1]) !== SCHOOL_ID || !subject) return [[]];
      return [[{ id: subject.id, subjectCode: subject.subjectCode, subjectSchoolLevelId: LEVEL_ID }]];
    }
    if (sql.includes('subjectName') && sql.includes('subjectSchoolLevelId') && sql.includes('FROM subjects')) {
      const subject = subjectRows.find(item => item.id === Number(params[0]));
      if (Number(params[1]) !== SCHOOL_ID || !subject) return [[]];
      return [[{ id: subject.id, subjectCode: subject.subjectCode, subjectName: subject.name, subjectSchoolLevelId: LEVEL_ID }]];
    }
    if (sql.includes('FROM subject_grade_scopes AS scopes')) {
      const gradeCode = { 21: 'grade-4', 22: 'grade-5', 23: 'grade-2', 24: 'grade-3', 25: 'grade-3' }[Number(params[1])];
      return [[{ id: 90, gradeCode }]];
    }
    if (sql.includes('SELECT id, code, name, component_type AS componentType, weight, sort_order AS sortOrder')) {
      return [[...(components.get(Number(params[1])) || []).map(item => ({ ...item }))]];
    }
    if (sql.includes('SELECT id, code FROM subject_grading_components')) {
      return [[...(components.get(Number(params[1])) || []).map(item => ({ id: item.id, code: item.code }))]];
    }
    if (sql.includes('SELECT id, code FROM subject_grading_exam_parts')) {
      return [[...(examParts.get(Number(params[1])) || []).map(item => ({ id: item.id, code: item.code }))]];
    }
    if (sql.includes('AS total') && sql.includes('FROM grading_items')) {
      const id = Number(params[1]);
      return [[{ total: sql.includes('subject_grading_exam_part_id')
        ? Number(linkedParts.has(id)) : Number(linkedComponents.has(id)) }]];
    }
    if (sql.includes('SELECT id, component_id AS componentId, code, name, weight, sort_order AS sortOrder')) {
      const ids = new Set(params.slice(1).map(Number));
      return [[...examParts.entries()].flatMap(([componentId, items]) => ids.has(componentId)
        ? items.map(item => ({ ...item, componentId })) : [])];
    }
    if (sql.startsWith('INSERT INTO subject_grading_profiles')) {
      const [schoolId, academicYearId, schoolLevelId, subjectId] = params.map(Number);
      const source = params.length === 6 ? params[4] : 'custom';
      const copiedFromProfileId = params.length === 6 && params[5] != null ? Number(params[5]) : null;
      const id = counters.nextProfileId++;
      const profile = { id, schoolId, academicYearId, schoolLevelId, subjectId, configurationSource: source, copiedFromProfileId };
      profiles.set(key(schoolId, academicYearId, schoolLevelId, subjectId), profile);
      components.set(id, []);
      return [{ insertId: id }];
    }
    if (sql.startsWith('INSERT INTO subject_grading_components')) {
      const [schoolId, profileId, code, name, componentType, weight, sortOrder] = params;
      const id = counters.nextComponentId++;
      components.get(Number(profileId)).push({ id, code, name, componentType, weight: Number(weight), sortOrder: Number(sortOrder), examParts: [] });
      examParts.set(id, []);
      return [{ insertId: id }];
    }
    if (sql.startsWith('INSERT INTO subject_grading_exam_parts')) {
      const [schoolId, componentId, code, name, weight, sortOrder] = params;
      const id = counters.nextPartId++;
      examParts.get(Number(componentId)).push({ id, code, name, weight: Number(weight), sortOrder: Number(sortOrder) });
      return [{ insertId: id }];
    }
    if (sql.startsWith('UPDATE subject_grading_components')) {
      const componentId = Number(params[5]);
      const profileId = Number(params[7]);
      const component = components.get(profileId)?.find(item => item.id === componentId);
      if (component) Object.assign(component, { code: params[0], name: params[1], componentType: params[2], weight: Number(params[3]), sortOrder: Number(params[4]) });
      return [{ affectedRows: component ? 1 : 0 }];
    }
    if (sql.startsWith('UPDATE subject_grading_exam_parts')) {
      const [, , , , partId, , componentId] = params;
      const part = examParts.get(Number(componentId))?.find(item => item.id === Number(partId));
      if (part) Object.assign(part, { code: params[0], name: params[1], weight: Number(params[2]), sortOrder: Number(params[3]) });
      return [{ affectedRows: part ? 1 : 0 }];
    }
    if (sql.startsWith('DELETE FROM subject_grading_components')) {
      const componentId = Number(params[0]);
      for (const [profileId, items] of components) components.set(profileId, items.filter(item => item.id !== componentId));
      examParts.delete(componentId);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('DELETE FROM subject_grading_exam_parts')) {
      const partId = Number(params[0]);
      for (const [componentId, items] of examParts) examParts.set(componentId, items.filter(item => item.id !== partId));
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE subject_grading_profiles')) {
      const parameterizedSource = sql.includes('configuration_source = ?');
      const profile = [...profiles.values()].find(item => item.id === Number(params[parameterizedSource ? 1 : 0]));
      if (profile) {
        const source = parameterizedSource ? String(params[0])
          : sql.includes("configuration_source = 'deped_default'") ? 'deped_default' : 'custom';
        profile.configurationSource = source;
        profile.copiedFromProfileId = null;
      }
      return [{ affectedRows: profile ? 1 : 0 }];
    }
    if (sql.startsWith('INSERT INTO school_year_final_grade_rules')) {
      const [schoolId, academicYearId, schoolLevelId, gradingMode, passingGradeThreshold, gradeRounding] = params;
      finalGradeRules.set(`${schoolId}:${academicYearId}:${schoolLevelId}`, {
        gradingMode, passingGradeThreshold: Number(passingGradeThreshold), gradeRounding
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in subject-grading config test: ${sql}`);
  }

  let transactionSnapshot = null;
  const cloneMap = map => new Map([...map.entries()].map(([entryKey, value]) => [entryKey, JSON.parse(JSON.stringify(value))]));
  const connection = {
    execute,
    async beginTransaction() {
      transactionSnapshot = {
        profiles: cloneMap(profiles), components: cloneMap(components),
        examParts: cloneMap(examParts), finalGradeRules: cloneMap(finalGradeRules)
      };
    },
    async commit() { counters.commits += 1; transactionSnapshot = null; },
    async rollback() {
      counters.rollbacks += 1;
      if (!transactionSnapshot) return;
      for (const [target, snapshot] of [[profiles, transactionSnapshot.profiles], [components, transactionSnapshot.components], [examParts, transactionSnapshot.examParts], [finalGradeRules, transactionSnapshot.finalGradeRules]]) {
        target.clear();
        snapshot.forEach((value, entryKey) => target.set(entryKey, value));
      }
      transactionSnapshot = null;
    },
    release() {}
  };
  return {
    execute,
    getConnection: async () => connection,
    connection,
    profiles,
    components,
    examParts,
    finalGradeRules,
    linkedComponents,
    linkedParts,
    publishedSubjects,
    statements,
    counters,
    key
  };
}

async function withController(database, run, auditEvents = []) {
  const originalGetDatabase = databaseModule.getDatabase;
  const originalWriteAuditLog = auditLogModule.writeAuditLog;
  const originalController = require.cache[controllerPath];
  databaseModule.getDatabase = () => database;
  auditLogModule.writeAuditLog = async (...args) => { auditEvents.push(args); };
  delete require.cache[controllerPath];
  try {
    return await run(require(controllerPath), auditEvents);
  } finally {
    delete require.cache[controllerPath];
    if (originalController) require.cache[controllerPath] = originalController;
    databaseModule.getDatabase = originalGetDatabase;
    auditLogModule.writeAuditLog = originalWriteAuditLog;
  }
}

async function invoke(handler, request) {
  const result = { statusCode: 200 };
  const response = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
  await handler(request, response, error => { result.error = error; });
  return result;
}

const admin = { role: 'school_admin', schoolId: SCHOOL_ID, id: 8 };

test('DepEd preview and apply create mapped defaults, flag unmatched subjects, and preserve custom settings on rerun', async () => {
  const database = createDatabase();
  await withController(database, async controller => {
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    assert.equal(preview.error, undefined);
    assert.deepEqual(preview.body.subjects.map(subject => subject.status), ['ready', 'unmatched']);
    assert.deepEqual(preview.body.subjects[0].defaultComponents.map(component => component.weight), [20, 50, 30]);
    assert.equal(preview.body.periodStructureCompatible, true);
    assert.equal(preview.body.gradingMode, 'deped_policy');
    assert.equal(preview.body.source, 'deped_default');

    const request = { user: admin, body: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) } };
    const first = await invoke(controller.applyDepedDefaults, request);
    assert.equal(first.error, undefined);
    assert.equal(first.body.added.length, 1);
    assert.equal(first.body.unmatched[0].subjectName, 'Local elective');
    assert.deepEqual(first.body.preview.subjects[0].components[2].examParts.map(part => part.weight), [30, 30, 40]);

    const savedProfile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    const savedComponents = database.components.get(savedProfile.id);
    savedProfile.configurationSource = 'custom';
    savedComponents[0].name = 'School-written assessment';

    const second = await invoke(controller.applyDepedDefaults, request);
    assert.equal(second.error, undefined);
    assert.equal(second.body.added.length, 0);
    assert.equal(second.body.alreadyConfigured.length, 1);
    assert.equal(second.body.preview.subjects[0].components[0].name, 'School-written assessment');
    assert.equal(database.statements.filter(entry => entry.sql.startsWith('INSERT INTO subject_grading_profiles')).length, 1);
  });
});

test('Grades 2–3 require school-selected exam parts and remain independent from Grades 4–6', async () => {
  const database = createDatabase({ earlyGrades: true });
  await withController(database, async controller => {
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const grade2 = preview.body.subjects.find(subject => subject.id === 23);
    const grade3 = preview.body.subjects.find(subject => subject.id === 24);
    assert.deepEqual(grade2.defaultComponents.map(component => component.weight), [20, 50, 30]);
    assert.deepEqual(grade2.defaultComponents[2].examParts, []);
    assert.equal(grade2.status, 'ready');
    assert.equal(grade2.needsExamSetup, true);
    assert.equal(grade3.needsExamSetup, true);
    assert.deepEqual(preview.body.subjects.find(subject => subject.id === 21).defaultComponents[2].examParts.map(part => part.weight), [30, 30, 40]);

    const applied = await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    assert.equal(applied.error, undefined);
    assert.deepEqual(applied.body.needsExamSetup.map(subject => subject.subjectId), [23, 24]);
    assert.equal(database.profiles.has(database.key(SCHOOL_ID, 10, LEVEL_ID, 23)), false);
    assert.equal(database.profiles.has(database.key(SCHOOL_ID, 10, LEVEL_ID, 24)), false);
    const grade4Profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    assert.deepEqual(database.examParts.get(database.components.get(grade4Profile.id)[2].id).map(part => part.weight), [30, 30, 40]);

    const schoolChosenParts = [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 60 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 40 }
    ];
    const grade2Save = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: grade2.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination' ? schoolChosenParts : [] })) }
    });
    assert.equal(grade2Save.error, undefined);
    assert.equal(grade2Save.body.profile.configurationSource, 'custom');
    assert.deepEqual(grade2Save.body.profile.components[2].examParts.map(part => part.weight), [60, 40]);

    const grade3PartsWithOptionalTermExam = [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 25 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 25 },
      { code: 'term-exam', name: 'Term Exam', weight: 50 }
    ];
    const grade3Save = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 24,
        components: grade3.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination' ? grade3PartsWithOptionalTermExam : [] })) }
    });
    assert.equal(grade3Save.error, undefined);
    assert.deepEqual(grade3Save.body.profile.components[2].examParts.map(part => part.weight), [25, 25, 50]);
    assert.notEqual(grade2Save.body.profile.id, grade3Save.body.profile.id);

    const invalid = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 24,
        components: grade3.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination'
            ? [{ code: 'summative-test-1', name: 'Summative Test 1', weight: 70 }, { code: 'summative-test-2', name: 'Summative Test 2', weight: 20 }]
            : [] })) }
    });
    assert.match(invalid.error?.message || '', /Exam-part weights must total 100%/);

    const missingExaminations = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 24, components: [
        { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
        { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 80 }
      ] }
    });
    assert.match(missingExaminations.error?.message || '', /must include one Examinations component/);
  });
});

test('Grade 2–3 profiles are not offered for SY 2027–28', async () => {
  const database = createDatabase({ earlyGrades: true, academicYearLabel: '2027-2028' });
  await withController(database, async controller => {
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    assert.equal(preview.error, undefined);
    assert.equal(preview.body.subjects.some(subject => [23, 24].includes(subject.id)), false);

    const save = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: [
          { code: 'written', name: 'Written', componentType: 'written', weight: 20 },
          { code: 'performance', name: 'Performance', componentType: 'performance', weight: 50 },
          { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30,
            examParts: [
              { code: 'test-1', name: 'Test 1', weight: 50 },
              { code: 'test-2', name: 'Test 2', weight: 50 }
            ] }
        ]
      }
    });
    assert.equal(save.error?.status, 404);
    assert.equal(database.profiles.has(database.key(SCHOOL_ID, 10, LEVEL_ID, 23)), false);
  });
});

test('teacher score setup applies the saved Elementary rule to Grade 2 in SY 2026–27', async () => {
  const database = createDatabase({ earlyGrades: true, teacherGradeCode: 'grade-2' });
  database.finalGradeRules.set(`${SCHOOL_ID}:10:${LEVEL_ID}`, {
    gradingMode: 'school_specific', passingGradeThreshold: 83, gradeRounding: 'truncate'
  });
  await withController(database, async controller => {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const grade2 = preview.body.subjects.find(subject => subject.id === 23);
    const saved = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: grade2.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination' ? [
            { code: 'summative-test-1', name: 'Summative Test 1', weight: 60 },
            { code: 'summative-test-2', name: 'Summative Test 2', weight: 40 }
          ] : [] })) }
    });
    assert.equal(saved.error, undefined);
    const active = await invoke(controller.getTeacherSubjectGradingConfig, {
      user: { id: 12, schoolId: SCHOOL_ID, role: 'teacher' },
      query: { sectionId: '8', subjectId: '23' }
    });
    assert.equal(active.error, undefined);
    assert.equal(active.body.applicable, true);
    assert.equal(active.body.configured, true);
    assert.equal(active.body.needsPolicyReview, false);
    assert.equal(active.body.locked, false);
    assert.equal(active.body.gradingMode, 'school_specific');
    assert.equal(active.body.gradingMethod, 'school_direct');
    assert.equal(active.body.passingGradeThreshold, 83);
    assert.equal(active.body.gradeRounding, 'truncate');
    assert.deepEqual(active.body.components.map(component => component.weight), [20, 50, 30]);
    assert.deepEqual(active.body.components[2].examParts.map(part => part.weight), [60, 40]);
  });

  const futureDatabase = createDatabase({ earlyGrades: true, academicYearLabel: '2027-2028', teacherGradeCode: 'grade-2' });
  await withController(futureDatabase, async controller => {
    const future = await invoke(controller.getTeacherSubjectGradingConfig, {
      user: { id: 12, schoolId: SCHOOL_ID, role: 'teacher' },
      query: { sectionId: '8', subjectId: '23' }
    });
    assert.equal(future.error, undefined);
    assert.equal(future.body.applicable, false);
    assert.equal(future.body.components.length, 0);
  });
});

test('legacy Grades 2–3 defaults need admin review before publishing but remain available for score entry', async () => {
  const database = createDatabase({ earlyGrades: true, teacherGradeCode: 'grade-2' });
  await withController(database, async controller => {
    const initial = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const grade2 = initial.body.subjects.find(subject => subject.id === 23);
    const legacyParts = [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
    ];
    const saved = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: grade2.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination' ? legacyParts : [] })) }
    });
    assert.equal(saved.error, undefined);
    database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 23)).configurationSource = 'deped_default';

    const review = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const legacySubject = review.body.subjects.find(subject => subject.id === 23);
    assert.equal(legacySubject.needsPolicyReview, true);
    assert.equal(legacySubject.needsExamSetup, false);
    assert.equal(legacySubject.status, 'configured');

    const teacherConfig = await invoke(controller.getTeacherSubjectGradingConfig, {
      user: { id: 12, schoolId: SCHOOL_ID, role: 'teacher' },
      query: { sectionId: '8', subjectId: '23' }
    });
    assert.equal(teacherConfig.error, undefined);
    assert.equal(teacherConfig.body.configured, true);
    assert.equal(teacherConfig.body.needsPolicyReview, true);
    assert.equal(teacherConfig.body.locked, false);

    const confirmed = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: legacySubject.components }
    });
    assert.equal(confirmed.error, undefined);
    assert.equal(confirmed.body.profile.configurationSource, 'custom');
    const confirmedPreview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    assert.equal(confirmedPreview.body.subjects.find(subject => subject.id === 23).needsPolicyReview, false);
  });

  const publishedDatabase = createDatabase({ earlyGrades: true, published: true, teacherGradeCode: 'grade-2' });
  const publishedProfile = {
    id: 100, schoolId: SCHOOL_ID, academicYearId: 10, schoolLevelId: LEVEL_ID,
    subjectId: 23, configurationSource: 'deped_default', copiedFromProfileId: null
  };
  publishedDatabase.profiles.set(publishedDatabase.key(SCHOOL_ID, 10, LEVEL_ID, 23), publishedProfile);
  publishedDatabase.components.set(100, [
    { id: 200, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20, sortOrder: 1 },
    { id: 201, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50, sortOrder: 2 },
    { id: 202, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, sortOrder: 3 }
  ]);
  publishedDatabase.examParts.set(200, []);
  publishedDatabase.examParts.set(201, []);
  publishedDatabase.examParts.set(202, [
    { id: 300, code: 'summative-test-1', name: 'Summative Test 1', weight: 50, sortOrder: 1 },
    { id: 301, code: 'summative-test-2', name: 'Summative Test 2', weight: 50, sortOrder: 2 }
  ]);
  await withController(publishedDatabase, async controller => {
    const teacherConfig = await invoke(controller.getTeacherSubjectGradingConfig, {
      user: { id: 12, schoolId: SCHOOL_ID, role: 'teacher' },
      query: { sectionId: '8', subjectId: '23' }
    });
    assert.equal(teacherConfig.error, undefined);
    assert.equal(teacherConfig.body.configured, true);
    assert.equal(teacherConfig.body.locked, true);
    assert.equal(teacherConfig.body.needsPolicyReview, false);
  });
});

test('existing Grades 2–3 profiles without exam parts are marked for setup', async () => {
  const database = createDatabase({ earlyGrades: true, teacherGradeCode: 'grade-2' });
  const profile = {
    id: 100, schoolId: SCHOOL_ID, academicYearId: 10, schoolLevelId: LEVEL_ID,
    subjectId: 23, configurationSource: 'custom', copiedFromProfileId: null
  };
  database.profiles.set(database.key(SCHOOL_ID, 10, LEVEL_ID, 23), profile);
  database.components.set(100, [
    { id: 200, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20, sortOrder: 1 },
    { id: 201, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50, sortOrder: 2 },
    { id: 202, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, sortOrder: 3 }
  ]);
  database.components.get(100).forEach(component => database.examParts.set(component.id, []));

  await withController(database, async controller => {
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const subject = preview.body.subjects.find(item => item.id === 23);
    assert.equal(subject.status, 'configured');
    assert.equal(subject.needsExamSetup, true);

    const teacherConfig = await invoke(controller.getTeacherSubjectGradingConfig, {
      user: { id: 12, schoolId: SCHOOL_ID, role: 'teacher' },
      query: { sectionId: '8', subjectId: '23' }
    });
    assert.equal(teacherConfig.body.configured, true);
    assert.equal(teacherConfig.body.needsExamSetup, true);
  });
});

test('catalog group save materializes shared weights and the school-selected early-grade split atomically', async () => {
  const database = createDatabase({ earlyGrades: true });
  const components = examParts => [
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
    { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts }
  ];
  const earlyParts = [
    { code: 'summative-test-1', name: 'Summative Test 1', weight: 60 },
    { code: 'summative-test-2', name: 'Summative Test 2', weight: 40 }
  ];
  const prescribedParts = [
    { code: 'summative-test-1', name: 'Summative Test 1', weight: 30 },
    { code: 'summative-test-2', name: 'Summative Test 2', weight: 30 },
    { code: 'term-exam', name: 'Term Exam', weight: 40 }
  ];
  await withController(database, async controller => {
    const result = await invoke(controller.saveK10CatalogSubjectGroupConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
        { subjectId: 23, components: components(earlyParts) },
        { subjectId: 21, components: components(prescribedParts) }
      ] }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.body.profiles.length, 2);
    assert.equal(database.counters.commits, 1);
    assert.equal(database.counters.rollbacks, 0);
    const early = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 23));
    const standard = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    assert.deepEqual(database.components.get(early.id).map(component => component.weight), [20, 50, 30]);
    assert.deepEqual(database.examParts.get(database.components.get(early.id)[2].id).map(part => part.weight), [60, 40]);
    assert.deepEqual(database.examParts.get(database.components.get(standard.id)[2].id).map(part => part.weight), [30, 30, 40]);
  });
});

test('catalog group save rolls back all targets if a later profile is published', async () => {
  const database = createDatabase({ earlyGrades: true, publishedSubjectIds: [21] });
  const components = parts => [
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
    { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: parts }
  ];
  const parts = [
    { code: 'test-1', name: 'Test 1', weight: 60 },
    { code: 'test-2', name: 'Test 2', weight: 40 }
  ];
  const result = await withController(database, controller => invoke(controller.saveK10CatalogSubjectGroupConfig, {
    user: admin,
    body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
      { subjectId: 23, components: components(parts) }, { subjectId: 21, components: components(parts) }
    ] }
  }));
  assert.equal(result.error?.status, 409);
  assert.equal(database.counters.commits, 0);
  assert.equal(database.counters.rollbacks, 1);
  assert.equal(database.profiles.has(database.key(SCHOOL_ID, 10, LEVEL_ID, 23)), false);
});

test('catalog group save rolls back when an existing linked component cannot be removed', async () => {
  const database = createDatabase({ earlyGrades: true, linkedComponentIds: [203] });
  const existingProfile = {
    id: 99, schoolId: SCHOOL_ID, academicYearId: 10, schoolLevelId: LEVEL_ID,
    subjectId: 21, configurationSource: 'custom', copiedFromProfileId: null
  };
  database.profiles.set(database.key(SCHOOL_ID, 10, LEVEL_ID, 21), existingProfile);
  database.components.set(99, [
    { id: 200, code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20, sortOrder: 1 },
    { id: 201, code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50, sortOrder: 2 },
    { id: 202, code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, sortOrder: 3 },
    { id: 203, code: 'school-extra', name: 'School Extra', componentType: 'other', weight: 0, sortOrder: 4 }
  ]);
  database.examParts.set(200, []);
  database.examParts.set(201, []);
  database.examParts.set(202, [{ id: 300, code: 'old-test', name: 'Old test', weight: 100, sortOrder: 1 }]);
  database.examParts.set(203, []);
  const components = parts => [
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
    { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: parts }
  ];
  const result = await withController(database, controller => invoke(controller.saveK10CatalogSubjectGroupConfig, {
    user: admin,
    body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
      { subjectId: 23, components: components([
        { code: 'test-1', name: 'Test 1', weight: 60 }, { code: 'test-2', name: 'Test 2', weight: 40 }
      ]) },
      { subjectId: 21, components: components([
        { code: 'test-1', name: 'Test 1', weight: 30 }, { code: 'test-2', name: 'Test 2', weight: 30 }, { code: 'term-exam', name: 'Term Exam', weight: 40 }
      ]) }
    ] }
  }));
  assert.equal(result.error?.status, 409);
  assert.equal(database.counters.rollbacks, 1);
  assert.equal(database.profiles.has(database.key(SCHOOL_ID, 10, LEVEL_ID, 23)), false);
  assert.equal(database.components.get(99).some(component => component.id === 203), true);
});

test('catalog group save enforces school, catalog, shared-weight, and shared early-grade exam scope', async () => {
  const database = createDatabase({ earlyGrades: true, includeEnglishGrade3: true });
  const components = (writtenWeight, firstWeight, secondWeight) => [
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: writtenWeight },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 70 - writtenWeight },
    { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: [
      { code: 'test-1', name: 'Test 1', weight: firstWeight }, { code: 'test-2', name: 'Test 2', weight: secondWeight }
    ] }
  ];
  await withController(database, async controller => {
    const crossGroup = await invoke(controller.saveK10CatalogSubjectGroupConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
        { subjectId: 23, components: components(20, 60, 40) }, { subjectId: 24, components: components(20, 60, 40) }
      ] }
    });
    assert.equal(crossGroup.error?.status, 404);

    const wrongSchool = await invoke(controller.saveK10CatalogSubjectGroupConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
        { subjectId: 999, components: components(20, 60, 40) }
      ] }
    });
    assert.equal(wrongSchool.error?.status, 404);

    const differentWeights = await invoke(controller.saveK10CatalogSubjectGroupConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
        { subjectId: 23, components: components(20, 60, 40) }, { subjectId: 25, components: components(25, 60, 40) }
      ] }
    });
    assert.match(differentWeights.error?.message || '', /Shared component names and weights must match/);

    const differentSplits = await invoke(controller.saveK10CatalogSubjectGroupConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', targets: [
        { subjectId: 23, components: components(20, 60, 40) }, { subjectId: 25, components: components(20, 50, 50) }
      ] }
    });
    assert.match(differentSplits.error?.message || '', /same school-selected exam setup/);
  });
});

test('published subject configurations are locked against edits', async () => {
  const database = createDatabase({ published: true });
  await withController(database, async controller => {
    const result = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21,
        components: [
          { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
          { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
          { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30,
            examParts: [
              { code: 'summative-test-1', name: 'Summative Test 1', weight: 30 },
              { code: 'summative-test-2', name: 'Summative Test 2', weight: 30 },
              { code: 'term-exam', name: 'Term Exam', weight: 40 }
            ] }
        ]
      }
    });
    assert.equal(result.error?.status, 409);
    assert.equal(database.counters.rollbacks, 1);
    assert.equal(database.statements.some(entry => entry.sql.startsWith('INSERT INTO subject_grading_components')), false);
  });
});

test('published Grade 2 profiles are locked against configuration changes', async () => {
  const database = createDatabase({ earlyGrades: true, published: true });
  await withController(database, async controller => {
    const result = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: [
          { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
          { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
          { code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30,
            examParts: [
              { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
              { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
            ] }
        ]
      }
    });
    assert.equal(result.error?.status, 409);
    assert.equal(database.counters.rollbacks, 1);
    assert.equal(database.statements.some(entry => entry.sql.startsWith('INSERT INTO subject_grading_components')), false);
  });
});

test('admins can save school-specific final-grade rules for the active year and level', async () => {
  const database = createDatabase();
  await withController(database, async controller => {
    const result = await invoke(controller.saveK10FinalGradeRules, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID,
        gradingMode: 'school_specific', passingGradeThreshold: 82.5, gradeRounding: 'roundup'
      }
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.body.finalGradeRules, {
      gradingMode: 'school_specific', gradingMethod: 'school_direct',
      gradingMethodLabel: 'School-specific direct grade', passingGradeThreshold: 82.5,
      gradeRounding: 'roundup', source: 'school_specific', locked: false,
      periodStructureCompatible: true, periodStructureWarning: null
    });
    assert.equal(database.finalGradeRules.get(`${SCHOOL_ID}:10:${LEVEL_ID}`).gradeRounding, 'roundup');
    const save = database.statements.find(entry => entry.sql.startsWith('INSERT INTO school_year_final_grade_rules'));
    assert.equal(save.params[0], SCHOOL_ID);
    assert.equal(save.params[1], 10);
    assert.equal(save.params[2], LEVEL_ID);
  });
});

test('published numerical Elementary and JHS grades lock final-grade rules for their school year and level', async () => {
  const database = createDatabase({ published: true });
  await withController(database, async controller => {
    const result = await invoke(controller.saveK10FinalGradeRules, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID,
        gradingMode: 'school_specific', passingGradeThreshold: 80, gradeRounding: 'truncate'
      }
    });
    assert.equal(result.error?.status, 409);
    assert.equal(database.counters.rollbacks, 1);
    assert.equal(database.finalGradeRules.size, 0);
    assert.equal(database.statements.some(entry => entry.sql.startsWith('INSERT INTO school_year_final_grade_rules')), false);
    const lockQuery = database.statements.find(entry => entry.sql.includes('FROM published_final_grades AS grades'));
    assert.deepEqual(lockQuery.params.slice(3), [
      'grade-2', 'grade-3', 'grade-4', 'grade-5', 'grade-6',
      'grade-7', 'grade-8', 'grade-9', 'grade-10'
    ]);
  });
});

test('admins can reweight and add components and exam parts while every set totals 100%', async () => {
  const database = createDatabase();
  await withController(database, async controller => {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    const existing = database.components.get(profile.id);
    const examParts = database.examParts.get(existing[2].id);
    const components = [
      { id: existing[0].id, code: existing[0].code, name: 'Written/Oral Work', componentType: 'written', weight: 15 },
      { id: existing[1].id, code: existing[1].code, name: existing[1].name, componentType: 'performance', weight: 45 },
      { id: existing[2].id, code: existing[2].code, name: existing[2].name, componentType: 'examination', weight: 20,
        examParts: examParts.map((part, index) => ({ ...part, weight: [20, 30, 50][index] })) },
      { code: 'project-work', name: 'Project work', componentType: 'other', weight: 20 }
    ];
    const result = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21, components }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.body.profile.configurationSource, 'custom');
    assert.deepEqual(result.body.profile.components.map(component => component.weight), [15, 45, 20, 20]);
    assert.deepEqual(result.body.profile.components[2].examParts.map(part => part.weight), [20, 30, 50]);
    assert.equal(result.body.profile.components[0].name, 'Written/Oral Work');

    const invalid = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21,
        components: components.map((component, index) => index === 3 ? { ...component, weight: 19 } : component) }
    });
    assert.match(invalid.error?.message || '', /total 100%/);
  });
});

test('a linked component cannot be removed from the configuration', async () => {
  const database = createDatabase();
  await withController(database, async controller => {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    const existing = database.components.get(profile.id);
    database.linkedComponents.add(existing[0].id);
    const result = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: {
        academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21,
        components: [
          { id: existing[1].id, code: existing[1].code, name: existing[1].name, componentType: 'performance', weight: 50 },
          { id: existing[2].id, code: existing[2].code, name: existing[2].name, componentType: 'examination', weight: 30,
            examParts: database.examParts.get(existing[2].id) },
          { code: 'custom-component', name: 'Custom component', componentType: 'other', weight: 20 }
        ]
      }
    });
    assert.equal(result.error?.status, 409);
    assert.match(result.error.message, /score or assignment links/);
    assert.equal(database.components.get(profile.id).length, 3);
    assert.equal(database.counters.rollbacks, 1);
  });
});

test('custom subject profiles copy forward as reviewable copies, not defaults', async () => {
  const database = createDatabase();
  await withController(database, async controller => {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const source = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    source.configurationSource = 'custom';

    await controller.copyCustomProfilesForward(database.connection, SCHOOL_ID, 11, '2027-06-01');

    const copied = database.profiles.get(database.key(SCHOOL_ID, 11, LEVEL_ID, 21));
    assert.equal(copied.configurationSource, 'copied_custom');
    assert.equal(copied.copiedFromProfileId, source.id);
    assert.deepEqual(database.components.get(copied.id).map(component => component.weight), [20, 50, 30]);
    assert.deepEqual(database.examParts.get(database.components.get(copied.id)[2].id).map(part => part.weight), [30, 30, 40]);
  });
});

test('Grades 4–10 restore canonical defaults while Grades 2–3 cannot restore a non-prescribed split', async () => {
  const database = createDatabase({ earlyGrades: true });
  await withController(database, async (controller, auditEvents) => {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const k10Profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    k10Profile.configurationSource = 'custom';

    const k10Components = database.components.get(k10Profile.id);
    const k10ComponentIds = k10Components.map(component => component.id);
    const k10PartIds = database.examParts.get(k10Components[2].id).map(part => part.id);
    k10Components[2].name = 'School examinations';
    database.examParts.get(k10Components[2].id)[0].name = 'School test one';
    database.examParts.get(k10Components[2].id)[0].weight = 20;
    database.examParts.get(k10Components[2].id)[1].weight = 30;
    database.examParts.get(k10Components[2].id)[2].weight = 50;
    k10Components.push({ id: 999, code: 'school-project', name: 'School project', componentType: 'other', weight: 10, sortOrder: 4, examParts: [] });
    database.examParts.set(999, []);
    database.examParts.get(k10Components[2].id).push({ id: 998, code: 'oral-exam', name: 'Oral exam', weight: 0, sortOrder: 4 });
    database.linkedComponents.add(k10Components[0].id);
    database.linkedParts.add(k10PartIds[0]);

    const earlyPreview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const early = earlyPreview.body.subjects.find(subject => subject.id === 23);
    const schoolChoice = await invoke(controller.saveSubjectGradingConfig, {
      user: admin,
      body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23,
        components: early.defaultComponents.map(component => ({ ...component,
          examParts: component.componentType === 'examination' ? [
            { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
            { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
          ] : [] })) }
    });
    assert.equal(schoolChoice.error, undefined);
    const earlyProfile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 23));
    earlyProfile.configurationSource = 'copied_custom';
    earlyProfile.copiedFromProfileId = 80;
    const earlyRestore = await invoke(controller.restoreDepedSubjectDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 23 }
    });
    assert.equal(earlyRestore.error?.status, 409);
    assert.match(earlyRestore.error.message, /does not prescribe a fixed exam-part split/);

    const restored = await invoke(controller.restoreDepedSubjectDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21 }
    });
    assert.equal(restored.error, undefined);
    assert.equal(restored.body.profile.configurationSource, 'deped_default');
    assert.equal(restored.body.profile.copiedFromProfileId, null);
    assert.deepEqual(restored.body.profile.components.map(component => component.weight), [20, 50, 30]);
    assert.deepEqual(restored.body.profile.components[2].examParts.map(part => part.weight), [30, 30, 40]);
    assert.deepEqual(restored.body.profile.components.map(component => component.id), k10ComponentIds.slice(0, 3));
    assert.deepEqual(restored.body.profile.components[2].examParts.map(part => part.id), k10PartIds);
    assert.equal(database.components.get(k10Profile.id).some(component => component.code === 'school-project'), false);
    assert.equal(database.examParts.get(k10Components[2].id).some(part => part.code === 'oral-exam'), false);
    assert.equal(auditEvents.filter(args => args[2] === 'subject_grading_defaults_restored').length, 1);

    const idsBeforeRepeat = database.components.get(k10Profile.id).map(component => component.id);
    const insertsBeforeRepeat = database.statements.filter(entry => entry.sql.startsWith('INSERT INTO subject_grading_components') || entry.sql.startsWith('INSERT INTO subject_grading_exam_parts')).length;
    const repeated = await invoke(controller.restoreDepedSubjectDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21 }
    });
    assert.equal(repeated.error, undefined);
    assert.deepEqual(database.components.get(k10Profile.id).map(component => component.id), idsBeforeRepeat);
    assert.equal(database.statements.filter(entry => entry.sql.startsWith('INSERT INTO subject_grading_components') || entry.sql.startsWith('INSERT INTO subject_grading_exam_parts')).length, insertsBeforeRepeat);
  });
});

test('restore rejects removing score- or assignment-linked components and exam parts', async t => {
  await t.test('linked extra component', async () => {
    const database = createDatabase();
    await withController(database, async controller => {
      await invoke(controller.applyDepedDefaults, { user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID } });
      const profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
      const extra = { id: 950, code: 'school-project', name: 'School project', componentType: 'other', weight: 10, sortOrder: 4, examParts: [] };
      database.components.get(profile.id).push(extra);
      database.examParts.set(extra.id, []);
      profile.configurationSource = 'custom';
      database.linkedComponents.add(extra.id);
      const result = await invoke(controller.restoreDepedSubjectDefaults, {
        user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21 }
      });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /linked to a score or assignment and cannot be removed/);
      assert.ok(database.components.get(profile.id).some(component => component.id === extra.id));
      assert.equal(profile.configurationSource, 'custom');
      assert.equal(database.counters.rollbacks, 1);
    });
  });

  await t.test('linked extra exam part', async () => {
    const database = createDatabase();
    await withController(database, async controller => {
      await invoke(controller.applyDepedDefaults, { user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID } });
      const profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
      const examination = database.components.get(profile.id)[2];
      const extra = { id: 951, code: 'oral-exam', name: 'Oral exam', weight: 0, sortOrder: 4 };
      database.examParts.get(examination.id).push(extra);
      profile.configurationSource = 'custom';
      database.linkedParts.add(extra.id);
      const result = await invoke(controller.restoreDepedSubjectDefaults, {
        user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21 }
      });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /linked to a score or assignment and cannot be removed/);
      assert.ok(database.examParts.get(examination.id).some(part => part.id === extra.id));
      assert.equal(profile.configurationSource, 'custom');
      assert.equal(database.counters.rollbacks, 1);
    });
  });

  await t.test('linked component cannot change assessment type', async () => {
    const database = createDatabase();
    await withController(database, async controller => {
      await invoke(controller.applyDepedDefaults, { user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID } });
      const profile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
      const examination = database.components.get(profile.id)[2];
      examination.componentType = 'other';
      profile.configurationSource = 'custom';
      database.linkedComponents.add(examination.id);
      const result = await invoke(controller.restoreDepedSubjectDefaults, {
        user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: 21 }
      });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /cannot change assessment type/);
      assert.equal(database.components.get(profile.id)[2].componentType, 'other');
      assert.equal(profile.configurationSource, 'custom');
      assert.equal(database.counters.rollbacks, 1);
    });
  });
});

test('restore rejects published, ineligible, unmatched, cross-school, and non-admin requests', async () => {
  const cases = [
    { name: 'published grades', options: { published: true }, user: admin, subjectId: 21, status: 409 },
    { name: 'ineligible year', options: { academicYearLabel: '2025-2026' }, user: admin, subjectId: 21, status: 409 },
    { name: 'unmatched subject', options: {}, user: admin, subjectId: 22, status: 409 },
    { name: 'cross-school request', options: {}, user: { ...admin, schoolId: SCHOOL_ID + 1 }, subjectId: 21, status: 404 },
    { name: 'non-admin request', options: {}, user: { ...admin, role: 'teacher' }, subjectId: 21, status: 403 }
  ];
  for (const entry of cases) {
    const database = createDatabase(entry.options);
    await withController(database, async controller => {
      const result = await invoke(controller.restoreDepedSubjectDefaults, {
        user: entry.user,
        body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId: entry.subjectId }
      });
      assert.equal(result.error?.status, entry.status, entry.name);
      assert.equal(database.statements.some(statement => /^(?:INSERT|UPDATE|DELETE) INTO subject_grading_/.test(statement.sql)), false, entry.name);
      if (entry.status !== 403) assert.equal(database.counters.rollbacks, 1, entry.name);
      assert.equal(database.counters.commits, 0, entry.name);
    });
  }
});

test('catalog-group restore resets DepEd profiles atomically and preserves confirmed Grades 2–3 exam choices', async t => {
  async function prepareGroup(database, controller) {
    await invoke(controller.applyDepedDefaults, {
      user: admin, body: { academicYearId: 10, schoolLevelId: LEVEL_ID }
    });
    const preview = await invoke(controller.previewDepedDefaults, {
      user: admin, query: { academicYearId: '10', schoolLevelId: String(LEVEL_ID) }
    });
    const earlySubjectIds = preview.body.subjects.filter(subject => [23, 25].includes(subject.id)).map(subject => subject.id);
    for (const subjectId of earlySubjectIds) {
      const subject = preview.body.subjects.find(item => item.id === subjectId);
      const components = subject.defaultComponents.map(component => ({
        ...component,
        weight: component.code === 'written-oral-works' ? 25
          : component.code === 'performance-tasks' ? 45 : 30,
        examParts: component.componentType === 'examination'
          ? [
              { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
              { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
            ]
          : []
      }));
      const saved = await invoke(controller.saveSubjectGradingConfig, {
        user: admin,
        body: { academicYearId: 10, schoolLevelId: LEVEL_ID, subjectId, components }
      });
      assert.equal(saved.error, undefined);
    }
    const standard = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
    standard.configurationSource = 'custom';
    const standardComponents = database.components.get(standard.id);
    standardComponents[0].weight = 25;
    standardComponents[1].weight = 45;
  }

  await t.test('restores editable targets and leaves a published grade profile alone', async () => {
    const database = createDatabase({ earlyGrades: true, includeEnglishGrade3: true });
    await withController(database, async controller => {
      await prepareGroup(database, controller);
      database.publishedSubjects.add(25);
      const publishedProfile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 25));
      const publishedWeights = database.components.get(publishedProfile.id).map(component => component.weight);
      const commitsBeforeRestore = database.counters.commits;
      const result = await invoke(controller.restoreDepedCatalogSubjectGroupDefaults, {
        user: admin,
        body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', subjectIds: [21, 23] }
      });
      assert.equal(result.error, undefined);
      const standard = result.body.profiles.find(profile => profile.subjectId === 21);
      const early = result.body.profiles.find(profile => profile.subjectId === 23);
      assert.equal(standard.configurationSource, 'deped_default');
      assert.deepEqual(standard.components.map(component => component.weight), [20, 50, 30]);
      assert.deepEqual(standard.components[2].examParts.map(part => part.weight), [30, 30, 40]);
      assert.equal(early.configurationSource, 'custom');
      assert.deepEqual(early.components.map(component => component.weight), [20, 50, 30]);
      assert.deepEqual(early.components[2].examParts.map(part => part.weight), [50, 50]);
      assert.deepEqual(database.components.get(publishedProfile.id).map(component => component.weight), publishedWeights);
      assert.equal(database.counters.commits, commitsBeforeRestore + 1);
      assert.equal(database.counters.rollbacks, 0);
    });
  });

  await t.test('rolls back the whole group when a later profile has a linked extra component', async () => {
    const database = createDatabase({ earlyGrades: true });
    await withController(database, async controller => {
      await prepareGroup(database, controller);
      const earlyProfile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 23));
      const extra = { id: 999, code: 'school-project', name: 'School project', componentType: 'other', weight: 5, sortOrder: 4, examParts: [] };
      database.components.get(earlyProfile.id).push(extra);
      database.examParts.set(extra.id, []);
      database.linkedComponents.add(extra.id);
      const standardProfile = database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21));
      const standardId = standardProfile.id;
      const beforeWeights = database.components.get(standardId).map(component => component.weight);
      const result = await invoke(controller.restoreDepedCatalogSubjectGroupDefaults, {
        user: admin,
        body: { academicYearId: 10, schoolLevelId: LEVEL_ID, groupKey: 'english', subjectIds: [21, 23] }
      });
      assert.equal(result.error?.status, 409);
      assert.match(result.error.message, /English:.*linked to a score or assignment and cannot be removed/);
      assert.deepEqual(database.components.get(standardId).map(component => component.weight), beforeWeights);
      assert.equal(database.profiles.get(database.key(SCHOOL_ID, 10, LEVEL_ID, 21)).configurationSource, 'custom');
      assert.ok(database.components.get(earlyProfile.id).some(component => component.id === extra.id));
      assert.equal(database.counters.rollbacks, 1);
    });
  });
});
