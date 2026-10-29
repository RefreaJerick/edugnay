const { validateSelection } = require('./shsSelection');
const { calculateSubjectFinal } = require('./shsGrading');

function subjectGradeStatus(terms = [], grades = []) {
  const expectedTermIds = new Set(terms.map(term => String(term.id)));
  if (grades.some(row => !expectedTermIds.has(String(row.academicTermId)))) {
    return { complete: false, passed: false, finalGrade: null, detail: 'A published grade belongs to a different school year or grading period.' };
  }
  if (grades.some(row => !Number.isInteger(Number(row.finalGrade)) || Number(row.finalGrade) < 0 || Number(row.finalGrade) > 100)) {
    return { complete: false, passed: false, finalGrade: null, detail: 'A published term grade is invalid.' };
  }
  const byTerm = new Map(grades.map(row => [String(row.academicTermId), Number(row.finalGrade)]));
  const missing = terms.filter(term => !byTerm.has(String(term.id)));
  if (!terms.length || missing.length) return { complete: false, passed: false, finalGrade: null,
    detail: !terms.length ? 'No grading periods are configured.' : `Missing published grades for ${missing.map(term => term.name).join(', ')}.` };
  const finalGrade = calculateSubjectFinal(terms.map(term => byTerm.get(String(term.id))));
  return { complete: true, passed: finalGrade >= 75, finalGrade,
    detail: finalGrade >= 75 ? `Final grade ${finalGrade} (passing).` : `Final grade ${finalGrade} is below 75.` };
}

function confirmationStatus(checklist, prior) {
  if (!prior) return null;
  return checklist.ready && prior.evidenceHash === checklist.evidenceHash ? 'confirmed' : 'needs_review';
}

function requestSelectionProblem(request, grade, prior = []) {
  if (!request || request.status !== 'approved') return `Grade ${grade} elective selection is not approved.`;
  if (request.classes.some(item => !item.catalogMatched)) return `A Grade ${grade} selection no longer matches the approved catalog.`;
  return validateSelection(request.pathwayCode, grade, request.classes, prior);
}

function evaluateCompletion(input) {
  const checks = [];
  const add = (key, label, passed, detail) => checks.push({ key, label, passed: Boolean(passed), detail });
  const cohortSupported = Number(input.grade12StartYear) >= 2026;
  add('cohort', 'Strengthened SHS cohort', cohortSupported,
    Number(input.grade12StartYear) < 2026
      ? 'Strengthened SHS completion is not configured for this school year.'
      : 'Supported Strengthened SHS Grade 12 cohort.');
  const core = input.coreSubjects || [];
  const coreHours = core.reduce((sum, item) => sum + Number(item.instructionalHours || 0), 0);
  const coreSetValid = core.length === 5 && core.every(item => Number(item.instructionalHours) === 160);
  add('core-set', 'Grade 11 core subjects', coreSetValid,
    `${core.length} core subjects and ${coreHours} of 800 required hours.`);
  add('core-grades', 'Passing Grade 11 core grades', core.length === 5 && core.every(item => item.gradeStatus?.passed),
    core.filter(item => !item.gradeStatus?.passed).map(item => `${item.subjectName}: ${item.gradeStatus?.detail || 'No passing final grade.'}`).join(' ') || 'All five core subjects have passing final grades.');

  const g11 = input.grade11Request;
  const g11Selections = g11?.classes || [];
  const g11SelectionProblem = requestSelectionProblem(g11, 11);
  add('grade11-pathway', 'Approved Grade 11 pathway', !g11SelectionProblem,
    g11SelectionProblem || `${g11Selections.length} approved Grade 11 elective class(es).`);
  add('grade11-grades', 'Passing Grade 11 elective grades', g11Selections.length > 0 && g11Selections.every(item => item.gradeStatus?.passed),
    g11Selections.filter(item => !item.gradeStatus?.passed).map(item => `${item.subjectName}: ${item.gradeStatus?.detail || 'No passing final grade.'}`).join(' ') || (g11Selections.length ? 'All selected Grade 11 electives have passing final grades.' : 'No approved Grade 11 elective choices with grade evidence.'));

  const history = input.priorHistory || [];
  const historyValid = history.every(item => item.catalogMatched && item.instructionalHours > 0
    && String(item.gradeSource || '').trim() && Number.isInteger(Number(item.finalGrade))
    && Number(item.finalGrade) >= 75 && Number(item.finalGrade) <= 100 && item.verifiedBy && item.verifiedAt);
  add('prior-evidence', 'Verified prior Grade 11 evidence', historyValid,
    historyValid ? (history.length ? `${history.length} prior record(s) have catalog, hours, grade, source, verifier, and date.` : 'No additional prior-history records are required.')
      : 'A prior elective is missing an approved catalog match, hours, passing grade, evidence source, verifier, or verification date.');

  const priorClasses = g11Selections.map(item => ({ ...item, grade: 11 }));
  const prior = [...priorClasses, ...history.filter(item => item.catalogMatched).map(item => ({
    catalogCode: item.catalogCode, subjectType: 'academic_elective', instructionalHours: item.instructionalHours, grade: 11
  }))];
  const g12 = input.grade12Request;
  const g12Selections = g12?.classes || [];
  const g12SelectionProblem = requestSelectionProblem(g12, 12, prior);
  add('grade12-pathway', 'Approved Grade 12 pathway and required hours', !g12SelectionProblem,
    g12SelectionProblem || `${g12Selections.length} approved Grade 12 elective class(es).`);
  add('grade12-grades', 'Passing Grade 12 elective grades', g12Selections.length > 0 && g12Selections.every(item => item.gradeStatus?.passed),
    g12Selections.filter(item => !item.gradeStatus?.passed).map(item => `${item.subjectName}: ${item.gradeStatus?.detail || 'No passing final grade.'}`).join(' ') || (g12Selections.length ? 'All selected Grade 12 electives have passing final grades.' : 'No approved Grade 12 elective choices with grade evidence.'));
  const grade12MembershipValid = g12Selections.length > 0
    && g12Selections.every(item => Boolean(item.memberActive || item.gradeStatus?.passed));
  add('grade12-membership', 'Grade 12 elective enrollment or earned-grade evidence', grade12MembershipValid,
    grade12MembershipValid ? 'Every selected class has an active enrollment or a recorded passing final grade.'
      : 'A withdrawn class has no passing final grade on record.');

  add('track', 'Track and pathway match', Boolean(g12?.trackCode && input.grade12TrackCode === g12.trackCode
    && (!input.grade11TrackCode || input.grade11TrackCode === g12.trackCode)),
  input.grade11TrackCode && input.grade11TrackCode !== input.grade12TrackCode
    ? 'The learner’s Grade 11 and Grade 12 tracks do not match.' : 'Grade 11 and Grade 12 track records match.');
  return { checks, ready: checks.every(check => check.passed), pathwayCode: g12?.pathwayCode || null };
}

module.exports = { confirmationStatus, evaluateCompletion, subjectGradeStatus };
