-- Add auditable archive metadata to school years.
-- Run once against the Academix database before using the Archive Data page.

USE academix;

ALTER TABLE academic_years
  ADD COLUMN archived_at DATETIME NULL AFTER status,
  ADD COLUMN archived_by_user_id BIGINT UNSIGNED NULL AFTER archived_at,
  ADD COLUMN archive_snapshot JSON NULL AFTER archived_by_user_id;
