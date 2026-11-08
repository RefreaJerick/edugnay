const { isSemaphoreConfigured, normalizePhilippineMobile } = require('../config/semaphore');

function reportSmsMessage({ studentName, weekStartDate, weekEndDate, summary, parentActions }) {
  const actions = Array.isArray(parentActions) ? parentActions.filter(action => typeof action === 'string' && action.trim()) : [];
  return [
    `Weekly Narrative Report for ${String(studentName).trim()}`,
    `Reporting week: ${weekStartDate} to ${weekEndDate}`,
    '',
    String(summary || '').trim(),
    ...(actions.length ? ['', 'Recommended actions:', ...actions.map(action => `- ${action.trim()}`)] : [])
  ].join('\n');
}

async function queueReleasedReportSms(connection, {
  schoolId, releaseId, studentId, studentName, weekStartDate, weekEndDate, summary, parentActions
}) {
  const [[setting]] = await connection.execute(
    `SELECT narrative_report_sms_enabled AS enabled
    FROM school_parent_notification_settings WHERE school_id = ?`, [schoolId]
  );
  if (!setting?.enabled) return { queued: 0, skipped: 0 };

  const [parents] = await connection.execute(
    `SELECT DISTINCT parents.id AS parentUserId, profiles.contact_number AS contactNumber
    FROM student_parent_links AS links
    INNER JOIN users AS students ON students.id = links.student_user_id
      AND students.school_id = links.school_id AND students.role = 'student' AND students.account_status = 'active'
    INNER JOIN users AS parents ON parents.id = links.parent_user_id
      AND parents.school_id = links.school_id AND parents.role = 'parent' AND parents.account_status = 'active'
    LEFT JOIN parent_profiles AS profiles ON profiles.user_id = parents.id
    WHERE links.school_id = ? AND links.student_user_id = ?`, [schoolId, studentId]
  );
  if (!parents.length) return { queued: 0, skipped: 0 };

  const message = reportSmsMessage({ studentName, weekStartDate, weekEndDate, summary, parentActions });
  const configured = isSemaphoreConfigured();
  let queued = 0;
  let skipped = 0;
  for (const parent of parents) {
    const normalizedPhone = normalizePhilippineMobile(parent.contactNumber);
    const status = !parent.contactNumber ? 'skipped' : !normalizedPhone ? 'skipped' : !configured ? 'failed' : 'pending';
    const errorCode = !parent.contactNumber ? 'missing_phone'
      : !normalizedPhone ? 'invalid_phone'
        : !configured ? 'provider_not_configured' : null;
    await connection.execute(
      `INSERT INTO narrative_report_sms_outbox
        (school_id, report_release_id, parent_user_id, recipient_phone, recipient_last4,
          message_body, status, next_attempt_at, last_error_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'pending' THEN CURRENT_TIMESTAMP ELSE NULL END, ?)
      ON DUPLICATE KEY UPDATE id = id`,
      [schoolId, releaseId, parent.parentUserId, status === 'pending' ? normalizedPhone : null,
        normalizedPhone ? normalizedPhone.slice(-4) : null,
        status === 'pending' ? message : null, status, status, errorCode]
    );
    if (status === 'pending') queued += 1;
    else if (status === 'skipped') skipped += 1;
  }
  return { queued, skipped };
}

module.exports = { queueReleasedReportSms, reportSmsMessage };
