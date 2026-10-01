const { getDatabase } = require('../config/database');
const { notifyParents } = require('../utils/parentNotifications');

async function checkAssignments(database) {
  const [rows] = await database.execute(
    `SELECT assignments.id, assignments.school_id AS schoolId, assignments.section_id AS sectionId,
      assignments.subject_id AS subjectId, assignments.online_submission_enabled AS onlineSubmissionEnabled,
      section_students.student_user_id AS studentId, students.display_name AS studentName,
      subjects.name AS subjectName, assignment_submissions.submission_status AS savedStatus,
      assignment_submissions.file_path AS filePath, triggers.threshold
    FROM assignments
    INNER JOIN parent_notification_triggers AS triggers ON triggers.school_id = assignments.school_id
      AND triggers.trigger_code = 'assignment_not_completed' AND triggers.is_enabled = TRUE
    INNER JOIN sections ON sections.id = assignments.section_id AND sections.school_id = assignments.school_id
      AND sections.status = 'active'
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.status = 'active'
    INNER JOIN subjects ON subjects.id = assignments.subject_id
    INNER JOIN section_students ON section_students.section_id = assignments.section_id
      AND section_students.withdrawn_at IS NULL AND section_students.enrolled_at <= assignments.due_at
    INNER JOIN users AS students ON students.id = section_students.student_user_id
      AND students.school_id = assignments.school_id AND students.role = 'student' AND students.account_status = 'active'
    LEFT JOIN assignment_submissions ON assignment_submissions.assignment_id = assignments.id
      AND assignment_submissions.student_user_id = students.id
    WHERE assignments.status = 'published' AND assignments.due_at < NOW()
    ORDER BY assignments.school_id, section_students.student_user_id, assignments.section_id,
      assignments.subject_id, assignments.due_at DESC, assignments.id DESC`
  );
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.schoolId}:${row.studentId}:${row.sectionId}:${row.subjectId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const threshold = Number(group[0].threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || group.length < threshold) continue;
    const missed = row => row.onlineSubmissionEnabled
      ? !(row.savedStatus === 'submitted' && row.filePath)
      : row.savedStatus === 'not_submitted';
    if (group.slice(0, threshold).some(row => !missed(row)) || group[threshold] && missed(group[threshold])) continue;
    const row = group[0];
    await notifyParents(database, {
      schoolId: row.schoolId, studentId: row.studentId, code: 'assignment_not_completed',
      eventKey: `assignment-streak:${row.sectionId}:${row.subjectId}:${row.studentId}:${group[threshold - 1].id}`,
      title: 'Assignments not completed',
      message: `${row.studentName} has ${threshold} consecutive incomplete assignments in ${row.subjectName}.`,
      targetPath: '/views/parent/edugnay-parent-dashboard.html'
    });
  }
}

async function checkJournals(database) {
  const [rows] = await database.execute(
    `SELECT prompts.id, journal_subjects.school_id AS schoolId, prompts.section_id AS sectionId,
      journal_subjects.id AS journalSubjectId, students.id AS studentId,
      students.display_name AS studentName, entries.id AS entryId, triggers.threshold
    FROM journal_prompts AS prompts
    INNER JOIN journal_subjects ON journal_subjects.id = prompts.journal_subject_id AND journal_subjects.is_active = TRUE
    INNER JOIN school_portal_features AS features ON features.school_id = journal_subjects.school_id AND features.journals_enabled = TRUE
    INNER JOIN parent_notification_triggers AS triggers ON triggers.school_id = journal_subjects.school_id
      AND triggers.trigger_code = 'journal_not_submitted' AND triggers.is_enabled = TRUE
    INNER JOIN sections ON sections.id = prompts.section_id AND sections.school_id = journal_subjects.school_id
      AND sections.status = 'active'
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.status = 'active'
    INNER JOIN section_students ON section_students.section_id = sections.id
      AND section_students.withdrawn_at IS NULL AND section_students.enrolled_at <= prompts.due_at
    INNER JOIN users AS students ON students.id = section_students.student_user_id
      AND students.school_id = journal_subjects.school_id AND students.role = 'student' AND students.account_status = 'active'
    LEFT JOIN student_journal_entries AS entries ON entries.journal_prompt_id = prompts.id
      AND entries.student_user_id = students.id AND entries.entry_status IN ('submitted', 'reviewed')
    WHERE prompts.due_at < NOW() AND (prompts.allow_late = FALSE OR prompts.prompt_status = 'closed')
    ORDER BY journal_subjects.school_id, students.id, prompts.section_id, journal_subjects.id,
      prompts.due_at DESC, prompts.id DESC`
  );
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.schoolId}:${row.studentId}:${row.sectionId}:${row.journalSubjectId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    const threshold = Number(group[0].threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || group.length < threshold ||
      group.slice(0, threshold).some(row => row.entryId) ||
      group[threshold] && !group[threshold].entryId) continue;
    const row = group[0];
    await notifyParents(database, {
      schoolId: row.schoolId, studentId: row.studentId, code: 'journal_not_submitted',
      eventKey: `journal-streak:${row.sectionId}:${row.journalSubjectId}:${row.studentId}:${group[threshold - 1].id}`,
      title: 'Journal entries not submitted',
      message: `${row.studentName} has missed ${threshold} consecutive journal prompts.`,
      targetPath: '/views/parent/edugnay-parent-dashboard.html'
    });
  }
}

async function runParentNotificationChecks(database = getDatabase()) {
  await checkAssignments(database);
  await checkJournals(database);
}

function startParentNotificationWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runParentNotificationChecks(); }
    catch (error) { console.error('Parent notification check failed:', error); }
    finally { running = false; }
  };
  setTimeout(run, 5000);
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { runParentNotificationChecks, startParentNotificationWorker };
