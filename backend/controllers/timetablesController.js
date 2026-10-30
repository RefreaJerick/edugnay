const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function id(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}

function isoDate(value, label) {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail(`${label} must be a valid date.`);
  return date;
}

function clockTime(value, label) {
  const time = String(value || '');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(`${label} must be a valid time.`);
  return `${time}:00`;
}

function hasOccurrence(start, end, weekday) {
  const startDay = new Date(`${start}T00:00:00Z`);
  const endDay = new Date(`${end}T00:00:00Z`);
  const shift = (weekday - (startDay.getUTCDay() || 7) + 7) % 7;
  return startDay.getTime() + shift * 86400000 <= endDay.getTime();
}

function validateMeeting(values, year) {
  const weekday = Number(values.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) fail('Choose a weekday.');
  const startTime = clockTime(values.startTime, 'Start time');
  const endTime = clockTime(values.endTime, 'End time');
  if (startTime >= endTime) fail('End time must be after start time. Overnight meetings are not supported.');
  const startDate = isoDate(values.startDate, 'Start date');
  const endDate = isoDate(values.endDate, 'End date');
  if (startDate > endDate || startDate < year.startDate || endDate > year.endDate) fail('Meeting dates must be ordered and within the school year.');
  if (!hasOccurrence(startDate, endDate, weekday)) fail('The selected weekday does not occur within the meeting dates.');
  const room = String(values.room || '').trim().replace(/\s+/g, ' ');
  if (room.length > 100) fail('Room name is too long.');
  return { weekday, startTime, endTime, startDate, endDate, room: room || null };
}

async function getAssignment(connection, schoolId, assignmentId) {
  const [rows] = await connection.execute(
    `SELECT a.id, a.section_id AS sectionId, a.teacher_user_id AS teacherId,
      s.academic_year_id AS academicYearId, s.status AS sectionStatus,
      s.name AS sectionName, g.display_name AS gradeName, g.grade_code AS gradeCode,
      sub.name AS subjectName, teacher.display_name AS teacherName,
      y.label AS schoolYearLabel, y.status AS yearStatus, DATE_FORMAT(y.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(y.end_date, '%Y-%m-%d') AS endDate
    FROM section_teachers a
    JOIN sections s ON s.id = a.section_id AND s.school_id = a.school_id
    JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = s.school_id
    JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id AND sub.is_active = TRUE
    JOIN users teacher ON teacher.id = a.teacher_user_id AND teacher.school_id = a.school_id
    JOIN academic_years y ON y.id = s.academic_year_id AND y.school_id = a.school_id
    WHERE a.id = ? AND a.school_id = ? LIMIT 1`, [assignmentId, schoolId]
  );
  return rows[0];
}

async function getMeetingOwner(connection, schoolId, meetingId) {
  const [rows] = await connection.execute(
    `SELECT c.assignment_id AS assignmentId, c.shs_elective_class_id AS electiveClassId,
      m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
      TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
      DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room
     FROM timetable_meetings m
    JOIN scheduled_classes c ON c.id = m.scheduled_class_id AND c.school_id = m.school_id
    WHERE m.id = ? AND m.school_id = ? LIMIT 1`, [meetingId, schoolId]
  );
  return rows[0];
}

async function getElectiveClass(connection, schoolId, classId) {
  const [rows] = await connection.execute(
    `SELECT c.id, c.class_name AS className, c.teacher_user_id AS teacherId, c.is_active AS classActive,
      teacher.display_name AS teacherName, teacher.account_status AS teacherStatus,
      o.subject_name AS subjectName, o.track_code AS trackCode, g.grade_code AS gradeCode,
      o.academic_year_id AS academicYearId, o.is_active AS offeringActive,
      y.label AS schoolYearLabel,
      y.status AS yearStatus, DATE_FORMAT(y.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(y.end_date, '%Y-%m-%d') AS endDate
     FROM shs_elective_classes c
     JOIN users teacher ON teacher.id = c.teacher_user_id AND teacher.school_id = c.school_id
     JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
     JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
     WHERE c.id = ? AND c.school_id = ? LIMIT 1`, [classId, schoolId]
  );
  return rows[0];
}

async function listYears(req, res, next) {
  try {
    const [years] = await getDatabase().execute(
      `SELECT id, label, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate
       FROM academic_years WHERE school_id = ? ORDER BY start_date DESC`, [req.user.schoolId]
    );
    res.json({ years });
  } catch (error) { next(error); }
}

