-- Existing drafts are unknown. Released reports remain visible to parents.
ALTER TABLE narrative_reports
  ADD COLUMN grade_evidence_used BOOLEAN NULL AFTER ai_follow_up_suggestion;
