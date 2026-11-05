USE academix;

ALTER TABLE assignments
  ADD COLUMN published_at DATETIME NULL AFTER due_at;

UPDATE assignments
SET published_at = created_at
WHERE status = 'published' AND published_at IS NULL;
