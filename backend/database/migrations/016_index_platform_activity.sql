ALTER TABLE audit_logs
  ADD INDEX idx_audit_logs_action_created (action_type, created_at, id);

ALTER TABLE schools
  ADD CONSTRAINT chk_schools_registration_status
  CHECK (registration_status IN ('pending', 'active', 'rejected', 'suspended'));

-- Existing registrations predate platform audit logging. Keep their actor unknown.
INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details, created_at)
SELECT schools.id, NULL, 'school_registration_submitted', 'school', schools.id,
  JSON_OBJECT('summary', schools.name, 'source', 'school_record'), schools.submitted_at
FROM schools
WHERE schools.submitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs AS existing
    WHERE existing.school_id = schools.id AND existing.action_type = 'school_registration_submitted'
  );

INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details, created_at)
SELECT schools.id, NULL, 'school_registration_approved', 'school', schools.id,
  JSON_OBJECT('summary', schools.name, 'source', 'school_record'), schools.approved_at
FROM schools
WHERE schools.approved_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs AS existing
    WHERE existing.school_id = schools.id AND existing.action_type = 'school_registration_approved'
  );

INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details, created_at)
SELECT schools.id, NULL, 'school_registration_rejected', 'school', schools.id,
  JSON_OBJECT('summary', schools.name, 'source', 'school_record'), schools.rejected_at
FROM schools
WHERE schools.rejected_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs AS existing
    WHERE existing.school_id = schools.id AND existing.action_type = 'school_registration_rejected'
  );
