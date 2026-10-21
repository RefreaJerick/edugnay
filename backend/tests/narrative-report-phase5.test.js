const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { reopenConfirmedReport, releaseConfirmedReport, readReleaseHistory } = require('../controllers/narrativeReportReviewController');
const { readPublicReports } = require('../controllers/narrativeReportParentController');
const { manilaDate, reserveModelCall, generateWithQuota } = require('../services/aiReportUsage');

const request = (body = {}, role = 'teacher') => ({
  user: { id: 3, schoolId: 1, role }, params: { reportId: '101' }, body
});

function reportDatabase({ report, history = [], denied = false }) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('BEGIN'); },
    async commit() { calls.push('COMMIT'); },
    async rollback() { calls.push('ROLLBACK'); },
    release() { calls.push('RELEASE'); },
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM narrative_reports AS reports')) return [[report].filter(() => !denied)];
      if (sql.includes('FROM narrative_report_releases') && sql.includes('version_number AS versionNumber')) {
        return [[history.length ? { versionNumber: history.length } : null].filter(Boolean)];
      }
      if (sql.startsWith('UPDATE narrative_reports SET released_at')) return [{ affectedRows: 1 }];
      if (sql.includes('COALESCE(teacher_edited_summary, generated_summary)')) {
        return [[{ summary: 'Corrected summary.', releasedAt: '2026-10-22 09:00:00' }]];
      }
      if (sql.includes('FROM report_recommendations')) return [[{ text: 'Read together.' }]];
      if (sql.includes('SELECT display_name AS displayName FROM users WHERE id = ?')) return [[{ displayName: 'Adviser' }]];
      if (sql.includes('SELECT display_name AS displayName FROM users')) return [[{ displayName: 'Synthetic Learner' }]];
      if (sql.includes('FROM parent_notification_triggers')) return [[{ enabled: 1 }]];
      return [{ affectedRows: 1 }];
    }
  };
  return { calls, getConnection: async () => connection };
}

test('reopen requires a reason, active original-section adviser, and a confirmed report', async () => {
  const base = { id: 101, sectionId: 22, studentId: 4, status: 'confirmed', releasedAt: null };
  await assert.rejects(reopenConfirmedReport(request({ reason: ' ' }), reportDatabase({ report: base })), error => error.status === 400);
  const denied = reportDatabase({ report: base, denied: true });
  await assert.rejects(reopenConfirmedReport(request({ reason: 'Correct the wording.' }), denied), error => error.status === 404);
  assert.match(denied.calls.find(call => call.sql?.includes('FROM narrative_reports AS reports')).sql,
    /sections\.status = 'active' AND features\.narrative_reports_enabled = 1/);
  assert.deepEqual(denied.calls.find(call => call.sql?.includes('FROM narrative_reports AS reports')).values, [101, 1, 3]);
  const db = reportDatabase({ report: base });
  assert.deepEqual(await reopenConfirmedReport(request({ reason: 'Correct the wording.' }), db),
    { reportId: '101', status: 'draft', pendingCorrection: false });
  assert.equal(db.calls.find(call => call.sql?.startsWith('UPDATE narrative_reports')).values[0], false);
  assert.ok(db.calls.some(call => call.sql?.includes('INSERT INTO audit_logs') &&
    call.values[2] === 'narrative_report_reopened' && JSON.parse(call.values[5]).reason === 'Correct the wording.'));
});

test('corrected release creates version 2 in one transaction and uses a distinct notification key', async () => {
  const previous = process.env.AI_REPORTS_RELEASE_ENABLED;
  process.env.AI_REPORTS_RELEASE_ENABLED = 'true';
  try {
    const report = { id: 101, sectionId: 22, studentId: 4, status: 'confirmed',
      releasedAt: '2026-10-18 08:00:00', pendingCorrection: 1, weekStartDate: '2026-10-12' };
    const db = reportDatabase({ report, history: [{ versionNumber: 1 }] });
    assert.deepEqual(await releaseConfirmedReport(request(), db),
      { reportId: '101', status: 'released', versionNumber: 2, alreadyReleased: false });
    const snapshot = db.calls.find(call => call.sql?.includes('INSERT INTO narrative_report_releases'));
    assert.deepEqual(snapshot.values.slice(0, 5), [1, 101, 2, 'Corrected summary.', '["Read together."]']);
    const notification = db.calls.find(call => call.sql?.startsWith('INSERT INTO notifications'));
    assert.equal(notification.values[4], 'narrative-report:101:released:v2');
    assert.ok(db.calls.indexOf(snapshot) < db.calls.indexOf(notification));
    assert.ok(db.calls.indexOf(notification) < db.calls.indexOf('COMMIT'));
    const incomplete = reportDatabase({ report, history: [] });
    await assert.rejects(releaseConfirmedReport(request(), incomplete), error => error.status === 409);
    assert.equal(incomplete.calls.some(call => call.sql?.startsWith('INSERT INTO notifications')), false);
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_RELEASE_ENABLED;
    else process.env.AI_REPORTS_RELEASE_ENABLED = previous;
  }
});

