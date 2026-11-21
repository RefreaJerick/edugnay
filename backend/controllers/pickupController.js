const fs = require('node:fs/promises');
const path = require('node:path');
const { getDatabase } = require('../config/database');
const { avatarDirectory, avatarFields, avatarMimeType } = require('../config/avatars');
const { codeLookup, createCodes, schoolDate, visibleCodes } = require('../config/fetcherCredentials');
const { writeAuditLog } = require('../utils/auditLog');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('Invalid ID.');
  return Number(value);
}

function optionalDate(value, label) {
  if (value == null || value === '') return null;
  const date = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || Number(date.slice(0, 4)) < 1000
    || parsed.toISOString().slice(0, 10) !== date) {
    fail(`Invalid ${label}.`);
  }
  return date;
}

function historyLimit(value) {
  if (value == null || value === '') return 50;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('History limit must be between 1 and 100.');
  return limit;
}

function pickupDateTime(date) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

async function ownerPerson(db, req, reference, lock = false) {
  const self = reference === 'self';
  if (!self) parseId(reference);
  const [[row]] = await db.execute(
    `SELECT fetchers.id, fetchers.parent_user_id AS parentId,
       fetchers.is_parent_self AS isSelf,
       CASE WHEN fetchers.is_parent_self THEN parents.display_name ELSE fetchers.full_name END AS fullName,
       CASE WHEN fetchers.is_parent_self THEN parents.avatar_filename ELSE fetchers.photo_filename END AS photoFilename,
       CASE WHEN fetchers.is_parent_self THEN 'Parent' ELSE fetchers.relationship END AS relationship
     FROM fetchers INNER JOIN users AS parents ON parents.id = fetchers.parent_user_id
       AND parents.school_id = fetchers.school_id AND parents.role = 'parent'
       AND parents.account_status = 'active'
     WHERE fetchers.school_id = ? AND fetchers.parent_user_id = ?
       AND ${self ? 'fetchers.is_parent_self = TRUE' : 'fetchers.id = ? AND fetchers.is_parent_self = FALSE'}
     LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    self ? [req.user.schoolId, req.user.id] : [req.user.schoolId, req.user.id, Number(reference)]
  );
  return row || null;
}

async function eligibleStudents(db, schoolId, person, lock = false) {
  const [rows] = await db.execute(
    `SELECT students.id AS studentId, students.display_name AS studentName,
       sections.name AS sectionName
     FROM student_parent_links AS links
     INNER JOIN users AS students ON students.id = links.student_user_id
       AND students.school_id = links.school_id AND students.role = 'student'
       AND students.account_status = 'active'
     INNER JOIN section_students AS members ON members.school_id = links.school_id
       AND members.student_user_id = links.student_user_id AND members.withdrawn_at IS NULL
     INNER JOIN sections ON sections.id = members.section_id
       AND sections.school_id = members.school_id AND sections.status = 'active'
     INNER JOIN academic_years AS years ON years.id = sections.academic_year_id
       AND years.school_id = sections.school_id AND years.status = 'active'
     WHERE links.school_id = ? AND links.parent_user_id = ?
       ${person.isSelf ? '' : `AND EXISTS (SELECT 1 FROM fetcher_authorizations AS auth
         WHERE auth.school_id = links.school_id AND auth.fetcher_id = ?
           AND auth.student_user_id = links.student_user_id AND auth.status = 'approved')`}
     ${lock ? 'FOR UPDATE' : ''}`,
    person.isSelf ? [schoolId, person.parentId] : [schoolId, person.parentId, person.id]
  );
  return [...new Map(rows.map(row => [Number(row.studentId), {
    studentId: Number(row.studentId), studentName: row.studentName,
    sectionName: row.sectionName }])).values()];
}

async function requireEligible(db, schoolId, person, lock = false) {
  if (!avatarMimeType(person.photoFilename)) fail('A current face photo is required.', 409);
  const students = await eligibleStudents(db, schoolId, person, lock);
  if (!students.length) fail('This fetcher has no currently authorized, enrolled students.', 409);
  return students;
}

async function selfPersonForIssue(db, req) {
  const [[parent]] = await db.execute(
    `SELECT users.id, users.display_name AS fullName, users.avatar_filename AS photoFilename,
       COALESCE(profiles.contact_number, '') AS contactNumber
     FROM users LEFT JOIN parent_profiles AS profiles ON profiles.user_id = users.id
     WHERE users.id = ? AND users.school_id = ? AND users.role = 'parent'
       AND users.account_status = 'active' FOR UPDATE`, [req.user.id, req.user.schoolId]
  );
  if (!parent) fail('Parent account not found.', 404);
  const existing = await ownerPerson(db, req, 'self', true);
  if (existing) return existing;
  const provisional = { id: null, parentId: req.user.id, isSelf: 1,
    fullName: parent.fullName, photoFilename: parent.photoFilename };
  await requireEligible(db, req.user.schoolId, provisional);
  const [result] = await db.execute(
    `INSERT INTO fetchers (school_id, parent_user_id, is_parent_self,
       full_name, relationship, contact_number) VALUES (?, ?, TRUE, ?, 'Parent', ?)`,
    [req.user.schoolId, req.user.id, parent.fullName, parent.contactNumber]
  );
  return { ...provisional, id: result.insertId };
}

async function credentialRow(db, schoolId, fetcherId, lock = false) {
  const [[row]] = await db.execute(
    `SELECT id, qr_token_ciphertext AS qrCiphertext,
       manual_code_ciphertext AS manualCiphertext, issued_at AS issuedAt,
       revoked_at AS revokedAt FROM fetcher_credentials
     WHERE school_id = ? AND fetcher_id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [schoolId, fetcherId]
  );
  return row || null;
}

