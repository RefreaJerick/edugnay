'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { createInterface } = require('node:readline/promises');
const { buildFinalGradePreview } = require('../controllers/gradesController');
const { DEFAULT_CRITERIA } = require('../services/journalAssessmentAi');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const CONFIRMATION = 'ADD ST JOHN JOURNAL AND ATTENDANCE FOR SCHOOL 7';
const PROMPT = 'What is one kind thing you did for someone this week? Describe what happened, how the person responded, and what you learned.';
const PREPARED = '2026-11-17 12:15:00';
const PUBLISHED = '2026-11-18 11:05:00';
const ACTS = [
  'carried groceries for our neighbor', 'shared my notes with a classmate', 'helped my grandmother prepare lunch',
  'picked up litter near our street', 'taught my younger cousin to read', 'helped a friend understand fractions',
  'gave my seat to an older passenger', 'helped my father wash the dishes', 'lent a pencil to a classmate',
  'walked a younger child home', 'helped my mother fold laundry', 'comforted a friend who was upset',
  'watered our neighbor\'s plants', 'helped my brother finish his homework', 'shared my snack with a friend',
  'carried books for our teacher', 'helped clean our classroom', 'checked on a sick neighbor',
  'helped a classmate find a lost notebook', 'swept the path outside our house', 'helped my aunt sort vegetables',
  'gave directions to a visitor', 'helped my sister practice spelling', 'shared an umbrella with a classmate',
  'helped my grandfather use his phone', 'fed a stray cat near our home', 'helped prepare chairs for our meeting',
  'listened to a friend who felt lonely', 'helped my uncle carry water', 'helped a new classmate find the room',
  'returned a wallet I found', 'helped my mother buy groceries', 'helped a younger pupil tie a shoelace',
  'gave my extra paper to a classmate', 'helped our neighbor sweep leaves', 'helped my cousin study science',
  'held the door for a person carrying bags', 'helped my sister organize her school things',
  'shared a storybook with a younger child', 'helped my father tidy our yard'
];

