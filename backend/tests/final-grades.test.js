const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
const savedGrades = [];
const pendingGrades = [];
const savedNotices = new Set();
const pendingNotices = new Set();
const publishedItems = new Set();
const pendingPublishedItems = new Set();
let assigned = true;
let failOnInsertNumber = 0;
let failOnAuditWrite = false;
let failOnNotificationWrite = false;
let failOnMarkerWrite = false;
let context = {};
let categories = [];
let students = [];
let items = [];
let scores = [];
let committed = false;
let rolledBack = false;
let parentTriggerEnabled = false;
let gradesEnabled = true;

const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('SELECT grades_enabled AS gradesEnabled FROM school_portal_features')) return [[{ gradesEnabled: gradesEnabled ? 1 : 0 }]];
    if (sql.includes('FROM parent_notification_triggers')) return [parentTriggerEnabled ? [{ enabled: 1 }] : []];
    if (sql.includes('SELECT passing_grade_threshold AS threshold FROM school_levels')) return [[{ threshold: 75 }]];
    if (sql.includes('INSERT INTO notifications')) {
      if (/ON DUPLICATE KEY UPDATE id = id/.test(sql)) throw new Error("Column 'id' in field list is ambiguous");
      if (failOnNotificationWrite) throw new Error('Simulated notification failure.');
      pendingNotices.add(`${values.at(-1)}:${values[4]}`);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM section_teachers')) return [[assigned ? context : undefined].filter(Boolean)];
    if (sql.includes('FROM grading_categories')) return [categories];
    if (sql.includes('FROM section_students')) return [students];
    if (sql.includes('FROM grading_items')) return [items];
    if (sql.includes('FROM student_scores')) return [scores];
    if (sql.includes('INSERT INTO published_final_grades')) {
      pendingGrades.push(values);
      if (failOnInsertNumber && pendingGrades.length === failOnInsertNumber) throw new Error('Simulated database write failure.');
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE grading_items SET used_in_published_grades')) {
      if (failOnMarkerWrite) throw new Error('Simulated marker write failure.');
      values.slice(5).forEach(id => pendingPublishedItems.add(id));
      return [{ affectedRows: values.length - 5 }];
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      if (failOnAuditWrite) throw new Error('Simulated activity log failure.');
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      beginTransaction: async () => {},
      commit: async () => {
        committed = true;
        savedGrades.push(...pendingGrades);
        pendingNotices.forEach(key => savedNotices.add(key));
        pendingPublishedItems.forEach(id => publishedItems.add(id));
        pendingGrades.length = 0;
        pendingNotices.clear();
        pendingPublishedItems.clear();
      },
      rollback: async () => { rolledBack = true; pendingGrades.length = 0; pendingNotices.clear(); pendingPublishedItems.clear(); },
      release: () => {}
    };
  }
};

databaseModule.getDatabase = () => database;
const grades = require('../controllers/gradesController');

function reset() {
  queries.length = 0;
  savedGrades.length = 0;
  pendingGrades.length = 0;
  savedNotices.clear();
  pendingNotices.clear();
  publishedItems.clear();
  pendingPublishedItems.clear();
  assigned = true;
  failOnInsertNumber = 0;
  failOnAuditWrite = false;
  failOnNotificationWrite = false;
  failOnMarkerWrite = false;
  committed = false;
  rolledBack = false;
  parentTriggerEnabled = false;
  gradesEnabled = true;
  context = {
    sectionId: 8, schoolId: 1, schoolLevelId: 2, academicYearId: 4,
    sectionName: 'St. Matthew', subjectId: 2, subjectName: 'English',
    academicTermId: 14, academicTermName: 'Quarter 2', termStatus: 'active',
    gradeRounding: 'round', passingGradeThreshold: '75.00'
  };
  categories = [
    { id: 1, code: 'ww', name: 'Written Work', weight: '30.00' },
    { id: 2, code: 'pt', name: 'Performance Task', weight: '50.00' },
    { id: 3, code: 'qa', name: 'Quarterly Assessment', weight: '20.00' }
  ];
  students = [
    { studentId: 101, studentName: 'Ava Cruz' },
    { studentId: 102, studentName: 'Ben Reyes' }
  ];
  items = [
    { gradingItemId: 11, title: 'Quiz', gradingCategoryId: 1, maxScore: '20.00', categorySchoolId: 1, categorySchoolLevelId: 2 },
    { gradingItemId: 12, title: 'Project', gradingCategoryId: 2, maxScore: '20.00', categorySchoolId: 1, categorySchoolLevelId: 2 },
    { gradingItemId: 13, title: 'Quarterly Test', gradingCategoryId: 3, maxScore: '10.00', categorySchoolId: 1, categorySchoolLevelId: 2 }
  ];
  scores = [
    { studentId: 101, gradingItemId: 11, score: '18.00' },
    { studentId: 101, gradingItemId: 12, score: '16.00' },
    { studentId: 101, gradingItemId: 13, score: '7.00' },
    { studentId: 102, gradingItemId: 11, score: '15.00' },
    { studentId: 102, gradingItemId: 12, score: '10.00' },
    { studentId: 102, gradingItemId: 13, score: '8.00' }
  ];
}

