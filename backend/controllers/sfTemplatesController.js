const fs = require('fs');
const crypto = require('crypto');
const { getDatabase } = require('../config/database');
const { createCombinedExportWorkbook, createExportWorkbook, getEditableCells, getExportFilePath, saveExport } = require('../config/sfExports');
const { SF2, monthInYear, buildSf2Pages } = require('../config/sf2');
const { SF3, buildSf3Pages } = require('../config/sf3');
const { SF5, buildSf5Pages } = require('../config/sf5');

const SF1_TEMPLATE = {
  formCode: 'SF1',
  sheetName: 'School Form 1 (SF1)',
  learnerStartRow: 10,
  learnerEndRow: 58,
  headerFields: {
    schoolId: { cellAddress: 'F4', type: 'text' },
    region: { cellAddress: 'H4', type: 'text' },
    division: { cellAddress: 'N4', type: 'text' },
    district: { cellAddress: 'U4', type: 'text' },
    schoolName: { cellAddress: 'F6', type: 'text' },
    schoolYear: { cellAddress: 'P6', type: 'text' },
    gradeLevel: { cellAddress: 'U6', type: 'text' },
    section: { cellAddress: 'X6', type: 'text' }
  },
  learnerFields: {
    rowNumber: { column: 'A', type: 'number', editable: false },
    lrn: { column: 'B', type: 'text' },
    name: { column: 'C', type: 'text' },
    sex: { column: 'G', type: 'text' },
    birthDate: { column: 'H', type: 'date' },
    age: { column: 'I', type: 'number' },
    birthPlaceProvince: { column: 'J', type: 'text' },
    motherTongue: { column: 'L', type: 'text' },
    indigenousGroup: { column: 'M', type: 'text' },
    religion: { column: 'N', type: 'text' },
    houseStreet: { column: 'O', type: 'text' },
    barangay: { column: 'P', type: 'text' },
    cityMunicipality: { column: 'Q', type: 'text' },
    province: { column: 'R', type: 'text' },
    fatherName: { column: 'T', type: 'text' },
    motherMaidenName: { column: 'V', type: 'text' },
    guardianName: { column: 'X', type: 'text' },
    guardianRelationship: { column: 'Y', type: 'text' },
    contactNumber: { column: 'Z', type: 'text' },
    remarks: { column: 'AA', type: 'text' }
  }
};

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw createError(`Invalid ${label}.`);
  return id;
}

function parseTemplateIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
  if (values.length < 2 || values.length > 4) throw createError('Select two to four forms to create a combined workbook.');
  const ids = values.map(value => parseId(value, 'template ID'));
  if (new Set(ids).size !== ids.length) throw createError('A template can only be selected once.');
  return ids;
}

function formatTemplate(row) {
  return {
    id: row.id,
    formCode: row.formCode,
    formName: row.formName,
    version: row.version,
    sheetName: row.sheetName,
    requiresAcademicTerm: Boolean(row.requiresAcademicTerm),
    mappingStatus: row.mappingStatus
  };
}

function formatIssue(issue) {
  return {
    severity: issue.severity,
    fieldKey: issue.fieldKey || null,
    cellReference: issue.cellReference || null,
    message: issue.message,
    canBeCorrectedInDownload: Boolean(issue.canBeCorrectedInDownload)
  };
}

function firstFridayOfJune(academicYearLabel) {
  const startYear = Number.parseInt(String(academicYearLabel || '').slice(0, 4), 10);
  const year = Number.isSafeInteger(startYear) ? startYear : new Date().getUTCFullYear();
  const date = new Date(Date.UTC(year, 5, 1));
  date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7));
  return date;
}

