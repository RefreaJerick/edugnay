const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let sections;
let enrolled;
let studentFound;
let inserts;
let existingSourceSection;
let auditFailure;
let duplicateInsert;
let notificationFailure;
let notifications;
let teachers;
let sectionTeacherIds;
let commits;
let rollbacks;
let statements;
const connection = {
  async execute(sql, values) {
    statements.push(sql);
    if (sql.startsWith('SELECT id FROM sections WHERE id IN')) {
      return [[values[0], values[1]].filter(id => sections[id]?.schoolId === values[2]).map(id => ({ id }))];
    }
    if (sql.startsWith('SELECT id FROM sections WHERE id = ?')) {
      return [sections[values[0]]?.schoolId === values[1] ? [{ id: values[0] }] : []];
    }
    if (sql.includes('FROM sections') && sql.includes('WHERE sections.id = ?')) {
      const section = sections[values[0]];
      return [section && section.schoolId === values[1] ? [section] : []];
    }
    if (sql.includes('FROM users WHERE id=?')) return [studentFound ? [{ id: 26, displayName: 'Jerick Refrea' }] : []];
    if (sql.startsWith('SELECT DISTINCT teachers.id AS userId')) {
      const [schoolId, adviserId] = values;
      const eligibleIds = new Set([adviserId, ...sectionTeacherIds]);
      return [[...eligibleIds].filter(id => teachers[id]?.schoolId === schoolId
        && teachers[id]?.role === 'teacher' && teachers[id]?.accountStatus === 'active').map(userId => ({ userId }))];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      if (notificationFailure) throw new Error('Notification insert failed.');
      notifications.push({ sql, values });
      return [{ insertId: notifications.length }];
    }
    if (sql.includes('SELECT COUNT(DISTINCT student_scores.id) AS total')) return [[{ total: 1 }]];
    if (sql.includes('SELECT COUNT(*) AS total FROM published_final_grades')) return [[{ total: 0 }]];
    if (sql.includes('FROM section_students INNER JOIN sections')) return [enrolled ? [{ id: 1 }] : []];
    if (sql.startsWith('SELECT id FROM section_students WHERE section_id=?')) return [values[0] === existingSourceSection ? [{ id: 1 }] : []];
    if (sql.includes('SELECT section_students.section_id AS sectionId FROM section_students')) return [existingSourceSection ? [{ sectionId: existingSourceSection }] : []];
    if (sql.startsWith('UPDATE section_students SET withdrawn_at = NOW() WHERE id')) {
      existingSourceSection = null;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO section_students')) {
      if (duplicateInsert) { const error = new Error('Duplicate active enrollment'); error.code = 'ER_DUP_ENTRY'; throw error; }
      inserts += 1;
      return [{ insertId: 2 }];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      if (auditFailure) throw new Error('Audit write failed');
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async beginTransaction() {},
  async commit() { commits += 1; },
  async rollback() { rollbacks += 1; },
  release() {}
};
databaseModule.getDatabase = () => ({ execute: (...args) => connection.execute(...args), getConnection: async () => connection });
const { enrollStudent, moveStudent, previewStudentMove } = require('../controllers/sectionsController');

function reset() {
  sections = {
    8: { id: 8, schoolId: 1, name: 'St. Matthew', status: 'active', academicYearStatus: 'active', academicYearId: 2, schoolLevelId: 1, gradeLevelId: 7, strandId: null, studentCount: 5, capacity: 40 },
    9: { id: 9, schoolId: 1, name: 'St. Mark', status: 'active', academicYearStatus: 'active', academicYearId: 2, schoolLevelId: 1, gradeLevelId: 7, strandId: null, studentCount: 4, capacity: 40 }
  };
  enrolled = false;
  studentFound = true;
  inserts = 0;
  existingSourceSection = 8;
  auditFailure = false;
  duplicateInsert = false;
  notificationFailure = false;
  notifications = [];
  teachers = {};
  sectionTeacherIds = [];
  commits = 0;
  rollbacks = 0;
  statements = [];
}

async function call(handler, params, body = {}) {
  const result = { status: 200, error: null, data: null };
  await handler({ user: { id: 2, schoolId: 1, role: 'school_admin' }, params, body, query: body }, {
    status(code) { result.status = code; return this; },
    set() { return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

test('admin can enroll an unassigned student in an active-year section', async () => {
  reset();
  const result = await call(enrollStudent, { sectionId: '8' }, { studentId: 26 });
  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(inserts, 1);
  assert.equal(commits, 1);
});

test('a withdrawn enrollment does not block a fresh enrollment in the same section', async () => {
  reset();
  const result = await call(enrollStudent, { sectionId: '8' }, { studentId: 26 });
  assert.equal(result.error, null);
  assert.equal(inserts, 1);
  assert.equal(rollbacks, 0);
  assert.ok(statements.some(sql => sql.includes('section_students.withdrawn_at IS NULL')));
  assert.equal(statements.some(sql => sql.startsWith('UPDATE section_students')), false);
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

test('move back to a previously attended section inserts a new enrollment', async () => {
  reset();
  const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
  assert.equal(result.error, null);
  assert.equal(inserts, 1);
  assert.equal(commits, 1);
});

test('a successful move notifies each active destination adviser and subject teacher once', async () => {
  reset();
  sections[9].adviserUserId = 41;
  teachers = {
    41: { schoolId: 1, role: 'teacher', accountStatus: 'active' },
    42: { schoolId: 1, role: 'teacher', accountStatus: 'active' },
    43: { schoolId: 1, role: 'teacher', accountStatus: 'inactive' },
    44: { schoolId: 2, role: 'teacher', accountStatus: 'active' },
    45: { schoolId: 1, role: 'school_admin', accountStatus: 'active' }
  };
  sectionTeacherIds = [41, 42, 42, 43, 44, 45];

  const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });

  assert.equal(result.error, null);
  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications.map(row => row.values[0]), [41, 42]);
  assert.ok(notifications.every(row => row.values[1] === 'Jerick Refrea was transferred from St. Matthew to St. Mark.'));
  assert.ok(notifications.every(row => row.values[2] === '/views/teacher/edugnay-teacher-sections.html?sectionId=9'));
  assert.ok(notifications.every(row => row.values[3] === 'student_transfer:2'));
  assert.ok(statements.some(sql => sql.includes("teachers.account_status = 'active'")
    && sql.includes("teachers.role = 'teacher'") && sql.includes('assignments.section_id = ?')));
  assert.equal(commits, 1);
});

test('an adviser without a subject assignment still receives the section transfer notice', async () => {
  reset();
  sections[9].adviserUserId = 46;
  teachers = { 46: { schoolId: 1, role: 'teacher', accountStatus: 'active' } };

  const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });

  assert.equal(result.error, null);
  assert.deepEqual(notifications.map(row => row.values[0]), [46]);
});

test('notification-write failure rolls back a student transfer', async () => {
  reset();
  sectionTeacherIds = [41];
  teachers = { 41: { schoolId: 1, role: 'teacher', accountStatus: 'active' } };
  notificationFailure = true;

  const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });

  assert.match(result.error.message, /Notification insert failed/);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
  assert.deepEqual(notifications, []);
});

test('a completed transfer cannot be repeated to create duplicate notifications', async () => {
  reset();
  teachers = { 41: { schoolId: 1, role: 'teacher', accountStatus: 'active' } };
  sectionTeacherIds = [41];

  const first = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
  const retry = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });

  assert.equal(first.error, null);
  assert.equal(retry.error?.status, 404);
  assert.equal(notifications.length, 1);
  assert.equal(commits, 1);
});

