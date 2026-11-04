USE academix;

ALTER TABLE school_settings
  ADD COLUMN accent_palette VARCHAR(24) NOT NULL DEFAULT 'default-blue' AFTER journal_subject_id;
