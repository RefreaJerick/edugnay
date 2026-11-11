# Academix database setup

`schema.sql` defines the final database structure through migration 066.
Migrations 067-069 add built-in school-form records, which are included in
`reference-data.sql`. Together, these files cover a fresh installation through
migration 069. `schema.sql` is for an empty database, not for upgrading an
existing one. It creates and selects the `academix` database, so check the
target server before importing.

The fresh schema uses `ON DELETE RESTRICT` for assignment grading categories
and learning-material terms. MariaDB 10.11 rejects their historical
`ON DELETE SET NULL` rules because `CHECK` constraints also use those columns.
The application does not remove grading categories that have recorded work;
term deletion will be blocked while materials still reference that term.

For a fresh installation:

1. Import `schema.sql` into an empty MariaDB server/database.
2. Import `reference-data.sql` for the built-in school-form templates and mappings.
3. Stop here for a non-demo installation.

For a fresh demo installation, import `schema.sql`, then `demo-data.sql`, then
`reference-data.sql`. The reference data is safe to import after the demo rows.
Neither the schema nor the reference data imports school-specific production
records.

For an existing database, back it up and apply only its pending numbered
`migrations/` files in order. Do not re-import `schema.sql` or replay migrations
on a fresh installation. `054_resume_after_partial_import.sql` was a one-time
recovery script for a database where part of migration 054 had already run;
it is not a numbered migration or part of normal setup.
