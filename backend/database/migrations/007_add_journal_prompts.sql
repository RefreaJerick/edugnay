-- Add weekly journal prompts and link each submission to its prompt.
-- Run once on an existing database after backing it up, using a MySQL admin account.
-- Keep DDL privileges off the Academix application account.

CREATE TABLE IF NOT EXISTS journal_prompts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  journal_subject_id BIGINT UNSIGNED NOT NULL,
  section_id BIGINT UNSIGNED NOT NULL,
  grading_item_id BIGINT UNSIGNED NULL,
  week_start_date DATE NOT NULL,
  prompt_text TEXT NOT NULL,
  opens_at DATETIME NOT NULL,
  due_at DATETIME NOT NULL,
  min_words SMALLINT UNSIGNED NOT NULL DEFAULT 50,
  allow_late BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_journal_prompts_section_week (journal_subject_id, section_id, week_start_date),
  UNIQUE KEY uq_journal_prompts_grading_item (grading_item_id),
  KEY idx_journal_prompts_section_status (section_id, prompt_status, week_start_date),
  CONSTRAINT fk_journal_prompts_subject FOREIGN KEY (journal_subject_id) REFERENCES journal_subjects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_prompts_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  CONSTRAINT fk_journal_prompts_grading_item FOREIGN KEY (grading_item_id) REFERENCES grading_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_journal_prompts_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE student_journal_entries
  ADD COLUMN journal_prompt_id BIGINT UNSIGNED NULL AFTER section_id,
  ADD UNIQUE KEY uq_journal_entry_prompt_student (journal_prompt_id, student_user_id),
  ADD CONSTRAINT fk_student_journal_entries_prompt
    FOREIGN KEY (journal_prompt_id) REFERENCES journal_prompts(id) ON DELETE RESTRICT;
