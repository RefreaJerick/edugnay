const { getDatabase } = require('../config/database');
const { avatarFields } = require('../config/avatars');
const { writeAuditLog } = require('../utils/auditLog');
const { assertTeacherScheduleAvailable } = require('./timetablesController');

const SECTION_STATUSES = new Set(['active', 'archived']);

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

function text(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value, label);
}

function capacity(value) {
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result < 1 || result > 100) throw createError('Capacity must be between 1 and 100.');
  return result;
}

function sectionSelect() {
  return `SELECT
    sections.id, sections.school_id AS schoolId, sections.academic_year_id AS academicYearId,
    sections.school_level_id AS schoolLevelId, sections.grade_level_id AS gradeLevelId,
    sections.track_id AS trackId, sections.strand_id AS strandId, sections.name, sections.capacity, sections.adviser_user_id AS adviserUserId,
    sections.status, academic_years.label AS academicYearLabel, academic_years.status AS academicYearStatus,
    DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
    DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS academicYearEndDate,
    school_levels.level_code AS schoolLevelCode,
    school_levels.display_name AS schoolLevelName, school_grade_levels.grade_code AS gradeCode,
    school_grade_levels.display_name AS gradeLevelName,
    tracks.track_code AS trackCode, tracks.display_name AS trackName,
    strands.strand_code AS strandCode, strands.display_name AS strandName,
    (school_levels.level_code = 'shs' AND tracks.track_code IN ('academic', 'tvl') AND sections.strand_id IS NULL) AS needsStrandReview,
    adviser.display_name AS adviserName,
    adviser.avatar_filename AS adviserAvatarFilename, adviser.avatar_version AS adviserAvatarVersion,
    (SELECT COUNT(*) FROM section_students WHERE section_students.school_id = sections.school_id
      AND section_students.section_id = sections.id AND section_students.withdrawn_at IS NULL) AS studentCount
  FROM sections
  INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.school_id = sections.school_id
  INNER JOIN school_levels ON school_levels.id = sections.school_level_id AND school_levels.school_id = sections.school_id
  INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id AND school_grade_levels.school_id = sections.school_id
  LEFT JOIN school_shs_tracks AS tracks ON tracks.id = sections.track_id AND tracks.school_id = sections.school_id
  LEFT JOIN school_shs_strands AS strands ON strands.id = sections.strand_id AND strands.school_id = sections.school_id
  LEFT JOIN users AS adviser ON adviser.id = sections.adviser_user_id AND adviser.school_id = sections.school_id`;
}

function getAccessFilter(req, scope = '') {
  if (req.user.role === 'school_admin') return { sql: 'sections.school_id = ?', values: [req.user.schoolId] };
  if (req.user.role === 'teacher' && scope === 'teaching') {
    return {
      sql: `sections.school_id = ? AND sections.status = 'active' AND academic_years.status = 'active' AND EXISTS (
        SELECT 1 FROM section_teachers
        INNER JOIN subjects ON subjects.id = section_teachers.subject_id
        WHERE section_teachers.school_id = sections.school_id
          AND section_teachers.section_id = sections.id
          AND section_teachers.teacher_user_id = ?
          AND subjects.school_id = sections.school_id AND subjects.is_active = TRUE
      )`,
      values: [req.user.schoolId, req.user.id]
    };
  }
  if (req.user.role === 'teacher') return { sql: `sections.school_id = ? AND (sections.adviser_user_id = ? OR EXISTS (SELECT 1 FROM section_teachers WHERE section_teachers.school_id = sections.school_id AND section_teachers.section_id = sections.id AND section_teachers.teacher_user_id = ?))`, values: [req.user.schoolId, req.user.id, req.user.id] };
  if (req.user.role === 'student') return { sql: `sections.school_id = ? AND EXISTS (SELECT 1 FROM section_students WHERE section_students.school_id = sections.school_id AND section_students.section_id = sections.id AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)`, values: [req.user.schoolId, req.user.id] };
  if (req.user.role === 'parent') return { sql: `sections.school_id = ? AND EXISTS (SELECT 1 FROM section_students INNER JOIN student_parent_links ON student_parent_links.school_id = section_students.school_id AND student_parent_links.student_user_id = section_students.student_user_id WHERE section_students.school_id = sections.school_id AND section_students.section_id = sections.id AND section_students.withdrawn_at IS NULL AND student_parent_links.parent_user_id = ?)`, values: [req.user.schoolId, req.user.id] };
  return { sql: '1 = 0', values: [] };
}

function formatSection(row) {
  return {
    id: row.id, schoolId: row.schoolId, academicYearId: row.academicYearId, academicYearLabel: row.academicYearLabel,
    academicYearStatus: row.academicYearStatus,
    academicYearStartDate: row.academicYearStartDate,
    academicYearEndDate: row.academicYearEndDate,
    schoolLevelId: row.schoolLevelId, schoolLevelCode: row.schoolLevelCode, schoolLevelName: row.schoolLevelName,
    gradeLevelId: row.gradeLevelId, gradeCode: row.gradeCode, gradeLevelName: row.gradeLevelName,
    trackId: row.trackId, trackCode: row.trackCode, trackName: row.trackName,
    strandId: row.strandId, strandCode: row.strandCode, strandName: row.strandName,
    needsStrandReview: Boolean(row.needsStrandReview),
    name: row.name, capacity: row.capacity, studentCount: Number(row.studentCount),
    adviserUserId: row.adviserUserId, adviserName: row.adviserName,
    adviserAvatar: avatarFields({ id: row.adviserUserId, avatarFilename: row.adviserAvatarFilename,
      avatarVersion: row.adviserAvatarVersion }), status: row.status
  };
}

