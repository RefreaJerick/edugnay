const { getDatabase } = require('../config/database');

const TASK_STATUSES = new Set(['pending', 'completed']);
const TASK_SELECT_FIELDS = "id, title, DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate, task_status AS status, completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt";

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function title(value) {
  const result = String(value || '').trim();
  if (!result) throw createError('Task title is required.');
  if (result.length > 255) throw createError('Task title is too long.');
  return result;
}

function dueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw createError('Task due date is invalid.');
  const parsedDate = new Date(`${result}T00:00:00.000Z`);
  if (Number(result.slice(0, 4)) < 1000
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== result) {
    throw createError('Task due date is invalid.');
  }
  return result;
}

function formatTask(row) {
  return { id: row.id, title: row.title, dueDate: row.dueDate, status: row.status, completedAt: row.completedAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function getTask(database, userId, taskId) {
  const [rows] = await database.execute(`SELECT ${TASK_SELECT_FIELDS} FROM user_tasks WHERE id = ? AND user_id = ? LIMIT 1`, [taskId, userId]);
  return rows[0] || null;
}

async function listTasks(req, res, next) {
  try {
    const [rows] = await getDatabase().execute(`SELECT ${TASK_SELECT_FIELDS} FROM user_tasks WHERE user_id = ? ORDER BY task_status, due_date IS NULL, due_date, created_at DESC`, [req.user.id]);
    res.json({ tasks: rows.map(formatTask) });
  } catch (error) { next(error); }
}

async function createTask(req, res, next) {
  try {
    const database = getDatabase();
    const taskTitle = title(req.body.title);
    const taskDueDate = dueDate(req.body.dueDate);
    const status = req.body.status === undefined ? 'pending' : String(req.body.status).trim().toLowerCase();
    if (!TASK_STATUSES.has(status)) throw createError('Task status is invalid.');
    const [result] = await database.execute(`INSERT INTO user_tasks (user_id, title, due_date, task_status, completed_at) VALUES (?, ?, ?, ?, ${status === 'completed' ? 'NOW()' : 'NULL'})`, [req.user.id, taskTitle, taskDueDate, status]);
    res.status(201).json({ task: formatTask(await getTask(database, req.user.id, result.insertId)) });
  } catch (error) { next(error); }
}

async function updateTask(req, res, next) {
  try {
    const database = getDatabase();
    const taskId = parseId(req.params.taskId, 'task ID');
    const current = await getTask(database, req.user.id, taskId);
    if (!current) throw createError('Task was not found.', 404);
    const taskTitle = req.body.title === undefined ? current.title : title(req.body.title);
    const taskDueDate = req.body.dueDate === undefined ? current.dueDate : dueDate(req.body.dueDate);
    const status = req.body.status === undefined ? current.status : String(req.body.status).trim().toLowerCase();
    if (!TASK_STATUSES.has(status)) throw createError('Task status is invalid.');
    await database.execute(`UPDATE user_tasks SET title = ?, due_date = ?, task_status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END WHERE id = ? AND user_id = ?`, [taskTitle, taskDueDate, status, status, taskId, req.user.id]);
    res.json({ task: formatTask(await getTask(database, req.user.id, taskId)) });
  } catch (error) { next(error); }
}

async function deleteTask(req, res, next) {
  try {
    const taskId = parseId(req.params.taskId, 'task ID');
    const [result] = await getDatabase().execute('DELETE FROM user_tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);
    if (!result.affectedRows) throw createError('Task was not found.', 404);
    res.status(204).send();
  } catch (error) { next(error); }
}

module.exports = { createTask, deleteTask, listTasks, updateTask };
