-- Register the adviser-generated Grade 12 TechPro SF9 for school year 2026-2027.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF9', 'Learner''s Performance Report (Grade 12 TechPro)', 'g12-techpro-2026-2027',
   'official', 'active', 'ready', 'SF9-G12-TechPro.xlsx',
   '/assets/templates/school-forms/sf9-g12-techpro.xlsx', 'SF9 - GRADE 12 TECHPRO', FALSE);

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
  UNION ALL SELECT 'techproElective1', 'B33', 'approved Grade 12 TechPro elective classes'
  UNION ALL SELECT 'techproElective1Term1', 'F33', 'published Grade 12 TechPro elective grade for Term 1'
  UNION ALL SELECT 'techproElective1Term2', 'G33', 'published Grade 12 TechPro elective grade for Term 2'
  UNION ALL SELECT 'techproElective1Term3', 'H33', 'published Grade 12 TechPro elective grade for Term 3'
  UNION ALL SELECT 'techproElective1Final', 'I33', 'calculated final grade from published term grades'
  UNION ALL SELECT 'techproElective2', 'B34', 'approved Grade 12 TechPro elective classes'
  UNION ALL SELECT 'techproElective2Term1', 'F34', 'published Grade 12 TechPro elective grade for Term 1'
  UNION ALL SELECT 'techproElective2Term2', 'G34', 'published Grade 12 TechPro elective grade for Term 2'
  UNION ALL SELECT 'techproElective2Term3', 'H34', 'published Grade 12 TechPro elective grade for Term 3'
  UNION ALL SELECT 'techproElective2Final', 'I34', 'calculated final grade from published term grades'
  UNION ALL SELECT 'workImmersion', 'B35', 'approved Grade 12 TechPro Work Immersion class'
  UNION ALL SELECT 'workImmersionTerm1', 'F35', 'published Work Immersion grade for Term 1'
  UNION ALL SELECT 'workImmersionTerm2', 'G35', 'published Work Immersion grade for Term 2'
  UNION ALL SELECT 'workImmersionTerm3', 'H35', 'published Work Immersion grade for Term 3'
  UNION ALL SELECT 'workImmersionFinal', 'I35', 'calculated final grade from published term grades'
  UNION ALL SELECT 'generalAverage', 'I38', 'left blank for adviser review for SY 2026-2027'
) AS fields
WHERE template.form_code = 'SF9' AND template.version = 'g12-techpro-2026-2027';
