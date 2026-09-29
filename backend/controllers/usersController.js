const bcrypt = require('bcrypt');
const { randomBytes } = require('crypto');
const { getDatabase } = require('../config/database');
const { sendAccountCreatedEmail, sendAccountStatusEmail } = require('../config/email');
const { deleteSessionsForUser } = require('../config/session');
const { issueStudentQrCredential } = require('../config/qrCredentials');

const USER_ROLES = new Set(['platform_admin', 'school_admin', 'teacher', 'student', 'parent']);
const ACCOUNT_STATUSES = new Set(['active', 'inactive', 'pending']);
const MANAGED_ROLES = new Set(['school_admin', 'teacher', 'student', 'parent']);

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function generateTemporaryPassword() {
  return `Edu-${randomBytes(9).toString('base64url').slice(0, 12)}!`;
}

function parsePositiveInteger(value, fallback, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function getListFilters(query) {
  const role = String(query.role || '').trim();
  const status = String(query.status || '').trim();
  const search = String(query.search || '').trim();

  if (role && !USER_ROLES.has(role)) throw createError('Invalid user role.');
  if (status && !ACCOUNT_STATUSES.has(status)) throw createError('Invalid account status.');
  if (search.length > 80) throw createError('Search text is too long.');

  return {
    role,
    status,
    search,
    page: parsePositiveInteger(query.page, 1, 1000000),
    limit: parsePositiveInteger(query.limit, 25, 100)
  };
}

function getSchoolScope(req, schoolId) {
  if (req.user.role === 'platform_admin') {
    if (!schoolId) return { clause: '', values: [] };

    const parsedSchoolId = parsePositiveInteger(schoolId, null, Number.MAX_SAFE_INTEGER);
    if (!parsedSchoolId) throw createError('Invalid school ID.');
    return { clause: 'users.school_id = ?', values: [parsedSchoolId] };
  }

  return { clause: 'users.school_id = ?', values: [req.user.schoolId] };
}

function userSelect() {
  return `SELECT
    users.id,
    users.school_id AS schoolId,
    users.role,
    users.school_email AS schoolEmail,
    users.personal_email AS personalEmail,
    users.account_status AS accountStatus,
    users.honorific,
    users.first_name AS firstName,
    users.last_name AS lastName,
    users.display_name AS displayName,
    users.initials,
    users.setup_completed_at AS setupCompletedAt,
    users.last_login_at AS lastLoginAt,
    users.created_at AS createdAt,
    school_admin_profiles.employee_number AS schoolAdminEmployeeNumber,
    school_admin_profiles.contact_number AS schoolAdminContactNumber,
    teacher_profiles.employee_number AS teacherEmployeeNumber,
    teacher_profiles.contact_number AS teacherContactNumber,
    student_profiles.lrn,
    student_profiles.middle_name AS studentMiddleName,
    student_profiles.has_no_middle_name AS studentHasNoMiddleName,
    student_profiles.sex AS studentSex,
    DATE_FORMAT(student_profiles.birth_date, '%Y-%m-%d') AS studentBirthDate,
    student_profiles.birth_place_province AS studentBirthPlaceProvince,
    student_profiles.mother_tongue AS studentMotherTongue,
    student_profiles.indigenous_group AS studentIndigenousGroup,
    student_profiles.religion AS studentReligion,
    student_profiles.house_street AS studentHouseStreet,
    student_profiles.barangay AS studentBarangay,
    student_profiles.city_municipality AS studentCityMunicipality,
    student_profiles.province AS studentProvince,
    student_profiles.contact_number AS studentContactNumber,
    parent_profiles.middle_name AS parentMiddleName,
    parent_profiles.maiden_last_name AS parentMaidenLastName,
    parent_profiles.has_no_middle_name AS parentHasNoMiddleName,
    parent_profiles.has_no_maiden_name AS parentHasNoMaidenName,
    parent_profiles.sex AS parentSex,
    parent_profiles.religion AS parentReligion,
    parent_profiles.contact_number AS parentContactNumber,
    parent_profiles.house_street AS parentHouseStreet,
    parent_profiles.barangay AS parentBarangay,
    parent_profiles.city_municipality AS parentCityMunicipality,
    parent_profiles.province AS parentProvince
  FROM users
  LEFT JOIN school_admin_profiles ON school_admin_profiles.user_id = users.id
  LEFT JOIN teacher_profiles ON teacher_profiles.user_id = users.id
  LEFT JOIN student_profiles ON student_profiles.user_id = users.id
  LEFT JOIN parent_profiles ON parent_profiles.user_id = users.id`;
}

function formatUser(row) {
  const user = {
    id: row.id,
    schoolId: row.schoolId,
    role: row.role,
    schoolEmail: row.schoolEmail,
    personalEmail: row.personalEmail,
    accountStatus: row.accountStatus,
    honorific: row.honorific,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    initials: row.initials,
    setupCompletedAt: row.setupCompletedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt
  };

  if (row.role === 'school_admin') {
    user.profile = {
      employeeNumber: row.schoolAdminEmployeeNumber,
      contactNumber: row.schoolAdminContactNumber
    };
  }

  if (row.role === 'teacher') {
    user.profile = {
      employeeNumber: row.teacherEmployeeNumber,
      contactNumber: row.teacherContactNumber
    };
  }

  if (row.role === 'student') {
    user.profile = {
      lrn: row.lrn,
      middleName: row.studentMiddleName,
      hasNoMiddleName: Boolean(row.studentHasNoMiddleName),
      sex: row.studentSex,
      birthDate: row.studentBirthDate,
      birthPlaceProvince: row.studentBirthPlaceProvince,
      motherTongue: row.studentMotherTongue,
      indigenousGroup: row.studentIndigenousGroup,
      religion: row.studentReligion,
      houseStreet: row.studentHouseStreet,
      barangay: row.studentBarangay,
      cityMunicipality: row.studentCityMunicipality,
      province: row.studentProvince,
      contactNumber: row.studentContactNumber
    };
  }

  if (row.role === 'parent') {
    user.profile = {
      middleName: row.parentMiddleName,
      maidenLastName: row.parentMaidenLastName,
      hasNoMiddleName: Boolean(row.parentHasNoMiddleName),
      hasNoMaidenName: Boolean(row.parentHasNoMaidenName),
      sex: row.parentSex,
      religion: row.parentReligion,
      contactNumber: row.parentContactNumber,
      houseStreet: row.parentHouseStreet,
      barangay: row.parentBarangay,
      cityMunicipality: row.parentCityMunicipality,
      province: row.parentProvince
    };
  }

  return user;
}

function normalizeText(value, maximum) {
  if (typeof value !== 'string') throw createError('Profile fields must be text.');

  const text = value.trim();
  if (text.length > maximum) throw createError('A profile field is too long.');
  return text || null;
}

function normalizeBoolean(value) {
  if (typeof value !== 'boolean') throw createError('Profile fields must use true or false.');
  return value;
}

function normalizeDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError('Birth date must use YYYY-MM-DD.');
  }

  return value;
}

