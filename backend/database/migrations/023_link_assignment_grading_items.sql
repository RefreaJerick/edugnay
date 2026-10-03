-- Link graded assignments to their score components after migration 022.
ALTER TABLE assignments
  ADD COLUMN grading_item_id BIGINT UNSIGNED NULL AFTER grading_category_id,
  ADD UNIQUE KEY uq_assignments_tenant_grading_item (school_id, grading_item_id),
  ADD CONSTRAINT fk_assignments_tenant_grading_item
    FOREIGN KEY (school_id, grading_item_id) REFERENCES grading_items(school_id, id) ON DELETE RESTRICT;

-- Link only unambiguous existing pairs. Other graded assignments remain unlinked
-- and are protected by the deletion check until they are reviewed.
UPDATE assignments AS assignments
INNER JOIN (
  SELECT assignmentId, itemId FROM (
    SELECT assignments.id AS assignmentId, items.id AS itemId,
      COUNT(*) OVER (PARTITION BY assignments.id) AS assignmentMatches,
      COUNT(*) OVER (PARTITION BY items.id) AS itemMatches
    FROM assignments
    INNER JOIN grading_items AS items
      ON items.school_id = assignments.school_id
      AND items.section_id = assignments.section_id
      AND items.subject_id = assignments.subject_id
      AND items.academic_term_id = assignments.academic_term_id
      AND items.grading_category_id = assignments.grading_category_id
      AND items.teacher_user_id = assignments.teacher_user_id
      AND items.title = assignments.title
      AND items.max_score = assignments.max_score
  ) AS matches
  WHERE assignmentMatches = 1 AND itemMatches = 1
) AS links ON links.assignmentId = assignments.id
SET assignments.grading_item_id = links.itemId;
