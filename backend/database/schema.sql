-- =========================================================
-- Academix Database Schema
-- MySQL 8.0+ | Run this file before demo-data.sql
-- =========================================================

CREATE DATABASE IF NOT EXISTS academix
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE academix;

-- =========================================================
-- 1. Schools and school-level configuration
-- =========================================================

CREATE TABLE IF NOT EXISTS schools (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_code VARCHAR(50) NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(120) NULL,
  school_type VARCHAR(50) NOT NULL DEFAULT 'k12',
  deped_school_id VARCHAR(50) NULL UNIQUE,
  region_name VARCHAR(120) NULL,
  division_name VARCHAR(150) NULL,
  district_name VARCHAR(150) NULL,
  address_line VARCHAR(255) NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(255) NULL,
  website VARCHAR(255) NULL,
  logo_path VARCHAR(500) NULL,
  registration_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_portal_features (
  school_id BIGINT UNSIGNED PRIMARY KEY,
  grades_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  narrative_reports_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  journals_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  attendance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sf_templates_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_portal_features_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_attendance_settings (
  school_id BIGINT UNSIGNED PRIMARY KEY,
  max_unexcused_absences TINYINT UNSIGNED NOT NULL DEFAULT 5,
  consecutive_absences_alert TINYINT UNSIGNED NOT NULL DEFAULT 3,
  late_count_as_absence TINYINT UNSIGNED NOT NULL DEFAULT 3,
  count_excused_absences BOOLEAN NOT NULL DEFAULT FALSE,
  allow_edit_past_attendance BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_attendance_settings_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_status_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  display_key VARCHAR(10) NOT NULL,
  display_tone VARCHAR(30) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_status_codes_school_code (school_id, code),
  CONSTRAINT fk_attendance_status_codes_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_years (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(30) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'upcoming',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_years_school_label (school_id, label),
  CONSTRAINT fk_academic_years_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_levels (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  level_code VARCHAR(30) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  grading_period_type VARCHAR(30) NOT NULL DEFAULT 'quarterly',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_levels_school_code (school_id, level_code),
  CONSTRAINT fk_school_levels_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_grade_levels (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_level_id BIGINT UNSIGNED NOT NULL,
  grade_code VARCHAR(30) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_grade_levels_level_grade (school_level_id, grade_code),
  CONSTRAINT fk_school_grade_levels_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_shs_tracks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_level_id BIGINT UNSIGNED NOT NULL,
  track_code VARCHAR(30) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_shs_tracks_level_track (school_level_id, track_code),
  CONSTRAINT fk_school_shs_tracks_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================
-- 2. Accounts, authentication, and role profiles
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NULL,
  role VARCHAR(30) NOT NULL,
  school_email VARCHAR(255) NOT NULL UNIQUE,
  personal_email VARCHAR(255) NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  account_status VARCHAR(30) NOT NULL DEFAULT 'active',
  honorific VARCHAR(30) NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(220) NOT NULL,
  initials VARCHAR(10) NOT NULL,
  setup_completed_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_school_role_status (school_id, role, account_status),
  CONSTRAINT fk_users_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  session_token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_reset_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_admin_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  employee_number VARCHAR(60) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_admin_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  employee_number VARCHAR(60) NULL,
  contact_number VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_teacher_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  lrn VARCHAR(12) NOT NULL UNIQUE,
  middle_name VARCHAR(100) NULL,
  has_no_middle_name BOOLEAN NOT NULL DEFAULT FALSE,
  sex VARCHAR(20) NULL,
  birth_date DATE NULL,
  birth_place_province VARCHAR(120) NULL,
  mother_tongue VARCHAR(120) NULL,
  indigenous_group VARCHAR(120) NULL,
  religion VARCHAR(120) NULL,
  house_street VARCHAR(255) NULL,
  barangay VARCHAR(120) NULL,
  city_municipality VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  contact_number VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parent_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  middle_name VARCHAR(100) NULL,
  maiden_last_name VARCHAR(100) NULL,
  has_no_middle_name BOOLEAN NOT NULL DEFAULT FALSE,
  has_no_maiden_name BOOLEAN NOT NULL DEFAULT FALSE,
  contact_number VARCHAR(30) NULL,
  house_street VARCHAR(255) NULL,
  barangay VARCHAR(120) NULL,
  city_municipality VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_parent_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_parent_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_user_id BIGINT UNSIGNED NOT NULL,
  parent_user_id BIGINT UNSIGNED NOT NULL,
  relationship VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_parent_links (student_user_id, parent_user_id, relationship),
  CONSTRAINT fk_student_parent_links_student
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_student_parent_links_parent
    FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =========================================================
-- 3. Terms, subjects, sections, and enrollments
-- =========================================================

CREATE TABLE IF NOT EXISTS academic_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  sequence_number TINYINT UNSIGNED NOT NULL,
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'upcoming',
  activated_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_terms_year_level_sequence (academic_year_id, school_level_id, sequence_number),
  CONSTRAINT fk_academic_terms_year
    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_academic_terms_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_term_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  previous_end_date DATE NULL,
  new_end_date DATE NULL,
  reason TEXT NULL,
  performed_by_user_id BIGINT UNSIGNED NOT NULL,
  performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_academic_term_actions_term
    FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT,
  CONSTRAINT fk_academic_term_actions_user
    FOREIGN KEY (performed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  subject_code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  school_level_id BIGINT UNSIGNED NULL,
  grade_level_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subjects_school_code (school_id, subject_code),
  CONSTRAINT fk_subjects_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_subjects_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE SET NULL,
  CONSTRAINT fk_subjects_grade_level
    FOREIGN KEY (grade_level_id) REFERENCES school_grade_levels(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_settings (
  school_id BIGINT UNSIGNED PRIMARY KEY,
  notification_email VARCHAR(255) NULL,
  current_school_year_label VARCHAR(30) NULL,
  journal_subject_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_settings_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_school_settings_journal_subject
    FOREIGN KEY (journal_subject_id) REFERENCES subjects(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  grade_level_id BIGINT UNSIGNED NOT NULL,
  strand_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  adviser_user_id BIGINT UNSIGNED NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sections_year_grade_name (academic_year_id, grade_level_id, name),
  CONSTRAINT fk_sections_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_year
    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_grade_level
    FOREIGN KEY (grade_level_id) REFERENCES school_grade_levels(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sections_strand
    FOREIGN KEY (strand_id) REFERENCES school_shs_tracks(id) ON DELETE SET NULL,
  CONSTRAINT fk_sections_adviser
    FOREIGN KEY (adviser_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS section_students (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_section_students_active (section_id, student_user_id),
  KEY idx_section_students_student (student_user_id),
  CONSTRAINT fk_section_students_section
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_section_students_student
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS section_teachers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_section_teachers_assignment (section_id, teacher_user_id, subject_id),
  KEY idx_section_teachers_teacher (teacher_user_id),
  CONSTRAINT fk_section_teachers_section
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_section_teachers_teacher
    FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_section_teachers_subject
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- =========================================================
-- 4. Assignments, scores, attendance, and QR credentials
-- =========================================================

CREATE TABLE IF NOT EXISTS grading_categories (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  school_level_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_grading_categories_school_level_code (school_id, school_level_id, code),
  CONSTRAINT fk_grading_categories_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_grading_categories_level
    FOREIGN KEY (school_level_id) REFERENCES school_levels(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NULL,
  grading_category_id BIGINT UNSIGNED NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  due_at DATETIME NULL,
  max_score DECIMAL(8,2) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'published',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assignments_section_subject (section_id, subject_id),
  CONSTRAINT fk_assignments_school
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignments_section
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignments_subject
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignments_term
    FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_assignments_category
    FOREIGN KEY (grading_category_id) REFERENCES grading_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_assignments_teacher
    FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(500) NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  submission_status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  submitted_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assignment_submissions_assignment_student (assignment_id, student_user_id),
  CONSTRAINT fk_assignment_submissions_assignment
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_assignment_submissions_student
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grading_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NOT NULL,
  grading_category_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  max_score DECIMAL(8,2) NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_grading_items_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_grading_items_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_grading_items_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT,
  CONSTRAINT fk_grading_items_category FOREIGN KEY (grading_category_id) REFERENCES grading_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_grading_items_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_scores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grading_item_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(8,2) NULL,
  remarks VARCHAR(500) NULL,
  recorded_by_user_id BIGINT UNSIGNED NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_scores_item_student (grading_item_id, student_user_id),
  CONSTRAINT fk_student_scores_item FOREIGN KEY (grading_item_id) REFERENCES grading_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_scores_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_scores_user FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  subject_scope_id BIGINT UNSIGNED AS (COALESCE(subject_id, 0)) STORED,
  attendance_date DATE NOT NULL,
  method VARCHAR(30) NOT NULL DEFAULT 'manual',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_by_user_id BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_sessions_scope (section_id, subject_scope_id, attendance_date),
  CONSTRAINT fk_attendance_sessions_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_sessions_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_sessions_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_sessions_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_sessions_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attendance_session_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  attendance_status VARCHAR(30) NOT NULL,
  remarks VARCHAR(500) NULL,
  marked_by_user_id BIGINT UNSIGNED NOT NULL,
  marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_records_session_student (attendance_session_id, student_user_id),
  CONSTRAINT fk_attendance_records_session FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_records_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_records_marker FOREIGN KEY (marked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_qr_credentials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_user_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  credential_status VARCHAR(30) NOT NULL DEFAULT 'active',
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_qr_credentials_student (student_user_id),
  CONSTRAINT fk_student_qr_credentials_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS qr_scan_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attendance_session_id BIGINT UNSIGNED NOT NULL,
  student_qr_credential_id BIGINT UNSIGNED NULL,
  scanned_student_user_id BIGINT UNSIGNED NULL,
  scanned_by_user_id BIGINT UNSIGNED NOT NULL,
  scan_result VARCHAR(30) NOT NULL,
  scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_scan_events_session FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_qr_scan_events_credential FOREIGN KEY (student_qr_credential_id) REFERENCES student_qr_credentials(id) ON DELETE SET NULL,
  CONSTRAINT fk_qr_scan_events_student FOREIGN KEY (scanned_student_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_qr_scan_events_user FOREIGN KEY (scanned_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- =========================================================
-- 5. Communication, journals, reports, and interventions
-- =========================================================

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  priority VARCHAR(30) NOT NULL DEFAULT 'normal',
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  author_user_id BIGINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcements_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_announcements_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcement_audiences (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  announcement_id BIGINT UNSIGNED NOT NULL,
  audience_type VARCHAR(30) NOT NULL,
  section_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_announcement_audiences (announcement_id, audience_type, section_id),
  CONSTRAINT fk_announcement_audiences_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_audiences_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcement_reads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  announcement_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_announcement_reads (announcement_id, user_id),
  CONSTRAINT fk_announcement_reads_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_announcement_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NULL,
  target_path VARCHAR(500) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user_read (user_id, read_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  due_date DATE NULL,
  task_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS journal_subjects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_journal_subjects_school_subject (school_id, subject_id),
  CONSTRAINT fk_journal_subjects_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_subjects_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_journal_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_subject_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  prompt_text TEXT NOT NULL,
  entry_text TEXT NOT NULL,
  entry_status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_journal_entries_subject FOREIGN KEY (journal_subject_id) REFERENCES journal_subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_journal_entries_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_student_journal_entries_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS journal_feedback (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  feedback_text TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_journal_feedback_entry FOREIGN KEY (journal_entry_id) REFERENCES student_journal_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_journal_feedback_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS narrative_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  teacher_user_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NULL,
  report_period_key VARCHAR(50) NOT NULL,
  report_period_label VARCHAR(120) NOT NULL,
  teacher_note TEXT NULL,
  generated_summary TEXT NOT NULL,
  teacher_edited_summary TEXT NULL,
  report_status VARCHAR(30) NOT NULL DEFAULT 'draft',
  is_at_risk BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_narrative_reports_student_period (student_user_id, report_period_key),
  CONSTRAINT fk_narrative_reports_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_reports_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_reports_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_reports_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_reports_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_recommendations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  narrative_report_id BIGINT UNSIGNED NOT NULL,
  recommendation_text TEXT NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_report_recommendations_order (narrative_report_id, display_order),
  CONSTRAINT fk_report_recommendations_report FOREIGN KEY (narrative_report_id) REFERENCES narrative_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_data_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  narrative_report_id BIGINT UNSIGNED NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_record_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_data_sources_report FOREIGN KEY (narrative_report_id) REFERENCES narrative_reports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_reopen_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  narrative_report_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  reason TEXT NOT NULL,
  request_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  admin_note TEXT NULL,
  expires_at DATETIME NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_reopen_requests_report FOREIGN KEY (narrative_report_id) REFERENCES narrative_reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_reopen_requests_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_reopen_requests_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS intervention_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  student_user_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  academic_term_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  concern_summary TEXT NOT NULL,
  goal_text TEXT NOT NULL,
  plan_status VARCHAR(30) NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL,
  target_date DATE NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_intervention_plans_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_intervention_plans_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_intervention_plans_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_intervention_plans_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_intervention_plans_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS intervention_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  intervention_plan_id BIGINT UNSIGNED NOT NULL,
  action_text TEXT NOT NULL,
  assigned_to_role VARCHAR(30) NOT NULL,
  due_date DATE NULL,
  action_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_intervention_actions_plan FOREIGN KEY (intervention_plan_id) REFERENCES intervention_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS intervention_progress_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  intervention_plan_id BIGINT UNSIGNED NOT NULL,
  recorded_by_user_id BIGINT UNSIGNED NOT NULL,
  progress_status VARCHAR(30) NOT NULL,
  note TEXT NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_intervention_progress_plan FOREIGN KEY (intervention_plan_id) REFERENCES intervention_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_progress_user FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- =========================================================
-- 6. School forms, exports, holidays, and audit history
-- =========================================================

CREATE TABLE IF NOT EXISTS school_form_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_code VARCHAR(30) NOT NULL,
  form_name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  source_type VARCHAR(30) NOT NULL DEFAULT 'official',
  template_status VARCHAR(30) NOT NULL DEFAULT 'active',
  mapping_status VARCHAR(30) NOT NULL DEFAULT 'ready',
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  default_sheet_name VARCHAR(255) NOT NULL,
  requires_academic_term BOOLEAN NOT NULL DEFAULT FALSE,
  published_by_user_id BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_form_templates_code_version (form_code, version),
  CONSTRAINT fk_school_form_templates_user FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_form_template_mappings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_form_template_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  worksheet_name VARCHAR(255) NOT NULL,
  cell_reference VARCHAR(30) NOT NULL,
  data_source VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_form_mappings_cell (school_form_template_id, worksheet_name, cell_reference),
  CONSTRAINT fk_school_form_mappings_template FOREIGN KEY (school_form_template_id) REFERENCES school_form_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_form_exports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_form_template_id BIGINT UNSIGNED NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NULL,
  academic_term_id BIGINT UNSIGNED NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  export_status VARCHAR(30) NOT NULL DEFAULT 'generated',
  file_path VARCHAR(500) NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_form_exports_template FOREIGN KEY (school_form_template_id) REFERENCES school_form_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_form_exports_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_school_form_exports_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL,
  CONSTRAINT fk_school_form_exports_term FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE SET NULL,
  CONSTRAINT fk_school_form_exports_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_form_export_issues (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_form_export_id BIGINT UNSIGNED NOT NULL,
  severity VARCHAR(30) NOT NULL,
  field_key VARCHAR(100) NULL,
  cell_reference VARCHAR(30) NULL,
  issue_message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_school_form_export_issues_export FOREIGN KEY (school_form_export_id) REFERENCES school_form_exports(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS holidays (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  holiday_date DATE NOT NULL,
  title VARCHAR(255) NOT NULL,
  detail TEXT NULL,
  holiday_type VARCHAR(30) NOT NULL DEFAULT 'holiday',
  applies_to VARCHAR(30) NOT NULL DEFAULT 'all',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_holidays_school_date_title (school_id, holiday_date, title),
  CONSTRAINT fk_holidays_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_logs_school_created (school_id, created_at),
  CONSTRAINT fk_audit_logs_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Run demo-data.sql after this schema to load presentation records.
