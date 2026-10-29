const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const access = require('../utils/shsTeachingAccess');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function classRow(overrides = {}) {
  return {
    id: 51,
    schoolId: 7,
    teacherId: 42,
    className: 'Grade 11 Academic A',
    capacity: 30,
    classActive: 1,
    academicYearId: 2027,
    gradeLevelId: 11,
    catalogVersion: 'deped-sshs-2026-10',
    catalogCode: 'AE001',
    trackCode: 'academic',
    subjectType: 'academic_elective',
    subjectName: 'Contemporary Literature 1',
    instructionalHours: 80,
    offeringActive: 1,
    gradeCode: 'grade-11',
    gradeName: 'Grade 11',
    teacherName: 'Maya Santos',
    teacherStatus: 'active',
    academicYearLabel: '2026-2027',
    yearStatus: 'active',
    yearStartDate: '2026-10-01',
    yearEndDate: '2027-06-30',
    ...overrides
  };
}

test('Phase 4 routes stay closed unless the shared SHS release gate is exactly enabled', () => {
  const previous = process.env.SHS_SELECTION_ENABLED;
  try {
    delete process.env.SHS_SELECTION_ENABLED;
    let nextCalled = false;
    let status;
    let body;
    access.requireShsTeachingEnabled({}, {
      status(code) { status = code; return this; },
      json(value) { body = value; }
    }, () => { nextCalled = true; });
    assert.equal(status, 404);
    assert.equal(nextCalled, false);
    assert.match(body.message, /not available/i);

    process.env.SHS_SELECTION_ENABLED = 'true';
    access.requireShsTeachingEnabled({}, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = previous;
  }
});

test('teacher SHS student details are restricted to assigned classes and active class members', async () => {
  const databasePath = require.resolve('../config/database');
  const accessPath = require.resolve('../utils/shsTeachingAccess');
  const controllerPath = require.resolve('../controllers/shsTeachingController');
  const databaseModule = require(databasePath);
  const accessModule = require(accessPath);
  const savedDatabase = require.cache[databasePath];
  const savedAccess = require.cache[accessPath];
  let studentAvailable = true;
  let checkedClass = null;
  const queries = [];
  const connection = {
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('FROM shs_elective_class_students m')) return [studentAvailable ? [{
        studentId: 73, displayName: 'Elective QA Student', schoolEmail: 'student@example.test', studentNumber: '123456789'
      }] : []];
      if (sql.includes('FROM student_parent_links')) return [[{
        displayName: 'Parent Example', relationship: 'Mother', contactNumber: '555-0100', email: 'parent@example.test'
      }]];
      throw new Error('Unexpected student-details query.');
    },
    release() {}
  };
  require.cache[databasePath] = { ...savedDatabase, exports: { ...databaseModule, getDatabase: () => ({ getConnection: async () => connection }) } };
  require.cache[accessPath] = { ...savedAccess, exports: {
    ...accessModule,
    assertElectiveTeacher: async (_connection, user, classId) => {
      checkedClass = { user, classId };
      return { gradeName: 'Grade 11', className: 'Capstone QA AE011', academicYearLabel: '2026-2027' };
    }
  } };
  delete require.cache[controllerPath];
  try {
    const controller = require(controllerPath);
    const request = { params: { classId: '51', studentId: '73' }, user: { id: 42, schoolId: 7, role: 'teacher' } };
    let body = null;
    let error = null;
    await controller.studentDetails(request, { json(value) { body = value; } }, value => { error = value; });
    assert.equal(error, null);
    assert.deepEqual(checkedClass, { user: request.user, classId: 51 });
    assert.deepEqual(body.student, {
      id: '73', displayName: 'Elective QA Student', schoolEmail: 'student@example.test',
      studentNumber: '123456789', gradeLevel: 'Grade 11', sectionName: 'Capstone QA AE011',
      schoolYear: '2026-2027', enrollmentStatus: 'Enrolled'
    });
    assert.equal(body.parents[0].displayName, 'Parent Example');
    assert.match(queries[0].sql, /m\.withdrawn_at IS NULL/);
    assert.deepEqual(queries[0].values, [7, 51, 73]);
    assert.match(queries[1].sql, /student_parent_links\.school_id = \? AND student_parent_links\.student_user_id = \?/);

    studentAvailable = false;
    error = null;
    await controller.studentDetails(request, { json() { assert.fail('An unassigned student must not be returned.'); } }, value => { error = value; });
    assert.equal(error?.status, 404);
    assert.match(error.message, /not found in this class/i);
    assert.equal(queries.length, 3, 'guardian records are not queried when the class membership check fails');
  } finally {
    delete require.cache[controllerPath];
    require.cache[databasePath] = savedDatabase;
    require.cache[accessPath] = savedAccess;
  }
});

