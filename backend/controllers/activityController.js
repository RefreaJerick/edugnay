const { getDatabase } = require('../config/database');
const { structuredActivityDetails } = require('../utils/auditLog');

const CATEGORIES = {
  accounts: ['user_created', 'user_updated', 'user_activated', 'user_deactivated', 'user_deleted', 'users_imported'],
  class_management: [
    'section_created', 'section_updated', 'section_deleted', 'student_enrolled', 'student_moved',
    'student_withdrawn', 'teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned',
    'section_strand_classified', 'subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted',
    'timetable_meeting_created', 'timetable_meeting_updated', 'timetable_meeting_deleted'
  ],
  shs_program: [
    'shs_subject_created', 'shs_subject_updated', 'shs_subject_deactivated', 'shs_subject_deleted',
    'shs_teacher_assigned', 'shs_teacher_assignment_updated', 'shs_teacher_unassigned',
    'shs_selection_submitted', 'shs_selection_revised', 'shs_selection_admin_recorded',
    'shs_selection_admin_updated', 'shs_selection_recorded', 'shs_selection_returned',
    'shs_selection_recorded_choices_changed', 'shs_selection_choices_cleared', 'shs_selection_request', 'shs_selection_approved',
    'shs_selection_admin_changed', 'shs_offering_activated', 'shs_offering_updated',
    'shs_elective_class_created', 'shs_elective_class_updated', 'shs_elective_class_deleted',
    'shs_grading_rule_saved', 'shs_grading_defaults_restored', 'shs_grading_item_created',
    'shs_score_saved', 'shs_score_corrected', 'shs_grades_published', 'shs_completion_confirmed',
    'shs_timetable_meeting_created', 'shs_timetable_meeting_updated', 'shs_timetable_meeting_deleted'
  ],
  announcements: ['announcement_draft_created', 'announcement_scheduled', 'announcement_published', 'announcement_updated', 'announcement_pinned', 'announcement_unpinned', 'announcement_deleted'],
  school_configuration: [
    'school_settings_updated', 'school_logo_updated', 'portal_features_updated', 'academic_structure_updated',
    'narrative_report_week_updated',
    'deped_subject_defaults_applied',
    'academic_year_created', 'academic_year_updated', 'academic_term_created', 'academic_term_updated',
    'academic_term_activated', 'academic_term_completed', 'academic_term_extended', 'grading_categories_updated',
    'school_registration_submitted', 'school_registration_approved', 'school_registration_rejected', 'school_registration_resubmitted',
    'attendance_settings_updated', 'parent_notification_triggers_updated', 'calendar_notice_created',
    'calendar_notice_deleted', 'journal_prompt_deleted', 'deped_k10_grading_defaults_applied',
    'k10_final_grade_rules_saved', 'subject_grading_config_updated', 'subject_grading_defaults_restored',
    'subject_grading_group_defaults_restored', 'ai_report_evidence_approved', 'ai_report_evidence_approval_revoked'
  ],
  narrative_reports: [
    'narrative_report_draft_generated', 'narrative_report_draft_regenerated', 'narrative_report_draft_reviewed',
    'narrative_report_confirmed_held', 'narrative_report_reopened', 'narrative_report_released_to_parents'
  ],
  reopen_requests: [
    'grading_period_reopen_requested', 'grading_period_reopen_approved', 'grading_period_reopen_rejected',
    'grading_period_reopen_extended', 'grading_period_reopen_revoked'
  ],
  assignments: ['assignment_created', 'assignment_updated', 'assignment_deleted'],
  learning_materials: ['learning_material_uploaded', 'learning_material_visibility_changed', 'learning_material_deleted'],
  grades: ['final_grades_published', 'grading_item_deleted'],
  attendance: ['attendance_confirmed', 'qr_credential_regenerated'],
  school_forms: ['school_form_generated', 'school_forms_combined_exported'],
  archives: ['academic_year_archived']
};

const PLATFORM_CATEGORIES = {
  registrations: ['school_registration_submitted', 'school_registration_approved', 'school_registration_rejected', 'school_registration_resubmitted'],
  access: ['school_suspended', 'school_reactivated', 'school_deleted']
};
const PLATFORM_ACTIONS = Object.values(PLATFORM_CATEGORIES).flat();

const LEGACY_SHS_ACTIVITY_SQL = `(
  (audit_logs.action_type IN ('subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted')
    AND EXISTS (SELECT 1 FROM subjects legacy_subject
      JOIN school_levels legacy_level ON legacy_level.id = legacy_subject.school_level_id
        AND legacy_level.school_id = legacy_subject.school_id
      WHERE legacy_subject.id = CAST(audit_logs.entity_id AS UNSIGNED)
        AND legacy_subject.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs'))
  OR (audit_logs.action_type IN ('teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned')
    AND EXISTS (SELECT 1 FROM section_teachers legacy_assignment
      JOIN sections legacy_section ON legacy_section.id = legacy_assignment.section_id AND legacy_section.school_id = legacy_assignment.school_id
      JOIN school_levels legacy_level ON legacy_level.id = legacy_section.school_level_id AND legacy_level.school_id = legacy_section.school_id
      WHERE legacy_assignment.id = CAST(audit_logs.entity_id AS UNSIGNED)
        AND legacy_assignment.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs'))
  OR (audit_logs.action_type IN ('timetable_meeting_created', 'timetable_meeting_updated', 'timetable_meeting_deleted')
    AND (JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.summary')) LIKE 'Elective class %'
      OR EXISTS (SELECT 1 FROM timetable_meetings legacy_meeting
        JOIN scheduled_classes legacy_scheduled ON legacy_scheduled.id = legacy_meeting.scheduled_class_id
          AND legacy_scheduled.school_id = legacy_meeting.school_id
        JOIN section_teachers legacy_assignment ON legacy_assignment.id = legacy_scheduled.assignment_id
          AND legacy_assignment.school_id = legacy_scheduled.school_id
        JOIN sections legacy_section ON legacy_section.id = legacy_assignment.section_id AND legacy_section.school_id = legacy_assignment.school_id
        JOIN school_levels legacy_level ON legacy_level.id = legacy_section.school_level_id AND legacy_level.school_id = legacy_section.school_id
        WHERE legacy_meeting.id = CAST(audit_logs.entity_id AS UNSIGNED)
          AND legacy_meeting.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs')))
)`;

const CATEGORY_LABELS = {
  accounts: 'Accounts',
  class_management: 'Class management',
  shs_program: 'SHS Program',
  announcements: 'Announcements',
  school_configuration: 'School configuration',
  narrative_reports: 'Narrative reports',
  assignments: 'Assignments',
  learning_materials: 'Learning materials',
  reopen_requests: 'Reopen requests',
  grades: 'Grades',
  attendance: 'Attendance',
  school_forms: 'School forms',
  archives: 'Archives'
};