async function findAccessibleSection(req, sectionId, connection = getDatabase()) {
  const access = getAccessFilter(req);
  const where = ['sections.id = ?'];
  const values = [sectionId];
  if (access.sql) { where.push(access.sql); values.push(...access.values); }
  const [sections] = await connection.execute(`${sectionSelect()} WHERE ${where.join(' AND ')} LIMIT 1`, values);
  return sections[0] || null;
}

async function findOwnedSection(schoolId, sectionId, connection = getDatabase()) {
  const [sections] = await connection.execute(`${sectionSelect()} WHERE sections.id = ? AND sections.school_id = ? LIMIT 1`, [sectionId, schoolId]);
  return sections[0] || null;
}

function assertSectionYearWritable(section) {
  if (section.academicYearStatus === 'archived') {
    throw createError('Records from an archived school year are read-only.', 409);
  }
}

function assertShsPlacementReviewed(section) {
  if (section?.needsStrandReview) {
    throw createError('Review and assign this section’s SHS strand before enrolling students or assigning subjects.', 409);
  }
}

async function getSectionReferences(connection, sectionId) {
  const [[references]] = await connection.execute(
    `SELECT
      (SELECT COUNT(*) FROM section_students WHERE section_id = ?) AS studentEnrollments,
      (SELECT COUNT(*) FROM section_teachers WHERE section_id = ?) AS teacherAssignments,
      (SELECT COUNT(*) FROM assignments WHERE section_id = ?) AS assignments,
      (SELECT COUNT(*) FROM grading_items WHERE section_id = ?) AS gradingItems,
      (SELECT COUNT(*) FROM published_final_grades WHERE section_id = ?) AS publishedGrades,
      (SELECT COUNT(*) FROM attendance_sessions WHERE section_id = ?) AS attendanceSessions,
      (SELECT COUNT(*) FROM grading_period_reopen_requests WHERE section_id = ?) AS reopenRequests,
      (SELECT COUNT(*) FROM learning_materials WHERE section_id = ?) AS learningMaterials,
      (SELECT COUNT(*) FROM journal_prompts WHERE section_id = ?) AS journalPrompts,
      (SELECT COUNT(*) FROM student_journal_entries WHERE section_id = ?) AS journalEntries,
      (SELECT COUNT(*) FROM narrative_reports WHERE section_id = ?) AS reports,
      (SELECT COUNT(*) FROM intervention_plans WHERE section_id = ?) AS interventions,
      (SELECT COUNT(*) FROM school_form_exports WHERE section_id = ?) AS formExports,
      (SELECT COUNT(*) FROM announcement_audiences WHERE section_id = ?) AS announcementAudiences`,
    Array(14).fill(sectionId)
  );
  return references;
}

async function validateSectionData(connection, schoolId, values) {
  const academicYearId = parseId(values.academicYearId, 'academic year ID');
  const schoolLevelId = parseId(values.schoolLevelId, 'school level ID');
  const gradeLevelId = parseId(values.gradeLevelId, 'grade level ID');
  const legacyTrackId = Object.hasOwn(values, 'trackId') ? null : optionalId(values.strandId, 'track ID');
  const trackId = Object.hasOwn(values, 'trackId') ? optionalId(values.trackId, 'track ID') : legacyTrackId;
  const strandId = Object.hasOwn(values, 'trackId') ? optionalId(values.strandId, 'strand ID') : null;
  const adviserUserId = optionalId(values.adviserUserId, 'adviser user ID');
  const [years] = await connection.execute('SELECT id, status FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1', [academicYearId, schoolId]);
  const [levels] = await connection.execute('SELECT id, level_code AS levelCode, is_enabled AS isEnabled FROM school_levels WHERE id = ? AND school_id = ? LIMIT 1', [schoolLevelId, schoolId]);
  const [grades] = await connection.execute('SELECT id FROM school_grade_levels WHERE id = ? AND school_level_id = ? AND is_enabled = TRUE LIMIT 1', [gradeLevelId, schoolLevelId]);
  if (!years.length || ['closed', 'archived'].includes(years[0].status) || !levels.length || !levels[0].isEnabled || !grades.length) throw createError('The academic year, school level, or grade level is invalid.', 404);
  if (levels[0].levelCode === 'shs') {
    if (!trackId) throw createError('Select an SHS track.');
    const [tracks] = await connection.execute('SELECT id, track_code AS trackCode FROM school_shs_tracks WHERE id = ? AND school_id = ? AND school_level_id = ? AND is_enabled = TRUE LIMIT 1', [trackId, schoolId, schoolLevelId]);
    if (!tracks.length) throw createError('The selected SHS track is invalid.', 404);
    const requiresStrand = ['academic', 'tvl'].includes(tracks[0].trackCode);
    if (requiresStrand && !strandId) throw createError('Select a strand for the Academic or TVL track.');
    if (!requiresStrand && strandId) throw createError('Sports and Arts and Design sections do not use a strand.');
    if (strandId) {
      const [strands] = await connection.execute('SELECT id FROM school_shs_strands WHERE id = ? AND school_id = ? AND school_level_id = ? AND track_id = ? AND is_enabled = TRUE LIMIT 1', [strandId, schoolId, schoolLevelId, trackId]);
      if (!strands.length) throw createError('The selected strand does not belong to this SHS track.', 404);
    }
  } else if (trackId || strandId) {
    throw createError('Tracks and strands can only be selected for Senior High School sections.');
  }
  if (adviserUserId) {
    const [advisers] = await connection.execute("SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND account_status = 'active' LIMIT 1", [adviserUserId, schoolId]);
    if (!advisers.length) throw createError('The selected adviser must be an active teacher from this school.', 404);
  }
  return { academicYearId, schoolLevelId, gradeLevelId, trackId, strandId, adviserUserId };
}

