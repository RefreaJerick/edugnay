-- For the partially migrated database only. The first three ALTER TABLE
-- statements of migration 054 already succeeded before the duplicate
-- student_scores.school_id error. Do not run this on a fresh database or twice.
-- Back up the database first. Keep SHS_SELECTION_ENABLED=false.

ALTER TABLE assignments
  DROP CONSTRAINT ck_elective_assignment_ungraded,
  ADD CONSTRAINT ck_elective_assignment_grading_scope CHECK (
    shs_elective_class_id IS NULL
    OR (grading_category_id IS NULL AND
      (grading_item_id IS NULL OR (academic_term_id IS NOT NULL AND max_score IS NOT NULL)))
  );

ALTER TABLE shs_verified_prior_electives
  ADD COLUMN final_grade DECIMAL(5,2) NULL AFTER instructional_hours,
  ADD COLUMN grade_source VARCHAR(500) NULL AFTER final_grade;

CREATE TABLE IF NOT EXISTS shs_completion_confirmations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  grade12_academic_year_id BIGINT UNSIGNED NOT NULL,
  pathway_code VARCHAR(40) NOT NULL,
  evidence_hash CHAR(64) NOT NULL,
  confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_completion_student_year
    (school_id, student_user_id, grade12_academic_year_id),
  CONSTRAINT fk_shs_completion_student FOREIGN KEY (school_id, student_user_id)
    REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_completion_year FOREIGN KEY (school_id, grade12_academic_year_id)
    REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_completion_confirmer FOREIGN KEY (school_id, confirmed_by_user_id)
    REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE shs_completion_confirmations
  ADD COLUMN confirmation_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER evidence_hash,
  ADD COLUMN latest_history_id BIGINT UNSIGNED NULL AFTER confirmation_version;

CREATE TABLE shs_completion_confirmation_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  grade12_academic_year_id BIGINT UNSIGNED NOT NULL,
  pathway_code VARCHAR(40) NOT NULL,
  evidence_hash CHAR(64) NOT NULL,
  evidence_snapshot JSON NOT NULL,
  confirmation_version INT UNSIGNED NOT NULL,
  confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_completion_history_school_id (school_id, id),
  KEY idx_shs_completion_history_student (school_id, student_user_id, grade12_academic_year_id, confirmation_version),
  CONSTRAINT fk_shs_completion_history_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_completion_history_year FOREIGN KEY (school_id, grade12_academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_completion_history_admin FOREIGN KEY (school_id, confirmed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE shs_grade_publication_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  shs_elective_class_id BIGINT UNSIGNED NULL,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  final_grade DECIMAL(5,2) NOT NULL,
  publication_version INT UNSIGNED NOT NULL,
  correction_reason VARCHAR(500) NULL,
  score_snapshot JSON NOT NULL,
  published_by_user_id BIGINT UNSIGNED NOT NULL,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_grade_history_school_id (school_id, id),
  KEY idx_shs_grade_history_scope (school_id, academic_term_id, section_id, subject_id, shs_elective_class_id, publication_version),
  KEY idx_shs_grade_history_student (school_id, student_user_id, academic_term_id),
  CONSTRAINT fk_shs_grade_history_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_section FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_subject FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_term FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_publisher FOREIGN KEY (school_id, published_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grade_history_class FOREIGN KEY (school_id, shs_elective_class_id) REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_shs_grade_history_owner CHECK (
    (shs_elective_class_id IS NOT NULL AND section_id IS NULL AND subject_id IS NULL)
    OR (shs_elective_class_id IS NULL AND section_id IS NOT NULL AND subject_id IS NOT NULL)
  )
) ENGINE=InnoDB;

-- Seed the last snapshot that existed before history tracking was introduced.
INSERT INTO shs_grade_publication_history
  (school_id, section_id, subject_id, shs_elective_class_id, academic_term_id,
   student_user_id, final_grade, publication_version, score_snapshot,
   published_by_user_id, published_at)
SELECT p.school_id, p.section_id, p.subject_id, p.shs_elective_class_id, p.academic_term_id,
  p.student_user_id, p.final_grade, 1, JSON_OBJECT('legacySnapshot', TRUE),
  p.published_by_user_id, p.published_at
FROM published_final_grades p
JOIN sections s ON s.id = p.section_id AND s.school_id = p.school_id
JOIN school_levels l ON l.id = s.school_level_id AND l.school_id = s.school_id
WHERE p.shs_elective_class_id IS NULL AND s.shs_curriculum_code = 'strengthened_2026'
  AND l.level_code = 'shs';

UPDATE published_final_grades current_grade
JOIN shs_grade_publication_history history
  ON history.school_id = current_grade.school_id
  AND history.section_id <=> current_grade.section_id
  AND history.subject_id <=> current_grade.subject_id
  AND history.shs_elective_class_id <=> current_grade.shs_elective_class_id
  AND history.academic_term_id = current_grade.academic_term_id
  AND history.student_user_id = current_grade.student_user_id
  AND history.publication_version = 1
SET current_grade.latest_history_id = history.id,
    current_grade.publication_version = 1;

CREATE TABLE shs_grade_score_corrections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  grading_item_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  old_score DECIMAL(8,2) NULL,
  new_score DECIMAL(8,2) NOT NULL,
  published_history_id BIGINT UNSIGNED NOT NULL,
  publication_version INT UNSIGNED NOT NULL,
  reason VARCHAR(500) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_shs_score_correction_student (school_id, student_user_id, changed_at),
  CONSTRAINT fk_shs_score_correction_item FOREIGN KEY (school_id, grading_item_id) REFERENCES grading_items(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_score_correction_publication FOREIGN KEY (school_id, published_history_id) REFERENCES shs_grade_publication_history(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_score_correction_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_score_correction_actor FOREIGN KEY (school_id, changed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE published_final_grades
  ADD CONSTRAINT fk_published_grade_latest_history FOREIGN KEY (school_id, latest_history_id)
    REFERENCES shs_grade_publication_history(school_id, id) ON DELETE RESTRICT;

ALTER TABLE shs_completion_confirmations
  ADD CONSTRAINT fk_shs_completion_latest_history FOREIGN KEY (school_id, latest_history_id)
    REFERENCES shs_completion_confirmation_history(school_id, id) ON DELETE RESTRICT;