const ACTION_LABELS = {
  user_created: ['created an account', 'user-plus', 'blue', 'accounts'],
  user_updated: ['updated an account', 'user-round-pen', 'blue', 'accounts'],
  user_activated: ['activated an account', 'user-check', 'green', 'accounts'],
  user_deactivated: ['deactivated an account', 'user-x', 'red', 'accounts'],
  user_deleted: ['deleted an account', 'user-x', 'red', 'accounts'],
  users_imported: ['imported accounts', 'users-round', 'blue', 'accounts'],
  section_created: ['created a section', 'school', 'blue', 'class_management'],
  section_updated: ['updated a section', 'school', 'blue', 'class_management'],
  section_deleted: ['deleted a section', 'school', 'red', 'class_management'],
  student_enrolled: ['enrolled a student', 'user-plus', 'blue', 'class_management'],
  shs_subject_created: ['added an SHS core subject', 'book-plus', 'blue', 'shs_program'],
  shs_subject_updated: ['updated an SHS core subject', 'book-open-check', 'blue', 'shs_program'],
  shs_subject_deactivated: ['deactivated an SHS core subject', 'book-minus', 'orange', 'shs_program'],
  shs_subject_deleted: ['removed an SHS core subject', 'book-minus', 'red', 'shs_program'],
  shs_teacher_assigned: ['assigned a teacher to an SHS subject', 'user-check', 'blue', 'shs_program'],
  shs_teacher_assignment_updated: ['changed the teacher for an SHS subject', 'user-round-pen', 'blue', 'shs_program'],
  shs_teacher_unassigned: ['removed a teacher from an SHS subject', 'user-minus', 'orange', 'shs_program'],
  shs_selection_submitted: ['submitted elective choices', 'clipboard-check', 'blue', 'shs_program'],
  shs_selection_revised: ['revised elective choices', 'clipboard-pen-line', 'blue', 'shs_program'],
  shs_selection_admin_recorded: ['recorded elective choices', 'clipboard-plus', 'blue', 'shs_program'],
  shs_selection_admin_updated: ['updated elective choices', 'clipboard-pen-line', 'blue', 'shs_program'],
  shs_selection_recorded: ['confirmed elective choices', 'circle-check', 'green', 'shs_program'],
  shs_selection_returned: ['returned elective choices for correction', 'message-square-warning', 'orange', 'shs_program'],
  shs_selection_recorded_choices_changed: ['updated confirmed elective choices', 'clipboard-pen-line', 'blue', 'shs_program'],
  shs_selection_choices_cleared: ['cleared confirmed elective choices', 'clipboard-x', 'orange', 'shs_program'],
  shs_selection_request: ['updated elective choices', 'clipboard-check', 'blue', 'shs_program'],
  shs_selection_approved: ['confirmed elective choices', 'circle-check', 'green', 'shs_program'],
  shs_selection_admin_changed: ['updated confirmed elective choices', 'clipboard-pen-line', 'blue', 'shs_program'],
  shs_offering_activated: ['added approved SHS subjects', 'book-plus', 'blue', 'shs_program'],
  shs_offering_updated: ['updated an SHS subject offering', 'book-open-check', 'blue', 'shs_program'],
  shs_elective_class_created: ['created an SHS class', 'school', 'blue', 'shs_program'],
  shs_elective_class_updated: ['updated an SHS class', 'school', 'blue', 'shs_program'],
  shs_elective_class_deleted: ['deleted an SHS class', 'school', 'red', 'shs_program'],
  shs_grading_rule_saved: ['saved SHS grading rules', 'settings-2', 'gold', 'shs_program'],
  shs_grading_defaults_restored: ['restored SHS grading defaults', 'rotate-ccw', 'gold', 'shs_program'],
  shs_grading_item_created: ['created an SHS grading item', 'clipboard-plus', 'blue', 'shs_program'],
  shs_score_saved: ['saved an SHS learner score', 'pencil-line', 'blue', 'shs_program'],
  shs_score_corrected: ['corrected a published SHS score', 'file-pen-line', 'orange', 'shs_program'],
  shs_grades_published: ['published SHS grades', 'graduation-cap', 'green', 'shs_program'],
  shs_completion_confirmed: ['confirmed an SHS completion record', 'circle-check', 'green', 'shs_program'],
  shs_timetable_meeting_created: ['scheduled an SHS class', 'calendar-plus', 'blue', 'shs_program'],
  shs_timetable_meeting_updated: ['updated an SHS class schedule', 'calendar-clock', 'blue', 'shs_program'],
  shs_timetable_meeting_deleted: ['removed an SHS class meeting', 'calendar-minus', 'orange', 'shs_program'],
  student_moved: ['moved a student to another section', 'users-round', 'blue', 'class_management'],
  student_withdrawn: ['withdrew a student from a section', 'user-minus', 'orange', 'class_management'],
  teacher_assigned: ['assigned a teacher to a subject', 'user-check', 'blue', 'class_management'],
  teacher_assignment_updated: ['changed a teacher assignment', 'user-round-pen', 'blue', 'class_management'],
  teacher_unassigned: ['removed a teacher assignment', 'user-minus', 'orange', 'class_management'],
  timetable_meeting_created: ['scheduled a subject class', 'calendar-plus', 'blue', 'class_management'],
  timetable_meeting_updated: ['updated a subject class schedule', 'calendar-clock', 'blue', 'class_management'],
  timetable_meeting_deleted: ['removed a subject class meeting', 'calendar-minus', 'orange', 'class_management'],
  subject_created: ['created a subject', 'book-plus', 'blue', 'class_management'],
  subject_updated: ['updated a subject', 'book-open-check', 'blue', 'class_management'],
  subject_deactivated: ['removed a subject from active choices', 'book-minus', 'orange', 'class_management'],
  subject_deleted: ['removed a subject', 'book-minus', 'red', 'class_management'],
  section_strand_classified: ['classified a section strand', 'school', 'blue', 'class_management'],
  announcement_draft_created: ['created an announcement draft', 'megaphone', 'purple', 'announcements'],
  announcement_published: ['published an announcement', 'megaphone', 'purple', 'announcements'],
  announcement_scheduled: ['scheduled an announcement', 'calendar-clock', 'purple', 'announcements'],
  announcement_pinned: ['pinned an announcement', 'pin', 'purple', 'announcements'],
  announcement_unpinned: ['unpinned an announcement', 'pin-off', 'purple', 'announcements'],
  announcement_updated: ['updated an announcement', 'megaphone', 'blue', 'announcements'],
  announcement_deleted: ['deleted an announcement', 'megaphone', 'red', 'announcements'],
  school_settings_updated: ['updated school settings', 'settings-2', 'gold', 'school_configuration'],
  narrative_report_week_updated: ['updated the narrative report week', 'calendar-days', 'gold', 'school_configuration'],
  portal_features_updated: ['updated portal features', 'settings-2', 'gold', 'school_configuration'],
  academic_structure_updated: ['updated the academic structure', 'settings-2', 'gold', 'school_configuration'],
  deped_subject_defaults_applied: ['applied DepEd subject defaults', 'book-open-check', 'blue', 'school_configuration'],
  academic_year_created: ['created an academic year', 'calendar-plus', 'blue', 'school_configuration'],
  academic_year_updated: ['updated an academic year', 'calendar-days', 'gold', 'school_configuration'],
  academic_term_created: ['created a grading period', 'calendar-plus', 'blue', 'school_configuration'],
  academic_term_updated: ['updated a grading period', 'calendar-days', 'gold', 'school_configuration'],
  academic_term_activated: ['activated a grading period', 'calendar-check', 'green', 'school_configuration'],
  academic_term_completed: ['completed a grading period', 'calendar-check', 'blue', 'school_configuration'],
  academic_term_extended: ['extended a grading period', 'calendar-plus', 'gold', 'school_configuration'],
  grading_categories_updated: ['updated grading rules', 'settings-2', 'gold', 'school_configuration'],
  school_registration_submitted: ['submitted a school registration', 'building-2', 'blue', 'school_configuration'],
  school_registration_approved: ['approved a school registration', 'building-2', 'green', 'school_configuration'],
  school_registration_rejected: ['rejected a school registration', 'building-2', 'red', 'school_configuration'],
  school_suspended: ['suspended a school account', 'building-2', 'red', 'school_configuration'],
  school_deleted: ['deleted a school account', 'trash-2', 'red', 'school_configuration'],
  school_reactivated: ['reactivated a school account', 'building-2', 'green', 'school_configuration'],
  school_logo_updated: ['updated the school logo', 'image', 'blue', 'school_configuration'],
  attendance_settings_updated: ['updated attendance settings', 'calendar-check', 'gold', 'school_configuration'],
  parent_notification_triggers_updated: ['updated parent notification settings', 'bell', 'blue', 'school_configuration'],
  calendar_notice_created: ['added a calendar notice', 'calendar-plus', 'blue', 'school_configuration'],
  calendar_notice_deleted: ['removed a calendar notice', 'calendar-minus', 'orange', 'school_configuration'],
  journal_prompt_deleted: ['deleted a journal prompt', 'notebook-pen', 'orange', 'school_configuration'],
  deped_k10_grading_defaults_applied: ['applied DepEd grading defaults', 'book-open-check', 'blue', 'school_configuration'],
  k10_final_grade_rules_saved: ['saved final-grade rules', 'settings-2', 'gold', 'school_configuration'],
  subject_grading_config_updated: ['updated subject grading settings', 'settings-2', 'gold', 'school_configuration'],
  subject_grading_defaults_restored: ['restored subject grading defaults', 'rotate-ccw', 'gold', 'school_configuration'],
  subject_grading_group_defaults_restored: ['restored grading defaults for a subject group', 'rotate-ccw', 'gold', 'school_configuration'],
  school_forms_combined_exported: ['exported school forms', 'file-spreadsheet', 'gold', 'school_forms'],
  school_registration_resubmitted: ['resubmitted a school registration', 'building-2', 'blue', 'school_configuration'],
  ai_report_evidence_approved: ['approved AI use of learner evidence', 'sparkles', 'green', 'school_configuration'],
  ai_report_evidence_approval_revoked: ['revoked approval for AI use of learner evidence', 'sparkles', 'orange', 'school_configuration'],
  narrative_report_draft_generated: ['generated a report draft', 'file-text', 'purple', 'narrative_reports'],
  narrative_report_draft_regenerated: ['regenerated a report draft', 'refresh-cw', 'purple', 'narrative_reports'],
  narrative_report_draft_reviewed: ['saved changes to a report draft', 'file-pen-line', 'blue', 'narrative_reports'],
  narrative_report_confirmed_held: ['confirmed a report', 'circle-check', 'green', 'narrative_reports'],
  narrative_report_reopened: ['reopened a report', 'file-pen-line', 'orange', 'narrative_reports'],
  narrative_report_released_to_parents: ['released a weekly report to parents', 'send', 'green', 'narrative_reports'],
  assignment_created: ['created an assignment', 'clipboard-plus', 'blue', 'assignments'],
  assignment_updated: ['updated an assignment', 'clipboard-pen-line', 'blue', 'assignments'],
  assignment_deleted: ['deleted an assignment', 'trash-2', 'red', 'assignments'],
  learning_material_uploaded: ['uploaded a learning material', 'file-up', 'blue', 'learning_materials'],
  learning_material_visibility_changed: ['changed a learning material', 'eye', 'blue', 'learning_materials'],
  learning_material_deleted: ['deleted a learning material', 'trash-2', 'red', 'learning_materials'],
  grading_period_reopen_requested: ['requested grade editing access', 'lock-keyhole-open', 'gold', 'reopen_requests'],
  grading_period_reopen_approved: ['approved a grade editing request', 'lock-keyhole-open', 'green', 'reopen_requests'],
  grading_period_reopen_rejected: ['rejected a grade editing request', 'lock-keyhole', 'red', 'reopen_requests'],
  grading_period_reopen_extended: ['extended grade editing access', 'calendar-plus', 'gold', 'reopen_requests'],
  grading_period_reopen_revoked: ['revoked grade editing access', 'lock-keyhole', 'red', 'reopen_requests'],
  final_grades_published: ['published final grades', 'graduation-cap', 'green', 'grades'],
  grading_item_deleted: ['deleted a score component', 'trash-2', 'red', 'grades'],
  attendance_confirmed: ['confirmed subject attendance', 'calendar-check', 'green', 'attendance'],
  qr_credential_regenerated: ['regenerated a student attendance QR', 'scan-line', 'blue', 'attendance'],
  school_form_generated: ['generated an official school form', 'file-spreadsheet', 'gold', 'school_forms'],
  academic_year_archived: ['archived an academic year', 'archive', 'gray', 'archives']
};

