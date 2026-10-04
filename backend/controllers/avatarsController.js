const fs = require('node:fs/promises');
const path = require('node:path');
const { getDatabase } = require('../config/database');
const {
  AVATAR_ERROR, avatarDirectory, avatarFields, avatarMimeType, deleteAvatar, saveAvatar
} = require('../config/avatars');

function createError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function canViewAvatar(database, viewer, owner) {
  if (Number(viewer.id) === Number(owner.id)) return true;
  if (!viewer.schoolId || Number(viewer.schoolId) !== Number(owner.schoolId)) return false;
  if (viewer.role === 'school_admin') return true;

  let sql;
  let values;
  if (viewer.role === 'teacher' && owner.role === 'student') {
    sql = `SELECT 1 FROM section_students AS members
      INNER JOIN sections ON sections.id = members.section_id AND sections.school_id = members.school_id AND sections.status = 'active'
      INNER JOIN academic_years AS years ON years.id = sections.academic_year_id AND years.school_id = sections.school_id AND years.status = 'active'
      WHERE members.school_id = ? AND members.student_user_id = ? AND members.withdrawn_at IS NULL
        AND (sections.adviser_user_id = ? OR EXISTS (
          SELECT 1 FROM section_teachers AS assignments
          INNER JOIN subjects ON subjects.id = assignments.subject_id
            AND subjects.school_id = assignments.school_id AND subjects.is_active = TRUE
          WHERE assignments.school_id = members.school_id AND assignments.section_id = members.section_id
            AND assignments.teacher_user_id = ?
        )) LIMIT 1`;
    values = [viewer.schoolId, owner.id, viewer.id, viewer.id];
  } else if (viewer.role === 'teacher' && owner.role === 'teacher') {
    sql = `SELECT 1 FROM sections
      WHERE sections.school_id = ? AND sections.status = 'active'
        AND (sections.adviser_user_id = ? OR EXISTS (
          SELECT 1 FROM section_teachers AS mine WHERE mine.school_id = sections.school_id
            AND mine.section_id = sections.id AND mine.teacher_user_id = ?
        ))
        AND (sections.adviser_user_id = ? OR EXISTS (
          SELECT 1 FROM section_teachers AS theirs WHERE theirs.school_id = sections.school_id
            AND theirs.section_id = sections.id AND theirs.teacher_user_id = ?
        )) LIMIT 1`;
    values = [viewer.schoolId, viewer.id, viewer.id, owner.id, owner.id];
  } else if (viewer.role === 'student' && owner.role === 'parent') {
    sql = `SELECT 1 FROM student_parent_links
      WHERE school_id = ? AND student_user_id = ? AND parent_user_id = ? LIMIT 1`;
    values = [viewer.schoolId, viewer.id, owner.id];
  } else if (viewer.role === 'student' && owner.role === 'teacher') {
    sql = `SELECT 1 FROM section_students AS members
      INNER JOIN sections ON sections.id = members.section_id
        AND sections.school_id = members.school_id AND sections.status = 'active'
      WHERE members.school_id = ? AND members.student_user_id = ? AND members.withdrawn_at IS NULL
        AND (sections.adviser_user_id = ? OR EXISTS (
          SELECT 1 FROM section_teachers AS assignments
          WHERE assignments.school_id = sections.school_id AND assignments.section_id = sections.id
            AND assignments.teacher_user_id = ?
        )) LIMIT 1`;
    values = [viewer.schoolId, viewer.id, owner.id, owner.id];
  } else if (viewer.role === 'parent' && owner.role === 'student') {
    sql = `SELECT 1 FROM student_parent_links
      WHERE school_id = ? AND parent_user_id = ? AND student_user_id = ? LIMIT 1`;
    values = [viewer.schoolId, viewer.id, owner.id];
  } else if (viewer.role === 'parent' && owner.role === 'teacher') {
    sql = `SELECT 1 FROM student_parent_links AS links
      WHERE links.school_id = ? AND links.parent_user_id = ?
        AND (EXISTS (
          SELECT 1 FROM section_students AS members
          INNER JOIN sections ON sections.id = members.section_id
            AND sections.school_id = members.school_id AND sections.status = 'active'
          WHERE members.school_id = links.school_id AND members.student_user_id = links.student_user_id
            AND members.withdrawn_at IS NULL
            AND (sections.adviser_user_id = ? OR EXISTS (
              SELECT 1 FROM section_teachers AS assignments
              WHERE assignments.school_id = sections.school_id AND assignments.section_id = sections.id
                AND assignments.teacher_user_id = ?
            ))
        ) OR EXISTS (
          SELECT 1 FROM narrative_reports AS reports
          WHERE reports.school_id = links.school_id AND reports.student_user_id = links.student_user_id
            AND reports.teacher_user_id = ? AND reports.report_status = 'confirmed'
        )) LIMIT 1`;
    values = [viewer.schoolId, viewer.id, owner.id, owner.id, owner.id];
  } else {
    return false;
  }

  const [rows] = await database.execute(sql, values);
  return rows.length > 0;
}

