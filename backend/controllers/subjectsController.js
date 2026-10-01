const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
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

function text(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

async function validateSubjectScope(connection, schoolId, schoolLevelId, gradeLevelId) {
  if (!schoolLevelId && gradeLevelId) throw createError('A grade level requires a school level.');
  if (schoolLevelId) {
    const [levels] = await connection.execute('SELECT id FROM school_levels WHERE id = ? AND school_id = ? LIMIT 1', [schoolLevelId, schoolId]);
    if (!levels.length) throw createError('School level was not found.', 404);
  }
  if (gradeLevelId) {
    const [grades] = await connection.execute('SELECT id FROM school_grade_levels WHERE id = ? AND school_level_id = ? LIMIT 1', [gradeLevelId, schoolLevelId]);
    if (!grades.length) throw createError('Grade level was not found.', 404);
  }
}

async function listSubjects(req, res, next) {
  try {
    const database = getDatabase();
    const values = [req.user.schoolId];
    let where = 'subjects.school_id = ?';
    if (req.user.role === 'teacher') {
      where += ' AND EXISTS (SELECT 1 FROM section_teachers WHERE section_teachers.subject_id = subjects.id AND section_teachers.teacher_user_id = ?)';
      values.push(req.user.id);
    } else if (req.user.role !== 'school_admin') {
      throw createError('You do not have access to subjects.', 403);
    }
    if (req.query.schoolLevelId) { where += ' AND subjects.school_level_id = ?'; values.push(parseId(req.query.schoolLevelId, 'school level ID')); }
    const [subjects] = await database.execute(`SELECT subjects.id, subjects.school_id AS schoolId, subjects.subject_code AS subjectCode, subjects.name, subjects.school_level_id AS schoolLevelId, subjects.grade_level_id AS gradeLevelId, subjects.is_active AS isActive, school_levels.level_code AS schoolLevelCode, school_levels.display_name AS schoolLevelName, school_grade_levels.grade_code AS gradeCode, school_grade_levels.display_name AS gradeLevelName FROM subjects LEFT JOIN school_levels ON school_levels.id = subjects.school_level_id LEFT JOIN school_grade_levels ON school_grade_levels.id = subjects.grade_level_id WHERE ${where} ORDER BY subjects.name`, values);
    res.json({ subjects: subjects.map(subject => ({ ...subject, isActive: Boolean(subject.isActive) })) });
  } catch (error) { next(error); }
}

async function createSubject(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const subjectCode = text(req.body.subjectCode, 50, 'Subject code').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(subjectCode)) throw createError('Subject code must use letters, numbers, or hyphens.');
    const name = text(req.body.name, 120, 'Subject name');
    const schoolLevelId = optionalId(req.body.schoolLevelId, 'school level ID');
    const gradeLevelId = optionalId(req.body.gradeLevelId, 'grade level ID');
    await validateSubjectScope(connection, req.user.schoolId, schoolLevelId, gradeLevelId);
    await connection.beginTransaction();
    transactionStarted = true;
    const [result] = await connection.execute('INSERT INTO subjects (school_id, subject_code, name, school_level_id, grade_level_id) VALUES (?, ?, ?, ?, ?)', [req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId]);
    await writeAuditLog(connection, req, 'subject_created', 'subject', result.insertId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ subject: { id: result.insertId, schoolId: req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId, isActive: true } });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('A subject with this code already exists.', 409);
    next(error);
  } finally { connection.release(); }
}

async function updateSubject(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const [rows] = await connection.execute('SELECT id, subject_code AS subjectCode, name, school_level_id AS schoolLevelId, grade_level_id AS gradeLevelId, is_active AS isActive FROM subjects WHERE id = ? AND school_id = ? LIMIT 1', [subjectId, req.user.schoolId]);
    const current = rows[0];
    if (!current) throw createError('Subject was not found.', 404);
    const subjectCode = req.body.subjectCode === undefined ? current.subjectCode : text(req.body.subjectCode, 50, 'Subject code').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(subjectCode)) throw createError('Subject code must use letters, numbers, or hyphens.');
    const name = req.body.name === undefined ? current.name : text(req.body.name, 120, 'Subject name');
    const schoolLevelId = req.body.schoolLevelId === undefined ? current.schoolLevelId : optionalId(req.body.schoolLevelId, 'school level ID');
    const gradeLevelId = req.body.gradeLevelId === undefined ? current.gradeLevelId : optionalId(req.body.gradeLevelId, 'grade level ID');
    const isActive = req.body.isActive === undefined ? Boolean(current.isActive) : req.body.isActive;
    if (typeof isActive !== 'boolean') throw createError('Subject activity must use true or false.');
    await validateSubjectScope(connection, req.user.schoolId, schoolLevelId, gradeLevelId);
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute('UPDATE subjects SET subject_code=?, name=?, school_level_id=?, grade_level_id=?, is_active=? WHERE id=?', [subjectCode, name, schoolLevelId, gradeLevelId, isActive, subjectId]);
    if (req.body.isActive !== undefined) {
      await connection.execute('UPDATE journal_subjects SET is_active = ? WHERE subject_id = ?', [isActive, subjectId]);
    }
    await writeAuditLog(connection, req, 'subject_updated', 'subject', subjectId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.json({ subject: { id: subjectId, schoolId: req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId, isActive } });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('A subject with this code already exists.', 409);
    next(error);
  } finally { connection.release(); }
}

async function deleteSubject(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    if (req.user.role !== 'school_admin' || !req.user.schoolId) throw createError('You do not have access to remove subjects.', 403);
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [subjects] = await connection.execute(
      'SELECT id, name FROM subjects WHERE id = ? AND school_id = ? FOR UPDATE',
      [subjectId, req.user.schoolId]
    );
    const subject = subjects[0];
    if (!subject) throw createError('Subject was not found.', 404);

    const [[references]] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM section_teachers WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM assignments WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM grading_items WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM published_final_grades WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM attendance_sessions WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM grading_period_reopen_requests WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM learning_materials WHERE subject_id = ?) +
        (SELECT COUNT(*) FROM journal_subjects WHERE subject_id = ?) AS total`,
      Array(8).fill(subjectId)
    );

    if (Number(references.total) > 0) {
      await connection.execute('UPDATE subjects SET is_active = FALSE WHERE id = ?', [subjectId]);
      await connection.execute('UPDATE journal_subjects SET is_active = FALSE WHERE subject_id = ?', [subjectId]);
      await writeAuditLog(connection, req, 'subject_deactivated', 'subject', subjectId, { summary: subject.name });
      await connection.commit();
      transactionStarted = false;
      return res.status(200).json({ deleted: false, subject: { id: subjectId, isActive: false } });
    }

    await writeAuditLog(connection, req, 'subject_deleted', 'subject', subjectId, { summary: subject.name });
    await connection.execute('DELETE FROM subjects WHERE id = ? AND school_id = ?', [subjectId, req.user.schoolId]);
    await connection.commit();
    transactionStarted = false;
    res.status(204).end();
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_ROW_IS_REFERENCED_2') error = createError('This subject has linked records and could not be removed.', 409);
    next(error);
  } finally { connection.release(); }
}

module.exports = { createSubject, deleteSubject, listSubjects, updateSubject };
