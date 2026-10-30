const { getDatabase } = require('../config/database');
const { SHS_GRADE_ELIGIBILITY, SHS_HOURS_BY_GRADE, SHS_SUBJECT_HOURS, SHS_SUBJECT_TYPES } = require('../config/shsCurriculum');
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

async function validateSubjectScope(connection, schoolId, schoolLevelId, gradeLevelIds, trackId, strandId, shsGradingGroup, shsSubjectType, instructionalHours) {
  if (!gradeLevelIds.length) throw createError('Select at least one grade level for this subject.');
  if (schoolLevelId) {
    const [levels] = await connection.execute('SELECT id FROM school_levels WHERE id = ? AND school_id = ? LIMIT 1', [schoolLevelId, schoolId]);
    if (!levels.length) throw createError('School level was not found.', 404);
  }
  const placeholders = gradeLevelIds.map(() => '?').join(', ');
  const [grades] = await connection.execute(
    `SELECT grades.id, grades.school_level_id AS schoolLevelId, grades.school_id AS schoolId,
      grades.grade_code AS gradeCode, levels.level_code AS levelCode
      FROM school_grade_levels AS grades INNER JOIN school_levels AS levels ON levels.id = grades.school_level_id
      WHERE grades.school_id = ? AND grades.id IN (${placeholders})`,
    [schoolId, ...gradeLevelIds]
  );
  if (grades.length !== gradeLevelIds.length || (schoolLevelId && grades.some(grade => Number(grade.schoolLevelId) !== schoolLevelId))) {
    throw createError('One or more selected grade levels are invalid for this school.', 404);
  }
  const [shsLevels] = await connection.execute("SELECT id FROM school_levels WHERE school_id = ? AND level_code = 'shs' LIMIT 1", [schoolId]);
  const shsLevelId = shsLevels[0] ? Number(shsLevels[0].id) : null;
  const includesShs = grades.some(grade => Number(grade.schoolLevelId) === shsLevelId);
  if (includesShs && grades.some(grade => Number(grade.schoolLevelId) !== shsLevelId)) {
    throw createError('Set up SHS subjects separately from Elementary and Junior High subjects.');
  }
  if (!includesShs && (trackId || strandId || shsGradingGroup || shsSubjectType || instructionalHours)) throw createError('SHS settings only apply to Senior High School subjects.');
  if (includesShs && strandId) throw createError('Strands are not used by the Strengthened SHS curriculum.');
  if (includesShs && shsGradingGroup) throw createError('The earlier SHS grading types cannot be used for new subjects.');
  if (includesShs && !Object.hasOwn(SHS_SUBJECT_TYPES, shsSubjectType)) throw createError('Choose a Strengthened SHS subject type.');
  if (includesShs && shsSubjectType !== 'core') throw createError('Set up approved electives and Work Immersion in SHS Program.');
  if (includesShs && !SHS_SUBJECT_HOURS[shsSubjectType].includes(instructionalHours)) throw createError('Choose valid instructional hours for this SHS subject type.');
  if (includesShs && grades.some(grade => !SHS_GRADE_ELIGIBILITY[shsSubjectType].includes(Number(grade.gradeCode.replace('grade-', ''))))) {
    throw createError('This SHS subject type is not available in the selected grade.');
  }
  if (includesShs && grades.some(grade => !SHS_HOURS_BY_GRADE[Number(grade.gradeCode.replace('grade-', ''))]?.[shsSubjectType]?.includes(instructionalHours))) {
    throw createError('These instructional hours are not valid for the selected SHS grade.');
  }
  if (includesShs && shsSubjectType === 'core' && trackId) throw createError('Core subjects are shared across SHS tracks.');
  if (includesShs && shsSubjectType !== 'core' && !trackId) throw createError('Choose a track for this SHS elective.');
  if (includesShs && trackId) {
    const [tracks] = await connection.execute('SELECT id, track_code AS trackCode FROM school_shs_tracks WHERE id = ? AND school_id = ? AND school_level_id = ? AND is_enabled = TRUE LIMIT 1', [trackId, schoolId, shsLevelId]);
    if (!tracks.length || !['academic', 'techpro'].includes(tracks[0].trackCode)) throw createError('Choose an enabled Strengthened SHS track.', 404);
    const trackCode = tracks[0].trackCode;
    if (shsSubjectType === 'academic_elective' && trackCode !== 'academic') throw createError('Academic electives require the Academic track.');
    if (['techpro_elective', 'work_immersion'].includes(shsSubjectType) && trackCode !== 'techpro') throw createError('TechPro subjects require the TechPro track.');
  }
  return { gradeLevelIds, gradeLevelRows: grades, includesShs, shsLevelId };
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
    const [subjects] = await database.execute(`SELECT subjects.id, subjects.school_id AS schoolId, subjects.subject_code AS subjectCode, subjects.name, subjects.school_level_id AS schoolLevelId, subjects.grade_level_id AS gradeLevelId, subjects.shs_grading_group AS shsGradingGroup, subjects.shs_subject_type AS shsSubjectType, subjects.instructional_hours AS instructionalHours, subjects.is_active AS isActive, school_levels.level_code AS schoolLevelCode, school_levels.display_name AS schoolLevelName, school_grade_levels.grade_code AS gradeCode, school_grade_levels.display_name AS gradeLevelName FROM subjects LEFT JOIN school_levels ON school_levels.id = subjects.school_level_id LEFT JOIN school_grade_levels ON school_grade_levels.id = subjects.grade_level_id WHERE ${where} ORDER BY subjects.name`, values);
    const scopes = subjects.length ? await database.execute(
      `SELECT scopes.subject_id AS subjectId, scopes.grade_level_id AS gradeLevelId,
        scopes.track_id AS trackId, scopes.strand_id AS strandId,
        grades.display_name AS gradeLevelName, levels.level_code AS schoolLevelCode,
        tracks.track_code AS trackCode, tracks.display_name AS trackName,
        strands.strand_code AS strandCode, strands.display_name AS strandName
      FROM subject_grade_scopes AS scopes
      INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
      INNER JOIN school_levels AS levels ON levels.id = grades.school_level_id
      LEFT JOIN school_shs_tracks AS tracks ON tracks.id = scopes.track_id
      LEFT JOIN school_shs_strands AS strands ON strands.id = scopes.strand_id
      WHERE scopes.school_id = ? AND scopes.subject_id IN (${subjects.map(() => '?').join(', ')})
      ORDER BY levels.id, grades.sort_order, tracks.id, strands.id`,
      [req.user.schoolId, ...subjects.map(subject => subject.id)]
    ).then(result => result[0]) : [];
    res.json({ subjects: subjects.map(subject => {
      const subjectScopes = scopes.filter(scope => String(scope.subjectId) === String(subject.id));
      return {
        ...subject,
        isActive: Boolean(subject.isActive),
        gradeLevelIds: subjectScopes.map(scope => Number(scope.gradeLevelId)),
        gradeScopes: subjectScopes.map(({ subjectId, ...scope }) => ({ ...scope, gradeLevelId: Number(scope.gradeLevelId), trackId: scope.trackId == null ? null : Number(scope.trackId), strandId: scope.strandId == null ? null : Number(scope.strandId) }))
      };
    }) });
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
    const gradeLevelIds = Array.isArray(req.body.gradeLevelIds)
      ? [...new Set(req.body.gradeLevelIds.map(value => parseId(value, 'grade level ID')))]
      : [optionalId(req.body.gradeLevelId, 'grade level ID')].filter(Boolean);
    const trackId = optionalId(req.body.trackId, 'track ID');
    const strandId = optionalId(req.body.strandId, 'strand ID');
    const shsGradingGroup = req.body.shsGradingGroup == null || req.body.shsGradingGroup === '' ? null : String(req.body.shsGradingGroup);
    const shsSubjectType = req.body.shsSubjectType == null ? null : String(req.body.shsSubjectType);
    const instructionalHours = req.body.instructionalHours == null || req.body.instructionalHours === '' ? null : Number(req.body.instructionalHours);
    const scope = await validateSubjectScope(connection, req.user.schoolId, schoolLevelId, gradeLevelIds, trackId, strandId, shsGradingGroup, shsSubjectType, instructionalHours);
    const gradeLevelId = gradeLevelIds.length === 1 ? gradeLevelIds[0] : null;
    await connection.beginTransaction();
    transactionStarted = true;
    const [result] = await connection.execute('INSERT INTO subjects (school_id, subject_code, name, school_level_id, grade_level_id, shs_grading_group, shs_subject_type, instructional_hours) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)', [req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId, shsSubjectType, instructionalHours]);
    for (const selectedGradeId of gradeLevelIds) {
      const isShsGrade = scope.gradeLevelRows.some(grade => Number(grade.id) === selectedGradeId && Number(grade.schoolLevelId) === scope.shsLevelId);
      await connection.execute('INSERT INTO subject_grade_scopes (school_id, subject_id, grade_level_id, track_id, strand_id) VALUES (?, ?, ?, ?, ?)', [req.user.schoolId, result.insertId, selectedGradeId, isShsGrade ? trackId : null, isShsGrade ? strandId : null]);
    }
    await writeAuditLog(connection, req, 'subject_created', 'subject', result.insertId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ subject: { id: result.insertId, schoolId: req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId, gradeLevelIds, trackId, strandId: null, shsGradingGroup: null, shsSubjectType, instructionalHours, isActive: true } });
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
    const [rows] = await connection.execute('SELECT id, subject_code AS subjectCode, name, school_level_id AS schoolLevelId, grade_level_id AS gradeLevelId, shs_grading_group AS shsGradingGroup, shs_subject_type AS shsSubjectType, instructional_hours AS instructionalHours, is_active AS isActive FROM subjects WHERE id = ? AND school_id = ? LIMIT 1', [subjectId, req.user.schoolId]);
    const current = rows[0];
    if (!current) throw createError('Subject was not found.', 404);
    const subjectCode = req.body.subjectCode === undefined ? current.subjectCode : text(req.body.subjectCode, 50, 'Subject code').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(subjectCode)) throw createError('Subject code must use letters, numbers, or hyphens.');
    const name = req.body.name === undefined ? current.name : text(req.body.name, 120, 'Subject name');
    const schoolLevelId = req.body.schoolLevelId === undefined ? current.schoolLevelId : optionalId(req.body.schoolLevelId, 'school level ID');
    const [currentScopes] = await connection.execute(
      `SELECT scopes.grade_level_id AS gradeLevelId, scopes.track_id AS trackId, scopes.strand_id AS strandId,
        school_levels.level_code AS schoolLevelCode
      FROM subject_grade_scopes AS scopes
      INNER JOIN school_grade_levels ON school_grade_levels.id = scopes.grade_level_id
      INNER JOIN school_levels ON school_levels.id = school_grade_levels.school_level_id
      WHERE scopes.school_id = ? AND scopes.subject_id = ?`,
      [req.user.schoolId, subjectId]
    );
    const gradeLevelIds = req.body.gradeLevelIds === undefined && req.body.gradeLevelId === undefined
      ? currentScopes.map(scope => Number(scope.gradeLevelId))
      : Array.isArray(req.body.gradeLevelIds)
        ? [...new Set(req.body.gradeLevelIds.map(value => parseId(value, 'grade level ID')))]
        : [optionalId(req.body.gradeLevelId, 'grade level ID')].filter(Boolean);
    const currentShsScope = currentScopes.find(scope => scope.schoolLevelCode === 'shs');
    if (currentShsScope && (current.shsGradingGroup || !current.shsSubjectType)) throw createError('This subject uses the earlier SHS setup. Clear the SHS test data before editing it.', 409);
    const currentTrackId = currentShsScope?.trackId == null ? null : Number(currentShsScope.trackId);
    if (currentShsScope?.strandId) throw createError('This subject uses an earlier SHS strand. Clear the SHS test data before editing it.', 409);
    const trackId = req.body.trackId === undefined ? currentTrackId : optionalId(req.body.trackId, 'track ID');
    const strandId = optionalId(req.body.strandId, 'strand ID');
    const shsGradingGroup = req.body.shsGradingGroup === undefined ? (currentShsScope ? current.shsGradingGroup : null) : (req.body.shsGradingGroup == null || req.body.shsGradingGroup === '' ? null : String(req.body.shsGradingGroup));
    const shsSubjectType = req.body.shsSubjectType === undefined ? current.shsSubjectType : (req.body.shsSubjectType == null ? null : String(req.body.shsSubjectType));
    const instructionalHours = req.body.instructionalHours === undefined ? current.instructionalHours : (req.body.instructionalHours == null || req.body.instructionalHours === '' ? null : Number(req.body.instructionalHours));
    const gradeLevelId = gradeLevelIds.length === 1 ? gradeLevelIds[0] : null;
    const isActive = req.body.isActive === undefined ? Boolean(current.isActive) : req.body.isActive;
    if (typeof isActive !== 'boolean') throw createError('Subject activity must use true or false.');
    const scope = await validateSubjectScope(connection, req.user.schoolId, schoolLevelId, gradeLevelIds, trackId, strandId, shsGradingGroup, shsSubjectType, instructionalHours);
    await connection.beginTransaction();
    transactionStarted = true;
    const requestedScopeKey = gradeLevelIds.map(id => {
      const isShsGrade = scope.gradeLevelRows.some(grade => Number(grade.id) === id && Number(grade.schoolLevelId) === scope.shsLevelId);
      return `${id}:${isShsGrade ? trackId || '' : ''}:${isShsGrade ? strandId || '' : ''}`;
    }).sort().join('|');
    const currentScopeKey = currentScopes.map(scope => `${Number(scope.gradeLevelId)}:${scope.trackId || ''}:${scope.strandId || ''}`).sort().join('|');
    if (requestedScopeKey !== currentScopeKey) {
      const [assignedSections] = await connection.execute(
        'SELECT sections.grade_level_id AS gradeLevelId, sections.track_id AS trackId, sections.strand_id AS strandId FROM section_teachers INNER JOIN sections ON sections.id = section_teachers.section_id AND sections.school_id = section_teachers.school_id WHERE section_teachers.school_id = ? AND section_teachers.subject_id = ?',
        [req.user.schoolId, subjectId]
      );
      const assignmentStillMatches = assignedSections.every(section => {
        if (!gradeLevelIds.includes(Number(section.gradeLevelId))) return false;
        const grade = scope.gradeLevelRows.find(row => Number(row.id) === Number(section.gradeLevelId));
        if (Number(grade?.schoolLevelId) !== scope.shsLevelId) return true;
        return (!trackId || Number(section.trackId) === trackId) && (!strandId || Number(section.strandId) === strandId);
      });
      if (!assignmentStillMatches) throw createError('This subject is assigned to sections outside the requested grade, track, or strand coverage. Remove or correct those assignments first.', 409);
    }
    await connection.execute('UPDATE subjects SET subject_code=?, name=?, school_level_id=?, grade_level_id=?, shs_grading_group=NULL, shs_subject_type=?, instructional_hours=?, is_active=? WHERE id=?', [subjectCode, name, schoolLevelId, gradeLevelId, shsSubjectType, instructionalHours, isActive, subjectId]);
    if (requestedScopeKey !== currentScopeKey) {
      await connection.execute('DELETE FROM subject_grade_scopes WHERE school_id = ? AND subject_id = ?', [req.user.schoolId, subjectId]);
      for (const selectedGradeId of gradeLevelIds) {
        const isShsGrade = scope.gradeLevelRows.some(grade => Number(grade.id) === selectedGradeId && Number(grade.schoolLevelId) === scope.shsLevelId);
        await connection.execute('INSERT INTO subject_grade_scopes (school_id, subject_id, grade_level_id, track_id, strand_id) VALUES (?, ?, ?, ?, ?)', [req.user.schoolId, subjectId, selectedGradeId, isShsGrade ? trackId : null, isShsGrade ? strandId : null]);
      }
    }
    await connection.execute('UPDATE journal_subjects SET name = ?, is_active = ? WHERE school_id = ? AND subject_id = ?', [name, isActive, req.user.schoolId, subjectId]);
    await writeAuditLog(connection, req, 'subject_updated', 'subject', subjectId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.json({ subject: { id: subjectId, schoolId: req.user.schoolId, subjectCode, name, schoolLevelId, gradeLevelId, gradeLevelIds, trackId, strandId: null, shsGradingGroup: null, shsSubjectType, instructionalHours, isActive } });
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
        (SELECT COUNT(*) FROM section_teachers WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM assignments WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM grading_items WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM published_final_grades WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM attendance_sessions WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM grading_period_reopen_requests WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM learning_materials WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM journal_subjects WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM subject_grading_profiles WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM shs_grading_profiles WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM shs_grade_publication_history WHERE school_id = ? AND subject_id = ?) +
        (SELECT COUNT(*) FROM school_settings WHERE school_id = ? AND journal_subject_id = ?) AS total`,
      Array.from({ length: 12 }, () => [req.user.schoolId, subjectId]).flat()
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
