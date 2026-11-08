const { GRADING_MODES, ROUNDING_RULES } = require('./k10FinalGradeRules');

function roundGrade(value, rule = 'round') {
  if (rule === 'roundup') return Math.ceil(value);
  if (rule === 'truncate') return Math.trunc(value);
  return Math.round(value);
}

async function loadShsFinalGradeRules(db, { schoolId, yearId, levelId, yearLabel, includeLock = false }) {
  const [rows] = await db.execute(
    `SELECT grading_mode AS gradingMode, passing_grade_threshold AS passingGradeThreshold,
      grade_rounding AS gradeRounding
     FROM school_year_final_grade_rules
     WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ? LIMIT 1`,
    [schoolId, yearId, levelId]
  );
  const saved = rows[0];
  const gradingMode = saved?.gradingMode === 'school_specific' ? 'school_specific' : 'deped_policy';
  const startYear = Number(String(yearLabel || '').match(/20\d{2}/)?.[0]);
  const supported = Number.isInteger(startYear) && startYear >= 2026;
  let locked = false;
  if (includeLock) {
    const [published] = await db.execute(
      `SELECT 1 FROM published_final_grades p
       JOIN academic_terms t ON t.id = p.academic_term_id AND t.school_id = p.school_id
       WHERE p.school_id = ? AND t.academic_year_id = ? AND t.school_level_id = ? LIMIT 1`,
      [schoolId, yearId, levelId]
    );
    const [communication] = await db.execute(
      `SELECT 1 FROM shs_communication_component_grades p
       JOIN academic_terms t ON t.id = p.academic_term_id AND t.school_id = p.school_id
       WHERE p.school_id = ? AND t.academic_year_id = ? AND t.school_level_id = ? LIMIT 1`,
      [schoolId, yearId, levelId]
    );
    locked = published.length > 0 || communication.length > 0;
  }
  return {
    gradingMode,
    gradingMethod: !supported ? null : gradingMode === 'school_specific' ? 'school_direct'
      : startYear === 2026 ? 'adjusted_2026' : 'zero_based',
    supported,
    passingGradeThreshold: gradingMode === 'school_specific' ? Number(saved.passingGradeThreshold) : 75,
    gradeRounding: gradingMode === 'school_specific' ? saved.gradeRounding : 'round',
    source: gradingMode === 'school_specific' ? 'school_specific' : 'deped_default',
    locked
  };
}

module.exports = { GRADING_MODES, ROUNDING_RULES, roundGrade, loadShsFinalGradeRules };
