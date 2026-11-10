-- Register the Grade 12 Academic SF9 for strengthened curriculum pilot sections in 2026-2027.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF9', 'Learner''s Performance Report (Grade 12 Academic)', 'g12-academic-2026-2027',
   'official', 'active', 'ready', 'SF9-G12-Academic.xlsx',
   '/assets/templates/school-forms/sf9-g12-academic.xlsx', 'SF9 - GRADE 12 ACADEMIC', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT template.id, fields.field_key, template.default_sheet_name, fields.cell_reference, fields.data_source
FROM school_form_templates AS template
CROSS JOIN (
  SELECT 'region' AS field_key, 'B7' AS cell_reference, 'schools.region_name' AS data_source
  UNION ALL SELECT 'division', 'B8', 'schools.division_name'
  UNION ALL SELECT 'district', 'B9', 'schools.district_name'
  UNION ALL SELECT 'address', 'B10', 'schools.address_line'
  UNION ALL SELECT 'schoolName', 'B12', 'schools.name'
  UNION ALL SELECT 'schoolYear', 'B15', 'academic_years.label'
  UNION ALL SELECT 'learnerName', 'C17', 'users, student_profiles'
  UNION ALL SELECT 'age', 'I17', 'student_profiles.birth_date'
  UNION ALL SELECT 'sex', 'K17', 'student_profiles.sex'
  UNION ALL SELECT 'lrn', 'C18', 'student_profiles.lrn'
  UNION ALL SELECT 'gradeLevel', 'I18', 'school_grade_levels.display_name'
  UNION ALL SELECT 'section', 'K18', 'sections.name'
  UNION ALL SELECT 'track', 'E19', 'school_shs_tracks.display_name'
  UNION ALL SELECT 'adviser', 'H27', 'users.display_name'
  UNION ALL SELECT 'electiveSubject1', 'B33', 'approved shs_selection_request_classes'
  UNION ALL SELECT 'firstTermGrade', 'F33', 'published_final_grades'
  UNION ALL SELECT 'secondTermGrade', 'G36', 'published_final_grades'
  UNION ALL SELECT 'thirdTermGrade', 'H39', 'published_final_grades'
  UNION ALL SELECT 'finalGrade', 'I33', 'published_final_grades'
  UNION ALL SELECT 'generalAverage', 'I43', 'adviser review'
) AS fields
WHERE template.form_code = 'SF9' AND template.version = 'g12-academic-2026-2027';
