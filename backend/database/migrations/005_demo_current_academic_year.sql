-- Demo-data migration for QR attendance testing as of 2026-09-27.
-- Apply only to the local Academix demo database. Replace these example dates
-- with the school's approved calendar before using this setup for a real school.

USE academix;

START TRANSACTION;

SET @demo_school_id = (SELECT id FROM schools WHERE school_code = 'scc' LIMIT 1);
SET @previous_year_id = (SELECT id FROM academic_years WHERE school_id = @demo_school_id AND label = '2025-2026' LIMIT 1);
SET @school_admin_id = (SELECT id FROM users WHERE school_id = @demo_school_id AND role = 'school_admin' ORDER BY id LIMIT 1);

INSERT INTO academic_years (school_id, label, start_date, end_date, status)
SELECT @demo_school_id, '2026-2027', '2026-05-01', '2027-04-30', 'upcoming'
WHERE @demo_school_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE school_id = @demo_school_id AND label = '2026-2027'
  );

SET @current_year_id = (
  SELECT id FROM academic_years
  WHERE school_id = @demo_school_id AND label = '2026-2027'
  LIMIT 1
);

-- Retire the old sections while their academic year is still open.
UPDATE sections
SET status = 'archived'
WHERE school_id = @demo_school_id
  AND academic_year_id = @previous_year_id
  AND status = 'active';

-- Record completion actions before closing the previous active terms.
INSERT INTO academic_term_actions (academic_term_id, action_type, performed_by_user_id, performed_at)
SELECT terms.id, 'completed', @school_admin_id, CURRENT_TIMESTAMP
FROM academic_terms AS terms
WHERE terms.academic_year_id = @previous_year_id
  AND terms.status = 'active'
  AND @school_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM academic_term_actions AS actions
    WHERE actions.academic_term_id = terms.id AND actions.action_type = 'completed'
  );

UPDATE academic_terms
SET status = 'closed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
WHERE academic_year_id = @previous_year_id AND status = 'active';

UPDATE academic_years
SET status = 'closed'
WHERE id = @previous_year_id AND status = 'active';

-- The 2026-2027 dates below are a demo calendar. Quarter 2 and Semester 1
-- include September 27, 2026, the current demo date.
UPDATE academic_years AS target
SET status = 'active'
WHERE target.id = @current_year_id
  AND target.status IN ('upcoming', 'active')
  AND NOT EXISTS (
    SELECT 1 FROM academic_years AS other_year
    WHERE other_year.school_id = target.school_id
      AND other_year.status = 'active'
      AND other_year.id <> target.id
  );

INSERT INTO academic_terms (
  academic_year_id, school_level_id, name, sequence_number,
  planned_start_date, planned_end_date, status, activated_at, completed_at
)
SELECT @current_year_id, levels.id, periods.name, periods.sequence_number,
  periods.planned_start_date, periods.planned_end_date, periods.term_status,
  CASE WHEN periods.term_status IN ('active', 'closed') THEN TIMESTAMP(periods.planned_start_date, '08:00:00') ELSE NULL END,
  CASE WHEN periods.term_status = 'closed' THEN TIMESTAMP(periods.planned_end_date, '17:00:00') ELSE NULL END
FROM school_levels AS levels
INNER JOIN (
  SELECT 'elementary' AS level_code, 'Quarter 1' AS name, 1 AS sequence_number, '2026-05-01' AS planned_start_date, '2026-07-31' AS planned_end_date, 'closed' AS term_status
  UNION ALL SELECT 'elementary', 'Quarter 2', 2, '2026-08-01', '2026-10-31', 'active'
  UNION ALL SELECT 'elementary', 'Quarter 3', 3, '2026-11-01', '2027-01-31', 'upcoming'
  UNION ALL SELECT 'elementary', 'Quarter 4', 4, '2027-02-01', '2027-04-30', 'upcoming'
  UNION ALL SELECT 'jhs', 'Quarter 1', 1, '2026-05-01', '2026-07-31', 'closed'
  UNION ALL SELECT 'jhs', 'Quarter 2', 2, '2026-08-01', '2026-10-31', 'active'
  UNION ALL SELECT 'jhs', 'Quarter 3', 3, '2026-11-01', '2027-01-31', 'upcoming'
  UNION ALL SELECT 'jhs', 'Quarter 4', 4, '2027-02-01', '2027-04-30', 'upcoming'
  UNION ALL SELECT 'shs', 'Semester 1', 1, '2026-05-01', '2026-10-31', 'active'
  UNION ALL SELECT 'shs', 'Semester 2', 2, '2026-11-01', '2027-04-30', 'upcoming'
) AS periods ON periods.level_code = levels.level_code
WHERE levels.school_id = @demo_school_id
  AND @current_year_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM academic_terms AS existing_term
    WHERE existing_term.academic_year_id = @current_year_id
      AND existing_term.school_level_id = levels.id
      AND existing_term.sequence_number = periods.sequence_number
  );

