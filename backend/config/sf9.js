const { DEPED_SHS_CORE_SUBJECTS } = require('./depedShsCoreSubjects');
const { COMMUNICATION_COMPONENTS } = require('./shsCommunication');
const { calculateSubjectFinal } = require('./shsGrading');

const SF9 = {
  formCode: 'SF9',
  sheetName: 'SF9 - GRADE 4-10',
  firstSubjectRow: 32,
  baseSubjectRows: 10,
  periodColumns: ['F', 'G', 'H'],
  finalGradeColumn: 'I',
  remarksColumn: 'J',
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

const SF9_GRADE11_ACADEMIC = {
  formCode: 'SF9',
  version: 'g11-academic-2026-2027',
  sheetName: 'SF9 - GRADE 11 ACADEMIC',
  periodColumns: ['F', 'G', 'H'],
  finalGradeColumn: 'I',
  remarksColumn: 'J',
  electiveRows: [41, 42, 43],
  generalAverageRow: 44,
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
    track: 'E19',
    adviser: 'H27'
  },
  coreSubjects: [
    { code: 'shs-core-communication', row: 33 },
    { code: 'shs-core-mathematics', row: 36 },
    { code: 'shs-core-science', row: 37 },
    { code: 'shs-core-life-career', row: 38 },
    { code: 'shs-core-philippine-history', row: 39 }
  ],
  communicationComponents: [
    { code: 'english', row: 34 },
    { code: 'filipino', row: 35 }
  ]
};

const SF9_GRADE11_TECHPRO = {
  formCode: 'SF9',
  version: 'g11-techpro-2026-2027',
  sheetName: 'SF9 - GRADE 11 TECHPRO',
  periodColumns: ['F', 'G', 'H'],
  finalGradeColumn: 'I',
  remarksColumn: 'J',
  electiveRow: 41,
  generalAverageRow: 43,
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
    track: 'E19',
    adviser: 'H27'
  },
  coreSubjects: SF9_GRADE11_ACADEMIC.coreSubjects,
  communicationComponents: SF9_GRADE11_ACADEMIC.communicationComponents
};

const SF9_GRADE12_ACADEMIC = {
  formCode: 'SF9',
  version: 'g12-academic-2026-2027',
  sheetName: 'SF9 - GRADE 12 ACADEMIC',
  periodColumns: ['F', 'G', 'H'],
  electiveRowsByTerm: [[33, 34, 35], [36, 37, 38], [39, 40, 41]],
  generalAverageRow: 43,
  headers: SF9_GRADE11_ACADEMIC.headers
};

