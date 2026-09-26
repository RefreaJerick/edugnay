const bcrypt = require('bcrypt');
const { getDatabase } = require('../config/database');
const {
  sendSchoolRegistrationDecisionEmail,
  sendSchoolRegistrationSubmittedEmail
} = require('../config/email');

const LEVEL_DEFAULTS = {
  elementary: { displayName: 'Elementary', gradingPeriodType: 'quarterly', grades: ['kindergarten', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5', 'grade-6'] },
  jhs: { displayName: 'Junior High School', gradingPeriodType: 'quarterly', grades: ['grade-7', 'grade-8', 'grade-9', 'grade-10'] },
  shs: { displayName: 'Senior High School', gradingPeriodType: 'semestral', grades: ['grade-11', 'grade-12'] }
};
const TRACK_DEFAULTS = ['academic', 'tvl', 'arts-design', 'sports'];
const FEATURE_FIELDS = ['gradesEnabled', 'narrativeReportsEnabled', 'journalsEnabled', 'attendanceEnabled', 'sfTemplatesEnabled'];

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value, maximum, required = false) {
  const result = String(value || '').trim();
  if (required && !result) throw createError('A required school field is missing.');
  if (result.length > maximum) throw createError('A school field is too long.');
  return result || null;
}

function email(value, required = false) {
  const result = text(value, 255, required)?.toLowerCase() || null;
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw createError('Provide a valid email address.');
  return result;
}

function boolean(value) {
  if (typeof value !== 'boolean') throw createError('Feature settings must use true or false.');
  return value;
}

function gradeLabel(code) {
  return code === 'kindergarten' ? 'Kindergarten' : `Grade ${code.replace('grade-', '')}`;
}

function trackLabel(code) {
  return { academic: 'Academic', tvl: 'Technical-Vocational-Livelihood', 'arts-design': 'Arts and Design', sports: 'Sports' }[code];
}

function normalizeLevels(values) {
  if (!Array.isArray(values) || !values.length) throw createError('Select at least one school level.');
  const levelCodes = values.map(value => typeof value === 'string' ? value : value.levelCode);
  if (new Set(levelCodes).size !== levelCodes.length || levelCodes.some(code => !LEVEL_DEFAULTS[code])) {
    throw createError('The school-level configuration is invalid.');
  }
  return levelCodes;
}

async function getSchoolRecord(database, schoolId) {
  const [rows] = await database.execute(
    `SELECT schools.id, schools.school_code AS schoolCode, schools.name, schools.short_name AS shortName,
      schools.school_type AS schoolType, schools.deped_school_id AS depedSchoolId, schools.region_name AS regionName,
      schools.division_name AS divisionName, schools.district_name AS districtName, schools.address_line AS addressLine,
      schools.phone, schools.email, schools.website, schools.logo_path AS logoPath,
      schools.registration_status AS registrationStatus, schools.submitted_at AS submittedAt,
      schools.approved_at AS approvedAt, schools.rejected_at AS rejectedAt, schools.rejection_reason AS rejectionReason,
      school_settings.notification_email AS notificationEmail, school_settings.current_school_year_label AS currentSchoolYearLabel
    FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id WHERE schools.id = ? LIMIT 1`,
    [schoolId]
  );
  return rows[0] || null;
}

async function getStructure(database, schoolId) {
  const [levels] = await database.execute(
    `SELECT id, level_code AS levelCode, display_name AS displayName, grading_period_type AS gradingPeriodType, is_enabled AS isEnabled
    FROM school_levels WHERE school_id = ? ORDER BY id`, [schoolId]
  );
  const [grades] = await database.execute(
    `SELECT school_grade_levels.school_level_id AS schoolLevelId, school_grade_levels.grade_code AS gradeCode, school_grade_levels.display_name AS displayName,
      school_grade_levels.sort_order AS sortOrder, school_grade_levels.is_enabled AS isEnabled
    FROM school_grade_levels INNER JOIN school_levels ON school_levels.id = school_grade_levels.school_level_id
    WHERE school_levels.school_id = ? ORDER BY school_grade_levels.sort_order`, [schoolId]
  );
  const [tracks] = await database.execute(
    `SELECT school_shs_tracks.school_level_id AS schoolLevelId, school_shs_tracks.track_code AS trackCode, school_shs_tracks.display_name AS displayName, school_shs_tracks.is_enabled AS isEnabled
    FROM school_shs_tracks INNER JOIN school_levels ON school_levels.id = school_shs_tracks.school_level_id
    WHERE school_levels.school_id = ? ORDER BY school_shs_tracks.id`, [schoolId]
  );
  return levels.map(level => ({
    ...level,
    isEnabled: Boolean(level.isEnabled),
    gradeLevels: grades.filter(grade => grade.schoolLevelId === level.id).map(grade => ({ ...grade, isEnabled: Boolean(grade.isEnabled) })),
    tracks: tracks.filter(track => track.schoolLevelId === level.id).map(track => ({ ...track, isEnabled: Boolean(track.isEnabled) }))
  }));
}

async function getFeatures(database, schoolId) {
  const [[features]] = await database.execute(
    `SELECT grades_enabled AS gradesEnabled, narrative_reports_enabled AS narrativeReportsEnabled,
      journals_enabled AS journalsEnabled, attendance_enabled AS attendanceEnabled,
      sf_templates_enabled AS sfTemplatesEnabled FROM school_portal_features WHERE school_id = ?`, [schoolId]
  );
  return Object.fromEntries(FEATURE_FIELDS.map(field => [field, Boolean(features?.[field])]));
}

function requireSchoolAdminSchool(req) {
  if (req.user.role !== 'school_admin' || !req.user.schoolId) throw createError('You do not have access to this resource.', 403);
  return req.user.schoolId;
}

async function listPlatformSchools(req, res, next) {
  try {
    const database = getDatabase();
    const [schools] = await database.execute(
      `SELECT id, name, short_name AS shortName, registration_status AS registrationStatus,
      submitted_at AS submittedAt, approved_at AS approvedAt, rejected_at AS rejectedAt FROM schools ORDER BY submitted_at DESC, id DESC`
    );
    res.status(200).json({ schools });
  } catch (error) { next(error); }
}

async function getPlatformSchool(req, res, next) {
  try {
    const schoolId = parseId(req.params.schoolId);
    if (!schoolId) throw createError('Invalid school ID.');
    const school = await getSchoolRecord(getDatabase(), schoolId);
    if (!school) throw createError('School not found.', 404);
    const database = getDatabase();
    const [administrators] = await database.execute(
      `SELECT id, display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail, account_status AS accountStatus
      FROM users WHERE school_id = ? AND role = 'school_admin' ORDER BY id`, [school.id]
    );
    res.status(200).json({ school, administrators, features: await getFeatures(database, school.id), structure: await getStructure(database, school.id) });
  } catch (error) { next(error); }
}

async function registerSchool(req, res, next) {
  let connection;
  try {
    const body = req.body || {};
    const name = text(body.name, 255, true);
    const schoolEmail = email(body.email, true);
    const notificationEmail = email(body.notificationEmail, true);
    const initialAdministrator = body.initialAdministrator || {};
    const adminFirstName = text(initialAdministrator.firstName, 100, true);
    const adminLastName = text(initialAdministrator.lastName, 100, true);
    const adminSchoolEmail = email(initialAdministrator.schoolEmail, true);
    const temporaryPassword = String(initialAdministrator.temporaryPassword || '');
    if (temporaryPassword.length < 12 || temporaryPassword.length > 128) throw createError('The administrator temporary password must contain 12 to 128 characters.');
    const levels = normalizeLevels(body.schoolLevels);
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [schoolResult] = await connection.execute(
      `INSERT INTO schools (school_code, name, short_name, school_type, deped_school_id, address_line, phone, email, website, registration_status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [text(body.schoolCode, 50), name, text(body.shortName, 120) || name.toUpperCase(), text(body.schoolType, 50) || 'k12', text(body.depedSchoolId, 50), text(body.addressLine, 255), text(body.phone, 30), schoolEmail, text(body.website, 255)]
    );
    const schoolId = schoolResult.insertId;
    await connection.execute('INSERT INTO school_settings (school_id, notification_email, current_school_year_label) VALUES (?, ?, ?)', [schoolId, notificationEmail, text(body.currentSchoolYearLabel, 30)]);
    await connection.execute('INSERT INTO school_portal_features (school_id) VALUES (?)', [schoolId]);
    await connection.execute('INSERT INTO school_attendance_settings (school_id) VALUES (?)', [schoolId]);
    for (const code of levels) {
      const definition = LEVEL_DEFAULTS[code];
      const [levelResult] = await connection.execute(
        'INSERT INTO school_levels (school_id, level_code, display_name, grading_period_type, is_enabled) VALUES (?, ?, ?, ?, TRUE)',
        [schoolId, code, definition.displayName, definition.gradingPeriodType]
      );
      for (const gradeCode of definition.grades) {
        const sortOrder = gradeCode === 'kindergarten' ? 0 : Number(gradeCode.replace('grade-', ''));
        await connection.execute('INSERT INTO school_grade_levels (school_level_id, grade_code, display_name, sort_order, is_enabled) VALUES (?, ?, ?, ?, TRUE)', [levelResult.insertId, gradeCode, gradeLabel(gradeCode), sortOrder]);
      }
      if (code === 'shs') {
        for (const trackCode of TRACK_DEFAULTS) {
          await connection.execute('INSERT INTO school_shs_tracks (school_level_id, track_code, display_name, is_enabled) VALUES (?, ?, ?, TRUE)', [levelResult.insertId, trackCode, trackLabel(trackCode)]);
        }
      }
    }
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const displayName = `${adminFirstName} ${adminLastName}`;
    const [adminResult] = await connection.execute(
      `INSERT INTO users (school_id, role, school_email, personal_email, password_hash, account_status, first_name, last_name, display_name, initials)
      VALUES (?, 'school_admin', ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [schoolId, adminSchoolEmail, notificationEmail, passwordHash, adminFirstName, adminLastName, displayName, `${adminFirstName[0]}${adminLastName[0]}`.toUpperCase()]
    );
    await connection.execute('INSERT INTO school_admin_profiles (user_id) VALUES (?)', [adminResult.insertId]);
    await connection.commit();
    const school = await getSchoolRecord(database, schoolId);
    const [platformAdmins] = await database.execute(`SELECT display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail FROM users WHERE role = 'platform_admin' AND account_status = 'active'`);
    await Promise.all(platformAdmins.map(user => sendSchoolRegistrationSubmittedEmail(user, school)));
    res.status(201).json({ school: { id: school.id, name: school.name, registrationStatus: school.registrationStatus, notificationEmail } });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('A school or administrator email already exists.', 409);
    next(error);
  } finally { connection?.release(); }
}

async function reviewSchool(req, res, next) {
  let connection;
  try {
    const schoolId = parseId(req.params.schoolId);
    if (!schoolId) throw createError('Invalid school ID.');
    const approved = req.params.action === 'approve';
    const reason = text(req.body?.reason, 1000);
    if (!approved && !reason) throw createError('Provide a reason for rejecting the registration.');
    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute('SELECT id, name, registration_status AS registrationStatus FROM schools WHERE id = ? FOR UPDATE', [schoolId]);
    if (!school) throw createError('School not found.', 404);
    if (school.registrationStatus !== 'pending') throw createError('Only pending school registrations can be reviewed.', 409);
    await connection.execute(
      `UPDATE schools SET registration_status = ?, approved_at = ${approved ? 'NOW()' : 'NULL'}, rejected_at = ${approved ? 'NULL' : 'NOW()'}, rejection_reason = ? WHERE id = ?`,
      [approved ? 'active' : 'rejected', approved ? null : reason, schoolId]
    );
    await connection.execute('UPDATE users SET account_status = ? WHERE school_id = ? AND role = \'school_admin\' AND account_status = \'pending\'', [approved ? 'active' : 'inactive', schoolId]);
    await connection.commit();
    const [administrators] = await database.execute(`SELECT display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail FROM users WHERE school_id = ? AND role = 'school_admin'`, [schoolId]);
    await Promise.all(administrators.map(user => sendSchoolRegistrationDecisionEmail(user, school, approved, reason)));
    res.status(200).json({ school: await getSchoolRecord(database, schoolId) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

async function getSchoolSettings(req, res, next) {
  try {
    const school = await getSchoolRecord(getDatabase(), requireSchoolAdminSchool(req));
    if (!school) throw createError('School not found.', 404);
    res.status(200).json({ school });
  } catch (error) { next(error); }
}

async function updateSchoolSettings(req, res, next) {
  try {
    const schoolId = requireSchoolAdminSchool(req);
    const body = req.body || {};
    const allowed = ['name', 'shortName', 'depedSchoolId', 'regionName', 'divisionName', 'districtName', 'addressLine', 'phone', 'email', 'website', 'notificationEmail', 'currentSchoolYearLabel'];
    const unknown = Object.keys(body).find(field => !allowed.includes(field));
    if (unknown || !Object.keys(body).length) throw createError('Provide valid school settings.');
    const database = getDatabase();
    const school = await getSchoolRecord(database, schoolId);
    const values = {
      name: Object.hasOwn(body, 'name') ? text(body.name, 255, true) : school.name,
      shortName: Object.hasOwn(body, 'shortName') ? text(body.shortName, 120) : school.shortName,
      depedSchoolId: Object.hasOwn(body, 'depedSchoolId') ? text(body.depedSchoolId, 50) : school.depedSchoolId,
      regionName: Object.hasOwn(body, 'regionName') ? text(body.regionName, 120) : school.regionName,
      divisionName: Object.hasOwn(body, 'divisionName') ? text(body.divisionName, 150) : school.divisionName,
      districtName: Object.hasOwn(body, 'districtName') ? text(body.districtName, 150) : school.districtName,
      addressLine: Object.hasOwn(body, 'addressLine') ? text(body.addressLine, 255) : school.addressLine,
      phone: Object.hasOwn(body, 'phone') ? text(body.phone, 30) : school.phone,
      email: Object.hasOwn(body, 'email') ? email(body.email, true) : school.email,
      website: Object.hasOwn(body, 'website') ? text(body.website, 255) : school.website,
      notificationEmail: Object.hasOwn(body, 'notificationEmail') ? email(body.notificationEmail) : school.notificationEmail,
      currentSchoolYearLabel: Object.hasOwn(body, 'currentSchoolYearLabel') ? text(body.currentSchoolYearLabel, 30) : school.currentSchoolYearLabel
    };
    await database.execute(`UPDATE schools SET name=?, short_name=?, deped_school_id=?, region_name=?, division_name=?, district_name=?, address_line=?, phone=?, email=?, website=? WHERE id=?`, [values.name, values.shortName, values.depedSchoolId, values.regionName, values.divisionName, values.districtName, values.addressLine, values.phone, values.email, values.website, schoolId]);
    await database.execute(`UPDATE school_settings SET notification_email=?, current_school_year_label=? WHERE school_id=?`, [values.notificationEmail, values.currentSchoolYearLabel, schoolId]);
    res.status(200).json({ school: await getSchoolRecord(database, schoolId) });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') error = createError('That DepEd school ID is already assigned.', 409); next(error); }
}

async function getPortalFeatures(req, res, next) {
  try { res.status(200).json({ features: await getFeatures(getDatabase(), requireSchoolAdminSchool(req)) }); } catch (error) { next(error); }
}

async function updatePortalFeatures(req, res, next) {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).find(field => !FEATURE_FIELDS.includes(field));
    if (unknown || !Object.keys(body).length) throw createError('Provide valid portal feature settings.');
    const schoolId = requireSchoolAdminSchool(req);
    const current = await getFeatures(getDatabase(), schoolId);
    FEATURE_FIELDS.forEach(field => { if (Object.hasOwn(body, field)) current[field] = boolean(body[field]); });
    await getDatabase().execute(`UPDATE school_portal_features SET grades_enabled=?, narrative_reports_enabled=?, journals_enabled=?, attendance_enabled=?, sf_templates_enabled=? WHERE school_id=?`, [current.gradesEnabled, current.narrativeReportsEnabled, current.journalsEnabled, current.attendanceEnabled, current.sfTemplatesEnabled, schoolId]);
    res.status(200).json({ features: current });
  } catch (error) { next(error); }
}

async function getAcademicStructure(req, res, next) {
  try { res.status(200).json({ levels: await getStructure(getDatabase(), requireSchoolAdminSchool(req)) }); } catch (error) { next(error); }
}

async function updateAcademicStructure(req, res, next) {
  let connection;
  try {
    const schoolId = requireSchoolAdminSchool(req);
    const levels = Array.isArray(req.body?.levels) ? req.body.levels : null;
    if (!levels?.length) throw createError('Provide at least one school level.');
    const codes = levels.map(level => level?.levelCode);
    if (new Set(codes).size !== codes.length || codes.some(code => !LEVEL_DEFAULTS[code])) throw createError('The school-level configuration is invalid.');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    for (const level of levels) {
      const definition = LEVEL_DEFAULTS[level.levelCode];
      const gradingPeriodType = ['quarterly', 'semestral', 'trimestral'].includes(level.gradingPeriodType) ? level.gradingPeriodType : definition.gradingPeriodType;
      await connection.execute(`INSERT INTO school_levels (school_id, level_code, display_name, grading_period_type, is_enabled) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), grading_period_type=VALUES(grading_period_type), is_enabled=VALUES(is_enabled)`, [schoolId, level.levelCode, text(level.displayName, 80) || definition.displayName, gradingPeriodType, boolean(level.isEnabled)]);
      const [[storedLevel]] = await connection.execute('SELECT id FROM school_levels WHERE school_id = ? AND level_code = ? FOR UPDATE', [schoolId, level.levelCode]);
      if (Array.isArray(level.gradeLevels)) {
        const gradeCodes = level.gradeLevels.map(grade => grade?.gradeCode);
        if (new Set(gradeCodes).size !== gradeCodes.length || gradeCodes.some(code => !definition.grades.includes(code))) {
          throw createError('The grade-level configuration is invalid.');
        }
        for (const grade of level.gradeLevels) {
          await connection.execute(`INSERT INTO school_grade_levels (school_level_id, grade_code, display_name, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order), is_enabled=VALUES(is_enabled)`, [storedLevel.id, grade.gradeCode, text(grade.displayName, 80) || gradeLabel(grade.gradeCode), Number(grade.sortOrder) || (grade.gradeCode === 'kindergarten' ? 0 : Number(grade.gradeCode.replace('grade-', ''))), boolean(grade.isEnabled)]);
        }
        if (gradeCodes.length) {
          await connection.execute(`UPDATE school_grade_levels SET is_enabled = FALSE WHERE school_level_id = ? AND grade_code NOT IN (${gradeCodes.map(() => '?').join(', ')})`, [storedLevel.id, ...gradeCodes]);
        } else {
          await connection.execute('UPDATE school_grade_levels SET is_enabled = FALSE WHERE school_level_id = ?', [storedLevel.id]);
        }
      }
      if (level.levelCode === 'shs' && Array.isArray(level.tracks)) {
        const trackCodes = level.tracks.map(track => track?.trackCode);
        if (new Set(trackCodes).size !== trackCodes.length || trackCodes.some(code => !TRACK_DEFAULTS.includes(code))) {
          throw createError('The SHS track configuration is invalid.');
        }
        for (const track of level.tracks) {
          await connection.execute(`INSERT INTO school_shs_tracks (school_level_id, track_code, display_name, is_enabled) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), is_enabled=VALUES(is_enabled)`, [storedLevel.id, track.trackCode, text(track.displayName, 120) || trackLabel(track.trackCode), boolean(track.isEnabled)]);
        }
        if (trackCodes.length) {
          await connection.execute(`UPDATE school_shs_tracks SET is_enabled = FALSE WHERE school_level_id = ? AND track_code NOT IN (${trackCodes.map(() => '?').join(', ')})`, [storedLevel.id, ...trackCodes]);
        } else {
          await connection.execute('UPDATE school_shs_tracks SET is_enabled = FALSE WHERE school_level_id = ?', [storedLevel.id]);
        }
      }
    }
    await connection.execute(`UPDATE school_levels SET is_enabled = FALSE WHERE school_id = ? AND level_code NOT IN (${codes.map(() => '?').join(', ')})`, [schoolId, ...codes]);
    await connection.commit();
    res.status(200).json({ levels: await getStructure(getDatabase(), schoolId) });
  } catch (error) { if (connection) await connection.rollback(); next(error); } finally { connection?.release(); }
}

module.exports = { getAcademicStructure, getPlatformSchool, getPortalFeatures, getSchoolSettings, listPlatformSchools, registerSchool, reviewSchool, updateAcademicStructure, updatePortalFeatures, updateSchoolSettings };
