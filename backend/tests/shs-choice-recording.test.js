const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
const { getCatalogEntry } = require('../config/shsApprovedCatalog');

function createDatabase() {
  const requests = new Map();
  const choices = new Map();
  const history = [];
  const audit = [];
  const queries = [];
  let nextRequestId = 1;
  let learnerPlacement = { gradeId: 11, gradeCode: 'grade-11', trackCode: 'academic' };
  const classes = [101, 102].map((classId, index) => {
    const entry = getCatalogEntry(`AE00${classId - 100}`);
    return { id: classId, className: `Class ${classId}`, capacity: 20, classActive: 1,
      catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
      subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-11',
      offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0 };
  });

  async function execute(sql, args = []) {
    queries.push(sql);
    if (sql.includes('SELECT s.id AS sectionId')) {
      const [schoolId, studentId, yearId] = args;
      if (Number(schoolId) !== 7 || ![41, 42].includes(Number(studentId))
        || (yearId != null && Number(yearId) !== 20)) return [[], []];
      return [[{ sectionId: Number(studentId) + 100, sectionName: `Grade ${learnerPlacement.gradeId} ${studentId}`, yearId: 20,
        ...learnerPlacement, gradeName: `Grade ${learnerPlacement.gradeId}`, schoolYear: '2027-2028',
        studentName: Number(studentId) === 41 ? 'Student One' : 'Student Two', yearStatus: 'active' }], []];
    }
    if (sql.includes('SELECT id, label, status FROM academic_years')) return [[{ id: 20, label: '2027-2028', status: 'active' }], []];
    if (sql.includes('SELECT status FROM academic_years') && sql.includes('FOR UPDATE')) return [[{ status: 'active' }], []];
    if (sql.includes('SELECT * FROM shs_selection_requests')) {
      const [schoolId, yearId, gradeId, studentId] = args;
      const row = [...requests.values()].find(item => item.school_id === Number(schoolId)
        && item.academic_year_id === Number(yearId) && item.grade_level_id === Number(gradeId)
        && item.student_user_id === Number(studentId));
      return [[...(row ? [{ ...row }] : [])], []];
    }
    if (sql.includes('elective_class_id AS classId')) {
      if (args.length === 2) {
        const [schoolId, requestId] = args;
        const request = requests.get(Number(requestId));
        return [[...(request?.school_id === Number(schoolId)
          ? (choices.get(Number(requestId)) || []).map(classId => ({ classId })) : [])], []];
      }
      const [, yearId, gradeId, studentId] = args;
      const row = [...requests.values()].find(item => item.academic_year_id === Number(yearId)
        && item.grade_level_id === Number(gradeId) && item.student_user_id === Number(studentId));
      return [(row ? (choices.get(row.id) || []).map(classId => ({ classId })) : []), []];
    }
    if (sql.includes('SELECT id FROM shs_elective_classes') && sql.includes('FOR UPDATE')) return [[], []];
    if (sql.includes('SELECT c.id, c.class_name AS className')) {
      return [classes.map(item => ({ ...item })), []];
    }
    if (sql.includes('SELECT c.id AS classId, m.weekday')) return [[], []];
    if (sql.includes('SELECT m.weekday') && sql.includes('FROM timetable_meetings')) return [[], []];
    if (sql.includes('INSERT INTO shs_selection_requests')) {
      const [schoolId, yearId, gradeId, studentId, pathwayCode] = args;
      const request = { id: nextRequestId++, school_id: Number(schoolId), academic_year_id: Number(yearId),
        grade_level_id: Number(gradeId), student_user_id: Number(studentId), pathway_code: pathwayCode,
        status: 'pending', revision: 1, decision_reason: null, reviewed_by_user_id: null, reviewed_at: null };
      requests.set(request.id, request);
      choices.set(request.id, []);
      return [{ insertId: request.id }, []];
    }
    if (sql.includes("UPDATE shs_selection_requests SET status = 'pending'")) {
      const [revision, schoolId, requestId] = args;
      const request = requests.get(Number(requestId));
      assert.equal(request.school_id, Number(schoolId));
      Object.assign(request, { status: 'pending', revision: Number(revision), decision_reason: null,
        reviewed_by_user_id: null, reviewed_at: null });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('DELETE FROM shs_selection_request_classes')) {
      choices.set(Number(args[1]), []);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO shs_selection_request_classes')) {
      const [schoolId, requestId, classId] = args;
      assert.equal(Number(schoolId), 7);
      choices.get(Number(requestId)).push(Number(classId));
      return [{ insertId: 1 }, []];
    }
    if (sql.includes('INSERT INTO shs_selection_history')) {
      history.push({ schoolId: Number(args[0]), requestId: Number(args[1]), actorId: Number(args[2]),
        action: args[3], revision: Number(args[4]), details: JSON.parse(args[5]) });
      return [{ insertId: 1 }, []];
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      audit.push({ schoolId: Number(args[0]), actorId: Number(args[1]), action: args[2], entityId: Number(args[4]), details: JSON.parse(args[5]) });
      return [{ insertId: 1 }, []];
    }
    throw new Error(`Unexpected SQL in SHS choice test: ${sql}`);
  }

  const connection = { execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
  const database = { execute, async getConnection() { return connection; } };
  return { database, requests, choices, history, audit, queries,
    setPlacement(value) { learnerPlacement = { ...learnerPlacement, ...value }; }, classes };
}

const databaseModuleRef = databaseModule;
let fixture;
databaseModuleRef.getDatabase = () => fixture.database;
const controller = require('../controllers/shsSelectionController');

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const res = { status() { return this; }, json(value) { resolve(value); } };
    handler(req, res, reject);
  });
}

