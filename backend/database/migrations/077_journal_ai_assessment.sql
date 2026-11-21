ALTER TABLE school_portal_features
  ADD COLUMN journal_ai_approved_at DATETIME NULL AFTER journals_enabled,
  ADD COLUMN journal_ai_approved_by_user_id BIGINT UNSIGNED NULL AFTER journal_ai_approved_at;

CREATE TABLE journal_ai_rubrics (
  school_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  journal_subject_id BIGINT UNSIGNED NOT NULL,
  criteria JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, teacher_user_id, journal_subject_id),
  CONSTRAINT fk_journal_ai_rubric_teacher FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_journal_ai_rubric_subject FOREIGN KEY (school_id, journal_subject_id) REFERENCES journal_subjects(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE journal_ai_assessments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  assessed_by_user_id BIGINT UNSIGNED NOT NULL,
  rubric_snapshot JSON NOT NULL,
  criterion_scores JSON NOT NULL,
  suggested_score DECIMAL(8,2) NOT NULL,
  max_score_snapshot DECIMAL(8,2) NOT NULL,
  feedback TEXT NOT NULL,
  model VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_journal_ai_entry_latest (school_id, journal_entry_id, id),
  CONSTRAINT fk_journal_ai_assessment_entry FOREIGN KEY (school_id, journal_entry_id) REFERENCES student_journal_entries(school_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_journal_ai_assessment_teacher FOREIGN KEY (school_id, assessed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE journal_ai_daily_usage (
  school_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  call_count INT UNSIGNED NOT NULL DEFAULT 0,
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, usage_date),
  CONSTRAINT fk_journal_ai_usage_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;
