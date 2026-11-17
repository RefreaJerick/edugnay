const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controller = fs.readFileSync(path.join(__dirname, '../controllers/assignmentsController.js'), 'utf8');
const updateSource = controller.match(/async function updateAssignment\([\s\S]*?(?=async function deleteAssignment\()/)?.[0];
const page = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');
const saveSource = page.match(/async function saveShsCoreAssignmentChanges\([\s\S]*?(?=async function openAssignmentSubmissionsModal\()/)?.[0];
const sharedSaveSource = page.match(/async function saveAssignmentChanges\([\s\S]*?(?=async function saveShsCoreAssignmentChanges\()/)?.[0];

test('SHS core edit saves replacement limit and grading link for a fresh read', async () => {
  assert.ok(updateSource);
  const stored = {
    id: 14, schoolId: 1, sectionId: 8, subjectId: 4, academicTermId: 6,
    communicationComponentCode: null, teacherUserId: 5, title: 'Project', description: null,
    dueAt: null, onlineSubmissionEnabled: 1, maxResubmissions: null, gradingItemId: null,
    status: 'published'
  };
  const operations = [];
  let ignoreWrites = false;
  const connection = {
    async beginTransaction() { operations.push('begin'); },
    async commit() { operations.push('commit'); },
    async rollback() { operations.push('rollback'); },
    release() {},
    async execute(sql, values) {
      if (!sql.startsWith('UPDATE assignments SET published_at')) throw new Error(`Unexpected query: ${sql}`);
      if (ignoreWrites) return [{ affectedRows: 0 }];
      stored.title = values[1];
      stored.description = values[2];
      stored.dueAt = values[3];
      stored.onlineSubmissionEnabled = values[4];
      stored.allowLateSubmissions = values[5];
      stored.maxResubmissions = values[6];
      stored.status = values[7];
      return [{ affectedRows: 1 }];
    }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    parseId: Number, requiredAcademicTermId: Number,
    getAssignmentForManagement: async () => ({ ...stored }),
    assertAssignmentYearWritable() {},
    getTeacherSectionSubject: async () => ({ shsCurriculumCode: 'strengthened_2026', shsSubjectType: 'core' }),
    validateTermAndCategory: async () => {}, requiredText: value => value,
    optionalText: value => value, dateTime: value => value,
    resubmissionLimit: value => value == null ? null : Number(value),
    allowLateSubmissions: value => value === true,
    ASSIGNMENT_STATUSES: new Set(['published']),
    createLinkedAssignmentItem: async () => { stored.gradingItemId = 18; stored.maxScore = 25; },
    nullableNumber: value => value == null ? null : Number(value),
    assignmentDetailsChanged: () => true, writeAuditLog: async () => {},
    assignmentAuditDetails: () => ({}), formatAssignment: row => ({ ...row }),
    createError: (message, status) => Object.assign(new Error(message), { status })
  });
  vm.runInContext(updateSource, context);
  let response;
  let failure;
  await context.updateAssignment({
    params: { assignmentId: '14' }, user: { id: 5, schoolId: 1, role: 'teacher' },
    body: { title: 'Project', academicTermId: 6, onlineSubmissionEnabled: true,
      maxResubmissions: 2, grade: { componentCode: 'written', maxScore: 25 } }
  }, { json(value) { response = value; } }, error => { failure = error; });
  assert.ifError(failure);
  assert.equal(response.assignment.maxResubmissions, 2);
  assert.equal(response.assignment.gradingItemId, 18);
  assert.equal(stored.maxResubmissions, 2);
  assert.equal(stored.gradingItemId, 18);
  assert.deepEqual(operations, ['begin', 'commit']);

  ignoreWrites = true;
  response = null;
  failure = null;
  await context.updateAssignment({
    params: { assignmentId: '14' }, user: { id: 5, schoolId: 1, role: 'teacher' },
    body: { maxResubmissions: 5 }
  }, { json(value) { response = value; } }, error => { failure = error; });
  assert.equal(response, null);
  assert.equal(failure?.status, 409);
  assert.equal(operations.at(-1), 'rollback');
});

test('SHS elective edit saves replacement limit and grading link for a fresh read', async () => {
  const stored = {
    id: 21, schoolId: 1, electiveClassId: 33, sectionId: null, academicTermId: 6,
    title: 'Project', description: null, dueAt: null, onlineSubmissionEnabled: 1,
    maxResubmissions: null, gradingItemId: null, status: 'published'
  };
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, values) {
      if (sql.includes('FROM academic_terms WHERE id = ?')) return [[{ id: 6 }]];
      if (sql.startsWith('UPDATE assignments SET published_at')) {
        stored.title = values[1];
        stored.description = values[2];
        stored.dueAt = values[3];
        stored.onlineSubmissionEnabled = values[4];
        stored.allowLateSubmissions = values[5];
        stored.maxResubmissions = values[6];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT assignment')) return [[{ ...stored }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    parseId: Number, getAssignmentForManagement: async () => ({ ...stored }),
    assertAssignmentYearWritable() {}, assertElectiveTeacher: async () => ({ academicYearId: 1, schoolLevelId: 2 }),
    requiredText: value => value, optionalText: value => value, dateTime: value => value,
    resubmissionLimit: value => value == null ? null : Number(value),
    allowLateSubmissions: value => value === true,
    ASSIGNMENT_STATUSES: new Set(['published']),
    createLinkedAssignmentItem: async () => { stored.gradingItemId = 28; stored.maxScore = 25; },
    nullableNumber: value => value == null ? null : Number(value),
    comparableDateTime: value => value || null,
    assignmentSelect: () => 'SELECT assignment', writeAuditLog: async () => {},
    formatAssignment: row => ({ ...row }),
    createError: (message, status) => Object.assign(new Error(message), { status })
  });
  vm.runInContext(updateSource, context);
  let response;
  let failure;
  await context.updateAssignment({
    params: { assignmentId: '21' }, user: { id: 5, schoolId: 1, role: 'teacher' },
    body: { maxResubmissions: 3, grade: { componentCode: 'written', maxScore: 25 } }
  }, { json(value) { response = value; } }, error => { failure = error; });
  assert.ifError(failure);
  assert.equal(response.assignment.maxResubmissions, 3);
  assert.equal(response.assignment.gradingItemId, 28);
  assert.equal(stored.maxResubmissions, 3);
  assert.equal(stored.gradingItemId, 28);
});

test('SHS elective edit rejects an inactive assignment term', async () => {
  const connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.includes('FROM academic_terms WHERE id = ?')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    parseId: Number,
    getAssignmentForManagement: async () => ({ id: 21, electiveClassId: 33, academicTermId: 6 }),
    assertAssignmentYearWritable() {},
    assertElectiveTeacher: async () => ({ academicYearId: 1, schoolLevelId: 2 }),
    createError: (message, status) => Object.assign(new Error(message), { status })
  });
  vm.runInContext(updateSource, context);
  let failure;
  await context.updateAssignment({ params: { assignmentId: '21' }, user: { id: 5, schoolId: 1, role: 'teacher' }, body: { title: 'Changed' } },
    { json() { assert.fail('The inactive assignment must not be saved.'); } }, error => { failure = error; });
  assert.equal(failure?.status, 409);
  assert.match(failure.message, /grading period is not active/);
});

test('SHS edit uses the fresh saved assignment before confirming success', async () => {
  assert.ok(saveSource);
  const assignment = { id: '14', academicTermId: 6, gradingItemId: null, maxResubmissions: null };
  const fields = {
    editAssignmentTitleInput: { value: 'Project' },
    editAssignmentDueInput: { value: '2026-11-20' },
    editAssignmentInstructionsInput: { value: '' },
    editAssignmentOnlineInput: { checked: true }
  };
  const notices = [];
  let rendered;
  let chosenLimit = 2;
  let savedLimit = 2;
  const context = vm.createContext({
    document: { getElementById: key => fields[key] },
    BACKEND_ASSIGNMENTS: [assignment], activeAssignmentId: '14',
    shsCoreAssignmentGrade: () => ({ componentCode: 'written', maxScore: 25 }),
    selectedAssignmentResubmissionLimit: () => chosenLimit,
    CURRENT_SECTION_ID: '8', CURRENT_SUBJECT_ID: '4', CURRENT_COMMUNICATION_COMPONENT_CODE: null,
    window: { EDUGNAY_API: {
      updateAssignment: async () => ({ ...assignment, maxResubmissions: savedLimit, gradingItemId: '18' }),
      getAssignments: async () => [{ ...assignment, maxResubmissions: savedLimit, gradingItemId: '18' }]
    }, AcademixShsGradebook: { refresh: async () => true } },
    closeModal() {}, renderAssignments() { rendered = true; },
    showAppToast(message, type) { notices.push({ message, type }); }
  });
  vm.runInContext(saveSource, context);
  await context.saveShsCoreAssignmentChanges();
  assert.equal(rendered, true);
  assert.equal(context.BACKEND_ASSIGNMENTS[0].maxResubmissions, 2);
  assert.equal(context.BACKEND_ASSIGNMENTS[0].gradingItemId, '18');
  assert.equal(notices.at(-1).message, 'Assignment updated.');

  context.activeAssignmentId = '14';
  context.window.AcademixShsGradebook.refresh = async () => false;
  await context.saveShsCoreAssignmentChanges();
  assert.match(notices.at(-1).message, /Score Recording could not refresh/);
  assert.equal(notices.at(-1).type, 'info');

  context.window.AcademixShsGradebook.refresh = async () => true;
  for (const [choice, persisted] of [[undefined, 0], [1, 1], [null, null]]) {
    chosenLimit = choice;
    savedLimit = persisted;
    assignment.maxResubmissions = 0;
    context.BACKEND_ASSIGNMENTS[0] = assignment;
    context.activeAssignmentId = '14';
    await context.saveShsCoreAssignmentChanges();
    assert.equal(notices.at(-1).message, 'Assignment updated.');
    assert.equal(context.BACKEND_ASSIGNMENTS[0].maxResubmissions, persisted);
  }
});

test('SHS elective edits preserve a legacy zero limit or save a new choice', async () => {
  assert.ok(sharedSaveSource);
  const saved = { id: '21', title: 'Project', dueDate: '2026-11-20',
    maxResubmissions: 0, gradingItemId: null };
  let choice;
  let sentLimit;
  const notices = [];
  const fields = {
    editAssignmentTitleInput: { value: 'Project' },
    editAssignmentInstructionsInput: { value: '' },
    editAssignmentDueInput: { value: '2026-11-20' },
    editAssignmentOnlineInput: { checked: true }
  };
  const context = vm.createContext({
    URLSearchParams, USE_SHS_CORE_GRADEBOOK: false, activeAssignmentId: '21',
    document: { getElementById: key => fields[key], querySelector: () => ({ disabled: false }) },
    selectedAssignmentResubmissionLimit: () => choice,
    closeModal() {}, showAppToast(message, type) { notices.push({ message, type }); },
    window: {
      location: { search: '?classId=33' },
      EDUGNAY_API: { async updateAssignment(id, values) {
        sentLimit = values.maxResubmissions;
        if (values.maxResubmissions !== undefined) saved.maxResubmissions = values.maxResubmissions;
        return { ...saved };
      } },
      AcademixElectiveClass: {
        canEdit: () => true, getAssignment: () => saved,
        assignmentGradePayload: () => null, refresh: async () => true,
        refreshScoresAfterAssignment: async () => true
      }
    }
  });
  vm.runInContext(sharedSaveSource, context);
  for (const [selected, expected] of [[undefined, 0], [1, 1], [null, null]]) {
    choice = selected;
    context.activeAssignmentId = '21';
    await context.saveAssignmentChanges();
    assert.equal(sentLimit, selected);
    assert.equal(saved.maxResubmissions, expected);
    assert.equal(notices.at(-1).message, 'Assignment updated.');
  }
  context.activeAssignmentId = '21';
  context.window.AcademixElectiveClass.refreshScoresAfterAssignment = async () => false;
  await context.saveAssignmentChanges();
  assert.equal(notices.at(-1).message, 'Assignment updated, but Score Recording could not refresh.');
  assert.equal(notices.at(-1).type, 'info');
});

