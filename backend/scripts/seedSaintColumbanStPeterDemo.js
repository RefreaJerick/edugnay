'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const bcrypt = require('bcrypt');
const { createInterface } = require('node:readline/promises');
const { planItems } = require('./seedSaintColumbanStJohnTerm1Grades');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');
const { buildFinalGradePreview } = require('../controllers/gradesController');
const { buildWeeklyEvidence } = require('../controllers/narrativeReportEvidenceController');
const { generateWithQuota, manilaDate } = require('../services/aiReportUsage');
const { DEFAULT_CRITERIA, generateJournalAssessment } = require('../services/journalAssessmentAi');

const SCHOOL_ID = 7;
const CONFIRMATION = 'SEED ST PETER TERM 1 DEMO FOR SCHOOL 7';
const PROMPT = 'What is one kind thing you did for someone this week? Describe what happened, how the person responded, and what you learned.';
const PARENT = { first: 'Marissa', last: 'Del Rosario', schoolEmail: 'm.delrosario.par@scc.academix.test',
  personalEmail: 'delrosario.marissa.demo@scc-demo.test' };
const ROSTER = ['Isabel Camille Del Rosario', 'Marco Daniel Dimaculangan',
  'Angela Rose Evangelista', 'Luis Mateo Fajardo', 'Francesca Marie Velasco'];
const JOURNALS = [
  'I helped my younger cousin read a story after school. She smiled when she finished a page on her own. I learned that patience can help someone feel more confident.',
  'I shared my notes with a classmate who was absent. He thanked me and caught up with the lesson. I felt happy that a small favor helped him.',
  'I carried groceries for our neighbor when I saw her walking home. She looked relieved and thanked me. I learned to notice when people need help.',
  'I helped my brother with his homework even though I wanted to play. He finished it and smiled. I realized kindness sometimes means giving my time.',
  'I helped clean our classroom after an activity. My classmates thanked me and joined in. I felt proud that we made the room pleasant for everyone.'
];

