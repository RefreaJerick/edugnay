-- SF8 is an adviser-generated editable workbook draft. Health assessment values are not stored in AcadeMix.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF8', 'Learner''s Basic Health and Nutrition Report', '1.0', 'official', 'active', 'ready',
   'SF8.xlsx', '/assets/templates/school-forms/sf8.xlsx', 'School Form 8 (SF8)', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'schoolName', default_sheet_name, 'E5', 'schools.name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'district', default_sheet_name, 'I5', 'schools.district_name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'division', default_sheet_name, 'L5', 'schools.division_name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'region', default_sheet_name, 'O5', 'schools.region_name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'schoolId', default_sheet_name, 'C7', 'schools.deped_school_id'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'F7', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'section', default_sheet_name, 'H7', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'strand', default_sheet_name, 'L7', 'school_shs_tracks.display_name'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'O7', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'maleLrn', default_sheet_name, 'B12', 'student_profiles.lrn, male roster'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'maleName', default_sheet_name, 'C12', 'users, student_profiles.sex=male'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'maleBirthDate', default_sheet_name, 'G12', 'student_profiles.birth_date, male roster'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'femaleLrn', default_sheet_name, 'B65', 'student_profiles.lrn, female roster'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'femaleName', default_sheet_name, 'C65', 'users, student_profiles.sex=female'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0'
UNION ALL SELECT id, 'femaleBirthDate', default_sheet_name, 'G65', 'student_profiles.birth_date, female roster'
FROM school_form_templates WHERE form_code = 'SF8' AND version = '1.0';
