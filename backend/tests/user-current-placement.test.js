const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
const userRows = [
  { id: 10, schoolId: 1, role: 'student', firstName: 'Juan', lastName: 'Cruz', displayName: 'Juan Cruz', initials: 'JC', accountStatus: 'active' },
  { id: 11, schoolId: 1, role: 'student', firstName: 'Maya', lastName: 'Torres', displayName: 'Maya Torres', initials: 'MT', accountStatus: 'active' },
  { id: 12, schoolId: 1, role: 'teacher', firstName: 'Maria', lastName: 'Reyes', displayName: 'Maria Reyes', initials: 'MR', accountStatus: 'active' }
];
const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith('SELECT COUNT(*) AS total FROM users')) return [[{ total: userRows.length }]];
    if (sql.includes('FROM users') && sql.includes('ORDER BY users.last_name')) return [userRows];
    if (sql.includes('FROM section_students')) return [[{
      studentId: 10, sectionId: 8, sectionName: 'St. Matthew', gradeLevel: 'Grade 7',
      schoolLevel: 'junior_high', strand: null, academicYearLabel: '2026–2027'
    }]];
    if (sql.includes('FROM users') && sql.includes('LIMIT 1')) return [[userRows[0]]];
    throw new Error(`Unexpected query: ${sql}`);
  }
};
databaseModule.getDatabase = () => database;

const { getAccountSetupStatus, getUser, listUsers } = require('../controllers/usersController');

async function call(handler, req) {
  const result = { status: 200, data: null, error: null };
  await handler(req, {
    status(code) { result.status = code; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

const schoolAdmin = { id: 2, schoolId: 1, role: 'school_admin' };

test('admin user list uses current active enrollment for student placement', async () => {
  queries.length = 0;
  const result = await call(listUsers, { user: schoolAdmin, query: { page: '1', limit: '25' } });
  assert.equal(result.error, null);
  assert.equal(result.data.users[0].sectionId, '8');
  assert.equal(result.data.users[0].sectionName, 'St. Matthew');
  assert.equal(result.data.users[0].gradeLevel, 'Grade 7');
  assert.equal(result.data.users[0].academicYearLabel, '2026–2027');
  assert.equal(result.data.users[1].sectionId, null);
  assert.equal(result.data.users[2].sectionName, undefined);
  const placementQuery = queries.find(query => query.sql.includes('FROM section_students'));
  assert.deepEqual(placementQuery.values, [10, 11]);
  assert.match(placementQuery.sql, /sections\.status = 'active'/);
  assert.match(placementQuery.sql, /academic_years\.status = 'active'/);
  assert.match(placementQuery.sql, /section_students\.withdrawn_at IS NULL/);
  assert.match(placementQuery.sql, /students\.school_id = sections\.school_id/);
});

test('admin user details returns the same database-backed current placement', async () => {
  queries.length = 0;
  const result = await call(getUser, { user: schoolAdmin, params: { userId: '10' } });
  assert.equal(result.error, null);
  assert.equal(result.data.user.sectionId, '8');
  assert.equal(result.data.user.sectionName, 'St. Matthew');
  assert.deepEqual(queries[0].values, [10, 1]);
  assert.match(queries[0].sql, /users\.school_id = \?/);
});

test('student setup requires a country but not a birth province', async () => {
  const student = userRows[0];
  Object.assign(student, {
    lrn: '100201000015', studentSex: 'male', studentBirthDate: '2013-01-10',
    studentBirthPlace: 'Jabriya', studentBirthPlaceRegion: null, studentBirthCountry: null,
    studentMotherTongue: 'Arabic', studentReligion: 'Islam',
    studentHouseStreet: 'Street 1', studentBarangay: 'Area 1',
    studentCityMunicipality: 'City', studentProvince: 'Region'
  });
  const missing = await call(getAccountSetupStatus, { user: { id: 10, schoolId: 1, role: 'student' } });
  assert.deepEqual(missing.data.setup.missingFields, ['birthCountry']);
  student.studentBirthCountry = 'Kuwait';
  const complete = await call(getAccountSetupStatus, { user: { id: 10, schoolId: 1, role: 'student' } });
  assert.equal(complete.data.setup.complete, true);
});
