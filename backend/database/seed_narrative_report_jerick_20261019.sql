-- Synthetic QA evidence for Jerick Refrea's Oct 19-23, 2026 report week.
-- Verified target: academix / QA School 01 / St. Peter / Maya Santos.
-- Run the complete script in one phpMyAdmin SQL request. The inserts are
-- guarded so a rerun before report generation will not duplicate fixture rows.
-- Existing assignment 15 has no matching subject row, so the evidence query
-- excludes it. This adds a separate published, synthetic assignment; it is
-- visible to St. Peter learners and their linked parents.

USE academix;

-- Preflight: expect QA School 01, Jerick (111), St. Peter (15), adviser Maya
-- (99), Values Education subject (88), and no report for this week.
SELECT DATABASE() AS selected_database;
SELECT student.id AS student_id, student.display_name, student.role,
  section.id AS section_id, section.name AS section_name,
  adviser.id AS adviser_id, settings.journal_subject_id,
  features.journals_enabled
FROM users AS student
JOIN section_students AS roster ON roster.school_id = student.school_id
  AND roster.student_user_id = student.id AND roster.section_id = 15
  AND roster.withdrawn_at IS NULL
JOIN sections AS section ON section.id = roster.section_id
  AND section.school_id = roster.school_id AND section.adviser_user_id = 99
JOIN users AS adviser ON adviser.id = section.adviser_user_id
  AND adviser.school_id = section.school_id AND adviser.role = 'teacher'
JOIN school_settings AS settings ON settings.school_id = section.school_id
JOIN school_portal_features AS features ON features.school_id = section.school_id
WHERE student.id = 111 AND student.school_id = 26 AND student.role = 'student';

-- Show assignments that the evidence collector can actually include. Assignment
-- 15 is intentionally absent because it has no matching subject. The QA fixture
-- assignment is inserted below.
SELECT assignment.id AS assignment_id, assignment.title,
  DATE(assignment.due_at) AS due_date, subject.name AS subject_name
FROM assignments AS assignment
JOIN subjects AS subject ON subject.id = assignment.subject_id
  AND subject.school_id = assignment.school_id
WHERE assignment.school_id = 26 AND assignment.section_id = 15
  AND assignment.status = 'published' AND assignment.due_at IS NOT NULL
  AND DATE(assignment.due_at) BETWEEN '2026-10-19' AND '2026-10-22';

SELECT id, report_status, released_at
FROM narrative_reports
WHERE school_id = 26 AND section_id = 15 AND student_user_id = 111
  AND report_period_key = 'week:2026-10-19';

START TRANSACTION;

-- Add a published, ungraded assignment using Maya's assigned Values Education
-- subject and St. Peter's active Term 1. Manual submission tracking avoids a
-- fake attachment while allowing the report evidence builder to count Jerick's
-- submitted status. Other learners remain unsubmitted.
INSERT INTO assignments (
  school_id, section_id, subject_id, academic_term_id, grading_category_id,
  subject_grading_component_id, subject_grading_exam_part_id, grading_item_id,
  teacher_user_id, title, description, due_at, max_score,
  online_submission_enabled, status
)
SELECT 26, 15, 88, 39, NULL, NULL, NULL, NULL, 99,
  'Synthetic QA Narrative Report Evidence - 2026-10-19',
  'Synthetic assignment fixture for narrative report generation testing.',
  '2026-10-19 23:59:00', NULL, 0, 'published'
FROM sections AS section
JOIN section_teachers AS teacher_subject ON teacher_subject.school_id = section.school_id
  AND teacher_subject.section_id = section.id AND teacher_subject.teacher_user_id = 99
  AND teacher_subject.subject_id = 88
JOIN subjects AS subject ON subject.id = teacher_subject.subject_id
  AND subject.school_id = section.school_id AND subject.is_active = TRUE
JOIN academic_terms AS term ON term.id = 39 AND term.school_id = section.school_id
  AND term.academic_year_id = section.academic_year_id
  AND term.school_level_id = section.school_level_id AND term.status = 'active'
JOIN users AS adviser ON adviser.id = 99 AND adviser.school_id = section.school_id
  AND adviser.role = 'teacher'
WHERE section.id = 15 AND section.school_id = 26 AND section.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM assignments AS existing
    WHERE existing.school_id = 26 AND existing.section_id = 15
      AND existing.subject_id = 88 AND existing.academic_term_id = 39
      AND existing.teacher_user_id = 99
      AND existing.title = 'Synthetic QA Narrative Report Evidence - 2026-10-19'
  );

-- Record only Jerick's synthetic manual submission, without an attachment.
INSERT INTO assignment_submissions (
  school_id, assignment_id, student_user_id, submission_status, submitted_at
)
SELECT 26, assignment.id, 111, 'submitted', '2026-10-21 14:00:00'
FROM assignments AS assignment
JOIN section_students AS roster ON roster.school_id = assignment.school_id
  AND roster.section_id = assignment.section_id AND roster.student_user_id = 111
  AND roster.withdrawn_at IS NULL
