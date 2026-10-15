-- Register the adviser-generated Grades 4-10 learner performance report draft.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF9', 'Learner''s Performance Report (Grades 4-10)', '1.0', 'official', 'active', 'ready',
   'SF9.xlsx', '/assets/templates/school-forms/sf9.xlsx', 'SF9 - GRADE 4-10', FALSE);

INSERT IGNORE INTO school_form_template_mappings
  (school_form_template_id, field_key, worksheet_name, cell_reference, data_source)
SELECT id, 'region', default_sheet_name, 'B7', 'schools.region_name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'division', default_sheet_name, 'B8', 'schools.division_name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'district', default_sheet_name, 'B9', 'schools.district_name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'address', default_sheet_name, 'B10', 'schools.address_line'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'schoolName', default_sheet_name, 'B12', 'schools.name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'B15', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'learnerName', default_sheet_name, 'C17', 'users, student_profiles'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'age', default_sheet_name, 'I17', 'student_profiles.birth_date, June 1 of school-year start'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'sex', default_sheet_name, 'K17', 'student_profiles.sex'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'lrn', default_sheet_name, 'C18', 'student_profiles.lrn'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'I18', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'section', default_sheet_name, 'K18', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'strand', default_sheet_name, 'C19', 'school_shs_tracks.display_name, when available'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'adviser', default_sheet_name, 'H27', 'users.display_name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'subjectName', default_sheet_name, 'B32', 'section_teachers and subjects, ordered by subject name'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'firstPeriodGrade', default_sheet_name, 'F32', 'published_final_grades, selected learner and assigned subject'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'finalGrade', default_sheet_name, 'J32', 'mean of all configured published period grades for the subject'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'generalAverage', default_sheet_name, 'J42', 'mean of completed subject final grades when all subjects and periods are published'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0';
