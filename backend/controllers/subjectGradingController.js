const { getDatabase } = require('../config/database');
const {
  createDepedK10DefaultComponents,
  getDepedK10GradeMethod,
  getDepedK10LearningArea,
  isDepedEarlyNumericalGradeCode,
  isDepedK10GradeCode,
  isDepedNumericalGradeCode
} = require('../config/depedK10Grading');
const { writeAuditLog } = require('../utils/auditLog');
const { GRADING_MODES, ROUNDING_RULES, loadK10FinalGradeRules } = require('../utils/k10FinalGradeRules');

const COMPONENT_TYPES = new Set(['written', 'performance', 'examination', 'other']);
const K10_PROFILE_GRADE_CODES = ['grade-4', 'grade-5', 'grade-6', 'grade-7', 'grade-8', 'grade-9', 'grade-10'];

function isProfileGradeCode(gradeCode, academicYearLabel) {
  return isDepedK10GradeCode(gradeCode)
    || (isDepedEarlyNumericalGradeCode(gradeCode)
      && getDepedK10GradeMethod(academicYearLabel) === 'deped_2026_transmutation');
}

async function getProfileGradeScopes(connection, schoolId, schoolLevelId, subjectId) {
  const [rows] = await connection.execute(
    `SELECT grades.grade_code AS gradeCode FROM subject_grade_scopes AS scopes
    INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id AND grades.school_id = scopes.school_id
    WHERE scopes.school_id = ? AND scopes.subject_id = ? AND grades.school_level_id = ?`,
    [schoolId, subjectId, schoolLevelId]
  );
  return rows;
}

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`${label} is invalid.`);
  return id;
}

function requiredText(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

function validateWeightedSet(values, label) {
  if (!values.length) throw createError(`Add at least one ${label.toLowerCase()}.`);
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  if (Math.round(total * 100) !== 10000) throw createError(`${label} weights must total 100%.`);
}

function normalizeComponents(rawComponents) {
  if (!Array.isArray(rawComponents)) throw createError('Subject grading components are required.');
  const componentCodes = new Set();
  const partCodes = new Set();
  const components = rawComponents.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError('Each grading component must be an object.');
    const code = requiredText(raw.code, 50, 'Component code').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(code) || componentCodes.has(code)) {
      throw createError('Component codes must be unique and use lowercase letters, numbers, or hyphens.');
    }
    componentCodes.add(code);
    if (!COMPONENT_TYPES.has(raw.componentType)) throw createError('Select a valid assessment component type.');
    const weight = Number(raw.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) throw createError('Component weights must be between 0 and 100.');
    const rawExamParts = raw.examParts ?? [];
    if (!Array.isArray(rawExamParts)) throw createError('Exam parts must be provided as a list.');
    const examParts = rawExamParts.map((part, partIndex) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) throw createError('Each exam part must be an object.');
      const partCode = requiredText(part.code, 50, 'Exam-part code').toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(partCode) || partCodes.has(`${code}:${partCode}`)) {
        throw createError('Exam-part codes must be unique within their component.');
      }
      partCodes.add(`${code}:${partCode}`);
      const partWeight = Number(part.weight);
      if (!Number.isFinite(partWeight) || partWeight < 0 || partWeight > 100) throw createError('Exam-part weights must be between 0 and 100.');
      return {
        id: part.id == null ? null : parseId(part.id, 'Exam part'),
        code: partCode,
        name: requiredText(part.name, 120, 'Exam-part name'),
        weight: Math.round(partWeight * 100) / 100,
        sortOrder: partIndex + 1
      };
    });
    if (raw.componentType === 'examination') validateWeightedSet(examParts, 'Exam-part');
    else if (examParts.length) throw createError('Exam parts can only be added to an Examinations component.');
    return {
      id: raw.id == null ? null : parseId(raw.id, 'Grading component'),
      code,
      name: requiredText(raw.name, 120, 'Component name'),
      componentType: raw.componentType,
      weight: Math.round(weight * 100) / 100,
      sortOrder: index + 1,
      examParts
    };
  });
  validateWeightedSet(components, 'Component');
  return components;
}

