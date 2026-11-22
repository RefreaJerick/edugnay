'use strict';

const { createInterface } = require('node:readline/promises');
const path = require('node:path');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const ADDED_AT = '2026-11-17 12:00:00';
const START_DATE = '2026-11-17';
const CORE_END = '2027-06-30';
const ELECTIVE_END = '2026-12-31';
const CONFIRMATION = 'SCHEDULE GRADE 11 FOR SCHOOL 7';
const SECTIONS = [
  { name: 'St. Cecilia', elective: 'AE007' },
  { name: 'St. Philip', elective: 'AE001' },
  { name: 'St. Sebastian', elective: 'TP-ICT-05' }
];
const CORE_CODES = [
  'shs-core-communication',
  'shs-core-life-career',
  'shs-core-mathematics',
  'shs-core-science',
  'shs-core-philippine-history'
];
const CORE_HOURS = [10, 11, 13, 14, 15];

function check(value, message) {
  if (!value) throw new Error(message);
}

function meeting(owner, weekday, startHour, durationMinutes, endDate, component = null) {
  const start = startHour * 60;
  const end = start + durationMinutes;
  return {
    ...owner, weekday,
    startTime: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}:00`,
    endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00`,
    startDate: START_DATE, endDate, room: null,
    component
  };
}

function buildPlan(sections) {
  const plan = [];
  for (const [sectionIndex, section] of sections.entries()) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      plan.push(meeting(section.elective, weekday, 8, 60, ELECTIVE_END));
      plan.push(meeting(section.elective, weekday, 9, 60, ELECTIVE_END));
      for (let slot = 0; slot < CORE_HOURS.length; slot++) {
        const code = CORE_CODES[(slot + sectionIndex) % CORE_CODES.length];
        const hour = CORE_HOURS[slot];
        if (code === 'shs-core-communication') {
          plan.push(meeting(section.core.english, weekday, hour, 30, CORE_END, 'english'));
          plan.push(meeting(section.core.filipino, weekday, hour + 0.5, 30, CORE_END, 'filipino'));
        } else {
          plan.push(meeting(section.core[code], weekday, hour, 60, CORE_END));
        }
      }
    }
  }
  return plan;
}

function overlaps(a, b) {
  return a.weekday === b.weekday && a.startTime < b.endTime && a.endTime > b.startTime
    && a.startDate <= b.endDate && a.endDate >= b.startDate;
}

function validatePlan(plan) {
  check(plan.length === 120, `Expected 120 weekly meetings; found ${plan.length}.`);
  for (const [index, first] of plan.entries()) {
    for (const second of plan.slice(index + 1)) {
      if (!overlaps(first, second)) continue;
      check(first.sectionId !== second.sectionId, `Section schedule conflict in ${first.sectionName}.`);
      check(first.teacherId !== second.teacherId, `Teacher schedule conflict: ${first.teacherName}.`);
      check(!first.students.some(id => second.students.includes(id)), 'Student schedule conflict.');
    }
  }
  for (const section of SECTIONS) {
    const rows = plan.filter(row => row.sectionName === section.name);
    check(rows.length === 40, `${section.name} needs 40 weekly meeting records.`);
    for (let weekday = 1; weekday <= 5; weekday++) {
      const day = rows.filter(row => row.weekday === weekday);
      const minutes = day.reduce((sum, row) => {
        const [sh, sm] = row.startTime.split(':').map(Number);
        const [eh, em] = row.endTime.split(':').map(Number);
        return sum + (eh * 60 + em) - (sh * 60 + sm);
      }, 0);
      check(day.length === 8 && minutes === 420, `${section.name} weekday ${weekday} is not seven hours.`);
    }
  }
}

