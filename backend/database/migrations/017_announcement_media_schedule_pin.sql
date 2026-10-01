ALTER TABLE announcements
  ADD COLUMN scheduled_at DATETIME NULL AFTER image_path,
  ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER scheduled_at,
  ADD KEY idx_announcements_due (status, scheduled_at),
  ADD KEY idx_announcements_school_pin (school_id, status, is_pinned, published_at);
