ALTER TABLE audit_logs
  ADD INDEX idx_audit_logs_meeting_history (school_id, entity_type, entity_id, id);
