const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');

function schoolDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offset))
    .toISOString().slice(0, 10);
}

function assignment(id, title, onlineSubmissionEnabled, dueDate) {
  return {
    id, schoolId: 3, sectionId: 12, subjectId: 44, electiveClassId: null,
    academicTermId: 8, gradingCategoryId: null, subjectGradingComponentId: null,
    subjectGradingExamPartId: null, gradingItemId: null, teacherUserId: 6,
    title, description: '', dueAt: `${dueDate}T12:00:00`, maxScore: null,
    onlineSubmissionEnabled, status: 'published', createdAt: `${dueDate}T08:00:00`,
    updatedAt: `${dueDate}T08:00:00`, sectionName: 'St. Matthew', sectionGrade: 'Grade 7',
    electiveGrade: null, electiveClassName: null, currentClassTeacherId: null,
    sectionYearStatus: 'active', electiveYearStatus: null, academicYearStatus: 'active',
    subjectName: 'English', academicTermName: 'Quarter 1', gradingCategoryCode: null,
    gradingCategoryName: null, subjectGradingComponentCode: null,
    subjectGradingComponentName: null, subjectGradingExamPartCode: null,
    subjectGradingExamPartName: null, teacherName: 'Teacher'
  };
}

test('student assignment list uses the shared effective status and hides orphan subjects', async () => {
  const today = schoolDate();
  const yesterday = schoolDate(-1);
  const assignments = [
    assignment(1, 'Uploaded online work', 1, today),
    assignment(2, 'Online work without file', 1, today),
    assignment(3, 'Teacher-recorded class work', 0, today),
    assignment(4, 'Overdue online work', 1, yesterday)
  ];
  const submissionRows = [
    { assignmentId: 1, savedStatus: 'submitted', filePath: '/private/work.pdf', submittedAt: `${today}T08:00:00` },
    { assignmentId: 2, savedStatus: 'submitted', filePath: null, submittedAt: `${today}T08:00:00` },
    { assignmentId: 3, savedStatus: 'submitted', filePath: null, submittedAt: null },
    { assignmentId: 4, savedStatus: null, filePath: null, submittedAt: null }
  ];
  const calls = [];
  const previousDatabase = databaseModule.getDatabase;
  const previousSelectionFlag = process.env.SHS_SELECTION_ENABLED;
  databaseModule.getDatabase = () => ({
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM assignments LEFT JOIN sections')) return [assignments];
      if (sql.includes('FROM assignment_submissions WHERE school_id = ? AND student_user_id = ?')) return [submissionRows];
      throw new Error(`Unexpected query: ${sql}`);
    }
  });
  process.env.SHS_SELECTION_ENABLED = 'false';

  try {
    const { listAssignments } = require('../controllers/assignmentsController');
    let body;
    let error;
    await listAssignments({ user: { id: 14, schoolId: 3, role: 'student' }, query: {} }, {
      json(value) { body = value; return this; }
    }, value => { error = value; });

    assert.equal(error, undefined);
    assert.deepEqual(body.assignments.map(item => item.submissionStatus), [
      'submitted', 'pending', 'submitted', 'not_submitted'
    ]);
    const listQuery = calls.find(call => call.sql.includes('FROM assignments LEFT JOIN sections'));
    assert.match(listQuery.sql, /assignments\.subject_id IS NOT NULL AND subjects\.is_active = TRUE/);
    assert.match(listQuery.sql, /assignments\.status = 'published'/);
    assert.deepEqual(calls.find(call => call.sql.includes('FROM assignment_submissions WHERE school_id')).values,
      [3, 14, 1, 2, 3, 4]);
  } finally {
    databaseModule.getDatabase = previousDatabase;
    if (previousSelectionFlag === undefined) delete process.env.SHS_SELECTION_ENABLED;
    else process.env.SHS_SELECTION_ENABLED = previousSelectionFlag;
  }
});
