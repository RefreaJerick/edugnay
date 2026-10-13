-- Adds an expiring, hashed capability token for reading a registration's current status.
-- Existing school registrations are left unchanged and receive no lookup token.
ALTER TABLE schools
  ADD COLUMN registration_status_token_hash CHAR(64) NULL,
  ADD COLUMN registration_status_token_expires_at DATETIME NULL,
  ADD UNIQUE KEY uq_schools_registration_status_token_hash (registration_status_token_hash);
