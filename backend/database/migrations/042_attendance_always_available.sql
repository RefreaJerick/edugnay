USE academix;

ALTER TABLE school_portal_features
  MODIFY COLUMN attendance_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE school_portal_features
SET attendance_enabled = TRUE
WHERE attendance_enabled <> TRUE;
