const { DOMAIN_WEIGHTS, usesDepedValuesDomains } = require('../config/depedValuesDomains');

async function resolveValuesDomainCode(connection, schoolId, sectionId, subjectId, componentId, value) {
  if (!componentId && (value == null || value === '')) return null;
  const [[scope]] = await connection.execute(
    `SELECT subjects.subject_code AS subjectCode, levels.grade_code AS gradeCode,
      years.label AS academicYearLabel, components.component_type AS componentType
    FROM sections
    INNER JOIN subjects ON subjects.id = ? AND subjects.school_id = sections.school_id
    INNER JOIN school_grade_levels AS levels ON levels.id = sections.grade_level_id
    INNER JOIN academic_years AS years ON years.id = sections.academic_year_id
    LEFT JOIN subject_grading_components AS components ON components.id = ?
      AND components.school_id = sections.school_id
    WHERE sections.id = ? AND sections.school_id = ? LIMIT 1`,
    [subjectId, componentId, sectionId, schoolId]
  );
  const domainCode = value == null || value === '' ? null : String(value).trim().toLowerCase();
  const applicable = scope && usesDepedValuesDomains(scope.subjectCode, scope.gradeCode, scope.academicYearLabel);
  const allowed = applicable && DOMAIN_WEIGHTS[scope.componentType];
  if (allowed) {
    if (!Object.hasOwn(allowed, domainCode)) {
      const error = new Error(`Choose a ${scope.componentType} domain for this GMRC/Values Education item.`);
      error.status = 400;
      throw error;
    }
  } else if (domainCode) {
    const error = new Error('A domain is available only for GMRC/Values Education Written/Oral Works and Performance Tasks in Grades 4–10.');
    error.status = 400;
    throw error;
  }
  return domainCode;
}

module.exports = { resolveValuesDomainCode };
