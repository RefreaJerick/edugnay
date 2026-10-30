const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getDatabase } = require('../config/database');

function parseSchoolId(args = process.argv.slice(2)) {
  const index = args.indexOf('--school-id');
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || !/^\d+$/.test(String(value))) {
    throw new Error('Provide a positive --school-id.');
  }
  const schoolId = Number(value);
  if (!Number.isSafeInteger(schoolId) || schoolId < 1) {
    throw new Error('Provide a positive --school-id.');
  }
  return schoolId;
}

const subjectReferenceQueries = {
  sectionTeachers: `SELECT 'section_teacher' AS recordType, section_teachers.id AS recordId,
      section_teachers.section_id AS sectionId, NULL AS classId,
      section_teachers.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM section_teachers
    LEFT JOIN subjects ON subjects.id = section_teachers.subject_id
      AND subjects.school_id = section_teachers.school_id
    WHERE section_teachers.school_id = ? AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  assignments: `SELECT 'assignment' AS recordType, assignments.id AS recordId,
      assignments.section_id AS sectionId, NULL AS classId,
      assignments.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN assignments.subject_id IS NULL THEN 'unassigned'
        WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM assignments
    LEFT JOIN subjects ON subjects.id = assignments.subject_id
      AND subjects.school_id = assignments.school_id
    WHERE assignments.school_id = ? AND assignments.shs_elective_class_id IS NULL
      AND assignments.section_id IS NOT NULL
      AND (assignments.subject_id IS NULL OR subjects.id IS NULL OR subjects.is_active = FALSE)`,
  gradingItems: `SELECT 'grading_item' AS recordType, grading_items.id AS recordId,
      grading_items.section_id AS sectionId, NULL AS classId,
      grading_items.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN grading_items.subject_id IS NULL THEN 'unassigned'
        WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM grading_items
    LEFT JOIN subjects ON subjects.id = grading_items.subject_id
      AND subjects.school_id = grading_items.school_id
    WHERE grading_items.school_id = ? AND grading_items.shs_elective_class_id IS NULL
      AND grading_items.section_id IS NOT NULL
      AND (grading_items.subject_id IS NULL OR subjects.id IS NULL OR subjects.is_active = FALSE)`,
  publishedGrades: `SELECT 'published_final_grade' AS recordType, published_final_grades.id AS recordId,
      published_final_grades.section_id AS sectionId, NULL AS classId,
      published_final_grades.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN published_final_grades.subject_id IS NULL THEN 'unassigned'
        WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM published_final_grades
    LEFT JOIN subjects ON subjects.id = published_final_grades.subject_id
      AND subjects.school_id = published_final_grades.school_id
    WHERE published_final_grades.school_id = ? AND published_final_grades.shs_elective_class_id IS NULL
      AND published_final_grades.section_id IS NOT NULL
      AND (published_final_grades.subject_id IS NULL OR subjects.id IS NULL OR subjects.is_active = FALSE)`,
  attendanceSessions: `SELECT 'attendance_session' AS recordType, attendance_sessions.id AS recordId,
      attendance_sessions.section_id AS sectionId, NULL AS classId,
      attendance_sessions.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM attendance_sessions
    LEFT JOIN subjects ON subjects.id = attendance_sessions.subject_id
      AND subjects.school_id = attendance_sessions.school_id
    WHERE attendance_sessions.school_id = ? AND attendance_sessions.shs_elective_class_id IS NULL
      AND attendance_sessions.section_id IS NOT NULL AND attendance_sessions.subject_id IS NOT NULL
      AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  reopenRequests: `SELECT 'grading_period_reopen_request' AS recordType, grading_period_reopen_requests.id AS recordId,
      grading_period_reopen_requests.section_id AS sectionId, NULL AS classId,
      grading_period_reopen_requests.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM grading_period_reopen_requests
    LEFT JOIN subjects ON subjects.id = grading_period_reopen_requests.subject_id
      AND subjects.school_id = grading_period_reopen_requests.school_id
    WHERE grading_period_reopen_requests.school_id = ?
      AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  learningMaterials: `SELECT 'learning_material' AS recordType, learning_materials.id AS recordId,
      learning_materials.section_id AS sectionId, NULL AS classId,
      learning_materials.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN learning_materials.subject_id IS NULL THEN 'unassigned'
        WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM learning_materials
    LEFT JOIN subjects ON subjects.id = learning_materials.subject_id
      AND subjects.school_id = learning_materials.school_id
    WHERE learning_materials.school_id = ? AND learning_materials.shs_elective_class_id IS NULL
      AND learning_materials.section_id IS NOT NULL
      AND (learning_materials.subject_id IS NULL OR subjects.id IS NULL OR subjects.is_active = FALSE)`,
  subjectGradeScopes: `SELECT 'subject_grade_scope' AS recordType, subject_grade_scopes.id AS recordId,
      NULL AS sectionId, NULL AS classId, subject_grade_scopes.subject_id AS subjectId,
      subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM subject_grade_scopes
    LEFT JOIN subjects ON subjects.id = subject_grade_scopes.subject_id
      AND subjects.school_id = subject_grade_scopes.school_id
    WHERE subject_grade_scopes.school_id = ? AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  subjectGradingProfiles: `SELECT 'subject_grading_profile' AS recordType, subject_grading_profiles.id AS recordId,
      NULL AS sectionId, NULL AS classId, subject_grading_profiles.subject_id AS subjectId,
      subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM subject_grading_profiles
    LEFT JOIN subjects ON subjects.id = subject_grading_profiles.subject_id
      AND subjects.school_id = subject_grading_profiles.school_id
    WHERE subject_grading_profiles.school_id = ? AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  shsGradingProfiles: `SELECT 'shs_grading_profile' AS recordType, shs_grading_profiles.id AS recordId,
      NULL AS sectionId, NULL AS classId, shs_grading_profiles.subject_id AS subjectId,
      subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM shs_grading_profiles
    LEFT JOIN subjects ON subjects.id = shs_grading_profiles.subject_id
      AND subjects.school_id = shs_grading_profiles.school_id
    WHERE shs_grading_profiles.school_id = ? AND shs_grading_profiles.subject_id IS NOT NULL
      AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  shsGradeHistory: `SELECT 'shs_grade_publication_history' AS recordType, shs_grade_publication_history.id AS recordId,
      shs_grade_publication_history.section_id AS sectionId,
      shs_grade_publication_history.shs_elective_class_id AS classId,
      shs_grade_publication_history.subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM shs_grade_publication_history
    LEFT JOIN subjects ON subjects.id = shs_grade_publication_history.subject_id
      AND subjects.school_id = shs_grade_publication_history.school_id
    WHERE shs_grade_publication_history.school_id = ? AND shs_grade_publication_history.subject_id IS NOT NULL
      AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  journalSubjects: `SELECT 'journal_subject' AS recordType, journal_subjects.id AS recordId,
      NULL AS sectionId, NULL AS classId, journal_subjects.subject_id AS subjectId,
      subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM journal_subjects
    LEFT JOIN subjects ON subjects.id = journal_subjects.subject_id
      AND subjects.school_id = journal_subjects.school_id
    WHERE journal_subjects.school_id = ? AND (subjects.id IS NULL OR subjects.is_active = FALSE)`,
  schoolSettingsJournalSubject: `SELECT 'school_journal_subject' AS recordType,
      school_settings.school_id AS recordId, NULL AS sectionId, NULL AS classId,
      school_settings.journal_subject_id AS subjectId, subjects.name AS subjectName,
      CASE WHEN subjects.id IS NULL THEN 'missing' ELSE 'inactive' END AS subjectState
    FROM school_settings
    LEFT JOIN subjects ON subjects.id = school_settings.journal_subject_id
      AND subjects.school_id = school_settings.school_id
    WHERE school_settings.school_id = ? AND school_settings.journal_subject_id IS NOT NULL
      AND (subjects.id IS NULL OR subjects.is_active = FALSE)`
};

async function buildSubjectIntegrityReport(database, schoolId) {
  const subjectIssues = {};
  for (const [key, sql] of Object.entries(subjectReferenceQueries)) {
    const [rows] = await database.execute(sql, [schoolId]);
    subjectIssues[key] = rows;
  }

  const [periodAssignments] = await database.execute(
    `SELECT assignments.id AS assignmentId,
      assignments.shs_elective_class_id AS classId,
      shs_elective_classes.class_name AS className,
      shs_offerings.subject_name AS subjectName,
      DATE_FORMAT(assignments.due_at, '%Y-%m-%d') AS dueDate,
      COUNT(DISTINCT academic_terms.id) AS matchingPeriodCount,
      GROUP_CONCAT(DISTINCT academic_terms.id ORDER BY academic_terms.sequence_number) AS matchingPeriodIds
    FROM assignments
    INNER JOIN shs_elective_classes ON shs_elective_classes.id = assignments.shs_elective_class_id
      AND shs_elective_classes.school_id = assignments.school_id
    INNER JOIN shs_offerings ON shs_offerings.id = shs_elective_classes.offering_id
      AND shs_offerings.school_id = shs_elective_classes.school_id
    INNER JOIN school_grade_levels ON school_grade_levels.id = shs_offerings.grade_level_id
      AND school_grade_levels.school_id = shs_offerings.school_id
    LEFT JOIN academic_terms ON academic_terms.school_id = shs_offerings.school_id
      AND academic_terms.academic_year_id = shs_offerings.academic_year_id
      AND academic_terms.school_level_id = school_grade_levels.school_level_id
      AND DATE(assignments.due_at) BETWEEN academic_terms.planned_start_date AND academic_terms.planned_end_date
    WHERE assignments.school_id = ? AND assignments.shs_elective_class_id IS NOT NULL
      AND assignments.academic_term_id IS NULL
    GROUP BY assignments.id, assignments.shs_elective_class_id,
      shs_elective_classes.class_name, shs_offerings.subject_name, assignments.due_at
    HAVING COUNT(DISTINCT academic_terms.id) <> 1
    ORDER BY assignments.id`,
    [schoolId]
  );

  const [subjectForeignKeys] = await database.execute(
    `SELECT key_usage.TABLE_NAME AS tableName,
      key_usage.CONSTRAINT_NAME AS constraintName,
      key_usage.COLUMN_NAME AS columnName,
      referential_constraints.DELETE_RULE AS deleteRule
    FROM information_schema.KEY_COLUMN_USAGE AS key_usage
    INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS referential_constraints
      ON referential_constraints.CONSTRAINT_SCHEMA = key_usage.CONSTRAINT_SCHEMA
      AND referential_constraints.CONSTRAINT_NAME = key_usage.CONSTRAINT_NAME
      AND referential_constraints.TABLE_NAME = key_usage.TABLE_NAME
    WHERE key_usage.CONSTRAINT_SCHEMA = DATABASE()
      AND key_usage.REFERENCED_TABLE_NAME = 'subjects'
    ORDER BY key_usage.TABLE_NAME, key_usage.CONSTRAINT_NAME, key_usage.ORDINAL_POSITION`
  );

  return {
    schoolId: String(schoolId),
    generatedAt: new Date().toISOString(),
    subjectIssues,
    shsAssignmentsNeedingPeriodReview: periodAssignments,
    subjectForeignKeys
  };
}

async function main() {
  const schoolId = parseSchoolId();
  const database = getDatabase();
  try {
    const report = await buildSubjectIntegrityReport(database, schoolId);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Subject integrity report failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildSubjectIntegrityReport, parseSchoolId, subjectReferenceQueries };
