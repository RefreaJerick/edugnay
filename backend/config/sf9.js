const SF9 = {
  formCode: 'SF9',
  sheetName: 'SF9 - GRADE 4-10',
  firstSubjectRow: 32,
  baseSubjectRows: 10,
  periodColumns: ['F', 'G', 'H', 'I'],
  finalGradeColumn: 'J',
  remarksColumn: 'K',
  headers: {
    region: 'B7',
    division: 'B8',
    district: 'B9',
    address: 'B10',
    schoolName: 'B12',
    schoolYear: 'B15',
    learnerName: 'C17',
    age: 'I17',
    sex: 'K17',
    lrn: 'C18',
    gradeLevel: 'I18',
    section: 'K18',
    strand: 'C19',
    adviser: 'H27'
  }
};

function displayName(learner) {
  return [learner.lastName, learner.firstName, learner.middleName]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function learnerAge(birthDate, schoolYear) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) return null;
  const startYear = Number.parseInt(String(schoolYear || '').slice(0, 4), 10);
  if (!Number.isSafeInteger(startYear)) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const cutoff = new Date(Date.UTC(startYear, 5, 1));
  let age = cutoff.getUTCFullYear() - birth.getUTCFullYear();
  if (cutoff.getUTCMonth() < birth.getUTCMonth()
    || (cutoff.getUTCMonth() === birth.getUTCMonth() && cutoff.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 ? age : null;
}

function buildSf9Pages(school, section, adviser, learner, subjects, terms, grades) {
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF9 is a draft. Class-day attendance, comments, signatures, and transfer details are left blank for adviser completion from verified records. Review grades and learner details before issuing the report card.' }];
  const requireValue = (value, fieldKey, cellReference, label) => {
    if (!String(value || '').trim()) issues.push({ severity: 'warning', fieldKey, cellReference,
      message: `${label} is not configured.` });
  };

  requireValue(school.depedSchoolId, 'schoolId', null, 'School ID');
  requireValue(school.region, 'region', SF9.headers.region, 'Region');
  requireValue(school.division, 'division', SF9.headers.division, 'Division');
  requireValue(school.district, 'district', SF9.headers.district, 'District');
  requireValue(school.addressLine, 'address', SF9.headers.address, 'School address');
  requireValue(school.schoolName, 'schoolName', SF9.headers.schoolName, 'School name');
  requireValue(learner.lrn, 'lrn', SF9.headers.lrn, `${displayName(learner)}'s LRN`);
  const sex = String(learner.sex || '').trim().toLowerCase();
  if (!['male', 'm', 'female', 'f'].includes(sex)) {
    issues.push({ severity: 'warning', fieldKey: 'sex', cellReference: SF9.headers.sex,
      message: `${displayName(learner) || 'The learner'} has no valid recorded sex.` });
  }
  requireValue(learner.birthDate, 'birthDate', SF9.headers.age, `${displayName(learner)}'s birthdate`);
  if (!String(learner.firstName || '').trim() || !String(learner.lastName || '').trim()) {
    issues.push({ severity: 'warning', fieldKey: 'learnerName', cellReference: SF9.headers.learnerName,
      message: 'The learner profile has an incomplete name.' });
  }
  if (!subjects.length) issues.push({ severity: 'warning', fieldKey: 'subjects', cellReference: null,
    message: 'No subjects are assigned to this section.' });
  if (!terms.length || terms.length > SF9.periodColumns.length) issues.push({ severity: 'error', fieldKey: 'terms', cellReference: null,
    message: 'SF9 requires two to four configured grading periods for this school level.' });

  const gradesBySubject = new Map();
  for (const grade of grades) {
    const key = `${grade.subjectId}:${grade.academicTermId}`;
    const matches = gradesBySubject.get(key) || [];
    matches.push(grade);
    gradesBySubject.set(key, matches);
  }

  const cells = [];
  const gradeNumberMatch = /^grade-(\d+)$/.exec(String(section.gradeCode || ''));
  const gradeNumber = gradeNumberMatch ? Number(gradeNumberMatch[1]) : '';
  const header = {
    region: school.region, division: school.division, district: school.district,
    address: school.addressLine, schoolName: school.schoolName,
    schoolYear: `School Year ${section.academicYear}`,
    learnerName: displayName(learner), age: learnerAge(learner.birthDate, section.academicYear),
    sex: learner.sex, lrn: learner.lrn, gradeLevel: gradeNumber,
    section: section.name, strand: section.strandName, adviser
  };
  Object.entries(SF9.headers).forEach(([fieldKey, cellAddress]) => {
    cells.push({ cellAddress, value: header[fieldKey] ?? '',
      type: ['age', 'gradeLevel'].includes(fieldKey) ? 'number' : 'text' });
  });

  const termHeaderNames = terms.length === SF9.periodColumns.length
    ? SF9.periodColumns.map((_, index) => `Q${index + 1}`)
    : terms.map(term => term.name);
  SF9.periodColumns.forEach((column, index) => {
    cells.push({ cellAddress: `${column}31`, value: termHeaderNames[index] || '', type: 'text' });
  });

  let allSubjectsComplete = subjects.length > 0 && terms.length > 0 && terms.length <= SF9.periodColumns.length;
  const subjectFinalGrades = [];
  subjects.forEach((subject, subjectIndex) => {
    const row = SF9.firstSubjectRow + subjectIndex;
    const subjectGrades = [];
    let subjectComplete = terms.length > 0 && terms.length <= SF9.periodColumns.length;
    terms.slice(0, SF9.periodColumns.length).forEach((term, termIndex) => {
      const matchingGrades = gradesBySubject.get(`${subject.id}:${term.id}`) || [];
      const cellAddress = `${SF9.periodColumns[termIndex]}${row}`;
      const gradeValue = matchingGrades[0]?.finalGrade;
      if (matchingGrades.length !== 1 || gradeValue === null || gradeValue === undefined
        || gradeValue === '' || !Number.isFinite(Number(gradeValue))) {
        subjectComplete = false;
        allSubjectsComplete = false;
        const reason = matchingGrades.length > 1 ? 'conflicting published grades' : 'no published grade';
        issues.push({ severity: 'warning', fieldKey: 'grade', cellReference: cellAddress,
          message: `${subject.name}, ${term.name}: ${reason}.` });
        cells.push({ cellAddress, value: '', type: 'number' });
      } else {
        const grade = Number(matchingGrades[0].finalGrade);
        subjectGrades.push(grade);
        cells.push({ cellAddress, value: grade, type: 'number' });
      }
    });

    for (let periodIndex = terms.length; periodIndex < SF9.periodColumns.length; periodIndex += 1) {
      cells.push({ cellAddress: `${SF9.periodColumns[periodIndex]}${row}`, value: '', type: 'number' });
    }

    const finalGrade = subjectComplete && subjectGrades.length === terms.length
      ? Number((subjectGrades.reduce((sum, grade) => sum + grade, 0) / terms.length).toFixed(2)) : null;
    if (finalGrade === null) allSubjectsComplete = false;
    else subjectFinalGrades.push(finalGrade);
    cells.push({ cellAddress: `B${row}`, value: subject.name, type: 'text' });
    cells.push({ cellAddress: `${SF9.finalGradeColumn}${row}`, value: finalGrade ?? '', type: 'number' });
  });

  const generalAverage = allSubjectsComplete && subjectFinalGrades.length === subjects.length
    ? Number((subjectFinalGrades.reduce((sum, grade) => sum + grade, 0) / subjects.length).toFixed(2)) : null;
  const averageCellAddress = `J${SF9.firstSubjectRow + Math.max(SF9.baseSubjectRows, subjects.length)}`;
  cells.push({ cellAddress: averageCellAddress, value: generalAverage ?? '', type: 'number' });
  if (!allSubjectsComplete && subjects.length) issues.push({ severity: 'warning', fieldKey: 'generalAverage', cellReference: averageCellAddress,
    message: 'The general average remains blank until every assigned subject has a published grade for every configured period.' });

  return { pages: [cells], issues, generalAverage, averageCellAddress };
}

module.exports = { SF9, buildSf9Pages, displayName, learnerAge };
