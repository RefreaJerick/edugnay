'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { legacyIdentity, legacyProfile, makeData } = require('../scripts/seedSaintColumbanDemoAccounts');
const { schoolEmailBase, schoolEmailCandidate } = require('../utils/schoolUserEmail');
const { buildManifest, run } = require('../scripts/fixSaintColumbanDemoNames');

function fakeDatabase(options = {}) {
  const domain = 'scc.academix.test';
  const admin = { id: 103, role: 'school_admin', firstName: 'Jesus', lastName: 'Vargas',
    displayName: 'Jesus Vargas', initials: 'JV', schoolEmail: `j.vargas.adm@${domain}`,
    personalEmail: 'admin@example.test', status: 'active', added: '2026-11-17 12:00:00',
    setupCompleted: null };
  const used = new Set([admin.schoolEmail]);
  const users = Array.from({ length: 165 }, (_, index) => {
    const old = legacyIdentity(index);
    const role = index < 135 ? 'student' : index < 155 ? 'teacher' : 'parent';
    const base = schoolEmailBase(old.first, old.last, role);
    let suffix = 1, schoolEmail = schoolEmailCandidate(base, domain, suffix);
    while (used.has(schoolEmail)) schoolEmail = schoolEmailCandidate(base, domain, ++suffix);
    used.add(schoolEmail);
    return { id: 200 + index, role, firstName: old.first, lastName: old.last,
      displayName: old.name, initials: `${old.first[0]}${old.last[0]}`.toUpperCase(),
      schoolEmail, personalEmail: old.personalEmail, status: 'active',
      added: '2026-11-17 12:00:00', setupCompleted: '2026-11-17 12:00:00' };
  });
  const profiles = new Map(users.map((user, index) => [user.id,
    { id: user.id, middleName: user.role === 'teacher' ? null : legacyProfile(index).middle,
      maidenLastName: user.role === 'parent' ? legacyProfile(index).maiden : null,
      religion: user.role === 'teacher' ? null : legacyProfile(index).religion,
      houseStreet: user.role === 'teacher' ? null : legacyProfile(index).houseStreet,
      barangay: user.role === 'teacher' ? null : legacyProfile(index).barangay }]));
  const state = { users, profiles, commits: 0, rollbacks: 0, snapshots: 0, userUpdates: 0,
    admin: { ...admin }, links: [] };
  const connection = {
    async query(sql) {
      if (sql.includes('DATABASE()')) return [[{ db: 'academix', fk: 1 }]];
      if (sql.includes('SELECT id, school_email')) return [[admin, ...users].map(user => ({
        id: user.id, schoolEmail: user.schoolEmail, personalEmail: user.personalEmail
      }))];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, values = []) {
      assert.equal((sql.match(/\?/g) || []).length, values.length, sql);
      if (options.failOn && sql.includes(options.failOn)) throw new Error('Injected failure');
      if (sql.includes('AS scores,') && sql.includes('AS exports')) return [[{
        scores: options.activityScores || 0, attendance: 0, submissions: 0,
        journals: 0, reports: 0, exports: 0
      }]];
      if (sql.includes('FROM schools WHERE id')) return [[{
        id: 7, name: "Saint Columban's College", status: options.status || 'active', domain
      }]];
      if (sql.includes('FROM student_parent_links WHERE school_id')) return [state.links.map(link => ({
        studentId: link.studentId, parentId: link.parentId, relationship: link.relationship
      }))];
      if (sql.includes('FROM users WHERE school_id = ? ORDER BY id')) return [[admin, ...users]];
      if (sql.startsWith('SELECT id, first_name')) return [users.map(user => ({
        id: user.id, firstName: user.firstName, lastName: user.lastName,
        displayName: user.displayName, initials: user.initials,
        schoolEmail: user.schoolEmail, personalEmail: user.personalEmail
      }))];
      if (sql.includes('COALESCE(s.middle_name')) return [[...profiles.values()]];
      if (sql.startsWith('UPDATE users SET')) {
        const user = users.find(item => item.id === values[6]);
        assert.equal(user.personalEmail, values[8]);
        Object.assign(user, { firstName: values[0], lastName: values[1],
          displayName: values[2], initials: values[3], schoolEmail: values[4],
          personalEmail: values[5] });
        state.userUpdates++;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE student_profiles')) {
        Object.assign(profiles.get(values[4]), { middleName: values[0], religion: values[1],
          houseStreet: values[2], barangay: values[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE parent_profiles')) {
        Object.assign(profiles.get(values[2]), { middleName: values[0], maidenLastName: values[1] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
      if (sql.startsWith('INSERT INTO student_parent_links')) {
        state.links.push({ studentId: values[1], parentId: values[2], relationship: values[3] });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
    async beginTransaction() { state.started = true; },
    async commit() { state.commits++; state.started = false; },
    async rollback() { state.rollbacks++; state.started = false; },
    release() {}
  };
  return { state, database: { async getConnection() { return connection; } } };
}

test('new fixture has distinct full names and ten matching families', () => {
  const accounts = makeData().accounts;
  assert.equal(new Set(accounts.map(item => item.first)).size, 165);
  assert.equal(new Set(accounts.map(item => item.name)).size, 165);
  assert.equal(new Set(accounts.map(item => item.last)).size, 145);
});

test('preview matches 165 original seeded accounts without writing', async () => {
  const { database, state } = fakeDatabase();
  const manifest = await buildManifest(await database.getConnection());
  assert.equal(manifest.changes.length, 165);
  assert.equal(manifest.changes.filter(change => change.old.name !== change.next.name).length, 126);
  for (const change of manifest.changes.filter(change => change.role === 'parent')) {
    assert.equal(change.next.name, change.old.name);
    assert.equal(change.next.schoolEmail, change.old.schoolEmail);
    assert.equal(change.next.personalEmail, change.old.personalEmail);
  }
  assert.equal(state.userUpdates, 0);
});

test('suspended school is rejected', async () => {
  const { database } = fakeDatabase({ status: 'suspended' });
  await assert.rejects(buildManifest(await database.getConnection()), /active Saint Columban/);
});

test('existing school activity stops the rename', async () => {
  const { database } = fakeDatabase({ activityScores: 1 });
  await assert.rejects(buildManifest(await database.getConnection()), /School activity/);
});

test('changed seeded account is rejected before applying', async () => {
  const { database, state } = fakeDatabase();
  state.users[12].lastName = 'Manually Edited';
  await assert.rejects(buildManifest(await database.getConnection()), /differs from the original fixture/);
  assert.equal(state.userUpdates, 0);
});

test('edited profile name is rejected before applying', async () => {
  const { database, state } = fakeDatabase();
  state.profiles.get(200).middleName = 'Manually Edited';
  await assert.rejects(buildManifest(await database.getConnection()), /edited profile/);
  assert.equal(state.userUpdates, 0);
});

test('existing parent links stop the repair', async () => {
  const { database, state } = fakeDatabase();
  state.links.push({ studentId: 200, parentId: 355, relationship: 'mother' });
  await assert.rejects(buildManifest(await database.getConnection()), /already has parent links/);
  assert.equal(state.userUpdates, 0);
});

test('cancelled apply does not take a snapshot or update accounts', async () => {
  const { database, state } = fakeDatabase();
  const log = console.log; console.log = () => {};
  try {
    await assert.rejects(run({ apply: true }, { database, confirm: async () => false,
      snapshot: () => { state.snapshots++; return 'snapshot-test'; } }), /Confirmation did not match/);
  } finally { console.log = log; }
  assert.equal(state.snapshots, 0);
  assert.equal(state.userUpdates, 0);
});

test('apply renames 126 mock accounts and verifies ten linked families', async () => {
  const { database, state } = fakeDatabase();
  const log = console.log; console.log = () => {};
  try {
    await run({ apply: true }, { database, confirm: async () => true,
      snapshot: () => { state.snapshots++; return 'snapshot-test'; } });
  } finally { console.log = log; }
  assert.equal(state.snapshots, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.userUpdates, 126);
  assert.equal(state.links.length, 20);
  assert.deepEqual(state.admin, { id: 103, role: 'school_admin', firstName: 'Jesus', lastName: 'Vargas',
    displayName: 'Jesus Vargas', initials: 'JV', schoolEmail: 'j.vargas.adm@scc.academix.test',
    personalEmail: 'admin@example.test', status: 'active', added: '2026-11-17 12:00:00', setupCompleted: null });
});

test('an update failure rolls back', async () => {
  const { database, state } = fakeDatabase({ failOn: 'UPDATE parent_profiles' });
  const log = console.log; console.log = () => {};
  try {
    await assert.rejects(run({ apply: true }, { database, confirm: async () => true,
      snapshot: () => 'snapshot-test' }), /Injected failure/);
  } finally { console.log = log; }
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
});
