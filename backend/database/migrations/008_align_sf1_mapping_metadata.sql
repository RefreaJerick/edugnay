-- Apply once to an existing database. The controller mapping remains the source of truth.
UPDATE school_form_template_mappings AS mapping
INNER JOIN school_form_templates AS template ON template.id = mapping.school_form_template_id
SET mapping.field_key = CASE mapping.field_key
  WHEN 'studentLrn' THEN 'lrn'
  WHEN 'studentName' THEN 'name'
  WHEN 'guardian' THEN 'guardianName'
  WHEN 'parentContactNumber' THEN 'contactNumber'
  WHEN 'address' THEN 'houseStreet'
  ELSE mapping.field_key END,
  mapping.data_source = CASE mapping.cell_reference
  WHEN 'O10' THEN 'student_profiles.house_street'
  ELSE mapping.data_source END
WHERE template.form_code = 'SF1'
  AND mapping.field_key IN ('studentLrn', 'studentName', 'guardian', 'parentContactNumber', 'address');

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'barangay', default_sheet_name, 'P10', 'student_profiles.barangay'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'cityMunicipality', default_sheet_name, 'Q10', 'student_profiles.city_municipality'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'province', default_sheet_name, 'R10', 'student_profiles.province'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'guardianRelationship', default_sheet_name, 'Y10', 'student_parent_links.relationship'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'remarks', default_sheet_name, 'AA10', 'teacher.edit'
FROM school_form_templates WHERE form_code = 'SF1';