function parseDetails(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function cleanLegacyText(value) {
  return String(value || '').trim()
    .replace(/\s*(?:\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|\u00b7)\s*/g, ', ')
    .replace(/\s+\?+\s+/g, ', ')
    .replace(/\s*(?:\u00c3\u00a2\u00e2\u20ac\u00a0\u00e2\u20ac\u2122|\u00e2\u2020\u2019|→)\s*/g, ' to ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^,\s*|,\s*$/g, '');
}

function splitLegacyParts(value) {
  return String(value || '')
    .split(/\s*(?:\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|\u00b7)\s*|\s+\?+\s+|\s*(?:\u00c3\u00a2\u00e2\u20ac\u00a0\u00e2\u20ac\u2122|\u00e2\u2020\u2019|→)\s*/)
    .map(part => part.trim())
    .filter(Boolean);
}

function readableSummaryContext(actionType, value) {
  const summary = cleanLegacyText(value);
  if (!summary) return '';
  if (/^(?:assignment|elective class)\s+\d+$/i.test(summary)) return '';
  if (/^shs_/.test(actionType)) {
    const labeledContext = summary.match(/^(?:added|created|updated|deleted|removed|activated|paused|scheduled|saved|restored|published|confirmed|corrected)\b[^:]*:\s*(.+)$/i);
    if (labeledContext) return labeledContext[1].trim();
  }
  const redundantSummaries = {
    shs_grading_rule_saved: /^saved custom SHS grading rule$/i,
    shs_grading_defaults_restored: /^restored default SHS grading rule$/i,
    narrative_report_week_updated: /^narrative report week updated$/i,
    parent_notification_triggers_updated: /^parent notification settings updated$/i,
    calendar_notice_deleted: /^calendar notice removed$/i
  };
  if (redundantSummaries[actionType]?.test(summary)) return '';
  if (actionType === 'shs_offering_activated') {
    const match = summary.match(/^added\s+(\d+)\s+approved\s+SHS\s+subjects?\s*(?:\(s\))?$/i);
    if (match) return `${match[1]} approved subject${match[1] === '1' ? '' : 's'}`;
  }
  if (actionType === 'subject_grading_config_updated') return summary.replace(/\s+grading configuration$/i, '').trim();
  if (['subject_grading_defaults_restored', 'subject_grading_group_defaults_restored'].includes(actionType)) {
    return summary.replace(/\s+DepEd defaults restored$/i, '').trim();
  }
  const label = ACTION_LABELS[actionType]?.[0];
  if (label && summary.toLowerCase() === label.toLowerCase()) return '';
  return summary;
}

function accountActivity(row, details, fallbackTitle) {
  const legacyParts = splitLegacyParts(details.summary);
  const displayName = String(details.displayName || legacyParts[0] || '').trim();
  const role = String(details.role || legacyParts[1] || '').replace(/_/g, ' ').trim();
  const titleByAction = {
    user_created: 'created an account',
    user_updated: 'updated an account',
    user_activated: 'activated an account',
    user_deactivated: 'deactivated an account',
    user_deleted: 'deleted an account'
  };
  return {
    title: displayName ? `${titleByAction[row.actionType] || fallbackTitle} for ${displayName}` : fallbackTitle,
    detail: role ? role.replace(/^./, char => char.toUpperCase()) : ''
  };
}

function enrollmentActivity(row, details, fallbackTitle) {
  const legacyParts = splitLegacyParts(details.summary);
  const studentName = details.studentName || legacyParts[0] || '';
  const sectionName = details.sectionName || legacyParts[1] || row.sectionName || '';
  const title = studentName && sectionName
    ? `enrolled ${studentName} in ${sectionName}`
    : fallbackTitle;
  return { title, detail: '' };
}

function sectionChangeActivity(row, details, fallbackTitle) {
  const legacyParts = splitLegacyParts(details.summary);
  const studentName = String(details.studentName || legacyParts[0] || '').trim();
  const sourceSection = String(details.sourceSectionName || (row.actionType === 'student_moved' ? legacyParts[1] : '') || '').trim();
  const targetSection = String(details.targetSectionName || (row.actionType === 'student_moved' ? legacyParts[2] : '') || '').trim();
  const sectionName = String(details.sectionName || row.sectionName || (row.actionType === 'student_withdrawn' ? legacyParts[1] : '') || '').trim();
  let title = fallbackTitle;
  if (row.actionType === 'student_moved' && studentName && sourceSection && targetSection) {
    title = `moved ${studentName} from ${sourceSection} to ${targetSection}`;
  } else if (row.actionType === 'student_withdrawn' && studentName && sectionName) {
    title = `withdrew ${studentName} from ${sectionName}`;
  }
  return { title, detail: '' };
}

function teacherAssignmentActivity(row, details) {
  const parts = splitLegacyParts(details.summary);
  const updated = row.actionType === 'teacher_assignment_updated';
  const teacherName = String(details.teacherName || (updated ? parts[1] : parts[0]) || '').trim();
  const previousTeacher = String(details.previousTeacher || (updated ? parts[0] : '') || '').trim();
  const sectionName = String(details.sectionName || parts[updated ? 2 : 1] || '').trim();
  const subjectName = String(details.subjectName || parts[updated ? 3 : 2] || '').trim();
  const target = subjectName || sectionName;
  let title = '';
  let detail = '';
  if (updated) {
    title = target ? `changed the teacher for ${target}` : 'changed a teacher assignment';
    if (previousTeacher && teacherName) detail = `From ${previousTeacher} to ${teacherName}`;
  } else if (row.actionType === 'teacher_unassigned') {
    title = teacherName && target ? `removed ${teacherName} from ${target}` : target ? `removed a teacher from ${target}` : '';
  } else {
    title = teacherName && target ? `assigned ${teacherName} to ${target}` : target ? `assigned a teacher to ${target}` : '';
  }
  return { title, detail };
}

function humanizeShsCode(value) {
  return String(value || '').replace(/[_-]+/g, ' ').trim()
    .replace(/\b\w/g, character => character.toUpperCase());
}

function shsGrade(details) {
  return String(details.gradeName || (details.gradeCode
    ? `Grade ${String(details.gradeCode).replace(/^grade-/, '')}` : '')).trim();
}

function shsTrack(details) {
  const track = String(details.trackName || details.trackCode || '').trim();
  if (!track) return '';
  const label = humanizeShsCode(track);
  return /\btrack$/i.test(label) ? label : `${label} track`;
}

function shsCount(value, singular, plural = singular === 'class' ? 'classes' : `${singular}s`) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? `${count} ${count === 1 ? singular : plural}` : '';
}

function shsChoiceActivity(row, details, fallbackTitle) {
  const action = String(row.actionType || '');
  const studentName = String(details.studentName || '').trim();
  const actorIsStudent = studentName && String(row.actor || '').trim().toLocaleLowerCase()
    === studentName.toLocaleLowerCase();
  const namedStudent = studentName && !actorIsStudent ? studentName : '';
  const titleByAction = {
    shs_selection_submitted: 'submitted elective choices',
    shs_selection_revised: 'updated elective choices',
    shs_selection_admin_recorded: 'recorded elective choices',
    shs_selection_admin_updated: 'updated elective choices',
    shs_selection_recorded: 'confirmed elective choices',
    shs_selection_approved: 'confirmed elective choices',
    shs_selection_returned: 'returned elective choices for correction',
    shs_selection_recorded_choices_changed: 'updated confirmed elective choices',
    shs_selection_admin_changed: 'updated confirmed elective choices',
    shs_selection_choices_cleared: 'cleared confirmed elective choices',
    shs_selection_request: 'updated elective choices'
  };
  let title = titleByAction[action] || fallbackTitle;
  if (namedStudent && action === 'shs_selection_returned') title = `returned ${namedStudent}'s elective choices for correction`;
  else if (namedStudent && action === 'shs_selection_choices_cleared') title = `cleared ${namedStudent}'s confirmed elective choices`;
  else if (namedStudent && ['shs_selection_recorded_choices_changed', 'shs_selection_admin_changed'].includes(action)) {
    title = `updated ${namedStudent}'s confirmed elective choices`;
  } else if (namedStudent && titleByAction[action]) title = `${title} for ${namedStudent}`;

  const legacyClassCount = cleanLegacyText(details.summary || '').match(/\b(\d+)\s+class(?:es)?\b/i)?.[1];
  const count = shsCount(details.classCount ?? legacyClassCount, 'class');
  const outcome = !count ? '' : action === 'shs_selection_choices_cleared' ? `${count} removed` : count;
  return { title, detail: outcome };
}

function formatShsTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const hour = Number(match[1]);
  return { clock: `${hour % 12 || 12}:${match[2]}`, period: hour < 12 ? 'AM' : 'PM' };
}

