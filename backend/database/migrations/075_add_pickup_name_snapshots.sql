ALTER TABLE pickup_records
  ADD COLUMN student_name_at_pickup VARCHAR(220) NULL AFTER student_user_id,
  ADD COLUMN fetcher_name_at_pickup VARCHAR(220) NULL AFTER fetcher_id,
  ADD COLUMN fetcher_relationship_at_pickup VARCHAR(60) NULL AFTER fetcher_name_at_pickup,
  ADD COLUMN guard_name_at_pickup VARCHAR(220) NULL AFTER guard_user_id,
  ADD KEY idx_pickup_records_school_history (school_id, id),
  ADD KEY idx_pickup_records_school_date (school_id, school_date, id);

UPDATE pickup_records AS records
INNER JOIN users AS students ON students.id = records.student_user_id
  AND students.school_id = records.school_id
INNER JOIN fetchers ON fetchers.id = records.fetcher_id
  AND fetchers.school_id = records.school_id
INNER JOIN users AS fetcher_parents ON fetcher_parents.id = fetchers.parent_user_id
  AND fetcher_parents.school_id = fetchers.school_id
INNER JOIN users AS guards ON guards.id = records.guard_user_id
  AND guards.school_id = records.school_id
SET records.student_name_at_pickup = students.display_name,
  records.fetcher_name_at_pickup = CASE WHEN fetchers.is_parent_self
    THEN fetcher_parents.display_name ELSE fetchers.full_name END,
  records.fetcher_relationship_at_pickup = CASE WHEN fetchers.is_parent_self
    THEN 'Parent' ELSE fetchers.relationship END,
  records.guard_name_at_pickup = guards.display_name;

ALTER TABLE pickup_records
  MODIFY COLUMN student_name_at_pickup VARCHAR(220) NOT NULL,
  MODIFY COLUMN fetcher_name_at_pickup VARCHAR(220) NOT NULL,
  MODIFY COLUMN fetcher_relationship_at_pickup VARCHAR(60) NOT NULL,
  MODIFY COLUMN guard_name_at_pickup VARCHAR(220) NOT NULL;
