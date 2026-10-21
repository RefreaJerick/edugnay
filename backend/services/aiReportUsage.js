const { generateNarrativeDraft } = require('./narrativeReportAi');

function manilaDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dailyLimit() {
  const value = Number(process.env.AI_REPORTS_DAILY_CALL_LIMIT || 100);
  if (!Number.isSafeInteger(value) || value < 1) {
    const error = new Error('The AI report daily limit is not configured correctly.');
    error.status = 503;
    throw error;
  }
  return value;
}

async function reserveModelCall(database, schoolId, date = manilaDate()) {
  const limit = dailyLimit();
  await database.execute(
    `INSERT INTO ai_report_daily_usage (school_id, usage_date, call_count)
    VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE school_id = school_id`, [schoolId, date]
  );
  const [result] = await database.execute(
    `UPDATE ai_report_daily_usage SET call_count = call_count + 1
    WHERE school_id = ? AND usage_date = ? AND call_count < ?`, [schoolId, date, limit]
  );
  if (!result.affectedRows) {
    const error = new Error('This school has reached today’s AI report limit. Try again tomorrow.');
    error.status = 429;
    throw error;
  }
  return date;
}

function errorCategory(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (['provider', 'refusal', 'invalid_output'].includes(error?.category)) return error.category;
  return 'other';
}

async function requireAiEvidenceApproval(database, schoolId) {
  const [[approval]] = await database.execute(
    `SELECT ai_evidence_approved_at AS approvedAt FROM school_portal_features
    WHERE school_id = ? AND narrative_reports_enabled = TRUE`, [schoolId]
  );
  if (!approval?.approvedAt) {
    const error = new Error('The school has not approved sending learner evidence to the AI service.');
    error.status = 503;
    throw error;
  }
}

async function recordModelOutcome(database, schoolId, date, usage, error) {
  const input = Math.max(0, Number(usage?.inputTokens) || 0);
  const output = Math.max(0, Number(usage?.outputTokens) || 0);
  if (input || output) {
    await database.execute(
      `UPDATE ai_report_daily_usage SET input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ? WHERE school_id = ? AND usage_date = ?`,
      [input, output, schoolId, date]
    );
  }
  if (error) {
    await database.execute(
      `INSERT INTO ai_report_daily_errors (school_id, usage_date, error_category, error_count)
      VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE error_count = error_count + 1`,
      [schoolId, date, errorCategory(error)]
    );
  }
}

async function generateWithQuota({ database, schoolId, student, reportWeek, teacherNote },
  { provider = generateNarrativeDraft, now = new Date() } = {}) {
  await requireAiEvidenceApproval(database, schoolId);
  const date = await reserveModelCall(database, schoolId, manilaDate(now));
  let draft;
  try {
    draft = await provider({ student, reportWeek, teacherNote });
  } catch (error) {
    await recordModelOutcome(database, schoolId, date, error.usage, error);
    throw error;
  }
  await recordModelOutcome(database, schoolId, date, draft.usage, null);
  return draft;
}

module.exports = {
  manilaDate, dailyLimit, requireAiEvidenceApproval, reserveModelCall,
  recordModelOutcome, generateWithQuota
};
