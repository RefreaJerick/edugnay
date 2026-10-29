// DepEd Order No. 015, s. 2026, section 44 and Table 10 (KS4), with details
// in Annex D. These rules apply to Strengthened SHS Grade 11 and Grade 12.
// Explicit groups prevent a subject title from choosing its own assessment weights.
const GROUPS = Object.freeze({
  core: { written: 20, performance: 50, examination: 30 },
  academic_general: { written: 20, performance: 50, examination: 30 },
  field_exposure: { written: 15, performance: 70, examination: 15, termExamOnly: true },
  arts_sports_wellness: { written: 20, performance: 60, examination: 20 },
  research_design: { written: 40, performance: 60, examination: 0 },
  techpro: { written: 15, performance: 65, examination: 20 },
  work_immersion: { written: 20, performance: 80, examination: 0 }
});

const POLICY_SOURCES = Object.freeze({
  order: 'DepEd Order No. 015, s. 2026, sections 44-50 and 52, Table 10 and Annex D',
  url: 'https://www.deped.gov.ph/wp-content/uploads/DO_s2026_015r.pdf',
  curriculum: 'DepEd Order No. 017, s. 2026'
});
const CONFIRMED_GROUPS = new Set(Object.keys(GROUPS));
const STANDARD_COMPONENTS = Object.freeze([
  { code: 'written', name: 'Written/Oral Works', componentType: 'written' },
  { code: 'performance', name: 'Performance Tasks', componentType: 'performance' },
  { code: 'examination', name: 'Examinations', componentType: 'examination' }
]);

function defaultComponents(weights) {
  return STANDARD_COMPONENTS.filter(component => Number(weights[component.code]) > 0).map(component => ({
    ...component,
    weight: Number(weights[component.code]),
    examParts: component.code === 'examination'
      ? (weights.termExamOnly ? { term_exam: 100 }
        : { summative_test_1: 30, summative_test_2: 30, term_exam: 40 })
      : {}
  }));
}

function componentWeights(components = []) {
  const weights = { written: 0, performance: 0, examination: 0 };
  for (const component of components) {
    if (Object.hasOwn(weights, component.componentType)) weights[component.componentType] += Number(component.weight) || 0;
  }
  return weights;
}