test('elective class access requires a current approved catalog entry and track', async () => {
  const db = { async execute(sql) {
    assert.match(sql, /y\.label AS academicYearLabel/);
    return [[classRow()]];
  } };
  const item = await access.getElectiveClass(db, 7, 51);
  assert.equal(item.id, 51);
  assert.equal(item.academicYearLabel, '2026-2027');

  for (const overrides of [
    { schoolId: 8 },
    { catalogVersion: 'old-version' },
    { instructionalHours: 240 },
    { subjectName: 'Unapproved subject' },
    { trackCode: 'techpro' }
  ]) {
    const invalid = await access.getElectiveClass({ async execute() { return [[classRow(overrides)]]; } }, 7, 51);
    assert.equal(invalid, null);
  }
});

test('catalog keeps Academic and TechPro Work Immersion distinct through teaching access', async () => {
  const academicWorkImmersion = classRow({
    catalogCode: 'WI-ACADEMIC-320', trackCode: 'academic', subjectType: 'academic_elective',
    subjectName: 'Work Immersion for Academic Track', instructionalHours: 320, gradeCode: 'grade-12'
  });
  const techproWorkImmersion = classRow({
    catalogCode: 'WI-320', trackCode: 'techpro', subjectType: 'work_immersion',
    subjectName: 'Work Immersion', instructionalHours: 320, gradeCode: 'grade-12'
  });
  for (const row of [academicWorkImmersion, techproWorkImmersion]) {
    const item = await access.getElectiveClass({ async execute() { return [[row]]; } }, 7, 51);
    assert.ok(item);
    assert.equal(item.assessmentGroup, 'work_immersion');
  }
  assert.equal((await access.getElectiveClass({ async execute() {
    return [[{ ...academicWorkImmersion, trackCode: 'techpro' }]];
  } }, 7, 51)), null);
});

test('teacher and student access is scoped to assigned teacher and explicit elective membership', async () => {
  const teacherDb = { async execute() { return [[classRow()]]; } };
  await assert.doesNotReject(() => access.assertElectiveTeacher(teacherDb, { id: 42, schoolId: 7 }, 51));
  await assert.rejects(() => access.assertElectiveTeacher(teacherDb, { id: 99, schoolId: 7 }, 51), /not found/i);
  await assert.rejects(() => access.assertElectiveTeacher({ async execute() { return [[classRow({ yearStatus: 'archived' })]]; } },
    { id: 42, schoolId: 7 }, 51, { write: true }), /archived/i);

  const calls = [];
  const studentDb = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM shs_elective_class_students')) return [[{ withdrawnAt: null }]];
    return [[classRow()]];
  } };
  await assert.doesNotReject(() => access.assertElectiveStudent(studentDb, { id: 73, schoolId: 7 }, 51, { write: true }));
  assert.deepEqual(calls[1].values, [7, 51, 73]);
  assert.match(calls[1].sql, /elective_class_id = \? AND student_user_id = \?/);
  assert.doesNotMatch(calls[1].sql, /section_students/);

  const withdrawnDb = { async execute(sql) {
    return sql.includes('FROM shs_elective_class_students')
      ? [[{ withdrawnAt: '2027-01-01 10:00:00' }]] : [[classRow()]];
  } };
  await assert.rejects(() => access.assertElectiveStudent(withdrawnDb, { id: 73, schoolId: 7 }, 51, { write: true }), /no longer active/i);
});

