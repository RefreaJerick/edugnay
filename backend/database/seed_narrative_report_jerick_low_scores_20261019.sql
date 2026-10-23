-- Development-only low-score fixture for Jerick Refrea, Oct 19-23, 2026.
-- QA School 01 / St. Peter / Values Education. Safe to run again.
USE academix;

SELECT DATABASE() AS selected_database;
SELECT learner.id AS learner_id, learner.display_name, section.id AS section_id,
  section.name AS section_name, subject.id AS subject_id, subject.name AS subject_name,
  term.id AS term_id, term.status AS term_status
FROM users AS learner
JOIN section_students AS roster ON roster.school_id = learner.school_id
  AND roster.student_user_id = learner.id AND roster.section_id = 15
  AND roster.withdrawn_at IS NULL
JOIN sections AS section ON section.id = roster.section_id
  AND section.school_id = roster.school_id AND section.adviser_user_id = 99
JOIN section_teachers AS assignment ON assignment.school_id = section.school_id
  AND assignment.section_id = section.id AND assignment.teacher_user_id = 99
  AND assignment.subject_id = 88
JOIN subjects AS subject ON subject.id = assignment.subject_id
  AND subject.school_id = section.school_id AND subject.is_active = TRUE
JOIN academic_terms AS term ON term.id = 39 AND term.school_id = section.school_id
  AND term.academic_year_id = section.academic_year_id
  AND term.school_level_id = section.school_level_id AND term.status = 'active'
WHERE learner.id = 111 AND learner.school_id = 26 AND learner.role = 'student'
  AND section.id = 15 AND section.school_id = 26 AND section.status = 'active';

START TRANSACTION;

INSERT INTO grading_items (
  school_id, section_id, subject_id, academic_term_id, teacher_user_id,
  title, max_score, recorded_at
)
SELECT 26, 15, 88, 39, 99, fixture.title, 10, fixture.recorded_at
FROM (
  SELECT 'Synthetic QA Low Score 1 - Oct 20, 2026' AS title, '2026-10-20 15:00:00' AS recorded_at
  UNION ALL SELECT 'Synthetic QA Low Score 2 - Oct 21, 2026', '2026-10-21 15:00:00'
  UNION ALL SELECT 'Synthetic QA Low Score 3 - Oct 22, 2026', '2026-10-22 15:00:00'
) AS fixture
JOIN sections AS section ON section.id = 15 AND section.school_id = 26
  AND section.status = 'active' AND section.adviser_user_id = 99
JOIN section_students AS roster ON roster.school_id = section.school_id
  AND roster.section_id = section.id AND roster.student_user_id = 111
  AND roster.withdrawn_at IS NULL
JOIN users AS learner ON learner.id = roster.student_user_id
  AND learner.school_id = 26 AND learner.role = 'student'
JOIN section_teachers AS assignment ON assignment.school_id = section.school_id
  AND assignment.section_id = section.id AND assignment.teacher_user_id = 99
  AND assignment.subject_id = 88
JOIN subjects AS subject ON subject.id = 88 AND subject.school_id = 26
  AND subject.is_active = TRUE
JOIN academic_terms AS term ON term.id = 39 AND term.school_id = 26
  AND term.academic_year_id = section.academic_year_id
  AND term.school_level_id = section.school_level_id AND term.status = 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM grading_items AS existing
  WHERE existing.school_id = 26 AND existing.section_id = 15
    AND existing.subject_id = 88 AND existing.academic_term_id = 39
    AND existing.teacher_user_id = 99 AND existing.title = fixture.title
);

INSERT INTO student_scores (
  school_id, grading_item_id, student_user_id, score, remarks,
  recorded_by_user_id, recorded_at
)
SELECT 26, item.id, 111, fixture.score, 'Synthetic narrative report QA score',
  99, fixture.recorded_at
FROM (
  SELECT 'Synthetic QA Low Score 1 - Oct 20, 2026' AS title, 6 AS score,
    '2026-10-20 15:00:00' AS recorded_at
  UNION ALL SELECT 'Synthetic QA Low Score 2 - Oct 21, 2026', 7, '2026-10-21 15:00:00'
  UNION ALL SELECT 'Synthetic QA Low Score 3 - Oct 22, 2026', 5, '2026-10-22 15:00:00'
) AS fixture
JOIN grading_items AS item ON item.school_id = 26 AND item.section_id = 15
  AND item.subject_id = 88 AND item.academic_term_id = 39
  AND item.teacher_user_id = 99 AND item.title = fixture.title
  AND item.max_score = 10 AND item.recorded_at = fixture.recorded_at
JOIN section_students AS roster ON roster.school_id = 26
  AND roster.section_id = 15 AND roster.student_user_id = 111
  AND roster.withdrawn_at IS NULL
JOIN users AS learner ON learner.id = roster.student_user_id
  AND learner.school_id = 26 AND learner.role = 'student'
WHERE NOT EXISTS (
  SELECT 1 FROM student_scores AS existing
  WHERE existing.school_id = 26 AND existing.grading_item_id = item.id
    AND existing.student_user_id = 111
);

-- Expect exactly three rows: Oct 20 6/10, Oct 21 7/10, Oct 22 5/10.
SELECT item.id AS item_id, item.title, DATE(item.recorded_at) AS activity_date,
  item.max_score, score.student_user_id, score.score,
  DATE(score.recorded_at) AS score_date
FROM grading_items AS item
JOIN student_scores AS score ON score.school_id = item.school_id
  AND score.grading_item_id = item.id AND score.student_user_id = 111
WHERE item.school_id = 26 AND item.section_id = 15
  AND item.subject_id = 88 AND item.academic_term_id = 39
  AND item.teacher_user_id = 99 AND item.title LIKE 'Synthetic QA Low Score % - Oct %, 2026'
ORDER BY item.recorded_at, item.id;

-- These item IDs should have no score rows for other learners.
SELECT COUNT(*) AS classmate_score_count
FROM student_scores AS score
JOIN grading_items AS item ON item.id = score.grading_item_id
  AND item.school_id = score.school_id
WHERE item.school_id = 26 AND item.section_id = 15
  AND item.subject_id = 88 AND item.academic_term_id = 39
  AND item.teacher_user_id = 99 AND item.title LIKE 'Synthetic QA Low Score % - Oct %, 2026'
  AND score.student_user_id <> 111;

COMMIT;
