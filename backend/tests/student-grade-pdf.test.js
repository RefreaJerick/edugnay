const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { buildStudentGradeCopy, createStudentGradePdf, loadStudentGradeLogo, prepareStudentGradeLogo } = require('../utils/studentGradePdf');

function overview(grades = []) {
  return {
    academicYears: [{
      id: '4', label: '2026-2027', sections: [{
        id: '8', gradingPeriodType: 'quarterly',
        terms: [1, 2, 3, 4].map(number => ({ id: String(number), name: `Quarter ${number}`, sequenceNumber: number })),
        subjects: [{ subjectId: '2', subjectCode: 'eng', subjectName: 'English' }]
      }],
      electiveClasses: [{
        classId: '51', gradingPeriodType: 'semestral', subjectCode: 'HUM101',
        subjectName: 'Humanities', terms: [{ id: '5', name: 'Semester 1', sequenceNumber: 1 }]
      }]
    }],
    publishedGrades: grades
  };
}

function grade(term, value, elective = false) {
  return {
    academicYearId: '4', academicTermId: String(term),
    sectionId: elective ? null : '8', subjectId: elective ? null : '2',
    electiveClassId: elective ? '51' : null, finalGrade: value
  };
}

test('grade copy gives each complete period its own GWA', async () => {
  const copy = buildStudentGradeCopy(overview([
    grade(1, 90), grade(2, 80), grade(3, 85), grade(4, 95), grade(5, 100, true)
  ]), '4');
  assert.equal(copy.groups.find(group => group.label === 'Quarter 1').gwa, 90);
  assert.equal(copy.groups.find(group => group.label === 'Quarter 2').gwa, 80);
  assert.equal(copy.groups.find(group => group.label === 'Semester 1').gwa, 100);
  assert.equal(Object.hasOwn(copy, 'gwa'), false);
  assert.equal(copy.groups.flatMap(group => group.rows).length, 5);
  assert.ok(copy.groups.some(group => group.rows.some(row => row.code === 'HUM101' && row.finalGrade === 100)));
  const pdf = await createStudentGradePdf(copy, { schoolName: 'Saint Columban School', studentName: 'Juan Dela Cruz' });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
});

test('each GWA waits only for missing marks in its own period', () => {
  const partial = buildStudentGradeCopy(overview([grade(1, 90)]), '4');
  assert.equal(partial.groups.find(group => group.label === 'Quarter 1').gwa, 90);
  assert.equal(partial.groups.find(group => group.label === 'Quarter 2').gwa, null);
  assert.equal(partial.groups.find(group => group.label === 'Semester 1').gwa, null);
  assert.ok(partial.groups.flatMap(group => group.rows).some(row => row.finalGrade === null));

  const shortYear = overview([grade(1, 90), grade(5, 100, true)]);
  shortYear.academicYears[0].sections[0].terms = shortYear.academicYears[0].sections[0].terms.slice(0, 1);
  assert.equal(buildStudentGradeCopy(shortYear, '4').groups.find(group => group.label === 'Quarter 2').gwa, null);
  assert.equal(buildStudentGradeCopy(shortYear, '999'), null);
});

test('a period GWA averages its subject rows, including electives in that period', () => {
  const data = overview([grade(1, 90), grade(5, 100, true)]);
  data.academicYears[0].electiveClasses[0].terms[0].id = '1';
  data.academicYears[0].electiveClasses[0].gradingPeriodType = 'quarterly';
  data.publishedGrades[1].academicTermId = '1';
  const copy = buildStudentGradeCopy(data, '4');
  assert.equal(copy.groups.find(group => group.label === 'Quarter 1').gwa, 95);
});

test('one unpublished subject blocks only its own period GWA', () => {
  const data = overview([grade(1, 90), grade(2, 80)]);
  data.academicYears[0].sections[0].subjects.push({ subjectId: '3', subjectCode: 'math', subjectName: 'Mathematics' });
  data.publishedGrades.push({ ...grade(2, 100), subjectId: '3' });
  const copy = buildStudentGradeCopy(data, '4');
  assert.equal(copy.groups.find(group => group.label === 'Quarter 1').gwa, null);
  assert.equal(copy.groups.find(group => group.label === 'Quarter 2').gwa, 90);
});

test('published elective history stays in the copy after active placement ends', () => {
  const data = overview([grade(1, 90), grade(2, 80), grade(3, 85), grade(4, 95), {
    ...grade(5, 100, true), subjectCode: 'HUM101', subjectName: 'Humanities',
    academicTermName: 'Semester 1', academicTermSequenceNumber: 1, gradingPeriodType: 'semestral'
  }]);
  data.academicYears[0].electiveClasses = [];
  const copy = buildStudentGradeCopy(data, '4');
  assert.equal(copy.groups.find(group => group.label === 'Semester 1').gwa, 100);
  assert.ok(copy.groups.some(group => group.rows.some(row => row.code === 'HUM101')));
});

test('PNG, JPEG, and WebP school logos are prepared for the PDF', async () => {
  const image = sharp({ create: { width: 24, height: 24, channels: 4, background: '#1a4080' } });
  for (const format of ['png', 'jpeg', 'webp']) {
    const source = await image.clone().toFormat(format).toBuffer();
    const logo = await prepareStudentGradeLogo(source);
    assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const copy = buildStudentGradeCopy(overview([grade(1, 90)]), '4');
    const pdf = await createStudentGradePdf(copy, {
      schoolName: 'Saint Columban School', studentName: 'Juan Dela Cruz', schoolLogo: logo
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal(await prepareStudentGradeLogo(Buffer.from('invalid')), null);
  assert.equal(await loadStudentGradeLogo('../another-school.png'), null);
});