WHERE assignment.school_id = 26 AND assignment.section_id = 15
  AND assignment.subject_id = 88 AND assignment.academic_term_id = 39
  AND assignment.teacher_user_id = 99
  AND assignment.status = 'published' AND assignment.online_submission_enabled = 0
  AND assignment.title = 'Synthetic QA Narrative Report Evidence - 2026-10-19'
  AND NOT EXISTS (
    SELECT 1 FROM assignment_submissions AS existing
    WHERE existing.school_id = 26 AND existing.assignment_id = assignment.id
      AND existing.student_user_id = 111
  );

-- Create one confirmed all-subject session if it does not already exist.
-- Other St. Peter learners will have an unmarked session, not an absence.
INSERT INTO attendance_sessions (
  school_id, section_id, subject_id, attendance_date, method, status,
  created_by_user_id, confirmed_by_user_id, confirmed_at
)
SELECT 26, 15, NULL, '2026-10-20', 'manual', 'confirmed', 99, 99, '2026-10-20 08:00:00'
FROM sections AS section
JOIN users AS adviser ON adviser.id = 99
  AND adviser.school_id = 26 AND adviser.role = 'teacher'
JOIN users AS student ON student.id = 111
  AND student.school_id = 26 AND student.role = 'student'
JOIN section_students AS roster ON roster.school_id = 26
  AND roster.section_id = section.id AND roster.student_user_id = student.id
  AND roster.withdrawn_at IS NULL
WHERE section.id = 15 AND section.school_id = 26
  AND section.adviser_user_id = adviser.id AND section.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM attendance_sessions AS existing
    WHERE existing.school_id = 26 AND existing.section_id = 15
      AND existing.subject_id IS NULL AND existing.attendance_date = '2026-10-20'
  );

-- Mark only Jerick present. Existing attendance records are left unchanged.
INSERT INTO attendance_records (
  school_id, attendance_session_id, student_user_id, attendance_status, marked_by_user_id
)
SELECT 26, session.id, 111, 'present', 99
FROM attendance_sessions AS session
JOIN section_students AS roster ON roster.school_id = 26
  AND roster.section_id = 15 AND roster.student_user_id = 111
  AND roster.withdrawn_at IS NULL
WHERE session.school_id = 26 AND session.section_id = 15
  AND session.subject_id IS NULL AND session.attendance_date = '2026-10-20'
  AND session.status = 'confirmed'
  AND NOT EXISTS (
    SELECT 1 FROM attendance_records AS existing
    WHERE existing.attendance_session_id = session.id
      AND existing.student_user_id = 111
  );

-- Add one synthetic reflection to the configured Values Education journal.
-- journal_prompt_id is NULL and prompt_text is blank (required by the schema).
-- The synthetic entry text and timestamp make this safe to rerun. Clear the
-- marker prompt text used by the first fixture run, if it is still present.
UPDATE student_journal_entries
SET prompt_text = ''
WHERE school_id = 26 AND journal_subject_id = 10 AND student_user_id = 111
  AND owner_teacher_user_id = 99 AND section_id = 15 AND journal_prompt_id IS NULL
  AND prompt_text = 'Synthetic QA fixture reflection for Oct 19-23, 2026.'
  AND entry_text = 'This week I helped my group organize our class activity. I listened to my classmates, shared one idea, and finished the part we agreed I would do.'
  AND submitted_at = '2026-10-21 14:00:00';

INSERT INTO student_journal_entries (
  school_id, journal_subject_id, student_user_id, owner_teacher_user_id,
  section_id, journal_prompt_id, prompt_text, entry_text, entry_status, submitted_at
)
SELECT 26, 10, 111, 99, 15, NULL,
  '',
  'This week I helped my group organize our class activity. I listened to my classmates, shared one idea, and finished the part we agreed I would do.',
  'submitted', '2026-10-21 14:00:00'
FROM users AS student
JOIN users AS adviser ON adviser.id = 99
  AND adviser.school_id = 26 AND adviser.role = 'teacher'
JOIN sections AS section ON section.id = 15 AND section.school_id = 26
  AND section.adviser_user_id = adviser.id AND section.status = 'active'
JOIN section_students AS roster ON roster.school_id = 26
  AND roster.section_id = section.id AND roster.student_user_id = student.id
  AND roster.withdrawn_at IS NULL
JOIN school_settings AS settings ON settings.school_id = 26
  AND settings.journal_subject_id = 88
JOIN school_portal_features AS features ON features.school_id = 26
  AND features.journals_enabled = TRUE
