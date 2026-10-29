// Read-only SHS preflight for the connected development database.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getDatabase } = require('../config/database');

async function main() {
  const db = getDatabase();
  try {
    const [schools] = await db.execute(`SELECT s.id, s.name, y.label AS activeYear
      FROM schools s LEFT JOIN academic_years y ON y.school_id = s.id AND y.status = 'active'
      WHERE s.registration_status = 'active' ORDER BY s.id`);
    const [schoolShs] = await db.execute(`SELECT s.id AS schoolId, s.name,
      (SELECT COUNT(*) FROM sections x WHERE x.school_id = s.id AND x.shs_curriculum_code = 'strengthened_2026') AS sections,
      (SELECT COUNT(*) FROM shs_offerings x WHERE x.school_id = s.id) AS offerings,
      (SELECT COUNT(*) FROM shs_elective_classes x WHERE x.school_id = s.id) AS classes,
      (SELECT COUNT(*) FROM shs_selection_requests x WHERE x.school_id = s.id) AS requests,
      (SELECT COUNT(*) FROM shs_grade_publication_history x WHERE x.school_id = s.id) AS publications
      FROM schools s WHERE s.school_code IN ('QA-SCHOOL-01', 'CAPSTONE-SHS-TEST') OR s.id = 26 ORDER BY s.id`);
    const [allSchoolShs] = await db.execute(`SELECT s.id AS schoolId, s.school_code AS schoolCode,
      (SELECT COUNT(*) FROM sections x WHERE x.school_id = s.id AND x.shs_curriculum_code = 'strengthened_2026') AS sections,
      (SELECT COUNT(*) FROM shs_offerings x WHERE x.school_id = s.id) AS offerings,
      (SELECT COUNT(*) FROM shs_elective_classes x WHERE x.school_id = s.id) AS classes,
      (SELECT COUNT(*) FROM shs_selection_requests x WHERE x.school_id = s.id) AS requests,
      (SELECT COUNT(*) FROM shs_grade_publication_history x WHERE x.school_id = s.id) AS publications
      FROM schools s ORDER BY s.id`);
    const [shs] = await db.execute(`SELECT
      (SELECT COUNT(*) FROM sections WHERE shs_curriculum_code = 'strengthened_2026') AS sections,
      (SELECT COUNT(*) FROM shs_offerings) AS offerings,
      (SELECT COUNT(*) FROM shs_elective_classes) AS classes,
      (SELECT COUNT(*) FROM shs_selection_requests) AS requests,
      (SELECT COUNT(*) FROM shs_grade_publication_history) AS publications`);
    const [columns] = await db.execute(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND (
        (table_name = 'grading_items' AND column_name = 'shs_elective_class_id') OR
        (table_name = 'published_final_grades' AND column_name = 'publication_version') OR
        (table_name = 'attendance_sessions' AND column_name = 'shs_elective_class_id'))`);
    const [qaClasses] = await db.execute(`SELECT c.id, c.class_name AS className, c.capacity,
      o.catalog_code AS catalogCode,
      (SELECT COUNT(*) FROM shs_elective_class_students e WHERE e.school_id = c.school_id
        AND e.elective_class_id = c.id AND e.withdrawn_at IS NULL) AS enrolled
      FROM shs_elective_classes c JOIN shs_offerings o ON o.id = c.offering_id AND o.school_id = c.school_id
      JOIN schools s ON s.id = c.school_id WHERE s.school_code = 'CAPSTONE-SHS-TEST'
      ORDER BY c.id`);
    const [qaRequests] = await db.execute(`SELECT q.id, q.status, u.school_email AS student,
      (SELECT GROUP_CONCAT(c.class_name ORDER BY c.id) FROM shs_selection_request_classes rc
        JOIN shs_elective_classes c ON c.id = rc.elective_class_id AND c.school_id = rc.school_id
        WHERE rc.school_id = q.school_id AND rc.request_id = q.id) AS classes
      FROM shs_selection_requests q JOIN users u ON u.id = q.student_user_id AND u.school_id = q.school_id
      JOIN schools s ON s.id = q.school_id WHERE s.school_code = 'CAPSTONE-SHS-TEST'`);
    console.log(JSON.stringify({ schools, allSchoolShs, schoolShs, shs: shs[0], phase4And5Columns: columns,
      qaClasses, qaRequests }, null, 2));
    if (columns.length !== 3) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
