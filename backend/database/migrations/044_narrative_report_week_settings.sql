USE academix;

ALTER TABLE school_settings
  ADD COLUMN narrative_report_week_start_day TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER journal_subject_id,
  ADD COLUMN narrative_report_week_end_day TINYINT UNSIGNED NOT NULL DEFAULT 6 AFTER narrative_report_week_start_day;

ALTER TABLE narrative_reports
  ADD COLUMN report_week_start_date DATE NULL AFTER academic_term_id,
  ADD COLUMN report_week_end_date DATE NULL AFTER report_week_start_date;
