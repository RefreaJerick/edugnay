const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let calls;
let state;

function createState(overrides = {}) {
  const grades = [71, 72, 73, 74].map(id => ({ id }));
  const jhsScopes = grades.map(grade => ({ gradeLevelId: grade.id, levelCode: 'jhs', levelEnabled: 1, gradeEnabled: 1 }));
  return {
    subjectSchoolId: 1,
    subjectActive: true,
    savedJournalSubjectId: 1,
    jhsEnabled: true,
    enabledJhsGrades: grades,
    subjects: {
      1: { id: 1, name: 'Values Education', subjectCode: 'values-education-jhs', schoolLevelId: 10, gradeLevelId: null, schoolLevelCode: 'jhs' },
      2: { id: 2, name: 'English', subjectCode: 'english', schoolLevelId: 10, gradeLevelId: null, schoolLevelCode: 'jhs' }
    },
    scopesBySubject: { 1: jhsScopes, 2: jhsScopes },
    reportWeekSettings: { weekStartDay: 1, weekEndDay: 6 },
    configuredJournal: true,
    featureRowPresent: true,
    featureValues: {
      gradesEnabled: 1,
      narrativeReportsEnabled: 1,
      journalsEnabled: 1,
      attendanceEnabled: 1,
      sfTemplatesEnabled: 1
    },
    studentJhsPlacement: true,
    committed: false,
    rolledBack: false,
    ...overrides
  };
}

