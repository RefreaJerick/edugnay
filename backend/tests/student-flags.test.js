const assert = require('node:assert/strict');
const test = require('node:test');
const { buildStudentFlags, getStudentFlags, lowScoreReasons } = require('../utils/studentFlags');

test('weekly low-score reasons are per subject and use the latest three scored items', () => {
  const score = (studentId, subjectId, itemId, points, maxScore = 10) => ({
    scoreId: itemId + 100, studentId, subjectId, subjectName: subjectId === 1 ? 'Math' : 'Science',
    itemId, title: `Activity ${itemId}`, itemDate: `2026-10-${String(19 + itemId).padStart(2, '0')}`,
    score: points, maxScore
  });
  const rows = [score(1, 1, 1, 7), score(1, 1, 2, 14, 20), score(1, 1, 3, 6),
    score(1, 2, 1, 6), score(1, 2, 2, 6), score(1, 2, 3, 7),
    score(2, 1, 1, 6), score(2, 1, 2, 7.5), score(2, 1, 3, 6),
    score(3, 1, 1, 6), score(3, 1, 2, 6)];
  const reasons = lowScoreReasons(rows);
  assert.deepEqual(reasons.get('1').map(reason => reason.subject), ['Math', 'Science']);
  assert.deepEqual(reasons.get('1')[0].scores.map(item => item.itemId), ['3', '2', '1']);
  assert.equal(reasons.has('2'), false);
  assert.equal(reasons.has('3'), false);
  assert.equal(lowScoreReasons([...rows, score(1, 1, 4, 8)]).get('1').some(reason => reason.subject === 'Math'), false);
});

const students = [
  { studentId: 1, name: 'Ada', initials: 'AD', sectionId: 10, sectionName: 'A', grade: 'Grade 2' },
  { studentId: 2, name: 'Ben', initials: 'BE', sectionId: 10, sectionName: 'A', grade: 'Grade 2' }
];
const record = (studentId, date, status, subjectId = 5) => ({
  studentId, date, status, subjectId, subjectName: subjectId === 5 ? 'English' : 'Math',
  sectionId: 10, sessionId: subjectId
});
const grade = (studentId, subjectId, finalGrade, termSequence, extra = {}) => ({
  studentId, subjectId, subjectName: subjectId === 5 ? 'English' : 'Math',
  finalGrade, termSequence, termName: `Term ${termSequence}`,
  publishedAt: `2026-10-0${termSequence}`, schoolLevelId: 3,
  levelCode: 'elementary', gradeCode: 'grade-2', ...extra
});
const base = { students, attendance: [], grades: [], rules: [],
  settings: { maxUnexcusedAbsences: 2, consecutiveAbsencesAlert: 2, countExcusedAbsences: false },
  yearLabel: '2026–2027' };

test('maximum counts dates once, including a mixed present and absent date', () => {
  const result = buildStudentFlags({ ...base, attendance: [
    record(1, '2026-10-01', 'absent'), record(1, '2026-10-01', 'present', 6),
    record(1, '2026-10-02', 'absent')
  ] });
  assert.equal(result.length, 1);
  assert.equal(result[0].reasons.find(reason => reason.type === 'absence').count, 2);
  assert.equal(result[0].reasons.find(reason => reason.type === 'consecutive').count, 2);
});

test('excused-only dates follow the school setting and do not count twice', () => {
  const attendance = [record(1, '2026-10-01', 'excused'),
    record(1, '2026-10-02', 'absent'), record(1, '2026-10-02', 'excused', 6)];
  assert.equal(buildStudentFlags({ ...base, attendance }).length, 0);
  const result = buildStudentFlags({ ...base, attendance,
    settings: { ...base.settings, countExcusedAbsences: true } });
  assert.equal(result[0].reasons[0].count, 2);
});

test('only the current same-subject absence streak is flagged', () => {
  const result = buildStudentFlags({ ...base, attendance: [
    record(1, '2026-10-01', 'absent'), record(1, '2026-10-02', 'present'),
    record(1, '2026-10-03', 'absent'), record(1, '2026-10-04', 'absent'),
    record(2, '2026-10-03', 'absent'), record(2, '2026-10-04', 'present')
  ], settings: { ...base.settings, maxUnexcusedAbsences: 5 } });
  assert.deepEqual(result.map(student => student.studentId), ['1']);
  assert.equal(result[0].reasons[0].type, 'consecutive');
  assert.equal(result[0].reasons[0].count, 2);
});

test('same-subject sessions count once per meeting date and mixed dates break the streak', () => {
  const attendance = [
    record(1, '2026-10-01', 'present'),
    { ...record(1, '2026-10-03', 'absent'), sessionId: 30 },
    { ...record(1, '2026-10-03', 'absent'), sessionId: 31 },
    { ...record(1, '2026-10-07', 'absent'), sessionId: 32 }
  ];
  const settings = { ...base.settings, maxUnexcusedAbsences: 9 };
  const result = buildStudentFlags({ ...base, attendance, settings });
  assert.equal(result[0].reasons[0].type, 'consecutive');
  assert.equal(result[0].reasons[0].count, 2);
  assert.deepEqual(buildStudentFlags({ ...base, attendance: [
    ...attendance, { ...record(1, '2026-10-07', 'present'), sessionId: 33 }
  ], settings }), []);
  assert.deepEqual(buildStudentFlags({ ...base, attendance: [
    ...attendance, { ...record(1, '2026-10-07', 'excused'), sessionId: 33 }
  ], settings }), []);
});

