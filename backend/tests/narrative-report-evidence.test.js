const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let activeDatabase;
databaseModule.getDatabase = () => activeDatabase;
const {
  addDays, getWeeklyEvidence, getWeeklySettings, normalizeWeekSettings,
  reportWeekRange, reportSubmissionStatus, updateWeeklySettings
} = require('../controllers/narrativeReportEvidenceController');
const { currentReportWeekRange } = require('../utils/reportWeekSettings');
const { buildModelEvidence } = require('../services/narrativeReportAi');

test('assignment completion respects the evidence cutoff and later status changes', () => {
  const dueDate = '2026-10-20';
  const base = { dueDate, onlineSubmissionEnabled: 1, submissionId: 4,
    savedStatus: 'submitted', filePath: '/private/example', submittedAt: '2026-10-23T09:00:00',
    statusUpdatedAt: '2026-10-23T09:00:00' };
  assert.equal(reportSubmissionStatus(base, '2026-10-22'), 'pending');
  assert.equal(reportSubmissionStatus(base, '2026-10-23'), 'submitted');
  assert.equal(reportSubmissionStatus({ ...base, onlineSubmissionEnabled: 0, filePath: null,
    submittedAt: null, statusUpdatedAt: '2026-10-21T09:00:00' }, '2026-10-22'), 'submitted');
  assert.equal(reportSubmissionStatus({ ...base, onlineSubmissionEnabled: 0, filePath: null,
    submittedAt: null }, '2026-10-22'), 'pending');
  assert.equal(reportSubmissionStatus({ ...base, submissionId: null, savedStatus: null,
    filePath: null, submittedAt: null }, '2026-10-22'), 'not_submitted');
});

function dateInSchoolZone() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfCurrentMondayWeek() {
  const today = dateInSchoolZone();
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay() || 7;
  return addDays(today, -((weekday - 1 + 7) % 7));
}

function invoke(handler, req, database) {
  activeDatabase = database;
  const result = { headers: {} };
  return handler(req, {
    set(name, value) { result.headers[name] = value; return this; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; }).then(() => result).finally(() => {
    activeDatabase = null;
  });
}

test('report week settings validate weekdays and support a week that crosses Sunday', () => {
  assert.deepEqual(normalizeWeekSettings({ weekStartDay: '5', weekEndDay: '2' }), {
    weekStartDay: 5, weekEndDay: 2
  });
  assert.deepEqual(reportWeekRange('2026-10-23', { weekStartDay: 5, weekEndDay: 2 }), {
    startDate: '2026-10-23', endDate: '2026-10-27'
  });
  assert.throws(() => normalizeWeekSettings({ weekStartDay: 1, weekEndDay: 1 }), /must be different/);
  assert.throws(() => normalizeWeekSettings({ weekStartDay: 0, weekEndDay: 6 }), /weekday from 1 to 7/);
  assert.throws(() => normalizeWeekSettings({ weekStartDay: [1], weekEndDay: 6 }), /weekday from 1 to 7/);
  assert.throws(() => normalizeWeekSettings({ weekStartDay: 1, weekEndDay: 6, extra: true }), /start and end weekdays/);
  assert.throws(() => reportWeekRange('2026-10-20', { weekStartDay: 1, weekEndDay: 6 }), /must start on Monday/);
});

test('current report week uses configured weekdays across week and year boundaries', () => {
  assert.deepEqual(currentReportWeekRange({ weekStartDay: 1, weekEndDay: 6 }, '2026-10-30'), {
    startDate: '2026-10-26', endDate: '2026-10-31'
  });
  assert.deepEqual(currentReportWeekRange({ weekStartDay: 5, weekEndDay: 2 }, '2027-01-03'), {
    startDate: '2027-01-01', endDate: '2027-01-05'
  });
  assert.deepEqual(currentReportWeekRange({ weekStartDay: 1, weekEndDay: 6 }, '2027-01-01'), {
    startDate: '2026-12-28', endDate: '2027-01-02'
  });
});

test('weekly evidence keeps the configured week and stops at today or the week end', async () => {
  const today = dateInSchoolZone();
  const weekStart = startOfCurrentMondayWeek();
  const weekEnd = addDays(weekStart, 5);
  const calls = [];
  const database = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM sections')) return [[{
        sectionId: 22, sectionName: 'St. Matthew', academicYearId: 9, schoolLevelId: 3,
        gradeLevelId: 7, academicYearStartDate: addDays(weekStart, -180),
        academicYearEndDate: addDays(weekEnd, 100), academicYearLabel: '2026-2027',
        gradeLevelName: 'Grade 7', schoolLevelCode: 'jhs', reportsEnabled: 1, journalSubjectId: null,
        journalsEnabled: 0, weekStartDay: 1, weekEndDay: 6
      }]];
      if (sql.includes('FROM section_students')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await invoke(getWeeklyEvidence, {
    user: { id: 8, schoolId: 4, role: 'teacher' },
    query: { sectionId: '22', startDate: weekStart }
  }, database);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.reportWeek, {
    startDate: weekStart, endDate: weekEnd,
    dataThroughDate: today < weekEnd ? today : weekEnd
  });

  const futureWeek = await invoke(getWeeklyEvidence, {
    user: { id: 8, schoolId: 4, role: 'teacher' },
    query: { sectionId: '22', startDate: addDays(weekStart, 7) }
  }, database);
  assert.equal(futureWeek.error?.status, 400);
  assert.match(futureWeek.error?.message, /cannot start in the future/);
});

