'use strict';

const path = require('node:path');
const { createInterface } = require('node:readline/promises');
const bcrypt = require('bcrypt');
const { issueStudentQrCredential } = require('../config/qrCredentials');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');

const DATABASE_NAME = 'academix';
const SCHOOL_NAME = "Saint Columban's College";
const CONFIRMATION_PHRASE = "CREATE 15 TEST ACCOUNTS FOR SAINT COLUMBAN'S COLLEGE";
const TEST_ACCOUNTS = [
  ['student', 'Miguel', 'Santos'],
  ['student', 'Bianca', 'Reyes'],
  ['student', 'Joaquin', 'Dela Cruz'],
  ['student', 'Alyssa', 'Bautista'],
  ['student', 'Gabriel', 'Mendoza'],
  ['student', 'Sofia', 'Villanueva'],
  ['student', 'Nathaniel', 'Castillo'],
  ['student', 'Patricia', 'Flores'],
  ['student', 'Lorenzo', 'Ramos'],
  ['student', 'Andrea', 'Navarro'],
  ['teacher', 'Maria', 'Aquino'],
  ['teacher', 'Rafael', 'Lim'],
  ['teacher', 'Elena', 'Manalo'],
  ['teacher', 'Daniel', 'Fernandez'],
  ['teacher', 'Lourdes', 'Garcia']
].map(([role, firstName, lastName], index) => {
  const roleIndex = role === 'student' ? index + 1 : index - 9;
  const number = String(roleIndex).padStart(2, '0');
  return {
    role,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    personalEmail: `stc-test-${role}-${number}@example.test`,
    ...(role === 'student'
      ? { lrn: `9998${String(roleIndex).padStart(8, '0')}` }
      : { employeeNo: `STC-TEST-T-${String(roleIndex).padStart(3, '0')}` })
  };
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(args) {
  const valid = new Set(['--preview', '--apply', '--help']);
  assert(args.every(argument => valid.has(argument)), `Unknown option: ${args.find(argument => !valid.has(argument))}`);
  assert(!(args.includes('--preview') && args.includes('--apply')), 'Choose either --preview or --apply.');
  if (args.includes('--help')) return { help: true };
  return { apply: args.includes('--apply') };
}

function validatePassword(password) {
  assert(typeof password === 'string' && password.length >= 12 && password.length <= 128,
    'STC_TEST_PASSWORD must contain 12 to 128 characters.');
  return password;
}

function makeSchoolEmail(account, domain, usedEmails) {
  const base = schoolEmailBase(account.firstName, account.lastName, account.role);
  let number = 1;
  let candidate = schoolEmailCandidate(base, domain, number);
  while (usedEmails.has(candidate.toLowerCase())) {
    number += 1;
    candidate = schoolEmailCandidate(base, domain, number);
  }
  usedEmails.add(candidate.toLowerCase());
  return candidate;
}

function assertStaticAccountList() {
  const fullNames = new Set();
  const personalEmails = new Set();
  const identifiers = new Set();
  for (const account of TEST_ACCOUNTS) {
    const fullName = account.displayName.toLowerCase();
    assert(!fullNames.has(fullName), `Duplicate test account name: ${account.displayName}.`);
    fullNames.add(fullName);
    assert(!personalEmails.has(account.personalEmail), `Duplicate test email: ${account.personalEmail}.`);
    personalEmails.add(account.personalEmail);
    const identifier = account.role === 'student' ? account.lrn : account.employeeNo;
    assert(!identifiers.has(identifier), `Duplicate test identifier: ${identifier}.`);
    identifiers.add(identifier);
    if (account.role === 'student') assert(/^\d{12}$/.test(account.lrn), 'Student LRNs must contain 12 digits.');
  }
  assert(TEST_ACCOUNTS.filter(account => account.role === 'student').length === 10,
    'The test account list must contain exactly 10 students.');
  assert(TEST_ACCOUNTS.filter(account => account.role === 'teacher').length === 5,
    'The test account list must contain exactly 5 teachers.');
}

async function readSchool(connection, lock = false) {
  const [schools] = await connection.execute(
    `SELECT id, name, school_email_domain AS schoolEmailDomain, registration_status AS registrationStatus
     FROM schools WHERE name = ? AND registration_status = 'active' ORDER BY id LIMIT 2${lock ? ' FOR UPDATE' : ''}`,
    [SCHOOL_NAME]
  );
  assert(schools.length === 1,
    `Expected one active school named ${SCHOOL_NAME}; found ${schools.length}. No accounts were created.`);
  storedSchoolDomain(schools[0]);
  return schools[0];
}

async function buildPlan(connection, options = {}) {
  const school = await readSchool(connection, options.lockSchool);
  const [existingUsers] = await connection.query(
    'SELECT school_email AS schoolEmail, personal_email AS personalEmail FROM users'
  );
  const usedSchoolEmails = new Set(existingUsers.map(row => String(row.schoolEmail || '').toLowerCase()));
  const existingPersonalEmails = new Set(existingUsers.map(row => String(row.personalEmail || '').toLowerCase()));
  const accounts = TEST_ACCOUNTS.map(account => ({
    ...account,
    schoolEmail: makeSchoolEmail(account, storedSchoolDomain(school), usedSchoolEmails)
  }));

  const duplicatePersonalEmails = accounts
    .filter(account => existingPersonalEmails.has(account.personalEmail.toLowerCase()))
    .map(account => account.personalEmail);
  assert(duplicatePersonalEmails.length === 0,
    `Test accounts already exist: ${duplicatePersonalEmails.join(', ')}. No accounts were created.`);

  const studentAccounts = accounts.filter(account => account.role === 'student');
  const lrnPlaceholders = studentAccounts.map(() => '?').join(', ');
  const [existingLrns] = await connection.execute(
    `SELECT lrn FROM student_profiles WHERE lrn IN (${lrnPlaceholders})`,
    studentAccounts.map(account => account.lrn)
  );
  assert(existingLrns.length === 0,
    `One or more synthetic test LRNs already exist: ${existingLrns.map(row => row.lrn).join(', ')}. No accounts were created.`);

  const teacherAccounts = accounts.filter(account => account.role === 'teacher');
  const employeePlaceholders = teacherAccounts.map(() => '?').join(', ');
  const [existingEmployeeNumbers] = await connection.execute(
    `SELECT profiles.employee_number AS employeeNo FROM teacher_profiles AS profiles
       INNER JOIN users ON users.id = profiles.user_id
       WHERE users.school_id = ? AND profiles.employee_number IN (${employeePlaceholders})
     UNION
     SELECT profiles.employee_number AS employeeNo FROM school_admin_profiles AS profiles
       INNER JOIN users ON users.id = profiles.user_id
       WHERE users.school_id = ? AND profiles.employee_number IN (${employeePlaceholders})`,
    [school.id, ...teacherAccounts.map(account => account.employeeNo),
      school.id, ...teacherAccounts.map(account => account.employeeNo)]
  );
  assert(existingEmployeeNumbers.length === 0,
    `One or more synthetic employee numbers already exist: ${existingEmployeeNumbers.map(row => row.employeeNo).join(', ')}. No accounts were created.`);

  return {
    school: { id: Number(school.id), name: school.name, schoolEmailDomain: storedSchoolDomain(school) },
    totalAccounts: accounts.length,
    accountCounts: { students: studentAccounts.length, teachers: teacherAccounts.length },
    recordsToCreate: {
      users: accounts.length,
      student_profiles: studentAccounts.length,
      student_qr_credentials: studentAccounts.length,
      teacher_profiles: teacherAccounts.length
    },
    accounts: accounts.map(account => ({
      role: account.role,
      name: account.displayName,
      schoolEmail: account.schoolEmail,
      personalEmail: account.personalEmail,
      ...(account.lrn ? { lrn: account.lrn } : { employeeNo: account.employeeNo })
    }))
  };
}

function planFingerprint(plan) {
  return JSON.stringify(plan);
}

async function confirm(phrase) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(`Type ${phrase} to continue: `)).trim() === phrase;
  } finally {
    prompt.close();
  }
}

