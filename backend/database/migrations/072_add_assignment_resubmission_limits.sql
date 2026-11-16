-- Past file replacements were not recorded; existing submissions start at zero.
ALTER TABLE assignments
  ADD COLUMN max_resubmissions INT UNSIGNED NULL AFTER online_submission_enabled;

ALTER TABLE assignment_submissions
  ADD COLUMN resubmission_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER file_size_bytes;
