USE academix;

ALTER TABLE narrative_reports
  ADD COLUMN ai_model VARCHAR(100) NULL AFTER teacher_note,
  ADD COLUMN ai_follow_up_suggestion TEXT NULL AFTER teacher_edited_summary;
