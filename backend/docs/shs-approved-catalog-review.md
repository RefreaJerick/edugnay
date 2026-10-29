# Strengthened SHS subject catalog review

Reviewed: 27 October 2026. Source: the user-supplied official DepEd Order No. 017, s. 2026, Annex A (printed pages 24–31), cross-checked against its Table 3 and the user-supplied *Strengthened SHS Key Features* PDF. This review concerns subject choices, not school approval or grading policy.

At this review, 131 catalog entries are available for new offerings and 0 remain blocked. The five Grade 11 core subjects are separate in Class Management. Codes identify catalog choices, including separate hour variants of Work Immersion; 131 is not a count of distinct subject titles.

| Group | Entries | New-use status |
| --- | ---: | --- |
| Academic electives | 67 | Available |
| Academic Field Experience | 13 | Available |
| TechPro electives | 48 | Available |
| TechPro Work Immersion | 3 | Available |
| Grade 11 core subjects | 5 | Separate from elective offerings |

## Corrections from Annex A

- Creative Production and Presentation (AE039) is Grade 12, 160 hours per term. Business 3 (AE009) and the specified higher-level science and mathematics subjects have their Annex A grade eligibility; the catalog test checks every code independently.
- All seven Arts Apprenticeship entries are Grade 12, 160 hours each. Design and Innovation and Research 1 and 2 allow Grade 11 or 12. The remaining Field Experience grade and hour values follow Annex A.
- TechPro electives generally allow Grade 11 or 12. Automotive 01/02, Commercial Air-Conditioning, and Mechatronics are Grade 12 only. Names differing from the annex were corrected, retaining old display names as aliases for saved records.
- Academic Work Immersion remains a Grade 12 Academic Field Experience choice (320 hours). TechPro Work Immersion is Grade 12, with 320 hours in one term or 540/640 hours over two terms. Existing WI-320 and WI-640 codes remain; WI-540 was added.
- Previously held Annex A entries are now verified. The picker uses the catalog's `verificationStatus` directly. The server uses the same status, grade, and track eligibility for new offerings and choices.

The independently maintained expected code/name list and grade/hour/category assertions are in `backend/tests/shs-approved-catalog-coverage.test.js`. The DepEd order and Key Features PDFs were read locally; they are not embedded in the repository.

## Existing records

Existing catalog codes and earlier catalog versions remain recognized. Earlier names are retained as aliases, and the prior 80-hour AE039 snapshot remains readable; no existing class, attendance, grade, or membership is rewritten. School staff still decide which catalog choices to offer.

The post-correction read-only offering audit found 21 saved offerings. All 21 still match a compatible catalog code, version, track, type, name, hours, and grade. The earlier audit counted 22 classes; class and membership rows were not rechecked in this pass. No database write, migration, or cleanup was run.
