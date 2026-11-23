'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { createInterface } = require('node:readline/promises');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const DATES = [{ date: '2026-11-17', weekday: 2 }, { date: '2026-11-18', weekday: 3 }];
const CONFIRMATION = 'ADD ST PETER DEMO ATTENDANCE FOR SCHOOL 7';
const REMARK = 'Synthetic demo attendance; entered after the scheduled date.';

function check(condition, message) { if (!condition) throw new Error(message); }

function planSessions(meetings, sessions, studentIds) {
  const expected = new Map();
  for (const meeting of meetings) {
    const key = `${meeting.date}:${meeting.subjectId}`;
    if (expected.has(key)) check(Number(expected.get(key).teacherId) === Number(meeting.teacherId),
      `Conflicting teacher assignments for ${key}.`);
    else expected.set(key, meeting);
  }
  check(expected.size > 0, 'No scheduled St. Peter subjects on the selected dates.');
  const existing = new Set();
  for (const session of sessions) {
    const key = `${session.date}:${session.subjectId}`;
    check(expected.has(key) && !existing.has(key), `Unexpected or duplicate attendance session: ${key}.`);
    check(session.status === 'confirmed' && Number(session.recordCount) === studentIds.length &&
      session.studentIds.length === studentIds.length &&
      studentIds.every(id => session.studentIds.includes(id)),
    `Incomplete attendance session: ${key}.`);
    existing.add(key);
  }
  return [...expected].filter(([key]) => !existing.has(key)).map(([, meeting]) => meeting);
}

async function readScope(c) {
  const [[db]] = await c.query('SELECT DATABASE() AS name, @@FOREIGN_KEY_CHECKS AS fk');
  check(db.name === 'academix' && Number(db.fk) === 1,
    'Expected academix with foreign-key checks enabled.');
  const [sections] = await c.execute(`SELECT s.id FROM sections s
    JOIN schools school ON school.id=s.school_id AND school.registration_status='active'
    JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id AND y.status='active'
    JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
    JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
    WHERE s.school_id=? AND school.name=? AND s.name='St. Peter' AND s.status='active'
      AND y.label='2026-2027' AND g.grade_code='grade-7' AND l.level_code='jhs'`,
  [SCHOOL_ID, "Saint Columban's College"]);
  check(sections.length === 1, 'Expected one active Grade 7 St. Peter in school 7.');
  const sectionId = sections[0].id;
  const [students] = await c.execute(`SELECT e.student_user_id AS id FROM section_students e
    JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id
    WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
      AND u.role='student' AND u.account_status='active' ORDER BY e.student_user_id`,
  [SCHOOL_ID, sectionId]);
  check(students.length === 5, 'Expected the five enrolled St. Peter students.');
  const studentIds = students.map(row => Number(row.id));
  const meetings = [];
  for (const { date, weekday } of DATES) {
    const [rows] = await c.execute(`SELECT DISTINCT sub.id AS subjectId, sub.name AS subject,
      st.teacher_user_id AS teacherId FROM timetable_meetings tm
      JOIN scheduled_classes sc ON sc.id=tm.scheduled_class_id AND sc.school_id=tm.school_id
      JOIN section_teachers st ON st.id=sc.assignment_id AND st.school_id=sc.school_id
      JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
      JOIN users teacher ON teacher.id=st.teacher_user_id AND teacher.school_id=st.school_id
        AND teacher.role='teacher' AND teacher.account_status='active'
      WHERE tm.school_id=? AND st.section_id=? AND tm.weekday=?
        AND ? BETWEEN tm.start_date AND tm.end_date
      ORDER BY sub.name,sub.id`, [SCHOOL_ID, sectionId, weekday, date]);
    check(rows.length > 0, `No scheduled subjects on ${date}.`);
    meetings.push(...rows.map(row => ({ date, subjectId:Number(row.subjectId),
      subject:row.subject, teacherId:Number(row.teacherId) })));
  }
  const [rows] = await c.execute(`SELECT s.id, DATE_FORMAT(s.attendance_date,'%Y-%m-%d') AS date,
    s.subject_id AS subjectId, s.status, r.student_user_id AS studentId
    FROM attendance_sessions s LEFT JOIN attendance_records r
      ON r.attendance_session_id=s.id AND r.school_id=s.school_id
    WHERE s.school_id=? AND s.section_id=? AND s.attendance_date IN (?,?)
    ORDER BY s.id,r.student_user_id`, [SCHOOL_ID,sectionId,...DATES.map(d => d.date)]);
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(Number(row.id))) byId.set(Number(row.id), { date:row.date,
      subjectId:row.subjectId, status:row.status, recordCount:0, studentIds:[] });
    if (row.studentId !== null) {
      byId.get(Number(row.id)).recordCount++;
      byId.get(Number(row.id)).studentIds.push(Number(row.studentId));
    }
  }
  const missing = planSessions(meetings,[...byId.values()],studentIds);
  return { sectionId, studentIds, meetings, existingCount:byId.size, missing };
}