function displayName(learner) {
  return [learner.lastName, learner.firstName, learner.middleName]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function isGrade11AcademicSf9(template) {
  return template?.formCode === SF9_GRADE11_ACADEMIC.formCode
    && template?.version === SF9_GRADE11_ACADEMIC.version;
}

function isGrade11TechProSf9(template) {
  return template?.formCode === SF9_GRADE11_TECHPRO.formCode
    && template?.version === SF9_GRADE11_TECHPRO.version;
}

function isGrade12AcademicSf9(template) {
  return template?.formCode === SF9_GRADE12_ACADEMIC.formCode
    && template?.version === SF9_GRADE12_ACADEMIC.version;
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
  const currentPolicy = section.academicYear === '2026-2027';
  const reportTerms = terms.slice(0, SF9.periodColumns.length);
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: currentPolicy
      ? 'SF9 is a draft. Enter the general average manually after review. Any GMRC/Values Education grades require separate domain-based verification and are left blank. Complete attendance, comments, signatures, and transfer details from verified records.'
      : 'SF9 is a draft. Class-day attendance, comments, signatures, and transfer details are left blank for adviser completion from verified records. Review grades and learner details before issuing the report card.' }];
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
  if (!terms.length || terms.length > 4) issues.push({ severity: 'error', fieldKey: 'terms', cellReference: null,
    message: 'SF9 requires one to four configured grading periods for this school level.' });
  if (terms.length !== SF9.periodColumns.length) issues.push({ severity: 'warning', fieldKey: 'terms', cellReference: null,
    message: `SF9 has three printed term columns, but this section has ${terms.length} configured grading periods. Only the first three periods can be shown, and calculated subject Final Grades will remain blank. Configure exactly three grading periods or enter and verify Final Grades manually.` });

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

  let allSubjectsComplete = subjects.length > 0 && terms.length === SF9.periodColumns.length;
  const subjectFinalGrades = [];
  subjects.forEach((subject, subjectIndex) => {
    const row = SF9.firstSubjectRow + subjectIndex;
    const policyReview = currentPolicy && (/^(gmrc|values-education)(?:-|$)/i.test(String(subject.code || ''))
      || /^(?:good manners and right conduct(?:\s*\(gmrc\))?|gmrc|values education)$/i.test(String(subject.name || '').trim()));
    const subjectGrades = [];
    let subjectComplete = terms.length === SF9.periodColumns.length;
    if (policyReview) {
      issues.push({ severity: 'warning', fieldKey: 'gradePolicyReview', cellReference: `F${row}`,
        message: `${subject.name}: term and final grades are blank because the GMRC/Values Education domain-weight calculation is not implemented. Adviser must verify and enter them manually.` });
      cells.push({ cellAddress: `B${row}`, value: subject.name, type: 'text' });
      SF9.periodColumns.forEach(column => cells.push({ cellAddress: `${column}${row}`, value: '', type: 'number' }));
      cells.push({ cellAddress: `${SF9.finalGradeColumn}${row}`, value: '', type: 'number' });
      allSubjectsComplete = false;
      return;
    }
    reportTerms.forEach((term, termIndex) => {
      const matchingGrades = gradesBySubject.get(`${subject.id}:${term.id}`) || [];
      const cellAddress = `${SF9.periodColumns[termIndex]}${row}`;
      const gradeValue = matchingGrades[0]?.finalGrade;
      if (matchingGrades.length !== 1 || gradeValue === null || gradeValue === undefined
        || gradeValue === '' || !Number.isFinite(Number(gradeValue))
        || (currentPolicy && (Number(gradeValue) < 0 || Number(gradeValue) > 100))) {
        subjectComplete = false;
        allSubjectsComplete = false;
        const reason = matchingGrades.length > 1 ? 'conflicting published grades'
          : matchingGrades.length ? 'invalid published grade' : 'no published grade';
        issues.push({ severity: 'warning', fieldKey: 'grade', cellReference: cellAddress,
          message: `${subject.name}, ${term.name}: ${reason}.` });
        cells.push({ cellAddress, value: '', type: 'number' });
      } else {
        const grade = Number(matchingGrades[0].finalGrade);
        subjectGrades.push(grade);
        cells.push({ cellAddress, value: grade, type: 'number' });
      }
    });

    for (let periodIndex = reportTerms.length; periodIndex < SF9.periodColumns.length; periodIndex += 1) {
      cells.push({ cellAddress: `${SF9.periodColumns[periodIndex]}${row}`, value: '', type: 'number' });
    }

    const finalGrade = subjectComplete && subjectGrades.length === SF9.periodColumns.length
      ? currentPolicy
        ? Math.round(subjectGrades.reduce((sum, grade) => sum + grade, 0) / terms.length)
        : Number((subjectGrades.reduce((sum, grade) => sum + grade, 0) / terms.length).toFixed(2))
      : null;
    if (finalGrade === null) allSubjectsComplete = false;
    else subjectFinalGrades.push(finalGrade);
    cells.push({ cellAddress: `B${row}`, value: subject.name, type: 'text' });
    cells.push({ cellAddress: `${SF9.finalGradeColumn}${row}`, value: finalGrade ?? '', type: 'number' });
  });

  const generalAverage = !currentPolicy && allSubjectsComplete && subjectFinalGrades.length === subjects.length
    ? Number((subjectFinalGrades.reduce((sum, grade) => sum + grade, 0) / subjects.length).toFixed(2)) : null;
  const averageCellAddress = `${SF9.finalGradeColumn}${SF9.firstSubjectRow + Math.max(SF9.baseSubjectRows, subjects.length)}`;
  cells.push({ cellAddress: averageCellAddress, value: generalAverage ?? '', type: 'number' });
  if (!currentPolicy && !allSubjectsComplete && subjects.length) issues.push({ severity: 'warning', fieldKey: 'generalAverage', cellReference: averageCellAddress,
    message: terms.length !== SF9.periodColumns.length
      ? 'The general average remains blank because SF9 requires exactly three configured grading periods.'
      : 'The general average remains blank until every assigned subject has a published grade for all three periods.' });

  return { pages: [cells], issues, generalAverage, averageCellAddress };
}