async function readForeignKeyChecks(connection) {
  const [[row]] = await connection.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
  return Number(row.enabled);
}

async function verifyCreatedAccounts(connection, schoolId, accounts, studentIds, teacherIds) {
  const userIds = accounts.map(account => account.id);
  const userPlaceholders = userIds.map(() => '?').join(', ');
  const [[users]] = await connection.execute(
    `SELECT COUNT(*) AS rowCount FROM users
     WHERE school_id = ? AND id IN (${userPlaceholders}) AND account_status = 'active' AND setup_completed_at IS NOT NULL`,
    [schoolId, ...userIds]
  );
  assert(Number(users.rowCount) === TEST_ACCOUNTS.length, 'Verification failed for test user accounts.');

  const [[students]] = await connection.execute(
    `SELECT COUNT(*) AS rowCount FROM student_profiles WHERE user_id IN (${studentIds.map(() => '?').join(', ')})`,
    studentIds
  );
  assert(Number(students.rowCount) === 10, 'Verification failed for student profiles.');

  const [[qrCredentials]] = await connection.execute(
    `SELECT COUNT(*) AS rowCount FROM student_qr_credentials
     WHERE school_id = ? AND student_user_id IN (${studentIds.map(() => '?').join(', ')}) AND credential_status = 'active'`,
    [schoolId, ...studentIds]
  );
  assert(Number(qrCredentials.rowCount) === 10, 'Verification failed for student QR credentials.');

  const [[teachers]] = await connection.execute(
    `SELECT COUNT(*) AS rowCount FROM teacher_profiles WHERE user_id IN (${teacherIds.map(() => '?').join(', ')})`,
    teacherIds
  );
  assert(Number(teachers.rowCount) === 5, 'Verification failed for teacher profiles.');
}

