const { getDatabase } = require('../config/database');

const CATEGORIES = {
  accounts: ['user_created', 'user_updated', 'user_activated', 'user_deactivated', 'user_deleted', 'users_imported'],
  class_management: [
    'section_created', 'section_updated', 'section_deleted', 'student_enrolled', 'student_moved',
    'student_withdrawn', 'teacher_assigned', 'teacher_assignment_updated', 'teacher_unassigned',
    'subject_created', 'subject_updated', 'subject_deactivated', 'subject_deleted'
  ],
  announcements: ['announcement_draft_created', 'announcement_scheduled', 'announcement_published', 'announcement_updated', 'announcement_pinned', 'announcement_unpinned', 'announcement_deleted'],
  school_configuration: [
    'school_settings_updated', 'school_logo_updated', 'portal_features_updated', 'academic_structure_updated',
    'academic_year_created', 'academic_year_updated', 'academic_term_created', 'academic_term_updated',
    'academic_term_activated', 'academic_term_completed', 'academic_term_extended', 'grading_categories_updated',
    'school_registration_submitted', 'school_registration_approved', 'school_registration_rejected'
  ],
  reopen_requests: [
    'grading_period_reopen_requested', 'grading_period_reopen_approved', 'grading_period_reopen_rejected',
    'grading_period_reopen_extended', 'grading_period_reopen_revoked'
  ],
  grades: ['final_grades_published'],
  attendance: ['attendance_confirmed', 'qr_credential_regenerated'],
  school_forms: ['school_form_generated'],
  archives: ['academic_year_archived']
};

const PLATFORM_CATEGORIES = {
  registrations: ['school_registration_submitted', 'school_registration_approved', 'school_registration_rejected'],
  access: ['school_suspended', 'school_reactivated']
};
const PLATFORM_ACTIONS = Object.values(PLATFORM_CATEGORIES).flat();

const CATEGORY_LABELS = {
  accounts: 'Accounts',
  class_management: 'Class management',
  announcements: 'Announcements',
  school_configuration: 'School configuration',
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
  announcement_draft_created: ['created an announcement draft', 'megaphone', 'purple', 'announcements'],
  announcement_published: ['published an announcement', 'megaphone', 'purple', 'announcements'],
  announcement_scheduled: ['scheduled an announcement', 'calendar-clock', 'purple', 'announcements'],
  announcement_pinned: ['pinned an announcement', 'pin', 'purple', 'announcements'],
  announcement_unpinned: ['unpinned an announcement', 'pin-off', 'purple', 'announcements'],
  announcement_updated: ['updated an announcement', 'megaphone', 'blue', 'announcements'],
  announcement_deleted: ['deleted an announcement', 'megaphone', 'red', 'announcements'],
  school_settings_updated: ['updated school settings', 'settings-2', 'gold', 'school_configuration'],
  portal_features_updated: ['updated portal features', 'settings-2', 'gold', 'school_configuration'],
  academic_structure_updated: ['updated the academic structure', 'settings-2', 'gold', 'school_configuration'],
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
  school_reactivated: ['reactivated a school account', 'building-2', 'green', 'school_configuration'],
  school_logo_updated: ['updated the school logo', 'image', 'blue', 'school_configuration'],
  grading_period_reopen_requested: ['requested grade editing access', 'lock-keyhole-open', 'gold', 'reopen_requests'],
  grading_period_reopen_approved: ['approved a grade editing request', 'lock-keyhole-open', 'green', 'reopen_requests'],
  grading_period_reopen_rejected: ['rejected a grade editing request', 'lock-keyhole', 'red', 'reopen_requests'],
  grading_period_reopen_extended: ['extended grade editing access', 'calendar-plus', 'gold', 'reopen_requests'],
  grading_period_reopen_revoked: ['revoked grade editing access', 'lock-keyhole', 'red', 'reopen_requests'],
  final_grades_published: ['published final grades', 'graduation-cap', 'green', 'grades'],
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
  const [title, icon, tone, category] = label || ['recorded a system activity', 'activity', 'blue', null];
  const detail = details.summary
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
      `SELECT audit_logs.id, audit_logs.school_id AS schoolId, audit_logs.action_type AS actionType,
        audit_logs.entity_type AS entityType, audit_logs.details, audit_logs.created_at AS createdAt,
        DATE_FORMAT(audit_logs.created_at, '%Y-%m-%d %H:%i:%s') AS cursorCreatedAt,
        users.display_name AS actor
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.actor_user_id
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
