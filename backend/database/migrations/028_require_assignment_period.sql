-- Assign existing assignments to their correct periods before running this migration.
-- The ALTER fails if any academic_term_id is NULL, so history is never guessed from due dates.
ALTER TABLE assignments
  DROP FOREIGN KEY fk_assignments_tenant_term,
  DROP FOREIGN KEY fk_assignments_term,
  MODIFY COLUMN academic_term_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE assignments
  ADD CONSTRAINT fk_assignments_term
    FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_assignments_tenant_term
    FOREIGN KEY (school_id, academic_term_id) REFERENCES academic_terms(school_id, id) ON DELETE RESTRICT;
