const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');

async function main() {
  const database = getDatabase();
  try {
    const [[clock]] = await database.query('SELECT NOW() AS databaseNow, @@session.time_zone AS sessionTimeZone, @@system_time_zone AS systemTimeZone');
    const [[column]] = await database.query(`SELECT COUNT(*) AS installed FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_journal_entries'
        AND COLUMN_NAME = 'owner_teacher_user_id'`);
    const ownerInstalled = Boolean(column.installed);
    const [rows] = await database.query(`SELECT entries.school_id AS schoolId,
      COUNT(*) AS entries,
      SUM(entries.journal_prompt_id IS NULL) AS promptless,
      SUM(entries.journal_prompt_id IS NOT NULL AND prompts.id IS NULL) AS brokenPromptLinks,
      ${ownerInstalled ? 'SUM(entries.owner_teacher_user_id IS NULL)' : 'NULL'} AS unresolvedOwners
      FROM student_journal_entries AS entries
      LEFT JOIN journal_prompts AS prompts ON prompts.school_id = entries.school_id
        AND prompts.id = entries.journal_prompt_id
      GROUP BY entries.school_id ORDER BY entries.school_id`);
    console.log(JSON.stringify({ clock, ownerInstalled, schools: rows }, null, 2));
  } finally {
    await database.end();
  }
}

main().catch(error => {
  console.error(`Journal ownership audit failed: ${error.message}`);
  process.exitCode = 1;
});
