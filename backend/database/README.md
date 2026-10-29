# Academix database setup

`schema.sql` defines the final database structure through migration 056. It is
for an empty database, not for upgrading an existing one. The file creates and
selects the `academix` database, so check the target server before importing.

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