async function uploadMyAvatar(req, res, next) {
  let connection;
  let newFilename;
  let committed = false;
  try {
    if (!req.file) throw createError(AVATAR_ERROR, 400);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, avatar_filename AS avatarFilename FROM users WHERE id = ? FOR UPDATE', [req.user.id]
    );
    if (!rows.length) throw createError('User not found.', 404);
    const oldFilename = rows[0].avatarFilename;
    newFilename = await saveAvatar(req.file);
    await connection.execute(
      'UPDATE users SET avatar_filename = ?, avatar_version = avatar_version + 1 WHERE id = ?',
      [newFilename, req.user.id]
    );
    const [[user]] = await connection.execute(
      'SELECT id, avatar_filename AS avatarFilename, avatar_version AS avatarVersion FROM users WHERE id = ?',
      [req.user.id]
    );
    await connection.commit();
    committed = true;
    await deleteAvatar(oldFilename).catch(console.error);
    res.status(200).json({ avatar: avatarFields(user) });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(console.error);
    if (newFilename && !committed) await deleteAvatar(newFilename).catch(console.error);
    next(error);
  } finally {
    connection?.release();
  }
}

async function removeMyAvatar(req, res, next) {
  let connection;
  let committed = false;
  try {
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, avatar_filename AS avatarFilename FROM users WHERE id = ? FOR UPDATE', [req.user.id]
    );
    if (!rows.length) throw createError('User not found.', 404);
    const oldFilename = rows[0].avatarFilename;
    if (oldFilename) {
      await connection.execute(
        'UPDATE users SET avatar_filename = NULL, avatar_version = avatar_version + 1 WHERE id = ?',
        [req.user.id]
      );
    }
    await connection.commit();
    committed = true;
    await deleteAvatar(oldFilename).catch(console.error);
    res.status(204).end();
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(console.error);
    next(error);
  } finally {
    connection?.release();
  }
}

async function getAvatar(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId < 1) throw createError('Avatar not found.', 404);
    const database = getDatabase();
    const [rows] = await database.execute(
      `SELECT id, school_id AS schoolId, role, avatar_filename AS avatarFilename
      FROM users WHERE id = ? LIMIT 1`, [userId]
    );
    const owner = rows[0];
    if (!owner || !avatarMimeType(owner.avatarFilename) || !await canViewAvatar(database, req.user, owner)) {
      throw createError('Avatar not found.', 404);
    }
    const mimeType = avatarMimeType(owner.avatarFilename);
    let bytes;
    try {
      bytes = await fs.readFile(path.join(avatarDirectory, owner.avatarFilename));
    } catch (error) {
      if (error.code === 'ENOENT') throw createError('Avatar not found.', 404);
      throw error;
    }
    res.set({
      'Content-Type': mimeType,
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-site',
      'X-Content-Type-Options': 'nosniff'
    });
    res.status(200).send(bytes);
  } catch (error) {
    next(error);
  }
}

module.exports = { canViewAvatar, getAvatar, removeMyAvatar, uploadMyAvatar };
