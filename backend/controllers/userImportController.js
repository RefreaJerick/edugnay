const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { getDatabase } = require('../config/database');
const { sendAccountCreatedEmail } = require('../config/email');

const ROLE_ALIASES = { adm: 'school_admin', fac: 'teacher', stud: 'student', parents: 'parent' };
const EXPECTED_COLUMNS = {
  school_admin: ['firstName', 'lastName', 'personalEmail', 'employeeNo'],
  teacher: ['firstName', 'lastName', 'personalEmail', 'employeeNo'],
  student: ['firstName', 'lastName', 'personalEmail', 'lrn'],
  parent: ['firstName', 'lastName', 'personalEmail', 'studentLrn', 'relationship']
};
const PARENT_RELATIONSHIPS = new Set(['mother', 'father', 'guardian']);
const MAX_IMPORT_ROWS = 1000;

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(value, maximum, field) {
  const text = String(value || '').trim();
  if (!text) return { value: '', error: `${field} is required.` };
  if (text.length > maximum) return { value: text, error: `${field} is too long.` };
  return { value: text, error: null };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
    return { value: email, error: 'personalEmail must be a valid email address.' };
  }
  return { value: email, error: null };
}

function normalizeLrn(value, field) {
  const lrn = String(value || '').trim();
  return /^\d{12}$/.test(lrn)
    ? { value: lrn, error: null }
    : { value: lrn, error: `${field} must contain exactly 12 digits.` };
}

function getImportRole(req) {
  const role = ROLE_ALIASES[String(req.body.role || '').trim()] || String(req.body.role || '').trim();
  if (!Object.hasOwn(EXPECTED_COLUMNS, role)) throw createError('Select a supported account role.');
  if (req.user.role === 'school_admin' && role === 'school_admin') {
    throw createError('School administrators cannot import administrator accounts.', 403);
  }
  return role;
}

function parseCsvFile(file, expectedColumns) {
  if (!file?.buffer?.length) throw createError('Choose a CSV file to import.');

  let headers;
  let rows;
  try {
    headers = parse(file.buffer, { bom: true, to_line: 1, trim: true })[0] || [];
    rows = parse(file.buffer, { bom: true, columns: headers, from_line: 2, skip_empty_lines: true, trim: true, relax_column_count: false });
  } catch (error) {
    throw createError(`The CSV structure is invalid${error.lines ? ` near line ${error.lines}` : ''}.`);
  }

  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  const missingColumns = expectedColumns.filter(column => !headers.includes(column));
  const unexpectedColumns = headers.filter(column => !expectedColumns.includes(column));
  if (duplicateHeaders.length || missingColumns.length || unexpectedColumns.length) {
    const problems = [];
    if (duplicateHeaders.length) problems.push(`Duplicate column: ${duplicateHeaders[0]}.`);
    if (missingColumns.length) problems.push(`Missing column: ${missingColumns.join(', ')}.`);
    if (unexpectedColumns.length) problems.push(`Unexpected column: ${unexpectedColumns.join(', ')}.`);
    throw createError(problems.join(' '));
  }
  if (!rows.length) throw createError('The CSV does not contain any data rows.');
  if (rows.length > MAX_IMPORT_ROWS) throw createError(`A CSV import can contain up to ${MAX_IMPORT_ROWS} rows.`);
  return rows;
}

function validateRows(rows, role) {
  return rows.map((source, index) => {
    const row = { rowNumber: index + 2, errors: [] };
    const firstName = normalizeText(source.firstName, 100, 'firstName');
    const lastName = normalizeText(source.lastName, 100, 'lastName');
    const personalEmail = normalizeEmail(source.personalEmail);
    row.firstName = firstName.value;
    row.lastName = lastName.value;
    row.personalEmail = personalEmail.value;
    [firstName.error, lastName.error, personalEmail.error].filter(Boolean).forEach(error => row.errors.push(error));

    if (role === 'school_admin' || role === 'teacher') {
      const employeeNo = normalizeText(source.employeeNo, 60, 'employeeNo');
      row.employeeNo = employeeNo.value.toUpperCase();
      if (employeeNo.error) row.errors.push(employeeNo.error);
    }
    if (role === 'student') {
      const lrn = normalizeLrn(source.lrn, 'lrn');
      row.lrn = lrn.value;
      if (lrn.error) row.errors.push(lrn.error);
    }
    if (role === 'parent') {
      const studentLrn = normalizeLrn(source.studentLrn, 'studentLrn');
      row.studentLrn = studentLrn.value;
      row.relationship = String(source.relationship || '').trim().toLowerCase();
      if (studentLrn.error) row.errors.push(studentLrn.error);
      if (!PARENT_RELATIONSHIPS.has(row.relationship)) {
        row.errors.push('relationship must be mother, father, or guardian.');
      }
    }
    return row;
  });
}

