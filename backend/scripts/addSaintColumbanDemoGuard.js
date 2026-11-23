'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const bcrypt = require('bcrypt');
const { storedSchoolDomain, schoolEmailBase, schoolEmailCandidate } = require('../utils/schoolUserEmail');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const ADDED_AT = '2026-11-17 15:56:00';
const PERSONAL_EMAIL = 'b.federico.guard@scc-demo.test';
const EMPLOYEE_NUMBER = 'SCC-DEMO-G-001';
const CONFIRMATION = 'CREATE FEDERICO BLANCO GUARD FOR SCHOOL 7';

function check(condition, message) { if (!condition) throw new Error(message); }

async function readScope(connection) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Expected the academix database with foreign-key checks enabled.');
  const [schools] = await connection.execute(
    'SELECT school_email_domain AS domain FROM schools WHERE id=? AND name=? AND registration_status=?',
    [SCHOOL_ID, SCHOOL_NAME, 'active']);
  check(schools.length === 1, 'Expected active Saint Columban school ID 7.');
  const domain = storedSchoolDomain({ schoolEmailDomain: schools[0].domain });
  check(domain === 'scc.academix.test', `Unexpected school email domain: ${domain}.`);
  const schoolEmail = schoolEmailCandidate(schoolEmailBase('Federico', 'Blanco', 'school_guard'), domain);
  const [duplicates] = await connection.execute(
    `SELECT id FROM users WHERE LOWER(school_email)=? OR LOWER(personal_email)=?
       OR (school_id=? AND LOWER(display_name)=?)`,
    [schoolEmail, PERSONAL_EMAIL, SCHOOL_ID, 'federico blanco']);
  check(duplicates.length === 0, 'Federico Blanco or one of the account emails already exists.');
  const [employeeMatches] = await connection.execute(
    `SELECT u.id FROM users u
       LEFT JOIN school_guard_profiles g ON g.user_id=u.id
       LEFT JOIN teacher_profiles t ON t.user_id=u.id
       LEFT JOIN school_admin_profiles a ON a.user_id=u.id
       WHERE u.school_id=? AND
         (g.employee_number=? OR t.employee_number=? OR a.employee_number=?)`,
    [SCHOOL_ID, EMPLOYEE_NUMBER, EMPLOYEE_NUMBER, EMPLOYEE_NUMBER]);
  check(employeeMatches.length === 0, 'Guard employee number already exists.');
  return { domain, schoolEmail };
}

function checkRdsEndpoint() {
  const output = execFileSync('aws', ['rds', 'describe-db-instances',
    '--db-instance-identifier', 'academix-test-db', '--region', 'ap-southeast-2',
    '--query', 'DBInstances[0].Endpoint.Address', '--output', 'text'],
  { encoding: 'utf8', timeout: 30000 }).trim();
  check(output && output !== 'None' && process.env.DB_HOST === output,
    'DB_HOST does not match the academix-test-db RDS endpoint.');
}

async function verify(connection, id, schoolEmail) {
  const [rows] = await connection.execute(
    `SELECT u.id, u.school_id AS schoolId, u.role, u.account_status AS status,
       u.display_name AS name, u.school_email AS schoolEmail,
       u.personal_email AS personalEmail,
       DATE_FORMAT(u.created_at,'%Y-%m-%d %H:%i:%s') AS dateAdded,
       DATE_FORMAT(u.setup_completed_at,'%Y-%m-%d %H:%i:%s') AS setupAt,
       DATE_FORMAT(p.created_at,'%Y-%m-%d %H:%i:%s') AS profileAdded,
       p.employee_number AS employeeNumber
     FROM users u JOIN school_guard_profiles p ON p.user_id=u.id
     WHERE u.id=?`, [id]);
  check(rows.length === 1 && Number(rows[0].schoolId) === SCHOOL_ID &&
    rows[0].role === 'school_guard' && rows[0].status === 'active' &&
    rows[0].name === 'Federico Blanco' && rows[0].schoolEmail === schoolEmail &&
    rows[0].personalEmail === PERSONAL_EMAIL && rows[0].employeeNumber === EMPLOYEE_NUMBER &&
    rows[0].dateAdded === ADDED_AT && rows[0].setupAt === ADDED_AT &&
    rows[0].profileAdded === ADDED_AT, 'Guard account verification failed.');
}

async function run({ apply = false, password, database, confirm,
  snapshot = takeSnapshot, checkEndpoint = checkRdsEndpoint,
  hashPassword = value => bcrypt.hash(value, 12) } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    connection = await db.getConnection();
    const scope = await readScope(connection);
    const preview = { mode: 'preview', school: { id: SCHOOL_ID, name: SCHOOL_NAME },
      guard: { name: 'Federico Blanco', role: 'school_guard',
        schoolEmail: scope.schoolEmail, personalEmail: PERSONAL_EMAIL,
        employeeNumber: EMPLOYEE_NUMBER, dateAdded: ADDED_AT },
      emailNotifications: 0, confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;
    check(typeof password === 'string' && password.length >= 12 && password.length <= 128,
      'STC_GUARD_PASSWORD must contain 12 to 128 characters.');
    const ask = confirm || (async phrase => {
      const { createInterface } = require('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) {
      console.log('Cancelled. Nothing was added.');
      return { mode: 'cancelled' };
    }
    const hash = await hashPassword(password);
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
    check(current.schoolEmail === scope.schoolEmail, 'School scope changed after preview.');
    const [created] = await connection.execute(
      `INSERT INTO users (school_id,role,school_email,personal_email,password_hash,
         account_status,first_name,last_name,display_name,initials,setup_completed_at,
         created_at,updated_at)
       VALUES (?,'school_guard',?,?,?,'active','Federico','Blanco','Federico Blanco','FB',?,?,?)`,
      [SCHOOL_ID, scope.schoolEmail, PERSONAL_EMAIL, hash, ADDED_AT, ADDED_AT, ADDED_AT]);
    const id = created.insertId;
    await connection.execute(
      `INSERT INTO school_guard_profiles (user_id,employee_number,created_at,updated_at)
       VALUES (?,?,?,?)`, [id, EMPLOYEE_NUMBER, ADDED_AT, ADDED_AT]);
    await connection.execute(
      `INSERT INTO audit_logs (school_id,actor_user_id,action_type,entity_type,entity_id,details)
       VALUES (?,NULL,'demo_guard_seeded','user',?,?)`,
      [SCHOOL_ID, id, JSON.stringify({ summary: 'Synthetic guard account created',
        dateAdded: ADDED_AT, actualExecutionDate: new Date().toISOString(), snapshotId })]);
    await verify(connection, id, scope.schoolEmail);
    await connection.commit();
    started = false;
    const result = { mode: 'complete', schoolId: SCHOOL_ID, guardId: id,
      dateAdded: ADDED_AT, emailsSent: 0, snapshotId, verified: true };
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
  await run({ apply: args[0] === '--apply', password: process.env.STC_GUARD_PASSWORD });
}

if (require.main === module) main().catch(error => {
  console.error('Guard creation stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { run, readScope, verify, ADDED_AT, CONFIRMATION };
