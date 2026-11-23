'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const CONFIRMATION = 'ALIGN ALL SCHOOL 7 ACTIVITY DATES';
const SUBMITTED_UTC = '2026-11-16 14:35:00';
const APPROVED_UTC = '2026-11-16 14:45:00';
const FETCHER_START_UTC = '2026-11-18 05:00:00'; // 1:00 PM in the Philippines
const FALLBACK_START_UTC = '2026-11-18 07:00:00'; // 3:00 PM in the Philippines

function check(ok, message) { if (!ok) throw new Error(message); }
function addSeconds(value, seconds) {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime() + seconds * 1000;
}
function sqlTime(milliseconds) { return new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' '); }
function inWindow(value) { return value >= '2026-11-15 16:00:00' && value < '2026-11-18 16:00:00'; }
function fetcherAction(type) { return type.startsWith('fetcher_') || type === 'student_picked_up'; }
function parseDetails(value) {
  if (!value) return {};
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return {}; }
}
function actionTime(row, scope, fetcherIndex) {
  const details = parseDetails(row.details);
  if (row.actionType === 'school_registration_submitted') return scope.school.submittedAt;
  if (row.actionType === 'school_registration_approved') return scope.school.approvedAt;
  if (fetcherAction(row.actionType)) return sqlTime(addSeconds(FETCHER_START_UTC, fetcherIndex * 60));
  if (row.actionType === 'learning_material_uploaded' && row.entityType === 'learning_material') {
    const material = scope.materials.find(item => Number(item.id) === Number(row.entityId));
    if (material && inWindow(material.createdAt)) return material.createdAt;
  }
  if (inWindow(row.createdAt)) return row.createdAt;
  if (row.actionType === 'demo_accounts_seeded') return '2026-11-17 04:00:00';
  if (row.actionType === 'demo_names_corrected') return '2026-11-17 04:10:00';
  if (row.actionType === 'demo_guard_seeded') return '2026-11-17 07:56:00';
  if (row.actionType === 'synthetic_demo_grade_correction') return '2026-11-18 03:06:00';
  if (row.actionType === 'synthetic_demo_st_peter_seed') return '2026-11-18 03:45:00';
  if (row.actionType === 'synthetic_demo_attendance_backfill') return '2026-11-18 05:30:00';
  if (row.actionType === 'synthetic_demo_st_peter_week_reset') return '2026-11-18 06:00:00';
  if (row.actionType === 'school_registration_dates_corrected') return '2026-11-16 14:50:00';
  if (details.source === 'synthetic_demo_data' &&
      /^2026-11-1[678] \d{2}:\d{2}:\d{2}$/.test(details.demoDate) && inWindow(details.demoDate))
    return details.demoDate;
  return null;
}