test('move preview reports prior scores without changing enrollment', async () => {
  reset();
  const result = await call(previewStudentMove, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
  assert.equal(result.error, null);
  assert.equal(result.data.priorScoreCount, 1);
  assert.equal(result.data.source.name, 'St. Matthew');
  assert.equal(result.data.target.name, 'St. Mark');
  assert.equal(commits, 0);
});

test('move rejects a different grade or strand before withdrawing the source enrollment', async () => {
  for (const change of [{ gradeLevelId: 8 }, { strandId: 2 }, { schoolLevelId: 2 }]) {
    reset();
    Object.assign(sections[9], change);
    const result = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
    assert.equal(result.error?.status, 409);
    assert.equal(inserts, 0);
    assert.equal(notifications.length, 0);
    assert.equal(commits, 0);
    assert.equal(rollbacks, 1);
  }
});

test('duplicate enrollment and failed audit return a conflict or roll back', async () => {
  reset();
  duplicateInsert = true;
  const duplicate = await call(enrollStudent, { sectionId: '8' }, { studentId: 26 });
  assert.equal(duplicate.error.status, 409);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);

  reset();
  auditFailure = true;
  const failed = await call(moveStudent, { sectionId: '8', studentId: '26' }, { targetSectionId: 9 });
  assert.match(failed.error.message, /Audit write failed/);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
});
