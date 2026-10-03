const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { requireSchoolUser } = require('../middleware/authorize');

function runSchoolUserGuard(role, schoolId = 1) {
  const result = { allowed: false, status: null, body: null };
  requireSchoolUser(
    { user: role ? { role, schoolId } : null },
    {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; }
    },
    () => { result.allowed = true; }
  );
  return result;
}

function routeSource(name) {
  return fs.readFileSync(path.join(__dirname, '../routes', name), 'utf8');
}

test('school routes allow school roles and reject platform administrators', () => {
  for (const role of ['school_admin', 'teacher', 'student', 'parent']) {
    assert.equal(runSchoolUserGuard(role).allowed, true, `${role} should pass`);
  }
  for (const role of ['platform_admin', null]) {
    const result = runSchoolUserGuard(role, null);
    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
  }
  assert.equal(runSchoolUserGuard('teacher', null).allowed, false);
});

test('platform administrators use only platform school-account routes', () => {
  const users = routeSource('users.js');
  const imports = routeSource('userImport.js');
  const sections = routeSource('sections.js');

  assert.doesNotMatch(users, /requireRoles\('platform_admin', 'school_admin'\)/);
  assert.match(imports, /requireRoles\('school_admin'\)/);
  assert.match(sections, /router\.use\(requireAuth, requireSchoolUser\)/);
});

test('tenant-aware background joins include the child school ID', () => {
  const announcementWorker = fs.readFileSync(path.join(__dirname, '../workers/announcementEmailWorker.js'), 'utf8');
  const parentWorker = fs.readFileSync(path.join(__dirname, '../workers/parentNotificationWorker.js'), 'utf8');

  assert.match(announcementWorker, /announcements\.school_id = queued\.school_id/);
  assert.match(announcementWorker, /recipients\.school_id = queued\.school_id/);
  assert.match(announcementWorker, /schools\.registration_status AS schoolStatus/);
  assert.match(announcementWorker, /job\.schoolStatus !== 'active'/);
  assert.match(parentWorker, /schools\.registration_status = 'active'/);
  assert.match(parentWorker, /section_students\.school_id = assignments\.school_id/);
  assert.match(parentWorker, /assignment_submissions\.school_id = assignments\.school_id/);
  assert.match(parentWorker, /entries\.school_id = journal_subjects\.school_id/);
});
