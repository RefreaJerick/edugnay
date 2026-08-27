/* Shared shell behavior for every portal role. */

/*
 * Frontend configuration store.
 * Replace the localStorage reads/writes with API calls during backend integration.
 */
(function initializeEdUgnayConfig() {
  const STORAGE_KEYS = {
    schools: 'edugnay_schools',
    activeSchool: 'edugnay_active_school',
    holidays: 'edugnay_holidays'
  };

  const GRADE_CATALOG = [
    {
      key: 'elementary',
      label: 'Elementary',
      grades: ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']
    },
    {
      key: 'jhs',
      label: 'Junior High School',
      grades: ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']
    },
    {
      key: 'shs',
      label: 'Senior High School',
      grades: ['Grade 11', 'Grade 12'],
      tracks: ['Academic', 'Technical-Vocational-Livelihood', 'Arts and Design', 'Sports'],
      strands: ['STEM', 'HUMSS', 'ABM', 'GAS', 'TVL']
    }
  ];

  const SUBJECT_CATALOG = [
    { id: 'filipino', name: 'Filipino', code: 'FIL', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'english', name: 'English', code: 'ENG', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'mathematics', name: 'Mathematics', code: 'MAT', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'science', name: 'Science', code: 'SCI', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'araling-panlipunan', name: 'Araling Panlipunan', code: 'AP', levels: ['elementary', 'jhs'] },
    { id: 'mapeh', name: 'MAPEH', code: 'MAPEH', levels: ['elementary', 'jhs'] },
    { id: 'tle', name: 'Technology and Livelihood Education', code: 'TLE', levels: ['jhs'] },
    { id: 'esp', name: 'Edukasyon sa Pagpapakatao', code: 'ESP', levels: ['elementary', 'jhs'] },
    { id: 'pe-health', name: 'Physical Education and Health', code: 'PEH', levels: ['shs'] },
    { id: 'empowerment-technologies', name: 'Empowerment Technologies', code: 'E-TECH', levels: ['shs'] },
    { id: 'practical-research', name: 'Practical Research', code: 'PR', levels: ['shs'] }
  ];

  const PERIOD_CATALOG = {
    elementary: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
    jhs: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
    shs: ['1st Semester', '2nd Semester']
  };

  const DEFAULT_ATTENDANCE_CODES = [
    { id: 'present', name: 'Present', description: 'Student attended class', key: 'P', tone: 'present' },
    { id: 'absent', name: 'Absent', description: 'Student did not attend', key: 'A', tone: 'absent' },
    { id: 'late', name: 'Late / Tardy', description: 'Student arrived after roll call', key: 'L', tone: 'late' },
    { id: 'excused', name: 'Excused', description: 'Absence with a valid reason', key: 'E', tone: 'excused' }
  ];

  function makeAttendanceRules(values = {}) {
    return {
      statusCodes: Array.isArray(values.statusCodes) && values.statusCodes.length
        ? values.statusCodes.map(code => ({ ...code }))
        : DEFAULT_ATTENDANCE_CODES.map(code => ({ ...code })),
      maxUnexcusedAbsences: Number.isFinite(Number(values.maxUnexcusedAbsences)) ? Number(values.maxUnexcusedAbsences) : 5,
      consecutiveAbsencesAlert: Number.isFinite(Number(values.consecutiveAbsencesAlert)) ? Number(values.consecutiveAbsencesAlert) : 3,
      lateCountAsAbsence: Number.isFinite(Number(values.lateCountAsAbsence)) ? Number(values.lateCountAsAbsence) : 3,
      countExcusedAbsences: Boolean(values.countExcusedAbsences),
      allowEditPastAttendance: values.allowEditPastAttendance !== false
    };
  }

  function makeDivision(level, values = {}) {
    const catalog = GRADE_CATALOG.find(item => item.key === level);
    const defaultRules = level === 'shs'
      ? [
        { id: 'performance', label: 'Written and Performance Work', weight: 60 },
        { id: 'assessment', label: 'Quarterly Assessment', weight: 40 }
      ]
      : [
        { id: 'ww', label: 'Written Work', weight: 30 },
        { id: 'pt', label: 'Performance Task', weight: level === 'elementary' ? 40 : 50 },
        { id: 'qa', label: 'Quarterly Assessment', weight: level === 'elementary' ? 30 : 20 }
      ];

    return {
      key: level,
      label: catalog?.label || level,
      schoolYear: values.schoolYear || '2025-2026',
      academicPeriod: values.academicPeriod || PERIOD_CATALOG[level]?.[0] || 'Quarter 1',
      periodStartDate: values.periodStartDate || '2025-05-05',
      periodEndDate: values.periodEndDate || '2025-07-18',
      gradeEncodingOpen: values.gradeEncodingOpen !== false,
      lockPreviousPeriods: values.lockPreviousPeriods !== false,
      enabledGrades: values.enabledGrades || [...(catalog?.grades || [])],
      tracks: values.tracks || [...(catalog?.tracks || [])],
      strands: values.strands || [...(catalog?.strands || [])],
      subjects: values.subjects || SUBJECT_CATALOG.filter(subject => subject.levels.includes(level)).map(subject => subject.id),
      sections: values.sections || [],
      gradingRules: values.gradingRules || defaultRules,
      passingGradeThreshold: Number.isFinite(Number(values.passingGradeThreshold)) ? Number(values.passingGradeThreshold) : 75,
      gradeRounding: values.gradeRounding || 'round'
    };
  }

  const DEFAULT_SCHOOLS = [
    {
      id: 'scc',
      name: "St. Columban's College",
      shortName: "ST. COLUMBAN'S COLLEGE",
      schoolType: 'k12',
      typeLabel: 'K-12 School',
      schoolId: '305614',
      address: 'San Pedro, Laguna, Philippines',
      phone: '(049) 123 4567',
      email: 'info@stcolumban.edu.ph',
      website: 'stcolumban.edu.ph',
      logoUrl: '../../assets/images/st-columban-logo.png',
      photos: [
        '../../assets/images/scc-pic-1.jpg',
        '../../assets/images/scc-pic-2.jpg',
        '../../assets/images/scc-pic-3.jpg',
        '../../assets/images/scc-pic-4.jpg'
      ],
      schoolYear: '2025-2026',
      academicPeriod: 'Quarter 2',
      attendanceRules: makeAttendanceRules(),
      activeDivision: 'jhs',
      schoolLevels: ['elementary', 'jhs', 'shs'],
      divisions: {
        elementary: makeDivision('elementary', {
          academicPeriod: 'Quarter 2',
          sections: [
            { id: 'elem-grade4-luke', name: 'St. Luke', grade: 'Grade 4', capacity: 40, enrolled: 32 },
            { id: 'elem-grade5-mark', name: 'St. Mark', grade: 'Grade 5', capacity: 40, enrolled: 35 }
          ],
          gradingRules: [
            { id: 'ww', label: 'Written Work', weight: 30 },
            { id: 'pt', label: 'Performance Task', weight: 40 },
            { id: 'qa', label: 'Quarterly Assessment', weight: 30 }
          ]
        }),
        jhs: makeDivision('jhs', {
          academicPeriod: 'Quarter 2',
          sections: [
            { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38, adviser: 'Ms. Maria Reyes', adviserInitials: 'MR' },
            { id: 'jhs-grade7-mark', name: 'St. Mark', grade: 'Grade 7', capacity: 40, enrolled: 34 },
            { id: 'jhs-grade8-luke', name: 'St. Luke', grade: 'Grade 8', capacity: 40, enrolled: 36 },
            { id: 'jhs-grade8-john', name: 'St. John', grade: 'Grade 8', capacity: 40, enrolled: 34 },
            { id: 'jhs-grade9-peter', name: 'St. Peter', grade: 'Grade 9', capacity: 40, enrolled: 37 },
            { id: 'jhs-grade9-paul', name: 'St. Paul', grade: 'Grade 9', capacity: 40, enrolled: 37 },
            { id: 'jhs-grade10-james', name: 'St. James', grade: 'Grade 10', capacity: 40, enrolled: 35 },
            { id: 'jhs-grade10-thomas', name: 'St. Thomas', grade: 'Grade 10', capacity: 40, enrolled: 33 }
          ],
          gradingRules: [
            { id: 'ww', label: 'Written Work', weight: 30 },
            { id: 'pt', label: 'Performance Task', weight: 50 },
            { id: 'qa', label: 'Quarterly Assessment', weight: 20 }
          ]
        }),
        shs: makeDivision('shs', {
          academicPeriod: '1st Semester',
          sections: [
            { id: 'shs-grade11-stem-a', name: 'STEM A', grade: 'Grade 11', strand: 'STEM', capacity: 40, enrolled: 28 },
            { id: 'shs-grade11-humss-a', name: 'HUMSS A', grade: 'Grade 11', strand: 'HUMSS', capacity: 40, enrolled: 26 },
            { id: 'shs-grade12-abm-a', name: 'ABM A', grade: 'Grade 12', strand: 'ABM', capacity: 40, enrolled: 31 },
            { id: 'shs-grade12-tvl-a', name: 'TVL A', grade: 'Grade 12', strand: 'TVL', capacity: 40, enrolled: 29 }
          ]
        })
      },
      enabledGrades: GRADE_CATALOG.find(item => item.key === 'jhs').grades,
      subjects: SUBJECT_CATALOG.filter(subject => subject.levels.includes('jhs')).map(subject => subject.id),
      sections: [
        { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38, adviser: 'Ms. Maria Reyes', adviserInitials: 'MR' },
        { id: 'jhs-grade8-luke', name: 'St. Luke', grade: 'Grade 8', capacity: 40, enrolled: 36 },
        { id: 'jhs-grade9-peter', name: 'St. Peter', grade: 'Grade 9', capacity: 40, enrolled: 37 }
      ],
      gradingRules: [
        { id: 'ww', label: 'Written Work', weight: 30 },
        { id: 'pt', label: 'Performance Task', weight: 50 },
        { id: 'qa', label: 'Quarterly Assessment', weight: 20 }
      ]
    }
  ];

  const DEFAULT_HOLIDAYS = [
    {
      id: 'demo-foundation-day',
      date: '2026-08-17',
      title: 'School Foundation Day',
      detail: 'No classes and no office transactions today.',
      type: 'holiday',
      appliesTo: 'all'
    },
    {
      id: 'national-heroes-day',
      date: '2026-08-31',
      title: 'National Heroes Day',
      detail: 'Regular classes resume on the next school day.',
      type: 'holiday',
      appliesTo: 'all'
    }
  ];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  const LEGACY_SCHOOL_IDS = new Set(['scc-jhs', 'scc-elementary', 'scc-shs']);
  const LEGACY_LEVEL_BY_ID = {
    'scc-elementary': 'elementary',
    'scc-jhs': 'jhs',
    'scc-shs': 'shs'
  };

  function divisionFromSchool(source, level) {
    const fallback = DEFAULT_SCHOOLS[0].divisions[level];
    const catalog = GRADE_CATALOG.find(item => item.key === level);
    return {
      ...clone(fallback),
      key: level,
      label: catalog?.label || level,
      schoolYear: source?.schoolYear || fallback.schoolYear,
      academicPeriod: source?.academicPeriod || fallback.academicPeriod,
      periodStartDate: source?.periodStartDate || fallback.periodStartDate,
      periodEndDate: source?.periodEndDate || fallback.periodEndDate,
      gradeEncodingOpen: source?.gradeEncodingOpen !== false,
      lockPreviousPeriods: source?.lockPreviousPeriods !== false,
      enabledGrades: source?.enabledGrades || source?.grades || fallback.enabledGrades,
      tracks: source?.tracks || fallback.tracks,
      strands: source?.strands || fallback.strands,
      subjects: source?.subjects || fallback.subjects,
      sections: source?.sections || fallback.sections,
      gradingRules: source?.gradingRules || fallback.gradingRules,
      passingGradeThreshold: Number.isFinite(Number(source?.passingGradeThreshold)) ? Number(source.passingGradeThreshold) : fallback.passingGradeThreshold,
      gradeRounding: source?.gradeRounding || fallback.gradeRounding
    };
  }

  function migrateLegacySchools(schools) {
    const legacy = schools.filter(school => LEGACY_SCHOOL_IDS.has(school?.id));
    if (!legacy.length) return schools;

    const byLevel = Object.fromEntries(legacy.map(school => [LEGACY_LEVEL_BY_ID[school.id], school]));
    const levels = ['elementary', 'jhs', 'shs'];
    const divisions = Object.fromEntries(levels.map(level => [level, divisionFromSchool(byLevel[level], level)]));
    const activeDivision = byLevel.jhs ? 'jhs' : levels.find(level => byLevel[level]) || 'jhs';
    const active = divisions[activeDivision];
    const first = byLevel.jhs || legacy[0];
    const photos = [...new Set(legacy.flatMap(school => Array.isArray(school.photos) ? school.photos : []))];
    const merged = {
      ...first,
      id: 'scc',
      name: "St. Columban's College",
      shortName: "ST. COLUMBAN'S COLLEGE",
      schoolType: 'k12',
      typeLabel: 'K-12 School',
      schoolId: first.schoolId || '305614',
      email: first.email || 'info@stcolumban.edu.ph',
      photos: photos.length ? photos : clone(DEFAULT_SCHOOLS[0].photos),
      schoolLevels: levels,
      activeDivision,
      divisions,
      schoolYear: active.schoolYear,
      academicPeriod: active.academicPeriod,
      periodStartDate: active.periodStartDate,
      periodEndDate: active.periodEndDate,
      gradeEncodingOpen: active.gradeEncodingOpen,
      lockPreviousPeriods: active.lockPreviousPeriods,
      enabledGrades: active.enabledGrades,
      tracks: active.tracks,
      subjects: active.subjects,
      sections: active.sections,
      gradingRules: active.gradingRules,
      passingGradeThreshold: active.passingGradeThreshold,
      gradeRounding: active.gradeRounding,
      attendanceRules: makeAttendanceRules(first.attendanceRules)
    };
    const result = [merged, ...schools.filter(school => !LEGACY_SCHOOL_IDS.has(school?.id))];
    writeJson(STORAGE_KEYS.schools, result);

    const activeId = localStorage.getItem(STORAGE_KEYS.activeSchool);
    if (LEGACY_SCHOOL_IDS.has(activeId)) localStorage.setItem(STORAGE_KEYS.activeSchool, merged.id);
    return result;
  }

  function getSchools() {
    const saved = readJson(STORAGE_KEYS.schools, null);
    return Array.isArray(saved) && saved.length
      ? migrateLegacySchools(saved)
      : clone(DEFAULT_SCHOOLS);
  }

  function saveSchools(schools) {
    writeJson(STORAGE_KEYS.schools, schools);
  }

  function getActiveSchool() {
    const schools = getSchools();
    const activeId = localStorage.getItem(STORAGE_KEYS.activeSchool) || schools[0]?.id;
    return schools.find(school => school.id === activeId) || schools[0] || DEFAULT_SCHOOLS[0];
  }

  function setActiveSchool(schoolId) {
    localStorage.setItem(STORAGE_KEYS.activeSchool, schoolId);
    return getActiveSchool();
  }

  function slug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function gradeLabel(value, fallback = '') {
    const text = String(value || fallback).trim();
    if (!text) return '';
    if (/^kindergarten$/i.test(text)) return 'Kindergarten';
    return /^grade\s+/i.test(text) ? text.replace(/^grade\s+/i, 'Grade ') : `Grade ${text}`;
  }

  function normalizeSectionRecord(source, level, index = 0) {
    const catalog = GRADE_CATALOG.find(item => item.key === level) || {};
    const value = typeof source === 'string' ? { label: source } : (source || {});
    const rawLabel = String(value.label || value.name || `Section ${index + 1}`).trim();
    const rawGrade = value.grade || rawLabel.match(/^(Kindergarten|Grade\s*\d+)/i)?.[1] || catalog.grades?.[0] || '';
    const grade = gradeLabel(rawGrade);
    const withoutGrade = rawLabel.replace(/^(Kindergarten|Grade\s*\d+)\s*(?:[-:]|\u2013|\u2014)?\s*/i, '').trim();
    const name = String(value.name || withoutGrade || rawLabel).trim();
    const configuredStrands = [
      ...(Array.isArray(catalog.strands) ? catalog.strands : []),
      ...(Array.isArray(catalog.tracks) ? catalog.tracks : []),
      ...(value.strand ? [value.strand] : []),
      ...(value.track ? [value.track] : [])
    ].filter(Boolean);
    const strand = String(value.strand || value.track || configuredStrands.find(option => new RegExp(`\\b${String(option).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(rawLabel)) || '').trim();
    const capacity = Number(value.capacity ?? value.maxCapacity);
    const enrolled = Number(value.enrolled ?? value.students ?? 0);

    return {
      id: value.id || `${level}-${slug(grade)}-${slug(name) || index + 1}`,
      level,
      grade,
      name,
      strand,
      track: strand,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 40,
      enrolled: Number.isFinite(enrolled) && enrolled >= 0 ? enrolled : 0,
      label: rawLabel,
      adviser: value.adviser || '',
      adviserInitials: value.adviserInitials || '',
      subjects: Number(value.subjects ?? value.subjectCount ?? 0)
    };
  }

  function getAssignmentSections(school = getActiveSchool()) {
    const levels = Array.isArray(school?.schoolLevels) && school.schoolLevels.length
      ? school.schoolLevels
      : (school?.schoolType === 'k12' ? GRADE_CATALOG.map(item => item.key) : [school?.schoolType || 'jhs']);

    return levels.flatMap(level => {
      const division = school?.divisions?.[level] || (school?.schoolType === level ? school : null) || {};
      const records = Array.isArray(division.sections) ? division.sections : [];
      return records.map((record, index) => normalizeSectionRecord(record, level, index));
    });
  }

  // Shared non-student accounts.
  const CORE_ACCOUNT_DIRECTORY = [
    { id: '1', firstName: 'Sr.', lastName: 'Admin', displayName: 'Sr. Admin', email: 'admin.adm@stcolumban.edu.ph', role: 'admin', employeeNo: 'ADM-2016-0001', section: '—', status: 'active', dateAdded: 'Jan 6, 2025', lrn: '', linkedStudents: [] },
    { id: '2', firstName: 'Maria', lastName: 'Reyes', displayName: 'Ms. Maria Reyes', email: 'm.reyes.fac@stcolumban.edu.ph', role: 'fac', employeeNo: 'FAC-2019-0042', section: 'Grade 7 / St. Matthew', status: 'active', dateAdded: 'Jun 3, 2024', lrn: '', linkedStudents: [] },
    { id: '3', firstName: 'Paolo', lastName: 'Tan', displayName: 'Mr. Paolo Tan', email: 'p.tan.fac@stcolumban.edu.ph', role: 'fac', employeeNo: 'FAC-2021-0017', section: 'Unassigned', status: 'active', dateAdded: 'May 20, 2025', lrn: '', linkedStudents: [] },
    { id: '7', firstName: 'Rosa', lastName: 'Lim', displayName: 'Rosa Lim', email: 'r.lim.parents@stcolumban.edu.ph', role: 'par', section: '', status: 'active', dateAdded: 'Jun 5, 2024', lrn: '', linkedStudents: [{ id: 'STU-J-LIM', name: 'J. Lim', section: 'Gr. 9' }] },
    { id: '8', firstName: 'Elena', lastName: 'Cruz', displayName: 'Elena Cruz', email: 'e.cruz.parents@stcolumban.edu.ph', role: 'par', section: '', status: 'inactive', dateAdded: 'May 24, 2025', lrn: '', linkedStudents: [{ id: 'STU-M-CRUZ', name: 'M. Cruz', section: 'Gr. 7' }] },
    { id: '9', firstName: 'Lara', lastName: 'Villanueva', displayName: 'Ms. Lara Villanueva', email: 'l.villanueva.fac@stcolumban.edu.ph', role: 'fac', employeeNo: 'FAC-2018-0031', section: 'Grade 9 / St. Peter', status: 'active', dateAdded: 'Jun 3, 2024', lrn: '', linkedStudents: [] },
  ];

  // Shared K-12 student collection. Replace this local array with the
  // school's student API response while keeping its record shape unchanged.
  const STUDENT_DIRECTORY = [
    { id: 'cm-001', name: 'Carlo Mendoza', email: 'c.mendoza.stud@stcolumban.edu.ph', initials: 'CM', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'lr-002', name: 'Liza Reyes', email: 'l.reyes.stud@stcolumban.edu.ph', initials: 'LR', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'rc-003', name: 'Rico Cruz', email: 'r.cruz.stud@stcolumban.edu.ph', initials: 'RC', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Mark' },
    { id: 'jd-004', name: 'Juan Dela Cruz', email: 'j.delacruz.stud@stcolumban.edu.ph', initials: 'JC', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. Luke' },
    { id: 'et-005', name: 'Ella Tan', email: 'e.tan.stud@stcolumban.edu.ph', initials: 'ET', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. John' },
    { id: 'ml-006', name: 'Maria Lopez', email: 'm.lopez.stud@stcolumban.edu.ph', initials: 'ML', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Peter' },
    { id: 'bg-007', name: 'Ben Garcia', email: 'b.garcia.stud@stcolumban.edu.ph', initials: 'BG', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Paul' },
    { id: 'as-008', name: 'Ana Santos', email: 'a.santos.stud@stcolumban.edu.ph', initials: 'AS', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. James' },
    { id: 'ks-009', name: 'Karl Santiago', email: 'k.santiago.stud@stcolumban.edu.ph', initials: 'KS', level: 'jhs', grade: '', strand: '', section: 'Unassigned' },
    { id: 'pn-010', name: 'Paula Nieves', email: 'p.nieves.stud@stcolumban.edu.ph', initials: 'PN', level: 'jhs', grade: '', strand: '', section: 'Unassigned' },
    { id: 'do-011', name: 'Dan Ocampo', email: 'd.ocampo.stud@stcolumban.edu.ph', initials: 'DO', level: 'jhs', grade: '', strand: '', section: 'Unassigned' },
    { id: 'mt-012', name: 'Maya Torres', email: 'm.torres.stud@stcolumban.edu.ph', initials: 'MT', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'sc-013', name: 'Sofia Cruz', email: 's.cruz.stud@stcolumban.edu.ph', initials: 'SC', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'gb-014', name: 'Gabriel Bautista', email: 'g.bautista.stud@stcolumban.edu.ph', initials: 'GB', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'na-015', name: 'Nicole Aquino', email: 'n.aquino.stud@stcolumban.edu.ph', initials: 'NA', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Matthew' },
    { id: 'pr-016', name: 'Paolo Rivera', email: 'p.rivera.stud@stcolumban.edu.ph', initials: 'PR', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Mark' },
    { id: 'av-017', name: 'Aira Villanueva', email: 'a.villanueva.stud@stcolumban.edu.ph', initials: 'AV', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Mark' },
    { id: 'ld-018', name: 'Lucas Dizon', email: 'l.dizon.stud@stcolumban.edu.ph', initials: 'LD', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Mark' },
    { id: 'br-019', name: 'Beatrice Ramos', email: 'b.ramos.stud@stcolumban.edu.ph', initials: 'BR', level: 'jhs', grade: 'Grade 7', strand: '', section: 'Grade 7 / St. Mark' },
    { id: 'mg-020', name: 'Miguel Garcia', email: 'm.garcia.stud@stcolumban.edu.ph', initials: 'MG', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. Luke' },
    { id: 'ac-021', name: 'Andrea Castillo', email: 'a.castillo.stud@stcolumban.edu.ph', initials: 'AC', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. Luke' },
    { id: 'eb-022', name: 'Ethan Bernardo', email: 'e.bernardo.stud@stcolumban.edu.ph', initials: 'EB', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. Luke' },
    { id: 'ch-023', name: 'Chloe Hernandez', email: 'c.hernandez.stud@stcolumban.edu.ph', initials: 'CH', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. Luke' },
    { id: 'nr-024', name: 'Nathan Reyes', email: 'n.reyes.stud@stcolumban.edu.ph', initials: 'NR', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. John' },
    { id: 'is-025', name: 'Isabella Santos', email: 'i.santos.stud@stcolumban.edu.ph', initials: 'IS', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. John' },
    { id: 'lm-026', name: 'Liam Mercado', email: 'l.mercado.stud@stcolumban.edu.ph', initials: 'LM', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. John' },
    { id: 'gr-027', name: 'Grace Rivera', email: 'g.rivera.stud@stcolumban.edu.ph', initials: 'GR', level: 'jhs', grade: 'Grade 8', strand: '', section: 'Grade 8 / St. John' },
    { id: 'ds-028', name: 'Daniel Salazar', email: 'd.salazar.stud@stcolumban.edu.ph', initials: 'DS', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Peter' },
    { id: 'cb-029', name: 'Camille Bautista', email: 'c.bautista.stud@stcolumban.edu.ph', initials: 'CB', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Peter' },
    { id: 'jr-030', name: 'Joshua Ramos', email: 'j.ramos2.stud@stcolumban.edu.ph', initials: 'JR', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Peter' },
    { id: 'rr-031', name: 'Reina Robles', email: 'r.robles.stud@stcolumban.edu.ph', initials: 'RR', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Peter' },
    { id: 'mp-032', name: 'Marcus Perez', email: 'm.perez.stud@stcolumban.edu.ph', initials: 'MP', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Paul' },
    { id: 'al-033', name: 'Alyssa Lim', email: 'a.lim.stud@stcolumban.edu.ph', initials: 'AL', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Paul' },
    { id: 'ad-034', name: 'Adrian Domingo', email: 'a.domingo.stud@stcolumban.edu.ph', initials: 'AD', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Paul' },
    { id: 'td-035', name: 'Trisha David', email: 't.david.stud@stcolumban.edu.ph', initials: 'TD', level: 'jhs', grade: 'Grade 9', strand: '', section: 'Grade 9 / St. Paul' },
    { id: 'vp-036', name: 'Vincent Padilla', email: 'v.padilla.stud@stcolumban.edu.ph', initials: 'VP', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. James' },
    { id: 'hc-037', name: 'Helena Cruz', email: 'h.cruz.stud@stcolumban.edu.ph', initials: 'HC', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. James' },
    { id: 'sa-038', name: 'Samuel Aquino', email: 's.aquino.stud@stcolumban.edu.ph', initials: 'SA', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. James' },
    { id: 'pm-039', name: 'Patricia Mendoza', email: 'p.mendoza.stud@stcolumban.edu.ph', initials: 'PM', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. James' },
    { id: 'ov-040', name: 'Oliver Valdez', email: 'o.valdez.stud@stcolumban.edu.ph', initials: 'OV', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. Thomas' },
    { id: 'bb-041', name: 'Bianca Bautista', email: 'b.bautista.stud@stcolumban.edu.ph', initials: 'BB', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. Thomas' },
    { id: 'mm-042', name: 'Matteo Morales', email: 'm.morales.stud@stcolumban.edu.ph', initials: 'MM', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. Thomas' },
    { id: 'cc-043', name: 'Clarisse Castillo', email: 'c.castillo.stud@stcolumban.edu.ph', initials: 'CC', level: 'jhs', grade: 'Grade 10', strand: '', section: 'Grade 10 / St. Thomas' },
    { id: 'em-044', name: 'Elijah Manalo', email: 'e.manalo.stud@stcolumban.edu.ph', initials: 'EM', level: 'elementary', grade: 'Grade 4', strand: '', section: 'Grade 4 / St. Luke' },
    { id: 'rs-045', name: 'Rina Soriano', email: 'r.soriano.stud@stcolumban.edu.ph', initials: 'RS', level: 'elementary', grade: 'Grade 4', strand: '', section: 'Grade 4 / St. Luke' },
    { id: 'ja-046', name: 'Janelle Aquino', email: 'j.aquino.stud@stcolumban.edu.ph', initials: 'JA', level: 'elementary', grade: 'Grade 5', strand: '', section: 'Grade 5 / St. Mark' },
    { id: 'cp-047', name: 'Caleb Pascual', email: 'c.pascual.stud@stcolumban.edu.ph', initials: 'CP', level: 'elementary', grade: 'Grade 5', strand: '', section: 'Grade 5 / St. Mark' },
    { id: 'ls-048', name: 'Lara Santiago', email: 'l.santiago.stud@stcolumban.edu.ph', initials: 'LS', level: 'shs', grade: 'Grade 11', strand: 'STEM', section: 'Grade 11 / STEM A' },
    { id: 'km-049', name: 'Kyle Mendoza', email: 'k.mendoza.stud@stcolumban.edu.ph', initials: 'KM', level: 'shs', grade: 'Grade 11', strand: 'STEM', section: 'Grade 11 / STEM A' },
    { id: 'hc-050', name: 'Hannah Cabrera', email: 'h.cabrera.stud@stcolumban.edu.ph', initials: 'HC', level: 'shs', grade: 'Grade 11', strand: 'HUMSS', section: 'Grade 11 / HUMSS A' },
    { id: 'dv-051', name: 'Diego Villarama', email: 'd.villarama.stud@stcolumban.edu.ph', initials: 'DV', level: 'shs', grade: 'Grade 11', strand: 'HUMSS', section: 'Grade 11 / HUMSS A' },
    { id: 'ab-052', name: 'Amara Bautista', email: 'a.bautista2.stud@stcolumban.edu.ph', initials: 'AB', level: 'shs', grade: 'Grade 12', strand: 'ABM', section: 'Grade 12 / ABM A' },
    { id: 'rg-053', name: 'Rafael Garcia', email: 'r.garcia.stud@stcolumban.edu.ph', initials: 'RG', level: 'shs', grade: 'Grade 12', strand: 'ABM', section: 'Grade 12 / ABM A' },
    { id: 'tm-054', name: 'Talia Mercado', email: 't.mercado.stud@stcolumban.edu.ph', initials: 'TM', level: 'shs', grade: 'Grade 12', strand: 'TVL', section: 'Grade 12 / TVL A' },
    { id: 'jn-055', name: 'Jonas Navarro', email: 'j.navarro.stud@stcolumban.edu.ph', initials: 'JN', level: 'shs', grade: 'Grade 12', strand: 'TVL', section: 'Grade 12 / TVL A' },
    { id: 'ar-056', name: 'Arielle Ramos', email: 'a.ramos.kinder@stcolumban.edu.ph', initials: 'AR', level: 'elementary', grade: 'Kindergarten', strand: '', section: 'Unassigned' },
    { id: 'dm-057', name: 'Daniel Morales', email: 'd.morales.kinder@stcolumban.edu.ph', initials: 'DM', level: 'elementary', grade: 'Kindergarten', strand: '', section: 'Unassigned' },
    { id: 'cv-058', name: 'Chloe Villanueva', email: 'c.villanueva.g1@stcolumban.edu.ph', initials: 'CV', level: 'elementary', grade: 'Grade 1', strand: '', section: 'Unassigned' },
    { id: 'er-059', name: 'Ethan Reyes', email: 'e.reyes.g1@stcolumban.edu.ph', initials: 'ER', level: 'elementary', grade: 'Grade 1', strand: '', section: 'Unassigned' },
    { id: 'bs-060', name: 'Bea Santos', email: 'b.santos.g2@stcolumban.edu.ph', initials: 'BS', level: 'elementary', grade: 'Grade 2', strand: '', section: 'Unassigned' },
    { id: 'lc-061', name: 'Lorenzo Cruz', email: 'l.cruz.g2@stcolumban.edu.ph', initials: 'LC', level: 'elementary', grade: 'Grade 2', strand: '', section: 'Unassigned' },
    { id: 'fg-062', name: 'Faith Garcia', email: 'f.garcia.g3@stcolumban.edu.ph', initials: 'FG', level: 'elementary', grade: 'Grade 3', strand: '', section: 'Unassigned' },
    { id: 'nb-063', name: 'Noah Bautista', email: 'n.bautista.g3@stcolumban.edu.ph', initials: 'NB', level: 'elementary', grade: 'Grade 3', strand: '', section: 'Unassigned' },
    { id: 'im-064', name: 'Ivy Mercado', email: 'i.mercado.g6@stcolumban.edu.ph', initials: 'IM', level: 'elementary', grade: 'Grade 6', strand: '', section: 'Unassigned' },
    { id: 'mf-065', name: 'Mateo Flores', email: 'm.flores.g6@stcolumban.edu.ph', initials: 'MF', level: 'elementary', grade: 'Grade 6', strand: '', section: 'Unassigned' },
  ];

  function resolveStudentSectionId(student) {
    const sectionLabel = String(student?.section || '').trim();
    const grade = String(student?.grade || '').trim().toLowerCase();
    const name = sectionLabel.split('/').pop().trim().toLowerCase();
    if (!sectionLabel || /^unassigned$/i.test(sectionLabel)) return null;

    const section = getAssignmentSections(getActiveSchool()).find(record => (
      String(record.grade || '').trim().toLowerCase() === grade
      && String(record.name || '').trim().toLowerCase() === name
    ));
    return section?.id || null;
  }

  // Keep the display label for the current UI and the relational ID needed by
  // management pages. An API student record can provide this sectionId directly.
  STUDENT_DIRECTORY.forEach(student => {
    student.sectionId = resolveStudentSectionId(student);
  });

  const STUDENT_ACCOUNT_OVERRIDES = {
    'j.delacruz.stud@stcolumban.edu.ph': { id: '4', status: 'active', dateAdded: 'Jun 3, 2024' },
    'a.santos.stud@stcolumban.edu.ph': { id: '5', status: 'active', dateAdded: 'May 26, 2025' },
    'b.garcia.stud@stcolumban.edu.ph': { id: '6', status: 'inactive', dateAdded: 'Jun 3, 2024' },
    'c.mendoza.stud@stcolumban.edu.ph': { id: '10', status: 'active', dateAdded: 'Jun 3, 2024' }
  };

  function splitAccountName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') };
  }

  function formatAccountGrade(value) {
    const grade = String(value || '').trim();
    return grade && !/^unassigned$/i.test(grade) ? grade : '';
  }

  function getInitials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  // Every person who can use the portal has one account. Student accounts are
  // built from the shared learner directory so the Users page, Dashboard, and
  // Class Management all begin with the same source of truth.
  const ACCOUNT_DIRECTORY = [
    ...CORE_ACCOUNT_DIRECTORY,
    ...STUDENT_DIRECTORY.map(student => {
      const override = STUDENT_ACCOUNT_OVERRIDES[student.email] || {};
      return {
        id: override.id || `student-${student.id}`,
        ...splitAccountName(student.name),
        displayName: student.name,
        email: student.email,
        role: 'stud',
        studentId: student.id,
        section: student.section,
        sectionId: student.sectionId,
        gradeLevel: formatAccountGrade(student.grade),
        status: override.status || 'active',
        dateAdded: override.dateAdded || 'Jun 10, 2025',
        lrn: '',
        linkedStudents: []
      };
    })
  ];

  function upsertStudentProfile(account, values = {}) {
    if (!account || account.role !== 'stud') return null;

    const index = STUDENT_DIRECTORY.findIndex(student => (
      student.id === account.studentId || student.email === account.email
    ));
    const current = index >= 0 ? STUDENT_DIRECTORY[index] : {};
    const name = values.name || account.displayName || [account.firstName, account.lastName].filter(Boolean).join(' ');
    const section = values.section ?? account.section ?? current.section ?? 'Unassigned';
    const grade = values.grade ?? account.gradeLevel ?? current.grade ?? '';
    const record = {
      ...current,
      id: current.id || account.studentId || `student-${account.id}`,
      name,
      email: values.email ?? account.email ?? current.email ?? '',
      initials: values.initials || current.initials || getInitials(name),
      level: values.level ?? current.level ?? '',
      grade,
      strand: values.strand ?? current.strand ?? '',
      section,
      sectionId: values.sectionId ?? account.sectionId ?? current.sectionId ?? null
    };

    if (index >= 0) STUDENT_DIRECTORY[index] = record;
    else STUDENT_DIRECTORY.push(record);

    account.studentId = record.id;
    account.section = record.section;
    account.sectionId = record.sectionId;
    account.gradeLevel = formatAccountGrade(record.grade);
    return record;
  }

  function removeStudentProfile(account) {
    if (!account) return;
    const index = STUDENT_DIRECTORY.findIndex(student => (
      student.id === account.studentId || student.email === account.email
    ));
    if (index >= 0) STUDENT_DIRECTORY.splice(index, 1);
  }

  function updateStudentPlacement(studentId, values = {}) {
    const student = STUDENT_DIRECTORY.find(record => record.id === studentId);
    if (!student) return null;

    Object.assign(student, values);
    const account = ACCOUNT_DIRECTORY.find(record => record.studentId === student.id || record.email === student.email);
    if (account) {
      account.section = student.section || 'Unassigned';
      account.sectionId = student.sectionId || null;
      account.gradeLevel = formatAccountGrade(student.grade);
    }
    return student;
  }

  function getHolidays() {
    const saved = readJson(STORAGE_KEYS.holidays, null);
    return Array.isArray(saved) ? saved : clone(DEFAULT_HOLIDAYS);
  }

  function saveHolidays(holidays) {
    writeJson(STORAGE_KEYS.holidays, holidays);
  }

  function getLocalDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getNoClassDay(date = getLocalDateISO()) {
    return getHolidays().find(day => day.date === date) || null;
  }

  window.EDUGNAY_CONFIG = {
    storageKeys: STORAGE_KEYS,
    schools: DEFAULT_SCHOOLS,
    grades: GRADE_CATALOG,
    createDivision: makeDivision,
    subjects: SUBJECT_CATALOG,
    accounts: ACCOUNT_DIRECTORY,
    students: STUDENT_DIRECTORY,
    upsertStudentProfile,
    removeStudentProfile,
    updateStudentPlacement,
    periods: PERIOD_CATALOG,
    attendanceDefaults: makeAttendanceRules(),
    holidays: DEFAULT_HOLIDAYS,
    getSchools,
    saveSchools,
    getActiveSchool,
    setActiveSchool,
    getAssignmentSections,
    getHolidays,
    saveHolidays,
    getLocalDateISO,
    getNoClassDay
  };
})();

/* Shared searchable select enhancement. The native select stays in the form
   as the source of truth, while the visible combobox makes long user lists
   easier to browse and search. Replace the option source with API data later
   without changing the form field contract. */
(function initializeSearchableSelectSupport() {
  const states = new WeakMap();

  function normalize(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function getOptionRecords(state) {
    return Array.from(state.select.options)
      .map(option => ({
        value: option.value,
        label: option.textContent.trim(),
        disabled: option.disabled
      }))
      .filter(option => option.value && option.label);
  }

  function initialsFor(label) {
    const words = String(label || '').split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  }

  function splitOptionLabel(label) {
    const parts = String(label || '').split(/\s*[\u00b7\u2022]\s*/);
    return {
      main: parts.shift() || label,
      meta: parts.join(' · ')
    };
  }

  function selectedRecord(state) {
    return getOptionRecords(state).find(option => option.value === state.select.value) || null;
  }

  function syncInput(state) {
    const selected = selectedRecord(state);
    state.input.disabled = state.select.disabled;
    state.input.required = state.required;
    state.input.setAttribute('aria-required', String(state.required));
    state.wrapper.classList.toggle('is-disabled', state.select.disabled);

    if (!state.open) {
      state.input.value = selected?.label || '';
      state.input.placeholder = state.placeholder;
    }
  }

  function setActiveOption(state, index) {
    const options = Array.from(state.menu.querySelectorAll('.searchable-select-option'));
    if (!options.length) {
      state.activeIndex = -1;
      state.input.removeAttribute('aria-activedescendant');
      return;
    }

    state.activeIndex = state.activeIndex < 0
      ? (index < 0 ? options.length - 1 : 0)
      : (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === state.activeIndex;
      option.classList.toggle('is-active', active);
      if (active) state.input.setAttribute('aria-activedescendant', option.id);
    });
    options[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function renderOptions(state, query = '') {
    const term = normalize(query);
    const options = getOptionRecords(state).filter(option => (
      !option.disabled && (!term || normalize(option.label).includes(term))
    ));

    state.visibleOptions = options;
    state.activeIndex = -1;
    state.menu.innerHTML = '';
    state.input.removeAttribute('aria-activedescendant');

    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'searchable-select-empty';
      empty.textContent = term ? state.emptyText : 'No options available';
      state.menu.appendChild(empty);
      return;
    }

    options.forEach((option, index) => {
      const item = document.createElement('div');
      const copy = splitOptionLabel(option.label);
      item.className = 'searchable-select-option';
      item.id = `${state.menu.id}-option-${index}`;
      item.dataset.value = option.value;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === state.select.value));
      if (option.value === state.select.value) item.classList.add('is-selected');

      const avatar = document.createElement('span');
      avatar.className = 'searchable-select-option-avatar';
      avatar.textContent = initialsFor(copy.main);

      const text = document.createElement('span');
      text.className = 'searchable-select-option-copy';

      const main = document.createElement('span');
      main.className = 'searchable-select-option-main';
      main.textContent = copy.main;
      text.appendChild(main);

      if (copy.meta) {
        const meta = document.createElement('span');
        meta.className = 'searchable-select-option-meta';
        meta.textContent = copy.meta;
        text.appendChild(meta);
      }

      item.append(avatar, text);
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', () => chooseOption(state, option.value));
      state.menu.appendChild(item);
    });
  }

  function openSelect(state) {
    if (state.select.disabled) return;
    if (!state.open) {
      state.open = true;
      state.wrapper.classList.add('is-open');
      state.input.setAttribute('aria-expanded', 'true');
      state.input.placeholder = state.searchPlaceholder;
      state.input.value = '';
      renderOptions(state, '');
    }
  }

  function closeSelect(state) {
    state.open = false;
    state.wrapper.classList.remove('is-open');
    state.input.setAttribute('aria-expanded', 'false');
    state.input.removeAttribute('aria-activedescendant');
    syncInput(state);
  }

  function chooseOption(state, value) {
    const option = getOptionRecords(state).find(record => record.value === value);
    if (!option || option.disabled) return;
    state.select.value = option.value;
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
    closeSelect(state);
  }

  function handleKeydown(state, event) {
    if (event.key === 'Escape') {
      if (state.open) {
        event.preventDefault();
        closeSelect(state);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openSelect(state);
      setActiveOption(state, state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    if (event.key === 'Enter' && state.open) {
      const option = state.visibleOptions[state.activeIndex >= 0 ? state.activeIndex : 0];
      if (option) {
        event.preventDefault();
        chooseOption(state, option.value);
      }
    }
  }

  function createSearchableSelect(selectOrSelector, settings = {}) {
    const select = typeof selectOrSelector === 'string'
      ? document.querySelector(selectOrSelector)
      : selectOrSelector;
    if (!select || select.tagName !== 'SELECT') return null;
    if (states.has(select)) return states.get(select);

    const wrapper = document.createElement('div');
    const control = document.createElement('div');
    const input = document.createElement('input');
    const menu = document.createElement('div');
    const baseId = select.id || `searchable-select-${Math.random().toString(36).slice(2)}`;

    wrapper.className = 'searchable-select';
    wrapper.dataset.searchableSelect = 'true';
    control.className = 'searchable-select-control';
    input.className = 'searchable-select-input';
    input.type = 'text';
    input.id = settings.inputId || `${baseId}-search`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${baseId}-options`);
    input.setAttribute('aria-label', settings.ariaLabel || select.getAttribute('aria-label') || 'Select an option');

    menu.className = 'searchable-select-menu';
    menu.id = `${baseId}-options`;
    menu.setAttribute('role', 'listbox');

    const state = {
      select,
      wrapper,
      input,
      menu,
      placeholder: settings.placeholder || select.options[0]?.textContent.trim() || 'Select an option',
      searchPlaceholder: settings.searchPlaceholder || 'Search options...',
      emptyText: settings.emptyText || 'No matching options',
      required: select.required,
      open: false,
      activeIndex: -1,
      visibleOptions: []
    };

    select.classList.add('searchable-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    /* Let the visible combobox own native validation while the original
       select remains available for form submission and backend integration. */
    select.required = false;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(control, select, menu);
    control.appendChild(input);

    input.addEventListener('focus', () => openSelect(state));
    input.addEventListener('click', () => openSelect(state));
    input.addEventListener('input', () => {
      openSelect(state);
      renderOptions(state, input.value);
    });
    input.addEventListener('keydown', event => handleKeydown(state, event));
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) closeSelect(state);
      }, 0);
    });
    select.addEventListener('change', () => {
      syncInput(state);
      if (state.open) renderOptions(state, input.value);
    });
    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target)) closeSelect(state);
    });

    if ('MutationObserver' in window) {
      const observer = new MutationObserver(() => {
        syncInput(state);
        if (state.open) renderOptions(state, input.value);
      });
      observer.observe(select, {
        attributes: true,
        attributeFilter: ['disabled'],
        childList: true,
        subtree: true
      });
      state.observer = observer;
    }

    states.set(select, state);
    syncInput(state);
    return state;
  }

  window.initSearchableSelect = createSearchableSelect;
  window.syncSearchableSelect = function syncSearchableSelect(selectOrSelector) {
    const select = typeof selectOrSelector === 'string'
      ? document.querySelector(selectOrSelector)
      : selectOrSelector;
    const state = select && states.get(select);
    if (!state) return;
    syncInput(state);
    if (state.open) renderOptions(state, state.input.value);
  };
})();

