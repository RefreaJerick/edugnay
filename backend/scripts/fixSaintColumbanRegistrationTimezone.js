'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { readScope, SUBMITTED_AT, APPROVED_AT } = require('./correctSaintColumbanRegistrationDates');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const DISPLAY_SUBMITTED_AT = '2026-11-16 22:35:00';
const DISPLAY_APPROVED_AT = '2026-11-16 22:45:00';
const UTC_SUBMITTED_AT = '2026-11-16 14:35:00';
const UTC_APPROVED_AT = '2026-11-16 14:45:00';
const CONFIRMATION = 'FIX SCHOOL 7 REGISTRATION TIMEZONE';

function check(value, message) { if (!value) throw new Error(message); }

function checkRdsEndpoint() {
  const endpoint = execFileSync('aws', ['rds', 'describe-db-instances',
    '--db-instance-identifier', 'academix-test-db', '--region', 'ap-southeast-2',
    '--query', 'DBInstances[0].Endpoint.Address', '--output', 'text'],
  { encoding: 'utf8', timeout: 30000 }).trim();
  check(endpoint && endpoint !== 'None' && process.env.DB_HOST === endpoint,
    'DB_HOST does not match the academix-test-db RDS endpoint.');
}

async function readCurrent(connection) {
  const [[clock]] = await connection.query(
    'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offsetSeconds'
  );
  check(Math.abs(Number(clock.offsetSeconds)) <= 60,
    'The database session is not in UTC; no dates were changed.');
  return readScope(connection);
}

async function run({ apply = false, database, confirm, snapshot = takeSnapshot,
  checkEndpoint = checkRdsEndpoint } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let inTransaction = false;
  try {
    connection = await db.getConnection();
    const before = await readCurrent(connection);
    check(before.school.createdAt === SUBMITTED_AT &&
      before.school.submittedAt === SUBMITTED_AT &&
      before.school.approvedAt === APPROVED_AT,
    'School registration dates do not match the previous correction; nothing was changed.');
    const target = { createdAt: UTC_SUBMITTED_AT, submittedAt: UTC_SUBMITTED_AT,
      approvedAt: UTC_APPROVED_AT };
    const preview = { mode: 'preview', school: { id: SCHOOL_ID, name: SCHOOL_NAME },
      current: before.school, targetStoredUtc: target,
      displayedInPhilippines: { submittedAt: DISPLAY_SUBMITTED_AT, approvedAt: DISPLAY_APPROVED_AT },
      preservedUpdatedAt: before.school.updatedAt, confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;

    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) return { mode: 'cancelled' };
    connection.release();
    connection = null;
    checkEndpoint();
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = await snapshot();
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    await connection.execute('SELECT id FROM schools WHERE id=? FOR UPDATE', [SCHOOL_ID]);
    const current = await readCurrent(connection);
    check(JSON.stringify(current) === JSON.stringify(before),
      'School or admin dates changed after preview.');
    const [updated] = await connection.execute(
      `UPDATE schools SET created_at=?, submitted_at=?, approved_at=?, updated_at=updated_at
       WHERE id=? AND name=? AND registration_status='active'`,
      [UTC_SUBMITTED_AT, UTC_SUBMITTED_AT, UTC_APPROVED_AT, SCHOOL_ID, SCHOOL_NAME]
    );
    check(updated.affectedRows === 1, 'Expected to update exactly one school.');
    const after = await readCurrent(connection);
    check(after.school.createdAt === target.createdAt &&
      after.school.submittedAt === target.submittedAt &&
      after.school.approvedAt === target.approvedAt &&
      after.school.updatedAt === before.school.updatedAt &&
      JSON.stringify(after.admin) === JSON.stringify(before.admin),
    'Date correction verification failed.');
    await connection.commit();
    inTransaction = false;
    const result = { mode: 'complete', schoolId: SCHOOL_ID, targetStoredUtc: target,
      displayedInPhilippines: preview.displayedInPhilippines, snapshotId, verified: true };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (inTransaction) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
    if (!database) await db.end();
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  check(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  check(new Date().getTimezoneOffset() === 0,
    'Run this script on the UTC-configured EC2 server.');
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}

if (require.main === module) main().catch(error => {
  console.error('Registration timezone correction stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { run, UTC_SUBMITTED_AT, UTC_APPROVED_AT, CONFIRMATION };
