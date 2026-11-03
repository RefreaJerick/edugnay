// Preview by default. This command removes only old Grade 11
// combined communication records and their dependent class work.
// Preview: node scripts/purgeLegacyCommunication.js --database academix
// Apply:   node scripts/purgeLegacyCommunication.js --database academix --apply --confirm PURGE-LEGACY-COMMUNICATION-academix
const fs = require('node:fs/promises');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getPrivateStorageDirectory } = require('../config/privateStorage');
const { getDatabase } = require('../config/database');

const LEGACY_SCOPE = `school_grade_levels.grade_code = 'grade-11'
  AND subjects.subject_code = 'shs-core-communication'`;
const MIGRATION_COLUMNS = [
  ['section_teachers', 'communication_component_code'],
  ['grading_items', 'communication_component_code'],
  ['assignments', 'communication_component_code'],
  ['learning_materials', 'communication_component_code'],
  ['attendance_sessions', 'communication_component_code'],
  ['attendance_sessions', 'communication_component_scope_code'],
  ['shs_grade_publication_history', 'communication_component_code'],
  ['published_final_grades', 'communication_grade_source']
];
const UUID_UPLOAD = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|png|mp4)$/i;

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') continue;
    if (!['--database', '--confirm'].includes(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Use --database <name>, optionally with --apply --confirm PURGE-LEGACY-COMMUNICATION-<name>.');
    }
    values.set(argument, args[index + 1]);
    index += 1;
  }
  const databaseName = values.get('--database');
  if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('Provide the expected database name with --database.');
  const apply = args.includes('--apply');
  const confirmation = `PURGE-LEGACY-COMMUNICATION-${databaseName}`;
  if (apply && values.get('--confirm') !== confirmation) throw new Error(`Applying requires --confirm ${confirmation}.`);
  if (!apply && values.has('--confirm')) throw new Error('--confirm is only accepted with --apply.');
  return { databaseName, apply };
}

async function assertMigration060(connection) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const columns = new Set(rows.map(row => `${row.tableName}.${row.columnName}`));
  const [componentTable] = await connection.execute(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shs_communication_component_grades'`
  );
  const missing = MIGRATION_COLUMNS.filter(([table, column]) => !columns.has(`${table}.${column}`));
  if (missing.length || !componentTable.length) {
    throw new Error('Migration 060 is not fully applied in this database; no records were changed.');
  }
}

async function selectRows(connection, sql, values = []) {
  const [rows] = await connection.execute(sql, values);
  return rows;
}

async function selectIds(connection, table, joins, where) {
  const rows = await selectRows(connection,
    `SELECT ${table}.id AS id FROM ${table} ${joins} WHERE ${where}`);
  return rows.map(row => String(row.id));
}

function placeholders(ids) {
  return ids.map(() => '?').join(',');
}