function calculateAge(birthDate, referenceDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = referenceDate.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = referenceDate.getUTCMonth() > birth.getUTCMonth()
    || (referenceDate.getUTCMonth() === birth.getUTCMonth() && referenceDate.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
}

function fullName(person, useMaidenLastName = false) {
  if (!person) return '';
  const lastName = useMaidenLastName && person.maidenLastName ? person.maidenLastName : person.lastName;
  return [lastName, person.firstName, person.middleName].filter(Boolean).join(', ');
}

function requireTextIssue(issues, value, fieldKey, cellReference, label) {
  if (!String(value || '').trim()) {
    issues.push({ severity: 'warning', fieldKey, cellReference, message: `${label} is not configured.` });
  }
}

async function ensureFeatureEnabled(database, schoolId) {
  const [features] = await database.execute(
    'SELECT sf_templates_enabled AS sfTemplatesEnabled FROM school_portal_features WHERE school_id = ? LIMIT 1',
    [schoolId]
  );
  if (!features[0]?.sfTemplatesEnabled) throw createError('SF Templates are not enabled for this school.', 403);
}

async function getTemplate(database, templateId) {
  const [templates] = await database.execute(
    `SELECT id, form_code AS formCode, form_name AS formName, version,
      mapping_status AS mappingStatus, file_path AS filePath,
      default_sheet_name AS sheetName, requires_academic_term AS requiresAcademicTerm
    FROM school_form_templates
    WHERE id = ? AND form_code IN (?, ?, ?, ?) AND source_type = 'official'
      AND template_status = 'active' AND mapping_status = 'ready'
    LIMIT 1`,
    [templateId, 'SF1', 'SF2', 'SF3', 'SF5']
  );
  if (!templates[0]) throw createError('This SF template is unavailable.', 404);
  return templates[0];
}

async function getAdvisorySections(database, teacherId, schoolId, includeClosed = false) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.name, academic_years.label AS academicYear,
      school_grade_levels.display_name AS gradeLevel
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      AND academic_years.status ${includeClosed ? "IN ('active', 'closed')" : "= 'active'"}
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
    WHERE sections.school_id = ? AND sections.adviser_user_id = ?
      AND ${includeClosed ? "(sections.status = 'active' OR (sections.status = 'archived' AND academic_years.status = 'closed'))" : "sections.status = 'active'"}
    ORDER BY school_grade_levels.sort_order, sections.name`,
    [schoolId, teacherId]
  );
  return sections.map(section => ({
    id: section.id,
    name: section.name,
    gradeLevel: section.gradeLevel,
    academicYear: section.academicYear,
    displayName: `${section.gradeLevel} - ${section.name}`
  }));
}

async function getAdvisorySection(database, teacherId, schoolId, sectionId, includeClosed = false) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.name,
      sections.academic_year_id AS academicYearId, sections.school_level_id AS schoolLevelId,
      sections.grade_level_id AS gradeLevelId, sections.strand_id AS strandId,
      academic_years.label AS academicYear, academic_years.status AS academicYearStatus,
      school_grade_levels.display_name AS gradeLevel,
      school_grade_levels.grade_code AS gradeCode,
      DATE_FORMAT(academic_years.start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(academic_years.end_date, '%Y-%m-%d') AS endDate
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id
      AND academic_years.status ${includeClosed ? "IN ('active', 'closed')" : "= 'active'"}
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
    WHERE sections.id = ? AND sections.school_id = ? AND sections.adviser_user_id = ?
      AND ${includeClosed ? "(sections.status = 'active' OR (sections.status = 'archived' AND academic_years.status = 'closed'))" : "sections.status = 'active'"}
    LIMIT 1`,
    [sectionId, schoolId, teacherId]
  );
  if (!sections[0]) throw createError('You can generate a school form only for a section where you are the class adviser.', 403);
  return sections[0];
}

async function validateTerm(database, schoolId, section, academicTermId, required) {
  if (!academicTermId && !required) return null;
  if (!academicTermId) throw createError('An academic term is required for this form.');

  const [terms] = await database.execute(
    `SELECT academic_terms.id, academic_terms.name, academic_terms.status
    FROM academic_terms
    INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
    WHERE academic_terms.id = ? AND academic_years.school_id = ?
      AND academic_terms.academic_year_id = ? AND academic_terms.school_level_id = ?
    LIMIT 1`,
    [academicTermId, schoolId, section.academicYearId, section.schoolLevelId]
  );
  if (!terms[0]) throw createError('The selected academic term does not belong to this section.', 403);
  return terms[0];
}

async function getSectionLearners(database, schoolId, sectionId, asOfDate = null) {
  const [learners] = await database.execute(
    `SELECT users.id AS userId, users.first_name AS firstName, users.last_name AS lastName,
      student_profiles.user_id AS profileUserId,
      student_profiles.lrn, student_profiles.middle_name AS middleName,
      student_profiles.sex, DATE_FORMAT(student_profiles.birth_date, '%Y-%m-%d') AS birthDate,
      student_profiles.birth_place_province AS legacyBirthPlace,
      student_profiles.birth_place AS birthPlace,
      student_profiles.birth_place_region AS birthPlaceRegion,
      student_profiles.birth_country AS birthCountry,
      student_profiles.mother_tongue AS motherTongue,
      student_profiles.indigenous_group AS indigenousGroup, student_profiles.religion,
      student_profiles.house_street AS houseStreet, student_profiles.barangay,
      student_profiles.city_municipality AS cityMunicipality, student_profiles.province
    FROM section_students
    INNER JOIN users ON users.id = section_students.student_user_id
      AND users.school_id = section_students.school_id AND users.role = 'student'
    LEFT JOIN student_profiles ON student_profiles.user_id = users.id
    WHERE section_students.school_id = ? AND section_students.section_id = ?
      AND ${asOfDate
    ? 'section_students.enrolled_at < DATE_ADD(?, INTERVAL 1 DAY) AND (section_students.withdrawn_at IS NULL OR section_students.withdrawn_at >= DATE_ADD(?, INTERVAL 1 DAY))'
    : 'section_students.withdrawn_at IS NULL'}
      ${asOfDate ? '' : "AND users.account_status = 'active'"}
    ORDER BY users.last_name, users.first_name, users.id`,
    asOfDate ? [schoolId, sectionId, asOfDate, asOfDate] : [schoolId, sectionId]
  );

  if (!learners.length) return learners;
  const placeholders = learners.map(() => '?').join(', ');
  const [parents] = await database.execute(
    `SELECT student_parent_links.student_user_id AS studentUserId, student_parent_links.relationship,
      users.first_name AS firstName, users.last_name AS lastName,
      parent_profiles.middle_name AS middleName, parent_profiles.maiden_last_name AS maidenLastName,
      parent_profiles.contact_number AS contactNumber
    FROM student_parent_links
    INNER JOIN users ON users.id = student_parent_links.parent_user_id
      AND users.school_id = student_parent_links.school_id AND users.role = 'parent'
    LEFT JOIN parent_profiles ON parent_profiles.user_id = users.id
    WHERE student_parent_links.school_id = ?
      AND student_parent_links.student_user_id IN (${placeholders}) AND users.account_status = 'active'`,
    [schoolId, ...learners.map(learner => learner.userId)]
  );

  const parentsByStudent = new Map();
  parents.forEach(parent => {
    const list = parentsByStudent.get(parent.studentUserId) || [];
    list.push(parent);
    parentsByStudent.set(parent.studentUserId, list);
  });
  return learners.map(learner => ({ ...learner, parents: parentsByStudent.get(learner.userId) || [] }));
}

