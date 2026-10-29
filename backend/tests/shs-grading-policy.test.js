const test = require('node:test');
const assert = require('node:assert/strict');
const { GROUPS, policyFor, policyBlockReason, requiredParts, transmuteStrengthenedShsInitialGrade,
  calculateTermGrade, calculateSubjectFinal } = require('../config/shsGrading');
const { catalog } = require('../config/shsApprovedCatalog');

test('each approved elective has an explicit assessment group', () => {
  for (const entry of catalog) assert.ok(GROUPS[entry.assessmentGroup], entry.code);
});

test('verified DO 015 Table 10 weights are explicit for every SHS assessment group', () => {
  assert.deepEqual(GROUPS.core, { written: 20, performance: 50, examination: 30 });
  assert.deepEqual(GROUPS.academic_general, { written: 20, performance: 50, examination: 30 });
  assert.deepEqual(GROUPS.techpro, { written: 15, performance: 65, examination: 20 });
  assert.deepEqual(GROUPS.work_immersion, { written: 20, performance: 80, examination: 0 });
  assert.deepEqual(GROUPS.field_exposure, { written: 15, performance: 70, examination: 15, termExamOnly: true });
  assert.deepEqual(GROUPS.arts_sports_wellness, { written: 20, performance: 60, examination: 20 });
  assert.deepEqual(GROUPS.research_design, { written: 40, performance: 60, examination: 0 });
  assert.deepEqual(requiredParts({ weights: GROUPS.work_immersion }), []);
  assert.deepEqual(requiredParts({ weights: GROUPS.field_exposure }), ['term_exam']);
  for (const group of Object.keys(GROUPS)) {
    assert.equal(GROUPS[group].written + GROUPS[group].performance + GROUPS[group].examination, 100);
    assert.equal(policyFor(group, '2027-2028', 'grade-12').method, 'zero_based');
    assert.equal(policyFor(group, '2027-2028', 'grade-11').method, 'zero_based');
  }
});

test('DO 015 applies its adjusted policy to Strengthened Grade 11 and Grade 12 in SY 2026-2027', () => {
  assert.equal(policyFor('core', '2026-2027', 'grade-11').method, 'adjusted_2026');
  assert.equal(policyFor('core', '2026-2027', 'grade-12').method, 'adjusted_2026');
  assert.match(policyFor('core', '2027-2028', 'grade-12').source, /DepEd Order No\. 015/);
  assert.equal(policyFor('unknown', '2027-2028', 'grade-12'), null);
  assert.equal(policyFor('core', '2026-2027', 'grade-10'), null);
  assert.match(policyBlockReason('core', '2026-2027', 'grade-10'), /only for Grade 11/);
});

test('Strengthened Grade 12 uses the same curriculum rules without a school-specific start flag', () => {
  assert.equal(policyFor('core', '2026-2027', 'grade-12').method, 'adjusted_2026');
  assert.equal(policyFor('core', '2027-2028', 'grade-12').method, 'zero_based');
  assert.equal(policyBlockReason('core', '2026-2027', 'grade-11'), null);
  assert.equal(policyBlockReason('core', '2026-2027', 'grade-12'), null);
});

test('grade calculation requires complete components and valid scores', () => {
  const policy = { group: 'work_immersion', weights: GROUPS.work_immersion, method: 'zero_based' };
  const items = [
    { id: 1, title: 'Portfolio', componentCode: 'written', maxScore: 20 },
    { id: 2, title: 'Industry evaluation', componentCode: 'performance', maxScore: 80 }
  ];
  assert.deepEqual(calculateTermGrade(policy, items, new Map([[1, 15], [2, 60]])),
    { initialGrade: 75, termGrade: 75 });
  assert.match(calculateTermGrade(policy, items, new Map([[1, 15]])).problem, /missing or invalid/);
  assert.match(calculateTermGrade(policy, items, new Map([[1, 21], [2, 60]])).problem, /missing or invalid/);
  assert.equal(calculateSubjectFinal([74, 75, 76]), 75);
});