async function listSections(req, res, next) {
  try {
    const scope = String(req.query?.scope || '').trim();
    if (scope && scope !== 'teaching') throw createError('Invalid section scope.');
    if (scope === 'teaching' && req.user.role !== 'teacher') throw createError('Teaching sections are available to teachers only.', 403);
    const access = getAccessFilter(req, scope);
    const [sections] = await getDatabase().execute(`${sectionSelect()}${access.sql ? ` WHERE ${access.sql}` : ''}
      ORDER BY CASE school_levels.level_code WHEN 'elementary' THEN 0 WHEN 'jhs' THEN 1 WHEN 'shs' THEN 2 ELSE 3 END,
        CASE WHEN school_grade_levels.grade_code = 'kindergarten' THEN 0
          ELSE CAST(SUBSTRING_INDEX(school_grade_levels.grade_code, '-', -1) AS UNSIGNED) END,
        sections.name`, access.values);
    const formatted = sections.map(formatSection);
    if (scope !== 'teaching' || !formatted.length) {
      res.json({ sections: formatted });
      return;
    }

    const sectionIds = formatted.map(section => section.id);
    const placeholders = sectionIds.map(() => '?').join(', ');
    const [assignments] = await getDatabase().execute(
      `SELECT section_teachers.section_id AS sectionId, subjects.id AS subjectId,
        subjects.subject_code AS subjectCode, subjects.name AS subjectName
      FROM section_teachers
      INNER JOIN subjects ON subjects.id = section_teachers.subject_id
        AND subjects.school_id = ? AND subjects.is_active = TRUE
      WHERE section_teachers.school_id = ? AND section_teachers.teacher_user_id = ?
        AND section_teachers.section_id IN (${placeholders})
      ORDER BY subjects.name`,
      [req.user.schoolId, req.user.schoolId, req.user.id, ...sectionIds]
    );
    formatted.forEach(section => {
      section.subjectAssignments = assignments
        .filter(assignment => String(assignment.sectionId) === String(section.id))
        .map(assignment => ({
          subjectId: String(assignment.subjectId),
          subjectCode: assignment.subjectCode,
          subjectName: assignment.subjectName
        }));
    });
    res.json({ sections: formatted });
  } catch (error) { next(error); }
}

async function getSection(req, res, next) {
  try {
    const section = await findAccessibleSection(req, parseId(req.params.sectionId, 'section ID'));
    if (!section) throw createError('Section not found.', 404);
    res.json({ section: formatSection(section) });
  } catch (error) { next(error); }
}

async function createSection(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const schoolId = req.user.schoolId;
    const values = await validateSectionData(connection, schoolId, req.body);
    const name = text(req.body.name, 120, 'Section name');
    const sectionCapacity = capacity(req.body.capacity);
    await connection.beginTransaction();
    transactionStarted = true;
    const [result] = await connection.execute('INSERT INTO sections (school_id, academic_year_id, school_level_id, grade_level_id, track_id, strand_id, name, capacity, adviser_user_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [schoolId, values.academicYearId, values.schoolLevelId, values.gradeLevelId, values.trackId, values.strandId, name, sectionCapacity, values.adviserUserId, 'active']);
    await writeAuditLog(connection, req, 'section_created', 'section', result.insertId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ section: formatSection(await findOwnedSection(schoolId, result.insertId)) });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('A section with this grade level and name already exists for this academic year.', 409);
    next(error);
  } finally { connection.release(); }
}

async function updateSection(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const schoolId = req.user.schoolId;
    const sectionId = parseId(req.params.sectionId, 'section ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [lockedSections] = await connection.execute(
      'SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE',
      [sectionId, schoolId]
    );
    if (!lockedSections.length) throw createError('Section not found.', 404);
    const current = await findOwnedSection(schoolId, sectionId, connection);
    if (!current) throw createError('Section not found.', 404);
    assertSectionYearWritable(current);
    for (const [field, label] of [
      ['academicYearId', 'academic year ID'], ['schoolLevelId', 'school level ID'],
      ['gradeLevelId', 'grade level ID'], ['trackId', 'track ID'], ['strandId', 'strand ID']
    ]) {
      if (req.body[field] === undefined) continue;
      const supplied = ['trackId', 'strandId'].includes(field)
        ? optionalId(req.body[field], label)
        : parseId(req.body[field], label);
      if (supplied !== (current[field] == null ? null : Number(current[field]))) {
        throw createError('A section’s academic year, school level, grade, and track or strand cannot be changed after creation.', 409);
      }
    }
    const adviserUserId = req.body.adviserUserId === undefined
      ? current.adviserUserId
      : optionalId(req.body.adviserUserId, 'adviser user ID');
    if (req.body.adviserUserId !== undefined && adviserUserId) {
      const [advisers] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'teacher' AND account_status = 'active' LIMIT 1",
        [adviserUserId, schoolId]
      );
      if (!advisers.length) throw createError('The selected adviser must be an active teacher from this school.', 404);
    }
    const name = req.body.name === undefined ? current.name : text(req.body.name, 120, 'Section name');
    const sectionCapacity = req.body.capacity === undefined ? current.capacity : capacity(req.body.capacity);
    const status = req.body.status === undefined ? current.status : String(req.body.status);
    if (!SECTION_STATUSES.has(status)) throw createError('Section status is invalid.');
    if (sectionCapacity < current.studentCount) throw createError('Capacity cannot be lower than the current student count.');
    await connection.execute('UPDATE sections SET name=?, capacity=?, adviser_user_id=?, status=? WHERE id=? AND school_id=?', [name, sectionCapacity, adviserUserId, status, sectionId, schoolId]);
    await writeAuditLog(connection, req, 'section_updated', 'section', sectionId, { summary: name });
    await connection.commit();
    transactionStarted = false;
    res.json({ section: formatSection(await findOwnedSection(schoolId, sectionId)) });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('A section with this grade level and name already exists for this academic year.', 409);
    next(error);
  } finally { connection.release(); }
}

