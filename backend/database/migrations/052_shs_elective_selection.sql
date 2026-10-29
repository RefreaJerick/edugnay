-- Apply manually after 051. The selection release flag remains off by default.
CREATE TABLE shs_selection_windows (
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  opens_at DATETIME NULL,
  closes_at DATETIME NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, academic_year_id),
  CONSTRAINT fk_shs_window_year FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_window_user FOREIGN KEY (school_id, updated_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_shs_window_dates CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at)
) ENGINE=InnoDB;

CREATE TABLE shs_selection_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  grade_level_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  pathway_code VARCHAR(40) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  decision_reason VARCHAR(500) NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_request_student_grade (school_id, academic_year_id, grade_level_id, student_user_id),
  UNIQUE KEY uq_shs_request_school_id (school_id, id),
  CONSTRAINT fk_shs_request_year FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_request_grade FOREIGN KEY (school_id, grade_level_id) REFERENCES school_grade_levels(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_request_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_request_reviewer FOREIGN KEY (school_id, reviewed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE shs_selection_request_classes (
  school_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  elective_class_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (request_id, elective_class_id),
  CONSTRAINT fk_shs_request_class_request FOREIGN KEY (school_id, request_id) REFERENCES shs_selection_requests(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_request_class_class FOREIGN KEY (school_id, elective_class_id) REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE shs_selection_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(30) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_shs_history_request FOREIGN KEY (school_id, request_id) REFERENCES shs_selection_requests(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_history_actor FOREIGN KEY (school_id, actor_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE shs_verified_prior_electives (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  catalog_version VARCHAR(40) NOT NULL,
  catalog_code VARCHAR(40) NOT NULL,
  instructional_hours SMALLINT UNSIGNED NOT NULL,
  verified_by_user_id BIGINT UNSIGNED NOT NULL,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_prior_elective (school_id, student_user_id, catalog_code),
  CONSTRAINT fk_shs_prior_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_prior_verifier FOREIGN KEY (school_id, verified_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
