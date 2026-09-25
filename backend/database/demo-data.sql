-- =========================================================
-- Academix Demo Data
-- MySQL 8.0+ | Run schema.sql before this file
-- Demo password for every account below: password
-- Replace all demo accounts before production use.
-- =========================================================

USE academix;

-- =========================================================
-- 1. Schools and configuration
-- =========================================================

INSERT INTO schools (
  id, school_code, name, short_name, school_type, deped_school_id,
  region_name, division_name, district_name, address_line, phone, email,
  website, logo_path, registration_status, submitted_at, approved_at
) VALUES
  (1, 'scc', 'Saint Columban''s College', 'SAINT COLUMBAN''S COLLEGE', 'k12', '400168',
   'Region I', 'Pangasinan I, Lingayen', 'Lingayen I',
   'Avenida Rizal, Lingayen, Pangasinan, Philippines', '(049) 123 4567',
   'info@stcolumban.edu.ph', 'stcolumban.edu.ph',
   '/assets/images/st-columban-logo.png', 'active', '2025-01-01 08:00:00', '2025-01-02 08:00:00'),
  (2, 'manghi', 'Mangaldan National High School', 'MANGHI', 'multi-level', NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   '/assets/images/manghi-logo.jpg', 'pending', '2026-08-30 09:00:00', NULL);

INSERT INTO school_settings (school_id, notification_email, current_school_year_label)
VALUES
  (1, 'info@stcolumban.edu.ph', '2025-2026'),
  (2, NULL, '2025-2026');

INSERT INTO school_portal_features (
  school_id, grades_enabled, narrative_reports_enabled, journals_enabled,
  attendance_enabled, sf_templates_enabled
) VALUES
  (1, TRUE, TRUE, TRUE, TRUE, TRUE),
  (2, FALSE, FALSE, FALSE, FALSE, FALSE);

INSERT INTO school_attendance_settings (
  school_id, max_unexcused_absences, consecutive_absences_alert,
  late_count_as_absence, count_excused_absences, allow_edit_past_attendance
) VALUES
  (1, 5, 3, 3, FALSE, TRUE),
  (2, 5, 3, 3, FALSE, TRUE);

INSERT INTO attendance_status_codes (
  school_id, code, display_name, description, display_key, display_tone
) VALUES
  (1, 'present', 'Present', 'Student attended class.', 'P', 'present'),
  (1, 'absent', 'Absent', 'Student did not attend class.', 'A', 'absent'),
  (1, 'late', 'Late', 'Student arrived after attendance was taken.', 'L', 'late'),
  (1, 'excused', 'Excused', 'Student absence has a recorded excuse.', 'E', 'excused');

INSERT INTO academic_years (id, school_id, label, start_date, end_date, status)
VALUES
  (1, 1, '2025-2026', '2025-03-03', '2025-12-05', 'active');

INSERT INTO school_levels (id, school_id, level_code, display_name, grading_period_type, is_enabled)
VALUES
  (1, 1, 'elementary', 'Elementary', 'quarterly', TRUE),
  (2, 1, 'jhs', 'Junior High School', 'quarterly', TRUE),
  (3, 1, 'shs', 'Senior High School', 'semestral', TRUE),
  (4, 2, 'jhs', 'Junior High School', 'quarterly', TRUE),
  (5, 2, 'shs', 'Senior High School', 'semestral', TRUE);

INSERT INTO school_grade_levels (id, school_level_id, grade_code, display_name, sort_order, is_enabled)
VALUES
  (1, 1, 'grade-4', 'Grade 4', 4, TRUE),
  (2, 1, 'grade-5', 'Grade 5', 5, TRUE),
  (3, 2, 'grade-7', 'Grade 7', 7, TRUE),
  (4, 2, 'grade-8', 'Grade 8', 8, TRUE),
  (5, 2, 'grade-9', 'Grade 9', 9, TRUE),
  (6, 2, 'grade-10', 'Grade 10', 10, TRUE),
  (7, 3, 'grade-11', 'Grade 11', 11, TRUE),
  (8, 3, 'grade-12', 'Grade 12', 12, TRUE);

