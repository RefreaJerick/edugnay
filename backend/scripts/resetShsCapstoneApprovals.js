// Reset only the two disposable Academic Grade 11 QA requests after a race test.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getDatabase } = require('../config/database');

async function main() {
  if (!process.argv.includes('--reset-test-approvals')) throw new Error('Explicit --reset-test-approvals is required.');
  const db = getDatabase();
  const connection = await db.getConnection();
  let started = false;
  try {
    const [schools] = await connection.execute(
      "SELECT id FROM schools WHERE school_code = 'CAPSTONE-SHS-TEST' AND name = 'Capstone SHS Test School'");
    if (schools.length !== 1) throw new Error('The separate capstone test school was not found.');
    const schoolId = schools[0].id;
    const [requests] = await connection.execute(`SELECT q.id, q.student_user_id AS studentId
      FROM shs_selection_requests q JOIN users u ON u.id = q.student_user_id AND u.school_id = q.school_id
      JOIN academic_years y ON y.id = q.academic_year_id AND y.school_id = q.school_id
      WHERE q.school_id = ? AND y.label = '2026-2027'
        AND u.school_email IN ('academic@capstone-shs-test.academix.invalid',
          'academiccross@capstone-shs-test.academix.invalid') ORDER BY q.id`, [schoolId]);
    if (requests.length !== 2) throw new Error('Expected exactly two disposable Academic QA requests.');
    await connection.beginTransaction(); started = true;
    for (const request of requests) {
      await connection.execute(`UPDATE shs_elective_class_students SET withdrawn_at = NOW()
        WHERE school_id = ? AND student_user_id = ? AND withdrawn_at IS NULL`,
      [schoolId, request.studentId]);
      await connection.execute(`UPDATE shs_selection_requests
        SET status = 'pending', reviewed_by_user_id = NULL, reviewed_at = NULL, decision_reason = NULL
        WHERE school_id = ? AND id = ?`, [schoolId, request.id]);
    }
    await connection.commit(); started = false;
    console.log(`Reset ${requests.length} test requests and withdrew their active test memberships in school ${schoolId}.`);
  } finally {
    if (started) await connection.rollback();
    connection.release();
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
