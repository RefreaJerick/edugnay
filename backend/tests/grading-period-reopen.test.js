const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let queryHandler = async () => [[]];
const queries = [];

const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    return queryHandler(sql, values);
  },
  async getConnection() {
    return {
      execute: async (sql, values = []) => {
        queries.push({ sql, values });
        return queryHandler(sql, values);
      },
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {}
    };
  }
};

databaseModule.getDatabase = () => database;
const reopen = require('../controllers/gradingPeriodReopenController');
const grades = require('../controllers/gradesController');

function mockScope(overrides = {}) {
  return {
    sectionId: 8,
    schoolId: 1,
    academicYearId: 4,
    schoolLevelId: 2,
    sectionStatus: 'active',
    academicYearStatus: 'active',
    subjectId: 2,
    academicTermId: 14,
    academicTermName: 'Quarter 2',
    termStatus: 'closed',
    ...overrides
  };
}

function mockRequest(overrides = {}) {
  return {
    id: 31,
    schoolId: 1,
    academicTermId: 14,
    sectionId: 8,
    subjectId: 2,
    teacherId: 5,
    teacherName: 'Maria Reyes',
    sectionName: 'St. Matthew',
    subjectName: 'English',
    academicTermName: 'Quarter 2',
    reason: 'Correct a score entered in error.',
    requestStatus: 'pending',
    status: 'pending',
    adminNote: null,
    lastActionNote: null,
    reviewedBy: null,
    reviewedAt: null,
    approvedAt: null,
    expiresAt: null,
    requestedAt: new Date('2026-09-30T08:00:00.000Z'),
    updatedAt: new Date('2026-09-30T08:00:00.000Z'),
    ...overrides
  };
}