INSERT INTO school_shs_tracks (id, school_level_id, track_code, display_name, is_enabled)
VALUES
  (1, 3, 'academic', 'Academic', TRUE),
  (2, 3, 'tvl', 'Technical-Vocational-Livelihood', TRUE),
  (3, 3, 'arts-design', 'Arts and Design', TRUE),
  (4, 3, 'sports', 'Sports', TRUE);

-- =========================================================
-- 2. Demo accounts and profiles
-- =========================================================

INSERT INTO users (
  id, school_id, role, school_email, personal_email, password_hash,
  account_status, honorific, first_name, last_name, display_name, initials,
  setup_completed_at
) VALUES
  (1, NULL, 'platform_admin', 'platform.admin@academix.test', 'platform.admin@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Platform', 'Admin', 'Platform Admin', 'PA', '2025-01-01 08:00:00'),
  (2, 1, 'school_admin', 'admin.adm@stcolumban.edu.ph', 'admin@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', 'Sr.', 'Admin', 'Admin', 'Sr. Admin', 'SA', '2025-01-06 08:00:00'),
  (3, 1, 'teacher', 'm.reyes.fac@stcolumban.edu.ph', 'maria.reyes@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', 'Ms.', 'Maria', 'Reyes', 'Ms. Maria Reyes', 'MR', '2025-06-03 08:00:00'),
  (4, 1, 'student', 'carlo.mendoza.stud@stcolumban.edu.ph', 'carlo.mendoza@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Carlo', 'Mendoza', 'Carlo Mendoza', 'CM', '2025-06-10 08:00:00'),
  (5, 1, 'student', 'liza.reyes.stud@stcolumban.edu.ph', 'liza.reyes@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Liza', 'Reyes', 'Liza Reyes', 'LR', '2025-06-10 08:00:00'),
  (6, 1, 'student', 'juan.delacruz.stud@stcolumban.edu.ph', 'juan.delacruz@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Juan', 'Dela Cruz', 'Juan Dela Cruz', 'JC', '2025-06-10 08:00:00'),
  (7, 1, 'student', 'maya.torres.stud@stcolumban.edu.ph', 'maya.torres@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Maya', 'Torres', 'Maya Torres', 'MT', '2025-06-10 08:00:00'),
  (8, 1, 'student', 'sofia.cruz.stud@stcolumban.edu.ph', 'sofia.cruz@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Sofia', 'Cruz', 'Sofia Cruz', 'SC', '2025-06-10 08:00:00'),
  (9, 1, 'parent', 'rosa.lim.par@stcolumban.edu.ph', 'rosa.lim@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWyS2e',
   'active', NULL, 'Rosa', 'Lim', 'Rosa Lim', 'RL', '2025-06-10 08:00:00');

INSERT INTO school_admin_profiles (user_id, employee_number) VALUES (2, 'ADM-2016-0001');
INSERT INTO teacher_profiles (user_id, employee_number, contact_number) VALUES (3, 'FAC-2019-0042', '09171230000');

INSERT INTO student_profiles (
  user_id, lrn, middle_name, has_no_middle_name, sex, birth_date,
  birth_place_province, mother_tongue, indigenous_group, religion,
  house_street, barangay, city_municipality, province, contact_number
) VALUES
  (4, '100201000001', 'Marie', FALSE, 'male', '2013-01-01', 'Pangasinan', 'Pangasinense', 'Not applicable', 'Catholic', '31 Rizal Street', 'Poblacion', 'Dagupan City', 'Pangasinan', '09191234567'),
  (5, '100201000002', 'Jose', FALSE, 'female', '2013-02-02', 'Pangasinan', 'Pangasinense', 'Not applicable', 'Catholic', '2 Rizal Street', 'San Isidro', 'Dagupan City', 'Pangasinan', '09201234567'),
  (6, '100201000003', 'Marie', FALSE, 'male', '2013-03-03', 'Pangasinan', 'Pangasinense', 'Not applicable', 'Catholic', '3 Rizal Street', 'Poblacion', 'Dagupan City', 'Pangasinan', '09171234567'),
  (7, '100201000004', 'Jose', FALSE, 'female', '2013-04-04', 'Pangasinan', 'Pangasinense', 'Not applicable', 'Catholic', '4 Rizal Street', 'San Isidro', 'Dagupan City', 'Pangasinan', '09171234567'),
  (8, '100201000005', 'Marie', FALSE, 'female', '2013-05-05', 'Pangasinan', 'Pangasinense', 'Not applicable', 'Catholic', '5 Rizal Street', 'Poblacion', 'Dagupan City', 'Pangasinan', '09181234567');