function toggleNotifDropdown() {
  const panel = document.getElementById('tbNotifPanel');
  if (panel) panel.classList.toggle('open');
}

function markAllNotifRead() {
  const adminItems = typeof getAdminNotifItems === 'function' ? getAdminNotifItems() : [];
  const roleItems = typeof NOTIFICATIONS !== 'undefined' && Array.isArray(NOTIFICATIONS)
    ? NOTIFICATIONS
    : [];
  const items = adminItems.length ? adminItems : roleItems;

  if (typeof NOTIFICATIONS !== 'undefined' && Array.isArray(NOTIFICATIONS)) {
    NOTIFICATIONS.forEach(item => { item.read = true; });
  }
  if (typeof setReadIds === 'function') setReadIds(items.map(item => item.id));
  if (typeof renderTopbarNotifs === 'function') renderTopbarNotifs();
}

function getProfileControls() {
  return {
    trigger: document.getElementById('tbProfileTrigger') || document.getElementById('profileTrigger'),
    dropdown: document.getElementById('tbProfileDropdown') || document.getElementById('profileDropdown')
  };
}

function toggleProfileDropdown(forceState) {
  const { trigger, dropdown } = getProfileControls();
  if (!trigger || !dropdown) return;
  const isOpen = forceState === undefined
    ? !dropdown.classList.contains('open')
    : forceState;
  dropdown.classList.toggle('open', isOpen);
  trigger.classList.toggle('open', isOpen);
  trigger.setAttribute('aria-expanded', String(isOpen));
}

