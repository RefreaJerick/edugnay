-- Term placement for Strengthened SHS elective classes. NULL means staff review is needed.
ALTER TABLE shs_elective_classes
  ADD COLUMN start_term_id BIGINT UNSIGNED NULL AFTER capacity,
  ADD COLUMN end_term_id BIGINT UNSIGNED NULL AFTER start_term_id,
  ADD CONSTRAINT fk_shs_elective_class_start_term
    FOREIGN KEY (school_id, start_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_shs_elective_class_end_term
    FOREIGN KEY (school_id, end_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT;

-- Published grades identify the class's term only when their terms are consecutive.
UPDATE shs_elective_classes c
JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
JOIN (
  SELECT p.school_id, p.shs_elective_class_id AS class_id,
    MIN(t.sequence_number) AS first_sequence, MAX(t.sequence_number) AS last_sequence,
    COUNT(DISTINCT t.sequence_number) AS term_count,
    COUNT(DISTINCT t.academic_year_id, t.school_level_id) AS scope_count
  FROM published_final_grades p
  JOIN academic_terms t ON t.id = p.academic_term_id AND t.school_id = p.school_id
  WHERE p.shs_elective_class_id IS NOT NULL
  GROUP BY p.school_id, p.shs_elective_class_id
) evidence ON evidence.school_id = c.school_id AND evidence.class_id = c.id
JOIN academic_terms first_term ON first_term.school_id = c.school_id
  AND first_term.academic_year_id = o.academic_year_id
  AND first_term.school_level_id = g.school_level_id
  AND first_term.sequence_number = evidence.first_sequence
JOIN academic_terms last_term ON last_term.school_id = c.school_id
  AND last_term.academic_year_id = o.academic_year_id
  AND last_term.school_level_id = g.school_level_id
  AND last_term.sequence_number = evidence.last_sequence
SET c.start_term_id = first_term.id, c.end_term_id = last_term.id
WHERE evidence.scope_count = 1
  AND evidence.term_count = CAST(evidence.last_sequence AS SIGNED) - CAST(evidence.first_sequence AS SIGNED) + 1
  AND evidence.term_count = CASE
    WHEN g.grade_code = 'grade-11' AND o.subject_type = 'techpro_elective' THEN 3
    WHEN o.subject_type = 'work_immersion' AND o.instructional_hours IN (540, 640) THEN 2
    ELSE 1 END
  AND NOT EXISTS (SELECT 1 FROM scheduled_classes sc
    JOIN timetable_meetings m ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
    WHERE sc.school_id = c.school_id AND sc.shs_elective_class_id = c.id
      AND (m.start_date < first_term.planned_start_date OR m.end_date > last_term.planned_end_date));

-- If there are no published grades, a fully dated timetable can identify a term span.
UPDATE shs_elective_classes c
JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
JOIN (
  SELECT sc.school_id, sc.shs_elective_class_id AS class_id,
    MIN(start_term.sequence_number) AS first_sequence,
    MAX(end_term.sequence_number) AS last_sequence, COUNT(*) AS matched_meetings
  FROM scheduled_classes sc
  JOIN timetable_meetings m ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
  JOIN shs_elective_classes ec ON ec.id = sc.shs_elective_class_id AND ec.school_id = sc.school_id
  JOIN shs_offerings offering ON offering.id = ec.offering_id AND offering.school_id = ec.school_id
  JOIN school_grade_levels grade ON grade.id = offering.grade_level_id AND grade.school_id = offering.school_id
  JOIN academic_terms start_term ON start_term.school_id = sc.school_id
    AND start_term.academic_year_id = offering.academic_year_id
    AND start_term.school_level_id = grade.school_level_id
    AND m.start_date BETWEEN start_term.planned_start_date AND start_term.planned_end_date
  JOIN academic_terms end_term ON end_term.school_id = sc.school_id
    AND end_term.academic_year_id = offering.academic_year_id
    AND end_term.school_level_id = grade.school_level_id
    AND m.end_date BETWEEN end_term.planned_start_date AND end_term.planned_end_date
  WHERE sc.shs_elective_class_id IS NOT NULL
  GROUP BY sc.school_id, sc.shs_elective_class_id
) evidence ON evidence.school_id = c.school_id AND evidence.class_id = c.id
JOIN academic_terms first_term ON first_term.school_id = c.school_id
  AND first_term.academic_year_id = o.academic_year_id
  AND first_term.school_level_id = g.school_level_id
  AND first_term.sequence_number = evidence.first_sequence
JOIN academic_terms last_term ON last_term.school_id = c.school_id
  AND last_term.academic_year_id = o.academic_year_id
  AND last_term.school_level_id = g.school_level_id
  AND last_term.sequence_number = evidence.last_sequence
SET c.start_term_id = first_term.id, c.end_term_id = last_term.id
WHERE c.start_term_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM published_final_grades p WHERE p.school_id = c.school_id
    AND p.shs_elective_class_id = c.id)
  AND evidence.matched_meetings = (SELECT COUNT(*) FROM scheduled_classes sc
    JOIN timetable_meetings m ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
    WHERE sc.school_id = c.school_id AND sc.shs_elective_class_id = c.id)
  AND CAST(evidence.last_sequence AS SIGNED) - CAST(evidence.first_sequence AS SIGNED) + 1 = CASE
    WHEN g.grade_code = 'grade-11' AND o.subject_type = 'techpro_elective' THEN 3
    WHEN o.subject_type = 'work_immersion' AND o.instructional_hours IN (540, 640) THEN 2
    ELSE 1 END;