async function list(req, res, next) {
  try {
    const schoolId = req.user.schoolId;
    let yearId = req.query.academicYearId ? id(req.query.academicYearId, 'school year ID') : null;
    if (!yearId) {
      const [years] = await getDatabase().execute(
        `SELECT id FROM academic_years WHERE school_id = ?
         ORDER BY (status = 'active') DESC, start_date DESC LIMIT 1`, [schoolId]
      );
      yearId = years[0]?.id || null;
    }
    if (!yearId) return res.json({ year: null, assignments: [], meetings: [] });
    const [years] = await getDatabase().execute(
      `SELECT id, label, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS endDate
       FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1`, [yearId, schoolId]
    );
    if (!years.length) fail('School year not found.', 404);
    let accessSql = '';
    const accessValues = [];
    if (req.user.role === 'teacher') {
      accessSql = ' AND a.teacher_user_id = ?';
      accessValues.push(req.user.id);
    } else if (req.user.role === 'student') {
      accessSql = ` AND EXISTS (SELECT 1 FROM section_students ss WHERE ss.school_id = a.school_id
        AND ss.section_id = a.section_id AND ss.student_user_id = ? AND ss.withdrawn_at IS NULL)`;
      accessValues.push(req.user.id);
    }
    const [rows] = await getDatabase().execute(
      `SELECT a.id AS assignmentId, a.section_id AS sectionId, a.teacher_user_id AS teacherId,
        s.name AS sectionName, s.status AS sectionStatus, g.display_name AS gradeName,
        sub.name AS subjectName, sub.subject_code AS subjectCode,
        teacher.display_name AS teacherName, c.id AS scheduledClassId,
        m.id AS meetingId, m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
        TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
        DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room
       FROM section_teachers a
       JOIN sections s ON s.id = a.section_id AND s.school_id = a.school_id
       JOIN school_grade_levels g ON g.id = s.grade_level_id AND g.school_id = a.school_id
       JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id AND sub.is_active = TRUE
       JOIN users teacher ON teacher.id = a.teacher_user_id AND teacher.school_id = a.school_id
       LEFT JOIN scheduled_classes c ON c.assignment_id = a.id AND c.school_id = a.school_id
       LEFT JOIN timetable_meetings m ON m.scheduled_class_id = c.id AND m.school_id = c.school_id
       WHERE a.school_id = ? AND s.academic_year_id = ?${accessSql}
       ORDER BY g.grade_code, s.name, sub.name, m.weekday, m.start_time`,
      [schoolId, yearId, ...accessValues]
    );
    const assignments = new Map();
    const meetings = [];
    for (const row of rows) {
      if (!assignments.has(row.assignmentId)) assignments.set(row.assignmentId, {
        assignmentId: row.assignmentId, sectionId: row.sectionId, teacherId: row.teacherId,
        sectionName: row.sectionName, sectionStatus: row.sectionStatus, gradeName: row.gradeName,
        subjectName: row.subjectName, subjectCode: row.subjectCode, teacherName: row.teacherName,
        scheduledClassId: row.scheduledClassId
      });
      if (row.meetingId) meetings.push({
        id: row.meetingId, assignmentId: row.assignmentId, scheduledClassId: row.scheduledClassId,
        sectionId: row.sectionId, teacherId: row.teacherId, sectionName: row.sectionName,
        gradeName: row.gradeName, subjectName: row.subjectName, teacherName: row.teacherName,
        weekday: row.weekday, startTime: row.startTime, endTime: row.endTime,
        startDate: row.startDate, endDate: row.endDate, room: row.room
      });
    }
    const includeElectives = req.user.role === 'school_admin' || process.env.SHS_SELECTION_ENABLED === 'true';
    if (includeElectives) {
      let electiveAccess = '';
      const electiveValues = [];
      if (req.user.role === 'teacher') {
        electiveAccess = ' AND ec.teacher_user_id = ?';
        electiveValues.push(req.user.id);
      } else if (req.user.role === 'student') {
        electiveAccess = ` AND EXISTS (SELECT 1 FROM shs_elective_class_students em
          WHERE em.school_id = ec.school_id AND em.elective_class_id = ec.id
            AND em.student_user_id = ? AND em.withdrawn_at IS NULL)`;
        electiveValues.push(req.user.id);
      }
      const [electives] = await getDatabase().execute(
        `SELECT ec.id AS electiveClassId, ec.class_name AS className, ec.teacher_user_id AS teacherId,
          ec.is_active AS classActive, o.is_active AS offeringActive,
          o.subject_name AS subjectName, g.display_name AS gradeName,
          teacher.display_name AS teacherName, sc.id AS scheduledClassId,
          m.id AS meetingId, m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
          TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
          DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
          DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room
         FROM shs_elective_classes ec
         JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
         JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
         JOIN users teacher ON teacher.id = ec.teacher_user_id AND teacher.school_id = ec.school_id
         LEFT JOIN scheduled_classes sc ON sc.shs_elective_class_id = ec.id AND sc.school_id = ec.school_id
         LEFT JOIN timetable_meetings m ON m.scheduled_class_id = sc.id AND m.school_id = sc.school_id
         WHERE ec.school_id = ? AND o.academic_year_id = ? AND ec.is_active = TRUE AND o.is_active = TRUE${electiveAccess}
         ORDER BY g.grade_code, o.subject_name, ec.class_name, m.weekday, m.start_time`,
        [schoolId, yearId, ...electiveValues]
      );
      for (const item of electives) {
        if (item.meetingId) meetings.push({
          id: item.meetingId, electiveClassId: item.electiveClassId,
          scheduledClassId: item.scheduledClassId, sectionId: null,
          sectionName: item.className, gradeName: item.gradeName, teacherId: item.teacherId,
          teacherName: item.teacherName, subjectName: item.subjectName,
          weekday: item.weekday, startTime: item.startTime, endTime: item.endTime,
          startDate: item.startDate, endDate: item.endDate, room: item.room
        });
      }
      const response = { year: years[0], assignments: [...assignments.values()], meetings };
      if (req.user.role === 'school_admin') response.electiveClasses = electives.filter((item, index, all) =>
        all.findIndex(other => Number(other.electiveClassId) === Number(item.electiveClassId)) === index);
      res.json(response);
      return;
    }
    res.json({ year: years[0], assignments: [...assignments.values()], meetings });
  } catch (error) { next(error); }
}

