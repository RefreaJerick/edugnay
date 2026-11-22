'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInput, makeStudents, readScope, run, ADDED_AT } =
  require('../scripts/addSaintColumbanStJohnStudents');

const input = 'firstName,lastName,personalEmail\n' +
  Array.from({ length: 10 }, (_, i) => `First${i + 1},Last${i + 1},student${i + 1}@example.test`).join('\n');

function fakeDatabase({ enrolled = 0, existingEmail = null, failInsert = false,
  complete = false } = {}) {
  const rows = parseInput(input);
  const actions = { begins: 0, commits: 0, rollbacks: 0, releases: 0,
    inserts: 0, profiles: 0, qrDates: 0, enrollments: 0 };
  const saved = [];
  const connection = {
    async query(sql) {
      if (sql.includes('FOREIGN_KEY_CHECKS')) return [[{ db: 'academix', fk: 1 }]];
      if (sql.includes('FROM users')) return [[
        { schoolId: 7, name: 'Existing Student', schoolEmail: 'existing@scc.academix.test',
          personalEmail: existingEmail }
      ]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      assert.equal((sql.match(/\?/g) || []).length, params.length,
        `SQL placeholder mismatch: ${sql.slice(0, 80)}`);
      if (sql.includes('FROM schools')) return [[{ domain: 'scc.academix.test' }]];
      if (sql.includes('FROM academic_years WHERE')) return [[{ id: 3 }]];
      if (sql.includes('FROM sections s JOIN')) return [[{ id: 12, capacity: 40, enrolled }]];
      if (sql.includes('FROM student_profiles WHERE lrn')) return [[]];
      if (sql.includes('FOR UPDATE')) return [[{ id: 3 }]];
      if (sql.includes('INSERT INTO users')) {
        actions.inserts++;
        if (failInsert) throw new Error('simulated insert failure');
        const id = 800 + saved.length;
        saved.push({ id, user: params });
        return [{ insertId: id }];
      }
      if (complete && sql.includes('INSERT INTO student_profiles')) {
        actions.profiles++;
        saved.find(record => record.id === params[0]).profile = params;
        return [{ affectedRows: 1 }];
      }
      if (complete && sql.includes('UPDATE student_qr_credentials')) {
        actions.qrDates++;
        saved.find(record => record.id === params[4]).qr = params;
        return [{ affectedRows: 1 }];
      }
      if (complete && sql.includes('INSERT INTO section_students')) {
        actions.enrollments++;
        saved.find(record => record.id === params[2]).enrollment = params;
        return [{ affectedRows: 1 }];
      }
      if (complete && sql.includes('FROM users u JOIN student_profiles p')) {
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
      if (complete && sql.includes('COUNT(*) AS n FROM section_students')) return [[{ n: 10 }]];
      throw new Error(`Unexpected execute: ${sql.slice(0, 80)}`);
    },
    async beginTransaction() { actions.begins++; },
    async commit() { actions.commits++; },
    async rollback() { actions.rollbacks++; },
    release() { actions.releases++; }
  };
  return { rows, actions, connection, database: { async getConnection() { return connection; } } };
}

async function quiet(callback) {
  const log = console.log;
  const table = console.table;
  console.log = () => {};
  console.table = () => {};
  try { return await callback(); }
  finally { console.log = log; console.table = table; }
}

test('input and synthetic profiles match the ten-student plan', () => {
  const students = makeStudents(parseInput(input));
  assert.equal(students.length, 10);
  assert.equal(students.filter(s => s.birthPlace === 'Lingayen').length, 7);
  assert.equal(students.filter(s => s.sex === 'female').length, 4);
  assert.equal(new Set(students.map(s => s.lrn)).size, 10);
  assert.ok(students.every(s => /^9995\d{8}$/.test(s.lrn)));
  assert.ok(students.every(s => s.houseStreet && s.barangay && s.motherTongue && s.religion));
  assert.equal(ADDED_AT, '2026-11-18 10:17:00');
  assert.throws(() => makeStudents(parseInput(input.replace('student2@example.test', 'student1@example.test'))),
    /Duplicate|Student source data/);
});

test('preflight is read-only and rejects an occupied section or used email', async () => {
  const scope = fakeDatabase();
  const students = makeStudents(scope.rows);
  assert.deepEqual(await readScope(scope.connection, students),
    { yearId: 3, sectionId: 12, domain: 'scc.academix.test' });
  assert.equal(students[0].schoolEmail, 'f.last1.stud@scc.academix.test');
  assert.equal(scope.actions.inserts, 0);
  await assert.rejects(readScope(fakeDatabase({ enrolled: 1 }).connection,
    makeStudents(scope.rows)), /empty Grade 7 St. John/);
  await assert.rejects(readScope(fakeDatabase({ existingEmail: 'student1@example.test' }).connection,
    makeStudents(scope.rows)), /Personal email already exists/);
});

test('apply requires a snapshot and rolls back if an insert fails', async () => {
  const missingSnapshot = fakeDatabase();
  await assert.rejects(quiet(() => run({ rows: missingSnapshot.rows, apply: true,
    password: 'strong-example-password', database: missingSnapshot.database,
    hashPassword: async () => 'hash', confirm: async () => true,
    snapshot: () => { throw new Error('snapshot unavailable'); } })), /snapshot unavailable/);
  assert.equal(missingSnapshot.actions.begins, 0);
  assert.equal(missingSnapshot.actions.inserts, 0);

  const failedInsert = fakeDatabase({ failInsert: true });
  await assert.rejects(quiet(() => run({ rows: failedInsert.rows, apply: true,
    password: 'strong-example-password', database: failedInsert.database,
    hashPassword: async () => 'hash', confirm: async () => true,
    snapshot: () => 'available-snapshot' })), /simulated insert failure/);
  assert.equal(failedInsert.actions.begins, 1);
  assert.equal(failedInsert.actions.rollbacks, 1);
  assert.equal(failedInsert.actions.commits, 0);
});

test('apply creates and verifies ten accounts without an email sender', async () => {
  const fixture = fakeDatabase({ complete: true });
  const result = await quiet(() => run({ rows: fixture.rows, apply: true,
    password: 'strong-example-password', database: fixture.database,
    hashPassword: async () => 'hash', confirm: async () => true,
    issueQr: async () => {}, snapshot: () => 'available-snapshot' }));
  assert.equal(result.result, 'complete');
  assert.equal(result.ids.length, 10);
  assert.deepEqual([fixture.actions.inserts, fixture.actions.profiles,
    fixture.actions.qrDates, fixture.actions.enrollments], [10, 10, 10, 10]);
  assert.equal(fixture.actions.commits, 1);
  assert.equal(fixture.actions.rollbacks, 0);
});
