const { getDatabase } = require('../config/database');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseAcademicYearId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError('Invalid academic year.');
  return id;
}

async function getSchoolGradeSummary(req, res, next) {
  try {
    const database = getDatabase();
    const schoolId = req.user.schoolId;
    res.set('Cache-Control', 'no-store');
    const yearId = req.query.academicYearId === undefined
      ? null
      : parseAcademicYearId(req.query.academicYearId);
    const yearValues = yearId ? [yearId, schoolId] : [schoolId];
    const yearFilter = yearId ? 'id = ? AND school_id = ?' : "school_id = ? AND status = 'active'";
    const [years] = await database.execute(
      `SELECT id, label FROM academic_years WHERE ${yearFilter} ORDER BY start_date DESC LIMIT 1`,
      yearValues
    );
    const academicYear = years[0] || null;
    if (yearId && !academicYear) throw createError('Academic year not found.', 404);

    if (!academicYear) {
      return res.json({ academicYear: null, subjectPerformance: [], gradeOutcome: null });
    }

    const [rows] = await database.execute(
      `SELECT school_grade_levels.display_name AS grade,
        school_grade_levels.sort_order AS gradeSort,
        subjects.name AS subject,
        AVG(published_final_grades.final_grade) AS averageGrade,
        COUNT(*) AS total,
        SUM(CASE WHEN published_final_grades.final_grade >= school_levels.passing_grade_threshold THEN 1 ELSE 0 END) AS passing,
        SUM(CASE WHEN published_final_grades.final_grade >= 90 THEN 1 ELSE 0 END) AS band90,
        SUM(CASE WHEN published_final_grades.final_grade >= 80 AND published_final_grades.final_grade < 90 THEN 1 ELSE 0 END) AS band80,
        SUM(CASE WHEN published_final_grades.final_grade >= 75 AND published_final_grades.final_grade < 80 THEN 1 ELSE 0 END) AS band75,
        SUM(CASE WHEN published_final_grades.final_grade < 75 THEN 1 ELSE 0 END) AS bandBelow75
      FROM published_final_grades
      INNER JOIN sections ON sections.id = published_final_grades.section_id
        AND sections.school_id = published_final_grades.school_id
      INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
        AND academic_years.school_id = published_final_grades.school_id
      INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
        AND academic_terms.academic_year_id = sections.academic_year_id
        AND academic_terms.school_level_id = sections.school_level_id
      INNER JOIN school_levels ON school_levels.id = sections.school_level_id
        AND school_levels.school_id = sections.school_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_level_id = sections.school_level_id
      INNER JOIN subjects ON subjects.id = published_final_grades.subject_id
        AND subjects.school_id = published_final_grades.school_id
      INNER JOIN users AS students ON students.id = published_final_grades.student_user_id
        AND students.school_id = published_final_grades.school_id
        AND students.role = 'student'
      WHERE published_final_grades.school_id = ? AND academic_years.id = ?
      GROUP BY school_grade_levels.id, school_grade_levels.display_name,
        school_grade_levels.sort_order, subjects.id, subjects.name
      ORDER BY school_grade_levels.sort_order, averageGrade DESC, subjects.name`,
      [schoolId, academicYear.id]
    );

    const gradesByLevel = new Map();
    const totals = { passing: 0, total: 0, band90: 0, band80: 0, band75: 0, bandBelow75: 0 };
    rows.forEach(row => {
      const grade = gradesByLevel.get(row.grade) || { grade: row.grade, rows: [] };
      const average = Number(row.averageGrade);
      grade.rows.push({
        subject: row.subject,
        score: Math.round(average * 10) / 10,
        tone: average >= 90 ? 'high' : average >= 80 ? 'mid' : 'low'
      });
      gradesByLevel.set(row.grade, grade);
      Object.keys(totals).forEach(key => { totals[key] += Number(row[key]) || 0; });
    });

    const percentage = count => totals.total ? Math.round(count / totals.total * 100) : 0;
    const gradeOutcome = totals.total ? {
      passing: totals.passing,
      failing: totals.total - totals.passing,
      total: totals.total,
      distribution: [
        { label: '90 to 100', value: totals.band90, percent: percentage(totals.band90), color: 'var(--green)' },
        { label: '80 to 89', value: totals.band80, percent: percentage(totals.band80), color: 'var(--blue-mid)' },
        { label: '75 to 79', value: totals.band75, percent: percentage(totals.band75), color: 'var(--orange)' },
        { label: 'Below 75', value: totals.bandBelow75, percent: percentage(totals.bandBelow75), color: 'var(--red)' }
      ]
    } : null;

    res.json({
      academicYear: { id: String(academicYear.id), label: academicYear.label },
      subjectPerformance: Array.from(gradesByLevel.values()),
      gradeOutcome
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSchoolGradeSummary };
