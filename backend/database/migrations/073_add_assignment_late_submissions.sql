ALTER TABLE assignments
  ADD COLUMN allow_late_submissions TINYINT(1) NOT NULL DEFAULT 0 AFTER online_submission_enabled;
