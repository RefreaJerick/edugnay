USE academix;

CREATE TABLE subject_grading_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  configuration_source ENUM('deped_default', 'custom', 'copied_custom') NOT NULL DEFAULT 'custom',
  copied_from_profile_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_grading_profiles_school_id (school_id, id),
  UNIQUE KEY uq_subject_grading_profiles_year_subject (school_id, academic_year_id, school_level_id, subject_id),
  CONSTRAINT fk_subject_grading_profiles_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subject_grading_profiles_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_subject_grading_profiles_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_subject_grading_profiles_subject
    FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_subject_grading_profiles_copy
    FOREIGN KEY (school_id, copied_from_profile_id) REFERENCES subject_grading_profiles(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE subject_grading_components (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  component_type ENUM('written', 'performance', 'examination', 'other') NOT NULL DEFAULT 'other',
  weight DECIMAL(5,2) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_grading_components_school_id (school_id, id),
  UNIQUE KEY uq_subject_grading_components_profile_code (profile_id, code),
  KEY idx_subject_grading_components_profile_sort (profile_id, sort_order, id),
  CONSTRAINT fk_subject_grading_components_profile
    FOREIGN KEY (school_id, profile_id) REFERENCES subject_grading_profiles(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE subject_grading_exam_parts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  component_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_grading_exam_parts_school_id (school_id, id),
  UNIQUE KEY uq_subject_grading_exam_parts_component_code (component_id, code),
  KEY idx_subject_grading_exam_parts_component_sort (component_id, sort_order, id),
  CONSTRAINT fk_subject_grading_exam_parts_component
    FOREIGN KEY (school_id, component_id) REFERENCES subject_grading_components(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE assignments
  ADD COLUMN subject_grading_component_id BIGINT UNSIGNED NULL AFTER grading_category_id,
  ADD COLUMN subject_grading_exam_part_id BIGINT UNSIGNED NULL AFTER subject_grading_component_id,
  ADD CONSTRAINT fk_assignments_subject_grading_component
    FOREIGN KEY (school_id, subject_grading_component_id) REFERENCES subject_grading_components(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_subject_grading_exam_part
    FOREIGN KEY (school_id, subject_grading_exam_part_id) REFERENCES subject_grading_exam_parts(school_id, id) ON DELETE RESTRICT;

ALTER TABLE grading_items
  MODIFY grading_category_id BIGINT UNSIGNED NULL,
  ADD COLUMN subject_grading_component_id BIGINT UNSIGNED NULL AFTER grading_category_id,
  ADD COLUMN subject_grading_exam_part_id BIGINT UNSIGNED NULL AFTER subject_grading_component_id,
  ADD CONSTRAINT fk_grading_items_subject_grading_component
    FOREIGN KEY (school_id, subject_grading_component_id) REFERENCES subject_grading_components(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_grading_items_subject_grading_exam_part
    FOREIGN KEY (school_id, subject_grading_exam_part_id) REFERENCES subject_grading_exam_parts(school_id, id) ON DELETE RESTRICT;
