-- Phase 1 is additive: existing SHS test records remain until the explicitly
-- requested, school-scoped cleanup is run. No student or school data is deleted.
ALTER TABLE subjects
  ADD COLUMN shs_subject_type VARCHAR(30) NULL AFTER shs_grading_group,
  ADD COLUMN instructional_hours SMALLINT UNSIGNED NULL AFTER shs_subject_type;

ALTER TABLE sections
  ADD COLUMN shs_curriculum_code VARCHAR(30) NULL AFTER name;

INSERT INTO school_shs_tracks (school_id, school_level_id, track_code, display_name, is_enabled)
SELECT school_levels.school_id, school_levels.id, 'techpro', 'Technical Professional (TechPro)', TRUE
FROM school_levels
WHERE school_levels.level_code = 'shs'
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), is_enabled = TRUE;

UPDATE school_shs_tracks
SET is_enabled = FALSE
WHERE track_code NOT IN ('academic', 'techpro');
