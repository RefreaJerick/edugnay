const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getDatabase } = require('../config/database');
const { AVATAR_ERROR, avatarDirectory, avatarMimeType, avatarType, deleteAvatar, saveAvatar } = require('../config/avatars');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function id(value, label) {
  const text = String(value ?? '');
  const number = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(number)) fail(`Invalid ${label}.`);
  return number;
}

function requiredText(value, label, maximum) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > maximum) fail(`${label} is required and must be ${maximum} characters or fewer.`);
  return text;
}

function studentIds(value) {
  let parsed;
  try { parsed = JSON.parse(String(value ?? '')); } catch { fail('Choose at least one linked student.'); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) fail('Choose 1 to 20 linked students.');
  const ids = parsed.map(value => id(value, 'student ID'));
  if (new Set(ids).size !== ids.length) fail('Choose each student only once.');
  return ids;
}

async function eligibleChildren(connection, schoolId, parentId) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT students.id AS studentId, students.display_name AS studentName,
       grade_levels.display_name AS gradeLevel, sections.name AS sectionName
     FROM student_parent_links AS links
     INNER JOIN users AS students ON students.id = links.student_user_id
       AND students.school_id = links.school_id AND students.role = 'student'
       AND students.account_status = 'active'
     INNER JOIN section_students AS enrollment ON enrollment.school_id = links.school_id
       AND enrollment.student_user_id = links.student_user_id AND enrollment.withdrawn_at IS NULL
       AND enrollment.id = (
         SELECT MAX(current_enrollment.id) FROM section_students AS current_enrollment
         INNER JOIN sections AS current_section ON current_section.id = current_enrollment.section_id
           AND current_section.school_id = current_enrollment.school_id AND current_section.status = 'active'
         INNER JOIN academic_years AS current_year ON current_year.id = current_section.academic_year_id
           AND current_year.school_id = current_section.school_id AND current_year.status = 'active'
         WHERE current_enrollment.school_id = links.school_id
           AND current_enrollment.student_user_id = links.student_user_id
           AND current_enrollment.withdrawn_at IS NULL
       )
     INNER JOIN sections ON sections.id = enrollment.section_id
       AND sections.school_id = enrollment.school_id
     INNER JOIN school_grade_levels AS grade_levels ON grade_levels.id = sections.grade_level_id
       AND grade_levels.school_id = sections.school_id
     WHERE links.school_id = ? AND links.parent_user_id = ?
     ORDER BY studentName`,
    [schoolId, parentId]
  );
  return rows.map(row => ({ studentId: Number(row.studentId), studentName: row.studentName,
    gradeLevel: row.gradeLevel, sectionName: row.sectionName }));
}

async function requireEligibleChild(connection, schoolId, parentId, studentId) {
  const [[parent]] = await connection.execute(
    `SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'parent'
       AND account_status = 'active'`, [parentId, schoolId]
  );
  if (!parent) fail('The requesting parent account is not active.', 409);
  const children = await eligibleChildren(connection, schoolId, parentId);
  const child = children.find(item => item.studentId === studentId);
  if (!child) fail('This student is not currently linked and enrolled in your school.', 403);
  return child;
}

async function ownedFetcher(connection, req, fetcherId) {
  const [[fetcher]] = await connection.execute(
    `SELECT id, school_id AS schoolId, parent_user_id AS parentId,
       is_parent_self AS isParentSelf, full_name AS fullName,
       relationship, contact_number AS contactNumber, photo_filename AS photoFilename
     FROM fetchers WHERE id = ? AND school_id = ? AND parent_user_id = ? FOR UPDATE`,
    [fetcherId, req.user.schoolId, req.user.id]
  );
  if (!fetcher || fetcher.isParentSelf) fail('Fetcher not found.', 404);
  return fetcher;
}

function photoUrl(fetcherId, filename) {
  const version = createHash('sha256').update(filename).digest('hex').slice(0, 12);
  return `/api/fetchers/${fetcherId}/photo?v=${version}`;
}

async function listMine(req, res, next) {
  try {
    const database = getDatabase();
    const children = await eligibleChildren(database, req.user.schoolId, req.user.id);
    const [[parent]] = await database.execute(
      `SELECT avatar_filename AS avatarFilename, avatar_version AS avatarVersion
       FROM users WHERE id = ? AND school_id = ? AND role = 'parent' AND account_status = 'active'`,
      [req.user.id, req.user.schoolId]
    );
    const [rows] = await database.execute(
      `SELECT fetchers.id, fetchers.full_name AS fullName, fetchers.relationship,
         fetchers.contact_number AS contactNumber, fetchers.photo_filename AS photoFilename,
         authorizations.id AS authorizationId, authorizations.student_user_id AS studentId,
         students.display_name AS studentName, authorizations.status,
         authorizations.reviewed_at AS reviewedAt
       FROM fetchers
       LEFT JOIN fetcher_authorizations AS authorizations
         ON authorizations.fetcher_id = fetchers.id AND authorizations.school_id = fetchers.school_id
       LEFT JOIN users AS students ON students.id = authorizations.student_user_id
         AND students.school_id = fetchers.school_id
       WHERE fetchers.school_id = ? AND fetchers.parent_user_id = ? AND fetchers.is_parent_self = FALSE
       ORDER BY fetchers.created_at DESC, authorizations.created_at`,
      [req.user.schoolId, req.user.id]
    );
    const byId = new Map();
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, {
        id: Number(row.id), fullName: row.fullName, relationship: row.relationship,
        contactNumber: row.contactNumber, photoUrl: row.photoFilename ? photoUrl(row.id, row.photoFilename) : null,
        authorizations: []
      });
      if (row.authorizationId) byId.get(row.id).authorizations.push({
        id: Number(row.authorizationId), studentId: Number(row.studentId),
        studentName: row.studentName, status: row.status, reviewedAt: row.reviewedAt
      });
    }
    const hasPhoto = Boolean(avatarMimeType(parent?.avatarFilename));
    res.json({
      children,
      self: { eligible: hasPhoto && children.length > 0, hasPhoto,
        photoUrl: hasPhoto ? `/api/users/${req.user.id}/avatar?v=${parent.avatarVersion || 0}` : null,
        children },
      fetchers: [...byId.values()]
    });
  } catch (error) { next(error); }
}

async function createFetcher(req, res, next) {
  let connection;
  let savedPhoto;
  let committed = false;
  try {
    const fullName = requiredText(req.body.fullName, 'Fetcher name', 220);
    const relationship = requiredText(req.body.relationship, 'Relationship', 60);
    const contactNumber = requiredText(req.body.contactNumber, 'Contact number', 30);
    const children = studentIds(req.body.studentIds);
    if (!req.file) fail(AVATAR_ERROR);
    avatarType(req.file);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const eligible = await eligibleChildren(connection, req.user.schoolId, req.user.id);
    if (children.some(child => !eligible.some(item => item.studentId === child))) {
      fail('Choose only currently linked and enrolled students.', 403);
    }
    savedPhoto = await saveAvatar(req.file);
    const [result] = await connection.execute(
      `INSERT INTO fetchers (school_id, parent_user_id, full_name, relationship, contact_number, photo_filename)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.schoolId, req.user.id, fullName, relationship, contactNumber, savedPhoto]
    );
    for (const studentId of children) {
      await connection.execute(
        `INSERT INTO fetcher_authorizations (school_id, fetcher_id, student_user_id, status)
         VALUES (?, ?, ?, 'pending')`, [req.user.schoolId, result.insertId, studentId]
      );
    }
    await writeAuditLog(connection, req, 'fetcher_requested', 'fetcher', result.insertId,
      { summary: fullName, studentIds: children,
        studentNames: children.map(studentId => eligible.find(child => child.studentId === studentId)?.studentName).filter(Boolean) });
    await connection.commit();
    committed = true;
    res.status(201).json({ id: Number(result.insertId), status: 'pending' });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(console.error);
    if (savedPhoto && !committed) await deleteAvatar(savedPhoto).catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function updateFetcher(req, res, next) {
  let connection;
  let savedPhoto;
  let oldPhoto;
  let committed = false;
  try {
    const fetcherId = id(req.params.fetcherId, 'fetcher ID');
    const allowed = ['fullName', 'relationship', 'contactNumber'];
    const body = req.body || {};
    if (Object.keys(body).some(key => !allowed.includes(key))) fail('Unsupported fetcher field.');
    if (!Object.keys(body).length && !req.file) fail('Provide a change to save.');
    if (req.file) avatarType(req.file);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const fetcher = await ownedFetcher(connection, req, fetcherId);
    const fullName = body.fullName === undefined ? fetcher.fullName : requiredText(body.fullName, 'Fetcher name', 220);
    const relationship = body.relationship === undefined ? fetcher.relationship : requiredText(body.relationship, 'Relationship', 60);
    const contactNumber = body.contactNumber === undefined ? fetcher.contactNumber : requiredText(body.contactNumber, 'Contact number', 30);
    const changed = Boolean(req.file) || fullName !== fetcher.fullName
      || relationship !== fetcher.relationship || contactNumber !== fetcher.contactNumber;
    if (!changed) fail('There are no changes to save.');
    oldPhoto = fetcher.photoFilename;
    savedPhoto = req.file ? await saveAvatar(req.file) : null;
    await connection.execute(
      `UPDATE fetchers SET full_name = ?, relationship = ?, contact_number = ?, photo_filename = ?
       WHERE id = ? AND school_id = ?`,
      [fullName, relationship, contactNumber, savedPhoto || oldPhoto, fetcherId, req.user.schoolId]
    );
    await connection.execute(
      `UPDATE fetcher_authorizations SET status = 'pending', reviewed_by_user_id = NULL,
         reviewed_at = NULL
       WHERE school_id = ? AND fetcher_id = ? AND status = 'approved'`,
      [req.user.schoolId, fetcherId]
    );
    await connection.execute(
      `UPDATE fetcher_credentials SET revoked_at = NOW()
       WHERE school_id = ? AND fetcher_id = ? AND revoked_at IS NULL`,
      [req.user.schoolId, fetcherId]
    );
    await writeAuditLog(connection, req, 'fetcher_updated', 'fetcher', fetcherId, { summary: fullName });
    await connection.commit();
    committed = true;
    if (savedPhoto) await deleteAvatar(oldPhoto).catch(console.error);
    res.json({ id: fetcherId, updated: true });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(console.error);
    if (savedPhoto && !committed) await deleteAvatar(savedPhoto).catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function requestChild(req, res, next) {
  let connection;
  try {
    const fetcherId = id(req.params.fetcherId, 'fetcher ID');
    const studentId = id(req.params.studentId, 'student ID');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const fetcher = await ownedFetcher(connection, req, fetcherId);
    const child = await requireEligibleChild(connection, req.user.schoolId, req.user.id, studentId);
    const [[existing]] = await connection.execute(
      `SELECT id, status FROM fetcher_authorizations
       WHERE school_id = ? AND fetcher_id = ? AND student_user_id = ? FOR UPDATE`,
      [req.user.schoolId, fetcherId, studentId]
    );
    if (existing && !['rejected', 'revoked'].includes(existing.status)) fail('This child already has a request for this fetcher.', 409);
    if (existing) {
      await connection.execute(
        `UPDATE fetcher_authorizations SET status = 'pending', reviewed_by_user_id = NULL,
           reviewed_at = NULL WHERE id = ? AND school_id = ?`,
        [existing.id, req.user.schoolId]
      );
    } else {
      await connection.execute(
        `INSERT INTO fetcher_authorizations (school_id, fetcher_id, student_user_id, status)
         VALUES (?, ?, ?, 'pending')`, [req.user.schoolId, fetcherId, studentId]
      );
    }
    await writeAuditLog(connection, req, 'fetcher_requested', 'fetcher', fetcherId,
      { summary: fetcher.fullName, studentId, studentName: child.studentName });
    await connection.commit();
    res.status(existing ? 200 : 201).json({ fetcherId, studentId, status: 'pending' });
  } catch (error) {
    if (connection) await connection.rollback().catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function revokeChild(req, res, next) {
  let connection;
  try {
    const fetcherId = id(req.params.fetcherId, 'fetcher ID');
    const studentId = id(req.params.studentId, 'student ID');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const fetcher = await ownedFetcher(connection, req, fetcherId);
    const [[authorization]] = await connection.execute(
      `SELECT id, status FROM fetcher_authorizations
       WHERE school_id = ? AND fetcher_id = ? AND student_user_id = ? FOR UPDATE`,
      [req.user.schoolId, fetcherId, studentId]
    );
    if (!authorization) fail('Authorization not found.', 404);
    if (authorization.status === 'revoked') fail('Authorization is already revoked.', 409);
    await connection.execute(
      `UPDATE fetcher_authorizations SET status = 'revoked', reviewed_by_user_id = NULL,
         reviewed_at = NULL WHERE id = ? AND school_id = ?`,
      [authorization.id, req.user.schoolId]
    );
    await connection.execute(
      `UPDATE fetcher_credentials SET revoked_at = UTC_TIMESTAMP()
       WHERE school_id = ? AND fetcher_id = ? AND revoked_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM fetcher_authorizations
           WHERE school_id = ? AND fetcher_id = ? AND status = 'approved')`,
      [req.user.schoolId, fetcherId, req.user.schoolId, fetcherId]
    );
    const [[student]] = await connection.execute(
      `SELECT display_name AS studentName FROM users WHERE id = ? AND school_id = ? AND role = 'student'`,
      [studentId, req.user.schoolId]
    );
    await writeAuditLog(connection, req, 'fetcher_revoked', 'fetcher', fetcherId,
      { summary: fetcher.fullName, studentId, studentName: student?.studentName });
    await connection.commit();
    res.json({ fetcherId, studentId, status: 'revoked' });
  } catch (error) {
    if (connection) await connection.rollback().catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function listRequests(req, res, next) {
  try {
    const status = String(req.query.status || 'pending').trim();
    if (!['all', 'pending', 'approved', 'rejected', 'revoked'].includes(status)) fail('Invalid request status.');
    const values = [req.user.schoolId];
    const filter = status === 'all' ? '' : 'AND authorizations.status = ?';
    if (filter) values.push(status);
    const [rows] = await getDatabase().execute(
      `SELECT authorizations.id, authorizations.status, authorizations.student_user_id AS studentId,
         students.display_name AS studentName, fetchers.id AS fetcherId,
         fetchers.full_name AS fullName, fetchers.relationship,
         fetchers.contact_number AS contactNumber, fetchers.photo_filename AS photoFilename,
         parents.display_name AS parentName,
         authorizations.reviewed_at AS reviewedAt, authorizations.created_at AS createdAt
       FROM fetcher_authorizations AS authorizations
       INNER JOIN fetchers ON fetchers.id = authorizations.fetcher_id
         AND fetchers.school_id = authorizations.school_id AND fetchers.is_parent_self = FALSE
       INNER JOIN users AS parents ON parents.id = fetchers.parent_user_id
         AND parents.school_id = fetchers.school_id
       INNER JOIN users AS students ON students.id = authorizations.student_user_id
         AND students.school_id = authorizations.school_id
       WHERE authorizations.school_id = ? ${filter}
       ORDER BY authorizations.updated_at DESC, authorizations.id DESC`, values
    );
    res.json({ requests: rows.map(row => ({ ...row, id: Number(row.id), fetcherId: Number(row.fetcherId),
      studentId: Number(row.studentId), photoUrl: row.photoFilename ? photoUrl(row.fetcherId, row.photoFilename) : null,
      photoFilename: undefined })) });
  } catch (error) { next(error); }
}

async function decideAuthorization(req, res, next) {
  let connection;
  try {
    const authorizationId = id(req.params.authorizationId, 'authorization ID');
    const decision = String(req.params.decision || '');
    if (!['approve', 'reject', 'revoke'].includes(decision)) fail('Invalid decision.');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[record]] = await connection.execute(
      `SELECT authorizations.id, authorizations.status, authorizations.student_user_id AS studentId,
         fetchers.id AS fetcherId, fetchers.parent_user_id AS parentId,
         fetchers.full_name AS fullName, fetchers.photo_filename AS photoFilename,
         students.display_name AS studentName
       FROM fetcher_authorizations AS authorizations
       INNER JOIN fetchers ON fetchers.id = authorizations.fetcher_id
         AND fetchers.school_id = authorizations.school_id AND fetchers.is_parent_self = FALSE
       LEFT JOIN users AS students ON students.id = authorizations.student_user_id
         AND students.school_id = authorizations.school_id AND students.role = 'student'
       WHERE authorizations.id = ? AND authorizations.school_id = ? FOR UPDATE`,
      [authorizationId, req.user.schoolId]
    );
    if (!record) fail('Authorization not found.', 404);
    if (decision === 'revoke' && record.status === 'revoked') fail('Authorization is already revoked.', 409);
    if (decision !== 'revoke' && record.status !== 'pending') fail('Only a pending request can be decided.', 409);
    if (decision === 'approve') {
      if (!avatarMimeType(record.photoFilename)) fail('A valid fetcher photo is required.', 409);
      await requireEligibleChild(connection, req.user.schoolId, record.parentId, Number(record.studentId));
    }
    const status = { approve: 'approved', reject: 'rejected', revoke: 'revoked' }[decision];
    await connection.execute(
      `UPDATE fetcher_authorizations SET status = ?, reviewed_by_user_id = ?,
         reviewed_at = NOW() WHERE id = ? AND school_id = ?`,
      [status, req.user.id, authorizationId, req.user.schoolId]
    );
    if (decision === 'revoke') {
      await connection.execute(
        `UPDATE fetcher_credentials SET revoked_at = UTC_TIMESTAMP()
         WHERE school_id = ? AND fetcher_id = ? AND revoked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM fetcher_authorizations
             WHERE school_id = ? AND fetcher_id = ? AND status = 'approved')`,
        [req.user.schoolId, record.fetcherId, req.user.schoolId, record.fetcherId]
      );
    }
    await writeAuditLog(connection, req, `fetcher_${status}`, 'fetcher_authorization', authorizationId,
      { summary: record.fullName, studentId: Number(record.studentId), studentName: record.studentName || undefined,
        fetcherId: Number(record.fetcherId) });
    await connection.commit();
    res.json({ id: authorizationId, status });
  } catch (error) {
    if (connection) await connection.rollback().catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function getPhoto(req, res, next) {
  try {
    const fetcherId = id(req.params.fetcherId, 'fetcher ID');
    const [[fetcher]] = await getDatabase().execute(
      `SELECT parent_user_id AS parentId, photo_filename AS photoFilename
       FROM fetchers WHERE id = ? AND school_id = ? AND is_parent_self = FALSE`,
      [fetcherId, req.user.schoolId]
    );
    if (!fetcher || (req.user.role === 'parent' && Number(fetcher.parentId) !== Number(req.user.id))) {
      fail('Photo not found.', 404);
    }
    const mimeType = avatarMimeType(fetcher.photoFilename);
    if (!mimeType) fail('Photo not found.', 404);
    let bytes;
    try { bytes = await fs.readFile(path.join(avatarDirectory, fetcher.photoFilename)); }
    catch (error) { if (error.code === 'ENOENT') fail('Photo not found.', 404); throw error; }
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-site', 'X-Content-Type-Options': 'nosniff' });
    res.status(200).send(bytes);
  } catch (error) { next(error); }
}

module.exports = { createFetcher, decideAuthorization, getPhoto, listMine, listRequests,
  requestChild, revokeChild, updateFetcher };