test('Table 10 term exams use their split weights and field exposure requires one term exam', () => {
  const general = policyFor('academic_general', '2027-2028', 'grade-11');
  const generalItems = [
    { id: 1, title: 'Written', componentCode: 'written', maxScore: 100 },
    { id: 2, title: 'Performance', componentCode: 'performance', maxScore: 100 },
    { id: 3, title: 'Summative 1', componentCode: 'examination', examPartCode: 'summative_test_1', maxScore: 100 },
    { id: 4, title: 'Summative 2', componentCode: 'examination', examPartCode: 'summative_test_2', maxScore: 100 },
    { id: 5, title: 'Term exam', componentCode: 'examination', examPartCode: 'term_exam', maxScore: 100 }
  ];
  assert.deepEqual(calculateTermGrade(general, generalItems, new Map([[1, 100], [2, 80], [3, 100], [4, 0], [5, 50]])),
    { initialGrade: 75, termGrade: 75 });

  const exposure = policyFor('field_exposure', '2027-2028', 'grade-12');
  const exposureItems = [
    { id: 1, title: 'Written', componentCode: 'written', maxScore: 100 },
    { id: 2, title: 'Performance', componentCode: 'performance', maxScore: 100 },
    { id: 3, title: 'Term exam', componentCode: 'examination', examPartCode: 'term_exam', maxScore: 100 }
  ];
  assert.deepEqual(calculateTermGrade(exposure, exposureItems, new Map([[1, 100], [2, 80], [3, 60]])),
    { initialGrade: 80, termGrade: 80 });
  assert.match(calculateTermGrade(exposure, exposureItems.slice(0, 2), new Map([[1, 100], [2, 80]])).problem, /term_exam/);
});

test('DO 015 Annex D adjusted transmutation matches policy examples and boundaries', () => {
  const adjusted = policyFor('core', '2026-2027', 'grade-11');
  const items = [
    { id: 1, title: 'Written', componentCode: 'written', maxScore: 100 },
    { id: 2, title: 'Performance', componentCode: 'performance', maxScore: 100 },
    { id: 3, title: 'Summative 1', componentCode: 'examination', examPartCode: 'summative_test_1', maxScore: 100 },
    { id: 4, title: 'Summative 2', componentCode: 'examination', examPartCode: 'summative_test_2', maxScore: 100 },
    { id: 5, title: 'Term exam', componentCode: 'examination', examPartCode: 'term_exam', maxScore: 100 }
  ];
  const scores = new Map([[1, 90], [2, 80], [3, 100], [4, 90], [5, 80]]);
  assert.deepEqual(calculateTermGrade(adjusted, items, scores), { initialGrade: 84.7, termGrade: 87 });
  assert.equal(transmuteStrengthenedShsInitialGrade(69.99), 74);
  assert.equal(transmuteStrengthenedShsInitialGrade(70), 75);
  assert.equal(transmuteStrengthenedShsInitialGrade(71.17), 75);
  assert.equal(transmuteStrengthenedShsInitialGrade(71.18), 76);
  assert.equal(transmuteStrengthenedShsInitialGrade(9.34), 61);
  assert.equal(transmuteStrengthenedShsInitialGrade(9.35), 62);
  assert.equal(transmuteStrengthenedShsInitialGrade(99.49), 99);
  assert.equal(transmuteStrengthenedShsInitialGrade(99.5), 100);
  const noExam = policyFor('research_design', '2027-2028', 'grade-11');
  assert.deepEqual(requiredParts(noExam), []);
  assert.equal(noExam.weights.examination, 0);
});

test('zero-based SHS policy publishes the rounded Initial Grade without transmutation', () => {
  const policy = policyFor('work_immersion', '2027-2028', 'grade-12');
  const items = [
    { id: 1, title: 'Portfolio', componentCode: 'written', maxScore: 20 },
    { id: 2, title: 'Industry evaluation', componentCode: 'performance', maxScore: 80 }
  ];
  assert.deepEqual(calculateTermGrade(policy, items, new Map([[1, 15], [2, 60]])),
    { initialGrade: 75, termGrade: 75 });
  assert.deepEqual(calculateTermGrade(policy, items, new Map([[1, 14], [2, 60]])),
    { initialGrade: 74, termGrade: 74 });
});

test('verified assessment groups identify the DO 015 source used in publication snapshots', () => {
  for (const group of Object.keys(GROUPS)) {
    const policy = policyFor(group, '2026-2027', 'grade-11');
    assert.ok(policy, group);
    assert.match(policy.source, /Table 10 and Annex D/);
  }
});
