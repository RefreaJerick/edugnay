const { getDatabase } = require('../config/database');
const { avatarFields } = require('../config/avatars');
const { assertElectiveParent, assertElectiveStudent, assertElectiveTeacher, getElectiveClass, getElectiveRoster } = require('../utils/shsTeachingAccess');

function fail(message, status = 404) { const error = new Error(message); error.status = status; throw error; }
function id(value, label) { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) { const error = new Error(`Invalid ${label}.`); error.status = 400; throw error; } return n; }

async function classList(req, res, next) {
  try {
    const schoolId = req.user.schoolId;
    let membershipJoin = '';
    let access = '';
    const joinValues = [];
    const accessValues = [];
    if (req.user.role === 'teacher') {
      access = 'AND ec.teacher_user_id = ? AND ec.is_active = TRUE AND o.is_active = TRUE AND t.account_status = \'active\'';
      accessValues.push(req.user.id);
    } else if (req.user.role === 'student') {
      membershipJoin = `JOIN shs_elective_class_students m ON m.school_id = ec.school_id
        AND m.elective_class_id = ec.id AND m.student_user_id = ? AND m.withdrawn_at IS NULL`;
      joinValues.push(req.user.id);
      access = "AND ec.is_active = TRUE AND o.is_active = TRUE AND y.status = 'active'";
    } else if (req.user.role === 'parent') {
      membershipJoin = `JOIN shs_elective_class_students m ON m.school_id = ec.school_id
        AND m.elective_class_id = ec.id AND m.withdrawn_at IS NULL
        JOIN student_parent_links pl ON pl.school_id = m.school_id AND pl.student_user_id = m.student_user_id
          AND pl.parent_user_id = ?`;
      joinValues.push(req.user.id);
      access = "AND ec.is_active = TRUE AND o.is_active = TRUE AND y.status = 'active'";
    } else if (req.user.role !== 'school_admin') fail('Elective classes are not available to this role.', 403);
    const values = [...joinValues, schoolId, ...accessValues];
    const [rows] = await getDatabase().execute(
      `SELECT ec.id AS electiveClassId, ec.class_name AS className, ec.teacher_user_id AS teacherId,
        ec.capacity, ec.is_active AS classActive, o.academic_year_id AS academicYearId,
        o.grade_level_id AS gradeLevelId, o.track_code AS trackCode, o.subject_name AS subjectName,
        o.subject_type AS subjectType, o.instructional_hours AS instructionalHours,
        o.is_active AS offeringActive, g.grade_code AS gradeCode, g.display_name AS gradeName,
        ${req.user.role === 'parent' || req.user.role === 'student' ? 'm.student_user_id AS studentId,' : 'NULL AS studentId,'}
        y.label AS schoolYear, y.status AS yearStatus, t.account_status AS teacherStatus,
        (SELECT active_term.name FROM academic_terms active_term
          WHERE active_term.school_id = ec.school_id
            AND active_term.academic_year_id = o.academic_year_id
            AND active_term.school_level_id = g.school_level_id
            AND active_term.status = 'active'
          ORDER BY active_term.sequence_number LIMIT 1) AS activePeriodName,
        DATE_FORMAT(y.start_date, '%Y-%m-%d') AS yearStartDate,
        DATE_FORMAT(y.end_date, '%Y-%m-%d') AS yearEndDate, t.display_name AS teacherName,
        (SELECT COUNT(*) FROM shs_elective_class_students active_members WHERE active_members.school_id = ec.school_id
          AND active_members.elective_class_id = ec.id AND active_members.withdrawn_at IS NULL) AS enrolledCount,
        EXISTS (SELECT 1 FROM scheduled_classes sc JOIN timetable_meetings tm
          ON tm.school_id = sc.school_id AND tm.scheduled_class_id = sc.id
          WHERE sc.school_id = ec.school_id AND sc.shs_elective_class_id = ec.id) AS scheduled
       FROM shs_elective_classes ec
       JOIN shs_offerings o ON o.id = ec.offering_id AND o.school_id = ec.school_id
       JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
       JOIN academic_years y ON y.id = o.academic_year_id AND y.school_id = o.school_id
       JOIN users t ON t.id = ec.teacher_user_id AND t.school_id = ec.school_id
       ${membershipJoin}
       WHERE ec.school_id = ? ${access}
       ORDER BY y.start_date DESC, g.grade_code, o.subject_name, ec.class_name`, values);
    res.json({ classes: rows.map(row => ({ ...row, electiveClassId: String(row.electiveClassId),
      enrolledCount: Number(row.enrolledCount), capacity: Number(row.capacity),
      instructionalHours: Number(row.instructionalHours), scheduled: Boolean(row.scheduled) })) });
  } catch (error) { next(error); }
}