async function getYearAndLevel(connection, schoolId, academicYearId, schoolLevelId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT academic_years.id AS academicYearId, academic_years.label AS academicYearLabel,
      academic_years.start_date AS startDate, academic_years.status AS academicYearStatus,
      school_levels.id AS schoolLevelId,
      school_levels.level_code AS levelCode, school_levels.grading_period_type AS gradingPeriodType
    FROM academic_years INNER JOIN school_levels ON school_levels.id = ? AND school_levels.school_id = academic_years.school_id
    WHERE academic_years.id = ? AND academic_years.school_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [schoolLevelId, academicYearId, schoolId]
  );
  return rows[0] || null;
}

async function getSubjectsForK10(connection, schoolId, levelId, academicYearLabel) {
  const allowedGradeCodes = [...K10_PROFILE_GRADE_CODES];
  if (getDepedK10GradeMethod(academicYearLabel) === 'deped_2026_transmutation') {
    allowedGradeCodes.push('grade-2', 'grade-3');
  }
  const [subjects] = await connection.execute(
    `SELECT subjects.id, subjects.subject_code AS subjectCode, subjects.name,
      GROUP_CONCAT(DISTINCT enabled_grades.grade_code ORDER BY enabled_grades.sort_order SEPARATOR ',') AS gradeCodes
    FROM subjects
    LEFT JOIN subject_grade_scopes AS scopes ON scopes.school_id = subjects.school_id AND scopes.subject_id = subjects.id
    LEFT JOIN school_grade_levels AS enabled_grades ON enabled_grades.school_id = scopes.school_id
      AND enabled_grades.id = scopes.grade_level_id AND enabled_grades.is_enabled = TRUE
      AND enabled_grades.grade_code IN (${allowedGradeCodes.map(() => '?').join(',')})
    WHERE subjects.school_id = ? AND subjects.is_active = TRUE
      AND (subjects.school_level_id = ? OR subjects.school_level_id IS NULL)
      AND enabled_grades.id IS NOT NULL
    GROUP BY subjects.id, subjects.subject_code, subjects.name
    ORDER BY subjects.name, subjects.id`,
    [...allowedGradeCodes, schoolId, levelId]
  );
  return subjects.map(subject => ({
    id: Number(subject.id),
    subjectCode: subject.subjectCode,
    name: subject.name,
    gradeCodes: String(subject.gradeCodes || '').split(',').filter(code => isProfileGradeCode(code, academicYearLabel)),
    learningArea: getDepedK10LearningArea(subject.subjectCode)
  }));
}

async function getProfile(connection, schoolId, academicYearId, schoolLevelId, subjectId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id, school_id AS schoolId, academic_year_id AS academicYearId,
      school_level_id AS schoolLevelId, subject_id AS subjectId,
      configuration_source AS configurationSource, copied_from_profile_id AS copiedFromProfileId
    FROM subject_grading_profiles
    WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ? AND subject_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, academicYearId, schoolLevelId, subjectId]
  );
  return rows[0] || null;
}

async function getProfileComponents(connection, schoolId, profileId) {
  const [components] = await connection.execute(
    `SELECT id, code, name, component_type AS componentType, weight, sort_order AS sortOrder
    FROM subject_grading_components WHERE school_id = ? AND profile_id = ? ORDER BY sort_order, id`,
    [schoolId, profileId]
  );
  const result = components.map(component => ({ ...component, id: Number(component.id), weight: Number(component.weight), examParts: [] }));
  if (!result.length) return result;
  const ids = result.map(component => component.id);
  const placeholders = ids.map(() => '?').join(',');
  const [parts] = await connection.execute(
    `SELECT id, component_id AS componentId, code, name, weight, sort_order AS sortOrder
    FROM subject_grading_exam_parts WHERE school_id = ? AND component_id IN (${placeholders}) ORDER BY sort_order, id`,
    [schoolId, ...ids]
  );
  const byId = new Map(result.map(component => [component.id, component]));
  parts.forEach(part => byId.get(Number(part.componentId))?.examParts.push({
    id: Number(part.id), code: part.code, name: part.name, weight: Number(part.weight), sortOrder: Number(part.sortOrder)
  }));
  return result;
}

