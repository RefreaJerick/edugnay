-- Add explicit tenant ownership to child records that link multiple school-owned records.

ALTER TABLE academic_term_actions ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE academic_term_actions AS actions
INNER JOIN academic_terms AS terms ON terms.id = actions.academic_term_id
SET actions.school_id = terms.school_id;
ALTER TABLE academic_term_actions
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_term_actions_tenant_term FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_term_actions_tenant_user FOREIGN KEY (school_id, performed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE assignment_submissions ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE assignment_submissions AS submissions
INNER JOIN assignments ON assignments.id = submissions.assignment_id
SET submissions.school_id = assignments.school_id;
ALTER TABLE assignment_submissions
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_assignment_submissions_tenant_assignment FOREIGN KEY (school_id, assignment_id) REFERENCES assignments(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignment_submissions_tenant_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE grading_items ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE grading_items AS items INNER JOIN sections ON sections.id = items.section_id
SET items.school_id = sections.school_id;
ALTER TABLE grading_items
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_grading_items_school_id (school_id, id),
  ADD CONSTRAINT fk_grading_items_tenant_section FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grading_items_tenant_subject FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grading_items_tenant_term FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grading_items_tenant_category FOREIGN KEY (school_id, grading_category_id) REFERENCES grading_categories(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grading_items_tenant_teacher FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE student_scores ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE student_scores AS scores INNER JOIN grading_items AS items ON items.id = scores.grading_item_id
SET scores.school_id = items.school_id;
ALTER TABLE student_scores
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_student_scores_tenant_item FOREIGN KEY (school_id, grading_item_id) REFERENCES grading_items(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_student_scores_tenant_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_student_scores_tenant_recorder FOREIGN KEY (school_id, recorded_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_records ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE attendance_records AS records INNER JOIN attendance_sessions AS sessions ON sessions.id = records.attendance_session_id
SET records.school_id = sessions.school_id;
ALTER TABLE attendance_records
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_attendance_records_tenant_session FOREIGN KEY (school_id, attendance_session_id) REFERENCES attendance_sessions(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_attendance_records_tenant_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_attendance_records_tenant_marker FOREIGN KEY (school_id, marked_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE student_qr_credentials ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE student_qr_credentials AS credentials INNER JOIN users ON users.id = credentials.student_user_id
SET credentials.school_id = users.school_id;
ALTER TABLE student_qr_credentials
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_student_qr_credentials_school_id (school_id, id),
  ADD CONSTRAINT fk_student_qr_credentials_tenant_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE CASCADE;

ALTER TABLE qr_scan_events ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE qr_scan_events AS scans INNER JOIN attendance_sessions AS sessions ON sessions.id = scans.attendance_session_id
SET scans.school_id = sessions.school_id;
ALTER TABLE qr_scan_events
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_qr_scans_tenant_session FOREIGN KEY (school_id, attendance_session_id) REFERENCES attendance_sessions(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qr_scans_tenant_credential FOREIGN KEY (school_id, student_qr_credential_id) REFERENCES student_qr_credentials(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qr_scans_tenant_student FOREIGN KEY (school_id, scanned_student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_qr_scans_tenant_user FOREIGN KEY (school_id, scanned_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE announcement_audiences ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE announcement_audiences AS audiences INNER JOIN announcements ON announcements.id = audiences.announcement_id
SET audiences.school_id = announcements.school_id;
ALTER TABLE announcement_audiences
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_announcement_audiences_tenant_announcement FOREIGN KEY (school_id, announcement_id) REFERENCES announcements(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_announcement_audiences_tenant_section FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT;

ALTER TABLE announcement_reads ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE announcement_reads AS announcement_read_rows
INNER JOIN announcements ON announcements.id = announcement_read_rows.announcement_id
SET announcement_read_rows.school_id = announcements.school_id;
ALTER TABLE announcement_reads
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_announcement_reads_tenant_announcement FOREIGN KEY (school_id, announcement_id) REFERENCES announcements(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_announcement_reads_tenant_user FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE;

ALTER TABLE announcement_email_outbox ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE announcement_email_outbox AS outbox INNER JOIN announcements ON announcements.id = outbox.announcement_id
SET outbox.school_id = announcements.school_id;
ALTER TABLE announcement_email_outbox
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_announcement_email_tenant_announcement FOREIGN KEY (school_id, announcement_id) REFERENCES announcements(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_announcement_email_tenant_user FOREIGN KEY (school_id, user_id) REFERENCES users(school_id, id) ON DELETE CASCADE;

ALTER TABLE journal_prompts ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE journal_prompts AS prompts INNER JOIN journal_subjects ON journal_subjects.id = prompts.journal_subject_id
SET prompts.school_id = journal_subjects.school_id;
ALTER TABLE journal_prompts
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_journal_prompts_school_id (school_id, id),
  ADD CONSTRAINT fk_journal_prompts_tenant_subject FOREIGN KEY (school_id, journal_subject_id) REFERENCES journal_subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_prompts_tenant_section FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_prompts_tenant_item FOREIGN KEY (school_id, grading_item_id) REFERENCES grading_items(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_prompts_tenant_creator FOREIGN KEY (school_id, created_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE student_journal_entries ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE student_journal_entries AS entries INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
SET entries.school_id = journal_subjects.school_id;
ALTER TABLE student_journal_entries
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_student_journal_entries_school_id (school_id, id),
  ADD CONSTRAINT fk_journal_entries_tenant_subject FOREIGN KEY (school_id, journal_subject_id) REFERENCES journal_subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_entries_tenant_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_entries_tenant_section FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_journal_entries_tenant_prompt FOREIGN KEY (school_id, journal_prompt_id) REFERENCES journal_prompts(school_id, id) ON DELETE RESTRICT;

ALTER TABLE journal_feedback ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE journal_feedback AS feedback INNER JOIN student_journal_entries AS entries ON entries.id = feedback.journal_entry_id
SET feedback.school_id = entries.school_id;
ALTER TABLE journal_feedback
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_journal_feedback_tenant_entry FOREIGN KEY (school_id, journal_entry_id) REFERENCES student_journal_entries(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_journal_feedback_tenant_teacher FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE report_reopen_requests ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE report_reopen_requests AS requests INNER JOIN narrative_reports AS reports ON reports.id = requests.narrative_report_id
SET requests.school_id = reports.school_id;
ALTER TABLE report_reopen_requests
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_report_reopen_tenant_report FOREIGN KEY (school_id, narrative_report_id) REFERENCES narrative_reports(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_report_reopen_tenant_requester FOREIGN KEY (school_id, requested_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_report_reopen_tenant_reviewer FOREIGN KEY (school_id, reviewed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE intervention_progress_entries ADD COLUMN school_id BIGINT UNSIGNED NULL AFTER id;
UPDATE intervention_progress_entries AS progress INNER JOIN intervention_plans AS plans ON plans.id = progress.intervention_plan_id
SET progress.school_id = plans.school_id;
ALTER TABLE intervention_progress_entries
  MODIFY school_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_intervention_progress_tenant_plan FOREIGN KEY (school_id, intervention_plan_id) REFERENCES intervention_plans(school_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_intervention_progress_tenant_user FOREIGN KEY (school_id, recorded_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;
