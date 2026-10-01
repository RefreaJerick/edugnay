const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');
const { getTrigger, notifyParents } = require('../utils/parentNotifications');

function createError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function parseId(value, label) { const id = Number.parseInt(value, 10); if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`); return id; }
function text(value, maximum, label) { const result = String(value || '').trim(); if (!result) throw createError(`${label} is required.`); if (result.length > maximum) throw createError(`${label} is too long.`); return result; }
function optionalText(value, maximum, label) { if (value === undefined || value === null) return null; const result = String(value).trim(); if (result.length > maximum) throw createError(`${label} is too long.`); return result || null; }
function scoreValue(value, label, required = true) { if (value === undefined || value === null || value === '') { if (required) throw createError(`${label} is required.`); return null; } const score = Number(value); if (!Number.isFinite(score) || score < 0 || score > 1000000) throw createError(`${label} is invalid.`); return Math.round(score * 100) / 100; }

async function getTeacherSectionSubject(connection, teacherId, sectionId, subjectId, schoolId) {
  const [rows] = await connection.execute(`SELECT sections.id, sections.school_id AS schoolId, sections.academic_year_id AS academicYearId, sections.school_level_id AS schoolLevelId FROM section_teachers INNER JOIN sections ON sections.id = section_teachers.section_id INNER JOIN subjects ON subjects.id = section_teachers.subject_id AND subjects.school_id = sections.school_id INNER JOIN users AS teachers ON teachers.id = section_teachers.teacher_user_id AND teachers.school_id = sections.school_id AND teachers.role = 'teacher' AND teachers.account_status = 'active' WHERE section_teachers.teacher_user_id = ? AND section_teachers.section_id = ? AND section_teachers.subject_id = ? AND sections.school_id = ? AND sections.status = 'active' LIMIT 1`, [teacherId, sectionId, subjectId, schoolId]);
  return rows[0] || null;
}

async function getManagedGradingItem(connection, user, gradingItemId) {
  const [rows] = await connection.execute(`SELECT grading_items.id, grading_items.section_id AS sectionId, grading_items.subject_id AS subjectId, grading_items.academic_term_id AS academicTermId, grading_items.grading_category_id AS gradingCategoryId, grading_items.teacher_user_id AS teacherUserId, grading_items.title, grading_items.max_score AS maxScore, academic_terms.status AS academicTermStatus, academic_years.status AS academicYearStatus FROM grading_items INNER JOIN sections ON sections.id = grading_items.section_id INNER JOIN academic_terms ON academic_terms.id = grading_items.academic_term_id AND academic_terms.academic_year_id = sections.academic_year_id AND academic_terms.school_level_id = sections.school_level_id INNER JOIN academic_years ON academic_years.id = sections.academic_year_id WHERE grading_items.id = ? AND sections.school_id = ? LIMIT 1`, [gradingItemId, user.schoolId]);
  const item = rows[0];
  if (!item || (user.role === 'teacher' && Number(item.teacherUserId) !== Number(user.id))) return null;
  if (item.academicYearStatus === 'archived') throw createError('Records from an archived school year are read-only.', 409);
  return item;
}

async function assertGradeWriteAccess(connection, user, scope) {
  if (!['teacher', 'school_admin'].includes(user.role)) throw createError('You do not have access to edit grades.', 403);

  const [terms] = await connection.execute(
    `SELECT academic_terms.status AS academicTermStatus,
      academic_years.status AS academicYearStatus
     FROM academic_terms
     INNER JOIN sections ON sections.id = ?
       AND sections.academic_year_id = academic_terms.academic_year_id
       AND sections.school_level_id = academic_terms.school_level_id
       AND sections.school_id = ? AND sections.status = 'active'
     INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
       AND academic_years.school_id = sections.school_id
     WHERE academic_terms.id = ? FOR UPDATE`,
    [scope.sectionId, user.schoolId, scope.academicTermId]
  );
  if (!terms.length) throw createError('The grading period no longer matches this section.', 404);
  const termStatus = terms[0].academicTermStatus;
  if (terms[0].academicYearStatus !== 'active') throw createError('Records outside the active school year are read-only.', 409);

  if (user.role === 'teacher') {
    const [assignments] = await connection.execute(
      `SELECT 1 FROM section_teachers
       INNER JOIN sections ON sections.id = section_teachers.section_id
         AND sections.school_id = ? AND sections.status = 'active'
       INNER JOIN subjects ON subjects.id = section_teachers.subject_id
         AND subjects.school_id = sections.school_id
       INNER JOIN users AS teachers ON teachers.id = section_teachers.teacher_user_id
         AND teachers.school_id = sections.school_id AND teachers.role = 'teacher'
         AND teachers.account_status = 'active'
       WHERE section_teachers.teacher_user_id = ?
         AND section_teachers.section_id = ? AND section_teachers.subject_id = ? LIMIT 1 FOR UPDATE`,
      [user.schoolId, user.id, scope.sectionId, scope.subjectId]
    );
    if (!assignments.length) throw createError('You are not assigned to this section and subject.', 403);
  }

  if (termStatus === 'active') return;
  if (termStatus !== 'closed' || user.role !== 'teacher') {
    throw createError('This grading period is locked. An approved, unexpired teacher request is required.', 409);
  }

  const [approvals] = await connection.execute(
    `SELECT id FROM grading_period_reopen_requests
     WHERE school_id = ? AND academic_term_id = ? AND section_id = ? AND subject_id = ?
       AND teacher_user_id = ? AND request_status = 'approved' AND expires_at > NOW()
     LIMIT 1 FOR UPDATE`,
    [user.schoolId, scope.academicTermId, scope.sectionId, scope.subjectId, user.id]
  );
  if (!approvals.length) throw createError('This grading period is locked. An approved, unexpired teacher request is required.', 409);
}

async function validateGradeItemScope(connection, user, section, subjectId, academicTermId, gradingCategoryId) {
  const [terms] = await connection.execute(`SELECT academic_terms.id,
      academic_terms.status AS academicTermStatus,
      academic_years.status AS academicYearStatus
    FROM academic_terms
    INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
    WHERE academic_terms.id = ? AND academic_terms.academic_year_id = ?
      AND academic_terms.school_level_id = ? AND academic_years.school_id = ? LIMIT 1`,
  [academicTermId, section.academicYearId, section.schoolLevelId, section.schoolId]);
  const [categories] = await connection.execute('SELECT id FROM grading_categories WHERE id=? AND school_id=? AND school_level_id=? LIMIT 1', [gradingCategoryId, section.schoolId, section.schoolLevelId]);
  if (!terms.length || !categories.length) throw createError('The term or grading category does not match the section.', 404);
  await assertGradeWriteAccess(connection, user, {
    schoolId: section.schoolId,
    sectionId: section.id,
    subjectId,
    academicTermId,
    academicTermStatus: terms[0].academicTermStatus,
    academicYearStatus: terms[0].academicYearStatus
  });
}

async function listGradingItems(req, res, next) {
  try {
    const where = ['sections.school_id = ?']; const values = [req.user.schoolId];
    if (req.user.role === 'teacher') {
      where.push('grading_items.teacher_user_id = ?'); values.push(req.user.id);
      where.push(`EXISTS (SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = grading_items.section_id
          AND section_teachers.subject_id = grading_items.subject_id
          AND section_teachers.teacher_user_id = ?)`);
      values.push(req.user.id);
    } else if (req.user.role !== 'school_admin') throw createError('You do not have access to grading items.', 403);
    if (req.query.sectionId) { where.push('grading_items.section_id = ?'); values.push(parseId(req.query.sectionId, 'section ID')); }
    const [items] = await getDatabase().execute(`SELECT grading_items.id, grading_items.section_id AS sectionId, grading_items.subject_id AS subjectId, grading_items.academic_term_id AS academicTermId, grading_items.grading_category_id AS gradingCategoryId, grading_items.teacher_user_id AS teacherUserId, grading_items.title, grading_items.max_score AS maxScore, grading_items.recorded_at AS recordedAt, subjects.name AS subjectName, academic_terms.name AS academicTermName, grading_categories.code AS gradingCategoryCode, grading_categories.name AS gradingCategoryName FROM grading_items INNER JOIN sections ON sections.id=grading_items.section_id INNER JOIN subjects ON subjects.id=grading_items.subject_id INNER JOIN academic_terms ON academic_terms.id=grading_items.academic_term_id INNER JOIN grading_categories ON grading_categories.id=grading_items.grading_category_id WHERE ${where.join(' AND ')} ORDER BY grading_items.recorded_at DESC`, values);
    res.json({ gradingItems: items.map(item => ({ ...item, maxScore: Number(item.maxScore) })) });
  } catch (error) { next(error); }
}

async function createGradingItem(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const sectionId = parseId(req.body.sectionId, 'section ID'); const subjectId = parseId(req.body.subjectId, 'subject ID');
    const academicTermId = parseId(req.body.academicTermId, 'academic term ID'); const gradingCategoryId = parseId(req.body.gradingCategoryId, 'grading category ID');
    const section = await getTeacherSectionSubject(connection, req.user.id, sectionId, subjectId, req.user.schoolId);
    if (!section) throw createError('You are not assigned to this section and subject.', 403);
    await validateGradeItemScope(connection, req.user, section, subjectId, academicTermId, gradingCategoryId);
    const title = text(req.body.title, 255, 'Grading item title'); const maxScore = scoreValue(req.body.maxScore, 'Maximum score');
    const [result] = await connection.execute('INSERT INTO grading_items (section_id, subject_id, academic_term_id, grading_category_id, teacher_user_id, title, max_score) VALUES (?, ?, ?, ?, ?, ?, ?)', [sectionId, subjectId, academicTermId, gradingCategoryId, req.user.id, title, maxScore]);
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ gradingItem: { id: result.insertId, sectionId, subjectId, academicTermId, gradingCategoryId, teacherUserId: req.user.id, title, maxScore } });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function updateGradingItem(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const gradingItemId = parseId(req.params.gradingItemId, 'grading item ID'); const current = await getManagedGradingItem(connection, req.user, gradingItemId);
    if (!current) throw createError('Grading item was not found.', 404);
    const assignedTeacherId = req.user.role === 'teacher' ? req.user.id : current.teacherUserId;
    const section = await getTeacherSectionSubject(connection, assignedTeacherId, current.sectionId, current.subjectId, req.user.schoolId);
    if (!section) throw createError('The grading item section-subject relationship is no longer active.', 409);
    await assertGradeWriteAccess(connection, req.user, {
      schoolId: section.schoolId,
      sectionId: current.sectionId,
      subjectId: current.subjectId,
      academicTermId: current.academicTermId,
      academicTermStatus: current.academicTermStatus,
      academicYearStatus: current.academicYearStatus
    });
    const title = req.body.title === undefined ? current.title : text(req.body.title, 255, 'Grading item title'); const maxScore = req.body.maxScore === undefined ? Number(current.maxScore) : scoreValue(req.body.maxScore, 'Maximum score');
    await connection.execute('UPDATE grading_items SET title=?, max_score=? WHERE id=?', [title, maxScore, gradingItemId]);
    await connection.commit();
    transactionStarted = false;
    res.json({ gradingItem: { ...current, title, maxScore } });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function listStudentScores(req, res, next) {
  try {
    const where = ['sections.school_id = ?']; const values = [req.user.schoolId];
    if (req.user.role === 'teacher') {
      where.push('grading_items.teacher_user_id = ?'); values.push(req.user.id);
      where.push(`EXISTS (SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = grading_items.section_id
          AND section_teachers.subject_id = grading_items.subject_id
          AND section_teachers.teacher_user_id = ?)`);
      values.push(req.user.id);
    } else if (req.user.role !== 'school_admin') throw createError('You do not have access to scores.', 403);
    if (req.query.gradingItemId) { where.push('student_scores.grading_item_id = ?'); values.push(parseId(req.query.gradingItemId, 'grading item ID')); }
    if (req.query.studentId) {
      where.push('student_scores.student_user_id = ?'); values.push(parseId(req.query.studentId, 'student ID'));
    }
    const [scores] = await getDatabase().execute(`SELECT student_scores.id, student_scores.grading_item_id AS gradingItemId, student_scores.student_user_id AS studentId, students.display_name AS studentName, student_scores.score, student_scores.remarks, student_scores.recorded_at AS recordedAt, grading_items.title AS gradingItemTitle, grading_items.max_score AS maxScore FROM student_scores INNER JOIN grading_items ON grading_items.id=student_scores.grading_item_id INNER JOIN sections ON sections.id=grading_items.section_id INNER JOIN users AS students ON students.id=student_scores.student_user_id WHERE ${where.join(' AND ')} ORDER BY students.last_name, students.first_name, grading_items.recorded_at DESC`, values);
    res.json({ studentScores: scores.map(score => ({ ...score, score: score.score === null ? null : Number(score.score), maxScore: Number(score.maxScore) })) });
  } catch (error) { next(error); }
}

function parseGradeScopeId(value, label) {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) throw createError(`Invalid ${label}.`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

async function getFinalGradesOverview(req, res, next) {
  try {
    const user = req.user;
    const schoolId = parseGradeScopeId(user.schoolId, 'school ID');
    const userId = parseGradeScopeId(user.id, 'user ID');
    if (Object.keys(req.query || {}).some(key => key !== 'studentId')) {
      throw createError('Unsupported grade filter.');
    }

    const requestedStudentId = req.query?.studentId === undefined
      ? null
      : parseGradeScopeId(req.query.studentId, 'student ID');
    let studentId = userId;
    if (user.role === 'parent') {
      if (!requestedStudentId) throw createError('A linked student must be selected.', 400);
      const [links] = await getDatabase().execute(
        `SELECT 1 FROM student_parent_links
        INNER JOIN users AS linked_students ON linked_students.id = student_parent_links.student_user_id
          AND linked_students.school_id = ? AND linked_students.role = 'student'
        WHERE student_parent_links.parent_user_id = ?
          AND student_parent_links.student_user_id = ? LIMIT 1`,
        [schoolId, userId, requestedStudentId]
      );
      if (!links.length) throw createError("You do not have access to this student's grades.", 403);
      studentId = requestedStudentId;
    } else if (user.role !== 'student') {
      throw createError('You do not have access to student grade overviews.', 403);
    } else if (requestedStudentId && requestedStudentId !== userId) {
      throw createError('You do not have access to these grades.', 403);
    }

    const database = getDatabase();
    const [[portalFeatures]] = await database.execute(
      'SELECT grades_enabled AS gradesEnabled FROM school_portal_features WHERE school_id = ? LIMIT 1',
      [schoolId]
    );
    if (!portalFeatures || !Number(portalFeatures.gradesEnabled)) {
      throw createError('The Grades portal is disabled for this school.', 403);
    }

    const [[student]] = await database.execute(
      `SELECT id, display_name AS displayName
      FROM users WHERE id = ? AND school_id = ? AND role = 'student' LIMIT 1`,
      [studentId, schoolId]
    );
    if (!student) throw createError('Student was not found.', 404);

    const [enrollmentRows] = await database.execute(
      `SELECT DISTINCT academic_years.id AS academicYearId,
        academic_years.label AS academicYearLabel, academic_years.status AS academicYearStatus,
        DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
        section_students.withdrawn_at AS enrollmentWithdrawnAt,
        sections.id AS sectionId, sections.name AS sectionName,
        sections.status AS sectionStatus, sections.school_level_id AS schoolLevelId,
        school_levels.grading_period_type AS gradingPeriodType
      FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id
        AND sections.school_id = ?
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id
        AND school_levels.school_id = sections.school_id
      WHERE section_students.student_user_id = ?
      ORDER BY academicYearStartDate DESC, sectionId DESC`,
      [schoolId, studentId]
    );

    const academicYears = [];
    const academicYearMap = new Map();
    const sectionMap = new Map();
    enrollmentRows.forEach(row => {
      const yearId = String(row.academicYearId);
      const sectionId = String(row.sectionId);
      if (!academicYearMap.has(yearId)) {
        const year = {
          id: yearId,
          label: row.academicYearLabel,
          status: row.academicYearStatus,
          startDate: row.academicYearStartDate,
          sections: []
        };
        academicYearMap.set(yearId, year);
        academicYears.push(year);
      }
      if (sectionMap.has(sectionId)) return;
      const section = {
        id: sectionId,
        name: row.sectionName,
        status: row.sectionStatus,
        isActiveEnrollment: row.enrollmentWithdrawnAt === null,
        schoolLevelId: String(row.schoolLevelId),
        gradingPeriodType: row.gradingPeriodType,
        terms: [],
        subjects: []
      };
      sectionMap.set(sectionId, section);
      academicYearMap.get(yearId).sections.push(section);
    });

    if (sectionMap.size) {
      const [termRows] = await database.execute(
        `SELECT DISTINCT academic_terms.id AS id,
          academic_terms.academic_year_id AS academicYearId,
          academic_terms.school_level_id AS schoolLevelId,
          academic_terms.name AS name,
          academic_terms.sequence_number AS sequenceNumber,
          academic_terms.status AS status
        FROM section_students
        INNER JOIN sections ON sections.id = section_students.section_id
          AND sections.school_id = ?
        INNER JOIN academic_terms ON academic_terms.academic_year_id = sections.academic_year_id
          AND academic_terms.school_level_id = sections.school_level_id
        WHERE section_students.student_user_id = ?
        ORDER BY sequenceNumber`,
        [schoolId, studentId]
      );
      termRows.forEach(term => {
        const year = academicYearMap.get(String(term.academicYearId));
        year?.sections
          .filter(section => section.schoolLevelId === String(term.schoolLevelId))
          .forEach(section => section.terms.push({
            id: String(term.id),
            name: term.name,
            sequenceNumber: Number(term.sequenceNumber),
            status: term.status
          }));
      });

      const [subjectRows] = await database.execute(
        `SELECT DISTINCT section_teachers.section_id AS sectionId,
          subjects.id AS subjectId, subjects.name AS subjectName
        FROM section_students
        INNER JOIN sections ON sections.id = section_students.section_id
          AND sections.school_id = ?
        INNER JOIN section_teachers ON section_teachers.section_id = sections.id
        INNER JOIN subjects ON subjects.id = section_teachers.subject_id
          AND subjects.school_id = sections.school_id
        WHERE section_students.student_user_id = ?
        ORDER BY subjectName`,
        [schoolId, studentId]
      );
      subjectRows.forEach(subject => {
        sectionMap.get(String(subject.sectionId))?.subjects.push({
          subjectId: String(subject.subjectId),
          subjectName: subject.subjectName
        });
      });
    }

    const currentYear = academicYears.find(year => year.status === 'active');
    const currentSection = currentYear?.sections.find(section => section.status === 'active' && section.isActiveEnrollment) || null;
    const current = currentYear && currentSection ? {
      sectionId: currentSection.id,
      sectionName: currentSection.name,
      academicYearId: currentYear.id,
      academicYearLabel: currentYear.label,
      schoolLevelId: currentSection.schoolLevelId,
      gradingPeriodType: currentSection.gradingPeriodType,
      terms: currentSection.terms,
      subjects: currentSection.subjects
    } : null;

    const [gradeRows] = await database.execute(
      `SELECT published_final_grades.section_id AS sectionId,
        sections.name AS sectionName, published_final_grades.subject_id AS subjectId,
        subjects.name AS subjectName, published_final_grades.academic_term_id AS academicTermId,
        academic_terms.name AS academicTermName,
        academic_terms.sequence_number AS academicTermSequenceNumber,
        school_levels.grading_period_type AS gradingPeriodType,
        academic_years.id AS academicYearId, academic_years.label AS academicYearLabel,
        academic_years.status AS academicYearStatus,
        published_final_grades.final_grade AS finalGrade,
        published_final_grades.published_at AS publishedAt
      FROM published_final_grades
      INNER JOIN sections ON sections.id = published_final_grades.section_id
        AND sections.school_id = published_final_grades.school_id
      INNER JOIN subjects ON subjects.id = published_final_grades.subject_id
        AND subjects.school_id = published_final_grades.school_id
      INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
        AND academic_terms.academic_year_id = sections.academic_year_id
        AND academic_terms.school_level_id = sections.school_level_id
      INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
        AND academic_years.school_id = published_final_grades.school_id
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id
        AND school_levels.school_id = sections.school_id
      WHERE published_final_grades.school_id = ?
        AND published_final_grades.student_user_id = ?
      ORDER BY academic_years.start_date DESC, academic_terms.sequence_number DESC,
        subjects.name, published_final_grades.published_at DESC`,
      [schoolId, studentId]
    );

    res.set('Cache-Control', 'no-store');
    res.json({
      overview: {
        student: { id: String(student.id), displayName: student.displayName },
        academicYears,
        current,
        publishedGrades: gradeRows.map(grade => ({
          ...grade,
          sectionId: String(grade.sectionId),
          subjectId: String(grade.subjectId),
          academicTermId: String(grade.academicTermId),
          academicYearId: String(grade.academicYearId),
          academicTermSequenceNumber: Number(grade.academicTermSequenceNumber),
          finalGrade: Number(grade.finalGrade)
        }))
      }
    });
  } catch (error) {
    next(error);
  }
}

function roundFinalGrade(value, rule) {
  if (rule === 'roundup') return Math.ceil(value);
  if (rule === 'truncate') return Math.trunc(value);
  return Math.round(value);
}

async function buildFinalGradePreview(connection, user, scope, lockRows = false) {
  const lock = lockRows ? ' FOR UPDATE' : '';
  const [contextRows] = await connection.execute(
    `SELECT sections.id AS sectionId, sections.school_id AS schoolId,
      sections.school_level_id AS schoolLevelId, sections.academic_year_id AS academicYearId,
      sections.name AS sectionName, subjects.id AS subjectId, subjects.name AS subjectName,
      academic_terms.id AS academicTermId, academic_terms.name AS academicTermName,
      academic_terms.status AS termStatus, school_levels.grade_rounding AS gradeRounding,
      school_levels.passing_grade_threshold AS passingGradeThreshold
    FROM section_teachers
    INNER JOIN sections ON sections.id = section_teachers.section_id
    INNER JOIN subjects ON subjects.id = section_teachers.subject_id
      AND subjects.school_id = sections.school_id
      AND (subjects.school_level_id IS NULL OR subjects.school_level_id = sections.school_level_id)
    INNER JOIN academic_terms ON academic_terms.id = ?
      AND academic_terms.academic_year_id = sections.academic_year_id
      AND academic_terms.school_level_id = sections.school_level_id
    INNER JOIN school_levels ON school_levels.id = sections.school_level_id
    WHERE sections.id = ? AND subjects.id = ? AND section_teachers.teacher_user_id = ?
      AND sections.school_id = ? AND sections.status = 'active'
    LIMIT 1${lock}`,
    [scope.academicTermId, scope.sectionId, scope.subjectId, user.id, user.schoolId]
  );
  const context = contextRows[0];
  if (!context) throw createError('The section, subject, or term is not available to your account.', 404);
  if (context.termStatus !== 'active') throw createError('Grades can only be published for the active term.', 409);

  const [categoryRows] = await connection.execute(
    `SELECT id, code, name, weight FROM grading_categories
    WHERE school_id = ? AND school_level_id = ? ORDER BY id${lock}`,
    [context.schoolId, context.schoolLevelId]
  );
  const categories = categoryRows.map(category => ({ ...category, id: Number(category.id), weight: Number(category.weight) }));
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const issues = [];
  const weightTotal = categories.reduce((sum, category) => sum + category.weight, 0);

  if (!categories.length) issues.push({ code: 'no_grading_categories', message: 'Configure grading categories before publishing.' });
  else if (categories.some(category => !Number.isFinite(category.weight) || category.weight <= 0 || category.weight > 100)
    || Math.round(weightTotal * 100) !== 10000) {
    issues.push({ code: 'invalid_category_weights', message: 'Grading category weights must be valid and total 100%.' });
  }
  if (!['round', 'roundup', 'truncate'].includes(context.gradeRounding)) {
    issues.push({ code: 'invalid_rounding_rule', message: 'The school rounding rule is invalid.' });
  }
  const passingGradeThreshold = Number(context.passingGradeThreshold);
  if (!Number.isFinite(passingGradeThreshold) || passingGradeThreshold < 0 || passingGradeThreshold > 100) {
    issues.push({ code: 'invalid_passing_threshold', message: 'The school passing-grade threshold must be between 0 and 100.' });
  }

  const [students] = await connection.execute(
    `SELECT section_students.student_user_id AS studentId, users.display_name AS studentName
    FROM section_students INNER JOIN users ON users.id = section_students.student_user_id
    WHERE section_students.section_id = ? AND section_students.withdrawn_at IS NULL
    ORDER BY users.last_name, users.first_name, users.id${lock}`,
    [context.sectionId]
  );
  if (!students.length) issues.push({ code: 'no_students', message: 'There are no actively enrolled students in this section.' });

  const [itemRows] = await connection.execute(
    `SELECT grading_items.id AS gradingItemId, grading_items.title AS title,
      grading_items.grading_category_id AS gradingCategoryId, grading_items.max_score AS maxScore,
      grading_categories.school_id AS categorySchoolId,
      grading_categories.school_level_id AS categorySchoolLevelId
    FROM grading_items
    LEFT JOIN grading_categories ON grading_categories.id = grading_items.grading_category_id
    WHERE grading_items.section_id = ? AND grading_items.subject_id = ?
      AND grading_items.academic_term_id = ? AND grading_items.teacher_user_id = ?
    ORDER BY grading_items.id${lock}`,
    [context.sectionId, context.subjectId, context.academicTermId, user.id]
  );
  const items = itemRows.map(item => ({ ...item, gradingItemId: Number(item.gradingItemId), gradingCategoryId: Number(item.gradingCategoryId), maxScore: Number(item.maxScore) }));

  if (!items.length) issues.push({ code: 'no_grading_items', message: 'Add grading items for this subject and term before publishing.' });
  for (const item of items) {
    if (!Number.isFinite(item.maxScore) || item.maxScore <= 0) {
      issues.push({ code: 'invalid_max_score', message: `“${item.title}” must have a maximum score greater than zero.` });
    }
    if (!categoryById.has(item.gradingCategoryId)
      || Number(item.categorySchoolId) !== Number(context.schoolId)
      || Number(item.categorySchoolLevelId) !== Number(context.schoolLevelId)) {
      issues.push({ code: 'invalid_item_category', message: `“${item.title}” is not linked to a grading category for this school level.` });
    }
  }
  if (items.length) {
    for (const category of categories) {
      if (!items.some(item => item.gradingCategoryId === category.id)) {
        issues.push({ code: 'category_without_items', categoryCode: category.code, message: `Add at least one grading item for ${category.name}.` });
      }
    }
  }

  let scoreRows = [];
  if (students.length && items.length) {
    [scoreRows] = await connection.execute(
      `SELECT student_scores.student_user_id AS studentId,
        student_scores.grading_item_id AS gradingItemId, student_scores.score
      FROM student_scores
      INNER JOIN grading_items ON grading_items.id = student_scores.grading_item_id
      INNER JOIN section_students ON section_students.section_id = grading_items.section_id
        AND section_students.student_user_id = student_scores.student_user_id
        AND section_students.withdrawn_at IS NULL
      WHERE grading_items.section_id = ? AND grading_items.subject_id = ?
        AND grading_items.academic_term_id = ? AND grading_items.teacher_user_id = ?
      ORDER BY student_scores.student_user_id, student_scores.grading_item_id${lock}`,
      [context.sectionId, context.subjectId, context.academicTermId, user.id]
    );
  }
  const scoreByKey = new Map(scoreRows.map(record => [`${record.studentId}:${record.gradingItemId}`, record]));
  const canCalculate = !issues.some(issue => issue.code !== 'no_students' && issue.code !== 'no_grading_items' && issue.code !== 'category_without_items');

  const studentGrades = students.map(student => {
    const missingItems = [];
    const invalidScores = [];
    const totals = new Map(categories.map(category => [category.id, { earned: 0, possible: 0 }]));

    for (const item of items) {
      const record = scoreByKey.get(`${student.studentId}:${item.gradingItemId}`);
      if (!record || record.score === null) {
        missingItems.push({ gradingItemId: item.gradingItemId, title: item.title });
        continue;
      }
      const score = Number(record.score);
      if (!Number.isFinite(score) || score < 0 || score > item.maxScore) {
        invalidScores.push({ gradingItemId: item.gradingItemId, title: item.title });
        continue;
      }
      const categoryTotal = totals.get(item.gradingCategoryId);
      if (categoryTotal) {
        categoryTotal.earned += score;
        categoryTotal.possible += item.maxScore;
      }
    }

    const complete = canCalculate && !missingItems.length && !invalidScores.length
      && categories.every(category => (totals.get(category.id)?.possible || 0) > 0);
    const categoryAverages = complete ? categories.map(category => ({
      code: category.code,
      name: category.name,
      weight: category.weight,
      percentage: (totals.get(category.id).earned / totals.get(category.id).possible) * 100
    })) : [];
    const weightedGrade = categoryAverages.reduce((sum, category) => sum + category.percentage * (category.weight / 100), 0);
    const finalGrade = complete ? roundFinalGrade(weightedGrade, context.gradeRounding) : null;

    return {
      studentId: Number(student.studentId),
      studentName: student.studentName,
      finalGrade,
      isPassing: finalGrade === null ? null : finalGrade >= passingGradeThreshold,
      missingItems,
      invalidScores,
      categoryAverages
    };
  });

  return {
    sectionId: Number(context.sectionId),
    sectionName: context.sectionName,
    subjectId: Number(context.subjectId),
    subjectName: context.subjectName,
    academicTermId: Number(context.academicTermId),
    academicTermName: context.academicTermName,
    gradeRounding: context.gradeRounding,
    passingGradeThreshold,
    categories,
    studentCount: students.length,
    readyToPublish: !issues.length && studentGrades.length > 0
      && studentGrades.every(student => student.finalGrade !== null),
    issues,
    missingScoreCount: studentGrades.reduce((sum, student) => sum + student.missingItems.length, 0),
    invalidScoreCount: studentGrades.reduce((sum, student) => sum + student.invalidScores.length, 0),
    students: studentGrades
  };
}

async function previewFinalGrades(req, res, next) {
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('Only an authenticated teacher can preview grades.', 403);
    const scope = {
      sectionId: parseGradeScopeId(req.query.sectionId, 'section ID'),
      subjectId: parseGradeScopeId(req.query.subjectId, 'subject ID'),
      academicTermId: parseGradeScopeId(req.query.academicTermId, 'academic term ID')
    };
    res.json({ preview: await buildFinalGradePreview(getDatabase(), req.user, scope) });
  } catch (error) { next(error); }
}

async function publishFinalGrades(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('Only an authenticated teacher can publish grades.', 403);
    const body = req.body || {};
    if (Object.keys(body).some(field => !['sectionId', 'subjectId', 'academicTermId'].includes(field))) {
      throw createError('Provide only the section, subject, and academic term for publishing.');
    }
    const scope = {
      sectionId: parseGradeScopeId(body.sectionId, 'section ID'),
      subjectId: parseGradeScopeId(body.subjectId, 'subject ID'),
      academicTermId: parseGradeScopeId(body.academicTermId, 'academic term ID')
    };
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const preview = await buildFinalGradePreview(connection, req.user, scope, true);
    if (!preview.readyToPublish) throw createError('Resolve every missing score and grading setup issue before publishing.', 409);

    const gradeTrigger = await getTrigger(connection, req.user.schoolId, 'grade_below_threshold');
    const [[level]] = gradeTrigger ? await connection.execute(
      'SELECT passing_grade_threshold AS threshold FROM school_levels WHERE id = (SELECT school_level_id FROM sections WHERE id = ? AND school_id = ?)',
      [preview.sectionId, req.user.schoolId]
    ) : [[]];

    for (const student of preview.students) {
      await connection.execute(
        `INSERT INTO published_final_grades (
          school_id, section_id, subject_id, academic_term_id, student_user_id,
          final_grade, published_by_user_id, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE final_grade = VALUES(final_grade),
          published_by_user_id = VALUES(published_by_user_id), published_at = NOW()`,
        [req.user.schoolId, preview.sectionId, preview.subjectId, preview.academicTermId, student.studentId, student.finalGrade, req.user.id]
      );
      if (gradeTrigger && Number(student.finalGrade) < Number(level.threshold)) {
        await notifyParents(connection, {
          schoolId: req.user.schoolId, studentId: student.studentId, code: 'grade_below_threshold',
          eventKey: `grade:${preview.sectionId}:${preview.subjectId}:${preview.academicTermId}:${student.studentId}`,
          title: 'Published grade below passing',
          message: `${student.studentName}'s published grade in ${preview.subjectName} is below the passing grade.`,
          targetPath: '/views/parent/edugnay-parent-grades.html'
        });
      }
    }

    await writeAuditLog(connection, req, 'final_grades_published', 'published_final_grades', null, {
      summary: `${preview.subjectName} · ${preview.sectionName} · ${preview.academicTermName} · ${preview.students.length} students`
    });

    await connection.commit();
    transactionStarted = false;
    res.json({
      published: true,
      sectionId: preview.sectionId,
      subjectId: preview.subjectId,
      academicTermId: preview.academicTermId,
      publishedCount: preview.students.length,
      grades: preview.students.map(({ studentId, studentName, finalGrade, isPassing }) => ({ studentId, studentName, finalGrade, isPassing }))
    });
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch {}
    }
    next(error);
  } finally {
    connection?.release();
  }
}

