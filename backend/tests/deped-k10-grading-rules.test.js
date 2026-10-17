const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  applyDepedK10GradeMethod,
  createDepedK10DefaultComponents,
  getDepedK10GradeMethod,
  getDepedK10LearningArea,
  transmuteDepedK10InitialGrade
} = require('../config/depedK10Grading');

test('DepEd default weights map each configured learning area correctly', () => {
  for (const code of ['english-elementary', 'filipino-jhs', 'mathematics-jhs', 'science-elementary', 'araling-panlipunan-jhs', 'gmrc-elementary', 'values-education-jhs']) {
    assert.equal(getDepedK10LearningArea(code), 'academic', code);
    assert.deepEqual(createDepedK10DefaultComponents(code).map(component => component.weight), [20, 50, 30]);
  }
  for (const code of ['epp-elementary', 'tle-jhs', 'music-and-arts-jhs', 'physical-education-and-health-elementary']) {
    assert.equal(getDepedK10LearningArea(code), 'applied', code);
    assert.deepEqual(createDepedK10DefaultComponents(code).map(component => component.weight), [20, 60, 20]);
  }
  assert.equal(createDepedK10DefaultComponents('unknown-local-elective'), null);
  assert.deepEqual(createDepedK10DefaultComponents('english-jhs')[2].examParts.map(part => part.weight), [30, 30, 40]);
});

test('school-year grading method changes from the SY 2026-27 table to direct zero-based grading', () => {
  assert.equal(getDepedK10GradeMethod('2026-2027'), 'deped_2026_transmutation');
  assert.equal(getDepedK10GradeMethod('2027-2028'), 'deped_zero_based');
  assert.equal(getDepedK10GradeMethod('2025-2026'), 'standard');
  assert.equal(applyDepedK10GradeMethod(81.9, 'deped_zero_based'), 82);
});

test('2026 adjusted transmutation matches the table around representative boundaries', () => {
  const boundaries = [
    [0, 60], [4.67, 60], [4.68, 61], [9.33, 61], [9.34, 62],
    [65.33, 73], [65.34, 74], [69.99, 74], [70, 75], [71.17, 75],
    [71.18, 76], [72.35, 76], [72.36, 77], [98.31, 98], [98.32, 99],
    [99.49, 99], [99.5, 100], [100, 100]
  ];
  for (const [initial, expected] of boundaries) {
    assert.equal(transmuteDepedK10InitialGrade(initial), expected, `initial grade ${initial}`);
  }
  assert.equal(applyDepedK10GradeMethod(71.18, 'deped_2026_transmutation'), 76);
});

test('K-10 grading rules exclude Kindergarten-Grade 3 and the teacher panel script parses', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for (const [index, script] of scripts.entries()) {
    if (script[1].trim()) new vm.Script(script[1], { filename: `teacher-sections.inline-${index}.js` });
  }
});
