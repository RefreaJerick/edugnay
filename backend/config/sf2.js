const SF2 = {
  formCode: 'SF2',
  sheetName: 'School Form 2 (SF2)',
  maleStart: 13, maleSlots: 21,
  femaleStart: 35, femaleSlots: 25,
  headers: { schoolId: 'C6', schoolYear: 'K6', month: 'X6', schoolName: 'C8', gradeLevel: 'X8', section: 'AC8' }
};

function monthInYear(month, section) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return false;
  const start = String(section.startDate || `${String(section.academicYear).slice(0, 4)}-01-01`).slice(0, 7);
  const end = String(section.endDate || `${String(section.academicYear).slice(-4)}-12-31`).slice(0, 7);
  return month >= start && month <= end;
}

function buildSf2Pages(school, section, month, learners) {
  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF2 is a draft. Names reflect section assignments, not confirmed enrollment. Daily attendance, class days, monthly totals, enrollment, transfers, and signatures are intentionally blank. Do not add class dates until attendance is verified: on SF2, an empty attendance cell beside a date means present.' }];
  if (!school.depedSchoolId) issues.push({ severity: 'warning', fieldKey: 'schoolId', cellReference: 'C6', message: 'The school ID is not configured.' });
  const male = [];
  const female = [];
  learners.forEach(learner => {
    const sex = String(learner.sex || '').trim().toLowerCase();
    if (sex === 'male' || sex === 'm') male.push(learner);
    else if (sex === 'female' || sex === 'f') female.push(learner);
    else issues.push({ severity: 'warning', fieldKey: 'sex', cellReference: null,
      message: `${learner.lastName}, ${learner.firstName} has no valid recorded sex and cannot be placed in the male/female roster.` });
  });
  const pageCount = Math.max(1, Math.ceil(male.length / SF2.maleSlots), Math.ceil(female.length / SF2.femaleSlots));
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const cells = [];
    const header = {
      schoolId: school.depedSchoolId || '', schoolYear: section.academicYear,
      month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)) + ' ' + month.slice(0, 4),
      schoolName: school.schoolName || '', gradeLevel: section.gradeLevel, section: section.name
    };
    Object.entries(SF2.headers).forEach(([field, cellAddress]) => cells.push({ cellAddress, value: header[field], type: 'text' }));
    [[male, SF2.maleStart, SF2.maleSlots], [female, SF2.femaleStart, SF2.femaleSlots]].forEach(([group, start, slots]) => {
      group.slice(pageIndex * slots, (pageIndex + 1) * slots).forEach((learner, index) => {
        const row = start + index;
        cells.push({ cellAddress: `A${row}`, value: pageIndex * slots + index + 1, type: 'number' });
        cells.push({ cellAddress: `B${row}`, value: [learner.lastName, learner.firstName, learner.middleName].filter(Boolean).join(', '), type: 'text' });
      });
    });
    cells.push({ cellAddress: 'A91', value: `School Form 2 :  Page ${pageIndex + 1} of ${pageCount}`, type: 'text' });
    return cells;
  });
  return { pages, issues };
}

module.exports = { SF2, monthInYear, buildSf2Pages };
