const { getDatabase } = require('../config/database');
const { notifyConsecutiveAbsences } = require('../utils/parentNotifications');

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
    WHERE section_id = ? AND subject_id = ? AND attendance_date = ?
    LIMIT 1`,
    [section.id, subjectId, attendanceDate]
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
    await assertAttendanceFeatureEnabled(database, section.schoolId);

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
    await assertAttendanceFeatureEnabled(database, section.schoolId);

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
    await assertAttendanceFeatureEnabled(connection, section.schoolId);
    await assertAttendanceCanBeEdited(connection, section, attendanceDate);

    const studentIds = await getActiveStudentIds(connection, sectionId);
    const submittedIds = records.map(record => record.studentId).sort((a, b) => a - b);
    if (studentIds.length !== submittedIds.length || studentIds.some((id, index) => id !== submittedIds[index])) {
      throw createError('Attendance must include every currently enrolled student.');
    }

    const [sessions] = await connection.execute(
      `SELECT id, method, status
      FROM attendance_sessions
      WHERE section_id = ? AND subject_id = ? AND attendance_date = ?
      FOR UPDATE`,
      [sectionId, subjectId, attendanceDate]
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

    for (const record of records) {
      if (record.status === 'absent') await notifyConsecutiveAbsences(connection, section.schoolId, sectionId, subjectId, record.studentId);
    }

    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'attendance_confirmed', 'attendance_session', ?, JSON_OBJECT('attendance_date', ?, 'subject_id', ?, 'method', 'manual', 'summary', ?))`,
      [section.schoolId, req.user.id, sessionId, attendanceDate, subjectId, `${section.name} · Subject ${subjectId} · ${attendanceDate}`]
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

async function getParentAttendance(req, res, next) {
  try {
    const database = getDatabase();
    await assertAttendanceFeatureEnabled(database, req.user.schoolId);
    const [children] = await database.execute(
      `SELECT students.id AS studentId, students.display_name AS displayName, students.initials,
        school_grade_levels.display_name AS gradeLevel, sections.name AS sectionName
      FROM student_parent_links
      INNER JOIN users AS students ON students.id = student_parent_links.student_user_id
      LEFT JOIN section_students ON section_students.student_user_id = students.id
        AND section_students.withdrawn_at IS NULL
        AND EXISTS (
          SELECT 1 FROM sections AS current_section
          INNER JOIN academic_years AS current_year ON current_year.id = current_section.academic_year_id
          WHERE current_section.id = section_students.section_id
            AND current_section.status = 'active' AND current_year.status = 'active'
        )
      LEFT JOIN sections ON sections.id = section_students.section_id AND sections.status = 'active'
      LEFT JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      WHERE student_parent_links.parent_user_id = ? AND students.school_id = ?
      ORDER BY students.last_name, students.first_name`,
      [req.user.id, req.user.schoolId]
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
      INNER JOIN subjects ON subjects.id = attendance_sessions.subject_id
      INNER JOIN sections ON sections.id = attendance_sessions.section_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      WHERE attendance_sessions.school_id = ?
        AND attendance_sessions.status = 'confirmed'
        AND attendance_sessions.attendance_date <= ?
        AND attendance_sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date
        AND academic_years.status = 'active'
        AND EXISTS (
          SELECT 1 FROM student_parent_links
          WHERE student_parent_links.student_user_id = attendance_records.student_user_id
            AND student_parent_links.parent_user_id = ?
        )
      ORDER BY attendance_sessions.attendance_date DESC, subjects.name`,
      [req.user.schoolId, getCurrentDate(), req.user.id]
    );
    res.json({ currentDate: getCurrentDate(), children: children.map(child => ({ ...child, studentId: String(child.studentId) })), records: records.map(record => ({ ...record, studentId: String(record.studentId), sectionId: String(record.sectionId), subjectId: String(record.subjectId) })) });
  } catch (error) { next(error); }
}

async function getSchoolAttendanceSummary(req, res, next) {
  try {
    const database = getDatabase();
    await assertAttendanceFeatureEnabled(database, req.user.schoolId);
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
      INNER JOIN sections ON sections.id = attendance_sessions.section_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
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
    const absences = new Map();
    const lateStudents = new Set();
    rows.forEach(row => {
      const count = Number(row.total);
      const section = sections.get(row.sectionId) || { grade: row.grade, section: row.sectionName, total: 0, attended: 0 };
      section.total += count;
      if (row.status === 'present' || row.status === 'late') section.attended += count;
      sections.set(row.sectionId, section);
      counts[row.status] = (counts[row.status] || 0) + count;
      if (row.status === 'absent') absences.set(row.studentId, (absences.get(row.studentId) || 0) + count);
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
      absenceTriggers: [
        { label: 'Students with 3+ subject absences', value: Array.from(absences.values()).filter(count => count >= 3).length, tone: 'red' },
        { label: 'Students with late subject records', value: lateStudents.size, tone: 'orange' }
      ]
    });
  } catch (error) { next(error); }
}

module.exports = { getParentAttendance, getSchoolAttendanceSummary, getSectionAttendance, getSectionAttendanceHistory, saveSectionAttendance };