INSERT INTO academic_term_actions (academic_term_id, action_type, performed_by_user_id, performed_at)
SELECT terms.id, 'activated', @school_admin_id, terms.activated_at
FROM academic_terms AS terms
WHERE terms.academic_year_id = @current_year_id
  AND terms.activated_at IS NOT NULL
  AND @school_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM academic_term_actions AS actions
    WHERE actions.academic_term_id = terms.id AND actions.action_type = 'activated'
  );

INSERT INTO academic_term_actions (academic_term_id, action_type, performed_by_user_id, performed_at)
SELECT terms.id, 'completed', @school_admin_id, terms.completed_at
FROM academic_terms AS terms
WHERE terms.academic_year_id = @current_year_id
  AND terms.completed_at IS NOT NULL
  AND @school_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM academic_term_actions AS actions
    WHERE actions.academic_term_id = terms.id AND actions.action_type = 'completed'
  );

UPDATE school_settings
SET current_school_year_label = '2026-2027'
WHERE school_id = @demo_school_id;

-- Keep the old section and all records attached to it for historical review.
INSERT INTO sections (
  school_id, academic_year_id, school_level_id, grade_level_id,
  name, capacity, adviser_user_id, status
)
SELECT @demo_school_id, @current_year_id, school_levels.id, school_grade_levels.id,
  'St. Matthew', 40, previous_section.adviser_user_id, 'active'
FROM school_levels
INNER JOIN school_grade_levels ON school_grade_levels.school_level_id = school_levels.id
INNER JOIN sections AS previous_section
  ON previous_section.school_id = @demo_school_id
  AND previous_section.academic_year_id = @previous_year_id
  AND previous_section.name = 'St. Matthew'
  AND previous_section.grade_level_id = school_grade_levels.id
WHERE school_levels.school_id = @demo_school_id
  AND school_levels.level_code = 'jhs'
  AND school_grade_levels.grade_code = 'grade-7'
  AND @current_year_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sections AS existing_section
    WHERE existing_section.academic_year_id = @current_year_id
      AND existing_section.grade_level_id = school_grade_levels.id
      AND existing_section.name = 'St. Matthew'
  );

SET @current_section_id = (
  SELECT id FROM sections
  WHERE school_id = @demo_school_id AND academic_year_id = @current_year_id
    AND name = 'St. Matthew'
  LIMIT 1
);

INSERT INTO section_students (section_id, student_user_id)
SELECT @current_section_id, enrollments.student_user_id
FROM section_students AS enrollments
INNER JOIN sections AS previous_section ON previous_section.id = enrollments.section_id
WHERE previous_section.academic_year_id = @previous_year_id
  AND previous_section.name = 'St. Matthew'
  AND enrollments.withdrawn_at IS NULL
  AND @current_section_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM section_students AS existing_enrollment
    WHERE existing_enrollment.section_id = @current_section_id
      AND existing_enrollment.student_user_id = enrollments.student_user_id
  );

INSERT INTO section_teachers (section_id, teacher_user_id, subject_id)
SELECT @current_section_id, assignments.teacher_user_id, assignments.subject_id
FROM section_teachers AS assignments
INNER JOIN sections AS previous_section ON previous_section.id = assignments.section_id
WHERE previous_section.academic_year_id = @previous_year_id
  AND previous_section.name = 'St. Matthew'
  AND @current_section_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM section_teachers AS existing_assignment
    WHERE existing_assignment.section_id = @current_section_id
      AND existing_assignment.teacher_user_id = assignments.teacher_user_id
      AND existing_assignment.subject_id = assignments.subject_id
  );

COMMIT;