function shsMeetingScheduleDetails(details) {
  const weekdayNumber = Number(details.weekday);
  const weekday = Number.isInteger(weekdayNumber) && weekdayNumber >= 1 && weekdayNumber <= 7
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekdayNumber - 1] : '';
  const start = formatShsTime(details.startTime);
  const end = formatShsTime(details.endTime);
  let time = '';
  if (start && end) time = start.period === end.period
    ? `${start.clock}-${end.clock} ${end.period}` : `${start.clock} ${start.period}-${end.clock} ${end.period}`;
  return weekday && time ? `${weekday}, ${time}` : weekday || time;
}

function shsProgramActivity(row, details, fallbackTitle) {
  const action = String(row.actionType || '');
  const summary = cleanLegacyText(details.summary || '');
  const subjectName = String(details.subjectName || '').trim();
  const className = String(details.className || details.electiveClassName || '')
    .replace(/^(?:created|updated|deleted|removed)\s+(?:an?\s+)?SHS\s+class\s*:\s*/i, '').trim();
  const teacherName = String(details.teacherName || '').trim();
  const grade = shsGrade(details);
  const track = shsTrack(details);
  const subjects = Array.isArray(details.subjects)
    ? details.subjects.map(subject => String(subject?.subjectName || '').trim()).filter(Boolean) : [];
  let title = fallbackTitle;
  let context = '';

  if (['shs_offering_activated'].includes(action)) {
    const summaryCount = summary.match(/^added\s+(\d+)\s+approved\s+SHS\s+subjects?\s*(?:\(s\))?/i);
    const subjectCount = Number(details.subjectCount || subjects.length || summaryCount?.[1]);
    if (Number.isSafeInteger(subjectCount) && subjectCount > 0) {
      title = subjectCount === 1 && subjects.length === 1
        ? `added ${subjects[0]} as an approved SHS subject`
        : `added ${shsCount(subjectCount, 'approved SHS subject')}`;
      context = [grade, track].filter(Boolean).join(' · ');
    }
  } else if (action === 'shs_offering_updated') {
    const paused = details.isActive === false || details.change === 'paused' || /^paused$/i.test(summary);
    const activated = details.isActive === true || details.change === 'activated' || /^activated$/i.test(summary);
    title = paused || activated
      ? subjectName ? `${paused ? 'paused' : 'activated'} the SHS offering for ${subjectName}`
        : `${paused ? 'paused' : 'activated'} an SHS subject offering`
      : subjectName ? `updated the SHS offering for ${subjectName}` : fallbackTitle;
    context = [grade, track].filter(Boolean).join(' · ');
  } else if (action === 'shs_elective_class_created' || action === 'shs_elective_class_updated'
    || action === 'shs_elective_class_deleted' || action.startsWith('shs_elective_class_')) {
    const changes = details.changes && typeof details.changes === 'object' && !Array.isArray(details.changes)
      ? details.changes : null;
    const statusChanged = action === 'shs_elective_class_updated' && details.wasActive !== details.isActive
      && typeof details.wasActive === 'boolean' && typeof details.isActive === 'boolean';
    if (statusChanged) {
      title = `${details.isActive ? 'activated' : 'paused'} SHS class${className ? ` ${className}` : ''}`;
    } else {
      const verb = action === 'shs_elective_class_created' ? 'created'
        : action === 'shs_elective_class_deleted' ? 'deleted'
          : changes && !Object.keys(changes).length ? 'saved' : 'updated';
      title = `${verb} SHS class${className ? ` ${className}` : ''}`;
    }
    if (action === 'shs_elective_class_created') context = subjectName;
    else if (changes?.className?.from && changes.className.from !== changes.className.to) {
      context = `Renamed from ${changes.className.from}`;
    } else if (changes?.teacherName?.from && changes.teacherName.from !== changes.teacherName.to) {
      context = `Teacher changed from ${changes.teacherName.from} to ${changes.teacherName.to}`;
    } else if (changes?.teacherName?.to) context = `Teacher changed to ${changes.teacherName.to}`;
    else if (changes?.capacity?.from != null && changes.capacity.to != null) {
      context = `Capacity changed from ${changes.capacity.from} to ${changes.capacity.to}`;
    }
  } else if (action.startsWith('shs_timetable_meeting_')
    || (row.isLegacyShs && ['timetable_meeting_created', 'timetable_meeting_updated', 'timetable_meeting_deleted'].includes(action))) {
    const verb = action.endsWith('_created') ? 'scheduled a meeting for'
      : action.endsWith('_updated') ? 'updated the schedule for' : 'removed a meeting for';
    title = className ? `${verb} ${className}` : fallbackTitle;
    context = shsMeetingScheduleDetails(details);
  } else if (action === 'shs_grading_rule_saved' || action === 'shs_grading_defaults_restored') {
    const restored = action === 'shs_grading_defaults_restored';
    title = subjectName
      ? `${restored ? 'restored default grading rules for' : 'saved grading rules for'} ${subjectName}`
      : restored ? 'restored SHS grading defaults' : 'saved SHS grading rules';
    context = grade;
  } else if (action === 'shs_grading_item_created') {
    const itemName = String(details.itemName || '').trim();
    title = itemName ? `added score component “${itemName}”` : 'added a score component';
    context = [subjectName, className || grade].filter(Boolean).join(' · ');
  } else if (action === 'shs_score_saved' || action === 'shs_score_corrected') {
    const studentName = String(details.studentName || '').trim();
    const itemName = String(details.itemName || '').trim();
    const corrected = action === 'shs_score_corrected';
    title = `${corrected ? 'corrected' : 'saved'} ${studentName ? `${studentName}'s ` : ''}${corrected ? 'published ' : ''}score${itemName ? ` for ${itemName}` : ''}`;
    const score = corrected && details.oldScore != null && details.newScore != null
      ? `${details.oldScore} to ${details.newScore}`
      : details.score != null ? `${details.score}${details.maxScore != null ? ` / ${details.maxScore}` : ''}` : '';
    context = score;
  } else if (action === 'shs_grades_published') {
    const target = className || subjectName;
    title = target ? `published grades for ${target}` : 'published SHS grades';
    context = shsCount(details.studentCount, 'learner');
  } else if (action === 'shs_completion_confirmed') {
    const studentName = String(details.studentName || '').trim();
    title = studentName ? `confirmed Grade 12 completion for ${studentName}` : 'confirmed an SHS completion record';
    const section = String(details.sectionName || '').replace(/^Grade\s+12\s*[-,:]\s*/i, '').trim();
    context = section;
  } else if (/^shs_subject_(created|updated|deactivated|deleted)$/.test(action)
    || (row.isLegacyShs && /^(subject_created|subject_updated|subject_deactivated|subject_deleted)$/.test(action))) {
    const verb = /created$/.test(action) ? 'added' : /updated$/.test(action) ? 'updated'
      : /deactivated$/.test(action) ? 'deactivated' : 'removed';
    title = subjectName ? `${verb} SHS core subject ${subjectName}` : fallbackTitle;
    context = grade;
  } else if (/^shs_teacher_(assigned|assignment_updated|unassigned)$/.test(action)
    || (row.isLegacyShs && /^(teacher_assigned|teacher_assignment_updated|teacher_unassigned)$/.test(action))) {
    const unassigned = /unassigned$/.test(action);
    const updated = /assignment_updated$/.test(action);
    title = subjectName && teacherName
      ? unassigned ? `removed ${teacherName} from ${subjectName}`
        : updated ? `changed the teacher for ${subjectName}` : `assigned ${teacherName} to ${subjectName}`
      : subjectName ? `${unassigned ? 'removed a teacher from' : updated ? 'changed the teacher for' : 'assigned a teacher to'} ${subjectName}`
        : fallbackTitle;
    context = updated && details.previousTeacher && teacherName
      ? `${details.previousTeacher} to ${teacherName}` : '';
  } else if (!ACTION_LABELS[action] && (String(row.entityType || '').startsWith('shs_') || action.startsWith('shs_'))) {
    if (/pause|deactiv/i.test(action) || /^paused$/i.test(summary)) title = 'paused an SHS subject or class';
    else if (/activ/i.test(action) || /^activated$/i.test(summary)) title = 'activated an SHS subject or class';
    else if (/delet|remov/i.test(action)) title = 'removed an SHS subject or class';
    else if (/creat|add/i.test(action)) title = 'added an SHS subject or class';
    else if (/updat|edit/i.test(action)) title = 'updated an SHS subject or class';
    else title = 'updated the SHS Program';
  }

  if (!context && action !== 'shs_elective_class_updated') {
    context = [className, subjectName, grade, track].find(part => part
      && !title.toLocaleLowerCase().includes(String(part).toLocaleLowerCase())) || '';
  }
  if (!context && summary && action !== 'shs_offering_activated'
    && !/^(?:activated|paused|updated|deleted|created)$/i.test(summary)) {
    const legacyContext = readableSummaryContext(action, summary);
    if (legacyContext && !title.toLocaleLowerCase().includes(legacyContext.toLocaleLowerCase())) context = legacyContext;
  }
  return { title, detail: context };
}