function credentialResponse(person, row) {
  const codes = row && !row.revokedAt ? visibleCodes(row) : null;
  return { fetcherId: Number(person.id), fullName: person.fullName,
    relationship: person.relationship, photoUrl: person.isSelf
      ? `/api/users/${person.parentId}/avatar` : `/api/fetchers/${person.id}/photo`,
    issuedAt: codes ? row.issuedAt : null, issued: Boolean(codes), ...codes };
}

async function getCredential(req, res, next) {
  try {
    const db = getDatabase();
    const person = await ownerPerson(db, req, req.params.reference);
    if (!person) {
      if (req.params.reference === 'self') return res.json({ issued: false });
      fail('Fetcher not found.', 404);
    }
    await requireEligible(db, req.user.schoolId, person);
    const row = await credentialRow(db, req.user.schoolId, person.id);
    res.json(credentialResponse(person, row));
  } catch (error) { next(error); }
}

async function issueCredential(req, res, next) {
  let connection;
  try {
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const person = req.params.reference === 'self'
      ? await selfPersonForIssue(connection, req)
      : await ownerPerson(connection, req, req.params.reference, true);
    if (!person) fail('Fetcher not found.', 404);
    await requireEligible(connection, req.user.schoolId, person, true);
    let row = await credentialRow(connection, req.user.schoolId, person.id, true);
    const reissue = req.path.endsWith('/reissue');
    if (reissue || !row || row.revokedAt || !visibleCodes(row)) {
      const codes = createCodes();
      await connection.execute(
        `INSERT INTO fetcher_credentials (school_id, fetcher_id, qr_token_hash, qr_token_ciphertext,
          manual_code_hash, manual_code_ciphertext, issued_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), NULL)
         ON DUPLICATE KEY UPDATE qr_token_hash = VALUES(qr_token_hash),
           qr_token_ciphertext = VALUES(qr_token_ciphertext), manual_code_hash = VALUES(manual_code_hash),
           manual_code_ciphertext = VALUES(manual_code_ciphertext), issued_at = UTC_TIMESTAMP(), revoked_at = NULL`,
        [req.user.schoolId, person.id, codes.qrHash, codes.qrCiphertext,
          codes.manualHash, codes.manualCiphertext]
      );
      row = await credentialRow(connection, req.user.schoolId, person.id, true);
      await writeAuditLog(connection, req, reissue ? 'fetcher_id_reissued' : 'fetcher_id_issued',
        'fetcher', person.id, { summary: person.fullName });
    }
    await connection.commit();
    res.json(credentialResponse(person, row));
  } catch (error) {
    if (connection) await connection.rollback().catch(console.error);
    next(error);
  } finally { connection?.release(); }
}

