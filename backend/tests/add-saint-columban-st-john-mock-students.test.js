'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeStudents, readScope, run, ADDED_AT } =
  require('../scripts/addSaintColumbanStJohnMockStudents');

function fakeDatabase({ enrolled = 10, capacity = 40, duplicateName = false,
  changedHash = false, failInsert = false } = {}) {
  const students = makeStudents();
  const original = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, lrn: `9995${String(i + 1).padStart(8, '0')}`,
    passwordHash: changedHash && i === 9 ? 'other-hash' : 'shared-hash'
  }));
  const saved = [];
  const actions = { begins: 0, commits: 0, rollbacks: 0, inserts: 0,
    snapshots: 0, qr: 0 };
  const connection = {
    async query(sql) {
      if (sql.includes('FOREIGN_KEY_CHECKS')) return [[{ db: 'academix', fk: 1 }]];
      if (sql.includes('FROM users')) return [[
        { schoolId: 7, name: duplicateName ? students[0].name : 'Existing Student',
          schoolEmail: 'existing@scc.academix.test', personalEmail: 'existing@example.test' }
      ]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      assert.equal((sql.match(/\?/g) || []).length, params.length,
        `SQL placeholder mismatch: ${sql.slice(0, 80)}`);
      if (sql.includes('FROM schools')) return [[{ domain: 'scc.academix.test' }]];
      if (sql.includes('FROM academic_years WHERE')) return [[{ id: 3 }]];
      if (sql.includes('FROM sections s JOIN')) return [[{ id: 12, capacity, enrolled: enrolled + saved.length }]];
      if (sql.includes('FROM section_students e') && sql.includes('password_hash')) return [original];
      if (sql.includes('FROM student_profiles WHERE lrn')) return [[]];
      if (sql.includes('FOR UPDATE')) return [[{ id: 3 }]];
      if (sql.includes('INSERT INTO users')) {
        actions.inserts++;
        if (failInsert && actions.inserts === 4) throw new Error('simulated insert failure');
        const id = 800 + saved.length;
        saved.push({ id, user: params });
        return [{ insertId: id }];
      }
      if (sql.includes('INSERT INTO student_profiles')) {
        saved.find(record => record.id === params[0]).profile = params;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE student_qr_credentials')) {
        saved.find(record => record.id === params[4]).qr = params;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO section_students')) {
        saved.find(record => record.id === params[2]).enrollment = params;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('FROM users u JOIN student_profiles p')) {
        return [saved.map(record => {
          const u = record.user;
          const p = record.profile;
          return { id: record.id, name: u[6], schoolEmail: u[1], personalEmail: u[2],
            role: 'student', status: 'active', added: u[9], setupAt: u[8],
            profileAdded: p[11], lrn: p[1], sex: p[2], birthDate: p[3],
            birthProvince: p[4], birthPlace: p[5], birthRegion: p[6],
            birthCountry: 'Philippines', motherTongue: p[7], religion: p[8],
            houseStreet: p[9], barangay: p[10], city: 'Lingayen', province: 'Pangasinan',
            sectionId: record.enrollment[1], enrolledAt: record.enrollment[3],
            qrStatus: 'active', qrIssuedAt: record.qr[0] };
        })];
      }
      if (sql.includes('student_user_id AS id FROM section_students')) {
        return [[...original.map(row => ({ id: row.id })),
          ...saved.map(row => ({ id: row.id }))]];
      }
      throw new Error(`Unexpected execute: ${sql.slice(0, 80)}`);
    },
    async beginTransaction() { actions.begins++; },
    async commit() { actions.commits++; },
    async rollback() { actions.rollbacks++; },
    release() {}
  };
  return { connection, actions, saved, database: { async getConnection() { return connection; } } };
}

async function quiet(callback) {
  const log = console.log;
  const table = console.table;
  console.log = () => {};
  console.table = () => {};
  try { return await callback(); }
  finally { console.log = log; console.table = table; }
}

test('30 students have distinct Grade 7 identities and complete local profiles', () => {
  const students = makeStudents();
  assert.equal(students.length, 30);
  assert.equal(students.filter(s => s.birthPlace === 'Lingayen').length, 24);
  assert.equal(new Set(students.map(s => s.name)).size, 30);
  assert.equal(new Set(students.map(s => s.personalEmail)).size, 30);
  assert.ok(students.every(s => s.sex && s.barangay && s.motherTongue && s.religion));
  assert.equal(ADDED_AT, '2026-11-18 10:17:00');
});

test('preview checks ten source accounts and 40 seats without changing data', async () => {
  const scope = fakeDatabase();
  const students = makeStudents();
  const result = await readScope(scope.connection, students);
  assert.equal(result.sectionId, 12);
  assert.equal(result.passwordHash, 'shared-hash');
  assert.equal(scope.actions.inserts, 0);
  await assert.rejects(readScope(fakeDatabase({ enrolled: 11 }).connection, makeStudents()),
    /exactly 10/);
  await assert.rejects(readScope(fakeDatabase({ capacity: 39 }).connection, makeStudents()),
    /40 seats/);
  await assert.rejects(readScope(fakeDatabase({ changedHash: true }).connection, makeStudents()),
    /shared password/);
  await assert.rejects(readScope(fakeDatabase({ duplicateName: true }).connection, makeStudents()),
    /Name already exists/);
});

test('apply reuses the shared hash, verifies forty students, and commits', async () => {
  const scope = fakeDatabase();
  const result = await quiet(() => run({ apply: true, database: scope.database,
    confirm: async () => true,
    snapshot: () => { scope.actions.snapshots++; return 'available-snapshot'; },
    issueQr: async () => { scope.actions.qr++; } }));
  assert.equal(result.result, 'complete');
  assert.equal(result.ids.length, 30);
  assert.equal(scope.actions.snapshots, 1);
  assert.equal(scope.actions.qr, 30);
  assert.equal(scope.actions.commits, 1);
  assert.equal(scope.actions.rollbacks, 0);
  assert.ok(scope.saved.every(record => record.user[3] === 'shared-hash'));
});

test('a failed insert rolls back the batch', async () => {
  const scope = fakeDatabase({ failInsert: true });
  await assert.rejects(quiet(() => run({ apply: true, database: scope.database,
    confirm: async () => true, snapshot: () => 'available-snapshot',
    issueQr: async () => {} })), /simulated insert failure/);
  assert.equal(scope.actions.commits, 0);
  assert.equal(scope.actions.rollbacks, 1);
});

test('an unavailable snapshot prevents every insert', async () => {
  const scope = fakeDatabase();
  await assert.rejects(quiet(() => run({ apply: true, database: scope.database,
    confirm: async () => true,
    snapshot: () => { throw new Error('snapshot unavailable'); } })),
  /snapshot unavailable/);
  assert.equal(scope.actions.begins, 0);
  assert.equal(scope.actions.inserts, 0);
});
