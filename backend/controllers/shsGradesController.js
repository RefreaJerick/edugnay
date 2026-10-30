const { getDatabase } = require('../config/database');
const { assertElectiveTeacher } = require('../utils/shsTeachingAccess');
const { writeAuditLog } = require('../utils/auditLog');
const { policyBlockReason, requiredParts, calculateTermGrade } = require('../config/shsGrading');
const { loadShsPolicy } = require('../utils/shsGradingProfiles');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}

async function resolveScope(db, user, input, write = false) {
  if (input.electiveClassId) {
    if (input.sectionId || input.subjectId) fail('Choose either an elective class or a core subject.');
    const item = await assertElectiveTeacher(db, user, id(input.electiveClassId, 'elective class ID'), { write });
    const scope = { kind: 'elective', classId: Number(item.id), yearId: Number(item.academicYearId),
      levelId: Number(item.schoolLevelId), gradeCode: item.gradeCode, yearLabel: item.academicYearLabel,
      yearStatus: item.yearStatus,
      group: item.assessmentGroup, offeringId: Number(item.offeringId), subjectName: item.subjectName, className: item.className,
      classActive: Boolean(item.classActive), offeringActive: Boolean(item.offeringActive), teacherStatus: item.teacherStatus,
      schoolId: user.schoolId };
    scope.policy = await loadShsPolicy(db, scope);
    if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode), 409);
    return scope;
  }
  const sectionId = id(input.sectionId, 'section ID');
  const subjectId = id(input.subjectId, 'subject ID');
  const [rows] = await db.execute(
    `SELECT s.id AS sectionId, s.name AS className, s.academic_year_id AS yearId,
      s.school_level_id AS levelId, g.grade_code AS gradeCode,
      y.label AS yearLabel, y.status AS yearStatus,
      sub.name AS subjectName
     FROM section_teachers st
     JOIN sections s ON s.id = st.section_id AND s.school_id = st.school_id
     JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
     JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
     JOIN subjects sub ON sub.id = st.subject_id AND sub.school_id = st.school_id AND sub.is_active = TRUE
     JOIN users t ON t.id = st.teacher_user_id AND t.school_id = st.school_id
     WHERE st.school_id = ? AND st.teacher_user_id = ? AND st.section_id = ? AND st.subject_id = ?
       AND t.account_status = 'active' AND s.status = 'active'
       AND s.shs_curriculum_code = 'strengthened_2026' AND l.level_code = 'shs'
       AND sub.shs_subject_type = 'core' LIMIT 1${write ? ' FOR UPDATE' : ''}`,
    [user.schoolId, user.id, sectionId, subjectId]
  );
  if (!rows.length) fail('This Strengthened SHS core subject is not assigned to you.', 404);
  const scope = { ...rows[0], kind: 'core', sectionId, subjectId, group: 'core', schoolId: user.schoolId };
  if (write && scope.yearStatus !== 'active') fail('Archived school years are read-only.', 409);
  scope.policy = await loadShsPolicy(db, scope);
  if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode), 409);
  return scope;
}

async function lockYear(db, scope) {
  const [rows] = await db.execute(
    'SELECT status FROM academic_years WHERE school_id = ? AND id = ? FOR UPDATE',
    [scope.schoolId, scope.yearId]
  );
  if (rows[0]?.status !== 'active') fail('Archived school years are read-only.', 409);
}

async function loadTerms(db, scope) {
  const [terms] = await db.execute(
    `SELECT id, name, status, sequence_number AS sequenceNumber,
      DATE_FORMAT(planned_start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(planned_end_date, '%Y-%m-%d') AS endDate
     FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ?
     ORDER BY sequence_number`, [scope.schoolId, scope.yearId, scope.levelId]
  );
  return terms;
}

async function assertTerm(db, scope, termId, write = false) {
  const term = (await loadTerms(db, scope)).find(row => Number(row.id) === Number(termId));
  if (!term) fail('The grading period does not belong to this class.', 404);
  if (write) {
    const [lockedTerms] = await db.execute(
      'SELECT status FROM academic_terms WHERE school_id = ? AND id = ? AND academic_year_id = ? FOR UPDATE',
      [scope.schoolId, termId, scope.yearId]
    );
    if (!lockedTerms.length) fail('The grading period does not belong to this class.', 404);
    term.status = lockedTerms[0].status;
  }
  if (write && term.status !== 'active') fail('This grading period is locked.', 409);
  return term;
}

