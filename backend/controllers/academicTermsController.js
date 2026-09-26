const { getDatabase } = require('../config/database');

const PERIOD_COUNTS = { quarterly: 4, semestral: 2, trimestral: 3 };
const YEAR_STATUSES = new Set(['upcoming', 'active', 'closed']);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requiredText(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

function date(value, label) {
  const result = String(value || '');
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw createError(`${label} must be a valid date.`);
  }
  return result;
}

function ensureDateRange(startDate, endDate, label = 'The end date') {
  if (startDate >= endDate) throw createError(`${label} must be after the start date.`);
}

async function getOwnedYear(schoolId, yearId, connection = getDatabase()) {
  const [rows] = await connection.execute(
    'SELECT id, school_id AS schoolId, label, start_date AS startDate, end_date AS endDate, status FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1',
    [yearId, schoolId]
  );
  return rows[0] || null;
}

async function getOwnedLevel(schoolId, levelId, connection = getDatabase()) {
  const [rows] = await connection.execute(
    'SELECT id, grading_period_type AS gradingPeriodType, is_enabled AS isEnabled FROM school_levels WHERE id = ? AND school_id = ? LIMIT 1',
    [levelId, schoolId]
  );
  return rows[0] || null;
}

async function getOwnedTerm(schoolId, termId, connection = getDatabase()) {
  const [rows] = await connection.execute(
    `SELECT academic_terms.id, academic_terms.academic_year_id AS academicYearId,
      academic_terms.school_level_id AS schoolLevelId, academic_terms.name,
      academic_terms.sequence_number AS sequenceNumber, academic_terms.planned_start_date AS plannedStartDate,
      academic_terms.planned_end_date AS plannedEndDate, academic_terms.status,
      academic_terms.activated_at AS activatedAt, academic_terms.completed_at AS completedAt,
      academic_years.school_id AS schoolId, academic_years.label AS academicYearLabel,
      academic_years.start_date AS academicYearStartDate, academic_years.end_date AS academicYearEndDate,
      academic_years.status AS academicYearStatus, school_levels.display_name AS schoolLevelName,
      school_levels.grading_period_type AS gradingPeriodType
    FROM academic_terms
    INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
    INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
    WHERE academic_terms.id = ? AND academic_years.school_id = ? LIMIT 1`,
    [termId, schoolId]
  );
  return rows[0] || null;
}

function validateTermPayload(body) {
  const academicYearId = parseId(body.academicYearId);
  const schoolLevelId = parseId(body.schoolLevelId);
  const sequenceNumber = Number.parseInt(body.sequenceNumber, 10);
  if (!academicYearId || !schoolLevelId || !Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw createError('Academic year, school level, and sequence number are required.');
  }
  const plannedStartDate = date(body.plannedStartDate, 'Planned start date');
  const plannedEndDate = date(body.plannedEndDate, 'Planned end date');
  ensureDateRange(plannedStartDate, plannedEndDate);
  return { academicYearId, schoolLevelId, sequenceNumber, plannedStartDate, plannedEndDate, name: requiredText(body.name, 80, 'Term name') };
}

async function listAcademicYears(req, res, next) {
  try {
    const database = getDatabase();
    const [years] = await database.execute(
      'SELECT id, label, start_date AS startDate, end_date AS endDate, status, created_at AS createdAt, updated_at AS updatedAt FROM academic_years WHERE school_id = ? ORDER BY start_date DESC',
      [req.user.schoolId]
    );
    res.json({ academicYears: years });
  } catch (error) { next(error); }
}

async function createAcademicYear(req, res, next) {
  try {
    const database = getDatabase();
    const label = requiredText(req.body.label, 30, 'Academic-year label');
    const startDate = date(req.body.startDate, 'Start date');
    const endDate = date(req.body.endDate, 'End date');
    ensureDateRange(startDate, endDate);
    const status = req.body.status || 'upcoming';
    if (!YEAR_STATUSES.has(status)) throw createError('Academic-year status is invalid.');
    if (status === 'active') {
      const [active] = await database.execute('SELECT id FROM academic_years WHERE school_id = ? AND status = \'active\' LIMIT 1', [req.user.schoolId]);
      if (active.length) throw createError('Close the current academic year before activating another one.', 409);
    }
    const [result] = await database.execute(
      'INSERT INTO academic_years (school_id, label, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
      [req.user.schoolId, label, startDate, endDate, status]
    );
    const year = await getOwnedYear(req.user.schoolId, result.insertId);
    res.status(201).json({ academicYear: year });
  } catch (error) { next(error); }
}