function buildPlan(scope) {
  const sorted = [...scope.logs].sort((a, b) => Number(a.id) - Number(b.id));
  let fetcherIndex = 0;
  let fallbackIndex = 0;
  const logs = sorted.map(row => {
    const mapped = actionTime(row, scope, fetcherIndex);
    const target = mapped || sqlTime(addSeconds(FALLBACK_START_UTC, fallbackIndex++));
    if (fetcherAction(row.actionType)) fetcherIndex++;
    check(inWindow(target), `Target outside November 16–18 for log ${row.id}.`);
    return { id: Number(row.id), actionType: row.actionType, entityType: row.entityType,
      entityId: row.entityId === null ? null : Number(row.entityId),
      current: row.createdAt, target, change: row.createdAt !== target };
  });
  const byEntity = (type, id) => logs.filter(row => row.entityType === type && row.entityId === Number(id));
  const first = rows => rows[0]?.target;
  const last = rows => rows[rows.length - 1]?.target;
  const fetchers = scope.fetchers.map(row => {
    const events = byEntity('fetcher', row.id);
    check(events.length, `Fetcher ${row.id} has no matching activity log.`);
    const created = first(events);
    const updated = last(events);
    return { ...row, targetCreatedAt: created, targetUpdatedAt: updated };
  });
  const authorizations = scope.authorizations.map(row => {
    const fetcher = fetchers.find(item => Number(item.id) === Number(row.fetcherId));
    const decisions = byEntity('fetcher_authorization', row.id);
    check(fetcher, `Authorization ${row.id} has no school fetcher.`);
    if (row.reviewedAt) check(decisions.length, `Authorization ${row.id} has no decision log.`);
    const reviewed = row.reviewedAt ? last(decisions) : null;
    return { ...row, targetCreatedAt: fetcher.targetCreatedAt,
      targetReviewedAt: reviewed, targetUpdatedAt: reviewed || fetcher.targetCreatedAt };
  });
  const credentials = scope.credentials.map(row => {
    const events = byEntity('fetcher', row.fetcherId).filter(item =>
      item.actionType === 'fetcher_id_issued' || item.actionType === 'fetcher_id_reissued');
    check(events.length, `Credential ${row.id} has no issuance log.`);
    check(!row.revokedAt, `Credential ${row.id} is revoked; its date needs individual review.`);
    return { ...row, targetIssuedAt: last(events) };
  });
  const pickups = scope.pickups.map(row => {
    const events = byEntity('pickup_record', row.id).filter(item => item.actionType === 'student_picked_up');
    check(events.length === 1, `Pickup ${row.id} needs exactly one activity log.`);
    return { ...row, targetPickedUpAt: events[0].target, targetSchoolDate: '2026-11-18' };
  });
  check(new Set(pickups.map(row => row.studentId)).size === pickups.length,
    'Multiple pickups for one student would conflict on November 18.');
  return { logs, fetchers, authorizations, credentials, pickups };
}