async function findConflict(connection, schoolId, yearId, assignment, meeting, excludeId) {
  const [rows] = await connection.execute(
    `SELECT m.id, m.weekday, DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room,
      c.id AS scheduledClassId, a.section_id AS sectionId, ec.id AS electiveClassId,
      COALESCE(a.teacher_user_id, ec.teacher_user_id) AS teacherId,
      COALESCE(s.name, ec.class_name) AS sectionName,
      COALESCE(sub.name, o.subject_name) AS subjectName
    FROM timetable_meetings m
    JOIN scheduled_classes c ON c.id = m.scheduled_class_id AND c.school_id = m.school_id
    LEFT JOIN section_teachers a ON a.id = c.assignment_id AND a.school_id = c.school_id
    LEFT JOIN sections s ON s.id = a.section_id AND s.school_id = a.school_id
    LEFT JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id AND sub.is_active = TRUE
    LEFT JOIN shs_elective_classes ec ON ec.id = c.shs_elective_class_id AND ec.school_id = c.school_id
    LEFT JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
    WHERE m.school_id = ? AND COALESCE(s.academic_year_id, o.academic_year_id) = ?
      AND (a.id IS NULL OR sub.id IS NOT NULL) AND m.weekday = ?
      AND m.start_time < ? AND m.end_time > ? AND m.start_date <= ? AND m.end_date >= ?
      AND m.id <> ?`,
    [schoolId, yearId, meeting.weekday, meeting.endTime, meeting.startTime, meeting.endDate, meeting.startDate, excludeId || 0]
  );
  for (const row of rows) {
    const sameRoom = meeting.room && row.room && meeting.room.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      === row.room.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!hasOccurrence(
      row.startDate > meeting.startDate ? row.startDate : meeting.startDate,
      row.endDate < meeting.endDate ? row.endDate : meeting.endDate,
      meeting.weekday
    )) continue;
    if ((assignment.sectionId && Number(row.sectionId) === Number(assignment.sectionId))
      || Number(row.teacherId) === Number(assignment.teacherId) || sameRoom) return row;
    if (assignment.sectionId || assignment.electiveClassId) {
      const [members] = await connection.execute(
        `SELECT 1 FROM (
          SELECT student_user_id FROM shs_elective_class_students
            WHERE school_id = ? AND elective_class_id = ? AND withdrawn_at IS NULL
          UNION SELECT student_user_id FROM section_students
            WHERE school_id = ? AND section_id = ? AND withdrawn_at IS NULL
        ) proposed JOIN (
          SELECT student_user_id FROM shs_elective_class_students
            WHERE school_id = ? AND elective_class_id = ? AND withdrawn_at IS NULL
          UNION SELECT student_user_id FROM section_students
            WHERE school_id = ? AND section_id = ? AND withdrawn_at IS NULL
        ) other ON other.student_user_id = proposed.student_user_id LIMIT 1`,
        [schoolId, assignment.electiveClassId || 0, schoolId, assignment.sectionId || 0,
          schoolId, row.electiveClassId || 0, schoolId, row.sectionId || 0]
      );
      if (members.length) return row;
    }
  }
  return undefined;
}

