const { getDatabase } = require('../config/database');
const { writeAuditLog } = require('../utils/auditLog');

function validDate(value) {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === date;
}

function formatNotice(row) {
  return { id: row.id, date: row.date, title: row.title, detail: row.detail || '',
    type: row.type, appliesTo: row.appliesTo };
}

const noticeSelect = `SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS date,
  title, detail, holiday_type AS type, applies_to AS appliesTo FROM holidays`;

async function listCalendarNotices(req, res, next) {
  try {
    const [rows] = await getDatabase().execute(
      `${noticeSelect} WHERE school_id = ? ORDER BY holiday_date DESC, id DESC`, [req.user.schoolId]
    );
    res.json({ notices: rows.map(formatNotice) });
  } catch (error) { next(error); }
}

async function createCalendarNotice(req, res, next) {
  let connection;
  try {
    const date = req.body?.date;
    const title = String(req.body?.title || '').trim();
    const detail = String(req.body?.detail || '').trim();
    if (!validDate(date) || !title || title.length > 255 || detail.length > 2000) {
      return res.status(400).json({ message: 'Provide a valid date, title, and notice.' });
    }
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO holidays (school_id, holiday_date, title, detail, holiday_type, applies_to)
       VALUES (?, ?, ?, ?, 'holiday', 'all')`,
      [req.user.schoolId, date, title, detail || null]
    );
    await writeAuditLog(connection, req, 'calendar_notice_created', 'holiday', result.insertId,
      { summary: title, noticeTitle: title, noticeDate: date }, req.user.schoolId);
    await connection.commit();
    res.status(201).json({ notice: formatNotice({ id: result.insertId, date, title, detail,
      type: 'holiday', appliesTo: 'all' }) });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This calendar notice already exists.' });
    }
    next(error);
  } finally { connection?.release(); }
}

async function deleteCalendarNotice(req, res, next) {
  let connection;
  try {
    const id = Number(req.params.noticeId);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid notice ID.' });
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [notices] = await connection.execute(
      `SELECT title, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS date FROM holidays
       WHERE id = ? AND school_id = ? LIMIT 1 FOR UPDATE`,
      [id, req.user.schoolId]);
    if (!notices.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Calendar notice not found.' });
    }
    const [result] = await connection.execute('DELETE FROM holidays WHERE id = ? AND school_id = ?',
      [id, req.user.schoolId]);
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: 'Calendar notice not found.' });
    }
    await writeAuditLog(connection, req, 'calendar_notice_deleted', 'holiday', id,
      { noticeTitle: notices[0].title, noticeDate: notices[0].date, summary: notices[0].title }, req.user.schoolId);
    await connection.commit();
    res.status(204).send();
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

module.exports = { listCalendarNotices, createCalendarNotice, deleteCalendarNotice };
