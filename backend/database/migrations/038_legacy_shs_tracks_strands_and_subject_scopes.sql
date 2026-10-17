-- Separate the legacy SHS track currently stored in sections.strand_id from
-- the actual Academic and TVL strands. Existing section values are preserved
-- as track_id, and no strand is inferred for historical sections.
CREATE TABLE IF NOT EXISTS school_shs_strands (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  track_id BIGINT UNSIGNED NOT NULL,
  strand_code VARCHAR(40) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_shs_strands_track_code (track_id, strand_code),
  UNIQUE KEY uq_school_shs_strands_school_id (school_id, id),
  CONSTRAINT fk_school_shs_strands_track
    FOREIGN KEY (track_id) REFERENCES school_shs_tracks(id) ON DELETE CASCADE,
  CONSTRAINT fk_school_shs_strands_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_school_shs_strands_tenant_track
    FOREIGN KEY (school_id, track_id) REFERENCES school_shs_tracks(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO school_shs_strands (school_id, school_level_id, track_id, strand_code, display_name)
SELECT tracks.school_id, tracks.school_level_id, tracks.id, defaults.strand_code, defaults.display_name
FROM school_shs_tracks AS tracks
INNER JOIN (
  SELECT 'academic' AS track_code, 'stem' AS strand_code, 'Science, Technology, Engineering, and Mathematics' AS display_name
  UNION ALL SELECT 'academic', 'abm', 'Accountancy, Business, and Management'
  UNION ALL SELECT 'academic', 'humss', 'Humanities and Social Sciences'
  UNION ALL SELECT 'academic', 'gas', 'General Academic Strand'
  UNION ALL SELECT 'tvl', 'agri-fishery-arts', 'Agri-Fishery Arts'
  UNION ALL SELECT 'tvl', 'home-economics', 'Home Economics'
  UNION ALL SELECT 'tvl', 'ict', 'Information and Communications Technology'
  UNION ALL SELECT 'tvl', 'industrial-arts', 'Industrial Arts'
) AS defaults ON defaults.track_code = tracks.track_code;

ALTER TABLE sections
  DROP FOREIGN KEY fk_sections_strand,
  DROP FOREIGN KEY fk_sections_tenant_track,
  CHANGE COLUMN strand_id track_id BIGINT UNSIGNED NULL,
  ADD COLUMN strand_id BIGINT UNSIGNED NULL AFTER track_id;

-- Recreate the tenant constraints in a separate ALTER so MySQL has released
-- the legacy constraint names before they are reused.
ALTER TABLE sections
  ADD CONSTRAINT fk_sections_track
    FOREIGN KEY (track_id) REFERENCES school_shs_tracks(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sections_tenant_track
    FOREIGN KEY (school_id, track_id) REFERENCES school_shs_tracks(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sections_strand
    FOREIGN KEY (strand_id) REFERENCES school_shs_strands(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sections_tenant_strand
    FOREIGN KEY (school_id, strand_id) REFERENCES school_shs_strands(school_id, id) ON DELETE RESTRICT;

ALTER TABLE subjects
  ADD COLUMN shs_grading_group VARCHAR(40) NULL AFTER grade_level_id;

CREATE TABLE IF NOT EXISTS subject_grade_scopes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  grade_level_id BIGINT UNSIGNED NOT NULL,
  track_id BIGINT UNSIGNED NULL,
  strand_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_grade_scope (school_id, subject_id, grade_level_id, track_id, strand_id),
  KEY idx_subject_grade_scopes_grade (school_id, grade_level_id, track_id, strand_id),
  CONSTRAINT fk_subject_grade_scopes_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_grade_scopes_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_grade_scopes_grade
    FOREIGN KEY (school_id, grade_level_id) REFERENCES school_grade_levels(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_grade_scopes_track
    FOREIGN KEY (school_id, track_id) REFERENCES school_shs_tracks(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_subject_grade_scopes_strand
    FOREIGN KEY (school_id, strand_id) REFERENCES school_shs_strands(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Preserve existing grade placement. Subjects with no specific grade are
-- expanded to the grades in their configured school level, and school-wide
-- subjects are expanded to all configured grades for that school.
INSERT INTO subject_grade_scopes (school_id, subject_id, grade_level_id)
SELECT subjects.school_id, subjects.id, subjects.grade_level_id
FROM subjects WHERE subjects.grade_level_id IS NOT NULL;

INSERT INTO subject_grade_scopes (school_id, subject_id, grade_level_id)
SELECT subjects.school_id, subjects.id, grades.id
FROM subjects
INNER JOIN school_grade_levels AS grades
  ON grades.school_id = subjects.school_id
  AND (subjects.school_level_id IS NULL OR grades.school_level_id = subjects.school_level_id)
WHERE subjects.grade_level_id IS NULL;

UPDATE school_form_template_mappings AS mappings
INNER JOIN school_form_templates AS templates ON templates.id = mappings.school_form_template_id
SET mappings.data_source = 'school_shs_strands.display_name, when available'
WHERE mappings.field_key = 'strand' AND templates.form_code IN ('SF8', 'SF9');
