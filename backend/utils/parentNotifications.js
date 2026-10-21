const { consecutiveMissedMeetingDates } = require('./attendanceStreak');

async function getTrigger(connection, schoolId, code) {
  if (code === 'narrative_report_released' && process.env.AI_REPORTS_RELEASE_ENABLED !== 'true') return null;
  const [[row]] = await connection.execute(
    `SELECT triggers.is_enabled AS enabled, triggers.threshold
    FROM parent_notification_triggers AS triggers
    LEFT JOIN school_portal_features AS features ON features.school_id = triggers.school_id
    WHERE triggers.school_id = ? AND triggers.trigger_code = ?
      AND (triggers.trigger_code NOT IN ('grade_below_threshold', 'journal_not_submitted', 'narrative_report_released')
        OR (triggers.trigger_code = 'grade_below_threshold' AND features.grades_enabled = TRUE)
        OR (triggers.trigger_code = 'journal_not_submitted' AND features.journals_enabled = TRUE)
        OR (triggers.trigger_code = 'narrative_report_released' AND features.narrative_reports_enabled = TRUE))`,
    [schoolId, code]
  );
  return row?.enabled ? row : null;
}

async function notifyParents(connection, { schoolId, studentId, code, eventKey, title, message, targetPath }) {
  if (!await getTrigger(connection, schoolId, code)) return;
  await connection.execute(
    `INSERT INTO notifications (user_id, related_student_user_id, type, title, message, target_path, event_key)
    SELECT DISTINCT parents.id, students.id, ?, ?, ?, ?, ?
    FROM student_parent_links AS links
    INNER JOIN users AS parents ON parents.id = links.parent_user_id
      AND parents.school_id = ? AND parents.role = 'parent' AND parents.account_status = 'active'
    INNER JOIN users AS students ON students.id = links.student_user_id
      AND students.school_id = ? AND students.role = 'student' AND students.account_status = 'active'
    WHERE links.school_id = ? AND links.student_user_id = ?
    ON DUPLICATE KEY UPDATE event_key = event_key`,
    [{ grade_below_threshold: 'grade', consecutive_absences: 'attendance', assignment_not_completed: 'assignment', narrative_report_released: 'report', journal_not_submitted: 'journal' }[code], title, message, targetPath, eventKey, schoolId, schoolId, schoolId, studentId]
  );
}

async function notifyConsecutiveAbsences(connection, schoolId, sectionId, subjectId, studentId) {
  const trigger = await getTrigger(connection, schoolId, 'consecutive_absences');
  if (!trigger) return;
  const [[settings]] = await connection.execute(
    'SELECT consecutive_absences_alert AS threshold FROM school_attendance_settings WHERE school_id = ?',
    [schoolId]
  );
  const threshold = Number(settings?.threshold || 3);
  const [history] = await connection.execute(
    `SELECT sessions.id AS sessionId,
      DATE_FORMAT(sessions.attendance_date, '%Y-%m-%d') AS date,
      records.attendance_status AS status
    FROM attendance_sessions AS sessions
    INNER JOIN attendance_records AS records ON records.school_id = sessions.school_id
      AND records.attendance_session_id = sessions.id
    WHERE sessions.school_id = ? AND sessions.section_id = ? AND sessions.subject_id = ?
      AND sessions.status = 'confirmed' AND records.student_user_id = ?
    ORDER BY sessions.attendance_date DESC, sessions.id DESC`,
    [schoolId, sectionId, subjectId, studentId]
  );
  const missedDates = consecutiveMissedMeetingDates(history);
  if (missedDates.length !== threshold) return;
  const [[student]] = await connection.execute('SELECT display_name AS name FROM users WHERE id = ? AND school_id = ?', [studentId, schoolId]);
  const [[subject]] = await connection.execute('SELECT name FROM subjects WHERE id = ? AND school_id = ?', [subjectId, schoolId]);
  await notifyParents(connection, {
    schoolId, studentId, code: 'consecutive_absences',
    eventKey: `absence:${sectionId}:${subjectId}:${studentId}:${missedDates[threshold - 1].sessionId}`,
    title: 'Consecutive missed subject meeting dates',
    message: `${student.name} missed ${threshold} consecutive recorded meeting dates in ${subject.name}.`,
    targetPath: '/views/parent/edugnay-parent-attendance.html'
  });
}

module.exports = { getTrigger, notifyParents, notifyConsecutiveAbsences };