async function classifySectionStrand(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const schoolId = req.user.schoolId;
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const strandId = parseId(req.body?.strandId, 'strand ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [locked] = await connection.execute(
      'SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE', [sectionId, schoolId]
    );
    if (!locked.length) throw createError('Section not found.', 404);
    const section = await findOwnedSection(schoolId, sectionId, connection);
    if (!section || section.schoolLevelCode !== 'shs' || !['academic', 'tvl'].includes(section.trackCode)) {
      throw createError('Only Academic or TVL sections need a strand classification.', 409);
    }
    if (section.strandId) throw createError('This section already has a strand classification.', 409);
    const [strands] = await connection.execute(
      'SELECT id, display_name AS displayName FROM school_shs_strands WHERE id = ? AND school_id = ? AND school_level_id = ? AND track_id = ? AND is_enabled = TRUE LIMIT 1',
      [strandId, schoolId, section.schoolLevelId, section.trackId]
    );
    if (!strands.length) throw createError('Choose an enabled strand for this section\'s track.', 404);
    await connection.execute('UPDATE sections SET strand_id = ? WHERE id = ? AND school_id = ? AND strand_id IS NULL', [strandId, sectionId, schoolId]);
    await writeAuditLog(connection, req, 'section_strand_classified', 'section', sectionId, {
      summary: `${section.name} · ${section.trackName} · ${strands[0].displayName}`
    });
    await connection.commit();
    transactionStarted = false;
    res.json({ section: formatSection(await findOwnedSection(schoolId, sectionId)) });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    next(error);
  } finally { connection.release(); }
}

async function deleteSection(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [lockedSections] = await connection.execute(
      'SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE',
      [sectionId, req.user.schoolId]
    );
    if (!lockedSections.length) throw createError('Section not found.', 404);
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section) throw createError('Section not found.', 404);
    assertSectionYearWritable(section);
    const references = await getSectionReferences(connection, sectionId);
    if (Object.values(references).some(value => Number(value) > 0)) throw createError('This section has students, teachers, announcements, or saved records and cannot be deleted.', 409);
    await writeAuditLog(connection, req, 'section_deleted', 'section', sectionId, { summary: section.name });
    await connection.execute('DELETE FROM sections WHERE id = ?', [sectionId]);
    await connection.commit();
    transactionStarted = false;
    res.status(204).send();
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      error = createError('This section has linked records and cannot be deleted.', 409);
    }
    next(error);
  } finally { connection.release(); }
}

async function listSectionStudents(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const section = await findAccessibleSection(req, sectionId);
    if (!section) throw createError('Section not found.', 404);
    const where = ['section_students.school_id = ?', 'section_students.section_id = ?', 'section_students.withdrawn_at IS NULL'];
    const values = [section.schoolId, sectionId];
    if (req.user.role === 'student') { where.push('students.id = ?'); values.push(req.user.id); }
    if (req.user.role === 'parent') { where.push('EXISTS (SELECT 1 FROM student_parent_links WHERE student_parent_links.school_id = section_students.school_id AND student_parent_links.student_user_id = students.id AND student_parent_links.parent_user_id = ?)'); values.push(req.user.id); }
    const [students] = await getDatabase().execute(`SELECT students.id, students.display_name AS displayName, students.school_email AS schoolEmail, students.initials, students.avatar_filename AS avatarFilename, students.avatar_version AS avatarVersion, student_profiles.lrn FROM section_students INNER JOIN users AS students ON students.id = section_students.student_user_id INNER JOIN student_profiles ON student_profiles.user_id = students.id WHERE ${where.join(' AND ')} ORDER BY students.last_name, students.first_name`, values);
    res.json({ section: formatSection(section), students: students.map(({ avatarFilename, avatarVersion, ...student }) => ({
      ...student, ...avatarFields({ id: student.id, avatarFilename, avatarVersion })
    })) });
  } catch (error) { next(error); }
}

async function getSectionStudentDetails(req, res, next) {
  try {
    if (req.user.role !== 'teacher') throw createError('You do not have access to this resource.', 403);

    const sectionId = parseId(req.params.sectionId, 'section ID');
    const studentId = parseId(req.params.studentId, 'student ID');
    const database = getDatabase();
    const [students] = await database.execute(
      `SELECT students.id AS studentId, students.display_name AS displayName,
        students.school_email AS schoolEmail, student_profiles.lrn AS studentNumber,
        school_grade_levels.display_name AS gradeLevel, sections.name AS sectionName,
        academic_years.label AS schoolYear
      FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id
        AND sections.school_id = section_students.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_id = sections.school_id
      INNER JOIN users AS students ON students.id = section_students.student_user_id
        AND students.school_id = section_students.school_id AND students.role = 'student'
      INNER JOIN student_profiles ON student_profiles.user_id = students.id
      WHERE section_students.school_id = ? AND section_students.section_id = ?
        AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL
        AND sections.status = 'active' AND academic_years.status = 'active'
        AND EXISTS (
          SELECT 1 FROM section_teachers
          INNER JOIN subjects ON subjects.id = section_teachers.subject_id
            AND subjects.school_id = section_teachers.school_id AND subjects.is_active = TRUE
          WHERE section_teachers.school_id = section_students.school_id
            AND section_teachers.section_id = section_students.section_id
            AND section_teachers.teacher_user_id = ?
        )
      LIMIT 1`,
      [req.user.schoolId, sectionId, studentId, req.user.id]
    );
    if (!students.length) throw createError('Student details were not found in your active subject sections.', 404);

    const [parents] = await database.execute(
      `SELECT parents.display_name AS displayName, student_parent_links.relationship,
        parent_profiles.contact_number AS contactNumber, parents.personal_email AS email
      FROM student_parent_links
      INNER JOIN users AS parents ON parents.id = student_parent_links.parent_user_id
        AND parents.school_id = student_parent_links.school_id AND parents.role = 'parent'
      LEFT JOIN parent_profiles ON parent_profiles.user_id = parents.id
      WHERE student_parent_links.school_id = ? AND student_parent_links.student_user_id = ?
      ORDER BY parents.last_name, parents.first_name, student_parent_links.relationship`,
      [req.user.schoolId, studentId]
    );

    const student = students[0];
    res.json({
      student: {
        id: String(student.studentId),
        displayName: student.displayName,
        schoolEmail: student.schoolEmail,
        studentNumber: student.studentNumber,
        gradeLevel: student.gradeLevel,
        sectionName: student.sectionName,
        schoolYear: student.schoolYear,
        enrollmentStatus: 'Enrolled'
      },
      parents
    });
  } catch (error) { next(error); }
}