function check(value, message) { if (!value) throw new Error(message); }
function when(date, hour, minute, second = 0) {
  return `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}
function lowResult(studentIndex, subjectName) {
  return studentIndex < 2 && ['Mathematics', 'Science'].includes(subjectName);
}
function scoreFor(studentIndex, subjectIndex, itemIndex, subjectName) {
  const variation = (studentIndex * 5 + subjectIndex * 3 + itemIndex * 5) % 7;
  return lowResult(studentIndex, subjectName) ? 4 + variation : 14 + variation;
}
function sourceRefs(student) {
  const refs = [];
  for (const row of student.attendance.sources || []) if (row.recordId) refs.push(['attendance_record', row.recordId]);
  for (const row of student.journal.sources || []) if (row.entryId) refs.push(['journal_entry', row.entryId]);
  for (const reason of student.candidateReasons || []) {
    if (reason.type === 'low_scores') for (const row of reason.scores || []) refs.push(['student_score', row.scoreId]);
    if (reason.type === 'grade') for (const row of student.academicRecords || []) {
      if (row.subjectName === reason.subject && Number(row.finalGrade) === Number(reason.grade)) {
        refs.push(['published_final_grade', row.gradeId]);
      }
    }
  }
  return [...new Map(refs.map(([type, id]) => [`${type}:${id}`, [type, Number(id)]])).values()];
}

async function readScope(c) {
  const [[state]] = await c.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1, 'Wrong database or foreign-key checks disabled.');
  const [sections] = await c.execute(`SELECT s.id, s.school_level_id AS levelId,
    s.academic_year_id AS yearId, s.adviser_user_id AS adviserId
    FROM sections s JOIN schools school ON school.id=s.school_id AND school.registration_status='active'
    JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id AND y.status='active'
    JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
    JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
    WHERE s.school_id=? AND school.name=? AND s.name='St. Peter' AND s.status='active'
      AND y.label='2026-2027' AND g.grade_code='grade-7' AND l.level_code='jhs'`,
  [SCHOOL_ID, "Saint Columban's College"]);
  check(sections.length === 1, 'Expected one active Grade 7 St. Peter in school 7.');
  const section = sections[0];
  const [advisers] = await c.execute(`SELECT id FROM users WHERE id=? AND school_id=? AND role='teacher'
    AND account_status='active' AND display_name='Ramon Jose Hermoso'`, [section.adviserId, SCHOOL_ID]);
  check(advisers.length === 1, 'Expected Ramon Jose Hermoso as adviser.');
  const [terms] = await c.execute(`SELECT id, name FROM academic_terms WHERE school_id=? AND academic_year_id=?
    AND school_level_id=? AND sequence_number=1 AND status='active'`, [SCHOOL_ID, section.yearId, section.levelId]);
  check(terms.length === 1, 'Expected active JHS Term 1.');
  const [students] = await c.execute(`SELECT u.id, u.display_name AS name, p.religion, p.house_street AS houseStreet,
    p.barangay, p.city_municipality AS city, p.province
    FROM section_students e JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id
    JOIN student_profiles p ON p.user_id=u.id
    WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
      AND u.role='student' AND u.account_status='active'
    ORDER BY u.last_name,u.first_name,u.id`, [SCHOOL_ID, section.id]);
  check(students.length === 5 && students.every((s, i) => s.name === ROSTER[i]),
    'St. Peter roster differs from the planned five students.');
  const [subjects] = await c.execute(`SELECT sub.id, sub.name, sub.subject_code AS code,
    st.teacher_user_id AS teacherId, u.display_name AS teacher
    FROM section_teachers st JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id AND sub.is_active=1
    JOIN users u ON u.id=st.teacher_user_id AND u.school_id=st.school_id AND u.role='teacher'
      AND u.account_status='active'
    WHERE st.school_id=? AND st.section_id=? ORDER BY sub.name,sub.id`, [SCHOOL_ID, section.id]);
  check(subjects.length === 9 && new Set(subjects.map(s => Number(s.id))).size === 9,
    'Expected nine assigned subjects.');
  const values = subjects.find(s => s.name === 'Values Education' && s.teacher === 'Gerardo Dayrit');
  check(values, 'Expected Gerardo Dayrit to teach Values Education.');
  const [components] = await c.execute(`SELECT p.subject_id AS subjectId, x.id, x.name,
    x.component_type AS componentType, x.weight
    FROM subject_grading_profiles p JOIN subject_grading_components x ON x.profile_id=p.id AND x.school_id=p.school_id
    WHERE p.school_id=? AND p.academic_year_id=? AND p.school_level_id=?
      AND p.subject_id IN (${subjects.map(() => '?').join(',')}) ORDER BY p.subject_id,x.sort_order,x.id`,
  [SCHOOL_ID, section.yearId, section.levelId, ...subjects.map(s => s.id)]);
  check(components.length > 0, 'Grading components are missing.');
  const [parts] = await c.execute(`SELECT id, component_id AS componentId, code, name, weight
    FROM subject_grading_exam_parts WHERE school_id=? AND component_id IN (${components.map(() => '?').join(',')})
    ORDER BY component_id,sort_order,id`, [SCHOOL_ID, ...components.map(x => x.id)]);
  const items = subjects.flatMap(s => planItems(s, components, parts));
  check(items.length === 64, `Expected the same 64 score items as St. John; found ${items.length}.`);
  const performance = components.filter(x => Number(x.subjectId) === Number(values.id) && x.componentType === 'performance');
  check(performance.length === 1, 'Expected one Values Education Performance Tasks component.');
  const [[settings]] = await c.execute(`SELECT f.grades_enabled AS gradesEnabled,
    f.narrative_reports_enabled AS reportsEnabled, f.journals_enabled AS journalsEnabled,
    f.journal_ai_approved_at AS journalApproved, f.ai_evidence_approved_at AS reportApproved,
    s.journal_subject_id AS journalSubjectId, s.narrative_report_week_start_day AS weekStart,
    s.narrative_report_week_end_day AS weekEnd
    FROM school_portal_features f JOIN school_settings s ON s.school_id=f.school_id
    WHERE f.school_id=?`, [SCHOOL_ID]);
  check(settings && Number(settings.gradesEnabled) === 1 && Number(settings.reportsEnabled) === 1 &&
    Number(settings.journalsEnabled) === 1 && settings.journalApproved && settings.reportApproved,
  'Grades, journals, AI approvals, or narrative reports are not enabled.');
  check(Number(settings.weekStart || 1) === 1 && Number(settings.weekEnd || 6) === 6,
    'Expected Monday-to-Saturday report weeks.');
  const [journalSubjects] = await c.execute(`SELECT id FROM journal_subjects WHERE id=? AND school_id=?
    AND subject_id=? AND is_active=1`, [settings.journalSubjectId, SCHOOL_ID, values.id]);
  check(journalSubjects.length === 1, 'Values Education journal is not configured.');
  const [rubrics] = await c.execute(`SELECT criteria FROM journal_ai_rubrics
    WHERE school_id=? AND teacher_user_id=? AND journal_subject_id=?`,
  [SCHOOL_ID, values.teacherId, journalSubjects[0].id]);
  check(rubrics.length <= 1 && (!rubrics.length || JSON.stringify(typeof rubrics[0].criteria === 'string'
    ? JSON.parse(rubrics[0].criteria) : rubrics[0].criteria) === JSON.stringify(DEFAULT_CRITERIA)),
  'Gerardo Dayrit has a different journal rubric.');
  const [parentAccount] = await c.execute(`SELECT id FROM users
    WHERE school_email=? OR personal_email=? OR (school_id=? AND display_name=?)`,
    [PARENT.schoolEmail, PARENT.personalEmail,SCHOOL_ID,`${PARENT.first} ${PARENT.last}`]);
  check(parentAccount.length === 0, 'Planned Del Rosario parent email already exists.');
  const [links] = await c.execute('SELECT id FROM student_parent_links WHERE school_id=? AND student_user_id=?',
    [SCHOOL_ID, students[0].id]);
  check(links.length === 0, 'Isabel already has a linked parent.');
  const [[existing]] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=? AND academic_term_id=?) AS items,
    (SELECT COUNT(*) FROM published_final_grades WHERE school_id=? AND section_id=? AND academic_term_id=?) AS grades,
    (SELECT COUNT(*) FROM journal_prompts WHERE school_id=? AND section_id=? AND week_start_date='2026-11-16') AS prompts,
    (SELECT COUNT(*) FROM attendance_sessions WHERE school_id=? AND section_id=?
      AND attendance_date IN ('2026-11-17','2026-11-18')) AS attendance,
    (SELECT COUNT(*) FROM narrative_reports WHERE school_id=? AND section_id=? AND report_period_key='week:2026-11-16') AS reports`,
  [SCHOOL_ID,section.id,terms[0].id,SCHOOL_ID,section.id,terms[0].id,SCHOOL_ID,section.id,
    SCHOOL_ID,section.id,SCHOOL_ID,section.id]);
  check(Object.values(existing).every(n => Number(n) === 0),
    'St. Peter already has score items, grades, journal, attendance, or reports in this period.');
  return { section, term: terms[0], students, subjects, values, items,
    journalSubjectId: journalSubjects[0].id, performanceId: performance[0].id,
    rubricExists: rubrics.length === 1 };
}

