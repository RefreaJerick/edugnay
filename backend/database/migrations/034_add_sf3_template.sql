-- Register the official SF3 roster draft. Book issue and return tracking remains manual.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF3', 'Books Issued and Returned', '1.0', 'official', 'active', 'ready',
   'SF3.xlsx', '/assets/templates/school-forms/sf3.xlsx', 'School Form 3 (SF3)', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'schoolId', default_sheet_name, 'C5', 'schools.deped_school_id'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'K5', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'schoolName', default_sheet_name, 'C7', 'schools.name'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'K7', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'section', default_sheet_name, 'N7', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'maleNumber', default_sheet_name, 'A12', 'generated.male_roster_number'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'maleName', default_sheet_name, 'B12', 'section_students, users, student_profiles.sex=male'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'femaleNumber', default_sheet_name, 'A37', 'generated.female_roster_number'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'femaleName', default_sheet_name, 'B37', 'section_students, users, student_profiles.sex=female'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0'
UNION ALL SELECT id, 'pageNumber', default_sheet_name, 'T68', 'generated.page_number'
FROM school_form_templates WHERE form_code = 'SF3' AND version = '1.0';
