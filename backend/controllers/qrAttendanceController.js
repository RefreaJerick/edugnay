const crypto = require('crypto');
const { getDatabase } = require('../config/database');

const ATTENDANCE_STATUSES = new Set(['present', 'absent', 'late', 'excused']);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function getCurrentDate() {
  const timeZone = process.env.SCHOOL_TIME_ZONE || 'Asia/Manila';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hashQrToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeRecords(records) {
  if (!Array.isArray(records) || !records.length || records.length > 200) {
    throw createError('Provide attendance for each student in the section.');
  }

  const studentIds = new Set();
  return records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw createError('Each attendance record must be an object.');
    }
    const studentId = parseId(record.studentId, 'student ID');
    if (studentIds.has(studentId)) throw createError('A student can only have one attendance record.');
    studentIds.add(studentId);

    const status = String(record.status || '').trim().toLowerCase();
    if (!ATTENDANCE_STATUSES.has(status)) throw createError('Attendance status is invalid.');
    if (record.remarks !== undefined && record.remarks !== null && typeof record.remarks !== 'string') {
      throw createError('Attendance remarks must be text.');
    }
    const remarks = String(record.remarks || '').trim();
    if (remarks.length > 500) throw createError('Attendance remarks are too long.');

    return { studentId, status, remarks: remarks || null };
  });
}

