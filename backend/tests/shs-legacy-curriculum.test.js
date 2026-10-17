const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const databaseModule = require('../config/database');
const { LEGACY_SHS_GRADING_GROUPS, LEGACY_SHS_GRADING_TYPES, SHS_STRANDS, SHS_TRACKS, transmuteLegacyShsInitialGrade } = require('../config/shsCurriculum');

let database;
databaseModule.getDatabase = () => database;
const { listGradingCategories, updateGradingCategories } = require('../controllers/academicTermsController');

const baseCategories = [
  { id: 1, schoolLevelId: 3, code: 'ww', name: 'Written Work', weight: '30.00' },
  { id: 2, schoolLevelId: 3, code: 'pt', name: 'Performance Task', weight: '50.00' },
  { id: 3, schoolLevelId: 3, code: 'qa', name: 'Quarterly Assessment', weight: '20.00' }
];

async function call({ role = 'teacher', query = {}, contextRows = [{ schoolLevelId: 3, schoolLevelCode: 'shs', shsGradingGroup: 'core' }] } = {}) {
  const statements = [];
  database = {
    async execute(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('FROM section_teachers')) return [contextRows];
      if (sql.includes('FROM published_final_grades AS grades')) return [[{ gradeCount: '7' }]];
      if (sql.includes('FROM grading_categories')) return [baseCategories];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = { data: null, error: null };
  await listGradingCategories({ user: { role, id: 22, schoolId: 9 }, query }, {
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return { ...result, statements };
}

test('legacy SHS tracks and strands use the older curriculum taxonomy', () => {
  assert.deepEqual(SHS_TRACKS.map(track => track.code), ['academic', 'tvl', 'arts-design', 'sports']);
  assert.deepEqual(SHS_STRANDS.academic.map(([code]) => code), ['stem', 'abm', 'humss', 'gas']);
  assert.deepEqual(SHS_STRANDS.tvl.map(([code]) => code), ['agri-fishery-arts', 'home-economics', 'ict', 'industrial-arts']);
  assert.deepEqual(SHS_STRANDS['arts-design'], []);
  assert.deepEqual(SHS_STRANDS.sports, []);
  assert.deepEqual(Object.fromEntries(Object.entries(LEGACY_SHS_GRADING_GROUPS)
    .map(([code, group]) => [code, [group.weights.ww, group.weights.pt, group.weights.qa]])), {
    core: [25, 50, 25],
    academic_other: [25, 45, 30],
    academic_immersion: [35, 40, 25],
    other_other: [20, 60, 20],
    other_immersion: [20, 60, 20]
  });
  assert.deepEqual(LEGACY_SHS_GRADING_TYPES.map(type => type.code), Object.keys(LEGACY_SHS_GRADING_GROUPS));
  assert.deepEqual(LEGACY_SHS_GRADING_TYPES.map(type => type.weights), Object.values(LEGACY_SHS_GRADING_GROUPS).map(group => group.weights));
  Object.values(LEGACY_SHS_GRADING_GROUPS).forEach(group => {
    assert.equal(Object.values(group.weights).reduce((sum, weight) => sum + weight, 0), 100);
  });
});

test('legacy SHS transmutation follows the DepEd initial-grade boundaries', () => {
  for (const [initial, expected] of [
    [0, 60], [3.99, 60], [4, 61], [59.99, 74], [60, 75], [61.59, 75],
    [61.6, 76], [74.39, 83], [74.4, 84], [98.4, 99], [99.99, 99], [100, 100]
  ]) assert.equal(transmuteLegacyShsInitialGrade(initial), expected, `Initial grade ${initial}`);
  assert.equal(transmuteLegacyShsInitialGrade(-0.01), null);
  assert.equal(transmuteLegacyShsInitialGrade(100.01), null);
});

test('migration preserves historical section tracks without guessing a strand', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../database/migrations/038_legacy_shs_tracks_strands_and_subject_scopes.sql'), 'utf8');
  const sectionAlterStatements = migration.split(';').filter(statement => /ALTER TABLE sections/i.test(statement));
  assert.match(migration, /CHANGE COLUMN strand_id track_id/);
  assert.match(migration, /ADD COLUMN strand_id BIGINT UNSIGNED NULL/);
  assert.doesNotMatch(migration, /UPDATE\s+sections\s+SET\s+strand_id\s*=/i);
  assert.match(migration, /INSERT INTO subject_grade_scopes/);
  const sqlComments = migration.split(/\r?\n/).filter(line => /^\s*--/.test(line)).join('\n');
  assert.doesNotMatch(sqlComments, /;/);
  assert.equal(sectionAlterStatements.length, 2);
  assert.match(sectionAlterStatements[0], /DROP FOREIGN KEY fk_sections_tenant_track/i);
  assert.doesNotMatch(sectionAlterStatements[0], /ADD CONSTRAINT fk_sections_tenant_track/i);
  assert.match(sectionAlterStatements[1], /ADD CONSTRAINT fk_sections_tenant_track/i);
});

test('teacher grading categories use the configured weights for the assigned SHS subject group', async () => {
  for (const [groupCode, group] of Object.entries(LEGACY_SHS_GRADING_GROUPS)) {
    const result = await call({ query: { schoolLevelId: '3', sectionId: '18', subjectId: '42' },
      contextRows: [{ schoolLevelId: 3, schoolLevelCode: 'shs', shsGradingGroup: groupCode }] });
    assert.equal(result.error, null);
    assert.equal(result.data.gradingScale, 'legacy_shs_transmutation');
    assert.deepEqual(result.data.gradingCategories.map(category => category.weight), [
      group.weights.ww, group.weights.pt, group.weights.qa
    ]);
    assert.deepEqual(result.statements[0].values, [9, 22, 18, 42]);
  }
});

test('category weights stay at school settings for non-SHS and unclassified subjects', async () => {
  const nonShs = await call({ query: { schoolLevelId: '2', sectionId: '18', subjectId: '42' },
    contextRows: [{ schoolLevelId: 2, schoolLevelCode: 'jhs', shsGradingGroup: null }] });
  assert.deepEqual(nonShs.data.gradingCategories.map(category => category.weight), [30, 50, 20]);

  const unclassified = await call({ query: { sectionId: '18', subjectId: '42' },
    contextRows: [{ schoolLevelId: 3, schoolLevelCode: 'shs', shsGradingGroup: null }] });
  assert.deepEqual(unclassified.data.gradingCategories.map(category => category.weight), [30, 50, 20]);
});

test('contextual category weights require an assigned teacher and matching school level', async () => {
  const unauthorized = await call({ role: 'school_admin', query: { sectionId: '18', subjectId: '42' } });
  assert.equal(unauthorized.error.status, 403);
  assert.equal(unauthorized.statements.length, 0);

  const mismatch = await call({ query: { schoolLevelId: '2', sectionId: '18', subjectId: '42' } });
  assert.equal(mismatch.error.status, 409);
  assert.equal(mismatch.statements.length, 1);

  const unassigned = await call({ query: { sectionId: '18', subjectId: '42' }, contextRows: [] });
  assert.equal(unassigned.error.status, 404);
  assert.equal(unassigned.statements.length, 1);
});

test('School Admin settings display SHS weights and final-grade rules together without subtabs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  assert.match(html, /Subject weights/);
  assert.match(html, /Final grade rules/);
  assert.match(html, /school-shs-weight-section/);
  assert.match(html, /school-shs-weight-table/);
  assert.match(html, /\$\{isShs \? `\$\{subjectWeightTable\}\$\{finalGradeRules\}\$\{saveButton\}`/);
  assert.doesNotMatch(html, /shsGradingSubtab|school-grading-subtabs|school-grading-subpane|data-shs-grading-subtab/);
  assert.doesNotMatch(html, /school-shs-weight-intro|These fixed weights follow the older SHS curriculum/);
  assert.match(html, /SHS term grades use the curriculum transmutation table/);
  assert.match(html, /publishedShsGradeCount/);
});

test('teacher grade UI distinguishes SHS initial estimates from transmuted term grades', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
  assert.match(html, /CURRENT_GRADE_SCALE === 'legacy_shs_transmutation'/);
  assert.match(html, /Weighted initial grade estimate\. Open Publish Preview to see its transmuted term grade\./);
  assert.match(html, /The weighted initial grade is converted to the reported term grade using the DepEd transmutation table\./);
  assert.doesNotMatch(html, /older SHS curriculum/);
  assert.match(html, /Initial \$\{Number\(student\.initialGrade\)\.toFixed\(2\)\} → Term \$\{student\.finalGrade\}/);
});

test('SHS user-facing validation copy describes the current curriculum without old or legacy labels', () => {
  const files = [
    '../../backend/controllers/academicTermsController.js',
    '../../backend/controllers/gradesController.js',
    '../../backend/controllers/subjectsController.js',
    '../../backend/controllers/sectionsController.js'
  ];
  const copy = files.map(relativePath => fs.readFileSync(path.join(__dirname, relativePath), 'utf8')).join('\n');
  assert.doesNotMatch(copy, /\b(?:old|older|legacy)\s+(?:SHS|Senior High School)\b/i);
});

test('SHS grading UI and shared API scripts parse', () => {
  for (const relativePath of [
    '../../views/admin/edugnay-admin-schools.html',
    '../../views/admin/edugnay-admin-management.html',
    '../../views/teacher/edugnay-teacher-sections.html'
  ]) {
    const html = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: relativePath });
    }
  }
  new vm.Script(fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8'));
});