test('students can revise pending or returned choices without a pathway, hours, or selection window', async () => {
  fixture = createDatabase();
  const student = { user: { id: 41, schoolId: 7 }, body: { classIds: [101] } };
  const first = await invoke(controller.submit, student);
  assert.deepEqual(first, { id: 1, status: 'pending', revision: 1 });
  assert.deepEqual(fixture.choices.get(1), [101]);
  assert.equal(fixture.requests.get(1).pathway_code, 'academic'); // Stored only for compatibility with the existing table.

  Object.assign(fixture.requests.get(1), { status: 'rejected', decision_reason: 'Please check your choices.' });
  const revised = await invoke(controller.submit, { ...student, body: { classIds: ['102'] } });
  assert.deepEqual(revised, { id: 1, status: 'pending', revision: 2 });
  assert.deepEqual(fixture.choices.get(1), [102]);
  assert.equal(fixture.requests.get(1).decision_reason, null);
  assert.deepEqual(fixture.history.map(item => item.action), ['submitted', 'revised']);
  assert.deepEqual(fixture.audit.map(item => item.action), ['shs_selection_submitted', 'shs_selection_revised']);
  assert.equal(fixture.audit[0].details.gradeName, 'Grade 11');
  assert.equal(fixture.audit[0].details.sectionName, 'Grade 11 41');
  assert.equal(fixture.audit[0].details.schoolYear, '2027-2028');
  assert.equal(fixture.audit[0].details.classCount, 1);
  assert.ok(fixture.queries.every(sql => !/shs_selection_windows|pathway_code\s*=/.test(sql)));
  assert.equal(fixture.queries.some(sql => /INSERT INTO shs_elective_class_students/.test(sql)), false);
});

test('identical student choices while waiting do not create a revision, history, or activity', async () => {
  fixture = createDatabase();
  const student = { user: { id: 41, schoolId: 7 } };
  const first = await invoke(controller.submit, { ...student, body: { classIds: [101, 102] } });
  const queryStart = fixture.queries.length;
  const repeat = await invoke(controller.submit, { ...student, body: { classIds: [102, 101] } });

  assert.deepEqual(repeat, { id: first.id, status: 'pending', revision: 1, unchanged: true });
  assert.deepEqual(fixture.choices.get(first.id), [101, 102]);
  assert.deepEqual(fixture.history.map(item => item.action), ['submitted']);
  assert.deepEqual(fixture.audit.map(item => item.action), ['shs_selection_submitted']);
  assert.ok(fixture.queries.slice(queryStart).every(sql => !/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql)));
});