async function getAdvisorySection(database, teacherId, sectionId) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.name
    FROM sections
    WHERE sections.id = ? AND sections.adviser_user_id = ? AND sections.status = 'active'
    LIMIT 1`,
    [sectionId, teacherId]
  );
  return sections[0] || null;
}

async function assertAttendanceFeatureEnabled(database, schoolId) {
  const [features] = await database.execute(
    'SELECT attendance_enabled AS attendanceEnabled FROM school_portal_features WHERE school_id = ? LIMIT 1',
    [schoolId]
  );
  if (!features[0]?.attendanceEnabled) {
    throw createError('Attendance is not enabled for this school.', 403);
  }
}

async function getActiveStudentIds(database, sectionId) {
  const [students] = await database.execute(
    `SELECT student_user_id AS studentId
    FROM section_students
    WHERE section_id = ? AND withdrawn_at IS NULL
    ORDER BY student_user_id`,
    [sectionId]
  );
  return students.map(student => student.studentId);
}

async function getQrAttendanceData(database, section, attendanceDate) {
  const [sessions] = await database.execute(
    `SELECT
      id,
      status,
      created_by_user_id AS createdByUserId,
      confirmed_by_user_id AS confirmedByUserId,
      confirmed_at AS confirmedAt
    FROM attendance_sessions
    WHERE section_id = ? AND subject_id IS NULL AND attendance_date = ?
    LIMIT 1`,
    [section.id, attendanceDate]
  );
  const session = sessions[0] || null;
  const [students] = await database.execute(
    `SELECT
      students.id AS studentId,
      students.display_name AS displayName,
      students.initials,
      student_profiles.lrn,
      attendance_records.attendance_status AS attendanceStatus,
      attendance_records.remarks,
      EXISTS (
        SELECT 1
        FROM qr_scan_events
        WHERE qr_scan_events.attendance_session_id = ?
          AND qr_scan_events.scanned_student_user_id = students.id
          AND qr_scan_events.scan_result = 'accepted'
      ) AS isScanned
    FROM section_students
    INNER JOIN users AS students ON students.id = section_students.student_user_id
    INNER JOIN student_profiles ON student_profiles.user_id = students.id
    LEFT JOIN attendance_records
      ON attendance_records.attendance_session_id = ?
      AND attendance_records.student_user_id = students.id
    WHERE section_students.section_id = ? AND section_students.withdrawn_at IS NULL
    ORDER BY students.last_name, students.first_name`,
    [session?.id || 0, session?.id || 0, section.id]
  );

  const roster = students.map(student => ({
    id: student.studentId,
    displayName: student.displayName,
    initials: student.initials,
    lrn: student.lrn,
    isScanned: Boolean(student.isScanned),
    attendanceStatus: student.attendanceStatus,
    remarks: student.remarks
  }));
  return {
    section: { id: section.id, schoolId: section.schoolId, name: section.name },
    attendanceDate,
    session: session && {
      id: session.id,
      method: 'qr',
      status: session.status,
      createdByUserId: session.createdByUserId,
      confirmedByUserId: session.confirmedByUserId,
      confirmedAt: session.confirmedAt
    },
    scannedCount: roster.filter(student => student.isScanned).length,
    students: roster
  };
}

async function getCurrentQrAttendance(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const database = getDatabase();
    const section = await getAdvisorySection(database, req.user.id, sectionId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(database, section.schoolId);

    res.status(200).json(await getQrAttendanceData(database, section, getCurrentDate()));
  } catch (error) {
    next(error);
  }
}

async function startQrAttendance(req, res, next) {
  let connection;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const attendanceDate = getCurrentDate();
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();

    const section = await getAdvisorySection(connection, req.user.id, sectionId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(connection, section.schoolId);

    const [sessions] = await connection.execute(
      `SELECT id, method, status
      FROM attendance_sessions
      WHERE section_id = ? AND subject_id IS NULL AND attendance_date = ?
      FOR UPDATE`,
      [sectionId, attendanceDate]
    );
    const existingSession = sessions[0];
    if (existingSession?.status === 'confirmed') {
      throw createError('Attendance has already been confirmed for today.', 409);
    }
    if (existingSession && existingSession.method !== 'qr') {
      throw createError('Today\'s attendance session was started manually.', 409);
    }
    if (!existingSession) {
      await connection.execute(
        `INSERT INTO attendance_sessions (
          school_id, section_id, subject_id, attendance_date, method, status, created_by_user_id
        ) VALUES (?, ?, NULL, ?, 'qr', 'draft', ?)`,
        [section.schoolId, sectionId, attendanceDate, req.user.id]
      );
    }

    await connection.commit();
    res.status(200).json(await getQrAttendanceData(database, section, attendanceDate));
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

async function getActiveQrSession(database, teacherId, sessionId, lockSession = false) {
  const [sessions] = await database.execute(
    `SELECT
      attendance_sessions.id,
      attendance_sessions.school_id AS schoolId,
      attendance_sessions.section_id AS sectionId,
      sections.name AS sectionName
    FROM attendance_sessions
    INNER JOIN sections ON sections.id = attendance_sessions.section_id
    WHERE attendance_sessions.id = ?
      AND attendance_sessions.method = 'qr'
      AND attendance_sessions.status = 'draft'
      AND attendance_sessions.attendance_date = ?
      AND sections.adviser_user_id = ?
      AND sections.status = 'active'
    LIMIT 1${lockSession ? ' FOR UPDATE' : ''}`,
    [sessionId, getCurrentDate(), teacherId]
  );
  return sessions[0] || null;
}

async function scanQrAttendance(req, res, next) {
  try {
    const sessionId = parseId(req.params.sessionId, 'attendance session ID');
    const qrToken = typeof req.body.qrToken === 'string' ? req.body.qrToken.trim() : '';
    if (!qrToken || qrToken.length > 500) throw createError('QR data is invalid.');

    const database = getDatabase();
    const session = await getActiveQrSession(database, req.user.id, sessionId);
    if (!session) throw createError('QR attendance session not found.', 404);
    await assertAttendanceFeatureEnabled(database, session.schoolId);

    const [credentials] = await database.execute(
      `SELECT
        student_qr_credentials.id,
        student_qr_credentials.student_user_id AS studentId,
        student_qr_credentials.credential_status AS credentialStatus,
        users.display_name AS displayName,
        users.initials
      FROM student_qr_credentials
      INNER JOIN users ON users.id = student_qr_credentials.student_user_id
      WHERE student_qr_credentials.token_hash = ?
      LIMIT 1`,
      [hashQrToken(qrToken)]
    );
    const credential = credentials[0];
    if (!credential || credential.credentialStatus !== 'active') {
      await database.execute(
        `INSERT INTO qr_scan_events (attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
        VALUES (?, ?, ?, ?, ?)`,
        [sessionId, credential?.id || null, credential?.studentId || null, req.user.id, credential ? 'revoked' : 'unknown']
      );
      throw createError('This attendance QR is unknown or no longer valid.', 422);
    }

    const [enrollments] = await database.execute(
      `SELECT 1 FROM section_students
      WHERE section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL
      LIMIT 1`,
      [session.sectionId, credential.studentId]
    );
    if (!enrollments[0]) {
      await database.execute(
        `INSERT INTO qr_scan_events (attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
        VALUES (?, ?, ?, ?, 'not_enrolled')`,
        [sessionId, credential.id, credential.studentId, req.user.id]
      );
      throw createError('This student is not enrolled in the selected section.', 422);
    }

    const [acceptedScans] = await database.execute(
      `SELECT id FROM qr_scan_events
      WHERE attendance_session_id = ? AND scanned_student_user_id = ? AND scan_result = 'accepted'
      LIMIT 1`,
      [sessionId, credential.studentId]
    );
    const isDuplicate = Boolean(acceptedScans[0]);
    await database.execute(
      `INSERT INTO qr_scan_events (attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
      VALUES (?, ?, ?, ?, ?)`,
      [sessionId, credential.id, credential.studentId, req.user.id, isDuplicate ? 'duplicate' : 'accepted']
    );

    res.status(200).json({
      scanned: !isDuplicate,
      duplicate: isDuplicate,
      student: { id: credential.studentId, displayName: credential.displayName, initials: credential.initials }
    });
  } catch (error) {
    next(error);
  }
}

async function confirmQrAttendance(req, res, next) {
  let connection;
  try {
    const sessionId = parseId(req.params.sessionId, 'attendance session ID');
    const records = normalizeRecords(req.body.records);
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();

    const session = await getActiveQrSession(connection, req.user.id, sessionId, true);
    if (!session) throw createError('QR attendance session not found.', 404);
    await assertAttendanceFeatureEnabled(connection, session.schoolId);

    const studentIds = await getActiveStudentIds(connection, session.sectionId);
    const submittedIds = records.map(record => record.studentId).sort((a, b) => a - b);
    if (studentIds.length !== submittedIds.length || studentIds.some((id, index) => id !== submittedIds[index])) {
      throw createError('Attendance must include every currently enrolled student.');
    }

    for (const record of records) {
      await connection.execute(
        `INSERT INTO attendance_records (
          attendance_session_id, student_user_id, attendance_status, remarks, marked_by_user_id, marked_at
        ) VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          attendance_status = VALUES(attendance_status),
          remarks = VALUES(remarks),
          marked_by_user_id = VALUES(marked_by_user_id),
          marked_at = NOW()`,
        [sessionId, record.studentId, record.status, record.remarks, req.user.id]
      );
    }
    await connection.execute(
      `UPDATE attendance_sessions
      SET status = 'confirmed', confirmed_by_user_id = ?, confirmed_at = NOW()
      WHERE id = ?`,
      [req.user.id, sessionId]
    );
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT('attendance_date', ?, 'method', 'qr'))`,
      [session.schoolId, req.user.id, sessionId, getCurrentDate()]
    );

    await connection.commit();
    res.status(200).json(await getQrAttendanceData(database, {
      id: session.sectionId,
      schoolId: session.schoolId,
      name: session.sectionName
    }, getCurrentDate()));
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

module.exports = {
  confirmQrAttendance,
  getCurrentQrAttendance,
  scanQrAttendance,
  startQrAttendance
};
