const { getDatabase } = require('../config/database');

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

function getPlatformSchoolId(req) {
  if (req.user.role !== 'platform_admin' || !req.query.schoolId) return null;
  return parseId(req.query.schoolId, 'school ID');
}

function sectionSelect() {
  return `SELECT
    sections.id,
    sections.school_id AS schoolId,
    sections.academic_year_id AS academicYearId,
    sections.school_level_id AS schoolLevelId,
    sections.grade_level_id AS gradeLevelId,
    sections.name,
    sections.capacity,
    sections.adviser_user_id AS adviserUserId,
    sections.status,
    academic_years.label AS academicYearLabel,
    school_levels.level_code AS schoolLevelCode,
    school_levels.display_name AS schoolLevelName,
    school_grade_levels.grade_code AS gradeCode,
    school_grade_levels.display_name AS gradeLevelName,
    adviser.display_name AS adviserName,
    (
      SELECT COUNT(*)
      FROM section_students
      WHERE section_students.section_id = sections.id
        AND section_students.withdrawn_at IS NULL
    ) AS studentCount
  FROM sections
  INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
  INNER JOIN school_levels ON school_levels.id = sections.school_level_id
  INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
  LEFT JOIN users AS adviser ON adviser.id = sections.adviser_user_id`;
}

function getAccessFilter(req) {
  if (req.user.role === 'platform_admin') {
    const schoolId = getPlatformSchoolId(req);
    return schoolId ? { sql: 'sections.school_id = ?', values: [schoolId] } : { sql: '', values: [] };
  }

  if (req.user.role === 'school_admin') {
    return { sql: 'sections.school_id = ?', values: [req.user.schoolId] };
  }

  if (req.user.role === 'teacher') {
    return {
      sql: `(sections.adviser_user_id = ? OR EXISTS (
        SELECT 1 FROM section_teachers
        WHERE section_teachers.section_id = sections.id
          AND section_teachers.teacher_user_id = ?
      ))`,
      values: [req.user.id, req.user.id]
    };
  }

  if (req.user.role === 'student') {
    return {
      sql: `EXISTS (
        SELECT 1 FROM section_students
        WHERE section_students.section_id = sections.id
          AND section_students.student_user_id = ?
          AND section_students.withdrawn_at IS NULL
      )`,
      values: [req.user.id]
    };
  }

  if (req.user.role === 'parent') {
    return {
      sql: `EXISTS (
        SELECT 1
        FROM section_students
        INNER JOIN student_parent_links
          ON student_parent_links.student_user_id = section_students.student_user_id
        WHERE section_students.section_id = sections.id
          AND section_students.withdrawn_at IS NULL
          AND student_parent_links.parent_user_id = ?
      )`,
      values: [req.user.id]
    };
  }

  return { sql: '1 = 0', values: [] };
}

function formatSection(row) {
  return {
    id: row.id,
    schoolId: row.schoolId,
    academicYearId: row.academicYearId,
    academicYearLabel: row.academicYearLabel,
    schoolLevelId: row.schoolLevelId,
    schoolLevelCode: row.schoolLevelCode,
    schoolLevelName: row.schoolLevelName,
    gradeLevelId: row.gradeLevelId,
    gradeCode: row.gradeCode,
    gradeLevelName: row.gradeLevelName,
    name: row.name,
    capacity: row.capacity,
    studentCount: Number(row.studentCount),
    adviserUserId: row.adviserUserId,
    adviserName: row.adviserName,
    status: row.status
  };
}

async function findAccessibleSection(req, sectionId) {
  const access = getAccessFilter(req);
  const where = ['sections.id = ?'];
  const values = [sectionId];
  if (access.sql) {
    where.push(access.sql);
    values.push(...access.values);
  }

  const database = getDatabase();
  const [sections] = await database.execute(
    `${sectionSelect()} WHERE ${where.join(' AND ')} LIMIT 1`,
    values
  );
  return sections[0] || null;
}

async function listSections(req, res, next) {
  try {
    const access = getAccessFilter(req);
    const where = access.sql ? ` WHERE ${access.sql}` : '';
    const database = getDatabase();
    const [sections] = await database.execute(
      `${sectionSelect()}${where} ORDER BY school_grade_levels.sort_order, sections.name`,
      access.values
    );

    res.status(200).json({ sections: sections.map(formatSection) });
  } catch (error) {
    next(error);
  }
}

async function getSection(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const section = await findAccessibleSection(req, sectionId);
    if (!section) throw createError('Section not found.', 404);

    res.status(200).json({ section: formatSection(section) });
  } catch (error) {
    next(error);
  }
}

async function listSectionStudents(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const section = await findAccessibleSection(req, sectionId);
    if (!section) throw createError('Section not found.', 404);

    const database = getDatabase();
    const where = ['section_students.section_id = ?', 'section_students.withdrawn_at IS NULL'];
    const values = [sectionId];

    if (req.user.role === 'student') {
      where.push('students.id = ?');
      values.push(req.user.id);
    }
    if (req.user.role === 'parent') {
      where.push(`EXISTS (
        SELECT 1 FROM student_parent_links
        WHERE student_parent_links.student_user_id = students.id
          AND student_parent_links.parent_user_id = ?
      )`);
      values.push(req.user.id);
    }

    const [students] = await database.execute(
      `SELECT
        students.id,
        students.display_name AS displayName,
        students.initials,
        student_profiles.lrn
      FROM section_students
      INNER JOIN users AS students ON students.id = section_students.student_user_id
      INNER JOIN student_profiles ON student_profiles.user_id = students.id
      WHERE ${where.join(' AND ')}
      ORDER BY students.last_name, students.first_name`,
      values
    );

    res.status(200).json({
      section: formatSection(section),
      students: students.map(student => ({
        id: student.id,
        displayName: student.displayName,
        initials: student.initials,
        lrn: student.lrn
      }))
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSection, listSectionStudents, listSections };
