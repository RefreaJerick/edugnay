'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, verify, run, CONFIRMATION } =
  require('../scripts/alignSaintColumbanActivityDates');

function scope() {
  return {
    school: { id: 7, name: "Saint Columban's College", status: 'active',
      submittedAt: '2026-11-16 14:35:00', approvedAt: '2026-11-16 14:45:00' },
    logs: [
      { id: 1, actionType: 'school_registration_submitted', entityType: 'school', entityId: 7,
        createdAt: '2026-11-22 09:32:00', details: null },
      { id: 2, actionType: 'school_registration_approved', entityType: 'school', entityId: 7,
        createdAt: '2026-11-22 09:32:46', details: null },
      { id: 3, actionType: 'demo_accounts_seeded', entityType: 'school', entityId: 7,
        createdAt: '2026-11-22 10:00:00', details: '{}' },
      { id: 4, actionType: 'fetcher_requested', entityType: 'fetcher', entityId: 11,
        createdAt: '2026-11-23 14:07:00', details: '{}' },
      { id: 5, actionType: 'fetcher_approved', entityType: 'fetcher_authorization', entityId: 21,
        createdAt: '2026-11-23 14:09:00', details: '{}' },
      { id: 6, actionType: 'fetcher_id_issued', entityType: 'fetcher', entityId: 11,
        createdAt: '2026-11-23 14:10:00', details: '{}' },
      { id: 7, actionType: 'student_picked_up', entityType: 'pickup_record', entityId: 31,
        createdAt: '2026-11-23 14:11:00', details: '{}' },
      { id: 8, actionType: 'other_action', entityType: 'school', entityId: 7,
        createdAt: '2026-11-23 15:00:00', details: '{}' },
      { id: 9, actionType: 'learning_material_uploaded', entityType: 'learning_material', entityId: 41,
        createdAt: '2026-11-23 15:01:00', details: '{}' },
      { id: 10, actionType: 'narrative_report_confirmed_held', entityType: 'narrative_reports', entityId: 30,
        createdAt: '2026-11-23 15:02:00', details: '{}' }
    ],
    materials: [{ id: 41, createdAt: '2026-11-18 03:04:00' }],
    reports: [{ id: 30, generatedAt: '2026-11-18 03:25:00',
      confirmedAt: '2026-11-18 03:32:00', releasedAt: '2026-11-18 03:40:00' }],
    fetchers: [{ id: 11, parentId: 12, createdAt: '2026-11-23 14:07:00',
      updatedAt: '2026-11-23 14:07:00' }],
    authorizations: [{ id: 21, fetcherId: 11, createdAt: '2026-11-23 14:07:00',
      reviewedAt: '2026-11-23 14:09:00', updatedAt: '2026-11-23 14:09:00' }],
    credentials: [{ id: 25, fetcherId: 11, issuedAt: '2026-11-23 14:10:00', revokedAt: null }],
    pickups: [{ id: 31, studentId: 50, schoolDate: '2026-11-23', pickedUpAt: '2026-11-23 14:11:00' }]
  };
}

test('maps all school logs, including platform registration and related fetcher dates', () => {
  const plan = buildPlan(scope());
  assert.equal(plan.logs.length, 10);
  assert.deepEqual(plan.logs.slice(0, 2).map(row => row.target),
    ['2026-11-16 14:35:00', '2026-11-16 14:45:00']);
  assert.equal(plan.logs[2].target, '2026-11-17 04:00:00');
  assert.deepEqual(plan.logs.slice(3, 7).map(row => row.target), [
    '2026-11-18 05:00:00', '2026-11-18 05:01:00',
    '2026-11-18 05:02:00', '2026-11-18 05:03:00'
  ]);
  assert.equal(plan.logs[7].target, null);
  assert.equal(plan.logs[8].target, '2026-11-18 03:04:00');
  assert.equal(plan.logs[9].target, '2026-11-18 03:32:00');
  assert.equal(plan.logs[9].needsReview, false);
  assert.equal(plan.logs[7].needsReview, true);
  assert.equal(plan.fetchers[0].targetCreatedAt, plan.logs[3].target);
  assert.equal(plan.authorizations[0].targetReviewedAt, plan.logs[4].target);
  assert.equal(plan.credentials[0].targetIssuedAt, plan.logs[5].target);
  assert.equal(plan.pickups[0].targetSchoolDate, '2026-11-18');
  assert.equal(plan.pickups[0].targetPickedUpAt, plan.logs[6].target);
});

