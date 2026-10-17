const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const databaseModule = require('../config/database');
const { DEPED_K10_SUBJECTS } = require('../config/depedK10Subjects');

const gradeRows = [
  ...['grade-4', 'grade-5', 'grade-6'].map((gradeCode, index) => ({
    schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1,
    gradeLevelId: 40 + index, gradeCode, gradeName: `Grade ${index + 4}`, gradeEnabled: gradeCode === 'grade-6' ? 0 : 1
  })),
  ...['grade-7', 'grade-8', 'grade-9', 'grade-10'].map((gradeCode, index) => ({
    schoolLevelId: 20, levelCode: 'jhs', levelEnabled: 1,
    gradeLevelId: 70 + index, gradeCode, gradeName: `Grade ${index + 7}`, gradeEnabled: 1
  }))
];

let database;
databaseModule.getDatabase = () => database;
const { applyDepedSubjectDefaults, getDepedSubjectPreview } = require('../controllers/depedK10SubjectsController');

function createDatabase({ allGradesDisabled = false } = {}) {
  const state = {
    subjects: [
      { id: 1, subjectCode: 'science-jhs', name: 'Science', schoolLevelId: 20, gradeLevelId: null, isActive: 1 },
      { id: 2, subjectCode: 'english-elementary', name: 'English', schoolLevelId: 10, gradeLevelId: null, isActive: 0 }
    ],
    scopes: [{ subjectId: 1, gradeLevelId: 70 }, { subjectId: 2, gradeLevelId: 40 }],
    audit: [],
    nextSubjectId: 3,
    transactions: []
  };
  const connection = {
    async beginTransaction() { state.transactions.push('begin'); },
    async commit() { state.transactions.push('commit'); },
    async rollback() { state.transactions.push('rollback'); },
    release() {},
    async execute(sql, values = []) {
      if (sql.includes('FROM school_levels')) return [allGradesDisabled
        ? gradeRows.map(row => ({ ...row, gradeEnabled: 0 }))
        : gradeRows];
      if (sql.startsWith('SELECT id, subject_code AS subjectCode')) {
        return [values[0] === 9 ? state.subjects : []];
      }
      if (sql.startsWith('SELECT subject_id AS subjectId')) {
        const subjectIds = values.slice(1).map(Number);
        return [state.scopes.filter(scope => subjectIds.includes(scope.subjectId))];
      }
      if (sql.startsWith('INSERT INTO subjects')) {
        const id = state.nextSubjectId++;
        state.subjects.push({ id, subjectCode: values[1], name: values[2], schoolLevelId: Number(values[3]), gradeLevelId: null, isActive: 1 });
        return [{ insertId: id }];
      }
      if (sql.startsWith('INSERT INTO subject_grade_scopes')) {
        state.scopes.push({ subjectId: Number(values[1]), gradeLevelId: Number(values[2]) });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        state.audit.push(JSON.parse(values[5]));
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  return { state, connection, database: { execute: connection.execute.bind(connection), getConnection: async () => connection } };
}

async function call(controller, { body = {}, schoolId = 9 } = {}) {
  const result = { status: null, data: null, error: null };
  await controller({ user: { id: 5, schoolId }, body }, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('DepEd subject catalog reflects the Grades 4-10 learning areas and level-specific EPP/TLE', () => {
  assert.equal(DEPED_K10_SUBJECTS.some(subject => subject.gradeCodes.includes('kindergarten')), false);
  assert.equal(DEPED_K10_SUBJECTS.filter(subject => subject.levelCode === 'elementary').length, 9);
  assert.equal(DEPED_K10_SUBJECTS.filter(subject => subject.levelCode === 'jhs').length, 9);
  assert.deepEqual(DEPED_K10_SUBJECTS.find(subject => subject.code === 'epp-elementary').gradeCodes, ['grade-4', 'grade-5', 'grade-6']);
  assert.deepEqual(DEPED_K10_SUBJECTS.find(subject => subject.code === 'tle-jhs').gradeCodes, ['grade-7', 'grade-8', 'grade-9', 'grade-10']);
});

test('preview lists enabled Grades 4-10 and flags existing subjects without changing them', async () => {
  const fixture = createDatabase();
  database = fixture.database;
  const result = await call(getDepedSubjectPreview);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.grades.map(grade => grade.gradeCode), ['grade-4', 'grade-5', 'grade-7', 'grade-8', 'grade-9', 'grade-10']);
  assert.equal(result.data.grades[0].subjects.find(subject => subject.code === 'english-elementary').status, 'inactive');
  assert.equal(result.data.grades[1].subjects.find(subject => subject.code === 'english-elementary').status, 'review-existing');
  assert.equal(result.data.grades[2].subjects.find(subject => subject.code === 'science-jhs').status, 'already-present');
  assert.equal(result.data.grades[3].subjects.find(subject => subject.code === 'science-jhs').status, 'review-existing');
  assert.equal(fixture.state.subjects.length, 2);
});

test('apply adds missing subjects across all enabled grades and repeat application is safe', async () => {
  const fixture = createDatabase();
  database = fixture.database;
  const first = await call(applyDepedSubjectDefaults);
  assert.equal(first.error, null);
  assert.equal(first.status, 200);
  assert.equal(first.data.addedSubjects.length, 16);
  assert.equal(first.data.addedGradeScopes, 48);
  assert.deepEqual(first.data.selectedGradeCodes, ['grade-4', 'grade-5', 'grade-7', 'grade-8', 'grade-9', 'grade-10']);
  assert.equal(fixture.state.scopes.some(scope => scope.subjectId === 1 && scope.gradeLevelId === 71), false);
  assert.equal(fixture.state.scopes.some(scope => scope.subjectId === 2 && scope.gradeLevelId === 40), true);
  assert.equal(fixture.state.audit.length, 1);

  const second = await call(applyDepedSubjectDefaults);
  assert.equal(second.error, null);
  assert.equal(second.data.addedSubjects.length, 0);
  assert.equal(second.data.addedGradeScopes, 0);
  assert.equal(fixture.state.subjects.length, 18);
  assert.deepEqual(fixture.state.transactions, ['begin', 'commit', 'begin', 'commit']);
});

test('apply rejects a school with no enabled Grades 4-10 and rolls back', async () => {
  const fixture = createDatabase({ allGradesDisabled: true });
  database = fixture.database;
  const result = await call(applyDepedSubjectDefaults);
  assert.equal(result.error?.status, 400);
  assert.match(result.error.message, /at least one Grade 4/);
  assert.deepEqual(fixture.state.transactions, ['begin', 'rollback']);
  assert.equal(fixture.state.subjects.length, 2);
});

test('School Settings exposes the review flow and its inline script parses', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  assert.match(page, /Review DepEd subjects/);
  assert.match(page, /depedSubjectReviewModal/);
  assert.match(page, /Apply DepEd subjects/);
  assert.match(page, /You can edit them later in Class Management/);
  new vm.Script(scripts.at(-1)[1], { filename: 'edugnay-admin-schools.inline.js' });
});

