'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planItems, readScope, recordTime, publishTime, mockFails, mockScore, run } =
  require('../scripts/seedSaintColumbanStJohnTerm1Grades');

function fixture() {
  const subjects = Array.from({ length: 9 }, (_, i) => ({
    id: i + 100, name: i === 8 ? 'Values Education' : `Subject ${i + 1}`,
    code: i === 8 ? 'values-education-jhs' : `subject-${i + 1}-jhs`,
    teacherId: i + 200, teacher: `Teacher ${i + 1}`
  }));
  const students = Array.from({ length: 40 }, (_, i) => ({
    id: i + 300, name: `Student ${i + 1}`
  }));
  const components = subjects.flatMap((subject, subjectIndex) =>
    [['written', subjectIndex === 8 ? 20 : 30],
      ['performance', subjectIndex === 8 ? 50 : 50],
      ['examination', subjectIndex === 8 ? 30 : 20]]
      .map(([componentType, weight], index) => ({
        subjectId: subject.id, id: subjectIndex * 3 + index + 1,
        name: componentType === 'examination' ? 'Term Exam' : componentType,
        componentType, weight
      })));
  const parts = subjects.flatMap((_, subjectIndex) => [
    { id: subjectIndex * 3 + 50, componentId: subjectIndex * 3 + 3,
      name: 'Summative Test 1', code: 'summative-test-1', weight: 30 },
    { id: subjectIndex * 3 + 51, componentId: subjectIndex * 3 + 3,
      name: 'Summative Test 2', code: 'summative-test-2', weight: 30 },
    { id: subjectIndex * 3 + 52, componentId: subjectIndex * 3 + 3,
      name: 'Term Exam', code: 'term-exam', weight: 40 }
  ]);
  return { subjects, students, components, parts };
}