function displayGrade11SectionName(school, section, adviser, learner) {
  return {
    region: school.region,
    division: school.division,
    district: school.district,
    address: school.addressLine,
    schoolName: school.schoolName,
    schoolYear: `School Year ${section.academicYear}`,
    learnerName: displayName(learner),
    age: learnerAge(learner.birthDate, section.academicYear),
    sex: learner.sex,
    lrn: learner.lrn,
    gradeLevel: 11,
    section: section.name,
    track: section.trackName,
    adviser
  };
}

function buildSf9Grade11CorePages(school, section, adviser, learner, subjects, terms, grades,
  communicationGrades, definition, trackLabel) {
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF9 is a draft. The general average, attendance, comments, signatures, transfer details, and school head information are left for adviser review and completion from verified records.' }];
  const requireValue = (value, fieldKey, cellReference, label) => {
    if (!String(value || '').trim()) issues.push({ severity: 'warning', fieldKey, cellReference,
      message: `${label} is not configured.` });
  };

  requireValue(school.depedSchoolId, 'schoolId', null, 'School ID');
  requireValue(school.region, 'region', definition.headers.region, 'Region');
  requireValue(school.division, 'division', definition.headers.division, 'Division');
  requireValue(school.district, 'district', definition.headers.district, 'District');
  requireValue(school.addressLine, 'address', definition.headers.address, 'School address');
  requireValue(school.schoolName, 'schoolName', definition.headers.schoolName, 'School name');
  requireValue(learner.lrn, 'lrn', definition.headers.lrn, `${displayName(learner)}'s LRN`);
  const sex = String(learner.sex || '').trim().toLowerCase();
  if (!['male', 'm', 'female', 'f'].includes(sex)) {
    issues.push({ severity: 'warning', fieldKey: 'sex', cellReference: definition.headers.sex,
      message: `${displayName(learner) || 'The learner'} has no valid recorded sex.` });
  }
  requireValue(learner.birthDate, 'birthDate', definition.headers.age, `${displayName(learner)}'s birthdate`);
  if (!String(learner.firstName || '').trim() || !String(learner.lastName || '').trim()) {
    issues.push({ severity: 'warning', fieldKey: 'learnerName', cellReference: definition.headers.learnerName,
      message: 'The learner profile has an incomplete name.' });
  }
  requireValue(section.trackName, 'track', definition.headers.track, trackLabel);

  const sortedTerms = [...terms].sort((left, right) => Number(left.sequenceNumber) - Number(right.sequenceNumber));
  const termBySequence = new Map();
  for (const term of sortedTerms) {
    const sequence = Number(term.sequenceNumber);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 3 || termBySequence.has(sequence)) {
      issues.push({ severity: 'error', fieldKey: 'terms', cellReference: null,
        message: `The Grade 11 ${trackLabel.replace(' track', '')} SF9 needs exactly one configured term for each of Terms 1, 2, and 3.` });
      break;
    }
    termBySequence.set(sequence, term);
  }
  if (terms.length !== 3 || [1, 2, 3].some(sequence => !termBySequence.has(sequence))) {
    if (!issues.some(issue => issue.fieldKey === 'terms')) {
      issues.push({ severity: 'error', fieldKey: 'terms', cellReference: null,
        message: `The Grade 11 ${trackLabel.replace(' track', '')} SF9 has three term columns, but this section has ${terms.length} configured terms. Configure Terms 1–3 before generating this form.` });
    }
  }

  const cells = [];
  const header = displayGrade11SectionName(school, section, adviser, learner);
  Object.entries(definition.headers).forEach(([fieldKey, cellAddress]) => {
    const value = fieldKey === 'track' && isGrade11TechProSf9(definition)
      ? 'Technical Professional' : header[fieldKey] ?? '';
    cells.push({ cellAddress, value,
      type: ['age', 'gradeLevel'].includes(fieldKey) ? 'number' : 'text' });
  });

  const subjectByCode = new Map(subjects.map(subject => [String(subject.code || ''), subject]));
  const validGrade = value => value !== null && value !== undefined && value !== ''
    && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  const addPublishedGrades = ({ row, label, gradeRows, fieldKey }) => {
    cells.push({ cellAddress: `B${row}`, value: label, type: 'text' });
    const validFinals = [];
    let complete = terms.length === 3;
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const term = termBySequence.get(sequence);
      const cellAddress = `${definition.periodColumns[sequence - 1]}${row}`;
      const matches = term ? gradeRows.filter(grade => Number(grade.academicTermId) === Number(term.id)) : [];
      if (matches.length !== 1 || !validGrade(matches[0]?.finalGrade)) {
        complete = false;
        const reason = matches.length > 1 ? 'conflicting published grades'
          : matches.length === 1 ? 'invalid published grade' : 'no published grade';
        issues.push({ severity: 'warning', fieldKey, cellReference: cellAddress, message: `${label}, Term ${sequence}: ${reason}.` });
        cells.push({ cellAddress, value: '', type: 'number' });
      } else {
        const grade = Number(matches[0].finalGrade);
        validFinals.push(grade);
        cells.push({ cellAddress, value: grade, type: 'number' });
      }
    }

    const finalGrade = complete ? calculateSubjectFinal(validFinals) : null;
    if (finalGrade === null) {
      issues.push({ severity: 'warning', fieldKey: 'grade', cellReference: `I${row}`,
        message: `${label}: the final grade remains blank until valid grades are published for all three terms.` });
    }
    cells.push({ cellAddress: `I${row}`, value: finalGrade ?? '', type: 'number' });
    cells.push({ cellAddress: `J${row}`, value: '', type: 'text' });
  };

  for (const subjectDefinition of definition.coreSubjects) {
    const catalogSubject = DEPED_SHS_CORE_SUBJECTS.find(subject => subject.code === subjectDefinition.code);
    const assignedSubject = subjectByCode.get(subjectDefinition.code);
    const label = catalogSubject?.name || assignedSubject?.name || subjectDefinition.code;
    const matchingGrades = subjectDefinition.code === 'shs-core-communication'
      ? grades.filter(grade => Number(grade.subjectId) === Number(assignedSubject?.id)
        && grade.communicationGradeSource === 'component_average')
      : grades.filter(grade => Number(grade.subjectId) === Number(assignedSubject?.id));
    if (!assignedSubject) {
      issues.push({ severity: 'warning', fieldKey: 'subject', cellReference: `B${subjectDefinition.row}`,
        message: `${label} is not assigned to this section.` });
    }
    addPublishedGrades({ row: subjectDefinition.row, label, gradeRows: matchingGrades, fieldKey: 'grade' });
  }

  const componentNames = COMMUNICATION_COMPONENTS;
  const communicationSubjectId = subjectByCode.get('shs-core-communication')?.id;
  for (const componentDefinition of definition.communicationComponents) {
    const label = componentNames[componentDefinition.code];
    const componentRows = communicationGrades.filter(grade => Number(grade.subjectId) === Number(communicationSubjectId)
      && grade.communicationComponentCode === componentDefinition.code);
    if (!componentRows.length) issues.push({ severity: 'warning', fieldKey: 'communicationComponent',
      cellReference: `B${componentDefinition.row}`, message: `${label} has no published component grades.` });
    addPublishedGrades({ row: componentDefinition.row, label, gradeRows: componentRows, fieldKey: 'communicationComponentGrade' });
  }

  return { issues, cells, validGrade, termBySequence };
}

