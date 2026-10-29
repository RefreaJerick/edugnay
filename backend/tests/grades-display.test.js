const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/js/shell-common.js'), 'utf8');
const studentPage = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-grades.html'), 'utf8');
const parentPage = fs.readFileSync(path.join(__dirname, '../../views/parent/edugnay-parent-grades.html'), 'utf8');
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
  assert.equal(gradeScoreClass({ finalGrade: 80, passingGradeThreshold: 83 }), 'is-published is-below-passing');
  assert.equal(gradeScoreClass({ finalGrade: 83, passingGradeThreshold: 83 }), 'is-published is-passing');
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

test('confirmed elective classes appear in each configured period with grades matched by class and period', () => {
  const years = buildApiFinalGradeYears({
    academicYears: [{
      id: '4', label: '2026-2027', status: 'active', sections: [],
      electiveClasses: [
        {
          classId: '51', academicYearId: '4', subjectName: 'Contemporary Literature 1',
          className: 'Capstone QA AE011', gradingPeriodType: 'semestral', passingGradeThreshold: 75,
          terms: [
            { id: '40', name: 'Semester 1', sequenceNumber: 1, status: 'active' },
            { id: '41', name: 'Semester 2', sequenceNumber: 2, status: 'upcoming' }
          ]
        },
        {
          classId: '52', academicYearId: '4', subjectName: 'Contemporary Literature 1',
          className: 'Capstone QA AE012', gradingPeriodType: 'semestral', passingGradeThreshold: 75,
          terms: [
            { id: '40', name: 'Semester 1', sequenceNumber: 1, status: 'active' },
            { id: '41', name: 'Semester 2', sequenceNumber: 2, status: 'upcoming' }
          ]
        }
      ]
    }],
    publishedGrades: [{
      id: 'published-51-40', sectionId: null, subjectId: null, electiveClassId: '51',
      academicYearId: '4', academicTermId: '40', academicTermSequenceNumber: 1,
      academicTermName: 'Semester 1', gradingPeriodType: 'semestral',
      subjectName: 'Contemporary Literature 1', sectionName: 'Capstone QA AE011',
      finalGrade: 91, passingGradeThreshold: 75, publishedAt: '2026-10-01T00:00:00.000Z'
    }]
  });
  const periods = years[0].periods;
  const semesterOne = periods.find(period => period.label === 'Semester 1');
  const semesterTwo = periods.find(period => period.label === 'Semester 2');

  assert.deepEqual(JSON.parse(JSON.stringify(semesterOne.subjects.map(subject => [subject.electiveClassId, subject.sectionName, subject.finalGrade]))), [
    ['51', 'Capstone QA AE011', 91],
    ['52', 'Capstone QA AE012', null]
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(semesterTwo.subjects.map(subject => [subject.electiveClassId, subject.finalGrade]))), [
    ['51', null],
    ['52', null]
  ]);
  assert.equal(semesterTwo.status, 'upcoming');
});

test('published elective history remains visible after its active placement is gone', () => {
  const years = buildApiFinalGradeYears({
    academicYears: [{ id: '4', label: '2026-2027', status: 'closed', sections: [], electiveClasses: [] }],
    publishedGrades: [{
      id: 'published-51-40', sectionId: null, subjectId: null, electiveClassId: '51',
      academicYearId: '4', academicTermId: '40', academicTermSequenceNumber: 1,
      academicTermName: 'Semester 1', gradingPeriodType: 'semestral',
      subjectName: 'Work Immersion', sectionName: 'Immersion A', finalGrade: 94,
      passingGradeThreshold: 75, publishedAt: '2026-10-01T00:00:00.000Z'
    }]
  });
  const subject = years[0].periods[0].subjects[0];

  assert.equal(subject.electiveClassId, '51');
  assert.equal(subject.sectionName, 'Immersion A');
  assert.equal(subject.finalGrade, 94);
});

test('grade API normalization preserves null section and subject IDs for elective grades', async () => {
  const overviewStart = source.indexOf('async function getApiFinalGradesOverview(');
  const overviewEnd = source.indexOf('async function getApiAssignmentSubmissions(', overviewStart);
  assert.ok(overviewStart >= 0 && overviewEnd > overviewStart);
  const response = {
    overview: {
      academicYears: [{
        id: 4, label: '2026-2027', status: 'active', sections: [],
        electiveClasses: [{
          classId: 51, academicYearId: 4, className: 'Capstone QA AE011',
          subjectName: 'Contemporary Literature 1', terms: [{ id: 40, sequenceNumber: 1 }]
        }]
      }],
      publishedGrades: [{
        id: 1, sectionId: null, subjectId: null, electiveClassId: 51,
        academicYearId: 4, academicTermId: 40, academicTermSequenceNumber: 1, finalGrade: 91
      }]
    }
  };
  const getOverview = vm.runInNewContext(
    source.slice(overviewStart, overviewEnd) + '\ngetApiFinalGradesOverview',
    { URLSearchParams, requestApi: async () => response }
  );
  const overview = await getOverview();

  assert.equal(overview.academicYears[0].electiveClasses[0].classId, '51');
  assert.equal(overview.academicYears[0].electiveClasses[0].terms[0].id, '40');
  assert.equal(overview.publishedGrades[0].sectionId, null);
  assert.equal(overview.publishedGrades[0].subjectId, null);
  assert.equal(overview.publishedGrades[0].electiveClassId, '51');
});

test('student and parent grade cards show the class name for confirmed SHS classes', () => {
  assert.match(studentPage, /subject\.electiveClassId && subject\.sectionName[\s\S]*?subject\.sectionName \+ ' · Not published'/);
  assert.match(parentPage, /subject\.electiveClassId && subject\.sectionName[\s\S]*?\$\{subject\.sectionName\} · \$\{gradeStatus\}/);
});

test('Grade 2–3 student and parent displays color published DepEd grades at the 75 boundary', () => {
  const years = buildApiFinalGradeYears({
    academicYears: [{
      id: '10', label: '2026-2027', status: 'active', sections: [{
        id: '21', name: 'Grade 2 - St. Matthew', gradingPeriodType: 'trimestral', passingGradeThreshold: 75,
        terms: [{ id: '31', name: 'Term 1', sequenceNumber: 1, status: 'active' }],
        subjects: [{ subjectId: '41', subjectName: 'Makabansa' }, { subjectId: '42', subjectName: 'English' }]
      }]
    }],
    publishedGrades: [
      { sectionId: '21', academicYearId: '10', academicTermId: '31', subjectId: '41', finalGrade: 75, passingGradeThreshold: 75 },
      { sectionId: '21', academicYearId: '10', academicTermId: '31', subjectId: '42', finalGrade: 72, passingGradeThreshold: 75 }
    ]
  });
  const subjects = years[0].periods[0].subjects;
  assert.equal(subjects[0].passingGradeThreshold, 75);
  assert.equal(subjects[1].passingGradeThreshold, 75);
  assert.equal(gradeScoreClass(subjects[0]), 'is-published is-passing');
  assert.equal(gradeScoreClass(subjects[1]), 'is-published is-below-passing');
});
