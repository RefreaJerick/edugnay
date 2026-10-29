const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const databaseModule = require('../config/database');

function createFixture({ status = 'approved', yearStatus = 'active', failAt = '', supportsNotRecorded = true } = {}) {
  const request = { id: 5, school_id: 7, academic_year_id: 20, grade_level_id: 11,
    student_user_id: 41, status, revision: 3, decision_reason: null,
    reviewed_by_user_id: 9, reviewed_at: '2026-10-27' };
  const choices = [101, 102];
  const memberships = [101, 102].map(classId => ({ classId, withdrawnAt: null }));
  const history = [], audit = [], queries = [];
  let snapshot;
  const database = {
    async getConnection() { return connection; }
  };
  const connection = {
    async beginTransaction() {
      snapshot = { request: { ...request }, choices: [...choices], memberships: memberships.map(item => ({ ...item })) };
    },
    async commit() { snapshot = null; },
    async rollback() {
      Object.assign(request, snapshot.request);
      choices.splice(0, choices.length, ...snapshot.choices);
      memberships.splice(0, memberships.length, ...snapshot.memberships);
      history.length = 0;
      audit.length = 0;
      snapshot = null;
    },
    release() {},
    async execute(sql, args = []) {
      queries.push(sql);
      if (failAt && sql.includes(failAt)) throw new Error('Simulated database failure');
      if (sql.includes('SELECT academic_year_id AS yearId FROM shs_selection_requests'))
        return [Number(args[0]) === 7 && Number(args[1]) === 5 ? [{ yearId: 20 }] : []];
      if (sql.includes('FROM information_schema.COLUMNS'))
        return [[{ columnType: supportsNotRecorded
          ? "enum('pending','approved','rejected','not_recorded')" : "enum('pending','approved','rejected')" }]];
      if (sql.includes('SELECT status FROM academic_years') && sql.includes('FOR UPDATE')) return [[{ status: yearStatus }]];
      if (sql.includes('SELECT * FROM shs_selection_requests') && sql.includes('FOR UPDATE')) return [[{ ...request }]];
      if (sql.includes('SELECT s.id AS sectionId')) return [[{
        sectionId: 141, sectionName: 'QA-only', yearId: 20, gradeId: 11, gradeCode: 'grade-11',
        gradeName: 'Grade 11', schoolYear: '2027-2028', studentName: 'Student One', trackCode: 'academic'
      }]];
      if (sql.includes('SELECT elective_class_id AS classId FROM shs_selection_request_classes'))
        return [choices.map(classId => ({ classId }))];
      if (sql.includes('UPDATE shs_elective_class_students SET withdrawn_at')) {
        for (const member of memberships) if (args.slice(2).includes(member.classId)) member.withdrawnAt = 'now';
        return [{ affectedRows: memberships.length }];
      }
      if (sql.includes('DELETE FROM shs_selection_request_classes')) { choices.length = 0; return [{ affectedRows: 2 }]; }
      if (sql.includes("UPDATE shs_selection_requests SET status = 'not_recorded'")) {
        Object.assign(request, { status: 'not_recorded', revision: Number(args[0]), decision_reason: null,
          reviewed_by_user_id: null, reviewed_at: null });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO shs_selection_history')) {
        history.push({ action: 'cleared', revision: Number(args[3]), details: JSON.parse(args[4]) });
        return [{ insertId: 1 }];
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        audit.push({ action: args[2], details: JSON.parse(args[5]) });
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { database, request, choices, memberships, history, audit, queries };
}

let fixture;
databaseModule.getDatabase = () => fixture.database;
const { clearApproved } = require('../controllers/shsSelectionController');

function invoke(user = { id: 9, schoolId: 7 }) {
  return new Promise(resolve => clearApproved({ user, params: { requestId: '5' } },
    { json: value => resolve({ value }) }, error => resolve({ error })));
}

test('clearing confirmed choices withdraws memberships and keeps the request and history', async () => {
  fixture = createFixture();
  const result = await invoke();
  assert.deepEqual(result.value, { id: 5, status: 'not_recorded', revision: 4, classIds: [] });
  assert.equal(fixture.request.status, 'not_recorded');
  assert.equal(fixture.request.reviewed_by_user_id, null);
  assert.deepEqual(fixture.choices, []);
  assert.ok(fixture.memberships.every(item => item.withdrawnAt));
  assert.deepEqual(fixture.history, [{ action: 'cleared', revision: 4,
    details: { oldClassIds: [101, 102], classIds: [] } }]);
  assert.equal(fixture.audit[0].action, 'shs_selection_choices_cleared');
  assert.equal(fixture.audit[0].details.classCount, 2);
  assert.equal(fixture.audit[0].details.studentName, 'Student One');
});

test('clearing rejects other schools, waiting choices, and closed school years', async () => {
  fixture = createFixture();
  assert.match((await invoke({ id: 9, schoolId: 8 })).error.message, /not found/);
  assert.equal(fixture.queries.some(sql => sql.includes('UPDATE shs_elective_class_students')), false);
  fixture = createFixture({ status: 'pending' });
  assert.match((await invoke()).error.message, /Only confirmed choices/);
  assert.equal(fixture.request.status, 'pending');
  fixture = createFixture({ yearStatus: 'archived' });
  assert.match((await invoke()).error.message, /Archived school years/);
  assert.deepEqual(fixture.choices, [101, 102]);
});

test('clearing stops before changing memberships when the status migration is missing', async () => {
  fixture = createFixture({ supportsNotRecorded: false });
  const result = await invoke();
  assert.match(result.error?.message || '', /finish the school setup/);
  assert.equal(fixture.request.status, 'approved');
  assert.deepEqual(fixture.choices, [101, 102]);
  assert.ok(fixture.memberships.every(item => item.withdrawnAt === null));
  assert.equal(fixture.history.length, 0);
  assert.equal(fixture.audit.length, 0);
});

test('clearing a confirmed request with no saved classes leaves existing placements untouched', async () => {
  fixture = createFixture();
  fixture.choices.length = 0;
  const result = await invoke();
  assert.match(result.error?.message || '', /no saved classes; review this record/);
  assert.equal(fixture.request.status, 'approved');
  assert.equal(fixture.request.revision, 3);
  assert.deepEqual(fixture.memberships.map(item => item.withdrawnAt), [null, null]);
  assert.equal(fixture.history.length, 0);
  assert.equal(fixture.audit.length, 0);
});

test('a database failure rolls back membership, request, and choice changes', async () => {
  fixture = createFixture({ failAt: 'INSERT INTO shs_selection_history' });
  assert.match((await invoke()).error.message, /Simulated database failure/);
  assert.equal(fixture.request.status, 'approved');
  assert.equal(fixture.request.revision, 3);
  assert.deepEqual(fixture.choices, [101, 102]);
  assert.ok(fixture.memberships.every(item => item.withdrawnAt === null));
  assert.equal(fixture.history.length, 0);
  assert.equal(fixture.audit.length, 0);
});

test('clear route is staff-only and the new status is added without replacing approved', () => {
  const root = path.join(__dirname, '..');
  const route = fs.readFileSync(path.join(root, 'routes/shsSelection.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'database/migrations/057_shs_selection_clear_status.sql'), 'utf8');
  assert.match(route, /router\.post\('\/requests\/:requestId\/clear', requireSchoolAdmin, controller\.clearApproved\)/);
  assert.match(migration, /ENUM\('pending', 'approved', 'rejected', 'not_recorded'\)/);
});