function buildSf9Grade11AcademicPages(school, section, adviser, learner, subjects, terms, grades,
  communicationGrades, electiveClasses, electiveGrades) {
  const { issues, cells, validGrade } = buildSf9Grade11CorePages(school, section, adviser, learner,
    subjects, terms, grades, communicationGrades, SF9_GRADE11_ACADEMIC, 'Academic track');

  const uniqueElectives = new Map();
  electiveClasses.forEach(record => uniqueElectives.set(String(record.electiveClassId), record));
  const electives = [...uniqueElectives.values()].sort((left, right) => {
    const leftSequence = Math.min(...electiveGrades.filter(grade => String(grade.electiveClassId) === String(left.electiveClassId))
      .map(grade => Number(grade.termSequenceNumber) || 99), 99);
    const rightSequence = Math.min(...electiveGrades.filter(grade => String(grade.electiveClassId) === String(right.electiveClassId))
      .map(grade => Number(grade.termSequenceNumber) || 99), 99);
    return leftSequence - rightSequence || String(left.electiveName || '').localeCompare(String(right.electiveName || ''))
      || Number(left.electiveClassId) - Number(right.electiveClassId);
  });
  if (electives.length > SF9_GRADE11_ACADEMIC.electiveRows.length) {
    issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
      message: `This section has ${electives.length} approved electives, but the Grade 11 Academic SF9 has only three elective rows. Resolve the elective list before generating the form.` });
  }
  SF9_GRADE11_ACADEMIC.electiveRows.forEach((row, index) => {
    const elective = electives[index];
    const label = String(elective?.electiveName || '').trim();
    if (!elective) {
      cells.push({ cellAddress: `B${row}`, value: '', type: 'text' });
      SF9_GRADE11_ACADEMIC.periodColumns.forEach(column => cells.push({ cellAddress: `${column}${row}`, value: '', type: 'number' }));
      cells.push({ cellAddress: `I${row}`, value: '', type: 'number' });
      cells.push({ cellAddress: `J${row}`, value: '', type: 'text' });
      return;
    }
    const classGrades = electiveGrades.filter(grade => String(grade.electiveClassId) === String(elective.electiveClassId));
    const validClassGrades = classGrades.filter(grade => Number(grade.termSequenceNumber) >= 1
      && Number(grade.termSequenceNumber) <= 3 && validGrade(grade.finalGrade));
    const gradesByTerm = new Map();
    validClassGrades.forEach(grade => {
      const sequence = Number(grade.termSequenceNumber);
      const records = gradesByTerm.get(sequence) || [];
      records.push(grade);
      gradesByTerm.set(sequence, records);
    });
    const rowGrades = [];
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const records = gradesByTerm.get(sequence) || [];
      const cellAddress = `${SF9_GRADE11_ACADEMIC.periodColumns[sequence - 1]}${row}`;
      if (records.length > 1) {
        issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: cellAddress,
          message: `${label}, Term ${sequence}: conflicting published elective grades.` });
        cells.push({ cellAddress, value: '', type: 'number' });
      } else {
        const grade = records[0];
        cells.push({ cellAddress, value: grade ? Number(grade.finalGrade) : '', type: 'number' });
        if (grade) rowGrades.push(grade);
      }
    }
    const hasInvalidGrade = classGrades.some(grade => !validGrade(grade.finalGrade)
      || Number(grade.termSequenceNumber) < 1 || Number(grade.termSequenceNumber) > 3);
    const finalGrade = !hasInvalidGrade && rowGrades.length === 1 && [...gradesByTerm.values()].every(records => records.length === 1)
      ? Number(rowGrades[0].finalGrade) : null;
    if (hasInvalidGrade) issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: `I${row}`,
      message: `${label} has an invalid or unsupported term grade. Its final grade is left blank for adviser review.` });
    else if (rowGrades.length > 1) issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: `I${row}`,
      message: `${label} has grades in more than one term. Its final grade is left blank for adviser review.` });
    else if (!rowGrades.length) issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: `I${row}`,
      message: `${label} has no published elective grade.` });
    cells.push({ cellAddress: `B${row}`, value: label, type: 'text' });
    cells.push({ cellAddress: `I${row}`, value: finalGrade ?? '', type: 'number' });
    cells.push({ cellAddress: `J${row}`, value: '', type: 'text' });
  });

  cells.push({ cellAddress: `I${SF9_GRADE11_ACADEMIC.generalAverageRow}`, value: '', type: 'number' });
  issues.push({ severity: 'warning', fieldKey: 'generalAverage', cellReference: `I${SF9_GRADE11_ACADEMIC.generalAverageRow}`,
    message: 'The general average is left blank for adviser review.' });
  return { pages: [cells], issues, generalAverage: null, averageCellAddress: `I${SF9_GRADE11_ACADEMIC.generalAverageRow}` };
}