test('withdrawal blocks new elective work but retains the learnerâ€™s earlier records', () => {
  const assignments = read('backend/controllers/assignmentsController.js');
  const attendance = read('backend/controllers/attendanceController.js');
  const studentPage = read('views/student/edugnay-student-assignments.html');

  assert.match(assignments, /assertElectiveStudent\(getDatabase\(\), req\.user, assignment\.electiveClassId, \{ write: true \}\)/);
  assert.match(assignments, /assignment = await getAssignmentForManagement\(connection, req\.user, assignmentId, true\);[\s\S]*?assertElectiveTeacher\(connection, req\.user, assignment\.electiveClassId, \{ write: true \}\)/);
  assert.match(assignments, /em\.withdrawn_at IS NULL OR assignments\.created_at <= em\.withdrawn_at/);
  assert.match(assignments, /assignments\.created_at <= em\.withdrawn_at[\s\S]*?\/api\/assignments\/history/);
  assert.match(studentPage, /readOnlyElective[\s\S]*?Enrollment ended/);
  assert.match(studentPage, /Your earlier submission remains available/);
  assert.match(attendance, /em\.withdrawn_at IS NULL OR s\.attendance_date <= DATE\(em\.withdrawn_at\)/);
});

test('migration and controllers keep attendance, assignments, and materials in one exclusive class scope', () => {
  const migration = read('backend/database/migrations/053_shs_elective_teaching.sql');
  const schema = read('backend/database/schema.sql');
  const attendance = read('backend/controllers/attendanceController.js');
  const qr = read('backend/controllers/qrAttendanceController.js');
  const assignments = read('backend/controllers/assignmentsController.js');
  const materials = read('backend/controllers/materialsController.js');
  const routes = read('backend/routes/shsTeaching.js');

  assert.match(migration, /uq_attendance_elective_class_date \(school_id, shs_elective_class_id, attendance_date\)/);
  assert.match(migration, /ck_assignment_scope CHECK/);
  assert.match(migration, /ck_material_scope CHECK/);
  assert.match(migration, /section_id IS NOT NULL AND subject_id IS NOT NULL/);
  assert.match(schema, /ck_elective_assignment_grading_scope CHECK[\s\S]*grading_item_id IS NULL OR/);
  assert.match(read('backend/database/migrations/054_strengthened_shs_grading.sql'), /DROP CONSTRAINT ck_elective_assignment_ungraded/);
  assert.match(schema, /grading_item_id BIGINT UNSIGNED NULL/);
  assert.match(schema, /fk_assignments_tenant_grading_item[\s\S]*REFERENCES grading_items\(school_id, id\)/);
  assert.match(attendance, /getElectiveRoster\(connection, item\.schoolId, classId\)/);
  assert.match(attendance, /uq_attendance_elective_class_date|shs_elective_class_id = \? AND attendance_date = \?/);
  assert.match(qr, /credential\.studentId\]/);
  assert.match(qr, /student_user_id = \? AND withdrawn_at IS NULL/);
  assert.match(assignments, /Elective assignments cannot be graded in this phase/);
  assert.match(assignments, /assertElectiveStudent\(getDatabase\(\), req\.user, assignment\.electiveClassId, \{ write: true \}\)/);
  assert.match(materials, /authorizeElectiveUpload/);
  assert.match(materials, /assertElectiveTeacher\(connection, req\.user, req\.materialElectiveClassId, \{ write: true \}\)/);
  assert.match(routes, /router\.use\(requireAuth, requireSchoolUser, requireShsTeachingEnabled\)/);
  assert.match(routes, /materialUpload\.single\('file'\)/);
});

test('attendance scope preserves legacy section-only sessions without mixing elective scope', () => {
  const migration = read('backend/database/migrations/053_shs_elective_teaching.sql');
  const schema = read('backend/database/schema.sql');
  const migrationScope = migration.match(/ADD CONSTRAINT ck_attendance_session_scope CHECK \(([\s\S]*?)\r?\n  \);/)?.[1] || '';
  const schemaScope = schema.match(/CONSTRAINT ck_attendance_session_scope CHECK \(([\s\S]*?)\r?\n  \)\r?\n\) ENGINE/)?.[1] || '';

  for (const scope of [migrationScope, schemaScope]) {
    assert.ok(scope, 'attendance scope constraint should exist');
    assert.match(scope, /shs_elective_class_id IS NOT NULL AND section_id IS NULL AND subject_id IS NULL/);
    assert.match(scope, /shs_elective_class_id IS NULL AND section_id IS NOT NULL/);
    assert.doesNotMatch(scope, /subject_id IS NOT NULL/);
  }
});

