-- Existing users keep the initials fallback until they upload a photo.
ALTER TABLE users
  ADD COLUMN avatar_filename VARCHAR(64) NULL AFTER initials,
  ADD COLUMN avatar_version BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER avatar_filename;
