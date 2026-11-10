const SF10 = {
  formCode: 'SF10',
  sheets: ['Front', 'Back'],
  blocks: [
    { sheet: 'Front', header: 21, grades: 26, average: 40 },
    { sheet: 'Front', header: 49, grades: 54, average: 68 },
    { sheet: 'Back', header: 3, grades: 8, average: 22 },
    { sheet: 'Back', header: 31, grades: 36, average: 50 },
    { sheet: 'Back', header: 59, grades: 64, average: 78 }
  ],
  subjects: [
    ['filipino', 0], ['english', 1], ['mathematics', 2], ['science', 3],
    ['araling-panlipunan', 4], ['values-education', 5], ['tle', 6],
    ['music-and-arts', 8], ['physical-education-and-health', 9]
  ],
  periodColumns: ['U', 'Y', 'AC', 'AG']
};

function nameOf(learner) {
  return [learner.lastName, learner.firstName, learner.middleName].filter(Boolean).join(', ');
}

function isSf10EntryCell(sheet, address) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(address || '').toUpperCase());
  if (!match || !SF10.sheets.includes(sheet)) return false;
  const column = [...match[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  if (column < 2 || column > 55) return false;
  if (sheet === 'Front' && ([7, 8, 12, 13, 16, 17, 79, 80, 84].includes(row))) return true;
  if (sheet === 'Back' && [89, 90, 94].includes(row)) return true;
  return SF10.blocks.some(block => block.sheet === sheet && (
    row === block.header || row === block.header + 1
    || row >= block.grades && row < block.grades + 10
    || row === block.average
    || row >= block.header + 21 && row <= block.header + 26
  ));
}

function isCompleteQuarterlySchedule(terms) {
  if (!Array.isArray(terms) || terms.length !== 4) return false;
  const ordered = [...terms].sort((left, right) => Number(left?.sequenceNumber) - Number(right?.sequenceNumber));
  const ids = ordered.map(term => String(term?.id ?? '').trim());
  return ordered.every((term, index) => Number(term?.sequenceNumber) === index + 1)
    && ids.every(Boolean) && new Set(ids).size === 4;
}

function blockedGradeCells(block) {
  const pageIndex = SF10.sheets.indexOf(block.sheet);
  const cells = Array.from({ length: 10 }, (_, offset) => {
    const row = block.grades + offset;
    return [...SF10.periodColumns.map(column => `${column}${row}`), `AJ${row}`];
  }).flat();
  cells.push(`AJ${block.average}`);
  return cells.map(cellAddress => ({ pageIndex, cellAddress }));
}

function buildSf10Pages(school, learner, histories) {
  const pages = [[], []];
  const restrictedCells = [];
  const add = (sheet, cellAddress, value, type = 'text') => pages[sheet === 'Front' ? 0 : 1]
    .push({ cellAddress, value: value ?? '', type });
  add('Front', 'G7', learner.lastName);
  add('Front', 'W7', learner.firstName);
  add('Front', 'AN7', learner.nameExtension);
  add('Front', 'AX7', learner.middleName);
  add('Front', 'M8', learner.lrn);
  add('Front', 'AH8', learner.birthDate, 'date');
  add('Front', 'AV8', learner.sex);

  const issues = [{ severity: 'warning', fieldKey: 'draft', cellReference: null,
    message: 'SF10 is a draft. Verify all grades and complete eligibility, remedial, certification, and signature fields from official records.' }];
  if (!learner.lrn) issues.push({ severity: 'warning', fieldKey: 'lrn', cellReference: 'M8', message: 'The learner has no recorded LRN.' });
  if (!learner.birthDate) issues.push({ severity: 'warning', fieldKey: 'birthDate', cellReference: 'AH8', message: 'The learner has no recorded birthdate.' });
  if (histories.length > SF10.blocks.length) issues.push({ severity: 'warning', fieldKey: 'years', cellReference: null,
    message: 'More than five school years were found. Only the latest five fit this workbook; review the omitted earlier years.' });

  histories.slice(-SF10.blocks.length).forEach((history, index) => {
    const block = SF10.blocks[index];
    const { section, subjects, grades } = history;
    const terms = Array.isArray(history.terms) ? history.terms : [];
    const h = block.header;
    add(block.sheet, `E${h}`, school.schoolName);
    add(block.sheet, `U${h}`, school.depedSchoolId);
    add(block.sheet, `AD${h}`, school.district);
    add(block.sheet, `AP${h}`, school.division);
    add(block.sheet, `BB${h}`, school.region);
    add(block.sheet, `I${h + 1}`, Number(String(section.gradeCode).replace('grade-', '')), 'number');
    add(block.sheet, `N${h + 1}`, section.name);
    add(block.sheet, `V${h + 1}`, section.academicYear);
    add(block.sheet, `AI${h + 1}`, section.adviserName);
    const orderedTerms = [...terms].sort((left, right) => Number(left?.sequenceNumber) - Number(right?.sequenceNumber));
    if (!isCompleteQuarterlySchedule(terms)) {
      restrictedCells.push(...blockedGradeCells(block));
      const detail = terms.length === 2 ? 'a semestral schedule'
        : terms.length === 3 ? 'a three-term schedule'
          : `${terms.length} grading periods or an irregular schedule`;
      issues.push({ severity: 'warning', fieldKey: 'periodStructure', cellReference: `U${block.grades}`,
        message: `${section.academicYear}: ${detail} does not match SF10's four quarters. Quarter grades and final ratings were left blank.` });
      return;
    }
    const byCode = new Map();
    subjects.forEach(subject => {
      const code = String(subject.code || '').replace(/-jhs$/, '');
      const matches = byCode.get(code) || [];
      matches.push(subject);
      byCode.set(code, matches);
    });
    let missingGrades = false;
    SF10.subjects.forEach(([code, offset]) => {
      const matchedSubjects = byCode.get(code) || [];
      if (matchedSubjects.length !== 1) { missingGrades = true; return; }
      const subject = matchedSubjects[0];
      const row = block.grades + offset;
      if (code === 'values-education' && section.academicYear === '2026-2027') {
        missingGrades = true;
        return;
      }
      const matches = grades.filter(grade => Number(grade.subjectId) === Number(subject.id));
      const values = orderedTerms.map((term, termIndex) => {
        const found = matches.filter(grade => Number(grade.academicTermId) === Number(term.id));
        const value = found.length === 1 && found[0].finalGrade != null ? Number(found[0].finalGrade) : null;
        if (found.length > 1) issues.push({ severity: 'warning', fieldKey: 'grades', cellReference: `${SF10.periodColumns[termIndex]}${row}`,
          message: `${section.academicYear}: conflicting published grades for ${subject.name}, period ${term.sequenceNumber}.` });
        if (value === null || !Number.isFinite(value)) missingGrades = true;
        if (termIndex < 4 && value !== null && Number.isFinite(value)) add(block.sheet, `${SF10.periodColumns[termIndex]}${row}`, value, 'number');
        return value;
      });
      if (values.length === 4 && values.every(value => value !== null && Number.isFinite(value))) {
        add(block.sheet, `AJ${row}`, Math.round(values.reduce((sum, value) => sum + value, 0) / 4), 'number');
      }
    });
    if (missingGrades) issues.push({ severity: 'warning', fieldKey: 'grades', cellReference: null,
      message: `${section.academicYear}: some learning areas or published grades are unavailable. Review and complete blank cells from verified records.` });
  });
  return { pages, issues, restrictedCells };
}

module.exports = { SF10, buildSf10Pages, isCompleteQuarterlySchedule, isSf10EntryCell, nameOf };