function dayName(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 7
    ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1]
    : '';
}

function genericActivityContext(row, details) {
  const action = row.actionType;
  if (action === 'academic_year_archived') {
    const label = details.label || readableSummaryContext(action, details.summary);
    return label ? (String(label).startsWith('S.Y.') ? label : `S.Y. ${label}`) : '';
  }
  if (action === 'narrative_report_week_updated') {
    const startDay = dayName(details.weekStartDay);
    const endDay = dayName(details.weekEndDay);
    return startDay && endDay ? `Report week: ${startDay} to ${endDay}` : '';
  }
  if (action === 'attendance_settings_updated') {
    const thresholds = Array.isArray(details.thresholds) ? details.thresholds : [];
    const changed = [details.maxUnexcusedAbsences ?? thresholds[0], details.consecutiveAbsencesAlert ?? thresholds[1],
      details.countExcusedAbsences, details.allowEditPastAttendance].filter(value => value != null).length;
    return changed ? `${changed} settings changed` : '';
  }
  if (action === 'deped_subject_defaults_applied' && Array.isArray(details.gradeCodes)) {
    return Array.isArray(details.addedSubjectCodes) ? `${details.addedSubjectCodes.length} subjects added` : '';
  }
  if (action === 'deped_k10_grading_defaults_applied') {
    const count = details.addedCount ?? details.added;
    return count != null ? `${count} subject profiles added` : '';
  }
  if (action === 'k10_final_grade_rules_saved') {
    return details.gradingMode ? `${String(details.gradingMode).replace(/_/g, ' ')} grading` : '';
  }
  if (action === 'subject_grading_group_defaults_restored') {
    const subjects = Array.isArray(details.subjectNames) ? details.subjectNames : [];
    return details.groupName || details.groupKey
      || (subjects.length || details.subjectIds?.length ? `${subjects.length || details.subjectIds.length} subject profiles` : '');
  }
  if (action === 'grading_period_reopen_requested' || action.startsWith('grading_period_reopen_')) {
    return [details.subjectName || details.sectionName, details.termName].filter(Boolean).join(' · ');
  }
  if (action === 'calendar_notice_created' || action === 'calendar_notice_deleted') {
    return details.noticeTitle || '';
  }
  if (action === 'school_forms_combined_exported') {
    const formCodes = String(details.form_codes || details.formCodes || '').split(',').filter(Boolean);
    return formCodes.length ? `${formCodes.length} forms` : '';
  }
  if (action === 'attendance_confirmed') {
    if (!details.sectionName && !details.className && !details.subjectName && details.summary) {
      return readableSummaryContext(action, details.summary);
    }
    const target = details.className || details.sectionName || details.subjectName;
    const count = details.recordCount != null ? `${details.recordCount} learners` : '';
    const context = [target, count].filter(Boolean).join(' · ');
    return context || readableSummaryContext(action, details.summary);
  }
  if (action === 'qr_credential_regenerated') return details.studentName || '';
  const strings = [details.announcementTitle, details.noticeTitle, details.subjectName, details.className,
    details.sectionName, details.studentName, details.termName, details.schoolName, details.gradeName,
    details.levelName, details.entityName, details.label]
    .filter(value => typeof value === 'string' && value.trim());
  return [...new Set(strings.map(cleanLegacyText))][0] || '';
}

