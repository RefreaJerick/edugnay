const { getDatabase } = require('../config/database');

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

function percentage(passing, total) {
  return Number(total) ? Math.round((Number(passing) / Number(total)) * 1000) / 10 : null;
}

async function getYear(database, schoolId, yearId) {
  const [years] = await database.execute(
    `SELECT academic_years.id, academic_years.school_id AS schoolId,
      academic_years.label, DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS endDate, academic_years.status,
      academic_years.archived_at AS archivedAt, academic_years.archive_snapshot AS archiveSnapshot,
      archiver.display_name AS archivedBy
    FROM academic_years
    LEFT JOIN users AS archiver ON archiver.id = academic_years.archived_by_user_id
    WHERE academic_years.id = ? AND academic_years.school_id = ? LIMIT 1`,
    [yearId, schoolId]
  );
  return years[0] || null;
}

async function getReadiness(database, schoolId, yearId, yearStatus) {
  const [[counts]] = await database.execute(
    `SELECT COUNT(DISTINCT school_levels.id) AS enabledLevels,
      COUNT(DISTINCT CASE WHEN academic_terms.id IS NOT NULL THEN school_levels.id END) AS levelsWithTerms,
      COUNT(academic_terms.id) AS termCount,
      COALESCE(SUM(CASE WHEN academic_terms.id IS NOT NULL AND academic_terms.status <> 'closed' THEN 1 ELSE 0 END), 0) AS unfinishedTerms
    FROM school_levels
    LEFT JOIN academic_terms ON academic_terms.school_level_id = school_levels.id
      AND academic_terms.academic_year_id = ?
    WHERE school_levels.school_id = ? AND school_levels.is_enabled = TRUE`,
    [yearId, schoolId]
  );

  let message = '';
  if (yearStatus !== 'closed') message = 'Only a closed school year can be archived.';
  else if (!Number(counts.enabledLevels) || !Number(counts.termCount) || Number(counts.enabledLevels) !== Number(counts.levelsWithTerms)) {
    message = 'Enable at least one school level and add grading periods for every enabled level before archiving.';
  } else if (Number(counts.unfinishedTerms)) message = 'Complete every grading period before archiving.';

  return {
    canArchive: !message,
    message,
    yearClosed: yearStatus === 'closed',
    hasTermsForEachLevel: Number(counts.enabledLevels) > 0 && Number(counts.enabledLevels) === Number(counts.levelsWithTerms) && Number(counts.termCount) > 0,
    allTermsClosed: Number(counts.termCount) > 0 && Number(counts.unfinishedTerms) === 0,
    termCount: Number(counts.termCount),
    unfinishedTerms: Number(counts.unfinishedTerms)
  };
}

async function getYearStatistics(database, schoolId, yearId) {
  const [[row]] = await database.execute(
    `SELECT
      (SELECT COUNT(DISTINCT section_students.student_user_id)
        FROM sections AS student_sections
        INNER JOIN section_students ON section_students.section_id = student_sections.id
        WHERE student_sections.academic_year_id = ? AND student_sections.school_id = ?) AS students,
      (SELECT COUNT(*) FROM sections
        WHERE academic_year_id = ? AND school_id = ?) AS sections,
      (SELECT COUNT(DISTINCT section_teachers.teacher_user_id)
        FROM sections AS teacher_sections
        INNER JOIN section_teachers ON section_teachers.section_id = teacher_sections.id
        WHERE teacher_sections.academic_year_id = ? AND teacher_sections.school_id = ?) AS teachers,
      (SELECT COUNT(*) FROM published_final_grades
        INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
          AND academic_terms.school_id = published_final_grades.school_id
        WHERE academic_terms.academic_year_id = ? AND published_final_grades.school_id = ?) AS gradeCount,
      (SELECT COALESCE(SUM(published_final_grades.final_grade >= school_levels.passing_grade_threshold), 0)
        FROM published_final_grades
        INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
          AND academic_terms.school_id = published_final_grades.school_id
        INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
        WHERE academic_terms.academic_year_id = ? AND published_final_grades.school_id = ?) AS passingGrades,
      (SELECT COUNT(*) FROM attendance_records
        INNER JOIN attendance_sessions ON attendance_sessions.id = attendance_records.attendance_session_id
          AND attendance_sessions.status = 'confirmed'
        INNER JOIN sections AS attendance_sections ON attendance_sections.id = attendance_sessions.section_id
        WHERE attendance_sections.academic_year_id = ? AND attendance_sessions.school_id = ?) AS attendanceCount,
      (SELECT COALESCE(SUM(attendance_records.attendance_status IN ('present', 'late')), 0)
        FROM attendance_records
        INNER JOIN attendance_sessions ON attendance_sessions.id = attendance_records.attendance_session_id
          AND attendance_sessions.status = 'confirmed'
        INNER JOIN sections AS attendance_sections ON attendance_sections.id = attendance_sessions.section_id
        WHERE attendance_sections.academic_year_id = ? AND attendance_sessions.school_id = ?) AS attendedCount`,
    [yearId, schoolId, yearId, schoolId, yearId, schoolId, yearId, schoolId, yearId, schoolId, yearId, schoolId, yearId, schoolId]
  );

  return {
    students: Number(row.students),
    sections: Number(row.sections),
    teachers: Number(row.teachers),
    gradeCount: Number(row.gradeCount),
    passingGrades: Number(row.passingGrades),
    passRate: percentage(row.passingGrades, row.gradeCount),
    attendanceRate: percentage(row.attendedCount, row.attendanceCount)
  };
}

