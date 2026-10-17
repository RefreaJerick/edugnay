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

function createDatabase({ published = false, linkedComponentIds = [], linkedExamPartIds = [] } = {}) {
  const profiles = new Map();
  const components = new Map();
  const examParts = new Map();
  const finalGradeRules = new Map();
  const statements = [];
  const linkedComponents = new Set(linkedComponentIds);
  const linkedParts = new Set(linkedExamPartIds);
  const counters = { nextProfileId: 100, nextComponentId: 200, nextPartId: 300, rollbacks: 0 };
  const key = (schoolId, yearId, levelId, subjectId) => `${schoolId}:${yearId}:${levelId}:${subjectId}`;

  async function execute(sql, rawParams = []) {
    const params = rawParams || [];
    const placeholderCount = (sql.match(/\?/g) || []).length;
    assert.equal(params.length, placeholderCount, `SQL bind count mismatch: ${sql}`);
    statements.push({ sql, params });

    if (sql.includes('SELECT academic_years.id AS academicYearId')) {
      return [[{
        academicYearId: Number(params[1]), academicYearLabel: '2026-2027', startDate: '2026-06-01',
        schoolLevelId: Number(params[0]), levelCode: 'elementary', gradingPeriodType: 'trimestral', academicYearStatus: 'active'
      }]];
    }
    if (sql.includes('SELECT COUNT(*) AS termCount')) return [[{ termCount: 3 }]];
    if (sql.includes('FROM school_year_final_grade_rules')) {
      const rule = finalGradeRules.get(`${params[0]}:${params[1]}:${params[2]}`);
      return [rule ? [{ ...rule }] : []];
    }
    if (sql.includes('GROUP_CONCAT(DISTINCT enabled_grades.grade_code')) return [SUBJECTS];
    if (sql.includes('SELECT COUNT(*) AS gradeCount') && sql.includes('FROM published_final_grades')) {
      return [[{ gradeCount: published ? 1 : 0 }]];
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
    if (sql.includes('subjectName') && sql.includes('subjectSchoolLevelId') && sql.includes('FROM subjects')) {
      return [[{ id: Number(params[0]), subjectName: 'English', subjectSchoolLevelId: LEVEL_ID }]];
    }
    if (sql.includes('FROM subject_grade_scopes AS scopes')) return [[{ id: 90 }]];
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
      const profile = [...profiles.values()].find(item => item.id === Number(params[0]));
      if (profile) { profile.configurationSource = 'custom'; profile.copiedFromProfileId = null; }
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

  const connection = {
    execute,
    async beginTransaction() {},
    async commit() {},
    async rollback() { counters.rollbacks += 1; },
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
    statements,
    counters,
    key
  };
}

async function withController(database, run) {
  const originalGetDatabase = databaseModule.getDatabase;
  const originalWriteAuditLog = auditLogModule.writeAuditLog;
  const originalController = require.cache[controllerPath];
  databaseModule.getDatabase = () => database;
  auditLogModule.writeAuditLog = async () => {};
  delete require.cache[controllerPath];
  try {
    return await run(require(controllerPath));
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

test('published Grades 4-10 results lock final-grade rules for their school year and level', async () => {
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