async function collectPlan(connection) {
  const scopeJoins = `
    JOIN sections ON sections.id = TARGET.section_id AND sections.school_id = TARGET.school_id
    JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
    JOIN subjects ON subjects.id = TARGET.subject_id AND subjects.school_id = TARGET.school_id`;
  const scopedIds = async (table, legacyFilter = 'TARGET.communication_component_code IS NULL') => {
    const joins = scopeJoins.replaceAll('TARGET', table);
    return selectIds(connection, table, joins,
      `${LEGACY_SCOPE} AND ${legacyFilter.replaceAll('TARGET', table)}`);
  };

  const sectionTeacherRows = await selectRows(connection,
    `SELECT section_teachers.id AS assignmentId, section_teachers.school_id AS schoolId,
      section_teachers.section_id AS sectionId, section_teachers.subject_id AS subjectId,
      section_teachers.teacher_user_id AS teacherUserId, academic_years.label AS schoolYear,
      school_grade_levels.grade_code AS gradeCode, sections.name AS sectionName,
      subjects.name AS subjectName, subjects.subject_code AS subjectCode
     FROM section_teachers ${scopeJoins.replaceAll('TARGET', 'section_teachers')}
     JOIN academic_years ON academic_years.id = sections.academic_year_id
       AND academic_years.school_id = sections.school_id
     WHERE ${LEGACY_SCOPE} AND section_teachers.communication_component_code IS NULL`);
  const sectionTeacherIds = sectionTeacherRows.map(row => String(row.assignmentId));
  const assignments = await selectRows(connection,
    `SELECT assignments.id AS id, assignments.communication_component_code AS componentCode,
      assignments.section_id AS sectionId, assignments.subject_id AS subjectId
     FROM assignments ${scopeJoins.replaceAll('TARGET', 'assignments')}
     WHERE ${LEGACY_SCOPE} AND assignments.communication_component_code IS NULL
       AND assignments.shs_elective_class_id IS NULL`);
  const assignmentIds = assignments.map(row => String(row.id));
  const gradingItemIds = await scopedIds('grading_items');
  const materials = await selectRows(connection,
    `SELECT learning_materials.id AS id, learning_materials.stored_file_name AS storedFileName
     FROM learning_materials ${scopeJoins.replaceAll('TARGET', 'learning_materials')}
     WHERE ${LEGACY_SCOPE} AND learning_materials.communication_component_code IS NULL
       AND learning_materials.shs_elective_class_id IS NULL`);
  const materialIds = materials.map(row => String(row.id));
  const attendanceSessionIds = await scopedIds('attendance_sessions');
  const historyIds = await selectIds(connection, 'shs_grade_publication_history',
    `JOIN sections ON sections.id = shs_grade_publication_history.section_id
      AND sections.school_id = shs_grade_publication_history.school_id
     JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
     JOIN subjects ON subjects.id = shs_grade_publication_history.subject_id
      AND subjects.school_id = shs_grade_publication_history.school_id`,
    `${LEGACY_SCOPE} AND (shs_grade_publication_history.communication_component_code IS NULL
      OR shs_grade_publication_history.communication_component_code = 'legacy_combined')`);
  const publishedGradeIds = await selectIds(connection, 'published_final_grades',
    `JOIN sections ON sections.id = published_final_grades.section_id
      AND sections.school_id = published_final_grades.school_id
     JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
      AND school_grade_levels.school_id = sections.school_id
     JOIN subjects ON subjects.id = published_final_grades.subject_id
      AND subjects.school_id = published_final_grades.school_id`,
    `${LEGACY_SCOPE} AND (published_final_grades.communication_grade_source IS NULL
      OR published_final_grades.communication_grade_source = 'legacy_combined')`);

  const scheduledClassIds = sectionTeacherIds.length
    ? (await selectRows(connection,
      `SELECT id FROM scheduled_classes WHERE assignment_id IN (${placeholders(sectionTeacherIds)})`, sectionTeacherIds)).map(row => String(row.id))
    : [];
  const timetableMeetingIds = scheduledClassIds.length
    ? (await selectRows(connection,
      `SELECT id FROM timetable_meetings WHERE scheduled_class_id IN (${placeholders(scheduledClassIds)})`, scheduledClassIds)).map(row => String(row.id))
    : [];
  const assignmentSubmissions = assignmentIds.length
    ? await selectRows(connection,
      `SELECT id, file_path AS filePath FROM assignment_submissions
       WHERE assignment_id IN (${placeholders(assignmentIds)})`, assignmentIds)
    : [];
  const studentScoreIds = gradingItemIds.length
    ? (await selectRows(connection,
      `SELECT id FROM student_scores WHERE grading_item_id IN (${placeholders(gradingItemIds)})`, gradingItemIds)).map(row => String(row.id))
    : [];
  const correctionIds = gradingItemIds.length || historyIds.length
    ? (await selectRows(connection,
      `SELECT id FROM shs_grade_score_corrections
       WHERE ${gradingItemIds.length ? `grading_item_id IN (${placeholders(gradingItemIds)})` : 'FALSE'}
          OR ${historyIds.length ? `published_history_id IN (${placeholders(historyIds)})` : 'FALSE'}`,
      [...gradingItemIds, ...historyIds])).map(row => String(row.id))
    : [];
  const attendanceRecordIds = attendanceSessionIds.length
    ? (await selectRows(connection,
      `SELECT id FROM attendance_records WHERE attendance_session_id IN (${placeholders(attendanceSessionIds)})`, attendanceSessionIds)).map(row => String(row.id))
    : [];
  const qrScanEventIds = attendanceSessionIds.length
    ? (await selectRows(connection,
      `SELECT id FROM qr_scan_events WHERE attendance_session_id IN (${placeholders(attendanceSessionIds)})`, attendanceSessionIds)).map(row => String(row.id))
    : [];

  if (historyIds.length) {
    const [[componentReference]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM shs_communication_component_grades
       WHERE latest_history_id IN (${placeholders(historyIds)})`, historyIds);
    if (Number(componentReference.count)) {
      throw new Error('A legacy history row is referenced by a component grade. Cleanup stopped without changing data.');
    }
  }
  if (gradingItemIds.length) {
    const [[nonLegacyAssignment]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM assignments a
       INNER JOIN grading_items gi ON gi.id = a.grading_item_id
       WHERE gi.id IN (${placeholders(gradingItemIds)})
         AND NOT (a.communication_component_code IS NULL
           AND a.shs_elective_class_id IS NULL
           AND a.section_id = gi.section_id AND a.subject_id = gi.subject_id)`, gradingItemIds);
    if (Number(nonLegacyAssignment.count)) {
      throw new Error('A component or unrelated assignment references a legacy score item. Cleanup stopped without changing data.');
    }
  }

  return {
    sectionTeacherIds, sectionTeacherRows, assignmentIds, assignments, gradingItemIds, materialIds, materials,
    attendanceSessionIds, historyIds, publishedGradeIds, scheduledClassIds,
    timetableMeetingIds, assignmentSubmissions, studentScoreIds, correctionIds,
    attendanceRecordIds, qrScanEventIds
  };
}

