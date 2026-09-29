-- Apply to an existing database only when learning_materials.description still exists.
-- This discards the unused description values; fresh installs should use schema.sql.
ALTER TABLE learning_materials
  DROP COLUMN description;