test('resubmitting unchanged choices after staff returns them creates a real revision and activity', async () => {
  fixture = createDatabase();
  const student = { user: { id: 41, schoolId: 7 } };
  const first = await invoke(controller.submit, { ...student, body: { classIds: [101] } });
  Object.assign(fixture.requests.get(first.id), { status: 'rejected', decision_reason: 'Please check your choices.' });

  const resubmitted = await invoke(controller.submit, { ...student, body: { classIds: [101] } });

  assert.deepEqual(resubmitted, { id: first.id, status: 'pending', revision: 2 });
  assert.deepEqual(fixture.choices.get(first.id), [101]);
  assert.deepEqual(fixture.history.map(item => item.action), ['submitted', 'revised']);
  assert.deepEqual(fixture.audit.map(item => item.action), ['shs_selection_submitted', 'shs_selection_revised']);
  assert.equal(fixture.audit[1].details.classCount, 1);
});

test('a learner can submit new choices after staff clears the confirmed record', async () => {
  fixture = createDatabase();
  fixture.requests.set(1, { id: 1, school_id: 7, academic_year_id: 20, grade_level_id: 11,
    student_user_id: 41, pathway_code: 'academic', status: 'not_recorded', revision: 3,
    decision_reason: null, reviewed_by_user_id: null, reviewed_at: null });
  fixture.choices.set(1, []);
  const result = await invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [102] } });
  assert.deepEqual(result, { id: 1, status: 'pending', revision: 4 });
  assert.deepEqual(fixture.choices.get(1), [102]);
  assert.equal(fixture.history[0].action, 'submitted');
  assert.equal(fixture.audit[0].action, 'shs_selection_submitted');
});

test('a learner can resubmit an empty pending record as a first submission', async () => {
  fixture = createDatabase();
  fixture.requests.set(1, { id: 1, school_id: 7, academic_year_id: 20, grade_level_id: 11,
    student_user_id: 41, pathway_code: 'academic', status: 'pending', revision: 4 });
  fixture.choices.set(1, []);
  const result = await invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [102] } });
  assert.deepEqual(result, { id: 1, status: 'pending', revision: 5 });
  assert.deepEqual(fixture.choices.get(1), [102]);
  assert.equal(fixture.history[0].action, 'submitted');
  assert.equal(fixture.audit[0].action, 'shs_selection_submitted');
});

test('student choices response includes the staff-assigned home section', async () => {
  fixture = createDatabase();
  const result = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(result.placement.sectionName, 'Grade 11 41');
  assert.equal(result.placement.trackCode, 'academic');
});

test('choice responses correct empty pending requests and retain linked paused classes', async () => {
  fixture = createDatabase();
  fixture.requests.set(8, { id: 8, school_id: 7, academic_year_id: 20, grade_level_id: 11,
    student_user_id: 41, pathway_code: 'academic', status: 'pending', revision: 2 });
  fixture.choices.set(8, []);
  const empty = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(empty.selection.status, 'not_recorded');
  assert.deepEqual(empty.selection.classIds, []);
  assert.deepEqual(empty.selection.savedClasses, []);
  assert.equal(empty.selection.dataIssue, false);
  fixture.requests.get(8).status = 'rejected';
  const rejectedEmpty = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(rejectedEmpty.selection.status, 'not_recorded');

  fixture.requests.get(8).status = 'approved';
  const approvedEmpty = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(approvedEmpty.selection.status, 'approved');
  assert.equal(approvedEmpty.selection.dataIssue, true);

  fixture.requests.get(8).status = 'pending';
  fixture.choices.set(8, [101]);
  fixture.classes[0].classActive = 0;
  fixture.classes[0].offeringActive = 0;
  const paused = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(paused.selection.status, 'pending');
  assert.equal(paused.selection.dataIssue, false);
  assert.equal(paused.selection.savedClasses.length, 1);
  assert.match(paused.selection.savedClasses[0].unavailableReason, /paused/);

  fixture.choices.set(8, [999]);
  const missing = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(missing.selection.dataIssue, true);
  assert.deepEqual(missing.selection.savedClasses, []);
});

test('student without an assigned SHS section receives a clear instruction and no choice data', async () => {
  fixture = createDatabase();
  await assert.rejects(invoke(controller.studentView, { user: { id: 43, schoolId: 7 } }),
    /School staff must assign you to an active Grade 11 or Grade 12 SHS section/);
});

