'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const SUBMITTED_AT = '2026-11-16 22:35:00';
const APPROVED_AT = '2026-11-16 22:45:00';
const ADMIN_ADDED_AT = '2026-11-17 12:00:00';
const CONFIRMATION = 'CORRECT SCHOOL 7 REGISTRATION DATES';

function check(value, message) { if (!value) throw new Error(message); }

async function readScope(connection) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Expected the academix database with foreign-key checks enabled.');
  const [schools] = await connection.execute(
    `SELECT id, name, registration_status AS status,
       DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt,
       DATE_FORMAT(submitted_at,'%Y-%m-%d %H:%i:%s') AS submittedAt,
       DATE_FORMAT(approved_at,'%Y-%m-%d %H:%i:%s') AS approvedAt,
       DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM schools WHERE id=? AND name=?`, [SCHOOL_ID, SCHOOL_NAME]);
  check(schools.length === 1 && schools[0].status === 'active',
    'Expected exactly one active Saint Columban school ID 7.');
  const school = schools[0];
  check(school.createdAt && school.submittedAt && school.approvedAt,
    'School registration dates are incomplete.');
  const [admins] = await connection.execute(
    `SELECT id, display_name AS name,
       DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS addedAt
     FROM users WHERE school_id=? AND role='school_admin'`, [SCHOOL_ID]);
  check(admins.length === 1 && admins[0].name === 'Jesus Vargas' &&
    admins[0].addedAt === ADMIN_ADDED_AT,
  'Expected only Jesus Vargas as school admin, added November 17 at noon.');
  return { school, admin: admins[0] };
}

function checkRdsEndpoint() {
  const output = execFileSync('aws', ['rds', 'describe-db-instances',
    '--db-instance-identifier', 'academix-test-db', '--region', 'ap-southeast-2',
    '--query', 'DBInstances[0].Endpoint.Address', '--output', 'text'],
  { encoding: 'utf8', timeout: 30000 }).trim();
  check(output && output !== 'None' && process.env.DB_HOST === output,
    'DB_HOST does not match the academix-test-db RDS endpoint.');
}

async function run({ apply = false, database, confirm, snapshot = takeSnapshot,
  checkEndpoint = checkRdsEndpoint } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    connection = await db.getConnection();
    const before = await readScope(connection);
    const target = { createdAt: SUBMITTED_AT, submittedAt: SUBMITTED_AT,
      approvedAt: APPROVED_AT };
    check(Object.keys(target).some(key => before.school[key] !== target[key]),
      'Registration dates already match the target; nothing to change.');
    const preview = { mode: 'preview', school: { id: SCHOOL_ID, name: SCHOOL_NAME },
      current: before.school, target, preservedUpdatedAt: before.school.updatedAt,
      admin: before.admin, confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) {
      console.log('Cancelled. Nothing was changed.');
      return { mode: 'cancelled' };
    }
    connection.release();
    connection = null;
    checkEndpoint();
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = await snapshot();
    connection = await db.getConnection();
    await connection.beginTransaction();
    started = true;
    await connection.execute('SELECT id FROM schools WHERE id=? FOR UPDATE', [SCHOOL_ID]);
    const current = await readScope(connection);
    check(JSON.stringify(current) === JSON.stringify(before),
      'School or admin dates changed after preview.');
    const [updated] = await connection.execute(
      `UPDATE schools SET created_at=?, submitted_at=?, approved_at=?, updated_at=updated_at
       WHERE id=? AND name=? AND registration_status='active'`,
      [SUBMITTED_AT, SUBMITTED_AT, APPROVED_AT, SCHOOL_ID, SCHOOL_NAME]);
    check(updated.affectedRows === 1, 'Expected to update exactly one school.');
    await connection.execute(
      `INSERT INTO audit_logs (school_id,actor_user_id,action_type,entity_type,entity_id,details)
       VALUES (?,NULL,'school_registration_dates_corrected','school',?,?)`,
      [SCHOOL_ID, SCHOOL_ID, JSON.stringify({ previous: {
        createdAt: before.school.createdAt, submittedAt: before.school.submittedAt,
        approvedAt: before.school.approvedAt }, target, snapshotId,
      actualExecutionDate: new Date().toISOString() })]);
    const after = await readScope(connection);
    check(after.school.createdAt === target.createdAt &&
      after.school.submittedAt === target.submittedAt &&
      after.school.approvedAt === target.approvedAt &&
      after.school.updatedAt === before.school.updatedAt &&
      JSON.stringify(after.admin) === JSON.stringify(before.admin),
    'Date correction verification failed.');
    await connection.commit();
    started = false;
    const result = { mode: 'complete', schoolId: SCHOOL_ID, target,
      snapshotId, verified: true };
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
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}

if (require.main === module) main().catch(error => {
  console.error('Registration date correction stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { run, readScope, SUBMITTED_AT, APPROVED_AT, CONFIRMATION };
