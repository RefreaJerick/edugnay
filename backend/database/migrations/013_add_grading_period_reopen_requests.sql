-- Apply once to an existing database before using grading-period reopen requests.
USE academix;

CREATE TABLE IF NOT EXISTS grading_period_reopen_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  reason TEXT NOT NULL,
  request_status ENUM('pending', 'approved', 'rejected', 'revoked') NOT NULL DEFAULT 'pending',
  review_note TEXT NULL,
  last_action_note TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  approved_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_gp_reopen_school_status_created (school_id, request_status, created_at),
  KEY idx_gp_reopen_teacher_scope (teacher_user_id, section_id, subject_id, academic_term_id, created_at),
  KEY idx_gp_reopen_scope_status_expiry (school_id, academic_term_id, section_id, subject_id, request_status, expires_at),
  CONSTRAINT chk_gp_reopen_approval_expiry CHECK (request_status <> 'approved' OR expires_at IS NOT NULL),
  CONSTRAINT chk_gp_reopen_review_fields CHECK (
    request_status = 'pending' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT fk_gp_reopen_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gp_reopen_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gp_reopen_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gp_reopen_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gp_reopen_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gp_reopen_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
