'use strict';

const { createInterface } = require('node:readline/promises');
const { issueStudentQrCredential } = require('../config/qrCredentials');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const ADDED_AT = '2026-11-18 10:17:00';
const CONFIRMATION = 'ADD 30 MOCK STUDENTS TO ST JOHN FOR SCHOOL 7';
const NAMES = [
  ['Ana Sofia', 'Abrenica', 'female'],
  ['Marco Luis', 'Aguirre', 'male'],
  ['Bea Nicole', 'Alcantara', 'female'],
  ['Julian Rafael', 'Alvarado', 'male'],
  ['Camila Therese', 'Arce', 'female'],
  ['Luis Miguel', 'Balagtas', 'male'],
  ['Marielle Grace', 'Balmores', 'female'],
  ['Paolo Andres', 'Bautista', 'male'],
  ['Denise Camille', 'Beltran', 'female'],
  ['Gabriel Jose', 'Bumanglag', 'male'],
  ['Isabella Mae', 'Cabral', 'female'],
  ['Rafael Mateo', 'Calderon', 'male'],
  ['Trisha Anne', 'Carpio', 'female'],
  ['Enrique Paolo', 'Cayabyab', 'male'],
  ['Mikaela Rose', 'Cortez', 'female'],
  ['Nathaniel John', 'De Vera', 'male'],
  ['Althea Marie', 'Dizon', 'female'],
  ['Joaquin Luis', 'Escueta', 'male'],
  ['Patricia Isabel', 'Fajardo', 'female'],
  ['Adrian Miguel', 'Galang', 'male'],
  ['Francesca Joy', 'Ilagan', 'female'],
  ['Sebastian Carlo', 'Lazaro', 'male'],
  ['Andrea Louise', 'Lising', 'female'],
  ['Daniel Gabriel', 'Magsino', 'male'],
  ['Clarisse Angela', 'Navarro', 'female'],
  ['Emmanuel Francis', 'Ocampo', 'male'],
  ['Bianca Lorraine', 'Pascual', 'female'],
  ['Carlos Joaquin', 'Quinto', 'male'],
  ['Samantha Elise', 'Rivera', 'female'],
  ['Miguel Antonio', 'Villanueva', 'male']
];
const BARANGAYS = ['Poblacion', 'Maniboc', 'Baay', 'Basing', 'Libsong East',
  'Libsong West', 'Pangapisan North', 'Quibaol', 'Tonton', 'Estanza',
  'Domalandan East', 'Capandanan', 'Wawa', 'Rosario', 'Sabangan'];
const OTHER_BIRTHPLACES = [
  ['Dagupan City', 'Pangasinan', 'Ilocos Region'],
  ['Urdaneta City', 'Pangasinan', 'Ilocos Region'],
  ['Manila', 'Metro Manila', 'NCR'],
  ['San Carlos City', 'Pangasinan', 'Ilocos Region'],
  ['Alaminos City', 'Pangasinan', 'Ilocos Region'],
  ['Baguio City', 'Benguet', 'CAR']
];

function check(value, message) { if (!value) throw new Error(message); }

function makeStudents() {
  const students = NAMES.map(([first, last, sex], index) => {
    const birthplace = index < 24
      ? ['Lingayen', 'Pangasinan', 'Ilocos Region']
      : OTHER_BIRTHPLACES[index - 24];
    const birthDate = `${index % 2 ? 2014 : 2013}-${String(index % 10 + 1).padStart(2, '0')}-${String(index % 20 + 4).padStart(2, '0')}`;
    return {
      first, last, sex, name: `${first} ${last}`, birthDate,
      birthPlace: birthplace[0], birthProvince: birthplace[1], birthRegion: birthplace[2],
      barangay: BARANGAYS[index % BARANGAYS.length], houseStreet: `Purok ${index % 5 + 1}`,
      motherTongue: index % 5 === 0 ? 'Ilocano' : 'Pangasinan',
      religion: index === 25 ? 'Islam' : index % 7 === 0 ? 'Born Again Christian'
        : index % 6 === 0 ? 'Christian' : 'Roman Catholic',
      personalEmail: `${last[0].toLowerCase()}.${first.split(' ')[0].toLowerCase()}.${String(index + 1).padStart(2, '0')}@scc-demo.test`,
      lrn: `9994${String(index + 1).padStart(8, '0')}`
    };
  });
  check(students.length === 30 && new Set(students.map(s => s.name.toLowerCase())).size === 30,
    'Mock names must be unique.');
  check(new Set(students.map(s => s.personalEmail)).size === 30 &&
    new Set(students.map(s => s.lrn)).size === 30, 'Mock identifiers must be unique.');
  for (const student of students) {
    const age = 2026 - Number(student.birthDate.slice(0, 4)) -
      (student.birthDate.slice(5) > '11-18' ? 1 : 0);
    check(age >= 12 && age <= 13 && /^\d{12}$/.test(student.lrn),
      `Invalid age or LRN for ${student.name}.`);
  }
  return students;
}

