'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreFor, lowResult, sourceRefs, run } = require('../scripts/seedSaintColumbanStPeterDemo');

test('two learners have low Mathematics and Science scores', () => {
  for (const subject of ['Mathematics', 'Science']) {
    for (let student = 0; student < 5; student++) {
      const scores = Array.from({ length: 7 }, (_, item) => scoreFor(student, 0, item, subject));
      assert.equal(lowResult(student, subject), student < 2);
      assert.ok(scores.every(score => student < 2 ? score >= 4 && score <= 10 : score >= 14 && score <= 20));
    }
  }
});

test('report source references deduplicate recorded evidence', () => {
  const student = {
    attendance: { sources: [{ recordId: '10' }, { recordId: '10' }] },
    journal: { sources: [{ entryId: '20' }] },
    candidateReasons: [
      { type: 'low_scores', scores: [{ scoreId: '30' }] },
      { type: 'grade', subject: 'Science', grade: 72 }
    ],
    academicRecords: [{ gradeId: '40', subjectName: 'Science', finalGrade: 72 }]
  };
  assert.deepEqual(sourceRefs(student), [
    ['attendance_record', 10], ['journal_entry', 20],
    ['student_score', 30], ['published_final_grade', 40]
  ]);
});

test('wrong database stops before snapshot or writes', async () => {
  let snapshotCalled = false;
  let writes = 0;
  const connection = {
    query: async () => [[{ db: 'other', fk: 1 }]],
    execute: async () => { writes++; throw new Error('unexpected query'); },
    release() {}
  };
  const database = { getConnection: async () => connection };
  await assert.rejects(run({ apply: true, database, password: 'long-demo-password',
    snapshot: () => { snapshotCalled = true; }, confirm: async () => true }),
  /Wrong database/);
  assert.equal(snapshotCalled, false);
  assert.equal(writes, 0);
});

test('preview validates St. Peter scope and cancelled apply makes no changes', async () => {
  const names = ['Isabel Camille Del Rosario', 'Marco Daniel Dimaculangan',
    'Angela Rose Evangelista', 'Luis Mateo Fajardo', 'Francesca Marie Velasco'];
  const subjects = Array.from({ length: 9 }, (_, i) => ({
    id: 100 + i, name: i === 8 ? 'Values Education' : `Subject ${i + 1}`,
    code: i === 8 ? 'values-education-jhs' : `subject-${i + 1}-jhs`,
    teacherId: 200 + i, teacher: i === 8 ? 'Gerardo Dayrit' : `Teacher ${i + 1}`
  }));
  const components = subjects.flatMap((subject, i) =>
    [['written', i === 8 ? 20 : 30], ['performance', 50],
      ['examination', i === 8 ? 30 : 20]].map(([componentType, weight], j) => ({
      subjectId: subject.id, id: i * 3 + j + 1,
      name: componentType === 'examination' ? 'Term Exam' : componentType,
      componentType, weight
    })));
  const parts = subjects.flatMap((_, i) => [30, 30, 40].map((weight, j) => ({
    id: 50 + i * 3 + j, componentId: i * 3 + 3,
    name: j === 2 ? 'Term Exam' : `Summative Test ${j + 1}`,
    code: ['summative-test-1', 'summative-test-2', 'term-exam'][j], weight
  })));
  let writes = 0;
  let snapshotCalled = false;
  const connection = {
    query: async sql => sql.includes('FOREIGN_KEY_CHECKS')
      ? [[{ db: 'academix', fk: 1 }]] : Promise.reject(new Error(`Unexpected query: ${sql}`)),
    async execute(sql, params = []) {
      assert.equal((sql.match(/\?/g) || []).length, params.length, `Placeholder mismatch: ${sql}`);
      if (/INSERT INTO|UPDATE |DELETE FROM/.test(sql)) writes++;
      if (sql.includes('FROM sections s')) return [[{ id: 12, levelId: 13, yearId: 14, adviserId: 15 }]];
      if (sql.includes("display_name='Ramon Jose Hermoso'")) return [[{ id: 15 }]];
      if (sql.includes('FROM academic_terms WHERE')) return [[{ id: 16, name: 'Term 1' }]];
      if (sql.includes('FROM section_students e')) return [names.map((name, i) => ({
        id: 300 + i, name, religion: 'Roman Catholic', houseStreet: 'Purok 1',
        barangay: 'Poblacion', city: 'Lingayen', province: 'Pangasinan'
      }))];
      if (sql.includes('FROM section_teachers st')) return [subjects];
      if (sql.includes('FROM subject_grading_profiles p')) return [components];
      if (sql.includes('FROM subject_grading_exam_parts WHERE')) return [parts];
      if (sql.includes('FROM school_portal_features f')) return [[{
        gradesEnabled: 1, reportsEnabled: 1, journalsEnabled: 1,
        journalApproved: '2026-11-17', reportApproved: '2026-11-17',
        journalSubjectId: 108, weekStart: 1, weekEnd: 6
      }]];
      if (sql.includes('FROM journal_subjects')) {
        assert.deepEqual(params, [7, 108]);
        return [[{ id: 25 }]];
      }
      if (sql.includes('FROM journal_ai_rubrics')) return [[]];
      if (sql.includes('FROM users\n    WHERE school_email')) return [[]];
      if (sql.includes('FROM student_parent_links WHERE')) return [[]];
      if (sql.includes('AS items') && sql.includes('AS grades')) return [[{
        items: 0, grades: 0, prompts: 0, attendance: 0, reports: 0
      }]];
      throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
    },
    release() {}
  };
  const database = { getConnection: async () => connection };
  const originalLog = console.log;
  const keys = ['AI_JOURNAL_ASSESSMENT_ENABLED','AI_REPORTS_GENERATION_ENABLED',
    'AI_REPORTS_RELEASE_ENABLED','OPENAI_API_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  for (const key of keys) process.env[key] = key === 'OPENAI_API_KEY' ? 'test-key' : 'true';
  console.log = () => {};
  try {
    const preview = await run({ database });
    assert.equal(preview.scoreItems, 65);
    assert.equal(preview.students.length, 5);
    const cancelled = await run({ apply: true, database, password: 'long-demo-password',
      confirm: async () => false, snapshot: () => { snapshotCalled = true; } });
    assert.equal(cancelled, undefined);
  } finally {
    console.log = originalLog;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  assert.equal(writes, 0);
  assert.equal(snapshotCalled, false);
});
