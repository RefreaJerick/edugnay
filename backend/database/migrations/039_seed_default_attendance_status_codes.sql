USE academix;

-- Add the built-in attendance codes only for schools that have no codes yet.
-- Existing school-specific rows are preserved unchanged.
INSERT INTO attendance_status_codes
  (school_id, code, display_name, description, display_key, display_tone, is_active)
SELECT schools.id, default_codes.code, default_codes.display_name,
  default_codes.description, default_codes.display_key, default_codes.display_tone, TRUE
FROM schools
CROSS JOIN (
  SELECT 'present' AS code, 'Present' AS display_name,
    'Student attended class.' AS description, 'P' AS display_key, 'present' AS display_tone
  UNION ALL SELECT 'absent', 'Absent', 'Student did not attend class.', 'A', 'absent'
  UNION ALL SELECT 'late', 'Late', 'Student arrived after attendance was taken.', 'L', 'late'
  UNION ALL SELECT 'excused', 'Excused', 'Student absence has a recorded excuse.', 'E', 'excused'
) AS default_codes
WHERE NOT EXISTS (
  SELECT 1 FROM attendance_status_codes AS existing_codes
  WHERE existing_codes.school_id = schools.id
);
