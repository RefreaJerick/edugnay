const assert = require('node:assert/strict');
const fs = require('node:fs');
const pageFs = require('./helpers/page-fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { saveReviewDraft, deleteUnreleasedDraft, confirmDraft, reviewValues } = require('../controllers/narrativeReportReviewController');
const teacherScript = pageFs.readFileSync(path.join(__dirname, '../../assets/js/teacher/narrative-reports.js'), 'utf8');

test('adviser week options include the current week and retain completed weeks within the academic year', () => {
  const script = teacherScript;
  const helpers = script.slice(script.indexOf('  function addDays('), script.indexOf('  function populateWeeks('));
  const weekOptions = vm.runInNewContext(`${helpers}\nweekOptions`);
  const section = { academicYearStartDate: '2026-10-01', academicYearEndDate: '2027-03-31' };
  const mondayFriday = { weekStartDay: 1, weekEndDay: 5 };
  const current = weekOptions(mondayFriday, section, '2026-10-22');
  assert.equal(current[0].startDate, '2026-10-19');
  assert.equal(current[0].endDate, '2026-10-23');
  assert.equal(current[1].startDate, '2026-10-12');
  assert.equal(current.length, 4);

  const afterWeek = weekOptions(mondayFriday, section, '2026-10-24');
  assert.equal(afterWeek[0].startDate, '2026-10-19');
  assert.ok(afterWeek[0].endDate < '2026-10-24', 'the same week is complete after Friday');
  const pastYear = weekOptions(mondayFriday, { ...section, academicYearEndDate: '2026-10-16' }, '2026-10-22');
  assert.equal(pastYear[0].startDate, '2026-10-12');
  assert.deepEqual(Array.from(weekOptions(mondayFriday, { ...section, academicYearStartDate: '2026-10-23' }, '2026-10-22')), []);

  const fridayTuesday = weekOptions({ weekStartDay: 5, weekEndDay: 2 }, section, '2026-10-22');
  assert.equal(fridayTuesday[0].startDate, '2026-10-16');
  assert.equal(fridayTuesday[0].endDate, '2026-10-20');
  assert.match(script, /option\.endDate >= today \? ' · In progress'/);
  assert.match(script, /In progress · Evidence through \$\{formatDate\(evidence\.reportWeek\.dataThroughDate\)\}/);
  assert.match(script, /const notice = \$\('report-week-notice'\);[\s\S]*?notice\.hidden = false;[\s\S]*?notice\.querySelector\('span'\)\.textContent = inProgress/);
  assert.match(script, /This report week has ended\. Review the reports below before confirming or releasing them to parents\./);
  assert.match(script, /if \(!weeks\.length\) \{\s*\$\('report-week-notice'\)\.hidden = true;/);
});

function weekNoticeHarness({ endDate = '2026-10-23', today = '2026-10-23', fail = false, gate } = {}) {
  const noticeText = { textContent: '' };
  const elements = {
    'report-section': { value: '15' },
    'report-week': { value: '2026-10-19' },
    'report-week-notice': { hidden: false, querySelector: () => noticeText },
    'reports-grid': { innerHTML: '' },
    'week-caption': { textContent: '' },
    'pipeline-context': { textContent: '' },
    'count-total': { textContent: '' }, 'count-drafts': { textContent: '' },
    'count-confirmed': { textContent: '' }, 'count-follow-up': { textContent: '' }
  };
  const state = { evidence: null, reports: [], weekRequestId: 0 };
  const messages = {};
  const source = teacherScript.slice(teacherScript.indexOf('  async function loadWeek()'), teacherScript.indexOf('  function generationCandidates()'));
  const loadWeek = vm.runInNewContext(`${source}\nloadWeek`, {
    state,
    $: id => elements[id],
    setGenerationButtonState() {},
    clearReportCounts() {},
    renderCounts() {},
    renderCards() {},
    renderEmptyState(icon, title, text) { messages.emptyState = { icon, title, text }; },
    updateGenerationControl() {},
    setMessage(id, text, error) { messages[id] = { text, error }; },
    formatDate: value => value,
    schoolToday: () => today,
    api: { async request(url) {
      if (gate) await gate;
      if (fail) throw new Error('Weekly reports could not be loaded.');
      if (url.includes('/weekly-evidence?')) return {
        section: { gradeLevel: 'Grade 8', name: 'St. Peter' },
        reportWeek: { startDate: '2026-10-19', endDate, dataThroughDate: today }
      };
      return { reports: [] };
    } }
  });
  return { loadWeek, elements, noticeText, messages };
}

test('week notice shows current or past guidance after loading and stays hidden during loading and errors', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const current = weekNoticeHarness({ gate });
  const pending = current.loadWeek();
  assert.equal(current.elements['report-week-notice'].hidden, true);
  finish();
  await pending;
  assert.equal(current.elements['report-week-notice'].hidden, false);
  assert.equal(current.noticeText.textContent, 'This report week is still in progress. A report generated now uses records available so far. For a more complete report, generate it after the week ends.');

  const past = weekNoticeHarness({ endDate: '2026-10-16', today: '2026-10-23' });
  await past.loadWeek();
  assert.equal(past.elements['report-week-notice'].hidden, false);
  assert.equal(past.noticeText.textContent, 'This report week has ended. Review the reports below before confirming or releasing them to parents.');

  const failed = weekNoticeHarness({ fail: true });
  await failed.loadWeek();
  assert.equal(failed.elements['report-week-notice'].hidden, true);
  assert.equal(failed.messages.emptyState.title, 'Weekly reports unavailable');
});

test('week notice is hidden when the section has no selectable report weeks', () => {
  const elements = {
    'report-section': { value: '15' },
    'report-week': { innerHTML: '', disabled: false },
    'report-week-notice': { hidden: false },
    'week-caption': { textContent: '' }
  };
  const source = teacherScript.slice(teacherScript.indexOf('  function populateWeeks()'), teacherScript.indexOf('  function setGenerationButtonState('));
  const populateWeeks = vm.runInNewContext(`${source}\npopulateWeeks`, {
    state: { sections: [{ id: '15' }], settings: {}, evidence: {}, reports: [] },
    $: id => elements[id], weekOptions: () => [], schoolToday: () => '2026-10-23',
    escape: value => value, formatDate: value => value,
    renderCounts() {}, renderEmptyState() {}, setGenerationButtonState() {}
  });
  populateWeeks();
  assert.equal(elements['report-week-notice'].hidden, true);
});

function request(body = {}) {
  return {
    user: { id: 3, schoolId: 1, role: 'teacher' }, params: { reportId: '101' }, body
  };
}

function fakeDatabase(report = {
  id: 101, sectionId: 22, studentId: 4, status: 'draft',
  followUpSuggestion: 'Check in with the learner.'
}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM narrative_reports AS reports')) return [[report].filter(Boolean)];
      if (sql.startsWith('UPDATE narrative_reports SET report_status') && report) report.status = 'confirmed';
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); }
  };
  return { calls, async getConnection() { return connection; } };
}