async function updateAcademicYear(req, res, next) {
  try {
    const database = getDatabase();
    const yearId = parseId(req.params.yearId);
    const current = yearId && await getOwnedYear(req.user.schoolId, yearId);
    if (!current) throw createError('Academic year was not found.', 404);
    if (current.status === 'closed') throw createError('A closed academic year cannot be changed.', 409);
    const label = req.body.label === undefined ? current.label : requiredText(req.body.label, 30, 'Academic-year label');
    const startDate = req.body.startDate === undefined ? current.startDate : date(req.body.startDate, 'Start date');
    const endDate = req.body.endDate === undefined ? current.endDate : date(req.body.endDate, 'End date');
    ensureDateRange(startDate, endDate);
    const status = req.body.status === undefined ? current.status : req.body.status;
    if (!YEAR_STATUSES.has(status)) throw createError('Academic-year status is invalid.');
    if (status === 'active' && current.status !== 'active') {
      const [active] = await database.execute('SELECT id FROM academic_years WHERE school_id = ? AND status = \'active\' AND id <> ? LIMIT 1', [req.user.schoolId, yearId]);
      if (active.length) throw createError('Close the current academic year before activating another one.', 409);
    }
    if (status !== current.status && (status === 'closed' || current.status === 'active')) {
      const [activeTerms] = await database.execute(
        'SELECT id FROM academic_terms WHERE academic_year_id = ? AND status = \'active\' LIMIT 1',
        [yearId]
      );
      if (activeTerms.length) throw createError('Complete every active term before changing the academic-year status.', 409);
    }
    await database.execute('UPDATE academic_years SET label = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?', [label, startDate, endDate, status, yearId]);
    res.json({ academicYear: await getOwnedYear(req.user.schoolId, yearId) });
  } catch (error) { next(error); }
}

async function listAcademicTerms(req, res, next) {
  try {
    const database = getDatabase();
    const filters = ['academic_years.school_id = ?'];
    const values = [req.user.schoolId];
    const yearId = req.query.academicYearId && parseId(req.query.academicYearId);
    const levelId = req.query.schoolLevelId && parseId(req.query.schoolLevelId);
    if (req.query.academicYearId && !yearId || req.query.schoolLevelId && !levelId) throw createError('A term filter is invalid.');
    if (yearId) { filters.push('academic_terms.academic_year_id = ?'); values.push(yearId); }
    if (levelId) { filters.push('academic_terms.school_level_id = ?'); values.push(levelId); }
    if (req.query.status) {
      if (!['upcoming', 'active', 'closed'].includes(req.query.status)) throw createError('Term status is invalid.');
      filters.push('academic_terms.status = ?'); values.push(req.query.status);
    }
    const [terms] = await database.execute(
      `SELECT academic_terms.id, academic_terms.academic_year_id AS academicYearId, academic_terms.school_level_id AS schoolLevelId,
        academic_terms.name, academic_terms.sequence_number AS sequenceNumber, academic_terms.planned_start_date AS plannedStartDate,
        academic_terms.planned_end_date AS plannedEndDate, academic_terms.status, academic_terms.activated_at AS activatedAt,
        academic_terms.completed_at AS completedAt, academic_years.label AS academicYearLabel, school_levels.display_name AS schoolLevelName,
        school_levels.grading_period_type AS gradingPeriodType
      FROM academic_terms INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
      INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
      WHERE ${filters.join(' AND ')} ORDER BY academic_years.start_date DESC, school_levels.id, academic_terms.sequence_number`, values
    );
    res.json({ academicTerms: terms });
  } catch (error) { next(error); }
}

async function getAcademicTerm(req, res, next) {
  try {
    const database = getDatabase();
    const termId = parseId(req.params.termId);
    const term = termId && await getOwnedTerm(req.user.schoolId, termId);
    if (!term) throw createError('Academic term was not found.', 404);
    const [actions] = await database.execute(
      `SELECT academic_term_actions.id, academic_term_actions.action_type AS actionType,
        academic_term_actions.previous_end_date AS previousEndDate, academic_term_actions.new_end_date AS newEndDate,
        academic_term_actions.reason, academic_term_actions.performed_at AS performedAt,
        users.display_name AS performedByName
      FROM academic_term_actions INNER JOIN users ON users.id = academic_term_actions.performed_by_user_id
      WHERE academic_term_actions.academic_term_id = ? ORDER BY academic_term_actions.performed_at DESC`, [termId]
    );
    res.json({ academicTerm: term, actions });
  } catch (error) { next(error); }
}

