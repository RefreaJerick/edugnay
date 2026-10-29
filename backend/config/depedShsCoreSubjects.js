// Five Grade 11 core subjects in the Strengthened SHS curriculum.
// Effective Communication and Mabisang Komunikasyon are language versions of one subject.
const CORE_GUIDES = 'https://sites.google.com/deped.gov.ph/deped-lrportal/three-term-budget-of-work-bow/grade-11';
const CORE_POLICY = 'https://www.deped.gov.ph/wp-content/uploads/DO_s2026_017r.pdf';
const CORE_HOURS = 'https://www.deped.gov.ph/wp-content/uploads/5_4_2026_SSHS-Key-Features.pdf';
const DEPED_SHS_CORE_SUBJECTS = Object.freeze([
  { code: 'shs-core-communication', name: 'Effective Communication / Mabisang Komunikasyon', levelCode: 'shs', gradeCodes: ['grade-11'], gradeSpecific: true, hours: 160, sourceUrl: CORE_GUIDES, policyUrl: CORE_POLICY, hoursUrl: CORE_HOURS },
  { code: 'shs-core-life-career', name: 'Life and Career Skills', levelCode: 'shs', gradeCodes: ['grade-11'], gradeSpecific: true, hours: 160, sourceUrl: CORE_GUIDES, policyUrl: CORE_POLICY, hoursUrl: CORE_HOURS },
  { code: 'shs-core-mathematics', name: 'General Mathematics', levelCode: 'shs', gradeCodes: ['grade-11'], gradeSpecific: true, hours: 160, sourceUrl: CORE_GUIDES, policyUrl: CORE_POLICY, hoursUrl: CORE_HOURS },
  { code: 'shs-core-science', name: 'General Science', levelCode: 'shs', gradeCodes: ['grade-11'], gradeSpecific: true, hours: 160, sourceUrl: CORE_GUIDES, policyUrl: CORE_POLICY, hoursUrl: CORE_HOURS },
  { code: 'shs-core-philippine-history', name: 'Pag-aaral ng Kasaysayan at Lipunang Pilipino', levelCode: 'shs', gradeCodes: ['grade-11'], gradeSpecific: true, hours: 160, sourceUrl: CORE_GUIDES, policyUrl: CORE_POLICY, hoursUrl: CORE_HOURS }
]);

module.exports = { DEPED_SHS_CORE_SUBJECTS };