test('staff can record a learner choice for review without creating membership', async () => {
  fixture = createDatabase();
  const result = await invoke(controller.recordStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '42' }, query: { academicYearId: '20' }, body: { classIds: [101] }
  });
  assert.deepEqual(result, { id: 1, status: 'pending', revision: 1 });
  assert.equal(fixture.requests.get(1).student_user_id, 42);
  assert.deepEqual(fixture.choices.get(1), [101]);
  assert.equal(fixture.history[0].actorId, 9);
  assert.equal(fixture.history[0].action, 'admin_recorded');
  assert.equal(fixture.audit[0].actorId, 9);
  assert.equal(fixture.audit[0].action, 'shs_selection_admin_recorded');
  assert.equal(fixture.audit[0].details.studentName, 'Student Two');
  assert.equal(fixture.audit[0].details.classCount, 1);
  assert.equal(fixture.queries.some(sql => /INSERT INTO shs_elective_class_students/.test(sql)), false);
});

test('student and staff cannot record Work Immersion for the other track', async () => {
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'academic' });
  const techproImmersion = getCatalogEntry('WI-320');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 103, className: 'TechPro immersion class', capacity: 20, classActive: 1,
    catalogVersion: techproImmersion.version, catalogCode: techproImmersion.code,
    trackCode: techproImmersion.trackCode, subjectName: techproImmersion.name,
    subjectType: techproImmersion.type, instructionalHours: techproImmersion.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });

  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [103] } }),
    /intended for the TechPro track/);
  await assert.rejects(invoke(controller.recordStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '41' }, query: { academicYearId: '20' }, body: { classIds: [103] }
  }), /intended for the TechPro track/);
  assert.equal(fixture.requests.size, 0);
  assert.equal(fixture.queries.some(sql => /INSERT INTO shs_selection_request_classes/.test(sql)), false);

  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'techpro' });
  const academicImmersion = getCatalogEntry('WI-ACADEMIC-320');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 104, className: 'Academic immersion class', capacity: 20, classActive: 1,
    catalogVersion: academicImmersion.version, catalogCode: academicImmersion.code,
    trackCode: academicImmersion.trackCode, subjectName: academicImmersion.name,
    subjectType: academicImmersion.type, instructionalHours: academicImmersion.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });
  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [104] } }),
    /intended for the Academic track/);
});

test('student and staff cannot record a Grade 12 catalog subject in Grade 11', async () => {
  fixture = createDatabase();
  const grade12Only = getCatalogEntry('AE039');
  fixture.classes.push({ id: 108, className: 'Grade 11 Creative Production', capacity: 20, classActive: 1,
    catalogVersion: grade12Only.version, catalogCode: grade12Only.code, trackCode: grade12Only.trackCode,
    subjectName: grade12Only.name, subjectType: grade12Only.type, instructionalHours: grade12Only.hours,
    gradeCode: 'grade-11', offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active',
    teacherRole: 'teacher', enrolledCount: 0 });

  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [108] } }),
    /no longer listed for this grade/);
  await assert.rejects(invoke(controller.recordStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '41' }, query: { academicYearId: '20' }, body: { classIds: [108] }
  }), /no longer listed for this grade/);
  assert.equal(fixture.requests.size, 0);
  assert.equal(fixture.queries.some(sql => /INSERT INTO shs_selection_request_classes/.test(sql)), false);
});

test('student and staff choice lists label and flag Work Immersion intended for the other track', async () => {
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'academic' });
  const entry = getCatalogEntry('WI-320');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 106, className: 'TechPro immersion class', capacity: 20, classActive: 1,
    catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
    subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });
  const studentData = await invoke(controller.studentView, { user: { id: 41, schoolId: 7 } });
  assert.equal(studentData.classes[0].catalogGroup, 'techpro_work_immersion');
  assert.match(studentData.classes[0].unavailableReason, /TechPro track students only/);
  const staffData = await invoke(controller.staffStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '41' }, query: { academicYearId: '20' }
  });
  assert.equal(staffData.classes[0].catalogGroup, 'techpro_work_immersion');
  assert.match(staffData.classes[0].unavailableReason, /TechPro track students only/);

  const request = { id: 1, school_id: 7, academic_year_id: 20, grade_level_id: 12, student_user_id: 41,
    pathway_code: 'academic', status: 'approved', revision: 1, decision_reason: null };
  fixture.requests.set(1, request);
  fixture.choices.set(1, [106]);
  const recorded = await invoke(controller.staffStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '41' }, query: { academicYearId: '20' }
  });
  assert.equal(recorded.selection.status, 'approved');
  assert.match(recorded.classes[0].unavailableReason, /TechPro track students only/,
    'an existing mismatched choice should be visible for staff review, not changed automatically');
});