function meetingScheduleDetails(details) {
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekdayNumber = Number(details.weekday);
  const weekday = Number.isInteger(weekdayNumber) && weekdayNumber >= 1 && weekdayNumber <= 7
    ? weekdays[weekdayNumber - 1] : '';
  const startTime = details.startTime ? String(details.startTime).slice(0, 5) : '';
  const endTime = details.endTime ? String(details.endTime).slice(0, 5) : '';
  const time = startTime && endTime ? `${startTime} to ${endTime}` : '';
  const schedule = [weekday, time].filter(Boolean).join(', ');
  return schedule;
}

function timetableActivity(details) {
  const classContext = [details.subjectName, details.sectionName || details.className].filter(Boolean).join(' · ');
  return [classContext, meetingScheduleDetails(details)].filter(Boolean).join(' · ');
}

function itemNameFromDetails(details) {
  const directName = String(details.title || details.itemName || '').trim();
  const summaryParts = splitLegacyParts(details.summary);
  const name = directName || summaryParts[0] || '';
  return name.replace(/\s*,\s*status\s*:\s*(?:draft|published|closed)\s*$/i, '').trim();
}

function itemContextFromDetails(row, details) {
  const parts = splitLegacyParts(details.summary);
  const subjectName = cleanLegacyText(details.subjectName || parts[1] || '');
  const isElective = details.scopeType === 'elective' || details.electiveClassId != null;
  const className = cleanLegacyText(details.className || details.electiveClassName || (isElective ? parts[2] : '') || '');
  const sectionGrade = cleanLegacyText(details.sectionGrade || row.sectionGrade || (parts[2] && /^grade\s/i.test(parts[2]) ? parts[2] : '') || '');
  const sectionName = cleanLegacyText(details.sectionName || row.sectionName || (sectionGrade ? parts[3] : '') || '')
    .replace(/,\s*status\s*:\s*(?:draft|published|closed)\s*$/i, '');
  const placement = className || [sectionGrade, sectionName].filter(Boolean).join(' · ');
  return [...new Set([subjectName, placement].filter(Boolean))].join(' · ');
}

function formatAssignmentActivity(row, details) {
  const name = itemNameFromDetails(details);
  const item = name ? `“${name}”` : '';
  let action = row.actionType === 'assignment_created' ? 'created assignment'
    : row.actionType === 'assignment_deleted' ? 'deleted assignment' : 'updated assignment';
  let title;
  const statusChanged = details.statusChanged === true;
  const targetStatus = details.toStatus || (statusChanged ? details.status : '');

  if (row.actionType === 'assignment_created' && details.status === 'draft') action = 'created draft assignment';
  else if (row.actionType === 'assignment_created' && details.status === 'closed') action = 'created closed assignment';
  else if (row.actionType === 'assignment_updated' && statusChanged) {
    if (targetStatus === 'published' && details.fromStatus === 'draft') {
      title = details.detailsChanged
        ? `updated assignment${item ? ` ${item}` : ''} and published it`
        : `published assignment${item ? ` ${item}` : ''}`;
    } else if (targetStatus === 'closed') {
      title = details.detailsChanged
        ? `updated assignment${item ? ` ${item}` : ''} and closed it`
        : `closed assignment${item ? ` ${item}` : ''}`;
    } else if (targetStatus === 'draft') {
      title = details.detailsChanged
        ? `updated assignment${item ? ` ${item}` : ''} and moved it to draft`
        : `moved assignment${item ? ` ${item} ` : ' '}to draft`;
    } else if (targetStatus) {
      title = `changed assignment${item ? ` ${item}` : ''} status to ${targetStatus}`;
    }
  }

  if (row.actionType === 'assignment_updated' && details.scoreComponentCreated === true
    && !statusChanged && !details.detailsChanged) {
    title = item ? `linked ${item} to Score Recording` : 'linked an assignment to Score Recording';
  }

  return { title: title || `${action}${item ? ` ${item}` : ''}`, detail: itemContextFromDetails(row, details) };
}

function formatLearningMaterialActivity(row, details) {
  const name = itemNameFromDetails(details);
  const item = name ? `“${name}”` : '';
  let action = row.actionType === 'learning_material_uploaded' ? 'uploaded learning material'
    : row.actionType === 'learning_material_deleted' ? 'deleted learning material' : 'changed learning material visibility';
  let title;

  if (row.actionType === 'learning_material_uploaded' && details.status === 'draft') action = 'uploaded draft learning material';
  else if (row.actionType === 'learning_material_visibility_changed') {
    if (details.fromStatus === 'draft' && details.toStatus === 'published') {
      title = `published learning material${item ? ` ${item}` : ''}`;
    } else if (details.fromStatus === 'published' && details.toStatus === 'draft') {
      title = `moved learning material${item ? ` ${item} ` : ' '}to draft`;
    } else if (details.toStatus) {
      title = `changed learning material${item ? ` ${item}` : ''} visibility to ${details.toStatus}`;
    }
  }

  return { title: title || `${action}${item ? ` ${item}` : ''}`, detail: itemContextFromDetails(row, details) };
}

function formatItemActivity(row, details) {
  if (CATEGORIES.assignments.includes(row.actionType)) return formatAssignmentActivity(row, details);
  if (CATEGORIES.learning_materials.includes(row.actionType)) return formatLearningMaterialActivity(row, details);
  return null;
}

