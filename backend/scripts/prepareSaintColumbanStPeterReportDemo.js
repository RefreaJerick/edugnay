'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');
const { buildWeeklyEvidence } = require('../controllers/narrativeReportEvidenceController');

const SCHOOL_ID = 7;
const WEEK = 'week:2026-11-16';
const CONFIRMATION = 'RESET 5 ST PETER REPORTS FOR SCHOOL 7';
const ROSTER = ['Isabel Camille Del Rosario', 'Marco Daniel Dimaculangan',
  'Angela Rose Evangelista', 'Luis Mateo Fajardo', 'Francesca Marie Velasco'];
const TRIGGER_NAME = 'narrative_release_no_delete';
const TRIGGER_SQL = `CREATE TRIGGER narrative_release_no_delete BEFORE DELETE ON narrative_report_releases
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'`;
const DATES = [{ date: '2026-11-17', day: 2 }, { date: '2026-11-18', day: 3 },
  { date: '2026-11-19', day: 4 }, { date: '2026-11-20', day: 5 }];
const WORK = [
  { subject: 'Mathematics', title: 'Linear Equations Practice', due: '2026-11-19 15:00:00',
    statuses: ['submitted', 'not_submitted', 'submitted', 'late', 'submitted'] },
  { subject: 'Science', title: 'Ecosystem Observation Sheet', due: '2026-11-20 15:00:00',
    statuses: ['late', 'not_submitted', 'submitted', 'submitted', 'not_submitted'] }
];
const ITEMS = [
  { subject: 'Mathematics', title: 'Quiz 3', kind: 'written', time: '2026-11-19 10:20:00', scores: [11, 16, 18, 13, 17] },
  { subject: 'Mathematics', title: 'Problem Set 1', kind: 'written', time: '2026-11-19 11:20:00', scores: [12, 14, 17, 18, 15] },
  { subject: 'Mathematics', title: 'Problem Solving Task', kind: 'performance', time: '2026-11-20 10:20:00', scores: [10, 13, 19, 16, 17] },
  { subject: 'Science', title: 'Quiz 3', kind: 'written', time: '2026-11-19 13:20:00', scores: [16, 11, 17, 14, 18] },
  { subject: 'Science', title: 'Lab Worksheet 1', kind: 'written', time: '2026-11-20 09:20:00', scores: [18, 12, 15, 17, 13] },
  { subject: 'Science', title: 'Investigation Task', kind: 'performance', time: '2026-11-20 13:20:00', scores: [15, 10, 19, 16, 14] }
];

function check(ok, message) { if (!ok) throw new Error(message); }
function placeholders(values) { return values.map(() => '?').join(','); }
function scoreBand(scores) {
  return { below75: scores.filter(score => score < 15).length,
    atLeast75: scores.filter(score => score >= 15).length };
}
function attendanceStatus(studentIndex, date, subject) {
  if (studentIndex === 0 && date === '2026-11-19' && subject === 'Mathematics') return 'absent';
  if (studentIndex === 1 && date === '2026-11-20' && subject === 'Science') return 'absent';
  if ((studentIndex + Number(date.slice(-2)) + subject.length) % 7 === 0) return 'late';
  return 'present';
}
function assertServiceStopped() {
  if (process.platform !== 'linux') throw new Error('Apply must run on the EC2 Linux host.');
  let state;
  try { state = execFileSync('systemctl', ['is-active', 'academix'], { encoding: 'utf8' }).trim(); }
  catch (error) { state = String(error.stdout || '').trim(); }
  check(state === 'inactive' || state === 'failed',
    `Stop academix before applying (systemd status: ${state || 'unknown'}).`);
}
function assertRdsTarget() {
  const endpoint=execFileSync('aws', ['rds','describe-db-instances',
    '--db-instance-identifier','academix-test-db','--region','ap-southeast-2',
    '--query','DBInstances[0].Endpoint.Address','--output','text'], { encoding:'utf8' }).trim();
  check(endpoint && endpoint!=='None' && process.env.DB_HOST===endpoint,
    'DB_HOST is not the endpoint of academix-test-db.');
}

