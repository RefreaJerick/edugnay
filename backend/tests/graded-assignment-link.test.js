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

const connection = {
  async beginTransaction() { queries.push('BEGIN'); },
  async commit() { queries.push('COMMIT'); },
  async rollback() { queries.push('ROLLBACK'); },
  release() {},
  async execute(sql) {
    queries.push(sql);
    if (sql.includes('FROM section_teachers INNER JOIN sections')) {
      return [assigned ? [{ id: 8, schoolId: 1, academicYearId: 2, schoolLevelId: 3 }] : []];
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
    if (sql.startsWith('INSERT INTO assignments')) return [{ insertId: 14 }];
    if (sql.startsWith('INSERT INTO grading_items')) {
      if (failItemInsert) throw new Error('Grade item insert failed');
      return [{ insertId: 18 }];
    }
    if (sql.startsWith('UPDATE assignments SET grading_item_id')) return [{ affectedRows: 1 }];
    if (sql.includes('WHERE assignments.id = ? AND assignments.school_id = ?')) {
      return [[{
        id: 14, schoolId: 1, sectionId: 8, subjectId: 4,
        academicTermId: 6, gradingCategoryId: 3, gradingItemId: 18,
        teacherUserId: 5, title: 'Project', maxScore: 50, status: 'published'
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { createAssignment } = require('../controllers/assignmentsController');

async function create(options = {}) {
  queries = [];
  failItemInsert = Boolean(options.failItemInsert);
  assigned = options.assigned !== false;
  termStatus = options.termStatus || 'active';
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
  assert.equal(queries.at(-1), 'COMMIT');
});

test('grade item failure rolls back the assignment too', async () => {
  const result = await create({ failItemInsert: true });
  assert.match(result.error?.message || '', /Grade item insert failed/);
  assert.equal(result.body, null);
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