async function assertTeacherScheduleAvailable(connection, schoolId, yearId, assignmentId, sectionId, teacherId) {
  const [meetings] = await connection.execute(
    `SELECT m.id, m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
      TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
      DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room
     FROM timetable_meetings m JOIN scheduled_classes c ON c.id = m.scheduled_class_id
     WHERE c.school_id = ? AND c.assignment_id = ?`, [schoolId, assignmentId]
  );
  for (const meeting of meetings) {
    const conflict = await findConflict(connection, schoolId, yearId, { sectionId, teacherId }, {
      ...meeting, startTime: `${meeting.startTime}:00`, endTime: `${meeting.endTime}:00`
    }, meeting.id);
    if (conflict) fail(`The new teacher has a schedule conflict with ${conflict.subjectName} in ${conflict.sectionName}.`, 409);
  }
}

async function assertElectiveTeacherScheduleAvailable(connection, schoolId, yearId, classId, teacherId) {
  const [meetings] = await connection.execute(
    `SELECT m.id, m.weekday, TIME_FORMAT(m.start_time, '%H:%i') AS startTime,
      TIME_FORMAT(m.end_time, '%H:%i') AS endTime,
      DATE_FORMAT(m.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(m.end_date, '%Y-%m-%d') AS endDate, m.room, sc.id AS scheduledClassId
     FROM timetable_meetings m JOIN scheduled_classes sc ON sc.id = m.scheduled_class_id AND sc.school_id = m.school_id
     WHERE sc.school_id = ? AND sc.shs_elective_class_id = ?`, [schoolId, classId]
  );
  for (const meeting of meetings) {
    const conflict = await findConflict(connection, schoolId, yearId, { teacherId, electiveClassId: classId }, {
      ...meeting, startTime: `${meeting.startTime}:00`, endTime: `${meeting.endTime}:00`
    }, meeting.id);
    if (conflict) fail(`The new teacher has a schedule conflict with ${conflict.subjectName} in ${conflict.sectionName}.`, 409);
  }
}

