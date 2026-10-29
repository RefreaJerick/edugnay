-- Apply manually after migration 052. Elective teaching stays behind
-- SHS_SELECTION_ENABLED and does not create graded work in this phase.
-- If a previous run stopped partway through, do not rerun successful ALTERs;
-- check the schema and apply only the statements that are still missing.

ALTER TABLE assignments
  MODIFY section_id BIGINT UNSIGNED NULL,
  MODIFY subject_id BIGINT UNSIGNED NULL,
  MODIFY academic_term_id BIGINT UNSIGNED NULL,
  ADD COLUMN shs_elective_class_id BIGINT UNSIGNED NULL AFTER subject_id,
  ADD KEY idx_assignments_elective_class (school_id, shs_elective_class_id),
  ADD CONSTRAINT fk_assignment_elective_class FOREIGN KEY (school_id, shs_elective_class_id)
    REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_assignment_scope CHECK (
    (shs_elective_class_id IS NOT NULL AND section_id IS NULL AND subject_id IS NULL)
    OR (shs_elective_class_id IS NULL AND section_id IS NOT NULL AND subject_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_elective_assignment_ungraded CHECK (
    shs_elective_class_id IS NULL OR (academic_term_id IS NULL AND grading_category_id IS NULL
      AND subject_grading_component_id IS NULL AND subject_grading_exam_part_id IS NULL
      AND grading_item_id IS NULL AND max_score IS NULL)
  );

ALTER TABLE learning_materials
  MODIFY section_id BIGINT UNSIGNED NULL,
  MODIFY subject_id BIGINT UNSIGNED NULL,
  ADD COLUMN shs_elective_class_id BIGINT UNSIGNED NULL AFTER subject_id,
  ADD KEY idx_materials_elective_class (school_id, shs_elective_class_id),
  ADD CONSTRAINT fk_material_elective_class FOREIGN KEY (school_id, shs_elective_class_id)
    REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_material_scope CHECK (
    (shs_elective_class_id IS NOT NULL AND section_id IS NULL AND subject_id IS NULL)
    OR (shs_elective_class_id IS NULL AND section_id IS NOT NULL AND subject_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_elective_material_no_term CHECK (
    shs_elective_class_id IS NULL OR academic_term_id IS NULL
  );

ALTER TABLE attendance_sessions
  MODIFY section_id BIGINT UNSIGNED NULL,
  MODIFY subject_id BIGINT UNSIGNED NULL,
  ADD COLUMN shs_elective_class_id BIGINT UNSIGNED NULL AFTER subject_id,
  ADD UNIQUE KEY uq_attendance_elective_class_date (school_id, shs_elective_class_id, attendance_date),
  ADD CONSTRAINT fk_attendance_elective_class FOREIGN KEY (school_id, shs_elective_class_id)
    REFERENCES shs_elective_classes(school_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_attendance_session_scope CHECK (
    (shs_elective_class_id IS NOT NULL AND section_id IS NULL AND subject_id IS NULL)
    -- Existing section-wide sessions may have no subject; keep them valid.
    OR (shs_elective_class_id IS NULL AND section_id IS NOT NULL)
  );
