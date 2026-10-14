-- SF5 is an adviser-generated, read-only year-end draft for Grades 1-10.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF5', 'Report on Promotion & Level of Proficiency', '1.0', 'official', 'active', 'ready',
   'SF5.xlsx', '/assets/templates/school-forms/sf5.xlsx', 'School Form 5 (SF5)', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'region', default_sheet_name, 'C3', 'schools.region_name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'division', default_sheet_name, 'E3', 'schools.division_name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'district', default_sheet_name, 'J3', 'schools.district_name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'schoolId', default_sheet_name, 'C5', 'schools.deped_school_id'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'G5', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'schoolName', default_sheet_name, 'C7', 'schools.name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'J7', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'section', default_sheet_name, 'L7', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'maleLrn', default_sheet_name, 'A13', 'student_profiles.lrn, male roster'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'maleName', default_sheet_name, 'B13', 'users, student_profiles.sex=male'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'maleGeneralAverage', default_sheet_name, 'F13', 'published_final_grades, all section subjects and terms'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'femaleLrn', default_sheet_name, 'A34', 'student_profiles.lrn, female roster'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'femaleName', default_sheet_name, 'B34', 'users, student_profiles.sex=female'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'femaleGeneralAverage', default_sheet_name, 'F34', 'published_final_grades, all section subjects and terms'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0'
UNION ALL SELECT id, 'pageNumber', default_sheet_name, 'M61', 'generated.page_number'
FROM school_form_templates WHERE form_code = 'SF5' AND version = '1.0';