async function readScope(c) {
  const [[db]] = await c.query('SELECT DATABASE() AS name, @@FOREIGN_KEY_CHECKS AS fk');
  check(db.name === 'academix' && Number(db.fk) === 1,
    'Expected academix with foreign-key checks enabled.');
  const [sections] = await c.execute(`SELECT s.id, s.academic_year_id AS yearId,
    s.adviser_user_id AS adviserId FROM sections s
    JOIN schools school ON school.id=s.school_id AND school.name=? AND school.registration_status='active'
    JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id AND y.status='active'
    JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
    JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
    WHERE s.school_id=? AND s.name='St. Peter' AND s.status='active'
      AND y.label='2026-2027' AND g.grade_code='grade-7' AND l.level_code='jhs'`,
  ["Saint Columban's College", SCHOOL_ID]);
  check(sections.length === 1, 'Expected one active Grade 7 St. Peter in school 7.');
  const section = sections[0];
  const [adviser] = await c.execute(`SELECT id FROM users WHERE school_id=? AND id=?
    AND role='teacher' AND account_status='active' AND display_name='Ramon Jose Hermoso'`,
  [SCHOOL_ID, section.adviserId]);
  check(adviser.length === 1, 'Expected Ramon Jose Hermoso as adviser.');
  const [terms] = await c.execute(`SELECT id FROM academic_terms WHERE school_id=?
    AND academic_year_id=? AND school_level_id=(SELECT school_level_id FROM sections WHERE id=?)
    AND sequence_number=1 AND status='active'`, [SCHOOL_ID, section.yearId, section.id]);
  check(terms.length === 1, 'Expected one active JHS Term 1.');
  const [students] = await c.execute(`SELECT u.id, u.display_name AS name FROM section_students e
    JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id
    WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
      AND u.role='student' AND u.account_status='active'
    ORDER BY u.last_name,u.first_name,u.id`, [SCHOOL_ID, section.id]);
  check(students.length === 5 && students.every((row, i) => row.name === ROSTER[i]),
    'St. Peter roster differs from the expected five students.');
  const [subjects] = await c.execute(`SELECT sub.id,sub.name,st.teacher_user_id AS teacherId
    FROM section_teachers st JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
    JOIN users teacher ON teacher.id=st.teacher_user_id AND teacher.school_id=st.school_id
    WHERE st.school_id=? AND st.section_id=? AND sub.name IN ('Mathematics','Science')
      AND teacher.role='teacher' AND teacher.account_status='active'
    ORDER BY sub.name`, [SCHOOL_ID, section.id]);
  check(subjects.length === 2 && new Set(subjects.map(s => s.name)).size === 2,
    'Expected assigned Mathematics and Science teachers.');
  const [components] = await c.execute(`SELECT gi.subject_id AS subjectId,
    gi.grading_category_id AS categoryId, gi.subject_grading_component_id AS componentId,
    comp.component_type AS kind FROM grading_items gi
    JOIN subject_grading_components comp ON comp.id=gi.subject_grading_component_id AND comp.school_id=gi.school_id
    WHERE gi.school_id=? AND gi.section_id=? AND gi.academic_term_id=?
      AND gi.subject_id IN (?,?) AND comp.component_type IN ('written','performance')
    GROUP BY gi.subject_id,gi.grading_category_id,gi.subject_grading_component_id,comp.component_type
    ORDER BY gi.subject_id,comp.component_type`,
  [SCHOOL_ID, section.id, terms[0].id, ...subjects.map(s => s.id)]);
  check(subjects.every(s => ['written', 'performance'].every(kind =>
    components.filter(row => Number(row.subjectId) === Number(s.id) && row.kind === kind).length === 1)),
  'Expected one written and one performance grading component per subject.');
  const [reports] = await c.execute(`SELECT id,student_user_id AS studentId,report_status AS status,
    released_at AS releasedAt FROM narrative_reports
    WHERE school_id=? AND section_id=? AND report_period_key=? ORDER BY student_user_id`,
  [SCHOOL_ID, section.id, WEEK]);
  check(reports.length === 5 && reports.every(r => r.status === 'confirmed' && r.releasedAt) &&
    students.every(s => reports.some(r => Number(r.studentId) === Number(s.id))),
  'Expected exactly five released St. Peter reports for November 16–21.');
  const reportIds = reports.map(r => Number(r.id));
  const [releases] = await c.execute(`SELECT id,narrative_report_id AS reportId,version_number AS version
    FROM narrative_report_releases WHERE school_id=? AND narrative_report_id IN (${placeholders(reportIds)})
    ORDER BY id`,
  [SCHOOL_ID, ...reportIds]);
  check(releases.length === 5 && releases.every(r => Number(r.version) === 1),
    'Expected exactly one release version for each report.');
  const releaseIds = releases.map(r => Number(r.id));
  const [[links]] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM report_recommendations WHERE narrative_report_id IN (${placeholders(reportIds)})) AS recommendations,
    (SELECT COUNT(*) FROM report_data_sources WHERE narrative_report_id IN (${placeholders(reportIds)})) AS sources,
    (SELECT COUNT(*) FROM report_reopen_requests WHERE narrative_report_id IN (${placeholders(reportIds)})) AS reopenRequests,
    (SELECT COUNT(*) FROM narrative_report_sms_outbox WHERE school_id=? AND report_release_id IN (${placeholders(releaseIds)})) AS sms`,
  [...reportIds, ...reportIds, ...reportIds, SCHOOL_ID, ...releaseIds]);
  check(Number(links.reopenRequests) === 0 && Number(links.sms) === 0,
    'Existing report correction requests or SMS outbox rows need review before reset.');
  const [notifications] = await c.execute(`SELECT n.id,n.event_key AS eventKey FROM notifications n
    WHERE n.user_id IN (SELECT parent_user_id FROM student_parent_links
      WHERE school_id=? AND student_user_id IN (${placeholders(students)}))
      AND n.event_key IN (${placeholders(reportIds)}) ORDER BY n.id`,
  [SCHOOL_ID, ...students.map(s => s.id), ...reportIds.map(id => `narrative-report:${id}:released`)]);
  const notificationIds = notifications.map(n => Number(n.id));
  const [[push]] = notificationIds.length ? await c.execute(`SELECT COUNT(*) AS n
    FROM notification_push_deliveries WHERE notification_id IN (${placeholders(notificationIds)})`, notificationIds)
    : [[{ n: 0 }]];
  check(Number(push.n) === 0, 'Report notifications have queued push deliveries; review before reset.');
  const [otherNotifications] = await c.execute(`SELECT id FROM notifications
    WHERE event_key IN (${placeholders(reportIds)}) AND id NOT IN (${placeholders(notificationIds.length ? notificationIds : [0])})`,
  [...reportIds.map(id => `narrative-report:${id}:released`), ...(notificationIds.length ? notificationIds : [0])]);
  check(otherNotifications.length === 0, 'Unexpected report notification recipients.');
  const [existingItems] = await c.execute(`SELECT title FROM grading_items WHERE school_id=? AND section_id=?
    AND academic_term_id=? AND subject_id IN (?,?)`,
  [SCHOOL_ID, section.id, terms[0].id, ...subjects.map(s => s.id)]);
  check(ITEMS.every(item => !existingItems.some(row => row.title === item.title)),
    'One of the planned score item titles already exists.');
  const [existingAssignments] = await c.execute(`SELECT id FROM assignments WHERE school_id=? AND section_id=?
    AND subject_id IN (?,?) AND DATE(due_at) BETWEEN '2026-11-16' AND '2026-11-21'`,
  [SCHOOL_ID, section.id, ...subjects.map(s => s.id)]);
  check(existingAssignments.length === 0, 'St. Peter already has Mathematics or Science assignments this week.');
  const [meetings] = await c.execute(`SELECT DISTINCT tm.weekday AS day,sub.id AS subjectId,sub.name AS subject,
    st.teacher_user_id AS teacherId,DATE_FORMAT(tm.start_date,'%Y-%m-%d') AS startDate,
    DATE_FORMAT(tm.end_date,'%Y-%m-%d') AS endDate FROM timetable_meetings tm
    JOIN scheduled_classes sc ON sc.id=tm.scheduled_class_id AND sc.school_id=tm.school_id
    JOIN section_teachers st ON st.id=sc.assignment_id AND st.school_id=sc.school_id
    JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
    WHERE tm.school_id=? AND st.section_id=? AND tm.weekday IN (2,3,4,5)
      AND tm.start_date <= '2026-11-20' AND tm.end_date >= '2026-11-17'
    ORDER BY tm.weekday,sub.id`,
  [SCHOOL_ID, section.id]);
  const scheduledRows = DATES.flatMap(d => meetings.filter(m => Number(m.day) === d.day &&
    m.startDate <= d.date && m.endDate >= d.date)
    .map(m => ({ date:d.date, subjectId:Number(m.subjectId), subject:m.subject, teacherId:Number(m.teacherId) })));
  const scheduled = [...new Map(scheduledRows.map(m => [`${m.date}:${m.subjectId}`,m])).values()];
  check(scheduled.length > 0 && scheduled.every(m =>
    subjects.some(s => Number(s.id) === m.subjectId) || m.teacherId > 0), 'Invalid St. Peter timetable.');
  const [attendance] = await c.execute(`SELECT s.id,DATE_FORMAT(s.attendance_date,'%Y-%m-%d') AS date,
    s.subject_id AS subjectId,s.status,r.student_user_id AS studentId FROM attendance_sessions s
    LEFT JOIN attendance_records r ON r.attendance_session_id=s.id AND r.school_id=s.school_id
    WHERE s.school_id=? AND s.section_id=? AND s.attendance_date BETWEEN '2026-11-17' AND '2026-11-20'
    ORDER BY s.id,r.student_user_id`, [SCHOOL_ID, section.id]);
  const bySession = new Map();
  for (const row of attendance) {
    if (!bySession.has(Number(row.id))) bySession.set(Number(row.id),
      { date:row.date, subjectId:Number(row.subjectId), status:row.status, studentIds:[] });
    if (row.studentId != null) bySession.get(Number(row.id)).studentIds.push(Number(row.studentId));
  }
  const existingKeys = new Set();
  for (const row of bySession.values()) {
    const key = `${row.date}:${row.subjectId}`;
    check(!existingKeys.has(key) && scheduled.some(m => `${m.date}:${m.subjectId}` === key) &&
      row.status === 'confirmed' && row.studentIds.length === 5 &&
      students.every(s => row.studentIds.includes(Number(s.id))),
    `Incomplete or unexpected attendance session ${key}.`);
    existingKeys.add(key);
  }
  const missing = scheduled.filter(m => !existingKeys.has(`${m.date}:${m.subjectId}`));
  const [trigger] = await c.query(`SHOW CREATE TRIGGER ${TRIGGER_NAME}`);
  check(trigger.length === 1 && String(trigger[0]['SQL Original Statement']).includes(
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"),
  'The released-report protection trigger differs from the expected rule.');
  return { section, termId:Number(terms[0].id), students, subjects, components,
    reportIds, releaseIds, notificationIds, links, missing,
    existingSessions:bySession.size, scheduledSessions:scheduled.length };
}

async function verify(c, scope) {
  const [reports] = await c.execute(`SELECT id FROM narrative_reports
    WHERE school_id=? AND section_id=? AND report_period_key=?`, [SCHOOL_ID,scope.section.id,WEEK]);
  check(reports.length === 0, 'St. Peter reports remain for this week.');
  const [releases] = await c.execute(`SELECT id FROM narrative_report_releases WHERE id IN (${placeholders(scope.releaseIds)})`,
    scope.releaseIds);
  check(releases.length === 0, 'St. Peter release snapshots remain.');
  const [notices] = await c.execute(`SELECT id FROM notifications WHERE id IN (${placeholders(scope.notificationIds.length ? scope.notificationIds : [0])})`,
    scope.notificationIds.length ? scope.notificationIds : [0]);
  check(notices.length === 0, 'Old parent report notifications remain.');
  const [[counts]] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=?
      AND title IN (${placeholders(ITEMS)})) AS items,
    (SELECT COUNT(*) FROM student_scores sc JOIN grading_items gi ON gi.id=sc.grading_item_id
      WHERE gi.school_id=? AND gi.section_id=? AND gi.title IN (${placeholders(ITEMS)})) AS scores,
    (SELECT COUNT(*) FROM assignments WHERE school_id=? AND section_id=?
      AND title IN (${placeholders(WORK)})) AS assignments,
    (SELECT COUNT(*) FROM attendance_sessions WHERE school_id=? AND section_id=?
      AND attendance_date BETWEEN '2026-11-17' AND '2026-11-20') AS sessions`,
  [SCHOOL_ID,scope.section.id,...ITEMS.map(i => i.title),SCHOOL_ID,scope.section.id,
    ...ITEMS.map(i => i.title),SCHOOL_ID,scope.section.id,...WORK.map(w => w.title),
    SCHOOL_ID,scope.section.id]);
  check(Number(counts.items) === 6 && Number(counts.scores) === 30 &&
    Number(counts.assignments) === 2 && Number(counts.sessions) === scope.scheduledSessions,
  'New St. Peter demo evidence failed verification.');
  const [submissions] = await c.execute(`SELECT a.title,s.submission_status AS status,COUNT(*) AS n
    FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id
    WHERE a.school_id=? AND a.section_id=? AND a.title IN (?,?)
    GROUP BY a.title,s.submission_status`,
  [SCHOOL_ID,scope.section.id,...WORK.map(w => w.title)]);
  check(submissions.reduce((n,row) => n+Number(row.n),0) === 10 &&
    WORK.every(w => ['submitted','late','not_submitted'].every(status =>
      Number(submissions.find(row => row.title === w.title && row.status === status)?.n || 0) ===
      w.statuses.filter(value => value === status).length)),
  'Manual assignment statuses failed verification.');
  const [[fk]] = await c.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
  check(Number(fk.enabled) === 1, 'Foreign-key checks were disabled.');
  return counts;
}

