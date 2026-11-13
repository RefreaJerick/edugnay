// DepEd Order No. 015, s. 2026, Annex D, Table 3 (KS2 GMRC and KS3 VE).
const DOMAIN_WEIGHTS = Object.freeze({
  written: Object.freeze({ cognitive: 10, affective: 10 }),
  performance: Object.freeze({ cognitive: 10, affective: 10, behavioral: 30 })
});

function usesDepedValuesDomains(subjectCode, gradeCode, academicYearLabel) {
  const year = Number(String(academicYearLabel || '').slice(0, 4));
  const grade = Number(String(gradeCode || '').replace(/^grade-/, ''));
  const code = String(subjectCode || '').toLowerCase();
  return year >= 2026 && ((code.startsWith('gmrc-') && grade >= 4 && grade <= 6)
    || (code.startsWith('values-education-') && grade >= 7 && grade <= 10));
}

function isDepedValuesSetup(components) {
  if (components.length !== 3) return false;
  const byType = new Map(components.map(component => [component.componentType, component]));
  const exam = byType.get('examination');
  return byType.size === 3 && Number(byType.get('written')?.weight) === 20
    && Number(byType.get('performance')?.weight) === 50 && Number(exam?.weight) === 30
    && (exam.examParts || []).length === 3
    && [['summative-test-1', 30], ['summative-test-2', 30], ['term-exam', 40]].every(([code, weight]) =>
      exam.examParts.some(part => part.code === code && Number(part.weight) === weight));
}

module.exports = { DOMAIN_WEIGHTS, usesDepedValuesDomains, isDepedValuesSetup };