function planCounts(plan) {
  return {
    section_teachers: plan.sectionTeacherIds.length,
    scheduled_classes: plan.scheduledClassIds.length,
    timetable_meetings: plan.timetableMeetingIds.length,
    assignments: plan.assignmentIds.length,
    assignment_submissions: plan.assignmentSubmissions.length,
    grading_items: plan.gradingItemIds.length,
    student_scores: plan.studentScoreIds.length,
    shs_grade_score_corrections: plan.correctionIds.length,
    published_final_grades: plan.publishedGradeIds.length,
    shs_grade_publication_history: plan.historyIds.length,
    attendance_sessions: plan.attendanceSessionIds.length,
    attendance_records: plan.attendanceRecordIds.length,
    qr_scan_events: plan.qrScanEventIds.length,
    learning_materials: plan.materialIds.length,
    submission_files: plan.assignmentSubmissions.filter(row => row.filePath).length,
    material_files: plan.materials.filter(row => row.storedFileName).length
  };
}

function affectedRecords(plan) {
  return {
    legacySectionAssignments: plan.sectionTeacherRows,
    timetables: {
      scheduled_classes: plan.scheduledClassIds,
      timetable_meetings: plan.timetableMeetingIds
    },
    classWork: {
      assignments: plan.assignments.map(row => ({ id: String(row.id), sectionId: String(row.sectionId), subjectId: String(row.subjectId) })),
      assignment_submissions: plan.assignmentSubmissions.map(row => String(row.id))
    },
    grades: {
      grading_items: plan.gradingItemIds,
      student_scores: plan.studentScoreIds,
      shs_grade_score_corrections: plan.correctionIds,
      published_final_grades: plan.publishedGradeIds,
      shs_grade_publication_history: plan.historyIds
    },
    attendance: {
      attendance_sessions: plan.attendanceSessionIds,
      attendance_records: plan.attendanceRecordIds,
      qr_scan_events: plan.qrScanEventIds
    },
    materials: plan.materials.map(row => ({ id: String(row.id), storedFileName: row.storedFileName || null }))
  };
}

async function deleteIds(connection, table, ids) {
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const [result] = await connection.execute(
      `DELETE FROM ${table} WHERE id IN (${placeholders(batch)})`, batch);
    if (result.affectedRows !== batch.length) throw new Error(`Delete count changed in ${table}; transaction rolled back.`);
  }
}

async function clearLegacyGradeLinks(connection, plan) {
  if (plan.gradingItemIds.length) {
    await connection.execute(
      `UPDATE journal_prompts SET grading_item_id = NULL
       WHERE grading_item_id IN (${placeholders(plan.gradingItemIds)})`, plan.gradingItemIds);
  }
  if (plan.historyIds.length) {
    await connection.execute(
      `UPDATE published_final_grades SET latest_history_id = NULL
       WHERE communication_grade_source = 'component_average'
         AND latest_history_id IN (${placeholders(plan.historyIds)})`, plan.historyIds);
  }
}

