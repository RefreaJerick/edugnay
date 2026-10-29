const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateRule } = require('../controllers/shsGradingSettingsController');
const { loadShsPolicy } = require('../utils/shsGradingProfiles');
const { calculateTermGrade, policyFor, componentsEqual } = require('../config/shsGrading');
const { getCatalogEntry } = require('../config/shsApprovedCatalog');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const customComponents = [
  { code: 'written', name: 'Written/Oral Works', componentType: 'written', weight: 30, examParts: [] },
  { code: 'performance', name: 'Performance Tasks', componentType: 'performance', weight: 40, examParts: [] },
  { code: 'examination', name: 'Examinations', componentType: 'examination', weight: 20, examParts: [
    { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
    { code: 'term-exam', name: 'Term Exam', weight: 50 }
  ] },
  { code: 'portfolio', name: 'Portfolio', componentType: 'other', weight: 10, examParts: [] }
];

function editorComponents(components) {
  return components.map(component => ({ ...component,
    examParts: Object.entries(component.examParts || {}).map(([code, value]) => ({
      code,
      name: typeof value === 'object' && value.name ? value.name
        : ({ summative_test_1: 'Summative Test 1', summative_test_2: 'Summative Test 2', term_exam: 'Term Exam' })[code]
          || code.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
      weight: Number(typeof value === 'object' ? value.weight : value)
    }))
  }));
}

test('custom SHS components and exam parts drive grade calculation while SHS defaults stay unchanged', async () => {
  const standard = policyFor('core', '2027-2028', 'grade-11');
  const custom = validateRule({ components: customComponents }, { components: standard.components });
  const db = { async execute(sql, values) {
    assert.match(sql, /components_json AS componentsJson/);
    assert.match(sql, /school_id = \? AND academic_year_id = \? AND subject_id = \?/);
    assert.deepEqual(values, [2, 8, 5]);
    return [[{ written: 20, performance: 50, examination: 30,
      examParts: JSON.stringify(standard.examParts), componentsJson: JSON.stringify(custom.components) }]];
  } };
  const policy = await loadShsPolicy(db, { kind: 'core', schoolId: 2, yearId: 8, subjectId: 5,
    group: 'core', yearLabel: '2027-2028', gradeCode: 'grade-11' });
  const items = [
    { id: 1, title: 'Written', componentCode: 'written', maxScore: 100 },
    { id: 2, title: 'Performance', componentCode: 'performance', maxScore: 100 },
    { id: 3, title: 'Summative Test 1', componentCode: 'examination', examPartCode: 'summative-test-1', maxScore: 100 },
    { id: 4, title: 'Term Exam', componentCode: 'examination', examPartCode: 'term-exam', maxScore: 100 },
    { id: 5, title: 'Portfolio', componentCode: 'portfolio', maxScore: 100 }
  ];
  const scores = new Map([[1, 80], [2, 60], [3, 100], [4, 0], [5, 90]]);
  assert.deepEqual(calculateTermGrade(policy, items, scores), { initialGrade: 67, termGrade: 67 });
  assert.deepEqual(standard.weights, { written: 20, performance: 50, examination: 30 });
  assert.equal(policy.components[3].name, 'Portfolio');
  const fallback = await loadShsPolicy({ async execute(sql, values) {
    assert.match(sql, /offering_id = \?/);
    assert.deepEqual(values, [2, 8, 4]);
    return [[]];
  } }, { kind: 'elective', schoolId: 2, yearId: 8, offeringId: 4,
    group: 'core', yearLabel: '2027-2028', gradeCode: 'grade-12' });
  assert.deepEqual(fallback.components.map(component => component.code), ['written', 'performance', 'examination']);
});

test('SHS rule editor accepts added components and parts but rejects invalid structure and totals', () => {
  const standard = policyFor('research_design', '2027-2028', 'grade-12');
  const valid = validateRule({ components: [
    { code: 'research', name: 'Research output', componentType: 'performance', weight: 70, examParts: [] },
    { code: 'oral-defense', name: 'Oral defense', componentType: 'other', weight: 30, examParts: [] }
  ] }, { components: standard.components });
  assert.equal(valid.weights.performance, 70);
  assert.equal(valid.components.length, 2);
  assert.equal(standard.components.some(component => component.componentType === 'examination'), false);
  assert.throws(() => validateRule({ components: customComponents.map((component, index) => ({ ...component,
    weight: index === 3 ? 9 : component.weight })) }, { components: policyFor('core', '2027-2028', 'grade-11').components }), /total 100/);
  assert.throws(() => validateRule({ components: customComponents.map(component => component.code === 'examination'
    ? { ...component, examParts: component.examParts.map(part => ({ ...part, weight: 40 })) } : component) },
  { components: policyFor('core', '2027-2028', 'grade-11').components }), /Exam-part weights must total 100/);
  assert.throws(() => validateRule({ components: [
    { code: 'same', name: 'One', componentType: 'other', weight: 50, examParts: [] },
    { code: 'same', name: 'Two', componentType: 'other', weight: 50, examParts: [] }
  ] }, { components: [] }), /unique/);
  assert.throws(() => validateRule({ components: [
    { code: 'work', name: 'Work', componentType: 'other', weight: 100,
      examParts: [{ code: 'part', name: 'Part', weight: 100 }] }
  ] }, { components: [] }), /Only examination/);
  assert.throws(() => validateRule({ components: [
    { code: 'examination', name: 'Examinations', componentType: 'examination', weight: 100, examParts: [] }
  ] }, { components: standard.components }, [], { allowExaminations: false }), /does not use an examination component/);
});

test('SHS restore validation accepts DepEd defaults with keyed exam parts', () => {
  const defaults = policyFor('core', '2026-2027', 'grade-11').components;
  const customized = customComponents;
  const restored = validateRule({ components: defaults }, { components: customized }, [
    { componentCode: 'examination', examPartCode: 'summative_test_1' }
  ]);

  assert.deepEqual(restored.components.find(component => component.code === 'examination').examParts, {
    summative_test_1: { name: 'Summative Test 1', weight: 30 },
    summative_test_2: { name: 'Summative Test 2', weight: 30 },
    term_exam: { name: 'Term Exam', weight: 40 }
  });
  assert.throws(() => validateRule({ components: defaults.map(component => component.code === 'examination'
    ? { ...component, examParts: { summative_test_1: 40, term_exam: 40 } } : component) },
  { components: customized }), /Exam-part weights must total 100/);
  assert.throws(() => validateRule({ components: defaults.map(component => component.code === 'written'
    ? { ...component, examParts: { invalid: 100 } } : component) },
  { components: customized }), /Only examination components may have exam parts/);
  assert.throws(() => validateRule({ components: defaults }, { components: customized }, [
    { componentCode: 'portfolio', examPartCode: null }
  ]), /cannot be removed/);
});

test('used SHS assessment codes and exam parts cannot be removed or retyped', () => {
  const standard = policyFor('core', '2027-2028', 'grade-11');
  const editable = editorComponents(standard.components);
  assert.doesNotThrow(() => validateRule({ components: editable }, { components: standard.components }));
  const used = [{ componentCode: 'examination', examPartCode: 'summative_test_1' }];
  const withoutExam = editable.filter(row => row.code !== 'examination')
    .map(row => row.code === 'performance' ? { ...row, weight: 80 } : row);
  assert.throws(() => validateRule({ components: withoutExam },
    { components: standard.components }, used), /cannot be removed/);
  assert.throws(() => validateRule({ components: editable.map(row => row.code === 'examination'
    ? { ...row, componentType: 'other', examParts: [] } : row) }, { components: standard.components }, used), /type cannot change/);
  assert.throws(() => validateRule({ components: editable.map(row => row.code === 'examination'
    ? { ...row, examParts: row.examParts.filter(part => part.code !== 'summative_test_1')
      .map(part => part.code === 'term_exam' ? { ...part, weight: 70 } : part) } : row) },
  { components: standard.components }, used), /exam part is used/);
  assert.throws(() => validateRule({ components: editable }, { components: customComponents },
    [{ componentCode: 'portfolio', examPartCode: null }]), /cannot be removed/);
  assert.throws(() => validateRule({ components: editable }, { components: standard.components },
    [{ componentCode: null, examPartCode: null }]), /no component code/);
  assert.throws(() => validateRule({ components: editable }, { components: standard.components },
    [{ componentCode: 'examination', examPartCode: null }]), /no exam part/);
  assert.throws(() => validateRule({ components: editable.map(row => row.code === 'examination'
    ? { ...row, weight: 0 } : row.code === 'performance' ? { ...row, weight: 80 } : row) },
  { components: standard.components }, used), /must keep a weight above 0/);
  assert.throws(() => validateRule({ components: editable.map(row => row.code === 'examination'
    ? { ...row, examParts: row.examParts.map(part => ({ ...part,
      weight: part.code === 'summative_test_1' ? 0 : part.code === 'summative_test_2' ? 100 : 0 })) } : row) },
  { components: standard.components }, used), /must keep a weight above 0/);
});

test('equivalent SHS rules remain identified as DepEd defaults', () => {
  const defaults = policyFor('core', '2027-2028', 'grade-11').components;
  const savedDefaults = defaults.map(component => ({ ...component, examParts: Object.fromEntries(
    Object.entries(component.examParts).map(([code, weight]) => [code, { name:
      ({ summative_test_1: 'Summative Test 1', summative_test_2: 'Summative Test 2', term_exam: 'Term Exam' })[code], weight }])
  ) }));
  assert.equal(componentsEqual(defaults, savedDefaults), true);
  assert.equal(componentsEqual(defaults, customComponents), false);
});

test('SHS grading defaults match their distinct DO 015 subject groups', () => {
  const { catalog } = require('../config/shsApprovedCatalog');
  const byCode = new Map(catalog.map(entry => [entry.code, entry]));
  assert.equal(byCode.get('AE039').assessmentGroup, 'field_exposure');
  for (const code of ['FE-DESIGN-INNOVATION', 'FE-RESEARCH-1', 'FE-RESEARCH-2'])
    assert.equal(byCode.get(code).assessmentGroup, 'research_design');

  for (const group of ['core', 'academic_general', 'techpro', 'arts_sports_wellness']) {
    const policy = policyFor(group, '2027-2028', 'grade-12');
    assert.deepEqual(policy.components.find(component => component.code === 'examination').examParts,
      { summative_test_1: 30, summative_test_2: 30, term_exam: 40 });
  }
  assert.deepEqual(policyFor('field_exposure', '2027-2028', 'grade-12')
    .components.find(component => component.code === 'examination').examParts, { term_exam: 100 });
  for (const group of ['research_design', 'work_immersion'])
    assert.equal(policyFor(group, '2027-2028', 'grade-12').components.some(component => component.componentType === 'examination'), false);
});

test('Academic Field Experience and both Work Immersion options keep their SHS groups', () => {
  const arts = getCatalogEntry('AA-DANCE');
  const academicImmersion = getCatalogEntry('WI-ACADEMIC-320');
  const techproImmersion = getCatalogEntry('WI-320');
  assert.equal(arts.assessmentGroup, 'field_exposure');
  assert.equal(policyFor(arts.assessmentGroup, '2027-2028', 'grade-12').weights.examination, 15);
  for (const entry of [academicImmersion, techproImmersion]) {
    assert.equal(entry.assessmentGroup, 'work_immersion');
    assert.equal(policyFor(entry.assessmentGroup, '2027-2028', 'grade-12').weights.examination, 0);
  }
});

test('SHS settings use additive component storage, retain school/year locks, and feed both teacher gradebooks', () => {
  const routes = read('backend/routes/academicTerms.js');
  const controller = read('backend/controllers/shsGradingSettingsController.js');
  const gradebook = read('backend/controllers/shsGradesController.js');
  const schoolPage = read('views/admin/edugnay-admin-schools.html');
  const migration = read('backend/database/migrations/056_flexible_shs_grading_components.sql');
  const schema = read('backend/database/schema.sql');
  assert.match(routes, /router\.put\('\/shs-grading', \.\.\.schoolAdminOnly/);
  assert.match(controller, /Archived school years are read-only/);
  assert.match(controller, /Published grades lock this subject/);
  assert.match(controller, /writeAuditLog/);
  assert.match(controller, /usedItemsFor/);
  assert.match(controller, /if \(restore\)[\s\S]*?validateRule\(\{ components: item\.defaultComponents \}/);
  assert.match(controller, /alignmentStatus: !ruleAvailable \? 'unavailable'/);
  assert.match(gradebook, /loadShsPolicy\(db, scope\)/);
  assert.match(gradebook, /components: scope\.policy\.components/);
  assert.match(gradebook, /scope\.policy\.components\?\.find/);
  assert.match(schoolPage, /Add component/);
  assert.match(schoolPage, /Add exam part/);
  assert.match(schoolPage, /defaultComponents\?\.some\(rule => rule\.componentType === 'examination'\)/);
  assert.match(schoolPage, /School-customized/);
  assert.match(schoolPage, /No verified rule/);
  assert.match(read('assets/js/teacher/shs-gradebook.js'), /policy\?\.components/);
  assert.match(read('assets/js/teacher/elective-class.js'), /policy\?\.components/);
  assert.match(migration, /ADD COLUMN components_json JSON NULL/);
  assert.match(migration, /UPDATE shs_grading_profiles/);
  assert.match(schema, /components_json JSON NULL/);
  assert.match(read('backend/database/migrations/055_shs_school_grading_profiles.sql'), /ck_shs_grading_weights/);
});

test('SHS editor uses compact K-10 row styling and previews defaults before restoring', () => {
  const page = read('views/admin/edugnay-admin-schools.html');
  const css = read('assets/css/admin/schools.css');
  for (const [index, script] of [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
    if (script[1].trim()) new vm.Script(script[1], { filename: `school-settings.inline-${index}.js` });
  }

  assert.match(page, /school-k10-component-columns[\s\S]*?Code[\s\S]*?Component[\s\S]*?Weight \(%\)/);
  assert.match(page, /school-k10-group-component-row school-k10-group-component-grid/);
  assert.match(page, /data-component-field="type" data-shs-component-field="componentType"/);
  assert.match(page, /data-part-field="weight" data-shs-part-field="weight"/);
  assert.match(page, /school-k10-grading-weight"><span>\$\{escape\(component\.name\)\}<\/span><strong>/);
  assert.match(page, /function showShsGradingRestoreConfirmation\(\)[\s\S]*?renderK10ComponentSummary\([\s\S]*?item\.components[\s\S]*?renderK10ComponentSummary\([\s\S]*?item\.defaultComponents/);
  assert.match(page, /function cancelShsGradingRestoreConfirmation\(\)[\s\S]*?shsGradingEditorBody[\s\S]*?getElementById\('shsGradingRestore'\)\.focus\(\)/);
  assert.match(page, /shsGradingRestoreBack'\)\.addEventListener\('click', cancelShsGradingRestoreConfirmation\)/);
  assert.match(page, /shsGradingRestoreConfirm'\)\.addEventListener\('click', \(\) => submitShsGradingRule\(\{\}, true\)\)/);
  assert.match(page, /getElementById\(restore \? 'shsGradingRestoreError' : 'shsGradingEditorError'\)/);
  assert.match(page, /errorNode\.textContent = error\.message \|\| \(restore \? 'DepEd defaults could not be restored\.'/);
  assert.match(page, /errorNode\.hidden = false/);
  assert.match(page, /request\(restore \? '\/shs-grading\/restore' : '\/shs-grading'/);
  assert.match(page, /state\.shsGradingData = await window\.EDUGNAY_API\.request\(`\/shs-grading\?academicYearId=\$\{yearId\}`\)/);
  assert.match(page, /data-label="Grade level"><span class="school-k10-grading-grade-list">\$\{escape\(item\.gradeCode\.replace\('grade-', 'Grade '\)\)\}<\/span><\/td>/);
  assert.match(css, /\.school-k10-grading-subject-name\s*\{[^}]*color:\s*var\(--theme-text/);
  assert.match(css, /#shsGradingComponents,[\s\S]*?\.shs-grading-component-entry[\s\S]*?display: grid/);
  assert.doesNotMatch(css, /\.shs-grading-component-grid input|\.shs-grading-exam-part input \{ min-height: 48px/);
});
