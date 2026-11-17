const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const gradebook = fs.readFileSync(path.join(__dirname, '../controllers/shsGradesController.js'), 'utf8');
const assignments = fs.readFileSync(path.join(__dirname, '../controllers/assignmentsController.js'), 'utf8');
const sections = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sections.js'), 'utf8');

test('SHS core assignment links to a policy score item in the same transaction', async () => {
  const source = gradebook.match(/async function insertItem\([\s\S]*?(?=async function createItem\()/)?.[0];
  assert.ok(source);
  const queries = [];
  const scope = { kind: 'core', schoolId: 1, sectionId: 8, subjectId: 4,
    communicationComponentCode: null, subjectName: 'Mathematics', className: 'Section B',
    gradeCode: 'grade-11', yearLabel: '2026-2027', policy: {
      components: [{ code: 'written', weight: 20, examParts: {} }]
    } };
  const connection = { async execute(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('FROM assignments')) return [[{ id: 14, title: 'Task', gradingItemId: null }]];
    if (sql.startsWith('INSERT INTO grading_items')) return [{ insertId: 18 }];
    if (sql.startsWith('UPDATE assignments')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const context = vm.createContext({
    id: value => Number(value), fail: message => { throw new Error(message); },
    resolveScope: async () => scope, lockYear: async () => {}, assertTerm: async () => {},
    writeAuditLog: async () => {}
  });
  vm.runInContext(source, context);
  const linkedId = await context.createLinkedAssignmentItem(connection,
    { user: { id: 5, schoolId: 1 } },
    { sectionId: 8, subjectId: 4, communicationComponentCode: null }, 14,
    { academicTermId: 6, componentCode: 'written', maxScore: 25, title: 'Task' });
  assert.equal(linkedId, 18);
  assert.match(queries[0].sql, /section_id = \? AND subject_id = \? AND communication_component_code <=> \?/);
  assert.deepEqual(Array.from(queries[0].values), [1, 14, 8, 4, null]);
  assert.equal(queries[1].values[9], 'written');
  assert.deepEqual(Array.from(queries[2].values.slice(0, 3)), [6, 25, 18]);
  assert.match(assignments, /if \(req\.body\.grade\) await createLinkedAssignmentItem\(connection, req,[\s\S]*?result\.insertId/);
  assert.match(assignments, /await connection\.commit\(\); transactionStarted = false;[\s\S]*?return res\.status\(201\)/);
});

test('SHS core assignment form sends the selected policy category and maximum score', () => {
  const source = sections.match(/function shsCoreAssignmentGrade\([\s\S]*?(?=\n    document\.getElementById\('assignOnlineSubmissionInput'\))/)?.[0];
  assert.ok(source);
  const values = { assignGradingInput: { checked: true }, assignCategoryInput: { value: 'written' },
    assignExamPartGroup: { hidden: true }, assignMaxScoreInput: { value: '25' } };
  const context = vm.createContext({ document: { getElementById: key => values[key] },
    shsCoreAssignmentWorkspace: { term: { id: 6, status: 'active' } } });
  vm.runInContext(source, context);
  const grade = context.shsCoreAssignmentGrade();
  assert.equal(grade.componentCode, 'written');
  assert.equal(grade.maxScore, 25);
  assert.equal(grade.academicTermId, 6);
});

test('SHS core assignment creation refreshes an opened score table', async () => {
  const source = sections.match(/async function addShsCoreAssignment\(\) \{[\s\S]*?(?=\n    function resetAssignmentForm\()/)?.[0];
  assert.ok(source);
  const fields = {
    assignTitleInput: { value: 'Project' }, assignDueInput: { value: '2026-11-20' },
    assignInstructionsInput: { value: '' }, assignOnlineSubmissionInput: { checked: true }
  };
  let refreshWorks = true;
  let refreshes = 0;
  const notices = [];
  const context = vm.createContext({
    document: { getElementById: id => fields[id] },
    BACKEND_TERMS: [{ id: 6, status: 'active' }],
    BACKEND_GRADE_CONTEXT: { sectionId: 8, subjectId: 4, communicationComponentCode: null },
    BACKEND_ASSIGNMENTS: [],
    shsCoreAssignmentGrade: () => ({ componentCode: 'written', maxScore: 25 }),
    selectedAssignmentResubmissionLimit: () => null,
    resetAssignmentForm() {}, closeModal() {}, renderAssignments() {},
    showAppToast: (message, type) => notices.push({ message, type }),
    window: { EDUGNAY_API: { createAssignment: async () => ({ id: 14, gradingItemId: 18 }) },
      AcademixShsGradebook: { refresh: async () => { refreshes++; return refreshWorks; } } }
  });
  vm.runInContext(source, context);
  await context.addShsCoreAssignment();
  assert.equal(refreshes, 1);
  assert.equal(notices.at(-1).message, 'Assignment added.');
  refreshWorks = false;
  await context.addShsCoreAssignment();
  assert.equal(notices.at(-1).message, 'Assignment added, but Score Recording could not refresh.');
  assert.equal(notices.at(-1).type, 'info');
});

test('SHS core assignment creation rolls back if its score component cannot be linked', async () => {
  const source = assignments.match(/async function createAssignment\([\s\S]*?(?=async function updateAssignment\()/)?.[0];
  assert.ok(source);
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() {},
    async execute(sql) {
      if (sql.startsWith('INSERT INTO assignments')) { events.push('assignment'); return [{ insertId: 14 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    parseId: value => Number(value), requiredAcademicTermId: value => Number(value),
    getTeacherSectionSubject: async () => ({ schoolId: 1, shsCurriculumCode: 'strengthened_2026', shsSubjectType: 'core' }),
    validateTermAndCategory: async () => {}, requiredText: value => value,
    optionalText: value => value, dateTime: value => value,
    resubmissionLimit: value => value ?? null,
    allowLateSubmissions: value => value === true,
    ASSIGNMENT_STATUSES: new Set(['published']),
    createLinkedAssignmentItem: async () => { events.push('link'); throw new Error('Grading rule unavailable'); },
    getAssignmentForManagement: async () => { throw new Error('Must not read after failed link'); }
  });
  vm.runInContext(source, context);
  let error;
  await context.createAssignment({ user: { id: 5, schoolId: 1, role: 'teacher' },
    body: { sectionId: 8, subjectId: 4, academicTermId: 6, title: 'Task',
      dueAt: '2026-11-16T23:59:00', grade: { componentCode: 'written', maxScore: 25 } } },
  { status() { return this; }, json() {} }, caught => { error = caught; });
  assert.match(error?.message, /Grading rule unavailable/);
  assert.deepEqual(events, ['begin', 'assignment', 'link', 'rollback']);
});
