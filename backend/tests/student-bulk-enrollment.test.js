const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let state;
const connection = {
  async beginTransaction() { state.started = true; },
  async commit() { state.commits++; },
  async rollback() { state.rollbacks++; },
  release() {},
  async execute(sql, values) {
    if (sql.includes('FROM users WHERE school_id = ?')) {
      return [values.slice(1).filter(id => !state.badStudentIds.includes(id)).map(id => ({ id, displayName: `Student ${id}` }))];
    }
    if (sql.startsWith('SELECT id FROM sections WHERE id = ?')) return [state.section.schoolId === values[1] ? [{ id: values[0] }] : []];
    if (sql.includes('FROM sections') && sql.includes('WHERE sections.id = ?')) return [state.section.schoolId === values[1] ? [state.section] : []];
    if (sql.includes('FROM section_students INNER JOIN sections')) return [state.hasEnrollment ? [{ studentId: 1 }] : []];
    if (sql.startsWith('INSERT INTO section_students')) {
      state.inserts++;
      if (state.failInsertAt === state.inserts) throw new Error('Insert failed');
      return [{ insertId: state.inserts }];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      state.audits++;
      state.auditDetails.push(JSON.parse(values[5]));
      return [{ insertId: state.audits }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { enrollStudentsBulk } = require('../controllers/sectionsController');

function reset() {
  state = {
    section: { id: 8, schoolId: 1, name: 'A', gradeLevelName: 'Grade 8', academicYearLabel: '2026-2027',
      status: 'active', academicYearStatus: 'active', academicYearId: 2, studentCount: 5, capacity: 40 },
    badStudentIds: [], hasEnrollment: false, inserts: 0, audits: 0, auditDetails: [], commits: 0, rollbacks: 0,
    failInsertAt: 0, started: false
  };
}

async function call(studentIds, sectionId = '8') {
  const result = { status: 200, body: null, error: null };
  await enrollStudentsBulk({ user: { id: 3, schoolId: 1, role: 'school_admin' }, params: { sectionId }, body: { studentIds } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; }
  }, error => { result.error = error; });
  return result;
}

test('bulk enrollment commits all students and audit entries together', async () => {
  reset();
  const result = await call([11, 12]);
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, { sectionId: 8, studentIds: [11, 12], assignedCount: 2 });
  assert.equal(state.inserts, 2);
  assert.equal(state.audits, 2);
  assert.deepEqual(state.auditDetails.map(({ summary, ...details }) => details), [
    { studentName: 'Student 11', sectionName: 'A', sectionId: 8, gradeName: 'Grade 8', schoolYear: '2026-2027' },
    { studentName: 'Student 12', sectionName: 'A', sectionId: 8, gradeName: 'Grade 8', schoolYear: '2026-2027' }
  ]);
  assert.ok(state.auditDetails.every(details => !details.summary.includes('?')));
  assert.equal(state.commits, 1);
});

test('bulk enrollment rejects invalid, duplicate, and oversized lists before a transaction', async () => {
  for (const ids of [[], [1, 1], [0], ['1'], Array.from({ length: 101 }, (_, i) => i + 1)]) {
    reset();
    assert.equal((await call(ids)).error.status, 400);
    assert.equal(state.started, false);
  }
});

test('bulk enrollment rolls back on unavailable students, conflicts, and capacity', async () => {
  for (const change of [
    () => { state.badStudentIds = [12]; },
    () => { state.hasEnrollment = true; },
    () => { state.section.capacity = 6; },
    () => { state.section.academicYearStatus = 'closed'; },
    () => { state.section.status = 'archived'; },
    () => { state.section.schoolId = 2; }
  ]) {
    reset();
    change();
    const result = await call([11, 12]);
    assert.ok(result.error);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
    assert.equal(state.inserts, 0);
    assert.equal(state.audits, 0);
  }
});

test('failure during insertion rolls back the whole batch', async () => {
  reset();
  state.failInsertAt = 2;
  const result = await call([11, 12]);
  assert.match(result.error.message, /Insert failed/);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
});
