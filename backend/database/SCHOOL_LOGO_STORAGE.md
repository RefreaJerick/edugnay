# School logo storage

All school-specific logo files are stored in `SCHOOL_LOGO_DIRECTORY`. Set it to an absolute, writable, persistent directory outside the project workspace in each deployment. If it is omitted, the API uses `~/.academix/uploads/school-logos`. All API instances serving a school must use the same storage (or a shared mounted volume).

`npm run backup:database` now saves the database snapshot and a sibling `school-logos-<timestamp>` directory containing every referenced logo plus a manifest with its school ID, filename, and SHA-256 checksum. Keep both artifacts together and private. The backup command fails rather than creating an incomplete pair if a referenced logo is missing or still uses a legacy path.

The database stores only a generated filename in `schools.logo_path`. The protected `GET /api/schools/:schoolId/logo` route serves the file and enforces school/platform access. The public image URL and database schema do not change.

## Existing databases

The migration command defaults to a read-only dry run. From `backend/`, review the schools and source paths it finds:

```sh
npm run migrate:school-logos
```

When the candidates and images are correct, apply the copy-and-reference update:

```sh
npm run migrate:school-logos -- --apply
```

The command preflights every legacy reference before writing, validates the image bytes, copies files to the configured directory under generated names, and updates only a row whose original path still matches. If an update fails, its new copy is removed. It can be safely rerun. Original files under `assets/images` are retained for recovery and demo seeding.

After applying, verify the platform school list and logo endpoint for each migrated school. Do not remove the legacy-path compatibility code until all deployed database rows have been migrated and verified.

## Demo database setup

After loading `schema.sql`, the required SQL migrations, and `demo-data.sql`, run the dry run and then the apply command above. The demo SQL retains the original sample image references as source fixtures; the command converts them to the same generated-filename format used by new registrations and school-settings uploads.