test('parent reads the last release during an open correction and never receives private fields', async () => {
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push({ sql, values });
    return [[{ id: 101, studentId: 4, weekStartDate: '2026-10-12', weekEndDate: '2026-10-17',
      summary: 'Released version one.', parentActions: '["Keep reading."]', versionNumber: 1,
      releasedAt: '2026-10-18T08:00:00', adviserName: 'Original Adviser',
      teacherNote: 'PRIVATE', followUpSuggestion: 'PRIVATE' }]];
  } };
  const [report] = await readPublicReports(database, 1, 4, 101);
  assert.equal(report.summary, 'Released version one.');
  assert.equal(report.correctedAt, null);
  assert.equal(report.teacherNote, undefined);
  assert.equal(report.followUpSuggestion, undefined);
  assert.doesNotMatch(calls[0].sql, /report_status = 'confirmed'/);
  assert.deepEqual(calls[0].values, [1, 4, 101]);
  assert.match(calls[0].sql, /history\.school_id = reports\.school_id/);
});

test('release history is school-scoped and adviser access is limited to active original section', async () => {
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM narrative_reports AS reports')) return [[{ id: 101 }]];
    if (sql.includes('FROM narrative_report_releases AS releases')) return [[{
      versionNumber: 2, summary: 'Corrected.', parentActions: '["Read together."]',
      releasedAt: '2026-10-22T09:00:00', adviserName: 'Adviser'
    }]];
    return [[{ reopenedAt: '2026-10-21T09:00:00', adviserName: 'Adviser', details: '{"reason":"Typo"}' }]];
  } };
  const result = await readReleaseHistory(database, request());
  assert.equal(result.releases[0].versionNumber, 2);
  assert.deepEqual(result.releases[0].parentActions, ['Read together.']);
  assert.equal(result.reopens[0].reason, 'Typo');
  assert.match(calls[0].sql, /sections\.status = 'active' AND sections\.adviser_user_id = \?/);
  assert.deepEqual(calls[0].values, [101, 1, 3]);
  await readReleaseHistory(database, request({}, 'school_admin'));
  assert.doesNotMatch(calls[3].sql, /sections\.adviser_user_id/);
  assert.deepEqual(calls[3].values, [101, 1]);
  await assert.rejects(readReleaseHistory({ execute: async () => [[]] }, request()), error => error.status === 404);
});

test('AI quota reserves before sending, counts failures, isolates schools, and rolls over in Manila', async () => {
  const previous = process.env.AI_REPORTS_DAILY_CALL_LIMIT;
  process.env.AI_REPORTS_DAILY_CALL_LIMIT = '2';
  try {
    const counters = new Map();
    const calls = [];
    const database = { async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('ai_evidence_approved_at')) return [[{ approvedAt: '2026-10-22 08:00:00' }]];
      if (sql.startsWith('INSERT INTO ai_report_daily_usage')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE ai_report_daily_usage SET call_count')) {
        const key = `${values[0]}:${values[1]}`;
        const count = counters.get(key) || 0;
        if (count >= values[2]) return [{ affectedRows: 0 }];
        counters.set(key, count + 1);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    } };
    const input = { database, schoolId: 1, student: {}, reportWeek: {}, teacherNote: '' };
    const now = new Date('2026-10-21T16:30:00Z');
    await generateWithQuota(input, { now, provider: async () => ({ usage: { inputTokens: 10, outputTokens: 5 } }) });
    await assert.rejects(generateWithQuota(input, { now, provider: async () => {
      const error = new Error('Provider failed'); error.category = 'provider'; throw error;
    } }), /Provider failed/);
    assert.equal(counters.get('1:2026-10-22'), 2);
    assert.equal(calls.filter(call => call.sql?.includes('INSERT INTO ai_report_daily_errors')).length, 1);
    await assert.rejects(generateWithQuota(input, { now, provider: async () => { throw new Error('Must not send'); } }),
      error => error.status === 429);
    assert.equal(counters.get('1:2026-10-22'), 2);
    await reserveModelCall(database, 2, '2026-10-22');
    await reserveModelCall(database, 1, '2026-10-23');
    assert.equal(counters.get('2:2026-10-22'), 1);
    assert.equal(counters.get('1:2026-10-23'), 1);
    assert.equal(manilaDate(new Date('2026-10-21T15:59:59Z')), '2026-10-21');
    assert.equal(manilaDate(now), '2026-10-22');
    assert.equal(calls.some(call => JSON.stringify(call.values).includes('Provider failed')), false);
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_DAILY_CALL_LIMIT;
    else process.env.AI_REPORTS_DAILY_CALL_LIMIT = previous;
  }
});