async function deletePlan(connection, plan) {
  await clearLegacyGradeLinks(connection, plan);
  await deleteIds(connection, 'attendance_records', plan.attendanceRecordIds);
  await deleteIds(connection, 'qr_scan_events', plan.qrScanEventIds);
  await deleteIds(connection, 'assignment_submissions', plan.assignmentSubmissions.map(row => String(row.id)));
  await deleteIds(connection, 'student_scores', plan.studentScoreIds);
  await deleteIds(connection, 'shs_grade_score_corrections', plan.correctionIds);
  await deleteIds(connection, 'timetable_meetings', plan.timetableMeetingIds);
  await deleteIds(connection, 'scheduled_classes', plan.scheduledClassIds);
  await deleteIds(connection, 'assignments', plan.assignmentIds);
  await deleteIds(connection, 'learning_materials', plan.materialIds);
  await deleteIds(connection, 'attendance_sessions', plan.attendanceSessionIds);
  await deleteIds(connection, 'published_final_grades', plan.publishedGradeIds);
  await deleteIds(connection, 'grading_items', plan.gradingItemIds);
  await deleteIds(connection, 'section_teachers', plan.sectionTeacherIds);
  await deleteIds(connection, 'shs_grade_publication_history', plan.historyIds);
}

function resolveUploadPath(filePath, directory, legacyDirectory) {
  const storedPath = String(filePath || '').replace(/\\/g, '/');
  const fileName = path.posix.basename(storedPath);
  if (!UUID_UPLOAD.test(fileName)) return null;
  const normalizedRelativePath = storedPath.replace(/^\/+/, '');
  const legacyPrefix = 'uploads/assignment-submissions/';
  const isLegacySubmission = normalizedRelativePath.startsWith(legacyPrefix)
    && normalizedRelativePath.slice(legacyPrefix.length) === fileName;
  if (!isLegacySubmission && normalizedRelativePath !== fileName) return null;
  const resolvedRoot = path.resolve(isLegacySubmission ? legacyDirectory : directory);
  const resolvedPath = path.resolve(resolvedRoot, fileName);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    ? resolvedPath : null;
}

async function cleanupFiles(plan) {
  const submissionDirectory = getPrivateStorageDirectory('ASSIGNMENT_SUBMISSION_DIRECTORY', 'assignment-submissions');
  const materialDirectory = getPrivateStorageDirectory('MATERIAL_UPLOAD_DIRECTORY', 'learning-materials');
  const legacySubmissionDirectory = path.resolve(__dirname, '..', 'uploads', 'assignment-submissions');
  const files = [
    ...plan.assignmentSubmissions.filter(row => row.filePath).map(row => resolveUploadPath(row.filePath, submissionDirectory, legacySubmissionDirectory)),
    ...plan.materials.filter(row => row.storedFileName).map(row => resolveUploadPath(row.storedFileName, materialDirectory, legacySubmissionDirectory))
  ];
  const pending = [];
  for (const file of new Set(files)) {
    if (!file) { pending.push('A linked upload has an unexpected filename and was not removed.'); continue; }
    try { await fs.unlink(file); }
    catch (error) {
      if (error.code !== 'ENOENT') pending.push(`${file}: ${error.message}`);
    }
  }
  return pending;
}

async function run(args = process.argv.slice(2), providedPool) {
  const { databaseName, apply } = parseArguments(args);
  const pool = providedPool || getDatabase();
  const ownsPool = !providedPool;
  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    const [[database]] = await connection.execute('SELECT DATABASE() AS databaseName');
    if (database?.databaseName !== databaseName) throw new Error('Connected database does not match --database. No records were changed.');
    await assertMigration060(connection);
    if (apply) {
      getPrivateStorageDirectory('ASSIGNMENT_SUBMISSION_DIRECTORY', 'assignment-submissions');
      getPrivateStorageDirectory('MATERIAL_UPLOAD_DIRECTORY', 'learning-materials');
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const plan = await collectPlan(connection);
    const counts = planCounts(plan);
    const records = affectedRecords(plan);
    if (apply) {
      await deletePlan(connection, plan);
      await connection.commit();
      transactionStarted = false;
      const pendingFiles = await cleanupFiles(plan);
      process.stdout.write(`${JSON.stringify({ database: databaseName, applied: true, counts, affectedRecords: records, pendingFiles }, null, 2)}\n`);
      return { counts, pendingFiles };
    }
    await connection.rollback();
    transactionStarted = false;
    process.stdout.write(`${JSON.stringify({ database: databaseName, applied: false, counts, affectedRecords: records, applyConfirmation: `PURGE-LEGACY-COMMUNICATION-${databaseName}` }, null, 2)}\n`);
    return { counts };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
    if (ownsPool) await pool.end();
  }
}

if (require.main === module) run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { assertMigration060, parseArguments, planCounts, resolveUploadPath, run };