test('annex-verified Work Immersion can be recorded for its intended track', async () => {
  for (const [trackCode, catalogCode, classId] of [
    ['techpro', 'WI-320', 105], ['academic', 'WI-ACADEMIC-320', 107]
  ]) {
    fixture = createDatabase();
    fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode });
    const entry = getCatalogEntry(catalogCode);
    fixture.classes.splice(0, fixture.classes.length, {
      id: classId, className: `${trackCode} immersion class`, capacity: 20, classActive: 1,
      catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
      subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-12',
      offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
    });
    const result = await invoke(controller.recordStudentChoices, {
      user: { id: 9, schoolId: 7 }, params: { studentId: '41' }, query: { academicYearId: '20' }, body: { classIds: [classId] }
    });
    assert.equal(result.status, 'pending');
    assert.equal(fixture.queries.some(sql => /INSERT INTO shs_selection_request_classes/.test(sql)), true);
  }
});

test('Grade 12 TechPro student and staff choices require exactly one offered Work Immersion class', async () => {
  const immersionRow = (id, code) => {
    const entry = getCatalogEntry(code);
    return { id, className: `Work Immersion ${code}`, capacity: 20, classActive: 1,
      catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
      subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-12',
      offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0 };
  };
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'techpro' });
  const techproElective = getCatalogEntry('TP-AF-01');
  fixture.classes.splice(0, fixture.classes.length, immersionRow(201, 'WI-320'), immersionRow(202, 'WI-540'), {
    id: 203, className: 'TechPro elective', capacity: 20, classActive: 1,
    catalogVersion: techproElective.version, catalogCode: techproElective.code,
    trackCode: techproElective.trackCode, subjectName: techproElective.name,
    subjectType: techproElective.type, instructionalHours: techproElective.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });

  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [203] } }),
    /include exactly one eligible TechPro Work Immersion class/);
  await assert.rejects(invoke(controller.recordStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '42' }, query: { academicYearId: '20' }, body: { classIds: [203] }
  }), /include exactly one eligible TechPro Work Immersion class/);
  await assert.rejects(invoke(controller.submit, {
    user: { id: 41, schoolId: 7 }, body: { classIds: [201, 202] }
  }), /include exactly one eligible TechPro Work Immersion class/);
  assert.equal(fixture.requests.size, 0);
  assert.deepEqual(fixture.history, []);
  assert.deepEqual(fixture.audit, []);

  const studentResult = await invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [201] } });
  assert.equal(studentResult.status, 'pending');
  assert.deepEqual(fixture.choices.get(studentResult.id), [201]);
  const staffResult = await invoke(controller.recordStudentChoices, {
    user: { id: 9, schoolId: 7 }, params: { studentId: '42' }, query: { academicYearId: '20' }, body: { classIds: [202] }
  });
  assert.equal(staffResult.status, 'pending');
  assert.deepEqual(fixture.choices.get(staffResult.id), [202]);
});

test('an unchanged Grade 12 TechPro request is rechecked against the Work Immersion requirement', async () => {
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'techpro' });
  const request = { id: 9, school_id: 7, academic_year_id: 20, grade_level_id: 12, student_user_id: 41,
    pathway_code: 'techpro', status: 'pending', revision: 3, decision_reason: null };
  fixture.requests.set(9, request);
  fixture.choices.set(9, [101]);
  const entry = getCatalogEntry('FE-DESIGN-INNOVATION');
  Object.assign(fixture.classes[0], { gradeCode: 'grade-12', catalogVersion: entry.version,
    catalogCode: entry.code, trackCode: entry.trackCode, subjectName: entry.name,
    subjectType: entry.type, instructionalHours: entry.hours });
  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [101] } }),
    /no eligible class is offered/);
  assert.equal(fixture.requests.get(9).revision, 3);
  assert.deepEqual(fixture.choices.get(9), [101]);
  assert.deepEqual(fixture.history, []);
  assert.deepEqual(fixture.audit, []);
});