async function insertProfile(connection, { schoolId, academicYearId, schoolLevelId, subjectId, source, copiedFromProfileId = null }, components) {
  const [result] = await connection.execute(
    `INSERT INTO subject_grading_profiles
      (school_id, academic_year_id, school_level_id, subject_id, configuration_source, copied_from_profile_id)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [schoolId, academicYearId, schoolLevelId, subjectId, source, copiedFromProfileId]
  );
  const profileId = Number(result.insertId);
  for (const component of components) {
    const [inserted] = await connection.execute(
      `INSERT INTO subject_grading_components
        (school_id, profile_id, code, name, component_type, weight, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, profileId, component.code, component.name, component.componentType, component.weight, component.sortOrder]
    );
    for (const part of component.examParts || []) {
      await connection.execute(
        `INSERT INTO subject_grading_exam_parts
          (school_id, component_id, code, name, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [schoolId, inserted.insertId, part.code, part.name, part.weight, part.sortOrder]
      );
    }
  }
  return profileId;
}

async function isProfileLocked(connection, schoolId, academicYearId, schoolLevelId, subjectId) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS gradeCount FROM published_final_grades AS grades
    INNER JOIN sections ON sections.id = grades.section_id AND sections.school_id = grades.school_id
    WHERE grades.school_id = ? AND sections.academic_year_id = ? AND sections.school_level_id = ? AND grades.subject_id = ?`,
    [schoolId, academicYearId, schoolLevelId, subjectId]
  );
  return Number(row?.gradeCount || 0) > 0;
}

async function getPreviewData(connection, schoolId, academicYearId, schoolLevelId) {
  const year = await getYearAndLevel(connection, schoolId, academicYearId, schoolLevelId);
  if (!year) throw createError('Academic year or school level was not found.', 404);
  if (!['elementary', 'jhs'].includes(year.levelCode)) throw createError('DepEd subject weights are available for Elementary and Junior High School.', 409);
  const finalGradeRules = await loadK10FinalGradeRules(connection, {
    schoolId, academicYearId, schoolLevelId,
    academicYearLabel: year.academicYearLabel,
    gradingPeriodType: year.gradingPeriodType
  });
  const subjects = await getSubjectsForK10(connection, schoolId, schoolLevelId, year.academicYearLabel);
  const result = [];
  for (const subject of subjects) {
    const profile = await getProfile(connection, schoolId, academicYearId, schoolLevelId, subject.id);
    const locked = await isProfileLocked(connection, schoolId, academicYearId, schoolLevelId, subject.id);
    const defaults = createDepedK10DefaultComponents(subject.subjectCode);
    result.push({
      ...subject,
      status: locked ? 'published' : profile ? 'configured' : defaults ? 'ready' : 'unmatched',
      configurationSource: profile?.configurationSource || null,
      components: profile ? await getProfileComponents(connection, schoolId, profile.id) : defaults || [],
      defaultComponents: defaults || []
    });
  }
  return {
    academicYearId,
    academicYearLabel: year.academicYearLabel,
    schoolLevelId,
    schoolLevelCode: year.levelCode,
    gradingPeriodType: year.gradingPeriodType,
    ...finalGradeRules,
    subjects: result
  };
}

async function previewDepedDefaults(req, res, next) {
  try {
    if (req.user.role !== 'school_admin') throw createError('Only School Admin can manage grading rules.', 403);
    const academicYearId = parseId(req.query.academicYearId, 'Academic year');
    const schoolLevelId = parseId(req.query.schoolLevelId, 'School level');
    res.json(await getPreviewData(getDatabase(), req.user.schoolId, academicYearId, schoolLevelId));
  } catch (error) { next(error); }
}

async function applyDepedDefaults(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    if (req.user.role !== 'school_admin') throw createError('Only School Admin can manage grading rules.', 403);
    const academicYearId = parseId(req.body.academicYearId, 'Academic year');
    const schoolLevelId = parseId(req.body.schoolLevelId, 'School level');
    await connection.beginTransaction();
    transactionStarted = true;
    const year = await getYearAndLevel(connection, req.user.schoolId, academicYearId, schoolLevelId, true);
    if (!year) throw createError('Academic year or school level was not found.', 404);
    if (!['elementary', 'jhs'].includes(year.levelCode)) throw createError('DepEd subject weights are available for Elementary and Junior High School.', 409);
    const subjects = await getSubjectsForK10(connection, req.user.schoolId, schoolLevelId, year.academicYearLabel);
    const summary = { added: [], alreadyConfigured: [], published: [], unmatched: [] };
    for (const subject of subjects) {
      const defaults = createDepedK10DefaultComponents(subject.subjectCode);
      if (!defaults) { summary.unmatched.push({ subjectId: subject.id, subjectName: subject.name }); continue; }
      if (await isProfileLocked(connection, req.user.schoolId, academicYearId, schoolLevelId, subject.id)) {
        summary.published.push({ subjectId: subject.id, subjectName: subject.name });
        continue;
      }
      if (await getProfile(connection, req.user.schoolId, academicYearId, schoolLevelId, subject.id)) {
        summary.alreadyConfigured.push({ subjectId: subject.id, subjectName: subject.name });
        continue;
      }
      await insertProfile(connection, {
        schoolId: req.user.schoolId, academicYearId, schoolLevelId,
        subjectId: subject.id, source: 'deped_default'
      }, defaults);
      summary.added.push({ subjectId: subject.id, subjectName: subject.name });
    }
    await writeAuditLog(connection, req, 'deped_k10_grading_defaults_applied', 'subject_grading_profile', academicYearId, {
      summary: `${year.academicYearLabel} ${year.levelCode} grading defaults`, added: summary.added.length
    });
    await connection.commit();
    transactionStarted = false;
    const preview = await getPreviewData(getDatabase(), req.user.schoolId, academicYearId, schoolLevelId);
    res.json({ ...summary, preview });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function getTeacherSubjectGradingConfig(req, res, next) {
  try {
    if (req.user.role !== 'teacher') throw createError('Only an assigned teacher can load subject grading rules.', 403);
    const sectionId = parseId(req.query.sectionId, 'Section');
    const subjectId = parseId(req.query.subjectId, 'Subject');
    const [rows] = await getDatabase().execute(
      `SELECT sections.id AS sectionId, sections.school_id AS schoolId, sections.academic_year_id AS academicYearId,
        sections.school_level_id AS schoolLevelId, school_grade_levels.grade_code AS gradeCode,
        academic_years.label AS academicYearLabel,
        school_levels.level_code AS levelCode, school_levels.grading_period_type AS gradingPeriodType
      FROM section_teachers INNER JOIN sections ON sections.id = section_teachers.section_id
        AND sections.school_id = section_teachers.school_id AND sections.status = 'active'
      INNER JOIN subjects ON subjects.id = section_teachers.subject_id AND subjects.school_id = sections.school_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_id = sections.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.school_id = sections.school_id
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id AND school_levels.school_id = sections.school_id
      WHERE section_teachers.school_id = ? AND section_teachers.teacher_user_id = ?
        AND section_teachers.section_id = ? AND section_teachers.subject_id = ? LIMIT 1`,
      [req.user.schoolId, req.user.id, sectionId, subjectId]
    );
    const section = rows[0];
    if (!section) throw createError('The section and subject are not assigned to your account.', 404);
    if (!['elementary', 'jhs'].includes(section.levelCode)
      || !isDepedNumericalGradeCode(section.gradeCode, section.academicYearLabel)) {
      res.json({ applicable: false, gradingMethod: 'standard', components: [] });
      return;
    }
    const finalGradeRules = await loadK10FinalGradeRules(getDatabase(), {
      schoolId: req.user.schoolId,
      academicYearId: section.academicYearId,
      schoolLevelId: section.schoolLevelId,
      academicYearLabel: section.academicYearLabel,
      gradingPeriodType: section.gradingPeriodType,
      gradeCode: section.gradeCode
    });
    const profile = await getProfile(getDatabase(), req.user.schoolId, section.academicYearId, section.schoolLevelId, subjectId);
    res.json({
      applicable: true,
      configured: Boolean(profile),
      configurationSource: profile?.configurationSource || null,
      academicYearId: Number(section.academicYearId),
      academicYearLabel: section.academicYearLabel,
      components: profile ? await getProfileComponents(getDatabase(), req.user.schoolId, profile.id) : [],
      ...finalGradeRules
    });
  } catch (error) { next(error); }
}

async function saveK10FinalGradeRules(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    if (req.user.role !== 'school_admin') throw createError('Only School Admin can manage final-grade rules.', 403);
    const academicYearId = parseId(req.body.academicYearId, 'Academic year');
    const schoolLevelId = parseId(req.body.schoolLevelId, 'School level');
    const gradingMode = String(req.body.gradingMode || '');
    if (!GRADING_MODES.has(gradingMode)) throw createError('Select a valid final-grade method.');

    let passingGradeThreshold = 75;
    let gradeRounding = 'round';
    if (gradingMode === 'school_specific') {
      passingGradeThreshold = Number(req.body.passingGradeThreshold);
      gradeRounding = String(req.body.gradeRounding || '');
      if (!Number.isFinite(passingGradeThreshold) || passingGradeThreshold < 0 || passingGradeThreshold > 100) {
        throw createError('Passing grade must be between 0 and 100.');
      }
      passingGradeThreshold = Math.round(passingGradeThreshold * 100) / 100;
      if (!ROUNDING_RULES.has(gradeRounding)) throw createError('Select a valid grade-rounding rule.');
    }

    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const year = await getYearAndLevel(connection, req.user.schoolId, academicYearId, schoolLevelId, true);
    if (!year || !['elementary', 'jhs'].includes(year.levelCode)) throw createError('The academic year and school level do not match.', 404);
    if (year.academicYearStatus !== 'active') throw createError('Final-grade rules can only be changed for the active school year.', 409);
    if (getDepedK10GradeMethod(year.academicYearLabel) === 'standard') {
      throw createError('DepEd numerical final-grade methods are available beginning in SY 2026–27.', 409);
    }

    const current = await loadK10FinalGradeRules(connection, {
      schoolId: req.user.schoolId,
      academicYearId,
      schoolLevelId,
      academicYearLabel: year.academicYearLabel,
      gradingPeriodType: year.gradingPeriodType
    });
    if (current.locked) throw createError('Final-grade rules are locked because numerical grades have already been published for this school year.', 409);

    await connection.execute(
      `INSERT INTO school_year_final_grade_rules
        (school_id, academic_year_id, school_level_id, grading_mode, passing_grade_threshold, grade_rounding)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE grading_mode = VALUES(grading_mode),
        passing_grade_threshold = VALUES(passing_grade_threshold), grade_rounding = VALUES(grade_rounding)`,
      [req.user.schoolId, academicYearId, schoolLevelId, gradingMode, passingGradeThreshold, gradeRounding]
    );
    await writeAuditLog(connection, req, 'k10_final_grade_rules_saved', 'school_year_final_grade_rules', academicYearId, {
      summary: `${year.academicYearLabel} ${year.levelCode} final-grade rules`,
      gradingMode, passingGradeThreshold, gradeRounding
    });
    await connection.commit();
    transactionStarted = false;
    const finalGradeRules = await loadK10FinalGradeRules(connection, {
      schoolId: req.user.schoolId,
      academicYearId,
      schoolLevelId,
      academicYearLabel: year.academicYearLabel,
      gradingPeriodType: year.gradingPeriodType
    });
    res.json({ finalGradeRules });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

async function getAdminSubjectGradingConfig(req, res, next) {
  try {
    if (req.user.role !== 'school_admin') throw createError('Only School Admin can manage grading rules.', 403);
    const academicYearId = parseId(req.query.academicYearId, 'Academic year');
    const subjectId = parseId(req.query.subjectId, 'Subject');
    const [subjects] = await getDatabase().execute(
      'SELECT id, school_level_id AS schoolLevelId FROM subjects WHERE id = ? AND school_id = ? AND is_active = TRUE LIMIT 1',
      [subjectId, req.user.schoolId]
    );
    if (!subjects.length) throw createError('Subject was not found.', 404);
    const schoolLevelId = req.query.schoolLevelId
      ? parseId(req.query.schoolLevelId, 'School level')
      : subjects[0].schoolLevelId == null ? null : Number(subjects[0].schoolLevelId);
    if (!schoolLevelId) throw createError('Select a school level for this subject configuration.');
    const year = await getYearAndLevel(getDatabase(), req.user.schoolId, academicYearId, schoolLevelId);
    if (!year || !['elementary', 'jhs'].includes(year.levelCode)) throw createError('The academic year and school level do not match.', 404);
    const scopes = await getProfileGradeScopes(getDatabase(), req.user.schoolId, schoolLevelId, subjectId);
    if (!scopes.some(scope => isProfileGradeCode(scope.gradeCode, year.academicYearLabel))) {
      throw createError('The subject has no eligible numerical-grade scope in this school level and school year.', 404);
    }
    const profile = await getProfile(getDatabase(), req.user.schoolId, academicYearId, schoolLevelId, subjectId);
    res.json({ profile: profile ? {
      ...profile,
      components: await getProfileComponents(getDatabase(), req.user.schoolId, profile.id),
      locked: await isProfileLocked(getDatabase(), req.user.schoolId, academicYearId, schoolLevelId, subjectId)
    } : null });
  } catch (error) { next(error); }
}

async function saveSubjectGradingConfig(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    if (req.user.role !== 'school_admin') throw createError('Only School Admin can manage grading rules.', 403);
    const academicYearId = parseId(req.body.academicYearId, 'Academic year');
    const schoolLevelId = parseId(req.body.schoolLevelId, 'School level');
    const subjectId = parseId(req.body.subjectId, 'Subject');
    const components = normalizeComponents(req.body.components);
    await connection.beginTransaction();
    transactionStarted = true;
    const [subjects] = await connection.execute(
      `SELECT id, name AS subjectName, school_level_id AS subjectSchoolLevelId
      FROM subjects WHERE id = ? AND school_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE`,
      [subjectId, req.user.schoolId]
    );
    const subject = subjects[0];
    if (!subject) throw createError('The subject is not active in this school.', 404);
    const year = await getYearAndLevel(connection, req.user.schoolId, academicYearId, schoolLevelId, true);
    if (!year || !['elementary', 'jhs'].includes(year.levelCode)) throw createError('The academic year and school level do not match.', 404);
    if (subject.subjectSchoolLevelId != null && Number(subject.subjectSchoolLevelId) !== schoolLevelId) {
      throw createError('This subject does not belong to the selected school level.', 404);
    }
    const scopes = await getProfileGradeScopes(connection, req.user.schoolId, schoolLevelId, subjectId);
    if (!scopes.some(scope => isProfileGradeCode(scope.gradeCode, year.academicYearLabel))) {
      throw createError('The subject has no eligible numerical-grade scope in this school level and school year.', 404);
    }
    if (getDepedK10GradeMethod(year.academicYearLabel) === 'standard') throw createError('Subject-specific DepEd rules apply beginning in SY 2026–27.', 409);
    let profile = await getProfile(connection, req.user.schoolId, academicYearId, schoolLevelId, subjectId, true);
    if (await isProfileLocked(connection, req.user.schoolId, academicYearId, schoolLevelId, subjectId)) {
      throw createError('This subject’s grading rules are locked because grades have already been published for this school year.', 409);
    }
    if (!profile) {
      const [inserted] = await connection.execute(
        `INSERT INTO subject_grading_profiles (school_id, academic_year_id, school_level_id, subject_id, configuration_source)
        VALUES (?, ?, ?, ?, 'custom')`,
        [req.user.schoolId, academicYearId, schoolLevelId, subjectId]
      );
      profile = { id: Number(inserted.insertId) };
    }
    const [existingComponents] = await connection.execute(
      'SELECT id, code FROM subject_grading_components WHERE school_id = ? AND profile_id = ? FOR UPDATE',
      [req.user.schoolId, profile.id]
    );
    const existingComponentIds = new Set(existingComponents.map(item => Number(item.id)));
    if (components.some(component => component.id && !existingComponentIds.has(component.id))) throw createError('A grading component does not belong to this subject configuration.', 404);
    for (const existing of existingComponents) {
      if (components.some(component => component.id === Number(existing.id))) continue;
      const [[usage]] = await connection.execute(
        `SELECT (SELECT COUNT(*) FROM grading_items WHERE school_id = ? AND subject_grading_component_id = ?)
          + (SELECT COUNT(*) FROM assignments WHERE school_id = ? AND subject_grading_component_id = ?) AS total`,
        [req.user.schoolId, existing.id, req.user.schoolId, existing.id]
      );
      if (Number(usage.total)) throw createError(`“${existing.code}” has score or assignment links and cannot be removed.`, 409);
      await connection.execute('DELETE FROM subject_grading_components WHERE id = ? AND school_id = ?', [existing.id, req.user.schoolId]);
    }
    for (const component of components) {
      let componentId = component.id;
      if (componentId) {
        await connection.execute(
          `UPDATE subject_grading_components SET code = ?, name = ?, component_type = ?, weight = ?, sort_order = ?
          WHERE id = ? AND school_id = ? AND profile_id = ?`,
          [component.code, component.name, component.componentType, component.weight, component.sortOrder, componentId, req.user.schoolId, profile.id]
        );
      } else {
        const [inserted] = await connection.execute(
          `INSERT INTO subject_grading_components
            (school_id, profile_id, code, name, component_type, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.user.schoolId, profile.id, component.code, component.name, component.componentType, component.weight, component.sortOrder]
        );
        componentId = Number(inserted.insertId);
      }
      const [existingParts] = await connection.execute(
        'SELECT id, code FROM subject_grading_exam_parts WHERE school_id = ? AND component_id = ? FOR UPDATE',
        [req.user.schoolId, componentId]
      );
      const partIds = new Set(existingParts.map(part => Number(part.id)));
      if (component.examParts.some(part => part.id && !partIds.has(part.id))) throw createError('An exam part does not belong to this component.', 404);
      for (const existingPart of existingParts) {
        if (component.examParts.some(part => part.id === Number(existingPart.id))) continue;
        const [[usage]] = await connection.execute(
          `SELECT (SELECT COUNT(*) FROM grading_items WHERE school_id = ? AND subject_grading_exam_part_id = ?)
            + (SELECT COUNT(*) FROM assignments WHERE school_id = ? AND subject_grading_exam_part_id = ?) AS total`,
          [req.user.schoolId, existingPart.id, req.user.schoolId, existingPart.id]
        );
        if (Number(usage.total)) throw createError(`“${existingPart.code}” has score or assignment links and cannot be removed.`, 409);
        await connection.execute('DELETE FROM subject_grading_exam_parts WHERE id = ? AND school_id = ?', [existingPart.id, req.user.schoolId]);
      }
      for (const part of component.examParts) {
        if (part.id) {
          await connection.execute(
            `UPDATE subject_grading_exam_parts SET code = ?, name = ?, weight = ?, sort_order = ?
            WHERE id = ? AND school_id = ? AND component_id = ?`,
            [part.code, part.name, part.weight, part.sortOrder, part.id, req.user.schoolId, componentId]
          );
        } else {
          await connection.execute(
            `INSERT INTO subject_grading_exam_parts
              (school_id, component_id, code, name, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.schoolId, componentId, part.code, part.name, part.weight, part.sortOrder]
          );
        }
      }
    }
    await connection.execute(
      `UPDATE subject_grading_profiles SET configuration_source = 'custom', copied_from_profile_id = NULL
      WHERE id = ? AND school_id = ?`,
      [profile.id, req.user.schoolId]
    );
    await writeAuditLog(connection, req, 'subject_grading_config_updated', 'subject_grading_profile', profile.id, {
      summary: `${subject.subjectName} grading configuration`, subjectId, academicYearId
    });
    await connection.commit();
    transactionStarted = false;
    const saved = await getProfile(connection, req.user.schoolId, academicYearId, schoolLevelId, subjectId);
    res.json({ profile: { ...saved, components: await getProfileComponents(connection, req.user.schoolId, saved.id), locked: false } });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function copyCustomProfilesForward(connection, schoolId, academicYearId, startDate) {
  const [profiles] = await connection.execute(
    `SELECT profiles.id, profiles.school_level_id AS schoolLevelId, profiles.subject_id AS subjectId,
      profiles.configuration_source AS configurationSource
    FROM subject_grading_profiles AS profiles
    INNER JOIN academic_years ON academic_years.id = profiles.academic_year_id AND academic_years.school_id = profiles.school_id
    INNER JOIN school_levels ON school_levels.id = profiles.school_level_id AND school_levels.school_id = profiles.school_id
    WHERE profiles.school_id = ? AND academic_years.start_date < ?
      AND profiles.configuration_source IN ('custom', 'copied_custom')
      AND school_levels.level_code IN ('elementary', 'jhs')
      AND academic_years.start_date = (
        SELECT MAX(previous_year.start_date) FROM academic_years AS previous_year
        WHERE previous_year.school_id = profiles.school_id AND previous_year.start_date < ?
      )`,
    [schoolId, startDate, startDate]
  );
  for (const profile of profiles) {
    if (await getProfile(connection, schoolId, academicYearId, Number(profile.schoolLevelId), Number(profile.subjectId))) continue;
    const components = await getProfileComponents(connection, schoolId, Number(profile.id));
    const copy = components.map(component => ({
      ...component, id: undefined,
      examParts: component.examParts.map(part => ({ ...part, id: undefined }))
    }));
    await insertProfile(connection, {
      schoolId, academicYearId, schoolLevelId: Number(profile.schoolLevelId), subjectId: Number(profile.subjectId),
      source: 'copied_custom', copiedFromProfileId: Number(profile.id)
    }, copy);
  }
}

module.exports = {
  applyDepedDefaults,
  copyCustomProfilesForward,
  getAdminSubjectGradingConfig,
  getTeacherSubjectGradingConfig,
  previewDepedDefaults,
  saveK10FinalGradeRules,
  saveSubjectGradingConfig
};
