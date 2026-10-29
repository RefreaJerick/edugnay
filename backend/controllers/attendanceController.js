const { getDatabase } = require('../config/database');
const { avatarFields } = require('../config/avatars');
const { notifyConsecutiveAbsences } = require('../utils/parentNotifications');
const { getStudentFlags } = require('../utils/studentFlags');
const { assertElectiveTeacher, getElectiveRoster } = require('../utils/shsTeachingAccess');

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

function attendanceOutcomeCounts(records) {
  return Object.fromEntries(['present', 'absent', 'late', 'excused'].map(status => [
    `${status}Count`, records.filter(record => record.status === status).length
  ]));
}

async function getTeachingSection(database, teacher, sectionId, subjectId) {
  const [sections] = await database.execute(
    `SELECT
      sections.id,
      sections.school_id AS schoolId,
      sections.name,
      DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
      DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS academicYearEndDate
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
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

function assertAttendanceDateInAcademicYear(section, attendanceDate) {
  if (attendanceDate < section.academicYearStartDate || attendanceDate > section.academicYearEndDate) {
    throw createError('Attendance date must be within the section academic year.');
  }
}

async function getAttendanceEditPermission(database, section, attendanceDate) {
  assertAttendanceDateInAcademicYear(section, attendanceDate);

  const currentDate = getCurrentDate();
  if (attendanceDate > currentDate) throw createError('Attendance cannot be recorded for a future date.');
  if (attendanceDate === currentDate) return true;

  const [settings] = await database.execute(
    'SELECT allow_edit_past_attendance AS allowEditPastAttendance FROM school_attendance_settings WHERE school_id = ? LIMIT 1',
    [section.schoolId]
  );
  return Boolean(settings[0]?.allowEditPastAttendance);
}

async function assertAttendanceCanBeEdited(database, section, attendanceDate) {
  if (!await getAttendanceEditPermission(database, section, attendanceDate)) {
    throw createError('Past attendance is locked for this school.', 403);
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

async function getAttendanceData(database, section, subjectId, attendanceDate) {
  const currentDate = getCurrentDate();
  const canEdit = await getAttendanceEditPermission(database, section, attendanceDate);
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
    WHERE school_id = ? AND section_id = ? AND subject_id = ? AND attendance_date = ?
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
      attendance_records.remarks
    FROM section_students
    INNER JOIN users AS students ON students.id = section_students.student_user_id
      AND students.school_id = section_students.school_id
    INNER JOIN student_profiles ON student_profiles.user_id = students.id
    LEFT JOIN attendance_records
      ON attendance_records.student_user_id = students.id
      AND attendance_records.attendance_session_id = ?
      AND attendance_records.school_id = section_students.school_id
    WHERE section_students.school_id = ? AND section_students.section_id = ? AND section_students.withdrawn_at IS NULL
    ORDER BY students.last_name, students.first_name`,
    [session?.id || 0, section.schoolId, section.id]
  );

  return {
    section: { id: section.id, schoolId: section.schoolId, name: section.name },
    subjectId,
    attendanceDate,
    currentDate,
    canEdit,
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
      ...avatarFields({ ...student, id: student.studentId }),
      lrn: student.lrn,
      attendanceStatus: student.attendanceStatus,
      remarks: student.remarks
    }))
  };
}

async function getSectionAttendance(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const attendanceDate = req.query.date ? normalizeDate(req.query.date) : getCurrentDate();
    const database = getDatabase();
    const section = await getTeachingSection(database, req.user, sectionId, subjectId);
    if (!section) throw createError('Section not found.', 404);

    res.status(200).json(await getAttendanceData(database, section, subjectId, attendanceDate));
  } catch (error) {
    next(error);
  }
}

