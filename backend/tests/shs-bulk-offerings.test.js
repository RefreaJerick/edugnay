const test = require('node:test');
const assert = require('node:assert/strict');
const databaseModule = require('../config/database');
const { catalog } = require('../config/shsApprovedCatalog');
let database;
databaseModule.getDatabase = () => database;
const { activate } = require('../controllers/shsProgramController');

function fixture(failSecond = false) {
  const calls = { inserted: [], transactions: [] };
  const connection = {
    async beginTransaction() { calls.transactions.push('begin'); },
    async commit() { calls.transactions.push('commit'); },
    async rollback() { calls.transactions.push('rollback'); },
    release() {},
    async execute(sql, values) {
      if (sql.includes('FROM academic_years')) return [[{ id: 4, label: '2027-2028', status: 'active' }]];
      if (sql.includes('FROM school_grade_levels')) return [[{ id: 7, gradeCode: 'grade-12' }]];
      if (sql.includes('FROM school_shs_tracks')) return [[{ trackCode: 'academic' }, { trackCode: 'techpro' }]];
      if (sql.includes('FROM audit_logs') || sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 10 }];
      if (sql.startsWith('SELECT id FROM academic_years')) return [[{ id: 4 }]];
      if (sql.startsWith('INSERT INTO shs_offerings')) {
        if (failSecond && calls.inserted.length === 1) throw Object.assign(new Error('Duplicate offering'), { code: 'ER_DUP_ENTRY' });
        calls.inserted.push(values[4]);
        return [{ insertId: calls.inserted.length }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  database = { getConnection: async () => connection };
  return calls;
}
async function call(codes) {
  const result = { status: 200 };
  await activate({ user: { id: 3, schoolId: 2 }, body: { academicYearId: 4, gradeLevelId: 7, catalogCodes: codes } },
    { status(code) { result.status = code; return this; }, json(value) { result.body = value; } },
    error => { result.error = error; });
  return result;
}
const choices = catalog.filter(item => item.type === 'academic_elective' && item.grades.includes(12)).slice(0, 2).map(item => item.code);

test('bulk offering save validates and inserts multiple catalog subjects in one transaction', async () => {
  const calls = fixture();
  const result = await call(choices);
  assert.equal(result.error, undefined);
  assert.equal(result.body.added.length, 2);
  assert.deepEqual(calls.inserted, choices);
  assert.deepEqual(calls.transactions, ['begin', 'commit']);
});

test('bulk offering save rejects duplicate choices before writing and rolls back failed inserts', async () => {
  const calls = fixture();
  const duplicate = await call([choices[0], choices[0]]);
  assert.match(duplicate.error.message, /distinct/);
  assert.equal(calls.inserted.length, 0);
  const failing = fixture(true);
  const result = await call(choices);
  assert.equal(result.error.code, 'ER_DUP_ENTRY');
  assert.deepEqual(failing.transactions, ['begin', 'rollback']);
});
