# AI Narrative Reports development QA — 2026-10-22

Scope: synthetic QA School 01 accounts in `academix`. This is not approval or rollout for the future pilot school.

## Result

- QA School 01 had recorded AI-evidence approval. One AI draft was generated for Miguel Santos for Oct 19–23 using evidence available through Oct 22. The adviser reviewed and confirmed it before an intentional release.
- The linked parent switched from Andrea to Miguel and saw only Miguel's released summary and actions. Report 4 has one immutable version-1 snapshot and one version-1 notification for the linked QA parent. Unreleased, unlinked-learner, and cross-school parent reads returned 404. No private evidence, adviser notes, flags, follow-up details, or correction reasons appeared in the parent response.
- Andrea's earlier version-2 correction, parent view, immutable history, and versioned notification were checked separately. Desktop and narrow-width admin/adviser history screenshots were reviewed; the narrow cards and history stack without clipping. Teacher phone styling remains deferred.
- The focused report, privacy, notification, and account-form tests passed (54/54 after the adviser feedback update). Changed JavaScript syntax checks and `git diff --check` passed. The earlier isolated report checks and backup/restore check passed and were not repeated.
- The user's API restart was confirmed, and `.env` still targets `academix` with generation and release both `false`. The running process's overrides could not be inspected directly from this tool session. No real-school AI request or release was made.

## Separate follow-up: 12 full-suite failures outside Narrative Reports

These did not occur in the focused report checks. They remain for their respective feature areas:

1. Teacher grades: SHS initial-estimate versus transmuted-term-grade UI expectation.
2. Student attendance: subject-session counts, calendar, flagged days, and day details.
3. Student attendance: empty, failure, and retry states showing no sample data.
4. Student attendance: page availability with the legacy attendance flag disabled.
5. Flag cards: compact reasons, plain avatars, and responsive grids.
6. Student materials: browser-supported previews and downloads for every file.
7. Student materials: distinguish empty API results from failed/missing API.
8. Student materials: authorized attachment download and original filename.
9. Student materials: visible download failure and restored button state.
10. Student materials: protected PDF preview and object-URL cleanup.
11. Student materials: authorized video streaming preview.
12. Student materials: preview failure message rather than an empty viewer.

The general two-school isolation script also lacks its expected fixture. This is separate from the report-specific isolated-database checks, which passed. Neither item is evidence of a Narrative Reports failure; both remain open for their owning feature/tests.
