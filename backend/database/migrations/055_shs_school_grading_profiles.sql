-- Apply manually after migration 054. Do not apply to a database twice.
CREATE TABLE IF NOT EXISTS shs_grading_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  offering_id BIGINT UNSIGNED NULL,
  written_weight TINYINT UNSIGNED NOT NULL,
  performance_weight TINYINT UNSIGNED NOT NULL,
  examination_weight TINYINT UNSIGNED NOT NULL,
  exam_parts JSON NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_grading_core (school_id, academic_year_id, subject_id),
  UNIQUE KEY uq_shs_grading_offering (school_id, academic_year_id, offering_id),
  CONSTRAINT fk_shs_grading_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grading_year FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grading_subject FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grading_offering FOREIGN KEY (school_id, offering_id) REFERENCES shs_offerings(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_grading_actor FOREIGN KEY (school_id, changed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_shs_grading_owner CHECK ((subject_id IS NOT NULL AND offering_id IS NULL) OR (subject_id IS NULL AND offering_id IS NOT NULL)),
  CONSTRAINT ck_shs_grading_weights CHECK (written_weight + performance_weight + examination_weight = 100)
) ENGINE=InnoDB;
