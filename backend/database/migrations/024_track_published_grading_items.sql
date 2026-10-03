-- A component is protected once it has contributed to a published final grade.
ALTER TABLE grading_items
  ADD COLUMN used_in_published_grades TINYINT(1) NOT NULL DEFAULT 0 AFTER max_score;

-- Historic publication did not record component IDs. Protect every item that
-- could have been included, including ambiguous same-second creation times.
UPDATE grading_items AS items
SET items.used_in_published_grades = 1
WHERE EXISTS (
  SELECT 1 FROM published_final_grades AS grades
  WHERE grades.school_id = items.school_id
    AND grades.section_id = items.section_id
    AND grades.subject_id = items.subject_id
    AND grades.academic_term_id = items.academic_term_id
    AND items.created_at <= grades.published_at
);
