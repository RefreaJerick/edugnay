'use strict';

const { createInterface } = require('node:readline/promises');
const { DOMAIN_WEIGHTS, isDepedValuesSetup, usesDepedValuesDomains } = require('../config/depedValuesDomains');
const { buildFinalGradePreview } = require('../controllers/gradesController');
const { takeSnapshot } = require('./seedSaintColumbanDemoAccounts');

const SCHOOL_ID = 7;
const CONFIRMATION = 'PUBLISH ST JOHN TERM 1 GRADES FOR 40 STUDENTS';
const RECORD_START = Date.UTC(2026, 10, 18, 10, 38);
const PUBLISH_START = Date.UTC(2026, 10, 18, 10, 59);

function check(value, message) { if (!value) throw new Error(message); }
function sqlTime(milliseconds) { return new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' '); }
function recordTime(itemIndex, studentIndex, itemCount) {
  const step = 900 / itemCount;
  return sqlTime(RECORD_START + Math.floor(itemIndex * step + studentIndex * step / 41) * 1000);
}
function publishTime(subjectIndex) {
  return sqlTime(PUBLISH_START + subjectIndex * 45 * 1000);
}
function mockScore(studentId, itemIndex) {
  return Math.round(20 * (0.62 + ((Number(studentId) * 13 + itemIndex * 7) % 34) / 100));
}

function planItems(subject, components, parts) {
  const values = usesDepedValuesDomains(subject.code, 'grade-7', '2026-2027');
  const componentRows = components.filter(row => Number(row.subjectId) === Number(subject.id));
  check(componentRows.length >= 2, `Grading profile missing for ${subject.name}.`);
  check(Math.round(componentRows.reduce((sum, row) => sum + Number(row.weight), 0) * 100) === 10000,
    `Grading weights do not total 100 for ${subject.name}.`);
  const profile = componentRows.map(row => ({ ...row,
    examParts: parts.filter(part => Number(part.componentId) === Number(row.id)) }));
  if (values) check(isDepedValuesSetup(profile), 'Values Education grading setup needs review.');
  const items = [];
  for (const component of profile) {
    const fields = { subjectId: subject.id, teacherId: subject.teacherId,
      componentId: component.id, maxScore: 20 };
    if (component.examParts.length) {
      check(Math.round(component.examParts.reduce((sum, part) => sum + Number(part.weight), 0) * 100) === 10000,
        `Exam part weights do not total 100 for ${subject.name}.`);
      for (const part of component.examParts) items.push({ ...fields,
        examPartId: part.id, domainCode: null, title: part.name });
    } else if (values && DOMAIN_WEIGHTS[component.componentType]) {
      const prefix = component.componentType === 'written' ? 'Quiz' : 'Performance Task';
      Object.keys(DOMAIN_WEIGHTS[component.componentType]).forEach((domainCode, index) =>
        items.push({ ...fields, examPartId: null, domainCode,
          title: `${prefix} ${index + 1} (${domainCode[0].toUpperCase()}${domainCode.slice(1)})` }));
    } else {
      const prefix = component.componentType === 'written' ? 'Quiz'
        : component.componentType === 'performance' ? 'Performance Task' : component.name;
      const count = ['written', 'performance'].includes(component.componentType) ? 2 : 1;
      for (let index = 1; index <= count; index++) items.push({ ...fields,
        examPartId: null, domainCode: null,
        title: count === 1 ? prefix : `${prefix} ${index}` });
    }
  }
  check(items.length >= 3 && new Set(items.map(item => item.title)).size === items.length,
    `Score item titles are invalid for ${subject.name}.`);
  return items;
}