const connection = {
  async beginTransaction() {
    calls.push('BEGIN');
    state.transactionSnapshot = {
      featureValues: state.featureValues ? { ...state.featureValues } : null,
      savedJournalSubjectId: state.savedJournalSubjectId,
      reportWeekSettings: { ...state.reportWeekSettings }
    };
  },
  async commit() { calls.push('COMMIT'); state.committed = true; },
  async rollback() {
    calls.push('ROLLBACK');
    if (state.transactionSnapshot) Object.assign(state, state.transactionSnapshot);
    state.rolledBack = true;
  },
  release() {},
  async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.startsWith('INSERT INTO school_portal_features')) {
      state.featureRowPresent = true;
      state.featureValues ||= {
        gradesEnabled: 0,
        narrativeReportsEnabled: 0,
        journalsEnabled: 0,
        attendanceEnabled: 0,
        sfTemplatesEnabled: 0
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT grades_enabled AS gradesEnabled')) return [state.featureRowPresent ? [state.featureValues] : []];
    if (sql.startsWith('UPDATE school_portal_features SET ai_evidence_approved_at')) {
      state.featureValues.aiEvidenceApprovedAt = values[0];
      state.featureValues.aiEvidenceApprovedByUserId = values[1];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE school_portal_features SET')) {
      state.featureValues = {
        ...(state.featureValues?.aiEvidenceApprovedAt !== undefined ? {
          aiEvidenceApprovedAt: state.featureValues.aiEvidenceApprovedAt,
          aiEvidenceApprovedByUserId: state.featureValues.aiEvidenceApprovedByUserId
        } : {}),
        gradesEnabled: values[0],
        narrativeReportsEnabled: values[1],
        journalsEnabled: values[2],
        attendanceEnabled: values[3],
        sfTemplatesEnabled: values[4]
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM school_portal_features') && sql.includes('journal_subjects')) return [state.configuredJournal ? [{ id: 9, schoolId: 1, subjectId: state.savedJournalSubjectId || 1, name: 'Values Education', isActive: 1 }] : []];
    if (sql.includes('journal_subject_id AS journalSubjectId') && sql.includes('FROM school_settings')) return [[{
      journalSubjectId: state.savedJournalSubjectId ?? 1,
      ...state.reportWeekSettings
    }]];
    if (sql.startsWith('UPDATE school_settings SET journal_subject_id')) {
      if (state.failWeekUpdate) throw new Error('Week settings write failed');
      state.savedJournalSubjectId = values[0];
      state.reportWeekSettings = { weekStartDay: values[1], weekEndDay: values[2] };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM school_settings')) return [[{ subjectId: state.savedJournalSubjectId ?? 1, journalSubjectId: state.savedJournalSubjectId ?? 1 }]];
    if (sql.includes('FROM subjects\n    LEFT JOIN school_levels')) {
      const subject = state.subjects?.[String(values[0])];
      return [[subject && state.subjectActive && state.subjectSchoolId === values[1] ? subject : undefined].filter(Boolean)];
    }
    if (sql.includes("FROM school_levels WHERE school_id = ? AND level_code = 'jhs'")) return [state.jhsEnabled ? [{ id: 10 }] : []];
    if (sql.includes('FROM school_grade_levels\n    WHERE school_id = ? AND school_level_id = ?')) return [state.enabledJhsGrades || []];
    if (sql.includes('FROM subject_grade_scopes AS scopes')) return [state.scopesBySubject?.[String(values[1])] || []];
    if (sql.includes('FROM section_students') && sql.includes('academic_years.status = \'active\'')) return [state.studentJhsPlacement ? [{ id: 8 }] : []];
    if (sql.includes('FROM sections\n')) return [values[1] === 4 ? [{ id: 8, schoolId: 1, academicYearId: 3, name: 'St. John', studentCount: 12, gradeLevelName: 'Grade 9' }] : []];
    if (sql.includes('FROM journal_prompts')) return [[]];
    if (sql.includes('FROM student_journal_entries')) return [[]];
    if (sql.startsWith('INSERT INTO journal_subjects') && state.failInsert) throw new Error('Database write failed');
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 3 }];
    return [{ affectedRows: 1 }];
  }
};
databaseModule.getDatabase = () => ({ getConnection: async () => connection, execute: (...args) => connection.execute(...args) });
const { getPortalFeatures, updatePortalFeatures } = require('../controllers/schoolsController');
const { listJournalSections } = require('../controllers/journalsController');

async function save(body, user = { id: 3, schoolId: 1, role: 'school_admin' }, overrides = {}) {
  calls = [];
  state = createState(overrides);
  const result = {};
  await updatePortalFeatures({ user, body }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('school admin approval records an actor and revocation disables future AI evidence sharing', async () => {
  const approved = await save({ aiEvidenceApproved: true });
  assert.equal(approved.error, undefined);
  assert.equal(approved.body.features.aiEvidenceApproved, true);
  assert.equal(state.featureValues.aiEvidenceApprovedByUserId, 3);
  assert.ok(calls.some(call => call.sql?.includes('INSERT INTO audit_logs') && call.values[2] === 'ai_report_evidence_approved'));
  const savedValues = { ...state.featureValues };
  const revoked = await save({ aiEvidenceApproved: false }, undefined, { featureValues: savedValues });
  assert.equal(revoked.error, undefined);
  assert.equal(revoked.body.features.aiEvidenceApproved, false);
  assert.equal(state.featureValues.aiEvidenceApprovedAt, null);
  assert.ok(calls.some(call => call.sql?.includes('INSERT INTO audit_logs') && call.values[2] === 'ai_report_evidence_approval_revoked'));
});

async function loadFeatures(user = { id: 3, schoolId: 1, role: 'school_admin' }) {
  calls = [];
  const result = {};
  await getPortalFeatures({ user }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  return result;
}

test('portal features return the saved journal subject', async () => {
  calls = [];
  state = createState();
  const result = {};
  await getPortalFeatures({ user: { schoolId: 1, role: 'teacher' } }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; }
  }, error => { result.error = error; });
  assert.equal(result.body.journalSubjectId, 1);
  assert.equal(result.body.journalSubjectName, 'Values Education');
  assert.equal(result.body.journalSubjectEligible, true);
});

test('SF Templates can be enabled and disabled, with changes returned after reload', async () => {
  const enabled = await save({ sfTemplatesEnabled: true });
  assert.equal(enabled.error, undefined);
  assert.equal(enabled.body.features.sfTemplatesEnabled, true);
  assert.equal((await loadFeatures()).body.features.sfTemplatesEnabled, true);

  const savedValues = { ...state.featureValues };
  const disabled = await save({ sfTemplatesEnabled: false }, undefined, { featureValues: savedValues });
  assert.equal(disabled.error, undefined);
  assert.equal(disabled.body.features.sfTemplatesEnabled, false);
  assert.equal(calls.some(call => /DELETE FROM school_form_(templates|exports)/i.test(call.sql || '')), false);
  assert.equal((await loadFeatures()).body.features.sfTemplatesEnabled, false);
});

test('saving portal features creates a missing row and keeps Attendance enabled', async () => {
  const result = await save(
    { sfTemplatesEnabled: true },
    { id: 3, schoolId: 42, role: 'school_admin' },
    { featureRowPresent: false, featureValues: null }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.body.features.sfTemplatesEnabled, true);
  assert.deepEqual(state.featureValues, {
    gradesEnabled: false,
    narrativeReportsEnabled: false,
    journalsEnabled: false,
    attendanceEnabled: true,
    sfTemplatesEnabled: true
  });
  const createRowIndex = calls.findIndex(call => call.sql?.startsWith('INSERT INTO school_portal_features'));
  const readRowIndex = calls.findIndex(call => call.sql?.includes('SELECT grades_enabled AS gradesEnabled'));
  const update = calls.find(call => call.sql?.startsWith('UPDATE school_portal_features SET'));
  assert.ok(createRowIndex >= 0 && createRowIndex < readRowIndex);
  assert.equal(calls[createRowIndex].values[0], 42);
  assert.equal(update.values.at(-1), 42);
  assert.equal(state.committed, true);
});

test('legacy portal-feature updates cannot disable Attendance', async () => {
  const result = await save({ attendanceEnabled: false }, undefined, {
    featureValues: {
      gradesEnabled: 0,
      narrativeReportsEnabled: 0,
      journalsEnabled: 0,
      attendanceEnabled: 0,
      sfTemplatesEnabled: 0
    }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.body.features.attendanceEnabled, true);
  assert.equal(state.featureValues.attendanceEnabled, true);
  const update = calls.find(call => call.sql?.startsWith('UPDATE school_portal_features SET'));
  assert.equal(update.values[3], true);
  assert.equal((await loadFeatures()).body.features.attendanceEnabled, true);
});

test('Portal Features exposes the SF Templates toggle and its value is actionable for teachers', () => {
  const settingsPage = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const teacherPage = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/sf-templates.js'), 'utf8');
  assert.match(settingsPage, /const sfTemplatesEnabled = Boolean\(features\.sfTemplatesEnabled\)/);
  const sfTemplatesToggleIndex = settingsPage.indexOf('name="sfTemplatesEnabled"');
  const journalsToggleIndex = settingsPage.indexOf('name="journalsEnabled"');
  assert.ok(sfTemplatesToggleIndex >= 0 && sfTemplatesToggleIndex < journalsToggleIndex);
  assert.match(settingsPage, /name="sfTemplatesEnabled"\s+\$\{sfTemplatesEnabled \? 'checked' : ''\}/);
  assert.match(settingsPage, /name="journalsEnabled"\s+\$\{journalsEnabled \? 'checked' : ''\}/);
  assert.match(settingsPage, /school-journal-settings-block \$\{journalsEnabled \? '' : 'is-disabled'\}/);
  assert.match(settingsPage, /id="journalSubjectBlock" aria-disabled="\$\{journalsEnabled \? 'false' : 'true'\}"/);
  assert.doesNotMatch(settingsPage, /id="journalSubjectBlock"[^>]*hidden/);
  assert.match(settingsPage, /<select id="journalSubjectId" name="journalSubjectId" \$\{journalsEnabled && \(eligibleJournalSubjects\.length \|\| savedJournalSubjectId\) \? '' : 'disabled'\}>/);
  assert.match(settingsPage, /journalSubjectSelect\.disabled = !isJournalEnabled \|\| \(!eligibleJournalSubjects\.length && !savedJournalSubjectId\)/);
  assert.match(settingsPage, /journalSubjectBlock\.classList\.toggle\('is-disabled', !isJournalEnabled\)/);
  assert.match(settingsPage, /id="journalHistoryBlock"\s+\$\{journalsEnabled \? '' : 'hidden'\}/);
  assert.match(settingsPage, /sfTemplatesEnabled: Boolean\(form\.elements\.sfTemplatesEnabled\?\.checked\)/);
  assert.match(teacherPage, /Ask your school admin to enable SF Templates in School Settings > Portal Features\./);
});

test('changing journal subject saves the feature and subject in one transaction', async () => {
  const result = await save({ journalsEnabled: true, journalSubjectId: 2 });
  assert.equal(result.error, undefined);
  assert.equal(result.body.journalSubjectId, 2);
  assert.equal(state.committed, true);
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO journal_subjects')));
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE school_settings SET journal_subject_id')));
});

test('portal features save report weekdays with feature settings, including while Narrative Reports is disabled', async () => {
  const result = await save({ narrativeReportsEnabled: false, weekStartDay: 2, weekEndDay: 7 });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.reportWeekSettings, { weekStartDay: 2, weekEndDay: 7 });
  assert.deepEqual(state.reportWeekSettings, { weekStartDay: 2, weekEndDay: 7 });
  assert.equal(state.featureValues.narrativeReportsEnabled, false);
  assert.equal(state.committed, true);
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE school_settings SET journal_subject_id')));
  assert.ok(calls.some(call => call.sql?.startsWith('INSERT INTO audit_logs') && call.values.includes('narrative_report_week_updated')));

  const reenabled = await save({ narrativeReportsEnabled: true, weekStartDay: 2, weekEndDay: 7 }, undefined, {
    reportWeekSettings: { weekStartDay: 2, weekEndDay: 7 }
  });
  assert.equal(reenabled.error, undefined);
  assert.equal(reenabled.body.features.narrativeReportsEnabled, true);
  assert.deepEqual(reenabled.body.reportWeekSettings, { weekStartDay: 2, weekEndDay: 7 });
});

test('portal feature updates reject incomplete or invalid weekday pairs before writing', async () => {
  for (const body of [
    { weekStartDay: 1 }, { weekEndDay: 6 }, { weekStartDay: 0, weekEndDay: 6 },
    { weekStartDay: 1, weekEndDay: 1 }, { weekStartDay: 'monday', weekEndDay: 6 }
  ]) {
    const result = await save(body);
    assert.equal(result.error?.status, 400, JSON.stringify(body));
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, false);
    assert.equal(calls.some(call => call.sql?.startsWith('UPDATE school_portal_features SET')), false);
  }
});

test('legacy portal-feature updates preserve saved report weekdays when omitted', async () => {
  const result = await save({ sfTemplatesEnabled: false }, undefined, {
    reportWeekSettings: { weekStartDay: 3, weekEndDay: 5 }
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.reportWeekSettings, { weekStartDay: 3, weekEndDay: 5 });
  assert.deepEqual(state.reportWeekSettings, { weekStartDay: 3, weekEndDay: 5 });
});

test('a failed weekday write rolls back portal-feature changes in the same transaction', async () => {
  const result = await save({ narrativeReportsEnabled: false, weekStartDay: 2, weekEndDay: 5 }, undefined, { failWeekUpdate: true });
  assert.equal(result.error?.message, 'Week settings write failed');
  assert.equal(state.rolledBack, true);
  assert.equal(state.committed, false);
  assert.equal(state.featureValues.narrativeReportsEnabled, 1);
  assert.deepEqual(state.reportWeekSettings, { weekStartDay: 1, weekEndDay: 6 });
  assert.ok(calls.some(call => call.sql?.startsWith('UPDATE school_portal_features SET')));
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('another school or an inactive subject cannot be selected', async () => {
  for (const overrides of [{ subjectSchoolId: 2 }, { subjectActive: false }]) {
    const result = await save({ journalSubjectId: 2 }, undefined, overrides);
    assert.equal(result.error?.status, 400);
    assert.equal(state.committed, false);
    assert.equal(state.rolledBack, true);
  }
});

test('only active JHS-only subjects with enabled grade coverage can be selected', async () => {
  const cases = [
    { name: 'elementary scope', scopesBySubject: { 1: [], 2: [{ gradeLevelId: 20, levelCode: 'elementary', levelEnabled: 1, gradeEnabled: 1 }] } },
    { name: 'SHS scope', scopesBySubject: { 1: [], 2: [{ gradeLevelId: 30, levelCode: 'shs', levelEnabled: 1, gradeEnabled: 1 }] } },
    { name: 'mixed JHS and elementary scope', scopesBySubject: { 1: [], 2: [
      { gradeLevelId: 71, levelCode: 'jhs', levelEnabled: 1, gradeEnabled: 1 },
      { gradeLevelId: 20, levelCode: 'elementary', levelEnabled: 1, gradeEnabled: 1 }
    ] } },
    { name: 'disabled JHS grade', enabledJhsGrades: [] },
    { name: 'disabled JHS level', jhsEnabled: false }
  ];
  for (const scenario of cases) {
    const result = await save({ journalSubjectId: 2 }, undefined, scenario);
    assert.equal(result.error?.status, 400, `${scenario.name} should be rejected`);
    assert.equal(state.rolledBack, true, `${scenario.name} should roll back`);
  }
  const valid = await save({ journalSubjectId: 2 }, undefined, { scopesBySubject: { 1: [], 2: createState().scopesBySubject[2] } });
  assert.equal(valid.error, undefined);
  assert.equal(valid.body.journalSubjectEligible, true);
});

test('a JHS subject can be saved as the default before Journals are enabled', async () => {
  const result = await save({ journalsEnabled: false, journalSubjectId: 1 }, undefined, { savedJournalSubjectId: null });
  assert.equal(result.error, undefined);
  assert.equal(result.body.features.journalsEnabled, false);
  assert.equal(result.body.journalSubjectId, 1);
  assert.equal(result.body.journalSubjectEligible, true);
});

test('invalid subject IDs and enabling journals without a subject fail', async () => {
  const invalid = await save({ journalSubjectId: '2oops' });
  assert.equal(invalid.error?.status, 400);
  const missing = await save({ journalsEnabled: true, journalSubjectId: null });
  assert.equal(missing.error?.status, 400);
});

test('disabling journals keeps its subject without changing journal history', async () => {
  const result = await save({ journalsEnabled: false });
  assert.equal(result.error, undefined);
  assert.equal(result.body.journalSubjectId, 1);
  assert.equal(result.body.features.journalsEnabled, false);
  assert.equal(calls.some(call => call.sql?.includes('DELETE FROM journal_')), false);
});

test('a failed journal-subject write rolls back the feature change', async () => {
  const result = await save({ journalSubjectId: 2 }, undefined, { failInsert: true });
  assert.equal(result.error?.message, 'Database write failed');
  assert.equal(state.rolledBack, true);
  assert.equal(state.committed, false);
});

test('journal sections appear only for a teacher assigned to the selected subject', async () => {
  calls = [];
  state = createState();
  async function sectionsFor(teacherId) {
    const result = {};
    await listJournalSections({ user: { id: teacherId, schoolId: 1, role: 'teacher' } }, {
      json(body) { result.body = body; }
    }, error => { result.error = error; });
    return result;
  }
  assert.equal((await sectionsFor(3)).body.sections.length, 0);
  assert.equal((await sectionsFor(4)).body.sections.length, 1);
  const query = calls.find(call => call.sql?.includes('FROM sections\n'));
  assert.match(query.sql, /section_teachers\.subject_id = \?/);
  assert.match(query.sql, /school_levels\.level_code = 'jhs'/);
  assert.match(query.sql, /school_grade_levels\.is_enabled = TRUE/);
  assert.deepEqual(query.values.slice(0, 2), [1, 3]);
});

test('current student Journals require a JHS placement while history remains available', async () => {
  calls = [];
  state = createState({ studentJhsPlacement: false });
  const result = {};
  const { listJournalSubjects, listJournalHistory } = require('../controllers/journalsController');
  await listJournalSubjects({ user: { id: 8, schoolId: 1, role: 'student' } }, {
    json(body) { result.subjects = body; }
  }, error => { result.subjectError = error; });
  assert.equal(result.subjectError?.status, 403);
  assert.match(result.subjectError.message, /Junior High School/);
  assert.match(calls[0].sql, /school_levels AS journal_levels/);

  calls = [];
  state = createState({ studentJhsPlacement: false });
  const history = {};
  await listJournalHistory({ user: { id: 8, schoolId: 1, role: 'student' }, query: {} }, {
    json(body) { history.body = body; }
  }, error => { history.error = error; });
  assert.equal(history.error, undefined);
  assert.ok(calls.some(call => call.sql.includes('FROM journal_prompts')));
});

test('teacher access and journal reminders use current backend assignments and subject', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../workers/parentNotificationWorker.js'), 'utf8');
  assert.match(teacher, /getJournalSections\(\)/);
  assert.match(teacher, /teacherJournalAccess = sections\.length > 0/);
  assert.match(worker, /settings\.journal_subject_id = journal_subjects\.subject_id/);
  assert.match(worker, /level_code = 'jhs'/);
  assert.match(worker, /subject_grade_scopes/);
});

test('teacher journal navigation renders cached links but page guards use refreshed access', () => {
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  const init = teacher.slice(teacher.indexOf("document.addEventListener('DOMContentLoaded', async () => {"));
  assert.ok(init.indexOf('applyTeacherSidebarSnapshot(cachedSnapshot)') < init.indexOf('getJournalSections()'));
  assert.ok(init.indexOf('getJournalSections()') < init.indexOf('if (guardTeacherPageAccess()) return;'));
  assert.ok(init.indexOf('if (guardTeacherPageAccess()) return;') < init.indexOf('await window.EDUGNAY_COMMUNICATION_READY'));
  const accessCheck = teacher.match(/function teacherCanAccess\(feature\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(accessCheck, /cachedSnapshot|teacherNavigationCanAccess/);
});

test('school settings and teacher shell scripts parse after journal changes', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../../views/admin/edugnay-admin-schools.html'), 'utf8');
  const adminStyles = fs.readFileSync(path.join(__dirname, '../../assets/css/admin/schools.css'), 'utf8');
  assert.match(admin, /state\.apiJournalSubjectId = portal\.journalSubjectId/);
  assert.match(admin, /values-education-jhs/);
  assert.match(admin, /journalGradeLabel/);
  assert.match(admin, /defaultJournalSubject = eligibleJournalSubjects\.find\(subject => subject\.journalDefault\)/);
  assert.match(admin, /escapeHtml\(subject\.name\).*escapeHtml\(subject\.journalGradeLabel\)/);
  assert.match(admin, /schoolLevelCode === 'jhs'/);
  assert.match(admin, /apiJournalSubjectEligible = portal\.journalSubjectEligible/);
  assert.match(admin, /journalSubjectId: journalSubjectId \? Number\(journalSubjectId\) : null/);
  assert.match(admin, /state\.apiSubjects = subjects\.filter\(subject => subject\.isActive\)/);
  assert.match(admin, /school-journal-settings-block \$\{journalsEnabled \? '' : 'is-disabled'\}/);
  assert.match(admin, /id="journalSubjectBlock" aria-disabled="\$\{journalsEnabled \? 'false' : 'true'\}"/);
  assert.doesNotMatch(admin, /id="journalSubjectBlock"[^>]*hidden/);
  assert.match(admin, /journalSubjectSelect\.disabled = !isJournalEnabled \|\| \(!eligibleJournalSubjects\.length && !savedJournalSubjectId\)/);
  assert.match(admin, /journalSubjectBlock\.classList\.toggle\('is-disabled', !isJournalEnabled\)/);
  assert.match(admin, /id="journalHistoryBlock" \$\{journalsEnabled \? '' : 'hidden'\}/);
  assert.match(admin, /class="top-btn secondary" type="button" id="viewSchoolJournalHistory"/);
  assert.match(admin, /getElementById\('viewSchoolJournalHistory'\)\?\.addEventListener\('click', openSchoolJournalHistory\)/);
  assert.match(admin, /journalHistoryBlock\.hidden = !isJournalEnabled/);
  assert.match(admin, /form\.elements\.journalSubjectId\?\.value \?\? state\.apiJournalSubjectId/);
  assert.match(admin, /journalToggle\?\.addEventListener\('change', syncJournalSections\)/);
  assert.match(adminStyles, /\.school-journal-history-block\s*\{\s*border-top:\s*0;/);
  assert.match(adminStyles, /\.school-portal-settings-column > \.school-portal-setting-block\s*\{[^}]*padding:\s*16px;[^}]*border:\s*1px solid var\(--gray-200\);[^}]*border-radius:\s*var\(--radius-md\);[^}]*background:\s*var\(--gray-50\);/s);
  assert.doesNotMatch(adminStyles, /\.school-journal-settings-block\.is-disabled\s*\{/);
  for (const [, source] of admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (source.trim()) new vm.Script(source);
  }
  const teacher = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/shell.js'), 'utf8');
  new vm.Script(teacher);
  const student = fs.readFileSync(path.join(__dirname, '../../assets/js/student/shell.js'), 'utf8');
  assert.match(student, /schoolLevel === 'elementary' \|\| schoolLevel === 'shs'/);
  assert.match(student, /studentJournalHistoryAvailable !== null/);
  new vm.Script(student);
  const journalPage = fs.readFileSync(path.join(__dirname, '../../views/student/edugnay-student-journal.html'), 'utf8');
  assert.doesNotMatch(journalPage, /user\.schoolLevel !== 'jhs'/);
  for (const [, source] of journalPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (source.trim()) new vm.Script(source);
  }
});
