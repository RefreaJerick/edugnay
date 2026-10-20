-- Move SF9 final-grade fields into the supplied three-term form layout.
UPDATE school_form_template_mappings AS mappings
INNER JOIN school_form_templates AS templates
  ON templates.id = mappings.school_form_template_id
SET mappings.cell_reference = CASE mappings.field_key
      WHEN 'finalGrade' THEN 'I32'
      WHEN 'generalAverage' THEN 'I42'
    END,
    mappings.data_source = CASE mappings.field_key
      WHEN 'finalGrade' THEN 'mean of published grades for exactly three terms; calculated per school-year rules'
      WHEN 'generalAverage' THEN 'mean of completed subject final grades for three terms; adviser-entered for SY 2026-2027'
    END
WHERE templates.form_code = 'SF9'
  AND templates.version = '1.0'
  AND mappings.field_key IN ('finalGrade', 'generalAverage');