test('rejects fetcher records without matching events and conflicting pickup dates', () => {
  const missing = scope();
  missing.logs = missing.logs.filter(row => row.id !== 5);
  assert.throws(() => buildPlan(missing), /no decision log/);
  const conflict = scope();
  conflict.pickups.push({ ...conflict.pickups[0], id: 32 });
  conflict.logs.push({ ...conflict.logs[6], id: 9, entityId: 32 });
  assert.throws(() => buildPlan(conflict), /Multiple pickups/);
});

test('verification detects an unmatched stored date', () => {
  const current = scope();
  current.logs[7].actionType = 'school_registration_dates_corrected';
  const plan = buildPlan(current);
  const after = scope();
  after.logs[7].actionType = 'school_registration_dates_corrected';
  after.logs.forEach((row, i) => { row.createdAt = plan.logs[i].target; });
  after.fetchers[0].createdAt = plan.fetchers[0].targetCreatedAt;
  after.fetchers[0].updatedAt = plan.fetchers[0].targetUpdatedAt;
  after.authorizations[0].createdAt = plan.authorizations[0].targetCreatedAt;
  after.authorizations[0].updatedAt = plan.authorizations[0].targetUpdatedAt;
  after.authorizations[0].reviewedAt = plan.authorizations[0].targetReviewedAt;
  after.credentials[0].issuedAt = plan.credentials[0].targetIssuedAt;
  after.pickups[0].schoolDate = plan.pickups[0].targetSchoolDate;
  after.pickups[0].pickedUpAt = plan.pickups[0].targetPickedUpAt;
  assert.doesNotThrow(() => verify(after, plan));
  after.logs[7].createdAt = current.logs[7].createdAt;
  assert.throws(() => verify(after, plan), /Activity date verification failed/);
});

test('later report dates are flagged instead of silently assigned a historical time', () => {
  const data = scope();
  data.reports[0].confirmedAt = '2026-11-23 09:26:20';
  const plan = buildPlan(data);
  assert.equal(plan.logs[9].needsReview, true);
  assert.equal(plan.logs[9].target, null);
});

test('preview and cancellation leave the database unchanged', async () => {
  const data = scope();
  const calls = [];
  const connection = {
    async query() { return [[{ name: 'academix', fk: 1, offsetSeconds: 0 }]]; },
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('FROM schools')) return [[data.school]];
      if (sql.includes('FROM audit_logs')) return [data.logs];
      if (sql.includes('FROM learning_materials')) return [data.materials];
      if (sql.includes('FROM narrative_reports')) return [data.reports];
      if (sql.includes('FROM fetcher_authorizations')) return [data.authorizations];
      if (sql.includes('FROM fetcher_credentials')) return [data.credentials];
      if (sql.includes('FROM fetchers')) return [data.fetchers];
      if (sql.includes('FROM pickup_records')) return [data.pickups];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { calls.push('RELEASE'); }
  };
  const database = { getConnection: async () => connection };
  const preview = await run({ database });
  assert.equal(preview.activityRows, 10);
  assert.equal(preview.activityChanges, 10);
  assert.equal(preview.activityRowsNeedingReview, 1);
  const review = await run({ database, reviewOnly: true });
  assert.equal(review.rowsNeedingReview.length, 1);
  assert.equal(review.rowsNeedingReview[0].id, 8);
  data.logs[7].actionType = 'school_registration_dates_corrected';
  const cancelled = await run({ database, apply: true, confirm: () => false,
    snapshot: () => { throw new Error('Snapshot should not run'); } });
  assert.equal(cancelled.mode, 'cancelled');
  data.logs[7].actionType = 'other_action';
  await assert.rejects(() => run({ database, apply: true, confirm: () => true,
    snapshot: () => { throw new Error('Snapshot should not run'); } }),
  /no matching record date/);
  assert.ok(!calls.some(call => call.startsWith('UPDATE') || call === 'BEGIN'));
  assert.equal(CONFIRMATION, 'ALIGN ALL SCHOOL 7 ACTIVITY DATES');
});

