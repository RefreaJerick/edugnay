const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');

const original = {
  id: 10, schoolId: 1, role: 'student', firstName: 'Juan', lastName: 'Cruz',
  lrn: '100201000015', studentSex: 'male', studentBirthDate: '2013-01-10',
  studentBirthPlace: 'Jabriya', studentBirthPlaceRegion: null, studentBirthCountry: null,
  studentMotherTongue: 'Arabic', studentReligion: 'Islam',
  studentHouseStreet: '123', studentBarangay: 'Area 1',
  studentCityMunicipality: 'City', studentProvince: 'Region'
};
let saved;
let pending;
let commits;
let rollbacks;

function updateRow(sql, values) {
  const row = pending || saved;
  const columns = {
    birth_place: 'studentBirthPlace', birth_place_region: 'studentBirthPlaceRegion',
    birth_country: 'studentBirthCountry', house_street: 'studentHouseStreet',
    contact_number: sql.startsWith('UPDATE parent_profiles') ? 'parentContactNumber' : 'studentContactNumber',
    middle_name: 'studentMiddleName'
  };
  sql.match(/SET (.+) WHERE user_id/)[1].split(', ').forEach((assignment, index) => {
    const column = assignment.split(' = ')[0];
    if (columns[column]) row[columns[column]] = values[index];
  });
  return [{ affectedRows: 1 }];
}

const connection = {
  async beginTransaction() { pending = { ...saved }; },
  async execute(sql, values) {
    if (sql.startsWith('UPDATE student_profiles') || sql.startsWith('UPDATE parent_profiles')) return updateRow(sql, values);
    if (sql.startsWith('SELECT')) return [[pending || saved]];
    if (sql.startsWith('UPDATE users')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  },
  async commit() { saved = pending; pending = null; commits += 1; },
  async rollback() { pending = null; rollbacks += 1; },
  release() {}
};
databaseModule.getDatabase = () => ({
  getConnection: async () => connection,
  execute: connection.execute.bind(connection)
});
const { completeAccountSetup, updateMyProfile } = require('../controllers/usersController');

async function call(handler, body, role = 'student') {
  const result = { status: 200, body: null, error: null };
  await handler({ user: { id: 10, schoolId: 1, role }, body }, {
    status(code) { result.status = code; return this; },
    json(value) { result.body = value; return this; }
  }, error => { result.error = error; });
  return result;
}

function reset() {
  saved = { ...original };
  pending = null;
  commits = 0;
  rollbacks = 0;
}

test('account setup accepts blank optional text and a numeric-looking street', async () => {
  reset();
  const result = await call(completeAccountSetup, {
    birthPlace: 'Jabriya', birthPlaceRegion: null, birthCountry: 'Kuwait',
    houseStreet: '123', contactNumber: null, middleName: null
  });
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(saved.studentBirthCountry, 'Kuwait');
  assert.equal(saved.studentBirthPlaceRegion, null);
  assert.equal(saved.studentHouseStreet, '123');
  assert.equal(commits, 1);
});

test('missing required country rolls back the profile update', async () => {
  reset();
  const result = await call(completeAccountSetup, { birthPlace: 'Jabriya', birthCountry: null });
  assert.equal(result.status, 400);
  assert.deepEqual(result.body.setup.missingFields, ['birthCountry']);
  assert.equal(saved.studentBirthCountry, null);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
});

test('missing required place rolls back the profile update', async () => {
  reset();
  const result = await call(completeAccountSetup, { birthPlace: null, birthCountry: 'Kuwait' });
  assert.equal(result.status, 400);
  assert.ok(result.body.setup.missingFields.includes('birthPlace'));
  assert.equal(saved.studentBirthPlace, 'Jabriya');
  assert.equal(rollbacks, 1);
});

test('real numbers and objects are rejected as profile text', async () => {
  for (const houseStreet of [123, { value: '123' }]) {
    reset();
    const result = await call(completeAccountSetup, { houseStreet });
    assert.match(result.error.message, /Profile fields must be text/);
    assert.equal(commits, 0);
  }
});

test('overlong text is rejected and later profile edits can clear optional text', async () => {
  reset();
  const invalid = await call(updateMyProfile, { birthCountry: 'x'.repeat(121) });
  assert.match(invalid.error.message, /too long/);
  const valid = await call(updateMyProfile, { contactNumber: null });
  assert.equal(valid.error, null);
  assert.equal(valid.status, 200);
});

test('parent profile edits can clear optional text', async () => {
  reset();
  saved.role = 'parent';
  saved.parentContactNumber = '09171234567';
  const result = await call(updateMyProfile, { contactNumber: null }, 'parent');
  assert.equal(result.error, null);
  assert.equal(result.body.user.profile.contactNumber, null);
});
