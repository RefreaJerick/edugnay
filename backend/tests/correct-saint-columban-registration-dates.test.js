'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, SUBMITTED_AT, APPROVED_AT, CONFIRMATION } =
  require('../scripts/correctSaintColumbanRegistrationDates');

function fixture({ wrongSchool = false, failAudit = false, changedAfterSnapshot = false } = {}) {
  const calls = [];
  let school = { id: 7, name: "Saint Columban's College", status: 'active',
    createdAt: '2026-11-22 09:32:02', submittedAt: '2026-11-22 09:32:02',
    approvedAt: '2026-11-22 09:32:46', updatedAt: '2026-11-22 09:32:46' };
  const admin = { id: 103, name: 'Jesus Vargas', addedAt: '2026-11-17 12:00:00' };
  const connection = {
    async query(sql) { calls.push({ sql }); return [[{ db: 'academix', fk: 1 }]]; },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM schools WHERE id=? AND name=?'))
        return [wrongSchool ? [] : [{ ...school }]];
      if (sql.includes("FROM users WHERE school_id=? AND role='school_admin'")) return [[{ ...admin }]];
      if (sql.startsWith('UPDATE schools')) {
        school = { ...school, createdAt: SUBMITTED_AT, submittedAt: SUBMITTED_AT,
          approvedAt: APPROVED_AT };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO audit_logs') && failAudit) throw new Error('audit failed');
      return [[]];
    },
    async beginTransaction() { calls.push({ sql: 'BEGIN' }); },
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  const database = { getConnection: async () => {
    if (changedAfterSnapshot && calls.some(call => call.sql === 'RELEASE'))
      admin.addedAt = '2026-11-18 12:00:00';
    return connection;
  } };
  return { calls, database };
}

test('preview shows exact dates and leaves the database unchanged', async () => {
  const f = fixture();
  const result = await run({ database: f.database,
    snapshot: () => { throw new Error('snapshot should not run'); } });
  assert.equal(result.target.createdAt, SUBMITTED_AT);
  assert.equal(result.target.submittedAt, SUBMITTED_AT);
  assert.equal(result.target.approvedAt, APPROVED_AT);
  assert.ok(!f.calls.some(call => call.sql === 'BEGIN' || call.sql.startsWith('UPDATE')));
});

test('wrong school and changed admin dates stop without an update', async () => {
  const wrong = fixture({ wrongSchool: true });
  await assert.rejects(() => run({ database: wrong.database }), /Expected exactly one active/);
  const changed = fixture({ changedAfterSnapshot: true });
  await assert.rejects(() => run({ database: changed.database, apply: true,
    confirm: () => true, checkEndpoint: () => {}, snapshot: () => 'available' }),
  /Expected only Jesus Vargas/);
  assert.ok(changed.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!changed.calls.some(call => call.sql.startsWith('UPDATE')));
});

test('cancellation or snapshot failure stops before a transaction', async () => {
  const cancelled = fixture();
  const result = await run({ database: cancelled.database, apply: true,
    confirm: phrase => phrase !== CONFIRMATION });
  assert.equal(result.mode, 'cancelled');
  assert.ok(!cancelled.calls.some(call => call.sql === 'BEGIN'));
  const failed = fixture();
  await assert.rejects(() => run({ database: failed.database, apply: true,
    confirm: () => true, checkEndpoint: () => {},
    snapshot: () => { throw new Error('snapshot unavailable'); } }), /snapshot unavailable/);
  assert.ok(!failed.calls.some(call => call.sql === 'BEGIN'));
});

test('audit failure rolls back the date update', async () => {
  const f = fixture({ failAudit: true });
  await assert.rejects(() => run({ database: f.database, apply: true,
    confirm: () => true, checkEndpoint: () => {}, snapshot: () => 'available' }),
  /audit failed/);
  assert.ok(f.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!f.calls.some(call => call.sql === 'COMMIT'));
});

test('apply updates only the school dates, records correction, and verifies', async () => {
  const f = fixture();
  const result = await run({ database: f.database, apply: true,
    confirm: phrase => phrase === CONFIRMATION,
    checkEndpoint: () => {}, snapshot: () => 'available' });
  assert.equal(result.verified, true);
  const updates = f.calls.filter(call => call.sql.startsWith('UPDATE schools'));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params,
    [SUBMITTED_AT, SUBMITTED_AT, APPROVED_AT, 7, "Saint Columban's College"]);
  assert.match(updates[0].sql, /updated_at=updated_at/);
  assert.ok(f.calls.some(call => call.sql.startsWith('INSERT INTO audit_logs')));
  assert.ok(f.calls.some(call => call.sql === 'COMMIT'));
});
