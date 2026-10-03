-- Enforce same-school references on feature tables that already store school_id.

ALTER TABLE grading_categories
  ADD UNIQUE KEY uq_grading_categories_school_id (school_id, id),
  ADD CONSTRAINT fk_grading_categories_tenant_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT;

ALTER TABLE assignments
  ADD UNIQUE KEY uq_assignments_school_id (school_id, id),
  ADD CONSTRAINT fk_assignments_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_tenant_category
    FOREIGN KEY (school_id, grading_category_id) REFERENCES grading_categories(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_tenant_teacher
    FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE published_final_grades
  ADD UNIQUE KEY uq_published_final_grades_school_id (school_id, id),
  ADD CONSTRAINT fk_published_final_grades_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_published_final_grades_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_published_final_grades_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_published_final_grades_tenant_student
    FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_published_final_grades_tenant_publisher
    FOREIGN KEY (school_id, published_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_sessions
  ADD UNIQUE KEY uq_attendance_sessions_school_id (school_id, id),
  ADD CONSTRAINT fk_attendance_sessions_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_attendance_sessions_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_attendance_sessions_tenant_creator
    FOREIGN KEY (school_id, created_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_attendance_sessions_tenant_confirmer
    FOREIGN KEY (school_id, confirmed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE grading_period_reopen_requests
  ADD UNIQUE KEY uq_gp_reopen_school_id (school_id, id),
  ADD CONSTRAINT fk_gp_reopen_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gp_reopen_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gp_reopen_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gp_reopen_tenant_teacher
    FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_gp_reopen_tenant_reviewer
    FOREIGN KEY (school_id, reviewed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE announcements
  ADD UNIQUE KEY uq_announcements_school_id (school_id, id),
  ADD CONSTRAINT fk_announcements_tenant_author
    FOREIGN KEY (school_id, author_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE learning_materials
  ADD UNIQUE KEY uq_materials_school_id (school_id, id),
  ADD CONSTRAINT fk_materials_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_materials_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_materials_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_materials_tenant_teacher
    FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE journal_subjects
  ADD UNIQUE KEY uq_journal_subjects_school_id (school_id, id),
  ADD CONSTRAINT fk_journal_subjects_tenant_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT;

ALTER TABLE narrative_reports
  ADD UNIQUE KEY uq_narrative_reports_school_id (school_id, id),
  ADD CONSTRAINT fk_narrative_reports_tenant_student
    FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_narrative_reports_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_narrative_reports_tenant_teacher
    FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_narrative_reports_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT;

ALTER TABLE intervention_plans
  ADD UNIQUE KEY uq_intervention_plans_school_id (school_id, id),
  ADD CONSTRAINT fk_intervention_plans_tenant_student
    FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervention_plans_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervention_plans_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_intervention_plans_tenant_creator
    FOREIGN KEY (school_id, created_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;

ALTER TABLE school_form_exports
  ADD UNIQUE KEY uq_school_form_exports_school_id (school_id, id),
  ADD CONSTRAINT fk_school_form_exports_tenant_section
    FOREIGN KEY (school_id, section_id) REFERENCES sections(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_school_form_exports_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_school_form_exports_tenant_user
    FOREIGN KEY (school_id, requested_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT;