function addDuplicateErrors(records, role) {
  const emails = new Map();
  const identifiers = new Map();
  const links = new Map();

  records.forEach(record => {
    if (record.personalEmail) {
      const first = emails.get(record.personalEmail);
      const sameParent = role === 'parent' && first
        && first.firstName.toLowerCase() === record.firstName.toLowerCase()
        && first.lastName.toLowerCase() === record.lastName.toLowerCase();
      if (first && !sameParent) {
        first.errors.push('personalEmail must be unique for each account.');
        record.errors.push('personalEmail must be unique for each account.');
      } else if (!first) {
        emails.set(record.personalEmail, record);
      }
    }

    const identifier = role === 'student' ? record.lrn : ['school_admin', 'teacher'].includes(role) ? record.employeeNo : null;
    if (identifier) {
      const first = identifiers.get(identifier);
      const field = role === 'student' ? 'lrn' : 'employeeNo';
      if (first) {
        first.errors.push(`${field} must be unique.`);
        record.errors.push(`${field} must be unique.`);
      } else {
        identifiers.set(identifier, record);
      }
    }

    if (role === 'parent' && record.personalEmail && record.studentLrn) {
      const key = `${record.personalEmail}|${record.studentLrn}`;
      const first = links.get(key);
      if (first) {
        first.errors.push('The same parent-student link appears more than once.');
        record.errors.push('The same parent-student link appears more than once.');
      } else {
        links.set(key, record);
      }
    }
  });
}

async function addDatabaseValidationErrors(database, records, role, schoolId) {
  const emails = [...new Set(records.map(record => record.personalEmail).filter(Boolean))];
  if (emails.length) {
    const placeholders = emails.map(() => '?').join(', ');
    const [existingUsers] = await database.execute(`SELECT personal_email AS personalEmail FROM users WHERE personal_email IN (${placeholders})`, emails);
    const existingEmails = new Set(existingUsers.map(user => user.personalEmail));
    records.filter(record => existingEmails.has(record.personalEmail)).forEach(record => record.errors.push('personalEmail is already assigned.'));
  }

  if (role === 'student') {
    const lrns = [...new Set(records.map(record => record.lrn).filter(Boolean))];
    if (lrns.length) {
      const placeholders = lrns.map(() => '?').join(', ');
      const [students] = await database.execute(
        `SELECT student_profiles.lrn FROM student_profiles
        INNER JOIN users ON users.id = student_profiles.user_id
        WHERE users.school_id = ? AND student_profiles.lrn IN (${placeholders})`,
        [schoolId, ...lrns]
      );
      const existingLrns = new Set(students.map(student => student.lrn));
      records.filter(record => existingLrns.has(record.lrn)).forEach(record => record.errors.push('lrn is already assigned.'));
    }
  }

  if (role === 'school_admin' || role === 'teacher') {
    const employeeNumbers = [...new Set(records.map(record => record.employeeNo).filter(Boolean))];
    if (employeeNumbers.length) {
      const placeholders = employeeNumbers.map(() => '?').join(', ');
      const [staff] = await database.execute(
        `SELECT employee_number AS employeeNo FROM school_admin_profiles
        INNER JOIN users ON users.id = school_admin_profiles.user_id
        WHERE users.school_id = ? AND school_admin_profiles.employee_number IN (${placeholders})
        UNION
        SELECT employee_number AS employeeNo FROM teacher_profiles
        INNER JOIN users ON users.id = teacher_profiles.user_id
        WHERE users.school_id = ? AND teacher_profiles.employee_number IN (${placeholders})`,
        [schoolId, ...employeeNumbers, schoolId, ...employeeNumbers]
      );
      const existingEmployeeNumbers = new Set(staff.map(member => String(member.employeeNo).toUpperCase()));
      records.filter(record => existingEmployeeNumbers.has(record.employeeNo)).forEach(record => record.errors.push('employeeNo is already assigned.'));
    }
  }

  if (role === 'parent') {
    const lrns = [...new Set(records.map(record => record.studentLrn).filter(Boolean))];
    if (lrns.length) {
      const placeholders = lrns.map(() => '?').join(', ');
      const [students] = await database.execute(
        `SELECT users.id, student_profiles.lrn FROM student_profiles
        INNER JOIN users ON users.id = student_profiles.user_id
        WHERE users.school_id = ? AND student_profiles.lrn IN (${placeholders})`,
        [schoolId, ...lrns]
      );
      const studentsByLrn = new Map(students.map(student => [student.lrn, student.id]));
      records.forEach(record => {
        record.studentId = studentsByLrn.get(record.studentLrn) || null;
        if (record.studentLrn && !record.studentId) record.errors.push('studentLrn does not match a student in this school.');
      });
    }
  }
}

function createValidationResponse(records) {
  return {
    message: 'Correct the CSV errors and import again. No accounts were created.',
    rows: records.map(record => ({ rowNumber: record.rowNumber, status: record.errors.length ? 'invalid' : 'valid', errors: [...new Set(record.errors)] }))
  };
}

function getAccountRecords(records, role) {
  if (role !== 'parent') return records;

  const parents = new Map();
  records.forEach(record => {
    if (!parents.has(record.personalEmail)) {
      parents.set(record.personalEmail, { ...record, links: [] });
    }
    parents.get(record.personalEmail).links.push({ studentId: record.studentId, relationship: record.relationship, rowNumber: record.rowNumber });
  });
  return [...parents.values()];
}

