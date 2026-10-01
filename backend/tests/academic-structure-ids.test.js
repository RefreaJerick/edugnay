const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { getAcademicStructure } = require('../controllers/schoolsController');

test('academic structure includes school-scoped grade and track IDs for class management', async () => {
  const queries = [];
  database = {
    async execute(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('FROM school_levels WHERE')) {
        return [[{ id: 3, levelCode: 'shs', isEnabled: 1, passingGradeThreshold: 75 }]];
      }
      if (sql.includes('FROM school_grade_levels')) {
        return [[{ id: 8, schoolLevelId: 3, gradeCode: 'grade-11', displayName: 'Grade 11', isEnabled: 1 }]];
      }
      return [[{ id: 13, schoolLevelId: 3, trackCode: 'academic', displayName: 'Academic', isEnabled: 1 }]];
    }
  };
  let result;
  let failure;
  await getAcademicStructure(
    { user: { role: 'school_admin', schoolId: 12 } },
    { status() { return this; }, json(body) { result = body; } },
    error => { failure = error; }
  );

  assert.equal(failure, undefined);
  assert.equal(result.levels[0].gradeLevels[0].id, 8);
  assert.equal(result.levels[0].tracks[0].id, 13);
  assert.equal(result.levels[0].gradeLevels[0].isEnabled, true);
  assert.equal(result.levels[0].tracks[0].isEnabled, true);
  assert.equal(queries.length, 3);
  assert.ok(queries.every(query => query.values[0] === 12));
  assert.match(queries[1].sql, /school_grade_levels\.id/);
  assert.match(queries[2].sql, /school_shs_tracks\.id/);
});
