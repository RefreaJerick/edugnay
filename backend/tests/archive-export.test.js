const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let rows = [];
const statements = [];
databaseModule.getDatabase = () => ({
  async execute(sql, values) {
    statements.push({ sql, values });
    if (sql.includes('FROM academic_years')) return [Number(values[1]) === 37 ? rows : []];
    if (sql.includes('FROM schools')) return [[{ name: "Saint Columban's College" }]];
    throw new Error(`Unexpected query: ${sql}`);
  }
});
const { exportArchiveYearPdf } = require('../controllers/archiveController');

function archiveRow(status = 'archived') {
  return {
    id: 21, schoolId: 37, label: '2025-2026', status,
    archivedAt: '2026-11-09 15:00:00', archivedBy: 'School Admin',
    archiveSnapshot: {
      students: 9, teachers: 0, sections: 2, passRate: 85.2, attendanceRate: 98.6,
      academicPeriods: [{ label: 'Term 1', period: 'Nov 6, 2025 - Dec 31, 2025', passRate: 85 }],
      sectionsTable: [{ name: 'Beta History A', grade: 'Grade 4', students: 5, passRate: 85 }]
    }
  };
}

async function runExport(yearId, schoolId = 37) {
  const response = {
    headers: {}, file: null,
    set(key, value) { this.headers[key] = value; return this; },
    send(file) { this.file = file; }
  };
  let error = null;
  await exportArchiveYearPdf(
    { params: { yearId: String(yearId) }, user: { schoolId, role: 'school_admin' } },
    response, nextError => { error = nextError; }
  );
  return { response, error };
}

test('exports the stored archive snapshot as a private PDF without writes', async () => {
  rows = [archiveRow()];
  statements.length = 0;
  const { response, error } = await runExport(21);
  assert.equal(error, null);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal(response.headers['Content-Disposition'], 'attachment; filename="school-year-archive-2025-2026.pdf"');
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(response.file.subarray(0, 5).toString(), '%PDF-');
  assert.ok(response.file.length > 1000);
  assert.ok(statements.every(({ sql }) => sql.trimStart().startsWith('SELECT')));
  assert.deepEqual(statements[0].values, [21, 37]);
});

test('rejects a year outside the school and an unarchived year', async () => {
  rows = [archiveRow()];
  statements.length = 0;
  const missing = await runExport(21, 99);
  assert.equal(missing.error.status, 404);
  assert.equal(missing.response.file, null);
  rows = [];
  const absent = await runExport(999);
  assert.equal(absent.error.status, 404);
  assert.equal(absent.response.file, null);
  rows = [archiveRow('closed')];
  const closed = await runExport(21);
  assert.equal(closed.error.status, 404);
  assert.equal(closed.response.file, null);
  assert.equal(statements.filter(({ sql }) => sql.includes('FROM schools')).length, 0);
});
