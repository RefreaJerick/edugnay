-- Built-in school-form templates and mappings for a fresh Academix database.
-- Import after schema.sql. Safe to import after demo-data.sql as well.
-- Historical migrations are not needed for a new installation.
USE academix;

INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF1', 'School Register', '1.0', 'official', 'active', 'ready',
   'SF1.xlsx', '/assets/templates/school-forms/sf1.xlsx', 'School Form 1 (SF1)', FALSE);

SET @sf1_template_id = (SELECT id FROM school_form_templates WHERE form_code = 'SF1' AND version = '1.0');
INSERT IGNORE INTO school_form_template_mappings (
  school_form_template_id, field_key, worksheet_name, cell_reference, data_source
) VALUES
  (@sf1_template_id, 'schoolId', 'School Form 1 (SF1)', 'F4', 'schools.deped_school_id'),
  (@sf1_template_id, 'region', 'School Form 1 (SF1)', 'H4', 'schools.region_name'),
  (@sf1_template_id, 'division', 'School Form 1 (SF1)', 'N4', 'schools.division_name'),
  (@sf1_template_id, 'district', 'School Form 1 (SF1)', 'U4', 'schools.district_name'),
  (@sf1_template_id, 'schoolName', 'School Form 1 (SF1)', 'F6', 'schools.name'),
  (@sf1_template_id, 'schoolYear', 'School Form 1 (SF1)', 'P6', 'academic_years.label'),
  (@sf1_template_id, 'gradeLevel', 'School Form 1 (SF1)', 'U6', 'school_grade_levels.display_name'),
  (@sf1_template_id, 'section', 'School Form 1 (SF1)', 'X6', 'sections.name'),
  (@sf1_template_id, 'rowNumber', 'School Form 1 (SF1)', 'A10', 'generated.learner_row_number'),
  (@sf1_template_id, 'lrn', 'School Form 1 (SF1)', 'B10', 'student_profiles.lrn'),
  (@sf1_template_id, 'name', 'School Form 1 (SF1)', 'C10', 'users.last_name, users.first_name, student_profiles.middle_name'),
  (@sf1_template_id, 'sex', 'School Form 1 (SF1)', 'G10', 'student_profiles.sex'),
  (@sf1_template_id, 'birthDate', 'School Form 1 (SF1)', 'H10', 'student_profiles.birth_date'),
  (@sf1_template_id, 'age', 'School Form 1 (SF1)', 'I10', 'generated.age_as_of_first_friday_of_june'),
  (@sf1_template_id, 'birthPlaceProvince', 'School Form 1 (SF1)', 'J10', 'student_profiles.birth_place, birth_place_region, birth_country'),
  (@sf1_template_id, 'motherTongue', 'School Form 1 (SF1)', 'L10', 'student_profiles.mother_tongue'),
  (@sf1_template_id, 'indigenousGroup', 'School Form 1 (SF1)', 'M10', 'student_profiles.indigenous_group'),
  (@sf1_template_id, 'religion', 'School Form 1 (SF1)', 'N10', 'student_profiles.religion'),
  (@sf1_template_id, 'houseStreet', 'School Form 1 (SF1)', 'O10', 'student_profiles.house_street'),
  (@sf1_template_id, 'barangay', 'School Form 1 (SF1)', 'P10', 'student_profiles.barangay'),
  (@sf1_template_id, 'cityMunicipality', 'School Form 1 (SF1)', 'Q10', 'student_profiles.city_municipality'),
  (@sf1_template_id, 'province', 'School Form 1 (SF1)', 'R10', 'student_profiles.province'),
  (@sf1_template_id, 'fatherName', 'School Form 1 (SF1)', 'T10', 'student_parent_links.father'),
  (@sf1_template_id, 'motherMaidenName', 'School Form 1 (SF1)', 'V10', 'student_parent_links.mother'),
  (@sf1_template_id, 'guardianName', 'School Form 1 (SF1)', 'X10', 'student_parent_links.guardian'),
  (@sf1_template_id, 'guardianRelationship', 'School Form 1 (SF1)', 'Y10', 'student_parent_links.relationship'),
  (@sf1_template_id, 'contactNumber', 'School Form 1 (SF1)', 'Z10', 'parent_profiles.contact_number'),
  (@sf1_template_id, 'remarks', 'School Form 1 (SF1)', 'AA10', 'teacher.edit');

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
UNION ALL SELECT id, 'finalGrade', default_sheet_name, 'I32', 'mean of published grades for exactly three terms; calculated per school-year rules'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0'
UNION ALL SELECT id, 'generalAverage', default_sheet_name, 'I42', 'mean of completed subject final grades for three terms; adviser-entered for SY 2026-2027'
FROM school_form_templates WHERE form_code = 'SF9' AND version = '1.0';
