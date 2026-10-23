USE academix;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  endpoint VARCHAR(2048) NOT NULL,
  endpoint_hash BINARY(32) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth_key VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_session FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_push_deliveries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT UNSIGNED NOT NULL,
  subscription_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claim_token CHAR(36) NULL,
  claimed_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_delivery (notification_id, subscription_id),
  KEY idx_push_delivery_ready (status, next_attempt_at, id),
  KEY idx_push_delivery_claim (status, claimed_at),
  CONSTRAINT fk_push_delivery_notice FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_delivery_subscription FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TRIGGER notifications_push_queue AFTER INSERT ON notifications
FOR EACH ROW INSERT INTO notification_push_deliveries (notification_id, subscription_id)
SELECT NEW.id, subscriptions.id FROM push_subscriptions AS subscriptions
INNER JOIN user_sessions AS sessions ON sessions.id = subscriptions.session_id
  AND sessions.user_id = subscriptions.user_id AND sessions.expires_at > NOW()
WHERE subscriptions.user_id = NEW.user_id;
