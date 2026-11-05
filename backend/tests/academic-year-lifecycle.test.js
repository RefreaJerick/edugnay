const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const controller = require('../controllers/academicTermsController');

const schoolId = 12;
const yearId = 8;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDate = (value, days) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function fixture({ status = 'active', finalEnd = shiftDate(today, -1), termStatus = 'closed', count = 2, activeYear = false } = {}) {
  const state = {
    year: { id: yearId, schoolId, label: '2025-2026', startDate: '2020-01-01', endDate: '2099-12-31', status },
    terms: [
      { id: 1, schoolLevelId: 3, sequenceNumber: 1, name: 'Semester 1', plannedStartDate: '2020-01-02', plannedEndDate: '2020-06-01', status: termStatus },
      { id: 2, schoolLevelId: 3, sequenceNumber: 2, name: 'Semester 2', plannedStartDate: '2020-06-02', plannedEndDate: finalEnd, status: termStatus }
    ].slice(0, count),
    calls: [], commits: 0, rollbacks: 0, currentLabel: null
  };
  const execute = async (sql, values = []) => {
    state.calls.push({ sql, values });
    if (sql.startsWith('SELECT id FROM schools')) return [[{ id: schoolId }]];
    if (sql.includes('FROM academic_years WHERE id = ? AND school_id = ?')) {
      return [Number(values[1]) === schoolId && Number(values[0]) === yearId ? [{ ...state.year }] : []];
    }
    if (sql.includes('FROM academic_terms') && sql.includes('INNER JOIN academic_years')) {
      return [[{ id: 1, academicYearId: yearId, schoolLevelId: 3, status: state.terms[0].status,
        academicYearStatus: state.year.status, academicYearStartDate: state.year.startDate,
        academicYearEndDate: state.year.endDate }]];
    }
    if (sql.includes('FROM school_levels WHERE id = ? AND school_id = ?')) return [[{ id: 3, isEnabled: true, gradingPeriodType: 'semestral' }]];
    if (sql.includes('FROM school_levels WHERE school_id = ? AND is_enabled = 1')) return [[{ id: 3, displayName: 'Elementary', gradingPeriodType: 'semestral' }]];
    if (sql.includes('FROM academic_terms WHERE academic_year_id = ? AND school_id = ?')) return [state.terms.map(term => ({ ...term }))];
    if (sql.includes("FROM academic_years WHERE school_id = ? AND status = 'active'")) return [activeYear ? [{ id: 99 }] : []];
    if (sql.startsWith('UPDATE academic_years SET status')) {
      state.year.status = sql.includes("status = 'closed'") ? 'closed' : 'active';
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO school_settings')) { state.currentLabel = values[1]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const connection = {
    execute, async beginTransaction() {}, async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; }, release() {}
  };
  database = { execute, getConnection: async () => connection };
  return state;
}

async function run(handler, id = yearId, body = {}) {
  const result = { error: null, data: null };
  await handler({ params: { yearId: String(id), termId: '1', action: 'activate' }, body, user: { id: 31, schoolId } }, {
    json(data) { result.data = data; }, status() { return this; }
  }, error => { result.error = error; });
  return result;
}

test('closes a complete school year only after its inclusive final term date', async () => {
  const state = fixture();
  const result = await run(controller.closeAcademicYear);
  assert.equal(result.error, null);
  assert.equal(result.data.academicYear.status, 'closed');
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  assert.ok(state.calls.some(call => call.sql.includes('FROM academic_terms') && call.sql.includes('FOR UPDATE')));
  assert.ok(state.calls.some(call => call.sql.startsWith('INSERT INTO audit_logs') && call.values[2] === 'academic_year_closed'));
  assert.equal(state.currentLabel, null, 'closing does not activate or archive a different year');
  const duplicate = await run(controller.closeAcademicYear);
  assert.equal(duplicate.error.status, 409);
  assert.equal(state.commits, 1);
});

test('rejects closure on or before the final end date and with missing or open terms', async () => {
  for (const options of [
    { finalEnd: today }, { finalEnd: shiftDate(today, 1) }, { count: 1 }, { termStatus: 'active' }, { status: 'upcoming' }
  ]) {
    const state = fixture(options);
    const result = await run(controller.closeAcademicYear);
    assert.equal(result.error.status, 409);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
    assert.equal(state.year.status, options.status || 'active');
  }
});

test('rejects another school’s year and legacy status changes', async () => {
  const state = fixture();
  assert.equal((await run(controller.closeAcademicYear, 999)).error.status, 404);
  assert.equal((await run(controller.updateAcademicYear, yearId, { status: 'closed' })).error.status, 409);
  assert.equal(state.commits, 0);
});

