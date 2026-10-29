async function studentCanAccessJournal(database, schoolId, studentId) {
  const [rows] = await database.execute(
    `SELECT 1 AS eligible FROM section_students AS enrollment
    INNER JOIN users AS student ON student.id = enrollment.student_user_id
      AND student.school_id = enrollment.school_id AND student.role = 'student'
      AND student.account_status = 'active'
    INNER JOIN sections AS section ON section.id = enrollment.section_id
      AND section.school_id = enrollment.school_id AND section.status = 'active'
    INNER JOIN academic_years AS year ON year.id = section.academic_year_id
      AND year.school_id = section.school_id AND year.status = 'active'
    INNER JOIN school_levels AS level ON level.id = section.school_level_id
      AND level.school_id = section.school_id AND level.level_code = 'jhs' AND level.is_enabled = TRUE
    INNER JOIN school_grade_levels AS grade ON grade.id = section.grade_level_id
      AND grade.school_id = section.school_id AND grade.is_enabled = TRUE
    INNER JOIN school_settings AS settings ON settings.school_id = section.school_id
    INNER JOIN school_portal_features AS features ON features.school_id = section.school_id
      AND features.journals_enabled = TRUE
    INNER JOIN journal_subjects AS journal_subject ON journal_subject.school_id = section.school_id
      AND journal_subject.subject_id = settings.journal_subject_id AND journal_subject.is_active = TRUE
    INNER JOIN subjects AS subject ON subject.id = journal_subject.subject_id
      AND subject.school_id = section.school_id AND subject.is_active = TRUE
    INNER JOIN section_teachers AS assignment ON assignment.school_id = section.school_id
      AND assignment.section_id = section.id AND assignment.subject_id = subject.id
    WHERE enrollment.school_id = ? AND enrollment.student_user_id = ?
      AND enrollment.withdrawn_at IS NULL LIMIT 1`,
    [schoolId, studentId]
  );
  return rows.length > 0;
}

module.exports = { studentCanAccessJournal };
