USE academix;

ALTER TABLE school_registration_email_outbox
  MODIFY decision ENUM('approved', 'rejected', 'suspended', 'reactivated') NOT NULL;
