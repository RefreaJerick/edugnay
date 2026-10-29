const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmationStatus, evaluateCompletion, subjectGradeStatus } = require('../config/shsCompletion');

const passing = { passed: true, complete: true, finalGrade: 82, detail: 'Final grade 82 (passing).' };
const academic = (index, grade = 11) => ({ catalogCode: `AE${String(index).padStart(3, '0')}`,
  subjectType: 'academic_elective', instructionalHours: 80, gradeStatus: passing, grade, catalogMatched: true, meetings: [], memberActive: true });
const techpro = code => ({ catalogCode: code, subjectType: 'techpro_elective', instructionalHours: 320, gradeStatus: passing, catalogMatched: true, meetings: [], memberActive: true });
const immersion = hours => ({ catalogCode: hours === 640 ? 'WI-640' : 'WI-320', subjectType: 'work_immersion', instructionalHours: hours, gradeStatus: passing, catalogMatched: true, meetings: [], memberActive: true });
const core = Array.from({ length: 5 }, (_, index) => ({ subjectName: `Core ${index + 1}`, instructionalHours: 160, gradeStatus: passing }));
const history = index => ({ catalogCode: `AE${String(index).padStart(3, '0')}`, instructionalHours: 80,
  finalGrade: 82, gradeSource: 'Official school record', verifiedBy: 3, verifiedAt: '2027-06-01', catalogMatched: true });
function input({ year = 2027, pathway, g11Track = 'academic', g12Track = g11Track, g11 = [], g12 = [], priorHistory = [] }) {
  return { grade12StartYear: year, grade11TrackCode: g11Track, grade12TrackCode: g12Track, coreSubjects: core,
    grade11Request: { pathwayCode: g11Track === 'academic' ? 'academic' : 'techpro', status: 'approved', classes: g11 },
    grade12Request: { pathwayCode: pathway, trackCode: g12Track, status: 'approved', classes: g12 }, priorHistory };
}

test('subject final requires every term, averages the published term grades, and rounds to a whole number', () => {
  const terms = [{ id: 1, name: 'Term 1' }, { id: 2, name: 'Term 2' }, { id: 3, name: 'Term 3' }];
  assert.deepEqual(subjectGradeStatus(terms, [{ academicTermId: 1, finalGrade: 74 }, { academicTermId: 2, finalGrade: 75 }, { academicTermId: 3, finalGrade: 76 }]),
    { complete: true, passed: true, finalGrade: 75, detail: 'Final grade 75 (passing).' });
  assert.match(subjectGradeStatus(terms, [{ academicTermId: 1, finalGrade: 100 }]).detail, /Missing published grades/);
  assert.equal(subjectGradeStatus(terms, [{ academicTermId: 1, finalGrade: 74 }, { academicTermId: 2, finalGrade: 74 }, { academicTermId: 3, finalGrade: 74 }]).passed, false);
});

test('a prior completion confirmation needs review when its evidence changes or is no longer ready', () => {
  const checklist = { ready: true, evidenceHash: 'new-evidence' };
  assert.equal(confirmationStatus(checklist, null), null);
  assert.equal(confirmationStatus(checklist, { evidenceHash: 'new-evidence' }), 'confirmed');
  assert.equal(confirmationStatus(checklist, { evidenceHash: 'old-evidence' }), 'needs_review');
  assert.equal(confirmationStatus({ ...checklist, ready: false }, { evidenceHash: 'new-evidence' }), 'needs_review');
});

test('completion checklist validates Academic pathway and passing grades across both years', () => {
  const g11 = [academic(1), academic(2), academic(3)];
  const g12 = Array.from({ length: 12 }, (_, index) => academic(index + 4, 12));
  const result = evaluateCompletion(input({ pathway: 'academic', g11, g12 }));
  assert.equal(result.ready, true);
  assert.ok(result.checks.every(check => check.passed));
});