async function run({ apply=false, database, snapshot=takeSnapshot, confirm,
  serviceStopped=assertServiceStopped, targetChecked=assertRdsTarget, scopeReader=readScope,
  verifyScope=verify, evidenceBuilder=buildWeeklyEvidence }={}) {
  const db = database || require('../config/database').getDatabase();
  let c; let transaction=false; let triggerDropped=false; let committed=false;
  try {
    c = await db.getConnection();
    const scope = await scopeReader(c);
    const allScores = ITEMS.flatMap(item => item.scores);
    const preview = { mode:'preview', schoolId:SCHOOL_ID, section:'Grade 7 St. Peter',
      reportWeek:'2026-11-16 to 2026-11-21', students:scope.students.map(s => s.name),
      remove:{ reports:scope.reportIds, releases:scope.releaseIds,
        recommendations:Number(scope.links.recommendations),sources:Number(scope.links.sources),
        parentNotifications:scope.notificationIds },
      add:{ scoreItems:ITEMS.length,scores:allScores.length,scoreBands:scoreBand(allScores),
        manualAssignments:WORK.map(w => ({ subject:w.subject,title:w.title,due:w.due,
          statuses:Object.fromEntries(['submitted','late','not_submitted'].map(status =>
            [status,w.statuses.filter(value => value === status).length])) })),
        attendanceSessions:scope.missing.length,attendanceRecords:scope.missing.length*5 },
      preserved:'All existing grades, journals, scores, students, and attendance',
      dataType:'synthetic demo; execution logged at actual time',
      confirmationPhrase:CONFIRMATION };
    console.log(JSON.stringify(preview,null,2));
    if (!apply) return preview;
    serviceStopped();
    targetChecked();
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input:process.stdin, output:process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing changed.'); return; }
    c.release(); c=null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId=snapshot();
    c=await db.getConnection();
    const current=await scopeReader(c);
    check(JSON.stringify(current) === JSON.stringify(scope), 'St. Peter data changed after preview.');
    await c.query(`DROP TRIGGER ${TRIGGER_NAME}`); triggerDropped=true;
    await c.beginTransaction(); transaction=true;
    await c.execute('SELECT id FROM sections WHERE school_id=? AND id=? FOR UPDATE',
      [SCHOOL_ID,scope.section.id]);
    const reportRows=await c.execute(`SELECT id FROM narrative_reports WHERE school_id=? AND section_id=?
      AND report_period_key=? FOR UPDATE`,[SCHOOL_ID,scope.section.id,WEEK]);
    check(reportRows[0].length===5 && reportRows[0].every(r=>scope.reportIds.includes(Number(r.id))),
      'Report set changed after preview.');
    if (scope.notificationIds.length) {
      const [removed]=await c.execute(`DELETE FROM notifications
        WHERE id IN (${placeholders(scope.notificationIds)})`,scope.notificationIds);
      check(removed.affectedRows===scope.notificationIds.length,'Parent notifications changed after preview.');
    }
    const [removedReleases]=await c.execute(`DELETE FROM narrative_report_releases WHERE school_id=?
      AND id IN (${placeholders(scope.releaseIds)})`,[SCHOOL_ID,...scope.releaseIds]);
    check(removedReleases.affectedRows===scope.releaseIds.length,'Report releases changed after preview.');
    const [removedSources]=await c.execute(`DELETE FROM report_data_sources
      WHERE narrative_report_id IN (${placeholders(scope.reportIds)})`,scope.reportIds);
    check(removedSources.affectedRows===Number(scope.links.sources),'Report sources changed after preview.');
    const [removedRecommendations]=await c.execute(`DELETE FROM report_recommendations
      WHERE narrative_report_id IN (${placeholders(scope.reportIds)})`,scope.reportIds);
    check(removedRecommendations.affectedRows===Number(scope.links.recommendations),
      'Report recommendations changed after preview.');
    const [removedReports]=await c.execute(`DELETE FROM narrative_reports WHERE school_id=? AND section_id=?
      AND report_period_key=? AND id IN (${placeholders(scope.reportIds)})`,
    [SCHOOL_ID,scope.section.id,WEEK,...scope.reportIds]);
    check(removedReports.affectedRows===scope.reportIds.length,'St. Peter reports changed after preview.');
    for (const item of ITEMS) {
      const subject=scope.subjects.find(s=>s.name===item.subject);
      const component=scope.components.find(row=>Number(row.subjectId)===Number(subject.id) && row.kind===item.kind);
      const [created]=await c.execute(`INSERT INTO grading_items
        (school_id,section_id,subject_id,academic_term_id,grading_category_id,
         subject_grading_component_id,teacher_user_id,title,max_score,recorded_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,20,?,?,?)`,
      [SCHOOL_ID,scope.section.id,subject.id,scope.termId,component.categoryId,
        component.componentId,subject.teacherId,item.title,item.time,item.time,item.time]);
      for (const [index,student] of scope.students.entries()) await c.execute(`INSERT INTO student_scores
        (school_id,grading_item_id,student_user_id,score,recorded_by_user_id,recorded_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`,
      [SCHOOL_ID,created.insertId,student.id,item.scores[index],subject.teacherId,item.time,item.time]);
    }
    for (const work of WORK) {
      const subject=scope.subjects.find(s=>s.name===work.subject);
      const published=work.due.slice(0,10)+' 08:00:00';
      const [assignment]=await c.execute(`INSERT INTO assignments
        (school_id,section_id,subject_id,academic_term_id,teacher_user_id,title,description,
         due_at,published_at,online_submission_enabled,allow_late_submissions,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, ?,?,0,1,'published',?,?)`,
      [SCHOOL_ID,scope.section.id,subject.id,scope.termId,subject.teacherId,work.title,
        'Complete the activity on paper and submit it to your teacher.',work.due,published,published,published]);
      for (const [index,student] of scope.students.entries()) {
        const status=work.statuses[index];
        const submitted=status==='not_submitted' ? null : status==='late'
          ? work.due.slice(0,10)+' 16:10:00' : work.due.slice(0,10)+' 13:40:00';
        const updated=submitted || work.due.slice(0,10)+' 16:30:00';
        await c.execute(`INSERT INTO assignment_submissions
          (school_id,assignment_id,student_user_id,submission_status,submitted_at,updated_at)
          VALUES (?,?,?,?,?,?)`,[SCHOOL_ID,assignment.insertId,student.id,status,submitted,updated]);
      }
    }
    for (const meeting of scope.missing) {
      const confirmed=meeting.date+' 16:45:00';
      const [session]=await c.execute(`INSERT INTO attendance_sessions
        (school_id,section_id,subject_id,attendance_date,method,status,
         created_by_user_id,confirmed_by_user_id,confirmed_at,created_at,updated_at)
        VALUES (?,?,?,?,'manual','confirmed',?,?,?,?,?)`,
      [SCHOOL_ID,scope.section.id,meeting.subjectId,meeting.date,meeting.teacherId,
        meeting.teacherId,confirmed,confirmed,confirmed]);
      for (const [index,student] of scope.students.entries()) await c.execute(`INSERT INTO attendance_records
        (school_id,attendance_session_id,student_user_id,attendance_status,
         marked_by_user_id,marked_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`,
      [SCHOOL_ID,session.insertId,student.id,attendanceStatus(index,meeting.date,meeting.subject),
        meeting.teacherId,confirmed,confirmed]);
    }
    await c.execute(`INSERT INTO audit_logs
      (school_id,actor_user_id,action_type,entity_type,entity_id,details)
      VALUES (?,NULL,'synthetic_demo_st_peter_week_reset','sections',?,?)`,
    [SCHOOL_ID,scope.section.id,JSON.stringify({ source:'synthetic_demo_data',week:WEEK,
      deletedReports:scope.reportIds,snapshotId,scoreItems:ITEMS.length,assignments:WORK.length,
      attendanceSessions:scope.missing.length })]);
    await verifyScope(c,scope);
    const evidence=await evidenceBuilder({ schoolId:SCHOOL_ID,teacherId:scope.section.adviserId,
      sectionId:scope.section.id,startDate:'2026-11-16',database:c });
    check(evidence.students.length===5 && evidence.students.every(student=>
      student.assignments.total===2 && student.academicScores.some(row=>
        ITEMS.some(item=>item.title===row.title && item.subject===row.subjectName))),
    'New assignments or score items are missing from report evidence.');
    check(evidence.students.filter(student=>student.followUpCandidate).length===2 &&
      ['Isabel Camille Del Rosario','Marco Daniel Dimaculangan'].every(name=>
        evidence.students.some(student=>student.displayName===name && student.followUpCandidate)),
    'Expected exactly Isabel and Marco to be follow-up candidates.');
    await c.commit(); transaction=false; committed=true;
    await c.query(TRIGGER_SQL); triggerDropped=false;
    const [restored]=await c.query(`SHOW CREATE TRIGGER ${TRIGGER_NAME}`);
    check(restored.length===1 && String(restored[0]['SQL Original Statement']).includes(
      "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"),
    'Released-report protection was not restored. Keep Academix stopped.');
    const result={ result:'complete',schoolId:SCHOOL_ID,reportWeek:WEEK,
      reportsRemoved:scope.reportIds.length,scoreItemsAdded:ITEMS.length,scoresAdded:30,
      assignmentsAdded:WORK.length,attendanceSessionsAdded:scope.missing.length,
      snapshotId,verified:true };
    console.log(JSON.stringify(result,null,2));
    return result;
  } catch(error) {
    if(transaction) await c.rollback();
    if(committed) error.message+= ' Data committed; check trigger restoration before starting Academix.';
    throw error;
  } finally {
    if(triggerDropped) {
      try {
        await c.query(TRIGGER_SQL);
        const [rows]=await c.query(`SHOW CREATE TRIGGER ${TRIGGER_NAME}`);
        check(rows.length===1 && String(rows[0]['SQL Original Statement']).includes(
          "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"),
        'Released-report protection was not restored. Keep Academix stopped.');
        console.log('Released-report protection restored.');
      } catch(error) {
        console.error('CRITICAL: Released-report protection could not be restored. Keep Academix stopped.',error.message);
        process.exitCode=1;
        throw error;
      }
    }
    c?.release(); if(!database) await db.end();
  }
}