INSERT INTO parent_profiles (
  user_id, middle_name, maiden_last_name, has_no_middle_name,
  has_no_maiden_name, contact_number, house_street, barangay,
  city_municipality, province
) VALUES
  (9, 'Santos', 'Santos', FALSE, FALSE, '09171234567', '12 Rizal Street', 'Poblacion', 'Dagupan City', 'Pangasinan');

INSERT INTO student_parent_links (student_user_id, parent_user_id, relationship)
VALUES
  (6, 9, 'mother'),
  (7, 9, 'guardian');

-- =========================================================
-- 3. Academic terms, subjects, and Grade 7 - St. Matthew
-- =========================================================

INSERT INTO academic_terms (
  id, academic_year_id, school_level_id, name, sequence_number,
  planned_start_date, planned_end_date, status, activated_at
) VALUES
  (1, 1, 2, 'Quarter 1', 1, '2025-03-03', '2025-05-02', 'closed', '2025-03-03 08:00:00'),
  (2, 1, 2, 'Quarter 2', 2, '2025-05-05', '2025-07-18', 'active', '2025-05-05 08:00:00'),
  (3, 1, 3, 'Semester 1', 1, '2025-03-03', '2025-07-18', 'active', '2025-03-03 08:00:00');

INSERT INTO academic_term_actions (
  academic_term_id, action_type, performed_by_user_id, performed_at
) VALUES
  (1, 'activated', 2, '2025-03-03 08:00:00'),
  (1, 'completed', 2, '2025-05-02 17:00:00'),
  (2, 'activated', 2, '2025-05-05 08:00:00');

INSERT INTO subjects (id, school_id, subject_code, name, school_level_id, grade_level_id)
VALUES
  (1, 1, 'values-education', 'Values Education', 2, 3),
  (2, 1, 'mathematics', 'Mathematics', 2, 3),
  (3, 1, 'english', 'English', 2, 3),
  (4, 1, 'science', 'Science', 2, 3);

UPDATE school_settings SET journal_subject_id = 1 WHERE school_id = 1;

INSERT INTO journal_subjects (id, school_id, subject_id, name, is_active)
VALUES (1, 1, 1, 'Values Education', TRUE);

INSERT INTO sections (
  id, school_id, academic_year_id, school_level_id, grade_level_id,
  name, capacity, adviser_user_id, status
) VALUES
  (1, 1, 1, 2, 3, 'St. Matthew', 40, 3, 'active'),
  (2, 1, 1, 2, 4, 'St. Luke', 40, NULL, 'active');

INSERT INTO section_students (section_id, student_user_id)
VALUES (1, 4), (1, 5), (1, 6), (1, 7), (1, 8);

INSERT INTO section_teachers (section_id, teacher_user_id, subject_id)
VALUES (1, 3, 1), (1, 3, 2), (1, 3, 3), (1, 3, 4);

INSERT INTO grading_categories (id, school_id, school_level_id, code, name, weight)
VALUES
  (1, 1, 2, 'ww', 'Written Work', 30.00),
  (2, 1, 2, 'pt', 'Performance Task', 50.00),
  (3, 1, 2, 'qa', 'Quarterly Assessment', 20.00);

-- =========================================================
-- 4. Assignment, scores, attendance, and QR demo records
-- =========================================================

INSERT INTO assignments (
  id, school_id, section_id, subject_id, academic_term_id,
  grading_category_id, teacher_user_id, title, description, due_at,
  max_score, status
) VALUES
  (1, 1, 1, 1, 2, 2, 3, 'Seatwork 1: Kindness and Respect', 'Complete the Values Education activity.', '2025-06-13 23:59:00', 20.00, 'published'),
  (2, 1, 1, 1, 2, 1, 3, 'Quiz 1: Core Values', 'Review the core values lesson.', '2025-06-11 23:59:00', 25.00, 'published');

