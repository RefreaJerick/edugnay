-- Track approval and rejection messages independently from registration decisions.
USE academix;

CREATE TABLE IF NOT EXISTS school_registration_email_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  decision ENUM('approved', 'rejected') NOT NULL,
  recipient_email VARCHAR(255) NULL,
  school_name VARCHAR(255) NOT NULL,
  administrator_name VARCHAR(220) NOT NULL,
  administrator_login VARCHAR(255) NULL,
  rejection_reason TEXT NULL,
  status ENUM('pending', 'sending', 'sent', 'skipped', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  manual_retries SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claim_token CHAR(36) NULL,
  claimed_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_school_registration_email_ready (status, next_attempt_at, id),
  KEY idx_school_registration_email_claim (status, claimed_at),
  KEY idx_school_registration_email_school (school_id, id),
  CONSTRAINT fk_school_registration_email_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
