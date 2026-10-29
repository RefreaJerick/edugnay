const { getDatabase } = require('../config/database');
const { getCatalogEntry } = require('../config/shsApprovedCatalog');
const { policyFor, defaultComponents, componentWeights, componentsEqual } = require('../config/shsGrading');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}
async function yearFor(db, schoolId, yearId, lock = false) {
  const [rows] = await db.execute(
    `SELECT id, label, status FROM academic_years WHERE school_id = ? AND id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, yearId]
  );
  if (!rows.length) fail('School year not found.', 404);
  return rows[0];
}
async function subjectsFor(db, schoolId, yearId, yearLabel) {
  const [core] = await db.execute(
    `SELECT DISTINCT s.id AS subjectId, NULL AS offeringId, s.name,
       g.grade_code AS gradeCode, 'core' AS assessmentGroup, s.is_active AS isActive
     FROM subjects s JOIN subject_grade_scopes sc ON sc.subject_id = s.id AND sc.school_id = s.school_id
     JOIN school_grade_levels g ON g.id = sc.grade_level_id AND g.school_id = sc.school_id
     JOIN school_levels l ON l.id = g.school_level_id AND l.school_id = g.school_id
     WHERE s.school_id = ? AND l.level_code = 'shs' AND g.grade_code = 'grade-11'
       AND s.shs_subject_type = 'core' ORDER BY s.name`, [schoolId]
  );
  const [offerings] = await db.execute(
    `SELECT NULL AS subjectId, o.id AS offeringId, o.subject_name AS name,
       g.grade_code AS gradeCode, o.catalog_code AS catalogCode,
       o.instructional_hours AS instructionalHours, o.is_active AS isActive
     FROM shs_offerings o JOIN school_grade_levels g ON g.id = o.grade_level_id AND g.school_id = o.school_id
     WHERE o.school_id = ? AND o.academic_year_id = ? ORDER BY g.grade_code, o.subject_name`,
    [schoolId, yearId]
  );
  const items = [...core, ...offerings.map(item => ({ ...item,
    assessmentGroup: getCatalogEntry(item.catalogCode)?.assessmentGroup || null }))];
  const [profiles] = await db.execute(
    `SELECT subject_id AS subjectId, offering_id AS offeringId, written_weight AS written,
      performance_weight AS performance, examination_weight AS examination, exam_parts AS examParts,
      components_json AS componentsJson
     FROM shs_grading_profiles WHERE school_id = ? AND academic_year_id = ?`, [schoolId, yearId]
  );
  const [published] = await db.execute(
    `SELECT DISTINCT p.subject_id AS subjectId, c.offering_id AS offeringId
     FROM published_final_grades p JOIN academic_terms t ON t.id = p.academic_term_id AND t.school_id = p.school_id
     LEFT JOIN shs_elective_classes c ON c.id = p.shs_elective_class_id AND c.school_id = p.school_id
     WHERE p.school_id = ? AND t.academic_year_id = ?`, [schoolId, yearId]
  );
  return items.map(item => {
    const profile = profiles.find(row => item.subjectId ? Number(row.subjectId) === Number(item.subjectId)
      : Number(row.offeringId) === Number(item.offeringId));
    const defaults = policyFor(item.assessmentGroup, yearLabel, item.gradeCode);
    const locked = published.some(row => item.subjectId ? Number(row.subjectId) === Number(item.subjectId)
      : Number(row.offeringId) === Number(item.offeringId));
    const defaultRuleComponents = defaults?.components || (defaults ? defaultComponents(defaults.weights) : []);
    const defaultWeights = defaults?.weights || null;
    const defaultExamParts = defaults?.examParts || {};
    const savedComponents = parseComponents(profile?.componentsJson);
    const legacyWeights = profile ? { written: Number(profile.written), performance: Number(profile.performance),
      examination: Number(profile.examination) } : defaultWeights;
    const components = savedComponents || (profile ? defaultComponents({ ...legacyWeights,
      termExamOnly: defaults?.weights?.termExamOnly }) : defaultRuleComponents);
    const examParts = profile ? parseJson(profile.examParts, {}) : defaultExamParts;
    if (profile && !savedComponents) {
      const examination = components.find(component => component.code === 'examination');
      if (examination) examination.examParts = examParts;
    }
    const ruleAvailable = Boolean(defaults?.components?.length);
    const configured = ruleAvailable && Boolean(profile) && !componentsEqual(components, defaultRuleComponents);
    return { ...item, locked, ruleAvailable, alignmentStatus: !ruleAvailable ? 'unavailable'
      : configured ? 'customized' : 'default', configured, components,
      weights: components.length ? componentWeights(components) : null,
      examParts: components.find(component => component.componentType === 'examination')?.examParts || {},
      defaultComponents: defaultRuleComponents, defaultWeights, defaultExamParts };
  });
}
async function list(req, res, next) {
  try {
    const yearId = id(req.query.academicYearId, 'school year ID');
    const db = getDatabase();
    const year = await yearFor(db, req.user.schoolId, yearId);
    res.json({ year, subjects: await subjectsFor(db, req.user.schoolId, yearId, year.label) });
  } catch (error) { next(error); }
}
function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function parseComponents(value) {
  const components = parseJson(value, null);
  if (!Array.isArray(components)) return null;
  return components.map(component => ({ ...component, weight: Number(component.weight),
    examParts: parseJson(component.examParts, {}) }));
}
function normalizeExamParts(parts) {
  if (parts == null) return [];
  if (Array.isArray(parts) || typeof parts !== 'object') return parts;
  return Object.entries(parts).map(([code, value]) => ({
    code,
    name: value && typeof value === 'object' && value.name
      ? value.name
      : code.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
    weight: value && typeof value === 'object' ? value.weight : value
  }));
}
function validateRule(input, defaults, usedItems = [], { allowExaminations = true } = {}) {
  const source = input.components;
  if (!Array.isArray(source) || !source.length || source.length > 20)
    fail('Add at least one grading component.');
  const componentCodes = new Set();
  const components = source.map(component => {
    const code = String(component.code || '').trim();
    const name = String(component.name || '').trim();
    const componentType = String(component.componentType || '').trim();
    const weight = Number(component.weight);
    if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(code) || componentCodes.has(code))
      fail('Component codes must be unique and use up to 30 lowercase letters, numbers, or hyphens.');
    componentCodes.add(code);
    if (!name || name.length > 100) fail('Each component needs a name of 1 to 100 characters.');
    if (!['written', 'performance', 'examination', 'other'].includes(componentType))
      fail('Choose a valid component type.');
    if (componentType === 'examination' && !allowExaminations)
      fail('This SHS subject group does not use an examination component.');
    if (!Number.isInteger(weight) || weight < 0 || weight > 100)
      fail('Component weights must be whole percentages from 0 to 100.');
    const rawParts = normalizeExamParts(component.examParts);
    if (!Array.isArray(rawParts) || (componentType !== 'examination' && rawParts.length))
      fail('Only examination components may have exam parts.');
    const partCodes = new Set();
    const examParts = {};
    for (const part of rawParts) {
      const partCode = String(part.code || '').trim();
      const partName = String(part.name || '').trim();
      const partWeight = Number(part.weight);
      if (!/^[a-z0-9][a-z0-9_-]{0,29}$/.test(partCode) || partCodes.has(partCode))
        fail('Exam-part codes must be unique and use up to 30 lowercase letters, numbers, hyphens, or underscores.');
      if (!partName || partName.length > 100) fail('Each exam part needs a name of 1 to 100 characters.');
      if (!Number.isInteger(partWeight) || partWeight < 0 || partWeight > 100)
        fail('Exam-part weights must be whole percentages from 0 to 100.');
      partCodes.add(partCode);
      examParts[partCode] = { name: partName, weight: partWeight };
    }
    if (rawParts.length && Object.values(examParts).reduce((sum, part) => sum + part.weight, 0) !== 100)
      fail('Exam-part weights must total 100%.');
    return { code, name, componentType, weight, examParts };
  });
  if (components.reduce((sum, component) => sum + component.weight, 0) !== 100)
    fail('Component weights must total 100%.');

  const previous = new Map((defaults.components || []).map(component => [component.code, component]));
  const next = new Map(components.map(component => [component.code, component]));
  for (const used of usedItems) {
    if (!used.componentCode) fail('An existing SHS assessment has no component code. Correct it before changing this rule.');
    const oldComponent = previous.get(used.componentCode);
    const newComponent = next.get(used.componentCode);
    if (!oldComponent) fail(`The ${used.componentCode} assessment component is not in the current rule. Review it before changing this rule.`);
    if (!newComponent) fail(`The ${used.componentCode} component is used by an assessment and cannot be removed.`);
    if (oldComponent && oldComponent.componentType !== newComponent.componentType)
      fail(`The ${used.componentCode} component type cannot change after assessments use it.`);
    if (Number(newComponent.weight) <= 0)
      fail(`The ${used.componentCode} component has assessments and must keep a weight above 0%.`);
    const newParts = newComponent.examParts || {};
    if (used.examPartCode && !Object.hasOwn(newParts, used.examPartCode))
      fail(`The ${used.examPartCode} exam part is used by an assessment and cannot be removed.`);
    if (!used.examPartCode && newComponent.componentType === 'examination'
      && Object.keys(newParts).length)
      fail('An existing examination assessment has no exam part required by the new rule. Correct it before changing this rule.');
    if (used.examPartCode && Number(typeof newParts[used.examPartCode] === 'object'
      ? newParts[used.examPartCode].weight : newParts[used.examPartCode]) <= 0)
      fail(`The ${used.examPartCode} exam part has assessments and must keep a weight above 0%.`);
  }
  return { components, weights: componentWeights(components),
    examParts: components.find(component => component.componentType === 'examination')?.examParts || {} };
}

async function usedItemsFor(db, schoolId, yearId, item) {
  const [rows] = await db.execute(item.subjectId
    ? `SELECT DISTINCT gi.shs_component_code AS componentCode, gi.shs_exam_part_code AS examPartCode
       FROM grading_items gi JOIN academic_terms t ON t.id = gi.academic_term_id AND t.school_id = gi.school_id
       WHERE gi.school_id = ? AND t.academic_year_id = ? AND gi.subject_id = ? AND gi.shs_elective_class_id IS NULL`
    : `SELECT DISTINCT gi.shs_component_code AS componentCode, gi.shs_exam_part_code AS examPartCode
       FROM grading_items gi JOIN academic_terms t ON t.id = gi.academic_term_id AND t.school_id = gi.school_id
       JOIN shs_elective_classes c ON c.id = gi.shs_elective_class_id AND c.school_id = gi.school_id
       WHERE gi.school_id = ? AND t.academic_year_id = ? AND c.offering_id = ?`,
    [schoolId, yearId, item.subjectId || item.offeringId]);
  return rows;
}
async function change(req, res, next, restore = false) {
  const db = getDatabase(); const connection = await db.getConnection(); let started = false;
  try {
    const schoolId = req.user.schoolId;
    const yearId = id(req.body.academicYearId, 'school year ID');
    const subjectId = req.body.subjectId ? id(req.body.subjectId, 'subject ID') : null;
    const offeringId = req.body.offeringId ? id(req.body.offeringId, 'offering ID') : null;
    if (Boolean(subjectId) === Boolean(offeringId)) fail('Choose one SHS subject or offering.');
    await connection.beginTransaction(); started = true;
    const year = await yearFor(connection, schoolId, yearId, true);
    if (year.status === 'archived') fail('Archived school years are read-only.', 409);
    const subjects = await subjectsFor(connection, schoolId, yearId, year.label);
    const item = subjects.find(row => subjectId ? Number(row.subjectId) === subjectId : Number(row.offeringId) === offeringId);
    if (!item || !item.defaultWeights || !item.isActive) fail('Active Strengthened SHS subject not found.', 404);
    if (item.locked) fail('Published grades lock this subject’s grading rule for the school year.', 409);
    let nextRule = { components: item.defaultComponents };
    if (restore) {
      const usedItems = await usedItemsFor(connection, schoolId, yearId, item);
      validateRule({ components: item.defaultComponents }, { components: item.components }, usedItems);
      await connection.execute(
        `DELETE FROM shs_grading_profiles WHERE school_id = ? AND academic_year_id = ? AND ${subjectId ? 'subject_id' : 'offering_id'} = ?`,
        [schoolId, yearId, subjectId || offeringId]
      );
    } else {
      const usedItems = await usedItemsFor(connection, schoolId, yearId, item);
      const rule = validateRule(req.body, { components: item.components }, usedItems,
        { allowExaminations: item.defaultComponents.some(component => component.componentType === 'examination') });
      nextRule = rule;
      await connection.execute(
        `INSERT INTO shs_grading_profiles (school_id, academic_year_id, subject_id, offering_id,
          written_weight, performance_weight, examination_weight, exam_parts, components_json, changed_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE components_json = VALUES(components_json),
           changed_by_user_id = VALUES(changed_by_user_id)`,
        [schoolId, yearId, subjectId, offeringId, item.defaultWeights.written,
          item.defaultWeights.performance, item.defaultWeights.examination,
          JSON.stringify(item.defaultExamParts), JSON.stringify(rule.components), req.user.id]
      );
    }
    await writeAuditLog(connection, req, restore ? 'shs_grading_defaults_restored' : 'shs_grading_rule_saved',
      subjectId ? 'subject' : 'shs_offering', subjectId || offeringId,
      { summary: `${restore ? 'Restored default' : 'Saved custom'} SHS grading rule`, academicYearId: yearId,
        subjectName: item.name, schoolYear: year.label, gradeCode: item.gradeCode,
        previous: { components: item.components },
        next: nextRule });
    await connection.commit(); started = false;
    res.json({ saved: true });
  } catch (error) { if (started) await connection.rollback(); next(error); } finally { connection.release(); }
}
module.exports = { list, save: (req, res, next) => change(req, res, next),
  restore: (req, res, next) => change(req, res, next, true), validateRule };
