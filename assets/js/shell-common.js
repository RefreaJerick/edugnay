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
            { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38 },
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
        { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38 },
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

  const STUDENT_DIRECTORY = [
    { id: 'STU-001', name: 'Juan Dela Cruz', email: 'j.delacruz.stud@stcolumban.edu.ph', initials: 'JD', level: 'jhs', grade: 'Grade 8', strand: '' },
    { id: 'STU-002', name: 'Ana Santos', email: 'a.santos.stud@stcolumban.edu.ph', initials: 'AS', level: 'jhs', grade: 'Grade 10', strand: '' },
    { id: 'STU-003', name: 'Ben Garcia', email: 'b.garcia.stud@stcolumban.edu.ph', initials: 'BG', level: 'jhs', grade: 'Grade 9', strand: '' },
    { id: 'STU-004', name: 'Carlo Mendoza', email: 'c.mendoza.stud@stcolumban.edu.ph', initials: 'CM', level: 'jhs', grade: 'Grade 7', strand: '' },
    { id: 'STU-005', name: 'Maria Lopez', email: 'm.lopez.stud@stcolumban.edu.ph', initials: 'ML', level: 'jhs', grade: 'Grade 9', strand: '' },
    { id: 'STU-006', name: 'Liza Reyes', email: 'l.reyes.stud@stcolumban.edu.ph', initials: 'LR', level: 'jhs', grade: 'Grade 7', strand: '' },
    { id: 'STU-007', name: 'Rico Cruz', email: 'r.cruz.stud@stcolumban.edu.ph', initials: 'RC', level: 'jhs', grade: 'Grade 8', strand: '' },
    { id: 'STU-008', name: 'Ella Tan', email: 'e.tan.stud@stcolumban.edu.ph', initials: 'ET', level: 'jhs', grade: 'Grade 8', strand: '' },
    { id: 'STU-009', name: 'Jose Ramos', email: 'j.ramos.stud@stcolumban.edu.ph', initials: 'JR', level: 'jhs', grade: 'Grade 7', strand: '' },
    { id: 'STU-010', name: 'Mia Reyes', email: 'm.reyes.stud@stcolumban.edu.ph', initials: 'MR', level: 'elementary', grade: 'Grade 5', strand: '' },
    { id: 'STU-011', name: 'Liam Santos', email: 'l.santos.stud@stcolumban.edu.ph', initials: 'LS', level: 'shs', grade: 'Grade 11', strand: 'STEM' },
    { id: 'STU-012', name: 'Karl Santiago', email: 'k.santiago.stud@stcolumban.edu.ph', initials: 'KS', level: 'jhs', grade: '', strand: '' },
    { id: 'STU-013', name: 'Paula Nieves', email: 'p.nieves.stud@stcolumban.edu.ph', initials: 'PN', level: 'jhs', grade: '', strand: '' },
    { id: 'STU-014', name: 'Dan Ocampo', email: 'd.ocampo.stud@stcolumban.edu.ph', initials: 'DO', level: 'jhs', grade: '', strand: '' }
  ];

  function getStudentDirectory() {
    return clone(STUDENT_DIRECTORY);
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
    periods: PERIOD_CATALOG,
    attendanceDefaults: makeAttendanceRules(),
    holidays: DEFAULT_HOLIDAYS,
    getSchools,
    saveSchools,
    getActiveSchool,
    setActiveSchool,
    getAssignmentSections,
    getStudentDirectory,
    getHolidays,
    saveHolidays,
    getLocalDateISO,
    getNoClassDay
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
  const school = window.EDUGNAY_CONFIG?.getActiveSchool?.();
  if (!school) return;

  document.querySelectorAll('.brand-sub').forEach(element => {
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
