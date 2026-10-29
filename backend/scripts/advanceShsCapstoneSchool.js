// Controlled school-year transitions for the named capstone test school only.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { getDatabase } = require('../config/database');

async function main() {
  const stage = process.argv[2];
  if (!['--grade11-term2', '--grade12-year', '--grade12-term2'].includes(stage)) {
    throw new Error('Choose --grade11-term2, --grade12-year, or --grade12-term2. Back up the database first.');
  }
  const connection = await getDatabase().getConnection();
  let started = false;
  try {
    await connection.beginTransaction(); started = true;
    const [[school]] = await connection.execute(
      `SELECT id, name FROM schools WHERE school_code = 'CAPSTONE-SHS-TEST'
       AND school_email_domain = 'capstone-shs-test.academix.invalid' FOR UPDATE`
    );
    if (!school || school.name !== 'Capstone SHS Test School') throw new Error('The named capstone test school was not found.');
    const [years] = await connection.execute(
      'SELECT id, label, status FROM academic_years WHERE school_id = ? ORDER BY label FOR UPDATE', [school.id]
    );
    const first = years.find(row => row.label === '2026-2027');
    const second = years.find(row => row.label === '2027-2028');
    if (!first || !second || (stage === '--grade12-term2'
      ? first.status !== 'archived' || second.status !== 'active'
      : first.status !== 'active' || second.status !== 'upcoming')) {
      throw new Error('The capstone school is not in the expected year state. No records were changed.');
    }
    const [terms] = await connection.execute(
      `SELECT id, academic_year_id AS yearId, sequence_number AS sequenceNumber, status
       FROM academic_terms WHERE school_id = ? FOR UPDATE`, [school.id]
    );
    const term = (year, sequence) => terms.find(row => Number(row.yearId) === Number(year.id)
      && Number(row.sequenceNumber) === sequence);
    if (stage === '--grade11-term2') {
      if (term(first, 1)?.status !== 'active' || term(first, 2)?.status !== 'upcoming') {
        throw new Error('Grade 11 terms are not in the expected state. No records were changed.');
      }
      await connection.execute("UPDATE academic_terms SET status = 'closed' WHERE school_id = ? AND id = ?", [school.id, term(first, 1).id]);
      await connection.execute("UPDATE academic_terms SET status = 'active', activated_at = NOW() WHERE school_id = ? AND id = ?", [school.id, term(first, 2).id]);
    } else if (stage === '--grade12-term2') {
      if (term(second, 1)?.status !== 'active' || term(second, 2)?.status !== 'upcoming') {
        throw new Error('Grade 12 terms are not in the expected state. No records were changed.');
      }
      await connection.execute("UPDATE academic_terms SET status = 'closed' WHERE school_id = ? AND id = ?", [school.id, term(second, 1).id]);
      await connection.execute("UPDATE academic_terms SET status = 'active', activated_at = NOW() WHERE school_id = ? AND id = ?", [school.id, term(second, 2).id]);
    } else {
      if (term(first, 1)?.status !== 'closed' || term(first, 2)?.status !== 'active'
        || term(second, 1)?.status !== 'upcoming') {
        throw new Error('Finish the Grade 11 terms first. No records were changed.');
      }
      await connection.execute("UPDATE academic_terms SET status = 'closed' WHERE school_id = ? AND id = ?", [school.id, term(first, 2).id]);
      await connection.execute("UPDATE academic_years SET status = 'archived' WHERE school_id = ? AND id = ?", [school.id, first.id]);
      await connection.execute("UPDATE academic_years SET status = 'active' WHERE school_id = ? AND id = ?", [school.id, second.id]);
      await connection.execute("UPDATE academic_terms SET status = 'active', activated_at = NOW() WHERE school_id = ? AND id = ?", [school.id, term(second, 1).id]);
      await connection.execute("UPDATE school_settings SET current_school_year_label = '2027-2028' WHERE school_id = ?", [school.id]);
      const [[level]] = await connection.execute(
        "SELECT id FROM school_levels WHERE school_id = ? AND level_code = 'shs'", [school.id]
      );
      const [[grade]] = await connection.execute(
        "SELECT id FROM school_grade_levels WHERE school_id = ? AND grade_code = 'grade-12'", [school.id]
      );
      const [[teacher]] = await connection.execute(
        "SELECT id FROM users WHERE school_id = ? AND school_email = 'teacher@capstone-shs-test.academix.invalid'", [school.id]
      );
      for (const trackCode of ['academic', 'techpro']) {
        const [[track]] = await connection.execute(
          'SELECT id FROM school_shs_tracks WHERE school_id = ? AND track_code = ?', [school.id, trackCode]
        );
        const [created] = await connection.execute(
          `INSERT INTO sections (school_id, academic_year_id, school_level_id, grade_level_id,
            track_id, name, shs_curriculum_code, adviser_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'strengthened_2026', ?)`,
          [school.id, second.id, level.id, grade.id, track.id,
            `Capstone ${trackCode === 'academic' ? 'Academic' : 'TechPro'} 12`, teacher.id]
        );
        const learners = trackCode === 'academic' ? ['academic', 'academiccross'] : ['techpro', 'techprocross'];
        for (const learner of learners) {
          const [[user]] = await connection.execute(
            'SELECT id FROM users WHERE school_id = ? AND school_email = ?',
            [school.id, `${learner}@capstone-shs-test.academix.invalid`]
          );
          await connection.execute(
            'INSERT INTO section_students (school_id, section_id, student_user_id) VALUES (?, ?, ?)',
            [school.id, created.insertId, user.id]
          );
        }
      }
    }
    await connection.commit(); started = false;
    console.log(JSON.stringify({ schoolId: school.id, stage, changedOnlyCapstoneSchool: true }));
  } catch (error) { if (started) await connection.rollback(); throw error; }
  finally { connection.release(); await getDatabase().end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
