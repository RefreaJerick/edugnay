-- Assign a missing SHS assignment period only when its due date falls within
-- exactly one configured period for that class's school year and school level.
-- Ambiguous assignments and assignments without a due date remain unchanged.

UPDATE assignments AS target
INNER JOIN (
  SELECT assignments.id AS assignment_id, MIN(academic_terms.id) AS academic_term_id
  FROM assignments
  INNER JOIN shs_elective_classes
    ON shs_elective_classes.id = assignments.shs_elective_class_id
    AND shs_elective_classes.school_id = assignments.school_id
  INNER JOIN shs_offerings
    ON shs_offerings.id = shs_elective_classes.offering_id
    AND shs_offerings.school_id = shs_elective_classes.school_id
  INNER JOIN school_grade_levels
    ON school_grade_levels.id = shs_offerings.grade_level_id
    AND school_grade_levels.school_id = shs_offerings.school_id
  INNER JOIN academic_terms
    ON academic_terms.school_id = shs_offerings.school_id
    AND academic_terms.academic_year_id = shs_offerings.academic_year_id
    AND academic_terms.school_level_id = school_grade_levels.school_level_id
    AND DATE(assignments.due_at) BETWEEN academic_terms.planned_start_date
      AND academic_terms.planned_end_date
  WHERE assignments.shs_elective_class_id IS NOT NULL
    AND assignments.section_id IS NULL
    AND assignments.academic_term_id IS NULL
    AND assignments.due_at IS NOT NULL
  GROUP BY assignments.id
  HAVING COUNT(DISTINCT academic_terms.id) = 1
) AS resolved ON resolved.assignment_id = target.id
SET target.academic_term_id = resolved.academic_term_id
WHERE target.academic_term_id IS NULL;
