const test = require('node:test');
const assert = require('node:assert/strict');
const { usesDepedValuesDomains, isDepedValuesSetup } = require('../config/depedValuesDomains');
const { resolveValuesDomainCode } = require('../utils/valuesDomainItems');

test('domain rule applies to GMRC Grades 4–6 and Values Education Grades 7–10 only', () => {
  assert.equal(usesDepedValuesDomains('gmrc-grade-4', 'grade-4', '2026-2027'), true);
  assert.equal(usesDepedValuesDomains('gmrc-elementary', 'grade-6', '2027-2028'), true);
  assert.equal(usesDepedValuesDomains('gmrc-grade-2', 'grade-2', '2026-2027'), false);
  assert.equal(usesDepedValuesDomains('values-education-jhs', 'grade-7', '2026-2027'), true);
  assert.equal(usesDepedValuesDomains('values-education-jhs', 'grade-10', '2027-2028'), true);
  assert.equal(usesDepedValuesDomains('english-jhs', 'grade-7', '2026-2027'), false);
});

test('only the prescribed component weights and exam split match DepEd values setup', () => {
  const components = [
    { componentType: 'written', weight: 20 },
    { componentType: 'performance', weight: 50 },
    { componentType: 'examination', weight: 30, examParts: [
      { code: 'summative-test-1', weight: 30 }, { code: 'summative-test-2', weight: 30 },
      { code: 'term-exam', weight: 40 }
    ] }
  ];
  assert.equal(isDepedValuesSetup(components), true);
  assert.equal(isDepedValuesSetup(components.map(component => component.componentType === 'performance'
    ? { ...component, weight: 45 } : component)), false);
  assert.equal(isDepedValuesSetup(components.map(component => component.componentType === 'examination'
    ? { ...component, examParts: component.examParts.map(part => part.code === 'term-exam'
      ? { ...part, weight: 35 } : part) } : component)), false);
});

test('saved score items require a valid domain only for applicable written and performance parts', async () => {
  const scope = { subjectCode: 'gmrc-grade-4', gradeCode: 'grade-4', academicYearLabel: '2026-2027', componentType: 'written' };
  const database = { execute: async () => [[scope]] };
  const resolve = value => resolveValuesDomainCode(database, 1, 2, 3, 4, value);
  assert.equal(await resolve('cognitive'), 'cognitive');
  await assert.rejects(resolve(null), { status: 400 });
  await assert.rejects(resolve('behavioral'), { status: 400 });
  scope.componentType = 'performance';
  assert.equal(await resolve('behavioral'), 'behavioral');
  scope.componentType = 'examination';
  assert.equal(await resolve(null), null);
  await assert.rejects(resolve('affective'), { status: 400 });
  scope.subjectCode = 'english-grade-4';
  await assert.rejects(resolve('cognitive'), { status: 400 });
  assert.equal(await resolve(null), null);
});
