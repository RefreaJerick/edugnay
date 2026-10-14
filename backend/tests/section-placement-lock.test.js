const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

let state;
let calls;
const connection = {
  async beginTransaction() { calls.push('begin'); },
  async commit() { calls.push('commit'); },
  async rollback() { calls.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('SELECT id FROM sections') && sql.includes('FOR UPDATE')) return [[{ id: 8 }]];
    if (sql.includes('FROM sections') && sql.includes('academic_years.status AS academicYearStatus')) return [[{ ...state }]];
    if (sql.includes('FROM users WHERE id = ?') && sql.includes("role = 'teacher'")) return [[{ id: 22 }]];
    if (sql.startsWith('UPDATE sections SET')) {
      state.name = values[0];
      state.capacity = values[1];
      state.adviserUserId = values[2];
      state.status = values[3];
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  }
};
const database = { getConnection: async () => connection, execute: (...args) => connection.execute(...args) };
databaseModule.getDatabase = () => database;
const { updateSection } = require('../controllers/sectionsController');

async function update(body) {
  calls = [];
  state = {
    id: 8, schoolId: 1, academicYearId: 3, schoolLevelId: 2,
    gradeLevelId: 7, strandId: 12, academicYearStatus: 'active',
    name: 'Old', capacity: 40, studentCount: 1, adviserUserId: null, status: 'active'
  };
  const result = { error: null, body: null };
  await updateSection({ user: { id: 5, schoolId: 1 }, params: { sectionId: '8' }, body }, {
    json(value) { result.body = value; }
  }, error => { result.error = error; });
  return result;
}

test('section edit accepts omitted or unchanged placement IDs and updates mutable fields', async () => {
  for (const placement of [{}, { academicYearId: 3, schoolLevelId: 2, gradeLevelId: 7, strandId: 12 }]) {
    const result = await update({ ...placement, name: 'New', capacity: 42, adviserUserId: 22 });
    assert.equal(result.error, null);
    assert.equal(result.body.section.name, 'New');
    assert.deepEqual([state.academicYearId, state.schoolLevelId, state.gradeLevelId, state.strandId], [3, 2, 7, 12]);
    const statement = calls.find(call => call.sql?.startsWith('UPDATE sections SET'));
    assert.doesNotMatch(statement.sql, /academic_year_id|school_level_id|grade_level_id|strand_id/);
    assert.ok(calls.includes('commit'));
  }
});

test('section edit rejects every placement change and rolls back without updating records', async () => {
  for (const change of [{ academicYearId: 4 }, { schoolLevelId: 1 }, { gradeLevelId: 8 },
    { strandId: 13 }, { strandId: null }, { strandId: '' }]) {
    const result = await update({ ...change, name: 'New' });
    assert.equal(result.error.status, 409);
    assert.equal(state.name, 'Old');
    assert.equal(calls.some(call => call.sql?.startsWith('UPDATE sections SET')), false);
    assert.equal(calls.some(call => call.sql?.includes('INSERT INTO audit_logs')), false);
    assert.ok(calls.includes('rollback'));
  }
});

test('disabled saved placement does not block a mutable edit', async () => {
  const result = await update({ name: 'New' });
  assert.equal(result.error, null);
  assert.equal(calls.some(call => call.sql?.includes('school_grade_levels WHERE id = ?')), false);
});
