const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const auditLog = require('../utils/auditLog');
const emailWorker = require('../workers/announcementEmailWorker');

const events = [];
let failOutboxInsert = false;
let savedAnnouncement;

const connection = {
  async beginTransaction() { events.push('begin'); },
  async commit() { events.push('commit'); },
  async rollback() { events.push('rollback'); },
  release() { events.push('release'); },
  async execute(sql, values = []) {
    if (sql.startsWith('INSERT INTO announcements')) {
      savedAnnouncement = {
        id: 31,
        schoolId: 4,
        title: values[1],
        body: values[2],
        priority: values[3],
        status: values[4],
        authorUserId: values[5],
        authorName: 'School Admin',
        imagePath: null,
        publishedAt: '2026-10-01 10:00:00',
        createdAt: '2026-10-01 10:00:00',
        updatedAt: '2026-10-01 10:00:00'
      };
      return [{ insertId: savedAnnouncement.id }];
    }
    if (sql.startsWith('INSERT INTO announcement_audiences')) return [{ affectedRows: 1 }];
    if (sql.startsWith('SELECT announcements.id')) return [[savedAnnouncement]];
    if (sql.includes('SELECT id AS userId FROM users WHERE school_id = ?')) {
      return [[{ userId: 11 }, { userId: 12 }]];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      events.push('notifications');
      return [{ affectedRows: 2 }];
    }
    if (sql.startsWith('INSERT IGNORE INTO announcement_email_outbox')) {
      events.push('outbox');
      if (failOutboxInsert) throw new Error('outbox unavailable');
      assert.deepEqual(values, [31, 4, 11, 12]);
      return [{ affectedRows: 2 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};

databaseModule.getDatabase = () => ({ getConnection: async () => connection });
auditLog.writeAuditLog = async () => { events.push('audit'); };
emailWorker.wakeAnnouncementEmailWorker = () => { events.push('worker_wake'); };

const announcements = require('../controllers/announcementsController');

function publish() {
  const result = { status: null, body: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    json(body) {
      events.push('response');
      result.body = body;
      return this;
    }
  };

  return announcements.createAnnouncement({
    user: { id: 10, schoolId: 4, role: 'school_admin' },
    body: { title: 'School update', body: 'A short announcement.', audiences: ['all'] }
  }, response, error => { result.error = error; }).then(() => result);
}

test.beforeEach(() => {
  events.length = 0;
  failOutboxInsert = false;
  savedAnnouncement = null;
});

test('published announcement commits its mail queue before responding and wakes delivery afterward', async () => {
  const result = await publish();

  assert.equal(result.error, null);
  assert.equal(result.status, 201);
  assert.equal(result.body.announcement.id, 31);
  assert.ok(events.indexOf('outbox') < events.indexOf('commit'));
  assert.ok(events.indexOf('commit') < events.indexOf('response'));
  assert.ok(events.indexOf('response') < events.indexOf('worker_wake'));
});

test('mail-queue failure rolls back the announcement instead of returning false success', async () => {
  failOutboxInsert = true;
  const result = await publish();

  assert.equal(result.error?.message, 'outbox unavailable');
  assert.equal(result.status, null);
  assert.ok(events.includes('rollback'));
  assert.ok(!events.includes('response'));
  assert.ok(!events.includes('worker_wake'));
});
