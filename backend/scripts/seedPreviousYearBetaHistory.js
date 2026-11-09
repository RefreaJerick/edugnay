// One-time local beta fixture for Saint Columban's College. Run without arguments
// to preview the source records. Back up with `node scripts/backupDatabase.js`
// before passing --apply to insert and archive the year.
require('dotenv').config({ quiet: true });

const { getDatabase } = require('../config/database');
const { archiveAcademicYear } = require('../controllers/archiveController');

const SCHOOL_ID = 37;
const SCHOOL_NAME = "Saint Columban's College";
const YEAR_LABEL = '2025-2026';
const YEAR_START = '2025-11-06';
const YEAR_END = '2026-06-30';
const PERIODS = [
  ['Term 1', '2025-11-06', '2025-12-31'],
  ['Term 2', '2026-01-01', '2026-03-31'],
  ['Term 3', '2026-04-01', '2026-06-30']
];
const GROUPS = [
  { currentGrade: 'grade-5', previousGrade: 'grade-4', sourceSection: 'Section A', previousSection: 'Beta History A', subjects: ['english-elementary', 'mathematics-elementary', 'science-elementary', 'filipino-elementary'] },
  { currentGrade: 'grade-8', previousGrade: 'grade-7', sourceSection: 'Section C', previousSection: 'Beta History B', subjects: ['english-jhs', 'mathematics-jhs', 'science-jhs', 'filipino-jhs'] }
];
const ATTENDANCE_DATES = ['2025-11-18', '2026-01-20', '2026-03-17', '2026-05-19'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function single(connection, sql, values = []) {
  const [rows] = await connection.execute(sql, values);
  assert(rows.length === 1, `Expected one row; found ${rows.length}.`);
  return rows[0];
}

async function preflight(connection) {
  const school = await single(connection, 'SELECT id, name FROM schools WHERE id = ? LIMIT 1', [SCHOOL_ID]);
  assert(school.name === SCHOOL_NAME, 'School ID 37 no longer belongs to Saint Columban\'s College.');
  const [previousYears] = await connection.execute('SELECT id FROM academic_years WHERE school_id = ? AND label = ?', [SCHOOL_ID, YEAR_LABEL]);
  assert(!previousYears.length, `${YEAR_LABEL} already exists; no records were added.`);
  const activeYear = await single(connection, "SELECT id, label, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate, DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate FROM academic_years WHERE school_id = ? AND status = 'active'", [SCHOOL_ID]);
  assert(activeYear.label === '2026-2027' && activeYear.startDate === '2026-11-06' && activeYear.endDate === '2027-06-30', 'The active year or calendar changed; review dates before seeding.');
  const admin = await single(connection, "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' AND account_status = 'active'", [SCHOOL_ID]);
  const [levels] = await connection.execute('SELECT id, level_code AS code FROM school_levels WHERE school_id = ? AND is_enabled = TRUE ORDER BY id', [SCHOOL_ID]);
  assert(levels.map(level => level.code).join(',') === 'elementary,jhs,shs', 'Enabled school levels changed; review archive readiness.');

  const groups = [];
  for (const group of GROUPS) {
    const [sources] = await connection.execute(
      `SELECT s.id FROM sections s INNER JOIN school_grade_levels gl ON gl.id = s.grade_level_id
       WHERE s.school_id = ? AND s.academic_year_id = ? AND s.status = 'active'
         AND gl.grade_code = ? AND s.name = ?`,
      [SCHOOL_ID, activeYear.id, group.currentGrade, group.sourceSection]
    );
    assert(sources.length === 1, `Current ${group.currentGrade} ${group.sourceSection} source section changed.`);
    const [students] = await connection.execute(
      `SELECT ss.student_user_id AS id FROM section_students ss
       INNER JOIN users u ON u.id = ss.student_user_id AND u.school_id = ss.school_id
       WHERE ss.school_id = ? AND ss.section_id = ? AND ss.withdrawn_at IS NULL
         AND u.role = 'student' AND u.account_status = 'active' ORDER BY ss.student_user_id`,
      [SCHOOL_ID, sources[0].id]
    );
    assert(students.length >= 4 && students.length <= 5, `Current ${group.currentGrade} source roster changed.`);
    const grade = await single(connection,
      `SELECT gl.id, gl.school_level_id AS levelId FROM school_grade_levels gl
       WHERE gl.school_id = ? AND gl.grade_code = ?`, [SCHOOL_ID, group.previousGrade]);
    const [subjects] = await connection.execute(
      `SELECT sub.id, sub.subject_code AS code FROM subjects sub
       INNER JOIN subject_grade_scopes scope ON scope.school_id = sub.school_id
         AND scope.subject_id = sub.id AND scope.grade_level_id = ?
       WHERE sub.school_id = ? AND sub.is_active = TRUE AND sub.subject_code IN (?, ?, ?, ?)`,
      [grade.id, SCHOOL_ID, ...group.subjects]
    );
    assert(subjects.length === group.subjects.length && group.subjects.every(code => subjects.some(subject => subject.code === code)), `Historical ${group.previousGrade} subject scope changed.`);
    groups.push({ ...group, grade, students: students.map(student => student.id), subjects });
  }
  return { activeYear, adminId: admin.id, levels, groups };
}

async function insertHistory(connection, fixture) {
  const [yearResult] = await connection.execute(
    'INSERT INTO academic_years (school_id, label, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
    [SCHOOL_ID, YEAR_LABEL, YEAR_START, YEAR_END, 'closed']
  );
  const yearId = yearResult.insertId;
  const terms = new Map();
  for (const level of fixture.levels) {
    for (const [index, [name, start, end]] of PERIODS.entries()) {
      const [result] = await connection.execute(
        `INSERT INTO academic_terms (school_id, academic_year_id, school_level_id, name, sequence_number,
          planned_start_date, planned_end_date, status, activated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?)`,
        [SCHOOL_ID, yearId, level.id, name, index + 1, start, end, `${start} 08:00:00`, `${end} 17:00:00`]
      );
      terms.set(`${level.id}:${index}`, result.insertId);
    }
  }

  let gradeCount = 0;
  let attendanceCount = 0;
  for (const [groupIndex, group] of fixture.groups.entries()) {
    const [sectionResult] = await connection.execute(
      `INSERT INTO sections (school_id, academic_year_id, school_level_id, grade_level_id, name, capacity, status)
       VALUES (?, ?, ?, ?, ?, 40, 'archived')`,
      [SCHOOL_ID, yearId, group.grade.levelId, group.grade.id, group.previousSection]
    );
    const sectionId = sectionResult.insertId;
    for (const studentId of group.students) {
      await connection.execute(
        `INSERT INTO section_students (school_id, section_id, student_user_id, enrolled_at, withdrawn_at)
         VALUES (?, ?, ?, ?, ?)`,
        [SCHOOL_ID, sectionId, studentId, `${YEAR_START} 08:00:00`, `${YEAR_END} 17:00:00`]
      );
    }
    for (const [subjectIndex, subject] of group.subjects.entries()) {
      for (const [termIndex, period] of PERIODS.entries()) {
        for (const [studentIndex, studentId] of group.students.entries()) {
          // Varied but repeatable results, including a few marks below 75.
          const grade = 71 + ((studentIndex * 7 + subjectIndex * 5 + termIndex * 3 + groupIndex * 4) % 25);
          await connection.execute(
            `INSERT INTO published_final_grades (school_id, section_id, subject_id, academic_term_id,
              student_user_id, final_grade, published_by_user_id, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [SCHOOL_ID, sectionId, subject.id, terms.get(`${group.grade.levelId}:${termIndex}`), studentId, grade, fixture.adminId, `${period[2]} 17:00:00`]
          );
          gradeCount++;
        }
      }
      for (const [dateIndex, date] of ATTENDANCE_DATES.entries()) {
        const [sessionResult] = await connection.execute(
          `INSERT INTO attendance_sessions (school_id, section_id, subject_id, attendance_date,
            method, status, created_by_user_id, confirmed_by_user_id, confirmed_at)
           VALUES (?, ?, ?, ?, 'manual', 'confirmed', ?, ?, ?)`,
          [SCHOOL_ID, sectionId, subject.id, date, fixture.adminId, fixture.adminId, `${date} 17:00:00`]
        );
        for (const [studentIndex, studentId] of group.students.entries()) {
          const status = (studentIndex + subjectIndex + dateIndex) % 13 === 0 ? 'absent'
            : (studentIndex + subjectIndex + dateIndex) % 9 === 0 ? 'late' : 'present';
          await connection.execute(
            `INSERT INTO attendance_records (school_id, attendance_session_id, student_user_id,
              attendance_status, marked_by_user_id, marked_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [SCHOOL_ID, sessionResult.insertId, studentId, status, fixture.adminId, `${date} 17:00:00`]
          );
          attendanceCount++;
        }
      }
    }
  }
  return { yearId, sections: fixture.groups.length, students: fixture.groups.reduce((sum, group) => sum + group.students.length, 0), gradeCount, attendanceCount };
}

async function archive(yearId, adminId) {
  return new Promise((resolve, reject) => {
    archiveAcademicYear(
      { params: { yearId: String(yearId) }, user: { id: adminId, schoolId: SCHOOL_ID, role: 'school_admin' } },
      { status() { return this; }, json: resolve }, reject
    );
  });
}

async function main() {
  assert(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--apply', 'Use --apply to load the fixture.');
  const database = getDatabase();
  let connection;
  try {
    connection = await database.getConnection();
    if (process.argv[2] !== '--apply') {
      const fixture = await preflight(connection);
      console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID, year: YEAR_LABEL,
        currentYearId: fixture.activeYear.id,
        groups: fixture.groups.map(group => ({ previousGrade: group.previousGrade, students: group.students.length, subjects: group.subjects.map(subject => subject.code) })),
        plannedTerms: fixture.levels.length * PERIODS.length }, null, 2));
      return;
    }
    await connection.beginTransaction();
    let seeded;
    let fixture;
    try {
      fixture = await preflight(connection);
      seeded = await insertHistory(connection, fixture);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(`Seeded closed ${YEAR_LABEL} year ${seeded.yearId}: ${seeded.sections} sections, ${seeded.students} students, ${seeded.gradeCount} grades, ${seeded.attendanceCount} attendance records.`);
    // Use the application's existing archive path for its snapshot and audit entry.
    const result = await archive(seeded.yearId, fixture.adminId);
    console.log(`Archived ${result.archive.label}: ${result.archive.gradeCount} grades, ${result.archive.sections} sections.`);
  } finally {
    connection?.release();
    await database.end();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
