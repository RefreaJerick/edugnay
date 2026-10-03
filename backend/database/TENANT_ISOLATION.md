# School data isolation

Academix uses one MySQL database for all schools. Every school is treated as a separate tenant.

## Access rules

- A `platform_admin` has no school and may use only platform school-account operations.
- A `school_admin`, `teacher`, `student`, or `parent` must belong to one school.
- A school user's school comes from the authenticated database session. A browser-provided `schoolId` cannot change it.
- School administrators may manage records from their own school only.
- Teachers also need the matching active section and subject assignment.
- Students may access only their own records and current or permitted historical enrollment data.
- Parents may access only students linked to their account in the same school.
- Background workers must join events and recipients through the same school.
- Background workers pause queued delivery while a school is suspended.

Intentional platform-wide access is limited to school registration, school status, school account summaries, school logos needed by the platform portal, and platform school-account activity.

Platform administrators do not use school user, section, assignment, grade, attendance, announcement, material, journal, report, or export routes. Those routes require a valid school role and take the school ID from the authenticated session.

## Private files

New assignment submissions, learning materials, school logos, announcement images, and generated SF exports are stored outside the project workspace. Configure their private directories with the matching environment settings in `.env.example`. The API checks the signed-in user's school and role before it opens any protected file, and responses do not expose server paths. Existing assignment submissions and SF exports in the old private backend folders remain readable through their protected endpoints while new files use the external directories.

## Table ownership inventory

| Ownership | Tables | School source | Current protection |
|---|---|---|---|
| Platform | `schools` | Record itself | Intentional global table |
| Platform | `school_form_templates`, `school_form_template_mappings` | None | Shared official templates |
| Direct school | `school_portal_features`, `school_attendance_settings`, `attendance_status_codes`, `academic_years`, `school_levels`, `parent_notification_triggers`, `subjects`, `school_settings`, `sections`, `grading_categories`, `assignments`, `published_final_grades`, `attendance_sessions`, `grading_period_reopen_requests`, `announcements`, `learning_materials`, `journal_subjects`, `narrative_reports`, `intervention_plans`, `school_form_exports`, `holidays`, `audit_logs` | Their `school_id` | Session-scoped checks and same-school foreign keys where records are related |
| User-owned | `user_sessions`, `password_reset_tokens`, role profile tables, `student_qr_credentials`, `user_tasks` | Referenced `users.school_id` | Inherits the user's tenant |
| Relationship | `student_parent_links`, `section_students`, `section_teachers` | Required `school_id` | Composite same-school foreign keys |
| Academic child | `school_grade_levels`, `school_shs_tracks`, `academic_terms`, `academic_term_actions` | Required `school_id` | Composite same-school foreign keys |
| Assignment/grade child | `assignment_submissions`, `grading_items`, `student_scores` | Required `school_id` | Composite same-school foreign keys |
| Attendance child | `attendance_records`, `student_qr_credentials`, `qr_scan_events` | Required `school_id` | Composite same-school foreign keys |
| Communication child | `announcement_audiences`, `announcement_reads`, `announcement_email_outbox` | Required `school_id` | Composite same-school foreign keys |
| Journal child | `journal_prompts`, `student_journal_entries`, `journal_feedback` | Required `school_id` | Composite same-school foreign keys |
| Report child | `report_recommendations`, `report_data_sources`, `report_reopen_requests` | Report or required `school_id` | Reopen requests use same-school foreign keys; report-owned children inherit the report tenant |
| Intervention child | `intervention_actions`, `intervention_progress_entries` | Plan or required `school_id` | Progress entries use same-school foreign keys; actions inherit the plan tenant |
| Export child | `school_form_export_issues` | School form export | Inherits the export tenant |

## Read-only integrity audit

Run from the `backend` directory:

```text
npm run audit:tenant
```

The command checks account roles and cross-school relationships across accounts, academic structure, classes, assignments, grades, attendance, communication, materials, journals, reports, interventions, school forms, and audit logs. It performs `SELECT` queries only. A zero exit code means no mismatch was found; a nonzero exit code means the displayed records must be reviewed before adding database constraints.

## Database constraint checks

The tenant constraint migrations are:

- `019_active_section_enrollments.sql`
- `020_add_core_tenant_constraints.sql`
- `021_add_feature_tenant_constraints.sql`
- `022_add_child_tenant_constraints.sql`
- `023_link_assignment_grading_items.sql`
- `024_track_published_grading_items.sql`

The configured database already has these migrations installed. Do not run them again there. For a different database, run the read-only audit first, create and verify a private database backup, apply each pending migration in order during a maintenance window, then run the audit and schema verifier again. MySQL DDL is not generally rolled back by a transaction, so restore from a verified backup if a migration fails. The snapshot command creates an ignored local JSON file containing schema and private school data; keep it secure and test restoration separately before relying on it for deployment recovery.

Run from `backend`:

```text
npm run audit:tenant
npm run backup:database
npm run verify:tenant
npm run test:tenant:two-school
```

The verifier checks the expected foreign keys, non-null tenant columns, unique keys, active-enrollment generated column, and published-component marker. The two-school test creates temporary accounts and sessions inside one database transaction, exercises cross-school reads and writes, and confirms its test school was rolled back. It requires an active school with saved records and a teacher assignment. Platform administrators remain limited to explicit platform routes; regular school endpoints never become an unscoped platform view.
