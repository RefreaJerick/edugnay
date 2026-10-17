const { getDatabase } = require('../config/database');
const { DEPED_K10_SUBJECTS } = require('../config/depedK10Subjects');
const { writeAuditLog } = require('../utils/auditLog');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asBoolean(value) {
  return value === true || value === 1 || value === '1';
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

async function loadSubjectContext(connection, schoolId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT school_levels.id AS schoolLevelId, school_levels.level_code AS levelCode,
      school_levels.is_enabled AS levelEnabled, school_grade_levels.id AS gradeLevelId,
      school_grade_levels.grade_code AS gradeCode, school_grade_levels.display_name AS gradeName,
      school_grade_levels.is_enabled AS gradeEnabled
    FROM school_levels
    LEFT JOIN school_grade_levels ON school_grade_levels.school_level_id = school_levels.id
      AND school_grade_levels.school_id = school_levels.school_id
    WHERE school_levels.school_id = ? AND school_levels.level_code IN ('elementary', 'jhs')
    ORDER BY school_levels.id, school_grade_levels.sort_order${lock ? ' FOR UPDATE' : ''}`,
    [schoolId]
  );
  const levels = new Map();
  for (const row of rows) {
    const levelCode = row.levelCode;
    if (!levels.has(levelCode)) {
      levels.set(levelCode, {
        id: Number(row.schoolLevelId),
        levelCode,
        isEnabled: asBoolean(row.levelEnabled),
        grades: []
      });
    }
    if (row.gradeLevelId != null) {
      levels.get(levelCode).grades.push({
        id: Number(row.gradeLevelId),
        gradeCode: row.gradeCode,
        displayName: row.gradeName,
        isEnabled: asBoolean(row.gradeEnabled)
      });
    }
  }
  const gradeRows = [...levels.values()]
    .filter(level => level.isEnabled)
    .flatMap(level => level.grades
      .filter(grade => grade.isEnabled && DEPED_K10_SUBJECTS.some(subject => subject.levelCode === level.levelCode && subject.gradeCodes.includes(grade.gradeCode)))
      .map(grade => ({ ...grade, schoolLevelId: level.id, levelCode: level.levelCode })));
  return { levels, gradeRows };
}

async function loadExistingSubjects(connection, schoolId, lock = false) {
  const [subjects] = await connection.execute(
    `SELECT id, subject_code AS subjectCode, name, school_level_id AS schoolLevelId,
      grade_level_id AS gradeLevelId, is_active AS isActive
    FROM subjects WHERE school_id = ?
    ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [schoolId]
  );
  if (!subjects.length) return [];
  const [scopes] = await connection.execute(
    `SELECT subject_id AS subjectId, grade_level_id AS gradeLevelId
    FROM subject_grade_scopes
    WHERE school_id = ? AND subject_id IN (${subjects.map(() => '?').join(', ')})`,
    [schoolId, ...subjects.map(subject => subject.id)]
  );
  const scopesBySubject = new Map();
  for (const scope of scopes) {
    if (!scopesBySubject.has(Number(scope.subjectId))) scopesBySubject.set(Number(scope.subjectId), new Set());
    scopesBySubject.get(Number(scope.subjectId)).add(Number(scope.gradeLevelId));
  }
  return subjects.map(subject => ({
    ...subject,
    id: Number(subject.id),
    schoolLevelId: subject.schoolLevelId == null ? null : Number(subject.schoolLevelId),
    gradeLevelId: subject.gradeLevelId == null ? null : Number(subject.gradeLevelId),
    isActive: asBoolean(subject.isActive),
    gradeLevelIds: scopesBySubject.get(Number(subject.id)) || new Set()
  }));
}

function matchingSubjects(defaultSubject, schoolLevelId, existingSubjects) {
  const name = normalizedName(defaultSubject.name);
  return existingSubjects.filter(subject => subject.subjectCode === defaultSubject.code
    || ((subject.schoolLevelId === schoolLevelId || subject.schoolLevelId == null) && normalizedName(subject.name) === name));
}