test('Grade 12 TechPro reports when the school has not offered an eligible immersion class', async () => {
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'techpro' });
  const techproElective = getCatalogEntry('TP-AF-01');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 205, className: 'TechPro elective', capacity: 20, classActive: 1,
    catalogVersion: techproElective.version, catalogCode: techproElective.code,
    trackCode: techproElective.trackCode, subjectName: techproElective.name,
    subjectType: techproElective.type, instructionalHours: techproElective.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });
  await assert.rejects(invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [205] } }),
    /no eligible class is offered.*ask school staff to add one/i);
  assert.equal(fixture.requests.size, 0);
  assert.deepEqual(fixture.history, []);
});

test('Grade 12 Academic Field Experience and Grade 11 TechPro choices do not require Work Immersion', async () => {
  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 12, gradeCode: 'grade-12', trackCode: 'academic' });
  const fieldExperience = getCatalogEntry('FE-DESIGN-INNOVATION');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 203, className: 'Design and Innovation', capacity: 20, classActive: 1,
    catalogVersion: fieldExperience.version, catalogCode: fieldExperience.code,
    trackCode: fieldExperience.trackCode, subjectName: fieldExperience.name,
    subjectType: fieldExperience.type, instructionalHours: fieldExperience.hours, gradeCode: 'grade-12',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });
  const academic = await invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [203] } });
  assert.equal(academic.status, 'pending');

  fixture = createDatabase();
  fixture.setPlacement({ gradeId: 11, gradeCode: 'grade-11', trackCode: 'techpro' });
  const techpro = getCatalogEntry('TP-AF-01');
  fixture.classes.splice(0, fixture.classes.length, {
    id: 204, className: 'Agricultural Crops Production', capacity: 20, classActive: 1,
    catalogVersion: techpro.version, catalogCode: techpro.code, trackCode: techpro.trackCode,
    subjectName: techpro.name, subjectType: techpro.type, instructionalHours: techpro.hours, gradeCode: 'grade-11',
    offeringActive: 1, teacherName: 'Active Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0
  });
  const grade11 = await invoke(controller.submit, { user: { id: 41, schoolId: 7 }, body: { classIds: [204] } });
  assert.equal(grade11.status, 'pending');
});

test('staff roster includes learners without a choice record, uses friendly statuses, and stays at 25 per page', async () => {
  fixture = createDatabase();
  fixture.database.execute = async (sql, args) => {
    if (sql.includes('SELECT id, label, status FROM academic_years')) return [[{ id: 20, label: '2027-2028', status: 'active' }], []];
    if (sql.includes('SELECT COUNT(DISTINCT u.id) AS total')) return [[{ total: 2 }], []];
    if (sql.includes('LIMIT ? OFFSET ?')) {
      assert.deepEqual(args.slice(-2), [25, 0]);
      return [[
        { studentId: 41, studentName: 'No Choice Yet', sectionId: 141, sectionName: 'Grade 11 A',
          gradeId: 11, gradeCode: 'grade-11', trackCode: 'academic', requestId: null, requestStatus: null, revision: null, note: null },
        { studentId: 42, studentName: 'Waiting Learner', sectionId: 142, sectionName: 'Grade 11 B',
          gradeId: 11, gradeCode: 'grade-11', trackCode: 'techpro', requestId: 1, requestStatus: 'pending', revision: 2, note: null }
      ], []];
    }
    throw new Error(`Unexpected roster SQL: ${sql}`);
  };
  const result = await invoke(controller.adminList, { user: { id: 9, schoolId: 7 }, query: { academicYearId: '20', pageSize: '50' } });
  assert.equal(result.total, 2);
  assert.equal(result.pageSize, 25);
  assert.equal(result.students[0].status, 'not_recorded');
  assert.equal(result.students[1].status, 'pending');
  assert.equal(result.students[0].sectionName, 'Grade 11 A');
});

