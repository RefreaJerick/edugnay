-- Apply once to an existing database. Fresh installs receive these changes from schema.sql.
ALTER TABLE school_levels
  ADD COLUMN grade_rounding ENUM('round', 'roundup', 'truncate') NOT NULL DEFAULT 'round' AFTER grading_period_type,
  ADD COLUMN passing_grade_threshold DECIMAL(5,2) NOT NULL DEFAULT 75.00 AFTER grade_rounding;

CREATE TABLE IF NOT EXISTS published_final_grades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  final_grade DECIMAL(5,2) NOT NULL,
  published_by_user_id BIGINT UNSIGNED NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_published_final_grades_scope (student_user_id, section_id, subject_id, academic_term_id),
  KEY idx_published_final_grades_section_subject_term (section_id, subject_id, academic_term_id),
  CONSTRAINT fk_published_final_grades_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_published_final_grades_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_published_final_grades_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_published_final_grades_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT,
  CONSTRAINT fk_published_final_grades_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_published_final_grades_publisher FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
