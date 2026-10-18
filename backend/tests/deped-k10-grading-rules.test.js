const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  applyDepedK10GradeMethod,
  createDepedK10DefaultComponents,
  getDepedNumericalGradeBlockReason,
  getDepedK10GradeMethod,
  getDepedK10LearningArea,
  isDepedNumericalGradeCode,
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

test('Grade 2–3 subject defaults use separate two-test exam profiles', () => {
  for (const gradeCode of ['grade-2', 'grade-3']) {
    for (const area of ['filipino', 'english', 'mathematics', 'gmrc', 'makabansa']) {
      const components = createDepedK10DefaultComponents(`${area}-${gradeCode}`);
      assert.deepEqual(components.map(component => component.weight), [20, 50, 30]);
      assert.deepEqual(components[2].examParts.map(part => part.weight), [50, 50]);
    }
  }
  const grade3Science = createDepedK10DefaultComponents('science-grade-3');
  assert.deepEqual(grade3Science.map(component => component.weight), [20, 50, 30]);
  assert.deepEqual(grade3Science[2].examParts.map(part => part.weight), [50, 50]);
  assert.deepEqual(createDepedK10DefaultComponents('english-elementary')[2].examParts.map(part => part.weight), [30, 30, 40]);
  assert.equal(getDepedK10LearningArea('makabansa-grade-2'), 'academic');
});

test('school-year grading method changes from the SY 2026-27 table to direct zero-based grading', () => {
  assert.equal(getDepedK10GradeMethod('2026-2027'), 'deped_2026_transmutation');
  assert.equal(getDepedK10GradeMethod('2027-2028'), 'deped_zero_based');
  assert.equal(getDepedK10GradeMethod('2025-2026'), 'standard');
  assert.equal(applyDepedK10GradeMethod(81.9, 'deped_zero_based'), 82);
});

test('numerical grading eligibility follows grade and school year, keeping descriptive grades out', () => {
  assert.equal(isDepedNumericalGradeCode('grade-2', '2026-2027'), true);
  assert.equal(isDepedNumericalGradeCode('grade-3', '2026-2027'), true);
  assert.equal(isDepedNumericalGradeCode('grade-2', '2027-2028'), false);
  assert.equal(isDepedNumericalGradeCode('grade-3', '2027-2028'), false);
  assert.equal(isDepedNumericalGradeCode('grade-4', '2027-2028'), true);
  assert.equal(isDepedNumericalGradeCode('grade-1', '2026-2027'), false);
  assert.match(getDepedNumericalGradeBlockReason('kindergarten', '2026-2027'), /descriptive reporting/);
  assert.match(getDepedNumericalGradeBlockReason('grade-1', '2026-2027'), /descriptive reporting/);
  assert.match(getDepedNumericalGradeBlockReason('grade-2', '2027-2028'), /not available/);
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

test('DepEd subject grading excludes descriptive grades and the teacher panel script parses', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/teacher/edugnay-teacher-sections.html'), 'utf8');
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for (const [index, script] of scripts.entries()) {
    if (script[1].trim()) new vm.Script(script[1], { filename: `teacher-sections.inline-${index}.js` });
  }
});
