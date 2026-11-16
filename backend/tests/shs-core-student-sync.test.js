const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sections = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const gradebook = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shs-gradebook.js'), 'utf8');
const syncStart = sections.indexOf('      syncShsPublishedGrades: workspace => {');
const syncEnd = sections.indexOf('      renderAttendanceRows:', syncStart);
const studentsStart = sections.indexOf('    function renderTeacherStudentList() {');
const studentsEnd = sections.indexOf('    function renderTeacherAttendanceRows()', studentsStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart && studentsStart >= 0 && studentsEnd > studentsStart);

test('successful core term loads supply the Students grade source', () => {
  assert.match(gradebook, /if \(data\.scope\.kind === 'core'\) \{\s*window\.TeacherClassViews\?\.updateSectionHeaderFromGradebook\?\.\(term\?\.id\);\s*window\.TeacherClassViews\?\.syncShsPublishedGrades\?\.\(data\);/);
  const periodName = { textContent: '' };
  let renders = 0;
  const context = vm.createContext({
    USE_SHS_CORE_GRADEBOOK: true, ACTIVE_ACADEMIC_PERIOD_ID: '',
    SHS_CORE_STUDENT_PASSING_THRESHOLD: null, BACKEND_PUBLISHED_GRADES: [],
    CURRENT_SECTION_ID: '4', CURRENT_SUBJECT_ID: '5',
    document: { getElementById: () => periodName },
    renderTeacherStudentList() { renders++; }
  });
  const sync = vm.runInContext(`({${sections.slice(syncStart, syncEnd)}}).syncShsPublishedGrades`, context);
  sync({ term: { id: 1, name: 'Term 1' }, scope: { policy: { passingGradeThreshold: 80 } },
    published: [{ studentId: 9, finalGrade: 79 }] });
  assert.equal(context.ACTIVE_ACADEMIC_PERIOD_ID, '1');
  assert.equal(context.SHS_CORE_STUDENT_PASSING_THRESHOLD, 80);
  assert.equal(context.BACKEND_PUBLISHED_GRADES[0].academicTermId, '1');
  assert.equal(periodName.textContent, 'Term 1');
  sync({ term: { id: 2, name: 'Term 2' }, scope: { policy: { passingGradeThreshold: 80 } },
    published: [{ studentId: 9, finalGrade: 92 }] });
  assert.equal(context.ACTIVE_ACADEMIC_PERIOD_ID, '2');
  assert.equal(context.BACKEND_PUBLISHED_GRADES.length, 1);
  assert.equal(context.BACKEND_PUBLISHED_GRADES[0].finalGrade, 92);
  assert.equal(periodName.textContent, 'Term 2');
  assert.equal(renders, 2);
});

test('core Students uses the SHS threshold; Elem and JHS keep their own threshold', () => {
  let rendered;
  const nodes = new Map([['academicPeriodSelect', { value: '2' }],
    ['studentGradePeriodName', { textContent: 'Term 2' }]]);
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '' });
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node },
    window: { TeacherClassViews: { renderStudents: value => { rendered = value; } },
      EDUGNAY_CONFIG: { escapeHtml: value => String(value) } },
    isBackendGradeMode: () => true, isBackendAttendanceMode: () => false,
    getGradeStudents: () => [{ id: 9, schoolEmail: '' }],
    getPublishedGradesForPeriod: () => [{ studentId: 9, finalGrade: 79 }],
    getGradeStatusTone: (grade, passing = 75, warning = 70) => grade >= passing ? 'grade-pass'
      : grade >= warning ? 'grade-warn' : 'grade-fail',
    USE_SHS_CORE_GRADEBOOK: true, SHS_CORE_STUDENT_PASSING_THRESHOLD: 80,
    PASSING_GRADE_THRESHOLD: 75, CURRENT_SECTION: 'Class A', BACKEND_SECTION_MODE: true,
    STUDENT_LIST_GRADE_ERROR: '', BACKEND_ATTENDANCE_HISTORY_ERROR: ''
  });
  vm.runInContext(sections.slice(studentsStart, studentsEnd), context);
  context.renderTeacherStudentList();
  assert.match(rendered.columns.find(column => column.key === 'grade').render(rendered.students[0]), /grade-warn.*79/);
  assert.match(rendered.columns.find(column => column.key === 'grade').label, /Term 2 Final Grade/);
  context.USE_SHS_CORE_GRADEBOOK = false;
  context.renderTeacherStudentList();
  assert.match(rendered.columns.find(column => column.key === 'grade').render(rendered.students[0]), /grade-pass.*79/);
});
