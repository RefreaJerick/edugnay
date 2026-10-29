const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const databaseModule = require('../config/database');
let database;
databaseModule.getDatabase = () => database;
const controller = require('../controllers/shsProgramController');
const timetable = require('../controllers/timetablesController');
const { CATALOG_VERSION, catalog, getCatalogEntry } = require('../config/shsApprovedCatalog');
const { pathwayReadiness } = require('../config/shsReadiness');

const root = path.join(__dirname, '../..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { this.ended = true; return this; } });

test('SHS Program loads track labels from the qualified track display name', async () => {
  const queries = [];
  const tracks = [
    { code: 'academic', label: 'Academic' },
    { code: 'techpro', label: 'TechPro' }
  ];
  database = { async execute(sql) {
    queries.push(sql);
    if (sql.includes('FROM school_shs_tracks')) return [tracks];
    return [[]];
  } };

  const res = response();
  let error;
  await controller.list({ user: { schoolId: 2 }, query: {} }, res, value => { error = value; });

  const trackQuery = queries.find(sql => sql.includes('FROM school_shs_tracks'));
  assert.match(trackQuery, /t\.track_code AS code, t\.display_name AS label/);
  assert.deepEqual(res.body.tracks, tracks);
  assert.equal(Object.hasOwn(res.body, 'readiness'), false);
  assert.equal(error, undefined);
});

test('SHS Program flags active Work Immersion memberships from a different home track for staff review', async () => {
  let query;
  const counts = await controller.mismatchedImmersionMemberships({ async execute(sql, args) {
    query = { sql, args };
    return [[
      { classId: 91, learnerId: 501, catalogCode: 'WI-320', learnerTrackCode: 'academic' },
      { classId: 91, learnerId: 502, catalogCode: 'WI-320', learnerTrackCode: 'academic' },
      { classId: 91, learnerId: 503, catalogCode: 'WI-ACADEMIC-320', learnerTrackCode: 'academic' },
      { classId: 92, learnerId: 504, catalogCode: 'WI-640', learnerTrackCode: 'techpro' }
    ]];
  } }, 7, 2027);
  assert.match(query.sql, /m\.withdrawn_at IS NULL/);
  assert.match(query.sql, /ss\.withdrawn_at IS NULL/);
  assert.match(query.sql, /s\.shs_curriculum_code = 'strengthened_2026'/);
  assert.match(query.sql, /o\.catalog_code IN \(/);
  assert.match(query.sql, /o\.academic_year_id = \?/);
  assert.deepEqual(query.args.slice(0, 2), [7, 2027]);
  assert.deepEqual([...counts], [[91, 2]], 'only learners mismatched with the catalog track should be flagged');
  const page = read('assets/js/admin/shs-program.js');
  assert.match(page, /trackReviewCount/);
  assert.match(page, /Their enrollment has not been changed/);
  const programPage = read('views/admin/edugnay-admin-shs-program.html');
  assert.match(programPage, /Academic electives, Academic Field Experience, TechPro electives, and TechPro Work Immersion/);
});

test('SHS Program uses two staff tabs and no longer exposes readiness or completion features', async () => {
  const route = read('backend/routes/shsProgram.js');
  const api = read('assets/js/shell-common.js');
  const page = read('views/admin/edugnay-admin-shs-program.html');
  const client = read('assets/js/admin/shs-program.js');
  assert.match(page, /role="tablist"/);
  assert.match(page, /data-shs-tab="subjects"/);
  assert.match(page, /data-shs-tab="choices"/);
  assert.match(page, /class="mgmt-tabs shs-tabs"/);
  assert.match(page, /class="mgmt-tab shs-tab active"[^>]*aria-selected="true"/);
  assert.match(client, /tab\.classList\.toggle\('active', selected\)/);
  assert.match(read('assets/css/shs-program.css'), /\.shs-tabs\s*\{\s*margin-bottom:\s*0;/);
  assert.doesNotMatch(page, /Pathway readiness|Grade 12 program completion|shs-completion-list|shs-readiness/i);
  assert.doesNotMatch(route, /completion|confirm/);
  assert.doesNotMatch(api, /getShsCompletion|confirmShsCompletion|verifyShsPrior|recordShsPrior/);
  assert.doesNotMatch(client, /getShsCompletion|confirmShsCompletion|verifyShsPrior|recordShsPrior|loadCompletion|renderCompletion/);
});

test('SHS subject filters live inside their panel and class menu actions have decorative icons', () => {
  const page = read('views/admin/edugnay-admin-shs-program.html');
  const client = read('assets/js/admin/shs-program.js');
  const styles = read('assets/css/shs-program.css');
  const panelStart = page.indexOf('aria-label="Subject classes"');
  const toolbar = page.indexOf('class="shs-toolbar shs-subject-toolbar"');
  const offerings = page.indexOf('id="shs-offerings"');

  assert.ok(panelStart >= 0 && toolbar > panelStart && offerings > toolbar,
    'Grade, Track, and Add subject should appear inside Subject classes before the list');
  assert.doesNotMatch(page, /<section class="timetable-card" aria-label="Subject class filters"/,
    'the filters should no longer have a separate panel');
  assert.match(page, /aria-label="School year"[\s\S]*id="shs-year"/,
    'the separate School year selector stays unchanged');
  assert.match(client, /data-edit-class="\$\{c\.id\}"[^>]*><i data-lucide="pencil" aria-hidden="true"><\/i>Edit class/);
  assert.match(client, /data-schedule-class="\$\{c\.id\}"[^>]*><i data-lucide="calendar-days" aria-hidden="true"><\/i>Schedule/);
  assert.match(client, /data-toggle-class="\$\{c\.id\}"[^>]*><i data-lucide="\$\{classActive \? 'pause' : 'play'\}" aria-hidden="true"><\/i>/);
  assert.match(client, /data-delete-class="\$\{c\.id\}"[^>]*><i data-lucide="trash-2" aria-hidden="true"><\/i>Delete class/);
  assert.match(styles, /\.shs-class-menu-item svg\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s);
});

test('SHS approved-subject form keeps the searchable multiselect visible in a responsive two-column dialog', () => {
  const page = read('views/admin/edugnay-admin-shs-program.html');
  const client = read('assets/js/admin/shs-program.js');
  const studentClient = read('assets/js/student/shs-selection.js');
  const selectionController = read('backend/controllers/shsSelectionController.js');
  const styles = read('assets/css/shs-program.css');
  assert.match(page, /id="shs-catalog-search" type="search"/);
  assert.match(page, /id="shs-catalog-choices" class="shs-catalog-choices" role="group"/);
  assert.match(page, /id="shs-offering-layout"[\s\S]*id="shs-dialog-grade"[\s\S]*id="shs-catalog-choices"[\s\S]*id="shs-catalog-clear"[\s\S]*id="shs-catalog-summary"/);
  assert.doesNotMatch(page, /shs-selected-summary/);
  assert.match(page, /<div class="shs-catalog-info-banner" role="note"><span class="shs-catalog-info-icon"><i data-lucide="info" aria-hidden="true"><\/i><\/span><p>Grade 11 core subjects are set up in Class Management\.[\s\S]*?<\/p><\/div>/);
  assert.match(page, /<div class="shs-catalog-actions"><button id="shs-catalog-clear" type="button">Clear selection<\/button><span id="shs-catalog-summary" class="shs-catalog-count" aria-live="polite" aria-atomic="true">0 selected<\/span><\/div>/);
  assert.match(styles, /\.shs-catalog-info-banner\s*\{[^}]*background:\s*var\(--blue-xpale\)/s);
  assert.match(styles, /\.shs-catalog-actions\s*\{[^}]*justify-content:\s*space-between/s);
  assert.match(styles, /\.shs-catalog-count\s*\{[^}]*font-size:\s*11px/s);
  assert.equal([...client.matchAll(/\$\('shs-catalog-summary'\)\.textContent = `\$\{state\.catalogCodes\.size\} selected`;/g)].length, 2);
  assert.doesNotMatch(page, /shs-catalog-trigger|shs-catalog-menu|shs-catalog-done/);
  assert.match(styles, /\.shs-dialog\.shs-offering-dialog\s*\{[^}]*width:\s*min\(820px/s);
  assert.match(styles, /\.shs-offering-layout\s*\{[^}]*grid-template-columns:\s*minmax\(190px,\s*\.72fr\)\s+minmax\(0,\s*1\.28fr\)/s);
  assert.match(styles, /\.timetable-field\.shs-catalog-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.shs-catalog-choices\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /@media\s*\(max-width:\s*680px\)[\s\S]*\.shs-offering-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(styles, /\.timetable-field \.shs-catalog-choice\s*\{[^}]*text-transform:\s*none/s);
  assert.match(styles, /\.timetable-field \.shs-catalog-choice:has\(input:checked\)/);
  assert.match(styles, /\.shs-catalog-group\s*\{/);
  assert.match(client, /key:\s*'academic_electives',\s*label:\s*'Academic electives'/);
  assert.match(client, /key:\s*'field_experience',\s*label:\s*'Field Experience \(Academic\)'/);
  assert.match(client, /key:\s*'techpro_electives',\s*label:\s*'TechPro electives'/);
  assert.match(client, /key:\s*'techpro_work_immersion',\s*label:\s*'TechPro Work Immersion'/);
  assert.match(client, /item\.trackCode === track/);
  assert.match(client, /filteredSelectable\.filter\(item => item\.catalogGroup === group\.key\)/);
  assert.match(client, /filteredPending\.map\(item =>/);
  assert.match(client, /item\.verificationStatus === 'verified'/);
  const pendingMarkup = client.match(/const pendingMarkup = ([\s\S]*?)\n    \$\('shs-catalog-choices'\)/)?.[1] || '';
  assert.match(pendingMarkup, /aria-disabled="true"/);
  assert.match(pendingMarkup, /catalogHoursLabel\(item, grade\.code\)/);
  assert.doesNotMatch(pendingMarkup, /<input/);
  assert.match(client, /shs-choice-category[^>]*>\$\{escape\(catalogGroupLabel\(item\.catalogGroup\)\)\}/);
  assert.match(studentClient, /shs-saved-choice-meta[^>]*>\$\{escape\(item\.className\)\} &middot; \$\{escape\(item\.teacherName\)\}/);
  assert.match(studentClient, /shs-saved-choice-schedule[^>]*>\$\{escape\(meetings \|\| 'Schedule not set yet'\)\}/);
  assert.match(selectionController, /savedClasses, dataIssue/);
  assert.match(selectionController, /item\.assessmentGroup === 'work_immersion' && item\.trackCode !== place\.trackCode/);
  assert.match(selectionController, /wrongTrackImmersion/);
  assert.match(client, /shs-offering-dialog', isOffering/);
  assert.match(client, /shs-offering-layout'\)\.hidden = !isOffering/);
  assert.match(client, /catalogCodes\.add\(event\.target\.value\)/);
  assert.match(client, /catalogCodes: \[\.\.\.state\.catalogCodes\]/);
});

test('SHS offering cards have responsive layout, clear actions, and shared status-pill styling', () => {
  const client = read('assets/js/admin/shs-program.js');
  const styles = read('assets/css/shs-program.css');
  const sharedStyles = read('assets/css/styles.css');

  assert.match(styles, /\.shs-class-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.shs-class-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.shs-class-list\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styles, /\.shs-class\s*\{[^}]*border:\s*1px solid var\(--gray-200\)[^}]*background:\s*var\(--theme-surface\)/s);
  assert.match(styles, /\.shs-class\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+35px[^}]*column-gap:\s*12px/s);
  assert.match(styles, /\.shs-class-menu\s*\{[^}]*justify-self:\s*end[^}]*align-self:\s*start/s);
  assert.match(styles, /\.shs-class-copy\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /\.shs-offering-head\s*>\s*div\s*>\s*span/);
  assert.match(styles, /\.shs-class-copy\s*>\s*span/);
  assert.match(styles, /\.shs-class-menu-trigger\s*\{[^}]*width:\s*35px[^}]*min-height:\s*34px/s);
  assert.match(styles, /\.shs-class-action-menu\s*\{[^}]*display:\s*none[^}]*width:\s*160px/s);
  assert.match(styles, /\.shs-class-action-menu\.open\s*\{\s*display:\s*grid;/);
  assert.match(read('assets/css/admin/management.css'), /\.section-action-menu\s*\{[^}]*display:\s*none[^}]*width:\s*160px/s);
  assert.doesNotMatch(styles, /\.shs-offering span\s*,/);

  assert.match(client, /class="timetable-button" type="button" data-add-class=/);
  assert.match(client, /class="shs-class-menu-trigger"[^>]*data-class-menu-toggle=/);
  assert.match(client, /class="shs-class-action-menu"[^>]*role="menu"[^>]*aria-labelledby=/);
  assert.match(client, /role="menuitem" data-edit-class=/);
  assert.match(client, /role="menuitem" data-schedule-class=/);
  assert.match(client, /role="menuitem" data-toggle-class=/);
  assert.match(client, /role="menuitem" data-delete-class=/);
  assert.match(client, /data-edit-class="\$\{c\.id\}" \$\{archived \? 'disabled' : ''\}/);
  assert.match(client, /data-toggle-class="\$\{c\.id\}" \$\{archived \? 'disabled' : ''\}/);
  assert.match(client, /data-delete-class="\$\{c\.id\}" \$\{archived \? 'disabled' : ''\}/);
  assert.match(client, /deleteShsClass\(state\.deleteClassId\)/);
  assert.match(client, /updateShsClass\(item\.id, \{ isActive: nextActive \}\)/);
  assert.match(client, /function closeClassMenus\(restoreFocus = false\)/);
  assert.match(client, /if \(event\.key === 'Escape'\)[\s\S]*closeClassMenus\(true\)/);
  assert.match(client, /document\.addEventListener\('click',[\s\S]*!event\.target\.closest\('\.shs-class-menu'\)[\s\S]*closeClassMenus\(\)/);
  assert.match(client, /event\.key === 'ArrowDown'[\s\S]*querySelector\('\[role="menuitem"/);
  assert.match(client, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(client, /shs-delete-overlay/);
  assert.match(client, /shs-delete-overlay'\)\.addEventListener\('keydown'[\s\S]*event\.key !== 'Tab'/);
  assert.match(read('backend/routes/shsProgram.js'), /router\.delete\('\/classes\/:classId', controller\.deleteClass\)/);
  assert.match(client, /closeDeleteClass\(\{ restoreFocus: false \}\);[\s\S]*load\(yearId\);[\s\S]*querySelector\('\.shs-class-menu-trigger'\)[\s\S]*Class deleted\./);
  assert.match(client, /catch \(error\) \{[\s\S]*shs-delete-error/);
  assert.match(client, /data-add-class=/);
  assert.match(client, /data-toggle="\$\{item\.id\}"/);
  assert.match(client, /href="edugnay-admin-timetables\.html\?academicYearId=/);
  assert.match(styles, /\.shs-class-menu-item\s*\{[^}]*text-decoration:\s*none/s);
  assert.match(styles, /\.shs-class-menu-item:hover\s*\{[^}]*text-decoration:\s*none/s);
  assert.match(styles, /\.shs-class-menu-item\.delete/);
  assert.match(client, /class="badge \$\{active \? 'badge-green' : 'badge-gray'\}"/);
  assert.match(sharedStyles, /\.badge,[\s\S]*?border-radius:\s*var\(--radius-pill\)[\s\S]*?color:\s*var\(--pill-color/);
});

test('SHS class deletion removes only an unused active-year class and records the action', async () => {
  const calls = [];
  const classRow = { id: 91, school_id: 7, offering_id: 31, academicYearId: 2027, yearStatus: 'active', class_name: 'Group A' };
  database = { async getConnection() { return {
    async beginTransaction() { calls.push({ type: 'begin' }); },
    async commit() { calls.push({ type: 'commit' }); },
    async rollback() { calls.push({ type: 'rollback' }); },
    release() {},
    async execute(sql, args = []) {
      calls.push({ sql, args });
      if (sql.includes('FROM shs_elective_classes c')) return [[classRow]];
      if (sql.includes('SELECT id FROM academic_years')) return [[{ id: 2027 }]];
      if (sql.includes('SELECT id FROM shs_elective_classes WHERE')) return [[{ id: 91 }]];
      if (sql.includes('AS timetableRecords')) return [[{
        timetableRecords: 0, membershipRecords: 0, choiceRecords: 0, assignmentRecords: 0,
        assessmentRecords: 0, publishedGrades: 0, gradeHistory: 0, attendanceRecords: 0, materialRecords: 0
      }]];
      if (sql.includes('FROM shs_selection_history')) return [[{ total: 0 }]];
      if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
      if (sql.includes('DELETE FROM shs_elective_classes')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  }; } };

  const res = response();
  let error;
  await controller.deleteClass({ user: { id: 8, schoolId: 7, role: 'school_admin' }, params: { classId: '91' } }, res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  const classLookups = calls.filter(call => call.sql?.includes('FROM shs_elective_classes c'));
  assert.equal(classLookups.length, 2);
  assert.ok(classLookups.every(call => call.args[0] === 91 && call.args[1] === 7), 'class lookup is school-scoped');
  const historyCheck = calls.find(call => call.sql?.includes('FROM shs_selection_history'));
  assert.match(historyCheck.sql, /JSON_CONTAINS\(details, JSON_ARRAY\(\?\), '\$\.classIds'\)/);
  assert.match(historyCheck.sql, /JSON_CONTAINS\(details, JSON_ARRAY\(\?\), '\$\.oldClassIds'\)/);
  assert.deepEqual(historyCheck.args, [7, 91, 91]);
  const referencesCheck = calls.find(call => call.sql?.includes('AS timetableRecords'));
  for (const linkedTable of ['scheduled_classes', 'shs_elective_class_students', 'shs_selection_request_classes',
    'assignments', 'grading_items', 'published_final_grades', 'shs_grade_publication_history',
    'attendance_sessions', 'learning_materials']) assert.match(referencesCheck.sql, new RegExp(`FROM ${linkedTable}\\b`));
  const auditIndex = calls.findIndex(call => call.sql?.includes('INSERT INTO audit_logs'));
  const deleteIndex = calls.findIndex(call => call.sql?.includes('DELETE FROM shs_elective_classes'));
  assert.ok(auditIndex >= 0 && auditIndex < deleteIndex);
  assert.ok(calls.some(call => call.type === 'commit'));
});

test('SHS class updates record the fields that changed for activity messages', async () => {
  const calls = [];
  const classRow = { id: 91, school_id: 7, offering_id: 31, academicYearId: 2027,
    yearStatus: 'active', class_name: 'Group A', teacher_user_id: 8,
    previousTeacherName: 'Maya Santos', capacity: 30, is_active: 1,
    subjectName: 'Creative Composition 1', gradeCode: 'grade-11',
    trackCode: 'academic', schoolYearLabel: '2026-2027' };
  database = { async getConnection() { return {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, args = []) {
      calls.push({ sql, args });
      if (sql.includes('FROM shs_elective_classes c')) return [[classRow]];
      if (sql.includes('FROM users') && sql.includes("role = 'teacher'")) return [[{ id: 8, displayName: 'Maya Santos' }]];
      if (sql.includes('SELECT id FROM academic_years')) return [[{ id: 2027 }]];
      if (sql.includes('COUNT(*) AS total FROM shs_elective_class_students')) return [[{ total: 0 }]];
      if (sql.includes('UPDATE shs_elective_classes')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    }
  }; } };

  const res = response();
  let error;
  await controller.updateClass({ user: { id: 9, schoolId: 7, role: 'school_admin' },
    params: { classId: '91' }, body: { className: 'Group B', capacity: 40 } },
  res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(res.body.id, 91);
  const audit = calls.find(call => call.sql.includes('INSERT INTO audit_logs'));
  const details = JSON.parse(audit.args[5]);
  assert.deepEqual(details.changes, {
    className: { from: 'Group A', to: 'Group B' }, capacity: { from: 30, to: 40 }
  });
  assert.equal(details.subjectName, 'Creative Composition 1');
});

test('SHS class deletion preserves classes with linked history and rejects archived or out-of-school classes', async t => {
  async function invokeDelete({ classExists = true, archived = false, linked = false, history = 0 } = {}) {
    const calls = [];
    const classRow = { id: 91, school_id: 7, offering_id: 31, academicYearId: 2027, yearStatus: archived ? 'archived' : 'active', class_name: 'Group A' };
    database = { async getConnection() { return {
      async beginTransaction() { calls.push({ type: 'begin' }); },
      async commit() { calls.push({ type: 'commit' }); },
      async rollback() { calls.push({ type: 'rollback' }); },
      release() {},
      async execute(sql, args = []) {
        calls.push({ sql, args });
        if (sql.includes('FROM shs_elective_classes c')) return [classExists ? [classRow] : []];
        if (sql.includes('SELECT id FROM academic_years')) return [[{ id: 2027 }]];
        if (sql.includes('SELECT id FROM shs_elective_classes WHERE')) return [[{ id: 91 }]];
        if (sql.includes('AS timetableRecords')) return [[{
          timetableRecords: linked ? 1 : 0, membershipRecords: 0, choiceRecords: 0, assignmentRecords: 0,
          assessmentRecords: 0, publishedGrades: 0, gradeHistory: 0, attendanceRecords: 0, materialRecords: 0
        }]];
        if (sql.includes('FROM shs_selection_history')) return [[{ total: history }]];
        if (sql.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }];
        if (sql.includes('DELETE FROM shs_elective_classes')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${sql}`);
      }
    }; } };
    const res = response();
    let error;
    await controller.deleteClass({ user: { id: 8, schoolId: 7, role: 'school_admin' }, params: { classId: '91' } }, res, value => { error = value; });
    return { calls, res, error };
  }

  await t.test('linked timetable or learning records block deletion without deleting data', async () => {
    const { calls, error } = await invokeDelete({ linked: true });
    assert.equal(error?.status, 409);
    assert.match(error.message, /Pause the class instead/);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM shs_elective_classes')));
    assert.ok(calls.some(call => call.type === 'rollback'));
    assert.ok(!calls.some(call => call.type === 'commit'));
  });

  await t.test('old choice history also blocks deletion', async () => {
    const { calls, error } = await invokeDelete({ history: 1 });
    assert.equal(error?.status, 409);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM shs_elective_classes')));
  });

  await t.test('archived-year class cannot be deleted', async () => {
    const { calls, error } = await invokeDelete({ archived: true });
    assert.equal(error?.status, 409);
    assert.match(error.message, /Archived school years are read-only/);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM shs_elective_classes')));
    assert.ok(!calls.some(call => call.type === 'begin'));
  });

  await t.test('class from another school is not found', async () => {
    const { calls, error } = await invokeDelete({ classExists: false });
    assert.equal(error?.status, 404);
    assert.ok(!calls.some(call => call.sql?.includes('DELETE FROM shs_elective_classes')));
  });
});

test('catalog is versioned, verifies Annex A choices, and excludes old strands', () => {
  assert.equal(catalog.length, 131);
  assert.ok(catalog.every(item => ['academic_elective', 'techpro_elective', 'work_immersion'].includes(item.type)));
  assert.ok(catalog.every(item => ['academic', 'techpro'].includes(item.trackCode) && item.catalogGroup));
  assert.ok(catalog.every(item => item.version && item.sourceUrl.startsWith('https://')
    && (!item.guideUrl || item.guideUrl.startsWith('https://'))
    && item.hoursUrl.startsWith('https://www.deped.gov.ph/')
    && item.timeAllotmentUrl.endsWith('/5_4_2026_SSHS-Key-Features.pdf') && Number.isInteger(item.hours)));
  assert.equal(getCatalogEntry('NOT_APPROVED'), null);
  assert.equal(getCatalogEntry('AE001').hours, 80);
  assert.equal(getCatalogEntry('TP-JAVA').hours, 320);
  assert.deepEqual(catalog.filter(item => item.type === 'work_immersion').map(item => item.hours), [320, 540, 640]);
  assert.equal(getCatalogEntry('WI-320').trackCode, 'techpro');
  assert.equal(getCatalogEntry('WI-640').catalogGroup, 'techpro_work_immersion');
  for (const [code, hours] of [['WI-320', 320], ['WI-540', 540], ['WI-640', 640]]) {
    const entry = getCatalogEntry(code);
    assert.deepEqual({ code: entry.code, name: entry.name, type: entry.type, version: entry.version, hours, grades: entry.grades }, {
      code, name: 'Work Immersion for Tech-Pro Track', type: 'work_immersion', version: CATALOG_VERSION, hours, grades: [12]
    });
  }
  assert.equal(getCatalogEntry('WI-ACADEMIC-320').trackCode, 'academic');
  assert.equal(getCatalogEntry('WI-ACADEMIC-320').assessmentGroup, 'work_immersion');
  assert.deepEqual(catalog.filter(item => item.catalogGroup === 'field_experience').map(item => [item.code, item.hours]), [
    ['WI-ACADEMIC-320', 320], ['AA-DANCE', 160], ['AA-LITERARY', 160], ['AA-MEDIA', 160],
    ['AA-MUSIC', 160], ['AA-THEATER', 160], ['AA-TRADITIONAL', 160], ['AA-VISUAL', 160],
    ['FE-DESIGN-INNOVATION', 80], ['FE-RESEARCH-1', 80], ['FE-RESEARCH-2', 80],
    ['FE-SPORTS-INCAMPUS', 160], ['FE-OFFCAMPUS', 80]
  ]);
  assert.ok(catalog.filter(item => item.code.startsWith('AA-')).every(item => item.assessmentGroup === 'field_exposure'));
  assert.ok(catalog.filter(item => item.catalogGroup === 'field_experience').every(item =>
    item.trackCode === 'academic' && item.verificationStatus === 'verified'
      && item.hoursUrl.endsWith('/DO_s2026_017r.pdf')));
  assert.equal(getCatalogEntry('AE039').hours, 160);
  assert.equal(getCatalogEntry('AE039').hoursUnit, 'per_term');
  assert.equal(getCatalogEntry('AE039').verificationStatus, 'verified');
  assert.equal(getCatalogEntry('AE046').verificationStatus, 'verified');
  assert.equal(getCatalogEntry('AE063').sourceBasis, 'released_curriculum_guides');
  assert.equal(getCatalogEntry('AE066').sourceBasis, 'released_curriculum_guides');
  assert.equal(getCatalogEntry('WI-ACADEMIC-320').sourceBasis, 'do_017_annex_a');
  assert.equal(getCatalogEntry('FE-OFFCAMPUS').sourceBasis, 'do_017_annex_a');
  assert.ok(catalog.filter(item => item.type === 'academic_elective' && item.grades.includes(12)).length >= 12);
  assert.ok(catalog.some(item => item.type === 'techpro_elective' && item.grades.includes(11) && item.grades.includes(12)));
  assert.doesNotMatch(catalog.map(item => item.name).join(' '), /GAS|STEM strand|TVL track/i);
});

function item(code, type, grade, hours, extra = {}) {
  return { catalogCode: code, subjectType: type, grade, instructionalHours: hours,
    offeringActive: true, classActive: true, teacherActive: true, availableSeats: 30, meetingCount: 1, ...extra };
}

test('readiness checks four pathways using distinct scheduled subjects with seats', () => {
  const academic11 = catalog.filter(entry => entry.type === 'academic_elective').slice(0, 3)
    .map(entry => item(entry.code, entry.type, 11, entry.hours));
  const academic12 = catalog.filter(entry => entry.type === 'academic_elective').slice(3, 15)
    .map(entry => item(entry.code, entry.type, 12, entry.hours));
  const techpro11 = [item('TP-JAVA', 'techpro_elective', 11, 320)];
  const techpro12 = [item('TP-JAVA', 'techpro_elective', 12, 320), item('WI-640', 'work_immersion', 12, 640)];
  const rows = [...academic11, ...academic12, ...techpro11, ...techpro12];
  const ready = pathwayReadiness(rows, 5);
  assert.equal(ready.academic.grade11, true);
  assert.equal(ready.academic.grade12, true);
  assert.equal(ready.academic_cross_track.grade12, true);
  assert.equal(ready.techpro.grade11, true);
  assert.equal(ready.techpro.grade12, true);
  assert.equal(ready.techpro_cross_track.grade12, false);
  assert.equal(pathwayReadiness([...academic12, ...techpro12]).techpro.grade12, true,
    'Grade 12 readiness must not depend on Grade 11 offerings in the same school year.');
  assert.equal(pathwayReadiness(rows.map(row => row.catalogCode === 'AE004' ? { ...row, meetingCount: 0 } : row), 5).academic.grade12, false);
  assert.equal(pathwayReadiness(rows, 4).academic.grade11, false);
  assert.equal(pathwayReadiness([...rows, { ...rows[0], availableSeats: 0 }], 5).academic.grade11, true);
});

test('readiness rejects overlapping class combinations but accepts a parallel class', () => {
  const slot = { weekday: 1, startTime: '09:00', endTime: '10:00', startDate: '2026-07-01', endDate: '2027-06-30' };
  const subjects = ['AE001', 'AE002', 'AE003'].map(code => item(code, 'academic_elective', 11, 80, { meetings: [slot] }));
  assert.equal(pathwayReadiness(subjects, 5).academic.grade11, false);
  const parallel = { ...subjects[1], meetings: [{ ...slot, startTime: '10:00', endTime: '11:00' }] };
  const third = { ...subjects[2], meetings: [{ ...slot, startTime: '11:00', endTime: '12:00' }] };
  assert.equal(pathwayReadiness([...subjects, parallel, third], 5).academic.grade11, true);
});

test('offering activation rejects unapproved catalog codes before any write', async () => {
  const queries = [];
  database = { getConnection: async () => ({ execute: async (...args) => { queries.push(args); return [[]]; }, release() {} }) };
  const res = response(); let error;
  await controller.activate({ user: { schoolId: 2 }, body: { academicYearId: 3, gradeLevelId: 4, catalogCode: 'FAKE' } }, res, value => { error = value; });
  assert.match(error.message, /approved catalog/);
  assert.equal(queries.length, 0);
});

test('offering activation respects grade eligibility, archived years, and enabled tracks', async () => {
  let yearStatus = 'active';
  let gradeCode = 'grade-11';
  let enabledTracks = ['academic', 'techpro'];
  let began = false;
  database = { getConnection: async () => ({
    async execute(sql) {
      if (sql.includes('FROM academic_years WHERE id')) return [[{ id: 3, status: yearStatus }]];
      if (sql.includes('FROM school_grade_levels g')) return [[{ id: 4, gradeCode }]];
      if (sql.includes('FROM school_shs_tracks')) return [enabledTracks.map(trackCode => ({ trackCode }))];
      return [[]];
    },
    async beginTransaction() { began = true; }, async rollback() {}, release() {}
  }) };
  async function attempt(catalogCode) {
    let error;
    await controller.activate({ user: { schoolId: 2 }, body: { academicYearId: 3, gradeLevelId: 4, catalogCode } },
      response(), value => { error = value; });
    return error;
  }
  yearStatus = 'archived';
  assert.equal((await attempt('AE001')).status, 409);
  yearStatus = 'active'; gradeCode = 'grade-11';
  assert.match((await attempt('AE009')).message, /not approved for the selected grade/);
  gradeCode = 'grade-12';
  gradeCode = 'grade-11';
  assert.match((await attempt('TP-AUTO-01')).message, /not approved for the selected grade/);
  enabledTracks = ['techpro'];
  assert.equal((await attempt('AE001')).status, 409, 'a verified subject still requires its school track to be enabled');
  assert.equal(began, false);
});

test('elective classes reject invalid capacity and inactive teachers', async () => {
  let calls = 0;
  database = { getConnection: async () => ({
    async execute(sql) {
      calls++;
      if (sql.includes('FROM shs_offerings o')) return [[{ id: 9, academic_year_id: 3, yearStatus: 'active', is_active: 1,
        catalog_code: 'AE001' }]];
      if (sql.includes('FROM users')) return [[]];
      return [[]];
    }, release() {}
  }) };
  async function attempt(capacity) {
    let error;
    await controller.createClass({ user: { schoolId: 2 }, body: {
      offeringId: 9, teacherId: 7, className: 'Group A', capacity
    } }, response(), value => { error = value; });
    return error;
  }
  assert.match((await attempt(501)).message, /Capacity cannot exceed/);
  assert.equal(calls, 0);
  assert.match((await attempt(40)).message, /active teacher/);
});

test('elective meeting endpoints are admin only and share the school-year lock', () => {
  const routes = read('backend/routes/timetables.js');
  const source = read('backend/controllers/timetablesController.js');
  assert.match(routes, /elective-classes\/:classId\/meetings', requireSchoolAdmin/);
  assert.match(source, /async function saveElective[\s\S]*?FOR UPDATE[\s\S]*?findConflict/);
  assert.match(source, /COALESCE\(s\.academic_year_id, o\.academic_year_id\)/);
  assert.match(source, /shs_elective_class_students/);
  assert.equal(typeof timetable.saveElective, 'function');
});

test('schema ownership is exclusive and every administrator sidebar has one SHS Program link', () => {
  const migration = read('backend/database/migrations/051_shs_offerings_and_classes.sql');
  assert.match(migration, /CHECK \(\(assignment_id IS NULL\) <> \(shs_elective_class_id IS NULL\)\)/);
  assert.match(migration, /CREATE TABLE shs_elective_class_students/);
  assert.match(read('backend/database/schema.sql'), /CREATE TABLE IF NOT EXISTS shs_offerings/);
  for (const file of fs.readdirSync(path.join(root, 'views/admin')).filter(name => name.endsWith('.html'))) {
    const html = read(`views/admin/${file}`);
    const sidebar = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0];
    assert.ok(sidebar, file);
    assert.equal((sidebar.match(/href="edugnay-admin-shs-program\.html"/g) || []).length, 1, file);
  }
});

test('student and teacher timetable responses do not query elective classes in Phase 2', async () => {
  const queries = [];
  database = { execute: async (sql) => {
    queries.push(sql);
    if (sql.includes('FROM academic_years WHERE id')) return [[{ id: 3, label: '2026-2027', status: 'active' }]];
    return [[]];
  } };
  for (const role of ['teacher', 'student']) {
    let error;
    await timetable.list({ user: { id: 4, schoolId: 2, role }, query: { academicYearId: '3' } }, response(), value => { error = value; });
    assert.equal(error, undefined);
  }
  assert.ok(!queries.some(sql => sql.includes('FROM shs_elective_classes ec')));
});

test('elective conflicts include teacher, room, future members, dates, and adjacent times', async () => {
  const candidate = {
    id: 12, sectionId: null, electiveClassId: 5, teacherId: 30,
    sectionName: 'Group B', subjectName: 'Biology 1', room: 'Lab 1',
    startDate: '2026-07-01', endDate: '2026-12-31'
  };
  let memberConflict = false;
  const connection = { async execute(sql) {
    if (sql.includes('student_user_id')) return [memberConflict ? [{ 1: 1 }] : []];
    return [[candidate]];
  } };
  const meeting = { weekday: 3, startTime: '09:00:00', endTime: '10:00:00',
    startDate: '2026-07-01', endDate: '2026-12-31', room: null };
  const owner = { electiveClassId: 7, teacherId: 30 };
  assert.equal((await timetable.findConflict(connection, 2, 3, owner, meeting, 0)).id, 12);
  owner.teacherId = 31;
  assert.equal(await timetable.findConflict(connection, 2, 3, owner, meeting, 0), undefined);
  meeting.room = ' lab 1 ';
  assert.equal((await timetable.findConflict(connection, 2, 3, owner, meeting, 0)).id, 12);
  meeting.room = null;
  memberConflict = true;
  assert.equal((await timetable.findConflict(connection, 2, 3, owner, meeting, 0)).id, 12);
  meeting.startDate = '2027-01-01'; meeting.endDate = '2027-02-01';
  assert.equal(await timetable.findConflict(connection, 2, 3, owner, meeting, 0), undefined);
});

test('elective meeting writes lock the year before checking cross-class conflicts', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); }, async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); }, release() {},
    async execute(sql) {
      calls.push(sql);
      if (sql.includes('FROM shs_elective_classes c') && sql.includes('LIMIT 1')) return [[{
        id: 7, teacherId: 4, academicYearId: 3, yearStatus: 'active',
        classActive: 1, offeringActive: 1, teacherStatus: 'active',
        startDate: '2026-06-01', endDate: '2027-03-31'
      }]];
      if (sql.includes('m.start_time <')) return [[]];
      if (sql.includes('SELECT id FROM scheduled_classes')) return [[{ id: 11 }]];
      if (sql.includes('INSERT INTO timetable_meetings')) return [{ insertId: 14 }];
      return [[]];
    }
  };
  database = { getConnection: async () => connection };
  let error; const res = response();
  await timetable.saveElective({ user: { schoolId: 2, id: 90 }, params: { classId: '7' }, body: {
    weekday: 3, startTime: '08:00', endTime: '09:00', startDate: '2026-07-01', endDate: '2026-12-31'
  } }, res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(res.body.id, 14);
  assert.ok(calls.findIndex(sql => typeof sql === 'string' && sql.includes('FOR UPDATE'))
    < calls.findIndex(sql => typeof sql === 'string' && sql.includes('m.start_time <')));
  assert.equal(calls.at(-1), 'COMMIT');
});

test('Grade 12 Strengthened elective meetings can be scheduled without a school-specific start setting', async () => {
  const queries = [];
  const classRow = {
    id: 7, teacherId: 4, academicYearId: 3, yearStatus: 'active',
    startDate: '2027-06-01', endDate: '2028-03-31', classActive: 1,
    offeringActive: 1, teacherStatus: 'active'
  };
  database = { getConnection: async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      queries.push(sql);
      if (sql.includes('FROM shs_elective_classes c') && sql.includes('LIMIT 1')) return [[classRow]];
      if (sql.trim().startsWith('SELECT id FROM scheduled_classes') && sql.includes('LIMIT 1')) return [[]];
      if (sql.trim().startsWith('SELECT id FROM scheduled_classes')) return [[{ id: 8 }]];
      if (sql.includes('SELECT m.id, m.weekday')) return [[]];
      if (sql.includes('INSERT INTO timetable_meetings')) return [{ insertId: 14 }];
      return [[]];
    }
  }) };
  const res = response();
  let error;
  await timetable.saveElective({ user: { schoolId: 2, id: 90 }, params: { classId: '7' }, body: {
    weekday: 3, startTime: '08:00', endTime: '09:00', startDate: '2027-07-01', endDate: '2028-03-31'
  } }, res, value => { error = value; });
  assert.equal(error, undefined);
  assert.equal(res.body.id, 14);
  assert.ok(queries.some(sql => sql.includes('INSERT INTO timetable_meetings')));
  assert.ok(!queries.some(sql => /strengthened_shs_grade12_pilot|grade12PilotEnabled/i.test(sql)));

  const listQueries = [];
  database = { async execute(sql) {
    listQueries.push(sql);
    if (sql.includes('FROM academic_years WHERE id =')) return [[{
      id: 3, label: 'S.Y. 2026-2027', status: 'active', startDate: '2026-06-01', endDate: '2027-03-31'
    }]];
    return [[]];
  } };
  error = undefined;
  await timetable.list({ user: { id: 4, schoolId: 2, role: 'school_admin' }, query: { academicYearId: '3' } }, response(), value => { error = value; });
  assert.equal(error, undefined);
  const electiveQuery = listQueries.find(sql => sql.includes('FROM shs_elective_classes ec'));
  assert.match(electiveQuery, /o\.academic_year_id = \?/);
  assert.doesNotMatch(electiveQuery, /grade-12.*2026|strengthened_shs_grade12_pilot/i);
});
