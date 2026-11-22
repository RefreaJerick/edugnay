'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const bcrypt = require('bcrypt');
const { issueStudentQrCredential } = require('../config/qrCredentials');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const DEMO_DATE = '2026-11-17 12:00:00';
const CONFIRMATION = `SEED 165 ACCOUNTS FOR SCHOOL ${SCHOOL_ID}`;
const SECTION_NAMES = [
  ['St. Anne', 'St. Clare', 'St. Francis'],
  ['St. Mary', 'St. Joseph', 'St. Andrew'],
  ['St. Paul', 'St. Matthew', 'St. Mark'],
  ['St. Catherine', 'St. Teresa', 'St. Elizabeth'],
  ['St. Dominic', 'St. Benedict', 'St. Anthony'],
  ['St. John', 'St. Peter', 'St. Luke'],
  ['St. Stephen', 'St. Thomas', 'St. James'],
  ['St. Augustine', 'St. Ignatius', 'St. Vincent'],
  ['St. Gabriel', 'St. Michael', 'St. Raphael']
];
const FIRST_NAMES = ('Miguel Sofia Gabriel Alyssa Joaquin Bianca Nathaniel Patricia Lorenzo Andrea Rafael Maria Daniel Elena Carlo Teresa Paolo Janine Arvin Lourdes Anton Camille Emmanuel Katrina Diego Isabel Marco Angela Luis Francesca Adrian Clarisse Vincent Daniela Tristan Regina Mateo Nicole Andres Beatriz Francis Julia Ramon Mikaela Christian Janelle Jose Carla Elijah Samantha Benjamin Anne Lucas Kristine Aaron').split(' ');
const ORIGINAL_LAST_NAMES = ('Santos|Reyes|Dela Cruz|Bautista|Mendoza|Villanueva|Castillo|Flores|Ramos|Navarro|Aquino|Lim|Manalo|Fernandez|Garcia|Gatdula|Macapagal|Legaspi|Santiago|De Guzman|Cruz|De Leon|Torres|Velasco|Domingo|Mercado|Pineda|Javier|Alvarado|Perez|Rivera|Soriano|Salazar|Palisoc|Padilla|Bernal|Valdez|Abad|Guinto|Rosales|Magno|Dizon|Pascual|Medina|Estrella|Agustin|Ferrer|Salcedo|Capili|Corpuz|Lacuesta|De Vera|Villareal|Malabanan|Cordero').split('|');
const MORE_LAST_NAMES = ('Abella|Alonzo|Angeles|Arce|Arellano|Balagtas|Ballesteros|Barrios|Beltran|Benitez|Bernardo|Borja|Briones|Calara|Calderon|Camacho|Canlas|Carandang|Carino|Casimiro|Chua|Co|Cortez|Cuenca|David|Del Rosario|Dimaculangan|Evangelista|Fajardo|Francisco|Galang|Gonzales|Gutierrez|Hidalgo|Jacinto|Lagman|Laurel|Lazaro|Licup|Mabini|Macaraig|Magallanes|Mangubat|Marasigan|Montemayor|Natividad|Ocampo|Ong|Pangilinan|Panganiban|Paredes|Peralta|Punzalan|Quijano|Ramirez|Recto|Robles|Roxas|Salvador|Sarmiento|Sevilla|Sison|Solis|Suarez|Sy|Tabora|Tan|Tecson|Tolentino|Trinidad|Tuazon|Umali|Uy|Valenzuela|Vergara|Yabut|Yambao|Zaragoza|Aglipay|Alcantara|Baluyot|Basa|Caballero|Cabral|Caguioa|Calma|Carpio|Catacutan|Chavez|Concepcion|Dacumos|De Castro|De Mesa|De Ocampo|Del Mundo|Espiritu|Gatchalian|Hermoso|Juarez|Katigbak|Lacson|Ledesma|Liwanag|Maceda|Magsaysay|Navarrete|Nepomuceno|Quintos|Villamor|Yap').split('|');
const LAST_NAMES = [...ORIGINAL_LAST_NAMES, ...MORE_LAST_NAMES];
const SECOND_MALE = ['Jose', 'Luis', 'Paolo', 'Andres', 'Gabriel', 'Daniel', 'Rafael', 'Mateo'];
const SECOND_FEMALE = ['Marie', 'Grace', 'Mae', 'Therese', 'Camille', 'Isabel', 'Angela', 'Rose'];
const BARANGAYS = ('Poblacion|Maniboc|Baay|Basing|Libsong East|Libsong West|Pangapisan North|Quibaol|Tonton|Estanza|Domalandan East|Capandanan|Wawa|Rosario|Sabangan').split('|');
const RELIGIONS = ['Roman Catholic', 'Roman Catholic', 'Roman Catholic', 'Roman Catholic', 'Born Again Christian', 'Christian', 'Islam'];
const FAMILY_STUDENT_INDEXES = Array.from({ length: 10 }, (_, family) => [family * 12, family * 12 + 15]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function clean(value) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Identify accounts created by the first demo seed so the repair touches only those accounts.
function legacyIdentity(index) {
  const first = FIRST_NAMES[index % 55];
  const last = ORIGINAL_LAST_NAMES[(index + Math.floor(index / 55) * 13) % 55];
  return {
    first, last, name: `${first} ${last}`,
    personalEmail: `${clean(last)[0]}.${clean(first)}.${String(index + 1).padStart(3, '0')}@scc-demo.test`
  };
}

function legacyProfile(index) {
  return {
    middle: ORIGINAL_LAST_NAMES[(index + 17) % 55],
    maiden: index % 55 % 2 ? ORIGINAL_LAST_NAMES[(index + 23) % 55] : null,
    religion: RELIGIONS[index % RELIGIONS.length],
    houseStreet: `Purok ${index % 5 + 1}`,
    barangay: BARANGAYS[index % BARANGAYS.length]
  };
}

function makeData() {
  assert(FIRST_NAMES.length === 55 && ORIGINAL_LAST_NAMES.length === 55 &&
    LAST_NAMES.length === 165 && new Set(LAST_NAMES.map(name => name.toLowerCase())).size === 165,
  'Name lists must contain 165 different surnames.');
  const sections = SECTION_NAMES.flatMap((names, i) => names.map(name => ({ grade: i + 2, name })));
  const accounts = Array.from({ length: 165 }, (_, i) => {
    const originalFirst = FIRST_NAMES[i % 55];
    const sex = i % 55 % 2 ? 'female' : 'male';
    const round = Math.floor(i / 55);
    const secondNames = sex === 'male' ? SECOND_MALE : SECOND_FEMALE;
    let second = secondNames[(i % 55 + round * 3) % secondNames.length];
    if (second === originalFirst) second = secondNames[(i % 55 + round * 3 + 1) % secondNames.length];
    const first = round ? `${originalFirst} ${second}` : originalFirst;
    const last = LAST_NAMES[i];
    const role = i < 135 ? 'student' : i < 155 ? 'teacher' : 'parent';
    const grade = role === 'student' ? 2 + Math.floor(i / 15) : null;
    const section = grade ? SECTION_NAMES[grade - 2][Math.floor(i % 15 / 5)] : null;
    const age = grade ? grade + 5 + i % 2 : null;
    const month = i % 12 + 1;
    const day = i * 7 % 27 + 1;
    const futureBirthday = month > 11 || (month === 11 && day > 17);
    const birthYear = grade ? 2026 - age - (futureBirthday ? 1 : 0) : null;
    return {
      role, grade, section, first, last, name: `${first} ${last}`,
      sex,
      middle: LAST_NAMES[(i + 17) % 165],
      maiden: LAST_NAMES[(i + 23) % 165],
      personalEmail: `${clean(last)[0]}.${clean(first)}.${String(i + 1).padStart(3, '0')}@scc-demo.test`,
      birthDate: grade ? `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
      lrn: role === 'student' ? `9996${String(i + 1).padStart(8, '0')}` : null,
      employeeNo: role === 'teacher' ? `SCC-DEMO-T-${String(i - 134).padStart(3, '0')}` : null,
      barangay: BARANGAYS[i % BARANGAYS.length],
      houseStreet: `Purok ${i % 5 + 1}`,
      religion: RELIGIONS[i % RELIGIONS.length],
      motherTongue: i % 4 ? 'Pangasinan' : 'Ilocano',
      contactNumber: `0900${String(i + 1).padStart(7, '0')}`
    };
  });
  // Keep the existing parent names. Move their replacement names to the
  // students that originally used those first names and surnames.
  for (let index = 155; index < 165; index++) {
    const parent = accounts[index];
    const old = legacyIdentity(index);
    const firstOwner = accounts[index % 55];
    const lastOwner = accounts[ORIGINAL_LAST_NAMES.indexOf(old.last)];
    [parent.first, firstOwner.first] = [firstOwner.first, parent.first];
    [parent.last, lastOwner.last] = [lastOwner.last, parent.last];
  }
  for (const [index, account] of accounts.entries()) {
    account.name = `${account.first} ${account.last}`;
    account.personalEmail = `${clean(account.last)[0]}.${clean(account.first)}.${String(index + 1).padStart(3, '0')}@scc-demo.test`;
  }
  for (const [family, studentIndexes] of FAMILY_STUDENT_INDEXES.entries()) {
    const parent = accounts[155 + family];
    for (const index of studentIndexes) {
      const student = accounts[index];
      student.last = parent.last;
      student.name = `${student.first} ${student.last}`;
      student.personalEmail = `${clean(student.last)[0]}.${clean(student.first)}.${String(index + 1).padStart(3, '0')}@scc-demo.test`;
      student.houseStreet = parent.houseStreet;
      student.barangay = parent.barangay;
      student.religion = parent.religion;
      student.parentIndex = 155 + family;
    }
  }
  assert(sections.length === 27 && new Set(sections.map(s => s.name)).size === 27, 'Invalid sections.');
  assert(new Set(accounts.map(a => a.name.toLowerCase())).size === 165, 'Duplicate full names.');
  assert(new Set(accounts.map(a => a.first.toLowerCase())).size === 165, 'Duplicate first names.');
  assert(new Set(accounts.map(a => a.last.toLowerCase())).size === 145, 'Unexpected surname overlap.');
  assert(FAMILY_STUDENT_INDEXES.flat().length === 20 &&
    new Set(FAMILY_STUDENT_INDEXES.flat()).size === 20, 'Family students overlap.');
  assert(new Set(accounts.map(a => a.personalEmail)).size === 165, 'Duplicate personal emails.');
  for (const section of sections) {
    assert(accounts.filter(a => a.grade === section.grade && a.section === section.name).length === 5,
      `Expected five students in Grade ${section.grade} ${section.name}.`);
  }
  for (const account of accounts.filter(a => a.role === 'student')) {
    const [year, month, day] = account.birthDate.split('-').map(Number);
    const age = 2026 - year - (month > 11 || (month === 11 && day > 17) ? 1 : 0);
    assert(age === account.grade + 5 || age === account.grade + 6, `Invalid age for ${account.name}.`);
  }
  return { sections, accounts };
}

async function preflight(connection, data) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  assert(state.db === 'academix' && Number(state.fk) === 1, 'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    'SELECT id, registration_status AS status, school_email_domain AS domain FROM schools WHERE id=? AND name=?',
    [SCHOOL_ID, SCHOOL_NAME]);
  assert(schools.length === 1 && schools[0].status === 'active', 'Expected active Saint Columban school ID 7.');
  const [years] = await connection.execute(
    "SELECT id FROM academic_years WHERE school_id=? AND label='2026-2027' AND status='active'", [SCHOOL_ID]);
  assert(years.length === 1, 'Expected one active 2026-2027 school year.');
  const [grades] = await connection.execute(
    `SELECT g.id, g.grade_code AS code, l.id AS levelId FROM school_grade_levels g
     JOIN school_levels l ON l.id=g.school_level_id
     WHERE g.school_id=? AND l.school_id=? AND g.is_enabled=1 AND l.is_enabled=1
       AND l.level_code IN ('elementary','jhs')`, [SCHOOL_ID, SCHOOL_ID]);
  const gradeMap = new Map(grades.map(grade => [grade.code, grade]));
  for (let grade = 2; grade <= 10; grade++) {
    assert(gradeMap.has(`grade-${grade}`), `Grade ${grade} is not enabled.`);
  }
  const [users] = await connection.execute(
    `SELECT role, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS added
     FROM users WHERE school_id=?`, [SCHOOL_ID]);
  assert(users.length === 1 && users[0].role === 'school_admin' && users[0].added === DEMO_DATE,
    'Expected only the School Admin with Date Added November 17.');
  const [[sectionCount]] = await connection.execute('SELECT COUNT(*) AS n FROM sections WHERE school_id=?', [SCHOOL_ID]);
  assert(Number(sectionCount.n) === 0, 'School already has sections. Nothing was added.');
  const [emails] = await connection.query('SELECT school_email, personal_email FROM users');
  const schoolEmails = new Set(emails.map(row => row.school_email.toLowerCase()));
  const personalEmails = new Set(emails.map(row => String(row.personal_email || '').toLowerCase()));
  const domain = storedSchoolDomain({ schoolEmailDomain: schools[0].domain });
  for (const account of data.accounts) {
    assert(!personalEmails.has(account.personalEmail), `Personal email exists: ${account.personalEmail}`);
    personalEmails.add(account.personalEmail);
    const base = schoolEmailBase(account.first, account.last, account.role);
    let suffix = 1;
    let candidate = schoolEmailCandidate(base, domain, suffix);
    while (schoolEmails.has(candidate)) candidate = schoolEmailCandidate(base, domain, ++suffix);
    schoolEmails.add(candidate);
    account.schoolEmail = candidate;
  }
  const [lrns] = await connection.execute(
    "SELECT lrn FROM student_profiles WHERE lrn BETWEEN '999600000001' AND '999600000135'");
  assert(lrns.length === 0, 'Demo LRNs already exist.');
  return { yearId: years[0].id, domain, gradeMap };
}

function aws(args) {
  return execFileSync('aws', args, { encoding: 'utf8', timeout: 20 * 60 * 1000 });
}

function takeSnapshot() {
  const caller = JSON.parse(aws(['sts', 'get-caller-identity', '--region', 'ap-southeast-2', '--output', 'json']));
  assert(caller.Account === '332502302492', 'Wrong AWS account.');
  const id = `academix-pre-demo-seed-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
  aws(['rds', 'create-db-snapshot', '--db-instance-identifier', 'academix-test-db',
    '--db-snapshot-identifier', id, '--region', 'ap-southeast-2', '--output', 'json']);
  console.log(`Waiting for snapshot ${id}...`);
  aws(['rds', 'wait', 'db-snapshot-available', '--db-snapshot-identifier', id, '--region', 'ap-southeast-2']);
  const [found, instance, status] = JSON.parse(aws(['rds', 'describe-db-snapshots',
    '--db-snapshot-identifier', id, '--snapshot-type', 'manual', '--region', 'ap-southeast-2',
    '--query', 'DBSnapshots[0].[DBSnapshotIdentifier,DBInstanceIdentifier,Status]', '--output', 'json']));
  assert(found === id && instance === 'academix-test-db' && status === 'available', 'Snapshot not available.');
  return id;
}

async function verify(connection) {
  const [roles] = await connection.execute(
    'SELECT role, COUNT(*) AS n FROM users WHERE school_id=? GROUP BY role', [SCHOOL_ID]);
  const counts = Object.fromEntries(roles.map(row => [row.role, Number(row.n)]));
  assert(roles.length === 4 && counts.school_admin === 1 && counts.student === 135 &&
    counts.teacher === 20 && counts.parent === 10, 'Account counts failed verification.');
  const [[records]] = await connection.execute(`SELECT
    (SELECT COUNT(*) FROM sections WHERE school_id=?) AS sections,
    (SELECT COUNT(*) FROM section_students WHERE school_id=? AND withdrawn_at IS NULL) AS enrollments,
    (SELECT COUNT(*) FROM student_profiles p JOIN users u ON u.id=p.user_id WHERE u.school_id=?) AS students,
    (SELECT COUNT(*) FROM student_qr_credentials WHERE school_id=? AND credential_status='active') AS qr,
    (SELECT COUNT(*) FROM teacher_profiles p JOIN users u ON u.id=p.user_id WHERE u.school_id=?) AS teachers,
    (SELECT COUNT(*) FROM parent_profiles p JOIN users u ON u.id=p.user_id WHERE u.school_id=?) AS parents,
    (SELECT COUNT(*) FROM student_parent_links WHERE school_id=?) AS parentLinks,
    (SELECT COUNT(*) FROM section_teachers WHERE school_id=?) AS teacherAssignments,
    (SELECT COUNT(*) FROM grading_items WHERE school_id=?) AS scoreItems,
    (SELECT COUNT(*) FROM student_scores WHERE school_id=?) AS scores,
    (SELECT COUNT(*) FROM published_final_grades WHERE school_id=?) AS publishedGrades,
    (SELECT COUNT(*) FROM attendance_records WHERE school_id=?) AS attendance,
    (SELECT COUNT(*) FROM users WHERE school_id=? AND role<>'school_admin'
      AND (created_at<>? OR setup_completed_at<>?)) AS wrongAccountDates,
    (SELECT COUNT(*) FROM sections WHERE school_id=? AND created_at<>?) AS wrongSectionDates,
    (SELECT COUNT(*) FROM section_students WHERE school_id=?
      AND (created_at<>? OR enrolled_at<>?)) AS wrongEnrollmentDates,
    (SELECT COUNT(*) FROM student_qr_credentials WHERE school_id=?
      AND (created_at<>? OR issued_at<>?)) AS wrongQrDates,
    (SELECT COUNT(*) FROM student_profiles p JOIN users u ON u.id=p.user_id
      WHERE u.school_id=? AND (p.created_at<>? OR p.lrn IS NULL OR p.sex IS NULL OR p.birth_date IS NULL
        OR p.birth_place IS NULL OR p.birth_country IS NULL OR p.mother_tongue IS NULL
        OR p.religion IS NULL OR p.house_street IS NULL OR p.barangay IS NULL
        OR p.city_municipality IS NULL OR p.province IS NULL)) AS incompleteStudents,
    (SELECT COUNT(*) FROM parent_profiles p JOIN users u ON u.id=p.user_id
      WHERE u.school_id=? AND (p.created_at<>? OR p.sex IS NULL OR p.religion IS NULL
        OR p.contact_number IS NULL OR p.house_street IS NULL OR p.barangay IS NULL
        OR p.city_municipality IS NULL OR p.province IS NULL)) AS incompleteParents,
    (SELECT COUNT(*) FROM teacher_profiles p JOIN users u ON u.id=p.user_id
      WHERE u.school_id=? AND (p.created_at<>? OR p.employee_number IS NULL)) AS incompleteTeachers`,
  [SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID,
    SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID,
    SCHOOL_ID, DEMO_DATE, DEMO_DATE, SCHOOL_ID, DEMO_DATE, SCHOOL_ID, DEMO_DATE, DEMO_DATE,
    SCHOOL_ID, DEMO_DATE, DEMO_DATE, SCHOOL_ID, DEMO_DATE, SCHOOL_ID, DEMO_DATE,
    SCHOOL_ID, DEMO_DATE]);
  const expected = { sections: 27, enrollments: 135, students: 135, qr: 135, teachers: 20,
    parents: 10, parentLinks: 20, teacherAssignments: 0, scoreItems: 0, scores: 0,
    publishedGrades: 0, attendance: 0, wrongAccountDates: 0, wrongSectionDates: 0,
    wrongEnrollmentDates: 0, wrongQrDates: 0, incompleteStudents: 0,
    incompleteParents: 0, incompleteTeachers: 0 };
  for (const [key, value] of Object.entries(expected)) {
    assert(Number(records[key]) === value, `Verification failed: ${key}.`);
  }
  const [sections] = await connection.execute(`SELECT s.id, COUNT(e.id) AS n FROM sections s
    LEFT JOIN section_students e ON e.section_id=s.id AND e.withdrawn_at IS NULL
    WHERE s.school_id=? GROUP BY s.id`, [SCHOOL_ID]);
  assert(sections.length === 27 && sections.every(section => Number(section.n) === 5),
    'Expected five students in every section.');
  const [[ages]] = await connection.execute(`SELECT COUNT(*) AS n FROM student_profiles p
    JOIN users u ON u.id=p.user_id JOIN section_students e ON e.student_user_id=u.id
    JOIN sections s ON s.id=e.section_id JOIN school_grade_levels g ON g.id=s.grade_level_id
    WHERE u.school_id=? AND e.withdrawn_at IS NULL AND TIMESTAMPDIFF(YEAR,p.birth_date,'2026-11-17')
      BETWEEN CAST(SUBSTRING(g.grade_code,7) AS UNSIGNED)+5
          AND CAST(SUBSTRING(g.grade_code,7) AS UNSIGNED)+6`, [SCHOOL_ID]);
  assert(Number(ages.n) === 135, 'Student ages failed verification.');
  return { accounts: counts, sections: 27, enrolledStudents: 135, parentsLinked: 20,
    teacherAssignments: 0, allProfilesComplete: true, datesVerified: true };
}

async function run({ apply, password, confirm = async phrase => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(`Type ${phrase} to continue: `)).trim() === phrase; }
  finally { input.close(); }
} }, dependencies = {}) {
  const data = makeData();
  if (apply) assert(password?.length >= 12 && password.length <= 128,
    'STC_DEMO_PASSWORD must contain 12 to 128 characters.');
  const database = dependencies.database || require('../config/database').getDatabase();
  const hashPassword = dependencies.hashPassword || (value => bcrypt.hash(value, 12));
  const issueQr = dependencies.issueQr || issueStudentQrCredential;
  const createSnapshot = dependencies.createSnapshot || takeSnapshot;
  let connection;
  let started = false;
  try {
    connection = await database.getConnection();
    const original = await preflight(connection, data);
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID, school: SCHOOL_NAME,
      dateAdded: DEMO_DATE, sections: 27, students: 135, teachers: 20, parents: 10 }, null, 2));
    console.log('SECTIONS (grade | name):');
    for (const section of data.sections) console.log(`${section.grade} | ${section.name}`);
    console.log('ACCOUNTS (role | name | grade/section | birth | school email | personal email):');
    for (const account of data.accounts) console.log([account.role, account.name,
      account.grade ? `${account.grade}/${account.section}` : '-', account.birthDate || '-',
      account.schoolEmail, account.personalEmail].join(' | '));
    if (!apply) return { mode: 'preview', accounts: data.accounts, sections: data.sections };
    assert(await confirm(CONFIRMATION), 'Confirmation did not match. Nothing was added.');
    const hash = await hashPassword(password);
    connection.release();
    connection = null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = createSnapshot();
    connection = await database.getConnection();
    await connection.beginTransaction();
    started = true;
    const current = await preflight(connection, makeData());
    assert(current.yearId === original.yearId && current.domain === original.domain,
      'School configuration changed since preview.');
    const sectionIds = new Map();
    for (const section of data.sections) {
      const grade = current.gradeMap.get(`grade-${section.grade}`);
      const [result] = await connection.execute(`INSERT INTO sections
        (school_id,academic_year_id,school_level_id,grade_level_id,name,capacity,
         adviser_user_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,40,NULL,'active',?,?)`,
      [SCHOOL_ID, current.yearId, grade.levelId, grade.id, section.name, DEMO_DATE, DEMO_DATE]);
      sectionIds.set(`${section.grade}:${section.name}`, result.insertId);
    }
    const accountIds = [];
    for (const account of data.accounts) {
      const [result] = await connection.execute(`INSERT INTO users
        (school_id,role,school_email,personal_email,password_hash,account_status,
         first_name,last_name,display_name,initials,setup_completed_at,created_at,updated_at)
        VALUES (?,?,?,?,?,'active',?,?,?,?,?,?,?)`,
      [SCHOOL_ID, account.role, account.schoolEmail, account.personalEmail, hash,
        account.first, account.last, account.name,
        `${account.first[0]}${account.last[0]}`.toUpperCase(), DEMO_DATE, DEMO_DATE, DEMO_DATE]);
      const id = result.insertId;
      accountIds.push(id);
      if (account.role === 'student') {
        await connection.execute(`INSERT INTO student_profiles
          (user_id,lrn,middle_name,sex,birth_date,birth_place_province,birth_place,
           birth_place_region,birth_country,mother_tongue,religion,house_street,
           barangay,city_municipality,province,created_at,updated_at)
          VALUES (?,?,?,?,?,'Pangasinan','Lingayen','Ilocos Region','Philippines',
                  ?,?,?,?,'Lingayen','Pangasinan',?,?)`,
        [id, account.lrn, account.middle, account.sex, account.birthDate,
          account.motherTongue, account.religion, account.houseStreet,
          account.barangay, DEMO_DATE, DEMO_DATE]);
        await issueQr(connection, SCHOOL_ID, id);
        await connection.execute(`UPDATE student_qr_credentials
          SET issued_at=?,created_at=?,updated_at=? WHERE school_id=? AND student_user_id=?`,
        [DEMO_DATE, DEMO_DATE, DEMO_DATE, SCHOOL_ID, id]);
        await connection.execute(`INSERT INTO section_students
          (school_id,section_id,student_user_id,enrolled_at,created_at) VALUES (?,?,?,?,?)`,
        [SCHOOL_ID, sectionIds.get(`${account.grade}:${account.section}`), id, DEMO_DATE, DEMO_DATE]);
      } else if (account.role === 'teacher') {
        await connection.execute(`INSERT INTO teacher_profiles
          (user_id,employee_number,contact_number,created_at,updated_at) VALUES (?,?,?,?,?)`,
        [id, account.employeeNo, account.contactNumber, DEMO_DATE, DEMO_DATE]);
      } else {
        await connection.execute(`INSERT INTO parent_profiles
          (user_id,middle_name,maiden_last_name,has_no_maiden_name,sex,religion,
           contact_number,house_street,barangay,city_municipality,province,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'Lingayen','Pangasinan',?,?)`,
        [id, account.middle, account.sex === 'female' ? account.maiden : null,
          account.sex === 'male', account.sex, account.religion,
          account.contactNumber, account.houseStreet, account.barangay, DEMO_DATE, DEMO_DATE]);
      }
    }
    for (const [index, account] of data.accounts.entries()) {
      if (account.parentIndex === undefined) continue;
      const parent = data.accounts[account.parentIndex];
      await connection.execute(`INSERT INTO student_parent_links
        (school_id,student_user_id,parent_user_id,relationship,created_at)
        VALUES (?,?,?,?,?)`,
      [SCHOOL_ID, accountIds[index], accountIds[account.parentIndex],
        parent.sex === 'female' ? 'mother' : 'father', DEMO_DATE]);
    }
    const verified = await verify(connection);
    await connection.execute(`INSERT INTO audit_logs
      (school_id,actor_user_id,action_type,entity_type,entity_id,details)
      VALUES (?,NULL,'demo_accounts_seeded','school',?,?)`,
    [SCHOOL_ID, SCHOOL_ID, JSON.stringify({ summary: '165 mock accounts and 27 sections seeded',
      snapshotId, demoDate: DEMO_DATE, actualExecutionDate: new Date().toISOString() })]);
    await connection.commit();
    started = false;
    console.log(JSON.stringify({ mode: 'complete', schoolId: SCHOOL_ID, snapshotId, verified }, null, 2));
    return { mode: 'complete', verified };
  } catch (error) {
    if (started) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  assert(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  assert(process.env.QR_ENCRYPTION_KEY || process.env.SESSION_SECRET, 'QR encryption secret is missing.');
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  const database = require('../config/database').getDatabase();
  try {
    await run({ apply: args[0] === '--apply', password: process.env.STC_DEMO_PASSWORD }, { database });
  } finally {
    await database.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error('Demo setup stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { makeData, legacyIdentity, legacyProfile, preflight, verify, run, takeSnapshot, CONFIRMATION };
