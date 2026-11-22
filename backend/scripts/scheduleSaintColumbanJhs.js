'use strict';

const path = require('node:path');
const { createInterface } = require('node:readline/promises');
const { DEPED_GRADE_SUBJECTS } = require('../config/depedK10Subjects');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const ADDED_AT = '2026-11-17 12:00:00';
const START_DATE = '2026-11-17';
const END_DATE = '2027-06-30';
const CONFIRMATION = 'SCHEDULE 12 JHS SECTIONS FOR SCHOOL 7';
const PERIODS = ['08:00:00', '09:00:00', '10:00:00', '11:00:00', '13:00:00', '14:00:00', '15:00:00'];
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function check(value, message) {
  if (!value) throw new Error(message);
}

function weeklyHours(code) {
  if (['english-jhs', 'filipino-jhs', 'mathematics-jhs', 'science-jhs'].includes(code)) return 5;
  if (code === 'araling-panlipunan-jhs') return 4;
  if (code === 'tle-jhs') return 2;
  return 3;
}

function assignDays(assignments) {
  const remaining = new Map(assignments.map(row => [row.code, weeklyHours(row.code)]));
  const days = [];
  for (let weekday = 1; weekday <= 5; weekday++) {
    const daysLeft = 6 - weekday;
    const ordered = [...assignments].sort((a, b) =>
      remaining.get(b.code) - remaining.get(a.code) || a.code.localeCompare(b.code));
    const required = ordered.filter(row => remaining.get(row.code) === daysLeft);
    check(required.length <= PERIODS.length, 'Subject hours cannot fit in the school week.');
    const chosen = [
      ...required,
      ...ordered.filter(row => !required.includes(row) && remaining.get(row.code) > 0)
        .slice(0, PERIODS.length - required.length)
    ];
    check(chosen.length === PERIODS.length && new Set(chosen.map(row => row.code)).size === chosen.length,
      'Subject hours cannot fill the school day.');
    chosen.forEach(row => remaining.set(row.code, remaining.get(row.code) - 1));
    const shift = (weekday - 1) % chosen.length;
    days.push([...chosen.slice(shift), ...chosen.slice(0, shift)]);
  }
  check([...remaining.values()].every(hours => hours === 0), 'Weekly subject hours do not match.');
  return days;
}

// A seven-period day is a bipartite graph: sections on one side, teachers on
// the other. Pad both sides to degree seven, then take seven perfect matchings.
function assignPeriods(sections, dayAssignments) {
  const teacherIds = [...new Set(sections.flatMap(section =>
    section.assignments.map(row => Number(row.teacherId))))].sort((a, b) => a - b);
  check(teacherIds.length === 20, `Expected 20 JHS teachers; found ${teacherIds.length}.`);
  const edges = dayAssignments.flatMap((day, sectionIndex) => day.map(assignment => ({
    sectionIndex, teacherId: Number(assignment.teacherId), assignment
  })));
  const degree = new Map(teacherIds.map(id => [id, 0]));
  for (const edge of edges) degree.set(edge.teacherId, degree.get(edge.teacherId) + 1);
  check([...degree.values()].every(n => n <= PERIODS.length),
    'A teacher has more meetings than periods in one day.');
  for (let sectionIndex = sections.length; sectionIndex < teacherIds.length; sectionIndex++) {
    for (let slot = 0; slot < PERIODS.length; slot++) {
      const teacherId = teacherIds.find(id => degree.get(id) < PERIODS.length);
      check(teacherId !== undefined, 'Cannot balance teacher schedules.');
      edges.push({ sectionIndex, teacherId, assignment: null });
      degree.set(teacherId, degree.get(teacherId) + 1);
    }
  }
  check([...degree.values()].every(n => n === PERIODS.length),
    'Teacher schedule could not be balanced.');
  const result = [];
  for (let slot = 0; slot < PERIODS.length; slot++) {
    const matchedTeacher = new Map();
    function match(sectionIndex, seen) {
      for (const edge of edges) {
        if (edge.sectionIndex !== sectionIndex || seen.has(edge.teacherId)) continue;
        seen.add(edge.teacherId);
        const previous = matchedTeacher.get(edge.teacherId);
        if (!previous || match(previous.sectionIndex, seen)) {
          matchedTeacher.set(edge.teacherId, edge);
          return true;
        }
      }
      return false;
    }
    for (let sectionIndex = 0; sectionIndex < teacherIds.length; sectionIndex++) {
      check(match(sectionIndex, new Set()), 'Cannot assign a conflict-free period.');
    }
    const chosen = new Set(matchedTeacher.values());
    result.push(...[...chosen].filter(edge => edge.assignment).map(edge => ({ ...edge, slot })));
    for (let i = edges.length - 1; i >= 0; i--) if (chosen.has(edges[i])) edges.splice(i, 1);
  }
  check(edges.length === 0, 'Some daily meetings were not assigned.');
  return result;
}

