ALTER TABLE users
  DROP CONSTRAINT chk_users_role_school,
  ADD CONSTRAINT chk_users_role_school CHECK (
    (role = 'platform_admin' AND school_id IS NULL)
    OR (role IN ('school_admin', 'teacher', 'student', 'parent', 'school_guard') AND school_id IS NOT NULL)
  );

CREATE TABLE school_guard_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  employee_number VARCHAR(60) NOT NULL,
  contact_number VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_guard_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE fetchers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  parent_user_id BIGINT UNSIGNED NOT NULL,
  is_parent_self BOOLEAN NOT NULL DEFAULT FALSE,
  full_name VARCHAR(220) NOT NULL,
  relationship VARCHAR(60) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  photo_filename VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fetchers_school_id (school_id, id),
  KEY idx_fetchers_parent (school_id, parent_user_id),
  CONSTRAINT fk_fetchers_parent FOREIGN KEY (school_id, parent_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE fetcher_authorizations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  fetcher_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fetcher_authorization_child (fetcher_id, student_user_id),
  UNIQUE KEY uq_fetcher_authorizations_school_id (school_id, id),
  KEY idx_fetcher_authorizations_student (school_id, student_user_id, status),
  CONSTRAINT chk_fetcher_authorization_status CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  CONSTRAINT fk_fetcher_authorizations_fetcher FOREIGN KEY (school_id, fetcher_id) REFERENCES fetchers(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fetcher_authorizations_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fetcher_authorizations_reviewer FOREIGN KEY (school_id, reviewed_by_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE fetcher_credentials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  fetcher_id BIGINT UNSIGNED NOT NULL,
  qr_token_hash CHAR(64) NOT NULL UNIQUE,
  qr_token_ciphertext TEXT NOT NULL,
  manual_code_hash CHAR(64) NOT NULL UNIQUE,
  manual_code_ciphertext TEXT NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  UNIQUE KEY uq_fetcher_credentials_fetcher (fetcher_id),
  CONSTRAINT fk_fetcher_credentials_fetcher FOREIGN KEY (school_id, fetcher_id) REFERENCES fetchers(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE pickup_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  fetcher_id BIGINT UNSIGNED NOT NULL,
  guard_user_id BIGINT UNSIGNED NOT NULL,
  school_date DATE NOT NULL,
  picked_up_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pickup_records_school_day (school_id, student_user_id, school_date),
  KEY idx_pickup_records_recent (school_id, picked_up_at),
  CONSTRAINT fk_pickup_records_student FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pickup_records_fetcher FOREIGN KEY (school_id, fetcher_id) REFERENCES fetchers(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pickup_records_guard FOREIGN KEY (school_id, guard_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
