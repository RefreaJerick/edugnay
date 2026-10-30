const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getDatabase } = require('../config/database');
const { getSchoolLogoUrl, logoDirectory, saveSchoolLogo } = require('../config/schoolLogos');
const { deleteAvatar } = require('../config/avatars');
const { writeAuditLog } = require('../utils/auditLog');
const { studentCanAccessJournal } = require('../utils/studentJournalAccess');
const { findStudentShsPlacementRows, getStudentShsPlacementIssue } = require('../utils/shsSelectionPlacement');
const { SHS_TRACKS } = require('../config/shsCurriculum');
const { schoolDomainCandidate } = require('../utils/schoolEmailDomain');
const { schoolEmailBase, schoolEmailCandidate } = require('../utils/schoolUserEmail');
const { DEFAULT_WEEK, normalizeWeekSettings } = require('../utils/reportWeekSettings');
const { wakeSchoolRegistrationEmailWorker } = require('../workers/schoolRegistrationEmailWorker');
const {
  sendSchoolRegistrationSubmittedEmail
} = require('../config/email');

const LEVEL_DEFAULTS = {
  elementary: { displayName: 'Elementary', gradingPeriodType: 'quarterly', grades: ['kindergarten', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5', 'grade-6'] },
  jhs: { displayName: 'Junior High School', gradingPeriodType: 'quarterly', grades: ['grade-7', 'grade-8', 'grade-9', 'grade-10'] },
  shs: { displayName: 'Senior High School', gradingPeriodType: 'semestral', grades: ['grade-11', 'grade-12'] }
};
const TRACK_DEFAULTS = SHS_TRACKS.map(track => track.code);
const ATTENDANCE_STATUS_DEFAULTS = [
  { code: 'present', displayName: 'Present', description: 'Student attended class.', displayKey: 'P', displayTone: 'present' },
  { code: 'absent', displayName: 'Absent', description: 'Student did not attend class.', displayKey: 'A', displayTone: 'absent' },
  { code: 'late', displayName: 'Late', description: 'Student arrived after attendance was taken.', displayKey: 'L', displayTone: 'late' },
  { code: 'excused', displayName: 'Excused', description: 'Student absence has a recorded excuse.', displayKey: 'E', displayTone: 'excused' }
];
const FEATURE_FIELDS = ['gradesEnabled', 'narrativeReportsEnabled', 'journalsEnabled', 'attendanceEnabled', 'sfTemplatesEnabled'];
const SCHOOL_ACTIVITY_TABLES = [
  'attendance_status_codes', 'parent_notification_triggers', 'subjects', 'sections',
  'section_students', 'section_teachers', 'grading_categories', 'assignments',
  'published_final_grades', 'attendance_sessions', 'grading_period_reopen_requests',
  'announcements', 'learning_materials', 'journal_subjects', 'narrative_reports',
  'intervention_plans', 'school_form_exports', 'holidays'
];

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
  return SHS_TRACKS.find(track => track.code === code)?.label;
}

function normalizeLevels(values) {
  if (!Array.isArray(values) || !values.length) throw createError('Select at least one school level.');
  const levelCodes = values.map(value => typeof value === 'string' ? value : value.levelCode);
  if (new Set(levelCodes).size !== levelCodes.length || levelCodes.some(code => !LEVEL_DEFAULTS[code])) {
    throw createError('The school-level configuration is invalid.');
  }
  return levelCodes;
}

function validDate(value) {
  const date = String(value || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function registrationTerms(body, levelCodes) {
  const start = body.schoolYearStartDate;
  const end = body.schoolYearEndDate;
  if (!validDate(start) || !validDate(end) || start >= end) throw createError('Provide valid school year dates.');
  const configs = body.academicTermConfigs;
  if (!Array.isArray(configs) || configs.length !== levelCodes.length) throw createError('Configure the grading periods for every school level.');
  const periodTypes = { quarterly: 4, three_term: 3, semester: 2 };
  const seen = new Set();
  for (const config of configs) {
    if (!config || !levelCodes.includes(config.schoolLevel) || seen.has(config.schoolLevel) || !periodTypes[config.gradingPeriodType]) {
      throw createError('The school grading structure is invalid.');
    }
    seen.add(config.schoolLevel);
    if (!Array.isArray(config.academicPeriods) || config.academicPeriods.length !== periodTypes[config.gradingPeriodType]) {
      throw createError('The number of grading periods is invalid.');
    }
    let previousEnd = '';
    for (const period of config.academicPeriods) {
      if (!period || typeof period !== 'object') throw createError('A grading period is invalid.');
      text(period.name, 80, true);
      if (!validDate(period.plannedStartDate) || !validDate(period.plannedEndDate)
        || period.plannedStartDate < start || period.plannedEndDate > end
        || period.plannedStartDate >= period.plannedEndDate || period.plannedStartDate <= previousEnd) {
        throw createError('Grading period dates must be ordered within the school year.');
      }
      previousEnd = period.plannedEndDate;
    }
  }
  return configs;
}

function schoolTypeForLevels(levelCodes) {
  if (levelCodes.length === Object.keys(LEVEL_DEFAULTS).length) return 'k12';
  return levelCodes.length === 1 ? levelCodes[0] : 'multi-level';
}

async function getSchoolRecord(database, schoolId) {
  const [rows] = await database.execute(
    `SELECT schools.id, schools.school_code AS schoolCode, schools.name, schools.short_name AS shortName,
      schools.school_type AS schoolType, schools.deped_school_id AS depedSchoolId, schools.region_name AS regionName,
      schools.division_name AS divisionName, schools.district_name AS districtName, schools.address_line AS addressLine,
      schools.phone, schools.email, schools.website, schools.school_email_domain AS schoolEmailDomain, schools.logo_path AS logoPath,
      schools.registration_status AS registrationStatus, schools.submitted_at AS submittedAt,
      schools.approved_at AS approvedAt, schools.rejected_at AS rejectedAt, schools.rejection_reason AS rejectionReason,
      school_settings.notification_email AS notificationEmail, school_settings.current_school_year_label AS currentSchoolYearLabel
    FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id WHERE schools.id = ? LIMIT 1`,
    [schoolId]
  );
  return rows[0] ? { ...rows[0], logoUrl: getSchoolLogoUrl(rows[0]) } : null;
}

async function getStructure(database, schoolId) {
  const [levels] = await database.execute(
    `SELECT id, level_code AS levelCode, display_name AS displayName, grading_period_type AS gradingPeriodType,
      grade_rounding AS gradeRounding, passing_grade_threshold AS passingGradeThreshold, is_enabled AS isEnabled
    FROM school_levels WHERE school_id = ?
    ORDER BY CASE level_code WHEN 'elementary' THEN 0 WHEN 'jhs' THEN 1 WHEN 'shs' THEN 2 ELSE 3 END, id`, [schoolId]
  );
  const [grades] = await database.execute(
    `SELECT school_grade_levels.id, school_grade_levels.school_level_id AS schoolLevelId, school_grade_levels.grade_code AS gradeCode, school_grade_levels.display_name AS displayName,
      school_grade_levels.sort_order AS sortOrder, school_grade_levels.is_enabled AS isEnabled
    FROM school_grade_levels INNER JOIN school_levels ON school_levels.id = school_grade_levels.school_level_id
    WHERE school_levels.school_id = ?
    ORDER BY CASE school_levels.level_code WHEN 'elementary' THEN 0 WHEN 'jhs' THEN 1 WHEN 'shs' THEN 2 ELSE 3 END,
      CASE WHEN school_grade_levels.grade_code = 'kindergarten' THEN 0
        ELSE CAST(SUBSTRING_INDEX(school_grade_levels.grade_code, '-', -1) AS UNSIGNED) END,
      school_grade_levels.id`, [schoolId]
  );
  const [tracks] = await database.execute(
    `SELECT school_shs_tracks.id, school_shs_tracks.school_level_id AS schoolLevelId, school_shs_tracks.track_code AS trackCode, school_shs_tracks.display_name AS displayName, school_shs_tracks.is_enabled AS isEnabled
    FROM school_shs_tracks INNER JOIN school_levels ON school_levels.id = school_shs_tracks.school_level_id
    WHERE school_levels.school_id = ? AND school_shs_tracks.track_code IN ('academic', 'techpro') ORDER BY school_shs_tracks.id`, [schoolId]
  );
  return levels.map(level => ({
    ...level,
    isEnabled: Boolean(level.isEnabled),
    passingGradeThreshold: Number(level.passingGradeThreshold),
    gradeLevels: grades.filter(grade => grade.schoolLevelId === level.id).map(grade => ({ ...grade, isEnabled: Boolean(grade.isEnabled) })),
    tracks: tracks.filter(track => track.schoolLevelId === level.id).map(track => ({
      ...track,
      isEnabled: Boolean(track.isEnabled)
    }))
  }));
}

async function getFeatures(database, schoolId) {
  const [[features]] = await database.execute(
    `SELECT grades_enabled AS gradesEnabled, narrative_reports_enabled AS narrativeReportsEnabled,
      ai_evidence_approved_at AS aiEvidenceApprovedAt,
      journals_enabled AS journalsEnabled,
      sf_templates_enabled AS sfTemplatesEnabled FROM school_portal_features WHERE school_id = ?`, [schoolId]
  );
  return {
    ...Object.fromEntries(FEATURE_FIELDS.map(field => [field, Boolean(features?.[field])])),
    aiEvidenceApproved: Boolean(features?.aiEvidenceApprovedAt),
    aiEvidenceApprovedAt: features?.aiEvidenceApprovedAt || null,
    attendanceEnabled: true
  };
}

async function getJournalSubjectEligibility(database, schoolId, subjectId) {
  if (!subjectId) return { subject: null, eligible: false };
  const [[subject]] = await database.execute(
    `SELECT subjects.id, subjects.name, subjects.subject_code AS subjectCode,
      subjects.school_level_id AS schoolLevelId, subjects.grade_level_id AS gradeLevelId,
      COALESCE(subject_levels.level_code, grade_levels.level_code) AS schoolLevelCode
    FROM subjects
    LEFT JOIN school_levels AS subject_levels ON subject_levels.id = subjects.school_level_id
      AND subject_levels.school_id = subjects.school_id
    LEFT JOIN school_grade_levels AS direct_grades ON direct_grades.id = subjects.grade_level_id
      AND direct_grades.school_id = subjects.school_id
    LEFT JOIN school_levels AS grade_levels ON grade_levels.id = direct_grades.school_level_id
      AND grade_levels.school_id = subjects.school_id
    WHERE subjects.id = ? AND subjects.school_id = ? AND subjects.is_active = TRUE LIMIT 1`,
    [subjectId, schoolId]
  );
  if (!subject) return { subject: null, eligible: false };

  const [[jhsLevel]] = await database.execute(
    `SELECT id FROM school_levels WHERE school_id = ? AND level_code = 'jhs' AND is_enabled = TRUE LIMIT 1`,
    [schoolId]
  );
  if (!jhsLevel) return { subject, eligible: false };
  const [jhsGrades] = await database.execute(
    `SELECT id FROM school_grade_levels
    WHERE school_id = ? AND school_level_id = ? AND is_enabled = TRUE`,
    [schoolId, jhsLevel.id]
  );
  const enabledJhsGradeIds = new Set(jhsGrades.map(grade => Number(grade.id)));
  if (!enabledJhsGradeIds.size) return { subject, eligible: false };

  const [scopes] = await database.execute(
    `SELECT scopes.grade_level_id AS gradeLevelId, levels.level_code AS levelCode,
      levels.is_enabled AS levelEnabled, grades.is_enabled AS gradeEnabled
    FROM subject_grade_scopes AS scopes
    INNER JOIN school_grade_levels AS grades ON grades.id = scopes.grade_level_id
      AND grades.school_id = scopes.school_id
    INNER JOIN school_levels AS levels ON levels.id = grades.school_level_id
      AND levels.school_id = scopes.school_id
    WHERE scopes.school_id = ? AND scopes.subject_id = ?`,
    [schoolId, subjectId]
  );

  let eligible = false;
  if (scopes.length) {
    const hasEnabledJhsScope = scopes.some(scope => scope.levelCode === 'jhs'
      && Boolean(scope.levelEnabled) && Boolean(scope.gradeEnabled)
      && enabledJhsGradeIds.has(Number(scope.gradeLevelId)));
    const hasOtherEnabledLevelScope = scopes.some(scope => scope.levelCode !== 'jhs'
      && Boolean(scope.levelEnabled) && Boolean(scope.gradeEnabled));
    eligible = hasEnabledJhsScope && !hasOtherEnabledLevelScope;
  } else {
    eligible = subject.schoolLevelCode === 'jhs'
      && (!subject.gradeLevelId || enabledJhsGradeIds.has(Number(subject.gradeLevelId)));
  }
  return { subject, eligible };
}

function requireSchoolAdminSchool(req) {
  if (req.user.role !== 'school_admin' || !req.user.schoolId) throw createError('You do not have access to this resource.', 403);
  return req.user.schoolId;
}

function requireAuthenticatedSchool(req) {
  if (!req.user?.schoolId) throw createError('You do not have access to a school workspace.', 403);
  return req.user.schoolId;
}

async function listPlatformSchools(req, res, next) {
  try {
    const database = getDatabase();
    const [schools] = await database.execute(
      `SELECT schools.id, schools.school_code AS schoolCode, schools.deped_school_id AS depedSchoolId,
        schools.name, schools.short_name AS shortName, schools.school_type AS schoolType,
        schools.email, schools.school_email_domain AS schoolEmailDomain, schools.logo_path AS logoPath,
        schools.registration_status AS registrationStatus,
        CASE WHEN schools.registration_status = 'active' THEN 'active'
          ELSE schools.registration_status END AS platformStatus,
        schools.submitted_at AS submittedAt, schools.approved_at AS approvedAt, schools.rejected_at AS rejectedAt,
        school_settings.current_school_year_label AS schoolYear,
        school_settings.notification_email AS notificationEmail,
        (SELECT GROUP_CONCAT(levels.display_name ORDER BY levels.id SEPARATOR ' + ')
          FROM school_levels AS levels WHERE levels.school_id = schools.id) AS typeLabel,
        (SELECT admins.display_name FROM users AS admins
          WHERE admins.school_id = schools.id AND admins.role = 'school_admin' ORDER BY admins.id LIMIT 1) AS administrator,
        (SELECT admins.school_email FROM users AS admins
          WHERE admins.school_id = schools.id AND admins.role = 'school_admin' ORDER BY admins.id LIMIT 1) AS administratorSchoolEmail
      FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id
      ORDER BY schools.submitted_at DESC, schools.id DESC`
    );
    res.status(200).json({ schools: schools.map(school => ({ ...school, logoUrl: getSchoolLogoUrl(school) })) });
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
    const [academicTerms] = await database.execute(
      `SELECT school_levels.level_code AS schoolLevel, school_levels.grading_period_type AS gradingPeriodType,
        academic_terms.name, academic_terms.sequence_number AS sequenceNumber
      FROM academic_terms
      INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
      INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
      WHERE academic_years.school_id = ? AND academic_years.label = ?
      ORDER BY school_levels.id, academic_terms.sequence_number`,
      [school.id, school.currentSchoolYearLabel]
    );
    const [[journalSubject]] = await database.execute(
      'SELECT name FROM journal_subjects WHERE school_id = ? AND is_active = TRUE ORDER BY id LIMIT 1', [school.id]
    );
    const [[emailDelivery]] = await database.execute(
      `SELECT decision, status, attempts, recipient_email AS recipientEmail, sent_at AS sentAt,
        smtp_message_id AS smtpMessageId, last_error AS lastError
      FROM school_registration_email_outbox WHERE school_id = ? ORDER BY id DESC LIMIT 1`,
      [school.id]
    );
    res.status(200).json({ school, administrators, features: await getFeatures(database, school.id),
      structure: await getStructure(database, school.id), academicTerms, journalSubject: journalSubject || null,
      emailDelivery: emailDelivery || null });
  } catch (error) { next(error); }
}

async function registerSchool(req, res, next) {
  let connection;
  let logoName;
  let committed = false;
  try {
    let body = req.body || {};
    if (body.payload) {
      try { body = JSON.parse(body.payload); } catch { throw createError('The registration details are invalid.'); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError('The registration details are invalid.');
    const name = text(body.name, 255, true);
    const schoolEmail = email(body.email, true);
    const notificationEmail = email(body.notificationEmail, true);
    const initialAdministrator = body.initialAdministrator || {};
    const adminFirstName = text(initialAdministrator.firstName, 100, true);
    const adminLastName = text(initialAdministrator.lastName, 100, true);
    const emailBase = schoolEmailBase(adminFirstName, adminLastName, 'school_admin');
    const temporaryPassword = String(initialAdministrator.temporaryPassword || '');
    if (temporaryPassword.length < 12 || temporaryPassword.length > 128) throw createError('The administrator temporary password must contain 12 to 128 characters.');
    const levels = normalizeLevels(body.schoolLevels);
    const schoolYear = text(body.currentSchoolYearLabel, 30, true);
    const termConfigs = registrationTerms(body, levels);
    const registrationStatusToken = crypto.randomBytes(32).toString('hex');
    const registrationStatusTokenHash = crypto.createHash('sha256').update(registrationStatusToken).digest('hex');
    logoName = await saveSchoolLogo(req.file);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    let schoolEmailDomain = schoolDomainCandidate(name);
    let schoolResult;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        [schoolResult] = await connection.execute(
          `INSERT INTO schools (school_code, name, short_name, school_type, deped_school_id, address_line, phone, email, website, school_email_domain, logo_path, registration_status, registration_status_token_hash, registration_status_token_expires_at, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 90 DAY), NOW())`,
          [text(body.schoolCode, 50), name, text(body.shortName, 120) || name.toUpperCase(), schoolTypeForLevels(levels), text(body.depedSchoolId, 50), text(body.addressLine, 255), text(body.phone, 30), schoolEmail, text(body.website, 255), schoolEmailDomain, logoName, registrationStatusTokenHash]
        );
        break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [[existingDomain]] = await connection.execute('SELECT id FROM schools WHERE school_email_domain = ? LIMIT 1', [schoolEmailDomain]);
        if (!existingDomain || attempt === 2) throw error;
        schoolEmailDomain = schoolDomainCandidate(name, crypto.randomBytes(3).toString('hex'));
      }
    }
    const schoolId = schoolResult.insertId;
    await connection.execute('INSERT INTO school_settings (school_id, notification_email, current_school_year_label) VALUES (?, ?, ?)', [schoolId, notificationEmail, schoolYear]);
    await connection.execute('INSERT INTO school_portal_features (school_id) VALUES (?)', [schoolId]);
    await connection.execute('INSERT INTO school_attendance_settings (school_id) VALUES (?)', [schoolId]);
    const attendanceCodePlaceholders = ATTENDANCE_STATUS_DEFAULTS.map(() => '(?, ?, ?, ?, ?, ?, TRUE)').join(', ');
    const attendanceCodeValues = ATTENDANCE_STATUS_DEFAULTS.flatMap(code => [
      schoolId, code.code, code.displayName, code.description, code.displayKey, code.displayTone
    ]);
    await connection.execute(
      `INSERT INTO attendance_status_codes
        (school_id, code, display_name, description, display_key, display_tone, is_active)
      VALUES ${attendanceCodePlaceholders}`,
      attendanceCodeValues
    );
    const levelIds = {};
    for (const code of levels) {
      const definition = LEVEL_DEFAULTS[code];
      const config = termConfigs.find(item => item.schoolLevel === code);
      const periodType = { quarterly: 'quarterly', three_term: 'trimestral', semester: 'semestral' }[config.gradingPeriodType];
      const [levelResult] = await connection.execute(
        'INSERT INTO school_levels (school_id, level_code, display_name, grading_period_type, is_enabled) VALUES (?, ?, ?, ?, TRUE)',
        [schoolId, code, definition.displayName, periodType]
      );
      levelIds[code] = levelResult.insertId;
      for (const gradeCode of definition.grades) {
        const sortOrder = gradeCode === 'kindergarten' ? 0 : Number(gradeCode.replace('grade-', ''));
        await connection.execute('INSERT INTO school_grade_levels (school_id, school_level_id, grade_code, display_name, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, TRUE)', [schoolId, levelResult.insertId, gradeCode, gradeLabel(gradeCode), sortOrder]);
      }
      if (code === 'shs') {
        for (const trackCode of TRACK_DEFAULTS) {
          await connection.execute('INSERT INTO school_shs_tracks (school_id, school_level_id, track_code, display_name, is_enabled) VALUES (?, ?, ?, ?, TRUE)', [schoolId, levelResult.insertId, trackCode, trackLabel(trackCode)]);
        }
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const [yearResult] = await connection.execute(
      'INSERT INTO academic_years (school_id, label, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
      [schoolId, schoolYear, body.schoolYearStartDate, body.schoolYearEndDate,
        body.schoolYearStartDate <= today && today <= body.schoolYearEndDate ? 'active' : 'upcoming']
    );
    for (const config of termConfigs) {
      for (const [index, period] of config.academicPeriods.entries()) {
        await connection.execute(
          `INSERT INTO academic_terms (school_id, academic_year_id, school_level_id, name, sequence_number, planned_start_date, planned_end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [schoolId, yearResult.insertId, levelIds[config.schoolLevel], text(period.name, 80, true), index + 1, period.plannedStartDate, period.plannedEndDate]
        );
      }
    }
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const displayName = `${adminFirstName} ${adminLastName}`;
    let adminSchoolEmail;
    let adminResult;
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const candidate = schoolEmailCandidate(emailBase, schoolEmailDomain, suffix);
      const [[existing]] = await connection.execute('SELECT id FROM users WHERE school_email = ? LIMIT 1 FOR UPDATE', [candidate]);
      if (existing) continue;
      try {
        [adminResult] = await connection.execute(
          `INSERT INTO users (school_id, role, school_email, personal_email, password_hash, account_status, first_name, last_name, display_name, initials)
          VALUES (?, 'school_admin', ?, ?, ?, 'pending', ?, ?, ?, ?)`,
          [schoolId, candidate, notificationEmail, passwordHash, adminFirstName, adminLastName, displayName, `${adminFirstName[0]}${adminLastName[0]}`.toUpperCase()]
        );
        adminSchoolEmail = candidate;
        break;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [[conflict]] = await connection.execute('SELECT id FROM users WHERE school_email = ? LIMIT 1 FOR UPDATE', [candidate]);
        if (!conflict) throw error;
      }
    }
    if (!adminResult) throw createError('No available administrator email address was found.', 409);
    await connection.execute('INSERT INTO school_admin_profiles (user_id) VALUES (?)', [adminResult.insertId]);
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
       VALUES (?, ?, 'school_registration_submitted', 'school', ?,
         JSON_OBJECT('summary', ?, 'schoolName', ?, 'source', 'school_record'))`,
      [schoolId, adminResult.insertId, schoolId, `${name} · registration submitted`, name]
    );
    const [platformAdmins] = await connection.execute(`SELECT id, display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail FROM users WHERE role = 'platform_admin' AND account_status = 'active'`);
    for (const user of platformAdmins) {
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, target_path) VALUES (?, 'school_account', ?, ?, ?)`,
        [user.id, 'School account awaiting review', `${name} submitted a new registration.`, '/views/platform/edugnay-platform-school-accounts.html']
      );
    }
    await connection.commit();
    committed = true;
    platformAdmins.forEach(user => { sendSchoolRegistrationSubmittedEmail(user, { name }).catch(console.error); });
    res.status(201).json({
      school: { id: schoolId, name, schoolEmailDomain, administratorSchoolEmail: adminSchoolEmail, registrationStatus: 'pending', notificationEmail },
      registrationStatusToken
    });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    if (logoName && !committed) await fs.unlink(path.join(logoDirectory, logoName)).catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') error = createError('A school or administrator email already exists.', 409);
    next(error);
  } finally { connection?.release(); }
}

function maskNotificationEmail(value) {
  const emailAddress = String(value || '');
  const at = emailAddress.lastIndexOf('@');
  if (at < 1 || at === emailAddress.length - 1) return null;
  const localPart = emailAddress.slice(0, at);
  const visibleLength = Math.min(2, Math.max(0, localPart.length - 1));
  return `${localPart.slice(0, visibleLength)}***@${emailAddress.slice(at + 1)}`;
}

async function getRegistrationStatus(req, res, next) {
  let connection;
  try {
    res.set('Cache-Control', 'no-store');
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) throw createError('Registration status could not be found.', 404);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    connection = await getDatabase().getConnection();
    const [[registration]] = await connection.execute(
      `SELECT schools.name AS schoolName,
        schools.registration_status AS registrationStatus,
        schools.submitted_at AS submittedAt,
        schools.approved_at AS approvedAt,
        schools.rejected_at AS rejectedAt,
        (SELECT users.school_email FROM users WHERE users.school_id = schools.id AND users.role = 'school_admin' ORDER BY users.id LIMIT 1) AS administratorSchoolEmail,
        (SELECT school_settings.notification_email FROM school_settings WHERE school_settings.school_id = schools.id LIMIT 1) AS notificationEmail
       FROM schools
       WHERE schools.registration_status_token_hash = ?
         AND schools.registration_status_token_expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    if (!registration) throw createError('Registration status could not be found.', 404);

    res.json({ registration: {
      schoolName: registration.schoolName,
      registrationStatus: registration.registrationStatus,
      administratorSchoolEmail: registration.administratorSchoolEmail || null,
      notificationEmailMasked: maskNotificationEmail(registration.notificationEmail),
      submittedAt: registration.submittedAt,
      approvedAt: registration.approvedAt,
      rejectedAt: registration.rejectedAt
    } });
  } catch (error) {
    next(error);
  } finally {
    connection?.release();
  }
}

function getRegistrationToken(req) {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!/^[a-f0-9]{64}$/i.test(token)) throw createError('Registration status could not be found.', 404);
  return { token, tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
}

async function getRegistrationDetails(req, res, next) {
  let connection;
  try {
    res.set('Cache-Control', 'no-store');
    const { tokenHash } = getRegistrationToken(req);
    connection = await getDatabase().getConnection();
    const [[school]] = await connection.execute(
      `SELECT schools.id, schools.name, schools.short_name AS shortName,
        schools.school_code AS schoolCode, schools.deped_school_id AS depedSchoolId,
        schools.address_line AS addressLine, schools.phone, schools.email, schools.website,
        schools.school_email_domain AS schoolEmailDomain,
        schools.registration_status AS registrationStatus,
        school_settings.notification_email AS notificationEmail,
        school_settings.current_school_year_label AS currentSchoolYearLabel
      FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id
      WHERE schools.registration_status_token_hash = ?
        AND schools.registration_status_token_expires_at > NOW()
      LIMIT 1`,
      [tokenHash]
    );
    if (!school) throw createError('Registration details could not be found.', 404);
    if (school.registrationStatus !== 'rejected') throw createError('Only rejected registrations can be revised.', 409);

    const [[administrator]] = await connection.execute(
      `SELECT first_name AS firstName, last_name AS lastName, school_email AS schoolEmail
      FROM users WHERE school_id = ? AND role = 'school_admin' ORDER BY id LIMIT 1`,
      [school.id]
    );
    if (!administrator) throw createError('The registration administrator could not be found.', 409);
    const [levels] = await connection.execute(
      `SELECT level_code AS schoolLevel, grading_period_type AS storedPeriodType
      FROM school_levels WHERE school_id = ? AND is_enabled = TRUE ORDER BY id`,
      [school.id]
    );
    const [periods] = await connection.execute(
      `SELECT school_levels.level_code AS schoolLevel, academic_terms.name,
        academic_terms.sequence_number AS sequenceNumber,
        DATE_FORMAT(academic_terms.planned_start_date, '%Y-%m-%d') AS plannedStartDate,
        DATE_FORMAT(academic_terms.planned_end_date, '%Y-%m-%d') AS plannedEndDate
      FROM academic_terms
      INNER JOIN academic_years ON academic_years.id = academic_terms.academic_year_id
      INNER JOIN school_levels ON school_levels.id = academic_terms.school_level_id
      WHERE academic_years.school_id = ? AND academic_years.label = ?
        AND school_levels.is_enabled = TRUE
      ORDER BY school_levels.id, academic_terms.sequence_number`,
      [school.id, school.currentSchoolYearLabel]
    );
    const academicTermConfigs = levels.map(level => ({
      schoolLevel: level.schoolLevel,
      gradingPeriodType: ({ quarterly: 'quarterly', trimestral: 'three_term', semestral: 'semester' })[level.storedPeriodType] || 'quarterly',
      academicPeriods: periods.filter(period => period.schoolLevel === level.schoolLevel).map(period => ({
        name: period.name,
        plannedStartDate: period.plannedStartDate,
        plannedEndDate: period.plannedEndDate
      }))
    }));
    const [[yearDates]] = await connection.execute(
      `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS schoolYearStartDate,
        DATE_FORMAT(end_date, '%Y-%m-%d') AS schoolYearEndDate
      FROM academic_years WHERE school_id = ? AND label = ? LIMIT 1`,
      [school.id, school.currentSchoolYearLabel]
    );
    res.json({ application: {
      school: {
        name: school.name, shortName: school.shortName, schoolCode: school.schoolCode,
        depedSchoolId: school.depedSchoolId, addressLine: school.addressLine,
        phone: school.phone, email: school.email, website: school.website,
        schoolEmailDomain: school.schoolEmailDomain
      },
      notificationEmail: school.notificationEmail,
      initialAdministrator: { firstName: administrator.firstName, lastName: administrator.lastName },
      administratorSchoolEmail: administrator.schoolEmail,
      schoolLevels: levels.map(level => level.schoolLevel),
      currentSchoolYearLabel: school.currentSchoolYearLabel,
      schoolYearStartDate: yearDates?.schoolYearStartDate || null,
      schoolYearEndDate: yearDates?.schoolYearEndDate || null,
      academicTermConfigs
    } });
  } catch (error) {
    next(error);
  } finally {
    connection?.release();
  }
}

async function resubmitSchoolRegistration(req, res, next) {
  let connection;
  let logoName;
  let committed = false;
  try {
    res.set('Cache-Control', 'no-store');
    let body = req.body || {};
    if (body.payload) {
      try { body = JSON.parse(body.payload); } catch { throw createError('The registration details are invalid.'); }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError('The registration details are invalid.');
    const token = typeof body.registrationStatusToken === 'string' ? body.registrationStatusToken.trim() : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) throw createError('Registration status could not be found.', 404);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const name = text(body.name, 255, true);
    const schoolEmail = email(body.email, true);
    const notificationEmail = email(body.notificationEmail, true);
    const initialAdministrator = body.initialAdministrator || {};
    const adminFirstName = text(initialAdministrator.firstName, 100, true);
    const adminLastName = text(initialAdministrator.lastName, 100, true);
    const temporaryPassword = String(initialAdministrator.temporaryPassword || '');
    if (temporaryPassword.length < 12 || temporaryPassword.length > 128) throw createError('The administrator temporary password must contain 12 to 128 characters.');
    const levels = normalizeLevels(body.schoolLevels);
    const schoolYear = text(body.currentSchoolYearLabel, 30, true);
    const termConfigs = registrationTerms(body, levels);
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    logoName = await saveSchoolLogo(req.file);
    const registrationStatusToken = crypto.randomBytes(32).toString('hex');
    const registrationStatusTokenHash = crypto.createHash('sha256').update(registrationStatusToken).digest('hex');

    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute(
      `SELECT schools.id, schools.name, schools.school_email_domain AS schoolEmailDomain,
        schools.registration_status AS registrationStatus, schools.rejection_reason AS rejectionReason,
        schools.logo_path AS logoPath,
        school_settings.current_school_year_label AS currentSchoolYearLabel
      FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id
      WHERE schools.registration_status_token_hash = ?
        AND schools.registration_status_token_expires_at > NOW()
      LIMIT 1 FOR UPDATE`,
      [tokenHash]
    );
    if (!school) throw createError('Registration status could not be found.', 404);
    if (school.registrationStatus !== 'rejected') throw createError('Only rejected registrations can be resubmitted.', 409);
    const [[administrator]] = await connection.execute(
      `SELECT id, school_email AS schoolEmail FROM users
      WHERE school_id = ? AND role = 'school_admin' ORDER BY id LIMIT 1 FOR UPDATE`,
      [school.id]
    );
    if (!administrator) throw createError('The registration administrator could not be found.', 409);

    const [[year]] = await connection.execute(
      `SELECT id FROM academic_years
      WHERE school_id = ? AND label = ? LIMIT 1 FOR UPDATE`,
      [school.id, school.currentSchoolYearLabel]
    );
    let academicYearId = year?.id;
    const today = new Date().toISOString().slice(0, 10);
    const yearStatus = body.schoolYearStartDate <= today && today <= body.schoolYearEndDate ? 'active' : 'upcoming';
    if (academicYearId) {
      await connection.execute(
        'UPDATE academic_years SET label = ?, start_date = ?, end_date = ?, status = ? WHERE id = ? AND school_id = ?',
        [schoolYear, body.schoolYearStartDate, body.schoolYearEndDate, yearStatus, academicYearId, school.id]
      );
    } else {
      const [yearResult] = await connection.execute(
        'INSERT INTO academic_years (school_id, label, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)',
        [school.id, schoolYear, body.schoolYearStartDate, body.schoolYearEndDate, yearStatus]
      );
      academicYearId = yearResult.insertId;
    }

    const levelIds = {};
    for (const code of levels) {
      const definition = LEVEL_DEFAULTS[code];
      const config = termConfigs.find(item => item.schoolLevel === code);
      const periodType = { quarterly: 'quarterly', three_term: 'trimestral', semester: 'semestral' }[config.gradingPeriodType];
      await connection.execute(
        `INSERT INTO school_levels (school_id, level_code, display_name, grading_period_type, is_enabled)
        VALUES (?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), grading_period_type = VALUES(grading_period_type), is_enabled = TRUE`,
        [school.id, code, definition.displayName, periodType]
      );
      const [[level]] = await connection.execute(
        'SELECT id FROM school_levels WHERE school_id = ? AND level_code = ? FOR UPDATE',
        [school.id, code]
      );
      for (const gradeCode of definition.grades) {
        const sortOrder = gradeCode === 'kindergarten' ? 0 : Number(gradeCode.replace('grade-', ''));
        await connection.execute(
          `INSERT INTO school_grade_levels (school_id, school_level_id, grade_code, display_name, sort_order, is_enabled)
          VALUES (?, ?, ?, ?, ?, TRUE)
          ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), sort_order = VALUES(sort_order), is_enabled = TRUE`,
          [school.id, level.id, gradeCode, gradeLabel(gradeCode), sortOrder]
        );
      }
      if (code === 'shs') {
        for (const trackCode of TRACK_DEFAULTS) {
          await connection.execute(
            `INSERT INTO school_shs_tracks (school_id, school_level_id, track_code, display_name, is_enabled)
            VALUES (?, ?, ?, ?, TRUE)
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), is_enabled = TRUE`,
            [school.id, level.id, trackCode, trackLabel(trackCode)]
          );
        }
      }
      const [storedTerms] = await connection.execute(
        'SELECT id, sequence_number AS sequenceNumber FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ? FOR UPDATE',
        [school.id, academicYearId, level.id]
      );
      for (const [index, period] of config.academicPeriods.entries()) {
        const sequenceNumber = index + 1;
        const existingTerm = storedTerms.find(term => Number(term.sequenceNumber) === sequenceNumber);
        if (existingTerm) {
          await connection.execute(
            `UPDATE academic_terms SET name = ?, planned_start_date = ?, planned_end_date = ?,
              status = 'upcoming', activated_at = NULL, completed_at = NULL WHERE id = ?`,
            [text(period.name, 80, true), period.plannedStartDate, period.plannedEndDate, existingTerm.id]
          );
        } else {
          await connection.execute(
            `INSERT INTO academic_terms (school_id, academic_year_id, school_level_id, name, sequence_number, planned_start_date, planned_end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [school.id, academicYearId, level.id, text(period.name, 80, true), sequenceNumber, period.plannedStartDate, period.plannedEndDate]
          );
        }
      }
      for (const oldTerm of storedTerms.filter(term => Number(term.sequenceNumber) > config.academicPeriods.length)) {
        await connection.execute('DELETE FROM academic_terms WHERE id = ?', [oldTerm.id]);
      }
    }
    for (const code of Object.keys(LEVEL_DEFAULTS)) {
      if (!levels.includes(code)) {
        await connection.execute('UPDATE school_levels SET is_enabled = FALSE WHERE school_id = ? AND level_code = ?', [school.id, code]);
      }
    }
    await connection.execute(
      'UPDATE schools SET name = ?, short_name = ?, school_type = ?, deped_school_id = ?, address_line = ?, phone = ?, email = ?, website = ?, logo_path = COALESCE(?, logo_path) WHERE id = ?',
      [name, text(body.shortName, 120) || name.toUpperCase(), schoolTypeForLevels(levels),
        text(body.depedSchoolId, 50), text(body.addressLine, 255), text(body.phone, 30),
        schoolEmail, text(body.website, 255), logoName, school.id]
    );
    await connection.execute(
      'UPDATE school_settings SET notification_email = ?, current_school_year_label = ? WHERE school_id = ?',
      [notificationEmail, schoolYear, school.id]
    );
    const displayName = adminFirstName + ' ' + adminLastName;
    await connection.execute(
      `UPDATE users SET first_name = ?, last_name = ?, display_name = ?, initials = ?,
        personal_email = ?, password_hash = ?, account_status = 'pending'
      WHERE id = ? AND school_id = ? AND role = 'school_admin'`,
      [adminFirstName, adminLastName, displayName, (adminFirstName[0] + adminLastName[0]).toUpperCase(),
        notificationEmail, passwordHash, administrator.id, school.id]
    );
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
      VALUES (?, NULL, 'school_registration_resubmitted', 'school', ?, ?)`,
      [school.id, school.id, JSON.stringify({ summary: name + ' registration resubmitted',
        schoolName: name, source: 'school_record', previousRejectionReason: school.rejectionReason || null })]
    );
    const [statusUpdate] = await connection.execute(
      `UPDATE schools SET registration_status = 'pending', approved_at = NULL,
        rejected_at = NULL, rejection_reason = NULL, submitted_at = NOW(),
        registration_status_token_hash = ?, registration_status_token_expires_at = DATE_ADD(NOW(), INTERVAL 90 DAY)
      WHERE id = ? AND registration_status = 'rejected' AND registration_status_token_hash = ?
        AND registration_status_token_expires_at > NOW()`,
      [registrationStatusTokenHash, school.id, tokenHash]
    );
    if (statusUpdate.affectedRows !== 1) throw createError('Only rejected registrations can be resubmitted.', 409);
    const [platformAdmins] = await connection.execute(
      `SELECT id, display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail
      FROM users WHERE role = 'platform_admin' AND account_status = 'active'`
    );
    for (const user of platformAdmins) {
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, target_path)
        VALUES (?, 'school_account', 'School registration resubmitted', ?, ?)`,
        [user.id, name + ' revised and resubmitted its registration.', '/views/platform/edugnay-platform-school-accounts.html']
      );
    }
    await connection.commit();
    committed = true;
    if (logoName && /^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(school.logoPath || '')) {
      await fs.unlink(path.join(logoDirectory, school.logoPath)).catch(() => {});
    }
    platformAdmins.forEach(user => { sendSchoolRegistrationSubmittedEmail(user, { name }).catch(console.error); });
    res.status(200).json({
      school: {
        id: school.id, name, schoolEmailDomain: school.schoolEmailDomain,
        administratorSchoolEmail: administrator.schoolEmail, registrationStatus: 'pending',
        notificationEmail
      },
      registrationStatusToken
    });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    if (logoName && !committed) await fs.unlink(path.join(logoDirectory, logoName)).catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') error = createError('A school registration field conflicts with an existing record.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

async function reviewSchool(req, res, next) {
  let connection;
  let committed = false;
  try {
    const schoolId = parseId(req.params.schoolId);
    if (!schoolId) throw createError('Invalid school ID.');
    const approved = req.params.action === 'approve';
    const reason = text(req.body?.reason, 1000) || null;
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute(
      'SELECT schools.id, schools.name, schools.registration_status AS registrationStatus, school_settings.notification_email AS notificationEmail FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id WHERE schools.id = ? FOR UPDATE',
      [schoolId]
    );
    if (!school) throw createError('School not found.', 404);
    if (school.registrationStatus !== 'pending') throw createError('Only pending school registrations can be reviewed.', 409);
    await connection.execute(
      `UPDATE schools SET registration_status = ?, approved_at = ${approved ? 'NOW()' : 'NULL'}, rejected_at = ${approved ? 'NULL' : 'NOW()'}, rejection_reason = ? WHERE id = ?`,
      [approved ? 'active' : 'rejected', approved ? null : reason, schoolId]
    );
    await connection.execute('UPDATE users SET account_status = ? WHERE school_id = ? AND role = \'school_admin\' AND account_status = \'pending\'', [approved ? 'active' : 'inactive', schoolId]);
    await writeAuditLog(connection, req, approved ? 'school_registration_approved' : 'school_registration_rejected', 'school', schoolId, {
      summary: school.name
    }, schoolId);
    const [administrators] = await connection.execute(`SELECT id, display_name AS displayName, school_email AS schoolEmail, personal_email AS personalEmail FROM users WHERE school_id = ? AND role = 'school_admin'`, [schoolId]);
    for (const user of administrators) {
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, target_path) VALUES (?, 'school_account', ?, ?, ?)`,
        [user.id, approved ? 'School account approved' : 'School account rejected',
          approved ? `${school.name} is ready for your school community.` : `${school.name} registration was rejected.`,
          '/views/admin/edugnay-admin-dashboard.html']
      );
    }
    const administrator = administrators[0];
    await connection.execute(
      'INSERT INTO school_registration_email_outbox (school_id, decision, recipient_email, school_name, administrator_name, administrator_login, rejection_reason, status) VALUES (?, ?, ?, ?, ?, ?, ?, \'pending\')',
      [schoolId, approved ? 'approved' : 'rejected', school.notificationEmail || null, school.name,
        administrator?.displayName || 'School administrator', administrator?.schoolEmail || null,
        approved ? null : reason]
    );
    await connection.commit();
    committed = true;
    wakeSchoolRegistrationEmailWorker();
    res.status(200).json({ school: { id: schoolId, name: school.name,
      registrationStatus: approved ? 'active' : 'rejected', rejectionReason: approved ? null : reason },
      emailDelivery: { status: 'pending', recipientEmail: school.notificationEmail || null, attempts: 0 } });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

async function retrySchoolRegistrationEmail(req, res, next) {
  let connection;
  try {
    const schoolId = parseId(req.params.schoolId);
    if (!schoolId) throw createError('Invalid school ID.');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[emailJob]] = await connection.execute(
      'SELECT id, status FROM school_registration_email_outbox WHERE school_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [schoolId]
    );
    if (!emailJob) throw createError('No school account email was found.', 404);
    if (emailJob.status !== 'failed') throw createError('Only failed school account emails can be retried.', 409);
    await connection.execute(
      'UPDATE school_registration_email_outbox SET status = \'pending\', manual_retries = manual_retries + 1, next_attempt_at = NOW(), last_error = NULL, smtp_message_id = NULL, smtp_response = NULL, claim_token = NULL, claimed_at = NULL WHERE id = ?',
      [emailJob.id]
    );
    await connection.commit();
    wakeSchoolRegistrationEmailWorker();
    res.json({ emailDelivery: { status: 'pending', attempts: 0 } });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

async function getSchoolSettings(req, res, next) {
  try {
    const school = await getSchoolRecord(getDatabase(), requireSchoolAdminSchool(req));
    if (!school) throw createError('School not found.', 404);
    res.status(200).json({ school });
  } catch (error) { next(error); }
}

async function getSchoolLogo(req, res, next) {
  try {
    const schoolId = req.params.schoolId ? parseId(req.params.schoolId) : req.user.schoolId;
    if (!schoolId || (req.user.role !== 'platform_admin' && Number(req.user.schoolId) !== schoolId)) {
      throw createError('You do not have access to this school logo.', 403);
    }
    const school = await getSchoolRecord(getDatabase(), schoolId);
    if (!school?.logoUrl) throw createError('School logo not found.', 404);
    const filePath = path.join(logoDirectory, school.logoPath);
    let image;
    try {
      image = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw createError('School logo not found.', 404);
      throw error;
    }
    const extension = path.extname(school.logoPath).toLowerCase();
    const contentType = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    }[extension];
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    res.status(200).send(image);
  } catch (error) { next(error); }
}

async function updateSchoolLogo(req, res, next) {
  let logoName;
  let connection;
  let committed = false;
  try {
    const schoolId = requireSchoolAdminSchool(req);
    if (!req.file) throw createError('Choose a school logo.');
    logoName = await saveSchoolLogo(req.file);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute('SELECT logo_path AS logoPath FROM schools WHERE id = ? FOR UPDATE', [schoolId]);
    if (!school) throw createError('School not found.', 404);
    await connection.execute('UPDATE schools SET logo_path = ? WHERE id = ?', [logoName, schoolId]);
    await writeAuditLog(connection, req, 'school_logo_updated', 'school', schoolId, { summary: 'School logo' });
    const updatedSchool = await getSchoolRecord(connection, schoolId);
    await connection.commit();
    committed = true;
    if (/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(school.logoPath || '')) {
      await fs.unlink(path.join(logoDirectory, school.logoPath)).catch(() => {});
    }
    res.json({ school: updatedSchool });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    if (logoName && !committed) await fs.unlink(path.join(logoDirectory, logoName)).catch(() => {});
    next(error);
  } finally { connection?.release(); }
}

async function changeSchoolAccess(req, res, next) {
  let connection;
  let committed = false;
  try {
    const schoolId = parseId(req.params.schoolId);
    if (!schoolId) throw createError('Invalid school ID.');
    const suspending = req.params.action === 'suspend';
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute(
      `SELECT schools.id, schools.name, schools.registration_status AS status,
        school_settings.notification_email AS notificationEmail
      FROM schools LEFT JOIN school_settings ON school_settings.school_id = schools.id
      WHERE schools.id = ? FOR UPDATE`,
      [schoolId]
    );
    if (!school) throw createError('School not found.', 404);
    if (school.status !== (suspending ? 'active' : 'suspended')) {
      throw createError(`Only ${suspending ? 'active' : 'suspended'} schools can be ${suspending ? 'suspended' : 'reactivated'}.`, 409);
    }
    await connection.execute('UPDATE schools SET registration_status = ? WHERE id = ?', [suspending ? 'suspended' : 'active', schoolId]);
    await writeAuditLog(connection, req, suspending ? 'school_suspended' : 'school_reactivated', 'school', schoolId, { summary: school.name }, schoolId);
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, target_path)
       SELECT id, 'school_account', ?, ?, '/views/admin/edugnay-admin-dashboard.html'
       FROM users WHERE school_id = ? AND role = 'school_admin'`,
      [suspending ? 'School account suspended' : 'School account reactivated',
        `${school.name} has been ${suspending ? 'suspended' : 'reactivated'} by the platform administrator.`, schoolId]
    );
    const [[administrator]] = await connection.execute(
      `SELECT display_name AS displayName, school_email AS schoolEmail
      FROM users WHERE school_id = ? AND role = 'school_admin' ORDER BY id LIMIT 1`,
      [schoolId]
    );
    const accessEvent = suspending ? 'suspended' : 'reactivated';
    await connection.execute(
      `INSERT INTO school_registration_email_outbox
        (school_id, decision, recipient_email, school_name, administrator_name, administrator_login, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [schoolId, accessEvent, school.notificationEmail || null, school.name,
        administrator?.displayName || 'School administrator', administrator?.schoolEmail || null]
    );
    await connection.commit();
    committed = true;
    wakeSchoolRegistrationEmailWorker();
    res.json({ school: { id: schoolId, name: school.name,
      registrationStatus: suspending ? 'suspended' : 'active' },
      emailDelivery: { status: 'pending', recipientEmail: school.notificationEmail || null, attempts: 0 } });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    next(error);
  } finally { connection?.release(); }
}

async function deletePlatformSchool(req, res, next) {
  let connection;
  let committed = false;
  try {
    const schoolId = /^[1-9]\d*$/.test(String(req.params.schoolId || '')) ? parseId(req.params.schoolId) : null;
    if (!schoolId) throw createError('Invalid school ID.');
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const [[school]] = await connection.execute(
      'SELECT id, name, logo_path AS logoPath, registration_status AS status FROM schools WHERE id = ? FOR UPDATE',
      [schoolId]
    );
    if (!school) throw createError('School not found.', 404);
    if (!['rejected', 'suspended'].includes(school.status)) {
      throw createError('Only rejected or suspended schools can be deleted.', 409);
    }
    const [users] = await connection.execute('SELECT id, role, avatar_filename AS avatarFilename FROM users WHERE school_id = ? FOR UPDATE', [schoolId]);
    if (users.length !== 1 || users[0].role !== 'school_admin') {
      throw createError('This school has additional accounts or no initial administrator and cannot be deleted.', 409);
    }
    const [[yearCount]] = await connection.execute('SELECT COUNT(*) AS total FROM academic_years WHERE school_id = ?', [schoolId]);
    if (Number(yearCount.total) !== 1) throw createError('This school has additional academic years and cannot be deleted.', 409);
    for (const table of SCHOOL_ACTIVITY_TABLES) {
      const [[record]] = await connection.execute(`SELECT 1 AS found FROM ${table} WHERE school_id = ? LIMIT 1`, [schoolId]);
      if (record) throw createError('This school has accounts or academic records and cannot be permanently deleted. Keep it rejected or suspended.', 409);
    }
    const [[task]] = await connection.execute('SELECT 1 AS found FROM user_tasks WHERE user_id = ? LIMIT 1', [users[0].id]);
    if (task) throw createError('This school has account activity and cannot be permanently deleted.', 409);
    const [[publishedTemplate]] = await connection.execute('SELECT 1 AS found FROM school_form_templates WHERE published_by_user_id = ? LIMIT 1', [users[0].id]);
    if (publishedTemplate) throw createError('This school administrator has published forms and cannot be permanently deleted.', 409);
    const [[queuedEmail]] = await connection.execute(
      "SELECT id FROM school_registration_email_outbox WHERE school_id = ? AND status IN ('pending', 'sending') LIMIT 1 FOR UPDATE", [schoolId]
    );
    if (queuedEmail) throw createError('A school account email is still queued or sending. Try deleting the school after delivery finishes.', 409);

    await connection.execute('DELETE FROM school_registration_email_outbox WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM audit_logs WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM academic_terms WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM academic_years WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM school_shs_tracks WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM school_grade_levels WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM school_levels WHERE school_id = ?', [schoolId]);
    await connection.execute('DELETE FROM users WHERE id = ? AND school_id = ?', [users[0].id, schoolId]);
    await connection.execute('DELETE FROM schools WHERE id = ?', [schoolId]);
    await writeAuditLog(connection, req, 'school_deleted', 'school', schoolId,
      { summary: school.name, formerSchoolId: schoolId }, null);
    await connection.commit();
    committed = true;
    let fileCleanupFailed = false;
    if (getSchoolLogoUrl({ id: schoolId, logoPath: school.logoPath })) {
      try { await fs.unlink(path.join(logoDirectory, school.logoPath)); }
      catch (error) {
        if (error.code !== 'ENOENT') {
          fileCleanupFailed = true;
          console.error('Deleted school logo cleanup failed', { schoolId, code: error.code });
        }
      }
    }
    if (users[0].avatarFilename) {
      try { await deleteAvatar(users[0].avatarFilename); }
      catch (error) {
        fileCleanupFailed = true;
        console.error('Deleted school administrator avatar cleanup failed', { schoolId, code: error.code });
      }
    }
    res.status(200).json({ deletedSchoolId: schoolId, fileCleanupFailed });
  } catch (error) {
    if (connection && !committed) await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      error = createError('This school has protected records and cannot be permanently deleted. Keep it rejected or suspended.', 409);
    }
    next(error);
  } finally { connection?.release(); }
}

async function updateSchoolSettings(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    const schoolId = requireSchoolAdminSchool(req);
    const body = req.body || {};
    const allowed = ['name', 'shortName', 'depedSchoolId', 'regionName', 'divisionName', 'districtName', 'addressLine', 'phone', 'email', 'website', 'notificationEmail', 'currentSchoolYearLabel'];
    const unknown = Object.keys(body).find(field => !allowed.includes(field));
    if (unknown || !Object.keys(body).length) throw createError('Provide valid school settings.');
    const database = getDatabase();
    connection = await database.getConnection();
    const school = await getSchoolRecord(connection, schoolId);
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await connection.beginTransaction();
        transactionStarted = true;
        await connection.execute(`UPDATE schools SET name=?, short_name=?, deped_school_id=?, region_name=?, division_name=?, district_name=?, address_line=?, phone=?, email=?, website=? WHERE id=?`, [values.name, values.shortName, values.depedSchoolId, values.regionName, values.divisionName, values.districtName, values.addressLine, values.phone, values.email, values.website, schoolId]);
        await connection.execute(`UPDATE school_settings SET notification_email=?, current_school_year_label=? WHERE school_id=?`, [values.notificationEmail, values.currentSchoolYearLabel, schoolId]);
        await writeAuditLog(connection, req, 'school_settings_updated', 'school', schoolId, { summary: 'School identity and contact details' });
        await connection.commit();
        transactionStarted = false;
        break;
      } catch (error) {
        if (transactionStarted) { try { await connection.rollback(); } catch {} }
        transactionStarted = false;
        if (error.code !== 'ER_LOCK_DEADLOCK' || attempt === 1) throw error;
      }
    }
    res.status(200).json({ school: await getSchoolRecord(database, schoolId) });
  } catch (error) { if (transactionStarted) { try { await connection.rollback(); } catch {} } if (error.code === 'ER_DUP_ENTRY') error = createError('That DepEd school ID is already assigned.', 409); next(error); } finally { connection?.release(); }
}

async function getPortalFeatures(req, res, next) {
  try {
    const schoolId = requireAuthenticatedSchool(req);
    const database = getDatabase();
    const [[settings]] = await database.execute(
      'SELECT journal_subject_id AS journalSubjectId FROM school_settings WHERE school_id = ?', [schoolId]
    );
    const journalSubject = await getJournalSubjectEligibility(database, schoolId, settings?.journalSubjectId);
    const studentJournalEligible = req.user.role === 'student'
      ? journalSubject.eligible && await studentCanAccessJournal(database, schoolId, req.user.id)
      : journalSubject.eligible;
    const electivesEligible = req.user.role === 'student' && process.env.SHS_SELECTION_ENABLED === 'true'
      ? !getStudentShsPlacementIssue(await findStudentShsPlacementRows(database, schoolId, req.user.id))
      : false;
    res.status(200).json({
      features: await getFeatures(database, schoolId),
      journalSubjectId: settings?.journalSubjectId || null,
      journalSubjectName: journalSubject.subject?.name || null,
      journalSubjectEligible: studentJournalEligible,
      electivesEligible
    });
  } catch (error) { next(error); }
}

async function updatePortalFeatures(req, res, next) {
  let connection;
  let transactionStarted = false;
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).find(field => !FEATURE_FIELDS.includes(field) &&
      !['journalSubjectId', 'weekStartDay', 'weekEndDay', 'aiEvidenceApproved'].includes(field));
    if (unknown || !Object.keys(body).length) throw createError('Provide valid portal feature settings.');
    if (Object.hasOwn(body, 'aiEvidenceApproved') && typeof body.aiEvidenceApproved !== 'boolean') {
      throw createError('AI evidence approval must be enabled or disabled.');
    }
    const hasWeekStart = Object.hasOwn(body, 'weekStartDay');
    const hasWeekEnd = Object.hasOwn(body, 'weekEndDay');
    if (hasWeekStart !== hasWeekEnd) throw createError('Provide both report week weekdays together.');
    const requestedWeekSettings = hasWeekStart
      ? normalizeWeekSettings({ weekStartDay: body.weekStartDay, weekEndDay: body.weekEndDay })
      : null;
    const schoolId = requireSchoolAdminSchool(req);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    await connection.execute(
      'INSERT INTO school_portal_features (school_id) VALUES (?) ON DUPLICATE KEY UPDATE school_id = school_portal_features.school_id',
      [schoolId]
    );
    const current = await getFeatures(connection, schoolId);
    const [[settings]] = await connection.execute(`SELECT journal_subject_id AS journalSubjectId,
      narrative_report_week_start_day AS weekStartDay,
      narrative_report_week_end_day AS weekEndDay
      FROM school_settings WHERE school_id = ? FOR UPDATE`, [schoolId]);
    if (!settings) throw createError('School settings were not found.', 404);
    FEATURE_FIELDS.forEach(field => { if (Object.hasOwn(body, field)) current[field] = boolean(body[field]); });
    current.attendanceEnabled = true;
    const journalSubjectId = Object.hasOwn(body, 'journalSubjectId')
      ? body.journalSubjectId === null ? null : /^\d+$/.test(String(body.journalSubjectId)) ? parseId(body.journalSubjectId) : null
      : settings.journalSubjectId;
    const selectionChanged = Number(journalSubjectId || 0) !== Number(settings.journalSubjectId || 0);
    const reportWeekSettings = requestedWeekSettings || {
      weekStartDay: Number(settings.weekStartDay) || DEFAULT_WEEK.weekStartDay,
      weekEndDay: Number(settings.weekEndDay) || DEFAULT_WEEK.weekEndDay
    };
    if (Object.hasOwn(body, 'journalSubjectId') && body.journalSubjectId !== null && !journalSubjectId) throw createError('Select a valid journal subject.');
    if (current.journalsEnabled && !journalSubjectId) throw createError('Select a journal subject before enabling Journals.');
    const journalSubjectStatus = await getJournalSubjectEligibility(connection, schoolId, journalSubjectId);
    if (journalSubjectId && (current.journalsEnabled || selectionChanged)) {
      if (!journalSubjectStatus.subject) throw createError('Select an active subject from this school.');
      if (!journalSubjectStatus.eligible) throw createError('Choose an active subject scoped only to this school’s enabled JHS grades.');
      await connection.execute(`INSERT INTO journal_subjects (school_id, subject_id, name, is_active)
        VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE`, [schoolId, journalSubjectId, journalSubjectStatus.subject.name]);
    }
    await connection.execute(`UPDATE school_portal_features SET grades_enabled=?, narrative_reports_enabled=?, journals_enabled=?, attendance_enabled=?, sf_templates_enabled=? WHERE school_id=?`, [current.gradesEnabled, current.narrativeReportsEnabled, current.journalsEnabled, current.attendanceEnabled, current.sfTemplatesEnabled, schoolId]);
    if (Object.hasOwn(body, 'aiEvidenceApproved') && body.aiEvidenceApproved !== current.aiEvidenceApproved) {
      await connection.execute(
        `UPDATE school_portal_features SET ai_evidence_approved_at = ?,
          ai_evidence_approved_by_user_id = ? WHERE school_id = ?`,
        [body.aiEvidenceApproved ? new Date() : null, body.aiEvidenceApproved ? Number(req.user.id) : null, schoolId]
      );
      await writeAuditLog(connection, req,
        body.aiEvidenceApproved ? 'ai_report_evidence_approved' : 'ai_report_evidence_approval_revoked',
        'school_portal_features', schoolId, { summary: 'AI report evidence sharing' });
      current.aiEvidenceApproved = body.aiEvidenceApproved;
      current.aiEvidenceApprovedAt = body.aiEvidenceApproved ? new Date() : null;
    }
    await connection.execute(`UPDATE school_settings SET journal_subject_id = ?,
      narrative_report_week_start_day = ?, narrative_report_week_end_day = ? WHERE school_id = ?`,
    [journalSubjectId, reportWeekSettings.weekStartDay, reportWeekSettings.weekEndDay, schoolId]);
    await writeAuditLog(connection, req, 'portal_features_updated', 'school_portal_features', schoolId, { summary: 'School portal features' });
    if (requestedWeekSettings &&
      (requestedWeekSettings.weekStartDay !== Number(settings.weekStartDay) || requestedWeekSettings.weekEndDay !== Number(settings.weekEndDay))) {
      await writeAuditLog(connection, req, 'narrative_report_week_updated', 'school_settings', schoolId, {
        summary: 'Narrative report week updated', ...reportWeekSettings
      });
    }
    await connection.commit();
    transactionStarted = false;
    res.status(200).json({ features: current, journalSubjectId, journalSubjectEligible: journalSubjectStatus.eligible, reportWeekSettings });
  } catch (error) { if (transactionStarted) { try { await connection.rollback(); } catch {} } next(error); } finally { connection?.release(); }
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
          await connection.execute(`INSERT INTO school_grade_levels (school_id, school_level_id, grade_code, display_name, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order), is_enabled=VALUES(is_enabled)`, [schoolId, storedLevel.id, grade.gradeCode, text(grade.displayName, 80) || gradeLabel(grade.gradeCode), Number(grade.sortOrder) || (grade.gradeCode === 'kindergarten' ? 0 : Number(grade.gradeCode.replace('grade-', ''))), boolean(grade.isEnabled)]);
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
        if (level.tracks.some(track => track?.strands?.length || track?.strandCode || track?.strandId)) {
          throw createError('SHS strands are not part of the Strengthened SHS curriculum.');
        }
        for (const track of level.tracks) {
          await connection.execute(`INSERT INTO school_shs_tracks (school_id, school_level_id, track_code, display_name, is_enabled) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), is_enabled=VALUES(is_enabled)`, [schoolId, storedLevel.id, track.trackCode, text(track.displayName, 120) || trackLabel(track.trackCode), boolean(track.isEnabled)]);
        }
        if (trackCodes.length) {
          await connection.execute(`UPDATE school_shs_tracks SET is_enabled = FALSE WHERE school_level_id = ? AND track_code NOT IN (${trackCodes.map(() => '?').join(', ')})`, [storedLevel.id, ...trackCodes]);
        } else {
          await connection.execute('UPDATE school_shs_tracks SET is_enabled = FALSE WHERE school_level_id = ?', [storedLevel.id]);
        }
      }
    }
    await connection.execute('UPDATE schools SET school_type = ? WHERE id = ?', [schoolTypeForLevels(codes), schoolId]);
    await connection.execute(`UPDATE school_levels SET is_enabled = FALSE WHERE school_id = ? AND level_code NOT IN (${codes.map(() => '?').join(', ')})`, [schoolId, ...codes]);
    await writeAuditLog(connection, req, 'academic_structure_updated', 'school_levels', schoolId, { summary: 'School levels, grade levels, and tracks' });
    await connection.commit();
    res.status(200).json({ levels: await getStructure(getDatabase(), schoolId) });
  } catch (error) { if (connection) await connection.rollback(); next(error); } finally { connection?.release(); }
}

module.exports = { changeSchoolAccess, deletePlatformSchool, getAcademicStructure, getPlatformSchool, getPortalFeatures, getRegistrationDetails, getRegistrationStatus, getSchoolLogo, getSchoolSettings, listPlatformSchools, registerSchool, resubmitSchoolRegistration, retrySchoolRegistrationEmail, reviewSchool, updateAcademicStructure, updatePortalFeatures, updateSchoolLogo, updateSchoolSettings };