async function readScope(connection) {
  const { findConflict } = require('../controllers/timetablesController');
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1, 'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    'SELECT id FROM schools WHERE id=? AND name=? AND registration_status=?',
    [SCHOOL_ID, SCHOOL_NAME, 'active']);
  check(schools.length === 1, 'Expected active Saint Columban school ID 7.');
  const [years] = await connection.execute(
    `SELECT id, DATE_FORMAT(start_date,'%Y-%m-%d') AS startDate,
            DATE_FORMAT(end_date,'%Y-%m-%d') AS endDate
     FROM academic_years WHERE school_id=? AND label=? AND status=?`,
    [SCHOOL_ID, '2026-2027', 'active']);
  check(years.length === 1 && years[0].startDate <= START_DATE && years[0].endDate === CORE_END,
    'Expected active 2026-2027 year ending June 30.');
  const yearId = years[0].id;
  const [terms] = await connection.execute(
    `SELECT t.id, t.status, DATE_FORMAT(t.planned_start_date,'%Y-%m-%d') AS startDate,
            DATE_FORMAT(t.planned_end_date,'%Y-%m-%d') AS endDate
     FROM academic_terms t JOIN school_levels l ON l.id=t.school_level_id AND l.school_id=t.school_id
     WHERE t.school_id=? AND t.academic_year_id=? AND l.level_code='shs' AND t.sequence_number=1`,
    [SCHOOL_ID, yearId]);
  check(terms.length === 1 && terms[0].status === 'active' &&
    terms[0].startDate <= START_DATE && terms[0].endDate === ELECTIVE_END,
  'Expected active SHS Term 1 ending December 31.');
  const [sections] = await connection.execute(
    `SELECT s.id, s.name, s.grade_level_id AS gradeId
     FROM sections s JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
     WHERE s.school_id=? AND s.academic_year_id=? AND s.status='active' AND g.grade_code='grade-11'
       AND s.name IN ('St. Cecilia','St. Philip','St. Sebastian')`,
    [SCHOOL_ID, yearId]);
  check(sections.length === 3 && SECTIONS.every(expected => sections.some(s => s.name === expected.name)),
    'Expected the three active Grade 11 sections.');
  const [assignments] = await connection.execute(
    `SELECT a.id, a.section_id AS sectionId, a.teacher_user_id AS teacherId,
            a.communication_component_code AS component, sub.subject_code AS code,
            sub.name AS subjectName, u.display_name AS teacherName
     FROM section_teachers a JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=a.school_id
     JOIN users u ON u.id=a.teacher_user_id AND u.school_id=a.school_id
     WHERE a.school_id=? AND a.section_id IN (${sections.map(() => '?').join(',')})
       AND u.role='teacher' AND u.account_status='active' AND sub.is_active=1`,
    [SCHOOL_ID, ...sections.map(s => s.id)]);
  const core = assignments.filter(a => CORE_CODES.includes(a.code));
  check(core.length === 18, `Expected 18 active Grade 11 core assignments; found ${core.length}.`);
  const [classes] = await connection.execute(
    `SELECT c.id, c.teacher_user_id AS teacherId, u.display_name AS teacherName,
            o.catalog_code AS code, o.subject_name AS subjectName,
            c.start_term_id AS startTermId, c.end_term_id AS endTermId,
            first_term.sequence_number AS firstTerm, last_term.sequence_number AS lastTerm
     FROM shs_elective_classes c JOIN shs_offerings o ON o.id=c.offering_id AND o.school_id=c.school_id
     JOIN school_grade_levels g ON g.id=o.grade_level_id AND g.school_id=o.school_id
     JOIN users u ON u.id=c.teacher_user_id AND u.school_id=c.school_id
     JOIN academic_terms first_term ON first_term.id=c.start_term_id AND first_term.school_id=c.school_id
       AND first_term.academic_year_id=o.academic_year_id AND first_term.school_level_id=g.school_level_id
     JOIN academic_terms last_term ON last_term.id=c.end_term_id AND last_term.school_id=c.school_id
       AND last_term.academic_year_id=o.academic_year_id AND last_term.school_level_id=g.school_level_id
     WHERE c.school_id=? AND o.academic_year_id=? AND c.is_active=1 AND o.is_active=1
       AND g.grade_code='grade-11'
       AND u.role='teacher' AND u.account_status='active'
       AND o.catalog_code IN ('AE007','AE001','TP-ICT-05')`,
    [SCHOOL_ID, yearId]);
  check(classes.length === 3, 'Expected three active Grade 11 Term 1 elective classes.');
  const [enrollments] = await connection.execute(
    `SELECT section_id AS sectionId, student_user_id AS studentId FROM section_students
     WHERE school_id=? AND section_id IN (${sections.map(() => '?').join(',')}) AND withdrawn_at IS NULL
     ORDER BY section_id, student_user_id`,
    [SCHOOL_ID, ...sections.map(s => s.id)]);
  const [classStudents] = await connection.execute(
    `SELECT elective_class_id AS classId, student_user_id AS studentId FROM shs_elective_class_students
     WHERE school_id=? AND elective_class_id IN (${classes.map(() => '?').join(',')}) AND withdrawn_at IS NULL
     ORDER BY elective_class_id, student_user_id`,
    [SCHOOL_ID, ...classes.map(c => c.id)]);
  const scoped = SECTIONS.map(expected => {
    const section = sections.find(s => s.name === expected.name);
    const students = enrollments.filter(e => Number(e.sectionId) === Number(section.id)).map(e => Number(e.studentId));
    check(students.length === 5 && new Set(students).size === 5, `${expected.name} must have five students.`);
    const own = core.filter(a => Number(a.sectionId) === Number(section.id));
    const coreByCode = {};
    for (const code of CORE_CODES) {
      const matching = own.filter(a => a.code === code);
      if (code === 'shs-core-communication') {
        check(matching.length === 2 && matching.some(a => a.component === 'english') &&
          matching.some(a => a.component === 'filipino'), `${expected.name} needs both Communication teachers.`);
        for (const component of ['english','filipino']) {
          const a = matching.find(row => row.component === component);
          coreByCode[component] = { kind: 'core', ownerId: a.id, sectionId: section.id,
            sectionName: section.name, teacherId: a.teacherId, teacherName: a.teacherName,
            subjectName: component === 'english' ? 'Effective Communication' : 'Mabisang Komunikasyon', students };
        }
      } else {
        check(matching.length === 1 && matching[0].component == null,
          `${expected.name} needs one ${code} teacher.`);
        const a = matching[0];
        coreByCode[code] = { kind: 'core', ownerId: a.id, sectionId: section.id,
          sectionName: section.name, teacherId: a.teacherId, teacherName: a.teacherName,
          subjectName: a.subjectName, students };
      }
    }
    const matchingClasses = classes.filter(c => c.code === expected.elective &&
      Number(c.startTermId) === Number(terms[0].id));
    const elective = matchingClasses.find(c => {
      const members = classStudents.filter(row => Number(row.classId) === Number(c.id)).map(row => Number(row.studentId));
      return members.length === 5 && members.every(id => students.includes(id));
    });
    check(elective && matchingClasses.length === 1, `${expected.name} needs its expected Term 1 elective class.`);
    if (expected.elective === 'TP-ICT-05') {
      check(Number(elective.firstTerm) === 1 && Number(elective.lastTerm) === 3,
        'TechPro class must span Terms 1–3.');
    } else {
      check(Number(elective.firstTerm) === 1 && Number(elective.lastTerm) === 1,
        'Academic elective must begin and end in Term 1.');
    }
    return { ...section, students, core: coreByCode,
      elective: { kind: 'elective', ownerId: elective.id, sectionId: section.id,
        sectionName: section.name, teacherId: elective.teacherId, teacherName: elective.teacherName,
        subjectName: elective.subjectName, students } };
  });
  const plan = buildPlan(scoped);
  validatePlan(plan);
  const [existing] = await connection.execute(
    `SELECT id FROM scheduled_classes WHERE school_id=? AND
      (assignment_id IN (${core.map(() => '?').join(',')}) OR
       shs_elective_class_id IN (${scoped.map(() => '?').join(',')}))`,
    [SCHOOL_ID, ...core.map(a => a.id), ...scoped.map(s => s.elective.ownerId)]);
  check(existing.length === 0, 'A target class already has a schedule; nothing was added.');
  for (const row of plan) {
    const conflict = await findConflict(connection, SCHOOL_ID, yearId,
      { sectionId: row.kind === 'core' ? row.sectionId : null,
        electiveClassId: row.kind === 'elective' ? row.ownerId : null,
        teacherId: row.teacherId }, row, 0);
    check(!conflict, `Existing schedule conflicts with ${row.sectionName} ${row.subjectName} on weekday ${row.weekday}.`);
  }
  return { yearId, plan };
}

