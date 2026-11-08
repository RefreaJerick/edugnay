ALTER TABLE narrative_report_releases
  ADD UNIQUE KEY uq_narrative_release_school_id (school_id, id);

CREATE TABLE school_parent_notification_settings (
  school_id BIGINT UNSIGNED PRIMARY KEY,
  narrative_report_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_parent_notification_settings_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_school_parent_notification_settings_user
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE narrative_report_sms_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  report_release_id BIGINT UNSIGNED NOT NULL,
  parent_user_id BIGINT UNSIGNED NOT NULL,
  recipient_phone VARCHAR(16) NULL,
  recipient_last4 CHAR(4) NULL,
  message_body MEDIUMTEXT NULL,
  status ENUM('pending', 'sending', 'queued', 'sent', 'failed', 'uncertain', 'skipped') NOT NULL DEFAULT 'pending',
  semaphore_message_id VARCHAR(80) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  next_status_check_at DATETIME NULL,
  claim_token CHAR(36) NULL,
  claimed_at DATETIME NULL,
  last_error_code VARCHAR(80) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_report_sms_release_parent (school_id, report_release_id, parent_user_id),
  KEY idx_report_sms_pending (status, next_attempt_at, id),
  KEY idx_report_sms_status_check (status, next_status_check_at, id),
  KEY idx_report_sms_claim (status, claim_token, claimed_at),
  KEY idx_report_sms_school_created (school_id, created_at),
  CONSTRAINT fk_report_sms_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_sms_release
    FOREIGN KEY (school_id, report_release_id) REFERENCES narrative_report_releases(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_sms_parent
    FOREIGN KEY (school_id, parent_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