function previewForGrade(grade, existingSubjects) {
  const defaults = DEPED_K10_SUBJECTS.filter(subject => subject.levelCode === grade.levelCode && subject.gradeCodes.includes(grade.gradeCode));
  return {
    ...grade,
    subjects: defaults.map(defaultSubject => {
      const matches = matchingSubjects(defaultSubject, grade.schoolLevelId, existingSubjects);
      const covered = matches.find(subject => subject.gradeLevelId === grade.id || subject.gradeLevelIds.has(grade.id));
      let status = 'will-add';
      let existingName = null;
      if (covered) {
        status = covered.isActive ? 'already-present' : 'inactive';
        existingName = covered.name;
      } else if (matches.length) {
        status = 'review-existing';
        existingName = matches[0].name;
      }
      return { code: defaultSubject.code, name: defaultSubject.name, status, existingName };
    })
  };
}

async function getDepedSubjectPreview(req, res, next) {
  try {
    const schoolId = Number(req.user.schoolId);
    const database = getDatabase();
    const { levels, gradeRows } = await loadSubjectContext(database, schoolId);
    const existing = await loadExistingSubjects(database, schoolId);
    res.status(200).json({
      curriculum: 'Revised K to 10 curriculum',
      grades: gradeRows.map(grade => previewForGrade(grade, existing))
    });
  } catch (error) { next(error); }
}

async function applyDepedSubjectDefaults(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    const schoolId = Number(req.user.schoolId);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const { levels, gradeRows } = await loadSubjectContext(connection, schoolId, true);
    if (!gradeRows.length) throw createError('Enable at least one Grade 4–10 level, save it, and review the subject defaults again.');
    const selectedGrades = gradeRows;
    const existing = await loadExistingSubjects(connection, schoolId, true);
    const existingCodes = new Set(existing.map(subject => subject.subjectCode));
    const addedSubjects = [];
    let addedGradeScopes = 0;

    for (const defaultSubject of DEPED_K10_SUBJECTS) {
      const subjectGrades = selectedGrades.filter(grade => grade.levelCode === defaultSubject.levelCode
        && defaultSubject.gradeCodes.includes(grade.gradeCode));
      if (!subjectGrades.length) continue;
      const schoolLevel = levels.get(defaultSubject.levelCode);
      if (matchingSubjects(defaultSubject, schoolLevel.id, existing).length || existingCodes.has(defaultSubject.code)) continue;

      const [result] = await connection.execute(
        `INSERT INTO subjects (school_id, subject_code, name, school_level_id, grade_level_id, shs_grading_group)
        VALUES (?, ?, ?, ?, NULL, NULL)`,
        [schoolId, defaultSubject.code, defaultSubject.name, schoolLevel.id]
      );
      addedSubjects.push({ code: defaultSubject.code, name: defaultSubject.name });
      for (const grade of subjectGrades) {
        await connection.execute(
          'INSERT INTO subject_grade_scopes (school_id, subject_id, grade_level_id, track_id, strand_id) VALUES (?, ?, ?, NULL, NULL)',
          [schoolId, result.insertId, grade.id]
        );
        addedGradeScopes += 1;
      }
    }

    await writeAuditLog(connection, req, 'deped_subject_defaults_applied', 'subjects', schoolId, {
      summary: 'Applied revised K to 10 subject defaults',
      gradeCodes: selectedGrades.map(grade => grade.gradeCode),
      addedSubjectCodes: addedSubjects.map(subject => subject.code),
      addedGradeScopes
    });
    await connection.commit();
    transactionStarted = false;
    res.status(200).json({
      addedSubjects,
      addedGradeScopes,
      selectedGradeCodes: selectedGrades.map(grade => grade.gradeCode)
    });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('A subject was added at the same time. Refresh the preview and try again.', 409);
    next(error);
  } finally { connection?.release(); }
}

module.exports = { applyDepedSubjectDefaults, getDepedSubjectPreview };
