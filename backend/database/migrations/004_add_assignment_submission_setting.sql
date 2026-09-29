-- Apply once to existing databases so assignment submission availability persists.
ALTER TABLE assignments
  ADD COLUMN online_submission_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER max_score;
