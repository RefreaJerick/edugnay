const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const queries = [];
let noActiveYear = false;
const database = {
  async execute(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('FROM academic_years')) {
      if (noActiveYear) return [[]];
      if (values.includes(999)) return [[]];
      return [[{ id: 12, label: '2026–2027' }]];
    }
    if (sql.includes('FROM published_final_grades')) {
      return [[
        { grade: 'Grade 7', gradeSort: 1, subject: 'English', averageGrade: '84.5', total: 2, passing: 2, band90: 0, band80: 2, band75: 0, bandBelow75: 0 },
        { grade: 'Grade 7', gradeSort: 1, subject: 'Mathematics', averageGrade: '72', total: 1, passing: 0, band90: 0, band80: 0, band75: 0, bandBelow75: 1 }
      ]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
};
databaseModule.getDatabase = () => database;

const { getSchoolGradeSummary } = require('../controllers/reportsController');

async function call(query = {}, schoolId = 1) {
  const result = { data: null, error: null, headers: {} };
  await getSchoolGradeSummary({ user: { id: 2, schoolId, role: 'school_admin' }, query }, {
    set(name, value) { result.headers[name] = value; return this; },
    json(data) { result.data = data; return this; }
  }, error => { result.error = error; });
  return result;
}

test('school report uses published grades and the signed-in school year scope', async () => {
  queries.length = 0;
  const result = await call({ academicYearId: '12' }, 3);
  assert.equal(result.error, null);
  assert.equal(result.data.academicYear.label, '2026–2027');
  assert.deepEqual(result.data.subjectPerformance[0].rows.map(row => row.subject), ['English', 'Mathematics']);
  assert.equal(result.data.gradeOutcome.total, 3);
  assert.equal(result.data.gradeOutcome.passing, 2);
  assert.equal(result.data.gradeOutcome.failing, 1);
  const gradeQuery = queries.find(query => query.sql.includes('FROM published_final_grades'));
  assert.deepEqual(gradeQuery.values, [3, 12]);
  assert.match(gradeQuery.sql, /published_final_grades\.school_id = \?/);
  assert.match(gradeQuery.sql, /academic_years\.id = \?/);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('school report defaults to the active year in the signed-in school only', async () => {
  queries.length = 0;
  const result = await call({}, 4);
  assert.equal(result.error, null);
  const yearQuery = queries[0];
  assert.deepEqual(yearQuery.values, [4]);
  assert.match(yearQuery.sql, /school_id = \? AND status = 'active'/);
  assert.deepEqual(queries[1].values, [4, 12]);
});

test('school report rejects an academic year that does not belong to the signed-in school', async () => {
  queries.length = 0;
  const result = await call({ academicYearId: '999' }, 4);
  assert.equal(result.error?.status, 404);
  assert.equal(queries.some(query => query.sql.includes('FROM published_final_grades')), false);
});

test('school report returns an empty result when no active year exists', async () => {
  queries.length = 0;
  noActiveYear = true;
  const result = await call({}, 5);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { academicYear: null, subjectPerformance: [], gradeOutcome: null });
  assert.equal(queries.length, 1);
  noActiveYear = false;
});
