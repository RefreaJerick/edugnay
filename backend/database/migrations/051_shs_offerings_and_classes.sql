-- Run after migration 050 and the reviewed SHS-only development cleanup.
CREATE TABLE shs_offerings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  grade_level_id BIGINT UNSIGNED NOT NULL,
  catalog_version VARCHAR(40) NOT NULL,
  catalog_code VARCHAR(40) NOT NULL,
  track_code VARCHAR(30) NOT NULL,
  subject_type VARCHAR(30) NOT NULL,
  subject_name VARCHAR(120) NOT NULL,
  instructional_hours SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_offering_year_grade_code (school_id, academic_year_id, grade_level_id, catalog_code),
  UNIQUE KEY uq_shs_offering_school_id (school_id, id),
  CONSTRAINT fk_shs_offering_year FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_offering_grade FOREIGN KEY (school_id, grade_level_id) REFERENCES school_grade_levels(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE shs_elective_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  offering_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shs_elective_class_name (offering_id, class_name),
  UNIQUE KEY uq_shs_elective_class_school_id (school_id, id),
  CONSTRAINT fk_shs_elective_class_offering FOREIGN KEY (school_id, offering_id) REFERENCES shs_offerings(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_elective_class_teacher FOREIGN KEY (school_id, teacher_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE scheduled_classes
  MODIFY assignment_id BIGINT UNSIGNED NULL,
  ADD COLUMN shs_elective_class_id BIGINT UNSIGNED NULL AFTER assignment_id,
  ADD UNIQUE KEY uq_scheduled_class_elective (shs_elective_class_id),
  ADD CONSTRAINT fk_scheduled_class_elective FOREIGN KEY (school_id, shs_elective_class_id) REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_scheduled_class_single_owner CHECK ((assignment_id IS NULL) <> (shs_elective_class_id IS NULL));

-- Membership is dormant until Phase 3; it already allows conflict checks to
-- cover any future active enrolments without changing timetable ownership.
CREATE TABLE shs_elective_class_students (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  elective_class_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  withdrawn_at DATETIME NULL,
  active_marker TINYINT GENERATED ALWAYS AS (IF(withdrawn_at IS NULL, 1, NULL)) STORED,
  UNIQUE KEY uq_shs_elective_class_student (elective_class_id, student_user_id, active_marker),
  CONSTRAINT fk_shs_elective_student_class FOREIGN KEY (school_id, elective_class_id) REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shs_elective_student_user FOREIGN KEY (school_id, student_user_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
