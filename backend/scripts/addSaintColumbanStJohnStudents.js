'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createInterface } = require('node:readline/promises');
const bcrypt = require('bcrypt');
const { issueStudentQrCredential } = require('../config/qrCredentials');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const ADDED_AT = '2026-11-18 10:17:00';
const CONFIRMATION = 'ADD 10 ST JOHN STUDENTS FOR SCHOOL 7';

// Synthetic profile details, in the same row order as the private input CSV.
const PROFILES = [
  ['male', '2013-04-10', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Poblacion', 'Pangasinan', 'Roman Catholic'],
  ['male', '2013-09-26', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Maniboc', 'Ilocano', 'Christian'],
  ['male', '2014-02-14', 'Dagupan City', 'Pangasinan', 'Ilocos Region', 'Baay', 'Pangasinan', 'Roman Catholic'],
  ['male', '2013-12-03', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Basing', 'Filipino', 'Born Again Christian'],
  ['female', '2014-05-21', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Libsong East', 'Pangasinan', 'Roman Catholic'],
  ['female', '2013-07-18', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Libsong West', 'Ilocano', 'Roman Catholic'],
  ['female', '2014-08-04', 'Manila', 'Metro Manila', 'NCR', 'Pangapisan North', 'Filipino', 'Christian'],
  ['male', '2013-01-29', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Quibaol', 'Pangasinan', 'Roman Catholic'],
  ['female', '2014-10-11', 'Urdaneta City', 'Pangasinan', 'Ilocos Region', 'Tonton', 'Ilocano', 'Roman Catholic'],
  ['male', '2013-11-02', 'Lingayen', 'Pangasinan', 'Ilocos Region', 'Estanza', 'Pangasinan', 'Born Again Christian']
];

function check(value, message) { if (!value) throw new Error(message); }

function parseInput(csv) {
  const lines = String(csv).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  check(lines.shift() === 'firstName,lastName,personalEmail',
    'CSV header must be firstName,lastName,personalEmail.');
  check(lines.length === 10, `Expected 10 student rows; found ${lines.length}.`);
  return lines.map((line, index) => {
    const cells = line.split(',').map(value => value.trim());
    check(cells.length === 3 && cells.every(Boolean), `Invalid CSV row ${index + 2}.`);
    check(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(cells[2]),
      `Invalid personal email on row ${index + 2}.`);
    return cells;
  });
}

function makeStudents(rows) {
  check(Array.isArray(rows) && rows.length === 10, 'Expected exactly 10 student rows.');
  const students = rows.map((row, index) => {
    const [first, last, personalEmail] = row;
    const [sex, birthDate, birthPlace, birthProvince, birthRegion,
      barangay, motherTongue, religion] = PROFILES[index];
    return { first, last, name: `${first} ${last}`, personalEmail, sex, birthDate,
      birthPlace, birthProvince, birthRegion, barangay, motherTongue, religion,
      houseStreet: `Purok ${index % 5 + 1}`, lrn: `9995${String(index + 1).padStart(8, '0')}` };
  });
  check(students.length === 10 && new Set(students.map(s => s.name.toLowerCase())).size === 10 &&
    new Set(students.map(s => s.personalEmail.toLowerCase())).size === 10 &&
    new Set(students.map(s => s.lrn)).size === 10, 'Student source data has duplicates.');
  check(students.filter(s => s.birthPlace === 'Lingayen').length === 7,
    'Expected seven Lingayen birthplaces.');
  for (const student of students) {
    const age = 2026 - Number(student.birthDate.slice(0, 4)) -
      (student.birthDate.slice(5) > '11-18' ? 1 : 0);
    check(age >= 12 && age <= 13, `Invalid Grade 7 age: ${student.name}.`);
    check(/^\d{12}$/.test(student.lrn), `Invalid demo LRN: ${student.name}.`);
  }
  return students;
}

async function readScope(connection, students) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    'SELECT school_email_domain AS domain FROM schools WHERE id=? AND name=? AND registration_status=?',
    [SCHOOL_ID, SCHOOL_NAME, 'active']);
  check(schools.length === 1, 'Expected active Saint Columban school ID 7.');
  const [years] = await connection.execute(
    "SELECT id FROM academic_years WHERE school_id=? AND label='2026-2027' AND status='active'",
    [SCHOOL_ID]);
  check(years.length === 1, 'Expected one active 2026-2027 school year.');
  const [sections] = await connection.execute(
    `SELECT s.id, s.capacity, COUNT(e.id) AS enrolled
     FROM sections s JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
     JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
     LEFT JOIN section_students e ON e.section_id=s.id AND e.school_id=s.school_id
       AND e.withdrawn_at IS NULL
     WHERE s.school_id=? AND s.academic_year_id=? AND s.name='St. John'
       AND s.status='active' AND l.level_code='jhs' AND g.grade_code='grade-7'
     GROUP BY s.id, s.capacity`, [SCHOOL_ID, years[0].id]);
  check(sections.length === 1 && Number(sections[0].enrolled) === 0 &&
    Number(sections[0].capacity) >= 10,
  'Expected one empty Grade 7 St. John section with at least 10 seats.');
  const [users] = await connection.query(
    'SELECT school_id AS schoolId, display_name AS name, school_email AS schoolEmail, personal_email AS personalEmail FROM users');
  const names = new Set(users.filter(u => Number(u.schoolId) === SCHOOL_ID)
    .map(u => u.name.toLowerCase()));
  const schoolEmails = new Set(users.map(u => u.schoolEmail.toLowerCase()));
  const personalEmails = new Set(users.map(u => String(u.personalEmail || '').toLowerCase()));
  const domain = storedSchoolDomain({ schoolEmailDomain: schools[0].domain });
  for (const student of students) {
    check(!names.has(student.name.toLowerCase()), `Name already exists: ${student.name}.`);
    check(!personalEmails.has(student.personalEmail.toLowerCase()),
      `Personal email already exists: ${student.personalEmail}.`);
    names.add(student.name.toLowerCase());
    personalEmails.add(student.personalEmail.toLowerCase());
    const base = schoolEmailBase(student.first, student.last, 'student');
    let suffix = 1;
    let schoolEmail = schoolEmailCandidate(base, domain, suffix);
    while (schoolEmails.has(schoolEmail)) {
      check(++suffix <= 100, `No school email available for ${student.name}.`);
      schoolEmail = schoolEmailCandidate(base, domain, suffix);
    }
    schoolEmails.add(schoolEmail);
    student.schoolEmail = schoolEmail;
  }
  const [lrns] = await connection.execute(
    "SELECT lrn FROM student_profiles WHERE lrn BETWEEN '999500000001' AND '999500000010'", []);
  check(lrns.length === 0, 'One or more demo LRNs already exist.');
  return { yearId: years[0].id, sectionId: sections[0].id, domain };
}

async function verify(connection, sectionId, ids, students) {
  const [rows] = await connection.execute(
    `SELECT u.id, u.display_name AS name, u.school_email AS schoolEmail,
       u.personal_email AS personalEmail, u.role, u.account_status AS status,
       DATE_FORMAT(u.created_at,'%Y-%m-%d %H:%i:%s') AS added,
       DATE_FORMAT(u.setup_completed_at,'%Y-%m-%d %H:%i:%s') AS setupAt,
       p.lrn, p.sex, DATE_FORMAT(p.birth_date,'%Y-%m-%d') AS birthDate,
       p.birth_place AS birthPlace, p.birth_place_province AS birthProvince,
       p.birth_place_region AS birthRegion, p.birth_country AS birthCountry,
       p.mother_tongue AS motherTongue, p.religion, p.house_street AS houseStreet,
       p.barangay, p.city_municipality AS city, p.province,
       DATE_FORMAT(p.created_at,'%Y-%m-%d %H:%i:%s') AS profileAdded,
       e.section_id AS sectionId, DATE_FORMAT(e.enrolled_at,'%Y-%m-%d %H:%i:%s') AS enrolledAt,
       q.credential_status AS qrStatus, DATE_FORMAT(q.issued_at,'%Y-%m-%d %H:%i:%s') AS qrIssuedAt
     FROM users u JOIN student_profiles p ON p.user_id=u.id
     JOIN section_students e ON e.student_user_id=u.id AND e.school_id=u.school_id
       AND e.withdrawn_at IS NULL
     JOIN student_qr_credentials q ON q.student_user_id=u.id AND q.school_id=u.school_id
     WHERE u.school_id=? AND u.id IN (${ids.map(() => '?').join(',')})`,
    [SCHOOL_ID, ...ids]);
  check(rows.length === 10, 'Expected 10 complete account, profile, enrollment and QR records.');
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  for (const [index, id] of ids.entries()) {
    const row = byId.get(Number(id));
    const student = students[index];
    check(row && row.name === student.name && row.schoolEmail === student.schoolEmail &&
      row.personalEmail === student.personalEmail && row.role === 'student' && row.status === 'active' &&
      row.added === ADDED_AT && row.setupAt === ADDED_AT && row.profileAdded === ADDED_AT &&
      row.enrolledAt === ADDED_AT && row.qrIssuedAt === ADDED_AT && row.qrStatus === 'active' &&
      row.lrn === student.lrn && row.sex === student.sex && row.birthDate === student.birthDate &&
      row.birthPlace === student.birthPlace && row.birthProvince === student.birthProvince &&
      row.birthRegion === student.birthRegion && row.birthCountry === 'Philippines' &&
      row.motherTongue === student.motherTongue && row.religion === student.religion &&
      row.houseStreet === student.houseStreet && row.barangay === student.barangay &&
      row.city === 'Lingayen' && row.province === 'Pangasinan' &&
      Number(row.sectionId) === Number(sectionId),
    `Verification failed for ${student.name}.`);
  }
  const [[enrollment]] = await connection.execute(
    'SELECT COUNT(*) AS n FROM section_students WHERE school_id=? AND section_id=? AND withdrawn_at IS NULL',
    [SCHOOL_ID, sectionId]);
  check(Number(enrollment.n) === 10, 'St. John enrollment count is not 10.');
}

async function run({ rows, apply = false, password, confirm, database, hashPassword = value => bcrypt.hash(value, 12),
  issueQr = issueStudentQrCredential, snapshot = takeSnapshot } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    const students = makeStudents(rows);
    connection = await db.getConnection();
    const scope = await readScope(connection, students);
    console.table(students.map(({ name, personalEmail, schoolEmail, lrn, sex,
      birthDate, birthPlace, barangay, motherTongue, religion }) => ({
      name, personalEmail, schoolEmail, lrn, sex, birthDate, birthPlace,
      home: `${barangay}, Lingayen`, motherTongue, religion
    })));
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', students: students.length, dateAdded: ADDED_AT,
      emailNotifications: 0, confirmationPhrase: CONFIRMATION }, null, 2));
    if (!apply) return { mode: 'preview', students };
    check(typeof password === 'string' && password.length >= 12 && password.length <= 128,
      'STC_JOHN_PASSWORD must contain 12 to 128 characters.');
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing was added.'); return; }
    const hash = await hashPassword(password);
    connection.release();
    connection = null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    connection = await db.getConnection();
    await connection.beginTransaction();
    started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id=? AND school_id=? FOR UPDATE',
      [scope.yearId, SCHOOL_ID]);
    await connection.execute('SELECT id FROM sections WHERE id=? AND school_id=? FOR UPDATE',
      [scope.sectionId, SCHOOL_ID]);
    const checked = makeStudents(rows);
    const current = await readScope(connection, checked);
    check(current.yearId === scope.yearId && current.sectionId === scope.sectionId &&
      current.domain === scope.domain && checked.every((student, index) =>
        student.schoolEmail === students[index].schoolEmail),
    'School or account scope changed after preview.');
    const ids = [];
    for (const student of students) {
      const [created] = await connection.execute(
        `INSERT INTO users (school_id,role,school_email,personal_email,password_hash,
           account_status,first_name,last_name,display_name,initials,setup_completed_at,
           created_at,updated_at)
         VALUES (?,'student',?,?,?,'active',?,?,?,?,?,?,?)`,
        [SCHOOL_ID, student.schoolEmail, student.personalEmail, hash,
          student.first, student.last, student.name,
          `${student.first[0]}${student.last[0]}`.toUpperCase(), ADDED_AT, ADDED_AT, ADDED_AT]);
      const id = created.insertId;
      ids.push(id);
      await connection.execute(
        `INSERT INTO student_profiles (user_id,lrn,sex,birth_date,birth_place_province,
           birth_place,birth_place_region,birth_country,mother_tongue,religion,
           house_street,barangay,city_municipality,province,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'Philippines',?,?,?,?,'Lingayen','Pangasinan',?,?)`,
        [id, student.lrn, student.sex, student.birthDate, student.birthProvince,
          student.birthPlace, student.birthRegion, student.motherTongue,
          student.religion, student.houseStreet, student.barangay, ADDED_AT, ADDED_AT]);
      await issueQr(connection, SCHOOL_ID, id);
      await connection.execute(
        `UPDATE student_qr_credentials SET issued_at=?,created_at=?,updated_at=?
         WHERE school_id=? AND student_user_id=?`,
        [ADDED_AT, ADDED_AT, ADDED_AT, SCHOOL_ID, id]);
      await connection.execute(
        `INSERT INTO section_students (school_id,section_id,student_user_id,enrolled_at,created_at)
         VALUES (?,?,?,?,?)`, [SCHOOL_ID, scope.sectionId, id, ADDED_AT, ADDED_AT]);
    }
    await verify(connection, scope.sectionId, ids, students);
    await connection.commit();
    started = false;
    console.log(JSON.stringify({ result: 'complete', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', studentsCreated: ids.length,
      dateAdded: ADDED_AT, emailsSent: 0, verified: true, snapshotId }, null, 2));
    return { result: 'complete', ids };
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
  check(process.env.QR_ENCRYPTION_KEY || process.env.SESSION_SECRET,
    'QR encryption secret is missing.');
  const args = process.argv.slice(2);
  check(args.length === 3 && ['--preview', '--apply'].includes(args[0]) &&
    args[1] === '--file' && args[2],
  'Use --preview|--apply --file /path/to/private-students.csv.');
  const rows = parseInput(fs.readFileSync(args[2], 'utf8'));
  await run({ rows, apply: args[0] === '--apply', password: process.env.STC_JOHN_PASSWORD });
}

if (require.main === module) main().catch(error => {
  console.error('St. John account creation stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { parseInput, makeStudents, readScope, verify, run, ADDED_AT, CONFIRMATION };
