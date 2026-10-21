const { getDatabase } = require('../config/database');

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function positiveId(value, label) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw createError(`Select a valid ${label}.`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Select a valid ${label}.`);
  return id;
}

async function linkedChild(database, req) {
  const studentId = positiveId(req.params.studentId, 'student');
  const [rows] = await database.execute(
    `SELECT students.id AS studentId, students.display_name AS displayName,
      features.narrative_reports_enabled AS reportsEnabled
    FROM student_parent_links AS links
    INNER JOIN users AS students ON students.id = links.student_user_id
      AND students.school_id = links.school_id AND students.role = 'student'
      AND students.account_status = 'active'
    LEFT JOIN school_portal_features AS features ON features.school_id = links.school_id
    WHERE links.school_id = ? AND links.parent_user_id = ? AND links.student_user_id = ?
    LIMIT 1`,
    [Number(req.user.schoolId), Number(req.user.id), studentId]
  );
  if (!rows.length) throw createError('Linked student not found.', 404);
  if (!rows[0].reportsEnabled) throw createError('Narrative Reports are not enabled for this school.', 403);
  return { studentId: String(rows[0].studentId), displayName: rows[0].displayName };
}

function publicReport(row) {
  let actions = row.parentActions;
  if (typeof actions === 'string') {
    try { actions = JSON.parse(actions); } catch { actions = []; }
  }
  const versionNumber = Number(row.versionNumber);
  return {
    id: String(row.id), studentId: String(row.studentId),
    weekStartDate: row.weekStartDate, weekEndDate: row.weekEndDate,
    summary: row.summary, parentActions: Array.isArray(actions) ? actions : [],
    releasedAt: row.releasedAt, adviserName: row.adviserName || null,
    versionNumber, correctedAt: versionNumber > 1 ? row.releasedAt : null
  };
}

async function readPublicReports(database, schoolId, studentId, reportId) {
  const values = [Number(schoolId), Number(studentId)];
  const reportFilter = reportId == null ? '' : ' AND reports.id = ?';
  if (reportId != null) values.push(Number(reportId));
  const [rows] = await database.execute(
    `SELECT reports.id, reports.student_user_id AS studentId,
      DATE_FORMAT(reports.report_week_start_date, '%Y-%m-%d') AS weekStartDate,
      DATE_FORMAT(reports.report_week_end_date, '%Y-%m-%d') AS weekEndDate,
      releases.summary, releases.parent_actions AS parentActions,
      releases.version_number AS versionNumber,
      DATE_FORMAT(releases.released_at, '%Y-%m-%dT%H:%i:%s') AS releasedAt,
      releases.released_by_name AS adviserName
    FROM narrative_reports AS reports
    INNER JOIN narrative_report_releases AS releases ON releases.id = (
      SELECT history.id FROM narrative_report_releases AS history
      WHERE history.school_id = reports.school_id AND history.narrative_report_id = reports.id
      ORDER BY history.version_number DESC LIMIT 1
    )
    WHERE reports.school_id = ? AND reports.student_user_id = ?
      AND reports.released_at IS NOT NULL${reportFilter}
    ORDER BY reports.report_week_start_date DESC, releases.released_at DESC, reports.id DESC${reportId == null ? ' LIMIT 100' : ''}`,
    values
  );
  return rows.map(publicReport);
}

async function listChildReports(req, res, next) {
  try {
    const database = getDatabase();
    const child = await linkedChild(database, req);
    const reports = await readPublicReports(database, req.user.schoolId, child.studentId);
    res.set('Cache-Control', 'no-store');
    res.json({ child, reports });
  } catch (error) { next(error); }
}

async function getChildReport(req, res, next) {
  try {
    const database = getDatabase();
    const child = await linkedChild(database, req);
    const id = positiveId(req.params.reportId, 'report');
    const reports = await readPublicReports(database, req.user.schoolId, child.studentId, id);
    if (!reports.length) throw createError('Released report not found.', 404);
    res.set('Cache-Control', 'no-store');
    res.json({ child, report: reports[0] });
  } catch (error) { next(error); }
}

module.exports = { listChildReports, getChildReport, linkedChild, readPublicReports, publicReport };
