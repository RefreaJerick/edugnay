const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const databaseModule = require('../config/database');
let activeParentDatabase;
databaseModule.getDatabase = () => activeParentDatabase;
const { releaseConfirmedReport } = require('../controllers/narrativeReportReviewController');
const { linkedChild, listChildReports, readPublicReports } = require('../controllers/narrativeReportParentController');
const { currentReportWeekRange } = require('../utils/reportWeekSettings');

function releaseRequest(reportId = '101') {
  return {
    user: { id: 3, schoolId: 1, role: 'teacher' },
    params: { reportId },
    body: {}
  };
}

function releaseDatabase({ report = null, notify = true, failNotification = false } = {}) {
  const calls = [];
  const record = report || {
    id: 101, status: 'confirmed', followUpSuggestion: 'Check in.', studentId: 4,
    sectionId: 22, releasedAt: null, weekStartDate: '2026-10-12'
  };
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM narrative_reports AS reports')) return [[record]];
      if (sql.includes('FROM narrative_report_releases') && sql.includes('version_number AS versionNumber')) {
        return [[record.releasedAt ? { versionNumber: 1 } : undefined].filter(Boolean)];
      }
      if (sql.startsWith('UPDATE narrative_reports SET released_at')) {
        record.releasedAt = new Date();
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('COALESCE(teacher_edited_summary, generated_summary)')) {
        return [[{ summary: 'Approved summary.', releasedAt: record.releasedAt }]];
      }
      if (sql.includes('FROM report_recommendations')) return [[{ text: 'Read together.' }]];
      if (sql.includes('SELECT display_name AS displayName FROM users WHERE id = ?')) return [[{ displayName: 'Adviser' }]];
      if (sql.includes('SELECT display_name AS displayName FROM users')) return [[{ displayName: 'Synthetic Learner' }]];
      if (sql.includes('FROM parent_notification_triggers AS triggers')) return [[{ enabled: notify ? 1 : 0 }]];
      if (sql.startsWith('INSERT INTO notifications')) {
        if (failNotification) throw new Error('notification insert failed');
        return [{ affectedRows: 2 }];
      }
      return [{ affectedRows: 1 }];
    },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); }
  };
  return { calls, record, async getConnection() { return connection; } };
}

test('adviser release exposes only confirmed reports and creates one linked-parent notification event', async () => {
  const previous = process.env.AI_REPORTS_RELEASE_ENABLED;
  process.env.AI_REPORTS_RELEASE_ENABLED = 'true';
  try {
    const database = releaseDatabase();
    const result = await releaseConfirmedReport(releaseRequest(), database);
    assert.deepEqual(result, { reportId: '101', status: 'released', versionNumber: 1, alreadyReleased: false });
    const snapshot = database.calls.find(call => call.sql?.includes('INSERT INTO narrative_report_releases'));
    assert.equal(snapshot.values[2], 1);
    assert.equal(snapshot.values[3], 'Approved summary.');
    assert.equal(snapshot.values[4], '["Read together."]');
    const notification = database.calls.find(call => call.sql?.startsWith('INSERT INTO notifications'));
    assert.ok(notification);
    assert.equal(notification.values[0], 'report');
    assert.equal(notification.values[4], 'narrative-report:101:released');
    assert.match(notification.values[3], /studentId=4&reportId=101/);
    assert.match(notification.sql, /SELECT DISTINCT parents\.id/);
    assert.match(notification.sql, /student_parent_links AS links/);
    assert.ok(database.calls.some(call => call.sql?.includes("report_status = 'confirmed'") && call.sql?.includes('pending_correction = TRUE')));
    assert.ok(database.calls.some(call => call.sql?.includes("'narrative_report_released'")));
    const auditIndex = database.calls.findIndex(call => call.sql?.includes('INSERT INTO audit_logs'));
    const notificationIndex = database.calls.findIndex(call => call.sql?.startsWith('INSERT INTO notifications'));
    assert.ok(auditIndex >= 0 && auditIndex < notificationIndex);
    assert.ok(database.calls.includes('COMMIT'));
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_RELEASE_ENABLED;
    else process.env.AI_REPORTS_RELEASE_ENABLED = previous;
  }
});

