const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const databaseModule = require('../config/database');
const { DEPED_GRADE_SUBJECTS, DEPED_K10_SUBJECTS, EARLY_GRADE_SUBJECTS } = require('../config/depedK10Subjects');

const gradeRows = [
  { schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1, gradeLevelId: 20, gradeCode: 'grade-2', gradeName: 'Grade 2', gradeEnabled: 0 },
  { schoolLevelId: 10, levelCode: 'elementary', levelEnabled: 1, gradeLevelId: 30, gradeCode: 'grade-3', gradeName: 'Grade 3', gradeEnabled: 0 },
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

function createDatabase({ allGradesDisabled = false, enabledGradeCodes = null } = {}) {
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
      if (sql.includes('FROM school_levels')) return [gradeRows.map(row => ({
        ...row,
        gradeEnabled: allGradesDisabled ? 0 : enabledGradeCodes
          ? Number(enabledGradeCodes.includes(row.gradeCode)) : row.gradeEnabled
      }))];
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
  assert.equal(EARLY_GRADE_SUBJECTS.filter(subject => subject.gradeCodes[0] === 'grade-2').length, 5);
  assert.equal(EARLY_GRADE_SUBJECTS.filter(subject => subject.gradeCodes[0] === 'grade-3').length, 6);
  assert.equal(DEPED_GRADE_SUBJECTS.some(subject => subject.gradeCodes.includes('grade-1') || subject.gradeCodes.includes('kindergarten')), false);
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

test('preview lists the five Grade 2 subjects and six Grade 3 subjects only when those grades are enabled', async () => {
  const fixture = createDatabase({ enabledGradeCodes: ['grade-2', 'grade-3'] });
  database = fixture.database;
  const result = await call(getDepedSubjectPreview);

  assert.equal(result.error, null);
  assert.deepEqual(result.data.grades.map(grade => grade.gradeCode), ['grade-2', 'grade-3']);
  assert.equal(result.data.grades[0].subjects.length, 5);
  assert.equal(result.data.grades[1].subjects.length, 6);
  assert.deepEqual(result.data.grades[0].subjects.map(subject => subject.code), [
    'filipino-grade-2', 'english-grade-2', 'mathematics-grade-2', 'gmrc-grade-2', 'makabansa-grade-2'
  ]);
  assert.ok(result.data.grades[1].subjects.some(subject => subject.code === 'science-grade-3'));
  assert.equal(fixture.state.subjects.length, 2);
});

test('applying early-grade defaults creates separate subject records and scopes for each grade', async () => {
  const fixture = createDatabase({ enabledGradeCodes: ['grade-2', 'grade-3'] });
  database = fixture.database;
  const result = await call(applyDepedSubjectDefaults);

  assert.equal(result.error, null);
  assert.deepEqual(result.data.selectedGradeCodes, ['grade-2', 'grade-3']);
  assert.equal(result.data.addedSubjects.length, 11);
  assert.equal(result.data.addedGradeScopes, 11);
  const grade2English = fixture.state.subjects.find(subject => subject.subjectCode === 'english-grade-2');
  const grade3English = fixture.state.subjects.find(subject => subject.subjectCode === 'english-grade-3');
  assert.ok(grade2English && grade3English);
  assert.notEqual(grade2English.id, grade3English.id);
  assert.ok(fixture.state.scopes.some(scope => scope.subjectId === grade2English.id && scope.gradeLevelId === 20));
  assert.ok(fixture.state.scopes.some(scope => scope.subjectId === grade3English.id && scope.gradeLevelId === 30));
  assert.equal(fixture.state.subjects.some(subject => subject.subjectCode === 'science-grade-2'), false);
  assert.ok(fixture.state.subjects.some(subject => subject.subjectCode === 'science-grade-3'));

  const second = await call(applyDepedSubjectDefaults);
  assert.equal(second.error, null);
  assert.equal(second.data.addedSubjects.length, 0);
  assert.equal(fixture.state.subjects.filter(subject => subject.subjectCode === 'english-grade-2').length, 1);
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

test('apply rejects a school with no enabled supported grade levels and rolls back', async () => {
  const fixture = createDatabase({ allGradesDisabled: true });
  database = fixture.database;
  const result = await call(applyDepedSubjectDefaults);
  assert.equal(result.error?.status, 400);
  assert.match(result.error.message, /at least one supported grade level/);
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
  assert.doesNotMatch(page, /school-k10-transition-note|these final-grade settings apply to numerical Grades 2/);
  new vm.Script(scripts.at(-1)[1], { filename: 'edugnay-admin-schools.inline.js' });
});

test('Elementary final-grade settings keep their spacing without the redundant note', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  assert.doesNotMatch(page, /school-k10-transition-note|school-k10-transition-icon|school-k10-transition-text/);
  assert.match(page, /id="k10GradingModeHelp"/);
  assert.match(page, /id="k10PassingGradeHelp"/);
  assert.match(page, /preview\.periodStructureWarning/);
  assert.match(styles, /\.school-k10-final-rules\s*\{[^}]*gap:\s*16px;/s);
  assert.match(styles, /\.school-k10-final-rules-form\s*>\s*\.school-form-grid\s*\{[^}]*margin-top:\s*0;/s);
});

