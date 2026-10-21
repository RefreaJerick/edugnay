USE academix;

ALTER TABLE narrative_reports
  ADD COLUMN released_at DATETIME NULL AFTER confirmed_at,
  ADD KEY idx_narrative_reports_released (school_id, student_user_id, released_at, report_week_start_date);