async function readScope(connection, students) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    'SELECT school_email_domain AS domain FROM schools WHERE id=? AND name=? AND registration_status=?',
    [SCHOOL_ID, "Saint Columban's College", 'active']);
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
  check(sections.length === 1 && Number(sections[0].enrolled) === 10 &&
    Number(sections[0].capacity) >= 40,
  'Expected exactly 10 enrolled students and at least 40 seats in Grade 7 St. John.');
  const [originals] = await connection.execute(
    `SELECT u.id, u.password_hash AS passwordHash, p.lrn
     FROM section_students e
     JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id
     JOIN student_profiles p ON p.user_id=u.id
     WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
       AND u.role='student' AND u.account_status='active'
       AND p.lrn BETWEEN '999500000001' AND '999500000010'
     ORDER BY p.lrn`, [SCHOOL_ID, sections[0].id]);
  check(originals.length === 10 && originals.every((row, index) =>
    row.lrn === `9995${String(index + 1).padStart(8, '0')}` &&
    row.passwordHash && row.passwordHash === originals[0].passwordHash),
  'The original ten students or their shared password changed.');
  const [users] = await connection.query(
    'SELECT school_id AS schoolId, display_name AS name, school_email AS schoolEmail, personal_email AS personalEmail FROM users');
  const names = new Set(users.filter(u => Number(u.schoolId) === SCHOOL_ID)
    .map(u => u.name.toLowerCase()));
  const schoolEmails = new Set(users.map(u => u.schoolEmail.toLowerCase()));
  const personalEmails = new Set(users.map(u => String(u.personalEmail || '').toLowerCase()));
  const domain = storedSchoolDomain({ schoolEmailDomain: schools[0].domain });
  for (const student of students) {
    check(!names.has(student.name.toLowerCase()), `Name already exists: ${student.name}.`);
    check(!personalEmails.has(student.personalEmail),
      `Personal email already exists: ${student.personalEmail}.`);
    names.add(student.name.toLowerCase());
    personalEmails.add(student.personalEmail);
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
    "SELECT lrn FROM student_profiles WHERE lrn BETWEEN '999400000001' AND '999400000030'", []);
  check(lrns.length === 0, 'One or more new mock LRNs already exist.');
  return { yearId: years[0].id, sectionId: sections[0].id, domain,
    originalIds: originals.map(row => Number(row.id)), passwordHash: originals[0].passwordHash };
}

async function verify(connection, sectionId, ids, students, originalIds) {
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
  check(rows.length === 30, 'Expected 30 complete new accounts, profiles, enrollments and QR records.');
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
  const [enrolled] = await connection.execute(
    'SELECT student_user_id AS id FROM section_students WHERE school_id=? AND section_id=? AND withdrawn_at IS NULL',
    [SCHOOL_ID, sectionId]);
  check(enrolled.length === 40 && originalIds.every(id =>
    enrolled.some(row => Number(row.id) === id)),
  'St. John must have 40 students, including the original ten.');
}

async function run({ apply = false, confirm, database, issueQr = issueStudentQrCredential,
  snapshot = takeSnapshot } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    const students = makeStudents();
    connection = await db.getConnection();
    const scope = await readScope(connection, students);
    console.table(students.map(({ name, personalEmail, schoolEmail, lrn, sex,
      birthDate, birthPlace, barangay, motherTongue, religion }) => ({
      name, personalEmail, schoolEmail, lrn, sex, birthDate, birthPlace,
      home: `${barangay}, Lingayen`, motherTongue, religion
    })));
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', currentStudents: 10, studentsToAdd: 30,
      finalStudents: 40, dateAdded: ADDED_AT, emailNotifications: 0,
      confirmationPhrase: CONFIRMATION }, null, 2));
    if (!apply) return { mode: 'preview', students };
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing was added.'); return; }
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
    const checked = makeStudents();
    const current = await readScope(connection, checked);
    check(current.yearId === scope.yearId && current.sectionId === scope.sectionId &&
      current.domain === scope.domain && current.passwordHash === scope.passwordHash &&
      JSON.stringify(current.originalIds) === JSON.stringify(scope.originalIds) &&
      checked.every((student, index) => student.schoolEmail === students[index].schoolEmail),
    'School or account scope changed after preview.');
    const ids = [];
    for (const student of students) {
      const [created] = await connection.execute(
        `INSERT INTO users (school_id,role,school_email,personal_email,password_hash,
           account_status,first_name,last_name,display_name,initials,setup_completed_at,
           created_at,updated_at)
         VALUES (?,'student',?,?,?,'active',?,?,?,?,?,?,?)`,
        [SCHOOL_ID, student.schoolEmail, student.personalEmail, scope.passwordHash,
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
    await verify(connection, scope.sectionId, ids, students, scope.originalIds);
    await connection.commit();
    started = false;
    console.log(JSON.stringify({ result: 'complete', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', studentsCreated: ids.length, finalStudents: 40,
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
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
  check(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  check(process.env.QR_ENCRYPTION_KEY || process.env.SESSION_SECRET,
    'QR encryption secret is missing.');
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}

if (require.main === module) main().catch(error => {
  console.error('St. John mock student creation stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { makeStudents, readScope, verify, run, ADDED_AT, CONFIRMATION };
