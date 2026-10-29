-- Apply manually after migration 055. Do not apply to a database twice.
-- The JSON rule becomes the source of truth; the original weight columns remain
-- for compatibility with the already-applied 055 table and its constraints.
ALTER TABLE shs_grading_profiles
  ADD COLUMN components_json JSON NULL AFTER exam_parts;

UPDATE shs_grading_profiles
SET components_json = JSON_ARRAY(
  JSON_OBJECT(
    'code', 'written', 'name', 'Written/Oral Works',
    'componentType', 'written', 'weight', written_weight, 'examParts', JSON_OBJECT()
  ),
  JSON_OBJECT(
    'code', 'performance', 'name', 'Performance Tasks',
    'componentType', 'performance', 'weight', performance_weight, 'examParts', JSON_OBJECT()
  ),
  IF(examination_weight > 0,
    JSON_OBJECT(
      'code', 'examination', 'name', 'Examinations',
      'componentType', 'examination', 'weight', examination_weight,
      'examParts', COALESCE(JSON_EXTRACT(exam_parts, '$'), JSON_OBJECT())
    ),
    NULL
  )
)
WHERE components_json IS NULL;

-- Remove the NULL placeholder used for profiles without an examination.
UPDATE shs_grading_profiles
SET components_json = JSON_REMOVE(components_json, '$[2]')
WHERE examination_weight = 0 AND JSON_LENGTH(components_json) = 3;