async function roster(db, scope, forUpdate = false) {
  const [rows] = await db.execute(scope.kind === 'core'
    ? `SELECT u.id AS studentId, u.display_name AS studentName
       FROM section_students m JOIN users u ON u.id = m.student_user_id AND u.school_id = m.school_id
       WHERE m.school_id = ? AND m.section_id = ? AND m.withdrawn_at IS NULL
         AND u.role = 'student' AND u.account_status = 'active' ORDER BY u.last_name, u.first_name${forUpdate ? ' FOR UPDATE' : ''}`
    : `SELECT u.id AS studentId, u.display_name AS studentName
       FROM shs_elective_class_students m JOIN users u ON u.id = m.student_user_id AND u.school_id = m.school_id
       WHERE m.school_id = ? AND m.elective_class_id = ? AND m.withdrawn_at IS NULL
         AND u.role = 'student' AND u.account_status = 'active' ORDER BY u.last_name, u.first_name${forUpdate ? ' FOR UPDATE' : ''}`,
    [scope.schoolId, scope.kind === 'core' ? scope.sectionId : scope.classId]
  );
  return rows;
}

async function loadItems(db, scope, termId, forUpdate = false) {
  const [items] = await db.execute(
    `SELECT id, title, max_score AS maxScore, shs_component_code AS componentCode,
      shs_exam_part_code AS examPartCode, used_in_published_grades AS usedInPublishedGrades
     FROM grading_items WHERE school_id = ? AND academic_term_id = ?
       AND ${scope.kind === 'core'
         ? 'section_id = ? AND subject_id = ? AND shs_elective_class_id IS NULL'
         : 'shs_elective_class_id = ? AND section_id IS NULL AND subject_id IS NULL'}
     ORDER BY recorded_at, id${forUpdate ? ' FOR UPDATE' : ''}`,
    [scope.schoolId, termId, ...(scope.kind === 'core' ? [scope.sectionId, scope.subjectId] : [scope.classId])]
  );
  return items;
}

async function loadScores(db, scope, items, forUpdate = false) {
  if (!items.length) return [];
  const [rows] = await db.execute(
    `SELECT s.id, s.grading_item_id AS gradingItemId, s.student_user_id AS studentId,
      s.score, s.remarks FROM student_scores s JOIN grading_items i
        ON i.id = s.grading_item_id AND i.school_id = ?
     WHERE s.school_id = ? AND s.grading_item_id IN (${items.map(() => '?').join(',')})${forUpdate ? ' FOR UPDATE' : ''}`,
    [scope.schoolId, scope.schoolId, ...items.map(item => item.id)]
  );
  return rows;
}

async function workspace(req, res, next) {
  try {
    const db = getDatabase();
    const scope = await resolveScope(db, req.user, req.query);
    const terms = await loadTerms(db, scope);
    const termId = req.query.academicTermId ? id(req.query.academicTermId, 'term ID')
      : Number(terms.find(term => term.status === 'active')?.id || terms[0]?.id);
    const term = termId ? await assertTerm(db, scope, termId) : null;
    const rosterStudents = await roster(db, scope);
    const items = term ? await loadItems(db, scope, termId) : [];
    const scores = await loadScores(db, scope, items);
    const scoresByStudent = new Map();
    for (const score of scores) {
      const studentId = String(score.studentId);
      if (!scoresByStudent.has(studentId)) scoresByStudent.set(studentId, new Map());
      scoresByStudent.get(studentId).set(Number(score.gradingItemId), score.score == null ? null : Number(score.score));
    }
    const students = rosterStudents.map(student => {
      const studentScores = scoresByStudent.get(String(student.studentId)) || new Map();
      const componentAverages = {};
      for (const component of scope.policy?.components || []) {
        const examParts = component.examParts || {};
        const parts = Object.keys(examParts).length ? Object.entries(examParts) : [[null, 100]];
        let componentRatio = 0;
        let complete = true;
        for (const [part, configuredWeight] of parts) {
          const partItems = items.filter(item => item.componentCode === component.code
            && (part === null || item.examPartCode === part));
          const maximum = partItems.reduce((sum, item) => sum + Number(item.maxScore), 0);
          if (!partItems.length || maximum <= 0 || partItems.some(item => {
            const score = studentScores.get(Number(item.id));
            return score == null || !Number.isFinite(score) || score < 0 || score > Number(item.maxScore);
          })) {
            complete = false;
            break;
          }
          const earned = partItems.reduce((sum, item) => sum + Number(studentScores.get(Number(item.id))), 0);
          const partWeight = part === null ? 1
            : Number(typeof configuredWeight === 'object' ? configuredWeight.weight : configuredWeight) / 100;
          componentRatio += earned / maximum * partWeight;
        }
        componentAverages[component.code] = complete ? Math.round(componentRatio * 1000) / 10 : null;
      }
      const calculated = scope.policy ? calculateTermGrade(scope.policy, items, studentScores)
        : { problem: policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) };
      return { ...student, ...calculated, componentAverages };
    });
    const published = term ? (await db.execute(
      `SELECT student_user_id AS studentId, final_grade AS finalGrade,
        publication_version AS publicationVersion, correction_reason AS correctionReason,
        published_at AS publishedAt
       FROM published_final_grades WHERE school_id = ? AND academic_term_id = ?
         AND ${scope.kind === 'core'
           ? 'section_id = ? AND subject_id = ? AND shs_elective_class_id IS NULL'
           : 'shs_elective_class_id = ? AND section_id IS NULL AND subject_id IS NULL'}`,
      [scope.schoolId, termId, ...(scope.kind === 'core' ? [scope.sectionId, scope.subjectId] : [scope.classId])]
    ))[0] : [];
    res.json({ scope: { ...scope, policy: scope.policy && {
      group: scope.policy.group, weights: scope.policy.weights, components: scope.policy.components,
      method: scope.policy.method,
      requiredExamParts: requiredParts(scope.policy), source: scope.policy.source
    }, policyBlockReason: policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) }, terms, term, students, items, scores, published });
  } catch (error) { next(error); }
}