test('adviser can edit a draft and explicitly confirm it without releasing it', async () => {
  const database = fakeDatabase();
  const saved = await saveReviewDraft(request({
    summary: 'The learner attended two recorded sessions.',
    parentActions: ['Review class notes together.', 'Ask about the missed assignment.'],
    teacherNote: 'Classroom observation'
  }), database);
  assert.deepEqual(saved, { reportId: '101', status: 'draft' });
  assert.equal(database.calls.filter(call => call.sql?.startsWith('INSERT INTO report_recommendations')).length, 2);
  assert.ok(database.calls.some(call => call.sql?.includes('sections.adviser_user_id = ?') &&
    JSON.stringify(call.values) === JSON.stringify([101, 1, 3])));
  assert.ok(database.calls.some(call => call.sql?.startsWith('INSERT INTO audit_logs')));
  const confirmed = await confirmDraft(request({ followUpDecision: 'accept' }), database);
  assert.deepEqual(confirmed, { reportId: '101', status: 'confirmed', released: false });
  const update = database.calls.find(call => call.sql?.startsWith('UPDATE narrative_reports SET report_status'));
  assert.equal(update.values[0], true);
  assert.doesNotMatch(update.sql, /released_at|notification/i);
  assert.equal(database.calls.filter(call => call === 'COMMIT').length, 2);
});

test('suggestions require an accept or dismiss decision before confirmation', async () => {
  const database = fakeDatabase();
  await assert.rejects(confirmDraft(request({ followUpDecision: null }), database), error => error.status === 400);
  assert.ok(database.calls.includes('ROLLBACK'));
  assert.equal(database.calls.includes('COMMIT'), false);
  const dismissed = fakeDatabase({
    id: 101, sectionId: 22, studentId: 4, status: 'draft',
    followUpSuggestion: 'Check in.'
  });
  await confirmDraft(request({ followUpDecision: 'dismiss' }), dismissed);
  assert.equal(dismissed.calls.find(call => call.sql?.startsWith('UPDATE narrative_reports SET report_status')).values[0], false);
});

test('a report without a suggestion can be confirmed without a follow-up flag', async () => {
  const database = fakeDatabase({ id: 101, sectionId: 22, studentId: 4, status: 'draft', followUpSuggestion: null });
  assert.deepEqual(await confirmDraft(request({ followUpDecision: null }), database),
    { reportId: '101', status: 'confirmed', released: false });
  assert.equal(database.calls.find(call => call.sql?.startsWith('UPDATE narrative_reports SET report_status')).values[0], false);
  await assert.rejects(confirmDraft(request({ followUpDecision: 'accept' }), fakeDatabase({
    id: 101, sectionId: 22, studentId: 4, status: 'draft', followUpSuggestion: null
  })), error => error.status === 400);
});

test('invalid review details roll back without changing the report', async () => {
  const database = fakeDatabase();
  await assert.rejects(saveReviewDraft(request({ summary: 'A summary', parentActions: [''], teacherNote: '' }), database),
    error => error.status === 400);
  assert.ok(database.calls.includes('ROLLBACK'));
  assert.equal(database.calls.includes('COMMIT'), false);
  assert.equal(database.calls.some(call => call.sql?.startsWith('UPDATE narrative_reports')), false);
});

test('foreign, confirmed, and malformed reports cannot be edited or confirmed', async () => {
  await assert.rejects(saveReviewDraft(request({ summary: 'Okay', parentActions: [], teacherNote: '' }), fakeDatabase(null)),
    error => error.status === 404);
  await assert.rejects(confirmDraft(request({ followUpDecision: null }), fakeDatabase({ id: 101, status: 'confirmed' })), error => error.status === 409);
  assert.throws(() => reviewValues({ summary: '', parentActions: [], teacherNote: '' }), /invalid/);
  assert.throws(() => reviewValues({ summary: 'Okay', parentActions: [''], teacherNote: '' }), /invalid/);
  assert.throws(() => reviewValues({ summary: 'Okay', parentActions: [], teacherNote: '', followUpDecision: 'accept' }), /valid report/);
  assert.throws(() => reviewValues({ summary: 'Okay', parentActions: [], teacherNote: '', released: true }), /valid report/);
});

function deletionDatabase(report = {
  id: 101, sectionId: 22, studentId: 4, status: 'draft',
  periodKey: 'week:2026-10-19', releasedAt: null, pendingCorrection: false
}, { hasRelease = false, hasReopenRequest = false, affectedRows = 1 } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM narrative_reports AS reports')) return [[report].filter(Boolean)];
      if (sql.includes('EXISTS(SELECT 1 FROM narrative_report_releases')) return [[{ hasRelease, hasReopenRequest }]];
      if (sql.startsWith('DELETE FROM narrative_reports')) return [{ affectedRows }];
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); }
  };
  return { calls, async getConnection() { return connection; } };
}

function deletionRequest(overrides = {}) {
  return { ...request(), query: { sectionId: '22', startDate: '2026-10-19' }, ...overrides };
}

test('deleting an unreleased draft targets only its selected section and week and writes an audit entry', async () => {
  const database = deletionDatabase();
  await deleteUnreleasedDraft(deletionRequest(), database);
  const deletion = database.calls.find(call => call.sql?.startsWith('DELETE FROM narrative_reports'));
  assert.deepEqual(deletion.values, [101, 1, 22, 'week:2026-10-19']);
  assert.match(deletion.sql, /report_status = 'draft'[\s\S]*released_at IS NULL/);
  assert.ok(database.calls.some(call => call.sql?.startsWith('INSERT INTO audit_logs') &&
    call.values[2] === 'narrative_report_draft_deleted'));
  assert.ok(database.calls.includes('COMMIT'));
});

test('draft deletion rejects mismatched scope, confirmed or released reports, and protected history', async () => {
  for (const [req, database, status] of [
    [deletionRequest({ query: { sectionId: '23', startDate: '2026-10-19' } }), deletionDatabase(), 409],
    [deletionRequest({ query: { sectionId: '22', startDate: '2026-10-12' } }), deletionDatabase(), 409],
    [deletionRequest(), deletionDatabase({ id: 101, status: 'confirmed' }), 409],
    [deletionRequest(), deletionDatabase({ id: 101, status: 'draft', releasedAt: '2026-10-20' }), 409],
    [deletionRequest(), deletionDatabase({ id: 101, status: 'draft', pendingCorrection: true }), 409],
    [deletionRequest(), deletionDatabase(null), 404],
    [deletionRequest(), deletionDatabase(undefined, { hasRelease: true }), 409],
    [deletionRequest(), deletionDatabase(undefined, { hasReopenRequest: true }), 409]
  ]) {
    await assert.rejects(deleteUnreleasedDraft(req, database), error => error.status === status);
    assert.ok(database.calls.includes('ROLLBACK'));
    assert.equal(database.calls.some(call => call.sql?.startsWith('DELETE FROM narrative_reports')), false);
  }
});