test('My Classes keeps one shared workspace for sections and SHS classes', () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const teaching = read('assets/js/teacher/elective-class.js');
  const teachingAccess = read('backend/utils/shsTeachingAccess.js');
  const teachingController = read('backend/controllers/shsTeachingController.js');
  const teachingRoutes = read('backend/routes/shsTeaching.js');
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  const shell = read('assets/js/teacher/shell.js');
  const timetables = read('backend/controllers/timetablesController.js');

  assert.match(page, /<title>My Classes \| Academix<\/title>/);
  assert.equal((page.match(/id="teacher-section-workspace"/g) || []).length, 1);
  assert.doesNotMatch(page, /elective-class-workspace|shs-core-gradebook|elective-workspace\.css/);
  for (const tab of ['students', 'scores', 'attendance', 'assignments', 'materials']) {
    assert.equal((page.match(new RegExp('id="content-' + tab + '"', 'g')) || []).length, 1);
    assert.equal((page.match(new RegExp('id="tab-' + tab + '"', 'g')) || []).length, 1);
  }
  for (const id of ['studentTable', 'studentTbody', 'scoreTable', 'scoreTbody', 'attTable', 'attTbody',
    'assignmentList', 'teacherMaterialsList', 'addAssignmentModal', 'uploadModal', 'qrAttendanceModal']) {
    assert.match(page, new RegExp('id="' + id + '"'));
  }
  assert.match(page, /id="addCompModal"/);
  assert.match(page, /id="publishModal"/);
  assert.doesNotMatch(page, /id="shsGradingRuleModal"/);
  assert.match(teaching, /getShsElectiveRoster/);
  assert.match(teachingAccess, /u\.school_email AS schoolEmail/);
  assert.match(teaching, /TeacherClassViews\.renderStudents/);
  assert.match(teaching, /details: true/);
  assert.match(teaching, /getStudent: id => studentRoster\.find/);
  assert.match(teaching, /School Email/);
  assert.match(teaching, /Attendance Rate/);
  assert.match(teaching, /Final Grade/);
  assert.match(teaching, /getShsGradeWorkspace/);
  assert.match(teaching, /TeacherClassViews\.renderAttendanceRows/);
  assert.match(teaching, /TeacherClassViews\.renderAttendanceHistory/);
  assert.match(page, /function renderSharedQrAttendanceScans/);
  assert.match(page, /function renderSharedQrAttendanceFinalReview/);
  assert.match(teaching, /TeacherClassViews\.renderQrAttendanceScans/);
  assert.match(teaching, /TeacherClassViews\.renderQrAttendanceFinalReview/);
  assert.match(teaching, /getShsElectiveAttendance/);
  assert.match(teaching, /getShsElectiveAttendanceHistory/);
  assert.doesNotMatch(teaching, /attendanceHistoryHeadRow|attendanceHistoryTbody|content-attendance \.panel:nth-child\(2\)/);
  assert.match(teaching, /saveShsElectiveAttendance/);
  assert.match(teaching, /scanShsElectiveQrAttendance/);
  assert.match(teaching, /TeacherClassViews\.renderAssignments/);
  assert.match(teaching, /TeacherClassViews\.renderMaterials/);
  assert.match(teaching, /TeacherClassViews\.renderAssignmentSubmissions/);
  assert.doesNotMatch(teaching, /assignment-card|material-item|attendance-entry-row|qr-attendance-student|qr-attendance-final-row/);
  assert.match(teaching, /edugnay:teacher-materials-changed/);
  assert.match(page, /data-material-action="publish"/);
  assert.match(page, /data-material-action="remove"/);
  assert.match(teaching, /#content-scores \.panel/);
  assert.match(teaching, /uploadShsElectiveMaterial/);
  assert.match(gradebook, /getShsGradeWorkspace/);
  assert.match(gradebook, /TeacherClassViews\.renderScoreTable/);
  assert.match(gradebook, /TeacherClassViews\.renderScoreCategories/);
  const gradebookRenderer = gradebook.match(/function renderTable\([\s\S]*?\n  \}\n/)?.[0] || '';
  assert.match(gradebookRenderer, /TeacherClassViews\.renderScoreTable/);
  assert.doesNotMatch(gradebookRenderer, /thead\.innerHTML|tbody\.innerHTML/);
  assert.match(gradebook, /host\.querySelector\('#academicPeriodSelect'\)/);
  assert.match(gradebook, /updateSectionHeaderFromGradebook/);
  assert.match(gradebook, /updateHeaderGradeStatus/);
  assert.match(gradebook, /getElementById\('addCompModal'\)/);
  assert.doesNotMatch(gradebook, /elective-grade-table|shs-grade-toolbar|data-grade-item-modal/);
  assert.doesNotMatch(teaching, /style=/);
  assert.doesNotMatch(gradebook, /style=/);
  assert.match(shell, /getShsTeachingClasses\(\)/);
  assert.match(shell, /getAssignedTeacherShsClasses/);
  assert.match(teachingController, /t\.account_status AS teacherStatus/);
  assert.match(teachingController, /AS activePeriodName/);
  assert.match(teachingController, /async function studentDetails\(/);
  assert.match(teachingController, /assertElectiveTeacher\(connection, req\.user, classId\)/);
  assert.match(teachingController, /m\.withdrawn_at IS NULL LIMIT 1/);
  assert.match(teachingRoutes, /\/classes\/:classId\/students\/:studentId\/details', requireTeacher, controller\.studentDetails/);
  assert.match(timetables, /req\.user\.role === 'school_admin' \|\| process\.env\.SHS_SELECTION_ENABLED === 'true'/);
  assert.equal(fs.existsSync(path.join(root, 'assets/css/teacher/elective-workspace.css')), false);
});

test('SHS Score Recording uses the regular Add Component modal controls', () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  assert.match(page, /id="addScoreComponentSubmit"/);
  assert.match(page, /class="comp-type-opts" id="compTypeOpts"/);
  assert.match(page, /class="comp-type-opt cat-ww selected"/);
  assert.doesNotMatch(page, /id="shsGradeAssignmentGroup"/);
  assert.doesNotMatch(page, /scoreDateGivenGroup|Date Given/);
  assert.doesNotMatch(gradebook, /scoreDateGivenGroup|Date Given/);
  assert.match(gradebook, /TeacherClassViews\.renderComponentChoices/);
  assert.match(page, /class="comp-type-opt \$\{window\.EDUGNAY_CONFIG\.escapeHtml/);
  assert.match(gradebook, /Score Recording: '/);
  assert.match(gradebook, /Add Component/);
  assert.doesNotMatch(gradebook, /body\.innerHTML\s*=/);
  assert.doesNotMatch(gradebook, /Add assessment/);
});

test('regular Add Component uses the shared modal without Date Given setup', () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const start = page.indexOf('function openScoreComponentModal() {');
  const end = page.indexOf("\n    document.getElementById('compTypeOpts')", start);
  const openModal = start >= 0 && end > start ? page.slice(start, end) : '';
  assert.match(openModal, /submitButton\.onclick = addComponent/);
  assert.doesNotMatch(openModal, /shsGradeAssignmentGroup/);
  assert.doesNotMatch(openModal, /scoreDateGivenGroup|Date Given/);
  assert.match(openModal, /compNameInput'\)\.readOnly = false/);
});

test('SHS Add Component keeps the shared form and saves the selected policy category', async () => {
  const source = read('assets/js/teacher/shs-gradebook.js');
  const configure = source.match(/function configureAddAssessmentModal\([\s\S]*?\n  \}\n\n  function renderCategoryTabs/)?.[0]
    .replace(/\n\n  function renderCategoryTabs$/, '');
  assert.ok(configure);
  const makeCard = code => {
    const card = {
      dataset: { componentCode: code }, selected: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    };
    card.classList = { toggle(_name, value) { card.selected = value; } };
    return card;
  };
  const cards = [makeCard('written'), makeCard('examination')];
  cards[0].selected = true;
  const choices = {
    innerHTML: '', onclick: null,
    querySelectorAll: () => cards,
    querySelector: () => cards.find(card => card.selected) || null,
    contains: card => cards.includes(card)
  };
  const titleInput = { value: '', readOnly: false, placeholder: '', maxLength: 0, reportValidity: () => true };
  const maxInput = { value: '', min: '', max: '', step: '', reportValidity: () => true };
  const examSelect = { innerHTML: '', value: '', required: false };
  const examGroup = { hidden: true };
  const save = { disabled: false, onclick: null };
  const body = {
    innerHTML: 'shared regular component form',
    querySelector(selector) {
      return ({
        '#compTypeOpts': choices,
        '#compNameInput': titleInput,
        '#compMaxInput': maxInput,
        '#scoreExamPartGroup': examGroup,
        '#scoreExamPartInput': examSelect
      })[selector] || null;
    }
  };
  const modal = { querySelector: selector => selector === '.modal-body' ? body : selector === '#addScoreComponentSubmit' ? save : null };
  const calls = { values: null, closed: false, reloadTerm: null };
  const components = [
    { code: 'written', name: 'Written/Oral Works', weight: 20, examParts: {} },
    { code: 'examination', name: 'Examinations', weight: 30, examParts: { term_exam: { name: 'Term Exam', weight: 40 } } }
  ];
  const context = vm.createContext({
    document: { getElementById: () => modal },
    window: { lucide: { createIcons() {} }, closeModal() { calls.closed = true; },
      TeacherClassViews: { renderComponentChoices(host, entries) {
        host.innerHTML = entries.map(entry => `${entry.name} ${entry.weight}% of final grade`).join(' ');
      } } },
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    categoryCode: item => item.code === 'written' ? 'WW' : item.code === 'examination' ? 'QA' : 'PT',
    api: () => ({ createShsGradingItem: async values => { calls.values = values; } }),
    toast() {}
  });
  vm.runInContext(`${configure}; globalThis.configure = configureAddAssessmentModal;`, context);
  const data = { scope: { policy: { components } }, term: { id: 'term-5' } };
  const scope = { electiveClassId: 'class-77' };
  await context.configure(data, scope, true, async termId => { calls.reloadTerm = termId; });
  assert.equal(body.innerHTML, 'shared regular component form');
  assert.match(choices.innerHTML, /Written\/Oral Works/);
  assert.match(choices.innerHTML, /20% of final grade/);
  assert.equal(examGroup.hidden, true);

  choices.onclick({ target: { closest: () => cards[1] } });
  assert.equal(examGroup.hidden, false);
  assert.match(examSelect.innerHTML, /Term Exam/);
  titleInput.value = 'Term exam';
  maxInput.value = '100';
  examSelect.value = 'term_exam';
  await save.onclick({ preventDefault() {} });
  assert.equal(calls.values.componentCode, 'examination');
  assert.equal(calls.values.examPartCode, 'term_exam');
  assert.equal(calls.values.assignmentId, undefined);
  assert.equal(calls.values.maxScore, '100');
  assert.equal(calls.closed, true);
  assert.equal(calls.reloadTerm, 'term-5');
});

test('SHS assignment loading does not hold the grade workspace and the roster heading survives rendering', () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const teaching = read('assets/js/teacher/elective-class.js');
  const gradebook = read('assets/js/teacher/shs-gradebook.js');
  assert.match(gradebook, /const data = await api\(\)\.getShsGradeWorkspace\(query\)/);
  assert.doesNotMatch(gradebook, /getAssignments\(\{ electiveClassId: activeScope\.electiveClassId \}\)/);
  assert.match(page, /const periodName = column\.periodName \|\| \(String\(column\.label \|\| ''\)\.endsWith\(' Final Grade'\)/);
  assert.match(page, /id="studentGradePeriodName">\$\{window\.EDUGNAY_CONFIG\.escapeHtml\(periodName\)\}/);
  assert.doesNotMatch(teaching, /getElementById\('studentGradePeriodName'\)/);
  assert.match(teaching, /periodName: 'Current period'/);
  assert.match(teaching, /columns\[4\]\.periodName = workspace\.term\?\.name/);
});

test('My Classes uses the shared static page without a second Elective Class page', () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const dashboard = read('views/teacher/edugnay-teacher-dashboard.html');
  assert.match(page, /id="teacher-section-workspace"/);
  assert.match(page, /teacher\/elective-class\.js/);
  assert.match(page, /teacher\/shs-gradebook\.js/);
  assert.equal(fs.existsSync(path.join(root, 'views/teacher/edugnay-teacher-elective-class.html')), false);
  assert.match(dashboard, /TEACHER_CLASSES = \[/);
  assert.match(dashboard, /getShsTeachingClasses\(\)/);
  assert.match(dashboard, /My Classes/);
});

test('SHS assignment grading uses the existing assignment controls and transaction', async () => {
  const page = read('views/teacher/edugnay-teacher-sections.html');
  const teaching = read('assets/js/teacher/elective-class.js');
  const assignments = read('backend/controllers/assignmentsController.js');
  const grades = read('backend/controllers/shsGradesController.js');
  assert.match(page, /id="assignGradingInput"/);
  assert.match(page, /id="editAssignmentGradingInput"/);
  assert.doesNotMatch(page, /id="shsGradeAssignment"/);
  assert.match(teaching, /grade = assignmentGradePayload\(false\)/);
  assert.match(teaching, /grade,?\s*\n\s*\}/);
  assert.match(assignments, /await createLinkedAssignmentItem\(connection, req, electiveClass\.id, result\.insertId/);
  assert.match(assignments, /await createLinkedAssignmentItem\(connection, req, current\.electiveClassId, assignmentId/);
  assert.match(assignments, /writeAuditLog\(connection, req, 'assignment_created', 'assignment', result\.insertId/);
  assert.match(assignments, /scoreComponentCreated: Boolean\(assignment\.gradingItemId\)/);
  assert.match(grades, /if \(options\.recordActivity !== false\)/);
  const helper = grades.match(/async function createLinkedAssignmentItem\([\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const connection = {};
  const calls = [];
  const context = vm.createContext({
    resolveScope: async (db, _user, input, write) => {
      assert.equal(db, connection);
      assert.equal(input.electiveClassId, 77);
      calls.push(write ? 'write-scope' : 'read-scope');
      return { kind: 'elective' };
    },
    lockYear: async db => { assert.equal(db, connection); calls.push('lock-year'); },
    assertTerm: async (db, _scope, termId, write) => {
      assert.equal(db, connection); assert.equal(termId, 5); assert.equal(write, true);
      calls.push('check-term');
    },
    id: value => Number(value),
    insertItem: async (db, _req, _scope, termId, values, options) => {
      assert.equal(db, connection); assert.equal(termId, 5); assert.equal(values.assignmentId, 9);
      assert.equal(options.recordActivity, false);
      calls.push('insert-item');
      return 101;
    }
  });
  vm.runInContext(`${helper}; globalThis.createLinked = createLinkedAssignmentItem;`, context);
  assert.equal(await context.createLinked(connection, { id: 42 }, 77, 9, { academicTermId: 5 }), 101);
  assert.deepEqual(calls, ['read-scope', 'lock-year', 'write-scope', 'check-term', 'insert-item']);
});

test('SHS Student List shows names before attendance and grades finish', async () => {
  const teaching = read('assets/js/teacher/elective-class.js');
  const source = teaching.match(/async function loadStudents\(\) \{[\s\S]*?\n  \}\n\n  function localToday/)?.[0]
    .replace(/\n\n  function localToday$/, '');
  assert.ok(source);
  let resolveHistory;
  let resolveGrades;
  const renders = [];
  const context = vm.createContext({
    electiveClass: { electiveClassId: '77', className: 'Sample class' },
    escapeHtml: value => String(value),
    window: {
      EDUGNAY_API: {
        getShsElectiveRoster: async () => ({ students: [{ id: '8', displayName: 'Learner' }] }),
        getShsElectiveAttendanceHistory: () => new Promise(resolve => { resolveHistory = resolve; }),
        getShsGradeWorkspace: () => new Promise(resolve => { resolveGrades = resolve; })
      },
      TeacherClassViews: { renderStudents: value => renders.push(value) }
    },
    loadHeaderGradeWorkspace: () => new Promise(resolve => { resolveGrades = resolve; })
  });
  vm.runInContext(`${source}; globalThis.load = loadStudents;`, context);
  const loading = context.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders.at(-1).students[0].displayName, 'Learner');
  resolveHistory({ sessions: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders.at(-1).students[0].attendanceRate, '—');
  resolveGrades({ published: [], students: [], term: { name: 'Term 1' } });
  await loading;
  assert.equal(renders.at(-1).columns[4].periodName, 'Term 1');
});

test('SHS class header shows the selected grading period and saved-score progress', () => {
  const teaching = read('assets/js/teacher/elective-class.js');
  const source = teaching.match(/function updateHeaderGradeStatus\(workspaceData\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source);
  const nodes = {
    sectionPeriodName: { textContent: '' },
    sectionEncodingStatus: { textContent: '' }
  };
  const yearNode = { textContent: '' };
  let editable = true;
  const context = vm.createContext({
    classId: '77',
    electiveClass: { electiveClassId: '77', activePeriodName: 'Term 1', schoolYear: '2026-2027' },
    canEdit: () => editable,
    document: {
      getElementById: id => nodes[id],
      querySelector: () => yearNode
    }
  });
  vm.runInContext(`${source}; globalThis.update = updateHeaderGradeStatus;`, context);
  context.update({
    scope: { yearStatus: 'active', policy: {} },
    term: { name: 'Term 2', status: 'active' },
    students: [{ studentId: '1' }, { studentId: '2' }],
    items: [{ id: '11', maxScore: 10 }, { id: '12', maxScore: 20 }],
    scores: [
      { studentId: '1', gradingItemId: '11', score: 0 },
      { studentId: '1', gradingItemId: '12', score: 19 },
      { studentId: '2', gradingItemId: '11', score: 8 }
    ]
  });
  assert.equal(nodes.sectionPeriodName.textContent, 'Term 2');
  assert.equal(nodes.sectionEncodingStatus.textContent, '1 of 2 encoded');
  assert.equal(yearNode.textContent, '2026-2027');

  editable = false;
  context.update({ scope: { yearStatus: 'active', policy: {} }, term: { name: 'Term 2', status: 'active' } });
  assert.equal(nodes.sectionEncodingStatus.textContent, 'Read only');
});

test('a failed SHS assignment grade link rolls back the assignment', async () => {
  const assignments = read('backend/controllers/assignmentsController.js');
  const source = assignments.match(/async function createElectiveAssignment\([\s\S]*?\n\}\n\nasync function removeUploadedFile/)?.[0]
    .replace(/\n\nasync function removeUploadedFile$/, '');
  assert.ok(source);
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute() { calls.push('insert'); return [{ insertId: 19 }]; },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    assertElectiveTeacher: async () => ({ id: 77, schoolId: 5 }),
    parseId: Number,
    requiredText: value => value,
    optionalText: value => value,
    dateTime: value => value,
    ASSIGNMENT_STATUSES: new Set(['published']),
    createLinkedAssignmentItem: async () => { throw new Error('Grading period unavailable'); }
  });
  vm.runInContext(`${source}; globalThis.create = createElectiveAssignment;`, context);
  let failure;
  await context.create({ user: { id: 42, schoolId: 5 }, params: { classId: '77' }, body: {
    title: 'Task', description: '', dueAt: '2026-11-01T23:59:00', grade: { academicTermId: 1 }
  } }, {}, error => { failure = error; });
  assert.equal(failure.message, 'Grading period unavailable');
  assert.deepEqual(calls, ['begin', 'insert', 'rollback', 'release']);
});
