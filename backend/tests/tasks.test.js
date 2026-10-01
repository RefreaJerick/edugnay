const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');

let tasks = [];
let nextId = 1;
let selectQueries = [];

const database = {
  async execute(sql, values = []) {
    if (sql.includes('FROM user_tasks WHERE user_id = ? ORDER BY')) {
      selectQueries.push(sql);
      return [tasks.filter(task => task.userId === values[0])];
    }

    if (sql.includes('FROM user_tasks WHERE id = ? AND user_id = ? LIMIT 1')) {
      selectQueries.push(sql);
      const task = tasks.find(item => item.id === values[0] && item.userId === values[1]);
      return [task ? [{ ...task }] : []];
    }

    if (sql.startsWith('INSERT INTO user_tasks')) {
      const [userId, title, dueDate, status] = values;
      const task = {
        id: nextId++, userId, title, dueDate, status,
        completedAt: null, createdAt: null, updatedAt: null
      };
      tasks.push(task);
      return [{ insertId: task.id }];
    }

    if (sql.startsWith('UPDATE user_tasks')) {
      const [title, dueDate, status, , taskId, userId] = values;
      const task = tasks.find(item => item.id === taskId && item.userId === userId);
      if (task) Object.assign(task, { title, dueDate, status });
      return [{ affectedRows: task ? 1 : 0 }];
    }

    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => database;
const controller = require('../controllers/tasksController');

function call(handler, req) {
  const result = { status: 200, body: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; }
  };
  return handler(req, response, error => { result.error = error; })
    .then(() => result);
}

test.beforeEach(() => {
  tasks = [];
  nextId = 1;
  selectQueries = [];
});

test('task list returns due dates as YYYY-MM-DD and preserves empty dates', async () => {
  tasks = [
    { id: 1, userId: 7, title: 'Read', dueDate: '2026-09-30', status: 'pending' },
    { id: 2, userId: 7, title: 'Review', dueDate: null, status: 'pending' }
  ];

  const result = await call(controller.listTasks, { user: { id: 7 } });

  assert.equal(result.error, null);
  assert.deepEqual(result.body.tasks.map(task => task.dueDate), ['2026-09-30', null]);
  assert.match(selectQueries[0], /DATE_FORMAT\(due_date, '%Y-%m-%d'\) AS dueDate/);
});

test('created task response returns a date-only dueDate', async () => {
  const result = await call(controller.createTask, {
    user: { id: 7 },
    body: { title: 'Read', dueDate: '2026-09-30' }
  });

  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(result.body.task.dueDate, '2026-09-30');
  assert.match(selectQueries[0], /DATE_FORMAT\(due_date, '%Y-%m-%d'\) AS dueDate/);
});

test('updated task response returns a date-only dueDate', async () => {
  tasks = [{ id: 4, userId: 7, title: 'Read', dueDate: '2026-09-30', status: 'pending' }];

  const result = await call(controller.updateTask, {
    user: { id: 7 },
    params: { taskId: '4' },
    body: { dueDate: '2026-10-02' }
  });

  assert.equal(result.error, null);
  assert.equal(result.body.task.dueDate, '2026-10-02');
  assert.equal(selectQueries.length, 2);
  selectQueries.forEach(query => assert.match(query, /DATE_FORMAT\(due_date, '%Y-%m-%d'\) AS dueDate/));
});

test('impossible calendar dates are rejected', async () => {
  const result = await call(controller.createTask, {
    user: { id: 7 },
    body: { title: 'Read', dueDate: '2026-02-31' }
  });

  assert.equal(result.error?.status, 400);
  assert.equal(tasks.length, 0);
});
