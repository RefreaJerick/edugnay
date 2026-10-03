const fs = require('fs');
const crypto = require('crypto');
const { getDatabase } = require('../config/database');
const { createExportWorkbook, getExportFilePath, saveExport } = require('../config/sfExports');

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
    message: issue.message
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
    WHERE id = ? AND form_code = ? AND source_type = 'official'
      AND template_status = 'active' AND mapping_status = 'ready'
    LIMIT 1`,
    [templateId, SF1_TEMPLATE.formCode]
  );
  if (!templates[0]) throw createError('This SF template is unavailable.', 404);
  return templates[0];
}

async function getAdvisorySections(database, teacherId, schoolId) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.name, academic_years.label AS academicYear,
      school_grade_levels.display_name AS gradeLevel
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.status = 'active'
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
    WHERE sections.school_id = ? AND sections.adviser_user_id = ? AND sections.status = 'active'
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

async function getAdvisorySection(database, teacherId, schoolId, sectionId) {
  const [sections] = await database.execute(
    `SELECT sections.id, sections.school_id AS schoolId, sections.name,
      sections.academic_year_id AS academicYearId, sections.school_level_id AS schoolLevelId,
      academic_years.label AS academicYear, school_grade_levels.display_name AS gradeLevel
    FROM sections
    INNER JOIN academic_years ON academic_years.id = sections.academic_year_id AND academic_years.status = 'active'
    INNER JOIN school_grade_levels ON school_grade_levels.id = sections.grade_level_id
    WHERE sections.id = ? AND sections.school_id = ? AND sections.adviser_user_id = ?
      AND sections.status = 'active'
    LIMIT 1`,
    [sectionId, schoolId, teacherId]
  );
  if (!sections[0]) throw createError('You can generate SF1 only for a section where you are the class adviser.', 403);
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

async function getSectionLearners(database, schoolId, sectionId) {
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
    WHERE section_students.school_id = ? AND section_students.section_id = ? AND section_students.withdrawn_at IS NULL
      AND users.account_status = 'active'
    ORDER BY users.last_name, users.first_name, users.id`,
    [schoolId, sectionId]
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

function editableCellTypes() {
  const cells = new Map();
  Object.values(SF1_TEMPLATE.headerFields).forEach(field => cells.set(field.cellAddress, field.type));
  for (let row = SF1_TEMPLATE.learnerStartRow; row <= SF1_TEMPLATE.learnerEndRow; row += 1) {
    Object.values(SF1_TEMPLATE.learnerFields).forEach(field => {
      if (field.editable !== false) cells.set(`${field.column}${row}`, field.type);
    });
  }
  return cells;
}

