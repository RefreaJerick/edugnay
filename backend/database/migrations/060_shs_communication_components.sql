-- Apply manually after migration 059. Existing combined communication records
-- remain unchanged and are marked as legacy for review.

ALTER TABLE section_teachers
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER subject_id,
  ADD UNIQUE KEY uq_section_teachers_communication_component
    (section_id, subject_id, communication_component_code);

ALTER TABLE grading_items
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER shs_exam_part_code,
  ADD KEY idx_grading_item_communication_component
    (school_id, section_id, subject_id, communication_component_code, academic_term_id);

ALTER TABLE assignments
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER subject_id,
  ADD KEY idx_assignments_communication_component
    (school_id, section_id, subject_id, communication_component_code);

ALTER TABLE learning_materials
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER subject_id,
  ADD KEY idx_materials_communication_component
    (school_id, section_id, subject_id, communication_component_code, status);

ALTER TABLE attendance_sessions
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER subject_id,
  ADD COLUMN communication_component_scope_code VARCHAR(20)
    GENERATED ALWAYS AS (COALESCE(communication_component_code, '')) STORED AFTER subject_scope_id,
  DROP INDEX uq_attendance_sessions_scope,
  ADD UNIQUE KEY uq_attendance_sessions_scope
    (section_id, subject_scope_id, communication_component_scope_code, attendance_date);

ALTER TABLE shs_grade_publication_history
  ADD COLUMN communication_component_code VARCHAR(20) NULL AFTER subject_id,
  ADD KEY idx_shs_grade_history_communication_component
    (school_id, section_id, subject_id, communication_component_code, academic_term_id, student_user_id, publication_version);

ALTER TABLE published_final_grades
  ADD COLUMN communication_grade_source VARCHAR(30) NULL AFTER correction_reason;

UPDATE shs_grade_publication_history history
JOIN subjects ON subjects.id = history.subject_id AND subjects.school_id = history.school_id
SET history.communication_component_code = 'legacy_combined'
WHERE subjects.subject_code = 'shs-core-communication'
  AND history.shs_elective_class_id IS NULL;

UPDATE published_final_grades grades
JOIN subjects ON subjects.id = grades.subject_id AND subjects.school_id = grades.school_id
SET grades.communication_grade_source = 'legacy_combined'
WHERE subjects.subject_code = 'shs-core-communication'
  AND grades.shs_elective_class_id IS NULL;

CREATE TABLE shs_communication_component_grades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  communication_component_code VARCHAR(20) NOT NULL,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  final_grade DECIMAL(5,2) NOT NULL,
  publication_version INT UNSIGNED NOT NULL DEFAULT 1,
  latest_history_id BIGINT UNSIGNED NOT NULL,
  correction_reason VARCHAR(500) NULL,
  published_by_user_id BIGINT UNSIGNED NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_comm_component_grade
    (school_id, section_id, subject_id, communication_component_code, academic_term_id, student_user_id),
  UNIQUE KEY uq_shs_comm_component_grade_school_id (school_id, id),
  KEY idx_shs_comm_component_grade_student (school_id, student_user_id, academic_term_id),
  CONSTRAINT fk_shs_comm_component_grade_school FOREIGN KEY (school_id)
    REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_section FOREIGN KEY (school_id, section_id)
    REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_subject FOREIGN KEY (school_id, subject_id)
    REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_term FOREIGN KEY (school_id, academic_term_id)
    REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_student FOREIGN KEY (school_id, student_user_id)
    REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_history FOREIGN KEY (school_id, latest_history_id)
    REFERENCES shs_grade_publication_history(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_comm_component_grade_publisher FOREIGN KEY (school_id, published_by_user_id)
    REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_shs_comm_component_grade_code
    CHECK (communication_component_code IN ('english', 'filipino')),
  CONSTRAINT ck_shs_comm_component_grade_value CHECK (final_grade BETWEEN 0 AND 100)
) ENGINE=InnoDB;
