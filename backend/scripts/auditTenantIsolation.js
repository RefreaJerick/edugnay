const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');
const { runTenantIsolationAudit } = require('../utils/tenantIsolationAudit');

async function main() {
  const database = getDatabase();
  const result = await runTenantIsolationAudit(database);

  console.log(`Tenant isolation audit: ${result.checkCount} checks`);
  for (const check of result.checks) {
    const status = check.mismatchCount ? 'FAIL' : 'PASS';
    console.log(`${status} ${check.name}: ${check.mismatchCount} mismatch(es)`);
    if (check.samples.length) console.table(check.samples);
  }
  console.log(`Total mismatches: ${result.totalMismatches}`);
  process.exitCode = result.totalMismatches ? 1 : 0;
  await database.end();
}

main().catch(error => {
  console.error(`Tenant isolation audit failed: ${error.message}`);
  process.exitCode = 1;
});
