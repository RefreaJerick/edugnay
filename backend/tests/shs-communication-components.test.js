const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEPED_SHS_CORE_SUBJECTS } = require('../config/depedShsCoreSubjects');
const {
  COMMUNICATION_COMPONENTS,
  COMMUNICATION_COMPONENT_HOURS,
  averageCommunicationGrades
} = require('../config/shsCommunication');
const { buildStudentFlags, lowScoreReasons } = require('../utils/studentFlags');
const { assertMigration060, parseArguments, resolveUploadPath } = require('../scripts/purgeLegacyCommunication');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');

test('Effective Communication and Mabisang Komunikasyon stay one 160-hour core subject with 80 hours each', () => {
  const communicationSubjects = DEPED_SHS_CORE_SUBJECTS.filter(subject => subject.code === 'shs-core-communication');
  assert.equal(communicationSubjects.length, 1);
  assert.equal(communicationSubjects[0].hours, 160);
  assert.deepEqual(COMMUNICATION_COMPONENTS, {
    english: 'Effective Communication', filipino: 'Mabisang Komunikasyon'
  });
  assert.deepEqual(COMMUNICATION_COMPONENT_HOURS, { english: 80, filipino: 80 });
  assert.equal(Object.values(COMMUNICATION_COMPONENT_HOURS).reduce((sum, hours) => sum + hours, 0), 160);
});

test('legacy cleanup previews by default and requires the matching database confirmation to apply', () => {
  assert.doesNotMatch(read('backend/scripts/purgeLegacyCommunication.js'), /shs_curriculum_code/);
  assert.deepEqual(parseArguments(['--database', 'academix']), { databaseName: 'academix', apply: false });
  assert.deepEqual(parseArguments([
    '--database', 'academix', '--apply', '--confirm', 'PURGE-LEGACY-COMMUNICATION-academix'
  ]), { databaseName: 'academix', apply: true });
  assert.throws(() => parseArguments(['--apply', '--database', 'academix']), /requires --confirm/);
  assert.throws(() => parseArguments([
    '--database', 'academix', '--apply', '--confirm', 'PURGE-LEGACY-COMMUNICATION-other'
  ]), /requires --confirm/);
});

test('legacy cleanup stops when migration 060 is missing', async () => {
  const columns = [
    ['section_teachers', 'communication_component_code'],
    ['grading_items', 'communication_component_code'],
    ['assignments', 'communication_component_code'],
    ['learning_materials', 'communication_component_code'],
    ['attendance_sessions', 'communication_component_code'],
    ['attendance_sessions', 'communication_component_scope_code'],
    ['shs_grade_publication_history', 'communication_component_code'],
    ['published_final_grades', 'communication_grade_source']
  ].map(([tableName, columnName]) => ({ tableName, columnName }));
  const connection = rows => ({ async execute(sql) {
    return sql.includes('information_schema.COLUMNS') ? [rows]
      : [[{ tableName: 'shs_communication_component_grades' }]];
  } });

  await assertMigration060(connection(columns));
  await assert.rejects(assertMigration060(connection(columns.slice(1))), /Migration 060 is not fully applied/);
});

test('legacy cleanup resolves only expected upload paths inside their storage folders', () => {
  const fileName = '12345678-1234-1234-1234-123456789abc.pdf';
  const privateDirectory = path.resolve('private-uploads');
  const legacyDirectory = path.resolve('backend/uploads/assignment-submissions');
  assert.equal(resolveUploadPath(fileName, privateDirectory, legacyDirectory), path.join(privateDirectory, fileName));
  assert.equal(resolveUploadPath(`uploads/assignment-submissions/${fileName}`, privateDirectory, legacyDirectory), path.join(legacyDirectory, fileName));
  assert.equal(resolveUploadPath(`uploads/unknown/${fileName}`, privateDirectory, legacyDirectory), null);
  assert.equal(resolveUploadPath('../outside.pdf', privateDirectory, legacyDirectory), null);
});

test('component term grades average only when both valid whole-number grades exist', () => {
  assert.equal(averageCommunicationGrades(80, 81), 81);
  assert.equal(averageCommunicationGrades('84', '85'), 85);
  assert.equal(averageCommunicationGrades(0, 100), 50);
  for (const incomplete of [[80], [80, null], [80, undefined], [80, '']]) {
    assert.equal(averageCommunicationGrades(...incomplete), null);
  }
  for (const invalid of [[80, 100.5], [-1, 80], [80, 101], [NaN, 80]]) {
    assert.equal(averageCommunicationGrades(...invalid), null);
  }
});

test('low-score alerts do not mix English and Filipino component assessments', () => {
  const scores = [
    { scoreId: 1, itemId: 1, studentId: 10, subjectId: 20, communicationComponentCode: 'english', subjectName: 'Effective Communication / Mabisang Komunikasyon', itemDate: '2026-10-01', score: 60, maxScore: 100 },
    { scoreId: 2, itemId: 2, studentId: 10, subjectId: 20, communicationComponentCode: 'english', subjectName: 'Effective Communication / Mabisang Komunikasyon', itemDate: '2026-10-02', score: 60, maxScore: 100 },
    { scoreId: 3, itemId: 3, studentId: 10, subjectId: 20, communicationComponentCode: 'filipino', subjectName: 'Effective Communication / Mabisang Komunikasyon', itemDate: '2026-10-03', score: 60, maxScore: 100 }
  ];
  assert.equal(lowScoreReasons(scores).size, 0);
  const alerts = lowScoreReasons([...scores, {
    scoreId: 4, itemId: 4, studentId: 10, subjectId: 20, communicationComponentCode: 'english',
    subjectName: 'Effective Communication / Mabisang Komunikasyon', itemDate: '2026-10-04', score: 60, maxScore: 100
  }]);
  assert.equal(alerts.get('10').length, 1);
  assert.match(alerts.get('10')[0].subject, /Effective Communication$/);
});