async function getAcademicPeriods(database, schoolId, yearId) {
  const [terms] = await database.execute(
    `SELECT academic_terms.id, academic_terms.name AS label,
      DATE_FORMAT(academic_terms.planned_start_date, '%b %e, %Y') AS startDate,
      DATE_FORMAT(academic_terms.planned_end_date, '%b %e, %Y') AS endDate,
      COUNT(published_final_grades.id) AS gradeCount,
      COALESCE(SUM(published_final_grades.final_grade >= school_levels.passing_grade_threshold), 0) AS passingGrades
    FROM academic_terms
    INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
    INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
    LEFT JOIN published_final_grades ON published_final_grades.academic_term_id = academic_terms.id
      AND published_final_grades.school_id = academic_years.school_id
    WHERE academic_years.id = ? AND academic_years.school_id = ?
    GROUP BY academic_terms.id, academic_terms.name, academic_terms.sequence_number,
      academic_terms.planned_start_date, academic_terms.planned_end_date,
      school_levels.passing_grade_threshold
    ORDER BY school_levels.id, academic_terms.sequence_number`,
    [yearId, schoolId]
  );
  return terms.map(term => ({
    id: String(term.id),
    label: term.label,
    period: `${term.startDate} – ${term.endDate}`,
    passRate: percentage(term.passingGrades, term.gradeCount)
  }));
}

