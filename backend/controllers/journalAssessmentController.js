const { getDatabase } = require('../config/database');
const { getConfiguredJournalSubject, teacherCanManageSection } = require('./journalsController');
const { manilaDate } = require('../services/aiReportUsage');
const { DEFAULT_CRITERIA, validateCriteria, jsonValue, generateJournalAssessment } = require('../services/journalAssessmentAi');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function entryId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) fail('Invalid journal entry ID.');
  return id;
}

async function access(database, user) {
  const subject = await getConfiguredJournalSubject(database, user.schoolId);
  const [[settings]] = await database.execute(
    'SELECT journal_ai_approved_at AS approvedAt FROM school_portal_features WHERE school_id = ? AND journals_enabled = TRUE',
    [user.schoolId]
  );
  return { subject, enabled: Boolean(settings?.approvedAt) && process.env.AI_JOURNAL_ASSESSMENT_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY) };
}

async function getRubric(req, res, next) {
  try {
    const database = getDatabase();
    const { subject, enabled } = await access(database, req.user);
    const [assignments] = await database.execute(
      'SELECT id FROM section_teachers WHERE school_id = ? AND teacher_user_id = ? AND subject_id = ? LIMIT 1',
      [req.user.schoolId, req.user.id, subject.subjectId]
    );
    const [[row]] = await database.execute(
      'SELECT criteria FROM journal_ai_rubrics WHERE school_id = ? AND teacher_user_id = ? AND journal_subject_id = ?',
      [req.user.schoolId, req.user.id, subject.id]
    );
    res.json({ enabled: enabled && Boolean(assignments.length), criteria: row ? jsonValue(row.criteria) : DEFAULT_CRITERIA });
  } catch (error) { next(error); }
}

async function saveRubric(req, res, next) {
  try {
    const criteria = validateCriteria(req.body?.criteria);
    const database = getDatabase();
    const { subject, enabled } = await access(database, req.user);
    if (!enabled) fail('Journal AI assessment is not enabled for this school.', 403);
    const [assignments] = await database.execute(
      'SELECT id FROM section_teachers WHERE school_id = ? AND teacher_user_id = ? AND subject_id = ? LIMIT 1',
      [req.user.schoolId, req.user.id, subject.subjectId]
    );
    if (!assignments.length) fail('You are not assigned to this journal subject.', 403);
    await database.execute(
      `INSERT INTO journal_ai_rubrics (school_id, teacher_user_id, journal_subject_id, criteria)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE criteria = VALUES(criteria)`,
      [req.user.schoolId, req.user.id, subject.id, JSON.stringify(criteria)]
    );
    res.json({ criteria });
  } catch (error) { next(error); }
}

async function visibleEntry(database, user, id, subject) {
  const [rows] = await database.execute(
    `SELECT entries.id, entries.section_id AS sectionId, entries.prompt_text AS promptText,
      entries.entry_text AS entryText, items.max_score AS maxScore
     FROM student_journal_entries AS entries
     INNER JOIN journal_prompts AS prompts ON prompts.id = entries.journal_prompt_id AND prompts.school_id = entries.school_id
     INNER JOIN grading_items AS items ON items.id = prompts.grading_item_id AND items.school_id = entries.school_id
     WHERE entries.id = ? AND entries.school_id = ? AND entries.journal_subject_id = ?
       AND prompts.created_by_user_id = ? AND prompts.journal_subject_id = ? LIMIT 1`,
    [id, user.schoolId, subject.id, user.id, subject.id]
  );
  const entry = rows[0];
  if (!entry) fail('Journal entry was not found.', 404);
  if (!(await teacherCanManageSection(database, user.id, user.schoolId, entry.sectionId, subject.subjectId))) {
    fail('You are not assigned to review this journal entry.', 403);
  }
  return entry;
}

function assessmentFields(row) {
  if (!row) return null;
  return {
    id: row.id, criteria: jsonValue(row.rubric_snapshot), scores: jsonValue(row.criterion_scores),
    suggestedScore: Number(row.suggested_score), maxScore: Number(row.max_score_snapshot),
    feedback: row.feedback, assessedAt: row.created_at
  };
}

async function getAssessment(req, res, next) {
  try {
    const database = getDatabase();
    const { subject, enabled } = await access(database, req.user);
    if (!enabled) fail('Journal AI assessment is not enabled for this school.', 403);
    const id = entryId(req.params.entryId);
    await visibleEntry(database, req.user, id, subject);
    const [[row]] = await database.execute(
      'SELECT * FROM journal_ai_assessments WHERE school_id = ? AND journal_entry_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.schoolId, id]
    );
    res.json({ assessment: assessmentFields(row) });
  } catch (error) { next(error); }
}

async function assessEntry(req, res, next) {
  try {
    const database = getDatabase();
    const { subject, enabled } = await access(database, req.user);
    if (!enabled) fail('Journal AI assessment is not enabled for this school.', 403);
    const id = entryId(req.params.entryId);
    const entry = await visibleEntry(database, req.user, id, subject);
    const maxScore = Number(entry.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0) fail('The linked gradebook item has an invalid maximum score.', 409);
    const [[rubric]] = await database.execute(
      'SELECT criteria FROM journal_ai_rubrics WHERE school_id = ? AND teacher_user_id = ? AND journal_subject_id = ?',
      [req.user.schoolId, req.user.id, subject.id]
    );
    const criteria = validateCriteria(rubric ? jsonValue(rubric.criteria) : DEFAULT_CRITERIA);
    const limit = Number(process.env.AI_JOURNAL_DAILY_CALL_LIMIT || 100);
    if (!Number.isSafeInteger(limit) || limit < 1) fail('Journal AI assessment is unavailable right now.', 503);
    const date = manilaDate();
    await database.execute(
      'INSERT INTO journal_ai_daily_usage (school_id, usage_date) VALUES (?, ?) ON DUPLICATE KEY UPDATE school_id = school_id',
      [req.user.schoolId, date]
    );
    const [reserved] = await database.execute(
      'UPDATE journal_ai_daily_usage SET call_count = call_count + 1 WHERE school_id = ? AND usage_date = ? AND call_count < ?',
      [req.user.schoolId, date, limit]
    );
    if (!reserved.affectedRows) fail('This school has reached today’s journal AI limit. Try again tomorrow.', 429);
    const result = await generateJournalAssessment({ promptText: entry.promptText, entryText: entry.entryText, criteria });
    const total = criteria.reduce((sum, item) => sum + item.points, 0);
    const suggestedScore = Math.round(result.scores.reduce((sum, score) => sum + score, 0) / total * maxScore * 100) / 100;
    const [inserted] = await database.execute(
      `INSERT INTO journal_ai_assessments (school_id, journal_entry_id, assessed_by_user_id,
        rubric_snapshot, criterion_scores, suggested_score, max_score_snapshot, feedback, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.schoolId, id, req.user.id, JSON.stringify(criteria), JSON.stringify(result.scores),
        suggestedScore, maxScore, result.feedback, result.model]
    );
    await database.execute(
      'UPDATE journal_ai_daily_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE school_id = ? AND usage_date = ?',
      [result.inputTokens, result.outputTokens, req.user.schoolId, date]
    );
    res.status(201).json({ assessment: {
      id: inserted.insertId, criteria, scores: result.scores, suggestedScore, maxScore,
      feedback: result.feedback
    } });
  } catch (error) { next(error); }
}

module.exports = { getRubric, saveRubric, getAssessment, assessEntry };