function check(value, message) { if (!value) throw new Error(message); }
function timeAt(start, index, count) {
  return new Date(Date.UTC(2026, 10, 18, 0, 0) + start * 60000 + Math.floor(index * 14 * 60 / Math.max(count - 1, 1)) * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}
function answerFor(index, score = 16) {
  const act = ACTS[index];
  if (score < 10) return `This week I ${act}. The person said thank you. I felt okay about it, but I did not think much more about what happened.`;
  const response = [
    'They smiled and thanked me, which made me feel glad that I noticed they needed help.',
    'They seemed relieved and said it made their day easier. I felt proud to be useful.',
    'They thanked me quietly. I learned that even a small action can make someone feel supported.',
    'They looked happier afterward. I realized I can be kind without waiting for someone to ask.'
  ][index % 4];
  return `This week I ${act}. ${response}`;
}
function attendanceStatus(index) {
  return index === 7 || index === 23 ? 'absent' : index === 12 || index === 31 ? 'late' : 'present';
}

async function readScope(c) {
  const [[state]] = await c.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1, 'Wrong database or foreign-key checks disabled.');
  const [sections] = await c.execute(`SELECT s.id, s.school_level_id AS levelId, s.academic_year_id AS yearId
    FROM sections s JOIN schools school ON school.id=s.school_id AND school.registration_status='active'
    JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id AND y.status='active'
    JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
    JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
    WHERE s.school_id=? AND school.name=? AND s.name='St. John' AND s.status='active'
      AND y.label='2026-2027' AND g.grade_code='grade-7' AND l.level_code='jhs'`,
  [SCHOOL_ID, "Saint Columban's College"]);
  check(sections.length === 1, 'Expected one active Grade 7 St. John in school 7.');
  const section = sections[0];
  const [terms] = await c.execute(`SELECT id FROM academic_terms WHERE school_id=? AND academic_year_id=?
    AND school_level_id=? AND sequence_number=1 AND status='active'`, [SCHOOL_ID, section.yearId, section.levelId]);
  check(terms.length === 1, 'Expected active JHS Term 1.');
  const termId = terms[0].id;
  const [students] = await c.execute(`SELECT u.id, u.display_name AS name FROM section_students e
    JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id AND u.role='student'
      AND u.account_status='active' WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
    ORDER BY u.last_name, u.first_name, u.id`, [SCHOOL_ID, section.id]);
  check(students.length === 40 && new Set(students.map(s => Number(s.id))).size === 40,
    'Expected 40 active St. John students.');
  const [subjects] = await c.execute(`SELECT sub.id, sub.name, sub.subject_code AS code, st.teacher_user_id AS teacherId
    FROM section_teachers st JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
    JOIN users u ON u.id=st.teacher_user_id AND u.school_id=st.school_id AND u.role='teacher'
      AND u.account_status='active'
    WHERE st.school_id=? AND st.section_id=? ORDER BY sub.name, sub.id`, [SCHOOL_ID, section.id]);
  check(subjects.length === 9 && new Set(subjects.map(s => Number(s.id))).size === 9,
    'Expected nine assigned subjects.');
  const values = subjects.find(s => s.name === 'Values Education');
  check(values, 'Values Education teacher is missing.');
  const [journalSubjects] = await c.execute(`SELECT js.id FROM school_settings settings
    JOIN school_portal_features features ON features.school_id=settings.school_id AND features.journals_enabled=1
    JOIN journal_subjects js ON js.school_id=settings.school_id AND js.subject_id=settings.journal_subject_id
      AND js.is_active=1 WHERE settings.school_id=? AND js.subject_id=?`, [SCHOOL_ID, values.id]);
  check(journalSubjects.length === 1, 'Values Education journal is not configured.');
  const [components] = await c.execute(`SELECT comp.id FROM subject_grading_profiles p
    JOIN subject_grading_components comp ON comp.profile_id=p.id AND comp.school_id=p.school_id
    WHERE p.school_id=? AND p.academic_year_id=? AND p.school_level_id=? AND p.subject_id=?
      AND comp.component_type='performance'`, [SCHOOL_ID, section.yearId, section.levelId, values.id]);
  check(components.length === 1, 'Expected one Values Education Performance Tasks component.');
  const [affectiveItems] = await c.execute(`SELECT id FROM grading_items
    WHERE school_id=? AND section_id=? AND subject_id=? AND academic_term_id=?
      AND subject_grading_component_id=? AND domain_code='affective' AND max_score=20`,
  [SCHOOL_ID, section.id, values.id, termId, components[0].id]);
  check(affectiveItems.length === 1, 'Expected one existing 20-point affective Performance Task.');
  const [baseScores] = await c.execute(`SELECT student_user_id AS studentId, score FROM student_scores
    WHERE school_id=? AND grading_item_id=?`, [SCHOOL_ID, affectiveItems[0].id]);
  check(baseScores.length === 40 && baseScores.every(r => r.score !== null &&
    Number(r.score) >= 0 && Number(r.score) <= 20),
    'Expected 40 existing affective Performance Task scores.');
  const scoreByStudent = new Map(baseScores.map(r => [Number(r.studentId), Number(r.score)]));
  check(students.every(s => scoreByStudent.has(Number(s.id))), 'A student is missing an affective score.');
  const [grades] = await c.execute(`SELECT student_user_id AS studentId, final_grade AS grade,
    publication_version AS version,
    DATE_FORMAT(published_at,'%Y-%m-%d %H:%i:%s') AS publishedAt
    FROM published_final_grades WHERE school_id=? AND section_id=? AND subject_id=? AND academic_term_id=?`,
  [SCHOOL_ID, section.id, values.id, termId]);
  check(grades.length === 40 && grades.every(g => g.publishedAt === PUBLISHED &&
    Number(g.version) === 1),
    'Expected 40 Values Education grades published at 11:05 AM on November 18.');
  const [existing] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM journal_prompts WHERE school_id=? AND section_id=? AND week_start_date='2026-11-16') AS prompts,
    (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=? AND subject_id=?
      AND academic_term_id=? AND title='WK 1 Journal') AS items,
    (SELECT COUNT(*) FROM attendance_sessions WHERE school_id=? AND section_id=?
      AND attendance_date='2026-11-18') AS sessions`,
  [SCHOOL_ID, section.id, SCHOOL_ID, section.id, values.id, termId, SCHOOL_ID, section.id]);
  check(Number(existing[0].prompts) === 0 && Number(existing[0].items) === 0 &&
    Number(existing[0].sessions) === 0, 'Journal or November 18 attendance already exists; nothing was added.');
  const [rubrics] = await c.execute(`SELECT criteria FROM journal_ai_rubrics
    WHERE school_id=? AND teacher_user_id=? AND journal_subject_id=?`,
  [SCHOOL_ID, values.teacherId, journalSubjects[0].id]);
  check(rubrics.length <= 1 && (!rubrics.length ||
    JSON.stringify(typeof rubrics[0].criteria === 'string' ? JSON.parse(rubrics[0].criteria) : rubrics[0].criteria)
      === JSON.stringify(DEFAULT_CRITERIA)), 'Existing journal rubric differs from the requested four criteria.');
  const [meetings] = await c.execute(`SELECT DISTINCT sub.id AS subjectId, sub.name AS subject,
    st.teacher_user_id AS teacherId FROM timetable_meetings tm
    JOIN scheduled_classes sc ON sc.id=tm.scheduled_class_id AND sc.school_id=tm.school_id
    JOIN section_teachers st ON st.id=sc.assignment_id AND st.school_id=sc.school_id
    JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id
    WHERE tm.school_id=? AND st.section_id=? AND tm.weekday=3
      AND tm.start_time < '10:54:00'
      AND '2026-11-18' BETWEEN tm.start_date AND tm.end_date
    ORDER BY sub.name, sub.id`, [SCHOOL_ID, section.id]);
  check(meetings.length >= 1 && meetings.every(m => subjects.some(s => Number(s.id) === Number(m.subjectId)
    && Number(s.teacherId) === Number(m.teacherId))), 'Wednesday timetable needs review.');
  const [statusCodes] = await c.execute(`SELECT code FROM attendance_status_codes
    WHERE school_id=? AND is_active=1 AND code IN ('present','late','absent')`, [SCHOOL_ID]);
  check(statusCodes.length === 3, 'Attendance status codes need review.');
  const [notices] = await c.execute(`SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE ?`,
    [`grade-published:${section.id}:${values.id}:${termId}:%`]);
  check(Number(notices[0].n) === 40, 'Expected 40 existing Values Education grade notices.');
  return { section, termId, students, subjects, values, journalSubjectId: journalSubjects[0].id,
    componentId: components[0].id, scoreByStudent, grades, meetings, rubricExists: rubrics.length === 1 };
}

async function run({ apply = false, confirm, database, snapshot = takeSnapshot,
  calculate = buildFinalGradePreview } = {}) {
  const db = database || require('../config/database').getDatabase();
  let c;
  let started = false;
  try {
    c = await db.getConnection();
    const scope = await readScope(c);
    const preview = { mode: 'preview', schoolId: SCHOOL_ID, section: 'Grade 7 St. John',
      term: 'Term 1', prompt: PROMPT, promptPreparedAt: PREPARED,
      gradebookItem: 'WK 1 Journal', maxScore: 20, minWords: 15,
      rubric: DEFAULT_CRITERIA, journalEntries: 40, reviewedScores: 40,
      attendanceDate: '2026-11-18', attendanceSubjects: scope.meetings.map(m => m.subject),
      attendanceSessions: scope.meetings.length, attendanceRecords: scope.meetings.length * 40,
      attendanceStatusPerSubject: { present: 36, late: 2, absent: 2 },
      submissionTimeRange: '2026-11-18 10:38:00 to 10:52:00',
      attendanceTimeRange: '2026-11-18 10:54:00 to 10:58:00',
      valuesGradesToRecalculate: 40, preservedPublishedAt: PUBLISHED,
      newGradeNotifications: 0, newAiAssessments: 0, confirmationPhrase: CONFIRMATION };
    console.log(JSON.stringify(preview, null, 2));
    if (!apply) return preview;
    const ask = confirm || (async phrase => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return (await rl.question(`Type ${phrase} to continue: `)).trim() === phrase; }
      finally { rl.close(); }
    });
    if (!await ask(CONFIRMATION)) { console.log('Cancelled. Nothing was added.'); return; }
    c.release(); c = null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    c = await db.getConnection();
    await c.beginTransaction(); started = true;
    await c.execute('SELECT id FROM sections WHERE id=? AND school_id=? FOR UPDATE',
      [scope.section.id, SCHOOL_ID]);
    const current = await readScope(c);
    check(current.section.id === scope.section.id && current.termId === scope.termId &&
      JSON.stringify(current.students) === JSON.stringify(scope.students) &&
      JSON.stringify(current.subjects) === JSON.stringify(scope.subjects) &&
      JSON.stringify(current.grades) === JSON.stringify(scope.grades) &&
      JSON.stringify(current.meetings) === JSON.stringify(scope.meetings) &&
      current.values.id === scope.values.id && current.values.teacherId === scope.values.teacherId &&
      current.journalSubjectId === scope.journalSubjectId &&
      current.componentId === scope.componentId &&
      current.rubricExists === scope.rubricExists &&
      current.students.every(student => current.scoreByStudent.get(Number(student.id)) ===
        scope.scoreByStudent.get(Number(student.id))), 'School data changed after preview.');
    if (!current.rubricExists) await c.execute(`INSERT INTO journal_ai_rubrics
      (school_id, teacher_user_id, journal_subject_id, criteria, updated_at) VALUES (?,?,?,?,?)`,
    [SCHOOL_ID, current.values.teacherId, current.journalSubjectId,
      JSON.stringify(DEFAULT_CRITERIA), PREPARED]);
    const [item] = await c.execute(`INSERT INTO grading_items
      (school_id, section_id, subject_id, academic_term_id, subject_grading_component_id,
       domain_code, teacher_user_id, title, max_score, used_in_published_grades,
       recorded_at, created_at, updated_at)
      VALUES (?,?,?,?,?,'affective',?,'WK 1 Journal',20,1,?,?,?)`,
    [SCHOOL_ID, current.section.id, current.values.id, current.termId,
      current.componentId, current.values.teacherId, PREPARED, PREPARED, PREPARED]);
    const [prompt] = await c.execute(`INSERT INTO journal_prompts
      (school_id, journal_subject_id, section_id, grading_item_id, week_start_date,
       prompt_text, opens_at, due_at, min_words, allow_late, prompt_status,
       created_by_user_id, created_at, updated_at)
      VALUES (?,?,?,?, '2026-11-16', ?, ?, '2026-11-20 23:59:00', 15, 0, 'closed', ?, ?, ?)`,
    [SCHOOL_ID, current.journalSubjectId, current.section.id, item.insertId,
      PROMPT, PREPARED, current.values.teacherId, PREPARED, PREPARED]);
    for (const [index, student] of current.students.entries()) {
      const answer = answerFor(index, current.scoreByStudent.get(Number(student.id)));
      check(answer.trim().split(/\s+/).length >= 15, `Journal answer ${index + 1} is too short.`);
      const when = timeAt(10 * 60 + 38, index, 40);
      await c.execute(`INSERT INTO student_journal_entries
        (school_id, journal_subject_id, student_user_id, owner_teacher_user_id, section_id,
         journal_prompt_id, prompt_text, entry_text, entry_status, submitted_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,'reviewed',?,?,?)`,
      [SCHOOL_ID, current.journalSubjectId, student.id, current.values.teacherId,
        current.section.id, prompt.insertId, PROMPT, answer, when, when, when]);
      const scoreWhen = `2026-11-18 10:${52 + Math.floor(index / 20)}:45`;
      await c.execute(`INSERT INTO student_scores
        (school_id, grading_item_id, student_user_id, score, recorded_by_user_id, recorded_at, updated_at)
        VALUES (?,?,?,?,?,?,?)`,
      [SCHOOL_ID, item.insertId, student.id, current.scoreByStudent.get(Number(student.id)),
        current.values.teacherId, scoreWhen, scoreWhen]);
    }
    for (const [index, meeting] of current.meetings.entries()) {
      const when = new Date(Date.UTC(2026, 10, 18, 10, 54) +
        Math.floor(index * 240 / current.meetings.length) * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');
      const [session] = await c.execute(`INSERT INTO attendance_sessions
        (school_id, section_id, subject_id, attendance_date, method, status,
         created_by_user_id, confirmed_by_user_id, confirmed_at, created_at, updated_at)
        VALUES (?,?,?,'2026-11-18','manual','confirmed',?,?,?,?,?)`,
      [SCHOOL_ID, current.section.id, meeting.subjectId, meeting.teacherId,
        meeting.teacherId, when, when, when]);
      for (const [studentIndex, student] of current.students.entries()) {
        await c.execute(`INSERT INTO attendance_records
          (school_id, attendance_session_id, student_user_id, attendance_status,
           marked_by_user_id, marked_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
        [SCHOOL_ID, session.insertId, student.id, attendanceStatus(studentIndex),
          meeting.teacherId, when, when]);
      }
    }
    const calculated = await calculate(c,
      { id: current.values.teacherId, role: 'teacher', schoolId: SCHOOL_ID },
      { sectionId: current.section.id, subjectId: current.values.id,
        academicTermId: current.termId }, true);
    const before = new Map(current.grades.map(g => [Number(g.studentId), Number(g.grade)]));
    check(calculated.issues.length === 0 && calculated.students.length === 40 &&
      calculated.gradingItemIds.includes(Number(item.insertId)) &&
      calculated.students.every(s => s.finalGrade !== null &&
        (Number(s.finalGrade) >= Number(calculated.passingGradeThreshold)) ===
        (before.get(Number(s.studentId)) >= Number(calculated.passingGradeThreshold))),
    `Values Education grade check failed: ${JSON.stringify(calculated.issues)}.`);
    for (const student of calculated.students) {
      const [updated] = await c.execute(`UPDATE published_final_grades
        SET final_grade=?, domain_rule_version=?, publication_version=publication_version+1,
          correction_reason='Added WK 1 Journal to synthetic demo data', updated_at=NOW()
        WHERE school_id=? AND section_id=? AND subject_id=? AND academic_term_id=?
          AND student_user_id=? AND published_at=?`,
      [student.finalGrade, calculated.domainRuleVersion, SCHOOL_ID, current.section.id,
        current.values.id, current.termId, student.studentId, PUBLISHED]);
      check(updated.affectedRows === 1, `Could not update grade for student ${student.studentId}.`);
    }
    await c.execute(`INSERT INTO audit_logs
      (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'synthetic_demo_grade_correction', 'published_final_grades', ?, ?)`,
    [SCHOOL_ID, current.values.teacherId, current.section.id,
      JSON.stringify({ source: 'synthetic_demo_data', reason: 'Added St. John journal scores and November 18 attendance',
        snapshotId, valuesGradesRecalculated: 40 })]);
    const [[verified]] = await c.execute(`SELECT
      (SELECT COUNT(*) FROM student_journal_entries WHERE school_id=? AND journal_prompt_id=?
        AND entry_status='reviewed') AS entries,
      (SELECT COUNT(*) FROM student_scores WHERE school_id=? AND grading_item_id=?) AS scores,
      (SELECT COUNT(*) FROM attendance_records r JOIN attendance_sessions s
        ON s.id=r.attendance_session_id AND s.school_id=r.school_id
        WHERE s.school_id=? AND s.section_id=? AND s.attendance_date='2026-11-18'
          AND s.status='confirmed') AS attendance,
      (SELECT COUNT(*) FROM published_final_grades WHERE school_id=? AND section_id=?
        AND subject_id=? AND academic_term_id=? AND published_at=?) AS grades`,
    [SCHOOL_ID, prompt.insertId, SCHOOL_ID, item.insertId, SCHOOL_ID,
      current.section.id, SCHOOL_ID, current.section.id, current.values.id,
      current.termId, PUBLISHED]);
    check(Number(verified.entries) === 40 && Number(verified.scores) === 40 &&
      Number(verified.attendance) === current.meetings.length * 40 &&
      Number(verified.grades) === 40, 'Post-insert count verification failed.');
    const [savedGrades] = await c.execute(`SELECT student_user_id AS studentId,
      final_grade AS grade, publication_version AS version,
      DATE_FORMAT(published_at,'%Y-%m-%d %H:%i:%s') AS publishedAt
      FROM published_final_grades WHERE school_id=? AND section_id=?
        AND subject_id=? AND academic_term_id=?`,
    [SCHOOL_ID, current.section.id, current.values.id, current.termId]);
    const expectedGrades = new Map(calculated.students.map(s => [Number(s.studentId), Number(s.finalGrade)]));
    check(savedGrades.length === 40 && savedGrades.every(g =>
      Number(g.grade) === expectedGrades.get(Number(g.studentId)) &&
      Number(g.version) === 2 && g.publishedAt === PUBLISHED),
    'Published Values Education grade verification failed.');
    await c.commit(); started = false;
    const result = { result: 'complete', schoolId: SCHOOL_ID, section: 'Grade 7 St. John',
      journalEntries: 40, journalScores: 40, attendanceSessions: current.meetings.length,
      attendanceRecords: Number(verified.attendance), valuesGradesRecalculated: 40,
      publishedAtPreserved: PUBLISHED, newNotifications: 0, snapshotId, verified: true };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (started) await c.rollback();
    throw error;
  } finally {
    c?.release();
    if (!database) await db.end();
  }
}

async function main() {
  check(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}
if (require.main === module) main().catch(error => {
  console.error('St. John journal and attendance stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { run, readScope, answerFor, attendanceStatus, CONFIRMATION };
