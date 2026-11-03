const SUPPORTED_GRADE_CODE_PATTERN = /^grade-(?:[2-9]|1[0-2])$/;

function isSupportedGradeCode(value) {
  return SUPPORTED_GRADE_CODE_PATTERN.test(String(value || '').trim().toLowerCase());
}

module.exports = { isSupportedGradeCode };