async function verify(c, scope, parentId) {
  const [[counts]] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=? AND academic_term_id=?) AS items,
    (SELECT COUNT(*) FROM student_scores sc JOIN grading_items gi ON gi.id=sc.grading_item_id
      WHERE gi.school_id=? AND gi.section_id=? AND gi.academic_term_id=?) AS scores,
    (SELECT COUNT(*) FROM journal_prompts WHERE school_id=? AND section_id=? AND week_start_date='2026-11-16') AS prompts,
    (SELECT COUNT(*) FROM student_journal_entries WHERE school_id=? AND section_id=?) AS entries,
    (SELECT COUNT(*) FROM journal_ai_assessments a JOIN student_journal_entries e ON e.id=a.journal_entry_id
      WHERE e.school_id=? AND e.section_id=?) AS assessments,
    (SELECT COUNT(*) FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id
      WHERE s.school_id=? AND s.section_id=? AND s.attendance_date IN ('2026-11-17','2026-11-18')) AS attendance,
    (SELECT COUNT(*) FROM published_final_grades WHERE school_id=? AND section_id=? AND academic_term_id=?) AS grades,
    (SELECT COUNT(*) FROM narrative_reports WHERE school_id=? AND section_id=? AND report_period_key='week:2026-11-16'
      AND report_status='confirmed' AND released_at IS NOT NULL) AS reports,
    (SELECT COUNT(*) FROM narrative_report_releases r JOIN narrative_reports n ON n.id=r.narrative_report_id
      WHERE n.school_id=? AND n.section_id=? AND n.report_period_key='week:2026-11-16') AS releases,
    (SELECT COUNT(*) FROM student_parent_links WHERE school_id=? AND student_user_id=? AND parent_user_id=?) AS links`,
  [SCHOOL_ID,scope.section.id,scope.term.id,SCHOOL_ID,scope.section.id,scope.term.id,
    SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.section.id,
    SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.section.id,scope.term.id,
    SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.students[0].id,parentId]);
  check(Number(counts.items) === 65 && Number(counts.scores) === 325 && Number(counts.prompts) === 1 &&
    Number(counts.entries) === 5 && Number(counts.assessments) === 5 && Number(counts.attendance) === 15 &&
    Number(counts.grades) === 45 && Number(counts.reports) === 5 && Number(counts.releases) === 5 &&
    Number(counts.links) === 1, 'St. Peter record counts failed verification.');
  const [timeline] = await c.execute(`SELECT DATE_FORMAT(generated_at,'%Y-%m-%d %H:%i:%s') AS generated,
    DATE_FORMAT(confirmed_at,'%Y-%m-%d %H:%i:%s') AS confirmed,
    DATE_FORMAT(released_at,'%Y-%m-%d %H:%i:%s') AS released, is_at_risk AS atRisk
    FROM narrative_reports WHERE school_id=? AND section_id=? AND report_period_key='week:2026-11-16'`,
  [SCHOOL_ID,scope.section.id]);
  check(timeline.length === 5 && timeline.every(r => r.generated >= '2026-11-18 11:25:00' &&
    r.generated < r.confirmed && r.confirmed < r.released && r.released <= '2026-11-18 11:45:00') &&
    timeline.filter(r => Number(r.atRisk) === 1).length >= 2, 'Report timeline or follow-up flags failed verification.');
  const [[parentReport]] = await c.execute(`SELECT COUNT(*) AS n FROM narrative_report_releases rel
    JOIN narrative_reports rep ON rep.id=rel.narrative_report_id AND rep.school_id=rel.school_id
    JOIN student_parent_links link ON link.school_id=rep.school_id AND link.student_user_id=rep.student_user_id
    WHERE rel.school_id=? AND link.parent_user_id=? AND rep.student_user_id=?`,
  [SCHOOL_ID,parentId,scope.students[0].id]);
  check(Number(parentReport.n) === 1, 'Linked parent cannot access Isabel’s release.');
  const [[dates]] = await c.execute(`SELECT
    (SELECT DATE_FORMAT(MIN(recorded_at),'%Y-%m-%d') FROM grading_items
      WHERE school_id=? AND section_id=? AND academic_term_id=?) AS firstItemDate,
    (SELECT DATE_FORMAT(MAX(submitted_at),'%Y-%m-%d') FROM student_journal_entries
      WHERE school_id=? AND section_id=?) AS lastJournalDate,
    (SELECT DATE_FORMAT(MIN(a.created_at),'%Y-%m-%d') FROM journal_ai_assessments a
      JOIN student_journal_entries e ON e.id=a.journal_entry_id
      WHERE e.school_id=? AND e.section_id=?) AS aiDate,
    (SELECT DATE_FORMAT(MIN(published_at),'%Y-%m-%d') FROM published_final_grades
      WHERE school_id=? AND section_id=? AND academic_term_id=?) AS gradeDate,
    (SELECT COUNT(*) FROM notifications WHERE user_id=?
      AND event_key LIKE 'narrative-report:%:released'
      AND DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')=(
        SELECT DATE_FORMAT(released_at,'%Y-%m-%d %H:%i:%s') FROM narrative_reports
        WHERE school_id=? AND section_id=? AND student_user_id=?
          AND report_period_key='week:2026-11-16')) AS parentNotices,
    (SELECT COUNT(*) FROM notifications WHERE user_id IN (${scope.students.map(() => '?').join(',')})
      AND event_key LIKE ? AND DATE(created_at)='2026-11-18') AS gradeNotices`,
  [SCHOOL_ID,scope.section.id,scope.term.id,SCHOOL_ID,scope.section.id,
    SCHOOL_ID,scope.section.id,SCHOOL_ID,scope.section.id,scope.term.id,
    parentId,SCHOOL_ID,scope.section.id,scope.students[0].id,
    ...scope.students.map(s => s.id),`grade-published:${scope.section.id}:%:${scope.term.id}:%`]);
  check(dates.firstItemDate === '2026-11-17' && dates.lastJournalDate === '2026-11-17' &&
    dates.aiDate === '2026-11-18' && dates.gradeDate === '2026-11-18' &&
    Number(dates.parentNotices) === 1 && Number(dates.gradeNotices) === 45,
  'St. Peter dates or portal notifications failed verification.');
  const [[queued]] = await c.execute(`SELECT COUNT(*) AS n FROM notification_push_deliveries d
    JOIN notifications n ON n.id=d.notification_id
    WHERE n.user_id IN (${scope.students.map(() => '?').join(',')},?)
      AND (n.event_key LIKE ? OR n.event_key LIKE 'narrative-report:%:released')`,
  [...scope.students.map(s => s.id),parentId,
    `grade-published:${scope.section.id}:%:${scope.term.id}:%`]);
  check(Number(queued.n) === 0, 'Demo portal notifications must not queue device pushes.');
  const [[fk]] = await c.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
  check(Number(fk.enabled) === 1, 'Foreign-key checks are not enabled.');
  return counts;
}

async function run({ apply = false, password, confirm, database, snapshot = takeSnapshot,
  assess = generateJournalAssessment, generate = generateWithQuota, calculate = buildFinalGradePreview,
  evidenceBuilder = buildWeeklyEvidence, hashPassword = value => bcrypt.hash(value, 12) } = {}) {
  const db = database || require('../config/database').getDatabase();
  let c; let started = false;
  try {
    c = await db.getConnection();
    const scope = await readScope(c);
    const preview = { mode: 'preview', schoolId: SCHOOL_ID, section: 'Grade 7 St. Peter',
      adviser: 'Ramon Jose Hermoso', students: scope.students.map(s => s.name),
      scoreItems: 65, studentScores: 325, journalEntries: 5, realAiSuggestions: 5,
      attendanceSessions: 3, attendanceRecords: 15, publishedGrades: 45,
      realAiReports: 5, flaggedStudents: scope.students.slice(0, 2).map(s => s.name),
      parent: `${PARENT.first} ${PARENT.last}`, linkedStudent: scope.students[0].name,
      workDate: '2026-11-17', aiAndPublicationDate: '2026-11-18',
      confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;
    check(process.env.AI_JOURNAL_ASSESSMENT_ENABLED === 'true' &&
      process.env.AI_REPORTS_GENERATION_ENABLED === 'true' &&
      process.env.AI_REPORTS_RELEASE_ENABLED === 'true' && process.env.OPENAI_API_KEY,
    'Journal and report AI must be configured before applying.');
    check(typeof password === 'string' && password.length >= 12 && password.length <= 128,
      'Set STC_PETER_PARENT_PASSWORD to a 12–128 character password.');
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing was added.'); return; }
    const hash = await hashPassword(password);
    c.release(); c = null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    c = await db.getConnection();
    await c.beginTransaction(); started = true;
    await c.execute('SELECT id FROM sections WHERE id=? AND school_id=? FOR UPDATE',
      [scope.section.id,SCHOOL_ID]);
    const current = await readScope(c);
    check(JSON.stringify(current) === JSON.stringify(scope), 'St. Peter data changed after preview.');
    const child = current.students[0];
    check(child.religion && child.houseStreet && child.barangay && child.city === 'Lingayen' &&
      child.province === 'Pangasinan', 'Isabel’s profile needs a complete Lingayen family address and religion.');
    const [parent] = await c.execute(`INSERT INTO users
      (school_id,role,school_email,personal_email,password_hash,account_status,first_name,last_name,
       display_name,initials,setup_completed_at,created_at,updated_at)
      VALUES (?,'parent',?,?,?,'active',?,?,?,'MD',?,?,?)`,
    [SCHOOL_ID,PARENT.schoolEmail,PARENT.personalEmail,hash,PARENT.first,PARENT.last,
      `${PARENT.first} ${PARENT.last}`,'2026-11-17 12:20:00','2026-11-17 12:20:00','2026-11-17 12:20:00']);
    await c.execute(`INSERT INTO parent_profiles
      (user_id,sex,religion,house_street,barangay,city_municipality,province,created_at,updated_at)
      VALUES (?,'female',?,?,?,?,?,?,?)`,
    [parent.insertId,child.religion,child.houseStreet,child.barangay,child.city,child.province,
      '2026-11-17 12:20:00','2026-11-17 12:20:00']);
    await c.execute(`INSERT INTO student_parent_links
      (school_id,student_user_id,parent_user_id,relationship,created_at) VALUES (?,?,?,'mother',?)`,
    [SCHOOL_ID,child.id,parent.insertId,'2026-11-17 12:20:00']);
    if (!current.rubricExists) await c.execute(`INSERT INTO journal_ai_rubrics
      (school_id,teacher_user_id,journal_subject_id,criteria,updated_at) VALUES (?,?,?,?,?)`,
    [SCHOOL_ID,current.values.teacherId,current.journalSubjectId,JSON.stringify(DEFAULT_CRITERIA),'2026-11-17 12:25:00']);

    const subjectIndex = new Map(current.subjects.map((s,i) => [Number(s.id),i]));
    for (const [index,item] of current.items.entries()) {
      const subject = current.subjects[subjectIndex.get(Number(item.subjectId))];
      const itemTime = when('2026-11-17',13,Math.floor(index * 55 / current.items.length),index % 60);
      const [created] = await c.execute(`INSERT INTO grading_items
        (school_id,section_id,subject_id,academic_term_id,subject_grading_component_id,
         subject_grading_exam_part_id,domain_code,teacher_user_id,title,max_score,
         recorded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [SCHOOL_ID,current.section.id,item.subjectId,current.term.id,item.componentId,item.examPartId,
        item.domainCode,item.teacherId,item.title,item.maxScore,itemTime,itemTime,itemTime]);
      for (const [studentIndex,student] of current.students.entries()) {
        const scoreTime = when('2026-11-17',14,Math.floor(index * 45 / current.items.length),studentIndex * 7);
        await c.execute(`INSERT INTO student_scores
          (school_id,grading_item_id,student_user_id,score,recorded_by_user_id,recorded_at,updated_at)
          VALUES (?,?,?,?,?,?,?)`,
        [SCHOOL_ID,created.insertId,student.id,
          scoreFor(studentIndex,subjectIndex.get(Number(item.subjectId)),index,subject.name),
          item.teacherId,scoreTime,scoreTime]);
      }
    }
    const promptTime = '2026-11-17 12:30:00';
    const [journalItem] = await c.execute(`INSERT INTO grading_items
      (school_id,section_id,subject_id,academic_term_id,subject_grading_component_id,domain_code,
       teacher_user_id,title,max_score,recorded_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'affective',?,'WK 1 Journal',20,?,?,?)`,
    [SCHOOL_ID,current.section.id,current.values.id,current.term.id,current.performanceId,
      current.values.teacherId,promptTime,promptTime,promptTime]);
    const [prompt] = await c.execute(`INSERT INTO journal_prompts
      (school_id,journal_subject_id,section_id,grading_item_id,week_start_date,prompt_text,
       opens_at,due_at,min_words,allow_late,prompt_status,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,'2026-11-16',?,?,'2026-11-20 23:59:00',15,0,'closed',?,?,?)`,
    [SCHOOL_ID,current.journalSubjectId,current.section.id,journalItem.insertId,PROMPT,promptTime,
      current.values.teacherId,promptTime,promptTime]);
    const usageDate = manilaDate();
    const journalLimit = Number(process.env.AI_JOURNAL_DAILY_CALL_LIMIT || 100);
    check(Number.isSafeInteger(journalLimit) && journalLimit >= 5, 'Journal AI call limit is too low.');
    await c.execute(`INSERT INTO journal_ai_daily_usage (school_id,usage_date)
      VALUES (?,?) ON DUPLICATE KEY UPDATE school_id=school_id`, [SCHOOL_ID,usageDate]);
    for (const [i,student] of current.students.entries()) {
      console.log(`Assessing journal ${i + 1}/5: ${student.name}`);
      check(JOURNALS[i].split(/\s+/).length >= 15, 'A journal entry is too short.');
      const submitted = when('2026-11-17',15,5 + i * 6);
      const [entry] = await c.execute(`INSERT INTO student_journal_entries
        (school_id,journal_subject_id,student_user_id,owner_teacher_user_id,section_id,
         journal_prompt_id,prompt_text,entry_text,entry_status,submitted_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'reviewed',?,?,?)`,
      [SCHOOL_ID,current.journalSubjectId,student.id,current.values.teacherId,current.section.id,
        prompt.insertId,PROMPT,JOURNALS[i],submitted,submitted,submitted]);
      const [reserved] = await c.execute(`UPDATE journal_ai_daily_usage
        SET call_count=call_count+1 WHERE school_id=? AND usage_date=? AND call_count<?`,
      [SCHOOL_ID,usageDate,journalLimit]);
      check(reserved.affectedRows === 1, 'Journal AI daily limit reached.');
      const result = await assess({ promptText: PROMPT, entryText: JOURNALS[i], criteria: DEFAULT_CRITERIA });
      check(result?.scores?.length === 4 && result.scores.every((n,j) => Number.isInteger(n) && n >= 0 && n <= DEFAULT_CRITERIA[j].points)
        && result.feedback && result.model, `AI assessment failed for ${student.name}.`);
      const suggestion = result.scores.reduce((sum,n) => sum+n,0);
      const assessed = when('2026-11-18',10,40+i*2);
      await c.execute(`INSERT INTO journal_ai_assessments
        (school_id,journal_entry_id,assessed_by_user_id,rubric_snapshot,criterion_scores,
         suggested_score,max_score_snapshot,feedback,model,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [SCHOOL_ID,entry.insertId,current.values.teacherId,JSON.stringify(DEFAULT_CRITERIA),
        JSON.stringify(result.scores),suggestion,20,result.feedback,result.model,assessed]);
      await c.execute(`UPDATE journal_ai_daily_usage
        SET input_tokens=input_tokens+?,output_tokens=output_tokens+?
        WHERE school_id=? AND usage_date=?`,
      [Number(result.inputTokens)||0,Number(result.outputTokens)||0,SCHOOL_ID,usageDate]);
      const reviewed = when('2026-11-18',10,50+i);
      await c.execute(`INSERT INTO student_scores
        (school_id,grading_item_id,student_user_id,score,recorded_by_user_id,recorded_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`,
      [SCHOOL_ID,journalItem.insertId,student.id,suggestion,current.values.teacherId,reviewed,reviewed]);
    }
    const [meetings] = await c.execute(`SELECT DISTINCT sub.id AS subjectId, sub.name AS subject,
      st.teacher_user_id AS teacherId, tm.weekday FROM timetable_meetings tm
      JOIN scheduled_classes sc ON sc.id=tm.scheduled_class_id AND sc.school_id=tm.school_id
      JOIN section_teachers st ON st.id=sc.assignment_id AND st.school_id=sc.school_id
      JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
      WHERE tm.school_id=? AND st.section_id=? AND tm.weekday IN (2,3)
        AND '2026-11-17' BETWEEN tm.start_date AND tm.end_date
      ORDER BY tm.weekday,sub.name,sub.id`, [SCHOOL_ID,current.section.id]);
    const chosen = [2,2,3].map((day,index) => meetings.filter(m => Number(m.weekday) === day)[index === 1 ? 1 : 0]);
    check(chosen.every(Boolean) && new Set(chosen.map(m => `${m.weekday}:${m.subjectId}`)).size === 3,
      'Expected two Tuesday and one Wednesday scheduled subjects for attendance.');
    for (const [i,meeting] of chosen.entries()) {
      const date = i < 2 ? '2026-11-17' : '2026-11-18';
      const marked = when(date,i < 2 ? 16 : 10,i < 2 ? 10+i*5 : 55);
      const [session] = await c.execute(`INSERT INTO attendance_sessions
        (school_id,section_id,subject_id,attendance_date,method,status,created_by_user_id,
         confirmed_by_user_id,confirmed_at,created_at,updated_at)
        VALUES (?,?,?,?,'manual','confirmed',?,?,?,?,?)`,
      [SCHOOL_ID,current.section.id,meeting.subjectId,date,meeting.teacherId,
        meeting.teacherId,marked,marked,marked]);
      for (const [j,student] of current.students.entries()) {
        const status = j === 1 && i === 0 ? 'absent' : j === 0 && i === 1 ? 'late' : 'present';
        await c.execute(`INSERT INTO attendance_records
          (school_id,attendance_session_id,student_user_id,attendance_status,marked_by_user_id,marked_at,updated_at)
          VALUES (?,?,?,?,?,?,?)`,
        [SCHOOL_ID,session.insertId,student.id,status,meeting.teacherId,marked,marked]);
      }
    }
    const gradeSummary = [];
    const notificationIds = [];
    for (const [i,subject] of current.subjects.entries()) {
      const previewGrade = await calculate(c,{ id:subject.teacherId,role:'teacher',schoolId:SCHOOL_ID },
        { sectionId:current.section.id,subjectId:subject.id,academicTermId:current.term.id },true);
      check(previewGrade.readyToPublish && previewGrade.students.length === 5 &&
        previewGrade.students.every(s => s.finalGrade !== null),
      `Grade calculation failed for ${subject.name}: ${JSON.stringify(previewGrade.issues)}.`);
      if (['Mathematics','Science'].includes(subject.name)) check(previewGrade.students.filter(s =>
        Number(s.finalGrade) < Number(previewGrade.passingGradeThreshold)).length === 2,
      `Expected two below-passing grades in ${subject.name}.`);
      const published = when('2026-11-18',11,10+i);
      for (const grade of previewGrade.students) {
        await c.execute(`INSERT INTO published_final_grades
          (school_id,section_id,subject_id,academic_term_id,student_user_id,final_grade,
           domain_rule_version,published_by_user_id,published_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [SCHOOL_ID,current.section.id,subject.id,current.term.id,grade.studentId,grade.finalGrade,
          previewGrade.domainRuleVersion,subject.teacherId,published,published,published]);
        const [notice] = await c.execute(`INSERT INTO notifications
          (user_id,type,title,message,target_path,event_key,created_at)
          VALUES (?,'grade','Subject grade published',?,?,?,?)`,
        [grade.studentId,`Your final grade in ${subject.name} for ${current.term.name} has been published.`,
          '/views/student/edugnay-student-grades.html',
          `grade-published:${current.section.id}:${subject.id}:${current.term.id}:${grade.studentId}`,published]);
        notificationIds.push(notice.insertId);
      }
      await c.execute(`UPDATE grading_items SET used_in_published_grades=1,updated_at=?
        WHERE school_id=? AND section_id=? AND subject_id=? AND academic_term_id=?`,
      [published,SCHOOL_ID,current.section.id,subject.id,current.term.id]);
      gradeSummary.push({ subject:subject.name,publishedAt:published });
    }
    const evidence = await evidenceBuilder({ schoolId:SCHOOL_ID,teacherId:current.section.adviserId,
      sectionId:current.section.id,startDate:'2026-11-16',database:c });
    check(evidence.students.length === 5 && evidence.students.every((s,i) => s.displayName === current.students[i].name),
      'Weekly report evidence roster differs from St. Peter.');
    check(evidence.students.slice(0,2).every(s => s.followUpCandidate &&
      s.candidateReasons.some(r => r.type === 'grade')) &&
      evidence.students.slice(2).every(s => !s.followUpCandidate),
    'Expected exactly Isabel and Marco to have evidence-based follow-up reasons.');
    for (const [i,student] of evidence.students.entries()) {
      console.log(`Generating weekly report ${i + 1}/5: ${student.displayName}`);
      const draft = await generate({ database:c,schoolId:SCHOOL_ID,student,
        reportWeek:evidence.reportWeek,teacherNote:'',journalApplicable:true,gradesEnabled:true });
      check(draft?.summary && draft.model && Array.isArray(draft.parentActions) &&
        (!student.followUpCandidate || draft.followUpSuggestion),
      `AI report was incomplete for ${student.displayName}.`);
      const generated = when('2026-11-18',11,25+i);
      const confirmed = when('2026-11-18',11,32+i);
      const released = when('2026-11-18',11,40+i);
      const atRisk = i < 2 ? 1 : 0;
      const gradeEvidenceUsed = student.candidateReasons.some(r => ['low_scores','grade'].includes(r.type)) ? 1 : 0;
      const [report] = await c.execute(`INSERT INTO narrative_reports
        (school_id,student_user_id,section_id,teacher_user_id,academic_term_id,
         report_week_start_date,report_week_end_date,report_period_key,report_period_label,
         teacher_note,ai_model,generated_summary,ai_follow_up_suggestion,grade_evidence_used,
         report_status,is_at_risk,generated_at,confirmed_at,released_at,created_at,updated_at)
        VALUES (?,?,?,?,?,'2026-11-16','2026-11-21','week:2026-11-16',
          'Week of November 16, 2026 to November 21, 2026',NULL,?,?,?,?,'confirmed',?,?,?,?,?,?)`,
      [SCHOOL_ID,student.id,current.section.id,current.section.adviserId,current.term.id,
        draft.model,draft.summary,draft.followUpSuggestion || null,gradeEvidenceUsed,atRisk,
        generated,confirmed,released,generated,released]);
      for (const [j,action] of draft.parentActions.entries()) await c.execute(`INSERT INTO report_recommendations
        (narrative_report_id,recommendation_text,display_order,created_at) VALUES (?,?,?,?)`,
      [report.insertId,action,j+1,generated]);
      for (const [type,id] of sourceRefs(student)) await c.execute(`INSERT INTO report_data_sources
        (narrative_report_id,source_type,source_record_id,created_at) VALUES (?,?,?,?)`,
      [report.insertId,type,id,generated]);
      await c.execute(`INSERT INTO narrative_report_releases
        (school_id,narrative_report_id,version_number,summary,parent_actions,released_at,
         released_by_user_id,released_by_name) VALUES (?,?,1,?,?,?,?,?)`,
      [SCHOOL_ID,report.insertId,draft.summary,JSON.stringify(draft.parentActions),released,
        current.section.adviserId,'Ramon Jose Hermoso']);
      if (i === 0) {
        const [notice] = await c.execute(`INSERT INTO notifications
        (user_id,related_student_user_id,type,title,message,target_path,event_key,created_at)
        VALUES (?,?,'report','Weekly report available',?,?,?,?)`,
      [parent.insertId,child.id,`A new weekly progress report for ${child.name} is available.`,
        `/views/parent/edugnay-parent-reports.html?studentId=${child.id}&reportId=${report.insertId}`,
        `narrative-report:${report.insertId}:released`,released]);
        notificationIds.push(notice.insertId);
      }
    }
    const [pushTables] = await c.execute(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notification_push_deliveries'`);
    if (pushTables.length) await c.execute(`DELETE FROM notification_push_deliveries
      WHERE notification_id IN (${notificationIds.map(() => '?').join(',')})`,notificationIds);
    await c.execute(`INSERT INTO audit_logs
      (school_id,actor_user_id,action_type,entity_type,entity_id,details)
      VALUES (?,NULL,'synthetic_demo_st_peter_seed','sections',?,?)`,
    [SCHOOL_ID,current.section.id,
      JSON.stringify({ source:'synthetic_demo_data',snapshotId,students:5,reports:5 })]);
    const counts = await verify(c,current,parent.insertId);
    await c.commit(); started = false;
    const result = { result:'complete',schoolId:SCHOOL_ID,section:'Grade 7 St. Peter',
      scoreItems:counts.items,studentScores:counts.scores,journalEntries:counts.entries,
      aiSuggestions:counts.assessments,attendanceRecords:counts.attendance,
      gradesPublished:counts.grades,reportsReleased:counts.releases,
      parentEmail:PARENT.schoolEmail,linkedStudent:child.name,snapshotId,verified:true,
      gradeSummary };
    console.log(JSON.stringify(result,null,2));
    return result;
  } catch (error) { if (started) await c.rollback(); throw error; }
  finally { c?.release(); if (!database) await db.end(); }
}

async function main() {
  check(process.env.DB_NAME === 'academix','DB_NAME must be academix.');
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview','--apply'].includes(args[0]),'Use --preview or --apply.');
  await run({ apply:args[0] === '--apply',password:process.env.STC_PETER_PARENT_PASSWORD });
}
if (require.main === module) main().catch(error => {
  console.error('St. Peter demo seeding stopped:',error.message);
  process.exitCode = 1;
});

module.exports = { run,readScope,verify,scoreFor,lowResult,sourceRefs,CONFIRMATION };