test('release is idempotent, respects disabled notices, and rolls back on notification failure', async () => {
  const previous = process.env.AI_REPORTS_RELEASE_ENABLED;
  process.env.AI_REPORTS_RELEASE_ENABLED = 'true';
  try {
    const alreadyReleased = releaseDatabase({ report: {
      id: 101, status: 'confirmed', followUpSuggestion: null, studentId: 4,
      sectionId: 22, releasedAt: new Date(), weekStartDate: '2026-10-12'
    } });
    assert.deepEqual(await releaseConfirmedReport(releaseRequest(), alreadyReleased),
      { reportId: '101', status: 'released', alreadyReleased: true });
    assert.equal(alreadyReleased.calls.some(call => call.sql?.startsWith('INSERT INTO notifications')), false);

    const noNotice = releaseDatabase({ notify: false });
    await releaseConfirmedReport(releaseRequest(), noNotice);
    assert.equal(noNotice.calls.some(call => call.sql?.startsWith('INSERT INTO notifications')), false);
    assert.ok(noNotice.calls.includes('COMMIT'));

    const rollback = releaseDatabase({ failNotification: true });
    await assert.rejects(releaseConfirmedReport(releaseRequest(), rollback), /notification insert failed/);
    assert.ok(rollback.calls.includes('ROLLBACK'));
    assert.equal(rollback.calls.includes('COMMIT'), false);
    const rollbackAuditIndex = rollback.calls.findIndex(call => call.sql?.includes('INSERT INTO audit_logs'));
    const rollbackNotificationIndex = rollback.calls.findIndex(call => call.sql?.startsWith('INSERT INTO notifications'));
    assert.ok(rollbackAuditIndex >= 0 && rollbackAuditIndex < rollbackNotificationIndex);
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_RELEASE_ENABLED;
    else process.env.AI_REPORTS_RELEASE_ENABLED = previous;
  }
});

test('parent cannot read an unlinked child and report output is limited to released parent-facing fields', async () => {
  const scopedCalls = [];
  await assert.rejects(linkedChild({ execute: async (sql, values) => {
    scopedCalls.push({ sql, values });
    return [[]];
  } }, { user: { id: 8, schoolId: 2 }, params: { studentId: '44' } }), error => error.status === 404);
  assert.deepEqual(scopedCalls[0].values, [2, 8, 44]);

  let reportQuery = '';
  let reportQueryValues = [];
  const database = { execute: async (sql, values) => {
    if (sql.includes('FROM narrative_reports AS reports')) {
      reportQuery = sql;
      reportQueryValues = values;
      return [[{
      id: 101, studentId: 4, weekStartDate: '2026-10-12', weekEndDate: '2026-10-17',
      summary: 'A parent-facing summary.', parentActions: '["Read together this week."]', versionNumber: 1,
      releasedAt: '2026-10-18T10:00:00', adviserName: 'Ms. Synthetic Adviser',
      teacherNote: 'PRIVATE', reflectionText: 'PRIVATE', followUpSuggestion: 'PRIVATE', isAtRisk: 1
      }]];
    }
    return [[]];
  } };
  const [report] = await readPublicReports(database, 1, 4);
  assert.match(reportQuery, /INNER JOIN narrative_report_releases AS releases/);
  assert.match(reportQuery, /released_at IS NOT NULL/);
  assert.match(reportQuery, /ORDER BY history\.version_number DESC LIMIT 1/);
  assert.match(reportQuery, /releases\.released_by_name AS adviserName/);
  assert.deepEqual(reportQueryValues, [1, 4]);
  assert.deepEqual(Object.keys(report).sort(),
    ['id', 'studentId', 'weekStartDate', 'weekEndDate', 'summary', 'parentActions', 'releasedAt', 'adviserName', 'versionNumber', 'correctedAt'].sort());
  assert.equal(report.adviserName, 'Ms. Synthetic Adviser');
  assert.deepEqual(report.parentActions, ['Read together this week.']);
  assert.equal(report.teacherNote, undefined);
  assert.equal(report.followUpSuggestion, undefined);
  assert.equal(report.candidateReasons, undefined);

  let directValues;
  const directDatabase = { execute: async (sql, values) => {
    if (sql.includes('FROM narrative_reports AS reports')) {
      directValues = values;
      assert.match(sql, /AND reports\.id = \?/);
    }
    return [[]];
  } };
  assert.deepEqual(await readPublicReports(directDatabase, 1, 44, 900), []);
  assert.deepEqual(directValues, [1, 44, 900]);
});

