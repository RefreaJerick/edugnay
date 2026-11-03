const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSelection } = require('../config/shsSelection');
const { classAvailable, requiredTermCount, validateTermRange } = require('../utils/shsClassTerms');

const terms = [1, 2, 3].map(sequenceNumber => ({
  id: sequenceNumber, name: `Term ${sequenceNumber}`, sequenceNumber
}));
const academic = sequence => ({ catalogCode: `AE00${sequence}`, subjectType: 'academic_elective',
  instructionalHours: 80, gradeCode: 'grade-11', startTermSequence: sequence,
  endTermSequence: sequence, meetings: [] });

test('Grade 11 Academic choices need one 80-hour elective in every term', () => {
  assert.equal(validateSelection('academic', 11, [academic(1), academic(2), academic(3)]), null);
  assert.match(validateSelection('academic', 11, [academic(1), { ...academic(2), startTermSequence: 1, endTermSequence: 1 }, academic(3)]), /one 80-hour elective in each/);
  assert.match(validateSelection('academic', 11, [academic(1), academic(2)]), /three Academic electives/);
  assert.match(validateSelection('academic', 11, [academic(1), academic(2), { ...academic(3), startTermSequence: null }]), /term reviewed/);
});

test('Grade 12 pathways accept the prescribed loads and reviewed term spans', () => {
  const grade12Academic = Array.from({ length: 12 }, (_, index) => ({
    ...academic(index + 4), gradeCode: 'grade-12', startTermSequence: index % 3 + 1,
    endTermSequence: index % 3 + 1
  }));
  assert.equal(validateSelection('academic', 12, grade12Academic), null);
  const fieldExperience = { ...grade12Academic[0], catalogCode: 'FE-DESIGN-INNOVATION' };
  assert.equal(validateSelection('academic', 12, [fieldExperience, ...grade12Academic.slice(1)]), null);
  assert.match(validateSelection('academic', 12, grade12Academic.slice(1)), /960 hours/);

  const techpro = (code, grade, start = 1, end = 1) => ({
    catalogCode: code, subjectType: 'techpro_elective', instructionalHours: 320,
    gradeCode: `grade-${grade}`, startTermSequence: start, endTermSequence: end,
    meetings: []
  });
  const immersion = (hours, end) => ({ catalogCode: `WI-${hours}`, subjectType: 'work_immersion',
    instructionalHours: hours, gradeCode: 'grade-12', startTermSequence: 1,
    endTermSequence: end, meetings: [] });
  assert.equal(validateSelection('techpro', 11, [techpro('TP-01', 11, 1, 3)]), null);
  assert.equal(validateSelection('techpro', 12, [techpro('TP-02', 12), immersion(640, 2)]), null);
  assert.equal(validateSelection('techpro', 12, [techpro('TP-02', 12), techpro('TP-03', 12), immersion(320, 1)]), null);
  assert.match(validateSelection('techpro', 12, [techpro('TP-02', 12), immersion(640, 1)]), /required terms/);
  assert.equal(validateSelection('academic_cross_track', 12,
    [...grade12Academic.slice(0, 8), techpro('TP-04', 12)]), null);
  assert.equal(validateSelection('techpro_cross_track', 12,
    [techpro('TP-05', 12), immersion(320, 1)], grade12Academic.slice(0, 4)), null);
});

test('term coverage follows the subject duration and rejects gaps or another year', () => {
  assert.equal(requiredTermCount({ gradeCode: 'grade-11', subject_type: 'techpro_elective', instructional_hours: 320 }), 3);
  assert.equal(requiredTermCount({ gradeCode: 'grade-12', subject_type: 'work_immersion', instructional_hours: 640 }), 2);
  assert.equal(requiredTermCount({ gradeCode: 'grade-12', subject_type: 'academic_elective', instructional_hours: 160 }), 1);
  assert.deepEqual(validateTermRange(terms, { gradeCode: 'grade-12', subject_type: 'work_immersion', instructional_hours: 640 }, 1, 2),
    { start: terms[0], end: terms[1] });
  assert.throws(() => validateTermRange(terms, { gradeCode: 'grade-12', subject_type: 'work_immersion', instructional_hours: 640 }, 1, 3), /two consecutive terms|2 consecutive terms/);
  assert.throws(() => validateTermRange(terms, { gradeCode: 'grade-11', subject_type: 'academic_elective', instructional_hours: 80 }, 1, 99), /this class/);
});

test('upcoming classes stay unavailable until their term, then remain readable as history', () => {
  const item = { startTermSequence: 2, endTermSequence: 2 };
  assert.equal(classAvailable(item, terms[0]), false);
  assert.equal(classAvailable(item, terms[1]), true);
  assert.equal(classAvailable(item, terms[2]), false);
  assert.equal(classAvailable(item, terms[2], { history: true }), true);
  assert.equal(classAvailable({ ...item, startTermSequence: null }, terms[1]), false);
});