async function save(req, res, next) {
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    const schoolId = req.user.schoolId;
    const assignmentId = id(req.params.assignmentId, 'assignment ID');
    const meetingId = req.params.meetingId ? id(req.params.meetingId, 'meeting ID') : null;
    const initial = await getAssignment(connection, schoolId, assignmentId);
    if (!initial) fail('Subject assignment not found.', 404);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [initial.academicYearId, schoolId]);
    const assignment = await getAssignment(connection, schoolId, assignmentId);
    if (!assignment || Number(assignment.academicYearId) !== Number(initial.academicYearId)) fail('The assignment changed. Reload and try again.', 409);
    if (assignment.yearStatus === 'archived' || assignment.sectionStatus !== 'active') fail('This school year or section is read-only.', 409);
    const meeting = validateMeeting(req.body, assignment);
    if (meetingId) {
      const owner = await getMeetingOwner(connection, schoolId, meetingId);
      if (Number(owner?.assignmentId) !== assignmentId) fail('Meeting not found.', 404);
    }
    const [[existingClass]] = await connection.execute(
      'SELECT id FROM scheduled_classes WHERE school_id = ? AND assignment_id = ? LIMIT 1', [schoolId, assignmentId]
    );
    assignment.scheduledClassId = existingClass?.id || null;
    const conflict = await findConflict(connection, schoolId, assignment.academicYearId, assignment, meeting, meetingId);
    if (conflict) fail(`Schedule conflict with ${conflict.subjectName} in ${conflict.sectionName}.`, 409);
    let savedId = meetingId;
    if (meetingId) {
      await connection.execute(
        `UPDATE timetable_meetings SET weekday=?, start_time=?, end_time=?, start_date=?, end_date=?, room=?
         WHERE id=? AND school_id=?`,
        [meeting.weekday, meeting.startTime, meeting.endTime, meeting.startDate, meeting.endDate, meeting.room, meetingId, schoolId]
      );
    } else {
      await connection.execute(
        `INSERT INTO scheduled_classes (school_id, assignment_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [schoolId, assignmentId]
      );
      const [[scheduledClass]] = await connection.execute('SELECT id FROM scheduled_classes WHERE assignment_id = ? AND school_id = ?', [assignmentId, schoolId]);
      const [result] = await connection.execute(
        `INSERT INTO timetable_meetings (school_id, scheduled_class_id, weekday, start_time, end_time, start_date, end_date, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [schoolId, scheduledClass.id, meeting.weekday, meeting.startTime, meeting.endTime, meeting.startDate, meeting.endDate, meeting.room]
      );
      savedId = result.insertId;
    }
    await writeAuditLog(connection, req, meetingId ? 'timetable_meeting_updated' : 'timetable_meeting_created', 'timetable_meeting', savedId, {
      summary: `Assignment ${assignmentId}`, sectionName: assignment.sectionName,
      gradeName: assignment.gradeName, subjectName: assignment.subjectName, teacherName: assignment.teacherName,
      schoolYearLabel: assignment.schoolYearLabel, weekday: meeting.weekday, startTime: meeting.startTime,
      endTime: meeting.endTime, startDate: meeting.startDate, endDate: meeting.endDate, room: meeting.room
    });
    await connection.commit(); started = false;
    res.status(meetingId ? 200 : 201).json({ id: savedId });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function saveElective(req, res, next) {
  const connection = await getDatabase().getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const classId = id(req.params.classId, 'elective class ID');
    const meetingId = req.params.meetingId ? id(req.params.meetingId, 'meeting ID') : null;
    const initial = await getElectiveClass(connection, schoolId, classId);
    if (!initial) fail('Elective class not found.', 404);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [initial.academicYearId, schoolId]);
    const elective = await getElectiveClass(connection, schoolId, classId);
    if (!elective || Number(elective.academicYearId) !== Number(initial.academicYearId)) fail('The class changed. Reload and try again.', 409);
    if (elective.yearStatus === 'archived' || !elective.classActive || !elective.offeringActive) fail('This school year or class is read-only.', 409);
    if (elective.teacherStatus !== 'active') fail('Assign an active teacher before scheduling this class.', 409);
    const meeting = validateMeeting(req.body, elective);
    if (meetingId) {
      const owner = await getMeetingOwner(connection, schoolId, meetingId);
      if (Number(owner?.electiveClassId) !== classId) fail('Meeting not found.', 404);
    }
    const [[existingClass]] = await connection.execute(
      'SELECT id FROM scheduled_classes WHERE school_id = ? AND shs_elective_class_id = ? LIMIT 1', [schoolId, classId]
    );
    elective.scheduledClassId = existingClass?.id || null;
    elective.electiveClassId = classId;
    const conflict = await findConflict(connection, schoolId, elective.academicYearId, elective, meeting, meetingId);
    if (conflict) fail(`Schedule conflict with ${conflict.subjectName} in ${conflict.sectionName}.`, 409);
    let savedId = meetingId;
    if (meetingId) {
      await connection.execute(
        `UPDATE timetable_meetings SET weekday=?, start_time=?, end_time=?, start_date=?, end_date=?, room=?
         WHERE id=? AND school_id=?`,
        [meeting.weekday, meeting.startTime, meeting.endTime, meeting.startDate, meeting.endDate, meeting.room, meetingId, schoolId]
      );
    } else {
      await connection.execute(
        `INSERT INTO scheduled_classes (school_id, shs_elective_class_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [schoolId, classId]
      );
      const [[scheduledClass]] = await connection.execute(
        'SELECT id FROM scheduled_classes WHERE school_id = ? AND shs_elective_class_id = ?', [schoolId, classId]
      );
      const [result] = await connection.execute(
        `INSERT INTO timetable_meetings (school_id, scheduled_class_id, weekday, start_time, end_time, start_date, end_date, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [schoolId, scheduledClass.id, meeting.weekday, meeting.startTime, meeting.endTime, meeting.startDate, meeting.endDate, meeting.room]
      );
      savedId = result.insertId;
    }
    await writeAuditLog(connection, req, meetingId ? 'shs_timetable_meeting_updated' : 'shs_timetable_meeting_created', 'timetable_meeting', savedId, {
      summary: `Elective class ${classId}`, className: elective.className, subjectName: elective.subjectName,
      teacherName: elective.teacherName, gradeCode: elective.gradeCode, trackCode: elective.trackCode,
      schoolYearLabel: elective.schoolYearLabel, weekday: meeting.weekday, startTime: meeting.startTime,
      endTime: meeting.endTime, startDate: meeting.startDate, endDate: meeting.endDate, room: meeting.room
    });
    await connection.commit(); started = false;
    res.status(meetingId ? 200 : 201).json({ id: savedId });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

async function remove(req, res, next) {
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    const schoolId = req.user.schoolId;
    const meetingId = id(req.params.meetingId, 'meeting ID');
    const owner = await getMeetingOwner(connection, schoolId, meetingId);
    if (!owner) fail('Meeting not found.', 404);
    const initial = owner.assignmentId
      ? await getAssignment(connection, schoolId, owner.assignmentId)
      : await getElectiveClass(connection, schoolId, owner.electiveClassId);
    if (!initial) fail('Meeting not found.', 404);
    await connection.beginTransaction(); started = true;
    await connection.execute('SELECT id FROM academic_years WHERE id = ? AND school_id = ? FOR UPDATE', [initial.academicYearId, schoolId]);
    const assignment = owner.assignmentId
      ? await getAssignment(connection, schoolId, owner.assignmentId)
      : await getElectiveClass(connection, schoolId, owner.electiveClassId);
    const currentOwner = await getMeetingOwner(connection, schoolId, meetingId);
    if (!assignment || Number(currentOwner?.assignmentId || 0) !== Number(owner.assignmentId || 0)
      || Number(currentOwner?.electiveClassId || 0) !== Number(owner.electiveClassId || 0)) fail('Meeting not found.', 404);
    if (assignment.yearStatus === 'archived' || (owner.assignmentId && assignment.sectionStatus !== 'active')
      || (owner.electiveClassId && (!assignment.classActive || !assignment.offeringActive))) fail('This school year or class is read-only.', 409);
    await connection.execute('DELETE FROM timetable_meetings WHERE id = ? AND school_id = ?', [meetingId, schoolId]);
    const isShsMeeting = Boolean(owner.electiveClassId);
    const meetingDetails = {
      summary: isShsMeeting ? `Elective class ${owner.electiveClassId}` : `Assignment ${owner.assignmentId}`,
      weekday: owner.weekday, startTime: owner.startTime, endTime: owner.endTime,
      startDate: owner.startDate, endDate: owner.endDate, room: owner.room
    };
    if (isShsMeeting) {
      Object.assign(meetingDetails, {
        className: assignment.className, subjectName: assignment.subjectName,
        teacherName: assignment.teacherName, gradeCode: assignment.gradeCode,
        trackCode: assignment.trackCode, schoolYearLabel: assignment.schoolYearLabel
      });
    } else {
      Object.assign(meetingDetails, {
        sectionName: assignment.sectionName, gradeName: assignment.gradeName,
        subjectName: assignment.subjectName, teacherName: assignment.teacherName,
        schoolYearLabel: assignment.schoolYearLabel
      });
    }
    await writeAuditLog(connection, req, isShsMeeting ? 'shs_timetable_meeting_deleted' : 'timetable_meeting_deleted',
      'timetable_meeting', meetingId, meetingDetails);
    await connection.commit(); started = false;
    res.status(204).send();
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}

module.exports = { list, listYears, save, saveElective, remove, hasOccurrence, validateMeeting, findConflict,
  assertTeacherScheduleAvailable, assertElectiveTeacherScheduleAvailable };