test('staff roster search and filters work on a later page with more than 100 learners', async () => {
  fixture = createDatabase();
  const rosterSql = [];
  fixture.database.execute = async (sql, args) => {
    if (sql.includes('SELECT id, label, status FROM academic_years')) return [[{ id: 20, label: '2027-2028', status: 'active' }], []];
    if (sql.includes('SELECT COUNT(DISTINCT u.id) AS total')) { rosterSql.push(sql); return [[{ total: 126 }], []]; }
    if (sql.includes('LIMIT ? OFFSET ?')) {
      rosterSql.push(sql);
      assert.deepEqual(args.slice(-2), [25, 100]);
      return [[{ studentId: 126, studentName: 'Maya Santos', sectionId: 126, sectionName: 'Grade 11 A',
        gradeId: 11, gradeCode: 'grade-11', trackCode: 'academic', requestId: 18,
        requestStatus: 'pending', revision: 1, note: null }], []];
    }
    throw new Error(`Unexpected roster SQL: ${sql}`);
  };
  const result = await invoke(controller.adminList, { user: { id: 9, schoolId: 7 }, query: {
    academicYearId: '20', page: '5', pageSize: '50', search: 'Maya', grade: 'grade-11', status: 'pending'
  } });
  assert.equal(result.total, 126);
  assert.equal(result.page, 5);
  assert.equal(result.pageSize, 25);
  assert.equal(result.pages, 6);
  assert.equal(result.students[0].studentName, 'Maya Santos');
  assert.ok(rosterSql.every(sql => sql.includes('u.display_name LIKE ?') && sql.includes("g.grade_code = ?") && sql.includes("r.status = ?")));
  assert.ok(rosterSql.every(sql => sql.includes('shs_selection_request_classes')));
  assert.ok(rosterSql.some(sql => sql.includes('NOT EXISTS (SELECT 1 FROM shs_selection_request_classes')));
});

test('Not recorded filter includes learners with no request and cleared requests', async () => {
  fixture = createDatabase();
  fixture.database.execute = async (sql) => {
    if (sql.includes('SELECT id, label, status FROM academic_years')) return [[{ id: 20, label: '2027-2028', status: 'active' }], []];
    if (sql.includes('SELECT COUNT(DISTINCT u.id) AS total')) {
      assert.match(sql, /r\.id IS NULL OR r\.status = 'not_recorded'/);
      assert.match(sql, /r\.status IN \('pending', 'rejected'\)/);
      assert.match(sql, /NOT EXISTS \(SELECT 1 FROM shs_selection_request_classes/);
      return [[{ total: 2 }], []];
    }
    if (sql.includes('LIMIT ? OFFSET ?')) return [[
      { studentId: 41, studentName: 'No request', gradeCode: 'grade-11', requestId: null, requestStatus: null },
      { studentId: 42, studentName: 'Cleared', gradeCode: 'grade-11', requestId: 1, requestStatus: 'not_recorded' }
    ], []];
    throw new Error(`Unexpected roster SQL: ${sql}`);
  };
  const result = await invoke(controller.adminList, { user: { id: 9, schoolId: 7 },
    query: { academicYearId: '20', status: 'not_recorded' } });
  assert.deepEqual(result.students.map(item => item.status), ['not_recorded', 'not_recorded']);
});

test('staff roster marks confirmed requests with no choice links for review', async () => {
  fixture = createDatabase();
  let rosterQuery = '';
  fixture.database.execute = async sql => {
    if (sql.includes('SELECT id, label, status FROM academic_years')) return [[{ id: 20, label: '2027-2028', status: 'active' }], []];
    if (sql.includes('SELECT COUNT(DISTINCT u.id) AS total')) return [[{ total: 1 }], []];
    if (sql.includes('LIMIT ? OFFSET ?')) {
      rosterQuery = sql;
      return [[{ studentId: 41, studentName: 'Confirmed Learner', sectionName: 'Grade 11 A', gradeCode: 'grade-11',
        trackCode: 'academic', requestId: 1, requestStatus: 'approved', dataIssue: 1, revision: 2 }], []];
    }
    throw new Error(`Unexpected roster SQL: ${sql}`);
  };
  const result = await invoke(controller.adminList, { user: { id: 9, schoolId: 7 },
    query: { academicYearId: '20', status: 'approved' } });
  assert.equal(result.students[0].status, 'approved');
  assert.equal(result.students[0].dataIssue, true);
  assert.match(rosterQuery, /CASE WHEN r\.status = 'approved' AND NOT EXISTS/);
});
