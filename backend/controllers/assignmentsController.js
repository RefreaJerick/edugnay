const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { getDatabase } = require('../config/database');
const { assertGradeWriteAccess, validateGradeItemScope } = require('./gradesController');
const { writeAuditLog } = require('../utils/auditLog');
const { uploadDirectory } = require('../config/uploads');

const ASSIGNMENT_STATUSES = new Set(['draft', 'published', 'closed']);
const SUBMISSION_STATUSES = new Set(['pending', 'submitted', 'not_submitted']);
const execFileAsync = promisify(execFile);
const OFFICE_FILE_EXTENSIONS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']);
const MAX_PREVIEW_SIZE_BYTES = 30 * 1024 * 1024;

function createError(message, status = 400, expose = false) {
  const error = new Error(message);
  error.status = status;
  error.expose = expose;
  return error;
}

function parseId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value, label);
}

function requiredText(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

function optionalText(value, maximum, label) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result || null;
}

function scoreValue(value, label, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw createError(`${label} is required.`);
    return null;
  }
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1000000) throw createError(`${label} is invalid.`);
  return Math.round(score * 100) / 100;
}

function dateTime(value, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw createError(`${label} is required.`);
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw createError(`${label} is invalid.`);
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError('Date must use YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw createError('Date is invalid.');
  return value;
}

function getSchoolCurrentDate() {
  const timeZone = process.env.SCHOOL_TIME_ZONE || 'Asia/Manila';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatAssignment(row) {
  return {
    id: row.id, schoolId: row.schoolId, sectionId: row.sectionId, sectionName: row.sectionName,
    subjectId: row.subjectId, subjectName: row.subjectName, academicTermId: row.academicTermId,
    academicTermName: row.academicTermName, gradingCategoryId: row.gradingCategoryId,
    gradingItemId: row.gradingItemId,
    gradingCategoryCode: row.gradingCategoryCode, gradingCategoryName: row.gradingCategoryName, teacherUserId: row.teacherUserId,
    teacherName: row.teacherName, title: row.title, description: row.description,
    dueAt: row.dueAt, maxScore: row.maxScore === null ? null : Number(row.maxScore),
    onlineSubmissionEnabled: Boolean(row.onlineSubmissionEnabled),
    status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt
  };
}

function assignmentSelect() {
  return `SELECT assignments.id, assignments.school_id AS schoolId, assignments.section_id AS sectionId,
    assignments.subject_id AS subjectId, assignments.academic_term_id AS academicTermId,
    assignments.grading_category_id AS gradingCategoryId, assignments.grading_item_id AS gradingItemId,
    assignments.teacher_user_id AS teacherUserId,
    assignments.title, assignments.description, assignments.due_at AS dueAt, assignments.max_score AS maxScore,
    assignments.online_submission_enabled AS onlineSubmissionEnabled,
    assignments.status, assignments.created_at AS createdAt, assignments.updated_at AS updatedAt,
    sections.name AS sectionName, academic_years.status AS academicYearStatus,
    subjects.name AS subjectName, academic_terms.name AS academicTermName,
    grading_categories.code AS gradingCategoryCode, grading_categories.name AS gradingCategoryName, teachers.display_name AS teacherName
  FROM assignments INNER JOIN sections ON sections.id = assignments.section_id AND sections.school_id = assignments.school_id
  INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
  INNER JOIN subjects ON subjects.id = assignments.subject_id AND subjects.school_id = assignments.school_id
  LEFT JOIN academic_terms ON academic_terms.id = assignments.academic_term_id AND academic_terms.school_id = assignments.school_id
  LEFT JOIN grading_categories ON grading_categories.id = assignments.grading_category_id AND grading_categories.school_id = assignments.school_id
  INNER JOIN users AS teachers ON teachers.id = assignments.teacher_user_id AND teachers.school_id = assignments.school_id`;
}

async function getTeacherSectionSubject(connection, teacherId, sectionId, subjectId) {
  const [assignments] = await connection.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.academic_year_id AS academicYearId,
      sections.school_level_id AS schoolLevelId, sections.grade_level_id AS gradeLevelId, sections.status
    FROM section_teachers INNER JOIN sections ON sections.id = section_teachers.section_id
      AND sections.school_id = section_teachers.school_id
    WHERE section_teachers.teacher_user_id = ? AND section_teachers.section_id = ? AND section_teachers.subject_id = ?
      AND sections.status = 'active' LIMIT 1`,
    [teacherId, sectionId, subjectId]
  );
  return assignments[0] || null;
}

async function getAssignmentForManagement(connection, user, assignmentId, lock = false) {
  if (!['school_admin', 'teacher'].includes(user.role)) return null;
  const [assignments] = await connection.execute(`${assignmentSelect()} WHERE assignments.id = ? AND assignments.school_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [assignmentId, user.schoolId]);
  const assignment = assignments[0];
  if (!assignment || (user.role === 'teacher' && assignment.teacherUserId !== user.id)) return null;
  return assignment;
}

function assertAssignmentYearWritable(assignment) {
  if (assignment.academicYearStatus === 'archived') {
    throw createError('Records from an archived school year are read-only.', 409);
  }
}

async function validateTermAndCategory(connection, section, academicTermId, gradingCategoryId) {
  if (academicTermId) {
    const [terms] = await connection.execute("SELECT id FROM academic_terms WHERE id = ? AND academic_year_id = ? AND school_level_id = ? AND status = 'active' LIMIT 1", [academicTermId, section.academicYearId, section.schoolLevelId]);
    if (!terms.length) throw createError('The grading period must be active and match the section.', 404);
  }
  if (gradingCategoryId) {
    const [categories] = await connection.execute('SELECT id FROM grading_categories WHERE id = ? AND school_id = ? AND school_level_id = ? LIMIT 1', [gradingCategoryId, section.schoolId, section.schoolLevelId]);
    if (!categories.length) throw createError('The grading category does not match the section.', 404);
  }
}

async function listAssignments(req, res, next) {
  try {
    const database = getDatabase();
    const where = ['assignments.school_id = ?'];
    const values = [req.user.schoolId];
    if (req.user.role === 'teacher') { where.push('assignments.teacher_user_id = ?'); values.push(req.user.id); }
    else if (req.user.role === 'student') {
      where.push("assignments.status = 'published'");
      where.push('EXISTS (SELECT 1 FROM section_students WHERE section_students.school_id = assignments.school_id AND section_students.section_id = assignments.section_id AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)');
      values.push(req.user.id);
    } else if (req.user.role === 'parent') {
      where.push("assignments.status = 'published'");
      where.push('EXISTS (SELECT 1 FROM section_students INNER JOIN student_parent_links ON student_parent_links.school_id = section_students.school_id AND student_parent_links.student_user_id = section_students.student_user_id WHERE section_students.school_id = assignments.school_id AND section_students.section_id = assignments.section_id AND section_students.withdrawn_at IS NULL AND student_parent_links.parent_user_id = ?)');
      values.push(req.user.id);
    } else if (req.user.role !== 'school_admin') throw createError('You do not have access to assignments.', 403);
    if (req.query.sectionId) { where.push('assignments.section_id = ?'); values.push(parseId(req.query.sectionId, 'section ID')); }
    if (req.query.subjectId) { where.push('assignments.subject_id = ?'); values.push(parseId(req.query.subjectId, 'subject ID')); }
    const [assignments] = await database.execute(`${assignmentSelect()} WHERE ${where.join(' AND ')} ORDER BY assignments.due_at IS NULL, assignments.due_at, assignments.created_at DESC`, values);
    res.json({ assignments: assignments.map(formatAssignment) });
  } catch (error) { next(error); }
}

async function getParentAssignmentActivity(req, res, next) {
  try {
    const studentId = parseId(req.query.studentId, 'student ID');
    const date = normalizeDate(req.query.date);
    const database = getDatabase();
    const [children] = await database.execute(
      `SELECT users.id FROM users
      INNER JOIN student_parent_links ON student_parent_links.student_user_id = users.id
        AND student_parent_links.school_id = users.school_id
      WHERE users.id = ? AND users.school_id = ? AND users.role = 'student'
        AND users.account_status = 'active' AND student_parent_links.parent_user_id = ? LIMIT 1`,
      [studentId, req.user.schoolId, req.user.id]
    );
    if (!children.length) throw createError('This student is not linked to your parent account.', 403);

    const currentDate = getSchoolCurrentDate();
    const [rows] = await database.execute(
      `SELECT assignments.id AS assignmentId, assignments.subject_id AS subjectId,
        subjects.name AS subjectName, assignments.title,
        DATE_FORMAT(assignments.due_at, '%Y-%m-%d') AS dueDate,
        assignments.online_submission_enabled AS onlineSubmissionEnabled,
        assignment_submissions.submission_status AS savedStatus,
        assignment_submissions.file_path AS filePath,
        DATE_FORMAT(assignment_submissions.submitted_at, '%Y-%m-%dT%H:%i:%s') AS submittedAt
      FROM assignments
      INNER JOIN sections ON sections.id = assignments.section_id AND sections.school_id = assignments.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.status = 'active'
      INNER JOIN subjects ON subjects.id = assignments.subject_id AND subjects.school_id = assignments.school_id
      INNER JOIN section_students ON section_students.section_id = assignments.section_id
        AND section_students.school_id = assignments.school_id
        AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL
      LEFT JOIN assignment_submissions ON assignment_submissions.assignment_id = assignments.id
        AND assignment_submissions.school_id = assignments.school_id
        AND assignment_submissions.student_user_id = ?
      WHERE assignments.school_id = ? AND sections.school_id = ? AND sections.status = 'active'
        AND assignments.status = 'published' AND assignments.due_at IS NOT NULL
        AND DATE(assignments.due_at) = ?
        AND EXISTS (
          SELECT 1 FROM student_parent_links
          WHERE student_parent_links.school_id = assignments.school_id
            AND student_parent_links.student_user_id = section_students.student_user_id
            AND student_parent_links.parent_user_id = ?
        )
      ORDER BY subjects.name, assignments.title`,
      [studentId, studentId, req.user.schoolId, req.user.schoolId, date, req.user.id]
    );

    const assignments = rows.map(row => {
      const onlineSubmissionEnabled = Boolean(row.onlineSubmissionEnabled);
      const savedStatus = row.savedStatus;
      const hasUploadedFile = Boolean(row.filePath) && savedStatus === 'submitted';
      const manualStatus = !onlineSubmissionEnabled && SUBMISSION_STATUSES.has(savedStatus) ? savedStatus : null;
      const submissionStatus = hasUploadedFile
        ? 'submitted'
        : manualStatus || (row.dueDate < currentDate ? 'not_submitted' : 'pending');

      return {
        id: String(row.assignmentId),
        subjectId: String(row.subjectId),
        subjectName: row.subjectName,
        title: row.title,
        dueDate: row.dueDate,
        onlineSubmissionEnabled,
        submissionStatus,
        submittedAt: hasUploadedFile ? row.submittedAt : null
      };
    });

    res.json({ studentId: String(studentId), date, assignments });
  } catch (error) { next(error); }
}

async function updateStudentAssignmentStatus(req, res, next) {
  let connection;
  try {
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    const studentId = parseId(req.params.studentId, 'student ID');
    const status = String(req.body?.status || '').trim();
    if (!SUBMISSION_STATUSES.has(status)) throw createError('Submission status is invalid.');

    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const assignment = await getAssignmentForManagement(connection, req.user, assignmentId);
    if (!assignment) throw createError('Assignment was not found.', 404);
    assertAssignmentYearWritable(assignment);
    const [currentAssignment] = await connection.execute(
      'SELECT online_submission_enabled AS onlineSubmissionEnabled FROM assignments WHERE id = ? AND school_id = ? AND teacher_user_id = ? FOR UPDATE',
      [assignmentId, req.user.schoolId, req.user.id]
    );
    if (!currentAssignment.length) throw createError('Assignment was not found.', 404);
    if (Boolean(currentAssignment[0].onlineSubmissionEnabled)) {
      throw createError('Online submission status is set when a student uploads a file.', 409);
    }

    const [students] = await connection.execute(
      `SELECT section_students.student_user_id AS studentId FROM section_students
      INNER JOIN users ON users.id = section_students.student_user_id
      WHERE section_students.section_id = ? AND section_students.student_user_id = ?
        AND section_students.withdrawn_at IS NULL AND users.school_id = ?
        AND users.role = 'student' AND users.account_status = 'active' LIMIT 1 FOR UPDATE`,
      [assignment.sectionId, studentId, req.user.schoolId]
    );
    if (!students.length) throw createError('Student is not enrolled in this assignment section.', 404);

    const [existing] = await connection.execute(
      'SELECT file_path AS filePath FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? AND student_user_id = ? FOR UPDATE',
      [req.user.schoolId, assignmentId, studentId]
    );
    if (existing[0]?.filePath) throw createError('A student file is attached, so its status cannot be changed manually.', 409);

    await connection.execute(
      `INSERT INTO assignment_submissions (school_id, assignment_id, student_user_id, submission_status)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE submission_status = VALUES(submission_status), submitted_at = NULL`,
      [req.user.schoolId, assignmentId, studentId, status]
    );
    await connection.commit();
    res.json({ assignmentId: String(assignmentId), studentId: String(studentId), submissionStatus: status });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

async function createAssignment(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const sectionId = parseId(req.body.sectionId, 'section ID');
    const subjectId = parseId(req.body.subjectId, 'subject ID');
    const section = await getTeacherSectionSubject(connection, req.user.id, sectionId, subjectId);
    if (!section) throw createError('You are not assigned to this section and subject.', 403);
    const academicTermId = optionalId(req.body.academicTermId, 'academic term ID');
    const gradingCategoryId = optionalId(req.body.gradingCategoryId, 'grading category ID');
    await validateTermAndCategory(connection, section, academicTermId, gradingCategoryId);
    const title = requiredText(req.body.title, 255, 'Assignment title');
    const description = optionalText(req.body.description, 10000, 'Assignment description');
    const dueAt = dateTime(req.body.dueAt, 'Due date');
    const maxScore = scoreValue(req.body.maxScore, 'Maximum score', false);
    if ((gradingCategoryId === null) !== (maxScore === null)) {
      throw createError('Choose both a grading category and maximum score for a graded assignment.');
    }
    if (gradingCategoryId && (!academicTermId || maxScore <= 0)) {
      throw createError('A graded assignment needs an active grading period and a maximum score greater than zero.');
    }
    if (gradingCategoryId) await validateGradeItemScope(connection, req.user, section, subjectId, academicTermId, gradingCategoryId);
    const onlineSubmissionEnabled = req.body.onlineSubmissionEnabled === true ? 1 : 0;
    const status = req.body.status === undefined ? 'published' : String(req.body.status);
    if (!ASSIGNMENT_STATUSES.has(status)) throw createError('Assignment status is invalid.');
    const [result] = await connection.execute('INSERT INTO assignments (school_id, section_id, subject_id, academic_term_id, grading_category_id, teacher_user_id, title, description, due_at, max_score, online_submission_enabled, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [section.schoolId, sectionId, subjectId, academicTermId, gradingCategoryId, req.user.id, title, description, dueAt, maxScore, onlineSubmissionEnabled, status]);
    if (gradingCategoryId) {
      const [item] = await connection.execute(
        `INSERT INTO grading_items (school_id, section_id, subject_id, academic_term_id,
          grading_category_id, teacher_user_id, title, max_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [section.schoolId, sectionId, subjectId, academicTermId, gradingCategoryId, req.user.id, title, maxScore]
      );
      await connection.execute(
        'UPDATE assignments SET grading_item_id = ? WHERE id = ? AND school_id = ?',
        [item.insertId, result.insertId, req.user.schoolId]
      );
    }
    const assignment = await getAssignmentForManagement(connection, req.user, result.insertId);
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ assignment: formatAssignment(assignment) });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function updateAssignment(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    const current = await getAssignmentForManagement(connection, req.user, assignmentId, true);
    if (!current) throw createError('Assignment was not found.', 404);
    assertAssignmentYearWritable(current);
    const section = await getTeacherSectionSubject(connection, current.teacherUserId, current.sectionId, current.subjectId);
    if (!section) throw createError('The assignment section-subject relationship is no longer active.', 409);
    const academicTermId = req.body.academicTermId === undefined ? current.academicTermId : optionalId(req.body.academicTermId, 'academic term ID');
    const gradingCategoryId = req.body.gradingCategoryId === undefined ? current.gradingCategoryId : optionalId(req.body.gradingCategoryId, 'grading category ID');
    await validateTermAndCategory(connection, section, academicTermId, gradingCategoryId);
    const title = req.body.title === undefined ? current.title : requiredText(req.body.title, 255, 'Assignment title');
    const description = req.body.description === undefined ? current.description : optionalText(req.body.description, 10000, 'Assignment description');
    const dueAt = req.body.dueAt === undefined ? current.dueAt : dateTime(req.body.dueAt, 'Due date');
    const maxScore = req.body.maxScore === undefined ? current.maxScore : scoreValue(req.body.maxScore, 'Maximum score', false);
    if (current.gradingItemId && (Number(academicTermId) !== Number(current.academicTermId)
      || Number(gradingCategoryId) !== Number(current.gradingCategoryId) || maxScore === null)) {
      throw createError('An assignment with a score component cannot change its grading period or category, or remove its maximum score.', 409);
    }
    if (current.gradingItemId && (title !== current.title || Number(maxScore) !== Number(current.maxScore))) {
      await validateGradeItemScope(connection, req.user, section, current.subjectId, academicTermId, gradingCategoryId);
    }
    const onlineSubmissionEnabled = req.body.onlineSubmissionEnabled === undefined
      ? Number(current.onlineSubmissionEnabled) === 1
      : req.body.onlineSubmissionEnabled === true;
    const status = req.body.status === undefined ? current.status : String(req.body.status);
    if (!ASSIGNMENT_STATUSES.has(status)) throw createError('Assignment status is invalid.');
    if (current.gradingItemId) {
      const [[scores]] = await connection.execute(
        'SELECT MAX(score) AS highest FROM student_scores WHERE school_id = ? AND grading_item_id = ?',
        [req.user.schoolId, current.gradingItemId]
      );
      if (scores.highest !== null && maxScore < Number(scores.highest)) {
        throw createError(`The maximum score cannot be lower than the recorded score of ${scores.highest}.`, 409);
      }
      if (Number(maxScore) !== Number(current.maxScore)) {
        const [published] = await connection.execute(
          `SELECT id FROM published_final_grades WHERE school_id = ? AND section_id = ?
            AND subject_id = ? AND academic_term_id = ? LIMIT 1`,
          [req.user.schoolId, current.sectionId, current.subjectId, current.academicTermId]
        );
        if (published.length) throw createError('Published grades prevent changing this assignment’s maximum score.', 409);
      }
    }
    await connection.execute('UPDATE assignments SET academic_term_id=?, grading_category_id=?, title=?, description=?, due_at=?, max_score=?, online_submission_enabled=?, status=? WHERE id=? AND school_id=?', [academicTermId, gradingCategoryId, title, description, dueAt, maxScore, onlineSubmissionEnabled ? 1 : 0, status, assignmentId, req.user.schoolId]);
    if (current.gradingItemId) await connection.execute(
      'UPDATE grading_items SET title = ?, max_score = ? WHERE id = ? AND school_id = ?',
      [title, maxScore, current.gradingItemId, req.user.schoolId]
    );
    const assignment = formatAssignment(await getAssignmentForManagement(connection, req.user, assignmentId));
    await connection.commit();
    transactionStarted = false;
    res.json({ assignment });
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function deleteAssignment(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    let assignment = await getAssignmentForManagement(connection, req.user, assignmentId);
    if (!assignment) throw createError('Assignment was not found.', 404);
    assertAssignmentYearWritable(assignment);
    const original = assignment;
    if (assignment.gradingItemId) {
      const section = await getTeacherSectionSubject(connection, assignment.teacherUserId, assignment.sectionId, assignment.subjectId);
      if (!section || Number(section.schoolId) !== Number(req.user.schoolId)) {
        throw createError('The assignment section-subject relationship is no longer active.', 409);
      }
      await assertGradeWriteAccess(connection, req.user, assignment);
    }
    assignment = await getAssignmentForManagement(connection, req.user, assignmentId, true);
    if (!assignment) throw createError('Assignment was not found.', 404);
    if (['sectionId', 'subjectId', 'academicTermId', 'gradingCategoryId', 'teacherUserId', 'gradingItemId']
      .some(field => String(assignment[field]) !== String(original[field]))) {
      throw createError('The assignment changed while deletion was being prepared. Reload and try again.', 409);
    }
    assertAssignmentYearWritable(assignment);
    const [submissions] = await connection.execute(
      'SELECT id FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? LIMIT 1 FOR UPDATE',
      [assignment.schoolId, assignmentId]
    );
    if (submissions.length) throw createError('Assignments with student submissions cannot be deleted.', 409);
    if (assignment.gradingItemId) {
      const [items] = await connection.execute(
        `SELECT id, section_id AS sectionId, subject_id AS subjectId,
          academic_term_id AS academicTermId, grading_category_id AS gradingCategoryId,
          teacher_user_id AS teacherUserId, used_in_published_grades AS usedInPublishedGrades
        FROM grading_items WHERE id = ? AND school_id = ? FOR UPDATE`,
        [assignment.gradingItemId, assignment.schoolId]
      );
      const item = items[0];
      if (!item || Number(item.sectionId) !== Number(assignment.sectionId)
        || Number(item.subjectId) !== Number(assignment.subjectId)
        || Number(item.academicTermId) !== Number(assignment.academicTermId)
        || Number(item.gradingCategoryId) !== Number(assignment.gradingCategoryId)
        || Number(item.teacherUserId) !== Number(assignment.teacherUserId)) {
        throw createError('The assignment and score component no longer match.', 409);
      }
      if (item.usedInPublishedGrades) throw createError('This score component was used in published grades and cannot be deleted.', 409);
      const [scores] = await connection.execute(
        `SELECT id FROM student_scores WHERE school_id = ? AND grading_item_id = ?
          AND (score IS NOT NULL OR (remarks IS NOT NULL AND TRIM(remarks) <> '')) LIMIT 1 FOR UPDATE`,
        [assignment.schoolId, item.id]
      );
      if (scores.length) throw createError('The score component has saved student scores and cannot be deleted.', 409);
      const [prompts] = await connection.execute(
        'SELECT id FROM journal_prompts WHERE school_id = ? AND grading_item_id = ? LIMIT 1 FOR UPDATE',
        [assignment.schoolId, item.id]
      );
      if (prompts.length) throw createError('This score component belongs to a journal prompt and cannot be deleted.', 409);
    } else if (assignment.academicTermId) {
      const [gradingItems] = await connection.execute(
        'SELECT id FROM grading_items WHERE school_id = ? AND section_id = ? AND subject_id = ? AND academic_term_id = ? AND title = ? LIMIT 1',
        [assignment.schoolId, assignment.sectionId, assignment.subjectId, assignment.academicTermId, assignment.title]
      );
      if (gradingItems.length) throw createError('This older assignment has no confirmed score component link. Review it before deletion.', 409);
    }
    await connection.execute('DELETE FROM assignments WHERE id = ? AND school_id = ?', [assignmentId, assignment.schoolId]);
    if (assignment.gradingItemId) {
      await connection.execute(
        `DELETE FROM student_scores WHERE school_id = ? AND grading_item_id = ?
          AND score IS NULL AND (remarks IS NULL OR TRIM(remarks) = '')`,
        [assignment.schoolId, assignment.gradingItemId]
      );
      await connection.execute(
        'DELETE FROM grading_items WHERE id = ? AND school_id = ?',
        [assignment.gradingItemId, assignment.schoolId]
      );
    }
    await writeAuditLog(connection, req, 'assignment_deleted', 'assignment', assignmentId, {
      summary: assignment.title, gradingItemId: assignment.gradingItemId || null
    });
    await connection.commit();
    transactionStarted = false;
    res.status(204).send();
  } catch (error) { if (transactionStarted) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function getStudentAssignment(connection, schoolId, studentId, assignmentId) {
  const [assignments] = await connection.execute(`${assignmentSelect()} WHERE assignments.id = ? AND assignments.school_id = ? AND assignments.status = 'published' AND EXISTS (SELECT 1 FROM section_students WHERE section_students.school_id = assignments.school_id AND section_students.section_id = assignments.section_id AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL) LIMIT 1`, [assignmentId, schoolId, studentId]);
  return assignments[0] || null;
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await fs.unlink(file.path).catch(() => {});
}

async function removeStoredSubmission(relativePath) {
  const fileName = path.basename(String(relativePath || ''));
  if (!/^[a-f0-9-]{36}\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(fileName)) return;
  const legacy = String(relativePath).replace(/^\/+/, '').startsWith('uploads/assignment-submissions/');
  const directory = legacy ? path.resolve(__dirname, '..', 'uploads', 'assignment-submissions') : uploadDirectory;
  await fs.unlink(path.join(directory, fileName)).catch(() => {});
}

async function checkSubmissionFile(file) {
  const bytes = await fs.readFile(file.path);
  const extension = path.extname(file.filename).toLowerCase();
  const zip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const ole = bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const valid = extension === '.pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : ['.docx', '.pptx', '.xlsx'].includes(extension) ? zip
      : ['.doc', '.ppt', '.xls'].includes(extension) ? ole : false;
  if (!valid) throw createError('The submission contents do not match its file extension.');
  if (!zip) return;
  const document = await JSZip.loadAsync(bytes)
    .catch(() => { throw createError('The Office submission is invalid.'); });
  const requiredPart = { '.docx': 'word/document.xml', '.pptx': 'ppt/presentation.xml', '.xlsx': 'xl/workbook.xml' }[extension];
  if (!document.file(requiredPart) || Object.keys(document.files).some(name => /vbaProject\.bin$/i.test(name))) {
    throw createError('The Office submission is invalid or contains macros.');
  }
}

async function submitAssignment(req, res, next) {
  try {
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    if (!req.file) throw createError('Attach one supported submission file.');
    await checkSubmissionFile(req.file);
    const assignment = await getStudentAssignment(getDatabase(), req.user.schoolId, req.user.id, assignmentId);
    if (!assignment) throw createError('Assignment was not found.', 404);
    assertAssignmentYearWritable(assignment);
    if (!assignment.onlineSubmissionEnabled) throw createError('Online submissions are not enabled for this assignment.', 409);
    const filePath = req.file.filename;
    const database = getDatabase();
    const [existing] = await database.execute('SELECT file_path AS filePath FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? AND student_user_id = ? LIMIT 1', [req.user.schoolId, assignmentId, req.user.id]);
    await database.execute(`INSERT INTO assignment_submissions (school_id, assignment_id, student_user_id, file_name, file_path, file_size_bytes, submission_status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, 'submitted', NOW()) ON DUPLICATE KEY UPDATE file_name=VALUES(file_name), file_path=VALUES(file_path), file_size_bytes=VALUES(file_size_bytes), submission_status='submitted', submitted_at=NOW()`, [req.user.schoolId, assignmentId, req.user.id, req.file.originalname.slice(0, 255), filePath, req.file.size]);
    if (existing[0]?.filePath !== filePath) await removeStoredSubmission(existing[0]?.filePath);
    res.status(201).json({ assignmentId, studentId: req.user.id, fileName: req.file.originalname, fileSizeBytes: req.file.size, submissionStatus: 'submitted' });
  } catch (error) {
    await removeUploadedFile(req.file);
    next(error);
  }
}

async function listSubmissions(req, res, next) {
  try {
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    const database = getDatabase();
    const assignment = await getAssignmentForManagement(database, req.user, assignmentId);
    if (!assignment) {
      if (req.user.role !== 'student') throw createError('Assignment was not found.', 404);
      const ownAssignment = await getStudentAssignment(database, req.user.schoolId, req.user.id, assignmentId);
      if (!ownAssignment) throw createError('Assignment was not found.', 404);
      const [submissions] = await database.execute('SELECT id, assignment_id AS assignmentId, student_user_id AS studentId, file_name AS fileName, file_path AS filePath, file_size_bytes AS fileSizeBytes, submission_status AS submissionStatus, submitted_at AS submittedAt, updated_at AS updatedAt FROM assignment_submissions WHERE school_id = ? AND assignment_id = ? AND student_user_id = ?', [req.user.schoolId, assignmentId, req.user.id]);
      return res.json({ submissions: submissions.map(({ filePath, ...submission }) => ({
        ...submission,
        fileUrl: null
      })) });
    }
    const [submissions] = await database.execute('SELECT assignment_submissions.id, assignment_submissions.assignment_id AS assignmentId, assignment_submissions.student_user_id AS studentId, students.display_name AS studentName, assignment_submissions.file_name AS fileName, assignment_submissions.file_path AS filePath, assignment_submissions.file_size_bytes AS fileSizeBytes, assignment_submissions.submission_status AS submissionStatus, assignment_submissions.submitted_at AS submittedAt, assignment_submissions.updated_at AS updatedAt FROM assignment_submissions INNER JOIN users AS students ON students.id = assignment_submissions.student_user_id AND students.school_id = assignment_submissions.school_id WHERE assignment_submissions.school_id = ? AND assignment_submissions.assignment_id = ? ORDER BY students.last_name, students.first_name', [assignment.schoolId, assignmentId]);
    res.json({ submissions: submissions.map(({ filePath, ...submission }) => ({
      ...submission,
      fileUrl: filePath ? `/api/assignments/${assignmentId}/submissions/${submission.id}/download` : null
    })) });
  } catch (error) { next(error); }
}

async function getManagedSubmissionFile(database, user, assignmentId, submissionId) {
  const assignment = await getAssignmentForManagement(database, user, assignmentId);
  if (!assignment) throw createError('Assignment was not found.', 404);
  const [submissions] = await database.execute(
    'SELECT file_name AS fileName, file_path AS filePath FROM assignment_submissions WHERE id = ? AND school_id = ? AND assignment_id = ? LIMIT 1',
    [submissionId, assignment.schoolId, assignmentId]
  );
  const submission = submissions[0];
  const fileName = path.basename(String(submission?.filePath || ''));
  if (!/^[a-f0-9-]{36}\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(fileName)) {
    throw createError('The submitted file is not available.', 404);
  }
  const legacy = String(submission.filePath).replace(/^\/+/, '').startsWith('uploads/assignment-submissions/');
  const directory = legacy ? path.resolve(__dirname, '..', 'uploads', 'assignment-submissions') : uploadDirectory;
  const filePath = path.resolve(directory, fileName);
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    throw createError('The submitted file path is invalid.', 400);
  }
  return { fileName: submission.fileName || 'assignment-submission', filePath };
}

async function createSubmissionPdfPreview(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.pdf' && !OFFICE_FILE_EXTENSIONS.has(extension)) {
    throw createError('This file type cannot be previewed.', 415);
  }
  const temporaryDirectory = extension === '.pdf'
    ? null
    : await fs.mkdtemp(path.join(os.tmpdir(), 'academix-submission-preview-'));
  try {
    let previewPath = filePath;
    if (temporaryDirectory) {
      const profileDirectory = path.join(temporaryDirectory, 'profile');
      await fs.mkdir(profileDirectory);
      const converterPath = process.env.LIBREOFFICE_PATH || 'soffice';
      try {
        await execFileAsync(converterPath, [
          '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
          `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
          '--convert-to', 'pdf', '--outdir', temporaryDirectory, filePath
        ], { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw createError('Office previews need LibreOffice. Download the original file to open it.', 503, true);
        }
        throw createError('This Office file could not be previewed. Download the original file to open it.', 422);
      }
      previewPath = path.join(temporaryDirectory, `${path.basename(filePath, extension)}.pdf`);
    }

    let fileInfo;
    try {
      fileInfo = await fs.stat(previewPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw createError(temporaryDirectory
          ? 'This Office file could not be previewed. Download the original file to open it.'
          : 'The submitted file is not available.', temporaryDirectory ? 422 : 404);
      }
      throw error;
    }
    if (!fileInfo.isFile() || fileInfo.size > MAX_PREVIEW_SIZE_BYTES) {
      throw createError('This file is too large to preview. Download the original file to open it.', 413);
    }
    const buffer = await fs.readFile(previewPath);
    if (buffer.length < 5 || buffer.toString('ascii', 0, 5) !== '%PDF-') {
      throw createError('A PDF preview could not be created. Download the original file to open it.', 422);
    }
    return buffer;
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function downloadSubmission(req, res, next) {
  try {
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    const submissionId = parseId(req.params.submissionId, 'submission ID');
    const submission = await getManagedSubmissionFile(getDatabase(), req.user, assignmentId, submissionId);
    res.download(submission.filePath, submission.fileName, error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) { next(error); }
}

async function previewSubmission(req, res, next) {
  try {
    const assignmentId = parseId(req.params.assignmentId, 'assignment ID');
    const submissionId = parseId(req.params.submissionId, 'submission ID');
    const submission = await getManagedSubmissionFile(getDatabase(), req.user, assignmentId, submissionId);
    const pdf = await createSubmissionPdfPreview(submission.filePath);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="assignment-submission-preview.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }).send(pdf);
  } catch (error) { next(error); }
}

module.exports = { createAssignment, deleteAssignment, downloadSubmission, getParentAssignmentActivity, listAssignments, listSubmissions, previewSubmission, submitAssignment, updateAssignment, updateStudentAssignmentStatus };
