'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEPED_GRADE_SUBJECTS } = require('../config/depedK10Subjects');
const { buildPlan, validatePlan, weeklyHours, readScope } = require('../scripts/scheduleSaintColumbanElementary');

function fixture() {
  const sections = [];
  let assignmentId = 1;
  for (let grade = 2; grade <= 6; grade++) {
    for (let index = 0; index < 3; index++) {
      const sectionId = sections.length + 1;
      const gradeCode = `grade-${grade}`;
      sections.push({ id: sectionId, name: `Section ${sectionId}`, gradeCode,
        students: Array.from({ length: 5 }, (_, i) => sectionId * 10 + i),
        assignments: DEPED_GRADE_SUBJECTS
          .filter(subject => subject.gradeCodes.includes(gradeCode))
          .map(subject => ({ id: assignmentId++, code: subject.code,
            subjectName: subject.name, teacherId: sectionId,
            teacherName: `Teacher ${sectionId}` })) });
    }
  }
  return sections;
}

test('elementary timetable fills every school day and planned subject hours', () => {
  const plan = buildPlan(fixture());
  assert.doesNotThrow(() => validatePlan(plan));
  assert.equal(plan.length, 420);
  assert.equal(new Set(plan.map(row => row.assignmentId)).size, 114);
  for (const section of fixture()) {
    const grade = Number(section.gradeCode.split('-')[1]);
    const rows = plan.filter(row => row.sectionId === section.id);
    assert.equal(rows.length, grade <= 3 ? 25 : 30);
    for (const assignment of section.assignments) {
      assert.equal(rows.filter(row => row.assignmentId === assignment.id).length,
        weeklyHours(assignment.code, grade));
    }
    assert.ok(rows.every(row => row.startDate === '2026-11-17' &&
      row.endDate === '2027-06-30' && row.room === null));
    assert.ok(rows.every(row => row.startTime !== '12:00:00'));
  }
});

test('elementary timetable rejects a shared teacher in concurrent sections', () => {
  const sections = fixture();
  sections[1].assignments.forEach(row => { row.teacherId = sections[0].id; });
  assert.throws(() => validatePlan(buildPlan(sections)), /Teacher schedule conflict/);
});

test('elementary timetable rejects a student in concurrent sections', () => {
  const sections = fixture();
  sections[1].students.push(sections[0].students[0]);
  assert.throws(() => validatePlan(buildPlan(sections)), /Student schedule conflict/);
});

test('elementary preflight uses matching SQL arguments and performs no writes', async () => {
  const sections = fixture();
  const sectionRows = sections.map(section => ({ id: section.id, name: section.name,
    adviserId: section.id, gradeCode: section.gradeCode }));
  const assignments = sections.flatMap(section => section.assignments.map(row => ({
    ...row, sectionId: section.id, component: null, subjectActive: 1,
    role: 'teacher', teacherStatus: 'active'
  })));
  const enrollments = sections.flatMap(section => section.students.map(studentId => ({
    sectionId: section.id, studentId
  })));
  let conflictChecks = 0;
  const connection = {
    async query(sql) {
      assert.match(sql, /FOREIGN_KEY_CHECKS/);
      return [[{ db: 'academix', fk: 1 }]];
    },
    async execute(sql, params) {
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
      assert.equal((sql.match(/\?/g) || []).length, params.length,
        `SQL parameter count differs for: ${sql.slice(0, 70)}`);
      if (sql.includes('FROM schools')) return [[{ id: 7 }]];
      if (sql.includes('FROM academic_years WHERE')) return [[{
        id: 1, startDate: '2026-11-06', endDate: '2027-06-30'
      }]];
      if (sql.includes('FROM sections s JOIN')) return [sectionRows];
      if (sql.includes('FROM section_teachers a JOIN')) return [assignments];
      if (sql.includes('FROM section_students WHERE')) return [enrollments];
      if (sql.includes('FROM scheduled_classes WHERE')) return [[]];
      if (sql.includes('FROM timetable_meetings m')) {
        conflictChecks++;
        return [[]];
      }
      throw new Error(`Unexpected preflight query: ${sql.slice(0, 80)}`);
    }
  };
  const scope = await readScope(connection);
  assert.equal(scope.plan.length, 420);
  assert.equal(conflictChecks, 420);
});