async function enrollStudent(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const studentId = parseId(req.body.studentId, 'student ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [students] = await connection.execute("SELECT id, display_name AS displayName FROM users WHERE id=? AND school_id=? AND role='student' AND account_status='active' LIMIT 1 FOR UPDATE", [studentId, req.user.schoolId]);
    if (!students.length) throw createError('The student was not found in this school.', 404);
    const [lockedSections] = await connection.execute('SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE', [sectionId, req.user.schoolId]);
    if (!lockedSections.length) throw createError('An active section was not found.', 404);
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section || section.status !== 'active') throw createError('An active section was not found.', 404);
    assertShsPlacementReviewed(section);
    if (section.academicYearStatus !== 'active') throw createError('Students can only be assigned to sections in the active academic year.', 409);
    if (section.studentCount >= section.capacity) throw createError('This section has reached its capacity.', 409);
    const [enrollments] = await connection.execute('SELECT section_students.id FROM section_students INNER JOIN sections ON sections.id = section_students.section_id WHERE section_students.student_user_id=? AND sections.academic_year_id=? AND section_students.withdrawn_at IS NULL LIMIT 1', [studentId, section.academicYearId]);
    if (enrollments.length) throw createError('This student is already enrolled in a section for the academic year.', 409);
    await connection.execute('INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)', [req.user.schoolId, sectionId, studentId]);
    await writeAuditLog(connection, req, 'student_enrolled', 'section_student', studentId, { summary: `${students[0].displayName} · ${section.name}` });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ sectionId, studentId });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('This student is already enrolled in the section.', 409);
    next(error);
  } finally { connection.release(); }
}

async function enrollStudentsBulk(req, res, next) {
  const rawIds = req.body?.studentIds;
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 100 ||
      rawIds.some(value => !Number.isSafeInteger(value) || value < 1) ||
      new Set(rawIds).size !== rawIds.length) {
    return next(createError('Choose between 1 and 100 distinct students with valid IDs.'));
  }

  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const studentIds = [...rawIds].sort((a, b) => a - b);
    const placeholders = studentIds.map(() => '?').join(', ');
    await connection.beginTransaction();
    transactionStarted = true;

    const [students] = await connection.execute(
      `SELECT id, display_name AS displayName FROM users WHERE school_id = ? AND role = 'student' AND account_status = 'active' AND id IN (${placeholders}) ORDER BY id FOR UPDATE`,
      [req.user.schoolId, ...studentIds]
    );
    if (students.length !== studentIds.length) throw createError('One or more selected students are inactive or do not belong to this school.', 409);

    const [lockedSections] = await connection.execute('SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE', [sectionId, req.user.schoolId]);
    if (!lockedSections.length) throw createError('An active section was not found.', 404);
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section || section.status !== 'active') throw createError('An active section was not found.', 404);
    assertShsPlacementReviewed(section);
    if (section.academicYearStatus !== 'active') throw createError('Students can only be assigned to sections in the active academic year.', 409);
    if (section.studentCount + studentIds.length > section.capacity) throw createError('The section does not have enough remaining seats for all selected students.', 409);

    const [enrollments] = await connection.execute(
      `SELECT section_students.student_user_id AS studentId FROM section_students INNER JOIN sections ON sections.id = section_students.section_id WHERE section_students.school_id = ? AND sections.academic_year_id = ? AND section_students.student_user_id IN (${placeholders}) AND section_students.withdrawn_at IS NULL LIMIT 1`,
      [req.user.schoolId, section.academicYearId, ...studentIds]
    );
    if (enrollments.length) throw createError('One or more selected students are already enrolled for this academic year.', 409);

    for (const student of students) {
      await connection.execute('INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)', [req.user.schoolId, sectionId, student.id]);
      await writeAuditLog(connection, req, 'student_enrolled', 'section_student', student.id, { summary: `${student.displayName} · ${section.name}` });
    }
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ sectionId, studentIds: rawIds, assignedCount: rawIds.length });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('One or more selected students are already enrolled.', 409);
    next(error);
  } finally { connection.release(); }
}

function assertMoveSections(source, target) {
  if (!source || !target || source.status !== 'active' || target.status !== 'active') {
    throw createError('Both sections must be active sections from this school.', 404);
  }
  if (source.academicYearStatus !== 'active' || target.academicYearStatus !== 'active') {
    throw createError('Students can only be moved between sections in the active academic year.', 409);
  }
  assertShsPlacementReviewed(source);
  assertShsPlacementReviewed(target);
  if (Number(source.academicYearId) !== Number(target.academicYearId)) {
    throw createError('Students can only be moved within the same academic year.', 409);
  }
  if (Number(source.schoolLevelId) !== Number(target.schoolLevelId)
    || Number(source.gradeLevelId) !== Number(target.gradeLevelId)
    || String(source.trackId ?? '') !== String(target.trackId ?? '')
    || String(source.strandId ?? '') !== String(target.strandId ?? '')) {
    throw createError('Choose a section in the same school level, grade, track, and strand.', 409);
  }
  if (target.studentCount >= target.capacity) throw createError('The target section has reached its capacity.', 409);
}

