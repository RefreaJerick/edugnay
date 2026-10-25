USE academix;

ALTER TABLE section_teachers ADD UNIQUE KEY uq_section_teachers_school_id (school_id, id);

CREATE TABLE IF NOT EXISTS scheduled_classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_scheduled_class_assignment (assignment_id),
  UNIQUE KEY uq_scheduled_class_school_id (school_id, id),
  CONSTRAINT fk_scheduled_class_tenant_assignment FOREIGN KEY (school_id, assignment_id) REFERENCES section_teachers(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS timetable_meetings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  scheduled_class_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  room VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_timetable_class (scheduled_class_id),
  KEY idx_timetable_conflicts (school_id, weekday, start_time, end_time),
  CONSTRAINT fk_timetable_tenant_class FOREIGN KEY (school_id, scheduled_class_id) REFERENCES scheduled_classes(school_id, id) ON DELETE CASCADE
) ENGINE=InnoDB;