test('activates only a complete upcoming year and updates the current label', async () => {
  const state = fixture({ status: 'upcoming', termStatus: 'upcoming' });
  const result = await run(controller.activateAcademicYear);
  assert.equal(result.error, null);
  assert.equal(result.data.academicYear.status, 'active');
  assert.equal(state.currentLabel, '2025-2026');
  assert.equal(state.commits, 1);
  assert.ok(state.calls.some(call => call.sql.startsWith('INSERT INTO audit_logs') && call.values[2] === 'academic_year_activated'));
  assert.equal((await run(controller.activateAcademicYear)).error.status, 409);
});

test('rejects activation with an incomplete schedule, changed term, active year, or closed year', async () => {
  for (const options of [
    { status: 'upcoming', termStatus: 'upcoming', count: 1 },
    { status: 'upcoming', termStatus: 'closed' },
    { status: 'upcoming', termStatus: 'upcoming', activeYear: true },
    { status: 'closed', termStatus: 'closed' }
  ]) {
    const state = fixture(options);
    const result = await run(controller.activateAcademicYear);
    assert.equal(result.error.status, 409);
    assert.equal(state.commits, 0);
    assert.equal(state.currentLabel, null);
  }
});

test('closed years reject term creation, term editing, and term activation', async () => {
  const state = fixture({ status: 'closed', termStatus: 'upcoming' });
  const newTerm = await run(controller.createAcademicTerm, yearId, {
    academicYearId: yearId, schoolLevelId: 3, sequenceNumber: 1,
    name: 'Semester 1', plannedStartDate: '2027-01-01', plannedEndDate: '2027-06-01'
  });
  assert.equal(newTerm.error.status, 409);
  const edit = await run(controller.updateAcademicTerm, yearId, { name: 'Changed' });
  assert.equal(edit.error.status, 409);
  const action = await run(controller.termAction, yearId);
  assert.equal(action.error.status, 409);
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 3);
});

test('rollover creates an upcoming year and fresh upcoming term records', async () => {
  const state = { calls: [], nextTermId: 100, year: null, terms: [] };
  const execute = async (sql, values = []) => {
    state.calls.push(sql);
    if (sql.startsWith('SELECT id FROM schools')) return [[{ id: schoolId }]];
    if (sql.includes("FROM academic_years WHERE school_id = ? AND status = 'active'")) return [[]];
    if (sql.includes("FROM academic_years WHERE school_id = ? AND status = 'upcoming'")) return [[]];
    if (sql.startsWith('INSERT INTO academic_years')) {
      state.year = { id: 9, schoolId, label: values[1], startDate: values[2], endDate: values[3], status: values[4] };
      return [{ insertId: 9 }];
    }
    if (sql.includes('FROM subject_grading_profiles AS profiles')) return [[]];
    if (sql.includes('FROM academic_years WHERE id = ? AND school_id = ?')) return [[state.year]];
    if (sql.includes('FROM school_levels WHERE id = ? AND school_id = ?')) return [[{ id: 3, isEnabled: true, gradingPeriodType: 'semestral' }]];
    if (sql.startsWith('INSERT INTO academic_terms')) {
      const id = ++state.nextTermId;
      state.terms.push({ id, status: 'upcoming', values });
      return [{ insertId: id }];
    }
    if (sql.includes('FROM academic_terms') && sql.includes('INNER JOIN academic_years')) {
      const term = state.terms.find(item => item.id === Number(values[0]));
      return [[{ id: term.id, status: term.status, academicYearId: 9 }]];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const connection = { execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
  database = { execute, getConnection: async () => connection };
  const create = await run(controller.createAcademicYear, yearId, {
    label: '2027-2028', startDate: '2027-07-01', endDate: '2028-06-30'
  });
  assert.equal(create.error, null);
  assert.equal(create.data.academicYear.status, 'upcoming');
  for (const [sequenceNumber, start, end] of [[1, '2027-07-01', '2027-12-31'], [2, '2028-01-01', '2028-06-30']]) {
    const created = await run(controller.createAcademicTerm, yearId, {
      academicYearId: 9, schoolLevelId: 3, sequenceNumber,
      name: `Semester ${sequenceNumber}`, plannedStartDate: start, plannedEndDate: end
    });
    assert.equal(created.error, null);
  }
  assert.deepEqual(state.terms.map(term => term.id), [101, 102]);
  assert.ok(state.terms.every(term => term.status === 'upcoming'));
  assert.equal(state.year.status, 'upcoming');
  assert.ok(state.calls.filter(sql => sql === 'SELECT id FROM schools WHERE id = ? FOR UPDATE').length === 3);
});