async function createAcademicTerm(req, res, next) {
  try {
    const database = getDatabase();
    const data = validateTermPayload(req.body);
    const year = await getOwnedYear(req.user.schoolId, data.academicYearId);
    const level = await getOwnedLevel(req.user.schoolId, data.schoolLevelId);
    if (!year || !level) throw createError('Academic year or school level was not found.', 404);
    if (!level.isEnabled) throw createError('Enable the school level before configuring its terms.', 409);
    if (data.plannedStartDate < year.startDate || data.plannedEndDate > year.endDate) throw createError('Term dates must be inside the academic year.');
    if (data.sequenceNumber > PERIOD_COUNTS[level.gradingPeriodType]) throw createError(`This school level allows ${PERIOD_COUNTS[level.gradingPeriodType]} term(s).`);
    const [result] = await database.execute(
      'INSERT INTO academic_terms (academic_year_id, school_level_id, name, sequence_number, planned_start_date, planned_end_date) VALUES (?, ?, ?, ?, ?, ?)',
      [data.academicYearId, data.schoolLevelId, data.name, data.sequenceNumber, data.plannedStartDate, data.plannedEndDate]
    );
    res.status(201).json({ academicTerm: await getOwnedTerm(req.user.schoolId, result.insertId) });
  } catch (error) { next(error); }
}

async function updateAcademicTerm(req, res, next) {
  try {
    const database = getDatabase();
    const termId = parseId(req.params.termId);
    const current = termId && await getOwnedTerm(req.user.schoolId, termId);
    if (!current) throw createError('Academic term was not found.', 404);
    if (current.status !== 'upcoming') throw createError('Only an upcoming term can be edited. Use the term actions after activation.', 409);
    const name = req.body.name === undefined ? current.name : requiredText(req.body.name, 80, 'Term name');
    const plannedStartDate = req.body.plannedStartDate === undefined ? current.plannedStartDate : date(req.body.plannedStartDate, 'Planned start date');
    const plannedEndDate = req.body.plannedEndDate === undefined ? current.plannedEndDate : date(req.body.plannedEndDate, 'Planned end date');
    ensureDateRange(plannedStartDate, plannedEndDate);
    if (plannedStartDate < current.academicYearStartDate || plannedEndDate > current.academicYearEndDate) throw createError('Term dates must be inside the academic year.');
    await database.execute('UPDATE academic_terms SET name = ?, planned_start_date = ?, planned_end_date = ? WHERE id = ?', [name, plannedStartDate, plannedEndDate, termId]);
    res.json({ academicTerm: await getOwnedTerm(req.user.schoolId, termId) });
  } catch (error) { next(error); }
}

