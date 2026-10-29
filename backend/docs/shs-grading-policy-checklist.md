# Strengthened SHS grading rules

This file records the policy used by the SHS gradebook. Academix supports only the Strengthened SHS curriculum for Grade 11 and Grade 12. It does not implement or fall back to the former SHS curriculum.

## Sources and cohort scope

| Rule | Source | Implementation decision |
| --- | --- | --- |
| Strengthened curriculum and pathways | [DO 017, s. 2026](https://www.deped.gov.ph/wp-content/uploads/DO_s2026_017r.pdf) | Use the Strengthened SHS subject and pathway records only. |
| Grade 11 and Grade 12 curriculum | [DO 017, s. 2026](https://www.deped.gov.ph/wp-content/uploads/DO_s2026_017r.pdf) | Both grades use Strengthened SHS subjects and pathways. Academix has no school-specific early-start setting and no former-curriculum fallback. |
| Component weights and exam structure | [DO 015, s. 2026](https://www.deped.gov.ph/wp-content/uploads/DO_s2026_015r.pdf), section 44, Table 10, Annex D | Use the explicit assessment groups below. For groups with the standard exam structure, ST1, ST2, and Term Exam divide the examination component 30%, 30%, and 40%. |
| SY 2026-2027 conversion and later grading | DO 015, sections 48-50 and Annex D | Use the adjusted table in SY 2026-2027. Beginning SY 2027-2028, use zero-based grading with no transmutation. |
| Final subject grade and pass mark | DO 015, section 52 | Average the term grades and round to the nearest whole number. A final grade of 75 or higher passes. |

The application requires Grade 11 or Grade 12 and a Strengthened SHS section. Grade 12 does not need a separate school-specific activation setting. Normal school, enrollment, academic-year, permission, and valid-grade checks still apply.

## Confirmed DO 015 assessment groups

| SHS subject group | Written/Oral Works | Product/Performance Tasks | Examinations | Required examination items |
| --- | ---: | ---: | ---: | --- |
| Core subjects | 20% | 50% | 30% | ST1 30%, ST2 30%, Term Exam 40% of the examination component |
| Other Academic electives | 20% | 50% | 30% | ST1 30%, ST2 30%, Term Exam 40% of the examination component |
| Field Exposure, Arts Apprenticeship, Creative Production and Innovation | 15% | 70% | 15% | Term Exam only; it carries the full examination weight |
| Arts, Sports, and Health and Wellness electives | 20% | 60% | 20% | ST1 30%, ST2 30%, Term Exam 40% of the examination component |
| Research electives and Design and Innovation | 40% | 60% | None | No examination component |
| TechPro electives | 15% | 65% | 20% | ST1 30%, ST2 30%, Term Exam 40% of the examination component |
| Work Immersion | 20% | 80% | None | No examination component |

Every approved elective has an explicit catalog assessment group. Unknown groups, unsupported grades, and school years before SY 2026-2027 are blocked; the system does not infer a rule from a subject name.

## Grade calculation

1. For each component, combine its recorded item scores and maximum scores into a percentage score.
2. Apply the Table 10 component weight. For an examination component with the standard structure, apply the 30/30/40 split to ST1, ST2, and the Term Exam. Field Exposure uses only the Term Exam. Research/Design and Work Immersion have no examination component.
3. Add the weighted components to get the Initial Grade. Required items and valid scores are needed before publication.
4. In SY 2026-2027, apply the DO 015 Annex D adjusted table. It maps an Initial Grade of 70.00 to 75, uses the published two-decimal bands, and produces a whole-number Term Grade. From SY 2027-2028 onward, do not transmute; round the Initial Grade to a whole-number Term Grade.
5. For the final subject grade, average all configured Term Grades and round to the nearest whole number. A result of 75 or higher is passing.

## Code and test safeguards

- These rules are centralized in `backend/config/shsGrading.js` and are recorded in each publication snapshot.
- School administrators may save subject- or offering-specific component and exam-part weights for one school year through School Settings. The DepEd table above remains the starting default. A saved rule is used by both teacher gradebooks and captured in later publication snapshots; it does not rewrite earlier publications. Rules with published grades are locked for that school year. Academix labels custom rules but does not certify any external approval for them.
- Tests cover every explicit group, exam requirements, no-exam groups, missing or invalid scores, a published computation example, adjusted-table boundaries, later zero-based grading, and rejection of unsupported grade levels.
- Grade publication remains protected by `SHS_SELECTION_ENABLED`. Keep that switch off until the test-school flow and policy checks pass.
- Migration 054 was applied manually to the development database, including its partial-import resume. The application never runs migrations automatically. Applied schema alone does not verify grading or authorize release.
