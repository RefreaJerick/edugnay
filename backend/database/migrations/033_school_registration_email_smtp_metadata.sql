USE academix;

ALTER TABLE school_registration_email_outbox
  ADD COLUMN smtp_message_id VARCHAR(255) NULL AFTER sent_at,
  ADD COLUMN smtp_response VARCHAR(255) NULL AFTER smtp_message_id;
