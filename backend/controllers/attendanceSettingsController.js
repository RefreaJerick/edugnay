const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');

async function getAttendanceSettings(req, res, next) {
  try {
    const schoolId = req.user.schoolId;
    const [[settings]] = await getDatabase().execute(
      `SELECT max_unexcused_absences AS maxUnexcusedAbsences,
        consecutive_absences_alert AS consecutiveAbsencesAlert,
        count_excused_absences AS countExcusedAbsences,
        allow_edit_past_attendance AS allowEditPastAttendance
      FROM school_attendance_settings WHERE school_id = ?`, [schoolId]
    );
    const [codes] = await getDatabase().execute(
      `SELECT code AS id, display_name AS name, description,
        display_key AS displayKey, display_tone AS tone
      FROM attendance_status_codes WHERE school_id = ? AND is_active = 1 ORDER BY id`, [schoolId]
    );
    res.json({ settings: {
      maxUnexcusedAbsences: settings?.maxUnexcusedAbsences ?? 5,
      consecutiveAbsencesAlert: settings?.consecutiveAbsencesAlert ?? 3,
      countExcusedAbsences: Boolean(settings?.countExcusedAbsences),
      allowEditPastAttendance: settings?.allowEditPastAttendance == null ? true : Boolean(settings.allowEditPastAttendance),
      statusCodes: codes.map(code => ({ id: code.id, name: code.name,
        description: code.description, key: code.displayKey, tone: code.tone }))
    } });
  } catch (error) { next(error); }
}

async function updateAttendanceSettings(req, res, next) {
  const fields = ['maxUnexcusedAbsences', 'consecutiveAbsencesAlert'];
  const counts = fields.map(field => Number(req.body?.[field]));
  if (counts.some(value => !Number.isInteger(value) || value < 1 || value > 255)
    || typeof req.body?.countExcusedAbsences !== 'boolean'
    || typeof req.body?.allowEditPastAttendance !== 'boolean') {
    return res.status(400).json({ message: 'Enter valid attendance thresholds and options.' });
  }
  let connection;
  try {
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO school_attendance_settings
        (school_id, max_unexcused_absences, consecutive_absences_alert,
        count_excused_absences, allow_edit_past_attendance)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE max_unexcused_absences = VALUES(max_unexcused_absences),
        consecutive_absences_alert = VALUES(consecutive_absences_alert),
        count_excused_absences = VALUES(count_excused_absences),
        allow_edit_past_attendance = VALUES(allow_edit_past_attendance)`,
      [req.user.schoolId, ...counts, req.body.countExcusedAbsences, req.body.allowEditPastAttendance]
    );
    await writeAuditLog(connection, req, 'attendance_settings_updated', 'school_attendance_settings',
      req.user.schoolId, {
        thresholds: counts,
        countExcusedAbsences: req.body.countExcusedAbsences,
        allowEditPastAttendance: req.body.allowEditPastAttendance
      }, req.user.schoolId);
    await connection.commit();
    return getAttendanceSettings(req, res, next);
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

module.exports = { getAttendanceSettings, updateAttendanceSettings };