test('apply rolls back when a guarded update fails', async () => {
  const data = scope();
  data.logs[7].actionType = 'school_registration_dates_corrected';
  const calls = [];
  const connection = {
    async query() { return [[{ name: 'academix', fk: 1, offsetSeconds: 0 }]]; },
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('FROM schools')) return [[data.school]];
      if (sql.includes('FROM audit_logs')) return [data.logs];
      if (sql.includes('FROM learning_materials')) return [data.materials];
      if (sql.includes('FROM narrative_reports')) return [data.reports];
      if (sql.includes('FROM fetcher_authorizations')) return [data.authorizations];
      if (sql.includes('FROM fetcher_credentials')) return [data.credentials];
      if (sql.includes('FROM fetchers')) return [data.fetchers];
      if (sql.includes('FROM pickup_records')) return [data.pickups];
      if (sql.startsWith('SELECT id FROM schools')) return [[{ id: 7 }]];
      if (sql.startsWith('UPDATE audit_logs')) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async beginTransaction() { calls.push('BEGIN'); },
    async rollback() { calls.push('ROLLBACK'); },
    async commit() { calls.push('COMMIT'); },
    release() { calls.push('RELEASE'); }
  };
  await assert.rejects(() => run({ database: { getConnection: async () => connection },
    apply: true, confirm: () => true, snapshot: () => 'available',
    checkEndpoint: () => {}, checkService: () => {}, saveManifest: () => {} }),
  /Log 1 changed during apply/);
  assert.ok(calls.includes('BEGIN'));
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.includes('COMMIT'));
});

test('apply changes only school 7 rows and verifies before committing', async () => {
  const data = scope();
  data.logs[7].actionType = 'school_registration_dates_corrected';
  const calls = [];
  const connection = {
    async query() { return [[{ name: 'academix', fk: 1, offsetSeconds: 0 }]]; },
    async execute(sql, params = []) {
      calls.push(sql);
      if (sql.startsWith('SELECT id FROM schools')) return [[{ id: 7 }]];
      if (sql.includes('FROM schools')) return [[data.school]];
      if (sql.includes('FROM audit_logs')) return [data.logs];
      if (sql.includes('FROM learning_materials')) return [data.materials];
      if (sql.includes('FROM narrative_reports')) return [data.reports];
      if (sql.includes('FROM fetcher_authorizations')) return [data.authorizations];
      if (sql.includes('FROM fetcher_credentials')) return [data.credentials];
      if (sql.includes('FROM fetchers')) return [data.fetchers];
      if (sql.includes('FROM pickup_records')) return [data.pickups];
      if (sql.startsWith('UPDATE')) {
        assert.match(sql, /WHERE school_id=\? AND id=\?/);
        const schoolIndex = sql.startsWith('UPDATE audit_logs') || sql.startsWith('UPDATE fetcher_credentials') ? 1
          : sql.startsWith('UPDATE pickup_records') || sql.startsWith('UPDATE fetchers') ? 2 : 3;
        assert.equal(params[schoolIndex], 7);
        const rowId = params[schoolIndex + 1];
        const table = sql.match(/^UPDATE (\w+)/)[1];
        const rows = { audit_logs: data.logs, fetchers: data.fetchers,
          fetcher_authorizations: data.authorizations, fetcher_credentials: data.credentials,
          pickup_records: data.pickups }[table];
        const row = rows.find(item => item.id === rowId);
        assert.ok(row);
        if (table === 'audit_logs') row.createdAt = params[0];
        if (table === 'fetchers') [row.createdAt, row.updatedAt] = params;
        if (table === 'fetcher_authorizations')
          [row.createdAt, row.reviewedAt, row.updatedAt] = params;
        if (table === 'fetcher_credentials') row.issuedAt = params[0];
        if (table === 'pickup_records') [row.schoolDate, row.pickedUpAt] = params;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async beginTransaction() { calls.push('BEGIN'); },
    async rollback() { calls.push('ROLLBACK'); },
    async commit() { calls.push('COMMIT'); },
    release() { calls.push('RELEASE'); }
  };
  const result = await run({ database: { getConnection: async () => connection },
    apply: true, confirm: () => true, snapshot: () => 'available',
    checkEndpoint: () => {}, checkService: () => {}, saveManifest: () => {} });
  assert.equal(result.mode, 'complete');
  assert.equal(result.logsUpdated, 10);
  assert.equal(result.relatedRowsUpdated, 4);
  assert.ok(calls.includes('COMMIT'));
  assert.ok(!calls.includes('ROLLBACK'));
});