async function getSectionSummaries(database, schoolId, yearId) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.name, school_grade_levels.display_name AS grade,
      (SELECT COUNT(*) FROM section_students
        WHERE section_students.school_id = sections.school_id
          AND section_students.section_id = sections.id) AS students,
      (SELECT COUNT(*) FROM published_final_grades
        INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
        WHERE published_final_grades.school_id = sections.school_id
          AND published_final_grades.section_id = sections.id
          AND academic_terms.academic_year_id = sections.academic_year_id) AS gradeCount,
      (SELECT COALESCE(SUM(published_final_grades.final_grade >= school_levels.passing_grade_threshold), 0)
        FROM published_final_grades
        INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
        WHERE published_final_grades.school_id = sections.school_id
          AND published_final_grades.section_id = sections.id
          AND academic_terms.academic_year_id = sections.academic_year_id) AS passingGrades
    FROM sections
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
    INNER JOIN school_levels ON school_levels.id = sections.school_level_id
    WHERE sections.school_id = ? AND sections.academic_year_id = ?
    ORDER BY school_grade_levels.sort_order, sections.name`,
    [schoolId, yearId]
  );
  return sections.map(section => ({
    id: String(section.id),
    name: section.name,
    grade: section.grade,
    students: Number(section.students),
    passRate: percentage(section.passingGrades, section.gradeCount)
  }));
}

async function getArchiveDetails(database, schoolId, yearId) {
  const year = await getYear(database, schoolId, yearId);
  if (!year || year.status !== 'archived') throw createError('Archived school year was not found.', 404);
  let snapshot = year.archiveSnapshot;
  if (typeof snapshot === 'string') snapshot = JSON.parse(snapshot);
  if (!snapshot || typeof snapshot !== 'object') {
    const [statistics, academicPeriods, sectionsTable] = await Promise.all([
      getYearStatistics(database, schoolId, yearId),
      getAcademicPeriods(database, schoolId, yearId),
      getSectionSummaries(database, schoolId, yearId)
    ]);
    snapshot = { ...statistics, academicPeriods, sectionsTable };
  }
  const { archiveSnapshot, ...visibleYear } = year;
  return { ...visibleYear, ...snapshot };
}

async function listArchives(req, res, next) {
  try {
    const database = getDatabase();
    const schoolId = req.user.schoolId;
    const [archivedRows] = await database.execute(
      `SELECT id, label, status FROM academic_years
      WHERE school_id = ? AND status = 'archived' ORDER BY start_date DESC, id DESC`,
      [schoolId]
    );
    const archivedYears = [];
    for (const row of archivedRows) archivedYears.push(await getArchiveDetails(database, schoolId, row.id));

    const [closedYears] = await database.execute(
      `SELECT id, label, status FROM academic_years
      WHERE school_id = ? AND status = 'closed' ORDER BY start_date DESC, id DESC`,
      [schoolId]
    );
    const archiveCandidates = [];
    for (const year of closedYears) {
      const readiness = await getReadiness(database, schoolId, year.id, year.status);
      archiveCandidates.push({ ...year, ...readiness });
    }

    const gradeCount = archivedYears.reduce((total, year) => total + Number(year.gradeCount || 0), 0);
    const passingGrades = archivedYears.reduce((total, year) => total + Number(year.passingGrades || 0), 0);

    res.set('Cache-Control', 'no-store');
    res.json({
      summary: {
        archivedYears: archivedYears.length,
        students: archivedYears.reduce((sum, year) => sum + year.students, 0),
        sections: archivedYears.reduce((sum, year) => sum + year.sections, 0),
        averagePassRate: percentage(passingGrades, gradeCount)
      },
      archivedYears,
      archiveCandidates
    });
  } catch (error) { next(error); }
}

async function getArchiveYear(req, res, next) {
  try {
    const yearId = parseId(req.params.yearId, 'academic year ID');
    const archive = await getArchiveDetails(getDatabase(), req.user.schoolId, yearId);
    res.set('Cache-Control', 'no-store');
    res.json({ archive });
  } catch (error) { next(error); }
}

async function archiveAcademicYear(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    const yearId = parseId(req.params.yearId, 'academic year ID');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [years] = await connection.execute(
      'SELECT id, label, status FROM academic_years WHERE id = ? AND school_id = ? LIMIT 1 FOR UPDATE',
      [yearId, req.user.schoolId]
    );
    const year = years[0];
    if (!year) throw createError('School year was not found.', 404);
    if (year.status === 'archived') throw createError('This school year has already been archived.', 409);
    const readiness = await getReadiness(connection, req.user.schoolId, yearId, year.status);
    if (!readiness.canArchive) throw createError(readiness.message, 409);

    const [statistics, academicPeriods, sectionsTable] = await Promise.all([
      getYearStatistics(connection, req.user.schoolId, yearId),
      getAcademicPeriods(connection, req.user.schoolId, yearId),
      getSectionSummaries(connection, req.user.schoolId, yearId)
    ]);
    const archiveSnapshot = JSON.stringify({ ...statistics, academicPeriods, sectionsTable });

    const [archiveResult] = await connection.execute(
      `UPDATE academic_years SET status = 'archived', archived_at = NOW(), archived_by_user_id = ?, archive_snapshot = ?
      WHERE id = ? AND school_id = ? AND status = 'closed'`,
      [req.user.id, archiveSnapshot, yearId, req.user.schoolId]
    );
    if (!archiveResult.affectedRows) throw createError('This school year changed before it could be archived. Reload and try again.', 409);
    await connection.execute(
      `UPDATE sections SET status = 'archived'
      WHERE academic_year_id = ? AND school_id = ? AND status <> 'archived'`,
      [yearId, req.user.schoolId]
    );
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'academic_year_archived', 'academic_year', ?, JSON_OBJECT('label', ?, 'summary', ?))`,
      [req.user.schoolId, req.user.id, yearId, year.label, `S.Y. ${year.label}`]
    );

    const archive = await getArchiveDetails(connection, req.user.schoolId, yearId);
    await connection.commit();
    transactionStarted = false;
    res.status(200).json({ message: `S.Y. ${year.label} was archived successfully.`, archive });
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    next(error);
  } finally {
    connection?.release();
  }
}

module.exports = { archiveAcademicYear, getArchiveYear, listArchives };
