const assert = require('node:assert/strict');
const test = require('node:test');

const databaseModule = require('../config/database');
const schoolId = 12;
const adminId = 31;
let activeDatabase;
databaseModule.getDatabase = () => activeDatabase;
const controller = require('../controllers/archiveController');

function archiveSnapshot() {
  return {
    students: 3,
    sections: 1,
    teachers: 1,
    gradeCount: 2,
    passingGrades: 1,
    passRate: 50,
    attendanceRate: 80,
    academicPeriods: [],
    sectionsTable: []
  };
}

function responseRecorder() {
  return {
    result: { status: 200, data: null, committedAtResponse: false },
    status(code) { this.result.status = code; return this; },
    set() { return this; },
    json(data) { this.result.data = data; this.result.committedAtResponse = this.isCommitted?.() || false; }
  };
}

test('archive list only queries the authenticated school and reports term readiness', async () => {
  const calls = [];
  const database = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("status = 'archived'")) return [[{ id: 7, label: '2024-2025', status: 'archived' }]];
      if (sql.includes("status = 'closed'")) return [[{ id: 8, label: '2025-2026', status: 'closed' }]];
      if (sql.includes('FROM school_levels')) return [[{ enabledLevels: 2, levelsWithTerms: 2, termCount: 8, unfinishedTerms: 0 }]];
      if (sql.includes('LEFT JOIN users AS archiver')) return [[{
        id: values[0], schoolId, label: '2024-2025', status: 'archived',
        archivedAt: '2025-06-30 10:00:00', archivedBy: 'School Admin', archiveSnapshot: archiveSnapshot()
      }]];
      throw new Error(`Unexpected archive query: ${sql}`);
    }
  };
  activeDatabase = database;
  const res = responseRecorder();
  await controller.listArchives({ user: { id: adminId, schoolId } }, res, error => { throw error; });

  assert.equal(res.result.data.summary.archivedYears, 1);
  assert.equal(res.result.data.archivedYears[0].students, 3);
  assert.equal(res.result.data.archiveCandidates[0].canArchive, true);
  assert.ok(calls.every(call => call.values[0] === schoolId || call.values[1] === schoolId));
});

test('archive action commits the snapshot, sections, and audit record before returning success', async () => {
  let committed = false;
  let rolledBack = false;
  let savedSnapshot = null;
  const statements = [];
  const connection = {
    async beginTransaction() {},
    async execute(sql, values = []) {
      statements.push(sql);
      if (sql.includes('FROM academic_years') && sql.includes('FOR UPDATE')) {
        return [[{ id: 8, label: '2025-2026', status: 'closed' }]];
      }
      if (sql.includes('FROM school_levels')) return [[{ enabledLevels: 1, levelsWithTerms: 1, termCount: 4, unfinishedTerms: 0 }]];
      if (sql.includes('AS students')) return [[{
        students: 3, sections: 1, teachers: 1, gradeCount: 2,
        passingGrades: 1, attendanceCount: 5, attendedCount: 4
      }]];
      if (sql.includes('FROM academic_terms') && sql.includes('GROUP BY')) return [[[]]];
      if (sql.includes('FROM sections') && sql.includes('school_grade_levels')) return [[[]]];
      if (sql.startsWith('UPDATE academic_years')) { savedSnapshot = JSON.parse(values[1]); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('UPDATE sections') || sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
      if (sql.includes('LEFT JOIN users AS archiver')) return [[{
        id: 8, schoolId, label: '2025-2026', status: 'archived', archivedAt: '2026-06-30 12:00:00',
        archivedBy: 'School Admin', archiveSnapshot: savedSnapshot
      }]];
      throw new Error(`Unexpected archive query: ${sql}`);
    },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {}
  };
  activeDatabase = { getConnection: async () => connection };
  const res = responseRecorder();
  res.isCommitted = () => committed;
  let handlerError = null;
  await controller.archiveAcademicYear({
    params: { yearId: '8' },
    user: { id: adminId, schoolId }
  }, res, error => { handlerError = error; });

  assert.equal(handlerError, null);
  assert.equal(rolledBack, false);
  assert.equal(res.result.committedAtResponse, true);
  assert.equal(res.result.data.archive.status, 'archived');
  assert.equal(savedSnapshot.attendanceRate, 80);
  assert.ok(statements.some(sql => sql.startsWith('UPDATE sections')));
  assert.ok(statements.some(sql => sql.startsWith('INSERT INTO audit_logs')));
});

test('archive action rolls back and returns an error when any archive write fails', async () => {
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async execute(sql) {
      if (sql.includes('FROM academic_years') && sql.includes('FOR UPDATE')) return [[{ id: 8, label: '2025-2026', status: 'closed' }]];
      if (sql.includes('FROM school_levels')) return [[{ enabledLevels: 1, levelsWithTerms: 1, termCount: 4, unfinishedTerms: 0 }]];
      if (sql.includes('AS students')) return [[{ students: 0, sections: 0, teachers: 0, gradeCount: 0, passingGrades: 0, attendanceCount: 0, attendedCount: 0 }]];
      if (sql.includes('FROM academic_terms') && sql.includes('GROUP BY')) return [[[]]];
      if (sql.includes('FROM sections') && sql.includes('school_grade_levels')) return [[[]]];
      if (sql.startsWith('UPDATE academic_years') || sql.startsWith('UPDATE sections')) return [{ affectedRows: 1 }];
      if (sql.startsWith('INSERT INTO audit_logs')) throw new Error('Audit insert failed');
      throw new Error(`Unexpected archive query: ${sql}`);
    },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {}
  };
  activeDatabase = { getConnection: async () => connection };
  const res = responseRecorder();
  let handlerError = null;
  await controller.archiveAcademicYear({ params: { yearId: '8' }, user: { id: adminId, schoolId } }, res, error => { handlerError = error; });

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(res.result.data, null);
  assert.match(handlerError.message, /Audit insert failed/);
});

test('archive action rejects an open grading period without changing records', async () => {
  let writeAttempted = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async execute(sql) {
      if (sql.includes('FROM academic_years') && sql.includes('FOR UPDATE')) return [[{ id: 8, label: '2025-2026', status: 'closed' }]];
      if (sql.includes('FROM school_levels')) return [[{ enabledLevels: 1, levelsWithTerms: 1, termCount: 4, unfinishedTerms: 1 }]];
      if (sql.startsWith('UPDATE ') || sql.startsWith('INSERT ')) writeAttempted = true;
      throw new Error(`Unexpected archive query: ${sql}`);
    },
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {}
  };
  activeDatabase = { getConnection: async () => connection };
  const res = responseRecorder();
  let handlerError = null;
  await controller.archiveAcademicYear({ params: { yearId: '8' }, user: { id: adminId, schoolId } }, res, error => { handlerError = error; });

  assert.equal(handlerError.status, 409);
  assert.equal(rolledBack, true);
  assert.equal(writeAttempted, false);
  assert.equal(res.result.data, null);
});
