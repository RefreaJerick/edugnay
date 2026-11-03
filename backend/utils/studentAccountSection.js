const { isSupportedGradeCode } = require('../config/gradeScope');

async function findStudentAccountSection(connection, schoolId, sectionId, lock = false) {
  if (lock) {
    const [lockedSections] = await connection.execute(
      'SELECT id FROM sections WHERE id = ? AND school_id = ? FOR UPDATE',
      [sectionId, schoolId]
    );
    if (!lockedSections.length) return null;
  }

  const [sections] = await connection.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.name, sections.capacity, sections.status AS sectionStatus,
      sections.shs_curriculum_code AS shsCurriculumCode, sections.strand_id AS strandId,
      academic_years.label AS academicYearLabel, academic_years.status AS academicYearStatus,
      school_levels.level_code AS schoolLevelCode, school_levels.is_enabled AS levelEnabled,
      school_grade_levels.grade_code AS gradeCode,
      school_grade_levels.display_name AS gradeLevelName,
      school_grade_levels.is_enabled AS gradeEnabled,
      tracks.track_code AS trackCode
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      AND academic_years.school_id = sections.school_id
    INNER JOIN school_levels ON school_levels.id = sections.school_level_id
      AND school_levels.school_id = sections.school_id
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
    LEFT JOIN school_shs_tracks AS tracks ON tracks.id = sections.track_id
      AND tracks.school_id = sections.school_id
    WHERE sections.id = ? AND sections.school_id = ? LIMIT 1`,
    [sectionId, schoolId]
  );
  return sections[0] || null;
}

function isValidStudentAccountSection(section) {
  if (!section || section.sectionStatus !== 'active' || section.academicYearStatus !== 'active'
    || !Boolean(section.levelEnabled) || !Boolean(section.gradeEnabled)
    || !isSupportedGradeCode(section.gradeCode)) return false;

  const needsCurriculumSetup = section.schoolLevelCode === 'shs'
    && (section.shsCurriculumCode !== 'strengthened_2026'
      || !['academic', 'techpro'].includes(section.trackCode)
      || section.strandId !== null);
  return !needsCurriculumSetup;
}

async function hasStudentSectionCapacity(connection, section, additionalStudents = 1) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS studentCount FROM section_students
    WHERE school_id = ? AND section_id = ? AND withdrawn_at IS NULL`,
    [section.schoolId, section.id]
  );
  return Number(row?.studentCount || 0) + additionalStudents <= Number(section.capacity);
}

module.exports = { findStudentAccountSection, hasStudentSectionCapacity, isValidStudentAccountSection };