async function getSf2Learners(database, schoolId, sectionId, month) {
  const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date());
  if (month > currentMonth) return { learners: [], historical: false, future: true };
  const isCurrent = month === currentMonth;
  const monthStart = `${month}-01`;
  const [learners] = await database.execute(
    `SELECT DISTINCT users.id AS userId, users.first_name AS firstName, users.last_name AS lastName,
      student_profiles.middle_name AS middleName, student_profiles.sex
    FROM section_students
    INNER JOIN users ON users.id = section_students.student_user_id
      AND users.school_id = section_students.school_id AND users.role = 'student'
    LEFT JOIN student_profiles ON student_profiles.user_id = users.id
    WHERE section_students.school_id = ? AND section_students.section_id = ?
      AND ${isCurrent ? 'section_students.withdrawn_at IS NULL AND users.account_status = \'active\''
    : 'section_students.enrolled_at < DATE_ADD(LAST_DAY(?), INTERVAL 1 DAY) AND (section_students.withdrawn_at IS NULL OR section_students.withdrawn_at >= ?)'}
    ORDER BY users.last_name, users.first_name, users.id`,
    isCurrent ? [schoolId, sectionId] : [schoolId, sectionId, monthStart, monthStart]
  );
  return { learners, historical: !isCurrent };
}

async function getSf5GradeData(database, schoolId, section, learners) {
  const [subjects] = await database.execute(
    `SELECT DISTINCT subjects.id, subjects.name FROM section_teachers
    INNER JOIN subjects ON subjects.id = section_teachers.subject_id AND subjects.school_id = section_teachers.school_id
    WHERE section_teachers.school_id = ? AND section_teachers.section_id = ?
    ORDER BY subjects.name, subjects.id`, [schoolId, section.id]
  );
  const [terms] = await database.execute(
    `SELECT id, name FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ?
    ORDER BY sequence_number`, [schoolId, section.academicYearId, section.schoolLevelId]
  );
  if (!learners.length || !subjects.length || !terms.length) return { subjects, terms, grades: [] };
  const ids = learners.map(learner => learner.userId);
  const [grades] = await database.execute(
    `SELECT published_final_grades.student_user_id AS studentId,
      published_final_grades.subject_id AS subjectId, published_final_grades.academic_term_id AS academicTermId,
      published_final_grades.final_grade AS finalGrade, source_section.name AS sectionName
    FROM published_final_grades
    INNER JOIN sections AS source_section ON source_section.id = published_final_grades.section_id
      AND source_section.school_id = published_final_grades.school_id
      AND source_section.academic_year_id = ? AND source_section.grade_level_id = ?
      AND source_section.strand_id <=> ?
    WHERE published_final_grades.school_id = ?
      AND published_final_grades.student_user_id IN (${ids.map(() => '?').join(', ')})
      AND published_final_grades.subject_id IN (${subjects.map(() => '?').join(', ')})
      AND published_final_grades.academic_term_id IN (${terms.map(() => '?').join(', ')})
      AND EXISTS (SELECT 1 FROM section_students AS enrollment
        WHERE enrollment.school_id = published_final_grades.school_id
          AND enrollment.section_id = published_final_grades.section_id
          AND enrollment.student_user_id = published_final_grades.student_user_id
          AND (enrollment.withdrawn_at IS NULL OR published_final_grades.published_at <= enrollment.withdrawn_at))`,
    [section.academicYearId, section.gradeLevelId, section.strandId, schoolId,
      ...ids, ...subjects.map(subject => subject.id), ...terms.map(term => term.id)]
  );
  return { subjects, terms, grades };
}

