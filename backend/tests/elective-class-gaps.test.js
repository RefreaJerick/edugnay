const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadController(name, { database, electiveTeacher, auditLog = async () => {} }) {
  const databasePath = require.resolve('../config/database');
  const accessPath = require.resolve('../utils/shsTeachingAccess');
  const auditPath = require.resolve('../utils/auditLog');
  const controllerPath = require.resolve(`../controllers/${name}`);
  const previous = [databasePath, accessPath, auditPath, controllerPath].map(key => require.cache[key]);
  require.cache[databasePath] = { ...previous[0], exports: { getDatabase: () => database } };
  require.cache[accessPath] = { ...previous[1], exports: {
    ...require('../utils/shsTeachingAccess'), assertElectiveTeacher: electiveTeacher
  } };
  require.cache[auditPath] = { ...previous[2], exports: { writeAuditLog: auditLog } };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  return { controller, restore() {
    [databasePath, accessPath, auditPath, controllerPath].forEach((key, index) => {
      if (previous[index]) require.cache[key] = previous[index];
      else delete require.cache[key];
    });
  } };
}

function response() {
  const result = { status: 200, body: null, error: null };
  return { result, res: {
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; }
  }, next(error) { result.error = error; } };
}

test('elective material upload stores no academic term while retaining teacher write access', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academix-elective-material-'));
  const filePath = path.join(directory, 'upload.pdf');
  await fs.writeFile(filePath, '%PDF-1.4\nTest material');
  const queries = [];
  const accessCalls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO learning_materials')) return [{ insertId: 91 }];
      if (sql.includes('FROM learning_materials AS materials')) return [[{
        id: 91, schoolId: 7, electiveClassId: 51, title: 'Lesson notes',
        status: 'published', originalFileName: 'upload.pdf', storedFileName: 'upload.pdf',
        className: 'Calculus A', subjectName: 'Basic Calculus'
      }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const loaded = loadController('materialsController', {
    database: { getConnection: async () => connection },
    electiveTeacher: async (_connection, user, id, options) => {
      accessCalls.push({ user, id, options });
      return { id: 51 };
    }
  });
  try {
    const req = {
      user: { id: 42, schoolId: 7, role: 'teacher' }, materialElectiveClassId: 51,
      body: { title: 'Lesson notes', status: 'published' },
      file: { path: filePath, filename: 'upload.pdf', originalname: 'upload.pdf', size: 20 }
    };
    const reply = response();
    await loaded.controller.createMaterial(req, reply.res, reply.next);
    assert.equal(reply.result.error, null);
    assert.equal(reply.result.status, 201);
    const insert = queries.find(query => query.sql.includes('INSERT INTO learning_materials'));
    assert.deepEqual(insert.values.slice(0, 7), [7, null, null, null, 51, null, 42]);
    assert.deepEqual(accessCalls.map(call => [call.id, call.options]), [[51, { write: true }]]);
    assert.equal(queries.some(query => query.sql.includes('FROM academic_terms')), false);
  } finally {
    loaded.restore();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('offline elective status is scoped to an active class member and rejects online changes', async () => {
  const previousFlag = process.env.SHS_SELECTION_ENABLED;
  process.env.SHS_SELECTION_ENABLED = 'true';
  let member = true;
  let online = false;
  let termActive = true;
  let fileAttached = false;
  let saved = null;
  const accessCalls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, values) {
      if (sql.includes('FROM assignments') && sql.includes('WHERE assignments.id')) return [[{
        id: 12, schoolId: 7, electiveClassId: 51, teacherUserId: 99,
        academicTermId: 8, academicYearStatus: 'active'
      }]];
      if (sql.includes('FROM academic_terms WHERE id = ?')) {
        assert.deepEqual(values, [8, 7, 2027, 3]);
        return [termActive ? [{ id: 8 }] : []];
      }
      if (sql.includes('SELECT online_submission_enabled AS onlineSubmissionEnabled')) {
        assert.match(sql, /shs_elective_class_id = \?/);
        assert.deepEqual(values, [12, 7, 51]);
        return [[{ onlineSubmissionEnabled: online ? 1 : 0 }]];
      }
      if (sql.includes('FROM shs_elective_class_students AS members')) {
        assert.match(sql, /members\.withdrawn_at IS NULL/);
        assert.deepEqual(values, [7, 51, 73]);
        return [member ? [{ studentId: 73 }] : []];
      }
      if (sql.includes('SELECT file_path AS filePath')) return [fileAttached ? [{ filePath: 'student.pdf' }] : []];
      if (sql.includes('INSERT INTO assignment_submissions')) { saved = values; return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const loaded = loadController('assignmentsController', {
    database: { getConnection: async () => connection },
    electiveTeacher: async (_connection, _user, id, options) => {
      accessCalls.push({ id, options });
      return { id: 51, academicYearId: 2027, schoolLevelId: 3 };
    }
  });
  const call = async () => {
    const reply = response();
    await loaded.controller.updateStudentAssignmentStatus({
      params: { assignmentId: '12', studentId: '73' }, body: { status: 'submitted' },
      user: { id: 42, schoolId: 7, role: 'teacher' }
    }, reply.res, reply.next);
    return reply.result;
  };
  try {
    const success = await call();
    assert.equal(success.error, null);
    assert.deepEqual(saved, [7, 12, 73, 'submitted']);
    assert.equal(accessCalls.some(call => call.id === 51 && call.options?.write === true), true);

    member = false; saved = null;
    const outsider = await call();
    assert.equal(outsider.error.status, 404);
    assert.equal(saved, null);

    member = true; online = true;
    const onlineResult = await call();
    assert.equal(onlineResult.error.status, 409);

    online = false; fileAttached = true;
    const attached = await call();
    assert.equal(attached.error.status, 409);

    fileAttached = false; termActive = false;
    const inactive = await call();
    assert.equal(inactive.error.status, 409);
    assert.equal(saved, null);
  } finally {
    loaded.restore();
    if (previousFlag === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = previousFlag;
  }
});

test('elective assignment badge loads on class open, stays unknown on failure, and refreshes with the tab', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
  const loader = source.match(/async function loadAssignments\([\s\S]*?(?=\n  async function createAssignment\()/)?.[0];
  assert.ok(loader);
  assert.match(source, /activeTab !== 'assignments'\) void loadAssignments\(\{ countOnly: true \}\)/);
  const badge = { textContent: '—' };
  const subtitle = { textContent: '' };
  let rendered = 0;
  let fail = false;
  let submissionFailure = false;
  let renderedItems = [];
  const context = vm.createContext({
    assignmentsRequest: 0, assignments: [], electiveClass: { electiveClassId: '51', subjectName: 'Basic Calculus' },
    canEdit: () => true, canEditAssignmentStatus: () => true, formatShortDate: value => value,
    document: { getElementById: id => id === 'assignmentCount' ? badge : subtitle },
    window: {
      EDUGNAY_API: { getShsElectiveRoster: async () => ({ students: [{ id: '73' }] }),
        getAssignmentSubmissions: async () => {
          if (submissionFailure) throw new Error('Unavailable');
          return [{ studentId: '73', status: 'submitted' }];
        },
        getAssignments: async () => {
        if (fail) throw new Error('Assignments unavailable');
        return [{ id: '12', title: 'Test', onlineSubmissionEnabled: false }];
      } },
      TeacherClassViews: { renderAssignments: items => { rendered++; renderedItems = items; }, shsAssignmentGradingLabel: () => 'Not graded' }
    }
  });
  vm.runInContext(loader, context);
  assert.equal(await context.loadAssignments({ countOnly: true }), true);
  assert.equal(badge.textContent, '1');
  assert.equal(rendered, 0);

  fail = true;
  assert.equal(await context.loadAssignments({ countOnly: true }), false);
  assert.equal(badge.textContent, '—');
  assert.equal(rendered, 0);

  fail = false;
  assert.equal(await context.loadAssignments(), true);
  assert.equal(badge.textContent, '1');
  assert.equal(rendered, 2);
  assert.equal(renderedItems[0].submittedCount, 1);
  assert.equal(renderedItems[0].totalCount, 1);

  submissionFailure = true;
  assert.equal(await context.loadAssignments(), true);
  assert.equal(renderedItems[0].totalCount, null);
  assert.match(subtitle.textContent, /Some submission counts could not be loaded/);
});

test('elective tabs reuse loaded content until an explicit refresh', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
  const loader = source.match(/function loadTab\(tab, \{ force = false \} = \{\}\) \{[\s\S]*?(?=\n  window\.AcademixElectiveClass =)/)?.[0];
  assert.ok(loader);
  let studentLoads = 0;
  const context = vm.createContext({
    electiveClass: { electiveClassId: 51 }, loadedTabs: new Set(), pendingTabs: new Map(), attendanceDay: '',
    localToday: () => '2026-11-16',
    loadStudents: async () => { studentLoads++; return true; },
    loadGrades: async () => true, loadAttendance: async () => true, loadAttendanceHistory: async () => true,
    loadAssignments: async () => true, loadMaterials: async () => true,
    document: { getElementById: () => ({ value: '' }) },
    window: { AcademixShsGradebook: { refresh: async () => true } }
  });
  vm.runInContext(loader, context);
  await context.loadTab('students');
  await context.loadTab('students');
  assert.equal(studentLoads, 1);
  await context.loadTab('students', { force: true });
  assert.equal(studentLoads, 2);
});

test('elective assignment links refresh an opened score tab and retry after failure', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
  const loader = source.match(/function loadTab\(tab, \{ force = false \} = \{\}\) \{[\s\S]*?(?=\n  window\.AcademixElectiveClass =)/)?.[0];
  assert.ok(loader);
  let scoreLoads = 0;
  let scoreRefreshes = 0;
  let refreshWorks = true;
  const context = vm.createContext({
    electiveClass: { electiveClassId: 51 }, loadedTabs: new Set(), pendingTabs: new Map(), attendanceDay: '',
    localToday: () => '2026-11-16',
    loadStudents: async () => true,
    loadGrades: async () => { scoreLoads++; return true; },
    loadAttendance: async () => true, loadAttendanceHistory: async () => true,
    loadAssignments: async () => true, loadMaterials: async () => true,
    document: { getElementById: () => ({ value: '' }) },
    window: { AcademixShsGradebook: { refresh: async () => { scoreRefreshes++; return refreshWorks; } } }
  });
  vm.runInContext(loader, context);
  assert.equal(await context.refreshScoresAfterAssignment(), true);
  assert.equal(scoreLoads, 0);
  assert.equal(await context.loadTab('scores'), true);
  assert.equal(scoreLoads, 1);
  assert.equal(await context.refreshScoresAfterAssignment(), true);
  assert.equal(scoreRefreshes, 1);
  context.window.AcademixShsGradebook.refresh = async () => undefined;
  assert.equal(await context.refreshScoresAfterAssignment(), true);
  assert.equal(scoreLoads, 2);
  context.window.AcademixShsGradebook.refresh = async () => { scoreRefreshes++; return refreshWorks; };
  refreshWorks = false;
  assert.equal(await context.refreshScoresAfterAssignment(), false);
  assert.equal(context.loadedTabs.has('scores'), false);
  assert.equal(await context.loadTab('scores'), true);
  assert.equal(scoreLoads, 3);
});

test('creating an elective assignment reports a saved link and score refresh result', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../assets/js/teacher/elective-class.js'), 'utf8');
  const create = source.match(/async function createAssignment\(event\) \{[\s\S]*?(?=\n  async function prepareAssignmentGrading\()/)?.[0];
  assert.ok(create);
  const fields = {
    assignTitleInput: { value: 'Project' }, assignInstructionsInput: { value: '' },
    assignDueInput: { value: '2026-11-20' }, assignOnlineSubmissionInput: { checked: true }
  };
  const notices = [];
  const loads = [];
  let scoreRefreshWorks = true;
  const context = vm.createContext({
    electiveClass: { electiveClassId: 51 },
    document: { querySelector: selector => selector.includes('resubmission') ? null : { disabled: false },
      getElementById: id => fields[id] },
    assignmentGradePayload: () => ({ componentCode: 'written', maxScore: 20 }),
    loadTab: async tab => { loads.push(tab); return true; },
    refreshScoresAfterAssignment: async () => scoreRefreshWorks,
    toast: (message, type) => notices.push({ message, type }),
    window: { closeModal() {}, EDUGNAY_API: { createShsElectiveAssignment: async () => ({ id: 12 }) } }
  });
  vm.runInContext(create, context);
  await context.createAssignment({ preventDefault() {} });
  assert.deepEqual(loads, ['assignments']);
  assert.equal(notices.at(-1).message, 'Assignment added.');
  scoreRefreshWorks = false;
  await context.createAssignment({ preventDefault() {} });
  assert.equal(notices.at(-1).message, 'Assignment added, but Score Recording could not refresh.');
  assert.equal(notices.at(-1).type, 'info');
});