async function run({ apply=false, database, snapshot=takeSnapshot, confirm }={}) {
  const db = database || require('../config/database').getDatabase();
  let c; let transaction=false;
  try {
    c = await db.getConnection();
    const scope = await readScope(c);
    const preview = { mode:'preview', schoolId:SCHOOL_ID, section:'Grade 7 St. Peter',
      scheduledSubjectDates:scope.meetings.length, existingSessions:scope.existingCount,
      sessionsToAdd:scope.missing.length, recordsToAdd:scope.missing.length*scope.studentIds.length,
      missing:scope.missing.map(m => ({ date:m.date, subject:m.subject })),
      dataType:'synthetic demo', recordedAt:'actual execution time', confirmationPhrase:CONFIRMATION };
    console.log(JSON.stringify(preview,null,2));
    if (!apply || !scope.missing.length) return preview;
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input:process.stdin, output:process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing was added.'); return; }
    c.release(); c=null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    c = await db.getConnection();
    await c.beginTransaction(); transaction=true;
    const [locked] = await c.execute('SELECT id FROM sections WHERE school_id=? AND id=? FOR UPDATE',
      [SCHOOL_ID,scope.sectionId]);
    check(locked.length === 1, 'St. Peter was removed after preview.');
    const current = await readScope(c);
    check(JSON.stringify(current) === JSON.stringify(scope), 'St. Peter attendance changed after preview.');
    for (const meeting of current.missing) {
      const [created] = await c.execute(`INSERT INTO attendance_sessions
        (school_id,section_id,subject_id,attendance_date,method,status,
         created_by_user_id,confirmed_by_user_id,confirmed_at)
        VALUES (?,?,?,?,'manual','confirmed',?,?,NOW())`,
      [SCHOOL_ID,current.sectionId,meeting.subjectId,meeting.date,
        meeting.teacherId,meeting.teacherId]);
      for (const studentId of current.studentIds) await c.execute(`INSERT INTO attendance_records
        (school_id,attendance_session_id,student_user_id,attendance_status,remarks,marked_by_user_id)
        VALUES (?,?,?,'present',?,?)`,
      [SCHOOL_ID,created.insertId,studentId,REMARK,meeting.teacherId]);
    }
    await c.execute(`INSERT INTO audit_logs
      (school_id,actor_user_id,action_type,entity_type,entity_id,details)
      VALUES (?,NULL,'synthetic_demo_attendance_backfill','sections',?,?)`,
    [SCHOOL_ID,current.sectionId,JSON.stringify({ source:'synthetic_demo_data',
      dates:DATES.map(d => d.date),sessionsAdded:current.missing.length,snapshotId })]);
    const verified = await readScope(c);
    check(verified.missing.length === 0 &&
      verified.existingCount === current.meetings.length,
    'Attendance verification failed.');
    await c.commit(); transaction=false;
    const result = { result:'complete', schoolId:SCHOOL_ID,
      sessionsAdded:current.missing.length, recordsAdded:current.missing.length*current.studentIds.length,
      totalSessions:verified.existingCount, snapshotId, verified:true,
      dataType:'synthetic demo', recordedAt:'actual execution time' };
    console.log(JSON.stringify(result,null,2));
    return result;
  } catch (error) { if (transaction) await c.rollback(); throw error; }
  finally { c?.release(); if (!database) await db.end(); }
}

async function main() {
  check(process.env.DB_NAME === 'academix','DB_NAME must be academix.');
  const args=process.argv.slice(2);
  check(args.length === 1 && ['--preview','--apply'].includes(args[0]),'Use --preview or --apply.');
  await run({ apply:args[0] === '--apply' });
}
if (require.main === module) main().catch(error => {
  console.error('St. Peter demo attendance stopped:',error.message);
  process.exitCode=1;
});

module.exports={ run, planSessions };
