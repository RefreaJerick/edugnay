const { getDatabase } = require('../config/database');

const CODES = ['grade_below_threshold', 'consecutive_absences', 'assignment_not_completed', 'narrative_report_released', 'journal_not_submitted'];
const CUSTOM_THRESHOLDS = new Set(['assignment_not_completed', 'journal_not_submitted']);

function settingsFromRows(rows) {
  return CODES.map(code => {
    const row = rows.find(item => item.triggerCode === code);
    return { code, enabled: Boolean(row?.enabled), threshold: CUSTOM_THRESHOLDS.has(code) ? Number(row?.threshold || 2) : null };
  });
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
      'SELECT grades_enabled AS gradesEnabled, attendance_enabled AS attendanceEnabled, journals_enabled AS journalsEnabled FROM school_portal_features WHERE school_id = ?',
      [req.user.schoolId]
    );
    const availability = {
      grade_below_threshold: Boolean(features?.gradesEnabled),
      consecutive_absences: Boolean(features?.attendanceEnabled),
      assignment_not_completed: true,
      narrative_report_released: false,
      journal_not_submitted: Boolean(features?.journalsEnabled)
    };
    res.set('Cache-Control', 'no-store');
    res.json({ triggers: settingsFromRows(rows).map(item => ({ ...item, enabled: availability[item.code] && item.enabled, available: availability[item.code] })), absenceThreshold: Number(attendance?.absenceThreshold || 3) });
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
    if (triggers.some(item => item.code === 'narrative_report_released' && item.enabled)) {
      const error = new Error('Report notifications cannot be enabled until reports are released through the backend.');
      error.status = 409;
      throw error;
    }
    const [[features]] = await getDatabase().execute(
      'SELECT grades_enabled AS gradesEnabled, attendance_enabled AS attendanceEnabled, journals_enabled AS journalsEnabled FROM school_portal_features WHERE school_id = ?',
      [req.user.schoolId]
    );
    if (triggers.some(item => item.enabled && (
      (item.code === 'grade_below_threshold' && !features?.gradesEnabled) ||
      (item.code === 'consecutive_absences' && !features?.attendanceEnabled) ||
      (item.code === 'journal_not_submitted' && !features?.journalsEnabled)
    ))) {
      const error = new Error('Enable the related portal feature before its parent notification.');
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
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, details)
      VALUES (?, ?, 'parent_notification_triggers_updated', 'parent_notification_triggers', JSON_OBJECT('summary', 'Parent notification settings updated'))`,
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
        (item.code === 'consecutive_absences' && Boolean(features?.attendanceEnabled)) ||
        (item.code === 'journal_not_submitted' && Boolean(features?.journalsEnabled))
    })) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

module.exports = { getSettings, updateSettings };
