'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, UTC_SUBMITTED_AT, UTC_APPROVED_AT, CONFIRMATION } =
  require('../scripts/fixSaintColumbanRegistrationTimezone');

function fixture({ offsetSeconds = 0, changedAfterSnapshot = false } = {}) {
  const calls = [];
  let school = { id: 7, name: "Saint Columban's College", status: 'active',
    createdAt: '2026-11-16 22:35:00', submittedAt: '2026-11-16 22:35:00',
    approvedAt: '2026-11-16 22:45:00', updatedAt: '2026-11-22 09:32:46' };
  const admin = { id: 103, name: 'Jesus Vargas', addedAt: '2026-11-17 12:00:00' };
  const connection = {
    async query(sql) {
      calls.push({ sql });
      return sql.includes('TIMESTAMPDIFF')
        ? [[{ offsetSeconds }]] : [[{ db: 'academix', fk: 1 }]];
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM schools WHERE id=? AND name=?')) return [[{ ...school }]];
      if (sql.includes("FROM users WHERE school_id=? AND role='school_admin'")) return [[{ ...admin }]];
      if (sql.startsWith('UPDATE schools')) {
        school = { ...school, createdAt: params[0], submittedAt: params[1], approvedAt: params[2] };
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
    async beginTransaction() { calls.push({ sql: 'BEGIN' }); },
    async commit() { calls.push({ sql: 'COMMIT' }); },
    async rollback() { calls.push({ sql: 'ROLLBACK' }); },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  const database = { getConnection: async () => {
    if (changedAfterSnapshot && calls.some(call => call.sql === 'RELEASE'))
      school.submittedAt = '2026-11-16 22:36:00';
    return connection;
  } };
  return { calls, database };
}

test('preview shows only the three school date corrections and does not write', async () => {
  const f = fixture();
  const result = await run({ database: f.database });
  assert.equal(result.targetStoredUtc.submittedAt, UTC_SUBMITTED_AT);
  assert.equal(result.targetStoredUtc.approvedAt, UTC_APPROVED_AT);
  assert.equal(result.displayedInPhilippines.submittedAt, '2026-11-16 22:35:00');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric',
    minute: '2-digit' }).format(new Date(UTC_SUBMITTED_AT.replace(' ', 'T') + 'Z')), '10:35 PM');
  assert.ok(!f.calls.some(call => call.sql === 'BEGIN' || call.sql.startsWith('UPDATE')));
});

test('apply updates school 7 after confirmation and snapshot, then verifies', async () => {
  const f = fixture();
  const result = await run({ database: f.database, apply: true,
    confirm: phrase => phrase === CONFIRMATION,
    snapshot: () => 'available', checkEndpoint: () => {} });
  assert.equal(result.verified, true);
  const updates = f.calls.filter(call => call.sql.startsWith('UPDATE schools'));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params,
    [UTC_SUBMITTED_AT, UTC_SUBMITTED_AT, UTC_APPROVED_AT, 7, "Saint Columban's College"]);
  assert.match(updates[0].sql, /updated_at=updated_at/);
  assert.ok(f.calls.some(call => call.sql === 'COMMIT'));
});

test('non-UTC database session and changed dates stop without updating', async () => {
  const nonUtc = fixture({ offsetSeconds: 28800 });
  await assert.rejects(() => run({ database: nonUtc.database }), /not in UTC/);
  const changed = fixture({ changedAfterSnapshot: true });
  await assert.rejects(() => run({ database: changed.database, apply: true,
    confirm: () => true, snapshot: () => 'available', checkEndpoint: () => {} }),
  /changed after preview/);
  assert.ok(changed.calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!changed.calls.some(call => call.sql.startsWith('UPDATE')));
});

test('cancellation does not take a snapshot or write', async () => {
  const f = fixture();
  const result = await run({ database: f.database, apply: true,
    confirm: () => false, snapshot: () => { throw new Error('unexpected snapshot'); } });
  assert.equal(result.mode, 'cancelled');
  assert.ok(!f.calls.some(call => call.sql === 'BEGIN'));
});
