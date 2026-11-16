const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.ASSIGNMENT_SUBMISSION_DIRECTORY ||= path.join(os.tmpdir(), 'academix-student-assignment-score-tests');
process.env.MATERIAL_UPLOAD_DIRECTORY ||= path.join(os.tmpdir(), 'academix-student-assignment-score-material-tests');

const databaseModule = require('../config/database');
const calls = [];
const assignments = [
  { id: 1, schoolId: 3, sectionId: 4, subjectId: 5, academicTermId: 6,
    title: 'Scored', status: 'published', onlineSubmissionEnabled: 1, gradingItemId: 11, maxScore: 20 },
  { id: 2, schoolId: 3, sectionId: 4, subjectId: 5, academicTermId: 6,
    title: 'Awaiting score', status: 'published', onlineSubmissionEnabled: 1, gradingItemId: 12, maxScore: 20 },
  { id: 3, schoolId: 3, sectionId: 4, subjectId: 5, academicTermId: 6,
    title: 'Classroom', status: 'published', onlineSubmissionEnabled: 0, gradingItemId: 13, maxScore: 20 },
  { id: 4, schoolId: 3, sectionId: 4, subjectId: 5, academicTermId: 6,
    title: 'No grading item', status: 'published', onlineSubmissionEnabled: 1, gradingItemId: null, maxScore: null }
];
databaseModule.getDatabase = () => ({
  async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM assignments LEFT JOIN sections')) return [assignments];
    if (sql.includes('FROM assignment_submissions WHERE')) return [[]];
    if (sql.includes('FROM student_scores') && sql.includes('grading_item_id IN')) {
      return [[{ gradingItemId: 11, score: '0.00' }]];
    }
    if (sql.includes('FROM assignment_submissions') && sql.includes('own_score.score')) {
      return [[{
        id: 9, sectionId: 7, sectionName: 'Old section', subjectId: 5, academicTermId: 6,
        title: 'Old scored work', academicYearLabel: '2026-2027', academicTermName: 'Term 1',
        onlineSubmissionEnabled: 1, gradingItemId: 14, maxScore: '25.00', studentScore: '0.00',
        savedStatus: 'submitted', hasUploadedFile: 1
      }]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
});
const { listAssignments, getStudentAssignmentHistory } = require('../controllers/assignmentsController');

function response() {
  return { body: null, json(body) { this.body = body; }, set() { return this; } };
}

test('student assignment scores come only from linked online grading items', async () => {
  calls.length = 0;
  const res = response();
  let error;
  await listAssignments({ user: { role: 'student', id: 8, schoolId: 3 }, query: {} }, res,
    caught => { error = caught; });
  assert.ifError(error);
  assert.deepEqual(res.body.assignments.map(item => item.studentScore), [0, null, null, null]);
  const scoreQuery = calls.find(call => call.sql.includes('FROM student_scores'));
  assert.deepEqual(scoreQuery.values, [3, 8, 11, 12]);
  assert.match(scoreQuery.sql, /student_user_id = \?/);
});

test('previous section work includes the student’s own zero score', async () => {
  calls.length = 0;
  const res = response();
  let error;
  await getStudentAssignmentHistory({ user: { role: 'student', id: 8, schoolId: 3 } }, res,
    caught => { error = caught; });
  assert.ifError(error);
  assert.equal(res.body.history[0].studentScore, 0);
  assert.equal(res.body.history[0].maxScore, 25);
  assert.equal(res.body.history[0].gradingItemId, '14');
  const query = calls[0];
  assert.deepEqual(query.values, [3, 8]);
  assert.match(query.sql, /own_score\.student_user_id = assignment_submissions\.student_user_id/);
});
