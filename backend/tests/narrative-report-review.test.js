const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { saveReviewDraft, confirmDraft, reviewValues } = require('../controllers/narrativeReportReviewController');
const teacherScript = fs.readFileSync(path.join(__dirname, '../../assets/js/teacher/narrative-reports.js'), 'utf8');

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
    'pipeline-context': { textContent: '' }
  };
  const state = { evidence: null, reports: [] };
  const messages = {};
  const source = teacherScript.slice(teacherScript.indexOf('  async function loadWeek()'), teacherScript.indexOf('  function generationCandidates()'));
  const loadWeek = vm.runInNewContext(`${source}\nloadWeek`, {
    state,
    $: id => elements[id],
    setGenerationButtonState() {},
    renderCounts() {},
    renderCards() {},
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
  assert.equal(failed.messages['reports-message'].error, true);
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

test('teacher page gates parent release separately from confirmation', () => {
  const root = path.join(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'assets/js/teacher/narrative-reports.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  const sharedStyles = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
  const commonScript = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../routes/reports.js'), 'utf8');
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
  assert.match(styles, /\.reports-context-controls select:focus\s*\{[^}]*border-color:\s*var\(--blue-mid\);[^}]*box-shadow:\s*0 0 0 3px/s);
  assert.match(styles, /\.search-icon svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s);
  assert.match(styles, /\.search-input\s*\{[^}]*background:\s*var\(--white\);/s);
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
  assert.match(script, /No AI follow-up suggestion was provided/);
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
  assert.match(script, /setMessage\('reports-message', error\.message \|\| 'Weekly reports could not be loaded\.', true\)/);
  assert.match(styles, /@media \(max-width: 1232px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(routes, /weekly-drafts\/:reportId\/confirm.*requireSchoolUser.*requireRoles\('teacher'\)/);
  assert.match(routes, /weekly-drafts\/:reportId\/release.*requireSchoolUser.*requireRoles\('teacher'\)/);
});

test('adviser report actions use success toasts and show regeneration progress', () => {
  const root = path.join(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'assets/js/teacher/narrative-reports.js'), 'utf8');
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
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/adviser/narrative-reports.css'), 'utf8');
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
  const page = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
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

test('shared student avatar uses initials without a photo and after a photo load failure', () => {
  const root = path.join(__dirname, '../..');
  const commonScript = fs.readFileSync(path.join(root, 'assets/js/shell-common.js'), 'utf8');
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
