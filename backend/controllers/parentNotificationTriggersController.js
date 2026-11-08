const { getDatabase } = require('../config/database');
const { isSemaphoreConfigured } = require('../config/semaphore');

const CODES = ['grade_below_threshold', 'consecutive_absences', 'assignment_not_completed', 'narrative_report_released', 'journal_not_submitted'];
const CUSTOM_THRESHOLDS = new Set(['assignment_not_completed', 'journal_not_submitted']);

function settingsFromRows(rows) {
  return CODES.map(code => {
    const row = rows.find(item => item.triggerCode === code);
    return { code, enabled: Boolean(row?.enabled), threshold: CUSTOM_THRESHOLDS.has(code) ? Number(row?.threshold || 2) : null };
  });
}

function reportSmsAvailability(features) {
  if (!features?.narrativeReportsEnabled) return { available: false, reason: 'narrative_reports_disabled' };
  if (process.env.AI_REPORTS_RELEASE_ENABLED !== 'true') return { available: false, reason: 'report_release_disabled' };
  if (!isSemaphoreConfigured()) return { available: false, reason: 'semaphore_not_configured' };
  return { available: true, reason: null };
}

function reportSmsSetting(row, features) {
  return {
    enabled: Boolean(row?.enabled),
    configured: isSemaphoreConfigured(),
    ...reportSmsAvailability(features)
  };
}

async function getSettings(req, res, next) {
  try {
    const [rows] = await getDatabase().execute(
      'SELECT trigger_code AS triggerCode, is_enabled AS enabled, threshold FROM parent_notification_triggers WHERE school_id = ?',
      [req.user.schoolId]
    );
    const [[attendance]] = await getDatabase().execute(
      'SELECT consecutive_absences_alert AS absenceThreshold FROM school_attendance_settings WHERE school_id = ?',
      [req.user.schoolId]
    );
    const [[features]] = await getDatabase().execute(
      `SELECT grades_enabled AS gradesEnabled, journals_enabled AS journalsEnabled,
        narrative_reports_enabled AS narrativeReportsEnabled FROM school_portal_features WHERE school_id = ?`,
      [req.user.schoolId]
    );
    const [[smsSetting]] = await getDatabase().execute(
      'SELECT narrative_report_sms_enabled AS enabled FROM school_parent_notification_settings WHERE school_id = ?',
      [req.user.schoolId]
    );
    const reportNotificationsAvailable = Boolean(features?.narrativeReportsEnabled) && process.env.AI_REPORTS_RELEASE_ENABLED === 'true';
    const availability = {
      grade_below_threshold: Boolean(features?.gradesEnabled),
      consecutive_absences: true,
      assignment_not_completed: true,
      narrative_report_released: reportNotificationsAvailable,
      journal_not_submitted: Boolean(features?.journalsEnabled)
    };
    res.set('Cache-Control', 'no-store');
    res.json({
      triggers: settingsFromRows(rows).map(item => ({ ...item, enabled: availability[item.code] && item.enabled, available: availability[item.code] })),
      absenceThreshold: Number(attendance?.absenceThreshold || 3),
      narrativeReportSms: reportSmsSetting(smsSetting, features)
    });
  } catch (error) { next(error); }
}