test('parent report list includes the school-configured current report week', async () => {
  const settings = { weekStartDay: 5, weekEndDay: 2 };
  const reportRows = [{
    id: 101, studentId: 4, weekStartDate: '2026-10-23', weekEndDate: '2026-10-27',
    summary: 'A released report.', parentActions: '[]', versionNumber: 1,
    releasedAt: '2026-10-28T10:00:00', adviserName: 'Adviser'
  }];
  activeParentDatabase = {
    async execute(sql) {
      if (sql.includes('FROM student_parent_links AS links')) {
        return [[{ studentId: 4, displayName: 'Linked Learner', reportsEnabled: 1 }]];
      }
      if (sql.includes('FROM narrative_reports AS reports')) return [reportRows];
      if (sql.includes('FROM school_settings')) return [[settings]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const response = { headers: {} };
  try {
    await listChildReports({ user: { id: 8, schoolId: 2 }, params: { studentId: '4' } }, {
      set(name, value) { response.headers[name] = value; },
      json(body) { response.body = body; }
    }, error => { response.error = error; });
  } finally {
    activeParentDatabase = null;
  }
  assert.equal(response.error, undefined);
  assert.equal(response.body.child.displayName, 'Linked Learner');
  assert.equal(response.body.reports.length, 1);
  assert.deepEqual(response.body.currentReportWeek, currentReportWeekRange(settings));
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('release flag defaults off and parent routes require parent authorization', () => {
  const root = path.join(__dirname, '../..');
  const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../routes/reports.js'), 'utf8');
  const parentPage = fs.readFileSync(path.join(root, 'views/parent/edugnay-parent-reports.html'), 'utf8');
  const parentScript = fs.readFileSync(path.join(root, 'assets/js/parent/narrative-reports.js'), 'utf8');
  assert.match(envExample, /^AI_REPORTS_RELEASE_ENABLED=false$/m);
  assert.ok(routes.includes("router.post('/weekly-drafts/:reportId/release', requireSchoolUser, requireRoles('teacher')"));
  assert.ok(routes.includes("router.get('/parent/children/:studentId', requireSchoolUser, requireRoles('parent')"));
  assert.match(parentPage, /parentReportChildSwitcher/);
  assert.match(parentPage, /latest-report/);
  assert.doesNotMatch(parentPage, /parent-report-search|parent-report-year|filter-row/);
  assert.match(parentPage, /parent-report-list/);
  assert.match(parentPage, /parent-report-modal/);
  assert.match(parentScript, /reports\/parent\/children/);
  assert.match(parentScript, /renderPastReports/);
  assert.doesNotMatch(parentScript, /parent-report-search|parent-report-year|No matching reports/);
  assert.match(parentScript, /openReport\(linkedReport, null, false\)/);
  assert.doesNotMatch(parentScript, /teacherNote|followUpSuggestion|isAtRisk|reflectionText/);
  assert.ok(fs.existsSync(path.join(root, 'assets/js/parent/narrative-reports.js')));
});

test('parent page features the latest report and shows every past report without exposing private fields', async () => {
  const reports = [
    { id: '101', studentId: '4', weekStartDate: '2026-10-26', weekEndDate: '2026-10-31',
      summary: 'Approved summary for Sam: latest approved summary. In Values Education, Sam scored 6/10, 7/10, and 5/10 this week.', parentActions: [], adviserName: 'Ms. Adviser',
      releasedAt: '2026-10-30T10:00:00', correctedAt: '2026-10-30T10:00:00', versionNumber: 2,
      teacherNote: 'PRIVATE NOTE' },
    { id: '99', studentId: '4', weekStartDate: '2026-10-19', weekEndDate: '2026-10-24',
      summary: 'Approved summary for Lee:  older approved summary', parentActions: ['Read together'], adviserName: 'Mr. Former Adviser',
      releasedAt: '2026-10-30T09:00:00', followUpSuggestion: 'PRIVATE FOLLOW-UP' },
    { id: '98', studentId: '4', weekStartDate: '2025-05-26', weekEndDate: '2025-05-31',
      summary: 'ordinary report summary', parentActions: [], adviserName: 'Mr. Former Adviser',
      releasedAt: '2025-06-01T09:00:00' }
  ];
  const nodes = new Map();
  const listeners = {};
  const makeNode = id => ({
    id, hidden: false, innerHTML: '', textContent: '', value: '',
    isConnected: true, dataset: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { this.listeners[type] = callback; },
    querySelector() { return nodes.get('modal-close-button'); },
    querySelectorAll() { return [nodes.get('modal-close-button'), nodes.get('modal-footer-button')]; },
    focus() { document.activeElement = this; }
  });
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  };
  const document = {
    activeElement: null,
    body: makeNode('body'),
    getElementById: get,
    querySelectorAll(selector) { return selector === '[data-close-report]'
      ? [get('modal-close-button'), get('modal-footer-button')] : []; },
    addEventListener(type, callback) { listeners[type] = callback; }
  };
  const location = { href: 'http://localhost/views/parent/edugnay-parent-reports.html', search: '' };
  const window = {
    location,
    history: { replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
      location.search = new URL(location.href).search;
    } },
    EDUGNAY_SCHOOL_READY: Promise.resolve(),
    EDUGNAY_API: {
      async getParentChildren() { return [
        { studentId: '4', displayName: 'Lee Learner' },
        { studentId: '5', displayName: 'Sam Learner' },
        { studentId: '6', displayName: 'One Report Learner' },
        { studentId: '7', displayName: 'Older Report Learner' }
      ]; },
      async request(url) {
        if (url.endsWith('/99')) return { report: reports[1] };
        if (/\/\d+\/\d+$/.test(url)) throw Object.assign(new Error('Not found'), { status: 404 });
        const currentReportWeek = { startDate: '2026-10-26', endDate: '2026-10-31' };
        if (url.endsWith('/5')) return { reports: [], currentReportWeek };
        if (url.endsWith('/6')) return { reports: [{ ...reports[0], versionNumber: 1, correctedAt: null }], currentReportWeek };
        if (url.endsWith('/7')) return { reports: reports.slice(1), currentReportWeek };
        return { reports, currentReportWeek };
      }
    },
    EDUGNAY_CONFIG: {
      escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]); },
      renderPanelEmptyState({ title }) { return `<div class="panel-empty-state">${title}</div>`; },
      renderPanelSkeleton({ label }) { return `<div class="panel-skeleton">${label}</div>`; }
    },
    EDUGNAY_AVATAR: { html() { return '<span class="child-avatar"></span>'; }, hydrate() {} },
    lucide: { createIcons() {} }
  };
  const script = fs.readFileSync(path.join(__dirname, '../../assets/js/parent/narrative-reports.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../../assets/css/parent/reports.css'), 'utf8');
  assert.match(styles, /\.latest-report-hero \.lr-head \.report-correction-notice\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin:\s*0;/s);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.latest-report-hero \.lr-head \{\s*display:\s*block;\s*\}[\s\S]*?\.latest-report-hero \.lr-head \.report-correction-notice \{\s*margin:\s*10px 0 0 48px;/);
  vm.runInNewContext(script, { window, document, URL, URLSearchParams, Intl, Date, String, Number, Set, Array });
  await listeners.DOMContentLoaded();
  assert.match(get('latest-report').innerHTML, /Latest approved summary/);
  assert.match(get('latest-report').innerHTML, /Values Education.*6\/10, 7\/10, and 5\/10/);
  assert.match(get('latest-report').innerHTML, /Updated on October 30, 2026/);
  assert.match(get('latest-report').innerHTML, /class="lr-head"[\s\S]*?class="report-correction-notice"[\s\S]*?<\/div><span class="lr-quote-mark"/);
  assert.doesNotMatch(get('latest-report').innerHTML, /Approved summary for Sam:/);
  assert.doesNotMatch(get('latest-report').innerHTML, /Older approved summary|PRIVATE NOTE/);
  assert.doesNotMatch(get('latest-report').innerHTML, /Recommended actions/);
  assert.match(get('parent-report-list').innerHTML, /Older approved summary/);
  assert.match(get('parent-report-list').innerHTML, /ordinary report summary/);
  assert.doesNotMatch(get('parent-report-list').innerHTML, /Approved summary for Lee:/);
  assert.doesNotMatch(get('parent-report-list').innerHTML, /PRIVATE FOLLOW-UP/);
  assert.match(get('parent-report-list').innerHTML, /Older approved summary/);
  assert.match(get('parent-report-list').innerHTML, /ordinary report summary/);
  assert.equal((get('parent-report-list').innerHTML.match(/class="timeline-entry"/g) || []).length, 2);
  const trigger = get('timeline-trigger');
  trigger.dataset.reportId = '99';
  get('parent-report-list').listeners.click({ target: { closest: () => trigger } });
  assert.equal(get('parent-report-modal').hidden, false);
  assert.equal(get('parent-report-modal-summary').textContent, 'Older approved summary');
  assert.equal(reports[1].summary, 'Approved summary for Lee:  older approved summary');
  assert.match(get('parent-report-modal-actions').innerHTML, /Read together/);
  assert.match(location.search, /reportId=99/);
  listeners.keydown({ key: 'Escape' });
  assert.equal(get('parent-report-modal').hidden, true);
  assert.equal(document.activeElement, trigger);
  assert.doesNotMatch(location.search, /reportId=/);
  location.href = 'http://localhost/views/parent/edugnay-parent-reports.html?studentId=4&reportId=99';
  location.search = '?studentId=4&reportId=99';
  await listeners.DOMContentLoaded();
  assert.equal(get('parent-report-modal').hidden, false);
  assert.equal(get('parent-report-modal-summary').textContent, 'Older approved summary');
  get('modal-footer-button').listeners.click();
  location.href = 'http://localhost/views/parent/edugnay-parent-reports.html?studentId=4&reportId=900';
  location.search = '?studentId=4&reportId=900';
  await listeners.DOMContentLoaded();
  assert.equal(get('parent-report-modal').hidden, true);
  assert.match(get('parent-reports-message').textContent, /unavailable/i);
  assert.doesNotMatch(location.search, /reportId=/);
  get('parentReportChildSwitcher').listeners.click({ target: { closest: () => ({ dataset: { studentId: '5' } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(get('parent-reports-empty').innerHTML, /No reports shared yet/);
  assert.equal(get('parent-reports-content').hidden, true);
  get('parentReportChildSwitcher').listeners.click({ target: { closest: () => ({ dataset: { studentId: '6' } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('parent-reports-content').hidden, false);
  assert.match(get('latest-report').innerHTML, /Latest approved summary/);
  assert.doesNotMatch(get('latest-report').innerHTML, /report-correction-notice/);
  assert.match(get('parent-report-list').innerHTML, /No earlier reports/);
  assert.equal((get('parent-report-list').innerHTML.match(/class="timeline-entry"/g) || []).length, 0);
  get('parentReportChildSwitcher').listeners.click({ target: { closest: () => ({ dataset: { studentId: '4' } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('parent-reports-empty').hidden, true);
  assert.match(get('latest-report').innerHTML, /Latest approved summary/);
  get('parentReportChildSwitcher').listeners.click({ target: { closest: () => ({ dataset: { studentId: '7' } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('parent-reports-content').hidden, false);
  assert.match(get('latest-report').innerHTML, /No report for this week/);
  assert.match(get('parent-report-list').innerHTML, /Older approved summary/);
  assert.equal((get('parent-report-list').innerHTML.match(/class="timeline-entry"/g) || []).length, 2);
});
