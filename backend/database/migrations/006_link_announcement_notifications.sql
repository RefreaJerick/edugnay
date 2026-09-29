-- Link announcement notifications to their source so permanent deletion cleans them up.
ALTER TABLE notifications
  ADD COLUMN announcement_id BIGINT UNSIGNED NULL AFTER id,
  ADD KEY idx_notifications_announcement (announcement_id),
  ADD CONSTRAINT fk_notifications_announcement
    FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;

-- Backfill only legacy notifications whose title identifies exactly one announcement in the recipient's school.
UPDATE notifications AS notification
INNER JOIN users AS recipient ON recipient.id = notification.user_id
INNER JOIN announcements AS announcement
  ON announcement.school_id = recipient.school_id
  AND announcement.title = notification.message
SET notification.announcement_id = announcement.id
WHERE notification.announcement_id IS NULL
  AND notification.type = 'announcement'
  AND notification.title = 'New announcement'
  AND (
    SELECT COUNT(*)
    FROM announcements AS candidate
    WHERE candidate.school_id = recipient.school_id
      AND candidate.title = notification.message
  ) = 1;
