const ELEMENTARY_GRADES = ['grade-4', 'grade-5', 'grade-6'];
const JHS_GRADES = ['grade-7', 'grade-8', 'grade-9', 'grade-10'];

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

module.exports = { DEPED_K10_SUBJECTS, ELEMENTARY_GRADES, JHS_GRADES };