INSERT INTO assignment_submissions (
  assignment_id, student_user_id, file_name, file_path, file_size_bytes,
  submission_status, submitted_at
) VALUES
  (1, 4, 'kindness-and-respect.pdf', '/uploads/assignment-submissions/kindness-and-respect.pdf', 184320, 'submitted', '2025-06-12 15:30:00'),
  (1, 6, 'juan-seatwork.pdf', '/uploads/assignment-submissions/juan-seatwork.pdf', 165000, 'submitted', '2025-06-13 10:15:00'),
  (2, 5, NULL, NULL, NULL, 'missing', NULL);

INSERT INTO grading_items (
  id, section_id, subject_id, academic_term_id, grading_category_id,
  teacher_user_id, title, max_score, recorded_at
) VALUES
  (1, 1, 1, 2, 1, 3, 'Quiz 1: Core Values', 25.00, '2025-06-11 14:00:00'),
  (2, 1, 1, 2, 2, 3, 'Seatwork 1: Kindness and Respect', 20.00, '2025-06-13 14:00:00');

INSERT INTO student_scores (grading_item_id, student_user_id, score, recorded_by_user_id)
VALUES
  (1, 4, 24.00, 3), (1, 5, 23.00, 3), (1, 6, 22.00, 3), (1, 7, 25.00, 3), (1, 8, 21.00, 3),
  (2, 4, 19.00, 3), (2, 5, 18.00, 3), (2, 6, 20.00, 3), (2, 7, 20.00, 3), (2, 8, 17.00, 3);

INSERT INTO attendance_sessions (
  id, school_id, section_id, subject_id, attendance_date, method, status,
  created_by_user_id, confirmed_by_user_id, confirmed_at
) VALUES
  (1, 1, 1, NULL, '2025-06-13', 'qr', 'confirmed', 3, 3, '2025-06-13 08:15:00');

INSERT INTO attendance_records (
  attendance_session_id, student_user_id, attendance_status, marked_by_user_id
) VALUES
  (1, 4, 'present', 3), (1, 5, 'present', 3), (1, 6, 'present', 3),
  (1, 7, 'present', 3), (1, 8, 'excused', 3);

INSERT INTO student_qr_credentials (id, student_user_id, token_hash, credential_status)
VALUES
  (1, 4, SHA2('demo-qr-car-100201000001', 256), 'active'),
  (2, 5, SHA2('demo-qr-liza-100201000002', 256), 'active'),
  (3, 6, SHA2('demo-qr-juan-100201000003', 256), 'active'),
  (4, 7, SHA2('demo-qr-maya-100201000004', 256), 'active'),
  (5, 8, SHA2('demo-qr-sofia-100201000005', 256), 'active');

INSERT INTO qr_scan_events (
  attendance_session_id, student_qr_credential_id, scanned_student_user_id,
  scanned_by_user_id, scan_result, scanned_at
) VALUES
  (1, 1, 4, 3, 'accepted', '2025-06-13 08:02:00'),
  (1, 2, 5, 3, 'accepted', '2025-06-13 08:03:00'),
  (1, 3, 6, 3, 'accepted', '2025-06-13 08:04:00'),
  (1, 4, 7, 3, 'accepted', '2025-06-13 08:05:00');

-- =========================================================
-- 5. Announcements, journals, reports, and interventions
-- =========================================================

INSERT INTO announcements (
  id, school_id, title, body, priority, status, author_user_id, published_at
) VALUES
  (1, 1, 'Q2 Grade Encoding Deadline', 'Teachers must complete Quarter 2 grade encoding by June 14.', 'high', 'published', 2, '2025-06-12 08:00:00');

INSERT INTO announcement_audiences (announcement_id, audience_type)
VALUES (1, 'teacher'), (1, 'school_admin');

INSERT INTO announcement_reads (announcement_id, user_id, read_at)
VALUES (1, 3, '2025-06-12 08:30:00');

