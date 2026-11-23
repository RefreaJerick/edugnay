'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, ADDED_AT, CONFIRMATION } = require('../scripts/addSaintColumbanDemoGuard');

function fixture({ duplicate = false, failProfile = false } = {}) {
  const calls = [];
  let nextId = 500;
  const connection = {
    async query(sql) {
      calls.push(sql);
      return [[{ db: 'academix', fk: 1 }]];
    },
    async execute(sql, params) {
      calls.push(sql);
      if (sql.startsWith('SELECT school_email_domain')) return [[{ domain: 'scc.academix.test' }]];
      if (sql.startsWith('SELECT id FROM users')) return [duplicate ? [{ id: 10 }] : []];
      if (sql.startsWith('SELECT u.id FROM users u')) return [[]];
      if (sql.startsWith('INSERT INTO users')) return [{ insertId: nextId++ }];
      if (sql.startsWith('INSERT INTO school_guard_profiles') && failProfile) throw new Error('profile failed');
      if (sql.includes('FROM users u JOIN school_guard_profiles')) return [[{
        id: 500, schoolId: 7, role: 'school_guard', status: 'active',
        name: 'Federico Blanco', schoolEmail: 'f.blanco.guard@scc.academix.test',
        personalEmail: 'b.federico.guard@scc-demo.test', dateAdded: ADDED_AT,
        setupAt: ADDED_AT, profileAdded: ADDED_AT, employeeNumber: 'SCC-DEMO-G-001'
      }]];
      return [[]];
    },
    async beginTransaction() { calls.push('BEGIN'); },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); }
  };
  return { calls, database: { getConnection: async () => connection } };
}

test('preview lists the exact guard and does not snapshot or write', async () => {
  const f = fixture();
  const result = await run({ database: f.database,
    snapshot: () => { throw new Error('snapshot should not run'); } });
  assert.equal(result.guard.schoolEmail, 'f.blanco.guard@scc.academix.test');
  assert.equal(result.guard.dateAdded, ADDED_AT);
  assert.ok(!f.calls.some(sql => sql.startsWith('INSERT') || sql === 'BEGIN'));
});

test('apply requires exact confirmation and an available snapshot before insertion', async () => {
  const f = fixture();
  let snapshotCount = 0;
  const result = await run({ database: f.database, apply: true,
    password: 'a-strong-test-password', confirm: phrase => phrase === CONFIRMATION,
    checkEndpoint: () => {}, snapshot: () => { snapshotCount++; return 'snapshot-available'; },
    hashPassword: () => 'hashed' });
  assert.equal(result.verified, true);
  assert.equal(snapshotCount, 1);
  assert.ok(f.calls.indexOf('BEGIN') > f.calls.indexOf('RELEASE'));
  assert.ok(f.calls.some(sql => sql.startsWith('INSERT INTO audit_logs')));
  assert.ok(f.calls.indexOf('COMMIT') > f.calls.indexOf('INSERT INTO audit_logs'));
});

test('duplicate account stops before snapshot', async () => {
  const f = fixture({ duplicate: true });
  await assert.rejects(() => run({ database: f.database, apply: true,
    password: 'a-strong-test-password', snapshot: () => { throw new Error('snapshot called'); } }),
  /already exists/);
  assert.ok(!f.calls.includes('BEGIN'));
});

test('wrong confirmation or failed snapshot never inserts an account', async () => {
  const cancelled = fixture();
  const result = await run({ database: cancelled.database, apply: true,
    password: 'a-strong-test-password', confirm: () => false,
    snapshot: () => { throw new Error('snapshot should not run'); } });
  assert.equal(result.mode, 'cancelled');
  assert.ok(!cancelled.calls.includes('BEGIN'));

  const failed = fixture();
  await assert.rejects(() => run({ database: failed.database, apply: true,
    password: 'a-strong-test-password', confirm: () => true,
    checkEndpoint: () => {}, snapshot: () => { throw new Error('snapshot unavailable'); },
    hashPassword: () => 'hashed' }), /snapshot unavailable/);
  assert.ok(!failed.calls.includes('BEGIN'));
});

test('profile failure rolls back both records', async () => {
  const f = fixture({ failProfile: true });
  await assert.rejects(() => run({ database: f.database, apply: true,
    password: 'a-strong-test-password', confirm: () => true,
    checkEndpoint: () => {}, snapshot: () => 'snapshot-available',
    hashPassword: () => 'hashed' }), /profile failed/);
  assert.ok(f.calls.includes('ROLLBACK'));
  assert.ok(!f.calls.includes('COMMIT'));
});
