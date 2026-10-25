const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const controller = require('../controllers/timetablesController');

const year = { startDate: '2026-06-01', endDate: '2027-03-31' };
const valid = { weekday: 1, startTime: '08:00', endTime: '09:00', startDate: '2026-06-01', endDate: '2026-12-31', room: ' Room 204 ' };

test('meeting validation preserves school-local dates and rejects invalid ranges and times', () => {
  assert.deepEqual(controller.validateMeeting(valid, year), {
    weekday: 1, startTime: '08:00:00', endTime: '09:00:00',
    startDate: '2026-06-01', endDate: '2026-12-31', room: 'Room 204'
  });
  assert.throws(() => controller.validateMeeting({ ...valid, endTime: '08:00' }, year), /after start/);
  assert.throws(() => controller.validateMeeting({ ...valid, endDate: '2027-04-01' }, year), /school year/);
  assert.throws(() => controller.validateMeeting({ ...valid, startDate: '2026-06-02', endDate: '2026-06-02' }, year), /weekday/);
  assert.throws(() => controller.validateMeeting({ ...valid, startDate: '2026-02-29' }, year), /valid date/);
  assert.equal(controller.hasOccurrence('2028-02-29', '2028-02-29', 2), true);
});

test('conflicts require a shared section, teacher, or room and an actual shared weekday', async () => {
  const candidate = { id: 12, startDate: '2026-06-01', endDate: '2026-06-01', room: 'room 204', sectionId: 8, teacherId: 9, sectionName: 'Peter', subjectName: 'Math' };
  let queries = [];
  const connection = { async execute(sql, values) { queries.push({ sql, values }); return [[candidate]]; } };
  const meeting = { weekday: 1, startTime: '08:00:00', endTime: '09:00:00', startDate: '2026-06-01', endDate: '2026-06-03', room: 'Room 204' };
  assert.equal((await controller.findConflict(connection, 2, 3, { sectionId: 7, teacherId: 4 }, meeting, 0)).id, 12);
  assert.equal(queries[0].values[0], 2);
  assert.equal(queries[0].values[1], 3);
  assert.match(queries[0].sql, /m\.start_time < \? AND m\.end_time > \?/);
  candidate.room = null;
  assert.equal(await controller.findConflict(connection, 2, 3, { sectionId: 7, teacherId: 4 }, meeting, 0), undefined);
  candidate.teacherId = 4;
  candidate.startDate = '2026-06-02';
  candidate.endDate = '2026-06-03';
  assert.equal(await controller.findConflict(connection, 2, 3, { sectionId: 7, teacherId: 4 }, meeting, 0), undefined);
});

test('timetable reads scope teacher and student assignments to the signed-in user', async () => {
  const queries = [];
  database = { async execute(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('FROM academic_years WHERE id =')) return [[{ id: 3, label: '2026-2027', status: 'active', ...year }]];
    return [[]];
  } };
  async function read(role) {
    let body;
    let error;
    await controller.list({ user: { role, schoolId: 2, id: 42 }, query: { academicYearId: '3' } },
      { json(value) { body = value; } }, value => { error = value; });
    assert.equal(error, undefined);
    return body;
  }
  await read('teacher');
  assert.match(queries.at(-1).sql, /a\.teacher_user_id = \?/);
  assert.deepEqual(queries.at(-1).values, [2, 3, 42]);
  await read('student');
  assert.match(queries.at(-1).sql, /ss\.student_user_id = \? AND ss\.withdrawn_at IS NULL/);
  assert.deepEqual(queries.at(-1).values, [2, 3, 42]);
});

test('school-year choices come from the timetable API for all three roles', async () => {
  const seen = [];
  database = { async execute(sql, values) { seen.push({ sql, values }); return [[{ id: 3, label: '2026-2027', status: 'active' }]]; } };
  for (const role of ['school_admin', 'teacher', 'student']) {
    let body;
    await controller.listYears({ user: { role, schoolId: 2 } }, { json(value) { body = value; } }, error => { throw error; });
    assert.equal(body.years[0].id, 3);
  }
  assert.ok(seen.every(query => query.values[0] === 2 && query.sql.includes('WHERE school_id = ?')));
});