function buildSf9Grade11TechProPages(school, section, adviser, learner, subjects, terms, grades,
  communicationGrades, electiveClasses, electiveGrades) {
  const { issues, cells, validGrade, termBySequence } = buildSf9Grade11CorePages(school, section, adviser, learner,
    subjects, terms, grades, communicationGrades, SF9_GRADE11_TECHPRO, 'TechPro track');
  const uniqueClasses = new Map();
  electiveClasses.forEach(record => uniqueClasses.set(String(record.electiveClassId), record));
  const approvedClasses = [...uniqueClasses.values()];
  const techProElectives = approvedClasses.filter(record => record.trackCode === 'techpro'
    && record.subjectType === 'techpro_elective');
  const unsupportedChoices = approvedClasses.filter(record => record.trackCode !== 'techpro'
    || record.subjectType !== 'techpro_elective');

  if (unsupportedChoices.length) issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
    message: 'This Grade 11 TechPro SF9 has one elective row. The learner has additional cross-track or unsupported elective choices that cannot fit in this workbook.' });
  if (techProElectives.length > 1) issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
    message: 'This Grade 11 TechPro SF9 has one elective row, but more than one TechPro elective is approved.' });

  const elective = techProElectives.length === 1 ? techProElectives[0] : null;
  const label = String(elective?.electiveName || '').trim();
  const classGrades = elective
    ? electiveGrades.filter(grade => String(grade.electiveClassId) === String(elective.electiveClassId)) : [];
  const gradesBySequence = new Map();
  let hasUnexpectedGrade = false;
  classGrades.forEach(grade => {
    const sequence = Number(grade.termSequenceNumber);
    const matchingTerm = termBySequence.get(sequence);
    if (!matchingTerm || Number(grade.academicTermId) !== Number(matchingTerm.id)) {
      hasUnexpectedGrade = true;
      const column = sequence >= 1 && sequence <= 3 ? SF9_GRADE11_TECHPRO.periodColumns[sequence - 1] : 'I';
      issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: `${column}${SF9_GRADE11_TECHPRO.electiveRow}`,
        message: `${label || 'The TechPro elective'} has a published grade outside the configured Terms 1–3.` });
      return;
    }
    const rows = gradesBySequence.get(sequence) || [];
    rows.push(grade);
    gradesBySequence.set(sequence, rows);
  });

  const startSequence = Number(elective?.startTermSequenceNumber);
  const endSequence = Number(elective?.endTermSequenceNumber);
  const firstConfiguredTerm = termBySequence.get(1);
  const lastConfiguredTerm = termBySequence.get(3);
  const termSpanValid = Boolean(elective && startSequence === 1 && endSequence === 3
    && firstConfiguredTerm && lastConfiguredTerm
    && String(elective.startTermId) === String(firstConfiguredTerm.id)
    && String(elective.endTermId) === String(lastConfiguredTerm.id));
  if (elective && !termSpanValid) issues.push({ severity: 'error', fieldKey: 'electiveTerms',
    cellReference: 'B41', message: `${label} must be assigned across Terms 1–3 before this SF9 can be generated.` });

  const termGrades = [];
  let allTermsValid = Boolean(elective && termSpanValid && terms.length === 3);
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    const cellAddress = `${SF9_GRADE11_TECHPRO.periodColumns[sequence - 1]}${SF9_GRADE11_TECHPRO.electiveRow}`;
    const matchingGrades = gradesBySequence.get(sequence) || [];
    if (matchingGrades.length !== 1 || !validGrade(matchingGrades[0]?.finalGrade)) {
      allTermsValid = false;
      const reason = matchingGrades.length > 1 ? 'conflicting published grades'
        : matchingGrades.length === 1 ? 'invalid published grade' : 'no published grade';
      if (elective) issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: cellAddress,
        message: `${label}, Term ${sequence}: ${reason}.` });
      cells.push({ cellAddress, value: '', type: 'number' });
    } else {
      const grade = Number(matchingGrades[0].finalGrade);
      termGrades.push(grade);
      cells.push({ cellAddress, value: grade, type: 'number' });
    }
  }
  if (hasUnexpectedGrade) allTermsValid = false;

  if (!techProElectives.length) issues.push({ severity: 'warning', fieldKey: 'elective', cellReference: 'B41',
    message: 'No approved Grade 11 TechPro elective is recorded for this learner.' });
  const finalGrade = allTermsValid && termGrades.length === 3 ? calculateSubjectFinal(termGrades) : null;
  if (elective && finalGrade === null) issues.push({ severity: 'warning', fieldKey: 'electiveGrade',
    cellReference: 'I41', message: `${label}: the final grade remains blank until valid grades are published for Terms 1, 2, and 3.` });
  cells.push({ cellAddress: 'B41', value: label, type: 'text' });
  cells.push({ cellAddress: 'I41', value: finalGrade ?? '', type: 'number' });
  cells.push({ cellAddress: 'J41', value: '', type: 'text' });
  cells.push({ cellAddress: `I${SF9_GRADE11_TECHPRO.generalAverageRow}`, value: '', type: 'number' });
  issues.push({ severity: 'warning', fieldKey: 'generalAverage',
    cellReference: `I${SF9_GRADE11_TECHPRO.generalAverageRow}`, message: 'The general average is left blank for adviser review.' });

  return { pages: [cells], issues, generalAverage: null,
    averageCellAddress: `I${SF9_GRADE11_TECHPRO.generalAverageRow}` };
}

