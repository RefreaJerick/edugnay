# Tenant isolation audit result

Audit date: October 3, 2026 (Asia/Manila)

## Result

- Checks completed: 36
- Cross-school or invalid-role mismatches: 0
- Data corrections made: 0
- Database writes performed by the audit: 0
- Tenant constraints verified: 100
- Required non-null tenant columns verified: 21
- Unique tenant indexes verified: 24
- Active-enrollment generated column: valid
- Backend tests passed: 197
- Live two-school attack checks passed: 29, including rollback verification
- Status: Phases 1-13 verified against the configured local database

The audit ran against the configured Academix MySQL database using:

```text
npm run audit:tenant
```

## Passed areas

| Area | Checks |
|---|---|
| Accounts | User school requirements, role profiles, parent links, configuration editors |
| Academic structure | Academic-year archivers, terms, term actions, subjects, journal configuration |
| Classes | Sections, student enrollments, teacher subject assignments |
| Grades and assignments | Categories, assignments, submissions, grading items, scores, published grades, reopen requests |
| Attendance | Sessions, records, QR credentials, QR scans |
| Communication | Announcements, section audiences, reads, email queue, notifications |
| Learning materials | Section, subject, term, and teacher ownership |
| Journals | Subject, prompt, creator, grading item, student, section, and feedback ownership |
| Reports and interventions | Narrative reports, reopen actors, plans, terms, and progress actors |
| School forms | Shared template publishers and school export ownership |
| Audit history | School actors, with the intentional platform-admin exception |
| Explicit tenant columns | Child `school_id` values match their main owning records |

## Phase 4-5 result

1. Migration `020` adds direct tenant ownership and same-school keys to core academic, user-link, enrollment, and teacher-assignment records.
2. Migration `021` adds same-school foreign keys to feature records that already stored a school ID.
3. Migration `022` adds a required school ID and same-school foreign keys to child records.
4. Current write paths save the session-derived school ID for every migrated table they create.
5. The read-only audit compares every new child tenant column with its main owning record.
6. The constraint verifier reads the migrations and confirms their required constraints and non-null columns in the configured database.

The verified database snapshot is kept locally under `database/backups/`, which is excluded from Git because it contains private school data. The snapshot contains 59 tables and 536 rows. Invalid and duplicate older copies were removed during project cleanup. No schema migration was rerun during phases 11-13 because migrations 019-022 were already installed in this database.

## Phase 6-8 result

1. Platform administrators are restricted to the dedicated platform school-account routes. They can no longer list, create, import, edit, activate, or deactivate school users, or browse school sections.
2. Shared school routes use one `requireSchoolUser` guard, which rejects platform accounts and invalid school sessions before controller queries run.
3. Assignment, material, announcement, journal, notification, section, archive, and export queries use explicit tenant columns in sensitive joins and writes.
4. Announcement and parent-notification workers join queued and child records through the same school ID.
5. Protected files remain available only after their database-backed role, school, assignment, enrollment, or adviser checks pass.
6. Role-boundary tests cover all four school roles, platform denial, and tenant-aware worker joins.

## Phase 9-10 result

1. Parent-child reads, student self-service, teacher section access, grade reads, attendance, QR credentials, and SF learner records now carry the authenticated school ID through their identity checks and joins.
2. Assignment submissions and generated SF exports now default to private directories outside the project workspace. Existing protected files in the old backend folders remain available for compatibility.
3. Assignment submissions are checked by file signature. OOXML files must contain the expected Word, PowerPoint, or Excel package and cannot contain VBA macros.
4. Assignment, material, announcement-image, school-logo, and SF-export downloads remain behind database-backed role and ownership checks. Server storage paths are not returned to the browser.
5. Announcement email delivery pauses while a school is inactive, and parent-notification workers select records only from active schools.
6. Regression tests cover student QR self-access, cross-school QR denial, invalid assignment file contents, parent and teacher scopes, protected files, and worker tenant/status joins.

Run these checks after future schema or data changes:

```text
npm run audit:tenant
npm run verify:tenant
```

## Phase 11-13 result

1. A second active school, four school-role users, and their sessions were created inside a transaction. School admin, teacher, student, and parent attempts to access the first school's accounts, grades, attendance, announcements, QR data, assignment submissions, materials, form exports, logos, and notifications were denied or returned empty lists.
2. Cross-school parent links, enrollments, teacher assignments, assignment submissions, and attendance records were rejected by database foreign keys. A suspended school's session was denied. The transaction was rolled back, and the temporary school was confirmed absent.
3. A consistent-snapshot backup was created and read back successfully. The schema verifier confirmed all 100 foreign-key constraints, 21 required tenant columns, 24 unique indexes, and the active-enrollment generated column. No installed migration was reapplied.
4. The read-only integrity audit again reported zero mismatches across 36 checks. All 197 backend tests passed. Source review found no additional concrete cross-school access path in the scoped controllers and workers.

This is a local verification, not a claim that a hosted deployment or restore procedure has been tested. Run the same checks and test a restore before deploying to a different database.

## Score-component deletion follow-up (October 3, 2026)

Migration `023_link_assignment_grading_items.sql` was applied to the local database after a fresh, read-back-verified snapshot was saved under `database/backups/` (59 tables, 524 rows). Both existing graded assignments matched unique score components and were linked. The verifier now reports 101 tenant constraints, 21 required tenant columns, and 25 unique tenant indexes. The read-only audit still reports zero mismatches across 36 checks. These updated figures supersede the earlier phase 11-13 snapshot figures above; the earlier section records the verification at that time.

Graded assignment creation now creates its score component in the same transaction. Component deletion is limited to the owning school and teacher, requires grading-period write access, and is blocked for linked assignments, journal prompts, and published grades. Score deletion, component deletion, and the audit entry commit together. The full backend suite passes 209 tests. This was verified locally; the hosted database must receive migration `023` before deploying the updated API.

## Published-component follow-up (October 3, 2026)

Migration `024_track_published_grading_items.sql` was applied after a verified private snapshot (59 tables, 536 rows). It conservatively marked legacy components that could have contributed to published grades, including same-second cases. Of 13 local components, 9 were protected and 4 were unmarked; 2 unmarked components are in scopes with published grades. Future publish and republish transactions mark the exact components used. Deletion now permits an unmarked component while still enforcing teacher, school, grading-period, assignment, and journal restrictions.

The schema verifier confirmed the new non-null publication marker and the existing 101 tenant constraints, 21 tenant columns, and 25 unique indexes. The read-only tenant audit found zero mismatches across 36 checks. All 214 backend tests passed. Migration `024` must be applied to other databases before deploying the updated API; the local browser flow has not been manually tested.

## Linked assignment deletion follow-up (October 3, 2026)

Deleting a graded assignment now deletes its linked score component in one transaction only when it has no submissions, recorded scores or remarks, published use, or journal link and the requester has the required school and grading-period access. Empty score placeholder rows may be removed with the pair. The admin activity log records the assignment deletion. A rollback-only run of the actual delete handler against the local `test` pair returned HTTP 204; the assignment, component, and two blank score placeholders all remained afterward. All 226 backend tests, the two-school isolation test, and the schema verifier passed; the tenant audit reported zero mismatches.
