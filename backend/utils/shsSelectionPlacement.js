const SHS_PLACEMENT_ERRORS = {
  missing: 'School staff must assign you to an active Grade 11 or Grade 12 SHS section before you can record electives.',
  duplicate: 'This learner has more than one active SHS section.',
  grade: 'Elective choices are available only for Grade 11 and Grade 12.'
};

async function findStudentShsPlacementRows(db, schoolId, studentId, yearId = null) {
  const [rows] = await db.execute(
    `SELECT s.id AS sectionId, s.name AS sectionName, s.academic_year_id AS yearId, s.grade_level_id AS gradeId,
      g.grade_code AS gradeCode, g.display_name AS gradeName, t.track_code AS trackCode,
      y.label AS schoolYear, y.status AS yearStatus, u.display_name AS studentName,
      DATE_FORMAT(y.start_date, '%Y-%m-%d') AS yearStart, DATE_FORMAT(y.end_date, '%Y-%m-%d') AS yearEnd
     FROM section_students ss JOIN sections s ON s.id = ss.section_id AND s.school_id = ss.school_id
     JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
     JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
     JOIN school_shs_tracks t ON t.id = s.track_id AND t.school_id = s.school_id
     JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = s.school_id
     JOIN users u ON u.id = ss.student_user_id AND u.school_id = ss.school_id
     WHERE ss.school_id = ? AND ss.student_user_id = ? AND ss.withdrawn_at IS NULL
       AND s.status = 'active' AND s.shs_curriculum_code = 'strengthened_2026'
       AND l.level_code = 'shs' AND u.role = 'student' AND u.account_status = 'active'
       AND (? IS NULL OR s.academic_year_id = ?)
     ORDER BY (y.status = 'active') DESC, y.start_date DESC LIMIT 2`,
    [schoolId, studentId, yearId, yearId]
  );
  return rows;
}

function getStudentShsPlacementIssue(rows) {
  if (!rows?.length) return SHS_PLACEMENT_ERRORS.missing;
  if (rows.length > 1 && Number(rows[0].yearId) === Number(rows[1].yearId)) return SHS_PLACEMENT_ERRORS.duplicate;
  if (!['grade-11', 'grade-12'].includes(rows[0].gradeCode)) return SHS_PLACEMENT_ERRORS.grade;
  return null;
}

module.exports = { findStudentShsPlacementRows, getStudentShsPlacementIssue };