async function listPublishedFinalGrades(req, res, next) {
  try {
    const user = req.user;
    const allowedRoles = ['student', 'parent', 'teacher', 'school_admin'];
    if (!user || !allowedRoles.includes(user.role)) {
      throw createError('You do not have access to published grades.', 403);
    }

    const schoolId = parseGradeScopeId(user.schoolId, 'school ID');
    const userId = parseGradeScopeId(user.id, 'user ID');
    const database = getDatabase();
    const supportedFilters = ['studentId', 'sectionId', 'subjectId', 'academicTermId', 'academicYearId'];
    if (Object.keys(req.query || {}).some(key => !supportedFilters.includes(key))) {
      throw createError('Unsupported grade filter.');
    }

    const requestedStudentId = req.query?.studentId === undefined
      ? null
      : parseGradeScopeId(req.query.studentId, 'student ID');
    const parsedFilters = {};
    for (const queryName of ['sectionId', 'subjectId', 'academicTermId', 'academicYearId']) {
      if (req.query?.[queryName] !== undefined) {
        parsedFilters[queryName] = parseGradeScopeId(req.query[queryName], queryName);
      }
    }
    if (user.role === 'student' && requestedStudentId && requestedStudentId !== userId) {
      throw createError('You do not have access to these grades.', 403);
    }

    if (['student', 'parent'].includes(user.role)) {
      const [[portalFeatures]] = await database.execute(
        'SELECT grades_enabled AS gradesEnabled FROM school_portal_features WHERE school_id = ? LIMIT 1',
        [schoolId]
      );
      if (!portalFeatures?.gradesEnabled) {
        throw createError('The Grades portal is disabled for this school.', 403);
      }
    }

    const where = ['published_final_grades.school_id = ?'];
    const values = [schoolId];

    if (user.role === 'student') {
      const studentId = userId;
      if (requestedStudentId && requestedStudentId !== studentId) {
        throw createError('You do not have access to these grades.', 403);
      }
      where.push('published_final_grades.student_user_id = ?');
      values.push(studentId);
    } else if (user.role === 'parent') {
      if (requestedStudentId) {
        const [links] = await database.execute(
          `SELECT 1 FROM student_parent_links
          INNER JOIN users AS linked_students ON linked_students.id = student_parent_links.student_user_id
            AND linked_students.school_id = ? AND linked_students.role = 'student'
          WHERE student_parent_links.parent_user_id = ?
            AND student_parent_links.student_user_id = ? LIMIT 1`,
          [schoolId, userId, requestedStudentId]
        );
        if (!links.length) throw createError("You do not have access to this student's grades.", 403);
        where.push('published_final_grades.student_user_id = ?');
        values.push(requestedStudentId);
      } else {
        where.push(`EXISTS (
          SELECT 1 FROM student_parent_links
          INNER JOIN users AS linked_students ON linked_students.id = student_parent_links.student_user_id
            AND linked_students.school_id = published_final_grades.school_id
            AND linked_students.role = 'student'
          WHERE student_parent_links.parent_user_id = ?
            AND student_parent_links.student_user_id = published_final_grades.student_user_id
        )`);
        values.push(userId);
      }
    } else if (user.role === 'teacher') {
      where.push(`EXISTS (
        SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = published_final_grades.section_id
          AND section_teachers.subject_id = published_final_grades.subject_id
          AND section_teachers.teacher_user_id = ?
      )`);
      values.push(userId);
    }

    if (requestedStudentId && !['student', 'parent'].includes(user.role)) {
      where.push('published_final_grades.student_user_id = ?');
      values.push(requestedStudentId);
    }

    for (const [queryName, column] of [
      ['sectionId', 'published_final_grades.section_id'],
      ['subjectId', 'published_final_grades.subject_id'],
      ['academicTermId', 'published_final_grades.academic_term_id']
    ]) {
      if (parsedFilters[queryName] !== undefined) {
        where.push(`${column} = ?`);
        values.push(parsedFilters[queryName]);
      }
    }
    if (parsedFilters.academicYearId !== undefined) {
      where.push('sections.academic_year_id = ?');
      values.push(parsedFilters.academicYearId);
    }

    const [grades] = await database.execute(
      `SELECT published_final_grades.id,
        published_final_grades.school_id AS schoolId,
        published_final_grades.student_user_id AS studentId,
        students.display_name AS studentName,
        published_final_grades.section_id AS sectionId,
        sections.name AS sectionName,
        published_final_grades.subject_id AS subjectId,
        subjects.name AS subjectName,
        published_final_grades.academic_term_id AS academicTermId,
        academic_terms.name AS academicTermName,
        academic_years.id AS academicYearId,
        academic_years.label AS academicYearLabel,
        published_final_grades.final_grade AS finalGrade,
        published_final_grades.published_at AS publishedAt
      FROM published_final_grades
      INNER JOIN users AS students ON students.id = published_final_grades.student_user_id
        AND students.school_id = published_final_grades.school_id AND students.role = 'student'
      INNER JOIN sections ON sections.id = published_final_grades.section_id
        AND sections.school_id = published_final_grades.school_id
      INNER JOIN subjects ON subjects.id = published_final_grades.subject_id
        AND subjects.school_id = published_final_grades.school_id
      INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
        AND academic_terms.academic_year_id = sections.academic_year_id
        AND academic_terms.school_level_id = sections.school_level_id
      INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
        AND academic_years.school_id = published_final_grades.school_id
      WHERE ${where.join(' AND ')}
      ORDER BY academic_years.start_date DESC, academic_terms.sequence_number DESC,
        subjects.name, students.last_name, students.first_name, published_final_grades.published_at DESC`,
      values
    );

    res.set('Cache-Control', 'no-store');
    res.json({ finalGrades: grades.map(grade => ({
      ...grade,
      id: String(grade.id),
      schoolId: String(grade.schoolId),
      studentId: String(grade.studentId),
      sectionId: String(grade.sectionId),
      subjectId: String(grade.subjectId),
      academicTermId: String(grade.academicTermId),
      academicYearId: String(grade.academicYearId),
      finalGrade: Number(grade.finalGrade)
    })) });
  } catch (error) {
    next(error);
  }
}