async function readScope(connection) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  check(state.db === 'academix' && Number(state.fk) === 1,
    'Wrong database or foreign-key checks disabled.');
  const [sections] = await connection.execute(`
    SELECT s.id, s.school_level_id AS levelId, s.academic_year_id AS yearId,
           s.grade_level_id AS gradeId
    FROM sections s
    JOIN schools school ON school.id=s.school_id AND school.registration_status='active'
    JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id
    JOIN school_grade_levels g ON g.id=s.grade_level_id AND g.school_id=s.school_id
    JOIN school_levels l ON l.id=s.school_level_id AND l.school_id=s.school_id
    WHERE s.school_id=? AND school.name=? AND s.name='St. John' AND s.status='active'
      AND y.label='2026-2027' AND y.status='active' AND g.grade_code='grade-7'
      AND l.level_code='jhs'`, [SCHOOL_ID, "Saint Columban's College"]);
  check(sections.length === 1, 'Expected one active Grade 7 St. John in school ID 7.');
  const section = sections[0];
  const [terms] = await connection.execute(`
    SELECT id, name FROM academic_terms WHERE school_id=? AND academic_year_id=?
      AND school_level_id=? AND sequence_number=1 AND status='active'`,
    [SCHOOL_ID, section.yearId, section.levelId]);
  check(terms.length === 1, 'Expected an active JHS Term 1.');
  const term = terms[0];
  const [subjects] = await connection.execute(`
    SELECT sub.id, sub.name, sub.subject_code AS code,
           st.teacher_user_id AS teacherId, u.display_name AS teacher
    FROM section_teachers st
    JOIN subjects sub ON sub.id=st.subject_id AND sub.school_id=st.school_id AND sub.is_active=1
    JOIN users u ON u.id=st.teacher_user_id AND u.school_id=st.school_id
      AND u.role='teacher' AND u.account_status='active'
    WHERE st.school_id=? AND st.section_id=? ORDER BY sub.name, sub.id`,
    [SCHOOL_ID, section.id]);
  check(subjects.length === 9 && new Set(subjects.map(row => Number(row.id))).size === 9,
    'Expected nine assigned Grade 7 subjects with active teachers.');
  const [students] = await connection.execute(`
    SELECT u.id, u.display_name AS name FROM section_students e
    JOIN users u ON u.id=e.student_user_id AND u.school_id=e.school_id
      AND u.role='student' AND u.account_status='active'
    WHERE e.school_id=? AND e.section_id=? AND e.withdrawn_at IS NULL
    ORDER BY u.last_name, u.first_name, u.id`, [SCHOOL_ID, section.id]);
  check(students.length === 40 && new Set(students.map(row => Number(row.id))).size === 40,
    'Expected exactly 40 active students in St. John.');
  const [[features]] = await connection.execute(
    'SELECT grades_enabled AS enabled FROM school_portal_features WHERE school_id=?', [SCHOOL_ID]);
  check(Number(features?.enabled) === 1,
    'Enable the Grades portal feature before publishing student notifications.');
  const [[existing]] = await connection.execute(`
    SELECT (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=? AND academic_term_id=?) AS items,
           (SELECT COUNT(*) FROM published_final_grades WHERE school_id=? AND section_id=? AND academic_term_id=?) AS grades,
           (SELECT COUNT(*) FROM notifications WHERE event_key LIKE ?) AS notices`,
    [SCHOOL_ID, section.id, term.id, SCHOOL_ID, section.id, term.id,
      `grade-published:${section.id}:%:${term.id}:%`]);
  check(Number(existing.items) === 0 && Number(existing.grades) === 0 && Number(existing.notices) === 0,
    'Term 1 already has St. John score items, published grades, or grade notifications.');
  const [components] = await connection.execute(`
    SELECT p.subject_id AS subjectId, c.id, c.name, c.component_type AS componentType, c.weight
    FROM subject_grading_profiles p
    JOIN subject_grading_components c ON c.profile_id=p.id AND c.school_id=p.school_id
    WHERE p.school_id=? AND p.academic_year_id=? AND p.school_level_id=?
      AND p.subject_id IN (${subjects.map(() => '?').join(',')})
    ORDER BY p.subject_id, c.sort_order, c.id`,
    [SCHOOL_ID, section.yearId, section.levelId, ...subjects.map(row => row.id)]);
  const componentIds = components.map(row => row.id);
  check(componentIds.length > 0, 'No subject grading components found.');
  const [parts] = await connection.execute(`
    SELECT id, component_id AS componentId, code, name, weight
    FROM subject_grading_exam_parts WHERE school_id=?
      AND component_id IN (${componentIds.map(() => '?').join(',')})
    ORDER BY component_id, sort_order, id`, [SCHOOL_ID, ...componentIds]);
  const itemPlans = subjects.flatMap(subject => planItems(subject, components, parts));
  return { section, term, subjects, students, itemPlans };
}

