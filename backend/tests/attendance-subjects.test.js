const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const calls = [];
let attendanceEnabled = 0;
const section = {
  id: 8, schoolId: 1, name: 'St. Matthew',
  academicYearStartDate: '2025-01-01', academicYearEndDate: '2027-12-31'
};

const database = {
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM parent_notification_triggers')) return [[]];
    if (sql.includes("FROM users WHERE users.id = ?") && sql.includes("users.role = 'student'")) {
      return [values[0] === 4 && values[1] === 1 ? [{ id: 4, schoolId: 1, displayName: 'Student' }] : []];
    }
    if (sql.includes('SELECT name AS subjectName FROM subjects')) return [[{ subjectName: 'Mathematics' }]];
    if (sql.includes('FROM student_qr_credentials WHERE school_id = ?')) return [[]];
    if (sql.includes('FROM sections') && sql.includes('section_teachers')) {
      return [values[0] === 8 && values[1] === 1 && values[2] === 3 && [1, 2].includes(values[3]) ? [section] : []];
    }
    if (sql.includes('SELECT id FROM academic_years WHERE id = ? AND school_id = ?')) {
      return [values[0] === 5 && values[1] === 1 ? [{ id: 5 }] : []];
    }
    if (sql.includes('SELECT id, label FROM academic_years WHERE school_id = ?')) {
      return [[{ id: 5, label: '2026–2027' }]];
    }
    if (sql.includes('FROM section_students') && sql.includes('school_grade_levels.display_name AS grade')) return [[]];
    if (sql.includes('FROM school_portal_features')) return [attendanceEnabled == null ? [] : [{ attendanceEnabled }]];
    if (sql.includes('FROM school_attendance_settings')) return [[{ allowEditPastAttendance: 1 }]];
    if (sql.includes('FROM attendance_sessions') && sql.includes('INNER JOIN sections')) {
      return [[{ id: 21, schoolId: 1, sectionId: 8, subjectId: 1, sectionName: 'St. Matthew' }]];
    }
    if (sql.includes('FROM attendance_sessions') && sql.includes("method = 'qr'")) {
      return [[{ id: 21, status: 'draft', createdByUserId: 3 }]];
    }
    if (sql.includes('FROM attendance_sessions') && sql.includes('LEFT JOIN attendance_records')) return [[]];
    if (sql.includes('FROM attendance_sessions') && sql.includes('FOR UPDATE')) return [[]];
    if (sql.includes('FROM attendance_sessions') && sql.includes('LIMIT 1')) {
      return [[{ id: values[2] === 1 ? 10 : 11, status: 'confirmed', method: 'manual' }]];
    }
    if (sql.includes('FROM section_students') && sql.includes('INNER JOIN users AS students')) {
      const status = values[0] === 10 ? 'absent' : values[0] === 11 ? 'present' : null;
      return [[{ studentId: 4, displayName: 'Student', initials: 'ST', lrn: '123', attendanceStatus: status, remarks: null }]];
    }
    if (sql.includes('FROM section_students') && sql.includes('EXISTS (')) {
      return [[{ studentId: 4, displayName: 'Student', initials: 'ST', lrn: '123', isScanned: 0 }]];
    }
    if (sql.includes('FROM section_students') && sql.includes('ORDER BY student_user_id')) return [[{ studentId: 4 }]];
    if (sql.includes('INSERT INTO attendance_sessions')) return [{ insertId: 21 }];
    if (sql.includes('INSERT INTO attendance_records') || sql.includes('UPDATE attendance_sessions') || sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    if (sql.includes('FROM student_parent_links') && sql.includes('INNER JOIN users AS students')) {
      return [[{ studentId: 4, displayName: 'Student', initials: 'ST', gradeLevel: 'Grade 7', sectionName: 'St. Matthew' }]];
    }
    if (sql.includes('FROM attendance_records') && sql.includes('GROUP BY sections.id')) {
      return [[
        { sectionId: 8, sectionName: 'St. Matthew', grade: 'Grade 7', studentId: 4, status: 'absent', total: 1 },
        { sectionId: 8, sectionName: 'St. Matthew', grade: 'Grade 7', studentId: 4, status: 'present', total: 1 }
      ]];
    }
    if (sql.includes('FROM attendance_records') && sql.includes('INNER JOIN subjects')) {
      return [[{ studentId: 4, sectionId: 8, subjectId: 1, subjectName: 'Mathematics', date: '2026-09-27', status: 'absent' }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}
    };
  }
};
databaseModule.getDatabase = () => database;
const attendance = require('../controllers/attendanceController');
const qr = require('../controllers/qrAttendanceController');

async function call(handler, req) {
  const result = { status: 200, data: null, error: null };
  const response = {
    status(code) { result.status = code; return this; },
    set() { return this; },
    json(data) { result.data = data; return this; }
  };
  await handler(req, response, error => { result.error = error; });
  return result;
}

const teacher = { id: 3, schoolId: 1, role: 'teacher' };

test('the same student can have different statuses in two subjects', async () => {
  const first = await call(attendance.getSectionAttendance, {
    user: teacher, params: { sectionId: '8', subjectId: '1' }, query: { date: '2026-09-27' }
  });
  const second = await call(attendance.getSectionAttendance, {
    user: teacher, params: { sectionId: '8', subjectId: '2' }, query: { date: '2026-09-27' }
  });
  assert.equal(first.error, null);
  assert.equal(second.error, null);
  assert.equal(first.data.subjectId, 1);
  assert.equal(second.data.subjectId, 2);
  assert.equal(first.data.students[0].attendanceStatus, 'absent');
  assert.equal(second.data.students[0].attendanceStatus, 'present');
  assert.ok(calls.some(call => call.sql.includes('subject_id = ?') && call.values[2] === 1));
  assert.ok(calls.some(call => call.sql.includes('subject_id = ?') && call.values[2] === 2));
});

test('an unassigned subject is denied before attendance is read', async () => {
  const result = await call(attendance.getSectionAttendance, {
    user: teacher, params: { sectionId: '8', subjectId: '3' }, query: { date: '2026-09-27' }
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.status, 404);
});

test('a teacher from another school cannot read the section', async () => {
  const result = await call(attendance.getSectionAttendance, {
    user: { id: 3, schoolId: 2, role: 'teacher' },
    params: { sectionId: '8', subjectId: '1' }, query: { date: '2026-09-27' }
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.status, 404);
});

test('a student can read only their own same-school QR credential', async () => {
  calls.length = 0;
  const own = await call(qr.getStudentQr, {
    user: { id: 4, schoolId: 1, role: 'student' }, params: { studentId: '4' }
  });
  assert.equal(own.error, null);
  assert.equal(own.data.requiresRegeneration, true);
  const credentialQuery = calls.find(call => call.sql.includes('FROM student_qr_credentials'));
  assert.deepEqual(credentialQuery.values, [1, 4]);

  const other = await call(qr.getStudentQr, {
    user: { id: 4, schoolId: 1, role: 'student' }, params: { studentId: '5' }
  });
  assert.equal(other.data, null);
  assert.equal(other.error?.status, 403);
});

test('a school administrator cannot read a student QR from another school', async () => {
  const result = await call(qr.getStudentQr, {
    user: { id: 2, schoolId: 2, role: 'school_admin' }, params: { studentId: '4' }
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.status, 404);
});

test('QR sessions save the chosen subject and do not touch other subjects', async () => {
  calls.length = 0;
  const result = await call(qr.startQrAttendance, {
    user: teacher, params: { sectionId: '8', subjectId: '1' }
  });
  assert.equal(result.error, null);
  assert.equal(result.data.subjectId, 1);
  const insert = calls.find(call => call.sql.includes('INSERT INTO attendance_sessions'));
  assert.deepEqual(insert.values.slice(0, 3), [1, 8, 1]);
  assert.ok(calls.some(call => call.sql.includes('FOR UPDATE') && call.values[2] === 1));
  assert.ok(!calls.some(call => call.sql.includes('FROM school_portal_features')));
});

test('manual save writes a subject-specific session and student status', async () => {
  calls.length = 0;
  const result = await call(attendance.saveSectionAttendance, {
    user: teacher, params: { sectionId: '8', subjectId: '2' },
    body: { attendanceDate: '2026-09-27', records: [{ studentId: 4, status: 'present', remarks: 'Here' }] }
  });
  assert.equal(result.error, null);
  const insert = calls.find(call => call.sql.includes('INSERT INTO attendance_sessions'));
  assert.deepEqual(insert.values.slice(0, 3), [1, 8, 2]);
  const savedRecord = calls.find(call => call.sql.includes('INSERT INTO attendance_records'));
  assert.deepEqual(savedRecord.values.slice(0, 5), [1, 21, 4, 'present', 'Here']);
  const audit = calls.find(call => call.sql.includes('INSERT INTO audit_logs'));
  assert.equal((audit.sql.match(/\?/g) || []).length, audit.values.length);
  assert.ok(audit.sql.includes("'sectionName', ?"));
  assert.ok(audit.sql.includes("'subjectName', ?"));
  assert.ok(audit.values.includes('Mathematics'));
  assert.ok(!calls.some(call => call.sql.includes('FROM school_portal_features')));
});

test('QR confirmation keeps the session subject and records the reviewed roster', async () => {
  calls.length = 0;
  const result = await call(qr.confirmQrAttendance, {
    user: teacher, params: { sessionId: '21' },
    body: { records: [{ studentId: 4, status: 'absent', remarks: null }] }
  });
  assert.equal(result.error, null);
  assert.equal(result.data.subjectId, 1);
  assert.ok(calls.some(call => call.sql.includes('section_teachers.subject_id = attendance_sessions.subject_id')));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO attendance_records') && call.values[3] === 'absent'));
  const audit = calls.find(call => call.sql.includes('INSERT INTO audit_logs'));
  assert.equal((audit.sql.match(/\?/g) || []).length, audit.values.length);
});

test('parent attendance query is scoped to linked children and confirmed subjects', async () => {
  calls.length = 0;
  const result = await call(attendance.getParentAttendance, {
    user: { id: 9, schoolId: 1, role: 'parent' }
  });
  assert.equal(result.error, null);
  assert.equal(result.data.records[0].subjectId, '1');
  assert.match(result.data.currentDate, /^\d{4}-\d{2}-\d{2}$/);
  const query = calls.find(call => call.sql.includes('FROM attendance_records'));
  assert.match(query.sql, /attendance_sessions\.status = 'confirmed'/);
  assert.match(query.sql, /student_parent_links\.parent_user_id = \?/);
  assert.equal(query.values[0], 1);
  assert.equal(query.values[2], 9);
});

test('student attendance returns only records scoped to the signed-in student and school', async () => {
  calls.length = 0;
  const result = await call(attendance.getStudentAttendance, { user: { id: 4, schoolId: 1, role: 'student' } });
  assert.equal(result.error, null);
  assert.equal(result.data.records[0].studentId, '4');
  const query = calls.find(item => item.sql.includes('FROM attendance_records'));
  assert.deepEqual(query.values.slice(0, 2), [1, 4]);
  assert.match(query.sql, /attendance_records\.student_user_id = \?/);
  assert.match(query.sql, /attendance_sessions\.status = 'confirmed'/);
  assert.match(query.sql, /attendance_sessions\.attendance_date <= \?/);
  assert.match(query.sql, /academic_years\.status = 'active'/);
  assert.match(query.sql, /attendance_sessions\.attendance_date BETWEEN academic_years\.start_date AND academic_years\.end_date/);
});

test('student attendance works when the legacy feature flag is false or missing', async () => {
  for (const legacyValue of [0, null]) {
    attendanceEnabled = legacyValue;
    calls.length = 0;
    const result = await call(attendance.getStudentAttendance, { user: { id: 4, schoolId: 1, role: 'student' } });
    assert.equal(result.error, null);
    assert.equal(result.data.records[0].studentId, '4');
    assert.ok(calls.some(item => item.sql.includes('FROM attendance_records')));
    assert.ok(!calls.some(item => item.sql.includes('FROM school_portal_features')));
  }
  attendanceEnabled = 0;
});

test('student attendance route rejects other roles before reading records', () => {
  const router = require('../routes/attendance');
  const guard = router.stack.find(layer => layer.route?.path === '/me').route.stack[0].handle;
  for (const role of ['parent', 'teacher', 'school_admin']) {
    let status;
    let advanced = false;
    guard({ user: { role } }, { status(code) { status = code; return this; }, json() {} }, () => { advanced = true; });
    assert.equal(status, 403);
    assert.equal(advanced, false);
  }
  let advanced = false;
  guard({ user: { role: 'student' } }, {}, () => { advanced = true; });
  assert.equal(advanced, true);
});

test('school summary counts confirmed subject sessions instead of whole days', async () => {
  calls.length = 0;
  const result = await call(attendance.getSchoolAttendanceSummary, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }
  });
  assert.equal(result.error, null);
  assert.equal(result.data.attendanceRecordCount, 2);
  assert.equal(result.data.attendanceByGrade[0].rows[0].rate, 50);
  assert.deepEqual(result.data.attendanceBreakdown.filter(item => item.value > 0).map(item => item.label), ['Present', 'Absent']);
  const query = calls.find(call => call.sql.includes('FROM attendance_records'));
  assert.match(query.sql, /attendance_sessions\.subject_id IS NOT NULL/);
});

test('school attendance summary can load an explicitly selected school year', async () => {
  calls.length = 0;
  const result = await call(attendance.getSchoolAttendanceSummary, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }, query: { academicYearId: '5' }
  });
  assert.equal(result.error, null);
  assert.equal(result.data.academicYearId, '5');
  const query = calls.find(call => call.sql.includes('FROM attendance_records') && call.sql.includes('GROUP BY sections.id'));
  assert.deepEqual(query.values.slice(0, 2), [1, 5]);
  assert.match(query.sql, /academic_years\.id = \?/);
});

test('school attendance summary rejects years outside the authenticated school', async () => {
  calls.length = 0;
  const result = await call(attendance.getSchoolAttendanceSummary, {
    user: { id: 2, schoolId: 1, role: 'school_admin' }, query: { academicYearId: '999' }
  });
  assert.equal(result.data, null);
  assert.equal(result.error?.status, 404);
  assert.equal(calls.some(call => call.sql.includes('GROUP BY sections.id')), false);
});