async function run(options, dependencies = {}) {
  assertStaticAccountList();
  const dbEnv = dependencies.dbEnv || process.env;
  assert(dbEnv.DB_NAME === DATABASE_NAME, `DB_NAME must be ${DATABASE_NAME}.`);

  const password = options.apply ? validatePassword(dbEnv.STC_TEST_PASSWORD) : null;
  if (options.apply) {
    assert(dbEnv.QR_ENCRYPTION_KEY || dbEnv.SESSION_SECRET,
      'QR_ENCRYPTION_KEY or SESSION_SECRET is required to issue student QR credentials.');
  }

  const database = dependencies.database || require('../config/database').getDatabase();
  const hashPassword = dependencies.hashPassword || ((value) => bcrypt.hash(value, 12));
  const issueQr = dependencies.issueStudentQrCredential || issueStudentQrCredential;
  const askForConfirmation = dependencies.confirm || confirm;
  const output = dependencies.log || (value => console.log(JSON.stringify(value, null, 2)));
  let connection;
  let transactionStarted = false;

  try {
    connection = await database.getConnection();
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
    assert(await readForeignKeyChecks(connection) === 1, 'Could not enable foreign-key checks.');
    const preview = await buildPlan(connection);
    output({ mode: options.apply ? 'apply-preflight' : 'preview', database: dbEnv.DB_NAME, ...preview,
      confirmationPhrase: CONFIRMATION_PHRASE });
    if (!options.apply) return { preview };

    assert(await askForConfirmation(CONFIRMATION_PHRASE), 'Confirmation did not match; no accounts were created.');

    await connection.beginTransaction();
    transactionStarted = true;
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
    assert(await readForeignKeyChecks(connection) === 1, 'Foreign-key checks must remain enabled.');
    const currentPlan = await buildPlan(connection, { lockSchool: true });
    assert(planFingerprint(currentPlan) === planFingerprint(preview),
      'The school or account preflight changed after confirmation. No accounts were created; run preview again.');

    const passwordHash = await hashPassword(password);
    const studentIds = [];
    const teacherIds = [];
    const accountRecords = TEST_ACCOUNTS.map(account => ({
      ...account,
      schoolEmail: preview.accounts.find(item => item.personalEmail === account.personalEmail).schoolEmail
    }));

    for (const account of accountRecords) {
      const [result] = await connection.execute(
        `INSERT INTO users (school_id, role, school_email, personal_email, password_hash,
          account_status, first_name, last_name, display_name, initials, setup_completed_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW())`,
        [preview.school.id, account.role, account.schoolEmail, account.personalEmail, passwordHash,
          account.firstName, account.lastName, account.displayName,
          `${account.firstName[0]}${account.lastName[0]}`.toUpperCase()]
      );
      account.id = Number(result.insertId);
      if (account.role === 'student') {
        await connection.execute('INSERT INTO student_profiles (user_id, lrn) VALUES (?, ?)', [account.id, account.lrn]);
        await issueQr(connection, preview.school.id, account.id);
        studentIds.push(account.id);
      } else {
        await connection.execute(
          'INSERT INTO teacher_profiles (user_id, employee_number) VALUES (?, ?)',
          [account.id, account.employeeNo]
        );
        teacherIds.push(account.id);
      }
    }

    await verifyCreatedAccounts(connection, preview.school.id, accountRecords, studentIds, teacherIds);
    assert(await readForeignKeyChecks(connection) === 1, 'Foreign-key checks must remain enabled through verification.');
    await connection.commit();
    transactionStarted = false;

    const result = {
      mode: 'complete',
      school: preview.school,
      totalCreated: accountRecords.length,
      accountCounts: preview.accountCounts,
      recordsCreated: preview.recordsToCreate,
      accounts: accountRecords.map(account => ({
        id: account.id,
        role: account.role,
        name: account.displayName,
        schoolEmail: account.schoolEmail,
        personalEmail: account.personalEmail,
        ...(account.lrn ? { lrn: account.lrn } : { employeeNo: account.employeeNo })
      })),
      foreignKeyChecks: 1,
      verified: true
    };
    output(result);
    return result;
  } catch (error) {
    if (transactionStarted) await connection?.rollback().catch(() => {});
    throw error;
  } finally {
    connection?.release();
  }
}

function printUsage() {
  console.log('Usage: node scripts/seedSaintColumbanTestAccounts.js [--preview | --apply]');
  console.log('Apply requires STC_TEST_PASSWORD and the exact interactive confirmation phrase.');
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printUsage();
  const database = require('../config/database').getDatabase();
  try {
    await run(options, { database, dbEnv: process.env });
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Test account seeding stopped: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION_PHRASE,
  DATABASE_NAME,
  SCHOOL_NAME,
  TEST_ACCOUNTS,
  assertStaticAccountList,
  buildPlan,
  makeSchoolEmail,
  parseArgs,
  run,
  validatePassword
};