async function termAction(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    const termId = parseId(req.params.termId);
    if (!termId) throw createError('Academic term was not found.', 404);
    await connection.beginTransaction();
    const term = await getOwnedTerm(req.user.schoolId, termId, connection);
    if (!term) throw createError('Academic term was not found.', 404);
    const action = req.params.action;
    if (action === 'activate') {
      if (term.status !== 'upcoming' || term.academicYearStatus !== 'active') throw createError('Only an upcoming term in the active academic year can be activated.', 409);
      const [active] = await connection.execute('SELECT id FROM academic_terms WHERE academic_year_id = ? AND school_level_id = ? AND status = \'active\' AND id <> ? FOR UPDATE', [term.academicYearId, term.schoolLevelId, termId]);
      const [unfinished] = await connection.execute('SELECT id FROM academic_terms WHERE academic_year_id = ? AND school_level_id = ? AND sequence_number < ? AND status <> \'closed\' FOR UPDATE', [term.academicYearId, term.schoolLevelId, term.sequenceNumber]);
      if (active.length || unfinished.length) throw createError('Complete the current and earlier terms before activating this one.', 409);
      await connection.execute('UPDATE academic_terms SET status = \'active\', activated_at = NOW() WHERE id = ?', [termId]);
      await connection.execute('INSERT INTO academic_term_actions (academic_term_id, action_type, performed_by_user_id) VALUES (?, \'activated\', ?)', [termId, req.user.id]);
    } else if (action === 'complete') {
      if (term.status !== 'active') throw createError('Only the active term can be completed.', 409);
      await connection.execute('UPDATE academic_terms SET status = \'closed\', completed_at = NOW() WHERE id = ?', [termId]);
      await connection.execute('INSERT INTO academic_term_actions (academic_term_id, action_type, performed_by_user_id) VALUES (?, \'completed\', ?)', [termId, req.user.id]);
    } else if (action === 'extend') {
      if (term.status !== 'active') throw createError('Only the active term can be extended.', 409);
      const newEndDate = date(req.body.newEndDate, 'New end date');
      const reason = requiredText(req.body.reason, 2000, 'Reason for extension');
      if (newEndDate <= term.plannedEndDate) throw createError('The new end date must be after the current end date.');
      if (newEndDate > term.academicYearEndDate) throw createError('The new end date must be inside the academic year.');
      await connection.execute('UPDATE academic_terms SET planned_end_date = ? WHERE id = ?', [newEndDate, termId]);
      await connection.execute('INSERT INTO academic_term_actions (academic_term_id, action_type, previous_end_date, new_end_date, reason, performed_by_user_id) VALUES (?, \'extended\', ?, ?, ?, ?)', [termId, term.plannedEndDate, newEndDate, reason, req.user.id]);
    } else { throw createError('Term action is invalid.'); }
    await connection.commit();
    res.json({ academicTerm: await getOwnedTerm(req.user.schoolId, termId, connection) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

function validateCategories(categories) {
  if (!Array.isArray(categories) || !categories.length) throw createError('Add at least one grading category.');
  const codes = new Set();
  const normalized = categories.map(category => {
    const code = requiredText(category.code, 30, 'Category code').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(code) || codes.has(code)) throw createError('Category codes must be unique and use letters, numbers, or hyphens.');
    codes.add(code);
    const weight = Number(category.weight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) throw createError('Each category weight must be between 0 and 100.');
    return { id: category.id === undefined ? null : parseId(category.id), code, name: requiredText(category.name, 100, 'Category name'), weight: Math.round(weight * 100) / 100 };
  });
  if (normalized.some(category => category.id === null && categories.find(item => item.id !== undefined && !parseId(item.id)))) throw createError('A category identifier is invalid.');
  if (Math.round(normalized.reduce((sum, category) => sum + category.weight, 0) * 100) !== 10000) throw createError('Category weights must total 100%.');
  return normalized;
}

async function listGradingCategories(req, res, next) {
  try {
    const database = getDatabase();
    const levelId = req.query.schoolLevelId && parseId(req.query.schoolLevelId);
    if (req.query.schoolLevelId && !levelId) throw createError('School level is invalid.');
    const values = [req.user.schoolId];
    let filter = 'grading_categories.school_id = ?';
    if (levelId) { filter += ' AND grading_categories.school_level_id = ?'; values.push(levelId); }
    const [categories] = await database.execute(
      `SELECT grading_categories.id, grading_categories.school_level_id AS schoolLevelId, grading_categories.code,
        grading_categories.name, grading_categories.weight, school_levels.display_name AS schoolLevelName
      FROM grading_categories INNER JOIN school_levels ON school_levels.id = grading_categories.school_level_id
      WHERE ${filter} ORDER BY school_levels.id, grading_categories.code`, values
    );
    res.json({ gradingCategories: categories });
  } catch (error) { next(error); }
}

async function updateGradingCategories(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    const schoolLevelId = parseId(req.body.schoolLevelId);
    if (!schoolLevelId) throw createError('School level is required.');
    const categories = validateCategories(req.body.categories);
    const level = await getOwnedLevel(req.user.schoolId, schoolLevelId, connection);
    if (!level) throw createError('School level was not found.', 404);
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM grading_categories WHERE school_id = ? AND school_level_id = ? FOR UPDATE', [req.user.schoolId, schoolLevelId]);
    const existingIds = new Set(existing.map(category => category.id));
    if (categories.some(category => category.id && !existingIds.has(category.id))) throw createError('A grading category was not found.', 404);
    const requestedIds = new Set(categories.filter(category => category.id).map(category => category.id));
    for (const existingId of existingIds) {
      if (requestedIds.has(existingId)) continue;
      const [[usage]] = await connection.execute('SELECT (SELECT COUNT(*) FROM assignments WHERE grading_category_id = ?) + (SELECT COUNT(*) FROM grading_items WHERE grading_category_id = ?) AS total', [existingId, existingId]);
      if (usage.total) throw createError('A category with recorded work cannot be removed.', 409);
      await connection.execute('DELETE FROM grading_categories WHERE id = ?', [existingId]);
    }
    for (const category of categories) {
      if (category.id) await connection.execute('UPDATE grading_categories SET code = ?, name = ?, weight = ? WHERE id = ?', [category.code, category.name, category.weight, category.id]);
      else await connection.execute('INSERT INTO grading_categories (school_id, school_level_id, code, name, weight) VALUES (?, ?, ?, ?, ?)', [req.user.schoolId, schoolLevelId, category.code, category.name, category.weight]);
    }
    await connection.commit();
    const [saved] = await connection.execute('SELECT id, school_level_id AS schoolLevelId, code, name, weight FROM grading_categories WHERE school_id = ? AND school_level_id = ? ORDER BY code', [req.user.schoolId, schoolLevelId]);
    res.json({ gradingCategories: saved });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

module.exports = {
  createAcademicTerm,
  createAcademicYear,
  getAcademicTerm,
  listAcademicTerms,
  listAcademicYears,
  listGradingCategories,
  termAction,
  updateAcademicTerm,
  updateAcademicYear,
  updateGradingCategories
};