async function getMoveImpact(database, schoolId, studentId, source) {
  const [[scores]] = await database.execute(
    `SELECT COUNT(DISTINCT student_scores.id) AS total FROM student_scores
    INNER JOIN grading_items ON grading_items.id = student_scores.grading_item_id
      AND grading_items.school_id = student_scores.school_id
    INNER JOIN academic_terms ON academic_terms.id = grading_items.academic_term_id
      AND academic_terms.academic_year_id = ? AND academic_terms.school_level_id = ?
      AND academic_terms.status = 'active'
    WHERE student_scores.school_id = ? AND student_scores.student_user_id = ?
      AND grading_items.section_id = ?`,
    [source.academicYearId, source.schoolLevelId, schoolId, studentId, source.id]
  );
  const [[grades]] = await database.execute(
    `SELECT COUNT(*) AS total FROM published_final_grades
    INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
      AND academic_terms.academic_year_id = ? AND academic_terms.school_level_id = ?
      AND academic_terms.status = 'active'
    WHERE published_final_grades.school_id = ? AND published_final_grades.student_user_id = ?
      AND published_final_grades.section_id = ?`,
    [source.academicYearId, source.schoolLevelId, schoolId, studentId, source.id]
  );
  return { priorScoreCount: Number(scores?.total || 0), publishedGradeCount: Number(grades?.total || 0) };
}

async function previewStudentMove(req, res, next) {
  try {
    const sourceSectionId = parseId(req.params.sectionId, 'source section ID');
    const studentId = parseId(req.params.studentId, 'student ID');
    const targetSectionId = parseId(req.query.targetSectionId, 'target section ID');
    if (sourceSectionId === targetSectionId) throw createError('Choose a different target section.');
    const database = getDatabase();
    const [students] = await database.execute("SELECT id, display_name AS displayName FROM users WHERE id=? AND school_id=? AND role='student' AND account_status='active' LIMIT 1", [studentId, req.user.schoolId]);
    if (!students.length) throw createError('The student was not found in this school.', 404);
    const [source, target] = await Promise.all([
      findOwnedSection(req.user.schoolId, sourceSectionId, database),
      findOwnedSection(req.user.schoolId, targetSectionId, database)
    ]);
    assertMoveSections(source, target);
    const [enrollments] = await database.execute(
      `SELECT section_students.section_id AS sectionId FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id AND sections.school_id = section_students.school_id
      WHERE section_students.school_id = ? AND section_students.student_user_id = ?
        AND section_students.withdrawn_at IS NULL AND sections.academic_year_id = ?`,
      [req.user.schoolId, studentId, source.academicYearId]
    );
    if (enrollments.length !== 1 || Number(enrollments[0].sectionId) !== sourceSectionId) {
      throw createError('The student’s active enrollment has changed. Reload and review the move again.', 409);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ studentId, studentName: students[0].displayName,
      source: { id: source.id, name: source.name, gradeLevelName: source.gradeLevelName, strandName: source.strandName },
      target: { id: target.id, name: target.name, gradeLevelName: target.gradeLevelName, strandName: target.strandName },
      ...(await getMoveImpact(database, req.user.schoolId, studentId, source)) });
  } catch (error) { next(error); }
}

