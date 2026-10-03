-- Keep prompt-less legacy entries unassigned unless their original teacher can be proven.
ALTER TABLE student_journal_entries
  ADD COLUMN owner_teacher_user_id BIGINT UNSIGNED NULL AFTER student_user_id;

UPDATE student_journal_entries AS entries
INNER JOIN journal_prompts AS prompts ON prompts.school_id = entries.school_id
  AND prompts.id = entries.journal_prompt_id
SET entries.owner_teacher_user_id = prompts.created_by_user_id
WHERE entries.owner_teacher_user_id IS NULL;

ALTER TABLE student_journal_entries
  ADD KEY idx_journal_entries_owner (school_id, owner_teacher_user_id),
  ADD CONSTRAINT fk_journal_entries_tenant_owner FOREIGN KEY (school_id, owner_teacher_user_id)
    REFERENCES users(school_id, id) ON DELETE RESTRICT;
