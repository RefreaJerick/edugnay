-- Keep withdrawn enrollment rows while allowing a student to return to the same section.
-- The NULL marker permits multiple withdrawn rows; active rows remain unique.
ALTER TABLE section_students
  DROP INDEX uq_section_students_active,
  ADD COLUMN active_marker TINYINT GENERATED ALWAYS AS (IF(withdrawn_at IS NULL, 1, NULL)) STORED AFTER withdrawn_at,
  ADD UNIQUE KEY uq_section_students_active (section_id, student_user_id, active_marker);
