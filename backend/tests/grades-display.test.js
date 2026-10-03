const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const start = source.indexOf('function gradeScoreClass(');
const end = source.indexOf('async function getApiFinalGrades(', start);
assert.ok(start >= 0 && end > start);
const { gradeScoreClass, buildApiFinalGradeYears } = vm.runInNewContext(
  source.slice(start, end) + '\n({ gradeScoreClass, buildApiFinalGradeYears })'
);

test('published grade number color follows the configured passing threshold', () => {
  assert.equal(gradeScoreClass({ finalGrade: 74, passingGradeThreshold: 75 }), 'is-published is-below-passing');
  assert.equal(gradeScoreClass({ finalGrade: 75, passingGradeThreshold: 75 }), 'is-published is-passing');
  assert.equal(gradeScoreClass({ finalGrade: 92, passingGradeThreshold: 90 }), 'is-published is-passing');
  assert.equal(gradeScoreClass({ finalGrade: 0, passingGradeThreshold: 75 }), 'is-published is-below-passing');
  assert.equal(gradeScoreClass({ finalGrade: null, passingGradeThreshold: 75 }), 'is-pending');
  assert.equal(gradeScoreClass({ finalGrade: 80, passingGradeThreshold: null }), 'is-published');
});

test('grade display carries the threshold to published and unpublished subjects', () => {
  const years = buildApiFinalGradeYears({
    academicYears: [{
      id: '4', label: '2026-2027', status: 'active', sections: [{
        id: '8', name: 'St. Matthew', gradingPeriodType: 'quarterly', passingGradeThreshold: 75,
        terms: [{ id: '14', name: 'Quarter 2', sequenceNumber: 2, status: 'active' }],
        subjects: [{ subjectId: '2', subjectName: 'English' }, { subjectId: '3', subjectName: 'Science' }]
      }]
    }],
    publishedGrades: [{ sectionId: '8', academicYearId: '4', academicTermId: '14',
      subjectId: '2', finalGrade: 78, passingGradeThreshold: 75 }]
  });
  const subjects = years[0].periods.find(period => period.sequenceNumber === 2).subjects;
  assert.equal(subjects[0].passingGradeThreshold, 75);
  assert.equal(subjects[1].passingGradeThreshold, 75);
  assert.equal(gradeScoreClass(subjects[0]), 'is-published is-passing');
  assert.equal(gradeScoreClass(subjects[1]), 'is-pending');
});