INSERT INTO notifications (user_id, type, title, message, target_path)
VALUES
  (3, 'announcement', 'New announcement', 'Q2 Grade Encoding Deadline', '/views/teacher/edugnay-teacher-announcements.html'),
  (9, 'report', 'Weekly report ready', 'Juan Dela Cruz''s weekly report is ready.', '/views/parent/edugnay-parent-reports.html');

INSERT INTO user_tasks (user_id, title, due_date, task_status)
VALUES
  (2, 'Review pending quarter reopen requests', '2025-06-14', 'pending'),
  (3, 'Review Grade 7 journal entries', '2025-06-14', 'pending');

INSERT INTO student_journal_entries (
  id, journal_subject_id, student_user_id, section_id, prompt_text,
  entry_text, entry_status, submitted_at
) VALUES
  (1, 1, 4, 1, 'Describe a moment this week when you helped a classmate.', 'I helped a classmate understand the group activity.', 'submitted', '2025-06-12 13:00:00'),
  (2, 1, 6, 1, 'Describe a moment this week when you helped a classmate.', 'I enjoyed working with my group during the activity.', 'submitted', '2025-06-12 13:05:00');

INSERT INTO journal_feedback (journal_entry_id, teacher_user_id, feedback_text)
VALUES (1, 3, 'Thank you for showing kindness and cooperation.');

INSERT INTO narrative_reports (
  id, school_id, student_user_id, section_id, teacher_user_id, academic_term_id,
  report_period_key, report_period_label, teacher_note, generated_summary,
  teacher_edited_summary, report_status, is_at_risk, generated_at, confirmed_at
) VALUES
  (1, 1, 4, 1, 3, 2, '2025-W23', 'Week of June 9 to 14, 2025', NULL,
   'Carlo had a strong week. He attended all tracked sessions and completed his work on time.',
   'Carlo had a strong week. He attended all tracked sessions and completed his work on time.',
   'confirmed', FALSE, '2025-06-14 08:02:00', '2025-06-14 08:10:00'),
  (2, 1, 6, 1, 3, 2, '2025-W23', 'Week of June 9 to 14, 2025', 'Juan participated well in Values Education.',
   'Juan had a strong week across his tracked subjects and completed his work on time.',
   NULL, 'draft', FALSE, '2025-06-14 08:15:00', NULL);

INSERT INTO report_recommendations (narrative_report_id, recommendation_text, display_order)
VALUES
  (1, 'Maintain a regular study schedule and review class notes before the next lesson.', 1),
  (1, 'Encourage the student to continue participating in class and group activities.', 2),
  (2, 'Continue regular practice and review class notes before the next lesson.', 1),
  (2, 'Encourage consistent participation in group activities.', 2);

INSERT INTO report_data_sources (narrative_report_id, source_type, source_record_id)
VALUES
  (1, 'attendance_session', 1), (1, 'journal_entry', 1),
  (2, 'attendance_session', 1), (2, 'journal_entry', 2);

INSERT INTO report_reopen_requests (
  id, narrative_report_id, requested_by_user_id, reason, request_status,
  admin_note, expires_at, reviewed_by_user_id, reviewed_at
) VALUES
  (1, 1, 3, 'Correct a teacher-reviewed report detail.', 'approved',
   'Editing access is approved until the stated deadline.', '2025-06-16 17:00:00', 2, '2025-06-14 09:00:00');

INSERT INTO intervention_plans (
  id, school_id, student_user_id, section_id, academic_term_id,
  created_by_user_id, concern_summary, goal_text, plan_status, start_date, target_date
) VALUES
  (1, 1, 8, 1, 2, 3, 'Sofia needs support completing Values Education activities consistently.',
   'Complete assigned Values Education activities by their due dates for four consecutive weeks.',
   'active', '2025-06-10', '2025-07-08');

INSERT INTO intervention_actions (
  intervention_plan_id, action_text, assigned_to_role, due_date, action_status
) VALUES
  (1, 'Review missing activities with the student every Monday.', 'teacher', '2025-06-17', 'pending'),
  (1, 'Set aside 20 minutes for Values Education work twice each week.', 'parent', '2025-06-17', 'pending');