async function insertItem(connection, req, scope, termId, values, options = {}) {
    const component = String(values.componentCode || '');
    const part = values.examPartCode == null ? null : String(values.examPartCode);
    const ruleComponent = scope.policy.components?.find(row => row.code === component && Number(row.weight) > 0);
    if (!ruleComponent) fail('Choose a grading component used by this subject.');
    const componentParts = Object.keys(ruleComponent.examParts || {});
    if (componentParts.length ? !componentParts.includes(part) : part !== null)
      fail('Choose a valid examination part.');
    const assignmentId = values.assignmentId ? id(values.assignmentId, 'assignment ID') : null;
    if (assignmentId && scope.kind !== 'elective') fail('Only elective assignments can be linked here.');
    let assignment = null;
    if (assignmentId) {
      const [rows] = await connection.execute(
        `SELECT id, title, grading_item_id AS gradingItemId FROM assignments
         WHERE school_id = ? AND id = ? AND shs_elective_class_id = ? FOR UPDATE`,
        [scope.schoolId, assignmentId, scope.classId]
      );
      assignment = rows[0];
      if (!assignment || assignment.gradingItemId) fail('This assignment is unavailable or already graded.', 409);
    }
    const title = String(assignment?.title || values.title || '').trim();
    const maxScore = Number(values.maxScore);
    if (!title || title.length > 255 || !Number.isFinite(maxScore) || maxScore <= 0
      || maxScore > 999999.99 || Math.abs(Math.round(maxScore * 100) - maxScore * 100) > 1e-7)
      fail('Enter a title and a positive maximum score.');
    const [result] = await connection.execute(
      `INSERT INTO grading_items (school_id, section_id, subject_id, shs_elective_class_id,
        academic_term_id, teacher_user_id, title, max_score, shs_component_code, shs_exam_part_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [scope.schoolId, scope.kind === 'core' ? scope.sectionId : null,
        scope.kind === 'core' ? scope.subjectId : null, scope.kind === 'elective' ? scope.classId : null,
        termId, req.user.id, title, maxScore, component, part]
    );
    if (assignment) {
      await connection.execute(
        `UPDATE assignments SET academic_term_id = ?, max_score = ?, grading_item_id = ?
         WHERE school_id = ? AND id = ? AND shs_elective_class_id = ? AND grading_item_id IS NULL`,
        [termId, maxScore, result.insertId, scope.schoolId, assignmentId, scope.classId]
      );
    }
    if (options.recordActivity !== false) {
      await writeAuditLog(connection, req, 'shs_grading_item_created', 'grading_item', result.insertId, {
        itemName: title, subjectName: scope.subjectName, className: scope.className,
        gradeCode: scope.gradeCode, schoolYear: scope.yearLabel,
        assignmentId: assignment?.id || null, assignmentTitle: assignment?.title || null
      });
    }
    return result.insertId;
}

async function createLinkedAssignmentItem(connection, req, electiveClassId, assignmentId, values) {
    const lookup = await resolveScope(connection, req.user, { electiveClassId });
    await lockYear(connection, lookup);
    const scope = await resolveScope(connection, req.user, { electiveClassId }, true);
    const termId = id(values.academicTermId, 'term ID');
    await assertTerm(connection, scope, termId, true);
    return insertItem(connection, req, scope, termId, { ...values, assignmentId }, { recordActivity: false });
}

async function createItem(req, res, next) {
  const db = getDatabase(); const connection = await db.getConnection(); let started = false;
  try {
    await connection.beginTransaction(); started = true;
    const scopeLookup = await resolveScope(connection, req.user, req.body);
    await lockYear(connection, scopeLookup);
    const scope = await resolveScope(connection, req.user, req.body, true);
    if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) || 'The SHS grading policy is unavailable.', 409);
    const termId = id(req.body.academicTermId, 'term ID');
    await assertTerm(connection, scope, termId, true);
    const itemId = await insertItem(connection, req, scope, termId, req.body);
    await connection.commit(); started = false;
    res.status(201).json({ id: itemId });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function saveScore(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    await connection.beginTransaction(); started = true;
    const scopeLookup = await resolveScope(connection, req.user, req.body);
    await lockYear(connection, scopeLookup);
    const scope = await resolveScope(connection, req.user, req.body, true);
    if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) || 'The SHS grading policy is unavailable.', 409);
    const termId = id(req.body.academicTermId, 'term ID');
    await assertTerm(connection, scope, termId, true);
    const itemId = id(req.body.gradingItemId, 'grading item ID');
    const item = (await loadItems(connection, scope, termId, true)).find(row => Number(row.id) === itemId);
    if (!item) fail('Grading item not found in this class.', 404);
    if (item.usedInPublishedGrades) fail('Published grades protect this score component from changes.', 409);
    const studentId = id(req.body.studentId, 'student ID');
    const student = (await roster(connection, scope, true)).find(row => Number(row.studentId) === studentId);
    if (!student)
      fail('The learner is not an active member of this class.', 403);
    const score = Number(req.body.score);
    if (req.body.score === null || req.body.score === undefined || String(req.body.score).trim() === ''
      || !Number.isFinite(score) || score < 0 || score > Number(item.maxScore)
      || Math.abs(Math.round(score * 100) - score * 100) > 1e-7)
      fail('Score must be between zero and the maximum score.');
    await connection.execute(
      `INSERT INTO student_scores (school_id, grading_item_id, student_user_id, score, recorded_by_user_id)
       VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score),
         recorded_by_user_id = VALUES(recorded_by_user_id), recorded_at = NOW()`,
      [scope.schoolId, itemId, studentId, score, req.user.id]
    );
    await writeAuditLog(connection, req, 'shs_score_saved', 'grading_item', itemId, {
      studentId, studentName: student.studentName, itemName: item.title, subjectName: scope.subjectName,
      className: scope.className, gradeCode: scope.gradeCode, schoolYear: scope.yearLabel,
      score, maxScore: Number(item.maxScore)
    });
    await connection.commit(); started = false; res.json({ saved: true });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function correctScore(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    await connection.beginTransaction(); started = true;
    const scopeLookup = await resolveScope(connection, req.user, req.body);
    await lockYear(connection, scopeLookup);
    const scope = await resolveScope(connection, req.user, req.body, true);
    if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) || 'The grading policy is unavailable.', 409);
    const termId = id(req.body.academicTermId, 'term ID');
    await assertTerm(connection, scope, termId, true);
    const itemId = id(req.body.gradingItemId, 'grading item ID');
    const item = (await loadItems(connection, scope, termId, true)).find(row => Number(row.id) === itemId);
    if (!item) fail('Grading item not found in this class.', 404);
    const studentId = id(req.body.studentId, 'student ID');
    const student = (await roster(connection, scope, true)).find(row => Number(row.studentId) === studentId);
    if (!student)
      fail('The learner is not an active member of this class.', 403);
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10 || reason.length > 500) fail('Enter a correction reason between 10 and 500 characters.');
    const score = Number(req.body.score);
    if (req.body.score === null || req.body.score === undefined || String(req.body.score).trim() === ''
      || !Number.isFinite(score) || score < 0 || score > Number(item.maxScore)
      || Math.abs(Math.round(score * 100) - score * 100) > 1e-7)
      fail('Score must be between zero and the maximum score.');
    const [existing] = await connection.execute(
      `SELECT id, score FROM student_scores WHERE school_id = ? AND grading_item_id = ?
       AND student_user_id = ? FOR UPDATE`, [scope.schoolId, itemId, studentId]
    );
    if (!existing.length) fail('There is no saved score to correct.', 404);
    if (!item.usedInPublishedGrades) fail('This score has not been published. Use the regular Save action instead.');
    const [published] = await connection.execute(
      `SELECT id, publication_version AS publicationVersion, latest_history_id AS publishedHistoryId
       FROM published_final_grades WHERE school_id = ? AND academic_term_id = ?
       AND student_user_id = ? AND ${scope.kind === 'core'
         ? 'section_id = ? AND subject_id = ? AND shs_elective_class_id IS NULL'
         : 'shs_elective_class_id = ? AND section_id IS NULL AND subject_id IS NULL'} LIMIT 1 FOR UPDATE`,
      [scope.schoolId, termId, studentId, ...(scope.kind === 'core' ? [scope.sectionId, scope.subjectId] : [scope.classId])]
    );
    if (!published.length) fail('There is no published grade snapshot for this learner and term.', 409);
    if (!published[0].publishedHistoryId) fail('The published grade has no audit snapshot. The score cannot be corrected safely.', 409);
    await connection.execute(
      `INSERT INTO shs_grade_score_corrections
        (school_id, grading_item_id, student_user_id, old_score, new_score, published_history_id,
         publication_version, reason, changed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [scope.schoolId, itemId, studentId, existing[0].score, score, published[0].publishedHistoryId,
        published[0].publicationVersion, reason, req.user.id]
    );
    await connection.execute(
      `UPDATE student_scores SET score = ?, recorded_by_user_id = ?, recorded_at = NOW()
       WHERE school_id = ? AND grading_item_id = ? AND student_user_id = ?`,
      [score, req.user.id, scope.schoolId, itemId, studentId]
    );
    await writeAuditLog(connection, req, 'shs_score_corrected', 'grading_item', itemId,
      { studentId, studentName: student.studentName, itemName: item.title,
        subjectName: scope.subjectName, className: scope.className, gradeCode: scope.gradeCode,
        schoolYear: scope.yearLabel, oldScore: Number(existing[0].score), newScore: score, reason });
    await connection.commit(); started = false; res.json({ corrected: true, publishedSnapshotUnchanged: true });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function buildPreview(db, scope, termId, forUpdate = false) {
  const term = await assertTerm(db, scope, termId, forUpdate);
  const students = await roster(db, scope, forUpdate);
  const items = await loadItems(db, scope, termId, forUpdate);
  const scores = await loadScores(db, scope, items, forUpdate);
  const byStudent = new Map();
  for (const score of scores) {
    if (!byStudent.has(Number(score.studentId))) byStudent.set(Number(score.studentId), new Map());
    byStudent.get(Number(score.studentId)).set(Number(score.gradingItemId), score.score);
  }
  const blockReason = policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode);
  return { scope, term, items, policyBlockReason: blockReason, students: students.map(student => {
    const studentScores = byStudent.get(Number(student.studentId)) || new Map();
    return { ...student, ...(blockReason ? { problem: blockReason } : calculateTermGrade(scope.policy, items, studentScores)),
      scoreSnapshot: { policy: { group: scope.policy?.group, weights: scope.policy?.weights,
        components: scope.policy?.components,
        examParts: scope.policy?.examParts, method: scope.policy?.method, source: scope.policy?.source },
        items: items.map(item => ({ gradingItemId: Number(item.id), title: item.title,
          componentCode: item.componentCode, examPartCode: item.examPartCode,
          maxScore: Number(item.maxScore), score: studentScores.has(Number(item.id)) ? Number(studentScores.get(Number(item.id))) : null })) } };
  }) };
}

