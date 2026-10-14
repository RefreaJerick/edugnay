const SF3 = {
  formCode: 'SF3',
  sheetName: 'School Form 3 (SF3)',
  maleStart: 12,
  maleSlots: 24,
  femaleStart: 37,
  femaleSlots: 23,
  headers: {
    schoolId: 'C5',
    schoolYear: 'K5',
    schoolName: 'C7',
    gradeLevel: 'K7',
    section: 'N7'
  }
};

function buildSf3Pages(school, section, learners) {
  const issues = [{
    severity: 'warning',
    fieldKey: 'draft',
    cellReference: null,
    message: 'SF3 is a roster draft. Complete and verify book titles, issue and return dates, copy totals, remarks, and signatures in the downloaded workbook.'
  }];
  if (!school.depedSchoolId) {
    issues.push({ severity: 'warning', fieldKey: 'schoolId', cellReference: 'C5', message: 'The school ID is not configured.' });
  }

  const male = [];
  const female = [];
  learners.forEach(learner => {
    const sex = String(learner.sex || '').trim().toLowerCase();
    if (sex === 'male' || sex === 'm') male.push(learner);
    else if (sex === 'female' || sex === 'f') female.push(learner);
    else issues.push({
      severity: 'warning',
      fieldKey: 'sex',
      cellReference: null,
      message: `${learner.lastName}, ${learner.firstName} has no valid recorded sex and cannot be placed in the male/female roster.`
    });
  });

  if (!learners.length) {
    issues.push({ severity: 'warning', fieldKey: 'roster', cellReference: null, message: 'No active students are assigned to this section.' });
  }

  const pageCount = Math.max(1, Math.ceil(male.length / SF3.maleSlots), Math.ceil(female.length / SF3.femaleSlots));
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const cells = [];
    const header = {
      schoolId: school.depedSchoolId || '',
      schoolYear: section.academicYear || '',
      schoolName: school.schoolName || '',
      gradeLevel: section.gradeLevel || '',
      section: section.name || ''
    };
    Object.entries(SF3.headers).forEach(([field, cellAddress]) => {
      cells.push({ cellAddress, value: header[field], type: 'text' });
    });

    [[male, SF3.maleStart, SF3.maleSlots], [female, SF3.femaleStart, SF3.femaleSlots]].forEach(([group, start, slots]) => {
      group.slice(pageIndex * slots, (pageIndex + 1) * slots).forEach((learner, index) => {
        const row = start + index;
        cells.push({ cellAddress: `A${row}`, value: pageIndex * slots + index + 1, type: 'number' });
        cells.push({
          cellAddress: `B${row}`,
          value: [learner.lastName, learner.firstName, learner.middleName].filter(Boolean).join(', '),
          type: 'text'
        });
      });
    });

    cells.push({ cellAddress: 'T68', value: `School Form 3: Page ${pageIndex + 1} of ${pageCount}`, type: 'text' });
    return cells;
  });

  return { pages, issues };
}

module.exports = { SF3, buildSf3Pages };