function buildGenerationData(school, section, learners) {
  const issues = [];
  const referenceDate = firstFridayOfJune(section.academicYear);
  const lrnSet = new Set();
  const header = {
    schoolId: school.depedSchoolId,
    region: school.region,
    division: school.division,
    district: school.district,
    schoolName: school.schoolName,
    schoolYear: section.academicYear,
    gradeLevel: section.gradeLevel,
    section: section.name
  };

  requireTextIssue(issues, header.schoolId, 'schoolId', 'F4', 'The school ID');
  requireTextIssue(issues, header.region, 'region', 'H4', 'The region');
  requireTextIssue(issues, header.division, 'division', 'N4', 'The division');
  requireTextIssue(issues, header.district, 'district', 'U4', 'The district');
  if (learners.length > SF1_TEMPLATE.learnerEndRow - SF1_TEMPLATE.learnerStartRow + 1) {
    issues.push({ severity: 'error', fieldKey: 'learners', cellReference: null, message: 'SF1 supports up to 49 learners per export.' });
  }

  const records = learners.map((learner, index) => {
    const row = SF1_TEMPLATE.learnerStartRow + index;
    const parents = learner.parents || [];
    const uniqueParent = relationship => {
      const matches = parents.filter(parent => parent.relationship === relationship);
      if (matches.length > 1) {
        const column = { father: 'T', mother: 'V', guardian: 'X' }[relationship];
        issues.push({ severity: 'warning', fieldKey: relationship, cellReference: `${column}${row}`,
          message: `${learner.lastName}, ${learner.firstName} has multiple ${relationship} links; review the parent details manually.` });
      }
      return matches.length === 1 ? matches[0] : null;
    };
    const father = uniqueParent('father');
    const mother = uniqueParent('mother');
    const guardian = uniqueParent('guardian');
    const contact = [guardian, mother, father].map(parent => parent?.contactNumber).find(Boolean) || null;
    const lrn = String(learner.lrn || '').trim();

    if (!learner.profileUserId) {
      issues.push({ severity: 'error', fieldKey: 'studentProfile', cellReference: `B${row}`,
        message: `${learner.lastName}, ${learner.firstName} has no student profile; complete it before exporting SF1.` });
    }

    if (!/^\d{12}$/.test(lrn)) {
      issues.push({ severity: 'error', fieldKey: 'lrn', cellReference: `B${row}`, message: `${learner.lastName}, ${learner.firstName} has an invalid or missing 12-digit LRN.` });
    } else if (lrnSet.has(lrn)) {
      issues.push({ severity: 'error', fieldKey: 'lrn', cellReference: `B${row}`, message: `${learner.lastName}, ${learner.firstName} has a duplicate LRN in this section.` });
    }
    lrnSet.add(lrn);

    [
      ['sex', learner.sex, 'G', 'sex'],
      ['birthDate', learner.birthDate, 'H', 'birth date'],
      ['birthPlaceProvince', learner.birthPlace || learner.legacyBirthPlace, 'J', 'place of birth'],
      ['motherTongue', learner.motherTongue, 'L', 'mother tongue'],
      ['religion', learner.religion, 'N', 'religion']
    ].forEach(([fieldKey, value, column, label]) => {
      if (!String(value || '').trim()) {
        issues.push({ severity: 'warning', fieldKey, cellReference: `${column}${row}`, message: `${learner.lastName}, ${learner.firstName} has no ${label}.` });
      }
    });
    if (!learner.birthCountry) {
      issues.push({ severity: 'warning', fieldKey: 'birthCountry', cellReference: `J${row}`, message: `${learner.lastName}, ${learner.firstName} has not confirmed their country of birth.` });
    }
    if (!contact) {
      issues.push({ severity: 'warning', fieldKey: 'contactNumber', cellReference: `Z${row}`, message: `${learner.lastName}, ${learner.firstName} has no parent or guardian contact number.` });
    }

    return {
      rowNumber: index + 1,
      lrn,
      name: [learner.lastName, learner.firstName, learner.middleName].filter(Boolean).join(', '),
      sex: learner.sex ? String(learner.sex).charAt(0).toUpperCase() : '',
      birthDate: learner.birthDate,
      age: calculateAge(learner.birthDate, referenceDate),
      birthPlaceProvince: [learner.birthPlace || learner.legacyBirthPlace, learner.birthPlaceRegion, learner.birthCountry].filter(Boolean).join(', '),
      motherTongue: learner.motherTongue,
      indigenousGroup: learner.indigenousGroup,
      religion: learner.religion,
      houseStreet: learner.houseStreet,
      barangay: learner.barangay,
      cityMunicipality: learner.cityMunicipality,
      province: learner.province,
      fatherName: fullName(father),
      motherMaidenName: fullName(mother, true),
      guardianName: fullName(guardian),
      guardianRelationship: guardian?.relationship || '',
      contactNumber: contact,
      remarks: ''
    };
  });
  return { header, learners: records, issues };
}

function buildMappedCells(data) {
  const cells = [];
  Object.entries(SF1_TEMPLATE.headerFields).forEach(([fieldKey, definition]) => {
    cells.push({ cellAddress: definition.cellAddress, value: data.header[fieldKey], type: definition.type });
  });
  for (let row = SF1_TEMPLATE.learnerStartRow; row <= SF1_TEMPLATE.learnerEndRow; row += 1) {
    const learner = data.learners[row - SF1_TEMPLATE.learnerStartRow] || {};
    Object.entries(SF1_TEMPLATE.learnerFields).forEach(([fieldKey, definition]) => {
      cells.push({ cellAddress: `${definition.column}${row}`, value: learner[fieldKey] ?? null, type: definition.type });
    });
  }
  return cells;
}

