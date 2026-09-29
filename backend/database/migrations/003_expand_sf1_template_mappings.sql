-- Apply once to existing databases so SF1 metadata matches the verified official workbook.
UPDATE school_form_template_mappings
INNER JOIN school_form_templates ON school_form_templates.id = school_form_template_mappings.school_form_template_id
SET school_form_template_mappings.cell_reference = 'C10',
    school_form_template_mappings.data_source = 'users.last_name, users.first_name, student_profiles.middle_name'
WHERE school_form_templates.form_code = 'SF1'
  AND school_form_template_mappings.field_key = 'studentName';

INSERT IGNORE INTO school_form_template_mappings (
  school_form_template_id, field_key, worksheet_name, cell_reference, data_source
)
SELECT id, 'region', default_sheet_name, 'H4', 'schools.region_name'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'division', default_sheet_name, 'N4', 'schools.division_name'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'district', default_sheet_name, 'U4', 'schools.district_name'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'schoolYear', default_sheet_name, 'P6', 'academic_years.label'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'gradeLevel', default_sheet_name, 'U6', 'school_grade_levels.display_name'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'section', default_sheet_name, 'X6', 'sections.name'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'rowNumber', default_sheet_name, 'A10', 'generated.learner_row_number'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'sex', default_sheet_name, 'G10', 'student_profiles.sex'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'birthDate', default_sheet_name, 'H10', 'student_profiles.birth_date'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'age', default_sheet_name, 'I10', 'generated.age_as_of_first_friday_of_june'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'birthPlaceProvince', default_sheet_name, 'J10', 'student_profiles.birth_place_province'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'motherTongue', default_sheet_name, 'L10', 'student_profiles.mother_tongue'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'indigenousGroup', default_sheet_name, 'M10', 'student_profiles.indigenous_group'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'religion', default_sheet_name, 'N10', 'student_profiles.religion'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'address', default_sheet_name, 'O10', 'student_profiles.address_fields'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'fatherName', default_sheet_name, 'T10', 'student_parent_links.father'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'motherMaidenName', default_sheet_name, 'V10', 'student_parent_links.mother'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'guardian', default_sheet_name, 'X10', 'student_parent_links.guardian'
FROM school_form_templates WHERE form_code = 'SF1'
UNION ALL SELECT id, 'parentContactNumber', default_sheet_name, 'Z10', 'parent_profiles.contact_number'
FROM school_form_templates WHERE form_code = 'SF1';