test('latest published subject grade and effective division rule determine the grade flag', () => {
  const result = buildStudentFlags({ ...base,
    grades: [grade(1, 5, 70, 1), grade(1, 5, 80, 2), grade(1, 6, 80, 1),
      grade(2, 5, 79, 1), grade(2, 6, 75, 1)],
    rules: [{ schoolLevelId: 3, gradingMode: 'school_specific', passingGradeThreshold: 80 }]
  });
  assert.deepEqual(result.map(student => student.studentId), ['2']);
  assert.deepEqual(result[0].reasons.map(reason => reason.subject), ['English', 'Math']);
  assert.equal(result[0].reasons[0].threshold, 80);
});

test('DepEd passing boundary and descriptive-grade exclusion', () => {
  const result = buildStudentFlags({ ...base, grades: [
    grade(1, 5, 75, 1), grade(1, 6, 74, 1),
    grade(2, 5, 30, 1, { gradeCode: 'grade-1' })
  ] });
  assert.deepEqual(result.map(student => student.studentId), ['1']);
  assert.equal(result[0].reasons[0].subject, 'Math');
});

test('JHS uses its own saved passing threshold and excludes future unsupported early grades', () => {
  const jhs = buildStudentFlags({ ...base, grades: [
    grade(1, 5, 84, 1, { gradeCode: 'grade-7', levelCode: 'jhs', schoolLevelId: 4 }),
    grade(2, 5, 50, 1, { gradeCode: 'grade-2' })
  ], rules: [{ schoolLevelId: 4, gradingMode: 'school_specific', passingGradeThreshold: 85 }],
  yearLabel: '2027–2028' });
  assert.deepEqual(jhs.map(student => student.studentId), ['1']);
  assert.equal(jhs[0].reasons[0].threshold, 85);
});

test('a transfer does not leave a stale streak from an earlier section', () => {
  const result = buildStudentFlags({ ...base, attendance: [
    { ...record(1, '2026-10-01', 'absent'), sectionId: 9 },
    { ...record(1, '2026-10-02', 'absent'), sectionId: 9 }
  ], settings: { ...base.settings, maxUnexcusedAbsences: 5 } });
  assert.deepEqual(result, []);
});

test('teacher query scopes roster and published grades to assignments', async () => {
  const queries = [];
  const database = { async execute(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('SELECT id, label FROM academic_years')) return [[{ id: 9, label: '2026–2027' }]];
    if (sql.includes('FROM school_attendance_settings')) return [[null]];
    if (sql.includes('FROM section_students')) return [[students[0]]];
    if (sql.includes('FROM attendance_records AS records')) return [[]];
    if (sql.includes('FROM published_final_grades')) return [[]];
    if (sql.includes('FROM school_year_final_grade_rules')) return [[]];
    if (sql.includes('FROM school_settings')) return [[]];
    if (sql.includes('FROM student_scores AS scores')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await getStudentFlags(database, { schoolId: 7, teacherId: 8 });
  const roster = queries.find(item => item.sql.includes('FROM section_students'));
  const grades = queries.find(item => item.sql.includes('FROM published_final_grades'));
  assert.deepEqual(roster.values, [7, 9, 8, 8]);
  assert.match(roster.sql, /sections\.adviser_user_id = \?/);
  assert.match(grades.sql, /assigned\.teacher_user_id = \?/);
  assert.equal(grades.values.at(-1), 8);
  assert.match(grades.sql, /published_final_grades\.school_id = \?/);
});

test('admin selected year uses saved settings and combines attendance and grade reasons', async () => {
  const queries = [];
  const database = { async execute(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('SELECT id, label FROM academic_years')) return [[{ id: 12, label: '2026–2027' }]];
    if (sql.includes('FROM school_attendance_settings')) return [[{
      maxUnexcusedAbsences: 2, consecutiveAbsencesAlert: 3, countExcusedAbsences: 1
    }]];
    if (sql.includes('FROM section_students')) return [[students[0]]];
    if (sql.includes('FROM attendance_records AS records')) return [[
      record(1, '2026-10-01', 'absent'), record(1, '2026-10-02', 'excused')
    ]];
    if (sql.includes('FROM published_final_grades')) return [[grade(1, 5, 74, 1)]];
    if (sql.includes('FROM school_year_final_grade_rules')) return [[]];
    if (sql.includes('FROM school_settings')) return [[]];
    if (sql.includes('FROM student_scores AS scores')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const result = await getStudentFlags(database, { schoolId: 7, yearId: 12 });
  assert.equal(result.maximum, 2);
  assert.deepEqual(result.students[0].reasons.map(reason => reason.type), ['absence', 'grade']);
  assert.deepEqual(queries[0].values, [7, 12]);
  assert.doesNotMatch(queries.find(item => item.sql.includes('FROM section_students')).sql,
    /sections\.adviser_user_id = \?/);
});

test('teacher flag endpoint is role protected', () => {
  const router = require('../routes/attendance');
  const routeIndex = router.stack.findIndex(layer => layer.route?.path === '/teacher-flags');
  assert.ok(routeIndex > 0);
  const guard = router.stack[routeIndex - 1].handle;
  let status;
  guard({ user: { role: 'student' } }, { status(code) { status = code; return this; }, json() {} }, () => {});
  assert.equal(status, 403);
  let advanced = false;
  guard({ user: { role: 'teacher' } }, {}, () => { advanced = true; });
  assert.equal(advanced, true);
});
