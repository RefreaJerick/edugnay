const { isDepedNumericalGradeCode } = require('../config/depedK10Grading');
const { consecutiveMissedMeetingDates } = require('./attendanceStreak');

function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function schoolToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function lowScoreReasons(scores = []) {
  const bySubject = new Map();
  for (const score of scores) {
    if (score.score == null || !Number.isFinite(Number(score.score)) || !(Number(score.maxScore) > 0)) continue;
    const key = score.electiveClassId
      ? `${score.studentId}:class:${score.electiveClassId}` : `${score.studentId}:subject:${score.subjectId}`;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(score);
  }
  const reasons = new Map();
  for (const items of bySubject.values()) {
    items.sort((a, b) => String(b.itemDate).localeCompare(String(a.itemDate)) || Number(b.itemId) - Number(a.itemId));
    const latest = items.slice(0, 3);
    if (latest.length !== 3 || !latest.every(item => Number(item.score) / Number(item.maxScore) < .75)) continue;
    const studentId = String(latest[0].studentId);
    if (!reasons.has(studentId)) reasons.set(studentId, []);
    reasons.get(studentId).push({ type: 'low_scores',
      subject: latest[0].className ? `${latest[0].subjectName} · ${latest[0].className}` : latest[0].subjectName,
      count: 3,
      scores: latest.map(item => ({ scoreId: String(item.scoreId), itemId: String(item.itemId), title: item.title,
        date: String(item.itemDate).slice(0, 10), score: Number(item.score), maxScore: Number(item.maxScore) })) });
  }
  for (const studentReasons of reasons.values()) studentReasons.sort((a, b) => a.subject.localeCompare(b.subject));
  return reasons;
}

function buildStudentFlags({ students, attendance, grades, rules, settings, yearLabel, scores = [] }) {
  const maximum = Number(settings?.maxUnexcusedAbsences ?? 5);
  const consecutive = Number(settings?.consecutiveAbsencesAlert ?? 3);
  const countExcused = Boolean(settings?.countExcusedAbsences);
  const studentMap = new Map(students.map(student => [String(student.studentId), {
    studentId: String(student.studentId), name: student.name, initials: student.initials,
    sectionId: String(student.sectionId), sectionName: student.sectionName,
    grade: student.grade, reasons: []
  }]));
  const days = new Map();
  const subjectRecords = new Map();
  for (const record of attendance) {
    const id = String(record.studentId);
    if (!studentMap.has(id)) continue;
    const dayKey = `${id}:${dateKey(record.date)}`;
    const day = days.get(dayKey) || { studentId: id, absent: false, excused: false };
    day.absent ||= record.status === 'absent';
    day.excused ||= record.status === 'excused';
    days.set(dayKey, day);
    const subjectKey = record.electiveClassId
      ? `${id}:class:${record.electiveClassId}` : `${id}:${record.sectionId}:${record.subjectId}`;
    if (!subjectRecords.has(subjectKey)) subjectRecords.set(subjectKey, []);
    subjectRecords.get(subjectKey).push(record);
  }
  const absenceCounts = new Map();
  for (const day of days.values()) {
    if (day.absent || countExcused && day.excused) {
      absenceCounts.set(day.studentId, (absenceCounts.get(day.studentId) || 0) + 1);
    }
  }
  for (const [id, student] of studentMap) {
    const count = absenceCounts.get(id) || 0;
    if (count >= maximum) student.reasons.push({ type: 'absence', count, threshold: maximum, includesExcused: countExcused });
  }
  for (const records of subjectRecords.values()) {
    const count = consecutiveMissedMeetingDates(records).length;
    const student = studentMap.get(String(records[0].studentId));
    if (count >= consecutive && (records[0].electiveClassId || student.sectionId === String(records[0].sectionId))) {
      student.reasons.push({
        type: 'consecutive', count, threshold: consecutive,
        subject: records[0].className
          ? `${records[0].subjectName} · ${records[0].className}` : records[0].subjectName
      });
    }
  }
  const latestGrades = new Map();
  for (const grade of grades) {
    const startYear = Number(String(yearLabel).match(/20\d{2}/)?.[0] || 0);
    const olderNumericalGrade = /^grade-(?:[4-9]|10)$/.test(grade.gradeCode) &&
      startYear > 0 && startYear < 2026;
    if (!studentMap.has(String(grade.studentId)) ||
      !['elementary', 'jhs'].includes(grade.levelCode) ||
      !(isDepedNumericalGradeCode(grade.gradeCode, yearLabel) || olderNumericalGrade)) continue;
    const key = `${grade.studentId}:${grade.subjectId}`;
    const previous = latestGrades.get(key);
    if (!previous || Number(grade.termSequence) > Number(previous.termSequence) ||
      Number(grade.termSequence) === Number(previous.termSequence) &&
      String(grade.publishedAt) > String(previous.publishedAt)) latestGrades.set(key, grade);
  }
  for (const grade of latestGrades.values()) {
    const rule = rules.find(item => String(item.schoolLevelId) === String(grade.schoolLevelId));
    const threshold = isDepedNumericalGradeCode(grade.gradeCode, yearLabel)
      ? rule?.gradingMode === 'school_specific' ? Number(rule.passingGradeThreshold) : 75
      : Number(grade.levelPassingGradeThreshold);
    if (Number(grade.finalGrade) < threshold) {
      studentMap.get(String(grade.studentId)).reasons.push({
        type: 'grade', subject: grade.subjectName, grade: Number(grade.finalGrade),
        threshold, term: grade.termName
      });
    }
  }
  for (const [studentId, reasons] of lowScoreReasons(scores)) {
    const student = studentMap.get(studentId);
    if (student) student.reasons.push(...reasons);
  }
  return [...studentMap.values()].filter(student => student.reasons.length)
    .sort((a, b) => a.name.localeCompare(b.name) || a.studentId.localeCompare(b.studentId));
}