INSERT INTO intervention_progress_entries (
  intervention_plan_id, recorded_by_user_id, progress_status, note, recorded_at
) VALUES
  (1, 3, 'on_track', 'Sofia completed the first follow-up activity with guidance.', '2025-06-14 15:00:00');

-- =========================================================
-- 6. SF1 metadata, holidays, and audit history
-- =========================================================

INSERT INTO school_form_templates (
  id, form_code, form_name, version, source_type, template_status,
  mapping_status, file_name, file_path, default_sheet_name,
  requires_academic_term, published_by_user_id, published_at
) VALUES
  (1, 'SF1', 'School Register', '1.0', 'official', 'active', 'ready',
   'SF1.xlsx', '/assets/templates/school-forms/sf1.xlsx', 'School Form 1 (SF1)',
   FALSE, 1, '2025-06-01 08:00:00');

INSERT INTO school_form_template_mappings (
  school_form_template_id, field_key, worksheet_name, cell_reference, data_source
) VALUES
  (1, 'schoolName', 'School Form 1 (SF1)', 'F6', 'schools.name'),
  (1, 'schoolId', 'School Form 1 (SF1)', 'F4', 'schools.deped_school_id'),
  (1, 'studentLrn', 'School Form 1 (SF1)', 'B10', 'student_profiles.lrn'),
  (1, 'studentName', 'School Form 1 (SF1)', 'E10', 'users.last_name, users.first_name, student_profiles.middle_name');

INSERT INTO school_form_exports (
  id, school_form_template_id, school_id, section_id, academic_term_id,
  requested_by_user_id, export_status, file_path, generated_at
) VALUES
  (1, 1, 1, 1, 2, 3, 'generated',
   '/uploads/sf-exports/sf1-grade7-st-matthew-2025-06-14.xlsx', '2025-06-14 16:00:00');

INSERT INTO holidays (school_id, holiday_date, title, detail, holiday_type, applies_to)
VALUES
  (1, '2026-08-17', 'School Foundation Day', 'No classes and no office transactions today.', 'holiday', 'all'),
  (1, '2026-08-31', 'National Heroes Day', 'Regular classes resume on the next school day.', 'holiday', 'all');

INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
VALUES
  (1, 2, 'school_approved', 'school', 1, JSON_OBJECT('status', 'active')),
  (1, 3, 'attendance_confirmed', 'attendance_session', 1, JSON_OBJECT('method', 'qr', 'present_count', 4)),
  (1, 3, 'report_confirmed', 'narrative_report', 1, JSON_OBJECT('student_user_id', 4)),
  (1, 3, 'school_form_generated', 'school_form_export', 1, JSON_OBJECT('form_code', 'SF1'));

-- Continue normal auto-increment values after the fixed demo IDs above.
ALTER TABLE schools AUTO_INCREMENT = 3;
ALTER TABLE academic_years AUTO_INCREMENT = 2;
ALTER TABLE school_levels AUTO_INCREMENT = 6;
ALTER TABLE school_grade_levels AUTO_INCREMENT = 9;
ALTER TABLE school_shs_tracks AUTO_INCREMENT = 5;
ALTER TABLE users AUTO_INCREMENT = 10;
ALTER TABLE academic_terms AUTO_INCREMENT = 4;
ALTER TABLE subjects AUTO_INCREMENT = 5;
ALTER TABLE sections AUTO_INCREMENT = 3;
ALTER TABLE grading_categories AUTO_INCREMENT = 4;
ALTER TABLE assignments AUTO_INCREMENT = 3;
ALTER TABLE grading_items AUTO_INCREMENT = 3;
ALTER TABLE attendance_sessions AUTO_INCREMENT = 2;
ALTER TABLE student_qr_credentials AUTO_INCREMENT = 6;
ALTER TABLE announcements AUTO_INCREMENT = 2;
ALTER TABLE narrative_reports AUTO_INCREMENT = 3;
ALTER TABLE intervention_plans AUTO_INCREMENT = 2;
ALTER TABLE school_form_templates AUTO_INCREMENT = 2;
ALTER TABLE school_form_exports AUTO_INCREMENT = 2;
