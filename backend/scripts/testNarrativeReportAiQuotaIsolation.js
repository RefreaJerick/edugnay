const assert = require('node:assert/strict');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

if (process.env.DB_NAME !== 'academix_phase4_review' || process.env.PHASE5_ISOLATED_TEST !== '1') {
  throw new Error('This isolated quota check requires academix_phase4_review and PHASE5_ISOLATED_TEST=1.');
}

process.env.AI_REPORTS_DAILY_CALL_LIMIT = '2';
const database = require('../config/database').getDatabase();
const { generateWithQuota, reserveModelCall, manilaDate } = require('../services/aiReportUsage');
const parallelDates = ['2099-01-01', '2099-01-02'];

async function main() {
  const [schools] = await database.execute(
    'SELECT school_id AS id FROM school_portal_features WHERE narrative_reports_enabled = 1 ORDER BY school_id LIMIT 2'
  );
  assert.equal(schools.length, 2, 'The test database needs two report-enabled schools.');
  const schoolIds = schools.map(school => school.id);
  const [existing] = await database.execute(
    'SELECT school_id FROM ai_report_daily_usage WHERE school_id IN (?, ?) AND usage_date IN (?, ?)',
    [...schoolIds, ...parallelDates]
  );
  assert.equal(existing.length, 0, 'Reserved quota-test dates already contain usage; no data was changed.');

  try {
    const results = await Promise.allSettled(Array.from({ length: 5 },
      () => reserveModelCall(database, schoolIds[0], parallelDates[0])));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    assert.equal(results.filter(result => result.reason?.status === 429).length, 3);
    await reserveModelCall(database, schoolIds[1], parallelDates[0]);
    await reserveModelCall(database, schoolIds[0], parallelDates[1]);
    const [counts] = await database.execute(
      'SELECT school_id AS schoolId, usage_date AS date, call_count AS calls FROM ai_report_daily_usage WHERE school_id IN (?, ?) AND usage_date IN (?, ?) ORDER BY school_id, usage_date',
      [...schoolIds, ...parallelDates]
    );
    assert.deepEqual(counts.map(row => Number(row.calls)), [2, 1, 1]);
    console.log('PASS concurrent atomic quota, separate schools and day rollover');
  } finally {
    await database.execute(
      'DELETE FROM ai_report_daily_usage WHERE school_id IN (?, ?) AND usage_date IN (?, ?)',
      [...schoolIds, ...parallelDates]
    );
  }

  const connection = await database.getConnection();
  let started = false;
  try {
    await connection.beginTransaction();
    started = true;
    const transaction = { execute: connection.execute.bind(connection) };
    const schoolId = schoolIds[0];
    const testDate = '2099-01-03';
    const now = new Date('2099-01-02T16:00:00Z');
    assert.equal(manilaDate(now), testDate);
    let providerCalls = 0;
    const input = { database: transaction, schoolId, student: {}, reportWeek: {}, teacherNote: '' };
    await connection.execute(
      'UPDATE school_portal_features SET ai_evidence_approved_at = NULL, ai_evidence_approved_by_user_id = NULL WHERE school_id = ?',
      [schoolId]
    );
    await assert.rejects(generateWithQuota(input, { now, provider: async () => { providerCalls++; } }),
      { status: 503 });
    assert.equal(providerCalls, 0);
    const [[admin]] = await connection.execute(
      "SELECT id FROM users WHERE school_id = ? AND role = 'school_admin' LIMIT 1", [schoolId]
    );
    assert.ok(admin);
    await connection.execute(
      'UPDATE school_portal_features SET ai_evidence_approved_at = CURRENT_TIMESTAMP, ai_evidence_approved_by_user_id = ? WHERE school_id = ?',
      [admin.id, schoolId]
    );
    await generateWithQuota(input, { now, provider: async () => {
      providerCalls++;
      return { usage: { inputTokens: 12, outputTokens: 5 } };
    } });
    await assert.rejects(generateWithQuota(input, { now, provider: async () => {
      providerCalls++;
      const error = new Error('Synthetic provider failure');
      error.category = 'provider';
      throw error;
    } }), /Synthetic provider failure/);
    await assert.rejects(generateWithQuota(input, { now, provider: async () => { providerCalls++; } }),
      { status: 429 });
    assert.equal(providerCalls, 2);
    const [[usage]] = await connection.execute(
      'SELECT call_count AS calls, input_tokens AS inputTokens, output_tokens AS outputTokens FROM ai_report_daily_usage WHERE school_id = ? AND usage_date = ?',
      [schoolId, testDate]
    );
    assert.deepEqual([Number(usage.calls), Number(usage.inputTokens), Number(usage.outputTokens)], [2, 12, 5]);
    const [[error]] = await connection.execute(
      'SELECT error_category AS category, error_count AS count FROM ai_report_daily_errors WHERE school_id = ? AND usage_date = ?',
      [schoolId, testDate]
    );
    assert.deepEqual([error.category, Number(error.count)], ['provider', 1]);
    await connection.execute(
      'UPDATE school_portal_features SET ai_evidence_approved_at = NULL, ai_evidence_approved_by_user_id = NULL WHERE school_id = ?',
      [schoolId]
    );
    await assert.rejects(generateWithQuota(input, { now, provider: async () => { providerCalls++; } }),
      { status: 503 });
    assert.equal(providerCalls, 2);
    const [contentColumns] = await connection.execute(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ai_report_daily_usage', 'ai_report_daily_errors')
        AND COLUMN_NAME IN ('summary', 'teacher_note', 'reflection', 'report_content')`
    );
    assert.equal(contentColumns.length, 0);
    console.log('PASS approval, revocation, failed-call accounting and content-free aggregates');
  } finally {
    try {
      if (started) {
        await connection.rollback();
        console.log('PASS approval and provider test changes rolled back');
      }
    } finally {
      connection.release();
      await database.end();
    }
  }
}

main().catch(error => {
  console.error(`Phase 5 quota check failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