test('weekly settings endpoint returns the Monday-Saturday defaults when no row is present', async () => {
  const result = await invoke(getWeeklySettings, { user: { schoolId: 4 } }, {
    async execute(sql) {
      if (/narrative_report_week_start_day/.test(sql)) return [[]];
      assert.match(sql, /ai_evidence_approved_at/);
      return [[]];
    }
  });
  assert.deepEqual(result.body.settings, { weekStartDay: 1, weekEndDay: 6 });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.reportsEnabled, false);
  assert.equal(result.body.generationEnabled, false);
});

test('weekly generation status requires Reports, school approval, and the server switch', async () => {
  const previous = process.env.AI_REPORTS_GENERATION_ENABLED;
  try {
    for (const serverEnabled of [false, true]) {
      process.env.AI_REPORTS_GENERATION_ENABLED = String(serverEnabled);
      for (const reportsEnabled of [false, true]) {
        for (const approved of [false, true]) {
          const result = await invoke(getWeeklySettings, { user: { schoolId: 4 } }, {
            async execute(sql) {
              if (sql.includes('FROM school_settings')) return [[{ weekStartDay: 1, weekEndDay: 6 }]];
              assert.match(sql, /narrative_reports_enabled AS reportsEnabled/);
              return [[{ reportsEnabled: Number(reportsEnabled), approvedAt: approved ? '2026-10-22 08:00:00' : null }]];
            }
          });
          assert.equal(result.error, undefined);
          assert.equal(result.body.reportsEnabled, reportsEnabled);
          assert.equal(result.body.aiEvidenceApproved, approved);
          assert.equal(result.body.generationSwitchEnabled, serverEnabled);
          assert.equal(result.body.generationEnabled, serverEnabled && reportsEnabled && approved);
        }
      }
    }
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_GENERATION_ENABLED;
    else process.env.AI_REPORTS_GENERATION_ENABLED = previous;
  }
});

test('weekly settings update persists values and writes an audit record', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async execute(sql, values) { calls.push({ sql, values }); return [{ affectedRows: 1 }]; },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); }
  };
  const result = await invoke(updateWeeklySettings, {
    user: { id: 8, schoolId: 4, role: 'school_admin' },
    body: { weekStartDay: 2, weekEndDay: 7 }
  }, { getConnection: async () => connection });
  assert.deepEqual(result.body.settings, { weekStartDay: 2, weekEndDay: 7 });
  assert.ok(calls.some(call => typeof call === 'object' && /INSERT INTO school_settings/.test(call.sql)));
  assert.ok(calls.some(call => typeof call === 'object' && /INSERT INTO audit_logs/.test(call.sql)));
  assert.ok(calls.includes('COMMIT'));
  assert.ok(calls.includes('RELEASE'));
});