async function getSectionAttendanceHistory(req, res, next) {
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const database = getDatabase();
    const section = await getTeachingSection(database, req.user, sectionId, subjectId);
    if (!section) throw createError('Section not found.', 404);

    const [rows] = await database.execute(
      `SELECT
        attendance_sessions.id AS sessionId,
        DATE_FORMAT(attendance_sessions.attendance_date, '%Y-%m-%d') AS attendanceDate,
        attendance_sessions.method,
        attendance_sessions.confirmed_by_user_id AS confirmedByUserId,
        attendance_sessions.confirmed_at AS confirmedAt,
        attendance_records.student_user_id AS studentId,
        students.display_name AS displayName,
        students.initials,
        students.avatar_filename AS avatarFilename, students.avatar_version AS avatarVersion,
        attendance_records.attendance_status AS attendanceStatus,
        attendance_records.remarks
      FROM attendance_sessions
      LEFT JOIN attendance_records ON attendance_records.attendance_session_id = attendance_sessions.id
      LEFT JOIN users AS students ON students.id = attendance_records.student_user_id
      WHERE attendance_sessions.section_id = ?
        AND attendance_sessions.subject_id = ?
        AND attendance_sessions.status = 'confirmed'
        AND attendance_sessions.attendance_date BETWEEN ? AND ?
        AND attendance_sessions.attendance_date <= ?
      ORDER BY attendance_sessions.attendance_date DESC, students.last_name, students.first_name`,
      [section.id, subjectId, section.academicYearStartDate, section.academicYearEndDate, getCurrentDate()]
    );

    const sessionsByDate = new Map();
    rows.forEach(row => {
      if (!sessionsByDate.has(row.attendanceDate)) {
        sessionsByDate.set(row.attendanceDate, {
          attendanceDate: row.attendanceDate,
          session: {
            id: String(row.sessionId),
            method: row.method,
            status: 'confirmed',
            confirmedByUserId: row.confirmedByUserId,
            confirmedAt: row.confirmedAt
          },
          students: []
        });
      }

      if (row.studentId) {
        sessionsByDate.get(row.attendanceDate).students.push({
          id: String(row.studentId),
          displayName: row.displayName,
          initials: row.initials,
          ...avatarFields({ ...row, id: row.studentId }),
          attendanceStatus: row.attendanceStatus,
          remarks: row.remarks
        });
      }
    });

    res.status(200).json({
      section: { id: section.id, schoolId: section.schoolId, name: section.name },
      subjectId,
      sessions: Array.from(sessionsByDate.values())
    });
  } catch (error) {
    next(error);
  }
}

