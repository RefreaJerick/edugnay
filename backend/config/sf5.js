const SF5 = {
  formCode: 'SF5',
  sheetName: 'School Form 5 (SF5)',
  maleStart: 13,
  maleSlots: 20,
  femaleStart: 34,
  femaleSlots: 26,
  headers: {
    region: 'C3', division: 'E3', district: 'J3',
    schoolId: 'C5', schoolYear: 'G5', schoolName: 'C7',
    gradeLevel: 'J7', section: 'L7'
  }
};

function buildSf5Pages(school, section, learners, subjects, terms, grades) {
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF5 is a draft. Verify final ratings and complete promotion decisions, incomplete subjects, summaries, and signatures in the downloaded workbook.' }];
  if (!school.depedSchoolId) issues.push({ severity: 'warning', fieldKey: 'schoolId', cellReference: 'C5', message: 'The school ID is not configured.' });
  if (!learners.length) issues.push({ severity: 'warning', fieldKey: 'roster', cellReference: null, message: 'No active students are assigned to this section.' });
  if (!subjects.length) issues.push({ severity: 'warning', fieldKey: 'subjects', cellReference: null, message: 'No subjects are assigned to this section; general averages remain blank.' });
  if (!terms.length) issues.push({ severity: 'warning', fieldKey: 'terms', cellReference: null, message: 'No academic terms are configured for this level and year; general averages remain blank.' });

  const male = [];
  const female = [];
  for (const learner of learners) {
    const sex = String(learner.sex || '').trim().toLowerCase();
    if (sex === 'male' || sex === 'm') male.push(learner);
    else if (sex === 'female' || sex === 'f') female.push(learner);
    else issues.push({ severity: 'warning', fieldKey: 'sex', cellReference: null,
      message: `${learner.lastName}, ${learner.firstName} has no valid recorded sex and cannot be placed in the male/female roster.` });
  }

  const gradesByLearner = new Map();
  for (const grade of grades) {
    const key = `${grade.subjectId}:${grade.academicTermId}`;
    const learnerGrades = gradesByLearner.get(Number(grade.studentId)) || new Map();
    const matches = learnerGrades.get(key) || [];
    matches.push(grade);
    learnerGrades.set(key, matches);
    gradesByLearner.set(Number(grade.studentId), learnerGrades);
  }

  const breakdown = [];
  const pageCount = Math.max(1, Math.ceil(male.length / SF5.maleSlots), Math.ceil(female.length / SF5.femaleSlots));
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const cells = [];
    const header = {
      region: school.region, division: school.division, district: school.district,
      schoolId: school.depedSchoolId, schoolYear: section.academicYear,
      schoolName: school.schoolName, gradeLevel: section.gradeLevel, section: section.name
    };
    for (const [field, cellAddress] of Object.entries(SF5.headers)) {
      cells.push({ cellAddress, value: header[field] || '', type: 'text' });
    }

    for (const [group, start, slots] of [[male, SF5.maleStart, SF5.maleSlots], [female, SF5.femaleStart, SF5.femaleSlots]]) {
      group.slice(pageIndex * slots, (pageIndex + 1) * slots).forEach((learner, index) => {
        const row = start + index;
        const name = [learner.lastName, learner.firstName, learner.middleName].filter(Boolean).join(', ');
        const lrn = String(learner.lrn || '').trim();
        if (!/^\d{12}$/.test(lrn)) issues.push({ severity: 'warning', fieldKey: 'lrn', cellReference: `A${row}`,
          message: `${name} has a missing or invalid 12-digit LRN.` });
        cells.push({ cellAddress: `A${row}`, value: lrn, type: 'text' });
        cells.push({ cellAddress: `B${row}`, value: name, type: 'text' });

        const learnerGrades = gradesByLearner.get(Number(learner.userId)) || new Map();
        const subjectResults = [];
        const rawSubjectGrades = [];
        const gaps = [];
        let complete = subjects.length > 0 && terms.length > 0;
        for (const subject of subjects) {
          const termResults = [];
          const missingTerms = [];
          const termDetails = [];
          for (const term of terms) {
            const matches = learnerGrades.get(`${subject.id}:${term.id}`) || [];
            if (matches.length !== 1 || !Number.isFinite(Number(matches[0].finalGrade))) {
              complete = false;
              const reason = matches.length > 1 ? 'conflicting published grades' : 'no published grade';
              missingTerms.push({ term: term.name, reason });
              termDetails.push({ term: term.name, grade: null, section: null, reason });
              gaps.push(`${subject.name} / ${term.name}: ${reason}`);
            } else {
              const termResult = { term: term.name, grade: Number(matches[0].finalGrade), section: matches[0].sectionName };
              termResults.push(termResult);
              termDetails.push({ ...termResult, reason: null });
            }
          }
          const rawFinal = termResults.length === terms.length && terms.length
            ? termResults.reduce((sum, item) => sum + item.grade, 0) / terms.length : null;
          if (rawFinal !== null) rawSubjectGrades.push(rawFinal);
          subjectResults.push({ subject: subject.name, terms: termResults, missingTerms, termDetails,
            finalGrade: rawFinal === null ? null : Number(rawFinal.toFixed(2)) });
        }
        if (gaps.length) issues.push({ severity: 'warning', fieldKey: 'generalAverage', cellReference: `F${row}`,
          message: `${name}: general average remains blank (${gaps.length} missing or conflicting subject-period grades). See the breakdown.` });
        const average = complete
          ? Number((rawSubjectGrades.reduce((sum, grade) => sum + grade, 0) / subjects.length).toFixed(2)) : null;
        if (average !== null) cells.push({ cellAddress: `F${row}`, value: average, type: 'number' });
        breakdown.push({ studentId: learner.userId, name, page: pageIndex + 1, generalAverage: average, subjects: subjectResults });
      });
    }
    cells.push({ cellAddress: 'M61', value: `School Form 5: Page ${pageIndex + 1} of ${pageCount}`, type: 'text' });
    return cells;
  });

  return { pages, issues, breakdown };
}

module.exports = { SF5, buildSf5Pages };
