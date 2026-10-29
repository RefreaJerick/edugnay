// One-time, school-scoped development fixture. Never use for a real school.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getDatabase } = require('../config/database');

const SCHOOL_NAME = 'Capstone SHS Test School';
const SCHOOL_DOMAIN = 'capstone-shs-test.academix.invalid';
const SCHOOL_CODE = 'CAPSTONE-SHS-TEST';
const YEAR = '2026-2027';
const { DEPED_SHS_CORE_SUBJECTS } = require('../config/depedShsCoreSubjects');
const CORE_NAMES = DEPED_SHS_CORE_SUBJECTS.map(subject => subject.name);

async function main() {
  const backupIndex = process.argv.indexOf('--backup');
  const backupPath = backupIndex < 0 ? null : process.argv[backupIndex + 1];
  if (!process.argv.includes('--create') || !backupPath || !fs.statSync(backupPath).size) {
    throw new Error('Use --create --backup <verified database snapshot path>.');
  }
  const db = getDatabase();
  const connection = await db.getConnection();
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  let committed = false;
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute(
      'SELECT id FROM schools WHERE school_code = ? OR school_email_domain = ? FOR UPDATE',
      [SCHOOL_CODE, SCHOOL_DOMAIN]);
    if (existing) throw new Error(`Capstone test school already exists (ID ${existing.id}); no records were changed.`);
    const [schoolRow] = await connection.execute(
      `INSERT INTO schools (school_code, name, short_name, school_type, school_email_domain,
        registration_status, approved_at) VALUES (?, ?, 'Capstone SHS Test', 'shs', ?, 'active', NOW())`,
      [SCHOOL_CODE, SCHOOL_NAME, SCHOOL_DOMAIN]);
    const schoolId = schoolRow.insertId;
    await connection.execute(`INSERT INTO school_settings (school_id, current_school_year_label)
      VALUES (?, ?)`, [schoolId, YEAR]);
    await connection.execute(`INSERT INTO school_portal_features
      (school_id, grades_enabled, attendance_enabled) VALUES (?, TRUE, TRUE)`, [schoolId]);
    await connection.execute('INSERT INTO school_attendance_settings (school_id) VALUES (?)', [schoolId]);
    const [levelRow] = await connection.execute(`INSERT INTO school_levels
      (school_id, level_code, display_name, grading_period_type) VALUES (?, 'shs', 'Senior High School', 'semestral')`, [schoolId]);
    const levelId = levelRow.insertId;
    const grades = {};
    for (const grade of [11, 12]) {
      const [row] = await connection.execute(`INSERT INTO school_grade_levels
        (school_id, school_level_id, grade_code, display_name, sort_order)
        VALUES (?, ?, ?, ?, ?)`, [schoolId, levelId, `grade-${grade}`, `Grade ${grade}`, grade]);
      grades[grade] = row.insertId;
    }
    const tracks = {};
    for (const [code, label] of [['academic', 'Academic'], ['techpro', 'Technical Professional (TechPro)']]) {
      const [row] = await connection.execute(`INSERT INTO school_shs_tracks
        (school_id, school_level_id, track_code, display_name) VALUES (?, ?, ?, ?)`,
      [schoolId, levelId, code, label]);
      tracks[code] = row.insertId;
    }
    const years = {};
    for (const [label, start, end, status] of [
      [YEAR, '2026-08-01', '2027-06-30', 'active'],
      ['2027-2028', '2027-08-01', '2028-06-30', 'upcoming']
    ]) {
      const [row] = await connection.execute(`INSERT INTO academic_years
        (school_id, label, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)`,
      [schoolId, label, start, end, status]);
      years[label] = row.insertId;
      const boundary = label === YEAR ? ['2026-12-31', '2027-01-01'] : ['2027-12-31', '2028-01-01'];
      for (const [index, termStart, termEnd] of [
        [1, start, boundary[0]], [2, boundary[1], end]
      ]) await connection.execute(`INSERT INTO academic_terms
        (school_id, academic_year_id, school_level_id, name, sequence_number,
          planned_start_date, planned_end_date, status, activated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, row.insertId, levelId, `Semester ${index}`, index, termStart, termEnd,
        label === YEAR && index === 1 ? 'active' : 'upcoming',
        label === YEAR && index === 1 ? new Date() : null]);
    }
    const accounts = {};
    for (const [key, role, first, last] of [
      ['admin', 'school_admin', 'Capstone', 'Administrator'],
      ['teacher', 'teacher', 'Capstone', 'Teacher'],
      ['academic', 'student', 'Academic', 'Learner'],
      ['academicCross', 'student', 'Academic Cross', 'Learner'],
      ['techpro', 'student', 'TechPro', 'Learner'],
      ['techproCross', 'student', 'TechPro Cross', 'Learner'],
      ['parent', 'parent', 'Capstone', 'Parent'],
      ['unrelatedParent', 'parent', 'Unrelated', 'Parent']
    ]) {
      const email = `${key.toLowerCase()}@${SCHOOL_DOMAIN}`;
      const [row] = await connection.execute(`INSERT INTO users
        (school_id, role, school_email, password_hash, account_status, first_name,
          last_name, display_name, initials, setup_completed_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW())`,
      [schoolId, role, email, passwordHash, first, last, `${first} ${last}`, `${first[0]}${last[0]}`]);
      accounts[key] = { id: row.insertId, email };
      if (role === 'school_admin') await connection.execute(
        'INSERT INTO school_admin_profiles (user_id) VALUES (?)', [row.insertId]);
      if (role === 'teacher') await connection.execute(
        'INSERT INTO teacher_profiles (user_id) VALUES (?)', [row.insertId]);
      if (role === 'student') await connection.execute(
        'INSERT INTO student_profiles (user_id, lrn) VALUES (?, ?)',
        [row.insertId, `999${String(row.insertId).padStart(9, '0')}`]);
      if (role === 'parent') await connection.execute(
        'INSERT INTO parent_profiles (user_id) VALUES (?)', [row.insertId]);
    }
    await connection.execute(`INSERT INTO student_parent_links
      (school_id, student_user_id, parent_user_id, relationship) VALUES (?, ?, ?, 'guardian')`,
    [schoolId, accounts.academic.id, accounts.parent.id]);
    const sections = {};
    for (const track of ['academic', 'techpro']) {
      const [row] = await connection.execute(`INSERT INTO sections
        (school_id, academic_year_id, school_level_id, grade_level_id, track_id,
          name, shs_curriculum_code, adviser_user_id)
        VALUES (?, ?, ?, ?, ?, ?, 'strengthened_2026', ?)`,
      [schoolId, years[YEAR], levelId, grades[11], tracks[track],
        `Capstone ${track === 'academic' ? 'Academic' : 'TechPro'} 11`, accounts.teacher.id]);
      sections[track] = row.insertId;
    }
    for (const key of ['academic', 'academicCross', 'techpro', 'techproCross']) {
      const track = key.startsWith('academic') ? 'academic' : 'techpro';
      await connection.execute(`INSERT INTO section_students
        (school_id, section_id, student_user_id) VALUES (?, ?, ?)`,
      [schoolId, sections[track], accounts[key].id]);
    }
    for (const [index, name] of CORE_NAMES.entries()) {
      const [subject] = await connection.execute(`INSERT INTO subjects
        (school_id, subject_code, name, school_level_id, grade_level_id,
          shs_grading_group, shs_subject_type, instructional_hours)
        VALUES (?, ?, ?, ?, ?, 'core', 'core', 160)`,
      [schoolId, `QA-CORE-${index + 1}`, name, levelId, grades[11]]);
      for (const [track, sectionId] of Object.entries(sections)) {
        await connection.execute(`INSERT INTO subject_grade_scopes
          (school_id, subject_id, grade_level_id, track_id) VALUES (?, ?, ?, ?)`,
        [schoolId, subject.insertId, grades[11], tracks[track]]);
        const [assignment] = await connection.execute(`INSERT INTO section_teachers
          (school_id, section_id, teacher_user_id, subject_id) VALUES (?, ?, ?, ?)`,
        [schoolId, sectionId, accounts.teacher.id, subject.insertId]);
        const [scheduled] = await connection.execute(`INSERT INTO scheduled_classes
          (school_id, assignment_id) VALUES (?, ?)`, [schoolId, assignment.insertId]);
        await connection.execute(`INSERT INTO timetable_meetings
          (school_id, scheduled_class_id, weekday, start_time, end_time, start_date, end_date)
          VALUES (?, ?, ?, ?, ?, '2026-08-01', '2027-06-30')`,
        [schoolId, scheduled.insertId, index + 1,
          track === 'academic' ? '08:00:00' : '09:00:00',
          track === 'academic' ? '09:00:00' : '10:00:00']);
      }
    }
    await connection.commit();
    committed = true;
    console.log(JSON.stringify({ schoolId, schoolName: SCHOOL_NAME, academicYearIds: years,
      accounts, temporaryPassword }, null, 2));
  } finally {
    if (!committed) await connection.rollback();
    connection.release();
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