function normalizeEdits(value, editableCells, pageCount) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5000) throw createError('Edits must contain no more than 5,000 cells.');
  const allowed = new Map(editableCells.map(cell => [String(cell.cellAddress).toUpperCase(), cell.type]));
  const edits = new Map();
  value.forEach(edit => {
    const cellAddress = String(edit?.cellAddress || '').toUpperCase();
    if (!allowed.has(cellAddress)) throw createError('One or more edited cells are not allowed for this school form.');
    const pageIndex = edit?.pageIndex === undefined || edit.pageIndex === null || edit.pageIndex === '' ? 0 : Number(edit.pageIndex);
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
      throw createError('One or more edited cells refer to an unavailable form page.');
    }
    if (edit?.value !== null && edit?.value !== undefined
      && !['string', 'number'].includes(typeof edit.value)) {
      throw createError(`Enter a valid value for ${cellAddress}.`);
    }
    if (typeof edit?.value === 'number' && !Number.isFinite(edit.value)) {
      throw createError(`Enter a valid value for ${cellAddress}.`);
    }
    const cellValue = edit?.value === null || edit?.value === undefined ? '' : String(edit.value);
    if (cellValue.length > 500) throw createError('An edited cell value is too long.');
    const type = allowed.get(cellAddress);
    const blank = cellValue.trim() === '';
    let normalizedValue = type === 'text' ? cellValue : (blank ? '' : cellValue.trim());
    if (['date', 'dateText'].includes(type) && !blank) {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cellValue.trim());
      if (match) normalizedValue = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
      const date = new Date(`${normalizedValue}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
        || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalizedValue) {
        throw createError(`Enter a valid date for ${cellAddress}.`);
      }
    }
    if (type === 'number' && !blank && !Number.isFinite(Number(cellValue.trim()))) {
      throw createError(`Enter a valid number for ${cellAddress}.`);
    }
    if (type === 'number' && !blank) normalizedValue = cellValue.trim();
    const key = `${pageIndex}:${cellAddress}`;
    if (edits.has(key)) throw createError('A cell can only be edited once per form page.');
    edits.set(key, { pageIndex, cellAddress, value: normalizedValue, type });
  });
  return [...edits.values()];
}

function applyEditsToPages(pages, edits) {
  const nextPages = pages.map(page => page.map(cell => ({ ...cell })));
  edits.forEach(edit => {
    const cells = nextPages[edit.pageIndex];
    const existing = cells.find(cell => String(cell.cellAddress).toUpperCase() === edit.cellAddress);
    if (existing) {
      existing.value = edit.value;
      existing.type = edit.type;
    } else {
      cells.push({ cellAddress: edit.cellAddress, value: edit.value, type: edit.type });
    }
  });
  return nextPages;
}

function finalExportIssues(form, pages) {
  const editableAddresses = new Set(form.editableCells.map(cell => cell.cellAddress));
  const firstPage = new Map(pages[0].map(cell => [String(cell.cellAddress).toUpperCase(), cell.value]));
  const valueAt = address => String(firstPage.get(address) ?? '').trim();
  const resolvedLrnRows = new Set();
  const issues = [];

  if (form.template.formCode === 'SF1') {
    const seenLrns = new Set();
    for (let row = SF1_TEMPLATE.learnerStartRow; row <= SF1_TEMPLATE.learnerEndRow; row += 1) {
      const hasLearnerData = Object.keys(SF1_TEMPLATE.learnerFields).some(fieldKey => {
        const field = SF1_TEMPLATE.learnerFields[fieldKey];
        return field.column !== 'A' && valueAt(`${field.column}${row}`) !== '';
      });
      if (!hasLearnerData) continue;
      const address = `B${row}`;
      const lrn = valueAt(address);
      const valid = /^\d{12}$/.test(lrn) && !seenLrns.has(lrn);
      if (valid) {
        seenLrns.add(lrn);
        resolvedLrnRows.add(row);
      } else {
        issues.push({ severity: 'error', fieldKey: 'lrn', cellReference: address,
          message: lrn ? `Learner LRN in ${address} must be a unique 12-digit number.` : `Learner LRN in ${address} is required.` });
      }
    }
  }

  form.issues.forEach(issue => {
    if (form.template.formCode === 'SF1' && issue.fieldKey === 'lrn') {
      const row = Number(/\d+$/.exec(String(issue.cellReference || ''))?.[0]);
      if (resolvedLrnRows.has(row)) issues.push({ ...issue, severity: 'warning',
        message: `${issue.message} This workbook contains a manual correction; the saved student record is unchanged.` });
      return;
    }
    if (issue.severity === 'error' && issue.canBeCorrectedInDownload && editableAddresses.has(issue.cellReference)
      && valueAt(issue.cellReference)) {
      issues.push({ ...issue, severity: 'warning',
        message: `${issue.message} This workbook contains a manual correction; the saved school record is unchanged.` });
      return;
    }
    issues.push(issue);
  });
  return issues;
}

async function saveIssues(database, exportId, issues) {
  if (!issues.length) return;
  await database.query(
    `INSERT INTO school_form_export_issues
      (school_form_export_id, severity, field_key, cell_reference, issue_message)
    VALUES ${issues.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
    issues.flatMap(issue => [exportId, issue.severity, issue.fieldKey || null, issue.cellReference || null, issue.message])
  );
}

async function createExportRecord(database, template, schoolId, sectionId, academicTermId, userId, status, issues) {
  const [result] = await database.execute(
    `INSERT INTO school_form_exports
      (school_form_template_id, school_id, section_id, academic_term_id, requested_by_user_id, export_status, file_path)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [template.id, schoolId, sectionId, academicTermId || null, userId, status]
  );
  await saveIssues(database, result.insertId, issues);
  return result.insertId;
}

async function listTemplates(req, res, next) {
  try {
    const database = getDatabase();
    await ensureFeatureEnabled(database, req.user.schoolId);
    const [templates] = await database.execute(
      `SELECT id, form_code AS formCode, form_name AS formName, version,
        default_sheet_name AS sheetName, requires_academic_term AS requiresAcademicTerm,
        mapping_status AS mappingStatus
      FROM school_form_templates
      WHERE form_code IN (?, ?, ?, ?) AND source_type = 'official' AND template_status = 'active' AND mapping_status = 'ready'
      ORDER BY form_code, version DESC`,
      ['SF1', 'SF2', 'SF3', 'SF5']
    );
    res.json({ templates: templates.map(formatTemplate) });
  } catch (error) {
    next(error);
  }
}

async function getTemplateDetails(req, res, next) {
  try {
    const database = getDatabase();
    await ensureFeatureEnabled(database, req.user.schoolId);
    const template = await getTemplate(database, parseId(req.params.templateId, 'template ID'));
    const mappings = template.formCode === 'SF5'
      ? [...Object.entries(SF5.headers).map(([fieldKey, cellReference]) => ({ fieldKey, worksheetName: SF5.sheetName, cellReference })),
        ...[['maleLrn', 'A13'], ['maleName', 'B13'], ['maleGeneralAverage', 'F13'],
          ['femaleLrn', 'A34'], ['femaleName', 'B34'], ['femaleGeneralAverage', 'F34'],
          ['pageNumber', 'M61']].map(([fieldKey, cellReference]) => ({ fieldKey, worksheetName: SF5.sheetName, cellReference }))]
      : template.formCode === 'SF3'
      ? [...Object.entries(SF3.headers).map(([fieldKey, cellReference]) => ({ fieldKey, worksheetName: SF3.sheetName, cellReference })),
        { fieldKey: 'maleNumber', worksheetName: SF3.sheetName, cellReference: `A${SF3.maleStart}` },
        { fieldKey: 'maleName', worksheetName: SF3.sheetName, cellReference: `B${SF3.maleStart}` },
        { fieldKey: 'femaleNumber', worksheetName: SF3.sheetName, cellReference: `A${SF3.femaleStart}` },
        { fieldKey: 'femaleName', worksheetName: SF3.sheetName, cellReference: `B${SF3.femaleStart}` },
        { fieldKey: 'pageNumber', worksheetName: SF3.sheetName, cellReference: 'T68' }]
      : template.formCode === 'SF2'
      ? [...Object.entries(SF2.headers).map(([fieldKey, cellReference]) => ({ fieldKey, worksheetName: SF2.sheetName, cellReference })),
        { fieldKey: 'maleName', worksheetName: SF2.sheetName, cellReference: 'B13' },
        { fieldKey: 'femaleName', worksheetName: SF2.sheetName, cellReference: 'B35' },
        { fieldKey: 'pageNumber', worksheetName: SF2.sheetName, cellReference: 'A91' }]
      : [
      ...Object.entries(SF1_TEMPLATE.headerFields).map(([fieldKey, field]) => ({
        fieldKey, worksheetName: SF1_TEMPLATE.sheetName, cellReference: field.cellAddress
      })),
      ...Object.entries(SF1_TEMPLATE.learnerFields).map(([fieldKey, field]) => ({
        fieldKey, worksheetName: SF1_TEMPLATE.sheetName, cellReference: `${field.column}${SF1_TEMPLATE.learnerStartRow}`
      }))
    ];
    const sections = await getAdvisorySections(database, req.user.id, req.user.schoolId, template.formCode === 'SF5');
    res.json({ template: formatTemplate(template), mappings, sections, maxLearners: template.formCode === 'SF1' ? 49 : null });
  } catch (error) {
    next(error);
  }
}

async function preparePreview(req, database) {
  await ensureFeatureEnabled(database, req.user.schoolId);
  const template = await getTemplate(database, parseId(req.params.templateId, 'template ID'));
  const sectionId = parseId(req.method === 'GET' ? req.query.sectionId : req.body.sectionId, 'section ID');
  const termValue = req.method === 'GET' ? req.query.academicTermId : req.body.academicTermId;
  const requestedTermId = termValue === undefined || termValue === null || termValue === ''
    ? null : parseId(termValue, 'academic term ID');
  const section = await getAdvisorySection(database, req.user.id, req.user.schoolId, sectionId, template.formCode === 'SF5');
  if (template.formCode === 'SF5' && !/^grade-(?:[1-9]|10)$/.test(section.gradeCode)) {
    throw createError('SF5 is available only for Grades 1–10.', 403);
  }
  const term = await validateTerm(database, req.user.schoolId, section, requestedTermId, Boolean(template.requiresAcademicTerm));
  const [schools] = await database.execute(
    `SELECT name AS schoolName, deped_school_id AS depedSchoolId, region_name AS region,
      division_name AS division, district_name AS district
    FROM schools WHERE id = ? LIMIT 1`,
    [req.user.schoolId]
  );
  if (!schools[0]) throw createError('Your school could not be found.', 404);
  const month = req.method === 'GET' ? req.query.month : req.body.month;
  let data;
  let pages;
  if (template.formCode === 'SF5') {
    const learners = await getSectionLearners(database, req.user.schoolId, section.id,
      section.academicYearStatus === 'closed' ? section.endDate : null);
    const gradeData = await getSf5GradeData(database, req.user.schoolId, section, learners);
    data = buildSf5Pages(schools[0], section, learners, gradeData.subjects, gradeData.terms, gradeData.grades);
    pages = data.pages;
  } else if (template.formCode === 'SF2') {
    if (!monthInYear(month, section)) throw createError('Select a valid month within this section\'s academic year.');
    const roster = await getSf2Learners(database, req.user.schoolId, section.id, month);
    data = buildSf2Pages(schools[0], section, month, roster.learners);
    if (roster.historical) data.issues.push({ severity: 'warning', fieldKey: 'historicalRoster', cellReference: null,
      message: 'Past-month names use section assignment dates, which may be incomplete. Verify the roster against school records. Section assignment is not proof of enrollment.' });
    if (roster.future) data.issues.push({ severity: 'warning', fieldKey: 'futureRoster', cellReference: null,
      message: 'Future-month roster is left blank because assignments may change. Complete it from verified records when the month begins.' });
    if (!roster.learners.length && !roster.future) data.issues.push({ severity: 'warning', fieldKey: 'roster', cellReference: null,
      message: 'No section assignments were found for this month. Verify the roster before using the draft.' });
    pages = data.pages;
  } else if (template.formCode === 'SF3') {
    const learners = await getSectionLearners(database, req.user.schoolId, section.id);
    data = buildSf3Pages(schools[0], section, learners);
    pages = data.pages;
  } else {
    const learners = await getSectionLearners(database, req.user.schoolId, section.id);
    data = buildGenerationData(schools[0], section, learners);
    pages = [buildMappedCells(data)];
  }
  const mappedCells = pages[0];
  const editableCells = await getEditableCells(template, mappedCells);
  const editableAddresses = new Set(editableCells.map(cell => cell.cellAddress));
  const issues = data.issues.map(issue => {
    const canBeCorrectedInDownload = issue.severity === 'error'
      && !['studentProfile', 'learners'].includes(issue.fieldKey)
      && editableAddresses.has(issue.cellReference);
    return {
      ...issue,
      canBeCorrectedInDownload,
      message: canBeCorrectedInDownload
        ? `${issue.message} This entry can be corrected in the generated workbook only; the saved record remains unchanged.`
        : issue.message
    };
  });
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    templateId: template.id, version: template.version, schoolId: req.user.schoolId,
    sectionId: section.id, termId: term?.id || null, month: template.formCode === 'SF2' ? month : null,
    pages, issues, editableCells, breakdown: data.breakdown || null
  })).digest('hex');
  return { template, section, term, month, pages, mappedCells, editableCells, issues,
    breakdown: data.breakdown || [], fingerprint };
}

async function prepareCombinedPreview(req, database) {
  await ensureFeatureEnabled(database, req.user.schoolId);
  const templateIds = parseTemplateIds(req.body?.templateIds);
  const templates = await Promise.all(templateIds.map(templateId => getTemplate(database, templateId)));
  const formCodes = templates.map(template => template.formCode);
  if (new Set(formCodes).size !== formCodes.length || formCodes.some(code => !['SF1', 'SF2', 'SF3', 'SF5'].includes(code))) {
    throw createError('Select each available SF form only once.');
  }

  const previews = await Promise.all(templates.map(template => preparePreview({
    ...req,
    method: 'POST',
    params: { ...req.params, templateId: String(template.id) }
  }, database)));
  const order = { SF1: 1, SF2: 2, SF3: 3, SF5: 4 };
  previews.sort((left, right) => order[left.template.formCode] - order[right.template.formCode]);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(previews.map(preview => ({
    templateId: preview.template.id,
    formCode: preview.template.formCode,
    fingerprint: preview.fingerprint
  })))).digest('hex');
  return { forms: previews, fingerprint };
}

async function previewTemplate(req, res, next) {
  try {
    const preview = await preparePreview(req, getDatabase());
    res.json({
      mappedCells: preview.mappedCells,
      pages: preview.pages,
      editableCells: preview.editableCells,
      breakdown: preview.breakdown,
      issues: preview.issues.map(formatIssue),
      previewFingerprint: preview.fingerprint
    });
  } catch (error) {
    next(error);
  }
}

async function previewCombinedTemplates(req, res, next) {
  try {
    const preview = await prepareCombinedPreview(req, getDatabase());
    res.json({
      previewFingerprint: preview.fingerprint,
      forms: preview.forms.map(form => ({
        templateId: form.template.id,
        formCode: form.template.formCode,
        mappedCells: form.mappedCells,
        pages: form.pages,
        editableCells: form.editableCells,
        breakdown: form.breakdown,
        issues: form.issues.map(formatIssue)
      }))
    });
  } catch (error) {
    next(error);
  }
}

function safeFilePart(value) {
  return String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, '-')
    .replace(/-+/g, '-').replace(/[. ]+$/g, '').slice(0, 60) || 'section';
}

async function generateCombinedTemplates(req, res, next) {
  try {
    const database = getDatabase();
    const preview = await prepareCombinedPreview(req, database);
    if (!/^[a-f0-9]{64}$/.test(String(req.body.previewFingerprint || ''))
      || req.body.previewFingerprint !== preview.fingerprint) {
      throw createError('The school form data changed since the preview. Generate a new preview before downloading.', 409);
    }

    const requestedForms = req.body.forms;
    if (!Array.isArray(requestedForms) || requestedForms.length !== preview.forms.length) {
      throw createError('The combined workbook edits are invalid.');
    }
    const editsByTemplate = new Map();
    requestedForms.forEach(form => {
      const templateId = parseId(form?.templateId, 'template ID');
      if (editsByTemplate.has(templateId)) throw createError('A template can only be submitted once.');
      editsByTemplate.set(templateId, form?.edits);
    });
    if (preview.forms.some(form => !editsByTemplate.has(form.template.id))) {
      throw createError('The combined workbook edits do not match the selected templates.');
    }

    const preparedForms = preview.forms.map(form => {
      const requestedEdits = editsByTemplate.get(form.template.id);
      const edits = normalizeEdits(requestedEdits, form.editableCells, form.pages.length);
      const pages = applyEditsToPages(form.pages, edits);
      return { ...form, edits, pages, exportIssues: finalExportIssues(form, pages) };
    });
    const issues = preparedForms.flatMap(form => form.exportIssues.map(issue => ({ formCode: form.template.formCode, ...formatIssue(issue) })));
    if (issues.some(issue => issue.severity === 'error')) {
      return res.status(422).json({ message: 'Fix the listed data issues or correct them in the workbook before downloading.', issues });
    }

    const workbookForms = preparedForms.map(form => ({ formCode: form.template.formCode, pages: form.pages }));
    const manualEditCount = preparedForms.reduce((count, form) => count + form.edits.length, 0);
    const workbook = await createCombinedExportWorkbook(workbookForms);
    const section = preview.forms[0].section;
    const month = preview.forms.find(form => form.template.formCode === 'SF2')?.month;
    const formCodes = preview.forms.map(form => form.template.formCode);
    const formCodeList = formCodes.join('_');
    const draft = formCodes.includes('SF5') ? '-draft' : '';
    const fileName = `${formCodeList}_${safeFilePart(section.gradeLevel)}-${safeFilePart(section.name)}_${safeFilePart(month || section.academicYear)}${draft}.xlsx`;

    await database.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'school_forms_combined_exported', 'school_form_export', NULL,
        JSON_OBJECT('form_codes', ?, 'section_id', ?, 'reporting_month', ?, 'file_name', ?, 'manual_edit_count', ?))`,
      [req.user.schoolId, req.user.id, formCodes.join(','), section.id, month || null, fileName, manualEditCount]
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(workbook);
  } catch (error) {
    next(error);
  }
}

async function generateTemplate(req, res, next) {
  let savedFilePath = null;
  let exportId = null;
  let connection;
  let transactionStarted = false;
  try {
    const database = getDatabase();
    const { template, section, term, pages, mappedCells, editableCells, issues, fingerprint } = await preparePreview(req, database);
    if (!/^[a-f0-9]{64}$/.test(String(req.body.previewFingerprint || '')) || req.body.previewFingerprint !== fingerprint) {
      throw createError('The school form data changed since the preview. Generate a new preview before downloading.', 409);
    }
    const edits = normalizeEdits(req.body.edits, editableCells, pages.length);
    const exportPages = applyEditsToPages(pages, edits);
    const exportIssues = finalExportIssues({ template, editableCells, issues }, exportPages);
    const blockingIssues = exportIssues.filter(issue => issue.severity === 'error');
    if (blockingIssues.length) {
      return res.status(422).json({
        message: 'Fix the listed data issues or correct them in the workbook before downloading.',
        issues: exportIssues.map(formatIssue)
      });
    }
    exportId = await createExportRecord(
      database,
      template,
      req.user.schoolId,
      section.id,
      term?.id || null,
      req.user.id,
      'generating',
      exportIssues
    );

    const workbook = await createExportWorkbook(template, exportPages);
    const saved = await saveExport(workbook, template.formCode);
    savedFilePath = saved.filePath;
    connection = await database.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute(
      `UPDATE school_form_exports SET export_status = 'generated', file_path = ?, generated_at = NOW()
      WHERE id = ? AND school_id = ? AND requested_by_user_id = ?`,
      [saved.publicPath, exportId, req.user.schoolId, req.user.id]
    );
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, ?, 'school_form_generated', 'school_form_export', ?, JSON_OBJECT('form_code', ?, 'section_id', ?, 'reporting_month', ?, 'summary', ?, 'manual_edit_count', ?))`,
      [req.user.schoolId, req.user.id, exportId, template.formCode, section.id,
        template.formCode === 'SF2' ? req.body.month : null, `${template.formCode} · ${section.name}`, edits.length]
    );
    await connection.commit();
    transactionStarted = false;
    connection.release();
    connection = null;

    res.status(201).json({
      message: `${template.formCode} export generated successfully.`,
      export: {
        id: exportId,
        status: 'generated',
        fileName: saved.fileName,
        downloadUrl: `/api/sf-exports/${exportId}/download`
      },
      issues: exportIssues.map(formatIssue),
      mappedCells
    });
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    connection?.release();
    if (savedFilePath) await fs.promises.unlink(savedFilePath).catch(() => {});
    if (exportId) {
      await getDatabase().execute(
        `UPDATE school_form_exports SET export_status = 'failed', file_path = NULL
        WHERE id = ? AND school_id = ? AND requested_by_user_id = ?`,
        [exportId, req.user.schoolId, req.user.id]
      ).catch(() => {});
    }
    next(error);
  }
}

async function downloadExport(req, res, next) {
  try {
    const database = getDatabase();
    await ensureFeatureEnabled(database, req.user.schoolId);
    const exportId = parseId(req.params.exportId, 'export ID');
    const [exports] = await database.execute(
      `SELECT school_form_exports.id, school_form_exports.file_path AS filePath,
        school_form_templates.form_code AS formCode
      FROM school_form_exports
      INNER JOIN school_form_templates ON school_form_templates.id = school_form_exports.school_form_template_id
      WHERE school_form_exports.id = ? AND school_form_exports.school_id = ?
        AND school_form_exports.requested_by_user_id = ? AND school_form_exports.export_status = 'generated'
      LIMIT 1`,
      [exportId, req.user.schoolId, req.user.id]
    );
    if (!exports[0]) throw createError('This SF export is unavailable.', 404);
    const filePath = getExportFilePath(exports[0].filePath);
    if (!fs.existsSync(filePath)) throw createError('This SF export file is unavailable.', 404);
    const draft = exports[0].formCode === 'SF5' ? '-draft' : '';
    res.download(filePath, `${exports[0].formCode.toLowerCase()}${draft}-export-${exportId}.xlsx`, { dotfiles: 'allow' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  downloadExport,
  generateCombinedTemplates,
  generateTemplate,
  getTemplateDetails,
  listTemplates,
  previewCombinedTemplates,
  previewTemplate
};