JOIN journal_subjects AS journal ON journal.id = 10
  AND journal.school_id = 26 AND journal.subject_id = 88 AND journal.is_active = TRUE
WHERE student.id = 111 AND student.school_id = 26 AND student.role = 'student'
  AND NOT EXISTS (
    SELECT 1 FROM student_journal_entries AS existing
    WHERE existing.school_id = 26 AND existing.section_id = 15
      AND existing.student_user_id = 111 AND existing.journal_subject_id = 10
      AND existing.journal_prompt_id IS NULL
      AND existing.entry_text = 'This week I helped my group organize our class activity. I listened to my classmates, shared one idea, and finished the part we agreed I would do.'
      AND existing.submitted_at = '2026-10-21 14:00:00'
  );

-- Verify the attendance, reflection, included assignment evidence, and report
-- state before committing these synthetic rows.
SELECT session.id AS session_id, session.attendance_date,
  session.status AS session_status, records.attendance_status,
  records.student_user_id
FROM attendance_sessions AS session
JOIN attendance_records AS records
  ON records.attendance_session_id = session.id AND records.student_user_id = 111
WHERE session.school_id = 26 AND session.section_id = 15
  AND session.subject_id IS NULL AND session.attendance_date = '2026-10-20';

SELECT assignment.id AS assignment_id, assignment.title,
  DATE(assignment.due_at) AS due_date, subject.name AS subject_name,
  submission.submission_status, submission.file_path,
  CASE WHEN submission.file_path IS NOT NULL AND submission.submission_status = 'submitted' THEN 'submitted'
    WHEN assignment.online_submission_enabled <> 1
      AND submission.submission_status IN ('pending', 'submitted', 'not_submitted') THEN submission.submission_status
    WHEN DATE(assignment.due_at) < '2026-10-22' THEN 'not_submitted'
    ELSE 'pending' END AS report_evidence_status
FROM assignments AS assignment
JOIN subjects AS subject ON subject.id = assignment.subject_id
  AND subject.school_id = assignment.school_id
LEFT JOIN assignment_submissions AS submission
  ON submission.school_id = assignment.school_id
  AND submission.assignment_id = assignment.id AND submission.student_user_id = 111
WHERE assignment.school_id = 26 AND assignment.section_id = 15
  AND assignment.status = 'published' AND assignment.due_at IS NOT NULL
  AND DATE(assignment.due_at) BETWEEN '2026-10-19' AND '2026-10-22';

-- Confirm Jerick is submitted and every other eligible learner has no
-- submission, which the evidence builder interprets as not submitted by Oct 22.
SELECT student.id AS student_id, student.display_name,
  submission.submission_status, submission.file_path,
  CASE WHEN submission.file_path IS NOT NULL AND submission.submission_status = 'submitted' THEN 'submitted'
    WHEN assignment.online_submission_enabled <> 1
      AND submission.submission_status IN ('pending', 'submitted', 'not_submitted') THEN submission.submission_status
    WHEN DATE(assignment.due_at) < '2026-10-22' THEN 'not_submitted'
    ELSE 'pending' END AS report_evidence_status
FROM assignments AS assignment
JOIN subjects AS subject ON subject.id = assignment.subject_id
  AND subject.school_id = assignment.school_id
JOIN section_students AS roster ON roster.school_id = assignment.school_id
  AND roster.section_id = assignment.section_id
  AND DATE(roster.enrolled_at) <= DATE(assignment.due_at)
  AND (roster.withdrawn_at IS NULL OR DATE(roster.withdrawn_at) >= DATE(assignment.due_at))
JOIN users AS student ON student.id = roster.student_user_id
  AND student.school_id = roster.school_id AND student.role = 'student'
  AND student.account_status = 'active'
LEFT JOIN assignment_submissions AS submission ON submission.school_id = assignment.school_id
  AND submission.assignment_id = assignment.id AND submission.student_user_id = student.id
WHERE assignment.school_id = 26 AND assignment.section_id = 15
  AND assignment.title = 'Synthetic QA Narrative Report Evidence - 2026-10-19'
  AND assignment.status = 'published' AND DATE(assignment.due_at) = '2026-10-19'
ORDER BY student.id;

SELECT id, prompt_text, entry_text, entry_status, submitted_at
FROM student_journal_entries
WHERE school_id = 26 AND section_id = 15 AND student_user_id = 111
  AND journal_subject_id = 10
  AND journal_prompt_id IS NULL
  AND entry_text = 'This week I helped my group organize our class activity. I listened to my classmates, shared one idea, and finished the part we agreed I would do.'
  AND submitted_at = '2026-10-21 14:00:00';

SELECT id, report_status, released_at
FROM narrative_reports
WHERE school_id = 26 AND section_id = 15 AND student_user_id = 111
  AND report_period_key = 'week:2026-10-19';

COMMIT;
