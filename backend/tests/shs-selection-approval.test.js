const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const databaseModule = require('../config/database');
const { getCatalogEntry } = require('../config/shsApprovedCatalog');

function createDatabase() {
  const requests = new Map([1, 2].map(id => [id, {
    id, school_id: 7, academic_year_id: 20, grade_level_id: 11,
    student_user_id: 100 + id, pathway_code: 'academic', status: 'pending', revision: 1
  }]));
  const memberships = [];
  const emptyChoiceRequests = new Set();
  const choiceIds = new Map([[1, [1, 2, 3]], [2, [1, 2, 3]]]);
  let learnerPlacement = { sectionId: 30, yearId: 20, gradeId: 11, gradeCode: 'grade-11', trackCode: 'academic', yearStatus: 'active' };
  let availableClasses = [1, 2, 3].map(classId => {
    const entry = getCatalogEntry(`AE00${classId}`);
    return { id: classId, className: `Group ${classId}`, capacity: 1, classActive: 1,
      catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
      subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-11', offeringActive: 1,
      teacherName: 'Teacher', teacherStatus: 'active', teacherRole: 'teacher',
      enrolledCount: memberships.filter(item => item.classId === classId).length };
  });
  let queue = Promise.resolve();
  return {
    requests, memberships, emptyChoiceRequests,
    useRequiredTechProImmersion(requestId) {
      const request = requests.get(Number(requestId));
      Object.assign(request, { grade_level_id: 12, pathway_code: 'techpro', status: 'pending' });
      learnerPlacement = { sectionId: 30, yearId: 20, gradeId: 12, gradeCode: 'grade-12', trackCode: 'techpro', yearStatus: 'active' };
      const entry = getCatalogEntry('WI-320');
      const elective = getCatalogEntry('TP-AF-01');
      availableClasses = [
        { id: 4, className: 'TechPro Work Immersion', capacity: 1, classActive: 1,
          catalogVersion: entry.version, catalogCode: entry.code, trackCode: entry.trackCode,
          subjectName: entry.name, subjectType: entry.type, instructionalHours: entry.hours, gradeCode: 'grade-12', offeringActive: 1,
          teacherName: 'Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0 },
        { id: 5, className: 'TechPro elective', capacity: 1, classActive: 1,
          catalogVersion: elective.version, catalogCode: elective.code, trackCode: elective.trackCode,
          subjectName: elective.name, subjectType: elective.type, instructionalHours: elective.hours, gradeCode: 'grade-12', offeringActive: 1,
          teacherName: 'Teacher', teacherStatus: 'active', teacherRole: 'teacher', enrolledCount: 0 }
      ];
      choiceIds.set(Number(requestId), [4]);
      emptyChoiceRequests.delete(Number(requestId));
      memberships.length = 0;
    },
    async getConnection() {
      let releaseYear;
      const writtenMembers = [];
      let previousStatus;
      return {
        async beginTransaction() {},
        async commit() { releaseYear?.(); releaseYear = null; },
        async rollback() {
          for (const item of writtenMembers) memberships.splice(memberships.indexOf(item), 1);
          if (previousStatus) requests.get(previousStatus.id).status = previousStatus.status;
          releaseYear?.(); releaseYear = null;
        },
        release() {},
        async execute(sql, args) {
          if (sql.includes('SELECT academic_year_id AS yearId FROM shs_selection_requests')) {
            const row = requests.get(Number(args[1])); return [[...(row ? [{ yearId: row.academic_year_id }] : [])]];
          }
          if (sql.includes('SELECT status FROM academic_years') && sql.includes('FOR UPDATE')) {
            const previous = queue;
            queue = new Promise(resolve => { releaseYear = resolve; });
            await previous;
            return [[{ status: 'active' }]];
          }
          if (sql.includes('SELECT * FROM shs_selection_requests')) return [[requests.get(Number(args[1]))]];
          if (sql.includes('SELECT s.id AS sectionId')) return [[{ ...learnerPlacement }]];
          if (sql.includes('SELECT elective_class_id AS classId FROM shs_selection_request_classes'))
            return [emptyChoiceRequests.has(Number(args[1])) ? [] : (choiceIds.get(Number(args[1])) || []).map(classId => ({ classId }))];
          if (sql.includes('SELECT id FROM shs_elective_classes') && sql.includes('FOR UPDATE')) return [[]];
          if (sql.includes('SELECT c.id, c.class_name AS className')) return [availableClasses.map(item => ({
            ...item, enrolledCount: memberships.filter(member => member.classId === item.id).length
          }))];
          if (sql.includes('SELECT c.id AS classId, m.weekday')) return [availableClasses.map(item => ({
            classId: item.id,
            weekday: item.id, startTime: '09:00', endTime: '10:00',
            startDate: '2026-10-01', endDate: '2027-06-30'
          }))];
          if (sql.includes('SELECT COUNT(DISTINCT sub.id) AS total')) return [[{ total: 5 }]];
          if (sql.includes('SELECT m.weekday') && sql.includes('FROM timetable_meetings')) return [[]];
          if (sql.includes('INSERT INTO shs_elective_class_students')) {
            const item = { classId: Number(args[1]), studentId: Number(args[2]) };
            memberships.push(item); writtenMembers.push(item); return [{ insertId: memberships.length }];
          }
          if (sql.includes('UPDATE shs_selection_requests SET status')) {
            previousStatus = { id: Number(args[4]), status: requests.get(Number(args[4])).status };
            requests.get(Number(args[4])).status = args[0]; return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO shs_selection_history') || sql.includes('INSERT INTO audit_logs')) return [{ insertId: 1 }];
          throw new Error(`Unexpected SQL: ${sql.slice(0, 90)}`);
        }
      };
    }
  };
}

const database = createDatabase();
databaseModule.getDatabase = () => database;
const { decide, changeApproved } = require('../controllers/shsSelectionController');

test('approval and approved-change transactions take their first snapshot after the year lock', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controllers/shsSelectionController.js'), 'utf8');
  for (const name of ['decide', 'changeApproved']) {
    const body = source.split(`async function ${name}(`)[1].split('\nasync function ')[0];
    assert.ok(body.indexOf('const lookup = await execute(connection') < body.indexOf('await connection.beginTransaction()'),
      `${name} must not establish a REPEATABLE READ snapshot before the year lock`);
    assert.ok(body.indexOf('await connection.beginTransaction()') < body.indexOf('FOR UPDATE'),
      `${name} must lock the year inside its transaction`);
  }
});

test('near-simultaneous approvals reserve the last seats for only one learner', async () => {
  const call = requestId => new Promise(resolve => {
    const req = { user: { id: 9, schoolId: 7 }, params: { requestId }, body: { decision: 'approved' } };
    const res = { json(value) { resolve({ value }); } };
    decide(req, res, error => resolve({ error }));
  });
  const [first, second] = await Promise.all([call(1), call(2)]);
  assert.equal(first.value?.status, 'approved', first.error?.stack || JSON.stringify(first));
  assert.match(second.error?.message || '', /no seats left/);
  assert.equal(database.memberships.length, 3);
  assert.equal(database.requests.get(1).status, 'approved');
  assert.equal(database.requests.get(2).status, 'pending');
});

test('confirming a Grade 12 TechPro selection places the learner in required Work Immersion', async () => {
  database.useRequiredTechProImmersion(1);
  const req = { user: { id: 9, schoolId: 7 }, params: { requestId: '1' }, body: { decision: 'approved' } };
  let result, error;
  await new Promise(resolve => decide(req, { json(value) { result = value; resolve(); } }, value => { error = value; resolve(); }));
  assert.equal(error, undefined);
  assert.deepEqual(result, { id: 1, status: 'approved' });
  assert.deepEqual(database.memberships, [{ classId: 4, studentId: 101 }]);
  assert.equal(database.requests.get(1).status, 'approved');
});

test('editing a confirmed Grade 12 TechPro selection cannot remove required Work Immersion', async () => {
  database.useRequiredTechProImmersion(1);
  database.requests.get(1).status = 'approved';
  database.memberships.push({ classId: 4, studentId: 101 });
  const req = { user: { id: 9, schoolId: 7 }, params: { requestId: '1' }, body: { classIds: [5] } };
  let error;
  await new Promise(resolve => changeApproved(req, { json: resolve }, value => { error = value; resolve(); }));
  assert.match(error?.message || '', /include exactly one eligible TechPro Work Immersion class/);
  assert.equal(database.requests.get(1).status, 'approved');
  assert.deepEqual(database.memberships, [{ classId: 4, studentId: 101 }]);
});

test('staff cannot confirm or return a pending request with no saved classes', async () => {
  database.requests.get(1).status = 'pending';
  database.memberships.length = 0;
  database.emptyChoiceRequests.add(1);
  const req = { user: { id: 9, schoolId: 7 }, params: { requestId: '1' },
    body: { decision: 'rejected', reason: 'Please choose a class.' } };
  let error;
  await new Promise(resolve => decide(req, { json: resolve }, value => { error = value; resolve(); }));
  assert.match(error?.message || '', /no saved classes and cannot be reviewed/);
  assert.equal(database.requests.get(1).status, 'pending');
  assert.equal(database.memberships.length, 0);
});

test('staff cannot edit an approved request with no saved class links', async () => {
  database.requests.get(1).status = 'approved';
  database.emptyChoiceRequests.add(1);
  const req = { user: { id: 9, schoolId: 7 }, params: { requestId: '1' }, body: { classIds: [1] } };
  let error;
  await new Promise(resolve => changeApproved(req, { json: resolve }, value => { error = value; resolve(); }));
  assert.match(error?.message || '', /no saved classes; review this record before editing/);
  assert.equal(database.requests.get(1).status, 'approved');
  assert.equal(database.memberships.length, 0);
});
