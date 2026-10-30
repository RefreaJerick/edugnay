const { getDatabase } = require('../config/database');
const { avatarFields } = require('../config/avatars');
const { writeAuditLog } = require('../utils/auditLog');
const { buildStudentFlags } = require('../utils/studentFlags');
const {
  DEFAULT_WEEK, addDays, isoWeekday, normalizeDate, normalizeWeekSettings,
  readWeekSettings, reportWeekRange, schoolToday
} = require('../utils/reportWeekSettings');

const WEEKDAY_LABELS = Object.freeze({ 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' });

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

async function getWeeklySettings(req, res, next) {
  try {
    const schoolId = parseId(req.user?.schoolId, 'school ID');
    const settings = await readWeekSettings(getDatabase(), schoolId);
    const [[approval]] = await getDatabase().execute(
      'SELECT narrative_reports_enabled AS reportsEnabled, ai_evidence_approved_at AS approvedAt FROM school_portal_features WHERE school_id = ?',
      [schoolId]
    );
    const aiEvidenceApproved = Boolean(approval?.approvedAt);
    const reportsEnabled = Boolean(approval?.reportsEnabled);
    res.set('Cache-Control', 'no-store');
    res.json({
      settings, weekdays: WEEKDAY_LABELS,
      generationEnabled: process.env.AI_REPORTS_GENERATION_ENABLED === 'true' && reportsEnabled && aiEvidenceApproved,
      reportsEnabled,
      aiEvidenceApproved,
      generationSwitchEnabled: process.env.AI_REPORTS_GENERATION_ENABLED === 'true',
      releaseEnabled: process.env.AI_REPORTS_RELEASE_ENABLED === 'true'
    });
  } catch (error) { next(error); }
}

async function updateWeeklySettings(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    const settings = normalizeWeekSettings(req.body);
    const schoolId = parseId(req.user?.schoolId, 'school ID');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute(
      `INSERT INTO school_settings (
        school_id, narrative_report_week_start_day, narrative_report_week_end_day
      ) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        narrative_report_week_start_day = VALUES(narrative_report_week_start_day),
        narrative_report_week_end_day = VALUES(narrative_report_week_end_day)`,
      [schoolId, settings.weekStartDay, settings.weekEndDay]
    );
    await writeAuditLog(connection, req, 'narrative_report_week_updated', 'school_settings', schoolId, {
      summary: 'Narrative report week updated', ...settings
    });
    await connection.commit();
    transactionStarted = false;
    res.set('Cache-Control', 'no-store');
    res.json({ settings });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

function reportSubmissionStatus(row, throughDate) {
  const recordedInTime = !row.statusUpdatedAt || String(row.statusUpdatedAt).slice(0, 10) <= throughDate;
  const submittedInTime = row.submittedAt && String(row.submittedAt).slice(0, 10) <= throughDate;
  const uploaded = recordedInTime && submittedInTime && Boolean(row.filePath) && row.savedStatus === 'submitted';
  const manual = Number(row.onlineSubmissionEnabled) !== 1 &&
    recordedInTime && ['pending', 'submitted', 'not_submitted'].includes(row.savedStatus) ? row.savedStatus : null;
  if (row.submissionId && !recordedInTime) return 'pending';
  return uploaded ? 'submitted' : manual || (row.dueDate && row.dueDate < throughDate ? 'not_submitted' : 'pending');
}

function dateWithinEnrollment(day, enrollment) {
  return day >= enrollment.enrolledDate && (!enrollment.withdrawnDate || day <= enrollment.withdrawnDate);
}

function emptyAttendance() {
  return { confirmedSessions: 0, recordedSessions: 0, present: 0, late: 0, absent: 0, excused: 0, unmarkedSessions: 0, sources: [] };
}

async function buildWeeklyEvidence({ schoolId: schoolValue, teacherId: teacherValue, sectionId: sectionValue, startDate, database = getDatabase() }) {
    const schoolId = parseId(schoolValue, 'school ID');
    const teacherId = parseId(teacherValue, 'teacher ID');
    const sectionId = parseId(sectionValue, 'section ID');
    const [sectionRows] = await database.execute(
      `SELECT sections.id AS sectionId, sections.name AS sectionName,
        sections.academic_year_id AS academicYearId, sections.school_level_id AS schoolLevelId,
        school_levels.level_code AS schoolLevelCode,
        sections.grade_level_id AS gradeLevelId,
        DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS academicYearStartDate,
        DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS academicYearEndDate,
        academic_years.label AS academicYearLabel,
        school_grade_levels.display_name AS gradeLevelName,
        school_portal_features.narrative_reports_enabled AS reportsEnabled,
        school_settings.journal_subject_id AS journalSubjectId,
        school_portal_features.journals_enabled AS journalsEnabled,
        school_settings.narrative_report_week_start_day AS weekStartDay,
        school_settings.narrative_report_week_end_day AS weekEndDay
      FROM sections
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = sections.school_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_id = sections.school_id
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id
        AND school_levels.school_id = sections.school_id
      LEFT JOIN school_portal_features ON school_portal_features.school_id = sections.school_id
      LEFT JOIN school_settings ON school_settings.school_id = sections.school_id
      WHERE sections.id = ? AND sections.school_id = ? AND sections.status = 'active'
        AND academic_years.status = 'active' AND sections.adviser_user_id = ?
      LIMIT 1`,
      [sectionId, schoolId, teacherId]
    );
    const section = sectionRows[0];
    if (!section) throw createError('Advisory section not found.', 404);
    if (Number(section.reportsEnabled) !== 1) throw createError('Narrative Reports are not enabled for this school.', 403);
    const journalApplicable = section.schoolLevelCode === 'jhs' &&
      Number(section.journalsEnabled) === 1 && Boolean(section.journalSubjectId);

    const settings = {
      weekStartDay: Number(section.weekStartDay) || DEFAULT_WEEK.weekStartDay,
      weekEndDay: Number(section.weekEndDay) || DEFAULT_WEEK.weekEndDay
    };
    const period = reportWeekRange(startDate, settings);
    const today = schoolToday();
    if (period.startDate > today) throw createError('A report week cannot start in the future.');
    if (period.endDate < section.academicYearStartDate || period.startDate > section.academicYearEndDate) {
      throw createError('The selected report week does not overlap the active academic year.');
    }
    const evidenceStartDate = period.startDate < section.academicYearStartDate
      ? section.academicYearStartDate : period.startDate;
    const evidenceEndDate = [period.endDate, today, section.academicYearEndDate].sort()[0];

    const [rosterRows] = await database.execute(
      `SELECT students.id AS studentId, students.display_name AS displayName,
        students.initials, students.avatar_filename AS avatarFilename,
        students.avatar_version AS avatarVersion,
        DATE_FORMAT(section_students.enrolled_at, '%Y-%m-%d') AS enrolledDate,
        DATE_FORMAT(section_students.withdrawn_at, '%Y-%m-%d') AS withdrawnDate
      FROM section_students
      INNER JOIN users AS students ON students.id = section_students.student_user_id
        AND students.school_id = section_students.school_id AND students.role = 'student'
        AND students.account_status = 'active'
      WHERE section_students.school_id = ? AND section_students.section_id = ?
        AND DATE(section_students.enrolled_at) <= ?
        AND (section_students.withdrawn_at IS NULL OR DATE(section_students.withdrawn_at) >= ?)
      ORDER BY students.last_name, students.first_name, students.id`,
      [schoolId, sectionId, evidenceEndDate, evidenceStartDate]
    );
    const students = rosterRows.map(row => ({
      id: String(row.studentId), displayName: row.displayName, initials: row.initials || '',
      ...avatarFields({ id: row.studentId, avatarFilename: row.avatarFilename, avatarVersion: row.avatarVersion }),
      enrolledDate: row.enrolledDate, withdrawnDate: row.withdrawnDate,
      attendance: emptyAttendance(), assignments: { total: 0, submitted: 0, notSubmitted: 0, pending: 0, sources: [] },
      journal: { subjectName: null, entries: [], sources: [] },
      followUpCandidate: false, candidateReasons: [], academicRecords: [],
      academicScores: [], academicScoresOmitted: 0, lowScoreReasons: []
    }));
    const byStudent = new Map(students.map(student => [student.id, student]));

    if (students.length) {
      const studentIds = students.map(student => Number(student.id));
      const placeholders = studentIds.map(() => '?').join(', ');
      const [sessionRows] = await database.execute(
        `SELECT sessions.id AS sessionId,
          DATE_FORMAT(sessions.attendance_date, '%Y-%m-%d') AS attendanceDate,
          sessions.subject_id AS subjectId, COALESCE(subjects.name, 'All subjects') AS subjectName,
          records.id AS recordId, records.student_user_id AS studentId,
          records.attendance_status AS attendanceStatus, records.remarks
        FROM attendance_sessions AS sessions
        LEFT JOIN subjects ON subjects.id = sessions.subject_id AND subjects.school_id = sessions.school_id
          AND subjects.is_active = TRUE
        LEFT JOIN attendance_records AS records ON records.attendance_session_id = sessions.id
          AND records.school_id = sessions.school_id AND records.student_user_id IN (${placeholders})
        WHERE sessions.school_id = ? AND sessions.section_id = ? AND sessions.status = 'confirmed'
          AND (sessions.subject_id IS NULL OR subjects.id IS NOT NULL)
          AND sessions.attendance_date BETWEEN ? AND ?
        ORDER BY sessions.attendance_date, sessions.id, records.student_user_id`,
        [...studentIds, schoolId, sectionId, evidenceStartDate, evidenceEndDate]
      );
      const sessions = new Map();
      sessionRows.forEach(row => {
        const session = sessions.get(String(row.sessionId)) || {
          id: String(row.sessionId), date: row.attendanceDate,
          subjectId: row.subjectId == null ? null : String(row.subjectId), subjectName: row.subjectName,
          records: []
        };
        if (row.recordId != null) session.records.push(row);
        sessions.set(session.id, session);
      });
      sessions.forEach(session => students.forEach(student => {
        if (!dateWithinEnrollment(session.date, student)) return;
        const attendance = student.attendance;
        attendance.confirmedSessions++;
        const record = session.records.find(item => String(item.studentId) === student.id);
        if (!record) {
          attendance.unmarkedSessions++;
          attendance.sources.push({
            recordId: null, sessionId: session.id, date: session.date,
            subjectId: session.subjectId, subjectName: session.subjectName, status: null
          });
          return;
        }
        attendance.recordedSessions++;
        if (Object.hasOwn(attendance, record.attendanceStatus)) attendance[record.attendanceStatus]++;
        const source = {
          recordId: String(record.recordId), sessionId: session.id, date: session.date,
          subjectId: session.subjectId, subjectName: session.subjectName,
          status: record.attendanceStatus,
          remark: ['absent', 'late', 'excused'].includes(record.attendanceStatus) ? record.remarks?.trim() || null : null
        };
        attendance.sources.push(source);
      }));

      let shsAttendanceRows = [];
      if (section.schoolLevelCode === 'shs' && process.env.SHS_SELECTION_ENABLED === 'true') {
        [shsAttendanceRows] = await database.execute(
          `SELECT records.id AS recordId, records.student_user_id AS studentId,
            sessions.id AS sessionId, DATE_FORMAT(sessions.attendance_date, '%Y-%m-%d') AS date,
            sessions.shs_elective_class_id AS electiveClassId,
            offerings.subject_name AS subjectName, classes.class_name AS className,
            records.attendance_status AS status, records.remarks AS remark
          FROM attendance_records AS records
          INNER JOIN attendance_sessions AS sessions ON sessions.id = records.attendance_session_id
            AND sessions.school_id = records.school_id AND sessions.status = 'confirmed'
          INNER JOIN shs_elective_classes AS classes ON classes.id = sessions.shs_elective_class_id
            AND classes.school_id = sessions.school_id
          INNER JOIN shs_offerings AS offerings ON offerings.id = classes.offering_id
            AND offerings.school_id = classes.school_id AND offerings.academic_year_id = ?
          WHERE records.school_id = ? AND records.student_user_id IN (${placeholders})
            AND sessions.attendance_date BETWEEN ? AND ?
            AND EXISTS (SELECT 1 FROM shs_elective_class_students AS members
              WHERE members.school_id = records.school_id AND members.elective_class_id = classes.id
                AND members.student_user_id = records.student_user_id
                AND (members.withdrawn_at IS NULL OR sessions.attendance_date <= DATE(members.withdrawn_at)))
          ORDER BY sessions.attendance_date, sessions.id, records.student_user_id`,
          [section.academicYearId, schoolId, ...studentIds, evidenceStartDate, evidenceEndDate]
        );
        shsAttendanceRows.forEach(row => {
          const student = byStudent.get(String(row.studentId));
          if (!student || !dateWithinEnrollment(row.date, student)) return;
          const attendance = student.attendance;
          attendance.confirmedSessions++;
          attendance.recordedSessions++;
          if (Object.hasOwn(attendance, row.status)) attendance[row.status]++;
          attendance.sources.push({
            recordId: String(row.recordId), sessionId: String(row.sessionId), date: row.date,
            electiveClassId: String(row.electiveClassId), subjectName: row.subjectName,
            className: row.className, status: row.status,
            remark: ['absent', 'late', 'excused'].includes(row.status) ? row.remark?.trim() || null : null
          });
        });
      }

      const [assignmentRows] = await database.execute(
        `SELECT assignments.id AS assignmentId, assignments.title,
          assignments.subject_id AS subjectId, subjects.name AS subjectName,
          assignments.online_submission_enabled AS onlineSubmissionEnabled,
          DATE_FORMAT(assignments.due_at, '%Y-%m-%d') AS dueDate,
          section_students.student_user_id AS studentId,
          assignment_submissions.id AS submissionId,
          assignment_submissions.submission_status AS savedStatus,
          assignment_submissions.file_path AS filePath,
          DATE_FORMAT(assignment_submissions.submitted_at, '%Y-%m-%dT%H:%i:%s') AS submittedAt,
          DATE_FORMAT(assignment_submissions.updated_at, '%Y-%m-%dT%H:%i:%s') AS statusUpdatedAt
        FROM assignments
        INNER JOIN subjects ON subjects.id = assignments.subject_id AND subjects.school_id = assignments.school_id
          AND subjects.is_active = TRUE
        INNER JOIN section_students ON section_students.school_id = assignments.school_id
          AND section_students.section_id = assignments.section_id
          AND DATE(section_students.enrolled_at) <= DATE(assignments.due_at)
          AND (section_students.withdrawn_at IS NULL OR DATE(section_students.withdrawn_at) >= DATE(assignments.due_at))
        LEFT JOIN assignment_submissions ON assignment_submissions.school_id = assignments.school_id
          AND assignment_submissions.assignment_id = assignments.id
          AND assignment_submissions.student_user_id = section_students.student_user_id
        WHERE assignments.school_id = ? AND assignments.section_id = ? AND assignments.status = 'published'
          AND assignments.due_at IS NOT NULL
          AND DATE(assignments.due_at) BETWEEN ? AND ?
        ORDER BY assignments.due_at, subjects.name, assignments.title, section_students.student_user_id`,
        [schoolId, sectionId, evidenceStartDate, evidenceEndDate]
      );
      assignmentRows.forEach(row => {
        const student = byStudent.get(String(row.studentId));
        if (!student || !dateWithinEnrollment(row.dueDate, student)) return;
        const status = reportSubmissionStatus(row, evidenceEndDate);
        student.assignments.total++;
        if (status === 'submitted') student.assignments.submitted++;
        else if (status === 'not_submitted') student.assignments.notSubmitted++;
        else student.assignments.pending++;
        student.assignments.sources.push({
          assignmentId: String(row.assignmentId), submissionId: status === 'submitted' && row.submissionId != null ? String(row.submissionId) : null,
          subjectId: String(row.subjectId), subjectName: row.subjectName, title: row.title,
          dueDate: row.dueDate, status, submittedAt: status === 'submitted' ? row.submittedAt || null : null
        });
      });

      if (section.schoolLevelCode === 'shs' && process.env.SHS_SELECTION_ENABLED === 'true') {
        const [shsAssignmentRows] = await database.execute(
          `SELECT assignments.id AS assignmentId, assignments.title,
            assignments.shs_elective_class_id AS electiveClassId,
            offerings.subject_name AS subjectName, classes.class_name AS className,
            assignments.online_submission_enabled AS onlineSubmissionEnabled,
            DATE_FORMAT(assignments.due_at, '%Y-%m-%d') AS dueDate,
            members.student_user_id AS studentId,
            submissions.id AS submissionId, submissions.submission_status AS savedStatus,
            submissions.file_path AS filePath,
            DATE_FORMAT(submissions.submitted_at, '%Y-%m-%dT%H:%i:%s') AS submittedAt,
            DATE_FORMAT(submissions.updated_at, '%Y-%m-%dT%H:%i:%s') AS statusUpdatedAt
          FROM assignments
          INNER JOIN shs_elective_classes AS classes ON classes.id = assignments.shs_elective_class_id
            AND classes.school_id = assignments.school_id
          INNER JOIN shs_offerings AS offerings ON offerings.id = classes.offering_id
            AND offerings.school_id = classes.school_id AND offerings.academic_year_id = ?
          INNER JOIN shs_elective_class_students AS members ON members.school_id = assignments.school_id
            AND members.elective_class_id = classes.id AND members.student_user_id IN (${placeholders})
            AND (members.withdrawn_at IS NULL OR DATE(assignments.due_at) <= DATE(members.withdrawn_at))
          LEFT JOIN assignment_submissions AS submissions ON submissions.school_id = assignments.school_id
            AND submissions.assignment_id = assignments.id AND submissions.student_user_id = members.student_user_id
          WHERE assignments.school_id = ? AND assignments.status = 'published'
            AND assignments.due_at IS NOT NULL AND DATE(assignments.due_at) BETWEEN ? AND ?
          ORDER BY assignments.due_at, offerings.subject_name, assignments.title, members.student_user_id`,
          [section.academicYearId, ...studentIds, schoolId, evidenceStartDate, evidenceEndDate]
        );
        const seenAssignments = new Set();
        shsAssignmentRows.forEach(row => {
          const student = byStudent.get(String(row.studentId));
          const key = `${row.assignmentId}:${row.studentId}`;
          if (!student || seenAssignments.has(key) || !dateWithinEnrollment(row.dueDate, student)) return;
          seenAssignments.add(key);
          const status = reportSubmissionStatus(row, evidenceEndDate);
          student.assignments.total++;
          if (status === 'submitted') student.assignments.submitted++;
          else if (status === 'not_submitted') student.assignments.notSubmitted++;
          else student.assignments.pending++;
          student.assignments.sources.push({
            assignmentId: String(row.assignmentId),
            submissionId: status === 'submitted' && row.submissionId != null ? String(row.submissionId) : null,
            electiveClassId: String(row.electiveClassId), className: row.className,
            subjectName: row.subjectName, title: row.title, dueDate: row.dueDate,
            status, submittedAt: status === 'submitted' ? row.submittedAt || null : null
          });
        });
      }

      if (journalApplicable) {
        const [journalRows] = await database.execute(
          `SELECT entries.id AS entryId, entries.student_user_id AS studentId,
            subjects.name AS subjectName, entries.prompt_text AS promptText,
            entries.entry_text AS entryText, entries.entry_status AS entryStatus,
            DATE_FORMAT(entries.submitted_at, '%Y-%m-%dT%H:%i:%s') AS submittedAt
          FROM student_journal_entries AS entries
          INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
            AND journal_subjects.school_id = entries.school_id AND journal_subjects.is_active = TRUE
          INNER JOIN subjects ON subjects.id = journal_subjects.subject_id
            AND subjects.school_id = journal_subjects.school_id AND subjects.is_active = TRUE
          WHERE entries.school_id = ? AND entries.section_id = ?
            AND journal_subjects.subject_id = ?
            AND entries.submitted_at >= ? AND entries.submitted_at < DATE_ADD(?, INTERVAL 1 DAY)
            AND entries.student_user_id IN (${placeholders})
          ORDER BY entries.submitted_at, entries.id`,
          [schoolId, sectionId, section.journalSubjectId, evidenceStartDate, evidenceEndDate, ...studentIds]
        );
        journalRows.forEach(row => {
          const student = byStudent.get(String(row.studentId));
          if (!student || !dateWithinEnrollment(String(row.submittedAt).slice(0, 10), student)) return;
          student.journal.subjectName = row.subjectName;
          const entry = {
            entryId: String(row.entryId), subjectName: row.subjectName,
            promptText: row.promptText, entryText: row.entryText,
            status: row.entryStatus, submittedAt: row.submittedAt
          };
          student.journal.entries.push(entry);
          student.journal.sources.push({ entryId: entry.entryId, submittedAt: entry.submittedAt, status: entry.status });
        });
      }

      const [riskAttendance] = await database.execute(
        `SELECT records.student_user_id AS studentId, sessions.id AS sessionId,
          sessions.section_id AS sectionId, sessions.subject_id AS subjectId,
          DATE_FORMAT(sessions.attendance_date, '%Y-%m-%d') AS date,
          records.attendance_status AS status, COALESCE(subjects.name, 'All subjects') AS subjectName
        FROM attendance_sessions AS sessions
        INNER JOIN attendance_records AS records ON records.attendance_session_id = sessions.id
          AND records.school_id = sessions.school_id
        LEFT JOIN subjects ON subjects.id = sessions.subject_id AND subjects.school_id = sessions.school_id
          AND subjects.is_active = TRUE
        WHERE sessions.school_id = ? AND sessions.section_id = ? AND sessions.status = 'confirmed'
          AND (sessions.subject_id IS NULL OR subjects.id IS NOT NULL)
          AND sessions.attendance_date BETWEEN ? AND ?
        ORDER BY sessions.attendance_date, sessions.id`,
        [schoolId, sectionId, evidenceStartDate, evidenceEndDate]
      );
      const [gradeRows] = await database.execute(
        `SELECT grades.id AS gradeId, grades.student_user_id AS studentId,
          grades.subject_id AS subjectId, subjects.name AS subjectName,
          grades.final_grade AS finalGrade,
          DATE_FORMAT(grades.published_at, '%Y-%m-%dT%H:%i:%s') AS publishedAt,
          terms.sequence_number AS termSequence, terms.name AS termName,
          levels.level_code AS levelCode, levels.id AS schoolLevelId,
          levels.passing_grade_threshold AS levelPassingGradeThreshold,
          grade_levels.grade_code AS gradeCode
        FROM published_final_grades AS grades
        INNER JOIN academic_terms AS terms ON terms.id = grades.academic_term_id
          AND terms.academic_year_id = ? AND terms.school_level_id = ?
        INNER JOIN school_levels AS levels ON levels.id = terms.school_level_id
          AND levels.school_id = grades.school_id
        INNER JOIN school_grade_levels AS grade_levels ON grade_levels.school_id = grades.school_id
          AND grade_levels.id = ?
        INNER JOIN subjects ON subjects.id = grades.subject_id AND subjects.school_id = grades.school_id
          AND subjects.is_active = TRUE
        WHERE grades.school_id = ? AND grades.section_id = ?
          AND DATE(grades.published_at) BETWEEN ? AND ?
          AND grades.student_user_id IN (${placeholders})
        ORDER BY terms.sequence_number, grades.published_at, grades.id`,
        [section.academicYearId, section.schoolLevelId, section.gradeLevelId, schoolId, sectionId, evidenceStartDate, evidenceEndDate, ...studentIds]
      );
      const [scoreRows] = await database.execute(
        `SELECT scores.id AS scoreId, scores.student_user_id AS studentId, items.id AS itemId,
          items.subject_id AS subjectId, subjects.name AS subjectName,
          items.title, items.max_score AS maxScore, scores.score,
          DATE_FORMAT(items.recorded_at, '%Y-%m-%d') AS itemDate
        FROM student_scores AS scores
        INNER JOIN grading_items AS items ON items.id = scores.grading_item_id AND items.school_id = scores.school_id
          AND items.section_id = ? AND items.max_score > 0
        INNER JOIN academic_terms AS terms ON terms.id = items.academic_term_id
          AND terms.academic_year_id = ?
        INNER JOIN subjects ON subjects.id = items.subject_id AND subjects.school_id = items.school_id
          AND subjects.is_active = TRUE
        WHERE scores.school_id = ? AND scores.student_user_id IN (${placeholders})
          AND scores.score IS NOT NULL
          AND DATE(items.recorded_at) BETWEEN ? AND ?
          AND DATE(scores.recorded_at) <= ?
        ORDER BY items.recorded_at DESC, items.id DESC`,
        [sectionId, section.academicYearId, schoolId, ...studentIds, evidenceStartDate, evidenceEndDate, evidenceEndDate]
      );
      let shsGradeRows = [];
      let shsScoreRows = [];
      if (section.schoolLevelCode === 'shs' && process.env.SHS_SELECTION_ENABLED === 'true') {
        [shsGradeRows] = await database.execute(
          `SELECT grades.id AS gradeId, grades.student_user_id AS studentId,
            grades.shs_elective_class_id AS electiveClassId,
            offerings.subject_name AS subjectName, classes.class_name AS className,
            grades.final_grade AS finalGrade,
            DATE_FORMAT(grades.published_at, '%Y-%m-%dT%H:%i:%s') AS publishedAt,
            terms.sequence_number AS termSequence, terms.name AS termName,
            levels.level_code AS levelCode, levels.id AS schoolLevelId,
            levels.passing_grade_threshold AS levelPassingGradeThreshold,
            grade_levels.grade_code AS gradeCode
          FROM published_final_grades AS grades
          INNER JOIN shs_elective_classes AS classes ON classes.id = grades.shs_elective_class_id
            AND classes.school_id = grades.school_id
          INNER JOIN shs_offerings AS offerings ON offerings.id = classes.offering_id
            AND offerings.school_id = classes.school_id AND offerings.academic_year_id = ?
          INNER JOIN school_grade_levels AS grade_levels ON grade_levels.id = offerings.grade_level_id
            AND grade_levels.school_id = offerings.school_id
          INNER JOIN school_levels AS levels ON levels.id = grade_levels.school_level_id
            AND levels.school_id = grade_levels.school_id AND levels.level_code = 'shs'
          INNER JOIN academic_terms AS terms ON terms.id = grades.academic_term_id
            AND terms.academic_year_id = offerings.academic_year_id AND terms.school_level_id = levels.id
          WHERE grades.school_id = ? AND grades.student_user_id IN (${placeholders})
            AND DATE(grades.published_at) BETWEEN ? AND ?
            AND EXISTS (SELECT 1 FROM shs_elective_class_students AS members
              WHERE members.school_id = grades.school_id AND members.elective_class_id = classes.id
                AND members.student_user_id = grades.student_user_id)
          ORDER BY terms.sequence_number, grades.published_at, grades.id`,
          [section.academicYearId, schoolId, ...studentIds, evidenceStartDate, evidenceEndDate]
        );
        [shsScoreRows] = await database.execute(
          `SELECT scores.id AS scoreId, scores.student_user_id AS studentId, items.id AS itemId,
            items.shs_elective_class_id AS electiveClassId,
            offerings.subject_name AS subjectName, classes.class_name AS className,
            items.title, items.max_score AS maxScore, scores.score,
            DATE_FORMAT(items.recorded_at, '%Y-%m-%d') AS itemDate
          FROM student_scores AS scores
          INNER JOIN grading_items AS items ON items.id = scores.grading_item_id
            AND items.school_id = scores.school_id AND items.max_score > 0
          INNER JOIN shs_elective_classes AS classes ON classes.id = items.shs_elective_class_id
            AND classes.school_id = items.school_id
          INNER JOIN shs_offerings AS offerings ON offerings.id = classes.offering_id
            AND offerings.school_id = classes.school_id AND offerings.academic_year_id = ?
          INNER JOIN academic_terms AS terms ON terms.id = items.academic_term_id
            AND terms.academic_year_id = offerings.academic_year_id
          WHERE scores.school_id = ? AND scores.student_user_id IN (${placeholders})
            AND scores.score IS NOT NULL AND DATE(items.recorded_at) BETWEEN ? AND ?
            AND DATE(scores.recorded_at) <= ?
            AND EXISTS (SELECT 1 FROM shs_elective_class_students AS members
              WHERE members.school_id = scores.school_id AND members.elective_class_id = classes.id
                AND members.student_user_id = scores.student_user_id
                AND (members.withdrawn_at IS NULL OR DATE(items.recorded_at) <= DATE(members.withdrawn_at)))
          ORDER BY items.recorded_at DESC, items.id DESC`,
          [section.academicYearId, schoolId, ...studentIds, evidenceStartDate, evidenceEndDate, evidenceEndDate]
        );
      }
      const allGradeRows = gradeRows.concat(shsGradeRows);
      const allScoreRows = scoreRows.concat(shsScoreRows);
      const [riskSettingsRows] = await database.execute(
        `SELECT max_unexcused_absences AS maxUnexcusedAbsences,
          consecutive_absences_alert AS consecutiveAbsencesAlert,
          count_excused_absences AS countExcusedAbsences
        FROM school_attendance_settings WHERE school_id = ? LIMIT 1`,
        [schoolId]
      );
      const [gradeRules] = await database.execute(
        `SELECT school_level_id AS schoolLevelId, grading_mode AS gradingMode,
          passing_grade_threshold AS passingGradeThreshold
        FROM school_year_final_grade_rules
        WHERE school_id = ? AND academic_year_id = ?`,
        [schoolId, section.academicYearId]
      );
      const flags = buildStudentFlags({
        students: students.map(student => ({
          studentId: student.id, name: student.displayName, initials: student.initials,
          sectionId: String(sectionId), sectionName: section.sectionName, grade: section.gradeLevelName
        })),
        attendance: riskAttendance.concat(shsAttendanceRows.map(row => ({
          studentId: row.studentId, sectionId: null, subjectId: null,
          electiveClassId: row.electiveClassId, date: row.date,
          status: row.status, subjectName: row.subjectName, className: row.className
        }))).filter(row => {
          const student = byStudent.get(String(row.studentId));
          return student && dateWithinEnrollment(row.date, student);
        }),
        grades: allGradeRows.filter(row => {
          const learner = byStudent.get(String(row.studentId));
          return learner && dateWithinEnrollment(String(row.publishedAt).slice(0, 10), learner);
        }),
        scores: allScoreRows.filter(row => {
          const learner = byStudent.get(String(row.studentId));
          return learner && dateWithinEnrollment(String(row.itemDate).slice(0, 10), learner);
        }),
        rules: gradeRules,
        settings: riskSettingsRows[0] || {},
        yearLabel: section.academicYearLabel
      });
      const flagsByStudent = new Map(flags.map(flag => [flag.studentId, flag]));
      const weeklyScoresByStudent = new Map();
      allScoreRows.forEach(row => {
        const learner = byStudent.get(String(row.studentId));
        if (!learner || !dateWithinEnrollment(String(row.itemDate).slice(0, 10), learner)) return;
        if (!weeklyScoresByStudent.has(learner.id)) weeklyScoresByStudent.set(learner.id, []);
        weeklyScoresByStudent.get(learner.id).push(row);
      });
      const latestGradesByStudent = new Map();
      allGradeRows.forEach(grade => {
        const studentId = String(grade.studentId);
        const learner = byStudent.get(studentId);
        if (!learner || !dateWithinEnrollment(String(grade.publishedAt).slice(0, 10), learner)) return;
        const subjects = latestGradesByStudent.get(studentId) || new Map();
        const gradeKey = grade.electiveClassId ? `class:${grade.electiveClassId}` : `subject:${grade.subjectId}`;
        const current = subjects.get(gradeKey);
        if (!current || Number(grade.termSequence) > Number(current.termSequence) ||
          Number(grade.termSequence) === Number(current.termSequence) && String(grade.publishedAt) > String(current.publishedAt)) {
          subjects.set(gradeKey, grade);
        }
        latestGradesByStudent.set(studentId, subjects);
      });
      students.forEach(student => {
        const flag = flagsByStudent.get(student.id);
        student.followUpCandidate = Boolean(flag);
        student.candidateReasons = flag?.reasons || [];
        student.lowScoreReasons = student.candidateReasons.filter(reason => reason.type === 'low_scores');
        const weeklyScores = weeklyScoresByStudent.get(student.id) || [];
        const priorityIds = new Set(student.lowScoreReasons.flatMap(reason => reason.scores.map(score => score.scoreId)));
        const priority = weeklyScores.filter(row => priorityIds.has(String(row.scoreId)));
        const selected = [...priority, ...weeklyScores.filter(row => !priorityIds.has(String(row.scoreId)))].slice(0, 20);
        student.academicScores = selected.map(row => ({
          scoreId: String(row.scoreId), subjectName: row.subjectName,
          ...(row.electiveClassId ? { electiveClassId: String(row.electiveClassId), className: row.className } : {}),
          title: row.title,
          date: String(row.itemDate).slice(0, 10), score: Number(row.score), maxScore: Number(row.maxScore)
        }));
        student.academicScoresOmitted = Math.max(0, weeklyScores.length - selected.length);
        student.academicRecords = [...(latestGradesByStudent.get(student.id)?.values() || [])]
          .map(grade => ({
            gradeId: String(grade.gradeId), subjectId: grade.subjectId == null ? null : String(grade.subjectId),
            ...(grade.electiveClassId ? { electiveClassId: String(grade.electiveClassId), className: grade.className } : {}),
            subjectName: grade.subjectName,
            finalGrade: Number(grade.finalGrade), termName: grade.termName, publishedAt: grade.publishedAt
          }))
          .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
      });
    }

    return {
      section: {
        id: String(section.sectionId), name: section.sectionName,
        gradeLevel: section.gradeLevelName, academicYearId: String(section.academicYearId),
        academicYearLabel: section.academicYearLabel, journalApplicable
      },
      reportWeek: { ...period, dataThroughDate: evidenceEndDate },
      students: students.map(({ enrolledDate, withdrawnDate, ...student }) => student)
    };
}

async function getWeeklyEvidence(req, res, next) {
  try {
    const evidence = await buildWeeklyEvidence({
      schoolId: req.user?.schoolId, teacherId: req.user?.id,
      sectionId: req.query.sectionId, startDate: req.query.startDate
    });
    res.set('Cache-Control', 'no-store');
    res.json(evidence);
  } catch (error) { next(error); }
}

module.exports = {
  DEFAULT_WEEK, WEEKDAY_LABELS, addDays, buildWeeklyEvidence, getWeeklyEvidence, getWeeklySettings,
  isoWeekday, normalizeWeekSettings, reportWeekRange, reportSubmissionStatus, updateWeeklySettings
};