async function main() {
  check(process.env.DB_NAME==='academix','DB_NAME must be academix.');
  const args=process.argv.slice(2);
  check(args.length===1 && ['--preview','--apply','--restore-trigger'].includes(args[0]),
    'Use --preview, --apply, or --restore-trigger.');
  if (args[0]==='--restore-trigger') {
    assertServiceStopped();
    assertRdsTarget();
    const db=require('../config/database').getDatabase();
    let c;
    try {
      c=await db.getConnection();
      const [[state]]=await c.query('SELECT DATABASE() AS name, @@FOREIGN_KEY_CHECKS AS fk');
      check(state.name==='academix' && Number(state.fk)===1,'Wrong database or foreign-key checks disabled.');
      const [before]=await c.execute(`SELECT ACTION_STATEMENT AS body FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?`,[TRIGGER_NAME]);
      check(before.length===0 || before.length===1 && String(before[0].body).includes(
        "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"),
      'The existing report protection trigger differs from the expected rule.');
      if (!before.length) await c.query(TRIGGER_SQL);
      const [after]=await c.query(`SHOW CREATE TRIGGER ${TRIGGER_NAME}`);
      check(after.length===1 && String(after[0]['SQL Original Statement']).includes(
        "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"),
      'Released-report protection is not active. Keep Academix stopped.');
      console.log('Released-report protection is active.');
    } finally { c?.release(); await db.end(); }
    return;
  }
  await run({ apply:args[0]==='--apply' });
}
if(require.main===module) main().catch(error=>{
  console.error('St. Peter week preparation stopped:',error.message);
  process.exitCode=1;
});

module.exports={ run, scoreBand, attendanceStatus, DATES, ITEMS, WORK };
