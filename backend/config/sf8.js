const SF8 = {
  formCode: 'SF8',
  sheetName: 'School Form 8 (SF8)',
  maleStart: 12,
  maleSlots: 52,
  femaleStart: 65,
  femaleSlots: 44,
  headers: {
    schoolName: 'E5',
    district: 'I5',
    division: 'L5',
    region: 'O5',
    schoolId: 'C7',
    gradeLevel: 'F7',
    section: 'H7',
    strand: 'L7',
    schoolYear: 'O7'
  }
};

function formatLearnerName(learner) {
  return [learner.lastName, learner.firstName, learner.middleName]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function buildSf8Pages(school, section, learners) {
  const issues = [{
    severity: 'warning',
    fieldKey: 'draft',
    cellReference: null,
    message: 'SF8 is an editable draft. Verify learner details, complete the assessment, and review all results and totals before using the workbook as an official record.'
  }];
  const requiredSchoolFields = [
    ['schoolName', school.schoolName, 'School name'],
    ['schoolId', school.depedSchoolId, 'School ID'],
    ['district', school.district, 'District'],
    ['division', school.division, 'Division'],
    ['region', school.region, 'Region']
  ];
  requiredSchoolFields.forEach(([fieldKey, value, label]) => {
    if (!String(value || '').trim()) {
      issues.push({ severity: 'warning', fieldKey, cellReference: SF8.headers[fieldKey], message: `${label} is not configured.` });
    }
  });
  if (!learners.length) {
    issues.push({ severity: 'warning', fieldKey: 'roster', cellReference: null, message: 'No active students are assigned to this section.' });
  }

  const male = [];
  const female = [];
  learners.forEach(learner => {
    const name = formatLearnerName(learner);
    const sex = String(learner.sex || '').trim().toLowerCase();
    if (sex === 'male' || sex === 'm') male.push(learner);
    else if (sex === 'female' || sex === 'f') female.push(learner);
    else issues.push({ severity: 'warning', fieldKey: 'sex', cellReference: null,
      message: `${name || 'A learner'} has no valid recorded sex and cannot be placed in the male/female roster.` });

    if (!/^\d{12}$/.test(String(learner.lrn || '').trim())) {
      issues.push({ severity: 'warning', fieldKey: 'lrn', cellReference: null,
        message: `${name || 'A learner'} has a missing or invalid 12-digit LRN.` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(learner.birthDate || ''))) {
      issues.push({ severity: 'warning', fieldKey: 'birthDate', cellReference: null,
        message: `${name || 'A learner'} has no recorded birthdate.` });
    }
    if (!String(learner.lastName || '').trim() || !String(learner.firstName || '').trim()) {
      issues.push({ severity: 'warning', fieldKey: 'name', cellReference: null,
        message: `${name || 'A learner'} has an incomplete first or last name.` });
    }
  });

  const pageCount = Math.max(1, Math.ceil(male.length / SF8.maleSlots), Math.ceil(female.length / SF8.femaleSlots));
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const cells = [];
    const header = {
      schoolName: school.schoolName,
      district: school.district,
      division: school.division,
      region: school.region,
      schoolId: school.depedSchoolId,
      gradeLevel: section.gradeLevel,
      section: section.name,
      strand: section.strandName,
      schoolYear: section.academicYear
    };
    Object.entries(SF8.headers).forEach(([field, cellAddress]) => {
      cells.push({ cellAddress, value: header[field] || '', type: 'text' });
    });

    [[male, SF8.maleStart, SF8.maleSlots], [female, SF8.femaleStart, SF8.femaleSlots]].forEach(([group, start, slots]) => {
      group.slice(pageIndex * slots, (pageIndex + 1) * slots).forEach((learner, index) => {
        const row = start + index;
        cells.push({ cellAddress: `B${row}`, value: String(learner.lrn || '').trim(), type: 'text' });
        cells.push({
          cellAddress: `C${row}`,
          value: formatLearnerName(learner),
          type: 'text'
        });
        cells.push({ cellAddress: `G${row}`, value: learner.birthDate || '', type: 'date' });
      });
    });
    return cells;
  });

  return { pages, issues };
}

module.exports = { SF8, buildSf8Pages };