function normalizeEmail(value, fieldName) {
  if (typeof value !== 'string') throw createError(`${fieldName} must be text.`);
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    throw createError(`Provide a valid ${fieldName.toLowerCase()}.`);
  }
  return email;
}

function normalizeLrn(value) {
  const lrn = String(value || '').trim();
  if (!/^\d{12}$/.test(lrn)) throw createError('LRN must contain exactly 12 digits.');
  return lrn;
}

function getSetupStatus(user) {
  const fields = user.role === 'student'
    ? ['lrn', 'sex', 'birthDate', 'birthPlaceProvince', 'motherTongue', 'religion', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
    : user.role === 'parent'
      ? ['sex', 'religion', 'contactNumber', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
      : [];
  const missingFields = fields.filter(field => !user.profile?.[field]);
  return { required: fields.length > 0, complete: !missingFields.length, missingFields };
}

function getProfileChanges(role, body) {
  const fields = role === 'school_admin'
    ? { contactNumber: ['contact_number', 30] }
    : role === 'teacher'
    ? { contactNumber: ['contact_number', 30] }
    : role === 'student'
      ? {
        middleName: ['middle_name', 100], hasNoMiddleName: ['has_no_middle_name'], sex: ['sex', 20],
        birthDate: ['birth_date', 10], birthPlaceProvince: ['birth_place_province', 120],
        motherTongue: ['mother_tongue', 120], indigenousGroup: ['indigenous_group', 120], religion: ['religion', 120],
        houseStreet: ['house_street', 255], barangay: ['barangay', 120], cityMunicipality: ['city_municipality', 120],
        province: ['province', 120], contactNumber: ['contact_number', 30]
      }
      : role === 'parent'
        ? {
          middleName: ['middle_name', 100], maidenLastName: ['maiden_last_name', 100],
          hasNoMiddleName: ['has_no_middle_name'], hasNoMaidenName: ['has_no_maiden_name'],
          sex: ['sex', 20], religion: ['religion', 120], contactNumber: ['contact_number', 30],
          houseStreet: ['house_street', 255], barangay: ['barangay', 120],
          cityMunicipality: ['city_municipality', 120], province: ['province', 120]
        }
        : null;

  if (!fields) throw createError('This account does not have editable profile fields.', 403);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError('Profile changes must be an object.');
  }

  const unknownField = Object.keys(body).find(field => !Object.hasOwn(fields, field));
  if (unknownField) throw createError('This profile field cannot be edited.');

  const changes = [];
  Object.entries(fields).forEach(([field, [column, maximum]]) => {
    if (!Object.hasOwn(body, field)) return;

    let value = body[field];
    if (field === 'birthDate') value = normalizeDate(value);
    else if (field.startsWith('hasNo')) value = normalizeBoolean(value);
    else value = normalizeText(value, maximum);

    if (field === 'sex' && value && !['male', 'female'].includes(value)) {
      throw createError('Sex must be male or female.');
    }

    changes.push({ column, value });
  });

  if (!changes.length) throw createError('Provide at least one editable profile field.');
  return changes;
}

async function findUserById(userId, scope) {
  const database = getDatabase();
  const where = ['users.id = ?'];
  const values = [userId];

  if (scope.clause) {
    where.push(scope.clause);
    values.push(...scope.values);
  }

  const [users] = await database.execute(`${userSelect()} WHERE ${where.join(' AND ')} LIMIT 1`, values);
  return users[0] || null;
}

async function listUsers(req, res, next) {
  try {
    const filters = getListFilters(req.query);
    const scope = getSchoolScope(req, req.query.schoolId);
    const where = scope.clause ? [scope.clause] : [];
    const values = [...scope.values];

    if (filters.role) {
      where.push('users.role = ?');
      values.push(filters.role);
    }

    if (filters.status) {
      where.push('users.account_status = ?');
      values.push(filters.status);
    }

    if (filters.search) {
      where.push('(users.first_name LIKE ? OR users.last_name LIKE ? OR users.school_email LIKE ?)');
      const search = `%${filters.search}%`;
      values.push(search, search, search);
    }

    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const database = getDatabase();
    const [[count]] = await database.execute(`SELECT COUNT(*) AS total FROM users${whereSql}`, values);
    const offset = (filters.page - 1) * filters.limit;
    const [users] = await database.execute(
      `${userSelect()}${whereSql} ORDER BY users.last_name, users.first_name LIMIT ? OFFSET ?`,
      [...values, filters.limit, offset]
    );

    res.status(200).json({
      users: users.map(formatUser),
      pagination: { page: filters.page, limit: filters.limit, total: count.total }
    });
  } catch (error) {
    next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const userId = parsePositiveInteger(req.params.userId, null, Number.MAX_SAFE_INTEGER);
    if (!userId) throw createError('Invalid user ID.');

    const isOwnProfile = userId === req.user.id;
    let isLinkedChild = false;
    if (!isOwnProfile && req.user.role === 'parent') {
      const database = getDatabase();
      const [[link]] = await database.execute(
        `SELECT COUNT(*) AS linkCount FROM student_parent_links
        WHERE parent_user_id = ? AND student_user_id = ?
        `,
        [req.user.id, userId]
      );
      isLinkedChild = Number(link.linkCount) > 0;
    }
    if (!isOwnProfile && !isLinkedChild && req.user.role !== 'platform_admin' && req.user.role !== 'school_admin') {
      throw createError('You do not have access to this resource.', 403);
    }

    const scope = isOwnProfile || isLinkedChild || req.user.role === 'platform_admin'
      ? { clause: '', values: [] }
      : { clause: 'users.school_id = ?', values: [req.user.schoolId] };
    const user = await findUserById(userId, scope);
    if (!user) throw createError('User not found.', 404);

    res.status(200).json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
}

async function getMyProfile(req, res, next) {
  try {
    const user = await findUserById(req.user.id, { clause: '', values: [] });
    if (!user) throw createError('User not found.', 404);

    res.status(200).json({ user: formatUser(user) });
  } catch (error) {
    next(error);
  }
}

async function getMyParents(req, res, next) {
  try {
    if (req.user.role !== 'student') throw createError('You do not have access to this resource.', 403);

    const database = getDatabase();
    const [parents] = await database.execute(
      `SELECT parents.id AS parentId, parents.display_name AS displayName,
        parents.initials, parents.personal_email AS personalEmail,
        parent_profiles.contact_number AS contactNumber,
        student_parent_links.relationship
      FROM student_parent_links
      INNER JOIN users AS parents ON parents.id = student_parent_links.parent_user_id
        AND parents.school_id = ? AND parents.role = 'parent'
      LEFT JOIN parent_profiles ON parent_profiles.user_id = parents.id
      WHERE student_parent_links.student_user_id = ?
      ORDER BY parents.last_name, parents.first_name, student_parent_links.relationship`,
      [req.user.schoolId, req.user.id]
    );

    res.status(200).json({ parents: parents.map(parent => ({
      ...parent,
      parentId: String(parent.parentId)
    })) });
  } catch (error) {
    next(error);
  }
}

async function getParentChildren(req, res, next) {
  try {
    const parentId = req.params.userId
      ? parsePositiveInteger(req.params.userId, null, Number.MAX_SAFE_INTEGER)
      : req.user.id;
    if (!parentId) throw createError('Invalid parent ID.');
    if (req.user.role === 'parent' && parentId !== req.user.id) {
      throw createError('You do not have access to these children.', 403);
    }
    if (!['parent', 'school_admin'].includes(req.user.role)) {
      throw createError('You do not have access to these children.', 403);
    }
    const database = getDatabase();
    const [parents] = await database.execute(
      "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'parent' LIMIT 1",
      [parentId, req.user.schoolId]
    );
    if (!parents.length) throw createError('Parent not found.', 404);
    const [children] = await database.execute(
      `SELECT students.id AS studentId, students.display_name AS displayName,
        students.initials, student_profiles.lrn, links.relationship,
        sections.id AS sectionId, sections.name AS sectionName,
        grade_levels.display_name AS gradeLevel, school_levels.level_code AS schoolLevel,
        advisers.display_name AS adviserName
      FROM student_parent_links AS links
      INNER JOIN users AS students ON students.id = links.student_user_id
        AND students.school_id = ? AND students.role = 'student'
      LEFT JOIN student_profiles ON student_profiles.user_id = students.id
      LEFT JOIN section_students AS enrollment ON enrollment.student_user_id = students.id
        AND enrollment.withdrawn_at IS NULL
        AND EXISTS (
          SELECT 1 FROM sections AS active_section
          INNER JOIN academic_years ON academic_years.id = active_section.academic_year_id
          WHERE active_section.id = enrollment.section_id
            AND active_section.school_id = students.school_id
            AND active_section.status = 'active' AND academic_years.status = 'active'
        )
      LEFT JOIN sections ON sections.id = enrollment.section_id
        AND sections.school_id = students.school_id
      LEFT JOIN school_grade_levels AS grade_levels ON grade_levels.id = sections.grade_level_id
      LEFT JOIN school_levels ON school_levels.id = sections.school_level_id
      LEFT JOIN users AS advisers ON advisers.id = sections.adviser_user_id
      WHERE links.parent_user_id = ?
      ORDER BY students.last_name, students.first_name`,
      [req.user.schoolId, parentId]
    );
    res.json({ children: children.map(child => ({
      ...child, studentId: String(child.studentId),
      sectionId: child.sectionId == null ? null : String(child.sectionId)
    })) });
  } catch (error) { next(error); }
}

async function updateMyProfile(req, res, next) {
  try {
    const changes = getProfileChanges(req.user.role, req.body || {});
    const table = req.user.role === 'school_admin'
      ? 'school_admin_profiles'
      : req.user.role === 'teacher'
        ? 'teacher_profiles'
        : req.user.role === 'student'
          ? 'student_profiles'
          : 'parent_profiles';
    const database = getDatabase();
    const assignments = changes.map(change => `${change.column} = ?`).join(', ');

    const [result] = await database.execute(
      `UPDATE ${table} SET ${assignments} WHERE user_id = ?`,
      [...changes.map(change => change.value), req.user.id]
    );
    if (!result.affectedRows) throw createError('Profile not found.', 404);

    const user = await findUserById(req.user.id, { clause: '', values: [] });
    const setup = getSetupStatus(formatUser(user));
    if (setup.required && setup.complete && !user.setupCompletedAt) {
      await database.execute('UPDATE users SET setup_completed_at = NOW() WHERE id = ?', [req.user.id]);
    }
    const updatedUser = await findUserById(req.user.id, { clause: '', values: [] });
    res.status(200).json({ user: formatUser(updatedUser) });
  } catch (error) {
    next(error);
  }
}

function getManagedSchoolId(req, body = {}) {
  if (req.user.role === 'school_admin') return req.user.schoolId;
  if (req.user.role !== 'platform_admin') throw createError('You do not have access to this resource.', 403);
  return parsePositiveInteger(body.schoolId, null, Number.MAX_SAFE_INTEGER) || (() => { throw createError('School ID is required.'); })();
}

async function findManagedUser(req, userId) {
  const scope = req.user.role === 'platform_admin'
    ? { clause: '', values: [] }
    : { clause: 'users.school_id = ?', values: [req.user.schoolId] };
  const user = await findUserById(userId, scope);
  if (!user) throw createError('User not found.', 404);
  return user;
}

async function createUser(req, res, next) {
  let connection;
  try {
    const body = req.body || {};
    const schoolId = getManagedSchoolId(req, body);
    const role = String(body.role || '').trim();
    if (!MANAGED_ROLES.has(role) || (req.user.role === 'school_admin' && role === 'school_admin')) {
      throw createError('This role cannot be created here.');
    }
    const firstName = normalizeText(body.firstName, 100);
    const lastName = normalizeText(body.lastName, 100);
    if (!firstName || !lastName) throw createError('First name and last name are required.');
    const schoolEmail = normalizeEmail(body.schoolEmail, 'School email');
    const personalEmail = body.personalEmail ? normalizeEmail(body.personalEmail, 'Personal email') : null;
    const temporaryPassword = body.temporaryPassword
      ? String(body.temporaryPassword)
      : generateTemporaryPassword();
    if (temporaryPassword.length < 12 || temporaryPassword.length > 128) {
      throw createError('Temporary password must contain 12 to 128 characters.');
    }
    const employeeNo = ['school_admin', 'teacher'].includes(role)
      ? normalizeText(body.employeeNo, 60)?.toUpperCase()
      : null;
    if (['school_admin', 'teacher'].includes(role) && !employeeNo) {
      throw createError('Employee number is required for staff accounts.');
    }
    const lrn = role === 'student' ? normalizeLrn(body.lrn) : null;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const displayName = [body.honorific ? normalizeText(body.honorific, 30) : null, firstName, lastName].filter(Boolean).join(' ');
    const initials = `${firstName[0]}${lastName[0]}`.toUpperCase();

    const database = getDatabase();
    connection = await database.getConnection();
    await connection.beginTransaction();
    if (employeeNo) {
      const [staffMatches] = await connection.execute(
        `SELECT users.id
         FROM users
         LEFT JOIN teacher_profiles ON teacher_profiles.user_id = users.id
         LEFT JOIN school_admin_profiles ON school_admin_profiles.user_id = users.id
         WHERE users.school_id = ?
           AND (teacher_profiles.employee_number = ? OR school_admin_profiles.employee_number = ?)
         LIMIT 1`,
        [schoolId, employeeNo, employeeNo]
      );
      if (staffMatches.length) throw createError('That employee number is already assigned in this school.', 409);
    }
    const [result] = await connection.execute(
      `INSERT INTO users (school_id, role, school_email, personal_email, password_hash, account_status, honorific, first_name, last_name, display_name, initials)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [schoolId, role, schoolEmail, personalEmail, passwordHash, body.honorific ? normalizeText(body.honorific, 30) : null, firstName, lastName, displayName, initials]
    );
    const userId = result.insertId;
    if (role === 'student') {
      await connection.execute('INSERT INTO student_profiles (user_id, lrn) VALUES (?, ?)', [userId, lrn]);
      await issueStudentQrCredential(connection, userId);
    }
    else if (role === 'parent') await connection.execute('INSERT INTO parent_profiles (user_id) VALUES (?)', [userId]);
    else if (role === 'teacher') await connection.execute('INSERT INTO teacher_profiles (user_id, employee_number) VALUES (?, ?)', [userId, employeeNo]);
    else await connection.execute('INSERT INTO school_admin_profiles (user_id, employee_number) VALUES (?, ?)', [userId, employeeNo]);

    if (role === 'parent' && body.parentLinks !== undefined) {
      if (!Array.isArray(body.parentLinks)) throw createError('Parent links must be an array.');
      for (const link of body.parentLinks) {
        const studentId = parsePositiveInteger(link?.studentId, null, Number.MAX_SAFE_INTEGER);
        const relationship = String(link?.relationship || '').trim().toLowerCase();
        if (!studentId || !['mother', 'father', 'guardian'].includes(relationship)) {
          throw createError('Each parent link needs a valid student and relationship.');
        }
        const [students] = await connection.execute(
          `SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'student' LIMIT 1`,
          [studentId, schoolId]
        );
        if (!students.length) throw createError('A linked student was not found in this school.');
        await connection.execute(
          'INSERT INTO student_parent_links (student_user_id, parent_user_id, relationship) VALUES (?, ?, ?)',
          [studentId, userId, relationship]
        );
      }
    }
    await connection.commit();
    const user = await findUserById(userId, { clause: '', values: [] });
    const emailDelivery = await sendAccountCreatedEmail(formatUser(user), temporaryPassword);
    res.status(201).json({ user: formatUser(user), emailDelivery });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('A user with that school email, personal email, or LRN already exists.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

async function updateUser(req, res, next) {
  let connection;
  try {
    const userId = parsePositiveInteger(req.params.userId, null, Number.MAX_SAFE_INTEGER);
    if (!userId) throw createError('Invalid user ID.');
    const user = await findManagedUser(req, userId);
    const body = req.body || {};
    const allowed = new Set(['firstName', 'lastName', 'schoolEmail', 'personalEmail', 'accountStatus', 'employeeNo', 'lrn', 'parentLinks']);
    const unknown = Object.keys(body).find(field => !allowed.has(field));
    if (unknown) throw createError('This user field cannot be edited.');
    if (!Object.keys(body).length) throw createError('Provide at least one editable user field.');
    const values = {
      firstName: Object.hasOwn(body, 'firstName') ? normalizeText(body.firstName, 100) : user.firstName,
      lastName: Object.hasOwn(body, 'lastName') ? normalizeText(body.lastName, 100) : user.lastName,
      schoolEmail: Object.hasOwn(body, 'schoolEmail') ? normalizeEmail(body.schoolEmail, 'School email') : user.schoolEmail,
      personalEmail: Object.hasOwn(body, 'personalEmail') ? (body.personalEmail ? normalizeEmail(body.personalEmail, 'Personal email') : null) : user.personalEmail,
      accountStatus: Object.hasOwn(body, 'accountStatus') ? String(body.accountStatus) : user.accountStatus
    };
    if (Object.hasOwn(body, 'employeeNo') && !['school_admin', 'teacher'].includes(user.role)) {
      throw createError('Employee number is only available for staff accounts.');
    }
    if (Object.hasOwn(body, 'lrn') && user.role !== 'student') {
      throw createError('LRN is only available for student accounts.');
    }
    if (Object.hasOwn(body, 'parentLinks') && user.role !== 'parent') {
      throw createError('Parent links are only available for parent accounts.');
    }
    if (body.parentLinks !== undefined && (!Array.isArray(body.parentLinks) || body.parentLinks.length > 100)) {
      throw createError('Parent links must be an array of up to 100 students.');
    }
    const employeeNo = ['school_admin', 'teacher'].includes(user.role)
      ? (Object.hasOwn(body, 'employeeNo') ? normalizeText(body.employeeNo, 60)?.toUpperCase() : null)
      : null;
    const lrn = user.role === 'student'
      ? (Object.hasOwn(body, 'lrn') ? normalizeLrn(body.lrn) : null)
      : null;
    if (!values.firstName || !values.lastName || !ACCOUNT_STATUSES.has(values.accountStatus)) throw createError('User details are invalid.');
    if (userId === req.user.id && values.accountStatus !== 'active') {
      throw createError('You cannot deactivate your own account.');
    }
    const displayName = [user.honorific, values.firstName, values.lastName].filter(Boolean).join(' ');
    const initials = `${values.firstName[0]}${values.lastName[0]}`.toUpperCase();
    const database = getDatabase();
    if (employeeNo !== null) {
      const [staffMatches] = await database.execute(
        `SELECT users.id
         FROM users
         LEFT JOIN teacher_profiles ON teacher_profiles.user_id = users.id
         LEFT JOIN school_admin_profiles ON school_admin_profiles.user_id = users.id
         WHERE users.school_id = ? AND users.id <> ?
           AND (teacher_profiles.employee_number = ? OR school_admin_profiles.employee_number = ?)
         LIMIT 1`,
        [user.schoolId, userId, employeeNo, employeeNo]
      );
      if (staffMatches.length) throw createError('That employee number is already assigned in this school.', 409);
    }
    connection = await database.getConnection();
    await connection.beginTransaction();
    if (body.parentLinks !== undefined) {
      const seen = new Set();
      for (const link of body.parentLinks) {
        const studentId = parsePositiveInteger(link?.studentId, null, Number.MAX_SAFE_INTEGER);
        const relationship = String(link?.relationship || '').trim().toLowerCase();
        if (!studentId || seen.has(studentId) || !['mother', 'father', 'guardian'].includes(relationship)) {
          throw createError('Each parent link needs a distinct student and a valid relationship.');
        }
        seen.add(studentId);
        const [students] = await connection.execute(
          "SELECT id FROM users WHERE id = ? AND school_id = ? AND role = 'student' LIMIT 1",
          [studentId, user.schoolId]
        );
        if (!students.length) throw createError('A linked student was not found in this school.');
      }
    }
    await connection.execute(
      `UPDATE users SET first_name = ?, last_name = ?, school_email = ?, personal_email = ?, account_status = ?, display_name = ?, initials = ? WHERE id = ?`,
      [values.firstName, values.lastName, values.schoolEmail, values.personalEmail, values.accountStatus, displayName, initials, userId]
    );
    if (employeeNo !== null) {
      const table = user.role === 'teacher' ? 'teacher_profiles' : 'school_admin_profiles';
      await connection.execute(`UPDATE ${table} SET employee_number = ? WHERE user_id = ?`, [employeeNo, userId]);
    }
    if (lrn !== null) {
      await connection.execute('UPDATE student_profiles SET lrn = ? WHERE user_id = ?', [lrn, userId]);
    }
    if (body.parentLinks !== undefined) {
      await connection.execute('DELETE FROM student_parent_links WHERE parent_user_id = ?', [userId]);
      for (const link of body.parentLinks) {
        await connection.execute(
          'INSERT INTO student_parent_links (student_user_id, parent_user_id, relationship) VALUES (?, ?, ?)',
          [Number(link.studentId), userId, link.relationship.trim().toLowerCase()]
        );
      }
    }
    await connection.commit();
    const accountStatusChanged = values.accountStatus !== user.accountStatus;
    if (accountStatusChanged && values.accountStatus !== 'active') await deleteSessionsForUser(userId);
    const updated = await findUserById(userId, { clause: '', values: [] });
    const formattedUser = formatUser(updated);
    const emailDelivery = accountStatusChanged ? await sendAccountStatusEmail(formattedUser) : null;
    res.status(200).json({ user: formattedUser, emailDelivery });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('A user with that school email or personal email already exists.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

async function setUserStatus(req, res, next) {
  req.body = { accountStatus: req.params.action === 'activate' ? 'active' : 'inactive' };
  return updateUser(req, res, next);
}

async function getAccountSetupStatus(req, res, next) {
  try {
    const user = await findUserById(req.user.id, { clause: '', values: [] });
    const formatted = formatUser(user);
    res.status(200).json({ setup: { ...getSetupStatus(formatted), completedAt: user.setupCompletedAt } });
  } catch (error) {
    next(error);
  }
}

async function completeAccountSetup(req, res, next) {
  try {
    if (!['student', 'parent'].includes(req.user.role)) throw createError('Account setup is not required for this role.', 403);
    const changes = getProfileChanges(req.user.role, req.body || {});
    const table = req.user.role === 'student' ? 'student_profiles' : 'parent_profiles';
    const database = getDatabase();
    const assignments = changes.map(change => `${change.column} = ?`).join(', ');
    await database.execute(
      `UPDATE ${table} SET ${assignments} WHERE user_id = ?`,
      [...changes.map(change => change.value), req.user.id]
    );
    const user = await findUserById(req.user.id, { clause: '', values: [] });
    const setup = getSetupStatus(formatUser(user));
    if (!setup.complete) {
      return res.status(400).json({ message: 'Complete all required account-setup fields.', setup });
    }
    await database.execute('UPDATE users SET setup_completed_at = COALESCE(setup_completed_at, NOW()) WHERE id = ?', [req.user.id]);
    res.status(200).json({ setup: { ...setup, completedAt: new Date().toISOString() } });
  } catch (error) {
    next(error);
  }
}

module.exports = { completeAccountSetup, createUser, getAccountSetupStatus, getMyParents, getMyProfile, getParentChildren, getUser, listUsers, setUserStatus, updateMyProfile, updateUser };
