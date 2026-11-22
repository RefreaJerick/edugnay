'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, validatePlan, SECTIONS } = require('../scripts/scheduleSaintColumbanGrade11');

function fixture() {
  const codes = ['shs-core-life-career', 'shs-core-mathematics',
    'shs-core-science', 'shs-core-philippine-history'];
  return SECTIONS.map((section, index) => {
    const sectionId = index + 1;
    const students = Array.from({ length: 5 }, (_, i) => sectionId * 10 + i);
    const core = {};
    for (const [offset, key] of ['english', 'filipino', ...codes].entries()) {
      core[key] = { kind: 'core', ownerId: sectionId * 10 + offset,
        sectionId, sectionName: section.name, teacherId: offset + 1,
        teacherName: `Teacher ${offset + 1}`, subjectName: key, students };
    }
    return { name: section.name, core, elective: { kind: 'elective',
      ownerId: 100 + sectionId, sectionId, sectionName: section.name,
      teacherId: 10 + sectionId, teacherName: `Elective ${sectionId}`,
      subjectName: section.elective, students } };
  });
}

test('Grade 11 schedule fills 35 hours in each section without shared-teacher conflicts', () => {
  const plan = buildPlan(fixture());
  assert.doesNotThrow(() => validatePlan(plan));
  assert.equal(plan.length, 120);
  assert.equal(new Set(plan.map(row => `${row.kind}:${row.ownerId}`)).size, 21);
  for (const section of SECTIONS) {
    const rows = plan.filter(row => row.sectionName === section.name);
    assert.equal(rows.filter(row => row.component === 'english').length, 5);
    assert.equal(rows.filter(row => row.component === 'filipino').length, 5);
    assert.equal(rows.filter(row => row.kind === 'elective').length, 10);
    assert.equal(rows.filter(row => row.kind === 'core' && !row.component).length, 20);
    assert.ok(rows.every(row => row.startDate === '2026-11-17' && row.room === null));
    assert.ok(rows.filter(row => row.kind === 'elective').every(row => row.endDate === '2026-12-31'));
    assert.ok(rows.filter(row => row.kind === 'core').every(row => row.endDate === '2027-06-30'));
  }
});

test('Grade 11 schedule detects teacher conflicts before a database write', () => {
  const sections = fixture();
  sections[1].elective.teacherId = sections[0].elective.teacherId;
  assert.throws(() => validatePlan(buildPlan(sections)), /Teacher schedule conflict/);
});

test('Grade 11 schedule detects student overlap before a database write', () => {
  const sections = fixture();
  sections[1].elective.students.push(sections[0].elective.students[0]);
  assert.throws(() => validatePlan(buildPlan(sections)), /Student schedule conflict/);
});
