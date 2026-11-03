function requiredTermCount(offering) {
  const grade = Number(String(offering.gradeCode).replace('grade-', ''));
  const hours = Number(offering.instructional_hours ?? offering.instructionalHours);
  const type = offering.subject_type ?? offering.subjectType;
  if (grade === 11 && type === 'techpro_elective') return 3;
  if (type === 'work_immersion' && [540, 640].includes(hours)) return 2;
  return 1;
}

async function schoolTerms(db, schoolId, yearId, levelId) {
  const [rows] = await db.execute(
    `SELECT id, name, sequence_number AS sequenceNumber, status,
      DATE_FORMAT(planned_start_date, '%Y-%m-%d') AS startDate,
      DATE_FORMAT(planned_end_date, '%Y-%m-%d') AS endDate
     FROM academic_terms WHERE school_id = ? AND academic_year_id = ? AND school_level_id = ?
     ORDER BY sequence_number`, [schoolId, yearId, levelId]);
  return rows;
}

function validateTermRange(terms, offering, startId, endId) {
  const start = terms.find(term => Number(term.id) === Number(startId));
  const end = terms.find(term => Number(term.id) === Number(endId));
  if (!start || !end) throw Object.assign(new Error('Choose terms in this class’s school year.'), { status: 400 });
  const count = requiredTermCount(offering);
  if (Number(end.sequenceNumber) - Number(start.sequenceNumber) + 1 !== count
    || terms.filter(term => term.sequenceNumber >= start.sequenceNumber && term.sequenceNumber <= end.sequenceNumber).length !== count) {
    throw Object.assign(new Error(`This subject must cover ${count} consecutive term${count === 1 ? '' : 's'}.`), { status: 400 });
  }
  if (count === 3 && (Number(start.sequenceNumber) !== 1 || Number(end.sequenceNumber) !== 3)) {
    throw Object.assign(new Error('This year-long subject must cover Terms 1–3.'), { status: 400 });
  }
  return { start, end };
}

async function activeTerm(db, item) {
  const terms = await schoolTerms(db, item.schoolId, item.academicYearId, item.schoolLevelId);
  return terms.find(term => term.status === 'active')
    || (item.yearStatus === 'archived' ? terms.filter(term => term.status === 'completed').at(-1) : null);
}

function classAvailable(item, term, { history = false } = {}) {
  if (!item.startTermSequence || !item.endTermSequence || !term) return false;
  return Number(item.startTermSequence) <= Number(term.sequenceNumber)
    && (history || Number(term.sequenceNumber) <= Number(item.endTermSequence));
}

function classHasStartedSql(classIdSql, schoolIdSql) {
  return `EXISTS (SELECT 1 FROM shs_elective_classes term_class
    JOIN shs_offerings term_offering ON term_offering.id = term_class.offering_id
      AND term_offering.school_id = term_class.school_id
    JOIN school_grade_levels term_grade ON term_grade.id = term_offering.grade_level_id
      AND term_grade.school_id = term_offering.school_id
    JOIN academic_years term_year ON term_year.id = term_offering.academic_year_id
      AND term_year.school_id = term_offering.school_id
    JOIN academic_terms term_start ON term_start.id = term_class.start_term_id
      AND term_start.school_id = term_class.school_id
    LEFT JOIN academic_terms term_active ON term_active.school_id = term_class.school_id
      AND term_active.academic_year_id = term_offering.academic_year_id
      AND term_active.school_level_id = term_grade.school_level_id
      AND term_active.status = 'active'
    WHERE term_class.id = ${classIdSql} AND term_class.school_id = ${schoolIdSql}
      AND (term_active.sequence_number >= term_start.sequence_number
        OR (term_year.status = 'archived' AND EXISTS (
          SELECT 1 FROM academic_terms completed_term WHERE completed_term.school_id = term_class.school_id
            AND completed_term.academic_year_id = term_year.id
            AND completed_term.school_level_id = term_grade.school_level_id
            AND completed_term.status = 'completed'
            AND completed_term.sequence_number >= term_start.sequence_number))))`;
}

module.exports = { activeTerm, classAvailable, classHasStartedSql, requiredTermCount, schoolTerms, validateTermRange };
