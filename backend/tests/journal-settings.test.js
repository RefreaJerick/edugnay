const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let calls;
let state;
const connection = {
  async beginTransaction() { calls.push('BEGIN'); },
  async commit() { calls.push('COMMIT'); state.committed = true; },
  async rollback() { calls.push('ROLLBACK'); state.rolledBack = true; },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM school_portal_features WHERE')) return [[{ gradesEnabled: 1, narrativeReportsEnabled: 1, journalsEnabled: 1, attendanceEnabled: 1, sfTemplatesEnabled: 1 }]];
    if (sql.includes('FROM school_portal_features\n')) return [[{ id: 9, subjectId: 2, name: 'English', isActive: 1 }]];
    if (sql.includes('FROM school_settings')) return [[{ journalSubjectId: 1, journalSubjectName: 'Values Education' }]];
    if (sql.includes('FROM sections\n')) return [values[1] === 4 ? [{ id: 8, schoolId: 1, academicYearId: 3, name: 'St. John', studentCount: 12, gradeLevelName: 'Grade 9' }] : []];
    if (sql.includes('FROM subjects WHERE')) return [[state.subjectSchoolId === values[1] && state.subjectActive ? { id: values[0], name: 'English' } : undefined].filter(Boolean)];
    if (sql.startsWith('INSERT INTO journal_subjects') && state.failInsert) throw new Error('Database write failed');
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 3 }];
    return [{ affectedRows: 1 }];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: (...args) => connection.execute(...args) });
const { getPortalFeatures, updatePortalFeatures } = require('../controllers/schoolsController');
const { listJournalSections } = require('../controllers/journalsController');

async function save(body, user = { id: 3, schoolId: 1, role: 'school_admin' }, overrides = {}) {
  calls = [];
  state = { subjectSchoolId: 1, subjectActive: true, committed: false, rolledBack: false, ...overrides };
  const result = {};
  await updatePortalFeatures({ user, body }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('portal features return the saved journal subject', async () => {
  calls = [];
  state = {};
  const result = {};
  await getPortalFeatures({ user: { schoolId: 1, role: 'teacher' } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  assert.equal(result.body.journalSubjectId, 1);
  assert.equal(result.body.journalSubjectName, 'Values Education');
});

test('changing journal subject saves the feature and subject in one transaction', async () => {
  const result = await save({ journalsEnabled: true, journalSubjectId: 2 });
  assert.equal(result.error, undefined);
  assert.equal(result.body.journalSubjectId, 2);
  assert.equal(state.committed, true);
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO journal_subjects')));
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE school_settings SET journal_subject_id')));
});

test('another school or an inactive subject cannot be selected', async () => {
  for (const overrides of [{ subjectSchoolId: 2 }, { subjectActive: false }]) {
    const result = await save({ journalSubjectId: 2 }, undefined, overrides);
    assert.equal(result.error?.status, 400);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
  }
});

test('invalid subject IDs and enabling journals without a subject fail', async () => {
  const invalid = await save({ journalSubjectId: '2oops' });
  assert.equal(invalid.error?.status, 400);
  const missing = await save({ journalsEnabled: true, journalSubjectId: null });
  assert.equal(missing.error?.status, 400);
});

test('disabling journals keeps its subject without changing journal history', async () => {
  const result = await save({ journalsEnabled: false });
  assert.equal(result.error, undefined);
  assert.equal(result.body.journalSubjectId, 1);
  assert.equal(result.body.features.journalsEnabled, false);
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM journal_')), false);
});

test('a failed journal-subject write rolls back the feature change', async () => {
  const result = await save({ journalSubjectId: 2 }, undefined, { failInsert: true });
  assert.equal(result.error?.message, 'Database write failed');
  assert.equal(state.rolledBack, true);
  assert.equal(state.committed, false);
});

test('journal sections appear only for a teacher assigned to the selected subject', async () => {
  calls = [];
  state = {};
  async function sectionsFor(teacherId) {
    const result = {};
    await listJournalSections({ user: { id: teacherId, schoolId: 1, role: 'teacher' } }, {
      json(body) { result.body = body; }
    }, error => { result.error = error; });
    return result;
  }
  assert.equal((await sectionsFor(3)).body.sections.length, 0);
  assert.equal((await sectionsFor(4)).body.sections.length, 1);
  const query = calls.find(call => call.sql?.includes('FROM sections\n'));
  assert.match(query.sql, /section_teachers\.subject_id = \?/);
  assert.deepEqual(query.values.slice(0, 2), [1, 3]);
});

test('teacher access and journal reminders use current backend assignments and subject', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../workers/parentNotificationWorker.js'), 'utf8');
  assert.match(teacher, /getJournalSections\(\)/);
  assert.match(teacher, /teacherJournalAccess = sections\.length > 0/);
  assert.match(worker, /settings\.journal_subject_id = journal_subjects\.subject_id/);
});

test('teacher journal navigation is resolved once after loading access', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  const init = teacher.slice(teacher.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
  assert.equal((init.match(/applyTeacherAccess\(\)/g) || []).length, 1);
  assert.ok(init.indexOf('getJournalSections()') < init.indexOf('applyTeacherAccess()'));
  assert.ok(init.indexOf('applyTeacherAccess()') < init.indexOf('await window.EDUGNAY_COMMUNICATION_READY'));
});

test('school settings and teacher shell scripts parse after journal changes', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  assert.match(admin, /state\.apiJournalSubjectId = portal\.journalSubjectId/);
  assert.match(admin, /journalSubjectId: journalSubjectId \? Number\(journalSubjectId\) : null/);
  assert.match(admin, /state\.apiSubjects = subjects\.filter\(subject => subject\.isActive\)/);
  for (const [, source] of admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (source.trim()) new vm.Script(source);
  }
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  new vm.Script(teacher);
  const student = fs.readFileSync(path.join(__dirname, '../../assets/js/student/shell.js'), 'utf8');
  new vm.Script(student);
});
