-- Apply once to an existing academix database before enabling parent triggers.
USE academix;

CREATE TABLE IF NOT EXISTS parent_notification_triggers (
  school_id BIGINT UNSIGNED NOT NULL,
  trigger_code VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  threshold TINYINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, trigger_code),
  CONSTRAINT fk_parent_notification_triggers_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_parent_notification_triggers_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE notifications
  ADD COLUMN related_student_user_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN event_key VARCHAR(180) NULL AFTER target_path,
  ADD UNIQUE KEY uq_notifications_recipient_event (user_id, event_key),
  ADD KEY idx_notifications_related_student (related_student_user_id),
  ADD CONSTRAINT fk_notifications_related_student FOREIGN KEY (related_student_user_id) REFERENCES users(id) ON DELETE CASCADE;
