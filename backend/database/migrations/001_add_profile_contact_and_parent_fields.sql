-- Run once in phpMyAdmin after the original schema.sql has already been created.
-- This keeps existing school-admin and parent profile records intact.

ALTER TABLE school_admin_profiles
  ADD COLUMN contact_number VARCHAR(30) NULL AFTER employee_number;

ALTER TABLE parent_profiles
  ADD COLUMN sex VARCHAR(20) NULL AFTER has_no_maiden_name,
  ADD COLUMN religion VARCHAR(120) NULL AFTER sex;
