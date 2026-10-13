# School email domains

`schools.school_email_domain` is the stable suffix for generated school login addresses. It is assigned when a school is registered and does not change when its name, contact email, or website changes. Personal email remains the delivery address.

The first school administrator login is generated after that domain is assigned, using the administrator's name (for example, `j.reyes.adm@mnhs.academix.test`). The notification email is stored separately and receives the approval decision; the generated login is not a mailbox.

New schools use an acronym from the school name plus `SCHOOL_EMAIL_DOMAIN_BASE` (default `academix.test`). For example, Mangaldan National High School becomes `mnhs.academix.test`. A random suffix avoids collisions. Set the base suffix before registering schools in a deployment; changing it later affects only future registrations.

For an existing database, run these in order:

1. `node scripts/auditSchoolEmailDomains.js` and resolve any mixed or shared existing login domains.
2. `node scripts/backupDatabase.js` and verify the private snapshot under `database/backups/` before changing the schema. Keep it outside public hosting.
3. Set `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD` for a database account with `ALTER` permission. Do not grant `ALTER` to `academix_app`.
4. `node scripts/runMigration.js 029_add_school_email_domain.sql`
5. `node scripts/auditSchoolEmailDomains.js` again and run the focused tests.

The migration preserves existing user addresses and adopts each school's existing suffix when it is uniform. Schools without accounts receive a stable domain. SCC retains `stcolumban.edu.ph`; the existing Mangaldan pilot receives `mnhs.academix.test`. Do not rerun migration 029 after it succeeds. MySQL DDL is not transactionally rolled back; restore from the verified backup if a migration fails partway through.
