const { getDatabase } = require('../config/database');
const { getSchoolLogoUrl } = require('../config/schoolLogos');

async function getSchoolContext(req, res, next) {
  try {
    const schoolId = req.user.schoolId;
    const database = getDatabase();
    const [[school]] = await database.execute(
      `SELECT schools.id, schools.name, schools.short_name AS shortName,
        schools.school_type AS schoolType, schools.school_email_domain AS schoolEmailDomain,
        schools.logo_path AS logoPath, schools.registration_status AS registrationStatus,
        schools.region_name AS regionName, schools.division_name AS divisionName,
        schools.district_name AS districtName, schools.address_line AS address,
        schools.phone, schools.email, schools.website,
        school_settings.current_school_year_label AS schoolYear,
        school_settings.journal_subject_id AS journalSubjectId,
        DATE_FORMAT(current_year.start_date, '%Y-%m-%d') AS schoolYearStartDate,
        DATE_FORMAT(current_year.end_date, '%Y-%m-%d') AS schoolYearEndDate,
        features.grades_enabled AS gradesEnabled,
        features.narrative_reports_enabled AS narrativeReportsEnabled,
        features.journals_enabled AS journalsEnabled,
        features.sf_templates_enabled AS sfTemplatesEnabled
      FROM schools
      LEFT JOIN school_settings ON school_settings.school_id = schools.id
      LEFT JOIN academic_years AS current_year ON current_year.school_id = schools.id
        AND current_year.label = school_settings.current_school_year_label
      LEFT JOIN school_portal_features AS features ON features.school_id = schools.id
      WHERE schools.id = ? LIMIT 1`,
      [schoolId]
    );
    if (!school) return res.status(404).json({ message: 'School not found.' });

    const [levels] = await database.execute(
      `SELECT id, level_code AS levelCode, display_name AS displayName,
        grading_period_type AS gradingPeriodType, is_enabled AS isEnabled
      FROM school_levels WHERE school_id = ? ORDER BY id`, [schoolId]
    );
    const [periods] = await database.execute(
      `SELECT academic_terms.id, school_levels.level_code AS schoolLevel,
        academic_terms.name, academic_terms.sequence_number AS sequence,
        academic_terms.status, academic_terms.planned_start_date AS plannedStartDate,
        academic_terms.planned_end_date AS plannedEndDate
      FROM academic_terms
      INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
      INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
      WHERE academic_terms.school_id = ? AND academic_years.label = ?
      ORDER BY school_levels.id, academic_terms.sequence_number`,
      [schoolId, school.schoolYear || '']
    );

    const divisions = Object.fromEntries(levels.filter(level => level.isEnabled).map(level => [level.levelCode, {
      name: level.displayName,
      gradingPeriodType: level.gradingPeriodType,
      academicPeriods: periods.filter(period => period.schoolLevel === level.levelCode),
      activeAcademicPeriodId: periods.find(period => period.schoolLevel === level.levelCode && period.status === 'active')?.id || null
    }]));
    res.json({ school: {
      id: school.id,
      name: school.name,
      shortName: school.shortName,
      schoolType: school.schoolType,
      schoolEmailDomain: school.schoolEmailDomain,
      logoUrl: getSchoolLogoUrl(school),
      regionName: school.regionName,
      divisionName: school.divisionName,
      districtName: school.districtName,
      address: school.address,
      phone: school.phone,
      email: school.email,
      website: school.website,
      platformStatus: school.registrationStatus,
      schoolYear: school.schoolYear,
      schoolYearStartDate: school.schoolYearStartDate,
      schoolYearEndDate: school.schoolYearEndDate,
      journalSubjectId: school.journalSubjectId,
      gradesPageEnabled: Boolean(school.gradesEnabled),
      narrativeReportsEnabled: Boolean(school.narrativeReportsEnabled),
      journalsEnabled: Boolean(school.journalsEnabled),
      attendanceEnabled: true,
      sfTemplatesEnabled: Boolean(school.sfTemplatesEnabled),
      schoolLevels: Object.keys(divisions),
      activeDivision: Object.keys(divisions)[0] || null,
      divisions
    } });
  } catch (error) { next(error); }
}

module.exports = { getSchoolContext };
