const { getDatabase } = require('../config/database');
const { upsertStudentScore } = require('./gradesController');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function text(value, maximum, label, required = false) {
  if (value === undefined || value === null) {
    if (required) throw createError(`${label} is required.`);
    return null;
  }
  const result = String(value).trim();
  if (required && !result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result || null;
}

function dateOnly(value, label) {
  const result = String(value || '').trim();
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw createError(`${label} must be a valid date.`);
  }
  return result;
}

function dateTime(value, label) {
  const result = String(value || '').trim();
  const match = result.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw createError(`${label} must be a valid date and time.`);
  }
  dateOnly(match[1], label);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) {
    throw createError(`${label} must be a valid date and time.`);
  }
  return `${result.replace('T', ' ').slice(0, 19)}${result.length === 16 ? ':00' : ''}`;
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function promptFields(row) {
  return {
    id: row.id,
    journalSubjectId: row.journalSubjectId,
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    gradingItemId: row.gradingItemId,
    maxScore: row.maxScore === null ? null : Number(row.maxScore),
    weekStartDate: row.weekStartDate,
    promptText: row.promptText,
    opensAt: row.opensAt,
    dueAt: row.dueAt,
    minWords: Number(row.minWords),
    allowLate: row.allowLate === true || Number(row.allowLate) === 1,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function entryFields(row) {
  return {
    id: row.id,
    promptId: row.promptId === null ? null : row.promptId,
    journalSubjectId: row.journalSubjectId,
    journalSubjectName: row.journalSubjectName,
    studentId: row.studentId,
    studentName: row.studentName,
    studentInitials: row.studentInitials,
    sectionId: row.sectionId,
    sectionName: row.sectionName,
    promptText: row.promptText,
    entryText: row.entryText,
    status: row.status,
    submittedAt: row.submittedAt,
    isLate: row.isLate === true || Number(row.isLate) === 1,
    score: row.score === null ? null : Number(row.score),
    maxScore: row.maxScore === null ? null : Number(row.maxScore),
    feedback: row.feedbackId ? {
      id: row.feedbackId,
      text: row.feedbackText,
      teacherUserId: row.feedbackTeacherUserId,
      teacherName: row.feedbackTeacherName,
      createdAt: row.feedbackCreatedAt
    } : null
  };
}

async function getConfiguredJournalSubject(database, schoolId) {
  const [subjects] = await database.execute(
    `SELECT journal_subjects.id, journal_subjects.school_id AS schoolId,
      journal_subjects.subject_id AS subjectId, journal_subjects.name, journal_subjects.is_active AS isActive
    FROM school_portal_features
    INNER JOIN school_settings ON school_settings.school_id = school_portal_features.school_id
    INNER JOIN journal_subjects ON journal_subjects.school_id = school_settings.school_id
      AND journal_subjects.subject_id = school_settings.journal_subject_id
    WHERE school_portal_features.school_id = ?
      AND school_portal_features.journals_enabled = TRUE
      AND journal_subjects.is_active = TRUE
    LIMIT 1`,
    [schoolId]
  );
  if (!subjects[0]) throw createError('Journals are not enabled or configured for this school.', 403);
  return subjects[0];
}

async function teacherCanManageSection(database, teacherId, schoolId, sectionId, subjectId) {
  const [assignments] = await database.execute(
    `SELECT section_teachers.id FROM section_teachers
    INNER JOIN sections ON sections.id = section_teachers.section_id
    WHERE section_teachers.teacher_user_id = ? AND sections.school_id = ?
      AND section_teachers.section_id = ? AND section_teachers.subject_id = ?
      AND sections.status = 'active' LIMIT 1`,
    [teacherId, schoolId, sectionId, subjectId]
  );
  return Boolean(assignments[0]);
}

async function getGradingItem(database, req, sectionId, subjectId, gradingItemId) {
  if (!gradingItemId) return null;
  const [items] = await database.execute(
    `SELECT id, max_score AS maxScore FROM grading_items
    WHERE id = ? AND section_id = ? AND subject_id = ? AND teacher_user_id = ? LIMIT 1`,
    [gradingItemId, sectionId, subjectId, req.user.id]
  );
  if (!items[0]) throw createError('Choose a grading item for this section and journal subject.', 403);
  return items[0];
}

function promptsSelect() {
  return `SELECT journal_prompts.id, journal_prompts.journal_subject_id AS journalSubjectId,
    journal_subjects.subject_id AS subjectId, journal_subjects.name AS subjectName,
    journal_prompts.section_id AS sectionId, sections.name AS sectionName,
    journal_prompts.grading_item_id AS gradingItemId, grading_items.max_score AS maxScore,
    DATE_FORMAT(journal_prompts.week_start_date, '%Y-%m-%d') AS weekStartDate,
    journal_prompts.prompt_text AS promptText, journal_prompts.opens_at AS opensAt,
    journal_prompts.due_at AS dueAt, journal_prompts.min_words AS minWords,
    journal_prompts.allow_late AS allowLate, journal_prompts.prompt_status AS status,
    journal_prompts.created_by_user_id AS createdByUserId,
    journal_prompts.created_at AS createdAt, journal_prompts.updated_at AS updatedAt
  FROM journal_prompts
  INNER JOIN journal_subjects ON journal_subjects.id = journal_prompts.journal_subject_id
  INNER JOIN sections ON sections.id = journal_prompts.section_id
  LEFT JOIN grading_items ON grading_items.id = journal_prompts.grading_item_id`;
}

function entriesSelect() {
  return `SELECT student_journal_entries.id, student_journal_entries.journal_prompt_id AS promptId,
    student_journal_entries.journal_subject_id AS journalSubjectId,
    journal_subjects.name AS journalSubjectName, student_journal_entries.student_user_id AS studentId,
    students.display_name AS studentName, students.initials AS studentInitials,
    student_journal_entries.section_id AS sectionId, sections.name AS sectionName,
    student_journal_entries.prompt_text AS promptText, student_journal_entries.entry_text AS entryText,
    student_journal_entries.entry_status AS status, student_journal_entries.submitted_at AS submittedAt,
    IF(journal_prompts.due_at IS NOT NULL AND student_journal_entries.submitted_at > journal_prompts.due_at, TRUE, FALSE) AS isLate,
    student_scores.score AS score, grading_items.max_score AS maxScore,
    latest_feedback.id AS feedbackId, latest_feedback.feedback_text AS feedbackText,
    latest_feedback.teacher_user_id AS feedbackTeacherUserId,
    feedback_teachers.display_name AS feedbackTeacherName, latest_feedback.created_at AS feedbackCreatedAt
  FROM student_journal_entries
  INNER JOIN journal_subjects ON journal_subjects.id = student_journal_entries.journal_subject_id
  INNER JOIN users AS students ON students.id = student_journal_entries.student_user_id
  INNER JOIN sections ON sections.id = student_journal_entries.section_id
  LEFT JOIN journal_prompts ON journal_prompts.id = student_journal_entries.journal_prompt_id
  LEFT JOIN grading_items ON grading_items.id = journal_prompts.grading_item_id
  LEFT JOIN student_scores ON student_scores.grading_item_id = grading_items.id
    AND student_scores.student_user_id = student_journal_entries.student_user_id
  LEFT JOIN journal_feedback AS latest_feedback ON latest_feedback.id = (
    SELECT journal_feedback.id FROM journal_feedback
    WHERE journal_feedback.journal_entry_id = student_journal_entries.id
    ORDER BY journal_feedback.created_at DESC, journal_feedback.id DESC LIMIT 1
  )
  LEFT JOIN users AS feedback_teachers ON feedback_teachers.id = latest_feedback.teacher_user_id`;
}

async function listJournalSubjects(req, res, next) {
  try {
    if (!['teacher', 'student'].includes(req.user.role) || !req.user.schoolId) throw createError('You do not have access to journals.', 403);
    const subject = await getConfiguredJournalSubject(getDatabase(), req.user.schoolId);
    res.json({ journalSubjects: [{ id: subject.id, subjectId: subject.subjectId, name: subject.name, isActive: Boolean(subject.isActive) }] });
  } catch (error) { next(error); }
}

async function listJournalSections(req, res, next) {
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('You do not have access to journal sections.', 403);
    const database = getDatabase();
    const subject = await getConfiguredJournalSubject(database, req.user.schoolId);
    const [sections] = await database.execute(
      `SELECT sections.id, sections.school_id AS schoolId, sections.academic_year_id AS academicYearId,
        sections.name, sections.status, school_levels.display_name AS schoolLevelName,
        school_grade_levels.display_name AS gradeLevelName,
        (SELECT COUNT(*) FROM section_students WHERE section_students.section_id = sections.id
          AND section_students.withdrawn_at IS NULL) AS studentCount
      FROM sections
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      INNER JOIN section_teachers ON section_teachers.section_id = sections.id
      WHERE sections.school_id = ? AND sections.status = 'active'
        AND section_teachers.teacher_user_id = ? AND section_teachers.subject_id = ?
      ORDER BY school_grade_levels.sort_order, sections.name`,
      [req.user.schoolId, req.user.id, subject.subjectId]
    );
    res.json({ sections: sections.map(section => ({
      ...section,
      id: Number(section.id),
      schoolId: Number(section.schoolId),
      academicYearId: Number(section.academicYearId),
      studentCount: Number(section.studentCount),
      label: `${section.gradeLevelName} – ${section.name}`
    })) });
  } catch (error) { next(error); }
}

async function listJournalPrompts(req, res, next) {
  try {
    if (!['teacher', 'student'].includes(req.user.role) || !req.user.schoolId) throw createError('You do not have access to journal prompts.', 403);
    const database = getDatabase();
    const subject = await getConfiguredJournalSubject(database, req.user.schoolId);
    const where = [
      'journal_prompts.journal_subject_id = ?',
      'sections.school_id = ?',
      "sections.status = 'active'"
    ];
    const values = [subject.id, req.user.schoolId];

    if (req.user.role === 'teacher') {
      where.push(`EXISTS (SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = journal_prompts.section_id
          AND section_teachers.teacher_user_id = ? AND section_teachers.subject_id = ?)`);
      values.push(req.user.id, subject.subjectId);
    } else {
      where.push("journal_prompts.prompt_status IN ('open', 'closed')");
      where.push('journal_prompts.opens_at <= NOW()');
      where.push(`EXISTS (SELECT 1 FROM section_students
        WHERE section_students.section_id = journal_prompts.section_id
          AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)`);
      values.push(req.user.id);
    }

    if (req.query.sectionId) {
      const sectionId = parseId(req.query.sectionId, 'section ID');
      if (req.user.role === 'teacher' && !(await teacherCanManageSection(database, req.user.id, req.user.schoolId, sectionId, subject.subjectId))) {
        throw createError('You are not assigned to this section and journal subject.', 403);
      }
      if (req.user.role === 'student') {
        const [enrollments] = await database.execute(
          'SELECT section_id FROM section_students WHERE section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL LIMIT 1',
          [sectionId, req.user.id]
        );
        if (!enrollments.length) throw createError('You are not enrolled in this section.', 403);
      }
      where.push('journal_prompts.section_id = ?');
      values.push(sectionId);
    }

    const [prompts] = await database.execute(
      `${promptsSelect()} WHERE ${where.join(' AND ')} ORDER BY journal_prompts.week_start_date DESC, journal_prompts.id DESC`,
      values
    );
    res.json({ journalPrompts: prompts.map(promptFields) });
  } catch (error) { next(error); }
}

async function createJournalPrompt(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('Only teachers can create journal prompts.', 403);
    const sectionId = parseId(req.body.sectionId, 'section ID');
    const gradingItemId = parseId(req.body.gradingItemId, 'grading item ID');
    const weekStartDate = dateOnly(req.body.weekStartDate, 'Week start');
    const promptText = text(req.body.promptText, 5000, 'Journal prompt', true);
    const opensAt = dateTime(req.body.opensAt, 'Opening time');
    const dueAt = dateTime(req.body.dueAt, 'Due time');
    const minWords = Number(req.body.minWords);
    const allowLate = req.body.allowLate === true;
    if (!Number.isInteger(minWords) || minWords < 1 || minWords > 2000) throw createError('Minimum words must be between 1 and 2000.');
    if (new Date(`${weekStartDate}T00:00:00Z`).getUTCDay() !== 1) throw createError('The journal week must start on a Monday.');
    if (new Date(dueAt) <= new Date(opensAt)) throw createError('The due time must be after the opening time.');

    await connection.beginTransaction();
    const subject = await getConfiguredJournalSubject(connection, req.user.schoolId);
    if (!(await teacherCanManageSection(connection, req.user.id, req.user.schoolId, sectionId, subject.subjectId))) {
      throw createError('You are not assigned to this section and journal subject.', 403);
    }
    await getGradingItem(connection, req, sectionId, subject.subjectId, gradingItemId);
    await connection.execute(
      `UPDATE journal_prompts SET prompt_status = 'closed'
      WHERE journal_subject_id = ? AND section_id = ? AND prompt_status = 'open' AND week_start_date < ?`,
      [subject.id, sectionId, weekStartDate]
    );
    const [result] = await connection.execute(
      `INSERT INTO journal_prompts (
        journal_subject_id, section_id, grading_item_id, week_start_date, prompt_text,
        opens_at, due_at, min_words, allow_late, prompt_status, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [subject.id, sectionId, gradingItemId, weekStartDate, promptText, opensAt, dueAt, minWords, allowLate, req.user.id]
    );
    const [prompts] = await connection.execute(`${promptsSelect()} WHERE journal_prompts.id = ? LIMIT 1`, [result.insertId]);
    await connection.commit();
    res.status(201).json({ journalPrompt: promptFields(prompts[0]) });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return next(createError('A journal prompt already exists for that section and week.', 409));
    next(error);
  } finally { connection.release(); }
}

async function updateJournalPrompt(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('Only teachers can update journal prompts.', 403);
    const promptId = parseId(req.params.promptId, 'journal prompt ID');
    await connection.beginTransaction();
    const subject = await getConfiguredJournalSubject(connection, req.user.schoolId);
    const [currentRows] = await connection.execute(
      `SELECT journal_prompts.id, journal_prompts.section_id AS sectionId,
        journal_prompts.grading_item_id AS gradingItemId, journal_prompts.prompt_status AS status
      FROM journal_prompts WHERE journal_prompts.id = ? AND journal_prompts.journal_subject_id = ?
      LIMIT 1 FOR UPDATE`,
      [promptId, subject.id]
    );
    const current = currentRows[0];
    if (!current) throw createError('Journal prompt was not found.', 404);
    if (current.status !== 'open') throw createError('A closed journal prompt cannot be edited.', 409);
    if (!(await teacherCanManageSection(connection, req.user.id, req.user.schoolId, current.sectionId, subject.subjectId))) {
      throw createError('You are not assigned to this section and journal subject.', 403);
    }
    const [[entryCount]] = await connection.execute('SELECT COUNT(*) AS total FROM student_journal_entries WHERE journal_prompt_id = ?', [promptId]);
    if (Number(entryCount.total) > 0) throw createError('This prompt already has submissions and can no longer be edited.', 409);

    const promptText = text(req.body.promptText, 5000, 'Journal prompt', true);
    const opensAt = dateTime(req.body.opensAt, 'Opening time');
    const dueAt = dateTime(req.body.dueAt, 'Due time');
    const minWords = Number(req.body.minWords);
    const allowLate = req.body.allowLate === true;
    const gradingItemId = parseId(req.body.gradingItemId, 'grading item ID');
    if (!Number.isInteger(minWords) || minWords < 1 || minWords > 2000) throw createError('Minimum words must be between 1 and 2000.');
    if (new Date(dueAt) <= new Date(opensAt)) throw createError('The due time must be after the opening time.');
    await getGradingItem(connection, req, current.sectionId, subject.subjectId, gradingItemId);
    await connection.execute(
      `UPDATE journal_prompts SET prompt_text = ?, opens_at = ?, due_at = ?, min_words = ?,
        allow_late = ?, grading_item_id = ? WHERE id = ?`,
      [promptText, opensAt, dueAt, minWords, allowLate, gradingItemId, promptId]
    );
    const [prompts] = await connection.execute(`${promptsSelect()} WHERE journal_prompts.id = ? LIMIT 1`, [promptId]);
    await connection.commit();
    res.json({ journalPrompt: promptFields(prompts[0]) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function listJournalEntries(req, res, next) {
  try {
    if (!['teacher', 'student'].includes(req.user.role) || !req.user.schoolId) throw createError('You do not have access to journals.', 403);
    const database = getDatabase();
    const subject = await getConfiguredJournalSubject(database, req.user.schoolId);
    const where = [
      'student_journal_entries.journal_subject_id = ?',
      'sections.school_id = ?'
    ];
    const values = [subject.id, req.user.schoolId];
    if (req.user.role === 'student') {
      where.push('student_journal_entries.student_user_id = ?');
      values.push(req.user.id);
    } else {
      where.push(`EXISTS (SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = student_journal_entries.section_id
          AND section_teachers.teacher_user_id = ? AND section_teachers.subject_id = ?)`);
      values.push(req.user.id, subject.subjectId);
    }
    if (req.query.sectionId) {
      const sectionId = parseId(req.query.sectionId, 'section ID');
      if (req.user.role === 'teacher' && !(await teacherCanManageSection(database, req.user.id, req.user.schoolId, sectionId, subject.subjectId))) {
        throw createError('You are not assigned to this section and journal subject.', 403);
      }
      if (req.user.role === 'student') {
        const [enrollments] = await database.execute(
          'SELECT section_id FROM section_students WHERE section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL LIMIT 1',
          [sectionId, req.user.id]
        );
        if (!enrollments.length) throw createError('You are not enrolled in this section.', 403);
      }
      where.push('student_journal_entries.section_id = ?');
      values.push(sectionId);
    }
    if (req.query.promptId) {
      where.push('student_journal_entries.journal_prompt_id = ?');
      values.push(parseId(req.query.promptId, 'journal prompt ID'));
    }
    const [entries] = await database.execute(
      `${entriesSelect()} WHERE ${where.join(' AND ')} ORDER BY student_journal_entries.submitted_at DESC, student_journal_entries.id DESC`,
      values
    );
    res.json({ entries: entries.map(entryFields) });
  } catch (error) { next(error); }
}

async function submitJournalEntry(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (req.user.role !== 'student' || !req.user.schoolId) throw createError('You do not have access to submit journals.', 403);
    const promptId = parseId(req.body.promptId, 'journal prompt ID');
    const entryText = text(req.body.entryText, 20000, 'Journal entry', true);
    await connection.beginTransaction();
    const subject = await getConfiguredJournalSubject(connection, req.user.schoolId);
    const [prompts] = await connection.execute(
      `SELECT journal_prompts.id, journal_prompts.section_id AS sectionId,
        journal_prompts.prompt_text AS promptText, journal_prompts.min_words AS minWords,
        journal_prompts.opens_at AS opensAt, journal_prompts.due_at AS dueAt,
        journal_prompts.allow_late AS allowLate, journal_prompts.prompt_status AS status
      FROM journal_prompts INNER JOIN sections ON sections.id = journal_prompts.section_id
      WHERE journal_prompts.id = ? AND journal_prompts.journal_subject_id = ?
        AND sections.school_id = ? AND sections.status = 'active' LIMIT 1 FOR UPDATE`,
      [promptId, subject.id, req.user.schoolId]
    );
    const prompt = prompts[0];
    if (!prompt || prompt.status !== 'open') throw createError('This journal prompt is no longer accepting entries.', 409);
    if (new Date(prompt.opensAt) > new Date()) throw createError('This journal prompt is not open yet.', 409);
    if (new Date(prompt.dueAt) < new Date() && !prompt.allowLate) throw createError('The submission deadline has passed.', 409);
    if (wordCount(entryText) < Number(prompt.minWords)) throw createError(`Your entry must contain at least ${prompt.minWords} words.`);
    const [enrollments] = await connection.execute(
      `SELECT sections.id FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id
      WHERE section_students.section_id = ? AND section_students.student_user_id = ?
        AND section_students.withdrawn_at IS NULL AND sections.school_id = ? AND sections.status = 'active'
      LIMIT 1`,
      [prompt.sectionId, req.user.id, req.user.schoolId]
    );
    if (!enrollments.length) throw createError('You are not enrolled in this section.', 403);
    const [result] = await connection.execute(
      `INSERT INTO student_journal_entries (
        journal_subject_id, student_user_id, section_id, journal_prompt_id,
        prompt_text, entry_text, entry_status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'submitted', NOW())`,
      [subject.id, req.user.id, prompt.sectionId, promptId, prompt.promptText, entryText]
    );
    const [entries] = await connection.execute(`${entriesSelect()} WHERE student_journal_entries.id = ? LIMIT 1`, [result.insertId]);
    await connection.commit();
    res.status(201).json({ entry: entryFields(entries[0]) });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return next(createError('You have already submitted an entry for this prompt.', 409));
    next(error);
  } finally { connection.release(); }
}

async function reviewJournalEntry(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('Only teachers can review journal entries.', 403);
    const entryId = parseId(req.params.entryId, 'journal entry ID');
    const score = Number(req.body.score);
    if (req.body.score === undefined || req.body.score === null || req.body.score === '' || !Number.isFinite(score) || score < 0) throw createError('Enter a valid score.');
    await connection.beginTransaction();
    const subject = await getConfiguredJournalSubject(connection, req.user.schoolId);
    const [rows] = await connection.execute(
      `SELECT student_journal_entries.id, student_journal_entries.student_user_id AS studentId,
        student_journal_entries.section_id AS sectionId,
        journal_prompts.grading_item_id AS gradingItemId
      FROM student_journal_entries
      INNER JOIN journal_prompts ON journal_prompts.id = student_journal_entries.journal_prompt_id
      WHERE student_journal_entries.id = ? AND student_journal_entries.journal_subject_id = ?
        AND journal_prompts.journal_subject_id = ? LIMIT 1 FOR UPDATE`,
      [entryId, subject.id, subject.id]
    );
    const entry = rows[0];
    if (!entry) throw createError('Journal entry was not found.', 404);
    if (!(await teacherCanManageSection(connection, req.user.id, req.user.schoolId, entry.sectionId, subject.subjectId))) {
      throw createError('You are not assigned to review this journal entry.', 403);
    }
    if (!entry.gradingItemId) throw createError('This journal prompt is not linked to a gradebook item.', 409);
    const studentScore = await upsertStudentScore(connection, req.user, entry.gradingItemId, entry.studentId, { score });
    await connection.execute("UPDATE student_journal_entries SET entry_status = 'reviewed' WHERE id = ?", [entryId]);
    const [updated] = await connection.execute(`${entriesSelect()} WHERE student_journal_entries.id = ? LIMIT 1`, [entryId]);
    await connection.commit();
    res.status(200).json({ entry: entryFields(updated[0]), studentScore });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function addJournalFeedback(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (req.user.role !== 'teacher' || !req.user.schoolId) throw createError('You do not have access to review journals.', 403);
    const entryId = parseId(req.params.entryId, 'journal entry ID');
    const feedbackText = text(req.body.feedbackText, 5000, 'Feedback', true);
    await connection.beginTransaction();
    const subject = await getConfiguredJournalSubject(connection, req.user.schoolId);
    const [entries] = await connection.execute(
      `SELECT student_journal_entries.id, student_journal_entries.section_id AS sectionId
      FROM student_journal_entries WHERE student_journal_entries.id = ?
        AND student_journal_entries.journal_subject_id = ? LIMIT 1 FOR UPDATE`,
      [entryId, subject.id]
    );
    const entry = entries[0];
    if (!entry) throw createError('Journal entry was not found.', 404);
    if (!(await teacherCanManageSection(connection, req.user.id, req.user.schoolId, entry.sectionId, subject.subjectId))) {
      throw createError('You are not assigned to review this journal entry.', 403);
    }
    await connection.execute(
      'INSERT INTO journal_feedback (journal_entry_id, teacher_user_id, feedback_text) VALUES (?, ?, ?)',
      [entryId, req.user.id, feedbackText]
    );
    await connection.execute("UPDATE student_journal_entries SET entry_status = 'reviewed' WHERE id = ?", [entryId]);
    const [updated] = await connection.execute(`${entriesSelect()} WHERE student_journal_entries.id = ? LIMIT 1`, [entryId]);
    await connection.commit();
    res.status(201).json({ entry: entryFields(updated[0]) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

module.exports = {
  addJournalFeedback,
  createJournalPrompt,
  listJournalEntries,
  listJournalPrompts,
  listJournalSections,
  listJournalSubjects,
  reviewJournalEntry,
  submitJournalEntry,
  updateJournalPrompt
};