test('a draft changed during deletion rolls back and is not audited', async () => {
  const database = deletionDatabase(undefined, { affectedRows: 0 });
  await assert.rejects(deleteUnreleasedDraft(deletionRequest(), database), error => error.status === 409);
  assert.ok(database.calls.includes('ROLLBACK'));
  assert.equal(database.calls.some(call => call.sql?.startsWith('INSERT INTO audit_logs')), false);
});

test('delete confirmation preserves edits on cancel, then refreshes the selected week after deletion', async () => {
  const source = teacherScript.slice(teacherScript.indexOf('  function setDeleteConfirmation('), teacherScript.indexOf('  function showReview('));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, disabled: false, value: '', attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      focus() { this.focused = true; }
    });
    return nodes.get(id);
  };
  node('review-summary').value = 'Unsaved adviser edit';
  const state = {
    selectedReportId: '101', busy: false, deleteConfirmOpen: false,
    reports: [{ id: '101', studentId: '4', status: 'draft', releasedAt: null, pendingCorrection: false,
      reportWeekStartDate: '2026-10-19', reportWeekEndDate: '2026-10-23' }],
    evidence: { section: { id: '22' }, reportWeek: { startDate: '2026-10-19' },
      students: [{ id: '4', displayName: 'Learner Four' }] }
  };
  const requests = [];
  let refreshed = false;
  const context = {
    state, $: node, formatDate: value => value, setRegenerateConfirmation() {},
    setMessage(id, message) { node(id).textContent = message; },
    api: { async request(url, options) { requests.push({ url, options }); } },
    closeModal() {}, showAppToast() {},
    async loadWeek() { state.reports = []; refreshed = true; }
  };
  const controls = vm.runInNewContext(`${source}\n({ openDeleteConfirmation, cancelDeleteConfirmation, deleteReview })`, context);
  controls.openDeleteConfirmation();
  assert.match(node('review-delete-detail').textContent, /Learner Four.*2026-10-19.*2026-10-23/);
  assert.equal(node('review-delete-confirmation').hidden, false);
  controls.cancelDeleteConfirmation();
  assert.equal(node('review-summary').value, 'Unsaved adviser edit');
  assert.equal(node('review-delete-confirmation').hidden, true);
  assert.equal(requests.length, 0);
  controls.openDeleteConfirmation();
  await controls.deleteReview();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'DELETE');
  assert.match(requests[0].url, /\/weekly-drafts\/101\?sectionId=22&startDate=2026-10-19$/);
  assert.equal(refreshed, true);
  assert.equal(state.reports.length, 0);
});

test('failed draft deletion keeps the confirmation and report visible', async () => {
  const source = teacherScript.slice(teacherScript.indexOf('  async function deleteReview('), teacherScript.indexOf('  function showReview('));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false });
    return nodes.get(id);
  };
  const state = { selectedReportId: '101', deleteConfirmOpen: true, busy: false,
    reports: [{ id: '101' }], evidence: { section: { id: '22' }, reportWeek: { startDate: '2026-10-19' } } };
  let closed = false;
  const deleteReview = vm.runInNewContext(`${source}\ndeleteReview`, {
    state, $: node, api: { async request() { throw new Error('Draft changed.'); } },
    closeModal() { closed = true; }, loadWeek() {}, showAppToast() {},
    setMessage(id, message) { node(id).textContent = message; }
  });
  await deleteReview();
  assert.equal(closed, false);
  assert.equal(state.reports.length, 1);
  assert.equal(node('review-delete-error').textContent, 'Draft changed.');
  assert.equal(node('confirm-delete-draft').disabled, false);
});

test('removing the selected-week draft makes that learner eligible for generation again', () => {
  const reportLookup = teacherScript.slice(teacherScript.indexOf('  function reportFor('), teacherScript.indexOf('  function studentInitials('));
  const generationControl = teacherScript.slice(teacherScript.indexOf('  function generationCandidates()'), teacherScript.indexOf('  function showGeneration()'));
  const state = { evidence: { students: [{ id: '4' }] }, reports: [{ studentId: '4' }],
    generationEnabled: true, reportsEnabled: true, aiEvidenceApproved: true, generationSwitchEnabled: true };
  let disabled;
  const { generationCandidates, updateGenerationControl } = vm.runInNewContext(
    `${reportLookup}\n${generationControl}\n({ generationCandidates, updateGenerationControl })`,
    { state, setGenerationButtonState(value) { disabled = value; } }
  );
  updateGenerationControl();
  assert.equal(disabled, true);
  state.reports = [];
  updateGenerationControl();
  assert.equal(disabled, false);
  assert.equal(generationCandidates().length, 1);
});

