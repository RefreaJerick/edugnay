const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

const queries = [];
const connection = {
  async beginTransaction() { queries.push('begin'); },
  async commit() { queries.push('commit'); },
  async rollback() { queries.push('rollback'); },
  release() {},
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith('INSERT INTO schools')) return [{ insertId: 20 }];
    if (sql.startsWith('INSERT INTO school_levels')) return [{ insertId: 30 }];
    if (sql.startsWith('INSERT INTO academic_years')) return [{ insertId: 40 }];
    if (sql.startsWith('INSERT INTO users')) return [{ insertId: 50 }];
    if (sql.includes("role = 'platform_admin'")) return [[]];
    return [[]];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection });
const { registerSchool } = require('../controllers/schoolsController');

function registration() {
  return {
    name: 'Sample School', email: 'school@example.com', notificationEmail: 'notify@example.com',
    schoolLevels: ['jhs'], currentSchoolYearLabel: '2026-2027',
    schoolYearStartDate: '2026-08-01', schoolYearEndDate: '2027-05-31',
    academicTermConfigs: [{
      schoolLevel: 'jhs', gradingPeriodType: 'three_term', academicPeriods: [
        { name: 'Term 1', plannedStartDate: '2026-08-01', plannedEndDate: '2026-10-31' },
        { name: 'Term 2', plannedStartDate: '2026-11-01', plannedEndDate: '2027-02-28' },
        { name: 'Term 3', plannedStartDate: '2027-03-01', plannedEndDate: '2027-05-31' }
      ]
    }],
    initialAdministrator: {
      firstName: 'School', lastName: 'Admin', schoolEmail: 'admin@example.com',
      temporaryPassword: 'a-long-test-password'
    }
  };
}

async function call(body) {
  const result = { code: null, data: null, error: null };
  await registerSchool({ body }, {
    status(code) { result.code = code; return this; },
    json(data) { result.data = data; }
  }, error => { result.error = error; });
  return result;
}

test('registration saves the school, academic periods, and pending administrator together', async () => {
  queries.length = 0;
  const result = await call(registration());
  assert.equal(result.error, null);
  assert.equal(result.code, 201);
  assert.equal(result.data.school.id, 20);
  assert.equal(queries.filter(item => item.sql?.startsWith('INSERT INTO academic_terms')).length, 3);
  assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO academic_years')));
  assert.ok(queries.some(item => item.sql?.startsWith('INSERT INTO users') && item.values.includes('admin@example.com')));
  assert.equal(queries.at(-1), 'commit');
});

test('registration rejects an incomplete period structure before writing', async () => {
  queries.length = 0;
  const body = registration();
  body.academicTermConfigs[0].academicPeriods.pop();
  const result = await call(body);
  assert.equal(result.error.status, 400);
  assert.equal(queries.length, 0);
});