async function roster(req, res, next) {
  try {
    const classId = id(req.params.classId, 'class ID');
    const connection = await getDatabase().getConnection();
    try {
      let classInfo;
      if (req.user.role === 'teacher') classInfo = await assertElectiveTeacher(connection, req.user, classId);
      else if (req.user.role === 'school_admin') classInfo = await getElectiveClass(connection, req.user.schoolId, classId, { includeArchived: true });
      else fail('Only the assigned teacher or a school administrator can view this roster.', 403);
      if (!classInfo) fail('Elective class not found.');
      const students = await getElectiveRoster(connection, req.user.schoolId, classId);
      res.json({ electiveClass: classInfo, students: students.map(student => ({
        ...student, id: String(student.studentId), ...avatarFields({ ...student, id: student.studentId })
      })) });
    } finally { connection.release(); }
  } catch (error) { next(error); }
}

async function studentDetails(req, res, next) {
  try {
    const classId = id(req.params.classId, 'class ID');
    const studentId = id(req.params.studentId, 'student ID');
    const connection = await getDatabase().getConnection();
    try {
      const classInfo = await assertElectiveTeacher(connection, req.user, classId);
      const [students] = await connection.execute(
        `SELECT u.id AS studentId, u.display_name AS displayName, u.school_email AS schoolEmail,
          p.lrn AS studentNumber
         FROM shs_elective_class_students m
         JOIN users u ON u.id = m.student_user_id AND u.school_id = m.school_id AND u.role = 'student'
         LEFT JOIN student_profiles p ON p.user_id = u.id
         WHERE m.school_id = ? AND m.elective_class_id = ? AND m.student_user_id = ?
           AND m.withdrawn_at IS NULL LIMIT 1`,
        [req.user.schoolId, classId, studentId]
      );
      if (!students.length) fail('Student details were not found in this class.', 404);

      const [parents] = await connection.execute(
        `SELECT parents.display_name AS displayName, student_parent_links.relationship,
          parent_profiles.contact_number AS contactNumber, parents.personal_email AS email
         FROM student_parent_links
         JOIN users AS parents ON parents.id = student_parent_links.parent_user_id
           AND parents.school_id = student_parent_links.school_id AND parents.role = 'parent'
         LEFT JOIN parent_profiles ON parent_profiles.user_id = parents.id
         WHERE student_parent_links.school_id = ? AND student_parent_links.student_user_id = ?
         ORDER BY parents.last_name, parents.first_name, student_parent_links.relationship`,
        [req.user.schoolId, studentId]
      );

      const student = students[0];
      res.json({
        student: {
          id: String(student.studentId),
          displayName: student.displayName,
          schoolEmail: student.schoolEmail,
          studentNumber: student.studentNumber,
          gradeLevel: classInfo.gradeName,
          sectionName: classInfo.className,
          schoolYear: classInfo.academicYearLabel,
          enrollmentStatus: 'Enrolled'
        },
        parents
      });
    } finally { connection.release(); }
  } catch (error) { next(error); }
}

async function parentClassHistory(req, res, next) {
  try {
    const classId = id(req.params.classId, 'class ID');
    const studentId = id(req.params.studentId, 'student ID');
    const connection = await getDatabase().getConnection();
    try {
      const info = await assertElectiveParent(connection, req.user, classId, studentId);
      res.json({ electiveClass: info, studentId: String(studentId) });
    } finally { connection.release(); }
  } catch (error) { next(error); }
}

module.exports = { classList, roster, studentDetails, parentClassHistory };
