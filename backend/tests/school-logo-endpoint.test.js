const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'academix-school-logo-endpoint-'));
after(async () => {
  assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
  await fs.rm(testDirectory, { recursive: true, force: true });
});
process.env.SCHOOL_LOGO_DIRECTORY = testDirectory;
require('../config/schoolLogos');
delete process.env.SCHOOL_LOGO_DIRECTORY;

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const { getSchoolLogo } = require('../controllers/schoolsController');

async function callGetSchoolLogo() {
  const result = { status: 200, data: null, error: null, headers: null };
  await getSchoolLogo(
    { params: { schoolId: '19' }, user: { id: 1, role: 'platform_admin', schoolId: null } },
    {
      set(headers) { result.headers = headers; return this; },
      status(code) { result.status = code; return this; },
      send(data) { result.data = data; return this; }
    },
    error => { result.error = error; }
  );
  return result;
}

function setSchoolLogoRecord(logoPath) {
  database = {
    async execute(sql) {
      if (sql.includes('FROM schools LEFT JOIN school_settings')) {
        return [[{ id: 19, name: 'Test School', logoPath }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('school logo endpoint reads stored bytes and sends the image content type', async () => {
  const filename = '123e4567-e89b-12d3-a456-426614174000.png';
  const image = Buffer.from('test image bytes');
  await fs.writeFile(path.join(testDirectory, filename), image);
  setSchoolLogoRecord(filename);

  const result = await callGetSchoolLogo();
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, image);
  assert.equal(result.headers['Content-Type'], 'image/png');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['Cross-Origin-Resource-Policy'], 'cross-origin');
});

test('school logo endpoint returns a clear not-found error for missing files', async () => {
  setSchoolLogoRecord('223e4567-e89b-12d3-a456-426614174000.png');
  const result = await callGetSchoolLogo();
  assert.equal(result.error.status, 404);
  assert.equal(result.error.message, 'School logo not found.');
});

test('school logo endpoint does not serve legacy project assets after migration', async () => {
  setSchoolLogoRecord('/assets/images/st-columban-logo.png');
  const result = await callGetSchoolLogo();
  assert.equal(result.error.status, 404);
  assert.equal(result.error.message, 'School logo not found.');
});
