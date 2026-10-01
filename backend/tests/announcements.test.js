const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const auditLog = require('../utils/auditLog');
const emailWorker = require('../workers/announcementEmailWorker');

const events = [];
let failOutboxInsert = false;
let savedAnnouncement;
let dueRecords = [];
let schoolStatus = 'active';

const connection = {
  async beginTransaction() { events.push('begin'); },
  async commit() { events.push('commit'); },
  async rollback() { events.push('rollback'); },
  release() { events.push('release'); },
  async execute(sql, values = []) {
    if (sql.startsWith('SELECT id, title, status FROM announcements')) {
      return [savedAnnouncement && values[1] === savedAnnouncement.schoolId ? [{ id: 31, title: savedAnnouncement.title, status: savedAnnouncement.status }] : []];
    }
    if (sql.startsWith('UPDATE announcements SET is_pinned')) {
      savedAnnouncement.isPinned = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM announcements WHERE id = ? AND status = 'scheduled'")) {
      return [savedAnnouncement?.status === 'scheduled' ? [{ id: 31, schoolId: 4, authorUserId: 10, title: savedAnnouncement.title }] : []];
    }
    if (sql.startsWith('SELECT registration_status AS status FROM schools')) return [[{ status: schoolStatus }]];
    if (sql.startsWith("UPDATE announcements SET status = 'published'")) {
      savedAnnouncement.status = 'published';
      events.push('scheduled_publish');
      return [{ affectedRows: 1 }];
    }
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
        scheduledAt: values[7],
        isPinned: 0,
        publishedAt: values[4] === 'published' ? '2026-10-01 10:00:00' : null,
        createdAt: '2026-10-01 10:00:00',
        updatedAt: '2026-10-01 10:00:00'
      };
      return [{ insertId: savedAnnouncement.id }];
    }
    if (sql.startsWith('INSERT INTO announcement_audiences')) return [{ affectedRows: 1 }];
    if (sql.startsWith('SELECT announcements.id')) return [[savedAnnouncement]];
    if (sql.startsWith('SELECT announcement_id AS announcementId')) return [[{ announcementId: 31, type: 'all', sectionId: null }]];
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

databaseModule.getDatabase = () => ({
  getConnection: async () => connection,
  async execute(sql) {
    if (sql.startsWith('SELECT announcements.id FROM announcements')) return [dueRecords];
    if (sql.startsWith('SELECT announcements.image_path AS imagePath')) return [[]];
    throw new Error(`Unexpected pool query: ${sql}`);
  }
});
auditLog.writeAuditLog = async () => { events.push('audit'); };
emailWorker.wakeAnnouncementEmailWorker = () => { events.push('worker_wake'); };

const announcements = require('../controllers/announcementsController');

function publish(body = {}) {
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
    body: { title: 'School update', body: 'A short announcement.', audiences: ['all'], ...body }
  }, response, error => { result.error = error; }).then(() => result);
}

test.beforeEach(() => {
  events.length = 0;
  failOutboxInsert = false;
  savedAnnouncement = null;
  dueRecords = [];
  schoolStatus = 'active';
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

test('scheduled announcement stores the UTC time without notifying recipients early', async () => {
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = await publish({ status: 'scheduled', scheduledAt });

  assert.equal(result.error, null);
  assert.equal(result.body.announcement.status, 'scheduled');
  assert.equal(savedAnnouncement.scheduledAt, scheduledAt.slice(0, 19).replace('T', ' '));
  assert.ok(!events.includes('notifications'));
  assert.ok(!events.includes('outbox'));
  assert.ok(!events.includes('worker_wake'));
});

test('scheduled announcement requires a future time with a timezone', async () => {
  const result = await publish({ status: 'scheduled', scheduledAt: '2026-10-02T12:00' });
  assert.match(result.error?.message || '', /timezone/);
  assert.ok(!events.includes('commit'));
});

test('due worker publishes once, then creates notifications and queues email', async () => {
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await publish({ status: 'scheduled', scheduledAt });
  events.length = 0;
  dueRecords = [{ id: 31 }];

  await announcements.publishDueAnnouncements();
  await announcements.publishDueAnnouncements();

  assert.equal(savedAnnouncement.status, 'published');
  assert.equal(events.filter(event => event === 'scheduled_publish').length, 1);
  assert.equal(events.filter(event => event === 'notifications').length, 1);
  assert.equal(events.filter(event => event === 'outbox').length, 1);
  assert.ok(events.indexOf('outbox') < events.indexOf('commit'));
});

test('due worker does not publish while the school is suspended', async () => {
  await publish({ status: 'scheduled', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
  events.length = 0;
  dueRecords = [{ id: 31 }];
  schoolStatus = 'suspended';
  await announcements.publishDueAnnouncements();
  assert.equal(savedAnnouncement.status, 'scheduled');
  assert.ok(!events.includes('notifications'));
  assert.ok(!events.includes('outbox'));
});

test('only a school admin can pin a published announcement in their school', async () => {
  await publish();
  events.length = 0;
  const call = async (role, schoolId) => {
    const result = { error: null, body: null };
    await announcements.setAnnouncementPinned({
      user: { id: 10, schoolId, role }, params: { announcementId: '31' }, body: { pinned: true }
    }, { json(body) { result.body = body; } }, error => { result.error = error; });
    return result;
  };
  assert.equal((await call('teacher', 4)).error?.status, 403);
  assert.equal((await call('school_admin', 5)).error?.status, 404);
  const result = await call('school_admin', 4);
  assert.equal(result.error, null);
  assert.equal(result.body.announcement.pinned, true);
  assert.ok(events.includes('commit'));
});

test('an image request without a visible announcement returns not found', async () => {
  let error;
  await announcements.getAnnouncementImage({
    user: { id: 99, schoolId: 5, role: 'student' }, params: { announcementId: '31' }
  }, {}, failure => { error = failure; });
  assert.equal(error?.status, 404);
});
