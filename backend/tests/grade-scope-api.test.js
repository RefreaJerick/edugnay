const assert = require('node:assert/strict');
const test = require('node:test');
const databaseModule = require('../config/database');
const auditModule = require('../utils/auditLog');

let database;
databaseModule.getDatabase = () => database;
auditModule.writeAuditLog = async () => {};

const { updateAcademicStructure } = require('../controllers/schoolsController');
const { createSection } = require('../controllers/sectionsController');

function useDatabase(execute) {
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() {},
    async execute(sql, values = []) {
      events.push({ sql, values });
      return execute(sql, values);
    }
  };
  database = { getConnection: async () => connection, execute: connection.execute.bind(connection) };
  return events;
}

async function invoke(handler, req) {
  const response = { statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; } };
  let error = null;
  await handler(req, response, nextError => { error = nextError; });
  return { response, error };
}

test('school structure API rejects Kindergarten and Grade 1 codes', async () => {
  for (const gradeCode of ['kindergarten', 'grade-1']) {
    const events = useDatabase(sql => {
      if (sql.startsWith('INSERT INTO school_levels')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT id FROM school_levels')) return [[{ id: 20 }]];
      return [[]];
    });
    const result = await invoke(updateAcademicStructure, {
      user: { role: 'school_admin', schoolId: 5 },
      body: { levels: [{
        levelCode: 'elementary', isEnabled: true,
        gradeLevels: [{ id: 394, gradeCode, displayName: gradeCode, isEnabled: true }]
      }] }
    });

    assert.match(result.error?.message || '', /grade-level configuration is invalid/i, gradeCode);
    assert.ok(events.includes('rollback'), gradeCode);
    assert.equal(events.some(event => typeof event === 'object' && event.sql.startsWith('INSERT INTO school_grade_levels')), false, gradeCode);
  }
});

test('section API rejects legacy grade IDs and accepts a Grade 2 section', async () => {
  for (const gradeCode of ['kindergarten', 'grade-1']) {
    const events = useDatabase(sql => {
      if (sql.includes('SELECT id, label, status FROM academic_years')) {
        return [[{ id: 10, label: '2026-2027', status: 'active' }]];
      }
      if (sql.includes('SELECT id, level_code AS levelCode')) {
        return [[{ id: 11, levelCode: 'elementary', isEnabled: 1 }]];
      }
      if (sql.includes('SELECT id, grade_code AS gradeCode')) {
        return [[{ id: 394, gradeCode }]];
      }
      return [[]];
    });
    const result = await invoke(createSection, {
      user: { role: 'school_admin', schoolId: 5 },
      body: { name: `Legacy ${gradeCode}`, capacity: 30, academicYearId: 10,
        schoolLevelId: 11, gradeLevelId: 394 }
    });

    assert.equal(result.error?.status, 404, gradeCode);
    assert.match(result.error?.message || '', /grade level is invalid/i, gradeCode);
    assert.ok(events.includes('rollback'), gradeCode);
    assert.equal(events.some(event => typeof event === 'object' && event.sql.startsWith('INSERT INTO sections')), false, gradeCode);
  }

  const sectionRow = {
    id: 101, schoolId: 5, academicYearId: 10, academicYearLabel: '2026-2027', academicYearStatus: 'active',
    academicYearStartDate: '2026-08-01', academicYearEndDate: '2027-05-31', schoolLevelId: 11,
    schoolLevelCode: 'elementary', schoolLevelName: 'Elementary', gradeLevelId: 12,
    gradeCode: 'grade-2', gradeLevelName: 'Grade 2', trackId: null, trackCode: null, trackName: null,
    strandId: null, strandCode: null, strandName: null, needsCurriculumSetup: 0, name: 'Section A',
    capacity: 30, studentCount: 0, adviserUserId: null, adviserName: null,
    adviserAvatarFilename: null, adviserAvatarVersion: null, status: 'active'
  };
  const events = useDatabase(sql => {
    if (sql.includes('SELECT id, label, status FROM academic_years')) {
      return [[{ id: 10, label: '2026-2027', status: 'active' }]];
    }
    if (sql.includes('SELECT id, level_code AS levelCode')) {
      return [[{ id: 11, levelCode: 'elementary', isEnabled: 1 }]];
    }
    if (sql.includes('SELECT id, grade_code AS gradeCode')) {
      return [[{ id: 12, gradeCode: 'grade-2' }]];
    }
    if (sql.startsWith('INSERT INTO sections')) return [{ insertId: 101 }];
    if (sql.includes('WHERE sections.id = ? AND sections.school_id = ? LIMIT 1')) return [[sectionRow]];
    return [[]];
  });
  const result = await invoke(createSection, {
    user: { role: 'school_admin', schoolId: 5 },
    body: { name: 'Section A', capacity: 30, academicYearId: 10,
      schoolLevelId: 11, gradeLevelId: 12 }
  });
  assert.equal(result.error, null);
  assert.equal(result.response.statusCode, 201);
  assert.equal(result.response.body.section.gradeCode, 'grade-2');
  assert.ok(events.includes('commit'));
});