async function verify(connection, scope, itemIds, noticeIds) {
  const [[counts]] = await connection.execute(`
    SELECT (SELECT COUNT(*) FROM grading_items WHERE school_id=? AND section_id=? AND academic_term_id=?
              AND used_in_published_grades=1) AS items,
           (SELECT COUNT(*) FROM student_scores ss JOIN grading_items gi ON gi.id=ss.grading_item_id
              WHERE gi.school_id=? AND gi.section_id=? AND gi.academic_term_id=?) AS scores,
           (SELECT COUNT(*) FROM published_final_grades WHERE school_id=? AND section_id=?
              AND academic_term_id=?) AS grades,
           (SELECT COUNT(*) FROM notifications WHERE id IN (${noticeIds.map(() => '?').join(',')})) AS notices`,
    [SCHOOL_ID, scope.section.id, scope.term.id,
      SCHOOL_ID, scope.section.id, scope.term.id,
      SCHOOL_ID, scope.section.id, scope.term.id, ...noticeIds]);
  check(Number(counts.items) === itemIds.length &&
    Number(counts.scores) === itemIds.length * 40 &&
    Number(counts.grades) === 360 && Number(counts.notices) === 360,
  'Final record counts failed verification.');
  const [[timeBounds]] = await connection.execute(`
    SELECT (SELECT DATE_FORMAT(MIN(recorded_at),'%Y-%m-%d %H:%i:%s') FROM grading_items
              WHERE school_id=? AND section_id=? AND academic_term_id=?) AS firstItem,
           (SELECT DATE_FORMAT(MAX(recorded_at),'%Y-%m-%d %H:%i:%s') FROM grading_items
              WHERE school_id=? AND section_id=? AND academic_term_id=?) AS lastItem,
           (SELECT DATE_FORMAT(MIN(ss.recorded_at),'%Y-%m-%d %H:%i:%s') FROM student_scores ss
              JOIN grading_items gi ON gi.id=ss.grading_item_id
              WHERE gi.school_id=? AND gi.section_id=? AND gi.academic_term_id=?) AS firstScore,
           (SELECT DATE_FORMAT(MAX(ss.recorded_at),'%Y-%m-%d %H:%i:%s') FROM student_scores ss
              JOIN grading_items gi ON gi.id=ss.grading_item_id
              WHERE gi.school_id=? AND gi.section_id=? AND gi.academic_term_id=?) AS lastScore`,
    [SCHOOL_ID, scope.section.id, scope.term.id, SCHOOL_ID, scope.section.id, scope.term.id,
      SCHOOL_ID, scope.section.id, scope.term.id, SCHOOL_ID, scope.section.id, scope.term.id]);
  check([timeBounds.firstItem, timeBounds.lastItem, timeBounds.firstScore, timeBounds.lastScore]
    .every(time => time >= '2026-11-18 10:38:00' && time <= '2026-11-18 10:53:00'),
  'Score recording times failed verification.');
  const [grades] = await connection.execute(`
    SELECT subject_id AS subjectId, student_user_id AS studentId,
           DATE_FORMAT(published_at,'%Y-%m-%d %H:%i:%s') AS publishedAt,
           DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
    FROM published_final_grades WHERE school_id=? AND section_id=? AND academic_term_id=?`,
    [SCHOOL_ID, scope.section.id, scope.term.id]);
  const timeBySubject = new Map(scope.subjects.map((subject, index) =>
    [Number(subject.id), publishTime(index)]));
  check(grades.every(row => row.publishedAt === timeBySubject.get(Number(row.subjectId)) &&
    row.createdAt === row.publishedAt), 'Published grade times failed verification.');
  const [notices] = await connection.execute(`
    SELECT id, user_id AS userId, event_key AS eventKey,
           DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS createdAt
    FROM notifications WHERE id IN (${noticeIds.map(() => '?').join(',')})`, noticeIds);
  check(notices.length === 360 && notices.every(row => {
    const grade = grades.find(g => row.eventKey ===
      `grade-published:${scope.section.id}:${g.subjectId}:${scope.term.id}:${g.studentId}` &&
      Number(row.userId) === Number(g.studentId));
    return grade && row.createdAt === grade.publishedAt;
  }), 'Student notification times failed verification.');
  return counts;
}