async function upsertStudentScore(connection, user, gradingItemId, studentId, body) {
  const item = await getManagedGradingItem(connection, user, gradingItemId);
  if (!item) throw createError('Grading item was not found.', 404);
  await assertGradeWriteAccess(connection, user, {
    schoolId: user.schoolId,
    sectionId: item.sectionId,
    subjectId: item.subjectId,
    academicTermId: item.academicTermId,
    academicTermStatus: item.academicTermStatus,
    academicYearStatus: item.academicYearStatus
  });
  const score = scoreValue(body.score, 'Score', false);
  if (score !== null && score > Number(item.maxScore)) throw createError('Score cannot exceed the maximum score.');
  const remarks = optionalText(body.remarks, 500, 'Score remarks');
  const [students] = await connection.execute('SELECT student_user_id AS studentId FROM section_students WHERE section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL LIMIT 1 FOR UPDATE', [item.sectionId, studentId]);
  if (!students.length) throw createError('The student is not actively enrolled in this section.', 404);
  await connection.execute(`INSERT INTO student_scores (grading_item_id, student_user_id, score, remarks, recorded_by_user_id, recorded_at) VALUES (?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE score=VALUES(score), remarks=VALUES(remarks), recorded_by_user_id=VALUES(recorded_by_user_id), recorded_at=NOW()`, [gradingItemId, studentId, score, remarks, user.id]);
  const [scores] = await connection.execute('SELECT id, grading_item_id AS gradingItemId, student_user_id AS studentId, score, remarks, recorded_at AS recordedAt FROM student_scores WHERE grading_item_id=? AND student_user_id=?', [gradingItemId, studentId]);
  return { ...scores[0], score: scores[0].score === null ? null : Number(scores[0].score) };
}

