const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const databaseModule = require('../config/database');
const { DEPED_GRADE_SUBJECTS, DEPED_K10_SUBJECTS, EARLY_GRADE_SUBJECTS } = require('../config/depedK10Subjects');

const gradeRows = [
  { schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1, gradeLevelId: 20, gradeCode: 'grade-2', gradeName: 'Grade 2', gradeEnabled: 0 },
  { schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1, gradeLevelId: 30, gradeCode: 'grade-3', gradeName: 'Grade 3', gradeEnabled: 0 },
  ...['grade-4', 'grade-5', 'grade-6'].map((gradeCode, index) => ({
    schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1,
    gradeLevelId: 40 + index, gradeCode, gradeName: `Grade ${index + 4}`, gradeEnabled: gradeCode === 'grade-6' ? 0 : 1
  })),
  ...['grade-7', 'grade-8', 'grade-9', 'grade-10'].map((gradeCode, index) => ({
    schoolLevelId: 20, levelCode: 'jhs', levelEnabled: 1,
    gradeLevelId: 70 + index, gradeCode, gradeName: `Grade ${index + 7}`, gradeEnabled: 1
  }))
];

let database;
databaseModule.getDatabase = () => database;
const { applyDepedSubjectDefaults, getDepedSubjectPreview } = require('../controllers/depedK10SubjectsController');

