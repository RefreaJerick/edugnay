const {
  describeDepedK10GradeMethod,
  getDepedK10GradeMethod
} = require('../config/depedK10Grading');

const GRADING_MODES = new Set(['deped_policy', 'school_specific']);
const ROUNDING_RULES = new Set(['round', 'roundup', 'truncate']);

async function loadK10FinalGradeRules(connection, { schoolId, academicYearId, schoolLevelId, academicYearLabel, gradingPeriodType }) {
  const [rows] = await connection.execute(
    `SELECT grading_mode AS gradingMode, passing_grade_threshold AS passingGradeThreshold,
      grade_rounding AS gradeRounding
    FROM school_year_final_grade_rules
    WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ? LIMIT 1`,
    [schoolId, academicYearId, schoolLevelId]
  );
  const saved = rows[0] || null;
  const policyMethod = getDepedK10GradeMethod(academicYearLabel);
  const gradingMode = saved?.gradingMode || 'deped_policy';
  const isDepedPolicy = gradingMode === 'deped_policy';
  const gradingMethod = isDepedPolicy ? policyMethod : 'school_direct';
  const [[termCount]] = await connection.execute(
    'SELECT COUNT(*) AS termCount FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ?',
    [schoolId, academicYearId, schoolLevelId]
  );
  const periodStructureCompatible = !isDepedPolicy
    || (gradingPeriodType === 'trimestral' && Number(termCount?.termCount || 0) === 3);
  const publishedGradeCodes = ['grade-2', 'grade-3', 'grade-4', 'grade-5', 'grade-6', 'grade-7', 'grade-8', 'grade-9', 'grade-10'];
  const [[publishedRow]] = await connection.execute(
    `SELECT COUNT(*) AS gradeCount
    FROM published_final_grades AS grades
    INNER JOIN sections ON sections.id = grades.section_id AND sections.school_id = grades.school_id
    INNER JOIN school_grade_levels AS grade_levels ON grade_levels.id = sections.grade_level_id
      AND grade_levels.school_id = sections.school_id
    WHERE grades.school_id = ? AND sections.academic_year_id = ? AND sections.school_level_id = ?
      AND grade_levels.grade_code IN (${publishedGradeCodes.map(() => '?').join(',')})`,
    [schoolId, academicYearId, schoolLevelId, ...publishedGradeCodes]
  );
  const locked = Number(publishedRow?.gradeCount || 0) > 0;
  const gradingMethodLabel = gradingMethod === 'school_direct'
    ? 'School-specific direct grade'
    : describeDepedK10GradeMethod(gradingMethod);

  return {
    gradingMode,
    gradingMethod,
    gradingMethodLabel,
    passingGradeThreshold: isDepedPolicy ? 75 : Number(saved?.passingGradeThreshold ?? 75),
    gradeRounding: isDepedPolicy ? 'round' : saved?.gradeRounding || 'round',
    source: gradingMode === 'school_specific' ? 'school_specific' : 'deped_default',
    locked,
    periodStructureCompatible,
    periodStructureWarning: !periodStructureCompatible
      ? 'The DepEd method requires a three-term school year. Complete the three-term setup in School Settings > Academic Terms before publishing.'
      : null
  };
}

module.exports = { GRADING_MODES, ROUNDING_RULES, loadK10FinalGradeRules };