test('revoked school approval blocks the AI before quota or provider use', async () => {
  let providerCalled = false;
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push({ sql, values });
    return [[]];
  } };
  await assert.rejects(generateWithQuota({ database, schoolId: 1, student: {}, reportWeek: {} }, {
    provider: async () => { providerCalled = true; }
  }), error => error.status === 503);
  assert.equal(providerCalled, false);
  assert.equal(calls.length, 1);
});

test('concurrent reservations use the atomic school/day update and stop at the limit', async () => {
  const previous = process.env.AI_REPORTS_DAILY_CALL_LIMIT;
  process.env.AI_REPORTS_DAILY_CALL_LIMIT = '2';
  try {
    let count = 0;
    let providerCalls = 0;
    const database = { async execute(sql) {
      if (sql.includes('ai_evidence_approved_at')) return [[{ approvedAt: '2026-10-22' }]];
      if (sql.startsWith('INSERT INTO ai_report_daily_usage')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE ai_report_daily_usage SET call_count')) {
        assert.match(sql, /call_count = call_count \+ 1[\s\S]*call_count < \?/);
        return [{ affectedRows: count++ < 2 ? 1 : 0 }];
      }
      return [{ affectedRows: 1 }];
    } };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => generateWithQuota({
      database, schoolId: 1, student: {}, reportWeek: {}
    }, { provider: async () => { providerCalls += 1; return { usage: null }; } })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 3);
    assert.equal(providerCalls, 2);
  } finally {
    if (previous === undefined) delete process.env.AI_REPORTS_DAILY_CALL_LIMIT;
    else process.env.AI_REPORTS_DAILY_CALL_LIMIT = previous;
  }
});

test('migration backfills version one and makes release rows append-only', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'database/migrations/047_narrative_report_corrections_and_ai_controls.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  assert.match(migration, /INSERT INTO narrative_report_releases[\s\S]*?SELECT reports\.school_id, reports\.id, 1/);
  assert.match(migration, /GROUP_CONCAT\(JSON_QUOTE\(actions\.recommendation_text\) ORDER BY actions\.display_order/);
  assert.match(migration, /WHERE reports\.report_status = 'confirmed' AND reports\.released_at IS NOT NULL/);
  assert.match(migration, /CREATE TRIGGER narrative_release_no_update BEFORE UPDATE/);
  assert.match(migration, /CREATE TRIGGER narrative_release_no_delete BEFORE DELETE/);
  assert.match(schema, /released_by_name VARCHAR\(255\) NOT NULL/);
  assert.match(schema, /PRIMARY KEY \(school_id, usage_date\)/);
  assert.match(schema, /PRIMARY KEY \(school_id, usage_date, error_category\)/);
});

