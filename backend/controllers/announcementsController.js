const { getDatabase } = require('../config/database');
const { isEmailConfigured, sendAnnouncementEmail } = require('../config/email');

const ANNOUNCEMENT_STATUSES = new Set(['draft', 'published']);
const ANNOUNCEMENT_PRIORITIES = new Set(['normal', 'high', 'event']);
const AUDIENCE_TYPES = new Set(['all', 'school_admin', 'teacher', 'student', 'parent', 'section']);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  if (!/^\d+$/.test(String(value ?? ''))) throw createError(`Invalid ${label}.`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function text(value, maximum, label, required = false) {
  if (value === undefined || value === null) {
    if (required) throw createError(`${label} is required.`);
    return null;
  }
  const result = String(value).trim();
  if (required && !result) throw createError(`${label} is required.`);
  if (result.length > maximum) throw createError(`${label} is too long.`);
  return result || null;
}

function normalizeAudienceType(value) {
  const aliases = { teachers: 'teacher', students: 'student', parents: 'parent', admins: 'school_admin' };
  const type = aliases[String(value || '').trim().toLowerCase()] || String(value || '').trim().toLowerCase();
  if (!AUDIENCE_TYPES.has(type)) throw createError('Announcement audience is invalid.');
  return type;
}

function normalizeAudiences(value) {
  const source = Array.isArray(value) ? value : [value || 'all'];
  if (!source.length || source.length > 20) throw createError('Provide at least one announcement audience.');
  const entries = source.map(item => {
    const values = typeof item === 'object' && item !== null ? item : { type: item };
    const type = normalizeAudienceType(values.type || values.audience);
    const sectionId = type === 'section' ? parseId(values.sectionId, 'section ID') : null;
    return { type, sectionId };
  });
  const keys = new Set();
  entries.forEach(entry => {
    const key = `${entry.type}:${entry.sectionId || ''}`;
    if (keys.has(key)) throw createError('Announcement audiences must not be duplicated.');
    keys.add(key);
  });
  return entries;
}

function formatAnnouncement(row, audiences = []) {
  return {
    id: row.id,
    schoolId: row.schoolId,
    title: row.title,
    body: row.body,
    priority: row.priority,
    status: row.status,
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    imagePath: row.imagePath,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    audiences,
    isRead: Boolean(row.isRead)
  };
}

async function teacherCanAccessSection(connection, teacherId, sectionId) {
  const [sections] = await connection.execute(
    `SELECT sections.id FROM sections
    LEFT JOIN section_teachers ON section_teachers.section_id = sections.id AND section_teachers.teacher_user_id = ?
    WHERE sections.id = ? AND sections.status = 'active'
      AND (sections.adviser_user_id = ? OR section_teachers.id IS NOT NULL)
    LIMIT 1`,
    [teacherId, sectionId, teacherId]
  );
  return Boolean(sections[0]);
}

async function validateAudiences(connection, user, audiences) {
  for (const audience of audiences) {
    if (audience.type !== 'section') continue;
    const [sections] = await connection.execute('SELECT id FROM sections WHERE id = ? AND school_id = ? AND status = \'active\' LIMIT 1', [audience.sectionId, user.schoolId]);
    if (!sections.length) throw createError('Announcement section was not found.', 404);
    if (user.role === 'teacher' && !(await teacherCanAccessSection(connection, user.id, audience.sectionId))) {
      throw createError('You can only announce to your assigned sections.', 403);
    }
  }
  if (user.role === 'teacher' && audiences.some(audience => audience.type !== 'section')) {
    throw createError('Teachers can only announce to their assigned sections.', 403);
  }
}

async function getAnnouncement(connection, announcementId, user) {
  const [rows] = await connection.execute(
    `SELECT announcements.id, announcements.school_id AS schoolId, announcements.title, announcements.body,
      announcements.priority, announcements.status, announcements.author_user_id AS authorUserId,
      authors.display_name AS authorName, announcements.image_path AS imagePath,
      announcements.published_at AS publishedAt, announcements.created_at AS createdAt, announcements.updated_at AS updatedAt
    FROM announcements INNER JOIN users AS authors ON authors.id = announcements.author_user_id
    WHERE announcements.id = ? AND announcements.school_id = ? LIMIT 1`,
    [announcementId, user.schoolId]
  );
  return rows[0] || null;
}

async function getAnnouncementAudiences(connection, announcementIds) {
  if (!announcementIds.length) return new Map();
  const placeholders = announcementIds.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT announcement_id AS announcementId, audience_type AS type, section_id AS sectionId
    FROM announcement_audiences WHERE announcement_id IN (${placeholders})`,
    announcementIds
  );
  return rows.reduce((result, row) => {
    const audiences = result.get(row.announcementId) || [];
    audiences.push({ type: row.type, sectionId: row.sectionId });
    result.set(row.announcementId, audiences);
    return result;
  }, new Map());
}

async function getAudienceRecipientIds(connection, schoolId, audiences) {
  const recipientIds = new Set();
  for (const audience of audiences) {
    if (audience.type === 'section') {
      const [recipients] = await connection.execute(
        `SELECT student_user_id AS userId FROM section_students WHERE section_id = ? AND withdrawn_at IS NULL
        UNION
        SELECT student_parent_links.parent_user_id AS userId FROM section_students
          INNER JOIN student_parent_links ON student_parent_links.student_user_id = section_students.student_user_id
          WHERE section_students.section_id = ? AND section_students.withdrawn_at IS NULL
        UNION
        SELECT adviser_user_id AS userId FROM sections WHERE id = ? AND adviser_user_id IS NOT NULL
        UNION
        SELECT teacher_user_id AS userId FROM section_teachers WHERE section_id = ?`,
        [audience.sectionId, audience.sectionId, audience.sectionId, audience.sectionId]
      );
      recipients.forEach(recipient => recipientIds.add(recipient.userId));
      continue;
    }
    const [recipients] = await connection.execute(
      `SELECT id AS userId FROM users WHERE school_id = ? AND account_status = 'active'${audience.type === 'all' ? '' : ' AND role = ?'}`,
      audience.type === 'all' ? [schoolId] : [schoolId, audience.type]
    );
    recipients.forEach(recipient => recipientIds.add(recipient.userId));
  }
  return [...recipientIds];
}

async function createNotifications(connection, announcement, audiences) {
  const recipientIds = await getAudienceRecipientIds(connection, announcement.schoolId, audiences);
  const notificationRecipientIds = [];
  for (const userId of recipientIds) {
    if (String(userId) === String(announcement.authorUserId)) continue;
    await connection.execute(
      `INSERT INTO notifications (announcement_id, user_id, type, title, message, target_path)
      VALUES (?, ?, 'announcement', 'New announcement', ?, NULL)`,
      [announcement.id, userId, announcement.title]
    );
    notificationRecipientIds.push(userId);
  }
  return notificationRecipientIds;
}

async function sendAnnouncementEmails(connection, announcement, recipientIds) {
  try {
    if (!recipientIds.length || !isEmailConfigured()) return;
    const placeholders = recipientIds.map(() => '?').join(', ');
    const [recipients] = await connection.execute(
      `SELECT display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail
      FROM users WHERE id IN (${placeholders}) AND school_id = ? AND account_status = 'active'`,
      [...recipientIds, announcement.schoolId]
    );
    for (const recipient of recipients) {
      await sendAnnouncementEmail(recipient, announcement);
    }
  } catch (error) {
    console.error(`Announcement email delivery could not be completed: ${error.message}`);
  }
}

function announcementVisibilitySql(user) {
  if (user.role === 'school_admin') return { where: 'announcements.school_id = ?', values: [user.schoolId] };
  const shared = [
    "EXISTS (SELECT 1 FROM announcement_audiences WHERE announcement_audiences.announcement_id = announcements.id AND announcement_audiences.audience_type = 'all')",
    "EXISTS (SELECT 1 FROM announcement_audiences WHERE announcement_audiences.announcement_id = announcements.id AND announcement_audiences.audience_type = ?)"
  ];
  const values = [user.schoolId, user.role];
  if (user.role === 'teacher') {
    shared.push(`EXISTS (SELECT 1 FROM announcement_audiences
      INNER JOIN sections ON sections.id = announcement_audiences.section_id
      LEFT JOIN section_teachers ON section_teachers.section_id = sections.id AND section_teachers.teacher_user_id = ?
      WHERE announcement_audiences.announcement_id = announcements.id AND announcement_audiences.audience_type = 'section'
      AND (sections.adviser_user_id = ? OR section_teachers.id IS NOT NULL))`);
    values.push(user.id, user.id);
  }
  if (user.role === 'student') {
    shared.push("EXISTS (SELECT 1 FROM announcement_audiences INNER JOIN section_students ON section_students.section_id = announcement_audiences.section_id WHERE announcement_audiences.announcement_id = announcements.id AND announcement_audiences.audience_type = 'section' AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)");
    values.push(user.id);
  }
  if (user.role === 'parent') {
    shared.push("EXISTS (SELECT 1 FROM announcement_audiences INNER JOIN section_students ON section_students.section_id = announcement_audiences.section_id INNER JOIN student_parent_links ON student_parent_links.student_user_id = section_students.student_user_id WHERE announcement_audiences.announcement_id = announcements.id AND announcement_audiences.audience_type = 'section' AND section_students.withdrawn_at IS NULL AND student_parent_links.parent_user_id = ?)");
    values.push(user.id);
  }
  return {
    where: `announcements.school_id = ? AND ((announcements.status = 'published' AND (${shared.join(' OR ')})) OR announcements.author_user_id = ?)`,
    values: [...values, user.id]
  };
}

async function listAnnouncements(req, res, next) {
  try {
    if (!req.user.schoolId || !['school_admin', 'teacher', 'student', 'parent'].includes(req.user.role)) throw createError('You do not have access to announcements.', 403);
    const database = getDatabase();
    const visibility = announcementVisibilitySql(req.user);
    const [rows] = await database.execute(
      `SELECT announcements.id, announcements.school_id AS schoolId, announcements.title, announcements.body,
        announcements.priority, announcements.status, announcements.author_user_id AS authorUserId,
        authors.display_name AS authorName, announcements.image_path AS imagePath,
        announcements.published_at AS publishedAt, announcements.created_at AS createdAt, announcements.updated_at AS updatedAt,
        announcement_reads.read_at AS readAt
      FROM announcements INNER JOIN users AS authors ON authors.id = announcements.author_user_id
      LEFT JOIN announcement_reads ON announcement_reads.announcement_id = announcements.id AND announcement_reads.user_id = ?
      WHERE ${visibility.where} ORDER BY announcements.published_at DESC, announcements.created_at DESC`,
      [req.user.id, ...visibility.values]
    );
    const audienceMap = await getAnnouncementAudiences(database, rows.map(row => row.id));
    res.json({ announcements: rows.map(row => formatAnnouncement({ ...row, isRead: row.readAt }, audienceMap.get(row.id) || [])) });
  } catch (error) { next(error); }
}

async function createAnnouncement(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (!['school_admin', 'teacher'].includes(req.user.role)) throw createError('You do not have access to create announcements.', 403);
    const title = text(req.body.title, 255, 'Announcement title', true);
    const body = text(req.body.body, 20000, 'Announcement body', true);
    const priority = String(req.body.priority || 'normal').trim().toLowerCase();
    const status = String(req.body.status || 'published').trim().toLowerCase();
    if (!ANNOUNCEMENT_PRIORITIES.has(priority)) throw createError('Announcement priority is invalid.');
    if (!ANNOUNCEMENT_STATUSES.has(status)) throw createError('Announcement status is invalid.');
    const audiences = normalizeAudiences(req.body.audiences === undefined ? req.body.audience : req.body.audiences);
    await connection.beginTransaction();
    await validateAudiences(connection, req.user, audiences);
    const [result] = await connection.execute(
      `INSERT INTO announcements (school_id, title, body, priority, status, author_user_id, image_path, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${status === 'published' ? 'NOW()' : 'NULL'})`,
      [req.user.schoolId, title, body, priority, status, req.user.id, text(req.body.imagePath, 500, 'Image path')]
    );
    for (const audience of audiences) await connection.execute('INSERT INTO announcement_audiences (announcement_id, audience_type, section_id) VALUES (?, ?, ?)', [result.insertId, audience.type, audience.sectionId]);
    const announcement = await getAnnouncement(connection, result.insertId, req.user);
    const recipientIds = status === 'published'
      ? await createNotifications(connection, announcement, audiences)
      : [];
    await connection.commit();
    await sendAnnouncementEmails(connection, announcement, recipientIds);
    res.status(201).json({ announcement: formatAnnouncement(announcement, audiences) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function updateAnnouncement(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    if (!['school_admin', 'teacher'].includes(req.user.role)) throw createError('You do not have access to update announcements.', 403);
    const announcementId = parseId(req.params.announcementId, 'announcement ID');
    await connection.beginTransaction();
    const current = await getAnnouncement(connection, announcementId, req.user);
    if (!current || (req.user.role === 'teacher' && current.authorUserId !== req.user.id)) throw createError('Announcement was not found.', 404);
    const title = req.body.title === undefined ? current.title : text(req.body.title, 255, 'Announcement title', true);
    const body = req.body.body === undefined ? current.body : text(req.body.body, 20000, 'Announcement body', true);
    const priority = req.body.priority === undefined ? current.priority : String(req.body.priority).trim().toLowerCase();
    const status = req.body.status === undefined ? current.status : String(req.body.status).trim().toLowerCase();
    if (!ANNOUNCEMENT_PRIORITIES.has(priority)) throw createError('Announcement priority is invalid.');
    if (!ANNOUNCEMENT_STATUSES.has(status)) throw createError('Announcement status is invalid.');
    const replaceAudiences = req.body.audiences !== undefined || req.body.audience !== undefined;
    const audiences = replaceAudiences
      ? normalizeAudiences(req.body.audiences === undefined ? req.body.audience : req.body.audiences)
      : (await getAnnouncementAudiences(connection, [announcementId])).get(announcementId) || [];
    await validateAudiences(connection, req.user, audiences);
    await connection.execute(
      `UPDATE announcements SET title = ?, body = ?, priority = ?, status = ?, image_path = ?,
        published_at = CASE WHEN ? = 'published' AND ? <> 'published' THEN NOW() ELSE published_at END
      WHERE id = ?`,
      [title, body, priority, status, req.body.imagePath === undefined ? current.imagePath : text(req.body.imagePath, 500, 'Image path'), status, current.status, announcementId]
    );
    if (replaceAudiences) {
      await connection.execute('DELETE FROM announcement_audiences WHERE announcement_id = ?', [announcementId]);
      for (const audience of audiences) await connection.execute('INSERT INTO announcement_audiences (announcement_id, audience_type, section_id) VALUES (?, ?, ?)', [announcementId, audience.type, audience.sectionId]);
    }
    const updated = await getAnnouncement(connection, announcementId, req.user);
    const recipientIds = current.status !== 'published' && status === 'published'
      ? await createNotifications(connection, updated, audiences)
      : [];
    await connection.commit();
    await sendAnnouncementEmails(connection, updated, recipientIds);
    res.json({ announcement: formatAnnouncement(updated, audiences) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
}

async function deleteAnnouncement(req, res, next) {
  const connection = await getDatabase().getConnection();
  let transactionStarted = false;
  try {
    if (!['school_admin', 'teacher'].includes(req.user.role) || !req.user.schoolId) {
      throw createError('You do not have access to delete announcements.', 403);
    }

    const announcementId = parseId(req.params.announcementId, 'announcement ID');
    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.execute(
      `SELECT id, author_user_id AS authorUserId
      FROM announcements WHERE id = ? AND school_id = ? FOR UPDATE`,
      [announcementId, req.user.schoolId]
    );
    const announcement = rows[0];
    if (!announcement || (req.user.role === 'teacher' && Number(announcement.authorUserId) !== Number(req.user.id))) {
      throw createError('Announcement was not found.', 404);
    }

    await connection.execute(
      'DELETE FROM announcements WHERE id = ? AND school_id = ?',
      [announcementId, req.user.schoolId]
    );
    await connection.commit();
    transactionStarted = false;
    res.status(204).send();
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch { /* Preserve the original error. */ }
    }
    next(error);
  } finally { connection.release(); }
}

async function markAnnouncementRead(req, res, next) {
  const connection = await getDatabase().getConnection();
  try {
    const announcementId = parseId(req.params.announcementId, 'announcement ID');
    const visibility = announcementVisibilitySql(req.user);
    const [announcements] = await connection.execute(`SELECT announcements.id FROM announcements WHERE announcements.id = ? AND ${visibility.where} LIMIT 1`, [announcementId, ...visibility.values]);
    if (!announcements.length) throw createError('Announcement was not found.', 404);
    await connection.execute('INSERT INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE read_at = read_at', [announcementId, req.user.id]);
    res.status(204).send();
  } catch (error) { next(error); } finally { connection.release(); }
}

module.exports = { createAnnouncement, deleteAnnouncement, listAnnouncements, markAnnouncementRead, updateAnnouncement };