async function verifiedPerson(db, req, lock = false) {
  const lookup = codeLookup(req.body?.code);
  const [[person]] = await db.execute(
    `SELECT fetchers.id, fetchers.parent_user_id AS parentId,
       fetchers.is_parent_self AS isSelf,
       CASE WHEN fetchers.is_parent_self THEN parents.display_name ELSE fetchers.full_name END AS fullName,
       CASE WHEN fetchers.is_parent_self THEN parents.avatar_filename ELSE fetchers.photo_filename END AS photoFilename,
       CASE WHEN fetchers.is_parent_self THEN 'Parent' ELSE fetchers.relationship END AS relationship
     FROM fetcher_credentials AS credential
     INNER JOIN fetchers ON fetchers.id = credential.fetcher_id
       AND fetchers.school_id = credential.school_id
     INNER JOIN users AS parents ON parents.id = fetchers.parent_user_id
       AND parents.school_id = fetchers.school_id AND parents.role = 'parent'
       AND parents.account_status = 'active'
     WHERE credential.school_id = ? AND credential.${lookup.column} = ?
       AND credential.revoked_at IS NULL LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [req.user.schoolId, lookup.hash]
  );
  if (!person) fail('Fetcher code is invalid or has been revoked.', 422);
  const students = await requireEligible(db, req.user.schoolId, person, lock);
  return { person, students };
}

async function verifyCode(req, res, next) {
  try {
    const { person, students } = await verifiedPerson(getDatabase(), req);
    const today = schoolDate();
    const [picked] = await getDatabase().execute(
      `SELECT student_user_id AS studentId FROM pickup_records
       WHERE school_id = ? AND school_date = ? AND student_user_id IN (${students.map(() => '?').join(',')})`,
      [req.user.schoolId, today, ...students.map(student => student.studentId)]
    );
    const completed = new Set(picked.map(row => Number(row.studentId)));
    res.json({ fetcherId: Number(person.id), fullName: person.fullName,
      relationship: person.relationship, students: students.map(student => ({ ...student,
        pickedUp: completed.has(student.studentId) })) });
  } catch (error) { next(error); }
}

async function getVerifiedPhoto(req, res, next) {
  try {
    const { person } = await verifiedPerson(getDatabase(), req);
    const mimeType = avatarMimeType(person.photoFilename);
    const bytes = await fs.readFile(path.join(avatarDirectory, person.photoFilename));
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-site', 'X-Content-Type-Options': 'nosniff' });
    res.send(bytes);
  } catch (error) {
    if (error.code === 'ENOENT') return next(Object.assign(new Error('Photo unavailable.'), { status: 404 }));
    next(error);
  }
}

async function confirmPickup(req, res, next) {
  let connection;
  try {
    const studentId = parseId(req.body?.studentId);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    const { person, students } = await verifiedPerson(connection, req, true);
    if (!students.some(student => student.studentId === studentId)) fail('Student is no longer authorized for pickup.', 409);
    if (!person.isSelf) {
      const [[authorization]] = await connection.execute(
        `SELECT status FROM fetcher_authorizations WHERE school_id = ?
         AND fetcher_id = ? AND student_user_id = ? FOR UPDATE`,
        [req.user.schoolId, person.id, studentId]
      );
      if (authorization?.status !== 'approved') fail('Student is no longer authorized for pickup.', 409);
    }
    const now = new Date();
    const date = schoolDate(now);
    const pickedUpAt = now.toISOString().slice(0, 19).replace('T', ' ');
    const student = students.find(item => item.studentId === studentId);
    const [[guard]] = await connection.execute(
      `SELECT display_name AS guardName FROM users WHERE id = ? AND school_id = ?
       AND role = 'school_guard' AND account_status = 'active' FOR UPDATE`,
      [req.user.id, req.user.schoolId]
    );
    if (!guard) fail('Guard account is no longer active.', 403);
    const [result] = await connection.execute(
      `INSERT INTO pickup_records (school_id, student_user_id, student_name_at_pickup,
         fetcher_id, fetcher_name_at_pickup, fetcher_relationship_at_pickup,
         guard_user_id, guard_name_at_pickup, school_date, picked_up_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.schoolId, studentId, student.studentName, person.id, person.fullName,
        person.relationship, req.user.id, guard.guardName, date, pickedUpAt]
    );
    await writeAuditLog(connection, req, 'student_picked_up', 'pickup_record', result.insertId,
      { summary: `${student.studentName} was picked up by ${person.fullName}`,
        studentId, studentName: student.studentName, fetcherId: Number(person.id),
        fetcherName: person.fullName, schoolDate: date });
    const title = 'Student picked up';
    const message = `${student.studentName} was picked up by ${person.fullName} on ${pickupDateTime(now)}.`;
    await connection.execute(
      `INSERT INTO notifications (user_id, related_student_user_id, type, title,
         message, target_path, event_key)
       SELECT DISTINCT parents.id, students.id, 'pickup', ?, ?, ?, CONCAT('pickup:', ?)
       FROM student_parent_links AS links
       INNER JOIN users AS parents ON parents.id = links.parent_user_id
         AND parents.school_id = links.school_id AND parents.role = 'parent'
         AND parents.account_status = 'active'
       INNER JOIN users AS students ON students.id = links.student_user_id
         AND students.school_id = links.school_id AND students.role = 'student'
         AND students.account_status = 'active'
       WHERE links.school_id = ? AND links.student_user_id = ?
       ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
      [title, message, `/views/parent/edugnay-parent-fetchers.html?pickupId=${result.insertId}`,
        result.insertId, req.user.schoolId, studentId]
    );
    await connection.commit();
    res.status(201).json({ studentId, fetcherId: Number(person.id), schoolDate: date,
      pickedUpAt: `${pickedUpAt.replace(' ', 'T')}Z`, confirmed: true });
  } catch (error) {
    if (connection) await connection.rollback().catch(console.error);
    if (error.code === 'ER_DUP_ENTRY') return next(Object.assign(new Error('This student was already picked up today.'), { status: 409 }));
    next(error);
  } finally { connection?.release(); }
}

async function pickupHistory(req, res, next) {
  try {
    const query = req.query || {};
    const from = optionalDate(query.from, 'start date');
    const to = optionalDate(query.to, 'end date');
    if (from && to && from > to) fail('The start date must be on or before the end date.');
    const limit = historyLimit(query.limit);
    const cursor = query.cursor ? parseId(query.cursor) : null;
    const values = [req.user.schoolId];
    let filters = '';
    if (from) { filters += ' AND records.school_date >= ?'; values.push(from); }
    if (to) { filters += ' AND records.school_date <= ?'; values.push(to); }
    if (cursor) { filters += ' AND records.id < ?'; values.push(cursor); }
    if (req.user.role === 'parent') {
      filters += ` AND EXISTS (SELECT 1 FROM student_parent_links AS links
        WHERE links.school_id = records.school_id AND links.student_user_id = records.student_user_id
          AND links.parent_user_id = ?)`;
      values.push(req.user.id);
    }
    values.push(limit + 1);
    const [rows] = await getDatabase().execute(
      `SELECT records.id, records.student_user_id AS studentId,
         records.student_name_at_pickup AS studentName,
         records.fetcher_id AS fetcherId, records.fetcher_name_at_pickup AS fetcherName,
         records.fetcher_relationship_at_pickup AS fetcherRelationship,
         records.guard_user_id AS guardId, records.guard_name_at_pickup AS guardName,
         DATE_FORMAT(records.school_date, '%Y-%m-%d') AS schoolDate,
         DATE_FORMAT(records.picked_up_at, '%Y-%m-%dT%H:%i:%sZ') AS pickedUpAt,
         students.initials AS studentInitials,
         students.avatar_filename AS studentAvatarFilename,
         students.avatar_version AS studentAvatarVersion
       FROM pickup_records AS records
       LEFT JOIN users AS students ON students.id = records.student_user_id
         AND students.school_id = records.school_id AND students.role = 'student'
       WHERE records.school_id = ? ${filters}
       ORDER BY records.id DESC LIMIT ?`, values
    );
    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit).map(row => {
      const { studentAvatarFilename, studentAvatarVersion, ...record } = row;
      const studentId = Number(row.studentId);
      return { ...record, id: Number(row.id), studentId, fetcherId: Number(row.fetcherId),
        guardId: Number(row.guardId), ...avatarFields({ id: studentId,
          avatarFilename: studentAvatarFilename, avatarVersion: studentAvatarVersion }) };
    });
    res.set('Cache-Control', 'private, no-store');
    res.json({ records, nextCursor: hasMore ? String(records.at(-1).id) : null,
      timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila' });
  } catch (error) { next(error); }
}

async function todayCounts(req, res, next) {
  try {
    const date = schoolDate();
    const [[school]] = await getDatabase().execute(
      `SELECT COALESCE(NULLIF(TRIM(school_settings.current_school_year_label), ''),
          (SELECT active_year.label FROM academic_years AS active_year
           WHERE active_year.school_id = schools.id AND active_year.status = 'active'
           ORDER BY active_year.id DESC LIMIT 1)) AS schoolYear,
        COALESCE(NULLIF(TRIM(schools.short_name), ''), NULLIF(TRIM(schools.name), '')) AS shortName
       FROM schools
       LEFT JOIN school_settings ON school_settings.school_id = schools.id
       WHERE schools.id = ? LIMIT 1`,
      [req.user.schoolId]
    );
    const [[picked]] = await getDatabase().execute(
      `SELECT COUNT(*) AS count FROM pickup_records WHERE school_id = ? AND school_date = ?`,
      [req.user.schoolId, date]
    );
    const [[waiting]] = await getDatabase().execute(
      `SELECT COUNT(DISTINCT students.id) AS count
       FROM users AS students
       INNER JOIN section_students AS members ON members.student_user_id = students.id
         AND members.school_id = students.school_id AND members.withdrawn_at IS NULL
       INNER JOIN sections ON sections.id = members.section_id
         AND sections.school_id = members.school_id AND sections.status = 'active'
       INNER JOIN academic_years AS years ON years.id = sections.academic_year_id
         AND years.school_id = sections.school_id AND years.status = 'active'
       WHERE students.school_id = ? AND students.role = 'student' AND students.account_status = 'active'
         AND NOT EXISTS (SELECT 1 FROM pickup_records AS picked
           WHERE picked.school_id = students.school_id AND picked.student_user_id = students.id
             AND picked.school_date = ?)
         AND EXISTS (SELECT 1 FROM student_parent_links AS links
           INNER JOIN users AS parents ON parents.id = links.parent_user_id
             AND parents.school_id = links.school_id AND parents.role = 'parent'
             AND parents.account_status = 'active'
           WHERE links.school_id = students.school_id AND links.student_user_id = students.id
             AND (parents.avatar_filename IS NOT NULL OR EXISTS (
               SELECT 1 FROM fetcher_authorizations AS auth
               INNER JOIN fetchers ON fetchers.id = auth.fetcher_id
                 AND fetchers.school_id = auth.school_id AND fetchers.parent_user_id = parents.id
               WHERE auth.school_id = links.school_id AND auth.student_user_id = students.id
                 AND auth.status = 'approved' AND fetchers.photo_filename IS NOT NULL)))`,
      [req.user.schoolId, date]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({ schoolDate: date, schoolYear: school?.schoolYear || null,
      shortName: school?.shortName || null,
      pickedUp: Number(picked.count), awaiting: Number(waiting.count) });
  } catch (error) { next(error); }
}

module.exports = { confirmPickup, getCredential, getVerifiedPhoto, issueCredential,
  pickupHistory, todayCounts, verifyCode };