function buildPlan(sections) {
  const days = sections.map(section => assignDays(section.assignments));
  const plan = [];
  for (let weekday = 1; weekday <= 5; weekday++) {
    const assigned = assignPeriods(sections, days.map(day => day[weekday - 1]));
    for (const { sectionIndex, assignment, slot } of assigned) {
      const section = sections[sectionIndex];
      const startTime = PERIODS[slot];
      const endTime = `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, '0')}:00:00`;
      plan.push({ assignmentId: assignment.id, sectionId: section.id,
        sectionName: section.name, gradeCode: section.gradeCode,
        teacherId: assignment.teacherId, teacherName: assignment.teacherName,
        subjectCode: assignment.code, subjectName: assignment.subjectName,
        students: section.students, weekday, startTime, endTime,
        startDate: START_DATE, endDate: END_DATE, room: null });
    }
  }
  return plan.sort((a, b) => a.sectionId - b.sectionId ||
    a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

function validatePlan(plan) {
  check(plan.length === 420, `Expected 420 weekly meetings; found ${plan.length}.`);
  check(new Set(plan.map(row => row.assignmentId)).size === 108,
    'Expected 108 scheduled subject assignments.');
  const slots = new Map();
  for (const row of plan) {
    check(row.weekday >= 1 && row.weekday <= 5 && row.startTime < row.endTime,
      'Invalid meeting time.');
    const key = `${row.weekday}:${row.startTime}`;
    const concurrent = slots.get(key) || [];
    for (const other of concurrent) {
      check(Number(row.sectionId) !== Number(other.sectionId), 'Section schedule conflict.');
      check(Number(row.teacherId) !== Number(other.teacherId), 'Teacher schedule conflict.');
      check(!row.students.some(id => other.students.includes(id)), 'Student schedule conflict.');
    }
    concurrent.push(row);
    slots.set(key, concurrent);
  }
  const sectionIds = new Set(plan.map(row => row.sectionId));
  check(sectionIds.size === 12, 'Expected 12 JHS sections.');
  for (const sectionId of sectionIds) {
    const rows = plan.filter(row => row.sectionId === sectionId);
    check(rows.length === 35, 'Section has an incomplete timetable.');
    for (let weekday = 1; weekday <= 5; weekday++) {
      const day = rows.filter(row => row.weekday === weekday);
      check(day.length === 7 && new Set(day.map(row => row.subjectCode)).size === 7,
        'Section has an incomplete school day.');
    }
    for (const code of new Set(rows.map(row => row.subjectCode))) {
      check(rows.filter(row => row.subjectCode === code).length === weeklyHours(code),
        'Section has incorrect weekly subject hours.');
    }
  }
}

async function readScope(connection) {
  const { findConflict } = require('../controllers/timetablesController');
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    'SELECT id FROM schools WHERE id=? AND name=? AND registration_status=?',
    [SCHOOL_ID, SCHOOL_NAME, 'active']);
  check(schools.length === 1, 'Expected active Saint Columban school ID 7.');
  const [years] = await connection.execute(
    `SELECT id, DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
            DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate
     FROM academic_years WHERE school_id=? AND label='2026-2027' AND status='active'`,
    [SCHOOL_ID]);
  check(years.length === 1 && years[0].startDate <= START_DATE && years[0].endDate === END_DATE,
    'Expected active 2026-2027 school year ending June 30.');
  const yearId = years[0].id;
  const [sectionRows] = await connection.execute(
    `SELECT s.id, s.name, s.adviser_user_id AS adviserId, g.grade_code AS gradeCode
     FROM sections s JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
     JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
     WHERE s.school_id=? AND s.academic_year_id=? AND s.status='active'
       AND l.level_code='jhs' AND g.grade_code IN
         ('grade-7','grade-8','grade-9','grade-10')
     ORDER BY g.sort_order, s.name`,
    [SCHOOL_ID, yearId]);
  check(sectionRows.length === 12, `Expected 12 JHS sections; found ${sectionRows.length}.`);
  for (let grade = 7; grade <= 10; grade++) {
    check(sectionRows.filter(row => row.gradeCode === `grade-${grade}`).length === 3,
      `Expected three Grade ${grade} sections.`);
  }
  const sectionIds = sectionRows.map(row => row.id);
  const [assignments] = await connection.execute(
    `SELECT a.id, a.section_id AS sectionId, a.teacher_user_id AS teacherId,
            a.communication_component_code AS component, sub.subject_code AS code,
            sub.name AS subjectName, sub.is_active AS subjectActive,
            u.display_name AS teacherName,
            u.role, u.account_status AS teacherStatus
     FROM section_teachers a JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=a.school_id
     JOIN users u ON u.id=a.teacher_user_id AND u.school_id=a.school_id
     WHERE a.school_id=? AND a.section_id IN (${sectionIds.map(() => '?').join(',')})`,
    [SCHOOL_ID, ...sectionIds]);
  check(assignments.length === 108, `Expected 108 JHS subject assignments; found ${assignments.length}.`);
  const [enrollments] = await connection.execute(
    `SELECT section_id AS sectionId, student_user_id AS studentId
     FROM section_students WHERE school_id=? AND withdrawn_at IS NULL
       AND section_id IN (${sectionIds.map(() => '?').join(',')})
     ORDER BY section_id, student_user_id`,
    [SCHOOL_ID, ...sectionIds]);
  const sections = sectionRows.map(section => {
    const own = assignments.filter(row => Number(row.sectionId) === Number(section.id));
    const expected = DEPED_GRADE_SUBJECTS
      .filter(subject => subject.gradeCodes.includes(section.gradeCode))
      .map(subject => subject.code);
    const students = enrollments.filter(row => Number(row.sectionId) === Number(section.id))
      .map(row => Number(row.studentId));
    check(students.length === 5 && new Set(students).size === 5,
      `${section.name} must have five active students.`);
    check(own.length === expected.length && expected.every(code =>
      own.filter(row => row.code === code).length === 1),
      `${section.name} has an unexpected subject roster.`);
    check(own.some(row => Number(row.teacherId) === Number(section.adviserId)) &&
      own.every(row => row.role === 'teacher' && row.teacherStatus === 'active' &&
        Number(row.subjectActive) === 1 && row.component == null),
    `${section.name} must have active teachers and an assigned adviser.`);
    return { ...section, students, assignments: own };
  });
  check(new Set(sections.map(section => section.adviserId)).size === 12,
    'JHS advisers must be distinct across sections.');
  check(new Set(assignments.map(row => row.teacherId)).size === 20,
    'Expected 20 distinct JHS subject teachers.');
  const plan = buildPlan(sections);
  validatePlan(plan);
  const [existing] = await connection.execute(
    `SELECT id FROM scheduled_classes WHERE school_id=?
       AND assignment_id IN (${assignments.map(() => '?').join(',')})`,
    [SCHOOL_ID, ...assignments.map(row => row.id)]);
  check(existing.length === 0, 'A JHS subject already has a schedule. Nothing was added.');
  for (const row of plan) {
    const conflict = await findConflict(connection, SCHOOL_ID, yearId,
      { sectionId: row.sectionId, teacherId: row.teacherId }, row, 0);
    check(!conflict,
      `Existing schedule conflicts with ${row.sectionName} ${row.subjectName} on ${WEEKDAYS[row.weekday]}.`);
  }
  return { yearId, plan };
}

async function run({ apply = false, snapshot = takeSnapshot } = {}) {
  const db = require('../config/database').getDatabase();
  let connection;
  try {
    connection = await db.getConnection();
    const { yearId, plan } = await readScope(connection);
    for (const sectionId of [...new Set(plan.map(row => row.sectionId))]) {
      const rows = plan.filter(row => row.sectionId === sectionId);
      console.log(`${rows[0].gradeCode} ${rows[0].sectionName}`);
      for (let weekday = 1; weekday <= 5; weekday++) {
        console.log(`  ${WEEKDAYS[weekday]}: ${rows.filter(row => row.weekday === weekday)
          .map(row => `${row.startTime.slice(0, 5)} ${row.subjectName} (${row.teacherName})`).join(' | ')}`);
      }
    }
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID,
      scheduledClasses: 108, weeklyMeetings: plan.length, dateAdded: ADDED_AT,
      confirmationPhrase: CONFIRMATION }, null, 2));
    if (!apply) return;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer;
    try { answer = await rl.question(`Type ${CONFIRMATION} to continue: `); }
    finally { rl.close(); }
    if (answer !== CONFIRMATION) { console.log('Cancelled. Nothing was added.'); return; }
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    await connection.beginTransaction();
    try {
      await connection.execute('SELECT id FROM academic_years WHERE id=? AND school_id=? FOR UPDATE',
        [yearId, SCHOOL_ID]);
      const checked = await readScope(connection);
      check(checked.plan.length === plan.length && checked.plan.every((row, index) =>
        row.assignmentId === plan[index].assignmentId && row.teacherId === plan[index].teacherId &&
        row.students.join(',') === plan[index].students.join(',')),
      'Schedule scope changed after preview.');
      const ownerIds = new Map();
      for (const row of plan) {
        if (ownerIds.has(row.assignmentId)) continue;
        const [created] = await connection.execute(
          `INSERT INTO scheduled_classes (school_id, assignment_id, created_at)
           VALUES (?, ?, ?)`, [SCHOOL_ID, row.assignmentId, ADDED_AT]);
        ownerIds.set(row.assignmentId, created.insertId);
      }
      for (const row of plan) {
        await connection.execute(
          `INSERT INTO timetable_meetings
           (school_id, scheduled_class_id, weekday, start_time, end_time,
            start_date, end_date, room, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          [SCHOOL_ID, ownerIds.get(row.assignmentId), row.weekday,
            row.startTime, row.endTime, row.startDate, row.endDate, ADDED_AT, ADDED_AT]);
      }
      const [saved] = await connection.execute(
        `SELECT sc.id, sc.assignment_id AS assignmentId,
                DATE_FORMAT(sc.created_at,'%Y-%m-%d %H:%i:%s') AS classAdded,
                tm.weekday, TIME_FORMAT(tm.start_time,'%H:%i:%s') AS startTime,
                TIME_FORMAT(tm.end_time,'%H:%i:%s') AS endTime,
                DATE_FORMAT(tm.start_date,'%Y-%m-%d') AS startDate,
                DATE_FORMAT(tm.end_date,'%Y-%m-%d') AS endDate,
                DATE_FORMAT(tm.created_at,'%Y-%m-%d %H:%i:%s') AS meetingAdded
         FROM scheduled_classes sc JOIN timetable_meetings tm
           ON tm.scheduled_class_id=sc.id AND tm.school_id=sc.school_id
         WHERE sc.school_id=? AND sc.id IN (${[...ownerIds.values()].map(() => '?').join(',')})`,
        [SCHOOL_ID, ...ownerIds.values()]);
      const expected = new Set(plan.map(row =>
        `${row.assignmentId}:${row.weekday}:${row.startTime}:${row.endTime}:${row.startDate}:${row.endDate}`));
      check(ownerIds.size === 108 && saved.length === 420 && expected.size === 420,
        'Saved schedule counts differ from preview.');
      for (const row of saved) {
        const key = `${row.assignmentId}:${row.weekday}:${row.startTime}:${row.endTime}:${row.startDate}:${row.endDate}`;
        check(expected.delete(key) && row.classAdded === ADDED_AT && row.meetingAdded === ADDED_AT,
          'Saved meeting differs from preview.');
      }
      check(expected.size === 0, 'Some planned meetings were not saved.');
      await connection.commit();
      console.log(JSON.stringify({ result: 'complete', scheduledClassesCreated: ownerIds.size,
        weeklyMeetingsCreated: saved.length, dateAdded: ADDED_AT, verified: true,
        snapshotId }, null, 2));
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection?.release();
    await db.end();
  }
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  if (!['--preview', '--apply'].includes(process.argv[2]) || process.argv.length !== 3) {
    console.error('Usage: node scripts/scheduleSaintColumbanJhs.js --preview|--apply');
    process.exitCode = 1;
  } else {
    run({ apply: process.argv[2] === '--apply' }).catch(error => {
      console.error('JHS scheduling stopped:', error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { buildPlan, validatePlan, weeklyHours, assignDays, readScope, run };
