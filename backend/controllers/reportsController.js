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
        SUM(CASE WHEN published_final_grades.final_grade >= CASE
          WHEN school_levels.level_code = 'shs' THEN 75
          WHEN school_levels.level_code IN ('elementary', 'jhs')
            AND (school_grade_levels.grade_code IN ('grade-4', 'grade-5', 'grade-6',
              'grade-7', 'grade-8', 'grade-9', 'grade-10')
              OR school_grade_levels.grade_code IN ('grade-2', 'grade-3')
                AND SUBSTRING(academic_years.label, NULLIF(LOCATE('20', academic_years.label), 0), 4) = '2026')
            AND CAST(SUBSTRING(academic_years.label, NULLIF(LOCATE('20', academic_years.label), 0), 4) AS UNSIGNED) >= 2026
          THEN CASE WHEN final_grade_rules.grading_mode = 'school_specific'
            THEN final_grade_rules.passing_grade_threshold ELSE 75 END
          ELSE school_levels.passing_grade_threshold
        END THEN 1 ELSE 0 END) AS passing,
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
      LEFT JOIN school_year_final_grade_rules AS final_grade_rules
        ON final_grade_rules.school_id = published_final_grades.school_id
        AND final_grade_rules.academic_year_id = sections.academic_year_id
        AND final_grade_rules.school_level_id = sections.school_level_id
      INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
        AND school_grade_levels.school_level_id = sections.school_level_id
      INNER JOIN subjects ON subjects.id = published_final_grades.subject_id
        AND subjects.school_id = published_final_grades.school_id AND subjects.is_active = TRUE
      INNER JOIN users AS students ON students.id = published_final_grades.student_user_id
        AND students.school_id = published_final_grades.school_id
        AND students.role = 'student'
      WHERE published_final_grades.school_id = ? AND academic_years.id = ?
        AND (school_levels.level_code <> 'shs' OR (
          ? = TRUE AND sections.shs_curriculum_code = 'strengthened_2026'
          AND school_grade_levels.grade_code IN ('grade-11', 'grade-12')
          AND YEAR(academic_years.start_date) >= 2026
          ))
      GROUP BY school_grade_levels.id, school_grade_levels.display_name,
        school_grade_levels.sort_order, subjects.id, subjects.name
      ORDER BY school_grade_levels.sort_order, averageGrade DESC, subjects.name`,
      [schoolId, academicYear.id, process.env.SHS_SELECTION_ENABLED === 'true']
    );

    if (process.env.SHS_SELECTION_ENABLED === 'true') {
      const [electiveRows] = await database.execute(
        `SELECT school_grade_levels.display_name AS grade,
          school_grade_levels.sort_order AS gradeSort,
          shs_offerings.subject_name AS subject,
          AVG(published_final_grades.final_grade) AS averageGrade,
          COUNT(*) AS total,
          SUM(CASE WHEN published_final_grades.final_grade >= 75 THEN 1 ELSE 0 END) AS passing,
          SUM(CASE WHEN published_final_grades.final_grade >= 90 THEN 1 ELSE 0 END) AS band90,
          SUM(CASE WHEN published_final_grades.final_grade >= 80 AND published_final_grades.final_grade < 90 THEN 1 ELSE 0 END) AS band80,
          SUM(CASE WHEN published_final_grades.final_grade >= 75 AND published_final_grades.final_grade < 80 THEN 1 ELSE 0 END) AS band75,
          SUM(CASE WHEN published_final_grades.final_grade < 75 THEN 1 ELSE 0 END) AS bandBelow75
         FROM published_final_grades
         INNER JOIN shs_elective_classes ON shs_elective_classes.id = published_final_grades.shs_elective_class_id
           AND shs_elective_classes.school_id = published_final_grades.school_id
         INNER JOIN shs_offerings ON shs_offerings.id = shs_elective_classes.offering_id
           AND shs_offerings.school_id = shs_elective_classes.school_id
         INNER JOIN school_grade_levels ON school_grade_levels.id = shs_offerings.grade_level_id
           AND school_grade_levels.school_id = published_final_grades.school_id
         INNER JOIN school_levels ON school_levels.id = school_grade_levels.school_level_id
           AND school_levels.school_id = school_grade_levels.school_id
         INNER JOIN academic_years ON academic_years.id = shs_offerings.academic_year_id
           AND academic_years.school_id = shs_offerings.school_id
         INNER JOIN academic_terms ON academic_terms.id = published_final_grades.academic_term_id
           AND academic_terms.school_id = published_final_grades.school_id
           AND academic_terms.academic_year_id = academic_years.id
           AND academic_terms.school_level_id = school_levels.id
         INNER JOIN users AS students ON students.id = published_final_grades.student_user_id
           AND students.school_id = published_final_grades.school_id AND students.role = 'student'
         WHERE published_final_grades.school_id = ? AND academic_years.id = ?
           AND published_final_grades.section_id IS NULL AND published_final_grades.subject_id IS NULL
           AND school_levels.level_code = 'shs'
           AND school_grade_levels.grade_code IN ('grade-11', 'grade-12')
           AND YEAR(academic_years.start_date) >= 2026
         GROUP BY school_grade_levels.id, school_grade_levels.display_name,
           school_grade_levels.sort_order, shs_offerings.subject_name
         ORDER BY school_grade_levels.sort_order, averageGrade DESC, shs_offerings.subject_name`,
        [schoolId, academicYear.id]
      );
      rows.push(...electiveRows);
    }

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