async function getStudentFlags(database, { schoolId, yearId, teacherId = null }) {
  const [years] = await database.execute(
    `SELECT id, label FROM academic_years WHERE school_id = ? AND ${yearId ? 'id = ?' : "status = 'active'"} LIMIT 1`,
    yearId ? [schoolId, yearId] : [schoolId]
  );
  if (!years.length) return { students: [], maximum: 5 };
  const year = years[0];
  const [[settings]] = await database.execute(
    `SELECT max_unexcused_absences AS maxUnexcusedAbsences,
      consecutive_absences_alert AS consecutiveAbsencesAlert,
      count_excused_absences AS countExcusedAbsences
    FROM school_attendance_settings WHERE school_id = ?`, [schoolId]
  );
  const teacherScope = teacherId == null ? '' : `AND (sections.adviser_user_id = ? OR EXISTS (
    SELECT 1 FROM section_teachers AS access
    INNER JOIN subjects AS active_subject ON active_subject.id = access.subject_id
      AND active_subject.school_id = access.school_id AND active_subject.is_active = TRUE
    WHERE access.school_id = sections.school_id AND access.section_id = sections.id
      AND access.teacher_user_id = ?))`;
  const [roster] = await database.execute(
    `SELECT users.id AS studentId, users.display_name AS name, users.initials,
      sections.id AS sectionId, sections.name AS sectionName,
      school_grade_levels.display_name AS grade
    FROM section_students
    INNER JOIN sections ON sections.id = section_students.section_id
      AND sections.school_id = section_students.school_id
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
    INNER JOIN users ON users.id = section_students.student_user_id
      AND users.school_id = section_students.school_id AND users.role = 'student'
      AND users.account_status = 'active'
    WHERE section_students.school_id = ? AND sections.academic_year_id = ?
      ${teacherId == null ? '' : "AND section_students.withdrawn_at IS NULL AND sections.status = 'active'"}
      ${teacherScope}
    ORDER BY (section_students.withdrawn_at IS NULL) DESC,
      section_students.enrolled_at DESC, section_students.id DESC`,
    teacherId == null ? [schoolId, year.id] : [schoolId, year.id, teacherId, teacherId]
  );
  const students = [...new Map(roster.slice().reverse().map(row => [String(row.studentId), row])).values()];
  if (!students.length) return { students: [], maximum: Number(settings?.maxUnexcusedAbsences ?? 5) };
  const sectionIds = [...new Set(roster.map(row => Number(row.sectionId)))];
  const studentIds = students.map(row => Number(row.studentId));
  const placeholders = sectionIds.map(() => '?').join(', ');
  const studentPlaceholders = studentIds.map(() => '?').join(', ');
  const [attendance] = await database.execute(
    `SELECT records.student_user_id AS studentId, sessions.id AS sessionId,
      sessions.section_id AS sectionId, sessions.subject_id AS subjectId,
      DATE_FORMAT(sessions.attendance_date, '%Y-%m-%d') AS date,
      records.attendance_status AS status,
      subjects.name AS subjectName
    FROM attendance_records AS records
    INNER JOIN attendance_sessions AS sessions ON sessions.id = records.attendance_session_id
      AND sessions.school_id = records.school_id AND sessions.status = 'confirmed'
    INNER JOIN sections ON sections.id = sessions.section_id AND sections.school_id = sessions.school_id
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      AND academic_years.school_id = sections.school_id
    INNER JOIN subjects ON subjects.id = sessions.subject_id AND subjects.school_id = sessions.school_id
      AND subjects.is_active = TRUE
    WHERE sessions.school_id = ? AND sections.academic_year_id = ?
      AND sessions.section_id IN (${placeholders})
      AND records.student_user_id IN (${studentPlaceholders})
      AND sessions.attendance_date <= ?
      AND sessions.attendance_date BETWEEN academic_years.start_date AND academic_years.end_date`,
    [schoolId, year.id, ...sectionIds, ...studentIds, schoolToday()]
  );
  const [grades] = await database.execute(
    `SELECT published_final_grades.student_user_id AS studentId,
      published_final_grades.subject_id AS subjectId, subjects.name AS subjectName,
      published_final_grades.final_grade AS finalGrade,
      published_final_grades.published_at AS publishedAt,
      academic_terms.sequence_number AS termSequence, academic_terms.name AS termName,
      sections.school_level_id AS schoolLevelId,
      school_levels.level_code AS levelCode,
      school_levels.passing_grade_threshold AS levelPassingGradeThreshold,
      school_grade_levels.grade_code AS gradeCode
    FROM published_final_grades
    INNER JOIN sections ON sections.id = published_final_grades.section_id
      AND sections.school_id = published_final_grades.school_id
    INNER JOIN school_levels ON school_levels.id = sections.school_level_id
      AND school_levels.school_id = sections.school_id
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
    INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
      AND academic_terms.academic_year_id = sections.academic_year_id
      AND academic_terms.school_level_id = sections.school_level_id
    INNER JOIN subjects ON subjects.id = published_final_grades.subject_id
      AND subjects.is_active = TRUE
      AND subjects.school_id = published_final_grades.school_id
    WHERE published_final_grades.school_id = ? AND sections.academic_year_id = ?
      AND sections.id IN (${placeholders})
      AND published_final_grades.student_user_id IN (${studentPlaceholders})
      ${teacherId == null ? '' : `AND EXISTS (SELECT 1 FROM section_teachers AS assigned
        WHERE assigned.school_id = published_final_grades.school_id
          AND assigned.section_id = published_final_grades.section_id
          AND assigned.subject_id = published_final_grades.subject_id
          AND assigned.teacher_user_id = ?)`}`,
    teacherId == null ? [schoolId, year.id, ...sectionIds, ...studentIds]
      : [schoolId, year.id, ...sectionIds, ...studentIds, teacherId]
  );
  const [rules] = await database.execute(
    `SELECT school_level_id AS schoolLevelId, grading_mode AS gradingMode,
      passing_grade_threshold AS passingGradeThreshold
    FROM school_year_final_grade_rules WHERE school_id = ? AND academic_year_id = ?`,
    [schoolId, year.id]
  );
  const [[weekSettings] = []] = await database.execute(
    `SELECT narrative_report_week_start_day AS weekStartDay,
      narrative_report_week_end_day AS weekEndDay FROM school_settings WHERE school_id = ?`, [schoolId]
  );
  const today = schoolToday();
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay() || 7;
  const startDay = Number(weekSettings?.weekStartDay) || 1;
  const offset = (day - startDay + 7) % 7;
  const weekStart = new Date(`${today}T00:00:00.000Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - offset);
  const weekStartDate = weekStart.toISOString().slice(0, 10);
  const endOffset = (Number(weekSettings?.weekEndDay) || 6) - startDay + 7;
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + endOffset % 7);
  const weekEndDate = [weekEnd.toISOString().slice(0, 10), today].sort()[0];
  const [scores] = await database.execute(
    `SELECT scores.id AS scoreId, scores.student_user_id AS studentId, items.id AS itemId,
      items.section_id AS sectionId,
      items.subject_id AS subjectId, subjects.name AS subjectName,
      items.title, items.max_score AS maxScore, scores.score,
      DATE_FORMAT(items.recorded_at, '%Y-%m-%d') AS itemDate
    FROM student_scores AS scores
    INNER JOIN grading_items AS items ON items.id = scores.grading_item_id
      AND items.school_id = scores.school_id AND items.max_score > 0
    INNER JOIN academic_terms AS terms ON terms.id = items.academic_term_id
      AND terms.academic_year_id = ?
    INNER JOIN subjects ON subjects.id = items.subject_id AND subjects.school_id = items.school_id
      AND subjects.is_active = TRUE
    WHERE scores.school_id = ? AND items.section_id IN (${placeholders})
      AND scores.student_user_id IN (${studentPlaceholders}) AND scores.score IS NOT NULL
      AND DATE(items.recorded_at) BETWEEN ? AND ? AND DATE(scores.recorded_at) <= ?`,
    [year.id, schoolId, ...sectionIds, ...studentIds, weekStartDate, weekEndDate, weekEndDate]
  );
  return {
    students: buildStudentFlags({ students, attendance, grades, rules, settings, yearLabel: year.label,
      scores: scores.filter(score => String(students.find(student => String(student.studentId) === String(score.studentId))?.sectionId) === String(score.sectionId)) }),
    maximum: Number(settings?.maxUnexcusedAbsences ?? 5)
  };
}

module.exports = { buildStudentFlags, getStudentFlags, lowScoreReasons };
