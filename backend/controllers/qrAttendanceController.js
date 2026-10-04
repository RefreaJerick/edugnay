const { getDatabase } = require('../config/database');
const { avatarFields } = require('../config/avatars');
const { notifyConsecutiveAbsences } = require('../utils/parentNotifications');
const { createQrPayload, createQrToken, decryptQrToken, encryptQrToken, hashQrToken } = require('../config/qrCredentials');

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

function normalizeQrToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  const prefixes = ['academix:attendance:', 'edugnay:attendance:'];
  const prefix = prefixes.find(item => token.startsWith(item));
  const result = prefix ? token.slice(prefix.length) : token;
  if (!result || result.length > 500) throw createError('QR data is invalid.');
  return result;
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

async function getTeachingSection(database, teacher, sectionId, subjectId) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.name,
      DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
      DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS academicYearEndDate
    FROM sections INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
    WHERE sections.id = ? AND sections.school_id = ? AND sections.status = 'active'
      AND academic_years.status = 'active'
      AND EXISTS (
        SELECT 1 FROM section_teachers
        INNER JOIN subjects ON subjects.id = section_teachers.subject_id
        WHERE section_teachers.section_id = sections.id
          AND section_teachers.teacher_user_id = ?
          AND section_teachers.subject_id = ?
          AND subjects.school_id = sections.school_id AND subjects.is_active = TRUE
      )
    LIMIT 1`,
    [sectionId, teacher.schoolId, teacher.id, subjectId]
  );
  return sections[0] || null;
}

function assertQrAttendanceDate(section, attendanceDate) {
  if (attendanceDate < section.academicYearStartDate || attendanceDate > section.academicYearEndDate) {
    throw createError('QR attendance must be recorded within the section academic year.');
  }
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

async function getActiveStudentIds(database, schoolId, sectionId) {
  const [students] = await database.execute(
    `SELECT student_user_id AS studentId
    FROM section_students
    WHERE school_id = ? AND section_id = ? AND withdrawn_at IS NULL
    ORDER BY student_user_id`,
    [schoolId, sectionId]
  );
  return students.map(student => student.studentId);
}

async function getQrAttendanceData(database, section, subjectId, attendanceDate) {
  const [sessions] = await database.execute(
    `SELECT
      id,
      status,
      created_by_user_id AS createdByUserId,
      confirmed_by_user_id AS confirmedByUserId,
      confirmed_at AS confirmedAt
    FROM attendance_sessions
    WHERE school_id = ? AND section_id = ? AND subject_id = ? AND attendance_date = ? AND method = 'qr'
    LIMIT 1`,
    [section.schoolId, section.id, subjectId, attendanceDate]
  );
  const session = sessions[0] || null;
  const [students] = await database.execute(
    `SELECT
      students.id AS studentId,
      students.display_name AS displayName,
      students.initials,
      students.avatar_filename AS avatarFilename, students.avatar_version AS avatarVersion,
      student_profiles.lrn,
      attendance_records.attendance_status AS attendanceStatus,
      attendance_records.remarks,
      EXISTS (
        SELECT 1
        FROM qr_scan_events
        WHERE qr_scan_events.school_id = section_students.school_id
          AND qr_scan_events.attendance_session_id = ?
          AND qr_scan_events.scanned_student_user_id = students.id
          AND qr_scan_events.scan_result = 'accepted'
      ) AS isScanned
    FROM section_students
    INNER JOIN users AS students ON students.id = section_students.student_user_id
      AND students.school_id = section_students.school_id
    INNER JOIN student_profiles ON student_profiles.user_id = students.id
    LEFT JOIN attendance_records
      ON attendance_records.attendance_session_id = ?
      AND attendance_records.school_id = section_students.school_id
      AND attendance_records.student_user_id = students.id
    WHERE section_students.school_id = ? AND section_students.section_id = ? AND section_students.withdrawn_at IS NULL
    ORDER BY students.last_name, students.first_name`,
    [session?.id || 0, session?.id || 0, section.schoolId, section.id]
  );

  const roster = students.map(student => ({
    id: student.studentId,
    displayName: student.displayName,
    initials: student.initials,
    ...avatarFields({ ...student, id: student.studentId }),
    lrn: student.lrn,
    isScanned: Boolean(student.isScanned),
    attendanceStatus: student.attendanceStatus,
    remarks: student.remarks
  }));
  return {
    section: { id: section.id, schoolId: section.schoolId, name: section.name },
    subjectId,
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
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const database = getDatabase();
    const section = await getTeachingSection(database, req.user, sectionId, subjectId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(database, section.schoolId);
    const attendanceDate = getCurrentDate();
    assertQrAttendanceDate(section, attendanceDate);
    res.status(200).json(await getQrAttendanceData(database, section, subjectId, attendanceDate));
  } catch (error) {
    next(error);
  }
}

async function startQrAttendance(req, res, next) {
  let connection;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const attendanceDate = getCurrentDate();
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();

    const section = await getTeachingSection(connection, req.user, sectionId, subjectId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(connection, section.schoolId);
    assertQrAttendanceDate(section, attendanceDate);

    const [sessions] = await connection.execute(
      `SELECT id, method, status
      FROM attendance_sessions
      WHERE school_id = ? AND section_id = ? AND subject_id = ? AND attendance_date = ?
      FOR UPDATE`,
      [section.schoolId, sectionId, subjectId, attendanceDate]
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
        ) VALUES (?, ?, ?, ?, 'qr', 'draft', ?)`,
        [section.schoolId, sectionId, subjectId, attendanceDate, req.user.id]
      );
    }

    await connection.commit();
    res.status(200).json(await getQrAttendanceData(database, section, subjectId, attendanceDate));
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('A QR session already exists for this subject today. Reload attendance.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

async function getActiveQrSession(database, teacher, sessionId, lockSession = false) {
  const [sessions] = await database.execute(
    `SELECT
      attendance_sessions.id,
      attendance_sessions.school_id AS schoolId,
      attendance_sessions.section_id AS sectionId,
      attendance_sessions.subject_id AS subjectId,
      sections.name AS sectionName
    FROM attendance_sessions
    INNER JOIN sections ON sections.id = attendance_sessions.section_id
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
    WHERE attendance_sessions.id = ?
      AND attendance_sessions.method = 'qr'
      AND attendance_sessions.status = 'draft'
      AND attendance_sessions.attendance_date = ?
      AND sections.school_id = ?
      AND sections.status = 'active'
      AND academic_years.status = 'active'
      AND EXISTS (
        SELECT 1 FROM section_teachers
        INNER JOIN subjects ON subjects.id = section_teachers.subject_id
        WHERE section_teachers.section_id = sections.id
          AND section_teachers.subject_id = attendance_sessions.subject_id
          AND section_teachers.teacher_user_id = ?
          AND subjects.school_id = sections.school_id AND subjects.is_active = TRUE
      )
      AND attendance_sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date
    LIMIT 1${lockSession ? ' FOR UPDATE' : ''}`,
    [sessionId, getCurrentDate(), teacher.schoolId, teacher.id]
  );
  return sessions[0] || null;
}

async function scanQrAttendance(req, res, next) {
  let connection;
  try {
    const sessionId = parseId(req.params.sessionId, 'attendance session ID');
    const qrToken = normalizeQrToken(req.body.qrToken);

    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();
    const session = await getActiveQrSession(connection, req.user, sessionId, true);
    if (!session) throw createError('QR attendance session not found.', 404);
    await assertAttendanceFeatureEnabled(connection, session.schoolId);

    const [credentials] = await connection.execute(
      `SELECT
        student_qr_credentials.id,
        student_qr_credentials.student_user_id AS studentId,
        student_qr_credentials.credential_status AS credentialStatus,
        users.school_id AS schoolId,
        users.display_name AS displayName,
        users.initials, users.avatar_filename AS avatarFilename, users.avatar_version AS avatarVersion
      FROM student_qr_credentials
      INNER JOIN users ON users.id = student_qr_credentials.student_user_id
        AND users.school_id = student_qr_credentials.school_id
      WHERE student_qr_credentials.token_hash = ?
      LIMIT 1`,
      [hashQrToken(qrToken)]
    );
    const credential = credentials[0];
    if (!credential || credential.credentialStatus !== 'active' || credential.schoolId !== session.schoolId) {
      const matchingCredential = credential?.schoolId === session.schoolId ? credential : null;
      await connection.execute(
        `INSERT INTO qr_scan_events (school_id, attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [session.schoolId, sessionId, matchingCredential?.id || null, matchingCredential?.studentId || null, req.user.id, matchingCredential ? 'revoked' : 'unknown']
      );
      await connection.commit();
      return res.status(422).json({ message: 'This attendance QR is unknown or no longer valid.' });
    }

    const [enrollments] = await connection.execute(
      `SELECT 1 FROM section_students
      WHERE school_id = ? AND section_id = ? AND student_user_id = ? AND withdrawn_at IS NULL
      LIMIT 1`,
      [session.schoolId, session.sectionId, credential.studentId]
    );
    if (!enrollments[0]) {
      await connection.execute(
        `INSERT INTO qr_scan_events (school_id, attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
        VALUES (?, ?, ?, ?, ?, 'not_enrolled')`,
        [session.schoolId, sessionId, credential.id, credential.studentId, req.user.id]
      );
      await connection.commit();
      return res.status(422).json({ message: 'This student is not enrolled in the selected section.' });
    }

    const [acceptedScans] = await connection.execute(
      `SELECT id FROM qr_scan_events
      WHERE school_id = ? AND attendance_session_id = ? AND scanned_student_user_id = ? AND scan_result = 'accepted'
      LIMIT 1 FOR UPDATE`,
      [session.schoolId, sessionId, credential.studentId]
    );
    const isDuplicate = Boolean(acceptedScans[0]);
    await connection.execute(
      `INSERT INTO qr_scan_events (school_id, attendance_session_id, student_qr_credential_id, scanned_student_user_id, scanned_by_user_id, scan_result)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [session.schoolId, sessionId, credential.id, credential.studentId, req.user.id, isDuplicate ? 'duplicate' : 'accepted']
    );
    await connection.commit();

    res.status(200).json({
      scanned: !isDuplicate,
      duplicate: isDuplicate,
      student: { id: credential.studentId, displayName: credential.displayName, initials: credential.initials,
        ...avatarFields({ ...credential, id: credential.studentId }) }
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
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

    const session = await getActiveQrSession(connection, req.user, sessionId, true);
    if (!session) throw createError('QR attendance session not found.', 404);
    await assertAttendanceFeatureEnabled(connection, session.schoolId);

    const studentIds = await getActiveStudentIds(connection, session.schoolId, session.sectionId);
    const submittedIds = records.map(record => record.studentId).sort((a, b) => a - b);
    if (studentIds.length !== submittedIds.length || studentIds.some((id, index) => id !== submittedIds[index])) {
      throw createError('Attendance must include every currently enrolled student.');
    }

    for (const record of records) {
      await connection.execute(
        `INSERT INTO attendance_records (
          school_id, attendance_session_id, student_user_id, attendance_status, remarks, marked_by_user_id, marked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          attendance_status = VALUES(attendance_status),
          remarks = VALUES(remarks),
          marked_by_user_id = VALUES(marked_by_user_id),
          marked_at = NOW()`,
        [session.schoolId, sessionId, record.studentId, record.status, record.remarks, req.user.id]
      );
    }
    await connection.execute(
      `UPDATE attendance_sessions
      SET status = 'confirmed', confirmed_by_user_id = ?, confirmed_at = NOW()
      WHERE id = ?`,
      [req.user.id, sessionId]
    );
    for (const record of records) {
      if (record.status === 'absent') await notifyConsecutiveAbsences(connection, session.schoolId, session.sectionId, session.subjectId, record.studentId);
    }
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT('attendance_date', ?, 'subject_id', ?, 'method', 'qr', 'summary', ?))`,
      [session.schoolId, req.user.id, sessionId, getCurrentDate(), session.subjectId, `${session.sectionName} · Subject ${session.subjectId} · ${getCurrentDate()}`]
    );

    await connection.commit();
    res.status(200).json(await getQrAttendanceData(database, {
      id: session.sectionId,
      schoolId: session.schoolId,
      name: session.sectionName
    }, session.subjectId, getCurrentDate()));
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

async function findQrStudent(connection, user, studentId) {
  if (user.role === 'student' && user.id !== studentId) throw createError('You do not have access to this QR credential.', 403);
  if (!['student', 'school_admin'].includes(user.role)) throw createError('You do not have access to this QR credential.', 403);
  const [students] = await connection.execute("SELECT users.id, users.school_id AS schoolId, users.display_name AS displayName FROM users WHERE users.id = ? AND users.school_id = ? AND users.role = 'student' AND users.account_status = 'active' LIMIT 1", [studentId, user.schoolId]);
  if (!students.length) throw createError('Student was not found.', 404);
  return students[0];
}

async function getStudentQr(req, res, next) {
  try {
    const studentId = parseId(req.params.studentId, 'student ID');
    const database = getDatabase();
    await findQrStudent(database, req.user, studentId);
    const [credentials] = await database.execute('SELECT id, credential_status AS credentialStatus, token_ciphertext AS tokenCiphertext, issued_at AS issuedAt, revoked_at AS revokedAt FROM student_qr_credentials WHERE school_id = ? AND student_user_id = ? LIMIT 1', [req.user.schoolId, studentId]);
    const credential = credentials[0];
    const token = credential?.credentialStatus === 'active' ? decryptQrToken(credential.tokenCiphertext) : null;
    res.json({
      credential: credential && { id: credential.id, status: credential.credentialStatus, issuedAt: credential.issuedAt, revokedAt: credential.revokedAt },
      qrPayload: token ? createQrPayload(token) : null,
      requiresRegeneration: !token
    });
  } catch (error) { next(error); }
}

async function regenerateStudentQr(req, res, next) {
  let connection;
  try {
    const studentId = parseId(req.params.studentId, 'student ID');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const student = await findQrStudent(connection, req.user, studentId);
    const token = createQrToken();
    await connection.execute(`INSERT INTO student_qr_credentials (school_id, student_user_id, token_hash, token_ciphertext, credential_status, issued_at, revoked_at) VALUES (?, ?, ?, ?, 'active', NOW(), NULL) ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash), token_ciphertext=VALUES(token_ciphertext), credential_status='active', issued_at=NOW(), revoked_at=NULL`, [student.schoolId, studentId, hashQrToken(token), encryptQrToken(token)]);
    const [credentials] = await connection.execute('SELECT id, credential_status AS credentialStatus, issued_at AS issuedAt FROM student_qr_credentials WHERE school_id = ? AND student_user_id = ? LIMIT 1', [student.schoolId, studentId]);
    await connection.execute(`INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details) VALUES (?, ?, 'qr_credential_regenerated', 'student_qr_credential', ?, JSON_OBJECT('student_id', ?, 'summary', ?))`, [student.schoolId, req.user.id, credentials[0].id, studentId, student.displayName]);
    await connection.commit();
    res.json({ credential: { id: credentials[0].id, status: credentials[0].credentialStatus, issuedAt: credentials[0].issuedAt }, qrPayload: createQrPayload(token), requiresRegeneration: false });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

module.exports = {
  confirmQrAttendance,
  getCurrentQrAttendance,
  getStudentQr,
  regenerateStudentQr,
  scanQrAttendance,
  startQrAttendance
};
