const { getDatabase } = require('../config/database');

const CATEGORIES = {
  accounts: ['user_created', 'user_updated', 'user_activated', 'user_deactivated', 'user_deleted', 'users_imported'],
  class_management: [
    'section_created', 'section_updated', 'section_deleted', 'student_enrolled', 'student_moved',
    'student_withdrawn', 'teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned',
    'section_strand_classified', 'subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted'
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
  registrations: ['school_registration_submitted', 'school_registration_approved', 'school_registration_rejected'],
  access: ['school_suspended', 'school_reactivated', 'school_deleted']
};
const PLATFORM_ACTIONS = Object.values(PLATFORM_CATEGORIES).flat();

const CATEGORY_LABELS = {
  accounts: 'Accounts',
  class_management: 'Class management',
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
  student_moved: ['moved a student to another section', 'users-round', 'blue', 'class_management'],
  student_withdrawn: ['withdrew a student from a section', 'user-minus', 'orange', 'class_management'],
  teacher_assigned: ['assigned a teacher to a subject', 'user-check', 'blue', 'class_management'],
  teacher_assignment_updated: ['changed a teacher assignment', 'user-round-pen', 'blue', 'class_management'],
  teacher_unassigned: ['removed a teacher assignment', 'user-minus', 'orange', 'class_management'],
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

function formatActivity(row) {
  const details = parseDetails(row.details);
  const label = ACTION_LABELS[row.actionType];
  let [title, icon, tone, category] = label || ['recorded an activity', 'activity', 'blue', null];
  const isReportAction = CATEGORIES.narrative_reports.includes(row.actionType);
  const sectionName = row.sectionName && row.sectionGrade ? `${row.sectionGrade} · ${row.sectionName}` : null;
  if (isReportAction && sectionName) title = `${title} for ${sectionName}`;
  if (row.actionType === 'assignment_updated') {
    const statusChanged = details.statusChanged === true;
    const detailsChanged = details.detailsChanged === true;
    const targetStatus = details.toStatus;
    if (statusChanged && targetStatus === 'published') {
      title = detailsChanged ? 'updated and published an assignment' : 'published an assignment';
    } else if (statusChanged && targetStatus === 'closed') {
      title = detailsChanged ? 'updated and closed an assignment' : 'closed an assignment';
    } else if (statusChanged && targetStatus === 'draft') {
      title = detailsChanged ? 'updated an assignment and moved it to draft' : 'moved an assignment to draft';
    }
  }
  if (row.actionType === 'learning_material_visibility_changed') {
    title = details.toStatus === 'published' ? 'published a learning material' : 'moved a learning material to draft';
  }
  const weekStart = details.reportWeekStartDate || details.weekStartDate;
  const weekDetail = isReportAction && typeof weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
    ? `· Week of ${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${weekStart}T00:00:00.000Z`))}`
    : '';
  const hasItemContext = CATEGORIES.assignments.includes(row.actionType) || CATEGORIES.learning_materials.includes(row.actionType);
  const itemSummary = details.summary || details.title || '';
  const itemStatus = details.status ? ` (${String(details.status).replace(/^./, first => first.toUpperCase())})` : '';
  const detail = isReportAction ? weekDetail
    : hasItemContext ? `${itemSummary ? `: ${itemSummary}` : ''}${itemStatus}`
    : row.actionType === 'parent_notification_triggers_updated' ? '' : details.summary
    || details.label
    || details.form_code
    || (details.attendance_date ? `Attendance · ${details.attendance_date}` : '')
    || (row.entityType ? row.entityType.replace(/_/g, ' ') : '');

  return {
    id: String(row.id),
    schoolId: row.schoolId ? String(row.schoolId) : null,
    schoolName: row.schoolName || '',
    actor: row.actor || 'System',
    title,
    detail: String(detail || ''),
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
      where.push(`audit_logs.action_type IN (${actionTypes.map(() => '?').join(', ')})`);
      values.push(...actionTypes);
    }
    if (search) {
      const term = `%${search}%`;
      where.push(`(users.display_name LIKE ? OR audit_logs.action_type LIKE ?
        OR JSON_UNQUOTE(JSON_EXTRACT(audit_logs.details, '$.summary')) LIKE ?
        OR activity_sections.name LIKE ? OR school_grade_levels.display_name LIKE ?)`);
      values.push(term, term, term, term, term);
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
        activity_sections.name AS sectionName
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
        if (parseDetails(row.details).source === 'school_record') {
          event.actor = row.schoolName || 'School account';
          event.title = {
            school_registration_submitted: 'registration was submitted',
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

module.exports = { listSchoolActivity, listPlatformActivity };