test('weekly evidence denies a teacher who is not the section adviser before reading student data', async () => {
  const calls = [];
  const result = await invoke(getWeeklyEvidence, {
    user: { id: 8, schoolId: 4, role: 'teacher' },
    query: { sectionId: '22', startDate: startOfCurrentMondayWeek() }
  }, {
    async execute(sql, values) { calls.push({ sql, values }); return [[]]; }
  });
  assert.equal(result.error?.status, 404);
  assert.match(result.error?.message, /Advisory section not found/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /sections\.adviser_user_id = \?/);
  assert.match(calls[0].sql, /sections\.school_id = \?/);
  assert.deepEqual(calls[0].values, [22, 4, 8]);
});

test('weekly evidence summarizes confirmed attendance, assignments, journal text, and at-risk academic context', async () => {
  const weekStart = addDays(startOfCurrentMondayWeek(), -7);
  const today = dateInSchoolZone();
  const weekEnd = addDays(weekStart, 5);
  const dataThrough = [weekEnd, today].sort()[0];
  const evidenceDate = addDays(weekStart, 1) <= dataThrough ? addDays(weekStart, 1) : weekStart;
  const calls = [];
  const database = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM sections')) return [[{
        sectionId: 22, sectionName: 'St. Matthew', academicYearId: 9, schoolLevelId: 3,
        gradeLevelId: 7, academicYearStartDate: addDays(weekStart, -180),
        academicYearEndDate: addDays(weekEnd, 100), academicYearLabel: '2026-2027',
        gradeLevelName: 'Grade 7', schoolLevelCode: 'jhs', reportsEnabled: 1, journalSubjectId: 55,
        journalsEnabled: 1, weekStartDay: 1, weekEndDay: 6
      }]];
      if (sql.includes('FROM section_students')) return [[
        { studentId: 101, displayName: 'Ari Student', initials: 'AS', avatarFilename: '11111111-1111-4111-8111-111111111111.webp', avatarVersion: 7, enrolledDate: addDays(weekStart, -30), withdrawnDate: null },
        { studentId: 102, displayName: 'Bea Student', initials: 'BS', avatarFilename: null, avatarVersion: null, enrolledDate: addDays(weekStart, -30), withdrawnDate: null }
      ]];
      if (sql.includes('LEFT JOIN attendance_records AS records')) return [[
        { sessionId: 201, attendanceDate: evidenceDate, subjectId: 11, subjectName: 'English', recordId: 301, studentId: 101, attendanceStatus: 'present' },
        { sessionId: 201, attendanceDate: evidenceDate, subjectId: 11, subjectName: 'English', recordId: 302, studentId: 102, attendanceStatus: 'absent' },
        { sessionId: 202, attendanceDate: evidenceDate, subjectId: 12, subjectName: 'Math', recordId: null, studentId: null, attendanceStatus: null }
      ]];
      if (sql.includes('FROM assignments')) return [[
        { assignmentId: 401, title: 'Reading response', subjectId: 11, subjectName: 'English', onlineSubmissionEnabled: 1, dueDate: evidenceDate, studentId: 101, submissionId: 501, savedStatus: 'submitted', filePath: '/uploads/response.pdf', submittedAt: `${evidenceDate}T08:00:00` },
        { assignmentId: 402, title: 'Class presentation', subjectId: 12, subjectName: 'Math', onlineSubmissionEnabled: 0, dueDate: evidenceDate, studentId: 101, submissionId: 502, savedStatus: 'submitted', filePath: null, submittedAt: `${evidenceDate}T08:00:00` },
        { assignmentId: 401, title: 'Reading response', subjectId: 11, subjectName: 'English', onlineSubmissionEnabled: 1, dueDate: dataThrough, studentId: 102, submissionId: null, savedStatus: null, filePath: null, submittedAt: null }
      ]];
      if (sql.includes('FROM student_journal_entries AS entries')) return [[{
        entryId: 601, studentId: 101, subjectName: 'Values Education', promptText: 'Reflect on teamwork.',
        entryText: 'I helped my group finish our activity.', entryStatus: 'reviewed', submittedAt: `${evidenceDate}T09:00:00`
      }]];
      if (sql.includes('FROM attendance_sessions AS sessions') && sql.includes('INNER JOIN attendance_records')) return [[
        { studentId: 102, sessionId: 201, sectionId: 22, subjectId: 11, date: evidenceDate, status: 'absent', subjectName: 'English' }
      ]];
      if (sql.includes('FROM published_final_grades AS grades')) return [[{
        gradeId: 701, studentId: 102, subjectId: 13, subjectName: 'Mathematics', finalGrade: 70,
        publishedAt: `${evidenceDate}T10:00:00`, termSequence: 1, termName: 'Term 1',
        levelCode: 'jhs', schoolLevelId: 3, levelPassingGradeThreshold: 75, gradeCode: 'grade-7'
      }, {
        gradeId: 702, studentId: 101, subjectId: 11, subjectName: 'English', finalGrade: 85,
        publishedAt: `${evidenceDate}T11:00:00`, termSequence: 1, termName: 'Term 1',
        levelCode: 'jhs', schoolLevelId: 3, levelPassingGradeThreshold: 75, gradeCode: 'grade-7'
      }]];
      if (sql.includes('FROM student_scores AS scores')) return [Array.from({ length: 22 }, (_, index) => ({
        scoreId: 901 + index, studentId: 101, itemId: 801 + index, subjectId: 11, subjectName: 'English',
        title: `Reading check ${index + 1}`, maxScore: 10, score: 9, itemDate: evidenceDate
      }))];
      if (sql.includes('FROM school_attendance_settings')) return [[{
        maxUnexcusedAbsences: 99, consecutiveAbsencesAlert: 99, countExcusedAbsences: 0
      }]];
      if (sql.includes('FROM school_year_final_grade_rules')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await invoke(getWeeklyEvidence, {
    user: { id: 8, schoolId: 4, role: 'teacher' },
    query: { sectionId: '22', startDate: weekStart }
  }, database);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.reportWeek, { startDate: weekStart, endDate: weekEnd, dataThroughDate: dataThrough });
  const ari = result.body.students.find(student => student.id === '101');
  const bea = result.body.students.find(student => student.id === '102');
  assert.equal(ari.attendance.present, 1);
  assert.equal(ari.attendance.unmarkedSessions, 1);
  assert.ok(ari.attendance.sources.some(source => source.recordId === null && source.status === null));
  assert.equal(ari.assignments.total, 2);
  assert.equal(ari.assignments.submitted, 2);
  assert.equal(ari.journal.entries[0].entryText, 'I helped my group finish our activity.');
  assert.equal(ari.followUpCandidate, false);
  assert.equal(ari.academicRecords.length, 1);
  assert.equal(ari.academicScores.length, 20);
  assert.equal(ari.academicScoresOmitted, 2);
  assert.equal(ari.academicScores[0].score, 9);
  assert.equal(ari.hasAvatar, true);
  assert.equal(ari.avatarUrl, '/api/users/101/avatar?v=7');
  assert.equal(ari.avatarVersion, 7);
  assert.equal(Object.hasOwn(ari, 'avatarFilename'), false);
  assert.equal(bea.attendance.absent, 1);
  assert.equal(bea.attendance.unmarkedSessions, 1);
  assert.equal(bea.assignments.pending, 1);
  assert.equal(bea.followUpCandidate, true);
  assert.equal(bea.hasAvatar, false);
  assert.equal(bea.avatarUrl, null);
  assert.equal(Object.hasOwn(bea, 'avatarFilename'), false);
  assert.equal(bea.candidateReasons[0].type, 'grade');
  assert.equal(bea.academicRecords[0].finalGrade, 70);
  assert.ok(calls.some(call => call.sql.includes('entries.entry_text AS entryText')));
  const rosterQuery = calls.find(call => call.sql.includes('FROM section_students'));
  assert.match(rosterQuery.sql, /students\.avatar_filename AS avatarFilename/);
  assert.match(rosterQuery.sql, /students\.avatar_version AS avatarVersion/);
  assert.ok(calls.every(call => call.values.includes(4)), 'every evidence query is scoped to the adviser school');
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('SHS weekly evidence includes placed classes and only meaningful attendance remarks', async () => {
  const previousFlag = process.env.SHS_SELECTION_ENABLED;
  process.env.SHS_SELECTION_ENABLED = 'true';
  const weekStart = addDays(startOfCurrentMondayWeek(), -7);
  const weekEnd = addDays(weekStart, 5);
  const date = addDays(weekStart, 1);
  const calls = [];
  const database = { async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM sections')) return [[{
      sectionId: 22, sectionName: 'Grade 11 A', academicYearId: 9, schoolLevelId: 3,
      gradeLevelId: 7, academicYearStartDate: addDays(weekStart, -100),
      academicYearEndDate: addDays(weekEnd, 100), academicYearLabel: '2026-2027',
      gradeLevelName: 'Grade 11', schoolLevelCode: 'shs', reportsEnabled: 1,
      journalsEnabled: 0, weekStartDay: 1, weekEndDay: 6
    }]];
    if (sql.includes('FROM section_students')) return [[
      { studentId: 101, displayName: 'Ari Student', enrolledDate: addDays(weekStart, -20), withdrawnDate: null },
      { studentId: 102, displayName: 'Bea Student', enrolledDate: addDays(weekStart, -20), withdrawnDate: null }
    ]];
    if (sql.includes('LEFT JOIN attendance_records AS records')) return [[{
      sessionId: 201, attendanceDate: date, subjectId: 11, subjectName: 'Core English',
      recordId: 301, studentId: 101, attendanceStatus: 'late', remarks: 'Bus broke down'
    }]];
    if (sql.includes('FROM attendance_records AS records') && sql.includes('shs_elective_classes')) return [[
      { recordId: 302, studentId: 101, sessionId: 202, date, electiveClassId: 88,
        subjectName: 'Creative Writing', className: 'Class A', status: 'absent', remark: 'Family appointment' },
      { recordId: 303, studentId: 101, sessionId: 203, date, electiveClassId: 89,
        subjectName: 'Field Experience', className: 'Class B', status: 'present', remark: 'Ignore this' },
      { recordId: 304, studentId: 101, sessionId: 204, date, electiveClassId: 90,
        subjectName: 'Work Immersion', className: 'Class C', status: 'excused', remark: 'Approved appointment' },
      { recordId: 305, studentId: 999, sessionId: 205, date, electiveClassId: 91,
        subjectName: 'Work Immersion', className: 'Other class', status: 'absent', remark: 'Other learner' }
    ]];
    if (sql.includes('FROM assignments') && sql.includes('shs_elective_classes')) return [[{
      assignmentId: 401, studentId: 101, electiveClassId: 88,
      subjectName: 'Creative Writing', className: 'Class A', title: 'Essay',
      onlineSubmissionEnabled: 0, dueDate: date, submissionId: null, savedStatus: null
    }]];
    if (sql.includes('FROM assignments')) return [[]];
    if (sql.includes('FROM attendance_sessions AS sessions') && sql.includes('INNER JOIN attendance_records')) return [[]];
    if (sql.includes('FROM published_final_grades AS grades') && sql.includes('shs_elective_classes')) return [[
      { gradeId: 501, studentId: 101, electiveClassId: 88, subjectName: 'Creative Writing', className: 'Class A',
        finalGrade: 85, publishedAt: `${date}T10:00:00`, termSequence: 1, termName: 'Term 1',
        levelCode: 'shs', schoolLevelId: 3, levelPassingGradeThreshold: 75, gradeCode: 'grade-11' },
      { gradeId: 502, studentId: 101, electiveClassId: 89, subjectName: 'Field Experience', className: 'Class B',
        finalGrade: 90, publishedAt: `${date}T11:00:00`, termSequence: 1, termName: 'Term 1',
        levelCode: 'shs', schoolLevelId: 3, levelPassingGradeThreshold: 75, gradeCode: 'grade-11' },
      { gradeId: 503, studentId: 101, electiveClassId: 90, subjectName: 'Work Immersion', className: 'Class C',
        finalGrade: 88, publishedAt: `${date}T12:00:00`, termSequence: 1, termName: 'Term 1',
        levelCode: 'shs', schoolLevelId: 3, levelPassingGradeThreshold: 75, gradeCode: 'grade-11' }
    ]];
    if (sql.includes('FROM published_final_grades AS grades')) return [[]];
    if (sql.includes('FROM student_scores AS scores') && sql.includes('shs_elective_classes')) return [[
      { scoreId: 601, studentId: 101, itemId: 701, electiveClassId: 88, subjectName: 'Creative Writing',
        className: 'Class A', title: 'Essay', maxScore: 10, score: 6, itemDate: date },
      { scoreId: 602, studentId: 101, itemId: 702, electiveClassId: 89, subjectName: 'Field Experience',
        className: 'Class B', title: 'Reading', maxScore: 10, score: 6, itemDate: date },
      { scoreId: 603, studentId: 101, itemId: 703, electiveClassId: 90, subjectName: 'Work Immersion',
        className: 'Class C', title: 'Journal', maxScore: 10, score: 6, itemDate: date }
    ]];
    if (sql.includes('FROM student_scores AS scores')) return [[]];
    if (sql.includes('FROM school_attendance_settings')) return [[{
      maxUnexcusedAbsences: 99, consecutiveAbsencesAlert: 99, countExcusedAbsences: 0
    }]];
    if (sql.includes('FROM school_year_final_grade_rules')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  try {
    const result = await invoke(getWeeklyEvidence, {
      user: { id: 8, schoolId: 4, role: 'teacher' },
      query: { sectionId: '22', startDate: weekStart }
    }, database);
    assert.equal(result.error, undefined);
    const ari = result.body.students.find(student => student.id === '101');
    const bea = result.body.students.find(student => student.id === '102');
    assert.equal(ari.attendance.recordedSessions, 4);
    assert.equal(ari.attendance.absent, 1);
    assert.equal(ari.attendance.excused, 1);
    assert.equal(ari.attendance.sources.find(source => source.recordId === '302').remark, 'Family appointment');
    assert.equal(ari.attendance.sources.find(source => source.recordId === '303').remark, null);
    assert.equal(ari.assignments.total, 1);
    assert.equal(ari.academicRecords.length, 3);
    assert.deepEqual(ari.academicRecords.map(item => item.electiveClassId), ['88', '89', '90']);
    assert.equal(ari.academicScores.length, 3);
    assert.equal(ari.followUpCandidate, false, 'low scores in separate classes must not merge');
    assert.equal(bea.attendance.recordedSessions, 0);
    assert.equal(bea.assignments.total, 0);
    const aiEvidence = buildModelEvidence(ari, result.body.reportWeek, null);
    assert.equal(aiEvidence.attendance.remarks.length, 3);
    assert.match(aiEvidence.academicRecords[0].subject, /Class A/);
    assert.ok(calls.some(call => call.sql.includes('FROM published_final_grades AS grades')
      && call.sql.includes('shs_elective_classes') && call.sql.includes('DATE(grades.published_at) BETWEEN ? AND ?')
      && call.values.includes(weekStart) && call.values.includes(weekEnd)));
    assert.ok(calls.filter(call => call.sql.includes('shs_elective_classes')).every(call =>
      call.values.includes(9) && call.values.includes(4)));
  } finally {
    if (previousFlag === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = previousFlag;
  }
});

