const assert = require('node:assert/strict');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

if (process.env.DB_NAME !== 'academix_phase4_review' || process.env.PHASE5_ISOLATED_TEST !== '1') {
  throw new Error('This rollback-only check requires academix_phase4_review and PHASE5_ISOLATED_TEST=1.');
}

process.env.AI_REPORTS_GENERATION_ENABLED = 'false';
process.env.AI_REPORTS_RELEASE_ENABLED = 'true';

const database = require('../config/database').getDatabase();
const review = require('../controllers/narrativeReportReviewController');
const { readPublicReports } = require('../controllers/narrativeReportParentController');

async function main() {
  const connection = await database.getConnection();
  let started = false;
  try {
    const [[fixture]] = await connection.execute(
      `SELECT reports.id, reports.school_id AS schoolId, reports.student_user_id AS studentId,
        reports.section_id AS sectionId, sections.adviser_user_id AS adviserId
      FROM narrative_reports AS reports
      INNER JOIN sections ON sections.id = reports.section_id AND sections.school_id = reports.school_id
      INNER JOIN school_portal_features AS features ON features.school_id = reports.school_id
      INNER JOIN narrative_report_releases AS releases ON releases.school_id = reports.school_id
        AND releases.narrative_report_id = reports.id AND releases.version_number = 1
      WHERE reports.report_status = 'confirmed' AND reports.released_at IS NOT NULL
        AND reports.pending_correction = 0 AND sections.status = 'active'
        AND features.narrative_reports_enabled = 1
        AND NOT EXISTS (SELECT 1 FROM narrative_report_releases AS later
          WHERE later.school_id = reports.school_id AND later.narrative_report_id = reports.id
            AND later.version_number > 1)
      ORDER BY reports.id LIMIT 1`
    );
    const [[otherSchool]] = await connection.execute(
      'SELECT id FROM schools WHERE id <> ? LIMIT 1', [fixture?.schoolId || 0]
    );
    assert.ok(fixture && otherSchool, 'Test database needs a released report and another school.');

    await connection.beginTransaction();
    started = true;
    // Controller calls share this transaction; their commit/release methods cannot persist test changes.
    const transaction = {
      execute: connection.execute.bind(connection),
      getConnection: async () => ({
        execute: connection.execute.bind(connection),
        beginTransaction: async () => {}, commit: async () => {},
        rollback: async () => {}, release: () => {}
      })
    };
    const request = {
      params: { reportId: String(fixture.id) },
      user: { id: fixture.adviserId, schoolId: fixture.schoolId, role: 'teacher' },
      body: { reason: 'Correcting the parent summary after adviser review.' }
    };
    const before = (await readPublicReports(transaction, fixture.schoolId, fixture.studentId, fixture.id))[0];
    assert.equal(before.versionNumber, 1);
    const privateFields = ['teacherNote', 'followUpSuggestion', 'isAtRisk', 'candidateReasons'];
    assert.ok(privateFields.every(field => !Object.hasOwn(before, field)));

    await assert.rejects(
      review.reopenConfirmedReport({ ...request, user: { ...request.user, schoolId: otherSchool.id } }, transaction),
      { status: 404 }
    );
    await assert.rejects(
      review.reopenConfirmedReport({ ...request, user: { ...request.user, id: -1 } }, transaction),
      { status: 404 }
    );
    await connection.execute('UPDATE sections SET status = ? WHERE id = ? AND school_id = ?',
      ['inactive', fixture.sectionId, fixture.schoolId]);
    await assert.rejects(review.reopenConfirmedReport(request, transaction), { status: 404 });
    await connection.execute('UPDATE sections SET status = ? WHERE id = ? AND school_id = ?',
      ['active', fixture.sectionId, fixture.schoolId]);
    await assert.rejects(
      review.reopenConfirmedReport({ ...request, body: { reason: ' ' } }, transaction), { status: 400 }
    );

    const reopened = await review.reopenConfirmedReport(request, transaction);
    assert.equal(reopened.pendingCorrection, true);
    assert.deepEqual((await readPublicReports(transaction, fixture.schoolId, fixture.studentId, fixture.id))[0], before);
    await assert.rejects(review.reopenConfirmedReport(request, transaction), { status: 409 });

    const revisedSummary = 'Corrected parent summary from the rollback-only Phase 5 check.';
    const revisedActions = ['Review the weekly learning activity together.'];
    await review.saveReviewDraft({ ...request, body: {
      summary: revisedSummary, parentActions: revisedActions, teacherNote: 'Private test note.'
    } }, transaction);
    assert.deepEqual((await readPublicReports(transaction, fixture.schoolId, fixture.studentId, fixture.id))[0], before);
    const [[report]] = await connection.execute(
      'SELECT ai_follow_up_suggestion AS suggestion FROM narrative_reports WHERE id = ?', [fixture.id]
    );
    await review.confirmDraft({ ...request, body: {
      followUpDecision: report.suggestion ? 'dismiss' : null
    } }, transaction);

    const released = await review.releaseConfirmedReport({ ...request, body: {} }, transaction);
    assert.equal(released.versionNumber, 2);
    const current = (await readPublicReports(transaction, fixture.schoolId, fixture.studentId, fixture.id))[0];
    assert.equal(current.versionNumber, 2);
    assert.equal(current.summary, revisedSummary);
    assert.deepEqual(current.parentActions, revisedActions);
    assert.ok(current.correctedAt);
    assert.ok(privateFields.every(field => !Object.hasOwn(current, field)));
    assert.deepEqual(await readPublicReports(transaction, otherSchool.id, fixture.studentId, fixture.id), []);

    const history = await review.readReleaseHistory(transaction, request);
    assert.deepEqual(history.releases.map(version => version.versionNumber), [2, 1]);
    assert.equal(history.releases[1].summary, before.summary);
    assert.ok(history.reopens.some(entry => entry.reason === request.body.reason));
    await assert.rejects(
      review.readReleaseHistory(transaction, { ...request, user: { ...request.user, schoolId: otherSchool.id } }),
      { status: 404 }
    );
    const [[noticeBeforeRetry]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM notifications WHERE event_key = ?',
      [`narrative-report:${fixture.id}:released:v2`]
    );
    assert.ok(noticeBeforeRetry.count > 0, 'Expected a versioned parent notification.');
    assert.equal((await review.releaseConfirmedReport({ ...request, body: {} }, transaction)).alreadyReleased, true);
    const [[noticeAfterRetry]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM notifications WHERE event_key = ?',
      [`narrative-report:${fixture.id}:released:v2`]
    );
    assert.equal(noticeAfterRetry.count, noticeBeforeRetry.count);
    const [[newSnapshot]] = await connection.execute(
      'SELECT id FROM narrative_report_releases WHERE narrative_report_id = ? AND version_number = 2',
      [fixture.id]
    );
    await assert.rejects(connection.execute(
      'UPDATE narrative_report_releases SET summary = ? WHERE id = ?', ['tampered', newSnapshot.id]
    ));
    await assert.rejects(connection.execute('DELETE FROM narrative_report_releases WHERE id = ?', [newSnapshot.id]));
    console.log('PASS real-SQL correction, privacy, authorization, immutable history and notification retry');
  } finally {
    try {
      if (started) {
        await connection.rollback();
        console.log('PASS all test changes rolled back');
      }
    } finally {
      connection.release();
      await database.end();
    }
  }
}

main().catch(error => {
  console.error(`Phase 5 isolated check failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
