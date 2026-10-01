-- Apply once to an existing academix database before publishing announcements.
USE academix;

CREATE TABLE IF NOT EXISTS announcement_email_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  announcement_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'sending', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claim_token CHAR(36) NULL,
  claimed_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_announcement_email_recipient (announcement_id, user_id),
  KEY idx_announcement_email_ready (status, next_attempt_at, id),
  KEY idx_announcement_email_claim (status, claimed_at),
  CONSTRAINT fk_announcement_email_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_email_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
