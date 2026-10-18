const DEPED_K10_COMPONENTS = Object.freeze({
  academic: Object.freeze([
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
    {
      code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30,
      examParts: [
        { code: 'summative-test-1', name: 'Summative Test 1', weight: 30 },
        { code: 'summative-test-2', name: 'Summative Test 2', weight: 30 },
        { code: 'term-exam', name: 'Term Exam', weight: 40 }
      ]
    }
  ]),
  applied: Object.freeze([
    { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
    { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 60 },
    {
      code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 20,
      examParts: [
        { code: 'summative-test-1', name: 'Summative Test 1', weight: 30 },
        { code: 'summative-test-2', name: 'Summative Test 2', weight: 30 },
        { code: 'term-exam', name: 'Term Exam', weight: 40 }
      ]
    }
  ])
});

const ACADEMIC_AREA_PREFIXES = [
  'english-', 'filipino-', 'mathematics-', 'science-', 'araling-panlipunan-',
  'gmrc-', 'values-education-', 'makabansa-'
];
const APPLIED_AREA_PREFIXES = [
  'epp-', 'tle-', 'music-and-arts-', 'physical-education-and-health-'
];
const K10_GRADE_CODES = new Set(['grade-4', 'grade-5', 'grade-6', 'grade-7', 'grade-8', 'grade-9', 'grade-10']);
const EARLY_NUMERICAL_GRADE_CODES = new Set(['grade-2', 'grade-3']);
const EARLY_GRADE_COMPONENTS = Object.freeze([
  { code: 'written-oral-works', name: 'Written/Oral Works', componentType: 'written', weight: 20 },
  { code: 'performance-tasks', name: 'Performance Tasks', componentType: 'performance', weight: 50 },
  {
    code: 'examinations', name: 'Examinations', componentType: 'examination', weight: 30,
    examParts: [
      { code: 'summative-test-1', name: 'Summative Test 1', weight: 50 },
      { code: 'summative-test-2', name: 'Summative Test 2', weight: 50 }
    ]
  }
]);

function isDepedK10GradeCode(gradeCode) {
  return K10_GRADE_CODES.has(String(gradeCode || '').trim().toLowerCase());
}

function isDepedEarlyNumericalGradeCode(gradeCode) {
  return EARLY_NUMERICAL_GRADE_CODES.has(String(gradeCode || '').trim().toLowerCase());
}

function isDepedNumericalGradeCode(gradeCode, academicYearLabel) {
  const method = getDepedK10GradeMethod(academicYearLabel);
  if (isDepedK10GradeCode(gradeCode)) return method !== 'standard';
  return isDepedEarlyNumericalGradeCode(gradeCode) && method === 'deped_2026_transmutation';
}

function getDepedNumericalGradeBlockReason(gradeCode, academicYearLabel) {
  const code = String(gradeCode || '').trim().toLowerCase();
  const match = String(academicYearLabel || '').match(/20\d{2}/);
  const startYear = match ? Number(match[0]) : null;
  if (startYear === null || startYear < 2026) return null;
  if (code === 'kindergarten' || code === 'grade-1') {
    return 'Kindergarten and Grade 1 use descriptive reporting and cannot publish numerical grades for this school year.';
  }
  if (startYear >= 2027 && isDepedEarlyNumericalGradeCode(code)) {
    return `The DepEd grading setup for ${code === 'grade-2' ? 'Grade 2' : 'Grade 3'} is not available for this school year yet.`;
  }
  return null;
}

function isDepedEarlyGradeSubjectCode(subjectCode) {
  return /-(?:grade-2|grade-3)$/i.test(String(subjectCode || '').trim());
}

function getDepedK10LearningArea(subjectCode) {
  const code = String(subjectCode || '').trim().toLowerCase();
  if (APPLIED_AREA_PREFIXES.some(prefix => code.startsWith(prefix))) return 'applied';
  if (ACADEMIC_AREA_PREFIXES.some(prefix => code.startsWith(prefix))) return 'academic';
  return null;
}

function getDepedK10GradeMethod(academicYearLabel) {
  const match = String(academicYearLabel || '').match(/20\d{2}/);
  const startYear = match ? Number(match[0]) : null;
  if (startYear === 2026) return 'deped_2026_transmutation';
  if (startYear !== null && startYear >= 2027) return 'deped_zero_based';
  return 'standard';
}

function transmuteDepedK10InitialGrade(initialGrade) {
  const grade = Number(initialGrade);
  if (!Number.isFinite(grade)) return null;
  const value = Math.min(100, Math.max(0, Math.round(grade * 100) / 100));
  if (value >= 99.5) return 100;
  if (value >= 70) return Math.min(99, 75 + Math.floor((value - 70 + 1e-9) / 1.18));
  const lowerBounds = [0, 4.68, 9.34, 14.01, 18.68, 23.35, 28.01, 32.68, 37.34, 42.01, 46.67, 51.34, 56.01, 60.67, 65.34];
  let transmuted = 60;
  lowerBounds.forEach((lowerBound, index) => {
    if (value >= lowerBound) transmuted = 60 + index;
  });
  return transmuted;
}

function applyDepedK10GradeMethod(initialGrade, method, rounding = 'round') {
  if (!Number.isFinite(Number(initialGrade))) return null;
  if (method === 'deped_2026_transmutation') return transmuteDepedK10InitialGrade(initialGrade);
  const grade = Number(initialGrade);
  if (rounding === 'roundup') return Math.ceil(grade);
  if (rounding === 'truncate') return Math.trunc(grade);
  return Math.round(grade);
}

function describeDepedK10GradeMethod(method) {
  if (method === 'deped_2026_transmutation') return 'SY 2026–27 adjusted transmutation table';
  if (method === 'deped_zero_based') return 'Zero-based grading: initial grade rounded to a whole number';
  return 'School grading rules';
}

function createDepedK10DefaultComponents(subjectCode) {
  const learningArea = getDepedK10LearningArea(subjectCode);
  if (!learningArea) return null;
  const components = isDepedEarlyGradeSubjectCode(subjectCode)
    ? EARLY_GRADE_COMPONENTS
    : DEPED_K10_COMPONENTS[learningArea];
  return components.map((component, index) => ({
    ...component,
    sortOrder: index + 1,
    examParts: (component.examParts || []).map((part, partIndex) => ({ ...part, sortOrder: partIndex + 1 }))
  }));
}

module.exports = {
  applyDepedK10GradeMethod,
  createDepedK10DefaultComponents,
  describeDepedK10GradeMethod,
  getDepedNumericalGradeBlockReason,
  getDepedK10GradeMethod,
  getDepedK10LearningArea,
  isDepedEarlyGradeSubjectCode,
  isDepedEarlyNumericalGradeCode,
  isDepedK10GradeCode,
  isDepedNumericalGradeCode,
  transmuteDepedK10InitialGrade
};