test('consecutive absence alerts are calculated independently for each communication component', () => {
  const students = [{ studentId: 10, name: 'Learner', sectionId: 30, sectionName: 'Grade 11 A' }];
  const attendance = [
    { studentId: 10, sectionId: 30, subjectId: 20, communicationComponentCode: 'english', sessionId: 1, date: '2026-10-01', status: 'absent', subjectName: 'Effective Communication / Mabisang Komunikasyon' },
    { studentId: 10, sectionId: 30, subjectId: 20, communicationComponentCode: 'english', sessionId: 2, date: '2026-10-08', status: 'absent', subjectName: 'Effective Communication / Mabisang Komunikasyon' },
    { studentId: 10, sectionId: 30, subjectId: 20, communicationComponentCode: 'filipino', sessionId: 3, date: '2026-10-15', status: 'absent', subjectName: 'Effective Communication / Mabisang Komunikasyon' }
  ];
  const build = records => buildStudentFlags({ students, attendance: records, grades: [], rules: [], yearLabel: '2026-2027',
    settings: { maxUnexcusedAbsences: 99, consecutiveAbsencesAlert: 3 } });
  assert.deepEqual(build(attendance), []);
  const flagged = build([...attendance, {
    studentId: 10, sectionId: 30, subjectId: 20, communicationComponentCode: 'english', sessionId: 4,
    date: '2026-10-22', status: 'absent', subjectName: 'Effective Communication / Mabisang Komunikasyon'
  }]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].reasons[0].subject, 'Effective Communication / Mabisang Komunikasyon · Effective Communication');
});

test('component data stays isolated while legacy grades remain readable and write-protected', () => {
  const migration = read('backend/database/migrations/060_shs_communication_components.sql');
  const schema = read('backend/database/schema.sql');
  const assignments = read('backend/controllers/assignmentsController.js');
  const grades = read('backend/controllers/shsGradesController.js');
  const attendance = read('backend/controllers/attendanceController.js');
  const qrAttendance = read('backend/controllers/qrAttendanceController.js');
  const materials = read('backend/controllers/materialsController.js');
  const completion = read('backend/controllers/shsCompletionController.js');
  const overview = read('backend/controllers/gradesController.js');

  assert.match(migration, /UPDATE shs_grade_publication_history history[\s\S]*legacy_combined/);
  assert.match(migration, /UPDATE published_final_grades grades[\s\S]*legacy_combined/);
  assert.match(migration, /CREATE TABLE shs_communication_component_grades/);
  assert.match(schema, /communication_component_code VARCHAR\(20\) NULL/);
  assert.match(assignments, /section_teachers\.communication_component_code <=> \?/);
  assert.match(assignments, /grading_items \(school_id, section_id, subject_id, communication_component_code/);
  assert.match(grades, /Legacy combined communication records are read-only/);
  assert.match(grades, /averageCommunicationGrades\(components\.english\?\.finalGrade, components\.filipino\?\.finalGrade\)/);
  assert.match(grades, /shs_communication_component_grades/);
  assert.match(attendance, /attendance_sessions\.communication_component_code <=> \?/);
  assert.match(qrAttendance, /section_teachers\.communication_component_code <=> attendance_sessions\.communication_component_code/);
  assert.match(materials, /Legacy combined communication materials are read-only/);
  assert.match(completion, /p\.communication_grade_source = 'component_average'/);
  assert.match(overview, /communicationComponentGrades: communicationComponentRows/);
  assert.match(read('assets/js/student/grades.js'), /Effective Communication/);
  assert.match(read('assets/js/parent/grades.js'), /Mabisang Komunikasyon/);
});

test('component assignments remain distinct in teacher controls while grades stay one subject card', () => {
  const management = read('assets/js/admin/management.js');
  const teacherDashboard = read('assets/js/teacher/dashboard.js');
  const studentGrades = read('assets/js/student/grades.js');
  const parentGrades = read('assets/js/parent/grades.js');
  const gradeStyles = read('assets/css/grades.css');

  assert.match(management, /\['english', 'Effective Communication'\][\s\S]*\['filipino', 'Mabisang Komunikasyon'\]/);
  assert.match(management, /new Set\(sectionSubjects\.map\(subject => String\(subject\.subjectId\)\)\)/);
  assert.match(teacherDashboard, /function getTeacherAssignmentValue\(assignment\)/);
  assert.match(teacherDashboard, /communicationComponentCode\);/);
  assert.match(teacherDashboard, /target\.searchParams\.set\('communicationComponentCode'/);
  assert.match(read('assets/js/teacher/sections.js'), /item\.communicationComponentName \|\| item\.subjectName \|\| 'Class assignment'/);
  assert.match(read('assets/js/student/dashboard.js'), /material\.communicationComponentName \|\| material\.subjectName/);
  for (const page of [studentGrades, parentGrades]) {
    assert.match(page, /subject\.subjectCode === 'shs-core-communication'/);
    assert.match(page, /communicationComponents\.english\?\.finalGrade/);
    assert.match(page, /communicationComponents\.filipino\?\.finalGrade/);
    assert.match(page, /grade-communication-components/);
    assert.match(page, /grade-subject-row-communication/);
  }
  assert.match(gradeStyles, /\.grade-communication-components\s*\{[\s\S]*?display: grid/);
  assert.match(gradeStyles, /\.grade-subject-row-communication \.grade-subject-name\s*\{[^}]*overflow-wrap: anywhere/);
});
