const { policyFor, defaultComponents, componentWeights, componentsEqual } = require('../config/shsGrading');

function parseParts(value) {
  if (!value) return {};
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function parseComponents(value) {
  if (!value) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return null;
  return parsed.map(component => ({ ...component,
    weight: Number(component.weight),
    examParts: parseParts(component.examParts) }));
}

async function loadShsPolicy(db, scope) {
  const policy = policyFor(scope.group, scope.yearLabel, scope.gradeCode);
  if (!policy) return null;
  const [rows] = await db.execute(
    `SELECT written_weight AS written, performance_weight AS performance,
      examination_weight AS examination, exam_parts AS examParts, components_json AS componentsJson
     FROM shs_grading_profiles WHERE school_id = ? AND academic_year_id = ? AND ${scope.kind === 'core' ? 'subject_id = ?' : 'offering_id = ?'} LIMIT 1`,
    [scope.schoolId, scope.yearId, scope.kind === 'core' ? scope.subjectId : scope.offeringId]
  );
  if (!rows.length) return policy;
  const row = rows[0];
  const legacyWeights = { ...policy.weights, written: Number(row.written),
    performance: Number(row.performance), examination: Number(row.examination) };
  const legacyParts = parseParts(row.examParts);
  const components = parseComponents(row.componentsJson) || defaultComponents({ ...legacyWeights,
    termExamOnly: policy.weights.termExamOnly });
  if (!row.componentsJson) {
    for (const component of components) {
      if (component.code === 'examination') component.examParts = legacyParts;
    }
  }
  const customized = !componentsEqual(components, policy.components);
  return { ...policy, weights: componentWeights(components), components,
    examParts: legacyParts, source: customized ? 'School-customized rule' : policy.source };
}

module.exports = { loadShsPolicy, parseComponents };
