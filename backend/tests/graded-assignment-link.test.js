const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.ASSIGNMENT_SUBMISSION_DIRECTORY ||= path.join(os.tmpdir(), 'academix-graded-assignment-tests');
process.env.MATERIAL_UPLOAD_DIRECTORY ||= path.join(os.tmpdir(), 'academix-graded-material-tests');

const databaseModule = require('../config/database');
let queries;
let failItemInsert;
let assigned;
let termStatus;
let auditEntries;
let assignmentRow;
let failAuditInsert;

const connection = {
  async beginTransaction() { queries.push('BEGIN'); },
  async commit() { queries.push('COMMIT'); },
  async rollback() { queries.push('ROLLBACK'); },
  release() {},
  async execute(sql, values = []) {
    queries.push(sql);
    if (sql.startsWith('INSERT INTO audit_logs')) {
      if (failAuditInsert) throw new Error('Audit insert failed');
      auditEntries.push({ actionType: values[2], details: JSON.parse(values[5]) });
      return [{ insertId: auditEntries.length }];
    }
    if (sql.includes('FROM section_teachers INNER JOIN sections')) {
      return [assigned ? [{ id: 8, schoolId: 1, academicYearId: 2, schoolLevelId: 3 }] : []];
    }
    if (sql.includes('SELECT academic_years.label AS academicYearLabel, school_levels.level_code AS levelCode')) {
      return [[{ academicYearLabel: '2025-2026', levelCode: 'jhs' }]];
    }
    if (sql.includes('FROM academic_terms WHERE')) return [[{ id: 6 }]];
    if (sql.includes('FROM grading_categories WHERE')) return [[{ id: 3 }]];
    if (sql.includes('FROM academic_terms') && sql.includes('INNER JOIN academic_years')) {
      return [[{ id: 6, academicTermStatus: termStatus, academicYearStatus: 'active' }]];
    }
    if (sql.includes('FROM academic_terms') && sql.includes('INNER JOIN sections')) {
      return [[{ academicTermStatus: termStatus, academicYearStatus: 'active' }]];
    }
    if (sql.includes('FROM section_teachers') && sql.includes('FOR UPDATE')) return [[{ 1: 1 }]];
    if (sql.includes('FROM grading_period_reopen_requests')) return [[]];
    if (sql.startsWith('INSERT INTO assignments')) {
      assignmentRow = {
        id: 14, schoolId: 1, sectionId: 8, subjectId: 4,
        academicTermId: values[3], gradingCategoryId: values[4], gradingItemId: null,
        teacherUserId: 5, title: values[8], description: values[9], dueAt: values[10],
        maxScore: values[11], onlineSubmissionEnabled: values[12], status: values[13],
        subjectGradingComponentId: values[5], subjectGradingExamPartId: values[6],
        sectionName: 'St. John', sectionGrade: 'Grade 8', subjectName: 'English'
      };
      return [{ insertId: 14 }];
    }
    if (sql.startsWith('INSERT INTO grading_items')) {
      if (failItemInsert) throw new Error('Grade item insert failed');
      return [{ insertId: 18 }];
    }
    if (sql.startsWith('UPDATE assignments SET grading_item_id')) {
      if (assignmentRow) assignmentRow.gradingItemId = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE assignments SET academic_term_id=')) {
      Object.assign(assignmentRow, {
        academicTermId: values[0], gradingCategoryId: values[1],
        subjectGradingComponentId: values[2], subjectGradingExamPartId: values[3],
        title: values[4], description: values[5], dueAt: values[6], maxScore: values[7],
        onlineSubmissionEnabled: values[8], status: values[9]
      });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ?')) {
      return [[{ ...(assignmentRow || {
        id: 14, schoolId: 1, sectionId: 8, subjectId: 4,
        academicTermId: 6, gradingCategoryId: 3, gradingItemId: 18,
        teacherUserId: 5, title: 'Project', maxScore: 50, status: 'published',
        sectionName: 'St. John', sectionGrade: 'Grade 8', subjectName: 'English'
      }) }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { createAssignment, updateAssignment } = require('../controllers/assignmentsController');

async function create(options = {}) {
  queries = [];
  failItemInsert = Boolean(options.failItemInsert);
  assigned = options.assigned !== false;
  termStatus = options.termStatus || 'active';
  auditEntries = [];
  assignmentRow = null;
  failAuditInsert = Boolean(options.failAuditInsert);
  const result = { status: null, body: null, error: null };
  await createAssignment({
    user: { id: 5, schoolId: 1, role: 'teacher' },
    body: {
      sectionId: 8, subjectId: 4, academicTermId: 6,
      gradingCategoryId: 3, title: 'Project', maxScore: 50
    }
  }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('graded assignment and score component commit with a direct link', async () => {
  const result = await create();
  assert.ifError(result.error);
  assert.equal(result.status, 201);
  assert.equal(result.body.assignment.gradingItemId, 18);
  assert.ok(queries.findIndex(sql => sql.startsWith('INSERT INTO assignments'))
    < queries.findIndex(sql => sql.startsWith('INSERT INTO grading_items')));
  assert.ok(queries.some(sql => sql.startsWith('UPDATE assignments SET grading_item_id')));
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].actionType, 'assignment_created');
  assert.equal(auditEntries[0].details.summary, 'Project · English · Grade 8 · St. John');
  assert.equal(auditEntries[0].details.status, 'published');
  assert.equal(auditEntries[0].details.scoreComponentCreated, true);
  assert.equal(auditEntries[0].details.gradingItemId, 18);
  assert.ok(queries.findIndex(sql => sql.startsWith('INSERT INTO audit_logs')) < queries.indexOf('COMMIT'));
  assert.equal(queries.at(-1), 'COMMIT');
});

test('assignment content edit and status change are recorded together', async () => {
  queries = [];
  auditEntries = [];
  assigned = true;
  termStatus = 'active';
  assignmentRow = {
    id: 14, schoolId: 1, sectionId: 8, subjectId: 4, academicTermId: 6,
    gradingCategoryId: null, subjectGradingComponentId: null, subjectGradingExamPartId: null,
    gradingItemId: null, teacherUserId: 5, title: 'Homework', description: 'Old description',
    dueAt: null, maxScore: null, onlineSubmissionEnabled: 0, status: 'draft',
    sectionName: 'St. John', sectionGrade: 'Grade 8', subjectName: 'English'
  };
  const result = { error: null, body: null };
  await updateAssignment({
    user: { id: 5, schoolId: 1, role: 'teacher' }, params: { assignmentId: '14' },
    body: { title: 'Reading task', description: 'New private description', status: 'published' }
  }, { json(body) { result.body = body; } }, error => { result.error = error; });

  assert.ifError(result.error);
  assert.equal(result.body.assignment.status, 'published');
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].actionType, 'assignment_updated');
  assert.equal(auditEntries[0].details.fromStatus, 'draft');
  assert.equal(auditEntries[0].details.toStatus, 'published');
  assert.equal(auditEntries[0].details.statusChanged, true);
  assert.equal(auditEntries[0].details.detailsChanged, true);
  assert.equal(auditEntries[0].details.summary, 'Reading task · English · Grade 8 · St. John');
  assert.equal(JSON.stringify(auditEntries[0]).includes('New private description'), false);
});

test('every assignment status transition is saved in its audit entry', async () => {
  const transitions = [
    { from: 'draft', to: 'published' },
    { from: 'published', to: 'closed' },
    { from: 'closed', to: 'draft' }
  ];
  for (const transition of transitions) {
    queries = [];
    auditEntries = [];
    assigned = true;
    termStatus = 'active';
    assignmentRow = {
      id: 14, schoolId: 1, sectionId: 8, subjectId: 4, academicTermId: 6,
      gradingCategoryId: null, subjectGradingComponentId: null, subjectGradingExamPartId: null,
      gradingItemId: null, teacherUserId: 5, title: 'Homework', description: null,
      dueAt: null, maxScore: null, onlineSubmissionEnabled: 0, status: transition.from,
      sectionName: 'St. John', sectionGrade: 'Grade 8', subjectName: 'English'
    };
    let error = null;
    await updateAssignment({
      user: { id: 5, schoolId: 1, role: 'teacher' }, params: { assignmentId: '14' },
      body: { status: transition.to }
    }, { json() {} }, caught => { error = caught; });
    assert.ifError(error);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0].details.fromStatus, transition.from);
    assert.equal(auditEntries[0].details.toStatus, transition.to);
    assert.equal(auditEntries[0].details.statusChanged, true);
    assert.equal(auditEntries[0].details.detailsChanged, false);
  }
});

test('an unchanged assignment update does not create an audit entry', async () => {
  queries = [];
  auditEntries = [];
  assigned = true;
  termStatus = 'active';
  assignmentRow = {
    id: 14, schoolId: 1, sectionId: 8, subjectId: 4, academicTermId: 6,
    gradingCategoryId: null, subjectGradingComponentId: null, subjectGradingExamPartId: null,
    gradingItemId: null, teacherUserId: 5, title: 'Homework', description: null,
    dueAt: null, maxScore: null, onlineSubmissionEnabled: 0, status: 'published',
    sectionName: 'St. John', sectionGrade: 'Grade 8', subjectName: 'English'
  };
  let error = null;
  await updateAssignment({
    user: { id: 5, schoolId: 1, role: 'teacher' }, params: { assignmentId: '14' }, body: { status: 'published' }
  }, { json() {} }, caught => { error = caught; });
  assert.ifError(error);
  assert.equal(auditEntries.length, 0);
});

test('grade item failure rolls back the assignment too', async () => {
  const result = await create({ failItemInsert: true });
  assert.match(result.error?.message || '', /Grade item insert failed/);
  assert.equal(result.body, null);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('audit failure rolls back a new assignment', async () => {
  const result = await create({ failAuditInsert: true });
  assert.match(result.error?.message || '', /Audit insert failed/);
  assert.equal(result.body, null);
  assert.equal(auditEntries.length, 0);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('unassigned teacher cannot create either record', async () => {
  const result = await create({ assigned: false });
  assert.equal(result.error?.status, 403);
  assert.equal(queries.some(sql => sql.startsWith('INSERT INTO')), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('a closed period does not allow creating a graded assignment', async () => {
  const result = await create({ termStatus: 'closed' });
  assert.equal(result.error?.status, 409);
  assert.equal(queries.some(sql => sql.startsWith('INSERT INTO')), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('an ungraded assignment still requires a grading period', async () => {
  queries = [];
  assigned = true;
  const result = { error: null };
  await createAssignment({
    user: { id: 5, schoolId: 1, role: 'teacher' },
    body: { sectionId: 8, subjectId: 4, title: 'Homework' }
  }, {}, error => { result.error = error; });
  assert.match(result.error?.message || '', /Select a grading period/);
  assert.equal(queries.some(sql => sql.startsWith('INSERT INTO')), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('an assignment cannot be updated to remove its grading period', async () => {
  queries = [];
  assigned = true;
  const result = { error: null };
  await updateAssignment({
    user: { id: 5, schoolId: 1, role: 'teacher' },
    params: { assignmentId: '14' },
    body: { academicTermId: null }
  }, {}, error => { result.error = error; });
  assert.match(result.error?.message || '', /Select a grading period/);
  assert.equal(queries.some(sql => sql.startsWith('UPDATE assignments')), false);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
