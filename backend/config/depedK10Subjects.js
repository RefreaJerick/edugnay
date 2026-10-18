const ELEMENTARY_GRADES = ['grade-4', 'grade-5', 'grade-6'];
const JHS_GRADES = ['grade-7', 'grade-8', 'grade-9', 'grade-10'];
const EARLY_GRADE_SUBJECTS = [
  ...['grade-2', 'grade-3'].flatMap(gradeCode => [
    { code: `filipino-${gradeCode}`, name: 'Filipino', levelCode: 'elementary', gradeCodes: [gradeCode], gradeSpecific: true },
    { code: `english-${gradeCode}`, name: 'English', levelCode: 'elementary', gradeCodes: [gradeCode], gradeSpecific: true },
    { code: `mathematics-${gradeCode}`, name: 'Mathematics', levelCode: 'elementary', gradeCodes: [gradeCode], gradeSpecific: true },
    { code: `gmrc-${gradeCode}`, name: 'Good Manners and Right Conduct (GMRC)', levelCode: 'elementary', gradeCodes: [gradeCode], gradeSpecific: true },
    { code: `makabansa-${gradeCode}`, name: 'Makabansa', levelCode: 'elementary', gradeCodes: [gradeCode], gradeSpecific: true }
  ]),
  { code: 'science-grade-3', name: 'Science', levelCode: 'elementary', gradeCodes: ['grade-3'], gradeSpecific: true }
];

// Learning-area names are based on DepEd's Revised K to 10 curriculum guides:
// https://www.deped.gov.ph/matatagcurriculumk147/
// EPP/TLE grade coverage follows the official Grades 4-10 guide.
const DEPED_K10_SUBJECTS = [
  ...[
    ['english', 'English'],
    ['filipino', 'Filipino'],
    ['mathematics', 'Mathematics'],
    ['science', 'Science'],
    ['araling-panlipunan', 'Araling Panlipunan'],
    ['music-and-arts', 'Music & Arts'],
    ['physical-education-and-health', 'Physical Education & Health']
  ].flatMap(([code, name]) => [
    { code: `${code}-elementary`, name, levelCode: 'elementary', gradeCodes: ELEMENTARY_GRADES },
    { code: `${code}-jhs`, name, levelCode: 'jhs', gradeCodes: JHS_GRADES }
  ]),
  { code: 'gmrc-elementary', name: 'Good Manners and Right Conduct (GMRC)', levelCode: 'elementary', gradeCodes: ELEMENTARY_GRADES },
  { code: 'values-education-jhs', name: 'Values Education', levelCode: 'jhs', gradeCodes: JHS_GRADES },
  { code: 'epp-elementary', name: 'Edukasyong Pantahanan at Pangkabuhayan (EPP)', levelCode: 'elementary', gradeCodes: ELEMENTARY_GRADES },
  { code: 'tle-jhs', name: 'Technology and Livelihood Education (TLE)', levelCode: 'jhs', gradeCodes: JHS_GRADES }
];

const DEPED_GRADE_SUBJECTS = [...EARLY_GRADE_SUBJECTS, ...DEPED_K10_SUBJECTS];

module.exports = { DEPED_GRADE_SUBJECTS, DEPED_K10_SUBJECTS, EARLY_GRADE_SUBJECTS, ELEMENTARY_GRADES, JHS_GRADES };