test('journal evidence is collected only for configured JHS sections', async () => {
  const weekStart = addDays(startOfCurrentMondayWeek(), -7);
  const weekEnd = addDays(weekStart, 5);
  for (const scenario of [
    { level: 'elementary', journalsEnabled: 1, journalSubjectId: 55, expected: false },
    { level: 'shs', journalsEnabled: 1, journalSubjectId: 55, expected: false },
    { level: 'jhs', journalsEnabled: 0, journalSubjectId: 55, expected: false },
    { level: 'jhs', journalsEnabled: 1, journalSubjectId: null, expected: false },
    { level: 'jhs', journalsEnabled: 1, journalSubjectId: 55, expected: true }
  ]) {
    const calls = [];
    const database = { async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM sections')) return [[{
        sectionId: 22, sectionName: 'St. Matthew', academicYearId: 9, schoolLevelId: 3,
        schoolLevelCode: scenario.level, gradeLevelId: 7,
        academicYearStartDate: addDays(weekStart, -180), academicYearEndDate: addDays(weekEnd, 100),
        academicYearLabel: '2026-2027', gradeLevelName: 'Grade 7', reportsEnabled: 1,
        journalSubjectId: scenario.journalSubjectId, journalsEnabled: scenario.journalsEnabled,
        weekStartDay: 1, weekEndDay: 6
      }]];
      if (sql.includes('FROM section_students')) return [[{
        studentId: 101, displayName: 'Ari Student', initials: 'AS',
        enrolledDate: addDays(weekStart, -30), withdrawnDate: null
      }]];
      if (sql.includes('FROM student_journal_entries AS entries')) return [[{
        entryId: 601, studentId: 101, subjectName: 'Values Education', promptText: 'Reflect on teamwork.',
        entryText: 'I helped my group.', entryStatus: 'submitted', submittedAt: `${weekStart}T09:00:00`
      }]];
      return [[]];
    } };
    const result = await invoke(getWeeklyEvidence, {
      user: { id: 8, schoolId: 4, role: 'teacher' },
      query: { sectionId: '22', startDate: weekStart }
    }, database);
    assert.equal(result.error, undefined, scenario.level);
    assert.equal(result.body.section.journalApplicable, scenario.expected, scenario.level);
    assert.equal(calls.some(call => call.sql.includes('FROM student_journal_entries AS entries')),
      scenario.expected, scenario.level);
    assert.equal(result.body.students[0].journal.entries.length, scenario.expected ? 1 : 0, scenario.level);
    if (scenario.expected) {
      const journalQuery = calls.find(call => call.sql.includes('FROM student_journal_entries AS entries'));
      assert.match(journalQuery.sql, /subjects\.is_active = TRUE/);
    }
  }
});