async function call(handler, { role = 'teacher', id = 5, schoolId = 1, params = {}, query = {}, body = {} } = {}) {
  const result = { status: 200, data: null, error: null };
  await handler({ user: { id, schoolId, role }, params, query, body }, {
    status(code) { result.status = code; return this; },
    set() {},
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

function setScopeAndAssignment({ assigned = true, scope = mockScope(), requestRows = [] } = {}) {
  queryHandler = async sql => {
    if (sql.includes('FROM sections') && sql.includes('academic_terms')) return [[scope]];
    if (sql.includes('FROM section_teachers')) return [assigned ? [{ ok: 1 }] : []];
    if (sql.includes('FROM grading_period_reopen_requests')) return [requestRows];
    return [[]];
  };
}

test('teacher access response uses the database status and expiry', async () => {
  queries.length = 0;
  setScopeAndAssignment({ requestRows: [mockRequest({ requestStatus: 'approved', status: 'expired', expiresAt: new Date('2026-09-30T07:00:00.000Z') })] });

  const result = await call(reopen.getTeacherEditAccess, {
    query: { sectionId: '8', subjectId: '2', academicTermId: '14' }
  });

  assert.equal(result.error, null);
  assert.equal(result.data.canEdit, false);
  assert.equal(result.data.request.status, 'expired');
  assert.deepEqual(queries[0].values, [2, 14, 8, 1]);
  assert.match(queries[2].sql, /teacher_user_id = \?/);
  assert.deepEqual(queries[2].values.slice(0, 2), [1, 5]);
});

test('teacher access rejects a section and subject without a matching teacher assignment', async () => {
  queries.length = 0;
  setScopeAndAssignment({ assigned: false });

  const result = await call(reopen.getTeacherEditAccess, {
    query: { sectionId: '8', subjectId: '2', academicTermId: '14' }
  });

  assert.equal(result.error?.status, 403);
  assert.equal(queries.some(query => query.sql.includes('grading_period_reopen_requests')), false);
});

test('new requests use the authenticated teacher and reject a second pending request', async () => {
  queries.length = 0;
  let inserted = null;
  let rolledBack = false;
  let committed = false;
  queryHandler = async (sql, values) => {
    if (sql.includes('FROM sections') && sql.includes('academic_terms')) return [[mockScope()]];
    if (sql.includes('FROM section_teachers')) return [[{ ok: 1 }]];
    if (sql.includes('SELECT id FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('INSERT INTO grading_period_reopen_requests')) {
      inserted = values;
      return [{ insertId: 32 }];
    }
    if (sql.includes('INNER JOIN users ON users.id = grading_period_reopen_requests.teacher_user_id')) return [[mockRequest({ id: 32, teacherId: 5 })]];
    return [[]];
  };
  database.getConnection = async () => ({
    execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {}
  });

  const result = await call(reopen.createRequest, {
    body: { schoolId: 99, teacherId: 99, sectionId: 8, subjectId: 2, academicTermId: 14, reason: 'Please correct the score.' }
  });

  assert.equal(result.status, 201);
  assert.equal(result.data.request.teacherId, '5');
  assert.deepEqual(inserted, [1, 14, 8, 2, 5, 'Please correct the score.']);
  assert.equal(committed, true);
  assert.equal(rolledBack, false);

  queries.length = 0;
  inserted = null;
  rolledBack = false;
  committed = false;
  queryHandler = async sql => {
    if (sql.includes('FROM sections') && sql.includes('academic_terms')) return [[mockScope()]];
    if (sql.includes('FROM section_teachers')) return [[{ ok: 1 }]];
    if (sql.includes('SELECT id FROM grading_period_reopen_requests')) return [[{ id: 31 }]];
    return [[]];
  };
  const duplicate = await call(reopen.createRequest, {
    body: { sectionId: 8, subjectId: 2, academicTermId: 14, reason: 'Another request.' }
  });
  assert.equal(duplicate.error?.status, 409);
  assert.equal(inserted, null);
  assert.equal(rolledBack, true);
});

test('school-admin approval records the reviewer and school from the session', async () => {
  queries.length = 0;
  let updateValues = null;
  let notificationValues = null;
  let committed = false;
  queryHandler = async (sql, values) => {
    if (sql.includes('SELECT id, school_id AS schoolId') && !sql.includes('FOR UPDATE')) return [[mockRequest()]];
    if (sql.includes('FROM sections') && sql.includes('academic_terms')) return [[mockScope()]];
    if (sql.includes('FROM section_teachers')) return [[{ ok: 1 }]];
    if (sql.includes('WHERE id = ? AND school_id = ? FOR UPDATE')) return [[{ ...mockRequest(), status: 'pending' }]];
    if (sql.includes('SELECT id FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('SELECT CAST(? AS DATETIME) > NOW()')) return [[{ isValid: 1 }]];
    if (sql.includes("SET request_status = 'approved'")) { updateValues = values; return [{ affectedRows: 1 }]; }
    if (sql.includes('INSERT INTO notifications')) { notificationValues = values; return [{ insertId: 91 }]; }
    if (sql.includes('INNER JOIN users ON users.id = grading_period_reopen_requests.teacher_user_id')) {
      return [[mockRequest({ requestStatus: 'approved', status: 'approved', reviewedBy: 2, adminNote: 'Approved.', expiresAt: new Date('2026-10-01T08:00:00.000Z') })]];
    }
    return [[]];
  };
  database.getConnection = async () => ({
    execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => {},
    release: () => {}
  });

  const result = await call(reopen.approveRequest, {
    role: 'school_admin', id: 2, schoolId: 1, params: { requestId: '31' },
    body: { schoolId: 99, reviewedBy: 99, expiresAt: '2026-10-01T16:00', adminNote: 'Approved.' }
  });

  assert.equal(result.error, null);
  assert.equal(result.data.request.status, 'approved');
  assert.equal(updateValues[0], 2);
  assert.equal(updateValues[3], 31);
  assert.equal(updateValues[4], 1);
  assert.equal(notificationValues[0], 5);
  assert.equal(notificationValues[1], 'Grade access approved');
  assert.match(notificationValues[2], /2026-10-01 16:00 \(school local time\)/);
  assert.match(notificationValues[2], /Admin note: Approved\./);
  assert.match(notificationValues[3], /sectionId=8&subjectId=2&tab=scores/);
  assert.equal(committed, true);
});

test('reject, extend, and revoke create a teacher notification in the decision transaction', async () => {
  const decisions = [
    {
      action: 'reject', handler: reopen.rejectRequest, status: 'pending',
      body: { adminNote: 'Please provide more details.' }, title: 'Grade access request rejected',
      message: /Admin note: Please provide more details\./,
      final: { requestStatus: 'rejected', status: 'rejected', adminNote: 'Please provide more details.' }
    },
    {
      action: 'extend', handler: reopen.extendRequest, status: 'approved',
      body: { expiresAt: '2026-10-02T16:00', reason: 'Allow one more day.' }, title: 'Grade editing deadline extended',
      message: /2026-10-02 16:00 \(school local time\).*Reason: Allow one more day\./,
      final: { requestStatus: 'approved', status: 'approved', lastActionNote: 'Allow one more day.' }
    },
    {
      action: 'revoke', handler: reopen.revokeRequest, status: 'approved',
      body: { reason: 'The correction window has ended.' }, title: 'Grade editing access revoked',
      message: /Reason: The correction window has ended\./,
      final: { requestStatus: 'revoked', status: 'revoked', lastActionNote: 'The correction window has ended.' }
    }
  ];

  for (const decision of decisions) {
    queries.length = 0;
    let notificationValues = null;
    let committed = false;
    let rolledBack = false;
    queryHandler = async (sql, values) => {
      if (sql.includes('SELECT id, school_id AS schoolId') && !sql.includes('FOR UPDATE')) {
        return [[mockRequest({ status: decision.status, requestStatus: decision.status })]];
      }
      if (sql.includes('FROM sections') && sql.includes('academic_terms')) return [[mockScope()]];
      if (sql.includes('FROM section_teachers')) return [[{ ok: 1 }]];
      if (sql.includes("SELECT id FROM grading_period_reopen_requests") && sql.includes("request_status = 'pending'")) return [[]];
      if (sql.includes('WHERE id = ? AND school_id = ? FOR UPDATE')) {
        return [[mockRequest({ status: decision.status, requestStatus: decision.status })]];
      }
      if (sql.includes('SELECT CAST(? AS DATETIME) > NOW() AS isValid')) return [[{ isValid: 1 }]];
      if (sql.includes('SELECT CAST(? AS DATETIME) > NOW() AND CAST(? AS DATETIME) > expires_at')) return [[{ isLater: 1 }]];
      if (sql.includes("request_status = 'approved' AND expires_at > NOW()")) return [[{ id: 31 }]];
      if (sql.includes('UPDATE grading_period_reopen_requests')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO notifications')) { notificationValues = values; return [{ insertId: 92 }]; }
      if (sql.includes('INNER JOIN users ON users.id = grading_period_reopen_requests.teacher_user_id')) {
        return [[mockRequest(decision.final)]];
      }
      return [[]];
    };
    database.getConnection = async () => ({
      execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
      beginTransaction: async () => {},
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => {}
    });

    const result = await call(decision.handler, {
      role: 'school_admin', id: 2, schoolId: 1, params: { requestId: '31' }, body: decision.body
    });

    assert.equal(result.error, null, `${decision.action} should succeed`);
    assert.equal(notificationValues[0], 5, `${decision.action} should notify the requesting teacher`);
    assert.equal(notificationValues[1], decision.title);
    assert.match(notificationValues[2], decision.message);
    assert.match(notificationValues[3], /sectionId=8&subjectId=2&tab=scores/);
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
  }
});

test('a failed reopen notification insert rolls back the admin decision', async () => {
  queries.length = 0;
  let committed = false;
  let rolledBack = false;
  queryHandler = async sql => {
    if (sql.includes('SELECT id, school_id AS schoolId') && !sql.includes('FOR UPDATE')) {
      return [[mockRequest({ status: 'pending', requestStatus: 'pending' })]];
    }
    if (sql.includes('WHERE id = ? AND school_id = ? FOR UPDATE')) {
      return [[mockRequest({ status: 'pending', requestStatus: 'pending' })]];
    }
    if (sql.includes('UPDATE grading_period_reopen_requests')) return [{ affectedRows: 1 }];
    if (sql.includes('INNER JOIN users ON users.id = grading_period_reopen_requests.teacher_user_id')) {
      return [[mockRequest({ requestStatus: 'rejected', status: 'rejected' })]];
    }
    if (sql.includes('INSERT INTO notifications')) throw new Error('Notification insert failed.');
    return [[]];
  };
  database.getConnection = async () => ({
    execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {}
  });

  const result = await call(reopen.rejectRequest, {
    role: 'school_admin', id: 2, schoolId: 1, params: { requestId: '31' }, body: {}
  });

  assert.match(result.error?.message || '', /Notification insert failed/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});

test('school admin cannot act on a reopen request from another school', async () => {
  queries.length = 0;
  let updated = false;
  queryHandler = async (sql, values) => {
    if (sql.includes('SELECT id, school_id AS schoolId')) {
      assert.deepEqual(values, [31, 2]);
      return [[]];
    }
    if (sql.includes('UPDATE grading_period_reopen_requests')) updated = true;
    return [[]];
  };
  database.getConnection = async () => ({
    execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}
  });

  const result = await call(reopen.rejectRequest, {
    role: 'school_admin', id: 2, schoolId: 2, params: { requestId: '31' }, body: { schoolId: 1 }
  });

  assert.equal(result.error?.status, 404);
  assert.equal(updated, false);
});

function mockGradingItem(overrides = {}) {
  return {
    id: 21,
    sectionId: 8,
    subjectId: 2,
    academicTermId: 14,
    gradingCategoryId: 1,
    teacherUserId: 5,
    title: 'Quiz 1',
    maxScore: '20.00',
    academicTermStatus: 'closed',
    academicYearStatus: 'active',
    ...overrides
  };
}

function setClosedGradeWriteQueries({ approved = false, assigned = true } = {}) {
  queryHandler = async sql => {
    if (sql.includes('FROM grading_items') && sql.includes('LIMIT 1')) return [[mockGradingItem()]];
    if (sql.includes('FROM section_teachers')) return [assigned ? [{ id: 1, schoolId: 1, academicYearId: 4, schoolLevelId: 2 }] : []];
    if (sql.includes('FROM academic_terms') && sql.includes('FOR UPDATE')) return [[{ academicTermStatus: 'closed', academicYearStatus: 'active' }]];
    if (sql.includes('FROM grading_period_reopen_requests')) return [approved ? [{ id: 7 }] : []];
    if (sql.includes('FROM section_students')) return [[{ studentId: 101 }]];
    if (sql.includes('FROM student_scores') && sql.includes('WHERE grading_item_id')) return [[{ id: 41, gradingItemId: 21, studentId: 101, score: '18.00', remarks: null, recordedAt: new Date() }]];
    return [[]];
  };
}

test('closed-term score writes require an unexpired approval for the same teacher and scope', async () => {
  queries.length = 0;
  let inserted = false;
  let rolledBack = false;
  setClosedGradeWriteQueries({ approved: false });
  database.getConnection = async () => ({
    execute: async (sql, values = []) => {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO student_scores')) inserted = true;
      return queryHandler(sql, values);
    },
    beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => { rolledBack = true; }, release: () => {}
  });
  const denied = await call(grades.saveStudentScore, { body: { gradingItemId: 21, studentId: 101, score: 18 } });
  assert.equal(denied.error?.status, 409);
  assert.equal(inserted, false);
  assert.equal(rolledBack, true);

  queries.length = 0;
  inserted = false;
  rolledBack = false;
  setClosedGradeWriteQueries({ approved: true });
  const allowed = await call(grades.saveStudentScore, { body: { gradingItemId: 21, studentId: 101, score: 18 } });
  assert.equal(allowed.error, null);
  assert.equal(inserted, true);
  assert.equal(allowed.data.studentScore.score, 18);
  const permissionQuery = queries.find(query => query.sql.includes('FROM grading_period_reopen_requests'));
  assert.deepEqual(permissionQuery.values, [1, 14, 8, 2, 5]);
  assert.match(permissionQuery.sql, /expires_at > NOW\(\)/);
  assert.match(permissionQuery.sql, /FOR UPDATE/);
});

test('closed-term grading-item create and edit both reject without database approval', async () => {
  queries.length = 0;
  const writes = [];
  queryHandler = async (sql, values) => {
    if (sql.includes('FROM grading_items') && sql.includes('LIMIT 1')) return [[mockGradingItem()]];
    if (sql.includes('FROM section_teachers')) return [[{ id: 8, schoolId: 1, academicYearId: 4, schoolLevelId: 2 }]];
    if (sql.includes('SELECT academic_terms.id')) return [[{ id: 14, academicTermStatus: 'closed', academicYearStatus: 'active' }]];
    if (sql.includes('FROM academic_terms') && sql.includes('FOR UPDATE')) return [[{ academicTermStatus: 'closed', academicYearStatus: 'active' }]];
    if (sql.includes('FROM grading_categories')) return [[{ id: 1 }]];
    if (sql.includes('FROM grading_period_reopen_requests')) return [[]];
    if (sql.includes('INSERT INTO grading_items') || sql.includes('UPDATE grading_items')) writes.push(sql);
    return [[]];
  };
  database.getConnection = async () => ({
    execute: async (sql, values = []) => { queries.push({ sql, values }); return queryHandler(sql, values); },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}
  });

  const create = await call(grades.createGradingItem, {
    body: { sectionId: 8, subjectId: 2, academicTermId: 14, gradingCategoryId: 1, title: 'Quiz 2', maxScore: 20 }
  });
  const update = await call(grades.updateGradingItem, {
    params: { gradingItemId: '21' }, body: { title: 'Corrected quiz title' }
  });

  assert.equal(create.error?.status, 409);
  assert.equal(update.error?.status, 409);
  assert.deepEqual(writes, []);
});