function toggleProfileMenu(forceState) {
  toggleProfileDropdown(forceState);
}

function closeProfileMenu() {
  toggleProfileDropdown(false);
}

function toggleDrawer(open) {
  const isOpen = open === undefined
    ? !document.body.classList.contains('drawer-open')
    : open;
  document.body.classList.toggle('drawer-open', isOpen);
  const overlay = document.getElementById('overlay') || document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.toggle('open', isOpen);
  if (typeof window.refreshSidebarScrollbars === 'function') window.refreshSidebarScrollbars();
}

function toggleGroup(id) {
  const group = document.getElementById(id);
  if (!group) return;
  group.classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

function confirmLogout() {
  // TODO on backend conversion: replace with POST /auth/logout,
  // clear session cookie, then redirect
  localStorage.clear(); // wipes mock data (reopen requests, read-state, etc.)
  const isGitHubPages = location.hostname.endsWith('github.io');
  const BASE = isGitHubPages ? '/edugnay' : '';

  window.location.href = `${BASE}/index.html`;
}

function applyActiveSchoolToShell() {
  /* Platform pages operate across every registered school, so they must keep
     their platform context instead of inheriting the active school label. */
  if (document.body?.dataset.platformPortal === 'true') return;

  const school = window.EDUGNAY_CONFIG?.getActiveSchool?.();
  if (!school) return;

  document.querySelectorAll('.brand-sub:not([data-platform-brand])').forEach(element => {
    element.textContent = school.shortName || school.name;
  });
  document.querySelectorAll('[data-school-name]').forEach(element => {
    element.textContent = school.name;
  });
  /* The body stores the active school type as metadata. Exclude it from
     content replacement so refreshing the context never wipes the page. */
  document.querySelectorAll('[data-school-type]:not(body)').forEach(element => {
    element.textContent = school.typeLabel || school.schoolType;
  });
  document.querySelectorAll('[data-school-year]').forEach(element => {
    element.textContent = school.schoolYear || '';
  });
  document.querySelectorAll('.topbar-context-copy span, .admin-topbar-context-copy span').forEach(element => {
    element.textContent = `${school.typeLabel || school.schoolType} · ${school.schoolYear || ''}`;
  });
  /* Set shell metadata last so the body itself is not included in the
     data-school-type content selector above. */
  document.body.dataset.activeSchool = school.id;
  document.body.dataset.schoolType = school.schoolType;
}

function renderNoClassNotice() {
  if (document.body?.dataset.platformPortal === 'true') return;
  const pageName = location.pathname.split('/').pop().toLowerCase();
  if (!/(dashboard|notifications)\.html$/.test(pageName)) return;

  const main = document.querySelector('.main');
  const config = window.EDUGNAY_CONFIG;
  if (!main || !config?.getNoClassDay || main.querySelector('[data-system-day-banner]')) return;

  const noClassDay = config.getNoClassDay();
  if (!noClassDay) return;

  const banner = document.createElement('div');
  banner.className = 'system-day-banner';
  banner.dataset.systemDayBanner = 'true';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <div class="system-day-banner-icon" aria-hidden="true"><i data-lucide="calendar-off"></i></div>
    <div class="system-day-banner-copy">
      <div class="system-day-banner-kicker">No classes today</div>
      <div class="system-day-banner-title"></div>
      <div class="system-day-banner-text"></div>
    </div>`;
  banner.querySelector('.system-day-banner-title').textContent = noClassDay.title || '';
  banner.querySelector('.system-day-banner-text').textContent = noClassDay.detail || '';
  main.prepend(banner);
  if (window.lucide) lucide.createIcons();
}

window.refreshEdUgnayShellContext = function refreshEdUgnayShellContext() {
  applyActiveSchoolToShell();
  renderNoClassNotice();
};

function applyPageTitleToTopbar() {
  const source = document.querySelector('.page-overview-title')
    || document.querySelector('.nav-item.active .nav-label')
    || document.querySelector('.nav-group-toggle.active > span');
  const title = source?.textContent.trim();
  if (!title) return;

  document.querySelectorAll('.topbar-context, .admin-topbar-context').forEach(context => {
    const value = context.querySelector('strong');
    if (value) value.textContent = title;
    context.setAttribute('aria-label', `${title} page`);
  });
}

/* Initialize the shared right-edge fade for every horizontally scrollable tab bar. */
window.initScrollFades = function initScrollFades() {
  const selector = [
    '.child-switcher',
    '.subject-tab-bar',
    '.profile-tab-bar',
    '.mgmt-tabs',
    '.school-tabs',
    '.sf-tabs',
    '.filter-tabs',
    '.tab-bar',
    '.cat-tabs',
    '.att-history-tabs',
    '.grade-tabs',
    '.mini-tab-bar',
    '.section-tab-bar'
  ].join(', ');

  document.querySelectorAll(selector).forEach(element => {
    if (element.dataset.scrollFadeReady === 'true') return;
    element.dataset.scrollFadeReady = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'scroll-fade-wrap';
    if (!element.classList.contains('child-switcher')) {
      wrapper.classList.add('tabs-fade', 'light-tabs-fade');
    }

    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);

    const updateFade = () => {
      const hasMore = element.scrollWidth - element.clientWidth - element.scrollLeft > 4;
      wrapper.classList.toggle('has-more-right', hasMore);
    };

    updateFade();
    element.addEventListener('scroll', updateFade, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(updateFade).observe(element);
    } else {
      window.addEventListener('resize', updateFade);
    }
  });
};

/* Use a custom sidebar thumb so native track and arrow controls never appear. */
window.initSidebarScrollbars = function initSidebarScrollbars() {
  const sidebars = Array.from(document.querySelectorAll('.sidebar'));
  if (!sidebars.length) return;

  const refreshers = [];

  sidebars.forEach((sidebar, index) => {
    if (sidebar.dataset.customScrollbarReady === 'true') return;
    sidebar.dataset.customScrollbarReady = 'true';

    const scrollbar = document.createElement('div');
    scrollbar.className = 'sidebar-scrollbar';
    scrollbar.setAttribute('aria-hidden', 'true');

    const thumb = document.createElement('div');
    thumb.className = 'sidebar-scrollbar-thumb';
    scrollbar.appendChild(thumb);
    document.body.appendChild(scrollbar);

    let frame = 0;
    let dragging = false;
    let dragStartY = 0;
    let dragStartScrollTop = 0;

    const update = () => {
      frame = 0;

      const rect = sidebar.getBoundingClientRect();
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const visible = scrollRange > 1
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.left < window.innerWidth
        && rect.bottom > 0
        && rect.top < window.innerHeight;

      scrollbar.classList.toggle('is-visible', visible);
      if (!visible) return;

      const railHeight = Math.max(1, Math.round(rect.height));
      const thumbHeight = Math.min(
        railHeight,
        Math.max(32, Math.round((sidebar.clientHeight / sidebar.scrollHeight) * railHeight))
      );
      const thumbRange = Math.max(0, railHeight - thumbHeight);
      const progress = scrollRange > 0 ? sidebar.scrollTop / scrollRange : 0;

      scrollbar.style.left = `${Math.round(rect.right - 8)}px`;
      scrollbar.style.top = `${Math.round(rect.top)}px`;
      scrollbar.style.height = `${railHeight}px`;
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${Math.round(thumbRange * progress)}px)`;
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const stopDragging = () => {
      dragging = false;
      scrollbar.classList.remove('is-dragging');
    };

    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true;
      dragStartY = event.clientY;
      dragStartScrollTop = sidebar.scrollTop;
      scrollbar.classList.add('is-dragging');
      thumb.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    thumb.addEventListener('pointermove', event => {
      if (!dragging) return;
      const thumbRange = Math.max(1, scrollbar.clientHeight - thumb.offsetHeight);
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const delta = event.clientY - dragStartY;
      sidebar.scrollTop = dragStartScrollTop + (delta / thumbRange) * scrollRange;
      scheduleUpdate();
    });

    thumb.addEventListener('pointerup', stopDragging);
    thumb.addEventListener('pointercancel', stopDragging);
    thumb.addEventListener('lostpointercapture', stopDragging);

    scrollbar.addEventListener('pointerdown', event => {
      if (event.target === thumb) return;
      const railRect = scrollbar.getBoundingClientRect();
      const thumbRange = Math.max(1, railRect.height - thumb.offsetHeight);
      const scrollRange = sidebar.scrollHeight - sidebar.clientHeight;
      const target = Math.max(0, Math.min(
        thumbRange,
        event.clientY - railRect.top - (thumb.offsetHeight / 2)
      ));
      sidebar.scrollTop = (target / thumbRange) * scrollRange;
      scheduleUpdate();
    });

    sidebar.addEventListener('scroll', scheduleUpdate, { passive: true });
    sidebar.addEventListener('transitionend', event => {
      if (event.propertyName === 'transform') scheduleUpdate();
    });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    if ('ResizeObserver' in window) {
      new ResizeObserver(scheduleUpdate).observe(sidebar);
    }

    if ('MutationObserver' in window) {
      new MutationObserver(scheduleUpdate).observe(sidebar, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }

    refreshers.push(scheduleUpdate);
    scheduleUpdate();
  });

  window.refreshSidebarScrollbars = () => refreshers.forEach(refresh => refresh());
};

document.addEventListener('click', event => {
  const { trigger, dropdown } = getProfileControls();
  if (trigger && dropdown && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
    toggleProfileDropdown(false);
  }

  const notifTrigger = document.getElementById('tbNotifTrigger');
  const notifPanel = document.getElementById('tbNotifPanel');
  if (notifTrigger && notifPanel && !notifTrigger.contains(event.target) && !notifPanel.contains(event.target)) {
    notifPanel.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  applyActiveSchoolToShell();
  renderNoClassNotice();
  applyPageTitleToTopbar();
  window.initScrollFades();
  window.initSidebarScrollbars();
});