test('weekly evidence respects enrollment dates for transferred learners and does not treat missing history as a risk', async () => {
  const weekStart = addDays(startOfCurrentMondayWeek(), -7);
  const weekEnd = addDays(weekStart, 5);
  const beforeEnrollment = addDays(weekStart, 1);
  const enrolledDate = addDays(weekStart, 2);
  const afterWithdrawal = addDays(weekStart, 4);
  const calls = [];
  const database = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM sections')) return [[{
        sectionId: 22, sectionName: 'St. Matthew', academicYearId: 9, schoolLevelId: 3,
        gradeLevelId: 7, academicYearStartDate: addDays(weekStart, -180),
        academicYearEndDate: addDays(weekEnd, 100), academicYearLabel: '2026-2027',
        gradeLevelName: 'Grade 7', schoolLevelCode: 'jhs', reportsEnabled: 1, journalSubjectId: 55,
        journalsEnabled: 1, weekStartDay: 1, weekEndDay: 6
      }]];
      if (sql.includes('FROM section_students')) return [[{
        studentId: 103, displayName: 'Casey Transfer', initials: 'CT',
        enrolledDate, withdrawnDate: addDays(enrolledDate, 1)
      }]];
      if (sql.includes('LEFT JOIN attendance_records AS records')) return [[
        { sessionId: 801, attendanceDate: beforeEnrollment, subjectId: 11, subjectName: 'English', recordId: 811, studentId: 103, attendanceStatus: 'absent' },
        { sessionId: 802, attendanceDate: enrolledDate, subjectId: 11, subjectName: 'English', recordId: 812, studentId: 103, attendanceStatus: 'present' },
        { sessionId: 803, attendanceDate: afterWithdrawal, subjectId: 11, subjectName: 'English', recordId: 813, studentId: 103, attendanceStatus: 'absent' }
      ]];
      if (sql.includes('FROM assignments')) return [[
        { assignmentId: 821, title: 'Before enrollment', subjectId: 11, subjectName: 'English', onlineSubmissionEnabled: 0, dueDate: beforeEnrollment, studentId: 103, submissionId: 831, savedStatus: 'not_submitted', filePath: null, submittedAt: null },
        { assignmentId: 822, title: 'During enrollment', subjectId: 11, subjectName: 'English', onlineSubmissionEnabled: 0, dueDate: enrolledDate, studentId: 103, submissionId: 832, savedStatus: 'submitted', filePath: null, submittedAt: `${enrolledDate}T09:00:00` }
      ]];
      if (sql.includes('FROM student_journal_entries AS entries')) return [[
        { entryId: 841, studentId: 103, subjectName: 'Values Education', promptText: 'Before transfer', entryText: 'Old entry.', entryStatus: 'submitted', submittedAt: `${beforeEnrollment}T09:00:00` },
        { entryId: 842, studentId: 103, subjectName: 'Values Education', promptText: 'During enrollment', entryText: 'Relevant reflection.', entryStatus: 'submitted', submittedAt: `${enrolledDate}T09:00:00` },
        { entryId: 843, studentId: 103, subjectName: 'Values Education', promptText: 'After transfer', entryText: 'Out-of-section entry.', entryStatus: 'submitted', submittedAt: `${afterWithdrawal}T09:00:00` }
      ]];
      if (sql.includes('FROM attendance_sessions AS sessions') && sql.includes('INNER JOIN attendance_records')) return [[
        { studentId: 103, sessionId: 801, sectionId: 22, subjectId: 11, date: beforeEnrollment, status: 'absent', subjectName: 'English' },
        { studentId: 103, sessionId: 802, sectionId: 22, subjectId: 11, date: enrolledDate, status: 'present', subjectName: 'English' },
        { studentId: 103, sessionId: 803, sectionId: 22, subjectId: 11, date: afterWithdrawal, status: 'absent', subjectName: 'English' }
      ]];
      if (sql.includes('FROM published_final_grades AS grades')) return [[]];
      if (sql.includes('FROM student_scores AS scores')) return [[]];
      if (sql.includes('FROM school_attendance_settings')) return [[{
        maxUnexcusedAbsences: 1, consecutiveAbsencesAlert: 1, countExcusedAbsences: 0
      }]];
      if (sql.includes('FROM school_year_final_grade_rules')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const result = await invoke(getWeeklyEvidence, {
    user: { id: 8, schoolId: 4, role: 'teacher' },
    query: { sectionId: '22', startDate: weekStart }
  }, database);

  assert.equal(result.error, undefined);
  const transferred = result.body.students[0];
  assert.equal(transferred.attendance.confirmedSessions, 1);
  assert.equal(transferred.attendance.present, 1);
  assert.equal(transferred.attendance.absent, 0);
  assert.equal(transferred.assignments.total, 1);
  assert.equal(transferred.assignments.submitted, 1);
  assert.deepEqual(transferred.journal.entries.map(entry => entry.entryId), ['842']);
  assert.equal(transferred.followUpCandidate, false);
  assert.deepEqual(transferred.academicRecords, []);
  assert.ok(calls.every(call => call.values.includes(4)), 'transfer evidence queries remain school-scoped');
});
