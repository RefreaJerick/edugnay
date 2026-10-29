const { getCatalogEntry, matchesCatalogSnapshot } = require('../config/shsApprovedCatalog');

function createError(message, status = 403) { const error = new Error(message); error.status = status; return error; }

function requireShsTeachingEnabled(req, res, next) {
  if (process.env.SHS_SELECTION_ENABLED !== 'true') {
    return res.status(404).json({ message: 'SHS elective teaching is not available.' });
  }
  next();
}

async function getElectiveClass(connection, schoolId, classId, { includeArchived = false, forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ec.id, ec.school_id AS schoolId, ec.offering_id AS offeringId,
      ec.teacher_user_id AS teacherId, ec.class_name AS className, ec.capacity, ec.is_active AS classActive,
      o.academic_year_id AS academicYearId, o.grade_level_id AS gradeLevelId,
      g.school_level_id AS schoolLevelId,
      o.catalog_version AS catalogVersion, o.catalog_code AS catalogCode, o.track_code AS trackCode,
      o.subject_type AS subjectType, o.subject_name AS subjectName,
      o.instructional_hours AS instructionalHours, o.is_active AS offeringActive,
      g.grade_code AS gradeCode, g.display_name AS gradeName, t.display_name AS teacherName,
      t.account_status AS teacherStatus, y.label AS academicYearLabel, y.status AS yearStatus,
      DATE_FORMAT(y.start_date, '%Y-%m-%d') AS yearStartDate,
      DATE_FORMAT(y.end_date, '%Y-%m-%d') AS yearEndDate
     FROM shs_elective_classes ec
     JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
     JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     JOIN users t ON t.id = ec.teacher_user_id AND t.school_id = ec.school_id
     JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
     WHERE ec.school_id = ? AND ec.id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [schoolId, classId]);
  const item = rows[0];
  if (!item || Number(item.schoolId) !== Number(schoolId) || Number(item.id) !== Number(classId)
    || item.yearStatus === 'archived' && !includeArchived) return null;
  const catalogEntry = getCatalogEntry(item.catalogCode);
  const grade = Number(String(item.gradeCode).replace(/^grade-/, ''));
  if (!matchesCatalogSnapshot(catalogEntry, {
    catalogVersion: item.catalogVersion,
    trackCode: item.trackCode,
    subjectType: item.subjectType,
    subjectName: item.subjectName,
    instructionalHours: item.instructionalHours,
    gradeCode: grade
  })) return null;
  return { ...item, catalogGroup: catalogEntry.catalogGroup, clusterCode: catalogEntry.clusterCode,
    clusterName: catalogEntry.clusterName, assessmentGroup: catalogEntry.assessmentGroup };
}

async function assertElectiveTeacher(connection, user, classId, { write = false } = {}) {
  const item = await getElectiveClass(connection, user.schoolId, classId, { includeArchived: true, forUpdate: write });
  if (!item || Number(item.teacherId) !== Number(user.id)) throw createError('Elective class not found.', 404);
  if (write && (item.yearStatus !== 'active' || !item.classActive || !item.offeringActive || item.teacherStatus !== 'active')) {
    throw createError(item.yearStatus !== 'active' ? 'Archived school years are read-only.' : 'This elective class is not currently available for teaching.', 409);
  }
  return item;
}

async function assertElectiveStudent(connection, user, classId, { write = false, allowFormer = false } = {}) {
  const item = await getElectiveClass(connection, user.schoolId, classId, { includeArchived: true });
  if (!item) throw createError('Elective class not found.', 404);
  const [members] = await connection.execute(
    `SELECT withdrawn_at AS withdrawnAt FROM shs_elective_class_students
     WHERE school_id = ? AND elective_class_id = ? AND student_user_id = ?
     ORDER BY id DESC LIMIT 1`, [user.schoolId, classId, user.id]);
  const member = members[0];
  if (!member) throw createError('Elective class not found.', 404);
  if (member.withdrawnAt && !allowFormer) {
    if (write) throw createError('Your elective enrollment is no longer active.', 409);
    throw createError('Elective class not found.', 404);
  }
  if (write && (member.withdrawnAt || item.yearStatus !== 'active' || !item.classActive || !item.offeringActive)) {
    throw createError('Your elective enrollment is no longer active.', 409);
  }
  return { ...item, membershipEndedAt: member.withdrawnAt };
}

async function assertElectiveParent(connection, user, classId, studentId) {
  const item = await getElectiveClass(connection, user.schoolId, classId, { includeArchived: true });
  if (!item) throw createError('Elective class not found.', 404);
  const [links] = await connection.execute(
    `SELECT 1 FROM student_parent_links l
     JOIN shs_elective_class_students m ON m.student_user_id = l.student_user_id AND m.school_id = l.school_id
     WHERE l.school_id = ? AND l.parent_user_id = ? AND l.student_user_id = ?
       AND m.elective_class_id = ? AND m.withdrawn_at IS NULL LIMIT 1`,
    [user.schoolId, user.id, studentId, classId]);
  if (!links.length) throw createError('Elective class not found.', 404);
  return item;
}

async function getElectiveRoster(connection, schoolId, classId, { includeFormer = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT u.id AS studentId, u.display_name AS displayName, u.school_email AS schoolEmail, u.initials,
      u.avatar_filename AS avatarFilename, u.avatar_version AS avatarVersion,
      p.lrn, m.withdrawn_at AS withdrawnAt
     FROM shs_elective_class_students m
     JOIN users u ON u.id = m.student_user_id AND u.school_id = m.school_id AND u.role = 'student'
     LEFT JOIN student_profiles p ON p.user_id = u.id
     WHERE m.school_id = ? AND m.elective_class_id = ? ${includeFormer ? '' : 'AND m.withdrawn_at IS NULL'}
     ORDER BY u.last_name, u.first_name`, [schoolId, classId]);
  return rows;
}

module.exports = {
  assertElectiveParent,
  assertElectiveStudent,
  assertElectiveTeacher,
  getElectiveClass,
  getElectiveRoster,
  requireShsTeachingEnabled
};
