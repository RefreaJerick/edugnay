-- Requests without selected classes cannot be waiting for review or changes.
-- An empty status can remain if a clear was attempted before migration 057.
-- Keep the request and its history, but return it to the not-recorded state.
UPDATE shs_selection_requests r
SET r.status = 'not_recorded',
    r.revision = r.revision + 1,
    r.decision_reason = NULL,
    r.reviewed_by_user_id = NULL,
    r.reviewed_at = NULL
WHERE (r.status IN ('pending', 'rejected') OR r.status = '')
  AND NOT EXISTS (
    SELECT 1
    FROM shs_selection_request_classes rc
    WHERE rc.school_id = r.school_id
      AND rc.request_id = r.id
  );
