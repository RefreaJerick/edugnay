const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const controller = fs.readFileSync(path.join(__dirname, '../controllers/assignmentsController.js'), 'utf8');
const source = controller.match(/async function deleteAssignment\([\s\S]*?(?=\r?\nasync function getStudentAssignment\()/)?.[0];
assert.ok(source);

async function runDeletion({ kind = 'core', role = 'school_admin', schoolId = 1,
  linked = true, termActive = true, published = false, savedScore = false,
  expectedSubmissionCount = 0, actualSubmissionCount = 0 } = {}) {
  const calls = [];
  const assignment = { id: 4, schoolId: 1, sectionId: kind === 'core' ? 8 : null,
    subjectId: kind === 'core' ? 2 : null, electiveClassId: kind === 'elective' ? 9 : null,
    academicTermId: 6, gradingItemId: linked ? 12 : null, gradingCategoryId: null,
    teacherUserId: 5, title: 'Task', status: 'published', academicYearStatus: 'active' };
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() {},
    async execute(sql) {
      if (sql.includes('FROM academic_terms WHERE school_id = ? AND id = ?')) return [termActive ? [{ id: 6 }] : []];
      if (sql.includes('FROM assignment_submissions WHERE school_id = ?'))
        return [Array.from({ length: actualSubmissionCount }, (_, id) => ({ id: id + 1, filePath: null }))];
      if (sql.includes('FROM grading_items WHERE id = ?')) return [[{ id: 12, sectionId: assignment.sectionId,
        subjectId: assignment.subjectId, electiveClassId: assignment.electiveClassId,
        academicTermId: 6, gradingCategoryId: null, teacherUserId: 5,
        usedInPublishedGrades: published }]];
      if (sql.startsWith('SELECT id FROM student_scores')) return [savedScore ? [{ id: 20 }] : []];
      if (sql.includes('FROM journal_prompts')) return [[]];
      if (sql.startsWith('SELECT id FROM grading_items')) return [[]];
      if (sql.startsWith('DELETE FROM')) { calls.push(sql); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const context = vm.createContext({
    getDatabase: () => ({ getConnection: async () => connection }),
    parseId: Number, createError: (message, status = 400) => Object.assign(new Error(message), { status }),
    getAssignmentForManagement: async (_db, user) => user.schoolId === 1
      && (user.role === 'school_admin' || user.id === 5) ? { ...assignment } : null,
    assertAssignmentYearWritable() {},
    getTeacherSectionSubject: async () => ({ schoolId: 1, shsCurriculumCode: 'strengthened_2026',
      shsSubjectType: 'core', academicYearId: 3, schoolLevelId: 2 }),
    resolveShsScope: async (_db, user) => { if (user.role !== 'teacher') throw new Error('Teacher check used for admin'); },
    validateTermAndCategory: async () => { if (!termActive) throw Object.assign(new Error('Inactive term'), { status: 404 }); },
    assertGradeWriteAccess: async () => {}, assertElectiveTeacher: async (_db, user) => {
      if (user.id !== 5) throw new Error('Wrong teacher');
      return { academicYearId: 3, schoolLevelId: 2 };
    },
    getElectiveClass: async () => ({ yearStatus: 'active', classActive: true,
      offeringActive: true, teacherStatus: 'active', academicYearId: 3, schoolLevelId: 2 }),
    activeTerm: async () => ({ id: 6 }), classAvailable: () => true,
    writeAuditLog: async () => { calls.push('audit'); },
    assignmentAuditDetails: () => ({}), path: { basename: value => value },
    fs: { unlink: async () => {} }
  });
  vm.runInContext(source, context);
  let error;
  let status;
  await context.deleteAssignment({ params: { assignmentId: 4 }, query: { expectedSubmissionCount },
    user: { id: role === 'school_admin' ? 3 : 5, role, schoolId } },
  { status(value) { status = value; return this; }, send() {}, json() {} }, caught => { error = caught; });
  return { error, status, calls };
}

for (const kind of ['core', 'elective']) {
  for (const role of ['teacher', 'school_admin']) {
    for (const linked of [false, true]) {
      test(`${role} deletes ${kind} ${linked ? 'linked' : 'unlinked'} assignment`, async () => {
        const result = await runDeletion({ kind, role, linked });
        assert.ifError(result.error);
        assert.equal(result.status, 204);
        assert.equal(result.calls.at(-1), 'commit');
      });
    }
  }
}

for (const [name, options] of [
  ['cross-school', { schoolId: 2 }],
  ['inactive core period', { termActive: false }],
  ['inactive elective period', { kind: 'elective', termActive: false }],
  ['published item', { published: true }],
  ['saved score', { savedScore: true }],
  ['changed submission count', { expectedSubmissionCount: 1 }]
]) {
  test(`${name} blocks admin deletion`, async () => {
    const result = await runDeletion(options);
    assert.ok(result.error, name);
    assert.equal(result.calls.at(-1), 'rollback');
    assert.equal(result.calls.some(call => String(call).startsWith('DELETE')), false);
  });
}