async function moveStudent(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sourceSectionId = parseId(req.params.sectionId, 'source section ID');
    const studentId = parseId(req.params.studentId, 'student ID');
    const targetSectionId = parseId(req.body.targetSectionId, 'target section ID');
    if (sourceSectionId === targetSectionId) throw createError('Choose a different target section.');

    await connection.beginTransaction();
    transactionStarted = true;
    const [students] = await connection.execute("SELECT id, display_name AS displayName FROM users WHERE id=? AND school_id=? AND role='student' AND account_status='active' LIMIT 1 FOR UPDATE", [studentId, req.user.schoolId]);
    if (!students.length) throw createError('The student was not found in this school.', 404);
    const [lockedSections] = await connection.execute('SELECT id FROM sections WHERE id IN (?, ?) AND school_id = ? ORDER BY id FOR UPDATE', [sourceSectionId, targetSectionId, req.user.schoolId]);
    if (lockedSections.length !== 2) throw createError('Both sections must be active sections from this school.', 404);
    const source = await findOwnedSection(req.user.schoolId, sourceSectionId, connection);
    const target = await findOwnedSection(req.user.schoolId, targetSectionId, connection);
    assertMoveSections(source, target);

    const [sourceEnrollment] = await connection.execute('SELECT id FROM section_students WHERE section_id=? AND student_user_id=? AND withdrawn_at IS NULL LIMIT 1', [sourceSectionId, studentId]);
    if (!sourceEnrollment.length) throw createError('The student is not enrolled in the source section.', 404);
    const [targetEnrollment] = await connection.execute('SELECT id FROM section_students WHERE section_id=? AND student_user_id=? AND withdrawn_at IS NULL LIMIT 1', [targetSectionId, studentId]);
    if (targetEnrollment.length) throw createError('The student is already enrolled in the target section.', 409);
    const [activeYearEnrollments] = await connection.execute(
      `SELECT section_students.section_id AS sectionId FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id AND sections.school_id = section_students.school_id
      WHERE section_students.school_id = ? AND section_students.student_user_id = ?
        AND section_students.withdrawn_at IS NULL AND sections.academic_year_id = ? FOR UPDATE`,
      [req.user.schoolId, studentId, source.academicYearId]
    );
    if (activeYearEnrollments.length !== 1 || Number(activeYearEnrollments[0].sectionId) !== sourceSectionId) {
      throw createError('The student’s active enrollment has changed. Reload and review the move again.', 409);
    }

    await connection.execute('UPDATE section_students SET withdrawn_at = NOW() WHERE id = ?', [sourceEnrollment[0].id]);
    const [newEnrollment] = await connection.execute('INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)', [req.user.schoolId, targetSectionId, studentId]);
    const [receivingTeachers] = await connection.execute(
      `SELECT DISTINCT teachers.id AS userId FROM users AS teachers
      WHERE teachers.school_id = ? AND teachers.role = 'teacher' AND teachers.account_status = 'active'
        AND (teachers.id = ? OR EXISTS (
          SELECT 1 FROM section_teachers AS assignments
          WHERE assignments.school_id = ? AND assignments.section_id = ?
            AND assignments.teacher_user_id = teachers.id
        ))`,
      [req.user.schoolId, target.adviserUserId || 0, req.user.schoolId, targetSectionId]
    );
    const transferEventKey = `student_transfer:${newEnrollment.insertId}`;
    const notificationMessage = `${students[0].displayName} was transferred from ${source.name} to ${target.name}.`;
    const notificationTarget = `/views/teacher/edugnay-teacher-sections.html?sectionId=${encodeURIComponent(String(targetSectionId))}`;
    for (const teacher of receivingTeachers) {
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, target_path, event_key)
        VALUES (?, 'student_transfer', 'New student in your section', ?, ?, ?)
        ON DUPLICATE KEY UPDATE event_key = event_key`,
        [teacher.userId, notificationMessage, notificationTarget, transferEventKey]
      );
    }
    await writeAuditLog(connection, req, 'student_moved', 'section_student', studentId, { summary: `${students[0].displayName} · ${source.name} → ${target.name}` });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ sourceSectionId, targetSectionId, studentId });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') error = createError('This student is already enrolled in the target section.', 409);
    next(error);
  } finally { connection.release(); }
}

async function withdrawStudent(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const studentId = parseId(req.params.studentId, 'student ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const [lockedStudents] = await connection.execute('SELECT id FROM users WHERE id = ? AND school_id = ? AND role = ? FOR UPDATE', [studentId, req.user.schoolId, 'student']);
    if (!lockedStudents.length) throw createError('The student was not found in this school.', 404);
    const [lockedSections] = await connection.execute('SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE', [sectionId, req.user.schoolId]);
    if (!lockedSections.length) throw createError('Section not found.', 404);
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section) throw createError('Section not found.', 404);
    assertSectionYearWritable(section);
    const [students] = await connection.execute("SELECT display_name AS displayName FROM users WHERE id = ? AND school_id = ? AND role = 'student' LIMIT 1", [studentId, req.user.schoolId]);
    const [result] = await connection.execute('UPDATE section_students SET withdrawn_at = NOW() WHERE section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL', [sectionId, studentId]);
    if (!result.affectedRows) throw createError('Active student enrollment was not found.', 404);
    await writeAuditLog(connection, req, 'student_withdrawn', 'section_student', studentId, { summary: `${students[0]?.displayName || 'Student'} · ${section.name}` });
    await connection.commit();
    transactionStarted = false;
    res.status(204).send();
  } catch (error) { if (transactionStarted) { try { await connection.rollback(); } catch {} } next(error); } finally { connection.release(); }
}

async function listSectionTeachers(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const section = await findAccessibleSection(req, sectionId);
    if (!section) throw createError('Section not found.', 404);
    const [teachers] = await getDatabase().execute('SELECT section_teachers.id AS assignmentId, teachers.id AS teacherId, teachers.display_name AS teacherName, teachers.school_email AS teacherEmail, teachers.initials, teachers.avatar_filename AS avatarFilename, teachers.avatar_version AS avatarVersion, subjects.id AS subjectId, subjects.subject_code AS subjectCode, subjects.name AS subjectName FROM section_teachers INNER JOIN users AS teachers ON teachers.id = section_teachers.teacher_user_id INNER JOIN subjects ON subjects.id = section_teachers.subject_id WHERE section_teachers.section_id = ? ORDER BY teachers.last_name, subjects.name', [sectionId]);
    res.json({ section: formatSection(section), teachers: teachers.map(({ avatarFilename, avatarVersion, ...teacher }) => ({
      ...teacher, ...avatarFields({ id: teacher.teacherId, avatarFilename, avatarVersion })
    })) });
  } catch (error) { next(error); }
}

async function assignTeacher(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const teacherId = parseId(req.body.teacherId, 'teacher ID');
    const subjectId = parseId(req.body.subjectId, 'subject ID');
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section || section.status !== 'active') throw createError('An active section was not found.', 404);
    assertShsPlacementReviewed(section);
    const [teachers] = await connection.execute("SELECT id, display_name AS displayName FROM users WHERE id=? AND school_id=? AND role='teacher' AND account_status='active' LIMIT 1", [teacherId, req.user.schoolId]);
    const [subjects] = await connection.execute(
      `SELECT subjects.id, subjects.name, subjects.shs_grading_group AS shsGradingGroup
      FROM subjects WHERE subjects.id = ? AND subjects.school_id = ? AND subjects.is_active = TRUE
        AND (subjects.school_level_id IS NULL OR subjects.school_level_id = ?)
        AND EXISTS (
          SELECT 1 FROM subject_grade_scopes AS scopes
          WHERE scopes.school_id = subjects.school_id AND scopes.subject_id = subjects.id
            AND scopes.grade_level_id = ?
            AND (scopes.track_id IS NULL OR scopes.track_id = ?)
            AND (scopes.strand_id IS NULL OR scopes.strand_id = ?)
        ) LIMIT 1`,
      [subjectId, req.user.schoolId, section.schoolLevelId, section.gradeLevelId, section.trackId, section.strandId]
    );
    if (!teachers.length || !subjects.length) throw createError('The teacher or subject is not valid for this section.', 404);
    if (section.schoolLevelCode === 'shs' && !subjects[0].shsGradingGroup) {
      throw createError('Choose a grading type for this SHS subject before assigning it to a section.', 409);
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const [result] = await connection.execute('INSERT INTO section_teachers (school_id, section_id, teacher_user_id, subject_id) VALUES (?, ?, ?, ?)', [req.user.schoolId, sectionId, teacherId, subjectId]);
    await writeAuditLog(connection, req, 'teacher_assigned', 'section_teacher', result.insertId, { summary: `${teachers[0].displayName} · ${section.name} · ${subjects[0].name}` });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ assignmentId: result.insertId, sectionId, teacherId, subjectId });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') return next(createError('This teacher is already assigned to the subject in this section.', 409));
    next(error);
  } finally { connection.release(); }
}

async function removeTeacherAssignment(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const assignmentId = parseId(req.params.assignmentId, 'teacher assignment ID');
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section) throw createError('Section not found.', 404);
    assertSectionYearWritable(section);
    const [assignments] = await connection.execute('SELECT users.display_name AS teacherName, subjects.name AS subjectName FROM section_teachers INNER JOIN users ON users.id = section_teachers.teacher_user_id INNER JOIN subjects ON subjects.id = section_teachers.subject_id WHERE section_teachers.id = ? AND section_teachers.section_id = ? LIMIT 1', [assignmentId, sectionId]);
    if (!assignments.length) throw createError('Teacher assignment was not found.', 404);
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [section.academicYearId, req.user.schoolId]);
    const [scheduled] = await connection.execute(
      `SELECT m.id FROM timetable_meetings m
       JOIN scheduled_classes c ON c.id = m.scheduled_class_id AND c.school_id = m.school_id
       WHERE c.school_id = ? AND c.assignment_id = ? LIMIT 1`,
      [req.user.schoolId, assignmentId]
    );
    if (scheduled.length) throw createError('Remove this subject assignment’s scheduled meetings in Timetables first.', 409);
    const [result] = await connection.execute('DELETE FROM section_teachers WHERE id = ? AND section_id = ?', [assignmentId, sectionId]);
    if (!result.affectedRows) throw createError('Teacher assignment was not found.', 404);
    await writeAuditLog(connection, req, 'teacher_unassigned', 'section_teacher', assignmentId, { summary: `${assignments[0].teacherName} · ${section.name} · ${assignments[0].subjectName}` });
    await connection.commit();
    transactionStarted = false;
    res.status(204).send();
  } catch (error) { if (transactionStarted) { try { await connection.rollback(); } catch {} } next(error); } finally { connection.release(); }
}

async function updateTeacherAssignment(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const assignmentId = parseId(req.params.assignmentId, 'teacher assignment ID');
    const teacherId = parseId(req.body.teacherId, 'teacher ID');
    const section = await findOwnedSection(req.user.schoolId, sectionId, connection);
    if (!section || section.status !== 'active') throw createError('An active section was not found.', 404);
    assertSectionYearWritable(section);
    assertShsPlacementReviewed(section);
    const [teachers] = await connection.execute("SELECT id, display_name AS displayName FROM users WHERE id=? AND school_id=? AND role='teacher' AND account_status='active' LIMIT 1", [teacherId, req.user.schoolId]);
    if (!teachers.length) throw createError('The teacher was not found in this school.', 404);
    const [currentRows] = await connection.execute('SELECT subjects.name AS subjectName, users.display_name AS previousTeacher FROM section_teachers INNER JOIN users ON users.id = section_teachers.teacher_user_id INNER JOIN subjects ON subjects.id = section_teachers.subject_id WHERE section_teachers.id = ? AND section_teachers.section_id = ? LIMIT 1', [assignmentId, sectionId]);
    if (!currentRows.length) throw createError('Teacher assignment was not found.', 404);
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [section.academicYearId, req.user.schoolId]);
    await assertTeacherScheduleAvailable(connection, req.user.schoolId, section.academicYearId, assignmentId, sectionId, teacherId);
    const [result] = await connection.execute('UPDATE section_teachers SET teacher_user_id=? WHERE id=? AND section_id=?', [teacherId, assignmentId, sectionId]);
    if (!result.affectedRows) throw createError('Teacher assignment was not found.', 404);
    await writeAuditLog(connection, req, 'teacher_assignment_updated', 'section_teacher', assignmentId, { summary: `${currentRows[0].previousTeacher} → ${teachers[0].displayName} · ${section.name} · ${currentRows[0].subjectName}` });
    await connection.commit();
    transactionStarted = false;
    res.json({ assignmentId, sectionId, teacherId });
  } catch (error) {
    if (transactionStarted) { try { await connection.rollback(); } catch {} }
    if (error.code === 'ER_DUP_ENTRY') return next(createError('This teacher is already assigned to the subject in this section.', 409));
    next(error);
  } finally { connection.release(); }
}

module.exports = { assignTeacher, classifySectionStrand, createSection, deleteSection, enrollStudent, enrollStudentsBulk, getSection, getSectionStudentDetails, listSectionStudents, listSectionTeachers, listSections, moveStudent, previewStudentMove, removeTeacherAssignment, updateSection, updateTeacherAssignment, withdrawStudent };