async function preview(req, res, next) {
  try {
    const db = getDatabase(); const scope = await resolveScope(db, req.user, req.query);
    const result = await buildPreview(db, scope, id(req.query.academicTermId, 'term ID'));
    res.json({ preview: result, policyBlockReason: result.policyBlockReason });
  } catch (error) { next(error); }
}

async function publish(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    await connection.beginTransaction(); started = true;
    const scopeLookup = await resolveScope(connection, req.user, req.body);
    await lockYear(connection, scopeLookup);
    const scope = await resolveScope(connection, req.user, req.body, true);
    if (!scope.policy) fail(policyBlockReason(scope.group, scope.yearLabel, scope.gradeCode) || 'The SHS grading policy is unavailable.', 409);
    const termId = id(req.body.academicTermId, 'term ID');
    const previewResult = await buildPreview(connection, scope, termId, true);
    if (previewResult.term.status !== 'active') fail('This grading period is locked.', 409);
    if (!previewResult.students.length || previewResult.students.some(student => student.problem))
      fail('Resolve missing scores and assessment items before publishing.', 409);
    const scopeSql = scope.kind === 'core'
      ? 'section_id = ? AND subject_id = ? AND shs_elective_class_id IS NULL'
      : 'shs_elective_class_id = ? AND section_id IS NULL AND subject_id IS NULL';
    const scopeValues = scope.kind === 'core' ? [scope.sectionId, scope.subjectId] : [scope.classId];
    const [priorRows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM published_final_grades WHERE school_id = ? AND academic_term_id = ? AND ${scopeSql}`,
      [scope.schoolId, termId, ...scopeValues]
    );
    const correctionReason = String(req.body.correctionReason || '').trim();
    if (Number(priorRows[0]?.total || 0) && (correctionReason.length < 10 || correctionReason.length > 500))
      fail('Republishing changed grades requires a correction reason of 10 to 500 characters.', 409);
    const [versionRows] = await connection.execute(
      `SELECT COALESCE(MAX(publication_version), 0) AS currentVersion
       FROM shs_grade_publication_history WHERE school_id = ? AND academic_term_id = ? AND ${scopeSql}`,
      [scope.schoolId, termId, ...scopeValues]
    );
    const publicationVersion = Number(versionRows[0]?.currentVersion || 0) + 1;
    for (const student of previewResult.students) {
      const ownerValues = [scope.schoolId, scope.kind === 'core' ? scope.sectionId : null,
        scope.kind === 'core' ? scope.subjectId : null, scope.kind === 'elective' ? scope.classId : null,
        termId, student.studentId, student.termGrade, publicationVersion, correctionReason || null,
        JSON.stringify(student.scoreSnapshot), req.user.id];
      const [history] = await connection.execute(
        `INSERT INTO shs_grade_publication_history
          (school_id, section_id, subject_id, shs_elective_class_id, academic_term_id,
           student_user_id, final_grade, publication_version, correction_reason, score_snapshot,
           published_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ownerValues
      );
      await connection.execute(
        `INSERT INTO published_final_grades (school_id, section_id, subject_id,
          shs_elective_class_id, academic_term_id, student_user_id, final_grade,
          publication_version, latest_history_id, correction_reason, published_by_user_id, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE final_grade = VALUES(final_grade),
           publication_version = VALUES(publication_version), latest_history_id = VALUES(latest_history_id),
           correction_reason = VALUES(correction_reason),
           published_by_user_id = VALUES(published_by_user_id), published_at = NOW()`,
        [scope.schoolId, scope.kind === 'core' ? scope.sectionId : null,
          scope.kind === 'core' ? scope.subjectId : null,
          scope.kind === 'elective' ? scope.classId : null,
          termId, student.studentId, student.termGrade, publicationVersion, history.insertId,
          correctionReason || null, req.user.id]
      );
    }
    await connection.execute(
      `UPDATE grading_items SET used_in_published_grades = TRUE WHERE school_id = ?
       AND id IN (${previewResult.items.map(() => '?').join(',')})`,
      [scope.schoolId, ...previewResult.items.map(item => item.id)]
    );
    await writeAuditLog(connection, req, 'shs_grades_published', 'academic_term', termId,
      { classId: scope.classId || null, sectionId: scope.sectionId || null, subjectId: scope.subjectId || null,
        studentCount: previewResult.students.length, publicationVersion, correctionReason: correctionReason || null,
        subjectName: scope.subjectName, className: scope.className, gradeCode: scope.gradeCode,
        schoolYear: scope.yearLabel });
    await connection.commit(); started = false;
    res.json({ published: true, count: previewResult.students.length });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

module.exports = { resolveScope, workspace, createItem, createLinkedAssignmentItem, saveScore, correctScore, preview, publish };
