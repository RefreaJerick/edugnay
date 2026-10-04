-- Register the official SF2 draft. Section assignment is not school enrollment.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF2', 'Daily Attendance Report of Learners', '1.0', 'official', 'active', 'ready',
   'SF2.xlsx', '/assets/templates/school-forms/sf2.xlsx', 'School Form 2 (SF2)', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'schoolId', default_sheet_name, 'C6', 'schools.deped_school_id'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'K6', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'month', default_sheet_name, 'X6', 'teacher.selected_month'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'schoolName', default_sheet_name, 'C8', 'schools.name'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'X8', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'section', default_sheet_name, 'AC8', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'maleName', default_sheet_name, 'B13', 'section_students, users, student_profiles.sex'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'femaleName', default_sheet_name, 'B35', 'section_students, users, student_profiles.sex'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0'
UNION ALL SELECT id, 'pageNumber', default_sheet_name, 'A91', 'generated.page_number'
FROM school_form_templates WHERE form_code = 'SF2' AND version = '1.0';
