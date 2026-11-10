-- Register the supplied cumulative Junior High School SF10 workbook.
INSERT IGNORE INTO school_form_templates
  (form_code, form_name, version, source_type, template_status, mapping_status,
   file_name, file_path, default_sheet_name, requires_academic_term)
VALUES
  ('SF10', 'Learner Permanent Academic Record (Junior High School)', 'jhs-2025',
   'official', 'active', 'ready', 'SF10.xlsx',
   '/assets/templates/school-forms/sf10.xlsx', 'Front', FALSE);