test('grading settings return the shared SHS grading types and published-grade review count to School Admins', async () => {
  const result = await call({ role: 'school_admin' });
  assert.equal(result.error, null);
  assert.deepEqual(result.data.shsGradingTypes.map(type => type.code), Object.keys(LEGACY_SHS_GRADING_GROUPS));
  assert.equal(result.data.shsGradingTypes.find(type => type.code === 'other_other').weights.pt, 60);
  assert.equal(result.data.publishedShsGradeCount, 7);
  assert.ok(result.statements.some(statement => statement.sql.includes("school_levels.level_code = 'shs'")));
});

test('school-level SHS category weights cannot override the curriculum subject-group weights', async () => {
  const calls = [];
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, level_code AS levelCode')) return [[{ id: 3, levelCode: 'shs', gradeRounding: 'round', passingGradeThreshold: 75 }]];
      if (sql.includes('SELECT id, code, weight FROM grading_categories')) return [[
        { id: 1, code: 'ww', weight: '25.00' },
        { id: 2, code: 'pt', weight: '50.00' },
        { id: 3, code: 'qa', weight: '25.00' }
      ]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  database = { getConnection: async () => connection };
  const result = { error: null };
  await updateGradingCategories({
    user: { role: 'school_admin', schoolId: 9 },
    body: {
      schoolLevelId: 3,
      categories: [
        { id: 1, code: 'ww', name: 'Written Work', weight: 20 },
        { id: 2, code: 'pt', name: 'Performance Task', weight: 55 },
        { id: 3, code: 'qa', name: 'Quarterly Assessment', weight: 25 }
      ]
    }
  }, { json() {} }, error => { result.error = error; });

  assert.equal(result.error.status, 409);
  assert.match(result.error.message, /weights are determined by each subject/);
  assert.equal(rolledBack, true);
  assert.equal(calls.some(call => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.sql)), false);
});