function normalizeEdits(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) throw createError('Edits must contain no more than 1,000 cells.');
  const allowed = editableCellTypes();
  const edits = new Map();
  value.forEach(edit => {
    const cellAddress = String(edit?.cellAddress || '').toUpperCase();
    if (!allowed.has(cellAddress)) throw createError('One or more edited cells are not allowed for this SF1 template.');
    const cellValue = edit?.value === null || edit?.value === undefined ? '' : String(edit.value);
    if (cellValue.length > 500) throw createError('An edited cell value is too long.');
    const type = allowed.get(cellAddress);
    let normalizedValue = cellValue;
    if (type === 'date' && cellValue) {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cellValue.trim());
      if (match) normalizedValue = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
      const date = new Date(`${normalizedValue}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
        || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalizedValue) {
        throw createError(`Enter a valid date for ${cellAddress}.`);
      }
    }
    if (type === 'number' && cellValue && !Number.isFinite(Number(cellValue))) {
      throw createError(`Enter a valid number for ${cellAddress}.`);
    }
    if (/^B(?:[1-9]|[1-5]\d)$/.test(cellAddress) && cellValue && !/^\d{12}$/.test(cellValue.trim())) {
      throw createError(`Enter a 12-digit LRN for ${cellAddress}.`);
    }
    edits.set(cellAddress, { cellAddress, value: normalizedValue, type });
  });
  return [...edits.values()];
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
      WHERE form_code = ? AND source_type = 'official' AND template_status = 'active' AND mapping_status = 'ready'
      ORDER BY form_code, version DESC`,
      [SF1_TEMPLATE.formCode]
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
    const mappings = [
      ...Object.entries(SF1_TEMPLATE.headerFields).map(([fieldKey, field]) => ({
        fieldKey, worksheetName: SF1_TEMPLATE.sheetName, cellReference: field.cellAddress
      })),
      ...Object.entries(SF1_TEMPLATE.learnerFields).map(([fieldKey, field]) => ({
        fieldKey, worksheetName: SF1_TEMPLATE.sheetName, cellReference: `${field.column}${SF1_TEMPLATE.learnerStartRow}`
      }))
    ];
    const sections = await getAdvisorySections(database, req.user.id, req.user.schoolId);
    res.json({ template: formatTemplate(template), mappings, sections, maxLearners: 49 });
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
  const section = await getAdvisorySection(database, req.user.id, req.user.schoolId, sectionId);
  const term = await validateTerm(database, req.user.schoolId, section, requestedTermId, Boolean(template.requiresAcademicTerm));
  const [schools] = await database.execute(
    `SELECT name AS schoolName, deped_school_id AS depedSchoolId, region_name AS region,
      division_name AS division, district_name AS district
    FROM schools WHERE id = ? LIMIT 1`,
    [req.user.schoolId]
  );
  if (!schools[0]) throw createError('Your school could not be found.', 404);
  const learners = await getSectionLearners(database, req.user.schoolId, section.id);
  const data = buildGenerationData(schools[0], section, learners);
  const mappedCells = buildMappedCells(data);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    templateId: template.id, version: template.version, schoolId: req.user.schoolId,
    sectionId: section.id, termId: term?.id || null, mappedCells, issues: data.issues
  })).digest('hex');
  return { template, section, term, mappedCells, issues: data.issues, fingerprint };
}

async function previewTemplate(req, res, next) {
  try {
    const preview = await preparePreview(req, getDatabase());
    res.json({
      mappedCells: preview.mappedCells,
      issues: preview.issues.map(formatIssue),
      previewFingerprint: preview.fingerprint
    });
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
    const { template, section, term, mappedCells, issues, fingerprint } = await preparePreview(req, database);
    if (!/^[a-f0-9]{64}$/.test(String(req.body.previewFingerprint || '')) || req.body.previewFingerprint !== fingerprint) {
      throw createError('The SF1 data changed since the preview. Generate a new preview before downloading.', 409);
    }
    const edits = normalizeEdits(req.body.edits);
    const blockingIssues = issues.filter(issue => issue.severity === 'error');
    if (blockingIssues.length) {
      return res.status(422).json({
        message: 'Fix the listed data issues before generating this SF1 export.',
        issues: issues.map(formatIssue)
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
      issues
    );

    const cellMap = new Map(mappedCells.map(cell => [cell.cellAddress, cell]));
    edits.forEach(edit => cellMap.set(edit.cellAddress, edit));
    const workbook = await createExportWorkbook(template, [...cellMap.values()]);
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
      VALUES (?, ?, 'school_form_generated', 'school_form_export', ?, JSON_OBJECT('form_code', ?, 'section_id', ?, 'summary', ?))`,
      [req.user.schoolId, req.user.id, exportId, template.formCode, section.id, `${template.formCode} · ${section.name}`]
    );
    await connection.commit();
    transactionStarted = false;
    connection.release();
    connection = null;

    res.status(201).json({
      message: 'SF1 export generated successfully.',
      export: {
        id: exportId,
        status: 'generated',
        fileName: saved.fileName,
        downloadUrl: `/api/sf-exports/${exportId}/download`
      },
      issues: issues.map(formatIssue),
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
    res.download(filePath, `${exports[0].formCode.toLowerCase()}-export-${exportId}.xlsx`);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  downloadExport,
  generateTemplate,
  getTemplateDetails,
  listTemplates,
  previewTemplate
};