function formatActivity(row) {
  const details = parseDetails(row.details);
  const label = ACTION_LABELS[row.actionType];
  let [title, icon, tone, category] = label || ['recorded an activity', 'activity', 'blue', null];
  const isShsChoice = String(row.actionType || '').startsWith('shs_selection_') || row.entityType === 'shs_selection_request';
  const isShsActivity = Boolean(row.isLegacyShs) || isShsChoice || String(row.actionType || '').startsWith('shs_')
    || String(row.entityType || '').startsWith('shs_') || details.schoolLevelCode === 'shs';
  const shsDetails = isShsActivity ? structuredActivityDetails(row.actionType, details) : details;
  if (isShsActivity) category = 'shs_program';
  if (row.isLegacyShs) {
    const labels = {
      subject_created: ['added an SHS subject', 'book-plus', 'blue'],
      subject_updated: ['updated an SHS subject', 'book-open-check', 'blue'],
      subject_deactivated: ['deactivated an SHS subject', 'book-minus', 'orange'],
      subject_deleted: ['removed an SHS subject', 'book-minus', 'red'],
      teacher_assigned: ['assigned a teacher to an SHS subject', 'user-check', 'blue'],
      teacher_assignment_updated: ['changed the teacher for an SHS subject', 'user-round-pen', 'blue'],
      teacher_unassigned: ['removed a teacher from an SHS subject', 'user-minus', 'orange'],
      timetable_meeting_created: ['scheduled an SHS class', 'calendar-plus', 'blue'],
      timetable_meeting_updated: ['updated an SHS class schedule', 'calendar-clock', 'blue'],
      timetable_meeting_deleted: ['removed an SHS class meeting', 'calendar-minus', 'orange']
    };
    [title, icon, tone] = labels[row.actionType] || [title, icon, tone];
  }
  if (isShsChoice && !label) { title = 'updated elective choices'; icon = 'clipboard-check'; tone = 'blue'; }
  if (!label && isShsActivity && !isShsChoice) {
    icon = /grading|score|grade/.test(String(row.actionType)) ? 'settings-2' : 'book-open-check';
    tone = 'blue';
  }
  const isReportAction = CATEGORIES.narrative_reports.includes(row.actionType);
  const sectionName = row.sectionName && row.sectionGrade ? `${row.sectionGrade}, ${row.sectionName}` : null;
  if (isReportAction && sectionName) title = `${title} for ${sectionName}`;
  const weekStart = details.reportWeekStartDate || details.weekStartDate;
  const weekDetail = isReportAction && typeof weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    ? `Week of ${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${weekStart}T00:00:00.000Z`))}`
    : '';
  const itemActivity = formatItemActivity(row, details);
  const enrollment = row.actionType === 'student_enrolled' ? enrollmentActivity(row, details, title) : null;
  const sectionChange = ['student_moved', 'student_withdrawn'].includes(row.actionType)
    ? sectionChangeActivity(row, details, title) : null;
  const isTeacherAssignment = ['teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned'].includes(row.actionType)
    && !row.isLegacyShs;
  const teacherAssignment = isTeacherAssignment ? teacherAssignmentActivity(row, details) : null;
  const isTimetableAction = ['timetable_meeting_created', 'timetable_meeting_updated', 'timetable_meeting_deleted'].includes(row.actionType)
    && !isShsActivity;
  const timetable = isTimetableAction ? timetableActivity(details) : null;
  const account = CATEGORIES.accounts.includes(row.actionType) && row.actionType !== 'users_imported'
    ? accountActivity(row, details, title) : null;
  const shsChoice = isShsChoice ? shsChoiceActivity(row, shsDetails, title) : null;
  const shsProgram = isShsActivity && !isShsChoice ? shsProgramActivity(row, shsDetails, title) : null;
  const importedRole = String(details.role || '').replace(/_/g, ' ').trim();
  const importedCount = Number(details.accountCount ?? details.count);
  const importedRoleLabels = {
    student: ['student', 'students'], parent: ['parent', 'parents'], teacher: ['teacher', 'teachers'],
    school_admin: ['school admin', 'school admins']
  };
  const [importedRoleSingular, importedRolePlural] = importedRoleLabels[importedRole]
    || [importedRole || 'user', `${importedRole || 'user'}s`];
  const importedContext = row.actionType === 'users_imported' && Number.isSafeInteger(importedCount) && importedCount >= 0
    ? `${importedCount} ${importedCount === 1 ? importedRoleSingular : importedRolePlural}` : '';
  const genericContext = genericActivityContext(row, details);
  const summaryContext = readableSummaryContext(row.actionType, details.summary);
  const detail = account ? account.detail : enrollment ? enrollment.detail : sectionChange ? sectionChange.detail : teacherAssignment ? teacherAssignment.detail : shsChoice ? shsChoice.detail : shsProgram ? shsProgram.detail : itemActivity ? itemActivity.detail : isReportAction ? weekDetail
    : timetable ? timetable
    : importedContext || genericContext || details.form_code
    || (details.attendance_date ? `Attendance for ${details.attendance_date}` : '')
    || (row.actionType === 'parent_notification_triggers_updated' ? '' : summaryContext);
  const isSchoolResubmission = row.actionType === 'school_registration_resubmitted'
    && (details.source === 'school_record' || /\bregistration\s+(?:was\s+)?resubmitted$/i.test(cleanLegacyText(details.summary || '')));

  return {
    id: String(row.id),
    schoolId: row.schoolId ? String(row.schoolId) : null,
    schoolName: row.schoolName || '',
    actor: isSchoolResubmission ? row.schoolName || 'School account' : row.actor || 'System',
    title: isSchoolResubmission ? 'resubmitted its registration'
      : account?.title || enrollment?.title || sectionChange?.title || teacherAssignment?.title
        || shsChoice?.title || shsProgram?.title || itemActivity?.title || title,
    detail: isSchoolResubmission ? '' : String(detail || ''),
    icon,
    tone,
    type: CATEGORY_LABELS[category] || 'System',
    category: category || 'system',
    createdAt: row.createdAt
  };
}

function parseLimit(value) {
  if (value === undefined) return 20;
  if (!/^\d+$/.test(String(value))) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 ? limit : null;
}

function parseCursor(value) {
  if (!value) return null;
  if (String(value).length > 300 || !/^[A-Za-z0-9_-]+$/.test(String(value))) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cursor.createdAt)
      || !/^[1-9]\d{0,19}$/.test(String(cursor.id))) return null;
    return { createdAt: cursor.createdAt, id: String(cursor.id) };
  } catch { return null; }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.cursorCreatedAt, id: String(row.id) })).toString('base64url');
}

function schoolDate() {
  const timeZone = process.env.SCHOOL_TIME_ZONE || 'Asia/Manila';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFilterRange(value) {
  if (!value || value === 'all') return null;
  if (!['today', '7', '30'].includes(String(value))) return undefined;
  const end = schoolDate();
  const startDate = new Date(`${end}T00:00:00Z`);
  const days = value === 'today' ? 1 : Number(value);
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  return { start: startDate.toISOString().slice(0, 10), end };
}

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listSchoolActivity(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit);
    if (!limit) throw createError('Activity page size must be between 1 and 50.');
    const category = String(req.query.category || 'all');
    if (category !== 'all' && !Object.hasOwn(CATEGORIES, category)) throw createError('Activity category is invalid.');
    const search = String(req.query.search || '').trim();
    if (search.length > 100) throw createError('Activity search is too long.');
    const range = dateFilterRange(req.query.date);
    if (range === undefined) throw createError('Activity date filter is invalid.');
    const cursor = parseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) throw createError('Activity cursor is invalid.');

    const where = ['audit_logs.school_id = ?'];
    const values = [req.user.schoolId];
    if (category !== 'all') {
      const actionTypes = CATEGORIES[category];
      const actionFilter = `audit_logs.action_type IN (${actionTypes.map(() => '?').join(', ')})`;
      const legacyShsSubject = `audit_logs.action_type IN ('subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted')
        AND EXISTS (SELECT 1 FROM subjects legacy_subject
          JOIN school_levels legacy_level ON legacy_level.id = legacy_subject.school_level_id
            AND legacy_level.school_id = legacy_subject.school_id
          WHERE legacy_subject.id = CAST(audit_logs.entity_id AS UNSIGNED)
            AND legacy_subject.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs')`;
      const legacyShsTeacher = `audit_logs.action_type IN ('teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned')
        AND EXISTS (SELECT 1 FROM section_teachers legacy_assignment
          JOIN sections legacy_section ON legacy_section.id = legacy_assignment.section_id AND legacy_section.school_id = legacy_assignment.school_id
          JOIN school_levels legacy_level ON legacy_level.id = legacy_section.school_level_id AND legacy_level.school_id = legacy_section.school_id
          WHERE legacy_assignment.id = CAST(audit_logs.entity_id AS UNSIGNED)
            AND legacy_assignment.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs')`;
      const legacyShsMeeting = `audit_logs.action_type IN ('timetable_meeting_created', 'timetable_meeting_updated', 'timetable_meeting_deleted')
        AND (JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.summary')) LIKE 'Elective class %'
          OR EXISTS (SELECT 1 FROM timetable_meetings legacy_meeting
            JOIN scheduled_classes legacy_scheduled ON legacy_scheduled.id = legacy_meeting.scheduled_class_id
              AND legacy_scheduled.school_id = legacy_meeting.school_id
            JOIN section_teachers legacy_assignment ON legacy_assignment.id = legacy_scheduled.assignment_id
              AND legacy_assignment.school_id = legacy_scheduled.school_id
            JOIN sections legacy_section ON legacy_section.id = legacy_assignment.section_id AND legacy_section.school_id = legacy_assignment.school_id
            JOIN school_levels legacy_level ON legacy_level.id = legacy_section.school_level_id AND legacy_level.school_id = legacy_section.school_id
            WHERE legacy_meeting.id = CAST(audit_logs.entity_id AS UNSIGNED)
              AND legacy_meeting.school_id = audit_logs.school_id AND legacy_level.level_code = 'shs'))`;
      const legacyShs = LEGACY_SHS_ACTIVITY_SQL;
      if (category === 'shs_program') where.push(`(${actionFilter} OR ${legacyShs})`);
      else if (category === 'class_management') where.push(`(${actionFilter} AND NOT ${legacyShs})`);
      else where.push(actionFilter);
      values.push(...actionTypes);
    }
    if (search) {
      const term = `%${search}%`;
      where.push(`(users.display_name LIKE ? OR audit_logs.action_type LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.summary')) LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.studentName')) LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.subjectName')) LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.className')) LIKE ?
        OR activity_sections.name LIKE ? OR school_grade_levels.display_name LIKE ?)`);
      values.push(term, term, term, term, term, term, term, term);
    }
    if (range) {
      where.push('audit_logs.created_at >= ? AND audit_logs.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      values.push(range.start, range.end);
    }
    if (cursor) {
      where.push('(audit_logs.created_at < ? OR (audit_logs.created_at = ? AND audit_logs.id < ?))');
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    const [rows] = await getDatabase().execute(
      `SELECT audit_logs.id, audit_logs.school_id AS schoolId, audit_logs.action_type AS actionType,
        audit_logs.entity_type AS entityType, audit_logs.details, audit_logs.created_at AS createdAt,
        DATE_FORMAT(audit_logs.created_at, '%Y-%m-%d %H:%i:%s') AS cursorCreatedAt,
        users.display_name AS actor, school_grade_levels.display_name AS sectionGrade,
        activity_sections.name AS sectionName,
        CASE WHEN ${LEGACY_SHS_ACTIVITY_SQL} THEN 1 ELSE 0 END AS isLegacyShs
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.actor_user_id
      LEFT JOIN sections AS activity_sections ON activity_sections.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.sectionId')) AS UNSIGNED)
        AND activity_sections.school_id = audit_logs.school_id
      LEFT JOIN school_grade_levels ON school_grade_levels.id = activity_sections.grade_level_id
        AND school_grade_levels.school_id = activity_sections.school_id
      WHERE ${where.join(' AND ')}
      ORDER BY audit_logs.created_at DESC, audit_logs.id DESC LIMIT ?`,
      [...values, limit + 1]
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    res.set('Cache-Control', 'no-store');
    res.json({
      activities: pageRows.map(formatActivity),
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      hasMore
    });
  } catch (error) { next(error); }
}

async function listPlatformActivity(req, res, next) {
  try {
    const limit = parseLimit(req.query.limit);
    if (!limit) throw createError('Activity page size must be between 1 and 50.');
    const category = String(req.query.category || 'all');
    if (category !== 'all' && !Object.hasOwn(PLATFORM_CATEGORIES, category)) throw createError('Activity category is invalid.');
    const search = String(req.query.search || '').trim();
    if (search.length > 100) throw createError('Activity search is too long.');
    const range = dateFilterRange(req.query.date);
    if (range === undefined) throw createError('Activity date filter is invalid.');
    const cursor = parseCursor(req.query.cursor);
    if (req.query.cursor && !cursor) throw createError('Activity cursor is invalid.');
    const actions = category === 'all' ? PLATFORM_ACTIONS : PLATFORM_CATEGORIES[category];
    const where = [`audit_logs.action_type IN (${actions.map(() => '?').join(', ')})`, "audit_logs.entity_type = 'school'"];
    const values = [...actions];
    if (search) {
      const term = `%${search}%`;
      where.push(`(users.display_name LIKE ? OR schools.name LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.summary')) LIKE ?)`);
      values.push(term, term, term);
    }
    if (range) {
      where.push('audit_logs.created_at >= ? AND audit_logs.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      values.push(range.start, range.end);
    }
    if (cursor) {
      where.push('(audit_logs.created_at < ? OR (audit_logs.created_at = ? AND audit_logs.id < ?))');
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const [rows] = await getDatabase().execute(
      `SELECT audit_logs.id, audit_logs.school_id AS schoolId, schools.name AS schoolName,
        audit_logs.action_type AS actionType, audit_logs.entity_type AS entityType, audit_logs.details,
        audit_logs.created_at AS createdAt,
        DATE_FORMAT(audit_logs.created_at, '%Y-%m-%d %H:%i:%s') AS cursorCreatedAt,
        users.display_name AS actor
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.actor_user_id
      LEFT JOIN schools ON schools.id = audit_logs.school_id
      WHERE ${where.join(' AND ')}
      ORDER BY audit_logs.created_at DESC, audit_logs.id DESC LIMIT ?`,
      [...values, limit + 1]
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    res.set('Cache-Control', 'no-store');
    res.json({
      activities: pageRows.map(row => {
        const event = formatActivity(row);
        if (row.actionType === 'school_deleted') event.schoolName = parseDetails(row.details).summary || '';
        const access = PLATFORM_CATEGORIES.access.includes(row.actionType);
        const details = parseDetails(row.details);
        const registrationSummary = cleanLegacyText(details.summary || '');
        const schoolRecordRegistration = details.source === 'school_record'
          || (['school_registration_submitted', 'school_registration_resubmitted'].includes(row.actionType)
            && /\bregistration\s+(?:was\s+)?(?:re)?submitted$/i.test(registrationSummary));
        if (schoolRecordRegistration) {
          event.actor = row.schoolName || 'School account';
          event.title = {
            school_registration_submitted: 'registration was submitted',
            school_registration_resubmitted: 'registration was resubmitted',
            school_registration_approved: 'registration was approved',
            school_registration_rejected: 'registration was rejected'
          }[row.actionType] || event.title;
          event.detail = '';
        }
        return { ...event, type: access ? 'School access' : 'Registrations', category: access ? 'access' : 'registrations' };
      }),
      nextCursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      hasMore
    });
  } catch (error) { next(error); }
}

module.exports = { listSchoolActivity, listPlatformActivity, CATEGORIES, PLATFORM_CATEGORIES, ACTION_LABELS, formatActivity };