function createTemporaryPassword() {
  return `Edu-${crypto.randomBytes(12).toString('base64url')}!`;
}

function getSchoolEmailDomain(school) {
  const email = String(school.email || '').trim();
  if (email.includes('@')) return email.split('@').pop().toLowerCase();
  const website = String(school.website || '').trim().replace(/^https?:\/\//, '').split('/')[0];
  return website || `school-${school.id}.academix.local`;
}

function createSchoolEmail(record, role, domain, usedEmails) {
  const first = record.firstName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const last = record.lastName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'account';
  const suffix = { school_admin: 'adm', teacher: 'fac', student: 'stud', parent: 'par' }[role];
  const base = `${first.charAt(0)}.${last}.${suffix}`;
  let candidate = `${base}@${domain}`;
  let index = 2;
  while (usedEmails.has(candidate)) {
    candidate = `${base}${index}@${domain}`;
    index += 1;
  }
  usedEmails.add(candidate);
  return candidate;
}

async function importUsers(req, res, next) {
  let connection;
  try {
    const role = getImportRole(req);
    const rows = parseCsvFile(req.file, EXPECTED_COLUMNS[role]);
    const records = validateRows(rows, role);
    addDuplicateErrors(records, role);
    const schoolId = req.user.role === 'school_admin' ? req.user.schoolId : Number.parseInt(req.body.schoolId, 10);
    if (!Number.isSafeInteger(schoolId) || schoolId < 1) throw createError('A valid school ID is required.');

    const database = getDatabase();
    await addDatabaseValidationErrors(database, records, role, schoolId);
    if (records.some(record => record.errors.length)) {
      return res.status(422).json(createValidationResponse(records));
    }

    const [[school]] = await database.execute('SELECT id, email, website FROM schools WHERE id = ? LIMIT 1', [schoolId]);
    if (!school) throw createError('School not found.', 404);
    const [existingEmails] = await database.execute('SELECT school_email AS schoolEmail FROM users');
    const usedEmails = new Set(existingEmails.map(user => String(user.schoolEmail).toLowerCase()));
    const accounts = getAccountRecords(records, role).map(record => ({
      ...record,
      schoolEmail: createSchoolEmail(record, role, getSchoolEmailDomain(school), usedEmails),
      temporaryPassword: createTemporaryPassword()
    }));

    connection = await database.getConnection();
    await connection.beginTransaction();
    for (const account of accounts) {
      const passwordHash = await bcrypt.hash(account.temporaryPassword, 12);
      const displayName = `${account.firstName} ${account.lastName}`;
      const initials = `${account.firstName[0]}${account.lastName[0]}`.toUpperCase();
      const [result] = await connection.execute(
        `INSERT INTO users (school_id, role, school_email, personal_email, password_hash, account_status, first_name, last_name, display_name, initials)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        [schoolId, role, account.schoolEmail, account.personalEmail, passwordHash, account.firstName, account.lastName, displayName, initials]
      );
      account.id = result.insertId;
      if (role === 'student') await connection.execute('INSERT INTO student_profiles (user_id, lrn) VALUES (?, ?)', [account.id, account.lrn]);
      if (role === 'parent') {
        await connection.execute('INSERT INTO parent_profiles (user_id) VALUES (?)', [account.id]);
        for (const link of account.links) {
          await connection.execute(
            'INSERT INTO student_parent_links (student_user_id, parent_user_id, relationship) VALUES (?, ?, ?)',
            [link.studentId, account.id, link.relationship]
          );
        }
      }
      if (role === 'teacher') await connection.execute('INSERT INTO teacher_profiles (user_id, employee_number) VALUES (?, ?)', [account.id, account.employeeNo]);
      if (role === 'school_admin') await connection.execute('INSERT INTO school_admin_profiles (user_id, employee_number) VALUES (?, ?)', [account.id, account.employeeNo]);
    }
    await connection.commit();

    const deliveries = await Promise.all(accounts.map(account => sendAccountCreatedEmail({
      displayName: `${account.firstName} ${account.lastName}`,
      schoolEmail: account.schoolEmail,
      personalEmail: account.personalEmail
    }, account.temporaryPassword)));
    const deliverySummary = deliveries.reduce((summary, result) => {
      summary[result.status] = (summary[result.status] || 0) + 1;
      return summary;
    }, {});
    const accountByEmail = new Map(accounts.map(account => [account.personalEmail, account]));
    const parentLinkCount = role === 'parent' ? records.length : 0;

    res.status(201).json({
      summary: { role, accountsCreated: accounts.length, parentLinksCreated: parentLinkCount, emailDelivery: deliverySummary },
      rows: records.map(record => ({
        rowNumber: record.rowNumber,
        status: 'imported',
        userId: accountByEmail.get(record.personalEmail)?.id || null,
        errors: []
      }))
    });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') error = createError('An account, LRN, or parent link already exists. No accounts were created.', 409);
    next(error);
  } finally {
    connection?.release();
  }
}

module.exports = { importUsers };