async function run({ apply = false, snapshot = takeSnapshot } = {}) {
  const { getDatabase } = require('../config/database');
  const db = getDatabase();
  let connection;
  try {
    connection = await db.getConnection();
    const { yearId, plan } = await readScope(connection);
    console.table(plan.map(row => ({ section: row.sectionName, day: ['','Mon','Tue','Wed','Thu','Fri'][row.weekday],
      time: `${row.startTime.slice(0,5)}-${row.endTime.slice(0,5)}`, subject: row.subjectName,
      teacher: row.teacherName, end: row.endDate })));
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID,
      scheduledClasses: 21, weeklyMeetings: plan.length, dateAdded: ADDED_AT,
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
      await connection.execute('SELECT id FROM academic_years WHERE id=? AND school_id=? FOR UPDATE', [yearId, SCHOOL_ID]);
      const checked = await readScope(connection);
      check(checked.plan.length === plan.length && checked.plan.every((row, i) =>
        row.ownerId === plan[i].ownerId && row.teacherId === plan[i].teacherId &&
        row.students.join(',') === plan[i].students.join(',')), 'Schedule scope changed after preview.');
      const ownerIds = new Map();
      for (const row of plan) {
        const key = `${row.kind}:${row.ownerId}`;
        if (ownerIds.has(key)) continue;
        const [created] = await connection.execute(
          `INSERT INTO scheduled_classes (school_id, assignment_id, shs_elective_class_id, created_at)
           VALUES (?, ?, ?, ?)`,
          [SCHOOL_ID, row.kind === 'core' ? row.ownerId : null,
            row.kind === 'elective' ? row.ownerId : null, ADDED_AT]);
        ownerIds.set(key, created.insertId);
      }
      for (const row of plan) {
        await connection.execute(
          `INSERT INTO timetable_meetings
           (school_id, scheduled_class_id, weekday, start_time, end_time, start_date, end_date, room, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [SCHOOL_ID, ownerIds.get(`${row.kind}:${row.ownerId}`), row.weekday, row.startTime,
            row.endTime, row.startDate, row.endDate, null, ADDED_AT, ADDED_AT]);
      }
      const [verified] = await connection.execute(
        `SELECT sc.id, sc.assignment_id AS assignmentId, sc.shs_elective_class_id AS electiveId,
                DATE_FORMAT(sc.created_at,'%Y-%m-%d %H:%i:%s') AS added,
                tm.weekday, TIME_FORMAT(tm.start_time,'%H:%i:%s') AS startTime,
                TIME_FORMAT(tm.end_time,'%H:%i:%s') AS endTime,
                DATE_FORMAT(tm.start_date,'%Y-%m-%d') AS startDate,
                DATE_FORMAT(tm.end_date,'%Y-%m-%d') AS endDate,
                DATE_FORMAT(tm.created_at,'%Y-%m-%d %H:%i:%s') AS meetingAdded
         FROM scheduled_classes sc JOIN timetable_meetings tm ON tm.scheduled_class_id=sc.id AND tm.school_id=sc.school_id
         WHERE sc.school_id=? AND sc.id IN (${[...ownerIds.values()].map(() => '?').join(',')})`,
        [SCHOOL_ID, ...ownerIds.values()]);
      const expected = new Map();
      for (const row of plan) {
        const key = `${ownerIds.get(`${row.kind}:${row.ownerId}`)}:${row.weekday}:${row.startTime}:${row.endTime}:${row.startDate}:${row.endDate}`;
        check(!expected.has(key), 'Duplicate planned meeting.');
        expected.set(key, row);
      }
      check(ownerIds.size === 21 && verified.length === 120, 'Saved schedule counts differ from preview.');
      for (const row of verified) {
        const key = `${row.id}:${row.weekday}:${row.startTime}:${row.endTime}:${row.startDate}:${row.endDate}`;
        const source = expected.get(key);
        check(source && row.added === ADDED_AT && row.meetingAdded === ADDED_AT &&
          Number(source.ownerId) === Number(row.assignmentId || row.electiveId), 'Saved meeting differs from preview.');
        expected.delete(key);
      }
      check(expected.size === 0, 'Some planned meetings were not saved.');
      await connection.commit();
      console.log(JSON.stringify({ result: 'complete', scheduledClassesCreated: ownerIds.size,
        weeklyMeetingsCreated: verified.length, dateAdded: ADDED_AT,
        verified: true, snapshotId }, null, 2));
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
    console.error('Usage: node scripts/scheduleSaintColumbanGrade11.js --preview|--apply');
    process.exitCode = 1;
  } else {
    run({ apply: process.argv[2] === '--apply' }).catch(error => {
      console.error('Grade 11 scheduling stopped:', error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { buildPlan, validatePlan, readScope, run, SECTIONS, CONFIRMATION };
