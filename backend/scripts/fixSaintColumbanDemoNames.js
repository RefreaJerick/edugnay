'use strict';

const path = require('node:path');
const { createInterface } = require('node:readline/promises');
const { makeData, legacyIdentity, legacyProfile, takeSnapshot } = require('./seedSaintColumbanDemoAccounts');
const { schoolEmailBase, schoolEmailCandidate, storedSchoolDomain } = require('../utils/schoolUserEmail');

const SCHOOL_ID = 7;
const SCHOOL_NAME = "Saint Columban's College";
const DEMO_DATE = '2026-11-17 12:00:00';
const CONFIRMATION = 'FIX 165 DEMO ACCOUNTS FOR SCHOOL 7';

function assert(condition, message) { if (!condition) throw new Error(message); }
function expectedRole(index) { return index < 135 ? 'student' : index < 155 ? 'teacher' : 'parent'; }

async function buildManifest(connection, lock = false) {
  const [[state]] = await connection.query('SELECT DATABASE() AS db, @@FOREIGN_KEY_CHECKS AS fk');
  assert(state.db === 'academix' && Number(state.fk) === 1, 'Wrong database or foreign-key checks disabled.');
  const [schools] = await connection.execute(
    `SELECT id, name, registration_status AS status, school_email_domain AS domain
     FROM schools WHERE id = ? AND name = ?${lock ? ' FOR UPDATE' : ''}`,
    [SCHOOL_ID, SCHOOL_NAME]
  );
  assert(schools.length === 1 && schools[0].status === 'active', 'Expected active Saint Columban school ID 7.');
  const domain = storedSchoolDomain({ schoolEmailDomain: schools[0].domain });
  const [[activity]] = await connection.execute(`SELECT
    (SELECT COUNT(*) FROM student_scores WHERE school_id=?) AS scores,
    (SELECT COUNT(*) FROM attendance_records WHERE school_id=?) AS attendance,
    (SELECT COUNT(*) FROM assignment_submissions WHERE school_id=?) AS submissions,
    (SELECT COUNT(*) FROM student_journal_entries WHERE school_id=?) AS journals,
    (SELECT COUNT(*) FROM narrative_reports WHERE school_id=?) AS reports,
    (SELECT COUNT(*) FROM school_form_exports WHERE school_id=?) AS exports`,
  [SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID, SCHOOL_ID]);
  assert(Object.values(activity).every(count => Number(count) === 0),
    'School activity or exported reports already exist; review them before renaming accounts.');
  const [existingLinks] = await connection.execute(
    `SELECT student_user_id FROM student_parent_links WHERE school_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [SCHOOL_ID]);
  assert(existingLinks.length === 0, 'School already has parent links; review them before adding demo families.');
  const [schoolUsers] = await connection.execute(
    `SELECT id, role, first_name AS firstName, last_name AS lastName,
       display_name AS displayName, initials, school_email AS schoolEmail,
       personal_email AS personalEmail, account_status AS status,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS added,
       DATE_FORMAT(setup_completed_at, '%Y-%m-%d %H:%i:%s') AS setupCompleted
     FROM users WHERE school_id = ? ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [SCHOOL_ID]
  );
  const admin = schoolUsers.filter(user => user.role === 'school_admin');
  assert(admin.length === 1, 'Expected one School Admin.');
  const demoRows = schoolUsers.filter(user => String(user.personalEmail || '').endsWith('@scc-demo.test'));
  assert(demoRows.length === 165, `Expected 165 seeded demo accounts; found ${demoRows.length}.`);
  const byPersonalEmail = new Map(demoRows.map(row => [row.personalEmail, row]));
  assert(byPersonalEmail.size === 165, 'Duplicate seeded personal emails.');
  const [profileRows] = await connection.execute(
    `SELECT u.id, COALESCE(s.middle_name, p.middle_name) AS middleName,
       p.maiden_last_name AS maidenLastName,
       COALESCE(s.religion, p.religion) AS religion,
       COALESCE(s.house_street, p.house_street) AS houseStreet,
       COALESCE(s.barangay, p.barangay) AS barangay
     FROM users u LEFT JOIN student_profiles s ON s.user_id = u.id
     LEFT JOIN parent_profiles p ON p.user_id = u.id
     WHERE u.school_id = ?`, [SCHOOL_ID]
  );
  const profileById = new Map(profileRows.map(row => [Number(row.id), row]));

  const [allUsers] = await connection.query('SELECT id, school_email AS schoolEmail, personal_email AS personalEmail FROM users');
  const demoIds = new Set(demoRows.map(row => String(row.id)));
  const otherSchoolEmails = new Set(allUsers.filter(row => !demoIds.has(String(row.id)))
    .map(row => String(row.schoolEmail).toLowerCase()));
  const otherPersonalEmails = new Set(allUsers.filter(row => !demoIds.has(String(row.id)))
    .map(row => String(row.personalEmail || '').toLowerCase()));
  const legacySchoolEmails = new Set(otherSchoolEmails);
  const oldSchoolEmails = new Set(demoRows.map(row => row.schoolEmail.toLowerCase()));
  const newEmails = new Set();
  const newPersonalEmails = new Set();
  const data = makeData();
  const changes = data.accounts.map((account, index) => {
    const old = legacyIdentity(index);
    const current = byPersonalEmail.get(old.personalEmail);
    assert(current && current.role === expectedRole(index) &&
      current.firstName === old.first && current.lastName === old.last &&
      current.displayName === old.name && current.status === 'active' &&
      current.added === DEMO_DATE && current.setupCompleted === DEMO_DATE,
    `Seeded account ${index + 1} differs from the original fixture. Nothing was changed.`);
    const oldBase = schoolEmailBase(old.first, old.last, account.role);
    let oldSuffix = 1;
    let oldSchoolEmail = schoolEmailCandidate(oldBase, domain, oldSuffix);
    while (legacySchoolEmails.has(oldSchoolEmail)) {
      oldSchoolEmail = schoolEmailCandidate(oldBase, domain, ++oldSuffix);
    }
    assert(current.schoolEmail === oldSchoolEmail,
      `Seeded account ${index + 1} has a changed school email. Nothing was changed.`);
    legacySchoolEmails.add(oldSchoolEmail);
    if (account.role !== 'teacher') {
      const profile = profileById.get(Number(current.id));
      const expectedProfile = legacyProfile(index);
      assert(profile && profile.middleName === expectedProfile.middle &&
        (account.role !== 'parent' || profile.maidenLastName === expectedProfile.maiden) &&
        profile.religion === expectedProfile.religion &&
        profile.houseStreet === expectedProfile.houseStreet &&
        profile.barangay === expectedProfile.barangay,
      `Seeded account ${index + 1} has an edited profile. Nothing was changed.`);
    }
    const base = schoolEmailBase(account.first, account.last, account.role);
    let suffix = 1;
    let schoolEmail = schoolEmailCandidate(base, domain, suffix);
    while (otherSchoolEmails.has(schoolEmail) || newEmails.has(schoolEmail) ||
      (oldSchoolEmails.has(schoolEmail) && schoolEmail !== current.schoolEmail)) {
      schoolEmail = schoolEmailCandidate(base, domain, ++suffix);
    }
    assert(!otherPersonalEmails.has(account.personalEmail) &&
      !newPersonalEmails.has(account.personalEmail), `Personal email conflict: ${account.personalEmail}`);
    newEmails.add(schoolEmail);
    newPersonalEmails.add(account.personalEmail);
    return {
      id: Number(current.id), role: account.role,
      old: { first: old.first, last: old.last, name: old.name,
        schoolEmail: current.schoolEmail, personalEmail: current.personalEmail,
        middle: profileById.get(Number(current.id))?.middleName || null,
        maiden: profileById.get(Number(current.id))?.maidenLastName || null,
        religion: profileById.get(Number(current.id))?.religion || null,
        houseStreet: profileById.get(Number(current.id))?.houseStreet || null,
        barangay: profileById.get(Number(current.id))?.barangay || null },
      next: { first: account.first, last: account.last, name: account.name,
        schoolEmail, personalEmail: account.personalEmail,
        middle: account.middle, maiden: account.maiden, sex: account.sex,
        religion: account.religion, houseStreet: account.houseStreet,
        barangay: account.barangay, parentIndex: account.parentIndex }
    };
  });
  for (const change of changes) {
    assert(change.old.schoolEmail === change.next.schoolEmail ||
      !oldSchoolEmails.has(change.next.schoolEmail.toLowerCase()),
    `New school email conflicts with another current demo login: ${change.next.schoolEmail}`);
  }
  assert(new Set(changes.map(change => change.next.first.toLowerCase())).size === 165 &&
    new Set(changes.map(change => change.next.name.toLowerCase())).size === 165 &&
    new Set(changes.map(change => change.next.last.toLowerCase())).size === 145,
  'Unexpected duplicate full names or surnames.');
  return { school: schools[0], admin: admin[0], changes };
}

