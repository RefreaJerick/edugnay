'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { makeData, preflight, verify, run } = require('../scripts/seedSaintColumbanDemoAccounts');

function fakeDatabase(options = {}) {
  const state = { users: [], sections: [], profiles: { student: 0, teacher: 0, parent: 0 },
    enrollments: 0, qr: 0, snapshots: 0, commits: 0, rollbacks: 0, nextId: 200,
    failure: options.failure || null };
  const connection = {
    async query(sql) {
      if (sql.includes('DATABASE()')) return [[{ db: 'academix', fk: 1 }]];
      if (sql.includes('FROM users')) return [[{ school_email: 'j.vargas.adm@scc.academix.test', personal_email: 'admin@example.test' }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, values = []) {
      assert.equal((sql.match(/\?/g) || []).length, values.length, sql);
      if (state.failure && sql.includes(state.failure)) throw new Error('Injected insert failure');
      if (sql.startsWith('SELECT role, COUNT')) return [[
        { role: 'school_admin', n: 1 },
        ...['student', 'teacher', 'parent'].map(role => ({ role, n: state.users.filter(u => u.role === role).length }))
      ]];
      if (sql.includes('AS sections,')) return [[{
        sections: state.sections.length, enrollments: state.enrollments,
        students: state.profiles.student, qr: state.qr, teachers: state.profiles.teacher,
        parents: state.profiles.parent, parentLinks: 0, teacherAssignments: 0,
        scoreItems: 0, scores: 0, publishedGrades: 0, attendance: 0,
        wrongAccountDates: 0, wrongSectionDates: 0, wrongEnrollmentDates: 0,
        wrongQrDates: 0, incompleteStudents: 0, incompleteParents: 0, incompleteTeachers: 0
      }]];
      if (sql.includes('COUNT(e.id)')) return [state.sections.map((_, i) => ({ id: i + 1, n: 5 }))];
      if (sql.includes('TIMESTAMPDIFF')) return [[{ n: state.profiles.student }]];
      if (sql.startsWith('SELECT id, registration_status')) return [[{
        id: 7, status: options.schoolStatus || 'active', domain: 'scc.academix.test'
      }]];
      if (sql.startsWith('SELECT id FROM academic_years')) return [[{ id: 4 }]];
      if (sql.includes('FROM school_grade_levels g')) return [Array.from({ length: 9 }, (_, i) => ({
        id: i + 1, code: `grade-${i + 2}`, levelId: i < 5 ? 1 : 2
      }))];
      if (sql.includes('FROM users WHERE school_id=?')) return [
        [{ role: 'school_admin', added: '2026-11-17 12:00:00' }, ...state.users]
      ];
      if (sql.startsWith('SELECT COUNT(*) AS n FROM sections')) return [[{ n: state.sections.length }]];
      if (sql.includes('FROM student_profiles WHERE lrn')) return [[]];
      if (sql.startsWith('INSERT INTO sections')) {
        const id = state.nextId++;
        state.sections.push(id);
        return [{ insertId: id }];
      }
      if (sql.startsWith('INSERT INTO users')) {
        const id = state.nextId++;
        state.users.push({ id, role: values[1] });
        return [{ insertId: id }];
      }
      if (sql.startsWith('INSERT INTO student_profiles')) state.profiles.student++;
      if (sql.startsWith('INSERT INTO teacher_profiles')) state.profiles.teacher++;
      if (sql.startsWith('INSERT INTO parent_profiles')) state.profiles.parent++;
      if (sql.startsWith('INSERT INTO section_students')) state.enrollments++;
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() { state.started = true; },
    async commit() { state.commits++; state.started = false; },
    async rollback() { state.rollbacks++; state.started = false; },
    release() { state.releases = (state.releases || 0) + 1; }
  };
  return { state, database: { async getConnection() { return connection; } } };
}

test('generates 27 unique sections and 165 unique account names', () => {
  const data = makeData();
  assert.equal(data.sections.length, 27);
  assert.equal(data.accounts.length, 165);
  assert.equal(new Set(data.accounts.map(account => account.name)).size, 165);
  assert.deepEqual(data.sections.filter(section => section.grade === 7).map(section => section.name),
    ['St. John', 'St. Peter', 'St. Luke']);
});

test('preflight validates target and email uniqueness', async () => {
  const { database } = fakeDatabase();
  const data = makeData();
  await preflight(await database.getConnection(), data);
  assert.equal(new Set(data.accounts.map(account => account.schoolEmail)).size, 165);
});

test('preflight rejects a suspended school', async () => {
  const { database } = fakeDatabase({ schoolStatus: 'suspended' });
  await assert.rejects(preflight(await database.getConnection(), makeData()), /active Saint Columban/);
});

test('preview and cancelled apply make no changes', async () => {
  const { database, state } = fakeDatabase();
  const log = console.log;
  console.log = () => {};
  try {
    await run({ apply: false }, { database });
    await assert.rejects(run({ apply: true, password: 'valid-demo-pass', confirm: async () => false },
      { database }), /Confirmation did not match/);
  } finally { console.log = log; }
  assert.equal(state.sections.length, 0);
  assert.equal(state.snapshots, 0);
  assert.equal(state.commits, 0);
});

test('apply creates and verifies all records in one transaction', async () => {
  const { database, state } = fakeDatabase();
  const log = console.log;
  console.log = () => {};
  try {
    await run({ apply: true, password: 'valid-demo-pass', confirm: async () => true }, {
      database, hashPassword: async () => 'hash',
      createSnapshot: () => { state.snapshots++; return 'snapshot-test'; },
      issueQr: async () => { state.qr++; }
    });
  } finally { console.log = log; }
  assert.equal(state.snapshots, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.sections.length, 27);
  assert.equal(state.users.length, 165);
  assert.equal(state.profiles.student, 135);
  assert.equal(state.profiles.teacher, 20);
  assert.equal(state.profiles.parent, 10);
  assert.equal(state.enrollments, 135);
});

test('an insert error rolls back', async () => {
  const { database, state } = fakeDatabase({ failure: 'INSERT INTO teacher_profiles' });
  const log = console.log;
  console.log = () => {};
  try {
    await assert.rejects(run({ apply: true, password: 'valid-demo-pass', confirm: async () => true }, {
      database, hashPassword: async () => 'hash',
      createSnapshot: () => 'snapshot-test', issueQr: async () => { state.qr++; }
    }), /Injected insert failure/);
  } finally { console.log = log; }
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
});
