const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let sections;
let enrolled;
let studentFound;
let inserts;
const connection = {
  async execute(sql, values) {
    if (sql.includes('FROM sections') && sql.includes('WHERE sections.id = ?')) {
      const section = sections[values[0]];
      return [section && section.schoolId === values[1] ? [section] : []];
    }
    if (sql.includes('FROM users WHERE id=?')) return [studentFound ? [{ id: 26, displayName: 'Jerick Refrea' }] : []];
    if (sql.includes('FROM section_students INNER JOIN sections')) return [enrolled ? [{ id: 1 }] : []];
    if (sql.startsWith('INSERT INTO section_students')) { inserts += 1; return [{ insertId: 1 }]; }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {}
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { enrollStudent, moveStudent } = require('../controllers/sectionsController');

function reset() {
  sections = {
    8: { id: 8, schoolId: 1, name: 'St. Matthew', status: 'active', academicYearStatus: 'active', academicYearId: 2, studentCount: 5, capacity: 40 },
    9: { id: 9, schoolId: 1, name: 'St. Mark', status: 'active', academicYearStatus: 'active', academicYearId: 2, studentCount: 4, capacity: 40 }
  };
  enrolled = false;
  studentFound = true;
  inserts = 0;
}

async function call(handler, params, body = {}) {
  const result = { status: 200, error: null };
  await handler({ user: { id: 2, schoolId: 1, role: 'school_admin' }, params, body }, {
    status(code) { result.status = code; return this; },
    json() { return this; }
  }, error => { result.error = error; });
  return result;
}

test('admin can enroll an unassigned student in an active-year section', async () => {
  reset();
  const result = await call(enrollStudent, { sectionId: '8' }, { studentId: 26 });
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(inserts, 1);
});

test('enrollment rejects inactive years, full sections, duplicates, and another school', async () => {
  reset();
  sections[8].academicYearStatus = 'closed';
  assert.equal((await call(enrollStudent, { sectionId: '8' }, { studentId: 26 })).error.status, 409);
  sections[8].academicYearStatus = 'active';
  sections[8].studentCount = 40;
  assert.equal((await call(enrollStudent, { sectionId: '8' }, { studentId: 26 })).error.status, 409);
  sections[8].studentCount = 5;
  enrolled = true;
  assert.equal((await call(enrollStudent, { sectionId: '8' }, { studentId: 26 })).error.status, 409);
  enrolled = false;
  sections[8].schoolId = 2;
  assert.equal((await call(enrollStudent, { sectionId: '8' }, { studentId: 26 })).error.status, 404);
  assert.equal(inserts, 0);
});

test('move rejects a section outside the active academic year', async () => {
  reset();
  sections[9].academicYearStatus = 'closed';
  const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
  assert.equal(result.error.status, 409);
  assert.equal(inserts, 0);
});