test('timetable writes serialize on the school-year row before conflict checks', async () => {
  const queries = [];
  const assignment = { id: 5, sectionId: 7, teacherId: 4, academicYearId: 3, sectionStatus: 'active', yearStatus: 'active', ...year };
  const connection = {
    async beginTransaction() { queries.push('BEGIN'); },
    async commit() { queries.push('COMMIT'); },
    async rollback() { queries.push('ROLLBACK'); },
    release() {},
    async execute(sql) {
      queries.push(sql);
      if (sql.includes('FROM section_teachers a') && sql.includes('LIMIT 1')) return [[assignment]];
      if (sql.includes('FROM timetable_meetings m') && sql.includes('m.start_time <')) return [[]];
      if (sql.includes('SELECT id FROM scheduled_classes')) return [[{ id: 11 }]];
      if (sql.includes('INSERT INTO timetable_meetings')) return [{ insertId: 15 }];
      return [[]];
    }
  };
  database = { getConnection: async () => connection };
  let error;
  let result;
  await controller.save({ user: { schoolId: 2, id: 90 }, params: { assignmentId: '5' }, body: valid },
    { status() { return this; }, json(value) { result = value; } }, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(result.id, 15);
  const lock = queries.findIndex(query => typeof query === 'string' && query.includes('FOR UPDATE'));
  const conflicts = queries.findIndex(query => typeof query === 'string' && query.includes('m.start_time <'));
  assert.ok(lock > -1 && conflicts > lock);
  assert.equal(queries.at(-1), 'COMMIT');
});

test('a conflicting meeting returns 409 and rolls back without writing', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() {},
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('FROM section_teachers a') && sql.includes('LIMIT 1')) return [[{
        id: 5, sectionId: 7, teacherId: 4, academicYearId: 3, sectionStatus: 'active', yearStatus: 'active', ...year
      }]];
      if (sql.includes('m.start_time <')) return [[{
        id: 44, sectionId: 7, teacherId: 9, sectionName: 'St. Peter', subjectName: 'English',
        startDate: '2026-06-01', endDate: '2026-12-31'
      }]];
      return [[]];
    }
  };
  database = { getConnection: async () => connection };
  let failure;
  await controller.save({ user: { schoolId: 2, id: 90 }, params: { assignmentId: '5' }, body: valid },
    { status() { return this; }, json() {} }, error => { failure = error; });
  assert.equal(failure.status, 409);
  assert.match(failure.message, /English in St\. Peter/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some(sql => typeof sql === 'string' && sql.includes('INSERT INTO timetable_meetings')), false);
});

test('archived years and inactive sections cannot gain meetings', async () => {
  for (const state of [{ yearStatus: 'archived', sectionStatus: 'active' }, { yearStatus: 'active', sectionStatus: 'archived' }]) {
    const calls = [];
    const connection = {
      async beginTransaction() { calls.push('BEGIN'); }, async rollback() { calls.push('ROLLBACK'); }, release() {},
      async execute(sql) {
        calls.push(sql);
        if (sql.includes('FROM section_teachers a') && sql.includes('LIMIT 1')) return [[{
          id: 5, sectionId: 7, teacherId: 4, academicYearId: 3, ...year, ...state
        }]];
        return [[]];
      }
    };
    database = { getConnection: async () => connection };
    let failure;
    await controller.save({ user: { schoolId: 2 }, params: { assignmentId: '5' }, body: valid },
      { status() { return this; }, json() {} }, error => { failure = error; });
    assert.equal(failure.status, 409);
    assert.equal(calls.at(-1), 'ROLLBACK');
  }
});
