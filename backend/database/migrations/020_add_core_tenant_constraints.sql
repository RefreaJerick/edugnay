-- Add tenant ownership to core academic and relationship records.
-- Run only after the tenant isolation audit reports zero mismatches.

ALTER TABLE users
  ADD UNIQUE KEY uq_users_school_id (school_id, id),
  ADD CONSTRAINT chk_users_role_school CHECK (
    (role = 'platform_admin' AND school_id IS NULL)
    OR (role IN ('school_admin', 'teacher', 'student', 'parent') AND school_id IS NOT NULL)
  );

ALTER TABLE academic_years ADD UNIQUE KEY uq_academic_years_school_id (school_id, id);
ALTER TABLE school_levels ADD UNIQUE KEY uq_school_levels_school_id (school_id, id);
ALTER TABLE subjects ADD UNIQUE KEY uq_subjects_school_id (school_id, id);
ALTER TABLE sections ADD UNIQUE KEY uq_sections_school_id (school_id, id);

ALTER TABLE school_grade_levels ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE school_grade_levels AS grades
INNER JOIN school_levels AS levels ON levels.id = grades.school_level_id
SET grades.school_id = levels.school_id;
ALTER TABLE school_grade_levels
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_school_grade_levels_school_id (school_id, id),
  ADD CONSTRAINT fk_school_grade_levels_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE CASCADE;

ALTER TABLE school_shs_tracks ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE school_shs_tracks AS tracks
INNER JOIN school_levels AS levels ON levels.id = tracks.school_level_id
SET tracks.school_id = levels.school_id;
ALTER TABLE school_shs_tracks
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_school_shs_tracks_school_id (school_id, id),
  ADD CONSTRAINT fk_school_shs_tracks_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE CASCADE;

ALTER TABLE academic_terms ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE academic_terms AS terms
INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
SET terms.school_id = years.school_id;
ALTER TABLE academic_terms
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_academic_terms_school_id (school_id, id),
  ADD CONSTRAINT fk_academic_terms_tenant_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_academic_terms_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT;

ALTER TABLE student_parent_links ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE student_parent_links AS links
INNER JOIN users AS students ON students.id = links.student_user_id
SET links.school_id = students.school_id;
ALTER TABLE student_parent_links
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_student_parent_links_tenant_student
    FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_student_parent_links_tenant_parent
    FOREIGN KEY (school_id, parent_user_id) REFERENCES users(school_id, id) ON DELETE CASCADE;

ALTER TABLE section_students ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE section_students AS enrollments
INNER JOIN sections ON sections.id = enrollments.section_id
SET enrollments.school_id = sections.school_id;
ALTER TABLE section_students
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_section_students_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_section_students_tenant_student
    FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE section_teachers ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE section_teachers AS assignments
INNER JOIN sections ON sections.id = assignments.section_id
SET assignments.school_id = sections.school_id;
ALTER TABLE section_teachers
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_section_teachers_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_section_teachers_tenant_teacher
    FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_section_teachers_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT;

ALTER TABLE academic_years
  ADD CONSTRAINT fk_academic_years_tenant_archiver
    FOREIGN KEY (school_id, archived_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;
ALTER TABLE parent_notification_triggers
  ADD CONSTRAINT fk_parent_notification_triggers_tenant_user
    FOREIGN KEY (school_id, updated_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;
ALTER TABLE subjects
  ADD CONSTRAINT fk_subjects_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_subjects_tenant_grade
    FOREIGN KEY (school_id, grade_level_id) REFERENCES school_grade_levels(school_id, id) ON DELETE RESTRICT;
ALTER TABLE school_settings
  ADD CONSTRAINT fk_school_settings_tenant_journal_subject
    FOREIGN KEY (school_id, journal_subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT;
ALTER TABLE sections
  ADD CONSTRAINT fk_sections_tenant_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sections_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sections_tenant_grade
    FOREIGN KEY (school_id, grade_level_id) REFERENCES school_grade_levels(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sections_tenant_track
    FOREIGN KEY (school_id, strand_id) REFERENCES school_shs_tracks(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sections_tenant_adviser
    FOREIGN KEY (school_id, adviser_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;