test('admin release history view is read-only and parses as JavaScript', () => {
  const root = path.join(__dirname, '../..');
  const page = fs.readFileSync(path.join(root, 'views/admin/edugnay-admin-reports.html'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'backend/routes/reports.js'), 'utf8');
  assert.match(routes, /router\.get\('\/weekly-release-history', requireSchoolUser, requireRoles\('school_admin'\)/);
  assert.match(page, /id="school-release-list"/);
  assert.match(page, /id="school-release-detail"/);
  assert.match(page, /\/reports\/weekly-release-history/);
  for (const script of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (script[1].trim()) assert.doesNotThrow(() => new vm.Script(script[1]));
  }
});

test('teacher correction UI keeps regeneration disabled and parent UI labels updated releases', () => {
  const root = path.join(__dirname, '../..');
  const teacher = fs.readFileSync(path.join(root, 'assets/js/teacher/narrative-reports.js'), 'utf8');
  const parent = fs.readFileSync(path.join(root, 'assets/js/parent/narrative-reports.js'), 'utf8');
  const teacherPage = fs.readFileSync(path.join(root, 'views/teacher/edugnay-teacher-reports.html'), 'utf8');
  const teacherStyles = fs.readFileSync(path.join(root, 'assets/css/adviser/narrative-reports.css'), 'utf8');
  assert.match(teacher, /'regenerate-report'\)\.hidden = !editable \|\| Boolean\(report\.releasedAt\)/);
  assert.match(teacher, /report\.pendingCorrection[\s\S]*?Parents still see the last released version/);
  assert.match(teacher, /\/weekly-drafts\/\$\{encodeURIComponent\(report\.id\)\}\/reopen/);
  assert.match(teacherPage, /id="report-reopen-reason" maxlength="500"/);
  const historySection = teacherPage.match(/<section class="review-section report-history-section"[\s\S]*?<\/section>/)?.[0];
  assert.ok(historySection, 'released reports have a Released versions section');
  assert.match(historySection, /<button[^>]*id="report-history"[^>]*aria-controls="report-history-content"[^>]*aria-expanded="false">Show versions<\/button>/);
  assert.match(historySection, /<div id="report-history-content" hidden><\/div>/);
  const reviewFooter = teacherPage.match(/<div class="review-modal-foot">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)?.[1] || '';
  assert.doesNotMatch(reviewFooter, /id="report-history"/);
  assert.match(teacher, /historySection\.hidden = !report\.releasedAt/);
  assert.match(teacher, /historyContent\.hidden = true;[\s\S]*?historyContent\.dataset\.loaded = 'false';[\s\S]*?historyToggle\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(teacher, /if \(!historyContent\.hidden\)[\s\S]*?historyToggle\.textContent = 'Show versions'/);
  assert.match(teacher, /historyToggle\.textContent = 'Hide versions';[\s\S]*?historyToggle\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(teacher, /if \(state\.selectedReportId !== report\.id\) return/);
  assert.match(teacher, /setMessage\('review-message', error\.message \|\| 'Release history could not be loaded\.'/);
  assert.match(teacher, /report-history-releases[\s\S]*?report-history-entry/);
  assert.match(teacher, /index === 0 \? '<span class="report-history-current">Current parent version/);
  assert.match(teacher, /report-history-summary[\s\S]*?escape\(item\.summary\)/);
  assert.match(teacher, /item\.parentActions\.length \? `<section class="report-history-actions"/);
  assert.match(teacher, /report-history-corrections[\s\S]*?escape\(item\.reason\)/);
  assert.match(teacherStyles, /#review-modal \.report-history-entry\s*\{[^}]*background:\s*var\(--white\)/s);
  assert.match(teacherStyles, /#review-modal \.report-history-actions\s*\{[^}]*background:\s*var\(--blue-xpale\)/s);
  assert.match(teacherStyles, /#review-modal \.report-history-heading\s*\{[^}]*display:\s*flex/s);
  assert.match(teacherStyles, /#review-modal \.report-history-heading\s*\{[^}]*margin-bottom:\s*0/s);
  assert.match(teacherStyles, /#review-modal #report-history-content:not\(\[hidden\]\)\s*\{\s*margin-top:\s*10px;\s*\}/);
  assert.match(teacherStyles, /#review-modal \.report-history-toggle\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(teacherStyles, /@media \(max-width: 520px\)[\s\S]*?#review-modal \.report-history-heading \.review-section-label \{ flex: 1 1 150px;/s);
  assert.match(teacherStyles, /@media \(max-width: 520px\)[\s\S]*?#review-modal \.report-history-entry-head \{ flex-direction: column;/s);
  assert.match(teacherStyles, /#review-modal \.report-history-correction p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(parent, /Number\(report\.versionNumber\) > 1 && report\.correctedAt/);
  assert.match(parent, /Updated on/);
});
