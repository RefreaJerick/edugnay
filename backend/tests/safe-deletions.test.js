const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let scenario;
const calls = [];
const connection = {
  async beginTransaction() { calls.push({ type: 'begin' }); },
  async commit() { calls.push({ type: 'commit' }); },
  async rollback() { calls.push({ type: 'rollback' }); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ type: 'query', sql, values });
    if (sql.includes('SELECT id FROM schools WHERE id = ? FOR UPDATE')) return [[{ id: 1 }]];
    if (sql.includes('FROM users WHERE id = ? AND school_id = ? FOR UPDATE')) {
      return [scenario.user ? [{ id: 21, schoolId: 1, role: 'teacher', displayName: 'Test Teacher', ...scenario.user }] : []];
    }
    if (sql.includes("COUNT(*) AS total FROM users WHERE school_id = ? AND role = 'school_admin'")) {
      return [[{ total: scenario.otherAdmins ?? 1 }]];
    }
    if (sql.includes('FROM student_parent_links WHERE parent_user_id = ? OR student_user_id = ?')) {
      return [scenario.parentLink ? [{ id: 1 }] : []];
    }
    if (sql.includes('FROM sections WHERE id = ? AND school_id = ? FOR UPDATE')) {
      return [scenario.section ? [{ id: 8 }] : []];
    }
    if (sql.includes('FROM sections') && sql.includes('academic_years.status AS academicYearStatus')) {
      return [scenario.section ? [{
        id: 8, schoolId: 1, academicYearId: 3, academicYearStatus: 'active', name: 'Grade 7 - St. Matthew'
      }] : []];
    }
    if (sql.includes('AS announcementAudiences')) {
      const names = ['studentEnrollments', 'teacherAssignments', 'assignments', 'gradingItems', 'publishedGrades',
        'attendanceSessions', 'reopenRequests', 'learningMaterials', 'journalPrompts', 'journalEntries', 'reports',
        'interventions', 'formExports', 'announcementAudiences'];
      return [[Object.fromEntries(names.map(name => [name, scenario.sectionReferences || 0]))]];
    }
    if (sql.includes('SELECT id, name FROM subjects WHERE id = ? AND school_id = ? FOR UPDATE')) {
      return [scenario.subject ? [{ id: 6, name: 'English' }] : []];
    }
    if (sql.includes('AS total') && sql.includes('FROM section_teachers')) {
      return [[{ total: scenario.subjectReferences || 0 }]];
    }
    if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    if (sql.includes('DELETE FROM users')) {
      if (scenario.failUserDelete) throw Object.assign(new Error('Referenced row'), { code: 'ER_ROW_IS_REFERENCED_2' });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('DELETE FROM sections')) return [{ affectedRows: 1 }];
    if (sql.includes('DELETE FROM subjects')) return [{ affectedRows: 1 }];
    if (sql.includes('UPDATE subjects SET is_active = FALSE')) return [{ affectedRows: 1 }];
    if (sql.includes('UPDATE journal_subjects SET is_active = FALSE')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  }
};

const database = { async getConnection() { return connection; } };
databaseModule.getDatabase = () => database;
const usersController = require('../controllers/usersController');
const sectionsController = require('../controllers/sectionsController');
const subjectsController = require('../controllers/subjectsController');

function reset(values = {}) {
  calls.length = 0;
  scenario = { user: true, section: true, subject: true, ...values };
}

async function call(handler, req) {
  const result = { status: 200, body: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
    end() { return this; },
    send() { return this; }
  };
  await handler(req, response, error => { result.error = error; });
  return result;
}

test('school admin can permanently delete an unlinked account in their school', async () => {
  reset();
  const result = await call(usersController.deleteUser, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 204);
  const deletion = calls.find(call => call.sql?.includes('DELETE FROM users'));
  assert.deepEqual(deletion.values, [21, 1]);
  assert.ok(calls.findIndex(call => call.sql?.includes('INSERT INTO audit_logs')) < calls.indexOf(deletion));
  assert.ok(calls.some(call => call.type === 'commit'));
});

test('user deletion rejects self-delete, non-admin access, and accounts outside the school', async t => {
  await t.test('self-delete', async () => {
    reset();
    const result = await call(usersController.deleteUser, {
      user: { id: 21, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
    });
    assert.equal(result.error?.status, 409);
    assert.equal(calls.length, 0);
  });
  await t.test('non-admin', async () => {
    reset();
    const result = await call(usersController.deleteUser, {
      user: { id: 2, schoolId: 1, role: 'teacher' }, params: { userId: '21' }
    });
    assert.equal(result.error?.status, 403);
    assert.equal(calls.length, 0);
  });
  await t.test('different school', async () => {
    reset({ user: false });
    const result = await call(usersController.deleteUser, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
    });
    assert.equal(result.error?.status, 404);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM users')));
  });
});

test('user deletion blocks the last school administrator and linked parent/student accounts', async t => {
  await t.test('last administrator', async () => {
    reset({ user: { role: 'school_admin' }, otherAdmins: 0 });
    const result = await call(usersController.deleteUser, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
    });
    assert.equal(result.error?.status, 409);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM users')));
    assert.ok(calls.some(call => call.type === 'rollback'));
  });
  await t.test('linked student or parent', async () => {
    reset({ parentLink: true });
    const result = await call(usersController.deleteUser, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
    });
    assert.equal(result.error?.status, 409);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM users')));
  });
});

test('user delete maps protected academic records to a safe conflict response', async () => {
  reset({ failUserDelete: true });
  const result = await call(usersController.deleteUser, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { userId: '21' }
  });
  assert.equal(result.error?.status, 409);
  assert.match(result.error.message, /Deactivate it instead/);
  assert.ok(calls.some(call => call.type === 'rollback'));
});

test('section delete rejects every section with saved or linked records', async t => {
  await t.test('empty section is removed in a transaction', async () => {
    reset({ sectionReferences: 0 });
    const result = await call(sectionsController.deleteSection, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { sectionId: '8' }
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 204);
    const referenceCheck = calls.find(call => call.sql?.includes('AS announcementAudiences'));
    assert.match(referenceCheck.sql, /AS publishedGrades/);
    assert.match(referenceCheck.sql, /AS reopenRequests/);
    assert.match(referenceCheck.sql, /AS learningMaterials/);
    assert.match(referenceCheck.sql, /AS journalPrompts/);
    assert.ok(calls.some(call => call.sql?.includes('DELETE FROM sections')));
  });
  await t.test('a section with records is preserved', async () => {
    reset({ sectionReferences: 1 });
    const result = await call(sectionsController.deleteSection, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { sectionId: '8' }
    });
    assert.equal(result.error?.status, 409);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM sections')));
  });
});

test('subject deletion deactivates linked subjects and permanently removes unused ones', async t => {
  await t.test('linked subject retains its records', async () => {
    reset({ subjectReferences: 2 });
    const result = await call(subjectsController.deleteSubject, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { subjectId: '6' }
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.equal(result.body.deleted, false);
    assert.ok(calls.some(call => call.sql?.includes('UPDATE subjects SET is_active = FALSE')));
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM subjects')));
  });
  await t.test('unused subject is deleted', async () => {
    reset({ subjectReferences: 0 });
    const result = await call(subjectsController.deleteSubject, {
      user: { id: 2, schoolId: 1, role: 'school_admin' }, params: { subjectId: '6' }
    });
    assert.equal(result.error, null);
    assert.equal(result.status, 204);
    assert.ok(calls.some(call => call.sql?.includes('DELETE FROM subjects')));
  });
});
