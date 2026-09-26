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

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError('Attendance date must use YYYY-MM-DD.');
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createError('Attendance date is invalid.');
  }
  return value;
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
    `SELECT
      sections.id,
      sections.school_id AS schoolId,
      sections.name,
      DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
      DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS academicYearEndDate
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
    WHERE sections.id = ? AND sections.adviser_user_id = ? AND sections.status = 'active'
    LIMIT 1`,
    [sectionId, teacherId]
  );
  return sections[0] || null;
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

async function assertAttendanceCanBeEdited(database, section, attendanceDate) {
  if (attendanceDate < section.academicYearStartDate || attendanceDate > section.academicYearEndDate) {
    throw createError('Attendance date must be within the section academic year.');
  }

  const currentDate = getCurrentDate();
  if (attendanceDate > currentDate) throw createError('Attendance cannot be recorded for a future date.');
  if (attendanceDate >= currentDate) return;

  const [settings] = await database.execute(
    'SELECT allow_edit_past_attendance AS allowEditPastAttendance FROM school_attendance_settings WHERE school_id = ? LIMIT 1',
    [section.schoolId]
  );
  if (!settings[0]?.allowEditPastAttendance) {
    throw createError('Past attendance is locked for this school.', 403);
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

async function getAttendanceData(database, section, attendanceDate) {
  const [sessions] = await database.execute(
    `SELECT
      id,
      attendance_date AS attendanceDate,
      method,
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
      attendance_records.remarks
    FROM section_students
    INNER JOIN users AS students ON students.id = section_students.student_user_id
    INNER JOIN student_profiles ON student_profiles.user_id = students.id
    LEFT JOIN attendance_records
      ON attendance_records.student_user_id = students.id
      AND attendance_records.attendance_session_id = ?
    WHERE section_students.section_id = ? AND section_students.withdrawn_at IS NULL
    ORDER BY students.last_name, students.first_name`,
    [session?.id || 0, section.id]
  );

  return {
    section: { id: section.id, schoolId: section.schoolId, name: section.name },
    attendanceDate,
    session: session && {
      id: session.id,
      method: session.method,
      status: session.status,
      createdByUserId: session.createdByUserId,
      confirmedByUserId: session.confirmedByUserId,
      confirmedAt: session.confirmedAt
    },
    students: students.map(student => ({
      id: student.studentId,
      displayName: student.displayName,
      initials: student.initials,
      lrn: student.lrn,
      attendanceStatus: student.attendanceStatus,
      remarks: student.remarks
    }))
  };
}

async function getSectionAttendance(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const attendanceDate = normalizeDate(req.query.date);
    const database = getDatabase();
    const section = await getAdvisorySection(database, req.user.id, sectionId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(database, section.schoolId);

    res.status(200).json(await getAttendanceData(database, section, attendanceDate));
  } catch (error) {
    next(error);
  }
}

async function saveSectionAttendance(req, res, next) {
  let connection;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const attendanceDate = normalizeDate(req.body.attendanceDate);
    const records = normalizeRecords(req.body.records);
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();

    const section = await getAdvisorySection(connection, req.user.id, sectionId);
    if (!section) throw createError('Section not found.', 404);
    await assertAttendanceFeatureEnabled(connection, section.schoolId);
    await assertAttendanceCanBeEdited(connection, section, attendanceDate);

    const studentIds = await getActiveStudentIds(connection, sectionId);
    const submittedIds = records.map(record => record.studentId).sort((a, b) => a - b);
    if (studentIds.length !== submittedIds.length || studentIds.some((id, index) => id !== submittedIds[index])) {
      throw createError('Attendance must include every currently enrolled student.');
    }

    const [sessions] = await connection.execute(
      `SELECT id
      FROM attendance_sessions
      WHERE section_id = ? AND subject_id IS NULL AND attendance_date = ?
      FOR UPDATE`,
      [sectionId, attendanceDate]
    );
    let sessionId = sessions[0]?.id;

    if (!sessionId) {
      const [result] = await connection.execute(
        `INSERT INTO attendance_sessions (
          school_id, section_id, subject_id, attendance_date, method, status,
          created_by_user_id, confirmed_by_user_id, confirmed_at
        ) VALUES (?, ?, NULL, ?, 'manual', 'confirmed', ?, ?, NOW())`,
        [section.schoolId, sectionId, attendanceDate, req.user.id, req.user.id]
      );
      sessionId = result.insertId;
    } else {
      await connection.execute(
        `UPDATE attendance_sessions
        SET status = 'confirmed', confirmed_by_user_id = ?, confirmed_at = NOW()
        WHERE id = ?`,
        [req.user.id, sessionId]
      );
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
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT('attendance_date', ?, 'method', 'manual'))`,
      [section.schoolId, req.user.id, sessionId, attendanceDate]
    );

    await connection.commit();
    const data = await getAttendanceData(database, section, attendanceDate);
    res.status(200).json(data);
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

module.exports = { getSectionAttendance, saveSectionAttendance };