function createDatabase({ allGradesDisabled = false, enabledGradeCodes = null } = {}) {
  const state = {
    subjects: [
      { id: 1, subjectCode: 'science-jhs', name: 'Science', schoolLevelId: 20, gradeLevelId: null, isActive: 1 },
      { id: 2, subjectCode: 'english-elementary', name: 'English', schoolLevelId: 10, gradeLevelId: null, isActive: 0 }
    ],
    scopes: [{ subjectId: 1, gradeLevelId: 70 }, { subjectId: 2, gradeLevelId: 40 }],
    audit: [],
    nextSubjectId: 3,
    transactions: []
  };
  const connection = {
    async beginTransaction() { state.transactions.push('begin'); },
    async commit() { state.transactions.push('commit'); },
    async rollback() { state.transactions.push('rollback'); },
    release() {},
    async execute(sql, values = []) {
      if (sql.includes('FROM school_levels')) return [gradeRows.map(row => ({
        ...row,
        gradeEnabled: allGradesDisabled ? 0 : enabledGradeCodes
          ? Number(enabledGradeCodes.includes(row.gradeCode)) : row.gradeEnabled
      }))];
      if (sql.startsWith('SELECT id, subject_code AS subjectCode')) {
        return [values[0] === 9 ? state.subjects : []];
      }
      if (sql.startsWith('SELECT subject_id AS subjectId')) {
        const subjectIds = values.slice(1).map(Number);
        return [state.scopes.filter(scope => subjectIds.includes(scope.subjectId))];
      }
      if (sql.startsWith('INSERT INTO subjects')) {
        const id = state.nextSubjectId++;
        state.subjects.push({ id, subjectCode: values[1], name: values[2], schoolLevelId: Number(values[3]), gradeLevelId: null, isActive: 1 });
        return [{ insertId: id }];
      }
      if (sql.startsWith('INSERT INTO subject_grade_scopes')) {
        state.scopes.push({ subjectId: Number(values[1]), gradeLevelId: Number(values[2]) });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        state.audit.push(JSON.parse(values[5]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  return { state, connection, database: { execute: connection.execute.bind(connection), getConnection: async () => connection } };
}

async function call(controller, { body = {}, schoolId = 9 } = {}) {
  const result = { status: null, data: null, error: null };
  await controller({ user: { id: 5, schoolId }, body }, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('DepEd subject catalog reflects the Grades 4-10 learning areas and level-specific EPP/TLE', () => {
  assert.equal(DEPED_K10_SUBJECTS.some(subject => subject.gradeCodes.includes('kindergarten')), false);
  assert.equal(DEPED_K10_SUBJECTS.filter(subject => subject.levelCode === 'elementary').length, 9);
  assert.equal(DEPED_K10_SUBJECTS.filter(subject => subject.levelCode === 'jhs').length, 9);
  assert.deepEqual(DEPED_K10_SUBJECTS.find(subject => subject.code === 'epp-elementary').gradeCodes, ['grade-4', 'grade-5', 'grade-6']);
  assert.deepEqual(DEPED_K10_SUBJECTS.find(subject => subject.code === 'tle-jhs').gradeCodes, ['grade-7', 'grade-8', 'grade-9', 'grade-10']);
  assert.equal(EARLY_GRADE_SUBJECTS.filter(subject => subject.gradeCodes[0] === 'grade-2').length, 5);
  assert.equal(EARLY_GRADE_SUBJECTS.filter(subject => subject.gradeCodes[0] === 'grade-3').length, 6);
  assert.equal(DEPED_GRADE_SUBJECTS.some(subject => subject.gradeCodes.includes('grade-1') || subject.gradeCodes.includes('kindergarten')), false);
});

test('preview lists enabled Grades 4-10 and flags existing subjects without changing them', async () => {
  const fixture = createDatabase();
  database = fixture.database;
  const result = await call(getDepedSubjectPreview);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.grades.map(grade => grade.gradeCode), ['grade-4', 'grade-5', 'grade-7', 'grade-8', 'grade-9', 'grade-10']);
  assert.equal(result.data.grades[0].subjects.find(subject => subject.code === 'english-elementary').status, 'inactive');
  assert.equal(result.data.grades[1].subjects.find(subject => subject.code === 'english-elementary').status, 'review-existing');
  assert.equal(result.data.grades[2].subjects.find(subject => subject.code === 'science-jhs').status, 'already-present');
  assert.equal(result.data.grades[3].subjects.find(subject => subject.code === 'science-jhs').status, 'review-existing');
  assert.equal(fixture.state.subjects.length, 2);
});

test('preview lists the five Grade 2 subjects and six Grade 3 subjects only when those grades are enabled', async () => {
  const fixture = createDatabase({ enabledGradeCodes: ['grade-2', 'grade-3'] });
  database = fixture.database;
  const result = await call(getDepedSubjectPreview);

  assert.equal(result.error, null);
  assert.deepEqual(result.data.grades.map(grade => grade.gradeCode), ['grade-2', 'grade-3']);
  assert.equal(result.data.grades[0].subjects.length, 5);
  assert.equal(result.data.grades[1].subjects.length, 6);
  assert.deepEqual(result.data.grades[0].subjects.map(subject => subject.code), [
    'filipino-grade-2', 'english-grade-2', 'mathematics-grade-2', 'gmrc-grade-2', 'makabansa-grade-2'
  ]);
  assert.ok(result.data.grades[1].subjects.some(subject => subject.code === 'science-grade-3'));
  assert.equal(fixture.state.subjects.length, 2);
});

test('applying early-grade defaults creates separate subject records and scopes for each grade', async () => {
  const fixture = createDatabase({ enabledGradeCodes: ['grade-2', 'grade-3'] });
  database = fixture.database;
  const result = await call(applyDepedSubjectDefaults);

  assert.equal(result.error, null);
  assert.deepEqual(result.data.selectedGradeCodes, ['grade-2', 'grade-3']);
  assert.equal(result.data.addedSubjects.length, 11);
  assert.equal(result.data.addedGradeScopes, 11);
  const grade2English = fixture.state.subjects.find(subject => subject.subjectCode === 'english-grade-2');
  const grade3English = fixture.state.subjects.find(subject => subject.subjectCode === 'english-grade-3');
  assert.ok(grade2English && grade3English);
  assert.notEqual(grade2English.id, grade3English.id);
  assert.ok(fixture.state.scopes.some(scope => scope.subjectId === grade2English.id && scope.gradeLevelId === 20));
  assert.ok(fixture.state.scopes.some(scope => scope.subjectId === grade3English.id && scope.gradeLevelId === 30));
  assert.equal(fixture.state.subjects.some(subject => subject.subjectCode === 'science-grade-2'), false);
  assert.ok(fixture.state.subjects.some(subject => subject.subjectCode === 'science-grade-3'));

  const second = await call(applyDepedSubjectDefaults);
  assert.equal(second.error, null);
  assert.equal(second.data.addedSubjects.length, 0);
  assert.equal(fixture.state.subjects.filter(subject => subject.subjectCode === 'english-grade-2').length, 1);
});

test('apply adds missing subjects across all enabled grades and repeat application is safe', async () => {
  const fixture = createDatabase();
  database = fixture.database;
  const first = await call(applyDepedSubjectDefaults);
  assert.equal(first.error, null);
  assert.equal(first.status, 200);
  assert.equal(first.data.addedSubjects.length, 16);
  assert.equal(first.data.addedGradeScopes, 48);
  assert.deepEqual(first.data.selectedGradeCodes, ['grade-4', 'grade-5', 'grade-7', 'grade-8', 'grade-9', 'grade-10']);
  assert.equal(fixture.state.scopes.some(scope => scope.subjectId === 1 && scope.gradeLevelId === 71), false);
  assert.equal(fixture.state.scopes.some(scope => scope.subjectId === 2 && scope.gradeLevelId === 40), true);
  assert.equal(fixture.state.audit.length, 1);

  const second = await call(applyDepedSubjectDefaults);
  assert.equal(second.error, null);
  assert.equal(second.data.addedSubjects.length, 0);
  assert.equal(second.data.addedGradeScopes, 0);
  assert.equal(fixture.state.subjects.length, 18);
  assert.deepEqual(fixture.state.transactions, ['begin', 'commit', 'begin', 'commit']);
});

test('apply rejects a school with no enabled supported grade levels and rolls back', async () => {
  const fixture = createDatabase({ allGradesDisabled: true });
  database = fixture.database;
  const result = await call(applyDepedSubjectDefaults);
  assert.equal(result.error?.status, 400);
  assert.match(result.error.message, /at least one supported grade level/);
  assert.deepEqual(fixture.state.transactions, ['begin', 'rollback']);
  assert.equal(fixture.state.subjects.length, 2);
});

test('School Settings keeps the compact grading flow while DepEd subject review lives in Class Management', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const management = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-management.html'), 'utf8');
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  assert.doesNotMatch(page, /Review DepEd subjects|depedSubjectReviewModal|depedSubjectReviewHint/);
  assert.match(management, /id="reviewDepedSubjects"/);
  assert.match(management, /id="depedSubjectReviewModal"/);
  assert.match(management, /getDepedSubjectPreview\(\)/);
  assert.match(management, /applyDepedSubjectDefaults\(\)/);
  assert.match(management, /await refreshManagementViews\(\)/);
  assert.match(management, /edugnay-admin-schools\.html#academic-structure/);
  assert.match(page, /hash === '#academic-structure'/);
  assert.match(page, /id="applyMissingDepedDefaultsModal"/);
  assert.match(page, /Apply missing DepEd setups\?/);
  assert.match(page, /Only subjects without a saved setup are included\./);
  assert.match(page, /id="confirmApplyMissingDepedDefaults"/);
  assert.doesNotMatch(page, /depedGradingReviewModal|deped-grading-review-table|renderDepedGradingReviewBody/);
  assert.doesNotMatch(page, /school-k10-transition-note|these final-grade settings apply to numerical Grades 2/);
  new vm.Script(scripts.at(-1)[1], { filename: 'edugnay-admin-schools.inline.js' });
  const managementScripts = [...management.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(managementScripts.length);
  managementScripts.forEach((source, index) => new vm.Script(source, { filename: `edugnay-admin-management.inline-${index + 1}.js` }));
});

test('Grading Rules empty state has padded spacing and an un-underlined Manage subjects link', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  assert.match(styles, /\.school-k10-empty-state-actions\s*\{[^}]*padding:\s*16px 16px 24px;/s);
  assert.match(styles, /\.school-k10-empty-state-actions > \.top-btn\s*\{\s*text-decoration:\s*none;/);
});

test('missing DepEd confirmation lists only eligible subjects and grade scopes', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  const start = page.indexOf('    function formatK10GradeNames(');
  const end = page.indexOf('    function renderOtherGradeRules(', start);
  assert.ok(start >= 0 && end > start, 'grading summary and compact confirmation helpers are present');

  const components = (name, weight) => [{ name, weight, examParts: [] }];
  const preview = { subjects: [
    { id: 1, name: 'English', subjectCode: 'english-elementary', gradeCodes: ['grade-4', 'grade-5', 'grade-6'], learningArea: 'academic', status: 'configured', configurationSource: 'deped_default', components: components('Saved English weights', 20), defaultComponents: components('Incorrect suggested weights', 100) },
    { id: 2, name: 'English', subjectCode: 'english-grade-2', gradeCodes: ['grade-2'], learningArea: 'academic', status: 'configured', configurationSource: 'custom', components: components('School weights', 35), defaultComponents: components('DepEd weights', 20) },
    { id: 3, name: 'English', subjectCode: 'english-grade-3', gradeCodes: ['grade-3'], learningArea: 'academic', status: 'configured', configurationSource: 'deped_default', needsPolicyReview: true, components: components('Legacy English weights', 20), defaultComponents: components('DepEd weights', 20) },
    { id: 4, name: 'Filipino', subjectCode: 'filipino-elementary', gradeCodes: ['grade-5'], learningArea: 'academic', status: 'configured', configurationSource: 'copied_custom', components: components('Copied weights', 42), defaultComponents: components('DepEd weights', 20) },
    { id: 5, name: 'Mathematics', subjectCode: 'mathematics-grade-2', gradeCodes: ['grade-2'], learningArea: 'academic', status: 'ready', needsExamSetup: true, components: components('Suggested math weights', 20), defaultComponents: components('Suggested math weights', 20) },
    { name: 'Unmatched subject', gradeCodes: ['grade-3'], learningArea: null, status: 'unmatched', components: [], defaultComponents: [] },
    { id: 6, name: 'Science', subjectCode: 'science-elementary', gradeCodes: ['grade-6'], learningArea: 'academic', status: 'published', configurationSource: 'custom', components: components('Published school weights', 60), defaultComponents: components('Incorrect suggested weights', 100) },
    { id: 7, name: 'English', subjectCode: 'english-elementary', gradeCodes: ['grade-5'], learningArea: 'academic', status: 'published', configurationSource: null, components: components('Suggested locked weights', 20), defaultComponents: components('Suggested locked weights', 20) },
    { id: 8, name: 'Science', subjectCode: 'science-elementary', gradeCodes: ['grade-4', 'grade-5', 'grade-6'], learningArea: 'academic', status: 'ready', components: components('Suggested science weights', 20), defaultComponents: components('Suggested science weights', 20) }
  ] };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const context = {
    window: { EDUGNAY_CONFIG: { escapeHtml } },
    formatK10GradeNames: (codes, fallback) => codes?.length ? codes.join(', ') : fallback,
    createPreviewDefaults: subject => subject.defaultComponents || subject.components || [],
    preview,
    escapeHtml
  };
  vm.runInNewContext(`${page.slice(start, end)}\nmissingTargets = getMissingDepedGradingSubjects(preview.subjects); renderedConfirmation = renderMissingDepedDefaultsConfirmation(preview, escapeHtml);`, context);

  assert.deepEqual(Array.from(context.missingTargets, subject => subject.id), [8]);
  assert.match(context.renderedConfirmation, /This will add DepEd setups for 1 eligible subject\./);
  assert.match(context.renderedConfirmation, /<strong>Science<\/strong><span>G4, G5, G6<\/span>/);
  assert.match(context.renderedConfirmation, /Saved setups are unchanged\./);
  assert.match(context.renderedConfirmation, /Grades 2–3 still need an exam choice in Configure\./);
  assert.doesNotMatch(context.renderedConfirmation, /<table|<th>|English|Mathematics|Unmatched subject|Published school weights/);
  vm.runInNewContext(`emptyTargets = getMissingDepedGradingSubjects(preview.subjects.filter(subject => subject.id !== 8));`, context);
  assert.equal(context.emptyTargets.length, 0, 'customized, published, unmatched, and Grades 2–3 subjects are not apply targets');
  vm.runInNewContext(`englishGroups = groupK10SubjectsByLearningArea(preview.subjects).find(group => group.name === 'English');`, context);
  assert.equal(context.englishGroups.subjects.length, 4);
  assert.equal(context.englishGroups.grouped, true);
  vm.runInNewContext(`englishSetup = getK10CatalogGroupState(englishGroups); savedSetup = getK10CatalogGroupState({ subjects: [preview.subjects[0]] }); divergentSetup = getK10CatalogGroupState({ subjects: [preview.subjects[0], preview.subjects[1]] });`, context);
  assert.equal(context.englishSetup.label, 'Review exam setup');
  assert.equal(context.englishSetup.isSaved, false);
  assert.equal(context.savedSetup.label, 'Saved');
  assert.equal(context.divergentSetup.label, 'Different setups');
  assert.equal(context.divergentSetup.isSaved, false);
  vm.runInNewContext(`missingSetup = getK10CatalogGroupState({ subjects: [preview.subjects[0], preview.subjects[4]] }); lockedSetup = getK10CatalogGroupState({ subjects: [preview.subjects[6]] });`, context);
  assert.equal(context.missingSetup.label, 'Needs exam setup');
  assert.equal(context.lockedSetup.label, 'Published');
  const defaultComponents = [{
    code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20, examParts: []
  }, {
    code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50, examParts: []
  }, {
    code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 30 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 30 },
      { code: 'term-exam', name: 'Term Exam', weight: 40 }
    ]
  }];
  const alignmentProfile = (id, overrides = {}) => ({
    id, name: 'English', subjectCode: 'english-jhs', gradeCodes: ['grade-7'], learningArea: 'academic',
    status: 'configured', configurationSource: 'custom', components: JSON.parse(JSON.stringify(defaultComponents)),
    defaultComponents: JSON.parse(JSON.stringify(defaultComponents)), ...overrides
  });
  const defaultProfile = alignmentProfile(70);
  const customizedProfile = alignmentProfile(71, { components: JSON.parse(JSON.stringify(defaultComponents)) });
  customizedProfile.components[0].weight = 25;
  const secondNamedCustomProfile = alignmentProfile(72, { components: JSON.parse(JSON.stringify(defaultComponents)) });
  secondNamedCustomProfile.components[0].name = 'School Written Work';
  const earlyDefaults = JSON.parse(JSON.stringify(defaultComponents));
  earlyDefaults[2].examParts = [];
  const earlyProfile = (id, grade, overrides = {}) => ({
    id, name: 'English', subjectCode: `english-grade-${grade}`, gradeCodes: [`grade-${grade}`], learningArea: 'academic',
    status: 'configured', configurationSource: 'custom', components: JSON.parse(JSON.stringify(earlyDefaults)),
    defaultComponents: JSON.parse(JSON.stringify(earlyDefaults)), needsExamSetup: false, ...overrides
  });
  const earlyG2 = earlyProfile(2, 2);
  const earlyG3 = earlyProfile(3, 3);
  for (const subject of [earlyG2, earlyG3]) {
    subject.components[2].examParts = [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
    ];
  }
  const alignmentSubjects = {
    defaultProfile, customizedProfile, secondNamedCustomProfile, earlyG2, earlyG3,
    unmatched: { name: 'Local subject', status: 'unmatched', learningArea: null, defaultComponents: [], components: [] },
    missing: alignmentProfile(73, { status: 'ready', components: defaultComponents }),
    legacyEarly: earlyProfile(74, 3, { needsPolicyReview: true, components: [...JSON.parse(JSON.stringify(earlyDefaults))] }),
    publishedDefault: alignmentProfile(75, { status: 'published', configurationSource: 'deped_default' })
  };
  alignmentSubjects.missing.defaultComponents = JSON.parse(JSON.stringify(defaultComponents));
  alignmentSubjects.legacyEarly.components[2].examParts = [
    { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
    { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
  ];
  context.alignmentSubjects = alignmentSubjects;
  vm.runInNewContext(`
    alignmentFor = subjects => getK10CatalogGroupDepedAlignment({ subjects }, getK10CatalogGroupState({ subjects })).label;
    defaultAlignment = alignmentFor([alignmentSubjects.defaultProfile]);
    customAlignment = alignmentFor([alignmentSubjects.customizedProfile]);
    mixedAlignment = alignmentFor([alignmentSubjects.defaultProfile, alignmentSubjects.customizedProfile]);
    missingAlignment = alignmentFor([alignmentSubjects.defaultProfile, alignmentSubjects.missing]);
    unmatchedAlignment = alignmentFor([alignmentSubjects.unmatched]);
    earlyAlignment = alignmentFor([alignmentSubjects.earlyG2, alignmentSubjects.earlyG3]);
    pendingEarlyAlignment = alignmentFor([alignmentSubjects.earlyG2, { ...alignmentSubjects.earlyG3, needsExamSetup: true }]);
    reviewAlignment = alignmentFor([alignmentSubjects.legacyEarly]);
    publishedAlignment = alignmentFor([alignmentSubjects.publishedDefault]);
    differentlyNamedAlignment = alignmentFor([alignmentSubjects.customizedProfile, alignmentSubjects.secondNamedCustomProfile]);
  `, context);
  assert.equal(context.defaultAlignment, 'DepEd default');
  assert.equal(context.customAlignment, 'School-customized');
  assert.equal(context.mixedAlignment, 'Mixed');
  assert.equal(context.missingAlignment, 'Not set');
  assert.equal(context.unmatchedAlignment, 'No DepEd default');
  assert.equal(context.earlyAlignment, 'DepEd weights + school exam choice');
  assert.equal(context.pendingEarlyAlignment, 'Not set');
  assert.equal(context.reviewAlignment, 'Review needed');
  assert.equal(context.publishedAlignment, 'DepEd default');
  assert.equal(context.differentlyNamedAlignment, 'Mixed');
  const examProfile = (id, weight) => ({ id, status: 'configured', configurationSource: 'custom', gradeCodes: [`grade-${id}`], components: [{ code: 'examinations', componentType: 'examination', weight: 30, examParts: [{ code: 'term-exam', name: 'Term Exam', weight }] }] });
  context.examProfiles = [examProfile(4, 40), examProfile(5, 50)];
  vm.runInNewContext(`standardSplitSetup = getK10CatalogGroupState({ subjects: examProfiles });`, context);
  assert.equal(context.standardSplitSetup.label, 'Different setups');
  vm.runInNewContext(`oldSplitIsDefault = isDefaultK10ExamSplit([{name: 'Summative Test 1', weight: 50}, {name: 'Summative Test 2', weight: 50}]); policySplitIsDefault = isDefaultK10ExamSplit([{name: 'Summative Test 1', weight: 30}, {name: 'Summative Test 2', weight: 30}, {name: 'Term Exam', weight: 40}]);`, context);
  assert.equal(context.oldSplitIsDefault, false);
  assert.equal(context.policySplitIsDefault, true);
  vm.runInNewContext(`renderedExamSummary = renderK10ComponentSummary([{name: 'Examinations', weight: 30, examParts: [{name: 'Summative Test 1', weight: 50}, {name: 'Summative Test 2', weight: 50}]}], {showExamDetails: true});`, context);
  assert.match(context.renderedExamSummary, /Summative Test 1: 50%/);
  assert.match(context.renderedExamSummary, /Summative Test 2: 50%/);
  assert.match(page, /<th>Subject<\/th><th>Grade levels<\/th><th>Components and weights<\/th><th>DepEd alignment<\/th><th>Setup status<\/th><th>Action<\/th>/);
  assert.match(page, /renderK10GroupedSubjectRows\(preview\.subjects, group =>/);
  assert.match(page, /data-k10-configure-group=/);
  assert.match(page, /openK10CatalogGroupEditor\(group, preview\)/);
  assert.match(page, /saveK10CatalogSubjectGroupConfig\(/);
  assert.match(page, /Use the Grades 4[\s\S]{0,10}6 split \(30\/30\/40\)/);
  assert.match(page, /Choose an option/);
  assert.match(page, /Apply shared setup to editable grades/);
  assert.match(page, /formatK10GradeNames\(gradeCodes, 'No eligible Grade 2[\s\S]{0,5}10 scope'\)/);
  assert.match(page, /formatK10GradeNames\(subject\.gradeCodes, 'Grade scope not set'\)/);
  assert.match(page, /title: 'No eligible subjects yet'/);
  assert.match(page, /Manage subjects/);
  assert.match(page, /localStorage\.setItem\('managementTab','subjects'\)/);
  assert.match(page, /class="school-k10-grading-source badge \$\{setup\.badgeClass\}">\$\{escapeHtml\(setup\.label\)\}/);
  assert.doesNotMatch(page, /renderK10CatalogGroupDetails|school-k10-grade-details|school-k10-row-details-open/);
  assert.doesNotMatch(styles, /school-k10-grade-details|school-k10-row-details-open/);
  assert.match(page, /renderK10GroupExceptions\(\)/);
  assert.match(page, /data-k10-edit-exception=/);
  assert.match(page, /subjectGradingEditorFooter'\)\.hidden = !editable\.length/);
  assert.match(page, /function getMissingDepedGradingSubjects\(subjects\)/);
  assert.match(page, /function renderMissingDepedDefaultsConfirmation\(preview, escapeHtml\)/);
  assert.match(page, /id="openApplyMissingDepedDefaults"/);
  assert.match(page, /openApplyMissingDepedDefaults\(\)/);
  assert.match(page, /getDepedK10GradingPreview\(\{ academicYearId: year\.id, schoolLevelId: apiLevel\.id \}\)/);
  assert.match(page, /No missing DepEd setups to apply\./);
  assert.match(page, /Apply to \$\{targets\.length\} subject/);
  assert.match(page, /result\.added\.length/);
  assert.match(page, /Added DepEd setups to \$\{count\} subject/);
  assert.doesNotMatch(page, /depedGradingReviewModal|deped-grading-review-table|renderDepedGradingReviewBody/);
  assert.match(page, /result\.needsExamSetup/);
  assert.match(page, /Grades 2–3 still need an exam choice in Configure/);
  assert.match(page, /!isK10EarlyGradeSubject\(subject\)/);
  assert.match(page, /Published grades lock this setup\./);
  assert.match(page, /<th>Components and weights<\/th><th>DepEd alignment<\/th><th>Setup status<\/th>/);
  assert.match(page, /id="restoreDepedDefaults" hidden>Restore DepEd defaults<\/button>/);
  assert.match(page, /Any unsaved changes in the editor will be discarded/);
  assert.match(page, /id="restoreDepedDefaultsConfirmation"[^>]*hidden/);
  assert.match(page, /\['custom', 'copied_custom'\]\.includes\(subject\.configurationSource\)/);
  assert.match(page, /restoreDepedSubjectDefaults\(/);
  assert.ok(page.includes("restoreDepedSubjectDefaults({"), 'the editor calls the restore API');
  assert.match(page, /restoreDepedCatalogSubjectGroupDefaults\(/);
  assert.match(page, /function getK10GroupRestoreTargets\(\)/);
  assert.match(page, /function renderK10GroupRestoreSummary\(/);
  assert.match(page, /Saved Grades 2–3 exam choices are preserved/);
  assert.match(page, /profiles needing review are left unchanged/);
  assert.match(styles, /\.school-k10-restore-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.school-k10-restore-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.school-k10-grading-row-note,\s*\.school-k10-grading-action-note/);
  assert.match(styles, /\.school-k10-grading-table-wrap\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%/s);
  assert.match(styles, /\.school-k10-grading-table-wrap\s*\{\s*overflow-x:\s*auto;\s*\}/);
  assert.match(styles, /\.school-k10-grading-table thead th\s*\{[^}]*background:\s*var\(--gray-50, #f7f9fc\)/s);
  assert.doesNotMatch(styles, /\.school-k10-grading-table-wrap\s*\{[^}]*(?:border:|border-radius:)/s);
  assert.match(styles, /\.school-k10-grading-table\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed/s);
  assert.doesNotMatch(styles, /\.school-k10-grading-table-wrap\s*\{[^}]*width:\s*fit-content/s);
  assert.doesNotMatch(styles, /\.school-k10-grading-table\s*\{[^}]*width:\s*fit-content/s);
  assert.equal((styles.match(/\.school-k10-grading-table th:nth-child\(3\),\s*\.school-k10-grading-table td:nth-child\(3\)/g) || []).length, 1);
  assert.match(styles, /\.school-k10-grading-table th:nth-child\(3\),\s*\.school-k10-grading-table td:nth-child\(3\) \{ width: 250px; max-width: 270px; \}/);
  assert.doesNotMatch(styles, /\.school-k10-grading-table th:nth-child\(3\),\s*\.school-k10-grading-table td:nth-child\(3\) \{ width: 40%;/);
  assert.match(styles, /\.school-k10-grading-table th:nth-child\(4\),\s*\.school-k10-grading-table td:nth-child\(4\) \{ width: 22%; \}/);
  assert.match(styles, /\.school-k10-grading-table th:nth-child\(5\),\s*\.school-k10-grading-table td:nth-child\(5\) \{ width: 15%; \}/);
  assert.match(styles, /\.school-k10-grading-table th:nth-child\(6\),\s*\.school-k10-grading-table td:nth-child\(6\) \{ width: 9%; \}/);
  assert.match(styles, /\.school-k10-grading-table td:nth-child\(4\) \.school-k10-grading-source\s*\{\s*white-space:\s*nowrap;/);
  assert.match(styles, /@media \(max-width: 1280px\)[\s\S]*?\.school-k10-grading-table tbody tr\s*\{\s*position:\s*relative;\s*display:\s*flex;\s*flex-wrap:\s*wrap;/);
  assert.match(styles, /@media \(max-width: 1280px\)[\s\S]*?\.school-k10-grading-table\s*\{\s*display:\s*block;\s*width:\s*100%;\s*table-layout:\s*fixed;/);
  assert.match(page, /<td data-label="Grade levels">/);
  assert.match(page, /<td data-label="Components and weights">/);
  assert.match(page, /<td data-label="DepEd alignment">/);
  assert.match(page, /<td data-label="Setup status">/);
  assert.match(styles, /\.school-k10-grading-table tbody\s*\{\s*display:\s*grid;\s*\}/);
  assert.match(styles, /\.school-k10-grading-table tbody tr\s*\{[^}]*gap:\s*0 18px;[^}]*padding:\s*16px 12px;[^}]*border-bottom:\s*1px solid var\(--gray-100, #edf1f7\);/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr:last-child\s*\{\s*border-bottom:\s*0;/);
  assert.doesNotMatch(styles, /\.school-k10-grading-table tbody tr\s*\{[^}]*(?:border-radius:|background:)/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr > td:nth-child\(n\)\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*none;[^}]*padding:\s*0;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td\[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\);/s);
  assert.doesNotMatch(styles, /\.school-k10-grading-table tbody td:nth-child\(2\)::before\s*\{\s*display:\s*none;/);
  assert.match(styles, /\.school-k10-grading-table tbody tr > td:nth-child\(1\),\s*\.school-k10-grading-table tbody tr > td:nth-child\(2\)\s*\{\s*flex:\s*0 0 100%;\s*padding-right:\s*136px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(2\)\s*\{\s*margin-top:\s*6px;/);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(3\)\s*\{\s*flex:\s*0 0 100%;\s*margin-top:\s*16px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(4\)\s*\{\s*flex:\s*0 1 auto;\s*margin-top:\s*16px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr > td:nth-child\(5\)\s*\{[^}]*margin-top:\s*16px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(6\)\s*\{\s*position:\s*absolute;\s*top:\s*16px;\s*right:\s*16px;/s);
  assert.match(styles, /\.school-k10-grading-table \.school-k10-grading-weights\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(6\) \.top-btn\s*\{[^}]*min-width:\s*112px;[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr\.panel-empty-row > td\s*\{\s*flex:\s*1 1 100%;\s*padding-right:\s*0;/s);
  assert.match(styles, /\.deped-grading-apply-modal \.modal\s*\{[^}]*max-width:\s*560px/s);
  assert.match(styles, /\.school-k10-deped-confirmation-list\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.school-k10-deped-confirmation-list li\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(styles, /deped-grading-review-table|deped-grading-review-subject/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.school-k10-grading-table tbody tr\s*\{\s*padding:\s*14px 12px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr > td:nth-child\(n\)\s*\{\s*flex:\s*0 0 100%;\s*width:\s*100%;/s);
  assert.match(styles, /\.school-k10-grading-table tbody tr > td:nth-child\(6\)\s*\{\s*position:\s*static;\s*margin-top:\s*16px;/s);
  assert.match(styles, /\.school-k10-grading-table tbody td:nth-child\(6\) \.top-btn\s*\{\s*width:\s*100%;/);
  assert.match(styles, /\.school-k10-group-exceptions\s*\{/);
  assert.match(styles, /\.school-k10-exam-policy\s*\{/);
  assert.match(styles, /\.school-k10-exam-policy-row\s*\{/);
  assert.match(styles, /\.school-k10-group-exception\s*\{/);
  assert.match(styles, /\.school-k10-group-exam-part\s*\{/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.school-k10-group-exam-part\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(page, /DepEd weights vary by subject\./);
  assert.match(page, /\$\{applyMissingButton \? `<div class="school-k10-grading-toolbar">\$\{applyMissingButton\}<\/div>` : ''\}/);
  assert.match(styles, /\.school-k10-grading-toolbar\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.doesNotMatch(styles, /school-k10-grading-policy-note/);
});

test('Configure shows grade details only for exceptions and keeps published profiles read-only', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const helpersStart = page.indexOf('    function formatK10GradeNames(');
  const helpersEnd = page.indexOf('    function renderOtherGradeRules(', helpersStart);
  const exceptionsStart = page.indexOf('    function renderK10GroupExceptions(');
  const exceptionsEnd = page.indexOf('    function openK10CatalogGroupEditor(', exceptionsStart);
  const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const context = {
    window: { EDUGNAY_CONFIG: { escapeHtml } },
    formatK10GradeNames: codes => codes.join(', '),
    state: { k10EditorGroup: null }
  };
  vm.runInNewContext(page.slice(helpersStart, helpersEnd) + page.slice(exceptionsStart, exceptionsEnd), context);
  const saved = { id: 2, status: 'configured', configurationSource: 'custom', gradeCodes: ['grade-2'], components: [{ code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: [{ code: 'summative-test-1', name: 'Summative Test 1', weight: 50 }, { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }] }] };
  const pending = { id: 3, status: 'ready', needsExamSetup: true, gradeCodes: ['grade-3'], components: [] };
  const locked = { id: 4, status: 'published', configurationSource: 'custom', gradeCodes: ['grade-4'], components: [{ code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30, examParts: [{ code: 'term-exam', name: 'Term Exam', weight: 40 }] }] };
  context.state.k10EditorGroup = { allSubjects: [saved] };
  assert.equal(vm.runInNewContext('renderK10GroupExceptions()', context), '');
  context.state.k10EditorGroup = { allSubjects: [saved, pending, locked] };
  const exceptions = vm.runInNewContext('renderK10GroupExceptions()', context);
  assert.match(exceptions, /G4/);
  assert.doesNotMatch(exceptions, /G3/);
  assert.doesNotMatch(exceptions, /G2/);
  assert.match(exceptions, /Grade-specific exceptions/);
  assert.doesNotMatch(exceptions, /data-k10-edit-exception="3"/);
  assert.doesNotMatch(exceptions, /data-k10-edit-exception="4"/);
  const divergent = { ...saved, id: 5, gradeCodes: ['grade-3'], components: [{ ...saved.components[0], examParts: [{ code: 'summative-test-1', name: 'Summative Test 1', weight: 40 }, { code: 'summative-test-2', name: 'Summative Test 2', weight: 60 }] }] };
  context.state.k10EditorGroup = { allSubjects: [saved, divergent] };
  const conflicting = vm.runInNewContext('renderK10GroupExceptions()', context);
  assert.match(conflicting, /G2/);
  assert.match(conflicting, /G3/);
  assert.match(conflicting, /data-k10-edit-exception="2"/);
  assert.match(conflicting, /data-k10-edit-exception="5"/);
  context.state.k10EditorGroup = { allSubjects: [locked] };
  const published = vm.runInNewContext('renderK10GroupExceptions()', context);
  assert.match(published, /Term Exam: 40%/);
  assert.doesNotMatch(published, /data-k10-edit-exception/);
  assert.match(page, /Unsaved shared changes will be discarded/);
  assert.match(page, /!state\.k10EditorGroup\.subjects\.length/);
});

test('grouped editor organizes component weights and both exam setups into clear sections', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  const start = page.indexOf('    function renderK10EarlyExamGroupEditor(');
  const end = page.indexOf('    function renderSubjectGradingEditor(', start);
  assert.ok(start >= 0 && end > start);
  const escapeHtml = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const standard = { id: 6, status: 'configured', gradeCodes: ['grade-4', 'grade-5', 'grade-6'], components: [{ componentType: 'examination', examParts: [{ name: 'Summative Test 1', weight: 30 }, { name: 'Summative Test 2', weight: 30 }, { name: 'Term Exam', weight: 40 }] }] };
  const context = {
    window: { EDUGNAY_CONFIG: { escapeHtml } },
    state: { k10EditorGroup: { subjects: [standard], allSubjects: [standard] }, k10EarlyExamChoice: null, k10EarlyExamParts: [] },
    isK10EarlyGradeSubject: subject => subject.gradeCodes.some(code => ['grade-2', 'grade-3'].includes(code)),
    formatK10GradeNames: codes => codes.map(code => code.replace('grade-', 'G')).join(', '),
    getK10ExamParts: subject => subject.components[0].examParts,
    isDefaultK10ExamSplit: parts => parts.length === 3 && parts[0].weight === 30 && parts[1].weight === 30 && parts[2].weight === 40
  };
  vm.runInNewContext(page.slice(start, end), context);
  const prescribed = vm.runInNewContext('renderK10GroupStandardExamSummary()', context);
  assert.match(prescribed, /DepEd exam split · G4, G5, G6/);
  assert.match(prescribed, /ST1 30% · ST2 30% · Term exam 40%/);
  assert.doesNotMatch(prescribed, /Saved custom split/);
  context.state.k10EditorGroup.allSubjects = [{ ...standard, components: [{ componentType: 'examination', examParts: [{ name: '<Custom ST>', weight: 50 }, { name: 'Term Exam', weight: 50 }] }] }];
  const custom = vm.runInNewContext('renderK10GroupStandardExamSummary()', context);
  assert.match(custom, /Saved custom split · G4, G5, G6/);
  assert.match(custom, /&lt;Custom ST&gt; 50% · Term Exam 50%/);
  assert.doesNotMatch(custom, /<Custom ST>/);
  context.state.k10EditorGroup.allSubjects = [standard];
  const section = vm.runInNewContext(`renderK10GroupStandardExamSection([${JSON.stringify(standard.components[0])}], true)`, context);
  assert.match(section, /Grades 4–6 exam setup/);
  assert.match(section, /DepEd exam split · G4, G5, G6/);
  assert.match(section, /data-part-field="code"/);
  assert.match(section, /value="30"/);
  assert.match(section, /data-add-exam-part="0"/);
  assert.match(section, /ST1 30% · ST2 30% · Term exam 40%/);
  assert.match(section, /Percentages are within Examinations/);
  assert.doesNotMatch(section, /subject-grading-component-card/);
  const jhsSubject = { ...standard, id: 7, gradeCodes: ['grade-7', 'grade-8', 'grade-9', 'grade-10'] };
  context.state.k10EditorGroup.allSubjects = [jhsSubject];
  const jhsSection = vm.runInNewContext(`renderK10GroupStandardExamSection([${JSON.stringify(standard.components[0])}], true)`, context);
  assert.match(jhsSection, /JHS exam setup/);
  assert.match(jhsSection, /DepEd exam split · G7, G8, G9, G10/);
  assert.doesNotMatch(jhsSection, /Grades 4–6 and JHS exam setup|Grades 4–6 exam setup/);
  context.state.k10EditorGroup.allSubjects = [standard, jhsSubject];
  const combinedSection = vm.runInNewContext(`renderK10GroupStandardExamSection([${JSON.stringify(standard.components[0])}], true)`, context);
  assert.match(combinedSection, /Grades 4–6 and JHS exam setup/);
  const customSubject = { ...standard, components: [{ ...standard.components[0], examParts: [{ name: 'Custom Test', code: 'custom-test', weight: 50 }, { name: 'Term Exam', code: 'term-exam', weight: 50 }] }] };
  context.state.k10EditorGroup.allSubjects = [customSubject];
  const customSection = vm.runInNewContext(`renderK10GroupStandardExamSection([${JSON.stringify(customSubject.components[0])}], true)`, context);
  assert.match(customSection, /Saved custom split/);
  assert.match(customSection, /DepEd exam split · G4, G5, G6/);
  assert.match(customSection, /ST1 30% · ST2 30% · Term exam 40%/);
  assert.match(customSection, /value="50"/);
  const banner = vm.runInNewContext('renderK10GroupExamInfoBanner()', context);
  assert.match(banner, /school-k10-exam-info-banner/);
  assert.match(banner, /Grades 4–6 and JHS follow the DepEd exam split shown below/);
  assert.match(page, /school-k10-standard-exam-editor/);
  assert.match(page, /document\.querySelectorAll\('#subjectGradingEditorBody \.school-k10-standard-exam-editor'\)/);
  assert.match(page, /school-k10-component-columns/);
  assert.match(page, /aria-label="Component code"/);
  assert.match(page, /school-k10-editor-section school-k10-components-section/);
  assert.match(page, /\$\{hasAnyStandard \? renderK10GroupStandardExamSection\(displayComponents, hasEditableStandard\) : ''\}\$\{earlyExamNote\}/);
  assert.match(styles, /\.school-k10-exam-info-banner\s*\{[^}]*background:\s*var\(--blue-xpale\)/s);
  assert.match(styles, /\.school-k10-component-columns,\s*\.school-k10-group-component-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.school-k10-component-columns,\s*\.school-k10-group-component-grid\s*\{[^}]*grid-template-columns:\s*minmax\(100px, \.85fr\) minmax\(150px, 1\.35fr\) minmax\(145px, 1\.1fr\) minmax\(88px, \.65fr\) 100px;/s);
  assert.match(styles, /\.school-k10-component-columns\s*\{\s*padding:\s*0 12px 7px;/);
  assert.match(styles, /\.school-k10-group-component-grid > button\s*\{\s*box-sizing:\s*border-box;\s*width:\s*100px;/);
  assert.doesNotMatch(styles, /grid-template-columns:\s*minmax\(100px, \.85fr\) minmax\(150px, 1\.35fr\) minmax\(145px, 1\.1fr\) minmax\(88px, \.65fr\) auto/);
  assert.match(styles, /\.school-k10-component-table,\s*\.school-k10-standard-exam-editor \.school-k10-exam-part-list\s*\{\s*display:\s*grid;\s*gap:\s*8px;/);
  assert.match(styles, /\.school-k10-group-component-row\s*\{[^}]*border:\s*0;\s*border-radius:/s);
  assert.doesNotMatch(styles, /\.school-k10-group-component-row\s*\{[^}]*border-bottom:/s);
  assert.match(styles, /\.school-k10-exam-part-columns\s*\{\s*padding:\s*0 0 7px;/);
  assert.match(styles, /\.school-k10-exam-part-columns,\s*\.school-k10-standard-exam-editor \.subject-grading-exam-part,\s*\.school-k10-group-exam-part\s*\{[^}]*grid-template-columns:\s*minmax\(110px, \.85fr\) minmax\(160px, 1\.4fr\) minmax\(88px, \.65fr\) 92px;/s);
  assert.match(styles, /\.school-k10-group-exam-part > button,\s*\.school-k10-standard-exam-editor \.subject-grading-exam-part > button\s*\{[^}]*width:\s*92px;/s);
  assert.doesNotMatch(styles, /grid-template-columns:\s*minmax\(110px, \.85fr\) minmax\(160px, 1\.4fr\) minmax\(88px, \.65fr\) auto/);
  assert.match(styles, /\.school-k10-custom-split-label\s*\{/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.school-k10-group-component-grid[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.school-k10-group-component-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.school-k10-component-columns,\s*\.school-k10-exam-part-columns\s*\{\s*display:\s*none;/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.school-k10-group-exam-part,\s*\.school-k10-standard-exam-editor \.subject-grading-exam-part\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*?\.school-k10-group-exam-part,\s*\.school-k10-standard-exam-editor \.subject-grading-exam-part\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(page, /const individualExamParts = !state\.k10EditorGroup && component\.componentType === 'examination'/);
  assert.doesNotMatch(page, /\$\{policySplit\}/);
  const early = { id: 3, status: 'ready', needsExamSetup: true, gradeCodes: ['grade-3'] };
  context.state.k10EditorGroup = { subjects: [early], allSubjects: [standard, early] };
  assert.match(vm.runInNewContext('renderK10GroupExamInfoBanner()', context), /term exam is optional where appropriate/);
  const needsSetupSection = vm.runInNewContext('renderK10EarlyExamGroupEditor()', context);
  assert.match(needsSetupSection, /One school choice for both grades/);
  assert.doesNotMatch(needsSetupSection, /G3 needs setup|school-k10-exam-status/);
  context.state.k10EditorGroup = { subjects: [{ ...early, needsExamSetup: false, needsPolicyReview: true }], allSubjects: [early] };
  const needsReviewSection = vm.runInNewContext('renderK10EarlyExamGroupEditor()', context);
  assert.match(needsReviewSection, /One school choice for both grades/);
  assert.doesNotMatch(needsReviewSection, /Review saved choice|school-k10-exam-status/);
});

test('grouped editor collector reads standard exam parts from their new section', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const start = page.indexOf('    function collectSubjectGradingEditor(');
  const end = page.indexOf('    function collectK10EarlyExamEditor(', start);
  assert.ok(start >= 0 && end > start);
  const values = new Map([
    ['[data-component-field="code"]', 'examinations'],
    ['[data-component-field="name"]', 'Examinations'],
    ['[data-component-field="type"]', 'examination'],
    ['[data-component-field="weight"]', '30'],
    ['[data-part-field="code"]', 'term-exam'],
    ['[data-part-field="name"]', 'Term Exam'],
    ['[data-part-field="weight"]', '40']
  ]);
  const part = {
    dataset: { partId: '44' },
    querySelector: selector => ({ value: values.get(selector) })
  };
  const editor = { dataset: { componentIndex: '0' }, querySelectorAll: () => [part] };
  const card = {
    dataset: { componentId: '12' },
    querySelector: selector => ({ value: values.get(selector) }),
    querySelectorAll: () => []
  };
  const context = {
    state: { k10EditorGroup: {} },
    document: {
      querySelectorAll: selector => selector.includes('school-k10-standard-exam-editor') ? [editor] : [card]
    }
  };
  vm.runInNewContext(page.slice(start, end), context);
  const collected = vm.runInNewContext('collectSubjectGradingEditor()', context);
  assert.equal(collected[0].code, 'examinations');
  assert.deepEqual(JSON.parse(JSON.stringify(collected[0].examParts)), [
    { id: 44, code: 'term-exam', name: 'Term Exam', weight: 40, sortOrder: 1 }
  ]);
});

test('group save preserves untouched standard exam parts and applies intentional edits only to editable standard grades', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const start = page.indexOf('    function getK10ExamPartsSignature(');
  const end = page.indexOf('    function renderK10EarlyExamGroupEditor(', start);
  assert.ok(start >= 0 && end > start);
  const context = { isK10EarlyGradeSubject: subject => subject.gradeCodes.includes('grade-2') };
  vm.runInNewContext(page.slice(start, end), context);
  const parts = (first, second) => [
    { code: 'summative-test-1', name: 'Summative Test 1', weight: first },
    { code: 'term-exam', name: 'Term Exam', weight: second }
  ];
  const standard = (id, savedParts) => ({ id, status: 'configured', gradeCodes: [`grade-${id}`], components: [{ id: id * 10, code: 'examinations', componentType: 'examination', examParts: savedParts }] });
  const first = standard(4, parts(50, 50));
  const second = standard(5, parts(60, 40));
  const early = { id: 2, status: 'configured', gradeCodes: ['grade-2'], components: [{ code: 'examinations', componentType: 'examination', examParts: parts(70, 30) }] };
  const edited = [{ code: 'examinations', componentType: 'examination', weight: 30, examParts: parts(30, 70) }];
  const originalSignature = vm.runInNewContext('getK10ExamPartsSignature', context)(first.components[0].examParts);
  assert.equal(originalSignature, vm.runInNewContext('getK10ExamPartsSignature', context)(first.components[0].examParts.map(part => ({ ...part, id: 99, sortOrder: 1 }))));
  const map = vm.runInNewContext('mapK10ComponentsToProfile', context);
  assert.deepEqual(map(edited, first, [], false)[0].examParts.map(part => part.weight), [50, 50]);
  assert.deepEqual(map(edited, second, [], false)[0].examParts.map(part => part.weight), [60, 40]);
  assert.deepEqual(map(edited, first, [], true)[0].examParts.map(part => part.weight), [30, 70]);
  assert.deepEqual(map(edited, second, [], true)[0].examParts.map(part => part.weight), [30, 70]);
  assert.deepEqual(map(edited, early, parts(20, 80), true)[0].examParts.map(part => part.weight), [20, 80]);
  assert.match(page, /standardExamEdited = hasStandardGrades && getK10ExamPartsSignature\(standardExamParts\) !== state\.k10StandardExamOriginal/);
  assert.match(page, /mapK10ComponentsToProfile\(state\.k10EditorComponents, item, earlyParts, standardExamEdited\)/);
});

test('Elementary final-grade settings keep their spacing without the redundant note', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  assert.doesNotMatch(page, /school-k10-transition-note|school-k10-transition-icon|school-k10-transition-text/);
  assert.match(page, /id="k10GradingModeHelp"/);
  assert.match(page, /id="k10PassingGradeHelp"/);
  assert.match(page, /preview\.periodStructureWarning/);
  assert.match(styles, /\.school-k10-grading-panel\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(styles, /\.school-k10-grading-panel\s*>\s*:not\(\.school-k10-final-rules\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(styles, /\.school-k10-final-rules\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*width:\s*66\.6667%;[^}]*justify-self:\s*start;[^}]*box-sizing:\s*border-box;[^}]*gap:\s*16px;/s);
  assert.match(styles, /\.school-k10-final-rules-form\s*>\s*\.school-form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+120px\s+minmax\(0,\s*1fr\);[^}]*max-width:\s*none;[^}]*margin-top:\s*0;/s);
  assert.match(styles, /\.school-k10-final-rules-form\s+#k10PassingGradeThreshold\s*\{[^}]*width:\s*120px;/s);
  assert.match(styles, /@media\s*\(max-width:\s*1200px\)\s*\{[^}]*\.school-k10-final-rules-form\s*>\s*\.school-form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*max-width:\s*460px;/s);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)\s*\{[^}]*\.school-k10-grading-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.school-k10-final-rules\s*\{[^}]*width:\s*100%;/s);
});