test('teacher page gates parent release separately from confirmation', () => {
  const root = path.join(__dirname, '../..');
  const page = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const script = pageFs.readFileSync(path.join(root, 'assets/js/teacher/narrative-reports.js'), 'utf8');
  const styles = pageFs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  const sharedStyles = pageFs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  const commonScript = pageFs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const routes = pageFs.readFileSync(path.join(__dirname, '../routes/reports.js'), 'utf8');
  assert.match(page, /Weekly Report Generation Pipeline/);
  assert.match(page, /id="gen-modal"/);
  assert.match(page, /id="review-modal"/);
  assert.match(page, /Confirm report/);
  assert.match(page, /Releasing it to parents is a separate step/);
  assert.match(page, /id="review-avatar"/);
  for (const [tone, id] of [['purple', 'count-total'], ['orange', 'count-drafts'], ['green', 'count-confirmed'], ['red', 'count-follow-up']]) {
    assert.match(page, new RegExp(`class="stat-card ${tone}"[\\s\\S]*?id="${id}"`));
  }
  assert.doesNotMatch(page, /summary-tile-tag/);
  assert.doesNotMatch(styles, /report-summary-tile|summary-tile-tag/);
  assert.match(sharedStyles, /\.stat-card\.purple/);
  assert.match(sharedStyles, /\.stat-card\.orange/);
  assert.match(sharedStyles, /\.stat-card\.green/);
  assert.match(sharedStyles, /\.stat-card\.red/);
  assert.match(sharedStyles, /\.summary-strip:has\(> \.stat-card:nth-child\(4\)\)/);
  assert.match(page, /class="reports-overview"[\s\S]*?class="report-selection-card"[\s\S]*?id="report-section"[\s\S]*?id="report-week"[\s\S]*?class="summary-strip"/);
  assert.match(page, /class="report-selection-title" id="report-selection-title">Report selection<\/h2>/);
  assert.match(page, /<span class="search-icon" aria-hidden="true"><i data-lucide="search"><\/i><\/span><input class="search-input" id="report-search"/);
  assert.match(styles, /\.reports-context-controls select\s*\{[^}]*border:\s*1\.5px solid var\(--gray-200\);[^}]*background-color:\s*var\(--gray-50\);[^}]*font-size:\s*13px;[^}]*font-weight:\s*400;[^}]*appearance:\s*none;/s);
  assert.match(styles, /\.reports-context-controls select:focus\s*\{[^}]*border-color:\s*var\(--theme-accent-text\);[^}]*box-shadow:\s*0 0 0 3px/s);
  assert.match(styles, /\.search-icon svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s);
  assert.match(styles, /\.search-input\s*\{[^}]*background:\s*var\(--theme-surface\);/s);
  assert.match(styles, /\.reports-overview\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*\.9fr\)\s+minmax\(0,\s*1\.1fr\);/s);
  assert.match(styles, /\.reports-overview \.summary-strip\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*margin-bottom:\s*0;/s);
  assert.match(styles, /@media \(max-width: 1232px\)\s*\{[^}]*\.reports-overview \{ grid-template-columns: minmax\(0, 1fr\); \}/s);
  assert.match(styles, /@media \(min-width: 521px\)\s*\{[\s\S]*?\.reports-overview \.stat-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*min-height:\s*112px;[^}]*padding:\s*12px 14px;/s);
  assert.match(styles, /\.reports-overview \.stat-card-num\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/s);
  assert.match(styles, /\.reports-overview \.stat-card-icon\s*\{[^}]*position:\s*absolute;[^}]*top:\s*12px;[^}]*right:\s*14px;/s);
  assert.match(styles, /@media \(max-width: 520px\)\s*\{[\s\S]*?\.summary-strip \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(styles, /@media \(max-width: 1232px\)[\s\S]*?\.summary-strip \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  for (const id of ['count-total', 'count-drafts', 'count-confirmed', 'count-follow-up']) {
    assert.match(script, new RegExp(`\\$\\('${id}'\\)\\.textContent`));
  }
  assert.match(script, /generationEnabled/);
  assert.match(script, /releaseEnabled/);
  assert.match(script, /report\.followUpSuggestion/);
  assert.match(page, /id="follow-up-section" hidden><h3 class="review-section-label"><i data-lucide="heart-handshake" aria-hidden="true"><\/i> Suggested adviser follow-up<\/h3>/);
  assert.match(page, /id="follow-up-reasons"/);
  assert.match(page, /id="report-week-notice" hidden/);
  assert.match(script, /reason\.type === 'low_scores'/);
  assert.match(script, /detail\.textContent = .*score\.maxScore/);
  assert.match(script, /student\.candidateReasons/);
  assert.match(script, /item\.textContent = value/);
  assert.match(script, /No follow-up suggestion is available\. Review the reasons below\./);
  assert.doesNotMatch(page, /generation-control-help/);
  assert.doesNotMatch(script, /generation-control-help/);
  assert.match(script, /hasAttendanceRecords/);
  assert.match(script, /report-card-avatar/);
  assert.match(styles, /\.report-card-excerpt \{ padding: 12px 14px 12px; \}/);
  assert.match(script, /EDUGNAY_AVATAR\?\.html/);
  assert.match(script, /EDUGNAY_AVATAR\?\.hydrate/);
  assert.match(script, /EDUGNAY_AVATAR\?\.render/);
  assert.match(script, /statusTone = report\?\.pendingCorrection/);
  assert.match(script, /badge badge-\$\{statusTone\}/);
  assert.doesNotMatch(script, /status-pill|status-released|status-confirmed/);
  assert.match(script, /data-lucide="eye"/);
  assert.match(script, /\$\('review-summary'\)\.value = report\.editedSummary \|\| report\.generatedSummary;/);
  assert.match(script, /No confirmed records/);
  assert.match(script, /No assignments due/);
  assert.match(script, /data-source-card ds-/);
  assert.match(script, /getClientRects\(\)/);
  assert.match(script, /updateGenerationControl/);
  assert.match(script, /Narrative Reports are off/);
  assert.match(script, /school AI approval is missing/);
  assert.match(script, /the server has paused AI generation/);
  assert.match(script, /!state\.generationEnabled/);
  assert.doesNotMatch(styles, /generation-control-help/);
  assert.match(script, /function setGenerationButtonState\(disabled, reason = ''\)/);
  assert.match(script, /button\.title = reason/);
  assert.match(script, /button\.setAttribute\('aria-label', reason \? `Generate Reports unavailable:/);
  assert.match(script, /setGenerationButtonState\(true, 'No report week is available for generation\.'/);
  assert.match(script, /setGenerationButtonState\(true, 'Weekly report data could not be loaded\.'/);
  assert.match(script, /No learners are available for this section and week\./);
  assert.match(script, /Every learner already has a draft or confirmed report\./);
  assert.match(styles, /\.follow-up-evidence\s*\{[^}]*border:\s*1px solid var\(--blue-pale\);[^}]*background:\s*var\(--surface-blue\);/s);
  assert.match(styles, /\.follow-up-choices input\[type="radio"\]\s*\{[^}]*margin:\s*0;[^}]*align-self:\s*center;/s);
  assert.match(styles, /#review-modal \.review-modal-foot-actions > \[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  assert.match(script, /\$\('save-review'\)\.hidden = !editable/);
  assert.match(script, /\$\('confirm-review'\)\.hidden = !editable/);
  assert.match(script, /\$\('release-report'\)\.hidden = editable \|\| Boolean\(report\.releasedAt && !report\.pendingCorrection\) \|\| !state\.releaseEnabled/);
  assert.match(page, /class="review-avatar person-avatar person-avatar--compact"[^>]*id="review-avatar"/);
  assert.match(styles, /\.excerpt-text\s*\{[^}]*min-height:\s*68px;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.doesNotMatch(styles, /-webkit-line-clamp|\.excerpt-text\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.person-avatar\.report-card-avatar\s*\{\s*--avatar-size:\s*38px;/);
  assert.match(styles, /\.report-card \.excerpt-label\s*\{[^}]*font-size:\s*9px/s);
  assert.match(styles, /\.report-card \.excerpt-label\s*>\s*svg\s*\{[^}]*width:\s*12px/s);
  assert.match(styles, /\.report-card \.excerpt-text\s*\{\s*font-size:\s*10px;/);
  assert.match(styles, /\.report-card-review\s*>\s*svg\s*\{[^}]*width:\s*14px/s);
  assert.match(styles, /\.pipeline-head \.badge/);
  assert.doesNotMatch(styles, /^\s*\.badge\s*\{/m);
  assert.match(sharedStyles, /\.person-avatar\.person-avatar\s*\{[^}]*border-radius:\s*var\(--radius-circle\)/s);
  assert.match(sharedStyles, /\.person-avatar--compact\s*\{\s*--avatar-size:\s*43px;/);
  assert.match(commonScript, /const fallback = document\.createElement\('span'\)/);
  assert.match(commonScript, /image\.addEventListener\('error', \(\) => image\.remove\(\)/);
  assert.match(commonScript, /function renderPanelEmptyState\(options = \{\}\)/);
  assert.match(styles, /\.reports-grid:empty\s*\{\s*display:\s*none;\s*\}/);
  assert.match(script, /function renderEmptyState\(icon, title, text\)\s*\{[^}]*renderPanelEmptyState\(\{ icon, title, text \}\)/s);
  assert.match(script, /renderEmptyState\('user-round-search', 'No matching learners', 'Try changing your search or status filter\.'/);
  assert.match(script, /renderEmptyState\('users-round', 'No learners in this section'/);
  assert.match(script, /renderEmptyState\('calendar-days', 'No report week available'/);
  assert.match(script, /renderEmptyState\('door-open', 'No advisory section assigned'/);
  assert.match(script, /if \(!state\.evidence\) return;/);
  assert.match(script, /setMessage\('reports-message', error\.message \|\| 'Narrative Reports could not be loaded\.', true\)/);
  assert.match(styles, /@media \(max-width: 1232px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(routes, /weekly-drafts\/:reportId\/confirm.*requireSchoolUser.*requireRoles\('teacher'\)/);
  assert.match(routes, /router\.delete\('\/weekly-drafts\/:reportId', requireSchoolUser, requireRoles\('teacher'\)/);
  assert.match(routes, /weekly-drafts\/:reportId\/release.*requireSchoolUser.*requireRoles\('teacher'\)/);
});

test('teacher Narrative Reports removes the intro and keeps its page title', () => {
  const root = path.join(__dirname, '../..');
  const teacherPage = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const parentPage = pageFs.readFileSync(path.join(root, 'views/parent/edugnay-parent-reports.html'), 'utf8');

  assert.doesNotMatch(teacherPage, /class="portal-overview"/);
  assert.match(teacherPage, /data-page-title="Narrative Reports"/);
  assert.match(teacherPage, /data-page-title-target>Narrative Reports/);
  assert.match(teacherPage, /Weekly Report Generation Pipeline/);
  assert.match(parentPage, /class="portal-overview"/);
});

test('teacher Narrative Reports mobile controls fit their available width', () => {
  const root = path.join(__dirname, '../..');
  const page = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const styles = pageFs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  const sharedButtonStyles = pageFs.readFileSync(path.join(root, 'assets/css/modal-system.css'), 'utf8');
  const mobileStyles = styles.slice(styles.lastIndexOf('/* Narrative Reports mobile control layout */'));

  assert.match(page, /class="filter-row"[\s\S]*?id="report-search"[\s\S]*?id="report-status"/);
  assert.match(page, /class="generation-control"[\s\S]*?id="open-generation"/);
  assert.match(page, /id="confirm-review"/);
  assert.match(mobileStyles, /@media \(max-width: 760px\)/);
  assert.match(mobileStyles, /\.filter-row\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*width:\s*100%;/s);
  assert.match(mobileStyles, /\.filter-row \.search-wrap,[\s\S]*?\.filter-row \.select-filter\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(mobileStyles, /\.generation-control\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
  assert.match(mobileStyles, /\.panel-head-right \.generation-control > \.top-btn\s*\{[^}]*width:\s*100%;/s);
  assert.match(mobileStyles, /@media \(max-width: 760px\)[\s\S]*?#review-modal \.review-modal-foot-actions\s*\{[^}]*order:\s*1;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*width:\s*100%;/s);
  assert.match(mobileStyles, /#review-modal \.review-modal-foot\s*\{\s*row-gap:\s*8px;/);
  assert.match(mobileStyles, /#review-modal \.review-modal-foot-actions\s*\{[^}]*row-gap:\s*8px;/s);
  assert.match(mobileStyles, /#review-modal \.review-modal-foot-actions > \[data-close-modal\]\s*\{\s*display:\s*none;/);
  assert.match(mobileStyles, /#review-modal \.review-modal-foot-actions > #confirm-review,[\s\S]*?#review-modal \.review-modal-foot-actions > #release-report\s*\{\s*grid-row:\s*1;/);
  assert.match(mobileStyles, /#review-modal \.review-modal-foot-actions > #save-review\s*\{\s*grid-row:\s*2;/);
  assert.match(page, /class="modal-close" type="button" data-close-modal aria-label="Close review dialog"/);
  assert.match(page, /id="review-release-note"[\s\S]*?id="review-delete-confirmation"[\s\S]*?class="review-modal-foot"><button class="top-btn btn-danger delete-draft-trigger"[^>]*id="delete-review"/);
  assert.match(page, /class="top-btn btn-danger" id="confirm-delete-draft"/);
  assert.match(styles, /#review-modal \.review-delete-confirmation \{[^}]*border:\s*1px solid var\(--red-border\);[^}]*background:\s*var\(--red-pale\);/s);
  assert.doesNotMatch(mobileStyles, /#review-modal \.review-modal-foot-actions > #confirm-review,[\s\S]*?#review-modal \.review-modal-foot-actions > #save-review\s*\{[^}]*min-height:/);
  assert.match(sharedButtonStyles, /body :is\([\s\S]*?\.top-btn,[\s\S]*?min-height:\s*var\(--button-height\);[\s\S]*?border-radius:\s*var\(--button-radius\);/);
  assert.match(sharedButtonStyles, /@media \(max-width: 560px\)[\s\S]*?body :is\([\s\S]*?\.top-btn,[\s\S]*?min-height:\s*36px;[\s\S]*?font-size:\s*12px;/);
  assert.match(mobileStyles, /#review-modal \.delete-draft-trigger\s*\{[^}]*order:\s*2;[^}]*width:\s*100%;[^}]*min-height:\s*48px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--red\);/s);
  assert.doesNotMatch(mobileStyles, /#review-modal \.delete-draft-trigger::before/);
  assert.match(styles, /\.top-btn:focus-visible\s*\{\s*outline:\s*3px solid var\(--blue-mid\);/);
});

test('report pipeline keeps its desktop stages and exposes the grouped mobile flow', () => {
  const root = path.join(__dirname, '../..');
  const page = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const styles = pageFs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  const bannerStart = page.indexOf('<section class="pipeline-banner"');
  const bannerEnd = page.indexOf('</section>', bannerStart);
  const bannerMarkup = page.slice(bannerStart, bannerEnd);
  const livePipelineStyles = styles.slice(styles.indexOf('/* Screenshot-aligned live adviser report dashboard and dialogs. */'));
  const mobileStyles = styles.slice(styles.lastIndexOf('/* Narrative Reports mobile control layout */'));
  const pipelineStyles = styles.slice(styles.indexOf('/* Mobile pipeline disclosure.'));

  assert.match(page, /class="pipeline-banner"[^>]*aria-labelledby="pipeline-title"/);
  assert.doesNotMatch(bannerMarkup, /class="pipeline-icon"|data-lucide="workflow"/);
  assert.match(page, /class="review-modal-head"><span class="pipeline-icon"><i data-lucide="sparkles"><\/i><\/span>/);
  assert.match(page, /id="generation-state"/);
  assert.match(page, /id="pipeline-toggle" type="button" aria-controls="pipeline-flow" aria-expanded="true"[^>]*hidden/);
  assert.match(page, /id="pipeline-flow" role="group" aria-label="Report preparation steps"/);
  assert.match(page, /class="pipeline-data-heading">Collect data<\/h3>/);
  assert.match(page, /class="pipeline-data-sources"[\s\S]*?>Attendance<[\s\S]*?>Assignments<[\s\S]*?>Academic<[\s\S]*?>Journal</);
  assert.match(page, /class="flow-step ai"[\s\S]*?>AI draft<[\s\S]*?class="flow-step final"[\s\S]*?>To parent</);
  assert.ok(page.indexOf('id="generation-state"') < page.indexOf('id="pipeline-flow"'), 'availability status stays visible outside the collapsible flow');

  assert.match(styles, /\.pipeline-flow\s*\{[^}]*display:\s*flex;/s);
  assert.match(livePipelineStyles, /\.pipeline-banner\s*\{[^}]*background:\s*var\(--navy\);[^}]*--pipeline-card-surface:\s*var\(--school-dark-surface, #132641\);[^}]*--pipeline-card-border:\s*var\(--school-dark-border, #344d6a\);[^}]*--pipeline-strong-text:\s*var\(--school-dark-text, #f3f7fe\);[^}]*--pipeline-muted-text:\s*var\(--school-dark-muted, #9eb2cc\);/s);
  assert.match(livePipelineStyles, /\.pipeline-icon\s*\{[^}]*background:\s*var\(--blue-mid\);/s);
  assert.match(livePipelineStyles, /\.pipeline-title\s*\{\s*color:\s*var\(--white\);/);
  assert.match(livePipelineStyles, /\.pipeline-flow::before\s*\{\s*display:\s*none;\s*\}/);
  assert.match(livePipelineStyles, /\.flow-step:not\(\.final\)::after\s*\{[^}]*left:\s*calc\(50% \+ 12px\);[^}]*right:\s*calc\(-50% \+ 12px\);[^}]*background-image:\s*radial-gradient\(circle, rgba\(255, 255, 255, \.36\) 1px, transparent 1\.3px\);[^}]*background-size:\s*8px 2px;[^}]*background-repeat:\s*repeat-x;/s);
  assert.match(livePipelineStyles, /@media \(max-width: 940px\)\s*\{\s*\.flow-step:not\(\.final\)::after \{ display: none; \}\s*\}/);
  assert.match(livePipelineStyles, /\.flow-step-icon\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--school-accent-on-dark, #8bbcff\);/s);
  assert.match(livePipelineStyles, /\.flow-step-icon svg\s*\{\s*width:\s*22px;\s*height:\s*22px;\s*\}/);
  assert.match(livePipelineStyles, /\.flow-step\.ai \.flow-step-icon\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*#c4b5fd;/s);
  assert.match(livePipelineStyles, /\.flow-step\.final \.flow-step-icon\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--gold-light\);/s);
  assert.match(livePipelineStyles, /\.flow-step-label\s*\{\s*color:\s*rgba\(255, 255, 255, \.92\);/);
  assert.match(livePipelineStyles, /\.pipeline-head \.badge\.is-enabled\s*\{[^}]*color:\s*var\(--theme-success-deep\);/s);
  assert.match(styles, /\.pipeline-data-group,\s*\.pipeline-data-sources\s*\{\s*display:\s*contents;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-flow\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.match(pipelineStyles, /@media \(max-width: 760px\)[\s\S]*?\.pipeline-banner:has\(\.pipeline-flow\[hidden\]\) \.pipeline-head\s*\{\s*margin-bottom:\s*0;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-flow::before\s*\{\s*display:\s*none;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-data-group::after,\s*\.pipeline-flow > \.flow-step\.ai::after\s*\{[^}]*left:\s*15\.5px;[^}]*width:\s*3px;[^}]*background-image:\s*radial-gradient\(circle, rgba\(255, 255, 255, \.36\) 1\.3px, transparent 1\.5px\);[^}]*background-size:\s*3px 8px;[^}]*background-repeat:\s*repeat-y;/s);
  assert.match(pipelineStyles, /\.pipeline-data-group::after\s*\{\s*top:\s*34px;\s*bottom:\s*-22px;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-flow > \.flow-step\.ai::after\s*\{\s*top:\s*calc\(50% \+ 11px\);\s*bottom:\s*-22px;\s*\}/);
  assert.match(pipelineStyles, /@media \(max-width: 760px\)[\s\S]*?#generation-state\s*\{\s*display:\s*none;\s*\}/);
  assert.match(pipelineStyles, /#pipeline-toggle\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(pipelineStyles, /#pipeline-toggle:focus-visible\s*\{\s*outline:\s*2px solid rgba\(255, 255, 255, \.82\);\s*outline-offset:\s*2px;\s*box-shadow:\s*none;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-data-sources\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(pipelineStyles, /\.pipeline-data-group \.flow-step\s*\{[^}]*grid-template-columns:\s*22px minmax\(0, 1fr\);[^}]*border:\s*1px solid var\(--pipeline-card-border\);[^}]*background:\s*var\(--pipeline-card-surface\);/s);
  assert.match(pipelineStyles, /\.pipeline-data-group \.flow-step-icon\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--school-accent-on-dark, #8bbcff\);/s);
  assert.match(pipelineStyles, /\.pipeline-data-group \.flow-step-icon svg\s*\{\s*width:\s*20px;\s*height:\s*20px;\s*\}/);
  assert.match(pipelineStyles, /\.pipeline-data-group \.flow-step-label\s*\{\s*color:\s*var\(--pipeline-strong-text\);/);
  assert.match(pipelineStyles, /\.pipeline-data-group \.flow-step-sub\s*\{\s*color:\s*var\(--pipeline-muted-text\);/);
  assert.match(pipelineStyles, /\.pipeline-data-number\s*\{[^}]*background:\s*var\(--pipeline-accent-surface\);[^}]*color:\s*var\(--pipeline-accent-text\);/s);
  assert.match(pipelineStyles, /@media \(max-width: 380px\)\s*\{\s*\.pipeline-data-sources\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);\s*\}/);
  assert.match(styles, /\.pipeline-toggle\[aria-expanded="true"\] svg\s*\{\s*transform:\s*rotate\(180deg\);\s*\}/);
});

test('pipeline disclosure collapses on mobile and restores the expanded desktop flow', () => {
  const start = teacherScript.indexOf('  function initPipelineDisclosure() {');
  const end = teacherScript.indexOf('\n  document.addEventListener(\'DOMContentLoaded\'', start);
  assert.ok(start >= 0 && end > start);

  const attributes = new Map();
  const handlers = new Map();
  const toggle = {
    hidden: true,
    addEventListener(type, handler) { handlers.set(type, handler); },
    getAttribute(name) { return attributes.get(name); },
    setAttribute(name, value) { attributes.set(name, value); }
  };
  const flow = { hidden: false };
  let onViewportChange;
  const mobileQuery = {
    matches: true,
    addEventListener(type, handler) { onViewportChange = handler; },
    addListener(type, handler) { onViewportChange = handler; }
  };
  const initPipelineDisclosure = vm.runInNewContext(
    `${teacherScript.slice(start, end)}\ninitPipelineDisclosure`,
    {
      $: id => id === 'pipeline-toggle' ? toggle : id === 'pipeline-flow' ? flow : null,
      window: { matchMedia(query) { assert.equal(query, '(max-width: 760px)'); return mobileQuery; } }
    }
  );

  initPipelineDisclosure();
  assert.equal(flow.hidden, true);
  assert.equal(toggle.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(attributes.get('aria-label'), 'Show report preparation steps');

  handlers.get('click')();
  assert.equal(flow.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(attributes.get('aria-label'), 'Hide report preparation steps');
  handlers.get('click')();
  assert.equal(flow.hidden, true);

  mobileQuery.matches = false;
  onViewportChange();
  assert.equal(flow.hidden, false);
  assert.equal(toggle.hidden, true);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(attributes.get('aria-label'), 'Hide report preparation steps');

  mobileQuery.matches = true;
  onViewportChange();
  assert.equal(flow.hidden, true);
  assert.equal(toggle.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'false');
});

test('adviser report actions use success toasts and show regeneration progress', () => {
  const root = path.join(__dirname, '../..');
  const page = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const script = pageFs.readFileSync(path.join(root, 'assets/js/teacher/narrative-reports.js'), 'utf8');
  assert.match(page, /id="regenerate-report-label">Regenerate draft<\/span>/);
  assert.match(script, /if \(generated\) showAppToast\(/);
  assert.match(script, /showAppToast\(confirm[\s\S]*?'Correction confirmed\. Not sent to parents\.'[\s\S]*?'Report confirmed\. Not sent to parents\.'[\s\S]*?'Draft saved\.'/);
  assert.match(script, /'regenerate-report-label'\)\.textContent = 'Regenerating\.\.\.'/);
  assert.match(script, /'regenerate-report-label'\)\.textContent = 'Regenerate draft'/);
  assert.match(script, /showAppToast\('Draft regenerated\.'\)/);
  assert.match(script, /showAppToast\(report\.pendingCorrection \? 'Correction released to parents\.' : 'Report released to parents\.'\)/);
  assert.match(script, /showAppToast\('Report reopened for correction\.'\)/);
});

test('adviser cards and review evidence omit Journal outside eligible JHS sections', () => {
  const styles = pageFs.readFileSync(path.join(__dirname, '../../assets/css/adviser/narrative-reports.css'), 'utf8');
  assert.match(styles, /\.report-card-metrics\.without-journal \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /#review-modal \.data-source-grid\.without-journal \.ds-academic \{ grid-column: 1 \/ -1; \}/);
  const student = {
    id: '4', displayName: 'Ari Student', initials: 'AS',
    attendance: { recordedSessions: 1, absent: 0, present: 1 },
    assignments: { total: 1, submitted: 1 },
    academicRecords: [], academicScores: [], academicScoresOmitted: 0,
    journal: { entries: [{ entryText: 'A private reflection.' }] }
  };
  const state = { evidence: { section: { gradeLevel: 'Grade 7', name: 'St. Matthew', journalApplicable: false },
    students: [student] } };
  const elements = {
    'report-search': { value: '' }, 'report-status': { value: 'all' }, 'reports-grid': { innerHTML: '' },
    'review-evidence': { innerHTML: '', withoutJournal: false,
      classList: { toggle(name, value) { elements['review-evidence'].withoutJournal = value; } } }
  };
  const context = { state, student, $: id => elements[id], reportFor: () => null,
    studentInitials: item => item.initials, escape: value => String(value), setMessage() {},
    window: { lucide: { createIcons() {} } } };
  const cardsSource = teacherScript.slice(teacherScript.indexOf('  function renderCards()'), teacherScript.indexOf('  async function loadWeek()'));
  const renderCards = vm.runInNewContext(`${cardsSource}\nrenderCards`, context);
  const reviewStart = teacherScript.indexOf('  function showReview(');
  const reviewSource = teacherScript.slice(teacherScript.indexOf('    const attendance = student.attendance;', reviewStart),
    teacherScript.indexOf('    window.lucide?.createIcons?.();', reviewStart));
  const renderReviewEvidence = vm.runInNewContext(`function renderReviewEvidence() {\n${reviewSource}\n}\nrenderReviewEvidence`, context);

  renderCards();
  renderReviewEvidence();
  assert.match(elements['reports-grid'].innerHTML, /report-card-metrics without-journal/);
  assert.doesNotMatch(elements['reports-grid'].innerHTML, /Journal/);
  assert.equal(elements['review-evidence'].withoutJournal, true);
  assert.doesNotMatch(elements['review-evidence'].innerHTML, /Journal/);
  assert.match(elements['review-evidence'].innerHTML, /Academic records/);

  state.evidence.section.journalApplicable = true;
  renderCards();
  renderReviewEvidence();
  assert.match(elements['reports-grid'].innerHTML, /Journal/);
  assert.match(elements['review-evidence'].innerHTML, /Journal/);
  assert.equal(elements['review-evidence'].withoutJournal, false);
});

test('inline regeneration confirmation cancels safely and starts only after explicit confirmation', async () => {
  const root = path.join(__dirname, '../..');
  const page = pageFs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const styles = pageFs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  assert.match(page, /id="regenerate-confirmation"[^>]*hidden/);
  assert.match(page, /id="keep-current-draft"/);
  assert.match(page, /id="confirm-regenerate"/);
  assert.match(styles, /\.regenerate-confirmation\[hidden\] \{ display: none; \}/);
  assert.doesNotMatch(teacherScript, /window\.confirm\('Replace this draft/);

  const helpers = teacherScript.slice(teacherScript.indexOf('  function updateRegenerateButton()'), teacherScript.indexOf('  function showReview('));
  const regeneration = teacherScript.slice(teacherScript.indexOf('  async function regenerate()'), teacherScript.indexOf('  async function releaseReport('));
  const report = { id: '19', studentId: '111', status: 'draft', releasedAt: null };
  const state = { reports: [report], selectedReportId: '19', generationEnabled: true, busy: false,
    regenerateConfirmOpen: false, evidence: { section: { id: '15' }, reportWeek: { startDate: '2026-10-19' } } };
  let focused, requests = 0, resolveRequest, message, toast;
  const controls = {
    'regenerate-report': { disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; }, focus() { focused = 'regenerate-report'; } },
    'regenerate-confirmation': { hidden: true },
    'keep-current-draft': { focus() { focused = 'keep-current-draft'; } },
    'regenerate-report-label': { textContent: 'Regenerate draft' },
    'review-modal': { querySelector() { return { focus() { focused = 'review-dialog'; } }; } }
  };
  const api = { request() { requests += 1; return new Promise(resolve => { resolveRequest = resolve; }); } };
  const actions = vm.runInNewContext(`${helpers}\n${regeneration}\n({ updateRegenerateButton, openRegenerateConfirmation, cancelRegenerateConfirmation, regenerate })`, {
    state, $: id => controls[id], api, async loadWeek() {}, showReview() {},
    showAppToast(value) { toast = value; }, setMessage(id, value) { message = value; }
  });

  actions.updateRegenerateButton();
  actions.openRegenerateConfirmation();
  assert.equal(requests, 0);
  assert.equal(controls['regenerate-confirmation'].hidden, false);
  assert.equal(controls['regenerate-report'].disabled, true);
  assert.equal(controls['regenerate-report'].attributes['aria-expanded'], 'true');
  assert.equal(focused, 'keep-current-draft');
  actions.cancelRegenerateConfirmation();
  assert.equal(requests, 0);
  assert.equal(controls['regenerate-confirmation'].hidden, true);
  assert.equal(controls['regenerate-report'].disabled, false);
  assert.equal(focused, 'regenerate-report');

  await actions.regenerate();
  assert.equal(requests, 0, 'the request cannot start without the inline confirmation');
  actions.openRegenerateConfirmation();
  const pending = actions.regenerate();
  assert.equal(requests, 1);
  assert.equal(state.busy, true);
  assert.equal(controls['regenerate-confirmation'].hidden, true);
  assert.equal(controls['regenerate-report-label'].textContent, 'Regenerating...');
  assert.equal(focused, 'review-dialog');
  await actions.regenerate();
  assert.equal(requests, 1, 'a second confirmation cannot start another request');
  resolveRequest({ results: [{ status: 'generated' }] });
  await pending;
  assert.equal(state.busy, false);
  assert.equal(controls['regenerate-report'].disabled, false);
  assert.equal(controls['regenerate-report-label'].textContent, 'Regenerate draft');
  assert.equal(toast, 'Draft regenerated.');

  actions.openRegenerateConfirmation();
  const failed = actions.regenerate();
  resolveRequest({ results: [{ status: 'error', message: 'Provider unavailable' }] });
  await failed;
  assert.equal(message, 'Provider unavailable');
  assert.equal(state.busy, false);
  assert.equal(controls['regenerate-report'].disabled, false);
  assert.equal(controls['regenerate-confirmation'].hidden, true);
});

test('regeneration is available for open corrections but not released or confirmed reports', async () => {
  const helpers = teacherScript.slice(teacherScript.indexOf('  function updateRegenerateButton()'), teacherScript.indexOf('  function showReview('));
  const regeneration = teacherScript.slice(teacherScript.indexOf('  async function regenerate()'), teacherScript.indexOf('  async function releaseReport('));
  const report = { id: '19', studentId: '111', status: 'draft', releasedAt: '2026-10-23', pendingCorrection: true };
  const state = { reports: [report], selectedReportId: '19', generationEnabled: true, busy: false,
    regenerateConfirmOpen: false, evidence: { section: { id: '15' }, reportWeek: { startDate: '2026-10-19' } } };
  const controls = {
    'regenerate-report': { disabled: true, setAttribute() {}, removeAttribute() {} },
    'regenerate-confirmation': { hidden: true },
    'regenerate-report-label': { textContent: 'Regenerate draft' },
    'review-modal': { querySelector() { return { focus() {} }; } },
    'keep-current-draft': { focus() {} }
  };
  let requests = 0;
  const actions = vm.runInNewContext(`${helpers}\n${regeneration}\n({ updateRegenerateButton, openRegenerateConfirmation, regenerate })`, {
    state, $: id => controls[id], api: { async request() { requests++; return { results: [{ status: 'generated' }] }; } },
    async loadWeek() {}, showReview() {}, showAppToast() {}, setMessage() {}
  });
  actions.updateRegenerateButton();
  assert.equal(controls['regenerate-report'].disabled, false);
  actions.openRegenerateConfirmation();
  await actions.regenerate();
  assert.equal(requests, 1);

  for (const change of [
    { pendingCorrection: false }, { status: 'confirmed' }, { status: 'draft', pendingCorrection: true, generationEnabled: false }
  ]) {
    Object.assign(report, { status: 'draft', pendingCorrection: true }, change);
    state.generationEnabled = change.generationEnabled ?? true;
    actions.updateRegenerateButton();
    assert.equal(controls['regenerate-report'].disabled, true);
  }
});

test('shared student avatar uses initials without a photo and after a photo load failure', () => {
  const root = path.join(__dirname, '../..');
  const commonScript = pageFs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const start = commonScript.indexOf('function renderAvatar(');
  const end = commonScript.indexOf('\nfunction avatarHtml(', start);
  assert.ok(start >= 0 && end > start);

  const renderAvatar = vm.runInNewContext(
    `const EDUGNAY_API_BASE_URL = 'https://school.example'; ${commonScript.slice(start, end)}; renderAvatar`,
    {
      URL,
      document: {
        createElement(tagName) {
          const listeners = {};
          return {
            tagName: tagName.toUpperCase(), listeners,
            addEventListener(type, handler) { listeners[type] = handler; },
            remove() {
              const index = this.parent.children.indexOf(this);
              if (index >= 0) this.parent.children.splice(index, 1);
            }
          };
        }
      }
    }
  );
  const createAvatarElement = () => {
    const attributes = new Map();
    const classes = new Set();
    const children = [];
    return {
      attributes, classes, children, dataset: {},
      classList: {
        add(name) { classes.add(name); },
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
      },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      querySelector(selector) { return selector === ':scope > img' ? children.find(child => child.tagName === 'IMG') || null : null; },
      replaceChildren(...nodes) {
        children.splice(0, children.length, ...nodes);
        nodes.forEach(node => { node.parent = this; });
      },
      appendChild(node) { node.parent = this; children.push(node); }
    };
  };

  const initialsOnly = createAvatarElement();
  renderAvatar(initialsOnly, { id: 42, name: 'Lee Learner', initials: 'LL', role: 'student' }, { size: 'compact' });
  assert.equal(initialsOnly.children[0].textContent, 'LL');
  assert.equal(initialsOnly.classes.has('person-avatar--compact'), true);
  assert.equal(initialsOnly.dataset.avatarTone, 'green');

  const photoAvatar = createAvatarElement();
  renderAvatar(photoAvatar, {
    id: 42, name: 'Lee Learner', initials: 'LL', role: 'student',
    avatarUrl: '/api/users/42/avatar?v=3'
  }, { size: 'compact' });
  const image = photoAvatar.children.find(child => child.tagName === 'IMG');
  assert.equal(image.src, 'https://school.example/api/users/42/avatar?v=3');
  assert.equal(image.crossOrigin, 'use-credentials');
  image.listeners.error();
  assert.deepEqual(photoAvatar.children.map(child => child.textContent), ['LL']);
});