async function call(handler, { role = 'teacher', query = {}, body = {} } = {}) {
  const result = { status: 200, data: null, error: null };
  await handler({ user: { id: 5, schoolId: 1, role }, query, body }, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

const scope = { sectionId: '8', subjectId: '2', academicTermId: '14' };

test('preview calculates weighted category percentages and applies school rounding', async () => {
  reset();
  const result = await call(grades.previewFinalGrades, { query: scope });

  assert.equal(result.error, null);
  assert.equal(result.data.preview.readyToPublish, true);
  assert.equal(result.data.preview.students[0].finalGrade, 81);
  assert.deepEqual(result.data.preview.students[0].categoryAverages.map(item => item.percentage), [90, 80, 70]);
  assert.equal(result.data.preview.students[0].isPassing, true);
  assert.equal(result.data.preview.students[1].finalGrade, 64);
  assert.equal(result.data.preview.students[1].isPassing, false);
});

test('preview follows round, roundup, and truncate settings', async () => {
  reset();
  students = [students[0]];
  items.forEach(item => { item.maxScore = '100.00'; });
  scores = items.map(item => ({ studentId: 101, gradingItemId: item.gradingItemId, score: '80.20' }));

  for (const [rule, expected] of [['round', 80], ['roundup', 81], ['truncate', 80]]) {
    context.gradeRounding = rule;
    const result = await call(grades.previewFinalGrades, { query: scope });
    assert.equal(result.data.preview.students[0].finalGrade, expected);
  }
});

test('blank and absent score records block publication, but an explicit zero is valid', async () => {
  reset();
  scores = scores.filter(record => !(record.studentId === 102 && record.gradingItemId === 13));
  const preview = await call(grades.previewFinalGrades, { query: scope });

  assert.equal(preview.data.preview.readyToPublish, false);
  assert.equal(preview.data.preview.missingScoreCount, 1);
  assert.deepEqual(preview.data.preview.students[1].missingItems, [{ gradingItemId: 13, title: 'Quarterly Test' }]);
  assert.equal(preview.data.preview.students[1].finalGrade, null);

  const publish = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(publish.error?.status, 409);
  assert.equal(savedGrades.length, 0);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);

  reset();
  scores.find(record => record.studentId === 102 && record.gradingItemId === 13).score = '0.00';
  const zeroScorePreview = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(zeroScorePreview.data.preview.readyToPublish, true);
  assert.equal(zeroScorePreview.data.preview.missingScoreCount, 0);
});

test('publish saves all student grades atomically using the authenticated teacher identity', async () => {
  reset();
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.equal(result.error, null);
  assert.equal(result.data.published, true);
  assert.equal(result.data.publishedCount, 2);
  assert.equal(savedGrades.length, 2);
  assert.ok(savedGrades.every(values => values[0] === 1 && values[1] === 8 && values[2] === 2 && values[3] === 14 && values[6] === 5));
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  const studentNotices = queries.filter(query => query.sql.includes('INSERT INTO notifications') && query.sql.includes('SELECT students.id'));
  assert.equal(studentNotices.length, 2);
  assert.deepEqual(studentNotices.map(query => query.values.at(-1)), [101, 102]);
  assert.ok(studentNotices.every(query => query.values[3] === '/views/student/edugnay-student-grades.html' && query.values.at(-2) === 1));
  assert.equal(savedNotices.size, 2);
  assert.deepEqual([...publishedItems], [11, 12, 13]);
  assert.match(queries.find(query => query.sql.includes('INSERT INTO published_final_grades')).sql, /ON DUPLICATE KEY UPDATE/);
  const audit = queries.find(query => query.sql.includes('INSERT INTO audit_logs'));
  assert.ok(audit);
  assert.equal(audit.values[2], 'final_grades_published');
});

test('publication notifies linked parents only for a below-passing final grade', async () => {
  reset();
  parentTriggerEnabled = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(result.error, null);
  const notices = queries.filter(item => item.sql.includes('INSERT INTO notifications') && item.sql.includes('student_parent_links'));
  assert.equal(notices.length, 1);
  assert.equal(notices[0].values[0], 'grade');
  assert.equal(notices[0].values.at(-1), 102);
  assert.match(notices[0].sql, /ON DUPLICATE KEY UPDATE event_key = event_key/);
  assert.equal(savedNotices.size, 3);
  assert.equal(committed, true);
});

test('republishing the same subject and term keeps the parent alert deduplicated', async () => {
  reset();
  parentTriggerEnabled = true;
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal(savedNotices.size, 3);
  assert.equal(savedGrades.length, 4);
});

test('republishing marks a newly added component only after the new grades commit', async () => {
  reset();
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  items.push({ gradingItemId: 14, title: 'New quiz', gradingCategoryId: 1, maxScore: '10.00', categorySchoolId: 1, categorySchoolLevelId: 2 });
  scores.push({ studentId: 101, gradingItemId: 14, score: '9.00' });
  scores.push({ studentId: 102, gradingItemId: 14, score: '8.00' });
  assert.equal(publishedItems.has(14), false);
  assert.equal((await call(grades.publishFinalGrades, { body: scope })).error, null);
  assert.equal(publishedItems.has(14), true);
});

test('marker failure rolls back grade publication and component protection', async () => {
  reset();
  failOnMarkerWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.match(result.error?.message || '', /marker write failure/);
  assert.equal(savedGrades.length, 0);
  assert.equal(publishedItems.size, 0);
  assert.equal(rolledBack, true);
});

test('disabled Grades page suppresses student and parent grade notifications', async () => {
  reset();
  gradesEnabled = false;
  parentTriggerEnabled = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(result.error, null);
  assert.equal(savedGrades.length, 2);
  assert.equal(queries.some(query => query.sql.includes('INSERT INTO notifications')), false);
  assert.equal(savedNotices.size, 0);
});

test('a notification write failure rolls grade publication back', async () => {
  reset();
  parentTriggerEnabled = true;
  failOnNotificationWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });
  assert.match(result.error?.message, /notification failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(savedNotices.size, 0);
});