async function updateSettings(req, res, next) {
  let connection;
  try {
    const triggers = req.body?.triggers;
    if (!Array.isArray(triggers) || triggers.length !== CODES.length ||
      new Set(triggers.map(item => item?.code)).size !== CODES.length ||
      triggers.some(item => !CODES.includes(item?.code) || typeof item.enabled !== 'boolean' ||
        Object.keys(item).some(key => !['code', 'enabled', 'threshold'].includes(key)) ||
        (CUSTOM_THRESHOLDS.has(item.code) && (!Number.isInteger(item.threshold) || item.threshold < 1 || item.threshold > 20)) ||
        (!CUSTOM_THRESHOLDS.has(item.code) && item.threshold != null))) {
      const error = new Error('Provide all five notification rules with valid settings.');
      error.status = 400;
      throw error;
    }
    const reportTrigger = triggers.find(item => item.code === 'narrative_report_released');
    const hasSmsSetting = Object.prototype.hasOwnProperty.call(req.body || {}, 'narrativeReportSmsEnabled');
    const narrativeReportSmsEnabled = req.body?.narrativeReportSmsEnabled;
    if (hasSmsSetting && typeof narrativeReportSmsEnabled !== 'boolean') {
      const error = new Error('The weekly report SMS setting must be on or off.');
      error.status = 400;
      throw error;
    }
    if (reportTrigger.enabled && process.env.AI_REPORTS_RELEASE_ENABLED !== 'true') {
      const error = new Error('Report notifications are unavailable while report release is disabled.');
      error.status = 409;
      throw error;
    }
    const [[features]] = await getDatabase().execute(
      `SELECT grades_enabled AS gradesEnabled, journals_enabled AS journalsEnabled,
        narrative_reports_enabled AS narrativeReportsEnabled FROM school_portal_features WHERE school_id = ?`,
      [req.user.schoolId]
    );
    if (triggers.some(item => item.enabled && (
      (item.code === 'grade_below_threshold' && !features?.gradesEnabled) ||
      (item.code === 'journal_not_submitted' && !features?.journalsEnabled)
    ))) {
      const error = new Error('Enable the related portal feature before its parent notification.');
      error.status = 409;
      throw error;
    }
    if (reportTrigger.enabled && !features?.narrativeReportsEnabled) {
      const error = new Error('Enable Narrative Reports before its parent notification.');
      error.status = 409;
      throw error;
    }
    const smsAvailability = reportSmsAvailability(features);
    if (narrativeReportSmsEnabled === true && !smsAvailability.available) {
      const messages = {
        narrative_reports_disabled: 'Enable Narrative Reports before enabling report SMS.',
        report_release_disabled: 'Report SMS is unavailable while report release is disabled.',
        semaphore_not_configured: 'Semaphore SMS is not ready. Contact your platform administrator.'
      };
      const error = new Error(messages[smsAvailability.reason]);
      error.status = 409;
      throw error;
    }
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    for (const code of CODES) {
      const item = triggers.find(trigger => trigger.code === code);
      await connection.execute(
        `INSERT INTO parent_notification_triggers (school_id, trigger_code, is_enabled, threshold, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), threshold = VALUES(threshold), updated_by_user_id = VALUES(updated_by_user_id)`,
        [req.user.schoolId, item.code, item.enabled, CUSTOM_THRESHOLDS.has(item.code) ? item.threshold : null, req.user.id]
      );
    }
    let savedSmsSetting;
    if (hasSmsSetting) {
      await connection.execute(
        `INSERT INTO school_parent_notification_settings
          (school_id, narrative_report_sms_enabled, updated_by_user_id)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE narrative_report_sms_enabled = VALUES(narrative_report_sms_enabled),
          updated_by_user_id = VALUES(updated_by_user_id)`,
        [req.user.schoolId, narrativeReportSmsEnabled, req.user.id]
      );
      savedSmsSetting = { enabled: narrativeReportSmsEnabled };
    } else {
      const [[currentSmsSetting]] = await connection.execute(
        'SELECT narrative_report_sms_enabled AS enabled FROM school_parent_notification_settings WHERE school_id = ? FOR UPDATE',
        [req.user.schoolId]
      );
      savedSmsSetting = currentSmsSetting;
    }
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, details)
      VALUES (?, ?, 'parent_notification_triggers_updated', 'parent_notification_triggers', JSON_OBJECT('summary', 'Parent notification and delivery settings updated'))`,
      [req.user.schoolId, req.user.id]
    );
    await connection.commit();
    connection.release();
    connection = null;
    res.set('Cache-Control', 'no-store');
    res.json({ triggers: triggers.map(item => ({
      ...item,
      available: item.code === 'assignment_not_completed' ||
        (item.code === 'grade_below_threshold' && Boolean(features?.gradesEnabled)) ||
        item.code === 'consecutive_absences' ||
        (item.code === 'narrative_report_released' && Boolean(features?.narrativeReportsEnabled) && process.env.AI_REPORTS_RELEASE_ENABLED === 'true') ||
        (item.code === 'journal_not_submitted' && Boolean(features?.journalsEnabled))
    })), narrativeReportSms: reportSmsSetting(savedSmsSetting, features) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

module.exports = { getSettings, updateSettings };