test('completion checklist validates Academic cross-track pathway and distinct subjects', () => {
  const g11 = [academic(1), academic(2), academic(3)];
  const g12 = [...Array.from({ length: 8 }, (_, index) => academic(index + 4, 12)), techpro('TP-JAVA')];
  assert.equal(evaluateCompletion(input({ pathway: 'academic_cross_track', g11, g12 })).ready, true);
  assert.equal(evaluateCompletion(input({ pathway: 'academic_cross_track', g11,
    g12: [...g12.slice(0, 7), academic(1, 12), techpro('TP-JAVA')] })).ready, false);
});

test('completion checklist validates TechPro pathway with Work Immersion hours', () => {
  const result = evaluateCompletion(input({ pathway: 'techpro', g11Track: 'techpro', g12Track: 'techpro',
    g11: [techpro('TP-JAVA')], g12: [techpro('TP-NET'), immersion(640)] }));
  assert.equal(result.ready, true);
});

test('TechPro cross-track requires verified passing prior Academic elective evidence', () => {
  const result = evaluateCompletion(input({ pathway: 'techpro_cross_track', g11Track: 'techpro', g12Track: 'techpro',
    g11: [techpro('TP-JAVA')], g12: [techpro('TP-NET'), immersion(320)],
    priorHistory: [history(1), history(2), history(3), history(4)] }));
  assert.equal(result.ready, true);
  const invalid = evaluateCompletion(input({ pathway: 'techpro_cross_track', g11Track: 'techpro', g12Track: 'techpro',
    g11: [techpro('TP-JAVA')], g12: [techpro('TP-NET'), immersion(320)],
    priorHistory: [history(1), history(2), history(3), { ...history(4), gradeSource: '', finalGrade: 74 }] }));
  assert.equal(invalid.ready, false);
  assert.equal(invalid.checks.find(check => check.key === 'prior-evidence').passed, false);
  for (const invalidGrade of [100.5, 101, -1]) {
    const invalidHistory = evaluateCompletion(input({ pathway: 'techpro_cross_track', g11Track: 'techpro', g12Track: 'techpro',
      g11: [techpro('TP-JAVA')], g12: [techpro('TP-NET'), immersion(320)],
      priorHistory: [history(1), history(2), history(3), { ...history(4), finalGrade: invalidGrade }] }));
    assert.equal(invalidHistory.checks.find(check => check.key === 'prior-evidence').passed, false);
  }
});

test('missing core work, invalid core hours, a failed subject, and track changes block confirmation', () => {
  const g11 = [academic(1), academic(2), academic(3)];
  const g12 = Array.from({ length: 12 }, (_, index) => academic(index + 4, 12));
  const base = input({ pathway: 'academic', g11, g12 });
  assert.equal(evaluateCompletion({ ...base, coreSubjects: core.slice(0, 4) }).ready, false);
  assert.equal(evaluateCompletion({ ...base, coreSubjects: core.map((item, index) => index ? item : { ...item, instructionalHours: 320 }) }).ready, false);
  assert.equal(evaluateCompletion({ ...base, coreSubjects: core.map((item, index) => index ? item : { ...item, gradeStatus: { passed: false, finalGrade: 74 } }) }).ready, false);
  assert.equal(evaluateCompletion({ ...base, grade11TrackCode: 'techpro' }).ready, false);
  const strengthenedGrade12 = evaluateCompletion({ ...base, grade12StartYear: 2027 });
  assert.equal(strengthenedGrade12.ready, true);
  assert.equal(strengthenedGrade12.checks.find(check => check.key === 'cohort').passed, true);
});

test('withdrawal preserves a completed passing elective grade but blocks an unfinished one', () => {
  const g11 = [academic(1), academic(2), academic(3)];
  const complete = Array.from({ length: 12 }, (_, index) => ({ ...academic(index + 4, 12), memberActive: false }));
  const result = evaluateCompletion(input({ pathway: 'academic', g11, g12: complete }));
  assert.equal(result.ready, true);
  const incomplete = complete.map((item, index) => index ? item : { ...item, gradeStatus: { passed: false, complete: false, detail: 'Missing grades.' } });
  const blocked = evaluateCompletion(input({ pathway: 'academic', g11, g12: incomplete }));
  assert.equal(blocked.checks.find(check => check.key === 'grade12-membership').passed, false);
  assert.equal(blocked.ready, false);
});
