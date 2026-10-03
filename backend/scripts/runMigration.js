const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');
const { runTenantIsolationAudit } = require('../utils/tenantIsolationAudit');

async function main() {
  const migrationName = path.basename(String(process.argv[2] || ''));
  const startAt = Number.parseInt(process.argv[3] || '1', 10);
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(migrationName)) {
    throw new Error('Provide a migration file name from the database/migrations directory.');
  }
  if (!Number.isSafeInteger(startAt) || startAt < 1) throw new Error('The optional starting statement must be a positive number.');

  const applicationDatabase = getDatabase();
  try {
    const audit = await runTenantIsolationAudit(applicationDatabase);
    if (audit.totalMismatches) {
      throw new Error(`Migration stopped because the tenant audit found ${audit.totalMismatches} mismatch(es).`);
    }
  } finally {
    await applicationDatabase.end();
  }

  const database = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_MIGRATION_USER || process.env.DB_USER,
    password: process.env.DB_MIGRATION_USER
      ? (process.env.DB_MIGRATION_PASSWORD || '')
      : (process.env.DB_PASSWORD || ''),
    database: process.env.DB_NAME
  });

  try {
    const migrationPath = path.join(__dirname, '../database/migrations', migrationName);
    const source = await fs.readFile(migrationPath, 'utf8');
    const statements = source
      .split(';')
      .map(statement => statement.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
      .filter(statement => !/^USE\s+/i.test(statement));
    for (const statement of statements.slice(startAt - 1)) await database.query(statement);
    console.log(`Applied ${migrationName} from statement ${startAt} (${statements.length - startAt + 1} statements).`);
  } finally {
    await database.end();
  }
}

main().catch(error => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