function buildSf9Grade12AcademicPages(school, section, adviser, learner, terms, electiveClasses, electiveGrades) {
  const definition = SF9_GRADE12_ACADEMIC;
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF9 is a draft. The general average, attendance, comments, signatures, transfer details, and school head information require adviser review from verified records.' }];
  const cells = [];
  const header = { ...displayGrade11SectionName(school, section, adviser, learner), gradeLevel: 12 };
  Object.entries(definition.headers).forEach(([fieldKey, cellAddress]) => {
    cells.push({ cellAddress, value: header[fieldKey] ?? '',
      type: ['age', 'gradeLevel'].includes(fieldKey) ? 'number' : 'text' });
    if (['region', 'division', 'district', 'address', 'schoolName', 'learnerName', 'lrn', 'track'].includes(fieldKey)
      && !String(header[fieldKey] ?? '').trim()) {
      issues.push({ severity: 'warning', fieldKey, cellReference: cellAddress,
        message: `${fieldKey} is missing from the verified school or learner record.` });
    }
  });
  if (header.age === null) issues.push({ severity: 'warning', fieldKey: 'birthDate',
    cellReference: definition.headers.age, message: 'The learner has no verified birthdate for the age field.' });

  const termBySequence = new Map();
  terms.forEach(term => {
    const sequence = Number(term.sequenceNumber);
    if (Number.isInteger(sequence) && sequence >= 1 && sequence <= 3 && !termBySequence.has(sequence)) {
      termBySequence.set(sequence, term);
    }
  });
  if (terms.length !== 3 || termBySequence.size !== 3) issues.push({ severity: 'error',
    fieldKey: 'terms', cellReference: null,
    message: 'The Grade 12 Academic SF9 requires exactly three ordered terms numbered 1–3.' });

  const uniqueClasses = new Map(electiveClasses.map(record => [String(record.electiveClassId), record]));
  const electives = [...uniqueClasses.values()];
  if (electives.some(elective => elective.trackCode && elective.trackCode !== 'academic'
    || elective.subjectType && elective.subjectType !== 'academic_elective')) {
    issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
      message: 'This learner has an approved cross-track or unsupported elective that cannot be shown on the Grade 12 Academic SF9.' });
  }
  if (electives.length > 9) issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
    message: `This learner has ${electives.length} approved electives, but the Grade 12 Academic SF9 has only nine rows.` });
  if (!electives.length) issues.push({ severity: 'warning', fieldKey: 'electives', cellReference: 'B33',
    message: 'No approved Grade 12 Academic electives are recorded for this learner.' });

  const byStartTerm = [[], [], []];
  for (const elective of electives) {
    const start = Number(elective.startTermSequenceNumber);
    const end = Number(elective.endTermSequenceNumber);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 3 || end < start
      || Number(elective.startTermId) !== Number(termBySequence.get(start)?.id)
      || Number(elective.endTermId) !== Number(termBySequence.get(end)?.id)) {
      issues.push({ severity: 'error', fieldKey: 'electiveTerms', cellReference: null,
        message: `${elective.electiveName || 'An approved elective'} has no valid Term 1–3 assignment for this school year.` });
      continue;
    }
    byStartTerm[start - 1].push(elective);
  }
  byStartTerm.forEach((group, index) => {
    group.sort((left, right) => String(left.electiveName || '').localeCompare(String(right.electiveName || ''))
      || Number(left.electiveClassId) - Number(right.electiveClassId));
    if (group.length > 3) issues.push({ severity: 'error', fieldKey: 'electives', cellReference: null,
      message: `Term ${index + 1} has ${group.length} approved electives, but the form has only three rows for that term.` });
  });

  const validGrade = value => value !== null && value !== undefined && value !== ''
    && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  definition.electiveRowsByTerm.forEach((rows, termIndex) => rows.forEach((row, index) => {
    const elective = byStartTerm[termIndex][index];
    const label = String(elective?.electiveName || '').trim();
    cells.push({ cellAddress: `B${row}`, value: label, type: 'text' });
    const classGrades = electiveGrades.filter(grade => String(grade.electiveClassId) === String(elective?.electiveClassId));
    const start = Number(elective?.startTermSequenceNumber);
    const end = Number(elective?.endTermSequenceNumber);
    let complete = Boolean(elective);
    const validGrades = [];
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const address = `${definition.periodColumns[sequence - 1]}${row}`;
      const expected = elective && sequence >= start && sequence <= end;
      const matches = classGrades.filter(grade => Number(grade.academicTermId) === Number(termBySequence.get(sequence)?.id));
      if (!expected) {
        cells.push({ cellAddress: address, value: '', type: 'number' });
        if (matches.length) complete = false;
        continue;
      }
      if (matches.length !== 1 || !validGrade(matches[0].finalGrade)) {
        complete = false;
        issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: address,
          message: `${label}, Term ${sequence}: ${matches.length > 1 ? 'conflicting' : matches.length ? 'invalid' : 'missing'} published grade.` });
        cells.push({ cellAddress: address, value: '', type: 'number' });
      } else {
        const grade = Number(matches[0].finalGrade);
        validGrades.push(grade);
        cells.push({ cellAddress: address, value: grade, type: 'number' });
      }
    }
    if (elective && classGrades.some(grade => ![1, 2, 3].includes(Number(grade.termSequenceNumber))
      || Number(grade.academicTermId) !== Number(termBySequence.get(Number(grade.termSequenceNumber))?.id)
      || Number(grade.termSequenceNumber) < start || Number(grade.termSequenceNumber) > end)) {
      complete = false;
      issues.push({ severity: 'warning', fieldKey: 'electiveGrade', cellReference: `I${row}`,
        message: `${label} has a grade outside its verified term assignment.` });
    }
    const finalGrade = complete && validGrades.length === end - start + 1
      ? calculateSubjectFinal(validGrades) : null;
    cells.push({ cellAddress: `I${row}`, value: finalGrade ?? '', type: 'number' });
    cells.push({ cellAddress: `J${row}`, value: '', type: 'text' });
  }));
  cells.push({ cellAddress: 'I43', value: '', type: 'number' });
  issues.push({ severity: 'warning', fieldKey: 'generalAverage', cellReference: 'I43',
    message: 'The general average is left blank for adviser review.' });
  return { pages: [cells], issues, generalAverage: null, averageCellAddress: 'I43' };
}

module.exports = { SF9, SF9_GRADE11_ACADEMIC, SF9_GRADE11_TECHPRO, SF9_GRADE12_ACADEMIC, buildSf9Pages,
  buildSf9Grade11AcademicPages, buildSf9Grade11TechProPages, buildSf9Grade12AcademicPages,
  displayName, isGrade11AcademicSf9, isGrade11TechProSf9, isGrade12AcademicSf9, learnerAge };
