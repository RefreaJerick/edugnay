USE academix;

CREATE TABLE school_year_final_grade_rules (
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  grading_mode ENUM('deped_policy', 'school_specific') NOT NULL DEFAULT 'deped_policy',
  passing_grade_threshold DECIMAL(5,2) NOT NULL DEFAULT 75.00,
  grade_rounding ENUM('round', 'roundup', 'truncate') NOT NULL DEFAULT 'round',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, academic_year_id, school_level_id),
  CONSTRAINT fk_school_year_final_grade_rules_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_year_final_grade_rules_year
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_year_final_grade_rules_level
    FOREIGN KEY (school_id, school_level_id) REFERENCES school_levels(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