async function saveStudentScore(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const gradingItemId = parseId(req.body.gradingItemId, 'grading item ID');
    const studentId = parseId(req.body.studentId, 'student ID');
    const studentScore = await upsertStudentScore(connection, req.user, gradingItemId, studentId, req.body);
    await connection.commit();
    transactionStarted = false;
    res.status(200).json({ studentScore });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function updateStudentScore(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const scoreId = parseId(req.params.scoreId, 'student score ID');
    const [rows] = await connection.execute('SELECT id, grading_item_id AS gradingItemId, student_user_id AS studentId, score, remarks FROM student_scores WHERE id=? LIMIT 1', [scoreId]);
    const current = rows[0];
    if (!current) throw createError('Student score was not found.', 404);
    const values = { score: req.body.score === undefined ? current.score : req.body.score, remarks: req.body.remarks === undefined ? current.remarks : req.body.remarks };
    const studentScore = await upsertStudentScore(connection, req.user, current.gradingItemId, current.studentId, values);
    await connection.commit();
    transactionStarted = false;
    res.json({ studentScore });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

module.exports = {
  createGradingItem,
  getFinalGradesOverview,
  listGradingItems,
  listPublishedFinalGrades,
  listStudentScores,
  previewFinalGrades,
  publishFinalGrades,
  saveStudentScore,
  updateGradingItem,
  updateStudentScore
};
