ALTER TABLE student_profiles
  ADD COLUMN birth_place VARCHAR(120) NULL AFTER birth_place_province,
  ADD COLUMN birth_place_region VARCHAR(120) NULL AFTER birth_place,
  ADD COLUMN birth_country VARCHAR(120) NULL AFTER birth_place_region;

-- The old field may contain a province or a complete foreign birthplace.
-- Keep it intact and ask students to confirm their country during setup.
UPDATE student_profiles
SET birth_place = birth_place_province
WHERE birth_place_province IS NOT NULL AND TRIM(birth_place_province) <> '';

UPDATE school_form_template_mappings
INNER JOIN school_form_templates ON school_form_templates.id = school_form_template_mappings.school_form_template_id
SET school_form_template_mappings.data_source = 'student_profiles.birth_place, birth_place_region, birth_country'
WHERE school_form_templates.form_code = 'SF1'
  AND school_form_template_mappings.field_key = 'birthPlaceProvince';
