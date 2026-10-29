const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  SHS_GRADE_ELIGIBILITY, SHS_PATHWAYS, SHS_SUBJECT_HOURS,
  SHS_SUBJECT_TYPES, SHS_TRACKS, isStrengthenedTrack
} = require('../config/shsCurriculum');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

test('only Academic and TechPro are available for new SHS setup', () => {
  assert.deepEqual(SHS_TRACKS.map(track => track.code), ['academic', 'techpro']);
  assert.equal(isStrengthenedTrack('tvl'), false);
  assert.equal(isStrengthenedTrack('arts-design'), false);
  assert.equal(isStrengthenedTrack('sports'), false);
  assert.match(read('assets/js/shell-common.js'), /tracks: \['Academic', 'Technical Professional \(TechPro\)'\]/);
  assert.doesNotMatch(read('backend/database/demo-data.sql'), /'tvl'|'arts-design'|'sports'/);
});

test('curriculum rules keep the four pathways and their separate hour totals', () => {
  assert.deepEqual(Object.keys(SHS_SUBJECT_TYPES), ['core', 'academic_elective', 'techpro_elective', 'work_immersion']);
  assert.deepEqual(SHS_GRADE_ELIGIBILITY.core, [11]);
  assert.deepEqual(SHS_GRADE_ELIGIBILITY.work_immersion, [12]);
  assert.deepEqual(SHS_SUBJECT_HOURS.academic_elective, [80, 160, 320]);
  assert.equal(SHS_PATHWAYS.academic.grade11.academic_elective.count, 3);
  assert.equal(SHS_PATHWAYS.academic.grade11.academic_elective.hours, 240);
  assert.equal(SHS_PATHWAYS.academic.grade12.academic_elective.minCount, 9);
  assert.equal(SHS_PATHWAYS.academic.grade12.academic_elective.maxCount, 12);
  assert.equal(SHS_PATHWAYS.academic.grade12.academic_elective.hours, 960);
  assert.equal(SHS_PATHWAYS.academic_cross_track.grade12.techpro_elective.hours, 320);
  assert.equal(SHS_PATHWAYS.techpro.grade11.techpro_elective.hours, 320);
  assert.equal(SHS_PATHWAYS.techpro.totalElectiveHours, 1280);
  assert.equal(SHS_PATHWAYS.techpro_cross_track.academicElectives.hours, 320);
});

test('new SHS subjects store type and hours while legacy grade entry is blocked', () => {
  const subjects = read('backend/controllers/subjectsController.js');
  const grades = read('backend/controllers/gradesController.js');
  const terms = read('backend/controllers/academicTermsController.js');
  assert.match(subjects, /SHS_SUBJECT_HOURS\[shsSubjectType\]\.includes\(instructionalHours\)/);
  assert.match(subjects, /SHS_GRADE_ELIGIBILITY\[shsSubjectType\]/);
  assert.match(grades, /Strengthened SHS grades cannot be calculated or published/);
  assert.match(terms, /Strengthened SHS grading settings will be available in the grading phase/);
  assert.match(read('backend/database/migrations/050_strengthened_shs_foundation.sql'), /ADD COLUMN shs_subject_type/);
});

test('Class Management removes strand selection and asks for subject hours', () => {
  const html = read('views/admin/edugnay-admin-management.html');
  assert.doesNotMatch(html, /id="createStrand"/);
  assert.match(html, /id="subjectShsHours"/);
  assert.match(html, /Needs Strengthened SHS setup/);
});

test('School Settings and Class Management inline scripts parse', () => {
  for (const file of ['views/admin/edugnay-admin-schools.html', 'views/admin/edugnay-admin-management.html']) {
    const scripts = [...read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1].trim()).filter(Boolean);
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script, { filename: file }));
  }
});