function fakeDatabase({ enrolled = 40, gradesEnabled = 1, existingItems = 0,
  failScore = false, withPush = false, parentAlertsEnabled = 0, parentLinks = [] } = {}) {
  const data = fixture();
  const saved = { items: [], scores: [], grades: [], notices: [], audits: [], pushes: [] };
  const actions = { begins: 0, commits: 0, rollbacks: 0, snapshots: 0 };
  let nextId = 1000;
  const connection = {
    async query(sql) {
      if (sql.includes('FOREIGN_KEY_CHECKS')) return [[{ db: 'academix', fk: 1 }]];
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
    async execute(sql, params = []) {
      assert.equal((sql.match(/\?/g) || []).length, params.length,
        `SQL placeholder mismatch: ${sql.slice(0, 100)}`);
      if (sql.includes('FROM sections s') && sql.includes('school_grade_levels')) {
        return [[{ id: 12, levelId: 13, yearId: 14, gradeId: 15 }]];
      }
      if (sql.includes('FROM academic_terms WHERE')) return [[{ id: 16, name: 'Term 1' }]];
      if (sql.includes('FROM section_teachers st')) return [data.subjects];
      if (sql.includes('FROM section_students e') && sql.includes('u.role')) {
        return [data.students.slice(0, enrolled)];
      }
      if (sql.includes('FROM school_portal_features')) return [[{ enabled: gradesEnabled }]];
      if (sql.includes('FROM parent_notification_triggers')) {
        return [[{ enabled: parentAlertsEnabled }]];
      }
      if (sql.includes('FROM student_parent_links links')) return [parentLinks];
      if (sql.includes('AS items') && sql.includes('AS grades') && sql.includes('AS notices') &&
        !sql.includes('AS scores')) {
        return [[{ items: existingItems, grades: 0, notices: 0 }]];
      }
      if (sql.includes('FROM subject_grading_profiles p')) return [data.components];
      if (sql.includes('FROM subject_grading_exam_parts WHERE')) return [data.parts];
      if (sql.includes('FOR UPDATE')) return [[{ id: 12 }]];
      if (sql.includes('INSERT INTO grading_items')) {
        const id = nextId++;
        saved.items.push({ id, params });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO student_scores')) {
        if (failScore && saved.scores.length === 10) throw new Error('score write failed');
        saved.scores.push(params);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO published_final_grades')) {
        saved.grades.push(params);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO notifications')) {
        const id = nextId++;
        saved.notices.push({ id, params,
          kind: sql.includes('related_student_user_id') ? 'parent' : 'student' });
        if (withPush) saved.pushes.push(id);
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (sql.includes('UPDATE grading_items SET')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO audit_logs')) {
        saved.audits.push(params);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('information_schema.TABLES')) return [withPush ? [{ TABLE_NAME: 'notification_push_deliveries' }] : []];
      if (sql.includes('DELETE FROM notification_push_deliveries')) {
        saved.pushes = [];
        return [{ affectedRows: saved.notices.length }];
      }
      if (sql.includes('COUNT(*) AS n FROM notification_push_deliveries')) {
        return [[{ n: saved.pushes.length }]];
      }
      if (sql.includes('AS firstItem') && sql.includes('AS lastScore')) {
        return [[{ firstItem: saved.items[0].params[10],
          lastItem: saved.items.at(-1).params[10],
          firstScore: saved.scores[0][5], lastScore: saved.scores.at(-1)[5] }]];
      }
      if (sql.includes('AS scores') && sql.includes('AS notices')) {
        return [[{ items: saved.items.length, scores: saved.scores.length,
          grades: saved.grades.length, notices: saved.notices.length }]];
      }
      if (sql.includes('FROM published_final_grades WHERE')) {
        return [saved.grades.map(p => ({ subjectId: p[2], studentId: p[4],
          publishedAt: p[8], createdAt: p[9] }))];
      }
      if (sql.includes('FROM notifications WHERE id IN')) {
        return [saved.notices.map(({ id, params: p, kind }) => ({ id, userId: p[0],
          relatedStudentId: kind === 'parent' ? p[1] : null,
          eventKey: kind === 'parent' ? p[4] : p[3],
          createdAt: kind === 'parent' ? p[5] : p[4] }))];
      }
      throw new Error(`Unexpected execute: ${sql.slice(0, 100)}`);
    },
    async beginTransaction() { actions.begins++; },
    async commit() { actions.commits++; },
    async rollback() { actions.rollbacks++; },
    release() {}
  };
  return { data, saved, actions, connection, database: { async getConnection() { return connection; } } };
}

async function quiet(callback) {
  const log = console.log;
  const table = console.table;
  console.log = () => {};
  console.table = () => {};
  try { return await callback(); }
  finally { console.log = log; console.table = table; }
}

test('score items follow the subject profile and Values Education domains', () => {
  const { subjects, components, parts } = fixture();
  const normal = planItems(subjects[0], components, parts);
  const values = planItems(subjects[8], components, parts);
  assert.equal(normal.length, 7);
  assert.equal(values.length, 8);
  assert.deepEqual(values.filter(item => item.domainCode).map(item => item.domainCode),
    ['cognitive', 'affective', 'cognitive', 'affective', 'behavioral']);
  assert.deepEqual(values.filter(item => item.domainCode).map(item => item.title),
    ['Quiz 1', 'Quiz 2', 'Performance Task 1', 'Performance Task 2', 'Performance Task 3']);
  assert.equal(values.filter(item => item.examPartId).length, 3);
  assert.ok([...normal, ...values].every(item => item.maxScore === 20));
});

test('recording and publication dates stay in the requested windows', () => {
  assert.equal(recordTime(0, 0, 48), '2026-11-18 10:38:00');
  assert.ok(recordTime(63, 40, 64) <= '2026-11-18 10:53:00');
  assert.equal(publishTime(0), '2026-11-18 10:59:00');
  assert.equal(publishTime(8), '2026-11-18 11:05:00');
  assert.ok(mockScore(0, 0, 0) >= 0 && mockScore(0, 0, 0) <= 20);
  for (let subjectIndex = 0; subjectIndex < 9; subjectIndex++) {
    assert.equal(Array.from({ length: 40 }, (_, studentIndex) =>
      mockFails(studentIndex, subjectIndex)).filter(Boolean).length, 5);
    assert.ok(mockScore(0, 0, subjectIndex) <= 20);
  }
});

test('preflight rejects wrong enrollment, disabled Grades, and existing items', async () => {
  await assert.rejects(readScope(fakeDatabase({ enrolled: 39 }).connection), /40 active/);
  await assert.rejects(readScope(fakeDatabase({ gradesEnabled: 0 }).connection), /Grades portal/);
  await assert.rejects(readScope(fakeDatabase({ existingItems: 1 }).connection), /already has/);
});

test('apply publishes 360 calculated grades and matching historical in-app notices', async () => {
  const scope = fakeDatabase({ withPush: true, parentAlertsEnabled: 1,
    parentLinks: [{ studentId: 300, parentId: 900 }] });
  const calculate = async (_connection, _teacher, gradeScope) => ({
    readyToPublish: true, issues: [], passingGradeThreshold: 75,
    transferReviewStudentIds: [], domainRuleVersion: null,
    gradingItemIds: scope.saved.items.filter(row => row.params[2] === gradeScope.subjectId)
      .map(row => row.id),
    students: scope.data.students.map((row, studentIndex) => ({ studentId: row.id,
      studentName: row.name,
      finalGrade: mockFails(studentIndex,
        scope.data.subjects.findIndex(subject => subject.id === gradeScope.subjectId)) ? 70 : 85,
      retainedPublishedGrade: false }))
  });
  const result = await quiet(() => run({ apply: true, database: scope.database,
    confirm: async () => true,
    snapshot: () => { scope.actions.snapshots++; return 'available-snapshot'; },
    calculate }));
  assert.equal(result.result, 'complete');
  assert.equal(scope.saved.items.length, 64);
  assert.equal(scope.saved.scores.length, 2560);
  assert.equal(scope.saved.grades.length, 360);
  assert.equal(scope.saved.notices.filter(row => row.kind === 'student').length, 360);
  assert.equal(scope.saved.notices.filter(row => row.kind === 'parent').length, 2);
  assert.equal(result.parentNoticeIds.length, 2);
  assert.equal(scope.saved.grades.filter(row => Number(row[5]) < 75).length, 45);
  assert.equal(scope.saved.audits.length, 9);
  assert.equal(scope.saved.pushes.length, 0);
  assert.equal(scope.actions.commits, 1);
  assert.equal(scope.actions.rollbacks, 0);
});

test('snapshot failure prevents writes and score failure rolls back', async () => {
  const first = fakeDatabase();
  await assert.rejects(quiet(() => run({ apply: true, database: first.database,
    confirm: async () => true, snapshot: () => { throw new Error('snapshot unavailable'); } })),
  /snapshot unavailable/);
  assert.equal(first.actions.begins, 0);
  assert.equal(first.saved.items.length, 0);
  const second = fakeDatabase({ failScore: true });
  await assert.rejects(quiet(() => run({ apply: true, database: second.database,
    confirm: async () => true, snapshot: () => 'available-snapshot' })), /score write failed/);
  assert.equal(second.actions.commits, 0);
  assert.equal(second.actions.rollbacks, 1);
});

test('unexpected all-passing calculation rolls the grade seed back', async () => {
  const scope = fakeDatabase();
  const calculate = async (_connection, _teacher, gradeScope) => ({
    readyToPublish: true, issues: [], passingGradeThreshold: 75,
    transferReviewStudentIds: [], domainRuleVersion: null,
    gradingItemIds: scope.saved.items.filter(row => row.params[2] === gradeScope.subjectId)
      .map(row => row.id),
    students: scope.data.students.map(row => ({ studentId: row.id,
      studentName: row.name, finalGrade: 85, retainedPublishedGrade: false }))
  });
  await assert.rejects(quiet(() => run({ apply: true, database: scope.database,
    confirm: async () => true, snapshot: () => 'available-snapshot', calculate })),
  /passing and failing grades differ/);
  assert.equal(scope.actions.commits, 0);
  assert.equal(scope.actions.rollbacks, 1);
});
