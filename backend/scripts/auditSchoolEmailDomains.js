const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getDatabase } = require('../config/database');

async function main() {
  const database = getDatabase();
  try {
    const [columns] = await database.execute("SHOW COLUMNS FROM schools LIKE 'school_email_domain'");
    const installed = columns.length > 0;
    const [schools] = await database.execute(installed
      ? 'SELECT id, name, school_email_domain AS schoolEmailDomain FROM schools ORDER BY id'
      : 'SELECT id, name FROM schools ORDER BY id');
    const [domains] = await database.execute(`
      SELECT school_id AS schoolId, LOWER(SUBSTRING_INDEX(school_email, '@', -1)) AS domain, COUNT(*) AS accounts
      FROM users WHERE school_id IS NOT NULL
      GROUP BY school_id, domain ORDER BY school_id, domain`);
    const bySchool = new Map();
    for (const row of domains) {
      const entries = bySchool.get(Number(row.schoolId)) || [];
      entries.push({ domain: row.domain, accounts: row.accounts });
      bySchool.set(Number(row.schoolId), entries);
    }
    let unsafe = false;
    const claimed = new Map();
    for (const school of schools) {
      const entries = bySchool.get(Number(school.id)) || [];
      console.log(JSON.stringify({ schoolId: school.id, name: school.name, storedDomain: school.schoolEmailDomain || null, existingDomains: entries }));
      if (entries.length > 1) unsafe = true;
      if (installed && (!school.schoolEmailDomain || (entries.length === 1 && school.schoolEmailDomain !== entries[0].domain))) unsafe = true;
      for (const entry of entries) {
        if (claimed.has(entry.domain) && claimed.get(entry.domain) !== school.id) unsafe = true;
        claimed.set(entry.domain, school.id);
      }
    }
    if (unsafe) throw new Error('Mixed or shared domains found. Resolve these before applying migration 029.');
    console.log(installed ? 'Domain audit passed. Stored domains match existing accounts.'
      : 'Domain audit passed. Existing account addresses can be preserved.');
  } finally {
    await database.end();
  }
}

main().catch(error => {
  console.error(`Domain audit failed: ${error.message}`);
  process.exitCode = 1;
});