function fingerprint(manifest) {
  return JSON.stringify({ school: manifest.school, admin: manifest.admin, changes: manifest.changes });
}

async function verify(connection, manifest) {
  const ids = manifest.changes.map(change => change.id);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT id, first_name AS firstName, last_name AS lastName, display_name AS displayName,
       initials, school_email AS schoolEmail, personal_email AS personalEmail
     FROM users WHERE school_id = ? AND id IN (${placeholders})`,
    [SCHOOL_ID, ...ids]
  );
  assert(rows.length === 165, 'Account verification count failed.');
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  for (const change of manifest.changes) {
    const row = byId.get(change.id);
    const next = change.next;
    assert(row && row.firstName === next.first && row.lastName === next.last &&
      row.displayName === next.name && row.schoolEmail === next.schoolEmail &&
      row.personalEmail === next.personalEmail &&
      row.initials === `${next.first[0]}${next.last[0]}`.toUpperCase(),
    `Account ${change.id} did not match the new name and emails.`);
  }
  const [profiles] = await connection.execute(
    `SELECT u.id, COALESCE(s.middle_name, p.middle_name) AS middleName,
       p.maiden_last_name AS maidenLastName,
       COALESCE(s.religion, p.religion) AS religion,
       COALESCE(s.house_street, p.house_street) AS houseStreet,
       COALESCE(s.barangay, p.barangay) AS barangay
     FROM users u LEFT JOIN student_profiles s ON s.user_id = u.id
     LEFT JOIN parent_profiles p ON p.user_id = u.id
     WHERE u.school_id = ? AND u.id IN (${placeholders})`,
    [SCHOOL_ID, ...ids]
  );
  const profilesById = new Map(profiles.map(row => [Number(row.id), row]));
  for (const change of manifest.changes) {
    if (change.role === 'teacher') continue;
    const row = profilesById.get(change.id);
    assert(row && row.middleName === change.next.middle &&
      (change.role !== 'parent' || row.maidenLastName ===
        (change.next.sex === 'female' ? change.next.maiden : null)) &&
      row.religion === change.next.religion &&
      row.houseStreet === change.next.houseStreet &&
      row.barangay === change.next.barangay,
    `Profile ${change.id} did not match the new family details.`);
  }
  const [links] = await connection.execute(
    'SELECT student_user_id AS studentId, parent_user_id AS parentId, relationship FROM student_parent_links WHERE school_id = ?',
    [SCHOOL_ID]);
  assert(links.length === 20, 'Expected exactly 20 parent links.');
  const actualLinks = new Set(links.map(link => `${link.studentId}:${link.parentId}:${link.relationship}`));
  const expectedLinks = manifest.changes.filter(change => change.next.parentIndex !== undefined)
    .map(change => {
      const parent = manifest.changes[change.next.parentIndex];
      return `${change.id}:${parent.id}:${parent.next.sex === 'female' ? 'mother' : 'father'}`;
    });
  assert(actualLinks.size === 20 && expectedLinks.every(link => actualLinks.has(link)),
    'Parent links did not match the planned families.');
  assert(new Set(rows.map(row => row.firstName.toLowerCase())).size === 165 &&
    new Set(rows.map(row => row.displayName.toLowerCase())).size === 165 &&
    new Set(rows.map(row => row.lastName.toLowerCase())).size === 145,
  'An unexpected duplicate name or surname remains.');
  return { accountsVerified: 165, uniqueFirstNames: 165, uniqueFullNames: 165,
    uniqueSurnames: 145, familyLinks: 20 };
}

async function run(options, dependencies = {}) {
  const database = dependencies.database || require('../config/database').getDatabase();
  const snapshot = dependencies.snapshot || takeSnapshot;
  const confirm = dependencies.confirm || (async phrase => {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await input.question(`Type ${phrase} to continue: `)).trim() === phrase; }
    finally { input.close(); }
  });
  let connection;
  let inTransaction = false;
  try {
    connection = await database.getConnection();
    const before = await buildManifest(connection);
    const changed = before.changes.filter(change => change.old.name !== change.next.name);
    console.log(JSON.stringify({ mode: options.apply ? 'apply-preview' : 'preview',
      school: { id: before.school.id, name: before.school.name },
      accountsChecked: before.changes.length, accountsToRename: changed.length,
      studentAndParentProfilesToCheck: 145,
      familiesToLink: 10, studentsToLink: 20,
      unchangedAdmin: { id: before.admin.id, name: before.admin.displayName },
      confirmationPhrase: CONFIRMATION }, null, 2));
    for (const change of changed) {
      console.log(`${change.id} | ${change.old.name} -> ${change.next.name} | ${change.old.schoolEmail} -> ${change.next.schoolEmail} | ${change.old.personalEmail} -> ${change.next.personalEmail}`);
    }
    for (const change of before.changes.filter(item => item.next.parentIndex !== undefined)) {
      const parent = before.changes[change.next.parentIndex];
      console.log(`FAMILY | ${parent.next.name} -> ${change.next.name} | ${change.next.houseStreet}, ${change.next.barangay}, Lingayen | ${change.next.religion}`);
    }
    if (!options.apply) return { preview: before };
    assert(await confirm(CONFIRMATION), 'Confirmation did not match. Nothing was changed.');
    connection.release();
    connection = null;
    console.log('Taking a fresh RDS snapshot...');
    const snapshotId = snapshot();
    connection = await database.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const current = await buildManifest(connection, true);
    assert(fingerprint(current) === fingerprint(before),
      'School or account data changed since preview. Nothing was changed.');
    for (const change of current.changes) {
      const next = change.next;
      if (change.old.name !== next.name || change.old.schoolEmail !== next.schoolEmail ||
          change.old.personalEmail !== next.personalEmail) {
        const [result] = await connection.execute(
          `UPDATE users SET first_name=?, last_name=?, display_name=?, initials=?,
             school_email=?, personal_email=? WHERE id=? AND school_id=? AND personal_email=?`,
          [next.first, next.last, next.name, `${next.first[0]}${next.last[0]}`.toUpperCase(),
            next.schoolEmail, next.personalEmail, change.id, SCHOOL_ID, change.old.personalEmail]
        );
        assert(result.affectedRows === 1, `Account ${change.id} was not updated.`);
      }
      if (change.role === 'student') {
        await connection.execute(`UPDATE student_profiles SET middle_name=?, religion=?,
          house_street=?, barangay=? WHERE user_id=?`,
        [next.middle, next.religion, next.houseStreet, next.barangay, change.id]);
      } else if (change.role === 'parent') {
        await connection.execute('UPDATE parent_profiles SET middle_name=?, maiden_last_name=? WHERE user_id=?',
          [next.middle, next.sex === 'female' ? next.maiden : null, change.id]);
      }
    }
    for (const change of current.changes.filter(item => item.next.parentIndex !== undefined)) {
      const parent = current.changes[change.next.parentIndex];
      await connection.execute(`INSERT INTO student_parent_links
        (school_id,student_user_id,parent_user_id,relationship,created_at)
        VALUES (?,?,?,?,?)`,
      [SCHOOL_ID, change.id, parent.id, parent.next.sex === 'female' ? 'mother' : 'father', DEMO_DATE]);
    }
    const verified = await verify(connection, current);
    await connection.execute(
      `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
       VALUES (?, NULL, 'demo_names_corrected', 'school', ?, ?)`,
      [SCHOOL_ID, SCHOOL_ID, JSON.stringify({ summary: 'Corrected mock names and linked ten demo families',
        snapshotId, accountsRenamed: changed.length, studentsLinked: 20 })]
    );
    await connection.commit();
    inTransaction = false;
    console.log(JSON.stringify({ mode: 'complete', schoolId: SCHOOL_ID, snapshotId,
      accountsRenamed: changed.length, verified }, null, 2));
    return { mode: 'complete', verified };
  } catch (error) {
    if (inTransaction) await connection.rollback();
    throw error;
  } finally {
    connection?.release();
  }
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  assert(process.env.DB_NAME === 'academix', 'DB_NAME must be academix.');
  const args = process.argv.slice(2);
  assert(args.length === 1 && ['--preview', '--apply'].includes(args[0]), 'Use --preview or --apply.');
  const database = require('../config/database').getDatabase();
  try { await run({ apply: args[0] === '--apply' }, { database }); }
  finally { await database.end(); }
}

if (require.main === module) main().catch(error => {
  console.error('Demo-name correction stopped:', error.message);
  process.exitCode = 1;
});

module.exports = { buildManifest, verify, run, CONFIRMATION };