function componentsEqual(left = [], right = []) {
  const partName = code => ({ summative_test_1: 'Summative Test 1', summative_test_2: 'Summative Test 2',
    term_exam: 'Term Exam' })[code] || String(code).replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const normalize = components => components.map(component => ({
    code: String(component.code),
    name: String(component.name),
    componentType: String(component.componentType),
    weight: Number(component.weight),
    examParts: Object.entries(component.examParts || {}).map(([code, value]) => ({
      code,
      name: typeof value === 'object' && value.name ? String(value.name) : partName(code),
      weight: Number(typeof value === 'object' ? value.weight : value)
    })).sort((a, b) => a.code.localeCompare(b.code))
  }));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function policyBlockReason(group, academicYearLabel, gradeCode) {
  const startYear = Number(String(academicYearLabel || '').match(/20\d{2}/)?.[0]);
  if (!GROUPS[group]) return 'This SHS assessment group has no verified grading rule.';
  if (!['grade-11', 'grade-12'].includes(String(gradeCode || '').toLowerCase())) {
    return 'Strengthened SHS grading is available only for Grade 11 and Grade 12 classes.';
  }
  if (!Number.isInteger(startYear) || startYear < 2026) return 'Strengthened SHS grading is not configured for this school year.';
  return null;
}

function policyFor(group, academicYearLabel, gradeCode) {
  const weights = GROUPS[group];
  const startYear = Number(String(academicYearLabel || '').match(/20\d{2}/)?.[0]);
  if (!weights || !CONFIRMED_GROUPS.has(group)
    || policyBlockReason(group, academicYearLabel, gradeCode)) return null;
  const examParts = weights.examination
    ? (weights.termExamOnly ? { term_exam: 100 }
      : { summative_test_1: 30, summative_test_2: 30, term_exam: 40 }) : {};
  const components = defaultComponents(weights);
  return { group, weights: { ...componentWeights(components), ...(weights.termExamOnly ? { termExamOnly: true } : {}) }, components, examParts,
    method: startYear === 2026 ? 'adjusted_2026' : 'zero_based', source: POLICY_SOURCES.order };
}

function requiredParts(policy, componentCode = 'examination') {
  const component = policy?.components?.find(row => row.code === componentCode);
  if (component) return Object.keys(component.examParts || {});
  if (!policy?.weights?.examination) return [];
  return policy.weights.termExamOnly ? ['term_exam'] : Object.keys(policy.examParts || {});
}

// DO 015 Annex D adjusted transmutation table for SY 2026-2027. This is
// SHS-specific instead of borrowing the K-10 curriculum's grading helper.
function transmuteStrengthenedShsInitialGrade(initialGrade) {
  const grade = Number(initialGrade);
  if (!Number.isFinite(grade)) return null;
  const value = Math.min(100, Math.max(0, Math.round(grade * 100) / 100));
  if (value >= 99.5) return 100;
  if (value >= 70) return Math.min(99, 75 + Math.floor((value - 70 + 1e-9) / 1.18));
  const lowerBounds = [0, 4.68, 9.35, 14.01, 18.68, 23.35, 28.01, 32.68, 37.34,
    42.01, 46.67, 51.34, 56.01, 60.67, 65.34];
  let transmuted = 60;
  lowerBounds.forEach((lowerBound, index) => {
    if (value >= lowerBound) transmuted = 60 + index;
  });
  return transmuted;
}

function calculateTermGrade(policy, items, scoresByItem) {
  if (!policy) return { problem: 'The grading policy for this SHS class is not confirmed.' };
  let initialGrade = 0;
  const components = policy.components || defaultComponents({ ...policy.weights,
    termExamOnly: policy.weights.termExamOnly });
  for (const component of components) {
    const weight = Number(component.weight);
    if (!weight) continue;
    const examParts = component.examParts || {};
    const parts = Object.keys(examParts).length ? Object.keys(examParts) : [null];
    let componentPercent = 0;
    for (const part of parts) {
      const scoped = items.filter(item => item.componentCode === component.code
        && (part === null || item.examPartCode === part));
      if (!scoped.length) return { problem: `Add ${part || component.code} assessment items first.` };
      const highest = scoped.reduce((sum, item) => sum + Number(item.maxScore), 0);
      if (!Number.isFinite(highest) || highest <= 0) return { problem: 'Assessment maximum scores must be positive.' };
      let earned = 0;
      for (const item of scoped) {
        const score = scoresByItem.get(Number(item.id));
        if (score === undefined || score === null || !Number.isFinite(Number(score))
          || Number(score) < 0 || Number(score) > Number(item.maxScore)) {
          return { problem: `Resolve the missing or invalid score for ${item.title}.` };
        }
        earned += Number(score);
      }
      const partWeight = part === null ? 1
        : Number(typeof examParts[part] === 'object' ? examParts[part].weight : examParts[part]) / 100;
      componentPercent += earned / highest * partWeight;
    }
    initialGrade += componentPercent * weight;
  }
  const roundedInitial = Math.round(initialGrade * 100) / 100;
  const termGrade = policy.method === 'adjusted_2026'
    ? transmuteStrengthenedShsInitialGrade(roundedInitial) : Math.round(roundedInitial);
  return { initialGrade: roundedInitial, termGrade };
}

function calculateSubjectFinal(termGrades) {
  if (!termGrades.length || termGrades.some(value => !Number.isInteger(Number(value))
    || Number(value) < 0 || Number(value) > 100)) return null;
  return Math.round(termGrades.reduce((sum, value) => sum + Number(value), 0) / termGrades.length);
}

module.exports = { GROUPS, POLICY_SOURCES, policyFor, policyBlockReason, requiredParts,
  defaultComponents, componentWeights, componentsEqual, transmuteStrengthenedShsInitialGrade,
  calculateTermGrade, calculateSubjectFinal };