test('unassigned teachers and closed terms cannot preview or publish grades', async () => {
  reset();
  assigned = false;
  const unassigned = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(unassigned.error?.status, 404);
  assert.equal(queries.filter(query => query.sql.includes('FROM grading_categories')).length, 0);

  reset();
  context.termStatus = 'closed';
  const closedTerm = await call(grades.publishFinalGrades, { body: scope });
  assert.equal(closedTerm.error?.status, 409);
  assert.equal(savedGrades.length, 0);
  assert.equal(rolledBack, true);
});

test('only teachers can access the grade preview and publish handlers', async () => {
  reset();

  for (const role of ['student', 'parent', 'school_admin', 'platform_admin']) {
    const preview = await call(grades.previewFinalGrades, { role, query: scope });
    const publish = await call(grades.publishFinalGrades, { role, body: scope });
    assert.equal(preview.error?.status, 403);
    assert.equal(publish.error?.status, 403);
  }

  assert.equal(queries.length, 0);
  assert.equal(savedGrades.length, 0);
});

test('invalid score values and incomplete grading categories block publication', async () => {
  reset();
  scores[0].score = '21.00';
  const invalidScore = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(invalidScore.data.preview.readyToPublish, false);
  assert.equal(invalidScore.data.preview.invalidScoreCount, 1);
  assert.equal(invalidScore.data.preview.students[0].finalGrade, null);

  reset();
  items = items.filter(item => item.gradingCategoryId !== 3);
  const missingCategoryItems = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(missingCategoryItems.data.preview.readyToPublish, false);
  assert.ok(missingCategoryItems.data.preview.issues.some(issue => issue.code === 'category_without_items'));

  reset();
  categories[0].weight = '29.00';
  const invalidWeights = await call(grades.previewFinalGrades, { query: scope });
  assert.equal(invalidWeights.data.preview.readyToPublish, false);
  assert.ok(invalidWeights.data.preview.issues.some(issue => issue.code === 'invalid_category_weights'));
});

test('a failed snapshot write rolls the entire publish operation back', async () => {
  reset();
  failOnInsertNumber = 2;
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.match(result.error?.message, /Simulated database write failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(pendingGrades.length, 0);
});

test('a failed activity log write also rolls back grade publication', async () => {
  reset();
  failOnAuditWrite = true;
  const result = await call(grades.publishFinalGrades, { body: scope });

  assert.match(result.error?.message, /activity log failure/);
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(savedGrades.length, 0);
  assert.equal(pendingGrades.length, 0);
});

test('publishing rejects client-supplied school, publisher, or grade values', async () => {
  reset();
  const result = await call(grades.publishFinalGrades, {
    body: { ...scope, schoolId: 99, publishedByUserId: 99, grades: [{ studentId: 101, finalGrade: 100 }] }
  });

  assert.equal(result.error?.status, 400);
  assert.equal(queries.length, 0);
  assert.equal(savedGrades.length, 0);
});