async function saveSectionAttendance(req, res, next) {
  let connection;
  try {
    const sectionId = parseId(req.params.sectionId, 'section ID');
    const subjectId = parseId(req.params.subjectId, 'subject ID');
    const attendanceDate = normalizeDate(req.body.attendanceDate);
    const records = normalizeRecords(req.body.records);
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();

    const section = await getTeachingSection(connection, req.user, sectionId, subjectId);
    if (!section) throw createError('Section not found.', 404);
    const [[subject]] = await connection.execute('SELECT name AS subjectName FROM subjects WHERE id = ? AND school_id = ? LIMIT 1',
      [subjectId, section.schoolId]);
    await assertAttendanceCanBeEdited(connection, section, attendanceDate);

    const studentIds = await getActiveStudentIds(connection, section.schoolId, sectionId);
    const submittedIds = records.map(record => record.studentId).sort((a, b) => a - b);
    if (studentIds.length !== submittedIds.length || studentIds.some((id, index) => id !== submittedIds[index])) {
      throw createError('Attendance must include every currently enrolled student.');
    }

    const [sessions] = await connection.execute(
      `SELECT id, method, status
      FROM attendance_sessions
      WHERE school_id = ? AND section_id = ? AND subject_id = ? AND attendance_date = ?
      FOR UPDATE`,
      [section.schoolId, sectionId, subjectId, attendanceDate]
    );
    const existingSession = sessions[0];
    if (existingSession?.method === 'qr' && existingSession.status === 'draft') {
      throw createError('Review and confirm the QR attendance session before saving manual attendance.', 409);
    }
    let sessionId = existingSession?.id;

    if (!sessionId) {
      const [result] = await connection.execute(
        `INSERT INTO attendance_sessions (
          school_id, section_id, subject_id, attendance_date, method, status,
          created_by_user_id, confirmed_by_user_id, confirmed_at
        ) VALUES (?, ?, ?, ?, 'manual', 'confirmed', ?, ?, NOW())`,
        [section.schoolId, sectionId, subjectId, attendanceDate, req.user.id, req.user.id]
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
          school_id, attendance_session_id, student_user_id, attendance_status, remarks, marked_by_user_id, marked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          attendance_status = VALUES(attendance_status),
          remarks = VALUES(remarks),
          marked_by_user_id = VALUES(marked_by_user_id),
          marked_at = NOW()`,
        [section.schoolId, sessionId, record.studentId, record.status, record.remarks, req.user.id]
      );
    }

    for (const record of records) {
      if (record.status === 'absent') await notifyConsecutiveAbsences(connection, section.schoolId, sectionId, subjectId, record.studentId);
    }

    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT(
        'attendance_date', ?, 'attendanceDate', ?, 'sectionName', ?, 'subjectName', ?, 'method', 'manual',
        'recordCount', ?, 'presentCount', ?, 'absentCount', ?, 'lateCount', ?, 'excusedCount', ?, 'summary', ?))`,
      [section.schoolId, req.user.id, sessionId, attendanceDate, attendanceDate, section.name, subject?.subjectName || '',
        records.length, ...Object.values(attendanceOutcomeCounts(records)),
        [section.name, subject?.subjectName || `Subject ${subjectId}`, attendanceDate].join(' · ')]
    );

    await connection.commit();
    const data = await getAttendanceData(database, section, subjectId, attendanceDate);
    res.status(200).json(data);
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('Attendance was saved by another request. Reload this subject.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

async function getElectiveAttendance(req, res, next) {
  try {
    const classId = parseId(req.params.classId, 'elective class ID');
    const attendanceDate = req.query.date ? normalizeDate(req.query.date) : getCurrentDate();
    const database = getDatabase();
    const electiveClass = await assertElectiveTeacher(database, req.user, classId);
    const canEdit = await getAttendanceEditPermission(database, electiveClass, attendanceDate);
    const [sessions] = await database.execute(
      `SELECT id, method, status, created_by_user_id AS createdByUserId,
        confirmed_by_user_id AS confirmedByUserId, confirmed_at AS confirmedAt
       FROM attendance_sessions WHERE school_id = ? AND shs_elective_class_id = ? AND attendance_date = ? LIMIT 1`,
      [electiveClass.schoolId, classId, attendanceDate]);
    const session = sessions[0] || null;
    const members = await getElectiveRoster(database, electiveClass.schoolId, classId);
    const [records] = await database.execute(
      `SELECT attendance_records.student_user_id AS studentId,
        attendance_records.attendance_status AS attendanceStatus, attendance_records.remarks
       FROM attendance_records WHERE attendance_records.attendance_session_id = ? AND attendance_records.school_id = ?`,
      [session?.id || 0, electiveClass.schoolId]);
    const byStudent = new Map(records.map(record => [String(record.studentId), record]));
    res.json({ electiveClass, attendanceDate, currentDate: getCurrentDate(), canEdit,
      session: session && { id: session.id, method: session.method, status: session.status,
        createdByUserId: session.createdByUserId, confirmedByUserId: session.confirmedByUserId, confirmedAt: session.confirmedAt },
      students: members.map(student => ({ ...student, id: student.studentId,
        attendanceStatus: byStudent.get(String(student.studentId))?.attendanceStatus || null,
        remarks: byStudent.get(String(student.studentId))?.remarks || null })) });
  } catch (error) { next(error); }
}

async function getElectiveAttendanceHistory(req, res, next) {
  try {
    const classId = parseId(req.params.classId, 'elective class ID');
    const database = getDatabase();
    const item = await assertElectiveTeacher(database, req.user, classId);
    const [rows] = await database.execute(
      `SELECT s.id AS sessionId, DATE_FORMAT(s.attendance_date, '%Y-%m-%d') AS attendanceDate,
        s.method, s.confirmed_by_user_id AS confirmedByUserId, s.confirmed_at AS confirmedAt,
        ar.student_user_id AS studentId, u.display_name AS displayName, u.initials,
        u.avatar_filename AS avatarFilename, u.avatar_version AS avatarVersion,
        ar.attendance_status AS attendanceStatus, ar.remarks
       FROM attendance_sessions s LEFT JOIN attendance_records ar
         ON ar.attendance_session_id = s.id AND ar.school_id = s.school_id
       LEFT JOIN users u ON u.id = ar.student_user_id AND u.school_id = s.school_id
       WHERE s.school_id = ? AND s.shs_elective_class_id = ? AND s.status = 'confirmed'
         AND s.attendance_date BETWEEN ? AND ? AND s.attendance_date <= ?
       ORDER BY s.attendance_date DESC, u.last_name, u.first_name`,
      [item.schoolId, classId, item.yearStartDate, item.yearEndDate, getCurrentDate()]);
    const sessions = new Map();
    for (const row of rows) {
      if (!sessions.has(row.attendanceDate)) sessions.set(row.attendanceDate, { attendanceDate: row.attendanceDate,
        session: { id: String(row.sessionId), method: row.method, status: 'confirmed',
          confirmedByUserId: row.confirmedByUserId, confirmedAt: row.confirmedAt }, students: [] });
      if (row.studentId) sessions.get(row.attendanceDate).students.push({ id: String(row.studentId),
        displayName: row.displayName, initials: row.initials, ...avatarFields({ ...row, id: row.studentId }),
        attendanceStatus: row.attendanceStatus, remarks: row.remarks });
    }
    res.json({ electiveClass: item, sessions: [...sessions.values()] });
  } catch (error) { next(error); }
}

async function saveElectiveAttendance(req, res, next) {
  let connection;
  try {
    const classId = parseId(req.params.classId, 'elective class ID');
    const attendanceDate = normalizeDate(req.body.attendanceDate);
    const records = normalizeRecords(req.body.records);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const item = await assertElectiveTeacher(connection, req.user, classId, { write: true });
    await assertAttendanceCanBeEdited(connection, {
      ...item,
      academicYearStartDate: item.yearStartDate,
      academicYearEndDate: item.yearEndDate
    }, attendanceDate);
    const current = await getElectiveRoster(connection, item.schoolId, classId);
    const expected = current.map(student => Number(student.studentId)).sort((a, b) => a - b);
    const provided = records.map(record => record.studentId).sort((a, b) => a - b);
    if (expected.length !== provided.length || expected.some((studentId, index) => studentId !== provided[index])) {
      throw createError('Attendance must include every currently enrolled elective student.');
    }
    const [sessions] = await connection.execute(
      `SELECT id, method, status FROM attendance_sessions
       WHERE school_id = ? AND shs_elective_class_id = ? AND attendance_date = ? FOR UPDATE`,
      [item.schoolId, classId, attendanceDate]);
    if (sessions[0]?.method === 'qr' && sessions[0].status === 'draft') {
      throw createError('Review and confirm the QR attendance session before saving manual attendance.', 409);
    }
    let sessionId = sessions[0]?.id;
    if (!sessionId) {
      const [result] = await connection.execute(
        `INSERT INTO attendance_sessions (school_id, shs_elective_class_id, attendance_date, method,
          status, created_by_user_id, confirmed_by_user_id, confirmed_at)
         VALUES (?, ?, ?, 'manual', 'confirmed', ?, ?, NOW())`,
        [item.schoolId, classId, attendanceDate, req.user.id, req.user.id]);
      sessionId = result.insertId;
    } else {
      await connection.execute(`UPDATE attendance_sessions SET status = 'confirmed',
        confirmed_by_user_id = ?, confirmed_at = NOW() WHERE id = ? AND school_id = ?`,
      [req.user.id, sessionId, item.schoolId]);
    }
    for (const record of records) await connection.execute(
      `INSERT INTO attendance_records (school_id, attendance_session_id, student_user_id,
        attendance_status, remarks, marked_by_user_id, marked_at) VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE attendance_status = VALUES(attendance_status), remarks = VALUES(remarks),
         marked_by_user_id = VALUES(marked_by_user_id), marked_at = NOW()`,
      [item.schoolId, sessionId, record.studentId, record.status, record.remarks, req.user.id]);
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
       VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT('attendance_date', ?,
         'attendanceDate', ?, 'className', ?, 'subjectName', ?, 'elective_class_id', ?, 'method', 'manual',
         'recordCount', ?, 'presentCount', ?, 'absentCount', ?, 'lateCount', ?, 'excusedCount', ?, 'summary', ?))`,
      [item.schoolId, req.user.id, sessionId, attendanceDate, attendanceDate, item.className, item.subjectName, classId,
        records.length, ...Object.values(attendanceOutcomeCounts(records)),
        [item.className, item.subjectName, attendanceDate].join(' · ')]);
    await connection.commit();
    const refreshed = await new Promise((resolve, reject) => getElectiveAttendance({
      params: req.params,
      query: { date: attendanceDate },
      user: req.user
    }, { json: resolve }, reject));
    res.json(refreshed);
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('Attendance was saved by another request. Reload this class.', 409);
    next(error);
  } finally { connection?.release(); }
}

async function getParentAttendance(req, res, next) {
  try {
    const database = getDatabase();
    const [children] = await database.execute(
      `SELECT students.id AS studentId, students.display_name AS displayName, students.initials,
        students.avatar_filename AS avatarFilename, students.avatar_version AS avatarVersion,
        school_grade_levels.display_name AS gradeLevel, sections.name AS sectionName
      FROM student_parent_links
      INNER JOIN users AS students ON students.id = student_parent_links.student_user_id
        AND students.school_id = student_parent_links.school_id
      LEFT JOIN section_students ON section_students.student_user_id = students.id
        AND section_students.school_id = students.school_id
        AND section_students.withdrawn_at IS NULL
        AND EXISTS (
          SELECT 1 FROM sections AS current_section
          INNER JOIN academic_years AS current_year ON current_year.id = current_section.academic_year_id
          WHERE current_section.id = section_students.section_id
            AND current_section.status = 'active' AND current_year.status = 'active'
        )
      LEFT JOIN sections ON sections.id = section_students.section_id
        AND sections.school_id = section_students.school_id AND sections.status = 'active'
      LEFT JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_id = sections.school_id
      WHERE student_parent_links.school_id = ? AND student_parent_links.parent_user_id = ?
      ORDER BY students.last_name, students.first_name`,
      [req.user.schoolId, req.user.id]
    );
    const [records] = await database.execute(
      `SELECT attendance_records.student_user_id AS studentId,
        DATE_FORMAT(attendance_sessions.attendance_date, '%Y-%m-%d') AS date,
        attendance_sessions.section_id AS sectionId,
        attendance_sessions.subject_id AS subjectId,
        subjects.name AS subjectName,
        attendance_records.attendance_status AS status,
        attendance_records.remarks AS remark
      FROM attendance_records
      INNER JOIN attendance_sessions ON attendance_sessions.id = attendance_records.attendance_session_id
        AND attendance_sessions.school_id = attendance_records.school_id
      INNER JOIN subjects ON subjects.id = attendance_sessions.subject_id
        AND subjects.school_id = attendance_sessions.school_id
      INNER JOIN sections ON sections.id = attendance_sessions.section_id
        AND sections.school_id = attendance_sessions.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      WHERE attendance_sessions.school_id = ?
        AND attendance_sessions.status = 'confirmed'
        AND attendance_sessions.attendance_date <= ?
        AND attendance_sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date
        AND academic_years.status = 'active'
        AND EXISTS (
          SELECT 1 FROM student_parent_links
          WHERE student_parent_links.school_id = attendance_records.school_id
            AND student_parent_links.student_user_id = attendance_records.student_user_id
            AND student_parent_links.parent_user_id = ?
        )
      ORDER BY attendance_sessions.attendance_date DESC, subjects.name`,
      [req.user.schoolId, getCurrentDate(), req.user.id]
    );
    let electiveRecords = [];
    if (process.env.SHS_SELECTION_ENABLED === 'true') {
      [electiveRecords] = await database.execute(
        `SELECT ar.student_user_id AS studentId,
          DATE_FORMAT(s.attendance_date, '%Y-%m-%d') AS date,
          ec.id AS electiveClassId, ec.class_name AS className, o.subject_name AS subjectName,
          ar.attendance_status AS status, ar.remarks AS remark
         FROM attendance_records ar JOIN attendance_sessions s ON s.id = ar.attendance_session_id
           AND s.school_id = ar.school_id
         JOIN shs_elective_classes ec ON ec.id = s.shs_elective_class_id AND ec.school_id = s.school_id
         JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
         JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
         WHERE ar.school_id = ? AND s.status = 'confirmed' AND s.attendance_date <= ? AND y.status = 'active'
           AND EXISTS (SELECT 1 FROM shs_elective_class_students em WHERE em.school_id = ar.school_id
             AND em.elective_class_id = ec.id AND em.student_user_id = ar.student_user_id
             AND (em.withdrawn_at IS NULL OR s.attendance_date <= DATE(em.withdrawn_at)))
           AND EXISTS (SELECT 1 FROM student_parent_links pl WHERE pl.school_id = ar.school_id
             AND pl.student_user_id = ar.student_user_id AND pl.parent_user_id = ?)
         ORDER BY s.attendance_date DESC, o.subject_name`,
        [req.user.schoolId, getCurrentDate(), req.user.id]);
    }
    res.json({ currentDate: getCurrentDate(), children: children.map(({ avatarFilename, avatarVersion, ...child }) => ({
      ...child, ...avatarFields({ id: child.studentId, avatarFilename, avatarVersion }), studentId: String(child.studentId)
    })), records: [...records.map(record => ({ ...record, studentId: String(record.studentId),
      sectionId: String(record.sectionId), subjectId: String(record.subjectId) })), ...electiveRecords.map(record => ({
      ...record, studentId: String(record.studentId), sectionId: null, subjectId: null,
      electiveClassId: String(record.electiveClassId), scopeType: 'elective'
    }))] });
  } catch (error) { next(error); }
}

async function getStudentAttendance(req, res, next) {
  try {
    const database = getDatabase();
    const currentDate = getCurrentDate();
    const [records] = await database.execute(
      `SELECT attendance_records.student_user_id AS studentId,
        DATE_FORMAT(attendance_sessions.attendance_date, '%Y-%m-%d') AS date,
        attendance_sessions.section_id AS sectionId,
        attendance_sessions.subject_id AS subjectId,
        subjects.name AS subjectName,
        attendance_records.attendance_status AS status,
        attendance_records.remarks AS remark
      FROM attendance_records
      INNER JOIN attendance_sessions ON attendance_sessions.id = attendance_records.attendance_session_id
        AND attendance_sessions.school_id = attendance_records.school_id
      INNER JOIN subjects ON subjects.id = attendance_sessions.subject_id
        AND subjects.school_id = attendance_sessions.school_id
      INNER JOIN sections ON sections.id = attendance_sessions.section_id
        AND sections.school_id = attendance_sessions.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      WHERE attendance_sessions.school_id = ?
        AND attendance_records.student_user_id = ?
        AND attendance_sessions.status = 'confirmed'
        AND attendance_sessions.attendance_date <= ?
        AND attendance_sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date
        AND academic_years.status = 'active'
      ORDER BY attendance_sessions.attendance_date DESC, subjects.name`,
      [req.user.schoolId, req.user.id, currentDate]
    );
    let electiveRecords = [];
    if (process.env.SHS_SELECTION_ENABLED === 'true') {
      [electiveRecords] = await database.execute(
        `SELECT ar.student_user_id AS studentId, DATE_FORMAT(s.attendance_date, '%Y-%m-%d') AS date,
          ec.id AS electiveClassId, ec.class_name AS className, o.subject_name AS subjectName,
          ar.attendance_status AS status, ar.remarks AS remark
         FROM attendance_records ar JOIN attendance_sessions s ON s.id = ar.attendance_session_id
           AND s.school_id = ar.school_id
         JOIN shs_elective_classes ec ON ec.id = s.shs_elective_class_id AND ec.school_id = s.school_id
         JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
         JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
         WHERE ar.school_id = ? AND ar.student_user_id = ? AND s.status = 'confirmed'
           AND s.attendance_date <= ? AND y.status = 'active'
           AND EXISTS (SELECT 1 FROM shs_elective_class_students em WHERE em.school_id = ar.school_id
             AND em.elective_class_id = ec.id AND em.student_user_id = ar.student_user_id
             AND (em.withdrawn_at IS NULL OR s.attendance_date <= DATE(em.withdrawn_at)))
         ORDER BY s.attendance_date DESC, o.subject_name`,
        [req.user.schoolId, req.user.id, currentDate]);
    }
    res.json({ currentDate, records: records.map(record => ({
      ...record,
      studentId: String(record.studentId),
      sectionId: String(record.sectionId),
      subjectId: String(record.subjectId)
    })).concat(electiveRecords.map(record => ({ ...record, studentId: String(record.studentId),
      sectionId: null, subjectId: null, electiveClassId: String(record.electiveClassId), scopeType: 'elective' }))) });
  } catch (error) { next(error); }
}

async function getSchoolAttendanceSummary(req, res, next) {
  try {
    const database = getDatabase();
    const yearId = req.query?.academicYearId === undefined ? null : parseId(req.query.academicYearId, 'academic year ID');
    if (yearId) {
      const [years] = await database.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1', [yearId, req.user.schoolId]);
      if (!years.length) throw createError('Academic year not found.', 404);
    }
    const yearFilter = yearId ? 'academic_years.id = ?' : "academic_years.status = 'active'";
    const [rows] = await database.execute(
      `SELECT sections.id AS sectionId, sections.name AS sectionName,
        school_grade_levels.display_name AS grade,
        attendance_records.student_user_id AS studentId,
        attendance_records.attendance_status AS status,
        COUNT(*) AS total
      FROM attendance_records
      INNER JOIN attendance_sessions ON attendance_sessions.id = attendance_records.attendance_session_id
        AND attendance_sessions.school_id = attendance_records.school_id
      INNER JOIN sections ON sections.id = attendance_sessions.section_id
        AND sections.school_id = attendance_sessions.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_id = sections.school_id
      WHERE attendance_sessions.school_id = ? AND ${yearFilter}
        AND attendance_sessions.subject_id IS NOT NULL
        AND attendance_sessions.status = 'confirmed'
        AND attendance_sessions.attendance_date <= ?
        AND attendance_sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date
      GROUP BY sections.id, sections.name, school_grade_levels.display_name,
        attendance_records.student_user_id, attendance_records.attendance_status`,
      yearId ? [req.user.schoolId, yearId, getCurrentDate()] : [req.user.schoolId, getCurrentDate()]
    );
    const sections = new Map();
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    const lateStudents = new Set();
    rows.forEach(row => {
      const count = Number(row.total);
      const section = sections.get(row.sectionId) || { grade: row.grade, section: row.sectionName, total: 0, attended: 0 };
      section.total += count;
      if (row.status === 'present' || row.status === 'late') section.attended += count;
      sections.set(row.sectionId, section);
      counts[row.status] = (counts[row.status] || 0) + count;
      if (row.status === 'late') lateStudents.add(row.studentId);
    });
    const grades = new Map();
    sections.forEach(section => {
      const group = grades.get(section.grade) || { grade: section.grade, rows: [] };
      group.rows.push({ section: section.section, rate: Math.round(section.attended / section.total * 100) });
      grades.set(section.grade, group);
    });
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const attendanceRate = total ? Math.round(((counts.present + counts.late) / total) * 100) : null;
    const colors = { present: 'var(--green)', late: 'var(--orange)', absent: 'var(--red)', excused: 'var(--blue-mid)' };
    const flags = await getStudentFlags(database, { schoolId: req.user.schoolId, yearId });
    res.set('Cache-Control', 'no-store');
    res.json({
      academicYearId: yearId ? String(yearId) : null,
      attendanceRate,
      attendanceRecordCount: total,
      attendanceByGrade: Array.from(grades.values()),
      attendanceBreakdown: total ? Object.entries(counts).map(([status, count]) => ({
        label: status[0].toUpperCase() + status.slice(1),
        value: Math.round(count / total * 100), color: colors[status]
      })) : [],
      flaggedStudents: flags.students,
      absenceTriggers: [
        { label: `Students with ${flags.maximum}+ dates with absences`,
          value: flags.students.filter(student => student.reasons.some(reason => reason.type === 'absence')).length, tone: 'red' },
        { label: 'Students with late subject records', value: lateStudents.size, tone: 'orange' }
      ]
    });
  } catch (error) { next(error); }
}

async function getTeacherStudentFlags(req, res, next) {
  try {
    const flags = await getStudentFlags(getDatabase(), {
      schoolId: req.user.schoolId, teacherId: req.user.id
    });
    res.set('Cache-Control', 'no-store');
    res.json({ flaggedStudents: flags.students });
  } catch (error) { next(error); }
}

module.exports = { getParentAttendance, getStudentAttendance, getSchoolAttendanceSummary, getTeacherStudentFlags, getSectionAttendance, getSectionAttendanceHistory, saveSectionAttendance, getElectiveAttendance, getElectiveAttendanceHistory, saveElectiveAttendance };
