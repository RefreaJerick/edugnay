const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) {
    throw createError(`Invalid ${label}.`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function requiredText(value, maximum, label) {
  const result = String(value || '').trim();
  if (!result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result;
}

function optionalText(value, maximum, label) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result || null;
}

function dateTime(value, label = 'Expiration time') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  if (!match) throw createError(`${label} is invalid.`);
  const [, year, month, day, hour, minute, second = '00'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const check = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth() !== parts[1] - 1
    || check.getUTCDate() !== parts[2] || check.getUTCHours() !== parts[3]
    || check.getUTCMinutes() !== parts[4] || check.getUTCSeconds() !== parts[5]) {
    throw createError(`${label} is invalid.`);
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

const REQUEST_COLUMNS = `
  grading_period_reopen_requests.id AS id,
  grading_period_reopen_requests.school_id AS schoolId,
  grading_period_reopen_requests.academic_term_id AS academicTermId,
  grading_period_reopen_requests.section_id AS sectionId,
  grading_period_reopen_requests.subject_id AS subjectId,
  grading_period_reopen_requests.teacher_user_id AS teacherId,
  users.display_name AS teacherName,
  sections.name AS sectionName,
  subjects.name AS subjectName,
  academic_terms.name AS academicTermName,
  grading_period_reopen_requests.reason AS reason,
  grading_period_reopen_requests.request_status AS requestStatus,
  CASE WHEN grading_period_reopen_requests.request_status = 'approved'
    AND grading_period_reopen_requests.expires_at <= NOW() THEN 'expired'
    ELSE grading_period_reopen_requests.request_status END AS status,
  grading_period_reopen_requests.review_note AS adminNote,
  grading_period_reopen_requests.last_action_note AS lastActionNote,
  grading_period_reopen_requests.reviewed_by_user_id AS reviewedBy,
  grading_period_reopen_requests.reviewed_at AS reviewedAt,
  grading_period_reopen_requests.approved_at AS approvedAt,
  grading_period_reopen_requests.expires_at AS expiresAt,
  grading_period_reopen_requests.created_at AS requestedAt,
  grading_period_reopen_requests.updated_at AS updatedAt`;

const REQUEST_JOINS = `
  FROM grading_period_reopen_requests
  INNER JOIN users ON users.id = grading_period_reopen_requests.teacher_user_id
  INNER JOIN sections ON sections.id = grading_period_reopen_requests.section_id
    AND sections.school_id = grading_period_reopen_requests.school_id
  INNER JOIN subjects ON subjects.id = grading_period_reopen_requests.subject_id
    AND subjects.school_id = grading_period_reopen_requests.school_id
  INNER JOIN academic_terms ON academic_terms.id = grading_period_reopen_requests.academic_term_id
    AND academic_terms.academic_year_id = sections.academic_year_id
    AND academic_terms.school_level_id = sections.school_level_id`;

function formatRequest(row) {
  const status = row.status || row.requestStatus;
  return {
    id: String(row.id),
    schoolId: String(row.schoolId),
    academicTermId: String(row.academicTermId),
    academicPeriodId: String(row.academicTermId),
    sectionId: String(row.sectionId),
    subjectId: String(row.subjectId),
    teacherId: String(row.teacherId),
    teacher: row.teacherName || 'Teacher',
    section: row.sectionName || 'Section',
    subject: row.subjectName || 'Subject',
    academicTermName: row.academicTermName || 'Grading period',
    reason: row.reason,
    status,
    adminNote: row.adminNote || null,
    extensionReason: status === 'approved' ? row.lastActionNote || null : null,
    revokeReason: status === 'revoked' ? row.lastActionNote || null : null,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy == null ? null : String(row.reviewedBy),
    approvedAt: row.approvedAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt
  };
}

async function getDetailedRequest(connection, requestId, schoolId) {
  const [rows] = await connection.execute(
    `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
     WHERE grading_period_reopen_requests.id = ?
       AND grading_period_reopen_requests.school_id = ? LIMIT 1`,
    [requestId, schoolId]
  );
  return rows[0] || null;
}

async function getRequestForUpdate(connection, requestId, schoolId) {
  const [rows] = await connection.execute(
    `SELECT id, school_id AS schoolId, academic_term_id AS academicTermId,
      section_id AS sectionId, subject_id AS subjectId,
      teacher_user_id AS teacherId, request_status AS status, expires_at AS expiresAt
     FROM grading_period_reopen_requests
     WHERE id = ? AND school_id = ? FOR UPDATE`,
    [requestId, schoolId]
  );
  if (!rows.length) throw createError('Reopen request was not found.', 404);
  return rows[0];
}

async function getRequestSummary(connection, requestId, schoolId) {
  const [rows] = await connection.execute(
    `SELECT id, school_id AS schoolId, academic_term_id AS academicTermId,
      section_id AS sectionId, subject_id AS subjectId,
      teacher_user_id AS teacherId, request_status AS status
     FROM grading_period_reopen_requests
     WHERE id = ? AND school_id = ? LIMIT 1`,
    [requestId, schoolId]
  );
  if (!rows.length) throw createError('Reopen request was not found.', 404);
  return rows[0];
}

async function getScope(connection, schoolId, sectionId, subjectId, academicTermId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT sections.id AS sectionId, sections.school_id AS schoolId,
      sections.academic_year_id AS academicYearId, sections.school_level_id AS schoolLevelId,
      sections.status AS sectionStatus, academic_years.status AS academicYearStatus,
      subjects.id AS subjectId,
      academic_terms.id AS academicTermId, academic_terms.name AS academicTermName,
      academic_terms.status AS termStatus
     FROM sections
     INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
       AND academic_years.school_id = sections.school_id
     INNER JOIN subjects ON subjects.id = ? AND subjects.school_id = sections.school_id
     INNER JOIN academic_terms ON academic_terms.academic_year_id = sections.academic_year_id
       AND academic_terms.school_level_id = sections.school_level_id
       AND academic_terms.id = ?
     WHERE sections.id = ? AND sections.school_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [subjectId, academicTermId, sectionId, schoolId]
  );
  return rows[0] || null;
}

async function requireTeacherAssignment(connection, teacherId, sectionId, subjectId, schoolId) {
  const [rows] = await connection.execute(
    `SELECT 1 FROM section_teachers
     INNER JOIN sections ON sections.id = section_teachers.section_id
       AND sections.school_id = ? AND sections.status = 'active'
     INNER JOIN subjects ON subjects.id = section_teachers.subject_id
       AND subjects.school_id = sections.school_id
     INNER JOIN users AS teachers ON teachers.id = section_teachers.teacher_user_id
       AND teachers.school_id = sections.school_id AND teachers.role = 'teacher'
       AND teachers.account_status = 'active'
     WHERE section_teachers.teacher_user_id = ?
       AND section_teachers.section_id = ? AND section_teachers.subject_id = ? LIMIT 1 FOR UPDATE`,
    [schoolId, teacherId, sectionId, subjectId]
  );
  if (!rows.length) throw createError('You are not assigned to this section and subject.', 403);
}

async function requireValidExpiry(connection, value) {
  const [rows] = await connection.execute(
    'SELECT CAST(? AS DATETIME) > NOW() AS isValid',
    [value]
  );
  if (!Number(rows[0]?.isValid)) {
    throw createError('Choose an expiration time in the future.');
  }
}

async function hasConflictingRequest(connection, scope, exceptId = null) {
  const exceptFilter = exceptId === null ? '' : 'AND id <> ?';
  const values = [scope.schoolId, scope.academicTermId, scope.sectionId, scope.subjectId];
  if (exceptId !== null) values.push(exceptId);
  const [rows] = await connection.execute(
    `SELECT id FROM grading_period_reopen_requests
     WHERE school_id = ? AND academic_term_id = ? AND section_id = ? AND subject_id = ?
       ${exceptFilter}
       AND (request_status = 'pending'
         OR (request_status = 'approved' AND expires_at > NOW()))
     LIMIT 1 FOR UPDATE`,
    values
  );
  return rows.length > 0;
}

async function listRequests(req, res, next) {
  try {
    const values = [req.user.schoolId];
    const where = ['grading_period_reopen_requests.school_id = ?'];
    if (req.user.role === 'teacher') {
      where.push('grading_period_reopen_requests.teacher_user_id = ?');
      values.push(req.user.id);
    }
    for (const [name, column] of [
      ['sectionId', 'grading_period_reopen_requests.section_id'],
      ['subjectId', 'grading_period_reopen_requests.subject_id'],
      ['academicTermId', 'grading_period_reopen_requests.academic_term_id']
    ]) {
      if (req.query[name] !== undefined) {
        where.push(`${column} = ?`);
        values.push(parseId(req.query[name], name));
      }
    }
    const [rows] = await getDatabase().execute(
      `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
       WHERE ${where.join(' AND ')}
       ORDER BY grading_period_reopen_requests.created_at DESC,
         grading_period_reopen_requests.id DESC`,
      values
    );
    res.set('Cache-Control', 'no-store');
    res.json({ requests: rows.map(formatRequest) });
  } catch (error) { next(error); }
}

async function getTeacherEditAccess(req, res, next) {
  try {
    const sectionId = parseId(req.query.sectionId, 'section ID');
    const subjectId = parseId(req.query.subjectId, 'subject ID');
    const academicTermId = parseId(req.query.academicTermId, 'academic term ID');
    const database = getDatabase();
    const scope = await getScope(database, req.user.schoolId, sectionId, subjectId, academicTermId);
    if (!scope || scope.sectionStatus !== 'active') throw createError('The grading period or section was not found.', 404);
    await requireTeacherAssignment(database, req.user.id, sectionId, subjectId, req.user.schoolId);

    const [rows] = await database.execute(
      `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
       WHERE grading_period_reopen_requests.school_id = ?
         AND grading_period_reopen_requests.teacher_user_id = ?
         AND grading_period_reopen_requests.section_id = ?
         AND grading_period_reopen_requests.subject_id = ?
         AND grading_period_reopen_requests.academic_term_id = ?
       ORDER BY grading_period_reopen_requests.created_at DESC,
         grading_period_reopen_requests.id DESC LIMIT 1`,
      [req.user.schoolId, req.user.id, sectionId, subjectId, academicTermId]
    );
    const request = rows[0] ? formatRequest(rows[0]) : null;
    const canEdit = scope.academicYearStatus === 'active'
      && (scope.termStatus === 'active'
        || (scope.termStatus === 'closed' && request?.status === 'approved'));

    res.set('Cache-Control', 'no-store');
    res.json({
      academicTermId: String(academicTermId),
      termStatus: scope.termStatus,
      academicYearStatus: scope.academicYearStatus,
      canEdit,
      request
    });
  } catch (error) { next(error); }
}

async function createRequest(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    const sectionId = parseId(req.body.sectionId, 'section ID');
    const subjectId = parseId(req.body.subjectId, 'subject ID');
    const academicTermId = parseId(req.body.academicTermId, 'academic term ID');
    const reason = requiredText(req.body.reason, 2000, 'Reason');
    await connection.beginTransaction();
    transactionStarted = true;

    const scope = await getScope(connection, req.user.schoolId, sectionId, subjectId, academicTermId, true);
    if (!scope || scope.sectionStatus !== 'active') throw createError('The grading period or section was not found.', 404);
    if (scope.termStatus !== 'closed') throw createError('Only a closed grading period can be reopened.', 409);
    if (scope.academicYearStatus !== 'active') throw createError('Only terms in the active school year can be reopened.', 409);
    await requireTeacherAssignment(connection, req.user.id, sectionId, subjectId, req.user.schoolId);
    if (await hasConflictingRequest(connection, scope)) {
      throw createError('A pending request or active approval already exists for this section, subject, and grading period.', 409);
    }

    const [result] = await connection.execute(
      `INSERT INTO grading_period_reopen_requests
        (school_id, academic_term_id, section_id, subject_id, teacher_user_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.schoolId, academicTermId, sectionId, subjectId, req.user.id, reason]
    );
    const row = await getDetailedRequest(connection, result.insertId, req.user.schoolId);
    await writeAuditLog(connection, req, 'grading_period_reopen_requested', 'grading_period_reopen_request', result.insertId, {
      summary: `${row.subjectName} · ${row.sectionName} · ${row.academicTermName}`
    });
    await connection.commit();
    transactionStarted = false;
    res.status(201).json({ request: formatRequest(row) });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function getLockedScopeForRequest(connection, request, requireAssignment = false) {
  const scope = await getScope(
    connection,
    Number(request.schoolId),
    Number(request.sectionId),
    Number(request.subjectId),
    Number(request.academicTermId),
    true
  );
  if (!scope || scope.sectionStatus !== 'active' || scope.termStatus !== 'closed') {
    throw createError('This request no longer matches a closed grading period.', 409);
  }
  if (scope.academicYearStatus !== 'active') throw createError('Only terms in the active school year can be reopened.', 409);
  if (requireAssignment) {
    await requireTeacherAssignment(connection, request.teacherId, request.sectionId, request.subjectId, request.schoolId);
  }
  return scope;
}

function getDecisionNotification(action, request, expiresAt) {
  const scope = `${request.subjectName} in ${request.sectionName} (${request.academicTermName})`;
  const adminNote = String(request.adminNote || '').trim();
  const actionNote = String(request.lastActionNote || '').trim();
  const deadline = expiresAt ? String(expiresAt).slice(0, 16) : '';
  let title;
  let message;

  if (action === 'approve') {
    title = 'Grade access approved';
    message = `Your request to edit grades for ${scope} was approved. You may edit until ${deadline} (school local time).`;
    if (adminNote) message += ` Admin note: ${adminNote}`;
  } else if (action === 'reject') {
    title = 'Grade access request rejected';
    message = `Your request to edit grades for ${scope} was rejected.${adminNote ? ` Admin note: ${adminNote}` : ''}`;
  } else if (action === 'extend') {
    title = 'Grade editing deadline extended';
    message = `Your grade editing access for ${scope} was extended until ${deadline} (school local time).${actionNote ? ` Reason: ${actionNote}` : ''}`;
  } else {
    title = 'Grade editing access revoked';
    message = `Your grade editing access for ${scope} was revoked.${actionNote ? ` Reason: ${actionNote}` : ''}`;
  }

  const targetPath = `/views/teacher/edugnay-teacher-sections.html?sectionId=${encodeURIComponent(String(request.sectionId))}&subjectId=${encodeURIComponent(String(request.subjectId))}&tab=scores`;
  return { title, message, targetPath };
}

async function respondToRequest(req, res, next, action) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  let expiresAt = null;
  try {
    const requestId = parseId(req.params.requestId, 'request ID');
    await connection.beginTransaction();
    transactionStarted = true;
    const requestSummary = await getRequestSummary(connection, requestId, req.user.schoolId);
    let scope = null;
    if (action === 'approve') {
      scope = await getLockedScopeForRequest(connection, requestSummary, true);
    } else if (action === 'extend') {
      await getLockedScopeForRequest(connection, requestSummary, true);
    }
    const current = await getRequestForUpdate(connection, requestId, req.user.schoolId);

    if (action === 'approve') {
      if (current.status !== 'pending') throw createError('Only pending requests can be approved.', 409);
      if (await hasConflictingRequest(connection, scope, current.id)) {
        throw createError('Another pending request or active approval already exists for this scope.', 409);
      }
      expiresAt = dateTime(req.body.expiresAt);
      const adminNote = optionalText(req.body.adminNote, 2000, 'Admin note');
      await requireValidExpiry(connection, expiresAt);
      await connection.execute(
        `UPDATE grading_period_reopen_requests
         SET request_status = 'approved', reviewed_by_user_id = ?, reviewed_at = NOW(),
           approved_at = NOW(), expires_at = ?, review_note = ?, last_action_note = NULL
         WHERE id = ? AND school_id = ?`,
        [req.user.id, expiresAt, adminNote, requestId, req.user.schoolId]
      );
    } else if (action === 'reject') {
      if (current.status !== 'pending') throw createError('Only pending requests can be rejected.', 409);
      const adminNote = optionalText(req.body.adminNote, 2000, 'Admin note');
      await connection.execute(
        `UPDATE grading_period_reopen_requests
         SET request_status = 'rejected', reviewed_by_user_id = ?, reviewed_at = NOW(), review_note = ?
         WHERE id = ? AND school_id = ?`,
        [req.user.id, adminNote, requestId, req.user.schoolId]
      );
    } else if (action === 'extend') {
      if (current.status !== 'approved') throw createError('Only active approved access can be extended.', 409);
      expiresAt = dateTime(req.body.expiresAt);
      const reason = requiredText(req.body.reason, 2000, 'Reason for extension');
      await requireValidExpiry(connection, expiresAt);
      const [valid] = await connection.execute(
        `SELECT CAST(? AS DATETIME) > NOW() AND CAST(? AS DATETIME) > expires_at AS isLater
         FROM grading_period_reopen_requests
         WHERE id = ? AND school_id = ? AND request_status = 'approved' AND expires_at > NOW() FOR UPDATE`,
        [expiresAt, expiresAt, requestId, req.user.schoolId]
      );
      if (!Number(valid[0]?.isLater)) throw createError('The new expiration must be later than the current expiration and in the future.');
      await connection.execute(
        `UPDATE grading_period_reopen_requests
         SET expires_at = ?, last_action_note = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
         WHERE id = ? AND school_id = ?`,
        [expiresAt, reason, req.user.id, requestId, req.user.schoolId]
      );
    } else if (action === 'revoke') {
      if (current.status !== 'approved') throw createError('Only active approved access can be revoked.', 409);
      const reason = requiredText(req.body.reason, 2000, 'Revocation reason');
      const [active] = await connection.execute(
        `SELECT id FROM grading_period_reopen_requests
         WHERE id = ? AND school_id = ? AND request_status = 'approved' AND expires_at > NOW() FOR UPDATE`,
        [requestId, req.user.schoolId]
      );
      if (!active.length) throw createError('This approval has expired and can no longer be revoked.', 409);
      await connection.execute(
        `UPDATE grading_period_reopen_requests
         SET request_status = 'revoked', last_action_note = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
         WHERE id = ? AND school_id = ?`,
        [reason, req.user.id, requestId, req.user.schoolId]
      );
    }

    const row = await getDetailedRequest(connection, requestId, req.user.schoolId);
    if (!row) throw createError('Reopen request was not found.', 404);
    const notification = getDecisionNotification(action, row, expiresAt);
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, target_path)
       VALUES (?, 'grading_period_reopen', ?, ?, ?)`,
      [row.teacherId, notification.title, notification.message, notification.targetPath]
    );
    await writeAuditLog(connection, req, `grading_period_reopen_${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'extend' ? 'extended' : 'revoked'}`, 'grading_period_reopen_request', requestId, {
      summary: `${row.teacherName} · ${row.subjectName} · ${row.sectionName} · ${row.academicTermName}`
    });
    await connection.commit();
    transactionStarted = false;
    res.json({ request: formatRequest(row) });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

function approveRequest(req, res, next) { return respondToRequest(req, res, next, 'approve'); }
function rejectRequest(req, res, next) { return respondToRequest(req, res, next, 'reject'); }
function extendRequest(req, res, next) { return respondToRequest(req, res, next, 'extend'); }
function revokeRequest(req, res, next) { return respondToRequest(req, res, next, 'revoke'); }

module.exports = {
  approveRequest,
  createRequest,
  extendRequest,
  getTeacherEditAccess,
  listRequests,
  rejectRequest,
  revokeRequest
};
