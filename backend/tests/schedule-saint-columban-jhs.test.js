'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEPED_GRADE_SUBJECTS } = require('../config/depedK10Subjects');
const { buildPlan, validatePlan, weeklyHours, readScope } = require('../scripts/scheduleSaintColumbanJhs');

function fixture() {
  const codes = DEPED_GRADE_SUBJECTS.filter(subject => subject.levelCode === 'jhs');
  const groupSizes = [3, 2, 3, 2, 2, 2, 2, 2, 2];
  let assignmentId = 1;
  let teacherStart = 1;
  const groups = codes.map((_, index) => {
    const group = Array.from({ length: groupSizes[index] }, (_, i) => teacherStart + i);
    teacherStart += group.length;
    return group;
  });
  const sections = Array.from({ length: 12 }, (_, index) => {
    const grade = 7 + Math.floor(index / 3);
    const sectionId = index + 1;
    return { id: sectionId, name: `Section ${sectionId}`, gradeCode: `grade-${grade}`,
      adviserId: null,
      students: Array.from({ length: 5 }, (_, i) => sectionId * 10 + i),
      assignments: codes.map((subject, subjectIndex) => {
        const teacherId = groups[subjectIndex][index % groups[subjectIndex].length];
        return { id: assignmentId++, code: subject.code,
          subjectName: subject.name, teacherId, teacherName: `Teacher ${teacherId}` };
      }) };
  });
  const advisers = new Set();
  for (const section of sections) {
    const teacher = section.assignments.find(row => !advisers.has(row.teacherId));
    assert.ok(teacher);
    section.adviserId = teacher.teacherId;
    advisers.add(teacher.teacherId);
  }
  return sections;
}

test('JHS timetable fills all sections with planned hours and no double bookings', () => {
  const sections = fixture();
  const plan = buildPlan(sections);
  assert.doesNotThrow(() => validatePlan(plan));
  assert.equal(plan.length, 420);
  assert.equal(new Set(plan.map(row => row.assignmentId)).size, 108);
  for (const section of sections) {
    const rows = plan.filter(row => row.sectionId === section.id);
    assert.equal(rows.length, 35);
    for (const assignment of section.assignments) {
      assert.equal(rows.filter(row => row.assignmentId === assignment.id).length,
        weeklyHours(assignment.code));
    }
    assert.ok(rows.every(row => row.startDate === '2026-11-17' &&
      row.endDate === '2027-06-30' && row.room === null && row.startTime !== '12:00:00'));
  }
});

test('JHS timetable rejects an overlapping student', () => {
  const sections = fixture();
  sections[1].students.push(sections[0].students[0]);
  assert.throws(() => validatePlan(buildPlan(sections)), /Student schedule conflict/);
});

test('JHS timetable rejects an overloaded teacher', () => {
  const sections = fixture();
  sections.slice(0, 8).forEach(section => { section.assignments[0].teacherId = 1; });
  assert.throws(() => buildPlan(sections), /more meetings than periods/);
});

test('JHS preflight matches SQL arguments, checks existing conflicts, and writes nothing', async () => {
  const sections = fixture();
  const sectionRows = sections.map(({ id, name, gradeCode, adviserId }) =>
    ({ id, name, gradeCode, adviserId }));
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
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    }
  };
  const scope = await readScope(connection);
  assert.equal(scope.plan.length, 420);
  assert.equal(conflictChecks, 420);
});