async function run({ apply = false, confirm, database, snapshot = takeSnapshot,
  calculate = buildFinalGradePreview } = {}) {
  const db = database || require('../config/database').getDatabase();
  let connection;
  let started = false;
  try {
    connection = await db.getConnection();
    const scope = await readScope(connection);
    console.table(scope.subjects.map(subject => ({
      subject: subject.name, teacher: subject.teacher,
      scoreItems: scope.itemPlans.filter(item => Number(item.subjectId) === Number(subject.id)).length
    })));
    console.table(scope.itemPlans.map((item, index) => ({
      subject: scope.subjects.find(subject => Number(subject.id) === Number(item.subjectId)).name,
      title: item.title, domain: item.domainCode || '-', maxScore: item.maxScore,
      recordedAt: recordTime(index, 0, scope.itemPlans.length)
    })));
    console.log(JSON.stringify({ mode: 'preview', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', term: scope.term.name, students: 40,
      scoreItems: scope.itemPlans.length, scores: scope.itemPlans.length * 40,
      publishedGrades: 360, studentNotifications: 360,
      scoreTimeRange: '2026-11-18 10:38:00 to 10:53:00',
      publicationTimeRange: '2026-11-18 10:59:00 to 11:05:00',
      confirmationPhrase: CONFIRMATION }, null, 2));
    if (!apply) return { mode: 'preview', scope };
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
    await connection.execute('SELECT id FROM sections WHERE id=? AND school_id=? FOR UPDATE',
      [scope.section.id, SCHOOL_ID]);
    const current = await readScope(connection);
    check(current.section.id === scope.section.id && current.term.id === scope.term.id &&
      JSON.stringify(current.subjects) === JSON.stringify(scope.subjects) &&
      JSON.stringify(current.students) === JSON.stringify(scope.students) &&
      JSON.stringify(current.itemPlans) === JSON.stringify(scope.itemPlans),
    'School setup changed after preview.');
    const itemIds = [];
    const itemsBySubject = new Map(current.subjects.map(subject => [Number(subject.id), []]));
    for (const [index, item] of current.itemPlans.entries()) {
      const when = recordTime(index, 0, current.itemPlans.length);
      const [created] = await connection.execute(`
        INSERT INTO grading_items
          (school_id, section_id, subject_id, academic_term_id,
           subject_grading_component_id, subject_grading_exam_part_id, domain_code,
           teacher_user_id, title, max_score, recorded_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [SCHOOL_ID, current.section.id, item.subjectId, current.term.id,
          item.componentId, item.examPartId, item.domainCode,
          item.teacherId, item.title, item.maxScore, when, when, when]);
      itemIds.push(created.insertId);
      itemsBySubject.get(Number(item.subjectId)).push(created.insertId);
      for (const [studentIndex, student] of current.students.entries()) {
        const scoreWhen = recordTime(index, studentIndex + 1, current.itemPlans.length);
        await connection.execute(`
          INSERT INTO student_scores
            (school_id, grading_item_id, student_user_id, score,
             recorded_by_user_id, recorded_at, updated_at)
          VALUES (?,?,?,?,?,?,?)`,
          [SCHOOL_ID, created.insertId, student.id, mockScore(student.id, index),
            item.teacherId, scoreWhen, scoreWhen]);
      }
    }
    const noticeIds = [];
    const gradeSummary = [];
    for (const [index, subject] of current.subjects.entries()) {
      const time = publishTime(index);
      const user = { id: subject.teacherId, role: 'teacher', schoolId: SCHOOL_ID };
      const preview = await calculate(connection, user, {
        sectionId: current.section.id, subjectId: subject.id, academicTermId: current.term.id
      }, true);
      check(preview.readyToPublish && preview.students.length === 40 &&
        preview.gradingItemIds.length === itemsBySubject.get(Number(subject.id)).length &&
        preview.students.every(student => !student.retainedPublishedGrade &&
          student.finalGrade !== null && student.finalGrade >= preview.passingGradeThreshold),
      `Grade calculation is not ready for ${subject.name}: ${JSON.stringify(preview.issues)}.`);
      check(preview.transferReviewStudentIds.length === 0,
        `Transferred work needs review for ${subject.name}.`);
      for (const student of preview.students) {
        await connection.execute(`
          INSERT INTO published_final_grades
            (school_id, section_id, subject_id, academic_term_id, student_user_id,
             final_grade, domain_rule_version, published_by_user_id,
             published_at, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [SCHOOL_ID, current.section.id, subject.id, current.term.id, student.studentId,
            student.finalGrade, preview.domainRuleVersion, subject.teacherId, time, time, time]);
        const eventKey = `grade-published:${current.section.id}:${subject.id}:${current.term.id}:${student.studentId}`;
        const [notice] = await connection.execute(`
          INSERT INTO notifications
            (user_id, type, title, message, target_path, event_key, created_at)
          VALUES (?, 'grade', 'Subject grade published', ?, ?, ?, ?)`,
          [student.studentId,
            `Your final grade in ${subject.name} for ${current.term.name} has been published.`,
            '/views/student/edugnay-student-grades.html', eventKey, time]);
        check(notice.affectedRows === 1, `Notification failed for student ${student.studentId}.`);
        noticeIds.push(notice.insertId);
      }
      await connection.execute(`
        UPDATE grading_items SET used_in_published_grades=1, updated_at=?
        WHERE school_id=? AND section_id=? AND subject_id=? AND academic_term_id=?`,
        [time, SCHOOL_ID, current.section.id, subject.id, current.term.id]);
      await connection.execute(`
        INSERT INTO audit_logs
          (school_id, actor_user_id, action_type, entity_type, details, created_at)
        VALUES (?, ?, 'final_grades_published', 'published_final_grades', ?, ?)`,
        [SCHOOL_ID, subject.teacherId,
          JSON.stringify({ summary: `${subject.name} · St. John · ${current.term.name} · 40 students`,
            source: 'synthetic_demo_data' }), time]);
      gradeSummary.push({ subject: subject.name, teacher: subject.teacher,
        publishedAt: time, grades: preview.students.length });
    }
    const [pushTables] = await connection.execute(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notification_push_deliveries'`);
    if (pushTables.length) {
      // Keep historical in-app notices without sending fresh device pushes today.
      await connection.execute(`DELETE FROM notification_push_deliveries
        WHERE notification_id IN (${noticeIds.map(() => '?').join(',')})`, noticeIds);
      const [[queued]] = await connection.execute(`SELECT COUNT(*) AS n FROM notification_push_deliveries
        WHERE notification_id IN (${noticeIds.map(() => '?').join(',')})`, noticeIds);
      check(Number(queued.n) === 0, 'Live push delivery queue was not cleared.');
    }
    await verify(connection, current, itemIds, noticeIds);
    await connection.commit();
    started = false;
    console.log(JSON.stringify({ result: 'complete', schoolId: SCHOOL_ID,
      section: 'Grade 7 St. John', term: current.term.name,
      scoreItemsCreated: itemIds.length, studentScoresEntered: itemIds.length * 40,
      gradesPublished: 360, inAppNotifications: noticeIds.length,
      livePushNotifications: 0, subjects: gradeSummary,
      snapshotId, verified: true }, null, 2));
    return { result: 'complete', itemIds, noticeIds };
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
  const args = process.argv.slice(2);
  check(args.length === 1 && ['--preview', '--apply'].includes(args[0]),
    'Use --preview or --apply.');
  await run({ apply: args[0] === '--apply' });
}

if (require.main === module) main().catch(error => {
  console.error('St. John Term 1 grading stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { planItems, readScope, recordTime, publishTime, mockScore,
  verify, run, CONFIRMATION };