async function readScope(connection) {
  const [[db]] = await connection.query('SELECT DATABASE() AS name, @@FOREIGN_KEY_CHECKS AS fk, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offsetSeconds');
  check(db.name === 'academix' && Number(db.fk) === 1 && Math.abs(Number(db.offsetSeconds)) <= 60,
    'Expected academix with foreign-key checks enabled and a UTC database session.');
  const [schools] = await connection.execute(`SELECT id,name,registration_status AS status,
    DATE_FORMAT(submitted_at,'%Y-%m-%d %H:%i:%s') AS submittedAt,
    DATE_FORMAT(approved_at,'%Y-%m-%d %H:%i:%s') AS approvedAt
    FROM schools WHERE id=? AND name=?`, [SCHOOL_ID, SCHOOL_NAME]);
  check(schools.length === 1 && schools[0].status === 'active', 'Expected active Saint Columban school ID 7.');
  const school = schools[0];
  check(school.submittedAt === SUBMITTED_UTC && school.approvedAt === APPROVED_UTC,
    'School registration dates differ from the corrected Nov 16 dates.');
  const [logs] = await connection.execute(`SELECT id,action_type AS actionType,entity_type AS entityType,
    entity_id AS entityId,details,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
    FROM audit_logs WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  check(logs.length > 0, 'No school activity logs found.');
  for (const type of ['school_registration_submitted', 'school_registration_approved'])
    check(logs.filter(row => row.actionType === type && row.entityType === 'school'
      && Number(row.entityId) === SCHOOL_ID).length === 1, `Expected one ${type} log for school 7.`);
  const [materials] = await connection.execute(`SELECT id,
    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
    FROM learning_materials WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  const [fetchers] = await connection.execute(`SELECT id,parent_user_id AS parentId,
    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,
    DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updatedAt
    FROM fetchers WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  const [authorizations] = await connection.execute(`SELECT id,fetcher_id AS fetcherId,
    DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,
    DATE_FORMAT(reviewed_at,'%Y-%m-%d %H:%i:%s') AS reviewedAt,
    DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updatedAt
    FROM fetcher_authorizations WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  const [credentials] = await connection.execute(`SELECT id,fetcher_id AS fetcherId,
    DATE_FORMAT(issued_at,'%Y-%m-%d %H:%i:%s') AS issuedAt,
    DATE_FORMAT(revoked_at,'%Y-%m-%d %H:%i:%s') AS revokedAt
    FROM fetcher_credentials WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  const [pickups] = await connection.execute(`SELECT id,student_user_id AS studentId,
    DATE_FORMAT(school_date,'%Y-%m-%d') AS schoolDate,
    DATE_FORMAT(picked_up_at,'%Y-%m-%d %H:%i:%s') AS pickedUpAt
    FROM pickup_records WHERE school_id=? ORDER BY id`, [SCHOOL_ID]);
  return { school, logs, materials, fetchers, authorizations, credentials, pickups };
}

function assertServiceStopped() {
  check(process.platform === 'linux', 'Apply must run on EC2 Linux.');
  let state;
  try { state = execFileSync('systemctl', ['is-active', 'academix'], { encoding: 'utf8' }).trim(); }
  catch (error) { state = String(error.stdout || '').trim(); }
  check(state === 'inactive' || state === 'failed', `Stop academix before applying (${state || 'unknown'}).`);
}
function assertRdsTarget() {
  const endpoint = execFileSync('aws', ['rds', 'describe-db-instances',
    '--db-instance-identifier', 'academix-test-db', '--region', 'ap-southeast-2',
    '--query', 'DBInstances[0].Endpoint.Address', '--output', 'text'],
  { encoding: 'utf8', timeout: 30000 }).trim();
  check(endpoint && endpoint !== 'None' && process.env.DB_HOST === endpoint,
    'DB_HOST does not match academix-test-db RDS.');
}

async function applyPlan(connection, plan) {
  for (const row of plan.logs.filter(item => item.change)) {
    const [result] = await connection.execute(`UPDATE audit_logs SET created_at=?
      WHERE school_id=? AND id=? AND created_at=?`, [row.target, SCHOOL_ID, row.id, row.current]);
    check(result.affectedRows === 1, `Log ${row.id} changed during apply.`);
  }
  for (const row of plan.fetchers) {
    if (row.createdAt === row.targetCreatedAt && row.updatedAt === row.targetUpdatedAt) continue;
    const [result] = await connection.execute(`UPDATE fetchers SET created_at=?,updated_at=?
      WHERE school_id=? AND id=? AND created_at=? AND updated_at=?`,
    [row.targetCreatedAt, row.targetUpdatedAt, SCHOOL_ID, row.id, row.createdAt, row.updatedAt]);
    check(result.affectedRows === 1, `Fetcher ${row.id} changed during apply.`);
  }
  for (const row of plan.authorizations) {
    if (row.createdAt === row.targetCreatedAt && row.reviewedAt === row.targetReviewedAt &&
        row.updatedAt === row.targetUpdatedAt) continue;
    const [result] = await connection.execute(`UPDATE fetcher_authorizations
      SET created_at=?,reviewed_at=?,updated_at=? WHERE school_id=? AND id=?
      AND created_at=? AND updated_at=? AND reviewed_at <=> ?`,
    [row.targetCreatedAt, row.targetReviewedAt, row.targetUpdatedAt,
      SCHOOL_ID, row.id, row.createdAt, row.updatedAt, row.reviewedAt]);
    check(result.affectedRows === 1, `Authorization ${row.id} changed during apply.`);
  }
  for (const row of plan.credentials) {
    if (row.issuedAt === row.targetIssuedAt) continue;
    const [result] = await connection.execute(`UPDATE fetcher_credentials SET issued_at=?
      WHERE school_id=? AND id=? AND issued_at=? AND revoked_at IS NULL`,
    [row.targetIssuedAt, SCHOOL_ID, row.id, row.issuedAt]);
    check(result.affectedRows === 1, `Credential ${row.id} changed during apply.`);
  }
  for (const row of plan.pickups) {
    if (row.schoolDate === row.targetSchoolDate && row.pickedUpAt === row.targetPickedUpAt) continue;
    const [result] = await connection.execute(`UPDATE pickup_records SET school_date=?,picked_up_at=?
      WHERE school_id=? AND id=? AND school_date=? AND picked_up_at=?`,
    [row.targetSchoolDate, row.targetPickedUpAt, SCHOOL_ID, row.id, row.schoolDate, row.pickedUpAt]);
    check(result.affectedRows === 1, `Pickup ${row.id} changed during apply.`);
  }
}

function verify(scope, plan) {
  const match = (rows, targets, fields) => rows.length === targets.length && rows.every((row, i) =>
    Number(row.id) === Number(targets[i].id) && fields.every(([field, target]) => row[field] === targets[i][target]));
  check(match(scope.logs, plan.logs, [['createdAt', 'target']]), 'Activity date verification failed.');
  check(match(scope.fetchers, plan.fetchers, [['createdAt', 'targetCreatedAt'], ['updatedAt', 'targetUpdatedAt']]),
    'Fetcher date verification failed.');
  check(match(scope.authorizations, plan.authorizations,
    [['createdAt', 'targetCreatedAt'], ['reviewedAt', 'targetReviewedAt'], ['updatedAt', 'targetUpdatedAt']]),
  'Authorization date verification failed.');
  check(match(scope.credentials, plan.credentials, [['issuedAt', 'targetIssuedAt']]),
    'Credential date verification failed.');
  check(match(scope.pickups, plan.pickups, [['schoolDate', 'targetSchoolDate'], ['pickedUpAt', 'targetPickedUpAt']]),
    'Pickup date verification failed.');
}

async function run({ apply = false, database, confirm, snapshot = takeSnapshot,
  checkEndpoint = assertRdsTarget, checkService = assertServiceStopped,
  saveManifest = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 }) } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    connection = await db.getConnection();
    const before = await readScope(connection);
    const plan = buildPlan(before);
    const preview = { mode: 'preview', school: { id: SCHOOL_ID, name: SCHOOL_NAME },
      activityRows: plan.logs.length, activityChanges: plan.logs.filter(row => row.change).length,
      fetcherRows: plan.fetchers.length, authorizationRows: plan.authorizations.length,
      credentialRows: plan.credentials.length, pickupRows: plan.pickups.length,
      logs: plan.logs, fetchers: plan.fetchers, authorizations: plan.authorizations,
      credentials: plan.credentials, pickups: plan.pickups, confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;
    check(plan.logs.some(row => row.change), 'All activity dates already match; nothing to change.');
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) return { mode: 'cancelled' };
    connection.release();
    connection = null;
    checkService();
    checkEndpoint();
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = await snapshot();
    const manifestFile = path.join(os.homedir(), `saint-columban-activity-before-${snapshotId}.json`);
    saveManifest(manifestFile, { schoolId: SCHOOL_ID, snapshotId, before, plan });
    connection = await db.getConnection();
    await connection.beginTransaction();
    started = true;
    await connection.execute('SELECT id FROM schools WHERE id=? FOR UPDATE', [SCHOOL_ID]);
    const current = await readScope(connection);
    check(JSON.stringify(current) === JSON.stringify(before), 'Records changed after preview; nothing was committed.');
    await applyPlan(connection, plan);
    verify(await readScope(connection), plan);
    await connection.commit();
    started = false;
    const result = { mode: 'complete', schoolId: SCHOOL_ID,
      logsUpdated: plan.logs.filter(row => row.change).length,
      relatedRowsUpdated: plan.fetchers.filter(row => row.createdAt !== row.targetCreatedAt ||
        row.updatedAt !== row.targetUpdatedAt).length +
        plan.authorizations.filter(row => row.createdAt !== row.targetCreatedAt ||
          row.reviewedAt !== row.targetReviewedAt || row.updatedAt !== row.targetUpdatedAt).length +
        plan.credentials.filter(row => row.issuedAt !== row.targetIssuedAt).length +
        plan.pickups.filter(row => row.schoolDate !== row.targetSchoolDate ||
          row.pickedUpAt !== row.targetPickedUpAt).length,
      snapshotId, manifestFile, verified: true };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
    if (!database) await db.end();
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  check(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  check(new Date().getTimezoneOffset() === 0, 'Run on the UTC-configured EC2 host.');
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]), 'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}

if (require.main === module) main().catch(error => {
  console.error('Activity date alignment stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { run, buildPlan, verify, CONFIRMATION };
