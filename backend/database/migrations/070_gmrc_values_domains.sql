-- Existing published grades remain unverified until recalculated and republished.
ALTER TABLE grading_items
  ADD COLUMN domain_code VARCHAR(20) NULL AFTER subject_grading_exam_part_id;

ALTER TABLE published_final_grades
  ADD COLUMN domain_rule_version VARCHAR(30) NULL AFTER final_grade;
