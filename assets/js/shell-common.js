/* Shared shell behavior for every portal role. */

const EDUGNAY_SESSION_STORAGE_KEY = 'edugnay_session';

function readFrontendSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(EDUGNAY_SESSION_STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
}

window.EDUGNAY_SESSION = window.EDUGNAY_SESSION || readFrontendSession();

/* Small rendering helpers shared by pages that build HTML from local records. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function isRecorded(score) {
  return score !== null && score !== undefined && score !== '' && Number.isFinite(Number(score));
}

function getInitials(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  if (value.includes(',')) {
    const [last, first] = value.split(',', 2).map(part => part.trim());
    return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
  }
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* Small notification helpers shared by every portal shell and notification page. */
function getNotificationReadIds(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(stored) ? [...new Set(stored.map(String))] : [];
  } catch {
    return [];
  }
}

function saveNotificationReadIds(storageKey, ids) {
  const values = Array.isArray(ids) ? ids : [];
  const uniqueIds = [...new Set(values.map(String))];
  localStorage.setItem(storageKey, JSON.stringify(uniqueIds));
  return uniqueIds;
}

function applyNotificationReadState(records, storageKey) {
  const readIds = new Set(getNotificationReadIds(storageKey));
  const values = Array.isArray(records) ? records : [];
  values.forEach(record => {
    record.read = Boolean(record.read || readIds.has(String(record.id)));
  });
  return values;
}

function markNotificationRead(storageKey, id, records = []) {
  const notificationId = String(id);
  const readIds = getNotificationReadIds(storageKey);
  if (!readIds.includes(notificationId)) readIds.push(notificationId);
  saveNotificationReadIds(storageKey, readIds);
  const record = (Array.isArray(records) ? records : [])
    .find(item => String(item.id) === notificationId);
  if (record) record.read = true;
  return record || null;
}

function markAllNotificationsRead(storageKey, records = []) {
  const values = Array.isArray(records) ? records : [];
  const readIds = new Set(getNotificationReadIds(storageKey));
  values.forEach(record => {
    readIds.add(String(record.id));
    record.read = true;
  });
  saveNotificationReadIds(storageKey, [...readIds]);
  return values;
}

function formatDateGroup(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatTime(dateValue) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatRelativeTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffHours = Math.floor((now - date) / 3600000);
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const group = formatDateGroup(date);
  if (group === 'Yesterday') return `Yesterday, ${formatTime(date)}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatTime(date)}`;
}

function applyCurrentDateToGradingBanners() {
  const currentDateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  document.querySelectorAll('.grading-banner [data-current-date]').forEach(element => {
    element.textContent = `${currentDateLabel}.`;
  });
}

/*
 * Frontend configuration store.
 * Replace the localStorage reads/writes with API calls during backend integration.
 */
(function initializeEdUgnayConfig() {
  const STORAGE_KEYS = {
    schools: 'edugnay_schools',
    activeSchool: 'edugnay_active_school',
    holidays: 'edugnay_holidays',
    users: 'edugnay_users',
    subjectAssignments: 'edugnay_subject_assignments',
    parentStudentLinks: 'edugnay_parent_student_links',
    attendance: 'edugnay_attendance',
    assignments: 'edugnay_assignments',
    assignmentScores: 'edugnay_assignment_scores',
    assignmentStatuses: 'edugnay_assignment_statuses',
    assignmentSubmissions: 'edugnay_assignment_submissions',
    materials: 'edugnay_learning_materials',
    todos: 'edugnay_user_todos',
    announcements: 'edugnay_announcements',
    grades: 'edugnay_grades',
    journals: 'edugnay_journals',
    reports: 'edugnay_reports',
    sfTemplates: 'edugnay_sf_template_records',
    userProfiles: 'edugnay_user_profiles'
  };

  // Canonical values used by frontend records and future API responses.
  const RECORD_VALUES = {
    roles: {
      PLATFORM_ADMIN: 'platform_admin',
      SCHOOL_ADMIN: 'school_admin',
      TEACHER: 'teacher',
      STUDENT: 'student',
      PARENT: 'parent'
    },
    statuses: {
      ACTIVE: 'active',
      DRAFT: 'draft',
      INACTIVE: 'inactive',
      PENDING: 'pending',
      REJECTED: 'rejected',
      SUSPENDED: 'suspended'
    }
  };

  const PARENT_RELATIONSHIPS = ['mother', 'father', 'guardian'];
  const LRN_PATTERN = /^\d{12}$/;

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
    { id: 'filipino', name: 'Filipino', code: 'FIL', levels: ['elementary'] },
    { id: 'english', name: 'English', code: 'ENG', levels: ['elementary'] },
    { id: 'mathematics', name: 'Mathematics', code: 'MAT', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'science', name: 'Science', code: 'SCI', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'values-education', name: 'Values Education', code: 'VE', levels: ['elementary', 'jhs', 'shs'] },
    { id: 'araling-panlipunan', name: 'Araling Panlipunan', code: 'AP', levels: ['elementary', 'jhs'] },
    { id: 'mapeh', name: 'MAPEH', code: 'MAPEH', levels: ['elementary', 'jhs'] },
    { id: 'tle', name: 'Technology and Livelihood Education', code: 'TLE', levels: ['jhs'] },
    { id: 'esp', name: 'Edukasyon sa Pagpapakatao', code: 'ESP', levels: ['elementary', 'jhs'] },
    { id: 'pe-health', name: 'Physical Education and Health', code: 'PEH', levels: ['shs'] },
    { id: 'empowerment-technologies', name: 'Empowerment Technologies', code: 'E-TECH', levels: ['shs'] },
    { id: 'practical-research', name: 'Practical Research', code: 'PR', levels: ['shs'] }
  ];

  const ACADEMIC_PERIOD_TYPES = {
    quarterly: {
      id: 'quarterly',
      label: 'Quarterly',
      periodNames: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
      idPrefix: 'q'
    },
    three_term: {
      id: 'three_term',
      label: 'Three-term',
      periodNames: ['Term 1', 'Term 2', 'Term 3'],
      idPrefix: 'term'
    },
    semester: {
      id: 'semester',
      label: 'Semestral',
      periodNames: ['Semester 1', 'Semester 2'],
      idPrefix: 'sem'
    }
  };

  const ACADEMIC_PERIOD_STATUSES = {
    UPCOMING: 'upcoming',
    ACTIVE: 'active',
    CLOSED: 'closed'
  };

  const REOPEN_REQUEST_STATUSES = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REVOKED: 'revoked'
  };

  function getDefaultPeriodType(level) {
    return level === 'shs' ? 'semester' : 'quarterly';
  }

  function getPeriodType(type) {
    return ACADEMIC_PERIOD_TYPES[type] || ACADEMIC_PERIOD_TYPES.quarterly;
  }

  function createAcademicPeriods(type, periods = [], idContext = '') {
    const definition = getPeriodType(type);
    return definition.periodNames.map((defaultName, index) => {
      const values = periods[index] || {};
      const number = index + 1;
      return {
        id: idContext ? `${idContext}-${definition.idPrefix}${number}` : values.id || `${definition.idPrefix}${number}`,
        name: String(values.name || defaultName).trim(),
        sequence: number,
        status: Object.values(ACADEMIC_PERIOD_STATUSES).includes(values.status)
          ? values.status
          : ACADEMIC_PERIOD_STATUSES.UPCOMING,
        plannedStartDate: values.plannedStartDate || null,
        plannedEndDate: values.plannedEndDate || null,
        startedAt: values.startedAt || null,
        closedAt: values.closedAt || null
      };
    });
  }

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

  function createDivision(level, values = {}) {
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

    const gradingPeriodType = ACADEMIC_PERIOD_TYPES[values.gradingPeriodType]
      ? values.gradingPeriodType
      : getDefaultPeriodType(level);
    const academicPeriods = createAcademicPeriods(
      gradingPeriodType,
      values.academicPeriods,
      values.periodIdContext
    );
    const legacyActivePeriod = academicPeriods.find(period => period.name === values.academicPeriod);
    const requestedActivePeriodId = values.activeAcademicPeriodId || legacyActivePeriod?.id || null;
    const activePeriod = academicPeriods.find(period => period.id === requestedActivePeriodId)
      || academicPeriods.find(period => period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE)
      || null;
    const activeAcademicPeriodId = activePeriod?.id || null;

    if (activeAcademicPeriodId) {
      academicPeriods.forEach(period => {
        if (period.id === activeAcademicPeriodId) period.status = ACADEMIC_PERIOD_STATUSES.ACTIVE;
        else if (period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE) period.status = ACADEMIC_PERIOD_STATUSES.UPCOMING;
        if (period.sequence < activePeriod.sequence) period.status = ACADEMIC_PERIOD_STATUSES.CLOSED;
      });
    }

    return {
      key: level,
      label: catalog?.label || level,
      gradingPeriodType,
      activeAcademicPeriodId,
      academicPeriods,
      enabledGrades: values.enabledGrades || [...(catalog?.grades || [])],
      tracks: values.tracks || [...(catalog?.tracks || [])],
      strands: values.strands || [...(catalog?.strands || [])],
      sections: values.sections || [],
      gradingRules: values.gradingRules || defaultRules,
      passingGradeThreshold: Number.isFinite(Number(values.passingGradeThreshold)) ? Number(values.passingGradeThreshold) : 75,
      gradeRounding: values.gradeRounding || 'round'
    };
  }

  function getSchoolLevelLabel(level) {
    return GRADE_CATALOG.find(item => item.key === level)?.label || level;
  }

  function getSchoolTypeInfo(levels) {
    const selected = GRADE_CATALOG
      .map(item => item.key)
      .filter(level => Array.isArray(levels) && levels.includes(level));

    if (selected.length === 1) {
      return { value: selected[0], label: getSchoolLevelLabel(selected[0]) };
    }

    if (selected.length === GRADE_CATALOG.length) {
      return { value: 'k12', label: 'K-12 School' };
    }

    return {
      value: 'multi-level',
      label: selected.length ? selected.map(getSchoolLevelLabel).join(' + ') : 'School'
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
      schoolYear: '2025-2026',
      schoolYearStartDate: '2025-03-03',
      schoolYearEndDate: '2025-12-05',
      platformStatus: RECORD_VALUES.statuses.ACTIVE,
      submittedAt: null,
      notificationEmail: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      // School-wide portal policy. Replace this local setting with the
      // authenticated school's settings response during backend integration.
      gradesPageEnabled: true,
      // AI-assisted narrative reports are a school-wide portal policy. Replace
      // this local setting with the authenticated school's settings response
      // during backend integration.
      narrativeReportsEnabled: true,
      journalsEnabled: true,
      journalSubjectId: 'values-education',
      attendanceRules: makeAttendanceRules(),
      activeDivision: 'jhs',
      schoolLevels: ['elementary', 'jhs', 'shs'],
      divisions: {
        elementary: createDivision('elementary', {
          activeAcademicPeriodId: 'q2',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-05-02' },
            { plannedStartDate: '2025-05-05', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-09-26' },
            { plannedStartDate: '2025-09-29', plannedEndDate: '2025-12-05' }
          ],
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
        jhs: createDivision('jhs', {
          activeAcademicPeriodId: 'q2',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-05-02' },
            { plannedStartDate: '2025-05-05', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-09-26' },
            { plannedStartDate: '2025-09-29', plannedEndDate: '2025-12-05' }
          ],
          sections: [
            { id: 'jhs-grade7-matthew', name: 'St. Matthew', grade: 'Grade 7', capacity: 40, enrolled: 38, adviserId: 'teacher-2' },
            { id: 'jhs-grade7-mark', name: 'St. Mark', grade: 'Grade 7', capacity: 40, enrolled: 34, adviserId: 'teacher-carla-dizon' },
            { id: 'jhs-grade8-luke', name: 'St. Luke', grade: 'Grade 8', capacity: 40, enrolled: 36, adviserId: 'teacher-9' },
            { id: 'jhs-grade8-john', name: 'St. John', grade: 'Grade 8', capacity: 40, enrolled: 34 },
            { id: 'jhs-grade9-peter', name: 'St. Peter', grade: 'Grade 9', capacity: 40, enrolled: 37, adviserId: 'teacher-rico-santos' },
            { id: 'jhs-grade9-paul', name: 'St. Paul', grade: 'Grade 9', capacity: 40, enrolled: 37, adviserId: 'teacher-jana-mendez' },
            { id: 'jhs-grade10-james', name: 'St. James', grade: 'Grade 10', capacity: 40, enrolled: 35, adviserId: 'teacher-3' },
            { id: 'jhs-grade10-thomas', name: 'St. Thomas', grade: 'Grade 10', capacity: 40, enrolled: 33, adviserId: 'teacher-ana-garcia' }
          ],
          gradingRules: [
            { id: 'ww', label: 'Written Work', weight: 30 },
            { id: 'pt', label: 'Performance Task', weight: 50 },
            { id: 'qa', label: 'Quarterly Assessment', weight: 20 }
          ]
        }),
        shs: createDivision('shs', {
          activeAcademicPeriodId: 'sem1',
          academicPeriods: [
            { plannedStartDate: '2025-03-03', plannedEndDate: '2025-07-18' },
            { plannedStartDate: '2025-07-21', plannedEndDate: '2025-12-05' }
          ],
          sections: [
            { id: 'shs-grade11-stem-a', name: 'STEM A', grade: 'Grade 11', strand: 'STEM', capacity: 40, enrolled: 28 },
            { id: 'shs-grade11-humss-a', name: 'HUMSS A', grade: 'Grade 11', strand: 'HUMSS', capacity: 40, enrolled: 26 },
            { id: 'shs-grade12-abm-a', name: 'ABM A', grade: 'Grade 12', strand: 'ABM', capacity: 40, enrolled: 31 },
            { id: 'shs-grade12-tvl-a', name: 'TVL A', grade: 'Grade 12', strand: 'TVL', capacity: 40, enrolled: 29 }
          ]
        })
      },
      initialAdministrator: {
        schoolId: 'scc',
        name: 'Sr. Admin',
        schoolEmail: 'admin.adm@stcolumban.edu.ph'
      }
    },
    {
      id: 'manghi',
      name: 'Mangaldan National High School',
      shortName: 'MANGHI',
      schoolType: 'multi-level',
      typeLabel: 'Junior High School + Senior High School',
      schoolId: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      logoUrl: '../../assets/images/manghi-logo.jpg',
      schoolYear: '2025-2026',
      schoolYearStartDate: null,
      schoolYearEndDate: null,
      platformStatus: RECORD_VALUES.statuses.PENDING,
      submittedAt: '2026-08-30T09:00:00.000Z',
      notificationEmail: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      gradesPageEnabled: false,
      narrativeReportsEnabled: false,
      journalsEnabled: false,
      journalSubjectId: null,
      attendanceRules: makeAttendanceRules(),
      activeDivision: 'jhs',
      schoolLevels: ['jhs', 'shs'],
      divisions: {
        jhs: createDivision('jhs'),
        shs: createDivision('shs')
      },
      initialAdministrator: {
        schoolId: 'manghi',
        name: 'Pending administrator',
        schoolEmail: null
      }
    }
  ];

  const DEFAULT_HOLIDAYS = [
    {
      id: 'demo-foundation-day',
      schoolId: 'scc',
      date: '2026-08-17',
      title: 'School Foundation Day',
      detail: 'No classes and no office transactions today.',
      type: 'holiday',
      appliesTo: 'all'
    },
    {
      id: 'national-heroes-day',
      schoolId: 'scc',
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

  function normalizeDivisionRecord(level, division = {}, school = {}) {
    const legacyName = String(division.academicPeriod || '');
    const gradingPeriodType = ACADEMIC_PERIOD_TYPES[division.gradingPeriodType]
      ? division.gradingPeriodType
      : (legacyName.toLowerCase().includes('semester') ? 'semester' : getDefaultPeriodType(level));
    let periods = Array.isArray(division.academicPeriods) ? division.academicPeriods : [];

    if (!periods.length) {
      periods = createAcademicPeriods(gradingPeriodType).map(period => ({
        ...period,
        plannedStartDate: period.name === legacyName ? division.periodStartDate || null : null,
        plannedEndDate: period.name === legacyName ? division.periodEndDate || null : null
      }));
    }

    const canHaveActivePeriod = school.platformStatus === RECORD_VALUES.statuses.ACTIVE;
    const legacyActive = canHaveActivePeriod
      ? periods.find(period => period.name === legacyName)?.id || null
      : null;
    const normalized = createDivision(level, {
      ...division,
      gradingPeriodType,
      academicPeriods: periods,
      activeAcademicPeriodId: canHaveActivePeriod
        ? division.activeAcademicPeriodId || legacyActive
        : null
    });

    if (!canHaveActivePeriod) {
      normalized.academicPeriods.forEach(period => {
        period.status = ACADEMIC_PERIOD_STATUSES.UPCOMING;
        period.startedAt = null;
        period.closedAt = null;
      });
    }

    return normalized;
  }

  function normalizeSchoolRecord(school = {}) {
    const validStatuses = [
      RECORD_VALUES.statuses.ACTIVE,
      RECORD_VALUES.statuses.PENDING,
      RECORD_VALUES.statuses.REJECTED,
      RECORD_VALUES.statuses.SUSPENDED
    ];
    const administrator = school.initialAdministrator;
    const platformStatus = validStatuses.includes(school.platformStatus)
      ? school.platformStatus
      : RECORD_VALUES.statuses.PENDING;
    const registrationPending = platformStatus === RECORD_VALUES.statuses.PENDING;

    const schoolLevels = Array.isArray(school.schoolLevels) && school.schoolLevels.length
      ? school.schoolLevels
      : (school.schoolType === 'k12' ? GRADE_CATALOG.map(level => level.key) : [school.schoolType || 'jhs']);
    const divisions = Object.fromEntries(schoolLevels.map(level => [
      level,
      normalizeDivisionRecord(level, school.divisions?.[level], school)
    ]));

    return {
      ...school,
      schoolYear: school.schoolYear || null,
      schoolYearStartDate: school.schoolYearStartDate || null,
      schoolYearEndDate: school.schoolYearEndDate || null,
      gradesPageEnabled: registrationPending ? false : school.gradesPageEnabled === true,
      narrativeReportsEnabled: registrationPending ? false : school.narrativeReportsEnabled === true,
      journalsEnabled: registrationPending ? false : school.journalsEnabled === true,
      journalSubjectId: school.journalSubjectId || null,
      schoolLevels,
      divisions,
      academicPeriodAudit: Array.isArray(school.academicPeriodAudit)
        ? school.academicPeriodAudit.map(entry => ({ ...entry }))
        : [],
      email: school.email ? String(school.email).trim().toLowerCase() : null,
      notificationEmail: school.notificationEmail
        ? String(school.notificationEmail).trim().toLowerCase()
        : null,
      platformStatus,
      submittedAt: school.submittedAt || null,
      approvedAt: school.approvedAt || null,
      rejectedAt: school.rejectedAt || null,
      rejectionReason: school.rejectionReason
        ? String(school.rejectionReason).trim()
        : null,
      initialAdministrator: administrator
        ? {
          ...administrator,
          schoolEmail: administrator.schoolEmail || administrator.email
            ? String(administrator.schoolEmail || administrator.email).trim().toLowerCase()
            : null
        }
        : null
    };
  }

  function getSchools() {
    const saved = readJson(STORAGE_KEYS.schools, null);
    const schools = Array.isArray(saved) && saved.length ? saved : clone(DEFAULT_SCHOOLS);
    return schools.map(normalizeSchoolRecord);
  }

  function saveSchools(schools) {
    const normalizedSchools = Array.isArray(schools)
      ? schools.map(normalizeSchoolRecord)
      : [];
    writeJson(STORAGE_KEYS.schools, normalizedSchools);
    return normalizedSchools;
  }

  // Replace this localStorage implementation with POST /api/school-registrations.
  async function createSchoolRegistration(registrationData = {}) {
    const school = registrationData.school;
    if (!school?.id) return null;

    const schools = getSchools();
    if (schools.some(record => record.id === school.id)) return null;

    schools.push(school);
    const savedSchools = saveSchools(schools);
    return savedSchools.find(record => record.id === school.id) || null;
  }

  // Replace this local getter with GET /api/school-registrations/:id.
  async function getSchoolRegistration(registrationId) {
    return getSchools().find(school => school.id === registrationId) || null;
  }

  // Replace this localStorage implementation with PATCH /api/schools/:id.
  function updateSchool(schoolId, updates = {}) {
    const schools = getSchools();
    const index = schools.findIndex(school => school.id === schoolId);
    if (index < 0) return null;

    schools[index] = { ...schools[index], ...updates };
    return saveSchools(schools)[index] || null;
  }

  function getActiveSchool() {
    const schools = getSchools();
    const activeId = localStorage.getItem(STORAGE_KEYS.activeSchool) || schools[0]?.id;
    return schools.find(school => school.id === activeId) || schools[0];
  }

  function getActiveSchoolId() {
    return getActiveSchool()?.id || null;
  }

  function getAcademicPeriods(schoolId = getActiveSchoolId(), schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const level = schoolLevel || school?.activeDivision || school?.schoolLevels?.[0];
    return clone(school?.divisions?.[level]?.academicPeriods || []);
  }

  function getCurrentAcademicPeriod(schoolId = getActiveSchoolId(), schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const level = schoolLevel || school?.activeDivision || school?.schoolLevels?.[0];
    const division = school?.divisions?.[level];
    return clone(division?.academicPeriods?.find(period => period.id === division.activeAcademicPeriodId) || null);
  }

  // Replace with GET /api/schools/:schoolId/academic-terms/:schoolLevel.
  async function getAcademicTermConfig(schoolId, schoolLevel) {
    const school = getSchools().find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    if (!school || !division) return null;
    return clone({
      schoolId,
      schoolLevel,
      schoolYear: school.schoolYear,
      schoolYearStartDate: school.schoolYearStartDate,
      schoolYearEndDate: school.schoolYearEndDate,
      gradingPeriodType: division.gradingPeriodType,
      activeAcademicPeriodId: division.activeAcademicPeriodId,
      academicPeriods: division.academicPeriods
    });
  }

  function isValidDateValue(value) {
    const dateValue = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false;
    const date = new Date(`${dateValue}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateValue;
  }

  function validateAcademicTermConfig(values = {}) {
    const errors = [];
    const definition = ACADEMIC_PERIOD_TYPES[values.gradingPeriodType];
    const periods = Array.isArray(values.academicPeriods) ? values.academicPeriods : [];
    const schoolYearStartDate = values.schoolYearStartDate || null;
    const schoolYearEndDate = values.schoolYearEndDate || null;

    const schoolYear = String(values.schoolYear || '').trim();
    const schoolYearMatch = schoolYear.match(/^(\d{4})-(\d{4})$/);
    if (!schoolYear) errors.push('Enter the school year.');
    else if (!schoolYearMatch || Number(schoolYearMatch[2]) !== Number(schoolYearMatch[1]) + 1) {
      errors.push('Use a consecutive school year such as 2026-2027.');
    }
    if (!schoolYearStartDate || !schoolYearEndDate) errors.push('Enter the school-year start and end dates.');
    else if (!isValidDateValue(schoolYearStartDate) || !isValidDateValue(schoolYearEndDate)) errors.push('Enter valid school-year dates.');
    else if (schoolYearEndDate <= schoolYearStartDate) errors.push('The school-year end date must be after its start date.');
    if (!definition) errors.push('Select a valid grading-period structure.');
    if (definition && periods.length !== definition.periodNames.length) {
      errors.push(`${definition.label} requires ${definition.periodNames.length} grading periods.`);
    }

    periods.forEach((period, index) => {
      const name = String(period.name || '').trim() || `Period ${index + 1}`;
      const start = period.plannedStartDate;
      const end = period.plannedEndDate;
      if (!start || !end) errors.push(`Enter both dates for ${name}.`);
      else if (!isValidDateValue(start) || !isValidDateValue(end)) errors.push(`Enter valid dates for ${name}.`);
      else {
        if (end <= start) errors.push(`${name} must end after it starts.`);
        if (schoolYearStartDate && start < schoolYearStartDate) errors.push(`${name} starts before the school year.`);
        if (schoolYearEndDate && end > schoolYearEndDate) errors.push(`${name} ends after the school year.`);
      }
      const previousEnd = periods[index - 1]?.plannedEndDate;
      if (isValidDateValue(start) && isValidDateValue(previousEnd) && start <= previousEnd) errors.push(`${name} overlaps the previous grading period.`);
    });

    return [...new Set(errors)];
  }

  // Replace with PUT /api/schools/:schoolId/academic-terms/:schoolLevel.
  async function saveAcademicTermConfig(schoolId, values = {}) {
    const schools = getSchools();
    const schoolIndex = schools.findIndex(record => record.id === schoolId);
    if (schoolIndex < 0) throw new Error('School not found.');

    const school = schools[schoolIndex];
    const level = values.schoolLevel;
    const division = school.divisions?.[level];
    if (!division) throw new Error('School level not found.');

    const errors = validateAcademicTermConfig(values);
    if (errors.length) throw new Error(errors[0]);

    const divisionHasStarted = division.academicPeriods.some(period => period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING);
    const schoolYearHasStarted = Object.values(school.divisions || {}).some(item =>
      item.academicPeriods?.some(period => period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING)
    );
    if (schoolYearHasStarted && (
      String(values.schoolYear).trim() !== school.schoolYear
      || values.schoolYearStartDate !== school.schoolYearStartDate
      || values.schoolYearEndDate !== school.schoolYearEndDate
    )) {
      throw new Error('The school year cannot change after a grading period has started in any school level.');
    }
    if (divisionHasStarted && values.gradingPeriodType !== division.gradingPeriodType) {
      throw new Error('This school level\'s period structure cannot change after a grading period has started.');
    }

    const definition = getPeriodType(values.gradingPeriodType);
    const sameStructure = values.gradingPeriodType === division.gradingPeriodType;
    const idContext = `${schoolId}-${level}-${String(values.schoolYear).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const periods = definition.periodNames.map((defaultName, index) => {
      const submitted = values.academicPeriods[index] || {};
      const existing = sameStructure ? division.academicPeriods.find(period => period.sequence === index + 1) : null;
      const isLocked = existing && existing.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING;
      return {
        id: existing?.id || `${idContext}-${definition.idPrefix}${index + 1}`,
        name: isLocked ? existing.name : String(submitted.name || defaultName).trim(),
        sequence: index + 1,
        status: existing?.status || ACADEMIC_PERIOD_STATUSES.UPCOMING,
        plannedStartDate: isLocked ? existing.plannedStartDate : submitted.plannedStartDate,
        plannedEndDate: isLocked ? existing.plannedEndDate : submitted.plannedEndDate,
        startedAt: existing?.startedAt || null,
        closedAt: existing?.closedAt || null
      };
    });

    school.schoolYear = String(values.schoolYear).trim();
    school.schoolYearStartDate = values.schoolYearStartDate;
    school.schoolYearEndDate = values.schoolYearEndDate;
    division.gradingPeriodType = values.gradingPeriodType;
    division.academicPeriods = periods;
    division.activeAcademicPeriodId = periods.find(period => period.status === ACADEMIC_PERIOD_STATUSES.ACTIVE)?.id || null;
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, level);
  }

  function addAcademicPeriodAudit(school, schoolLevel, period, action, details = {}) {
    school.academicPeriodAudit ||= [];
    school.academicPeriodAudit.push({
      id: `academic-period-audit-${Date.now()}`,
      schoolId: school.id,
      schoolLevel,
      academicPeriodId: period.id,
      action,
      ...details,
      createdAt: new Date().toISOString()
    });
  }

  // Replace with POST /api/schools/:schoolId/academic-periods/:periodId/start.
  async function startAcademicPeriod(schoolId, schoolLevel, periodId) {
    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    if (!school || !division) throw new Error('Academic-term configuration not found.');
    if (school.platformStatus !== RECORD_VALUES.statuses.ACTIVE) {
      throw new Error('The school registration must be approved before a grading period can start.');
    }
    if (division.activeAcademicPeriodId) throw new Error('Close the active grading period before starting another one.');

    const periods = division.academicPeriods;
    const period = periods.find(item => item.id === periodId);
    const firstUpcoming = periods.find(item => item.status === ACADEMIC_PERIOD_STATUSES.UPCOMING);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.UPCOMING) throw new Error('This grading period cannot be started.');
    if (firstUpcoming?.id !== period.id) throw new Error('Grading periods must be started in order.');
    if (!period.plannedStartDate || !period.plannedEndDate) throw new Error('Complete the grading-period schedule before starting it.');

    period.status = ACADEMIC_PERIOD_STATUSES.ACTIVE;
    period.startedAt = new Date().toISOString();
    division.activeAcademicPeriodId = period.id;
    addAcademicPeriodAudit(school, schoolLevel, period, 'started');
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  // Replace with GET /api/schools/:schoolId/academic-periods/:periodId/close-readiness.
  async function getAcademicPeriodCloseReadiness(schoolId, schoolLevel, periodId) {
    const school = getSchools().find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period) throw new Error('Academic period not found.');

    const sectionIds = new Set((division.sections || []).map(section => section.id));

    const reopenRequests = getReopenRequests({ schoolId, academicPeriodId: periodId })
      .filter(request => sectionIds.has(request.sectionId)
        && request.status === REOPEN_REQUEST_STATUSES.PENDING);
    const grades = readJson(schoolStorageKey(STORAGE_KEYS.grades, schoolId), GRADE_DIRECTORY)
      .filter(record => record.schoolId === schoolId
        && sectionIds.has(record.sectionId)
        && record.academicPeriodId === periodId
        && record.score == null);

    return {
      academicPeriodId: periodId,
      canClose: reopenRequests.length === 0,
      blockingIssues: reopenRequests.length ? [`${reopenRequests.length} reopen request${reopenRequests.length === 1 ? '' : 's'} must be resolved.`] : [],
      warnings: grades.length ? [`${grades.length} grade record${grades.length === 1 ? '' : 's'} still have no final score.`] : []
    };
  }

  // Replace with POST /api/schools/:schoolId/academic-periods/:periodId/close.
  async function closeAcademicPeriod(schoolId, schoolLevel, periodId) {
    const readiness = await getAcademicPeriodCloseReadiness(schoolId, schoolLevel, periodId);
    if (!readiness.canClose) throw new Error(readiness.blockingIssues[0]);

    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) throw new Error('Only the active grading period can be closed.');

    period.status = ACADEMIC_PERIOD_STATUSES.CLOSED;
    period.closedAt = new Date().toISOString();
    division.activeAcademicPeriodId = null;
    addAcademicPeriodAudit(school, schoolLevel, period, 'closed');
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  // Replace with PATCH /api/schools/:schoolId/academic-periods/:periodId/end-date.
  async function extendAcademicPeriod(schoolId, schoolLevel, periodId, values = {}) {
    const schools = getSchools();
    const school = schools.find(record => record.id === schoolId);
    const division = school?.divisions?.[schoolLevel];
    const period = division?.academicPeriods?.find(item => item.id === periodId);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) throw new Error('Only the active grading period can be extended.');

    const newEndDate = values.plannedEndDate;
    const reason = String(values.reason || '').trim();
    const nextPeriod = division.academicPeriods.find(item => item.sequence === period.sequence + 1);
    if (!isValidDateValue(newEndDate)) throw new Error('Choose a valid new end date.');
    if (newEndDate <= period.plannedEndDate) throw new Error('Choose an end date after the current end date.');
    if (school.schoolYearEndDate && newEndDate > school.schoolYearEndDate) throw new Error('The new end date must remain inside the school year.');
    if (nextPeriod?.plannedStartDate && newEndDate >= nextPeriod.plannedStartDate) throw new Error('The extension overlaps the next grading period. Adjust its dates first.');
    if (!reason) throw new Error('Enter a reason for the extension.');

    const previousEndDate = period.plannedEndDate;
    period.plannedEndDate = newEndDate;
    addAcademicPeriodAudit(school, schoolLevel, period, 'extended', { previousEndDate, newEndDate, reason });
    saveSchools(schools);
    return getAcademicTermConfig(schoolId, schoolLevel);
  }

  function getAcademicPeriodReminder(period, date = new Date()) {
    if (!period?.plannedEndDate || period.status !== ACADEMIC_PERIOD_STATUSES.ACTIVE) return null;
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(`${period.plannedEndDate}T00:00:00`);
    const daysRemaining = Math.ceil((end - today) / 86400000);
    if (daysRemaining < 0) return { tone: 'danger', label: 'Review overdue', daysRemaining };
    if (daysRemaining === 0) return { tone: 'warning', label: 'Ends today', daysRemaining };
    if (daysRemaining <= 7) return { tone: 'warning', label: `Ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`, daysRemaining };
    return null;
  }

  function normalizeReopenRequest(record = {}) {
    const requestedAt = record.requestedAt || record.createdAt || null;
    const status = record.status === 'denied' ? REOPEN_REQUEST_STATUSES.REJECTED : record.status;
    return {
      id: String(record.id || ''),
      schoolId: String(record.schoolId || ''),
      teacherId: String(record.teacherId || ''),
      sectionId: String(record.sectionId || ''),
      subjectId: String(record.subjectId || ''),
      academicPeriodId: String(record.academicPeriodId || record.quarter || '').toLowerCase(),
      reason: String(record.reason || '').trim(),
      status: Object.values(REOPEN_REQUEST_STATUSES).includes(status)
        ? status
        : REOPEN_REQUEST_STATUSES.PENDING,
      adminNote: String(record.adminNote || '').trim() || null,
      requestedAt,
      reviewedAt: record.reviewedAt || null,
      reviewedBy: record.reviewedBy || null,
      expiresAt: record.expiresAt || null,
      extendedAt: record.extendedAt || null,
      extendedBy: record.extendedBy || null,
      extensionReason: String(record.extensionReason || '').trim() || null,
      previousExpiresAt: record.previousExpiresAt || null,
      revokedAt: record.revokedAt || null,
      revokedBy: record.revokedBy || null,
      revokeReason: String(record.revokeReason || '').trim() || null
    };
  }

  function reopenRequestStorageKey(schoolId) {
    return `edugnay_reopen_requests:${schoolId}`;
  }

  function getReopenRequests(filters = {}) {
    const schoolId = String(filters.schoolId || getActiveSchoolId());
    return readJson(reopenRequestStorageKey(schoolId), [])
      .map(normalizeReopenRequest)
      .filter(request => request.schoolId === schoolId)
      .filter(request => !filters.teacherId || request.teacherId === String(filters.teacherId))
      .filter(request => !filters.sectionId || request.sectionId === String(filters.sectionId))
      .filter(request => !filters.subjectId || request.subjectId === String(filters.subjectId))
      .filter(request => !filters.academicPeriodId || request.academicPeriodId === String(filters.academicPeriodId))
      .filter(request => !filters.status || request.status === filters.status);
  }

  function saveReopenRequests(schoolId, requests) {
    writeJson(reopenRequestStorageKey(schoolId), requests.map(normalizeReopenRequest));
  }

  function getReopenRequestState(request, now = Date.now()) {
    if (request?.status === REOPEN_REQUEST_STATUSES.APPROVED) {
      const expiresAt = new Date(request.expiresAt || '').getTime();
      return Number.isFinite(expiresAt) && now < expiresAt
        ? REOPEN_REQUEST_STATUSES.APPROVED
        : 'expired';
    }
    return request?.status || null;
  }

  function isReopenRequestActive(request, now = Date.now()) {
    return getReopenRequestState(request, now) === REOPEN_REQUEST_STATUSES.APPROVED;
  }

  function getReopenRequestContext(request) {
    const school = getSchools().find(record => record.id === request.schoolId);
    const section = school && getAssignmentSections(school).find(record => record.id === request.sectionId);
    const period = section && school.divisions?.[section.level]?.academicPeriods
      ?.find(record => record.id === request.academicPeriodId);
    return { school, section, period };
  }

  function isSchoolAdministrator(userId, schoolId) {
    const user = getUserById(userId);
    return user?.schoolId === schoolId && user.role === RECORD_VALUES.roles.SCHOOL_ADMIN;
  }

  // Replace with POST /api/reopen-requests. The backend must derive the
  // teacher from the authenticated session instead of trusting teacherId.
  async function createReopenRequest(values = {}) {
    const request = normalizeReopenRequest({
      id: `reopen-request-${Date.now()}`,
      schoolId: values.schoolId || getActiveSchoolId(),
      teacherId: values.teacherId,
      sectionId: values.sectionId,
      subjectId: values.subjectId,
      academicPeriodId: values.academicPeriodId,
      reason: values.reason,
      status: REOPEN_REQUEST_STATUSES.PENDING,
      requestedAt: new Date().toISOString()
    });

    if (!request.schoolId || !request.teacherId || !request.sectionId || !request.subjectId || !request.academicPeriodId) {
      throw new Error('The teacher, section, subject, and grading period are required.');
    }
    if (!request.reason) throw new Error('Enter a reason for reopening the grading period.');

    const { school, section, period } = getReopenRequestContext(request);
    if (!school || !section || !period) throw new Error('The selected grading period could not be found.');
    if (period.status !== ACADEMIC_PERIOD_STATUSES.CLOSED) {
      throw new Error('Only a closed grading period can be reopened.');
    }

    const teacher = getUserById(request.teacherId);
    const assignedToSubject = ASSIGNMENT_DIRECTORY.some(record =>
      record.schoolId === request.schoolId
      && record.teacherId === request.teacherId
      && record.sectionId === request.sectionId
      && record.subjectId === request.subjectId
    );
    if (!teacher || teacher.schoolId !== request.schoolId || teacher.role !== RECORD_VALUES.roles.TEACHER || !assignedToSubject) {
      throw new Error('Only the assigned teacher can request access for this section and subject.');
    }

    const requests = getReopenRequests({ schoolId: request.schoolId });
    const duplicate = requests.find(record =>
      record.teacherId === request.teacherId
      && record.sectionId === request.sectionId
      && record.subjectId === request.subjectId
      && record.academicPeriodId === request.academicPeriodId
      && (record.status === REOPEN_REQUEST_STATUSES.PENDING || isReopenRequestActive(record))
    );
    if (duplicate) throw new Error('A pending or active reopen request already exists for this grading period.');

    requests.push(request);
    saveReopenRequests(request.schoolId, requests);
    return request;
  }

  // Replace with POST /api/reopen-requests/:id/approve.
  async function approveReopenRequest(requestId, values = {}) {
    const schoolId = String(values.schoolId || getActiveSchoolId());
    const requests = getReopenRequests({ schoolId });
    const request = requests.find(record => record.id === String(requestId));
    if (!request || request.status !== REOPEN_REQUEST_STATUSES.PENDING) {
      throw new Error('This request is no longer awaiting approval.');
    }

    const expiresAt = new Date(values.expiresAt || '').getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('Choose an expiration date and time later than now.');
    }
    const { period } = getReopenRequestContext(request);
    if (!period || period.status !== ACADEMIC_PERIOD_STATUSES.CLOSED) {
      throw new Error('Only a closed grading period can be reopened.');
    }
    if (!isSchoolAdministrator(values.reviewedBy, schoolId)) {
      throw new Error('Only a school administrator from this school can approve the request.');
    }

    request.status = REOPEN_REQUEST_STATUSES.APPROVED;
    request.adminNote = String(values.adminNote || '').trim() || null;
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = String(values.reviewedBy);
    request.expiresAt = new Date(expiresAt).toISOString();
    saveReopenRequests(schoolId, requests);
    return request;
  }

  // Replace with POST /api/reopen-requests/:id/reject.
  async function rejectReopenRequest(requestId, values = {}) {
    const schoolId = String(values.schoolId || getActiveSchoolId());
    const requests = getReopenRequests({ schoolId });
    const request = requests.find(record => record.id === String(requestId));
    if (!request || request.status !== REOPEN_REQUEST_STATUSES.PENDING) {
      throw new Error('This request is no longer awaiting review.');
    }
    if (!isSchoolAdministrator(values.reviewedBy, schoolId)) {
      throw new Error('Only a school administrator from this school can reject the request.');
    }

    request.status = REOPEN_REQUEST_STATUSES.REJECTED;
    request.adminNote = String(values.adminNote || '').trim() || null;
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = String(values.reviewedBy);
    request.expiresAt = null;
    saveReopenRequests(schoolId, requests);
    return request;
  }

  // Replace with PATCH /api/reopen-requests/:id/expiration.
  async function extendReopenRequest(requestId, values = {}) {
    const schoolId = String(values.schoolId || getActiveSchoolId());
    const requests = getReopenRequests({ schoolId });
    const request = requests.find(record => record.id === String(requestId));
    if (!request || !isReopenRequestActive(request)) throw new Error('Only active reopen access can be extended.');

    const expiresAt = new Date(values.expiresAt || '').getTime();
    const currentExpiration = new Date(request.expiresAt).getTime();
    const reason = String(values.reason || '').trim();
    if (!Number.isFinite(expiresAt) || expiresAt <= currentExpiration) {
      throw new Error('Choose a deadline later than the current expiration.');
    }
    if (!reason) throw new Error('Enter a reason for extending access.');
    if (!isSchoolAdministrator(values.extendedBy, schoolId)) {
      throw new Error('Only a school administrator from this school can extend access.');
    }

    request.previousExpiresAt = request.expiresAt;
    request.expiresAt = new Date(expiresAt).toISOString();
    request.extendedAt = new Date().toISOString();
    request.extendedBy = String(values.extendedBy);
    request.extensionReason = reason;
    saveReopenRequests(schoolId, requests);
    return request;
  }

  // Replace with POST /api/reopen-requests/:id/revoke.
  async function revokeReopenRequest(requestId, values = {}) {
    const schoolId = String(values.schoolId || getActiveSchoolId());
    const requests = getReopenRequests({ schoolId });
    const request = requests.find(record => record.id === String(requestId));
    if (!request || !isReopenRequestActive(request)) throw new Error('Only active reopen access can be revoked.');

    const reason = String(values.revokeReason || '').trim();
    if (!reason) throw new Error('Enter a reason for revoking access.');
    if (!isSchoolAdministrator(values.revokedBy, schoolId)) {
      throw new Error('Only a school administrator from this school can revoke access.');
    }

    request.status = REOPEN_REQUEST_STATUSES.REVOKED;
    request.revokedAt = new Date().toISOString();
    request.revokedBy = String(values.revokedBy);
    request.revokeReason = reason;
    saveReopenRequests(schoolId, requests);
    return request;
  }

  function scopeToActiveSchool(records, schoolId = getActiveSchoolId()) {
    return Array.isArray(records)
      ? records.filter(record => record.schoolId === schoolId)
      : [];
  }

  function withActiveSchool(records, ownerSchoolId = 'scc') {
    if (!Array.isArray(records)) return [];
    const ownedRecords = records.map(record => ({
      ...record,
      schoolId: record.schoolId || ownerSchoolId
    }));
    return scopeToActiveSchool(ownedRecords);
  }

  function schoolStorageKey(key, schoolId = getActiveSchoolId()) {
    return `${key}:${schoolId}`;
  }

  function isGradesPageEnabled(school = getActiveSchool()) {
    return Boolean(school?.gradesPageEnabled);
  }

  function isNarrativeReportsEnabled(school = getActiveSchool()) {
    return Boolean(school?.narrativeReportsEnabled);
  }

  function getSubjectAssignments() {
    return SUBJECT_ASSIGNMENTS;
  }

  function saveSubjectAssignments() {
    writeJson(STORAGE_KEYS.subjectAssignments, SUBJECT_ASSIGNMENTS);
  }

  function getConfiguredSubjects(school = getActiveSchool()) {
    return SUBJECT_CATALOG.filter(subject => getSubjectAssignments().some(record =>
      record.schoolId === school?.id &&
      record.subjectId === subject.id &&
      subject.levels?.includes(record.schoolLevel)
    ));
  }

  function getJournalSubject(school = getActiveSchool()) {
    return getConfiguredSubjects(school).find(subject => subject.id === school?.journalSubjectId) || null;
  }

  function isJournalsEnabled(school = getActiveSchool()) {
    return Boolean(school?.journalsEnabled && getJournalSubject(school));
  }

  function getAssignmentSections(school = getActiveSchool()) {
    return (school?.schoolLevels || []).flatMap(level =>
      (school.divisions?.[level]?.sections || []).map(section => ({
        ...section,
        schoolId: school.id,
        level
      }))
    );
  }

  // Replace this local getter with GET /api/sections during backend integration.
  async function getSections() {
    return getAssignmentSections();
  }

  // Replace this localStorage implementation with PATCH /api/sections/:id.
  async function updateSection(sectionId, values = {}) {
    const school = getActiveSchool();
    if (!school?.id || !sectionId) return null;

    const divisions = school.divisions || {};
    let sourceLevel = '';
    let sourceIndex = -1;
    Object.entries(divisions).some(([level, division]) => {
      const index = (division.sections || []).findIndex(section => section.id === String(sectionId));
      if (index < 0) return false;
      sourceLevel = level;
      sourceIndex = index;
      return true;
    });
    if (sourceIndex < 0) return null;

    const name = String(values.name || '').trim();
    const level = String(values.level || '').trim();
    const grade = String(values.grade || '').trim();
    const capacity = Number(values.capacity);
    if (!name || !level || !grade || !Number.isFinite(capacity) || capacity <= 0) return null;

    const sourceDivision = divisions[sourceLevel];
    const currentSection = sourceDivision.sections[sourceIndex];
    const targetDivision = divisions[level] || createDivision(level);
    targetDivision.sections = Array.isArray(targetDivision.sections) ? targetDivision.sections : [];
    const updatedSection = {
      ...currentSection,
      id: currentSection.id,
      schoolId: school.id,
      name,
      level,
      grade,
      strand: level === 'shs' ? String(values.strand || '').trim() || null : null,
      capacity,
      adviserId: values.adviserId ? String(values.adviserId).trim() || null : null
    };

    sourceDivision.sections.splice(sourceIndex, 1);
    if (sourceLevel === level) targetDivision.sections.splice(sourceIndex, 0, updatedSection);
    else targetDivision.sections.push(updatedSection);

    divisions[level] = targetDivision;
    school.schoolLevels = Array.isArray(school.schoolLevels) ? school.schoolLevels : [];
    if (!school.schoolLevels.includes(level)) school.schoolLevels.push(level);
    const savedSchool = updateSchool(school.id, {
      divisions,
      schoolLevels: school.schoolLevels,
      activeDivision: level
    });
    if (!savedSchool) return null;
    return getAssignmentSections(savedSchool).find(section => section.id === updatedSection.id) || null;
  }

  // Replace with GET /api/teacher/sections. The backend must derive the
  // teacher from the authenticated session and apply the same access rules.
  async function getMyTeachingSections() {
    const teacherId = window.EDUGNAY_TEACHER_ACCESS?.teacherId;
    if (!teacherId) return [];

    const sectionIds = new Set(
      ASSIGNMENT_DIRECTORY
        .filter(record => record.schoolId === getActiveSchoolId() && record.teacherId === teacherId)
        .map(record => record.sectionId)
    );

    return getAssignmentSections().filter(section => {
      const isAdviser = section.adviserId === teacherId;
      const isSubjectTeacher = (section.teacherAssignments || [])
        .some(record => record.teacherId === teacherId);
      return isAdviser || isSubjectTeacher || sectionIds.has(section.id);
    });
  }

  function getStoredSfTemplates() {
    const schoolId = getActiveSchoolId();
    const records = readJson(schoolStorageKey(STORAGE_KEYS.sfTemplates, schoolId), []);
    return Array.isArray(records)
      ? records
        .filter(record => record.schoolId === schoolId)
        .map(record => ({
          id: record.id,
          schoolId: record.schoolId,
          formCode: record.formCode,
          formName: record.formName,
          schoolLevel: record.schoolLevel,
          version: record.version,
          fileName: record.fileName || '',
          templateFileKey: record.templateFileKey || '',
          source: record.source || '',
          status: record.status || '',
          mappingStatus: record.mappingStatus || 'unmapped',
          sheets: Array.isArray(record.sheets) ? record.sheets : [],
          updatedAt: record.updatedAt || '',
          updatedBy: record.updatedBy || ''
        }))
      : [];
  }

  // Replace with GET /api/teacher/sf-templates.
  async function getSfTemplates() {
    return getStoredSfTemplates()
      .filter(record => record.source === 'official' && record.status === RECORD_VALUES.statuses.ACTIVE)
      .map(record => ({ ...record }));
  }

  // Replace with GET /api/teacher/sf-templates/:templateId/preview.
  async function getSfTemplatePreview(templateId, sheetName = '') {
    const template = (await getSfTemplates()).find(record => record.id === String(templateId));
    if (!template) throw new Error('The selected template could not be found.');
    const preview = await window.EDUGNAY_SF_WORKBOOK.getStoredTemplatePreview(template.templateFileKey, sheetName);
    return {
      template: { ...template },
      preview
    };
  }

  // Replace with POST /api/teacher/sf-forms/preview. The backend must repeat
  // the section permission check before returning school or learner records.
  async function generateSfForm(values = {}) {
    const template = (await getSfTemplates()).find(record => record.id === String(values.templateId));
    if (!template || template.status !== RECORD_VALUES.statuses.ACTIVE || template.mappingStatus !== 'ready') {
      throw new Error('Select an active template with a verified mapping.');
    }

    const section = (await getMyTeachingSections()).find(record => record.id === String(values.sectionId));
    if (!section) throw new Error('You do not have access to the selected class.');

    const schoolYear = String(values.schoolYear || '').trim();
    const academicPeriodId = String(values.academicPeriodId || '').trim();
    if (!schoolYear || !academicPeriodId) throw new Error('Select a school year and academic period.');

    const school = getActiveSchool();
    const teacher = getUserById(window.EDUGNAY_TEACHER_ACCESS?.teacherId);
    if (!school || !teacher) throw new Error('The school or teacher account could not be found.');
    const students = getStudents().filter(student => student.schoolId === school.id && student.sectionId === section.id);
    const context = {
      school,
      section,
      teacher,
      schoolYear,
      academicPeriodId,
      students,
      attendance: getAttendanceRecords({ sectionId: section.id }),
      grades: students.flatMap(student => getGradesForStudent(student.id, schoolYear))
        .filter(grade => grade.academicPeriodId === academicPeriodId)
    };

    const generated = await window.EDUGNAY_SF_WORKBOOK.generateWorkbook(template.templateFileKey, template, context);
    const fileName = `${template.formCode}_${section.grade}-${section.name}_${schoolYear}.xlsx`
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, '-');
    return {
      templateId: template.id,
      sectionId: section.id,
      schoolYear,
      academicPeriodId,
      fileName,
      ...generated
    };
  }

  function assignmentWithLabels(record, studentId = null) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    const statusRecord = studentId == null
      ? null
      : ASSIGNMENT_STATUS_RECORDS.find(item =>
        item.assignmentId === record.id && item.studentId === String(studentId)
      );
    return {
      ...record,
      subject: subject?.name || '',
      subjectName: subject?.name || '',
      teacher: teacher?.displayName || '',
      status: statusRecord?.status || 'pending'
    };
  }

  function getAssignments() {
    return ASSIGNMENT_DIRECTORY;
  }

  function getAssignmentsForSection(sectionId) {
    return ASSIGNMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId() && record.sectionId === String(sectionId))
      .map(record => assignmentWithLabels(record));
  }

  function getAssignmentsForStudent(studentId) {
    const student = getUserById(studentId);
    if (!student || student.role !== RECORD_VALUES.roles.STUDENT) return [];
    return ASSIGNMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId() && record.sectionId === student.sectionId)
      .map(record => assignmentWithLabels(record, student.id));
  }

  function saveAssignments(records = ASSIGNMENT_DIRECTORY) {
    const values = Array.isArray(records) ? records : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.assignments), values);
  }

  function createAssignment(values = {}) {
    const categoryId = String(values.categoryId || '').trim().toLowerCase() || null;
    const maxScore = Number(values.maxScore);
    const assignment = {
      id: String(values.id || `assignment-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      sectionId: values.sectionId || null,
      subjectId: values.subjectId || null,
      teacherId: values.teacherId || null,
      academicPeriodId: values.academicPeriodId || null,
      title: String(values.title || '').trim(),
      instructions: String(values.instructions || '').trim() || null,
      assignedDate: values.assignedDate || values.dueDate || null,
      dueDate: values.dueDate || null,
      onlineSubmissionEnabled: values.onlineSubmissionEnabled === true,
      categoryId: categoryId && maxScore > 0 ? categoryId : null,
      maxScore: categoryId && maxScore > 0 ? maxScore : null
    };
    ASSIGNMENT_DIRECTORY.push(assignment);
    saveAssignments();
    return assignment;
  }

  function updateAssignment(assignmentId, values = {}) {
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === String(assignmentId) && record.schoolId === getActiveSchoolId()
    );
    if (!assignment) return null;

    let nextCategoryId = assignment.categoryId;
    let nextMaxScore = assignment.maxScore;
    if (values.categoryId !== undefined || values.maxScore !== undefined) {
      const categoryValue = values.categoryId !== undefined ? values.categoryId : assignment.categoryId;
      const maxScoreValue = values.maxScore !== undefined ? values.maxScore : assignment.maxScore;
      const categoryId = String(categoryValue || '').trim().toLowerCase() || null;
      const maxScore = Number(maxScoreValue);
      const gradingRemoved = !categoryId || !(maxScore > 0);

      if (!gradingRemoved) {
        const highestScore = ASSIGNMENT_SCORE_RECORDS
          .filter(record =>
            record.schoolId === getActiveSchoolId() &&
            record.assignmentId === assignment.id &&
            record.score !== null
          )
          .reduce((highest, record) => Math.max(highest, Number(record.score) || 0), 0);
        if (maxScore < highestScore) return null;
      }

      nextCategoryId = gradingRemoved ? null : categoryId;
      nextMaxScore = gradingRemoved ? null : maxScore;
    }

    if (values.title !== undefined) {
      assignment.title = String(values.title || '').trim();
    }

    if (values.instructions !== undefined) {
      assignment.instructions = String(values.instructions || '').trim() || null;
    }

    if (values.dueDate !== undefined) {
      assignment.dueDate = values.dueDate ? String(values.dueDate) : null;
    }

    if (values.onlineSubmissionEnabled !== undefined) {
      assignment.onlineSubmissionEnabled = values.onlineSubmissionEnabled === true;
    }

    if (values.academicPeriodId !== undefined) {
      assignment.academicPeriodId = values.academicPeriodId || null;
    }

    if (values.categoryId !== undefined || values.maxScore !== undefined) {
      assignment.categoryId = nextCategoryId;
      assignment.maxScore = nextMaxScore;
    }

    saveAssignments();
    return assignment;
  }

  function getAssignmentStatuses(assignmentId = null) {
    return ASSIGNMENT_STATUS_RECORDS.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!assignmentId || record.assignmentId === String(assignmentId))
    );
  }

  function saveAssignmentStatuses() {
    writeJson(schoolStorageKey(STORAGE_KEYS.assignmentStatuses), ASSIGNMENT_STATUS_RECORDS);
  }

  function setAssignmentStatus(assignmentId, studentId, status) {
    const validStatuses = ['pending', 'submitted', 'not_submitted'];
    const schoolId = getActiveSchoolId();
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === String(assignmentId) && record.schoolId === schoolId
    );
    const student = getUserById(studentId);
    if (!assignment || !student || student.schoolId !== schoolId || !validStatuses.includes(status)) return null;

    let record = ASSIGNMENT_STATUS_RECORDS.find(item =>
      item.assignmentId === String(assignmentId) && item.studentId === String(studentId)
    );
    if (record) {
      record.status = status;
      record.updatedAt = new Date().toISOString();
    } else {
      record = {
        id: `assignment-status-${assignmentId}-${studentId}`,
        schoolId,
        assignmentId: String(assignmentId),
        studentId: String(studentId),
        status,
        updatedAt: new Date().toISOString()
      };
      ASSIGNMENT_STATUS_RECORDS.push(record);
    }
    saveAssignmentStatuses();
    return record;
  }

  function getAssignmentScores(filters = {}) {
    const schoolId = filters.schoolId || getActiveSchoolId();
    return ASSIGNMENT_SCORE_RECORDS.filter(record =>
      record.schoolId === schoolId &&
      (!filters.assignmentId || record.assignmentId === String(filters.assignmentId)) &&
      (!filters.studentId || record.studentId === String(filters.studentId))
    );
  }

  function saveAssignmentScores() {
    writeJson(schoolStorageKey(STORAGE_KEYS.assignmentScores), ASSIGNMENT_SCORE_RECORDS);
  }

  function setAssignmentScore(assignmentId, studentId, score) {
    const schoolId = getActiveSchoolId();
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === String(assignmentId) && record.schoolId === schoolId
    );
    const student = getUserById(studentId);
    const scoreValue = score === '' || score === null ? null : Number(score);

    if (
      !assignment ||
      !student ||
      student.role !== RECORD_VALUES.roles.STUDENT ||
      student.schoolId !== schoolId ||
      student.sectionId !== assignment.sectionId ||
      !assignment.categoryId ||
      !(Number(assignment.maxScore) > 0) ||
      (scoreValue !== null && (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > Number(assignment.maxScore)))
    ) return null;

    let record = ASSIGNMENT_SCORE_RECORDS.find(item =>
      item.schoolId === schoolId &&
      item.assignmentId === assignment.id &&
      item.studentId === String(studentId)
    );
    if (!record && scoreValue === null) return null;
    const updatedAt = new Date().toISOString();

    if (record) {
      record.score = scoreValue;
      record.updatedAt = updatedAt;
    } else {
      record = {
        id: `assignment-score-${assignment.id}-${studentId}`,
        schoolId,
        assignmentId: assignment.id,
        studentId: String(studentId),
        score: scoreValue,
        updatedAt
      };
      ASSIGNMENT_SCORE_RECORDS.push(record);
    }

    saveAssignmentScores();
    return record;
  }

  function learningMaterialWithLabels(record) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    return {
      ...record,
      subjectName: subject?.name || '',
      teacherName: teacher?.displayName || ''
    };
  }

  function getLearningMaterials(filters = {}) {
    return LEARNING_MATERIAL_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId())
      .filter(record => !filters.sectionId || record.sectionId === String(filters.sectionId))
      .filter(record => !filters.subjectId || record.subjectId === String(filters.subjectId))
      .filter(record => !filters.teacherId || record.teacherId === String(filters.teacherId))
      .filter(record => !filters.status || record.status === String(filters.status))
      .filter(record => filters.visibleToStudents === undefined || record.visibleToStudents === Boolean(filters.visibleToStudents))
      .map(learningMaterialWithLabels);
  }

  function getLearningMaterialsForSection(sectionId, subjectId = null) {
    return getLearningMaterials({ sectionId, ...(subjectId ? { subjectId } : {}) });
  }

  function getLearningMaterialsForStudent(studentId, subjectId = null) {
    const student = getUserById(studentId);
    if (!student || student.role !== RECORD_VALUES.roles.STUDENT || !student.sectionId) return [];
    return getLearningMaterials({
      sectionId: student.sectionId,
      ...(subjectId ? { subjectId } : {}),
      status: 'published',
      visibleToStudents: true
    });
  }

  function saveLearningMaterials(records = LEARNING_MATERIAL_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.materials), Array.isArray(records) ? records : []);
  }

  function createLearningMaterial(values = {}) {
    const material = {
      id: String(values.id || `material-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      sectionId: values.sectionId ? String(values.sectionId) : null,
      subjectId: values.subjectId ? String(values.subjectId) : null,
      teacherId: values.teacherId ? String(values.teacherId) : null,
      title: String(values.title || '').trim(),
      description: values.description ? String(values.description).trim() : null,
      type: String(values.type || 'file'),
      schoolYear: values.schoolYear || '2025-2026',
      academicPeriodId: values.academicPeriodId || null,
      postedAt: values.postedAt || null,
      fileSize: values.fileSize || null,
      fileUrl: values.fileUrl || null,
      status: values.status || 'draft',
      visibleToStudents: values.visibleToStudents === true,
      views: Number(values.views) || 0
    };
    LEARNING_MATERIAL_DIRECTORY.push(material);
    saveLearningMaterials();
    return material;
  }

  function getUserTodos(userId, schoolId = getActiveSchoolId()) {
    return USER_TODOS.filter(todo =>
      todo.schoolId === schoolId &&
      todo.userId === String(userId)
    );
  }

  function saveTodos() {
    writeJson(STORAGE_KEYS.todos, USER_TODOS);
  }

  function createTodo(values = {}) {
    const createdAt = values.createdAt || new Date().toISOString();
    const status = values.status === 'completed' ? 'completed' : 'pending';
    const schoolId = values.schoolId === null
      ? null
      : (values.schoolId || getActiveSchoolId());
    const todo = {
      id: String(values.id || `todo-${Date.now()}`),
      schoolId,
      userId: values.userId ? String(values.userId) : null,
      title: String(values.title || '').trim(),
      dueDate: values.dueDate || null,
      status,
      createdAt,
      updatedAt: values.updatedAt || createdAt,
      completedAt: status === 'completed' ? (values.completedAt || createdAt) : null
    };
    USER_TODOS.push(todo);
    saveTodos();
    return todo;
  }

  function updateTodo(todoId, values = {}, schoolId = getActiveSchoolId()) {
    const todo = USER_TODOS.find(item =>
      item.id === String(todoId) && item.schoolId === schoolId
    );
    if (!todo) return null;

    if (values.title !== undefined) todo.title = String(values.title).trim();
    if (values.dueDate !== undefined) todo.dueDate = values.dueDate || null;
    if (values.status !== undefined) {
      todo.status = values.status === 'completed' ? 'completed' : 'pending';
    }
    todo.updatedAt = new Date().toISOString();
    todo.completedAt = todo.status === 'completed'
      ? (values.completedAt || todo.completedAt || todo.updatedAt)
      : null;

    saveTodos();
    return todo;
  }

  function deleteTodo(todoId, schoolId = getActiveSchoolId()) {
    const index = USER_TODOS.findIndex(todo =>
      todo.id === String(todoId) && todo.schoolId === schoolId
    );
    if (index < 0) return null;
    const [todo] = USER_TODOS.splice(index, 1);
    saveTodos();
    return todo;
  }

  function gradeWithLabels(record) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    return {
      ...record,
      name: subject?.name || record.subjectName || '',
      teacher: teacher?.displayName || ''
    };
  }

  function getGradesForStudent(studentId, schoolYear = null) {
    const student = getUserById(studentId);
    if (!student || student.role !== RECORD_VALUES.roles.STUDENT) return [];

    const configuredPeriods = getAcademicPeriods(student.schoolId || getActiveSchoolId(), student.schoolLevel);
    const periods = configuredPeriods.map(period => ({
      id: period.id,
      label: period.name,
      status: period.status === ACADEMIC_PERIOD_STATUSES.CLOSED ? 'final' : period.status,
      subjects: []
    }));

    GRADE_DIRECTORY
      .filter(record => record.schoolId === student.schoolId)
      .filter(record => record.studentId === student.id)
      .filter(record => !schoolYear || record.schoolYear === schoolYear)
      .forEach(record => {
        const period = periods.find(item => item.id === record.academicPeriodId);
        if (!period) return;
        period.status = record.academicPeriodStatus || 'final';
        period.subjects.push(gradeWithLabels(record));
      });

    return periods;
  }

  const ANNOUNCEMENT_AUDIENCE_META = {
    all: { label: 'All Users', className: 'aud-all', icon: 'users' },
    teachers: { label: 'Teachers', className: 'aud-teacher', icon: 'book-open' },
    students: { label: 'Students', className: 'aud-student', icon: 'graduation-cap' },
    parents: { label: 'Parents', className: 'aud-parent', icon: 'heart-handshake' }
  };

  function formatAnnouncementTime(createdAt) {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function announcementView(record) {
    const audienceKeys = Array.isArray(record.audience) ? record.audience : ['all'];
    const primaryAudience = audienceKeys.includes('all') ? 'all' : audienceKeys[0];
    const audienceMeta = ANNOUNCEMENT_AUDIENCE_META[primaryAudience] || ANNOUNCEMENT_AUDIENCE_META.all;
    return {
      ...record,
      audienceKeys,
      audienceKey: audienceKeys.join('-'),
      audience: audienceKeys.map(key => ANNOUNCEMENT_AUDIENCE_META[key]?.label || key).join(' & '),
      audienceClass: audienceMeta.className,
      audienceIcon: audienceMeta.icon,
      author: record.authorName || record.author || '',
      time: record.time || formatAnnouncementTime(record.createdAt),
      tagClass: record.tagClass || (record.priority === 'high' ? 'badge-red' : record.priority === 'event' ? 'badge-gold' : 'badge-blue'),
      status: record.status === 'draft' ? 'Draft' : 'Active',
      draft: record.status === 'draft',
      seen: record.seenCount ? `Seen by ${record.seenCount} users` : (record.status === 'draft' ? 'Not yet published' : 'Not yet viewed')
    };
  }

  function getAnnouncements(audience) {
    const key = String(audience || '').toLowerCase();
    const schoolId = getActiveSchoolId();
    const records = ANNOUNCEMENT_DIRECTORY
      .filter(record => record.schoolId === schoolId && record.status !== 'draft');
    const noClassDay = getNoClassDay();

    if (noClassDay) {
      records.push({
        id: `calendar-${noClassDay.id}`,
        schoolId,
        title: noClassDay.title || 'No classes today',
        body: noClassDay.detail || 'Classes are suspended today.',
        priority: 'event',
        audience: ['all'],
        authorId: null,
        authorName: 'School calendar',
        createdAt: new Date(`${noClassDay.date}T00:00:00`).toISOString(),
        status: 'published',
        pinned: false,
        icon: 'calendar-off',
        iconClass: 'icon-event',
        tag: 'Calendar',
        read: false,
        seenCount: 0,
        imageUrl: null,
        access: null
      });
    }

    return records
      .filter(record => !key || (Array.isArray(record.audience) && (record.audience.includes('all') || record.audience.includes(key))))
      .map(announcementView);
  }

  function getAllAnnouncements() {
    return ANNOUNCEMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId())
      .map(announcementView);
  }

  function saveAnnouncements(records = ANNOUNCEMENT_DIRECTORY) {
    const values = Array.isArray(records) ? records : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.announcements), values);
  }

  function createAnnouncement(values = {}) {
    const audiences = Array.isArray(values.audience)
      ? values.audience
      : [values.audience || 'all'];
    const announcement = {
      id: String(values.id || `announcement-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      title: String(values.title || '').trim(),
      body: String(values.body || values.content || '').trim(),
      priority: values.priority || 'normal',
      audience: audiences,
      authorId: values.authorId || null,
      authorName: values.authorName || '',
      createdAt: values.createdAt || new Date().toISOString(),
      status: values.status || 'published',
      pinned: Boolean(values.pinned),
      icon: values.icon || 'megaphone',
      iconClass: values.iconClass || 'icon-normal',
      tag: values.tag || 'Normal',
      read: false,
      seenCount: 0,
      imageUrl: values.imageUrl || null,
      access: values.access || null
    };
    ANNOUNCEMENT_DIRECTORY.push(announcement);
    saveAnnouncements();
    return announcement;
  }

  function updateAnnouncement(announcementId, values = {}) {
    const announcement = ANNOUNCEMENT_DIRECTORY.find(record => record.id === String(announcementId));
    if (!announcement) return null;
    Object.assign(announcement, values);
    saveAnnouncements();
    return announcement;
  }

  function deleteAnnouncement(announcementId) {
    const index = ANNOUNCEMENT_DIRECTORY.findIndex(record => record.id === String(announcementId));
    if (index < 0) return null;
    const [announcement] = ANNOUNCEMENT_DIRECTORY.splice(index, 1);
    saveAnnouncements();
    return announcement;
  }

  // One direct user source for every school administrator, teacher, student, and parent.
  // Replace this local array with the users API response during backend integration.
  const DEFAULT_USERS = [
    { id: "admin-1", schoolId: "scc", role: "school_admin", email: "admin.adm@stcolumban.edu.ph", status: "active", createdAt: "2025-01-06T00:00:00.000Z", honorific: null, firstName: "Sr.", lastName: "Admin", displayName: "Sr. Admin", initials: "SA", employeeNo: "ADM-2016-0001", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-2", schoolId: "scc", role: "teacher", email: "m.reyes.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Maria", lastName: "Reyes", displayName: "Ms. Maria Reyes", initials: "MR", employeeNo: "FAC-2019-0042", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-3", schoolId: "scc", role: "teacher", email: "p.tan.fac@stcolumban.edu.ph", status: "active", createdAt: "2025-05-20T00:00:00.000Z", honorific: "Mr.", firstName: "Paolo", lastName: "Tan", displayName: "Mr. Paolo Tan", initials: "PT", employeeNo: "FAC-2021-0017", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-carla-dizon", schoolId: "scc", role: "teacher", email: "c.dizon.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Carla", lastName: "Dizon", displayName: "Ms. Carla Dizon", initials: "CD", employeeNo: "FAC-2020-0028", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-rico-santos", schoolId: "scc", role: "teacher", email: "r.santos.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Mr.", firstName: "Rico", lastName: "Santos", displayName: "Mr. Rico Santos", initials: "RS", employeeNo: "FAC-2019-0064", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-jana-mendez", schoolId: "scc", role: "teacher", email: "j.mendez.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Jana", lastName: "Mendez", displayName: "Ms. Jana Mendez", initials: "JM", employeeNo: "FAC-2022-0013", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-ana-garcia", schoolId: "scc", role: "teacher", email: "a.garcia.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Ana", lastName: "Garcia", displayName: "Ms. Ana Garcia", initials: "AG", employeeNo: "FAC-2021-0049", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-7", schoolId: "scc", role: "parent", email: "r.lim.parents@stcolumban.edu.ph", status: "active", createdAt: "2024-06-05T00:00:00.000Z", honorific: null, firstName: "Rosa", lastName: "Lim", displayName: "Rosa Lim", initials: "RL", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "parent-8", schoolId: "scc", role: "parent", email: "e.cruz.parents@stcolumban.edu.ph", status: "inactive", createdAt: "2025-05-24T00:00:00.000Z", honorific: null, firstName: "Elena", lastName: "Cruz", displayName: "Elena Cruz", initials: "EC", employeeNo: null, lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "teacher-9", schoolId: "scc", role: "teacher", email: "l.villanueva.fac@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: "Ms.", firstName: "Lara", lastName: "Villanueva", displayName: "Ms. Lara Villanueva", initials: "LV", employeeNo: "FAC-2018-0031", lrn: null, schoolLevel: null, gradeLevel: null, strand: null, sectionId: null },
    { id: "cm-001", schoolId: "scc", role: "student", email: "c.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Carlo", lastName: "Mendoza", displayName: "Carlo Mendoza", initials: "CM", employeeNo: null, lrn: "100201000003", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "lr-002", schoolId: "scc", role: "student", email: "l.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liza", lastName: "Reyes", displayName: "Liza Reyes", initials: "LR", employeeNo: null, lrn: "100201000004", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "rc-003", schoolId: "scc", role: "student", email: "r.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rico", lastName: "Cruz", displayName: "Rico Cruz", initials: "RC", employeeNo: null, lrn: "100201000005", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "jd-004", schoolId: "scc", role: "student", email: "j.delacruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Juan", lastName: "Dela Cruz", displayName: "Juan Dela Cruz", initials: "JC", employeeNo: null, lrn: "100201000001", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "et-005", schoolId: "scc", role: "student", email: "e.tan.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ella", lastName: "Tan", displayName: "Ella Tan", initials: "ET", employeeNo: null, lrn: "100201000006", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ml-006", schoolId: "scc", role: "student", email: "m.lopez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maria", lastName: "Lopez", displayName: "Maria Lopez", initials: "ML", employeeNo: null, lrn: "100201000007", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "bg-007", schoolId: "scc", role: "student", email: "b.garcia.stud@stcolumban.edu.ph", status: "inactive", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Ben", lastName: "Garcia", displayName: "Ben Garcia", initials: "BG", employeeNo: null, lrn: "100201000008", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "as-008", schoolId: "scc", role: "student", email: "a.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-05-26T00:00:00.000Z", honorific: null, firstName: "Ana", lastName: "Santos", displayName: "Ana Santos", initials: "AS", employeeNo: null, lrn: "100201000009", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ks-009", schoolId: "scc", role: "student", email: "k.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Karl", lastName: "Santiago", displayName: "Karl Santiago", initials: "KS", employeeNo: null, lrn: "100201000010", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "pn-010", schoolId: "scc", role: "student", email: "p.nieves.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paula", lastName: "Nieves", displayName: "Paula Nieves", initials: "PN", employeeNo: null, lrn: "100201000011", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "do-011", schoolId: "scc", role: "student", email: "d.ocampo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Dan", lastName: "Ocampo", displayName: "Dan Ocampo", initials: "DO", employeeNo: null, lrn: "100201000012", schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "mt-012", schoolId: "scc", role: "student", email: "m.torres.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maya", lastName: "Torres", displayName: "Maya Torres", initials: "MT", employeeNo: null, lrn: "100201000002", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "sc-013", schoolId: "scc", role: "student", email: "s.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Sofia", lastName: "Cruz", displayName: "Sofia Cruz", initials: "SC", employeeNo: null, lrn: "100201000013", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "gb-014", schoolId: "scc", role: "student", email: "g.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Gabriel", lastName: "Bautista", displayName: "Gabriel Bautista", initials: "GB", employeeNo: null, lrn: "100201000014", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "na-015", schoolId: "scc", role: "student", email: "n.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nicole", lastName: "Aquino", displayName: "Nicole Aquino", initials: "NA", employeeNo: null, lrn: "100201000015", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "pr-016", schoolId: "scc", role: "student", email: "p.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paolo", lastName: "Rivera", displayName: "Paolo Rivera", initials: "PR", employeeNo: null, lrn: "100201000016", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "av-017", schoolId: "scc", role: "student", email: "a.villanueva.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Aira", lastName: "Villanueva", displayName: "Aira Villanueva", initials: "AV", employeeNo: null, lrn: "100201000017", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "ld-018", schoolId: "scc", role: "student", email: "l.dizon.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lucas", lastName: "Dizon", displayName: "Lucas Dizon", initials: "LD", employeeNo: null, lrn: "100201000018", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "br-019", schoolId: "scc", role: "student", email: "b.ramos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Beatrice", lastName: "Ramos", displayName: "Beatrice Ramos", initials: "BR", employeeNo: null, lrn: "100201000019", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "mg-020", schoolId: "scc", role: "student", email: "m.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Miguel", lastName: "Garcia", displayName: "Miguel Garcia", initials: "MG", employeeNo: null, lrn: "100201000020", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ac-021", schoolId: "scc", role: "student", email: "a.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Andrea", lastName: "Castillo", displayName: "Andrea Castillo", initials: "AC", employeeNo: null, lrn: "100201000021", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "eb-022", schoolId: "scc", role: "student", email: "e.bernardo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Bernardo", displayName: "Ethan Bernardo", initials: "EB", employeeNo: null, lrn: "100201000022", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ch-023", schoolId: "scc", role: "student", email: "c.hernandez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Hernandez", displayName: "Chloe Hernandez", initials: "CH", employeeNo: null, lrn: "100201000023", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "nr-024", schoolId: "scc", role: "student", email: "n.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nathan", lastName: "Reyes", displayName: "Nathan Reyes", initials: "NR", employeeNo: null, lrn: "100201000024", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "is-025", schoolId: "scc", role: "student", email: "i.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Isabella", lastName: "Santos", displayName: "Isabella Santos", initials: "IS", employeeNo: null, lrn: "100201000025", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "lm-026", schoolId: "scc", role: "student", email: "l.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liam", lastName: "Mercado", displayName: "Liam Mercado", initials: "LM", employeeNo: null, lrn: "100201000026", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "gr-027", schoolId: "scc", role: "student", email: "g.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Grace", lastName: "Rivera", displayName: "Grace Rivera", initials: "GR", employeeNo: null, lrn: "100201000027", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ds-028", schoolId: "scc", role: "student", email: "d.salazar.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Salazar", displayName: "Daniel Salazar", initials: "DS", employeeNo: null, lrn: "100201000028", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "cb-029", schoolId: "scc", role: "student", email: "c.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Camille", lastName: "Bautista", displayName: "Camille Bautista", initials: "CB", employeeNo: null, lrn: "100201000029", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "jr-030", schoolId: "scc", role: "student", email: "j.ramos2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Joshua", lastName: "Ramos", displayName: "Joshua Ramos", initials: "JR", employeeNo: null, lrn: "100201000030", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "rr-031", schoolId: "scc", role: "student", email: "r.robles.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Reina", lastName: "Robles", displayName: "Reina Robles", initials: "RR", employeeNo: null, lrn: "100201000031", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "mp-032", schoolId: "scc", role: "student", email: "m.perez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Marcus", lastName: "Perez", displayName: "Marcus Perez", initials: "MP", employeeNo: null, lrn: "100201000032", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "al-033", schoolId: "scc", role: "student", email: "a.lim.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Alyssa", lastName: "Lim", displayName: "Alyssa Lim", initials: "AL", employeeNo: null, lrn: "100201000033", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "ad-034", schoolId: "scc", role: "student", email: "a.domingo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Adrian", lastName: "Domingo", displayName: "Adrian Domingo", initials: "AD", employeeNo: null, lrn: "100201000034", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "td-035", schoolId: "scc", role: "student", email: "t.david.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Trisha", lastName: "David", displayName: "Trisha David", initials: "TD", employeeNo: null, lrn: "100201000035", schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "vp-036", schoolId: "scc", role: "student", email: "v.padilla.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Vincent", lastName: "Padilla", displayName: "Vincent Padilla", initials: "VP", employeeNo: null, lrn: "100201000036", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "hc-037", schoolId: "scc", role: "student", email: "h.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Helena", lastName: "Cruz", displayName: "Helena Cruz", initials: "HC", employeeNo: null, lrn: "100201000037", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "sa-038", schoolId: "scc", role: "student", email: "s.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Samuel", lastName: "Aquino", displayName: "Samuel Aquino", initials: "SA", employeeNo: null, lrn: "100201000038", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "pm-039", schoolId: "scc", role: "student", email: "p.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Patricia", lastName: "Mendoza", displayName: "Patricia Mendoza", initials: "PM", employeeNo: null, lrn: "100201000039", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ov-040", schoolId: "scc", role: "student", email: "o.valdez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Oliver", lastName: "Valdez", displayName: "Oliver Valdez", initials: "OV", employeeNo: null, lrn: "100201000040", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "bb-041", schoolId: "scc", role: "student", email: "b.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bianca", lastName: "Bautista", displayName: "Bianca Bautista", initials: "BB", employeeNo: null, lrn: "100201000041", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "mm-042", schoolId: "scc", role: "student", email: "m.morales.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Matteo", lastName: "Morales", displayName: "Matteo Morales", initials: "MM", employeeNo: null, lrn: "100201000042", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "cc-043", schoolId: "scc", role: "student", email: "c.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Clarisse", lastName: "Castillo", displayName: "Clarisse Castillo", initials: "CC", employeeNo: null, lrn: "100201000043", schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "em-044", schoolId: "scc", role: "student", email: "e.manalo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Elijah", lastName: "Manalo", displayName: "Elijah Manalo", initials: "EM", employeeNo: null, lrn: "100201000044", schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "rs-045", schoolId: "scc", role: "student", email: "r.soriano.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rina", lastName: "Soriano", displayName: "Rina Soriano", initials: "RS", employeeNo: null, lrn: "100201000045", schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "ja-046", schoolId: "scc", role: "student", email: "j.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Janelle", lastName: "Aquino", displayName: "Janelle Aquino", initials: "JA", employeeNo: null, lrn: "100201000046", schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "cp-047", schoolId: "scc", role: "student", email: "c.pascual.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Caleb", lastName: "Pascual", displayName: "Caleb Pascual", initials: "CP", employeeNo: null, lrn: "100201000047", schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "ls-048", schoolId: "scc", role: "student", email: "l.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lara", lastName: "Santiago", displayName: "Lara Santiago", initials: "LS", employeeNo: null, lrn: "100201000048", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "km-049", schoolId: "scc", role: "student", email: "k.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Kyle", lastName: "Mendoza", displayName: "Kyle Mendoza", initials: "KM", employeeNo: null, lrn: "100201000049", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "hc-050", schoolId: "scc", role: "student", email: "h.cabrera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Hannah", lastName: "Cabrera", displayName: "Hannah Cabrera", initials: "HC", employeeNo: null, lrn: "100201000050", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "dv-051", schoolId: "scc", role: "student", email: "d.villarama.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Diego", lastName: "Villarama", displayName: "Diego Villarama", initials: "DV", employeeNo: null, lrn: "100201000051", schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "ab-052", schoolId: "scc", role: "student", email: "a.bautista2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Amara", lastName: "Bautista", displayName: "Amara Bautista", initials: "AB", employeeNo: null, lrn: "100201000052", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "rg-053", schoolId: "scc", role: "student", email: "r.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rafael", lastName: "Garcia", displayName: "Rafael Garcia", initials: "RG", employeeNo: null, lrn: "100201000053", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "tm-054", schoolId: "scc", role: "student", email: "t.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Talia", lastName: "Mercado", displayName: "Talia Mercado", initials: "TM", employeeNo: null, lrn: "100201000054", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "jn-055", schoolId: "scc", role: "student", email: "j.navarro.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Jonas", lastName: "Navarro", displayName: "Jonas Navarro", initials: "JN", employeeNo: null, lrn: "100201000055", schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "ar-056", schoolId: "scc", role: "student", email: "a.ramos.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Arielle", lastName: "Ramos", displayName: "Arielle Ramos", initials: "AR", employeeNo: null, lrn: "100201000056", schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "dm-057", schoolId: "scc", role: "student", email: "d.morales.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Morales", displayName: "Daniel Morales", initials: "DM", employeeNo: null, lrn: "100201000057", schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "cv-058", schoolId: "scc", role: "student", email: "c.villanueva.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Villanueva", displayName: "Chloe Villanueva", initials: "CV", employeeNo: null, lrn: "100201000058", schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "er-059", schoolId: "scc", role: "student", email: "e.reyes.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Reyes", displayName: "Ethan Reyes", initials: "ER", employeeNo: null, lrn: "100201000059", schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "bs-060", schoolId: "scc", role: "student", email: "b.santos.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bea", lastName: "Santos", displayName: "Bea Santos", initials: "BS", employeeNo: null, lrn: "100201000060", schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "lc-061", schoolId: "scc", role: "student", email: "l.cruz.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lorenzo", lastName: "Cruz", displayName: "Lorenzo Cruz", initials: "LC", employeeNo: null, lrn: "100201000061", schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "fg-062", schoolId: "scc", role: "student", email: "f.garcia.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Faith", lastName: "Garcia", displayName: "Faith Garcia", initials: "FG", employeeNo: null, lrn: "100201000062", schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "nb-063", schoolId: "scc", role: "student", email: "n.bautista.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Noah", lastName: "Bautista", displayName: "Noah Bautista", initials: "NB", employeeNo: null, lrn: "100201000063", schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "im-064", schoolId: "scc", role: "student", email: "i.mercado.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ivy", lastName: "Mercado", displayName: "Ivy Mercado", initials: "IM", employeeNo: null, lrn: "100201000064", schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
    { id: "mf-065", schoolId: "scc", role: "student", email: "m.flores.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Mateo", lastName: "Flores", displayName: "Mateo Flores", initials: "MF", employeeNo: null, lrn: "100201000065", schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
  ];

  const ACTIVE_SCHOOL_ID = getActiveSchoolId();

  // One record per school, subject, and grade. This is the source used by
  // Class Management to decide where a subject is available.
  const DEFAULT_SUBJECT_ASSIGNMENTS = [
    { id: 'scc-elementary-filipino-kindergarten', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-filipino-grade1', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-filipino-grade2', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-filipino-grade3', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-filipino-grade4', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-filipino-grade5', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-filipino-grade6', schoolId: 'scc', subjectId: 'filipino', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-english-kindergarten', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-english-grade1', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-english-grade2', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-english-grade3', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-english-grade4', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-english-grade5', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-english-grade6', schoolId: 'scc', subjectId: 'english', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-mathematics-kindergarten', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-mathematics-grade1', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-mathematics-grade2', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-mathematics-grade3', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-mathematics-grade4', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-mathematics-grade5', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-mathematics-grade6', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-science-kindergarten', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-science-grade1', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-science-grade2', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-science-grade3', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-science-grade4', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-science-grade5', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-science-grade6', schoolId: 'scc', subjectId: 'science', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-values-education-kindergarten', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-values-education-grade1', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-values-education-grade2', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-values-education-grade3', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-values-education-grade4', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-values-education-grade5', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-values-education-grade6', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-araling-panlipunan-kindergarten', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade1', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade2', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade3', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade4', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade5', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-araling-panlipunan-grade6', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-mapeh-kindergarten', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-mapeh-grade1', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-mapeh-grade2', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-mapeh-grade3', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-mapeh-grade4', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-mapeh-grade5', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-mapeh-grade6', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-elementary-esp-kindergarten', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Kindergarten', strand: null },
    { id: 'scc-elementary-esp-grade1', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 1', strand: null },
    { id: 'scc-elementary-esp-grade2', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 2', strand: null },
    { id: 'scc-elementary-esp-grade3', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 3', strand: null },
    { id: 'scc-elementary-esp-grade4', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 4', strand: null },
    { id: 'scc-elementary-esp-grade5', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 5', strand: null },
    { id: 'scc-elementary-esp-grade6', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'elementary', gradeLevel: 'Grade 6', strand: null },
    { id: 'scc-jhs-mathematics-grade7', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-mathematics-grade8', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-mathematics-grade9', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-mathematics-grade10', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-science-grade7', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-science-grade8', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-science-grade9', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-science-grade10', schoolId: 'scc', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-values-education-grade7', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-values-education-grade8', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-values-education-grade9', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-values-education-grade10', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade7', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade8', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade9', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-araling-panlipunan-grade10', schoolId: 'scc', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-mapeh-grade7', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-mapeh-grade8', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-mapeh-grade9', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-mapeh-grade10', schoolId: 'scc', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-tle-grade7', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-tle-grade8', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-tle-grade9', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-tle-grade10', schoolId: 'scc', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-jhs-esp-grade7', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'scc-jhs-esp-grade8', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'scc-jhs-esp-grade9', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'scc-jhs-esp-grade10', schoolId: 'scc', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'scc-shs-mathematics-grade11-stem', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-mathematics-grade11-humss', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-mathematics-grade11-abm', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-mathematics-grade11-gas', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-mathematics-grade11-tvl', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-mathematics-grade12-stem', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-mathematics-grade12-humss', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-mathematics-grade12-abm', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-mathematics-grade12-gas', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-mathematics-grade12-tvl', schoolId: 'scc', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-science-grade11-stem', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-science-grade11-humss', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-science-grade11-abm', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-science-grade11-gas', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-science-grade11-tvl', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-science-grade12-stem', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-science-grade12-humss', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-science-grade12-abm', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-science-grade12-gas', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-science-grade12-tvl', schoolId: 'scc', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-values-education-grade11-stem', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-values-education-grade11-humss', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-values-education-grade11-abm', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-values-education-grade11-gas', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-values-education-grade11-tvl', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-values-education-grade12-stem', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-values-education-grade12-humss', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-values-education-grade12-abm', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-values-education-grade12-gas', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-values-education-grade12-tvl', schoolId: 'scc', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-pe-health-grade11-stem', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-pe-health-grade11-humss', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-pe-health-grade11-abm', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-pe-health-grade11-gas', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-pe-health-grade11-tvl', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-pe-health-grade12-stem', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-pe-health-grade12-humss', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-pe-health-grade12-abm', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-pe-health-grade12-gas', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-pe-health-grade12-tvl', schoolId: 'scc', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-empowerment-technologies-grade11-stem', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-empowerment-technologies-grade11-humss', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-empowerment-technologies-grade11-abm', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-empowerment-technologies-grade11-gas', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-empowerment-technologies-grade11-tvl', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-empowerment-technologies-grade12-stem', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-empowerment-technologies-grade12-humss', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-empowerment-technologies-grade12-abm', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-empowerment-technologies-grade12-gas', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-empowerment-technologies-grade12-tvl', schoolId: 'scc', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'scc-shs-practical-research-grade11-stem', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'scc-shs-practical-research-grade11-humss', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'scc-shs-practical-research-grade11-abm', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'scc-shs-practical-research-grade11-gas', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'scc-shs-practical-research-grade11-tvl', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'scc-shs-practical-research-grade12-stem', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'scc-shs-practical-research-grade12-humss', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'scc-shs-practical-research-grade12-abm', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'scc-shs-practical-research-grade12-gas', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'scc-shs-practical-research-grade12-tvl', schoolId: 'scc', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-jhs-mathematics-grade7', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-mathematics-grade8', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-mathematics-grade9', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-mathematics-grade10', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-science-grade7', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-science-grade8', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-science-grade9', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-science-grade10', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-values-education-grade7', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-values-education-grade8', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-values-education-grade9', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-values-education-grade10', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade7', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade8', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade9', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-araling-panlipunan-grade10', schoolId: 'manghi', subjectId: 'araling-panlipunan', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-mapeh-grade7', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-mapeh-grade8', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-mapeh-grade9', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-mapeh-grade10', schoolId: 'manghi', subjectId: 'mapeh', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-tle-grade7', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-tle-grade8', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-tle-grade9', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-tle-grade10', schoolId: 'manghi', subjectId: 'tle', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-jhs-esp-grade7', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 7', strand: null },
    { id: 'manghi-jhs-esp-grade8', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 8', strand: null },
    { id: 'manghi-jhs-esp-grade9', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 9', strand: null },
    { id: 'manghi-jhs-esp-grade10', schoolId: 'manghi', subjectId: 'esp', schoolLevel: 'jhs', gradeLevel: 'Grade 10', strand: null },
    { id: 'manghi-shs-mathematics-grade11-stem', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-mathematics-grade11-humss', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-mathematics-grade11-abm', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-mathematics-grade11-gas', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-mathematics-grade11-tvl', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-mathematics-grade12-stem', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-mathematics-grade12-humss', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-mathematics-grade12-abm', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-mathematics-grade12-gas', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-mathematics-grade12-tvl', schoolId: 'manghi', subjectId: 'mathematics', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-science-grade11-stem', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-science-grade11-humss', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-science-grade11-abm', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-science-grade11-gas', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-science-grade11-tvl', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-science-grade12-stem', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-science-grade12-humss', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-science-grade12-abm', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-science-grade12-gas', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-science-grade12-tvl', schoolId: 'manghi', subjectId: 'science', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-values-education-grade11-stem', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-values-education-grade11-humss', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-values-education-grade11-abm', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-values-education-grade11-gas', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-values-education-grade11-tvl', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-values-education-grade12-stem', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-values-education-grade12-humss', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-values-education-grade12-abm', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-values-education-grade12-gas', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-values-education-grade12-tvl', schoolId: 'manghi', subjectId: 'values-education', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-pe-health-grade11-stem', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-pe-health-grade11-humss', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-pe-health-grade11-abm', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-pe-health-grade11-gas', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-pe-health-grade11-tvl', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-pe-health-grade12-stem', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-pe-health-grade12-humss', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-pe-health-grade12-abm', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-pe-health-grade12-gas', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-pe-health-grade12-tvl', schoolId: 'manghi', subjectId: 'pe-health', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-empowerment-technologies-grade11-stem', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-empowerment-technologies-grade11-humss', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-empowerment-technologies-grade11-abm', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-empowerment-technologies-grade11-gas', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-empowerment-technologies-grade11-tvl', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-empowerment-technologies-grade12-stem', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-empowerment-technologies-grade12-humss', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-empowerment-technologies-grade12-abm', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-empowerment-technologies-grade12-gas', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-empowerment-technologies-grade12-tvl', schoolId: 'manghi', subjectId: 'empowerment-technologies', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' },
    { id: 'manghi-shs-practical-research-grade11-stem', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'STEM' },
    { id: 'manghi-shs-practical-research-grade11-humss', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'HUMSS' },
    { id: 'manghi-shs-practical-research-grade11-abm', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'ABM' },
    { id: 'manghi-shs-practical-research-grade11-gas', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'GAS' },
    { id: 'manghi-shs-practical-research-grade11-tvl', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 11', strand: 'TVL' },
    { id: 'manghi-shs-practical-research-grade12-stem', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'STEM' },
    { id: 'manghi-shs-practical-research-grade12-humss', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'HUMSS' },
    { id: 'manghi-shs-practical-research-grade12-abm', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'ABM' },
    { id: 'manghi-shs-practical-research-grade12-gas', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'GAS' },
    { id: 'manghi-shs-practical-research-grade12-tvl', schoolId: 'manghi', subjectId: 'practical-research', schoolLevel: 'shs', gradeLevel: 'Grade 12', strand: 'TVL' }
  ];
  const savedSubjectAssignments = readJson(STORAGE_KEYS.subjectAssignments, null);
  const SUBJECT_ASSIGNMENTS = Array.isArray(savedSubjectAssignments)
    ? savedSubjectAssignments
    : clone(DEFAULT_SUBJECT_ASSIGNMENTS);

  // Shared attendance rows. Each record represents one student's status for
  // one school day, section, and (when available) subject. Replace this local
  // collection with the attendance API response during backend integration.
  const DEFAULT_ATTENDANCE_DIRECTORY = [
    { id: 'attendance-jd-004-2025-06-02-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-02-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-02-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-03-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-04-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-04-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-04-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-05-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-05-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-05-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-06-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-09-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-10-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-11-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-11-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-11-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-11', status: 'absent', remark: null },
    { id: 'attendance-jd-004-2025-06-12-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-12', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-12-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-12', status: 'late', remark: null },
    { id: 'attendance-jd-004-2025-06-12-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-12', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-06-13-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', date: '2025-06-13', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-26-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-26', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-27-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-27', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-28-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-28', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-29-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-29', status: 'present', remark: null },
    { id: 'attendance-jd-004-2025-05-30-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', date: '2025-05-30', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-02-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-03-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-04-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-05-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-06-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-09-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-10-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-11-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-11', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-12-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-12', status: 'absent', remark: null },
    { id: 'attendance-mt-012-2025-06-13-all', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: null, date: '2025-06-13', status: 'absent', remark: null },
    { id: 'attendance-cm-001-2025-06-02-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-02-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-02-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-02-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-02-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-02', status: 'late', remark: null },
    { id: 'attendance-cm-001-2025-06-03-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-03-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-03-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-03-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'excused', remark: null },
    { id: 'attendance-gb-014-2025-06-03-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-03', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-04-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-04-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-04-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-04-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-04-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-04', status: 'absent', remark: null },
    { id: 'attendance-cm-001-2025-06-05-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-05-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-05-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-sc-013-2025-06-05-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-05-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-05', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-06-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-06-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-06-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-06-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-06-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-06', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-09-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'late', remark: null },
    { id: 'attendance-lr-002-2025-06-09-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-09-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'absent', remark: null },
    { id: 'attendance-sc-013-2025-06-09-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-09-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-09', status: 'present', remark: null },
    { id: 'attendance-cm-001-2025-06-10-values-education', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-lr-002-2025-06-10-values-education', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-mt-012-2025-06-10-values-education', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'absent', remark: '4th consecutive absence' },
    { id: 'attendance-sc-013-2025-06-10-values-education', schoolId: 'scc', studentId: 'sc-013', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'present', remark: null },
    { id: 'attendance-gb-014-2025-06-10-values-education', schoolId: 'scc', studentId: 'gb-014', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', date: '2025-06-10', status: 'late', remark: 'arrived 15 minutes late' }
  ];
  const savedAttendance = readJson(schoolStorageKey(STORAGE_KEYS.attendance, ACTIVE_SCHOOL_ID), null);
  const attendanceSeed = Array.isArray(savedAttendance)
    ? savedAttendance
    : clone(scopeToActiveSchool(DEFAULT_ATTENDANCE_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ATTENDANCE_DIRECTORY = attendanceSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      studentId: String(record.studentId || ''),
      sectionId: record.sectionId || null,
      subjectId: record.subjectId || null,
      date: record.date || null,
      status: record.status || 'pending',
      remark: record.remark || null
    }));

  function getAttendanceRecords(filters = {}) {
    return ATTENDANCE_DIRECTORY.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!filters.studentId || record.studentId === String(filters.studentId)) &&
      (!filters.sectionId || record.sectionId === String(filters.sectionId)) &&
      (!filters.subjectId || record.subjectId === String(filters.subjectId)) &&
      (!filters.date || record.date === String(filters.date))
    );
  }

  function getAttendanceForStudent(studentId) {
    return getAttendanceRecords({ studentId });
  }

  function saveAttendanceRecords(records = ATTENDANCE_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.attendance), Array.isArray(records) ? records : []);
  }

  function upsertAttendanceRecord(values = {}) {
    const record = {
      id: String(values.id || `attendance-${values.studentId}-${values.date}-${values.subjectId || 'all'}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      studentId: String(values.studentId || ''),
      sectionId: values.sectionId || null,
      subjectId: values.subjectId || null,
      date: values.date || null,
      status: values.status || 'pending',
      remark: values.remark || null
    };
    const existing = ATTENDANCE_DIRECTORY.find(item =>
      item.schoolId === record.schoolId &&
      item.studentId === record.studentId &&
      item.sectionId === record.sectionId &&
      item.subjectId === record.subjectId &&
      item.date === record.date
    );
    if (existing) Object.assign(existing, record, { id: existing.id });
    else ATTENDANCE_DIRECTORY.push(record);
    saveAttendanceRecords();
    return existing || record;
  }

  // Shared assignment records for Teacher, Student, and Parent portals.
  // Each status row belongs to one assignment and one student.
  const DEFAULT_ASSIGNMENT_STATUS_RECORDS = [
    { id: 'assignment-status-001', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-002', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-003', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-004', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'gb-014', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-005', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-11T00:00:00.000Z' },
    { id: 'assignment-status-006', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-007', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'lr-002', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-008', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-009', schoolId: 'scc', assignmentId: 'assignment-004', studentId: 'jd-004', status: 'submitted', updatedAt: '2025-06-09T00:00:00.000Z' },
    { id: 'assignment-status-010', schoolId: 'scc', assignmentId: 'assignment-006', studentId: 'jd-004', status: 'submitted', updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-status-011', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'cm-001', status: 'submitted', updatedAt: '2025-06-10T00:15:00.000Z' },
    { id: 'assignment-status-012', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'sc-013', status: 'submitted', updatedAt: '2025-06-11T01:10:00.000Z' }
  ];

  const DEFAULT_ASSIGNMENT_DIRECTORY = [
    {
      id: 'assignment-001', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Seatwork 1: Kindness and Respect', instructions: null, assignedDate: '2025-06-09', dueDate: '2025-06-09',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 20
    },
    {
      id: 'assignment-002', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Quiz 1 Review: Core Values', instructions: null, assignedDate: '2025-06-11', dueDate: '2025-06-11',
      onlineSubmissionEnabled: true, categoryId: 'ww', maxScore: 50
    },
    {
      id: 'assignment-003', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Activity 1: Good Citizenship', instructions: null, assignedDate: '2025-06-13', dueDate: '2025-06-13',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 30
    },
    {
      id: 'assignment-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Seatwork 1: Kindness and Respect', instructions: null, assignedDate: '2025-06-09', dueDate: '2025-06-09',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 20
    },
    {
      id: 'assignment-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Quiz 1 Review: Core Values', instructions: null, assignedDate: '2025-06-11', dueDate: '2025-06-11',
      onlineSubmissionEnabled: true, categoryId: 'ww', maxScore: 50
    },
    {
      id: 'assignment-006', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Activity 1: Good Citizenship', instructions: null, assignedDate: '2025-06-13', dueDate: '2025-06-13',
      onlineSubmissionEnabled: false, categoryId: 'ww', maxScore: 30
    },
    {
      id: 'assignment-007', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-3',
      academicPeriodId: 'q2', title: 'Linear Equations Practice', instructions: null, assignedDate: '2025-06-12', dueDate: '2025-06-12',
      onlineSubmissionEnabled: false, categoryId: null, maxScore: null
    },
    {
      id: 'assignment-008', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-2',
      academicPeriodId: 'q2', title: 'Reading Response: Short Stories', instructions: null, assignedDate: '2025-06-10', dueDate: '2025-06-10',
      onlineSubmissionEnabled: false, categoryId: null, maxScore: null
    }
  ];
  const savedAssignments = readJson(schoolStorageKey(STORAGE_KEYS.assignments, ACTIVE_SCHOOL_ID), null);
  const assignmentSeed = Array.isArray(savedAssignments)
    ? savedAssignments
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ASSIGNMENT_DIRECTORY = assignmentSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(({ completion, ...record }) => {
      const defaultRecord = DEFAULT_ASSIGNMENT_DIRECTORY.find(item => item.id === record.id);
      const categoryId = Object.prototype.hasOwnProperty.call(record, 'categoryId')
        ? record.categoryId
        : defaultRecord?.categoryId || null;
      const savedMaxScore = Object.prototype.hasOwnProperty.call(record, 'maxScore')
        ? record.maxScore
        : defaultRecord?.maxScore;
      const maxScore = Number(savedMaxScore);
      return {
        ...record,
        schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
        academicPeriodId: record.academicPeriodId || defaultRecord?.academicPeriodId || null,
        instructions: record.instructions || null,
        onlineSubmissionEnabled: record.onlineSubmissionEnabled === true,
        categoryId: categoryId || null,
        maxScore: categoryId && maxScore > 0 ? maxScore : null
      };
    });

  const savedAssignmentStatuses = readJson(
    schoolStorageKey(STORAGE_KEYS.assignmentStatuses, ACTIVE_SCHOOL_ID),
    null
  );
  const ASSIGNMENT_STATUS_RECORDS = Array.isArray(savedAssignmentStatuses)
    ? savedAssignmentStatuses.filter(record => record.schoolId === ACTIVE_SCHOOL_ID)
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_STATUS_RECORDS, ACTIVE_SCHOOL_ID));

  const DEFAULT_ASSIGNMENT_SCORE_RECORDS = [
    { id: 'assignment-score-assignment-001-cm-001', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'cm-001', score: 18, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-001-lr-002', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'lr-002', score: 20, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-001-mt-012', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'mt-012', score: 12, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-001-sc-013', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'sc-013', score: 17, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-001-gb-014', schoolId: 'scc', assignmentId: 'assignment-001', studentId: 'gb-014', score: 14, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-002-cm-001', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'cm-001', score: 45, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-002-lr-002', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'lr-002', score: 50, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-002-mt-012', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'mt-012', score: 30, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-002-sc-013', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'sc-013', score: 42, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-002-gb-014', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'gb-014', score: 38, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-003-cm-001', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'cm-001', score: 28, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-003-lr-002', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'lr-002', score: 30, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-003-mt-012', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'mt-012', score: 18, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-003-sc-013', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'sc-013', score: 25, updatedAt: '2025-06-13T00:00:00.000Z' },
    { id: 'assignment-score-assignment-003-gb-014', schoolId: 'scc', assignmentId: 'assignment-003', studentId: 'gb-014', score: 20, updatedAt: '2025-06-13T00:00:00.000Z' }
  ];
  const savedAssignmentScores = readJson(
    schoolStorageKey(STORAGE_KEYS.assignmentScores, ACTIVE_SCHOOL_ID),
    null
  );
  const ASSIGNMENT_SCORE_RECORDS = Array.isArray(savedAssignmentScores)
    ? savedAssignmentScores.filter(record => record.schoolId === ACTIVE_SCHOOL_ID)
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_SCORE_RECORDS, ACTIVE_SCHOOL_ID));

  // One submission record belongs to one student and one assignment. The file
  // itself will be stored by the backend later; the frontend keeps metadata.
  const DEFAULT_ASSIGNMENT_SUBMISSIONS = [
    {
      id: 'assignment-submission-assignment-002-cm-001', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'cm-001',
      fileName: 'core-values-review-carlo.pdf', type: 'pdf', fileSize: 184320, fileUrl: '/assets/uploads/assignment-submissions/core-values-review-carlo.pdf',
      submittedAt: '2025-06-10T00:15:00.000Z', updatedAt: '2025-06-10T00:15:00.000Z'
    },
    {
      id: 'assignment-submission-assignment-002-lr-002', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'lr-002',
      fileName: 'quiz-1-review-liza.docx', type: 'docx', fileSize: 96256, fileUrl: null,
      submittedAt: '2025-06-11T00:00:00.000Z', updatedAt: '2025-06-11T00:00:00.000Z'
    },
    {
      id: 'assignment-submission-assignment-002-sc-013', schoolId: 'scc', assignmentId: 'assignment-002', studentId: 'sc-013',
      fileName: 'core-values-review-sofia.jpg', type: 'jpg', fileSize: 512000, fileUrl: null,
      submittedAt: '2025-06-11T01:10:00.000Z', updatedAt: '2025-06-11T01:10:00.000Z'
    }
  ];
  const savedAssignmentSubmissions = readJson(
    schoolStorageKey(STORAGE_KEYS.assignmentSubmissions, ACTIVE_SCHOOL_ID),
    null
  );
  const ASSIGNMENT_SUBMISSIONS = Array.isArray(savedAssignmentSubmissions)
    ? savedAssignmentSubmissions
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_SUBMISSIONS, ACTIVE_SCHOOL_ID));

  function getAssignmentSubmissions(assignmentId = null) {
    return ASSIGNMENT_SUBMISSIONS.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      (!assignmentId || record.assignmentId === String(assignmentId))
    );
  }

  function saveAssignmentSubmissions() {
    writeJson(schoolStorageKey(STORAGE_KEYS.assignmentSubmissions), ASSIGNMENT_SUBMISSIONS);
  }

  function submitAssignment(values = {}) {
    const schoolId = getActiveSchoolId();
    const assignmentId = String(values.assignmentId || '');
    const studentId = String(values.studentId || '');
    const assignment = ASSIGNMENT_DIRECTORY.find(record =>
      record.id === assignmentId && record.schoolId === schoolId
    );
    const student = getUserById(studentId);
    const fileName = String(values.fileName || '').trim();
    const type = String(values.type || '').trim();

    if (
      !assignment ||
      !student ||
      student.schoolId !== schoolId ||
      student.sectionId !== assignment.sectionId ||
      assignment.onlineSubmissionEnabled !== true ||
      !fileName ||
      !type
    ) return null;

    const submittedAt = values.submittedAt || new Date().toISOString();
    const record = {
      id: String(values.id || `assignment-submission-${assignmentId}-${studentId}`),
      schoolId,
      assignmentId,
      studentId,
      fileName,
      type,
      fileSize: values.fileSize || null,
      fileUrl: values.fileUrl || null,
      submittedAt,
      updatedAt: values.updatedAt || submittedAt
    };
    const existing = ASSIGNMENT_SUBMISSIONS.find(item =>
      item.schoolId === schoolId &&
      item.assignmentId === assignmentId &&
      item.studentId === studentId
    );

    if (existing) Object.assign(existing, record, { id: existing.id });
    else ASSIGNMENT_SUBMISSIONS.push(record);

    saveAssignmentSubmissions();
    setAssignmentStatus(assignmentId, studentId, 'submitted');
    return existing || record;
  }

  // Shared learning-material records for Teacher and Student portals. Every
  // record uses IDs for school, section, subject, and teacher so this array
  // can later be replaced by a learning-materials API response.
  const DEFAULT_LEARNING_MATERIAL_DIRECTORY = [
    { id: 'material-math-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 1: Algebra Basics', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Activity Sheet 1', type: 'docx', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 2 Slides: Equations', type: 'pptx', academicPeriodId: 'q1', postedAt: '2025-06-10T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Quiz 1 Answer Key', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Solving for X: Video Lesson', type: 'video', academicPeriodId: 'q2', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-006', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Lesson 3: Linear Inequalities', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-math-007', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', title: 'Seatwork 2: Variables', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-14T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Reading List: Short Stories', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Grammar Review Slides', type: 'pptx', academicPeriodId: 'q1', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Essay Writing Guide', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-english-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-3', title: 'Vocabulary List: Week 3', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-14T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Cell Structure Diagram', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Lab Safety Video', type: 'video', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Lesson 2 Slides: Ecosystems', type: 'pptx', academicPeriodId: 'q2', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Worksheet: Food Chains', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-12T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-science-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-9', title: 'Quiz 1 Review Notes', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-values-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Module 2: Empathy and Respect', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-values-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Reflection Guide', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-section-values-001', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Module 3 - Respect and Kindness.pdf', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-06-03T00:00:00+08:00', fileSize: '2.4 MB', status: 'published', visibleToStudents: true, views: 32 },
    { id: 'material-section-values-002', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Q2 Lesson 4 - Good Citizenship.pptx', type: 'pptx', academicPeriodId: 'q2', postedAt: '2025-05-28T00:00:00+08:00', fileSize: '5.1 MB', status: 'published', visibleToStudents: true, views: 28 },
    { id: 'material-section-values-003', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Activity Sheet 3 - Reflection Exercises.xlsx', type: 'xlsx', academicPeriodId: 'q2', postedAt: '2025-05-22T00:00:00+08:00', fileSize: '0.8 MB', status: 'published', visibleToStudents: true, views: 25 },
    { id: 'material-section-values-004', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Reference - Values Education Guide.pdf', type: 'pdf', academicPeriodId: 'q2', postedAt: '2025-05-15T00:00:00+08:00', fileSize: '1.2 MB', status: 'published', visibleToStudents: true, views: 38 },
    { id: 'material-section-values-005', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Values Poster Visual Aid.png', type: 'png', academicPeriodId: 'q2', postedAt: '2025-05-10T00:00:00+08:00', fileSize: '0.4 MB', status: 'published', visibleToStudents: true, views: 19 },
    { id: 'material-section-values-006', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2', title: 'Q2 Study Guide.docx', type: 'docx', academicPeriodId: 'q2', postedAt: '2025-06-08T00:00:00+08:00', fileSize: '0.6 MB', status: 'draft', visibleToStudents: false, views: 0 }
  ];
  const savedLearningMaterials = readJson(schoolStorageKey(STORAGE_KEYS.materials, ACTIVE_SCHOOL_ID), null);
  const learningMaterialSeed = Array.isArray(savedLearningMaterials)
    ? savedLearningMaterials
    : clone(scopeToActiveSchool(DEFAULT_LEARNING_MATERIAL_DIRECTORY, ACTIVE_SCHOOL_ID));
  const LEARNING_MATERIAL_DIRECTORY = learningMaterialSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      id: String(record.id || `material-${Date.now()}`),
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      sectionId: record.sectionId || null,
      subjectId: record.subjectId || null,
      teacherId: record.teacherId || null,
      title: String(record.title || ''),
      description: record.description || null,
      type: String(record.type || 'file'),
      schoolYear: record.schoolYear || '2025-2026',
      academicPeriodId: record.academicPeriodId || null,
      postedAt: record.postedAt || null,
      fileSize: record.fileSize || null,
      fileUrl: record.fileUrl || null,
      status: record.status || 'published',
      visibleToStudents: record.visibleToStudents !== false,
      views: Number(record.views) || 0
    }));

  // Personal user tasks. A future API can return this same record shape.
  const DEFAULT_USER_TODOS = [
    {
      id: 'teacher-todo-001',
      schoolId: 'scc',
      userId: 'teacher-2',
      title: 'Review Grade 7 journal entries',
      dueDate: '2026-09-09',
      status: 'pending',
      createdAt: '2026-09-07T08:00:00+08:00',
      updatedAt: '2026-09-07T08:00:00+08:00',
      completedAt: null
    },
    {
      id: 'teacher-todo-002',
      schoolId: 'scc',
      userId: 'teacher-2',
      title: 'Prepare next week\'s learning material',
      dueDate: '2026-09-11',
      status: 'pending',
      createdAt: '2026-09-07T08:15:00+08:00',
      updatedAt: '2026-09-07T08:15:00+08:00',
      completedAt: null
    },
    {
      id: 'teacher-todo-003',
      schoolId: 'scc',
      userId: 'teacher-2',
      title: 'Check Grade 8 attendance records',
      dueDate: '2026-09-07',
      status: 'completed',
      createdAt: '2026-09-05T15:30:00+08:00',
      updatedAt: '2026-09-07T09:10:00+08:00',
      completedAt: '2026-09-07T09:10:00+08:00'
    },
    {
      id: 'platform-todo-001',
      schoolId: null,
      userId: 'platform-admin-001',
      title: 'Review Manghi school account registration',
      dueDate: '2026-09-08',
      status: 'pending',
      createdAt: '2026-09-07T08:20:00+08:00',
      updatedAt: '2026-09-07T08:20:00+08:00',
      completedAt: null
    },
    {
      id: 'platform-todo-002',
      schoolId: null,
      userId: 'platform-admin-001',
      title: 'Check suspended school accounts',
      dueDate: '2026-09-10',
      status: 'pending',
      createdAt: '2026-09-07T08:35:00+08:00',
      updatedAt: '2026-09-07T08:35:00+08:00',
      completedAt: null
    },
    {
      id: 'platform-todo-003',
      schoolId: null,
      userId: 'platform-admin-001',
      title: 'Verify recent school configuration updates',
      dueDate: null,
      status: 'completed',
      createdAt: '2026-09-06T16:20:00+08:00',
      updatedAt: '2026-09-07T09:25:00+08:00',
      completedAt: '2026-09-07T09:25:00+08:00'
    },
    {
      id: 'admin-todo-001',
      schoolId: 'scc',
      userId: 'admin-1',
      title: 'Review pending grading-period reopen requests',
      dueDate: '2026-09-08',
      status: 'pending',
      createdAt: '2026-09-07T08:30:00+08:00',
      updatedAt: '2026-09-07T08:30:00+08:00',
      completedAt: null
    },
    {
      id: 'admin-todo-002',
      schoolId: 'scc',
      userId: 'admin-1',
      title: 'Confirm the active grading rules',
      dueDate: '2026-09-10',
      status: 'pending',
      createdAt: '2026-09-07T08:45:00+08:00',
      updatedAt: '2026-09-07T08:45:00+08:00',
      completedAt: null
    },
    {
      id: 'admin-todo-003',
      schoolId: 'scc',
      userId: 'admin-1',
      title: 'Check this week\'s school announcements',
      dueDate: null,
      status: 'completed',
      createdAt: '2026-09-06T16:00:00+08:00',
      updatedAt: '2026-09-07T09:20:00+08:00',
      completedAt: '2026-09-07T09:20:00+08:00'
    }
  ];
  const savedTodos = readJson(STORAGE_KEYS.todos, null);
  const USER_TODOS = Array.isArray(savedTodos)
    ? savedTodos
    : clone(DEFAULT_USER_TODOS);

  // Shared published/draft announcement records for every school portal.
  // Optional fields are always present: imageUrl/access use null, pinned uses false.
  // Portal pages read this collection with an audience key; Admin can read
  // all records, including drafts, for management.
  const DEFAULT_ANNOUNCEMENT_DIRECTORY = [
    {
      id: 'ANN-001', schoolId: 'scc', title: 'Q2 Grade Encoding Deadline: June 14',
      body: 'All subject teachers are required to complete encoding of Q2 grades no later than <strong>June 14, 2025</strong>. Please coordinate with your section adviser for any discrepancies before the deadline.',
      priority: 'high', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-14T08:00:00+08:00',
      status: 'published', pinned: true, icon: 'alert-triangle', iconClass: 'icon-high', tag: 'Urgent', read: false, seenCount: 284,
      imageUrl: '../../assets/uploads/announcements/ChatGPT Image Jun 13, 2026, 10_21_57 PM.png', access: null
    },
    {
      id: 'ANN-002', schoolId: 'scc', title: 'Journal Submission Window: This Friday',
      body: 'The weekly journal submission window will open this <strong>Friday, June 7</strong>. Please remind your students to submit their entries before 11:59 PM. Late submissions will not be accepted for this week.',
      priority: 'normal', audience: ['teachers'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-13T15:00:00+08:00',
      status: 'published', pinned: false, icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: false, seenCount: 24,
      imageUrl: null, access: 'journals'
    },
    {
      id: 'ANN-003', schoolId: 'scc', title: 'Foundation Day: June 20, 2025',
      body: 'St. Columban\'s College will celebrate its <strong>Foundation Day on June 20, 2025</strong>. Classes will be suspended for the day. All students are encouraged to participate in the school activities.',
      priority: 'event', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-30T10:00:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 312,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-004', schoolId: 'scc', title: 'Q2 Narrative Reports Now Available',
      body: 'Q2 narrative reports have been confirmed by section teachers and are now available to view in the portal. Please review the summaries for your assigned sections or linked children.',
      priority: 'normal', audience: ['teachers', 'parents'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-28T09:00:00+08:00',
      status: 'published', pinned: false, icon: 'file-text', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 198,
      imageUrl: null, access: 'reports'
    },
    {
      id: 'ANN-005', schoolId: 'scc', title: 'Weekly Journal is Now Open for Submission',
      body: 'This week\'s journal submission is now open. Please write about your week, your experiences, feelings, and anything you want to share. Submissions close <strong>Friday at 11:59 PM</strong>.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-24T07:00:00+08:00',
      status: 'published', pinned: false, icon: 'pencil', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 253,
      imageUrl: null, access: 'journals'
    },
    {
      id: 'ANN-006', schoolId: 'scc', title: 'End of Quarter Reminder: Q2 Closing',
      body: 'This announcement is saved as a draft and is not yet visible to any users. Click Edit to review and publish it.',
      priority: 'low', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-22T16:30:00+08:00',
      status: 'draft', pinned: false, icon: 'file-edit', iconClass: 'icon-low', tag: 'Draft', read: true, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-007', schoolId: 'scc', title: 'Intramurals Sign-up Open',
      body: 'Visit the Student Affairs table during recess this week to join a sports team for the upcoming intramurals. Sign-ups close <strong>Friday</strong>.',
      priority: 'event', audience: ['students'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-12T13:30:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-008', schoolId: 'scc', title: 'Library Resources Updated',
      body: 'New reference materials are now available in the student library corner.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Library', createdAt: '2025-06-10T10:00:00+08:00',
      status: 'published', pinned: false, icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 0,
      imageUrl: null, access: null
    },
    {
      id: 'ANN-009', schoolId: 'scc', title: 'Parent-Teacher Conference Schedule',
      body: 'Parent-Teacher Conferences for Q2 are scheduled for <strong>June 27, 2025</strong>, 8:00 AM to 4:00 PM. Please coordinate with your child\'s adviser for a specific time slot.',
      priority: 'event', audience: ['parents'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-11T09:00:00+08:00',
      status: 'published', pinned: false, icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: true, seenCount: 0,
      imageUrl: null, access: null
    }
  ];
  const savedAnnouncements = readJson(schoolStorageKey(STORAGE_KEYS.announcements, ACTIVE_SCHOOL_ID), null);
  const announcementSeed = Array.isArray(savedAnnouncements)
    ? savedAnnouncements
    : clone(scopeToActiveSchool(DEFAULT_ANNOUNCEMENT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ANNOUNCEMENT_DIRECTORY = announcementSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      audience: Array.isArray(record.audience) ? record.audience : [record.audience || 'all'],
      status: record.status || 'published',
      pinned: record.pinned === true,
      imageUrl: record.imageUrl || null,
      access: record.access || null
    }));

  // Shared final grade records for Student and Parent portals. Each row uses
  // stable IDs so the local source can later be replaced by a grades API.
  const DEFAULT_GRADE_DIRECTORY = [
    { id: 'grade-jd-004-q1-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 89, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 87, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 88, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-jd-004-q1-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: 'teacher-3', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 87, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: 'teacher-jana-mendez', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 89, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92.5, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 88.5, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 94, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: 'teacher-3', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-jd-004-q2-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: 'teacher-jana-mendez', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-mt-012-q1-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q1-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 88, remark: 'Very Satisfactory' },
    { id: 'grade-mt-012-q1-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
  ];
  const savedGrades = readJson(schoolStorageKey(STORAGE_KEYS.grades, ACTIVE_SCHOOL_ID), null);
  const gradeSeed = Array.isArray(savedGrades)
    ? savedGrades
    : clone(scopeToActiveSchool(DEFAULT_GRADE_DIRECTORY, ACTIVE_SCHOOL_ID));
  const GRADE_DIRECTORY = gradeSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({ ...record, schoolId: record.schoolId || ACTIVE_SCHOOL_ID }));

  // Shared journal records for Student and Teacher portals. Each row belongs
  // to one student, section, teacher, subject, and journal week. The local
  // collection can later be replaced with the journal API response.
  const DEFAULT_JOURNAL_DIRECTORY = [
    {
      id: 'journal-cm-001-2025-w23', schoolId: 'scc', studentId: 'cm-001', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 40,
      entryText: 'This week I had a hard time understanding how to solve equations with variables on both sides. At first I kept making errors moving terms to the other side. I asked my seatmate for help and we practiced a few examples together during break, and it finally clicked after the third try. I felt proud when I got the seatwork right on my own.',
      submittedAt: '2025-06-13T13:00:00+08:00'
    },
    {
      id: 'journal-lr-002-2025-w23', schoolId: 'scc', studentId: 'lr-002', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 45,
      entryText: 'I struggled with staying focused during our long discussion about rational expressions. I kept losing track of the steps. I tried writing each step down as the teacher explained and that helped a lot. By the end of class I felt more confident about the topic.',
      submittedAt: '2025-06-13T14:00:00+08:00'
    },
    {
      id: 'journal-mt-012-2025-w23', schoolId: 'scc', studentId: 'mt-012', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-sc-013-2025-w23', schoolId: 'scc', studentId: 'sc-013', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: true, reviewed: false, score: null,
      entryText: 'The challenge I faced was finishing my activity on time. I tend to overthink each problem and I run out of time. This week I tried setting a time limit for each item, and I managed to finish before the bell. I will keep practicing this.',
      submittedAt: '2025-06-14T09:00:00+08:00'
    },
    {
      id: 'journal-gb-014-2025-w23', schoolId: 'scc', studentId: 'gb-014', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-na-015-2025-w23', schoolId: 'scc', studentId: 'na-015', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 50,
      entryText: 'I found the quiz on linear inequalities confusing because of the direction of the inequality when you divide by a negative. I reviewed my notes after class and now I understand when to flip the sign and when not to.',
      submittedAt: '2025-06-13T15:00:00+08:00'
    },
    {
      id: 'journal-jd-004-2025-w23', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a moment this week when you helped a classmate or a classmate helped you. What did you learn from that experience?', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-jd-004-2025-w22', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W22', week: 'Week 2', dateRange: 'June 2 to 7, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Talk about a challenge you faced this week and how you tried to overcome it.', isCurrent: false, isOpen: false, minWords: 50, dueLabel: '',
      submitted: true, late: false, reviewed: true, score: 50,
      entryText: 'I found the quiz on linear inequalities confusing because of the direction of the inequality sign. At first I kept flipping it the wrong way whenever I multiplied or divided by a negative number. Instead of giving up, I asked Ms. Reyes to explain it again after class, and I also practiced with extra problems from the textbook. By the end of the week I felt a lot more confident, and I even helped my seatmate understand the same concept during our group activity.',
      submittedAt: '2025-06-06T21:42:00+08:00'
    },
    {
      id: 'journal-jd-004-2025-w21', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      academicPeriodId: 'q2', weekId: '2025-W21', week: 'Week 1', dateRange: 'May 26 to 31, 2025',
      categoryId: 'pt', maxScore: 50,
      prompt: 'Describe a moment this week when you helped a classmate or a classmate helped you.', isCurrent: false, isOpen: false, minWords: 50, dueLabel: '',
      submitted: true, late: false, reviewed: true, score: 45,
      entryText: "This week I had a hard time understanding how to solve equations with variables on both sides. My classmate Andrea noticed I was stuck during seatwork and took the time to walk me through the steps using a simpler example first. It made a big difference because she explained it in a way that made more sense to me than the textbook did. I learned that asking for help isn't something to be embarrassed about, and that classmates can be great teachers too.",
      submittedAt: '2025-05-30T19:15:00+08:00'
    }
  ];
  const savedJournals = readJson(schoolStorageKey(STORAGE_KEYS.journals, ACTIVE_SCHOOL_ID), null);
  const journalSeed = Array.isArray(savedJournals)
    ? savedJournals
    : clone(scopeToActiveSchool(DEFAULT_JOURNAL_DIRECTORY, ACTIVE_SCHOOL_ID));
  const JOURNAL_DIRECTORY = journalSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      academicPeriodId: record.academicPeriodId || 'q2',
      categoryId: record.categoryId || 'pt',
      maxScore: Number(record.maxScore) || 50,
      submitted: Boolean(record.submitted),
      reviewed: Boolean(record.reviewed),
      late: Boolean(record.late),
      score: record.score ?? null,
      entryText: String(record.entryText || record.entry || '')
    }));

  // Shared AI report records for Adviser and Parent portals. The text is a
  // mock generated summary; source metrics remain structured fields so a
  // future report-generation endpoint can replace this collection directly.
  const DEFAULT_REPORT_DIRECTORY = [
    {
      id: 'report-cm-001-2025-w23', schoolId: 'scc', studentId: 'cm-001', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Carlo had a strong week across all his subjects. He attended all sessions and completed all 4 tracked assignments on time. His journal entry reflected positively on his progress and noted enjoyment in group activities. No concerns to report this week - keep up the encouragement at home.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-lr-002-2025-w23', schoolId: 'scc', studentId: 'lr-002', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Liza continues to show consistent effort this week. She was present for all sessions and submitted all assignments on schedule. Her journal entry mentioned feeling more confident after a recent quiz. No concerns at this time.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: '2025-06-14T08:02:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w23', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Juan had a strong week across all his subjects. He attended all sessions and completed all 4 tracked assignments on time. His journal entry reflected positively on his progress in Algebra and noted enjoyment in group activities. No concerns to report this week. Keep up the encouragement at home!',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: '2025-06-14T08:02:00+08:00'
    },
    {
      id: 'report-ml-006-2025-w23', schoolId: 'scc', studentId: 'ml-006', sectionId: 'jhs-grade9-peter', teacherId: 'teacher-rico-santos',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: true,
      attendance: { total: '12/30', absences: [
        { subject: 'Mathematics', day: 'Tue' }, { subject: 'Mathematics', day: 'Wed' }, { subject: 'Mathematics', day: 'Thu' },
        { subject: 'Science', day: 'Tue' }, { subject: 'Science', day: 'Wed' }, { subject: 'Science', day: 'Thu' },
        { subject: 'English', day: 'Tue' }, { subject: 'English', day: 'Thu' }
      ] }, assignments: { total: '1/4', missing: ['Mathematics', 'Science', 'English'] }, journalEntryCount: 0,
      text: 'Maria is flagged as at-risk this week with multiple absences across subjects and only 1 of 4 assignments completed. Academic records show scores trending below the passing threshold. No journal entry was submitted. We strongly recommend reaching out to discuss what may be affecting her attendance and engagement.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-bg-007-2025-w23', schoolId: 'scc', studentId: 'bg-007', sectionId: 'jhs-grade9-paul', teacherId: 'teacher-jana-mendez',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: true,
      attendance: { total: '26/30', absences: [{ subject: 'Mathematics', day: 'Wed' }, { subject: 'Science', day: 'Wed' }, { subject: 'English', day: 'Wed' }] },
      assignments: { total: '2/4', missing: ['Mathematics', 'English'] }, journalEntryCount: 1,
      text: 'Ben is flagged as at-risk this week. He was absent in several subjects on Wednesday and completed only 2 of 4 assignments, continuing a pattern from prior weeks. His journal described feeling overwhelmed. We recommend a supportive conversation at home about pacing.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-as-008-2025-w23', schoolId: 'scc', studentId: 'as-008', sectionId: 'jhs-grade10-james', teacherId: 'teacher-3',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: false,
      attendance: { total: '29/30', absences: [{ subject: 'Science', day: 'Mon' }] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Ana had a good week with one absence in Science on Monday but completed all assignments regardless. Her journal entry mentioned working through a difficult topic with help from peers. No concerns at this time.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-mt-012-2025-w23', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Maya had a wonderful week. She participated actively in class discussions and completed all her assignments ahead of schedule. Her teacher noted she helped a classmate with a Math problem during group work. It was a lovely display of kindness.',
      generatedAt: '2025-06-14T09:15:00+08:00', confirmedAt: '2025-06-14T09:15:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w22', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W22', weekLabel: 'Week of June 2 to 7, 2025', dateRange: 'Jun 2 to Jun 7', status: 'confirmed', atRisk: true,
      attendance: { total: '28/30', absences: [{ subject: 'All subjects', day: 'Tue' }, { subject: 'All subjects', day: 'Thu' }] }, assignments: { total: '2/4', missing: ['Science', 'Filipino'] }, journalEntryCount: 1,
      text: 'Juan is flagged as at-risk this week. He was absent on Tuesday and Thursday and completed only 2 of 4 assignments. We recommend a check-in at home regarding his recent attendance and a brief conversation about any challenges he may be facing.',
      generatedAt: '2025-06-07T07:45:00+08:00', confirmedAt: '2025-06-07T07:45:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w21', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-9',
      weekId: '2025-W21', weekLabel: 'Week of May 26 to 31, 2025', dateRange: 'May 26 to May 31', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '3/4', missing: ['Science'] }, journalEntryCount: 1,
      text: 'Juan had a solid week overall. He attended every class day and completed 3 of his 4 assignments, with one activity still pending. His journal reflection was thoughtful and showed good self-awareness about managing his time.',
      generatedAt: '2025-05-31T08:10:00+08:00', confirmedAt: '2025-05-31T08:10:00+08:00'
    },
    {
      id: 'report-mt-012-2025-w22', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', teacherId: 'teacher-2',
      weekId: '2025-W22', weekLabel: 'Week of June 2 to 7, 2025', dateRange: 'Jun 2 to Jun 7', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Maya continues to do well this week. She was present every day and submitted all her work on time. No concerns at this time. She remains one of the more engaged students in class.',
      generatedAt: '2025-06-07T08:30:00+08:00', confirmedAt: '2025-06-07T08:30:00+08:00'
    }
  ];
  const savedReports = readJson(schoolStorageKey(STORAGE_KEYS.reports, ACTIVE_SCHOOL_ID), null);
  const reportSeed = Array.isArray(savedReports)
    ? savedReports
    : clone(scopeToActiveSchool(DEFAULT_REPORT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const REPORT_DIRECTORY = reportSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      studentId: String(record.studentId || ''),
      status: record.status || 'pending',
      atRisk: Boolean(record.atRisk),
      journalEntryCount: Number(record.journalEntryCount || 0),
      text: String(record.text || ''),
      confirmedAt: record.confirmedAt || null
    }));

  const USER_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.users, ACTIVE_SCHOOL_ID);
  const savedUsers = readJson(USER_STORAGE_KEY, null);
  const USERS = Array.isArray(savedUsers) && savedUsers.length
    ? savedUsers
    : clone(DEFAULT_USERS.filter(user => user.schoolId === ACTIVE_SCHOOL_ID));

  // Keep older saved records compatible with the canonical user fields.
  let usersChanged = false;
  USERS.forEach(user => {
    const defaultUser = DEFAULT_USERS.find(item => item.id === user.id);
    let savedLrn = user.lrn || defaultUser?.lrn || null;
    if (user.role === RECORD_VALUES.roles.STUDENT && savedLrn) {
      const digits = String(savedLrn).replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 11) {
        savedLrn = `${digits.slice(0, 6)}${digits.slice(6).padStart(6, '0')}`;
      } else if (digits.length === 12) {
        savedLrn = digits;
      }
    }
    const schoolEmail = String(user.schoolEmail || user.email || '').trim().toLowerCase();
    const personalEmail = String(user.personalEmail || '').trim().toLowerCase() || null;
    if (user.lrn !== savedLrn) {
      user.lrn = savedLrn;
      usersChanged = true;
    }
    if (user.schoolEmail !== schoolEmail) {
      user.schoolEmail = schoolEmail;
      usersChanged = true;
    }
    if (Object.hasOwn(user, 'email') && user.email !== schoolEmail) {
      user.email = schoolEmail;
      usersChanged = true;
    }
    if (user.personalEmail !== personalEmail) {
      user.personalEmail = personalEmail;
      usersChanged = true;
    }
  });
  if (Array.isArray(savedUsers) && savedUsers.length && usersChanged) {
    writeJson(USER_STORAGE_KEY, USERS);
  }

  const DEFAULT_PARENT_STUDENT_LINKS = [
    { id: 'parent-student-parent-7-jd-004', schoolId: 'scc', parentId: 'parent-7', studentId: 'jd-004' },
    { id: 'parent-student-parent-8-mt-012', schoolId: 'scc', parentId: 'parent-8', studentId: 'mt-012' }
  ];
  const PARENT_STUDENT_LINK_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.parentStudentLinks, ACTIVE_SCHOOL_ID);
  const savedParentStudentLinks = readJson(PARENT_STUDENT_LINK_STORAGE_KEY, null);
  const PARENT_STUDENT_LINKS = (Array.isArray(savedParentStudentLinks)
    ? savedParentStudentLinks
    : clone(DEFAULT_PARENT_STUDENT_LINKS))
    .map(link => ({
      id: String(link.id || `parent-student-${link.parentId}-${link.studentId}`),
      schoolId: link.schoolId || ACTIVE_SCHOOL_ID,
      parentId: String(link.parentId || ''),
      studentId: String(link.studentId || ''),
      relationship: PARENT_RELATIONSHIPS.includes(String(link.relationship || '').trim().toLowerCase())
        ? String(link.relationship).trim().toLowerCase()
        : null
    }));
  if (Array.isArray(savedParentStudentLinks)
    && JSON.stringify(savedParentStudentLinks) !== JSON.stringify(PARENT_STUDENT_LINKS)) {
    writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
  }

  const USER_PROFILE_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.userProfiles, ACTIVE_SCHOOL_ID);
  const savedUserProfiles = readJson(USER_PROFILE_STORAGE_KEY, []);
  const USER_PROFILES = (Array.isArray(savedUserProfiles) ? savedUserProfiles : [])
    .filter(profile => (profile.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(profile => normalizeUserProfile(profile.userId, profile));

  function normalizeUserProfile(userId, values = {}) {
    const profile = {
      userId: String(userId || values.userId || ''),
      schoolId: values.schoolId || ACTIVE_SCHOOL_ID,
      middleName: values.middleName || null,
      hasNoMiddleName: Boolean(values.hasNoMiddleName),
      contactNumber: values.contactNumber || null,
      sex: values.sex || null,
      birthDate: values.birthDate || null,
      birthPlaceProvince: values.birthPlaceProvince || null,
      motherTongue: values.motherTongue || null,
      indigenousGroup: values.indigenousGroup || null,
      religion: values.religion || null,
      houseStreet: values.houseStreet || null,
      barangay: values.barangay || null,
      cityMunicipality: values.cityMunicipality || null,
      province: values.province || null,
      maidenLastName: values.maidenLastName || null,
      hasNoMaidenName: Boolean(values.hasNoMaidenName),
      profileCompletedAt: values.profileCompletedAt || null,
      updatedAt: values.updatedAt || null
    };
    return profile;
  }

  function saveUserProfiles() {
    writeJson(USER_PROFILE_STORAGE_KEY, USER_PROFILES);
  }

  const ROLE_ALIASES = {
    admin: RECORD_VALUES.roles.SCHOOL_ADMIN,
    adm: RECORD_VALUES.roles.SCHOOL_ADMIN,
    fac: RECORD_VALUES.roles.TEACHER,
    stud: RECORD_VALUES.roles.STUDENT,
    par: RECORD_VALUES.roles.PARENT,
    parents: RECORD_VALUES.roles.PARENT
  };

  function getUsers() {
    return USERS;
  }

  function getUsersByRole(role) {
    return USERS.filter(user => user.role === String(role));
  }

  function getStudents() {
    return getUsersByRole(RECORD_VALUES.roles.STUDENT);
  }

  function getUserById(userId) {
    return USERS.find(user => user.id === String(userId)) || null;
  }

  function saveUsers() {
    writeJson(USER_STORAGE_KEY, USERS);
  }

  function getParentStudentLinks() {
    return PARENT_STUDENT_LINKS.filter(link => link.schoolId === getActiveSchoolId());
  }

  function setParentStudentLinks(parentId, links = []) {
    const parent = getUserById(parentId);
    if (!parent || parent.role !== RECORD_VALUES.roles.PARENT) return [];

    for (let index = PARENT_STUDENT_LINKS.length - 1; index >= 0; index -= 1) {
      if (PARENT_STUDENT_LINKS[index].parentId === parent.id) PARENT_STUDENT_LINKS.splice(index, 1);
    }

    const normalizedLinks = links
      .map(link => ({
        studentId: String(link?.studentId || ''),
        relationship: PARENT_RELATIONSHIPS.includes(String(link?.relationship || '').trim().toLowerCase())
          ? String(link.relationship).trim().toLowerCase()
          : null
      }))
      .filter(link => USERS.some(user => (
        user.id === link.studentId &&
        user.role === RECORD_VALUES.roles.STUDENT &&
        user.schoolId === parent.schoolId
      )))
      .filter((link, index, records) => (
        records.findIndex(record => record.studentId === link.studentId) === index
      ));

    normalizedLinks.forEach(link => PARENT_STUDENT_LINKS.push({
        id: `parent-student-${parent.id}-${link.studentId}`,
        schoolId: parent.schoolId,
        parentId: parent.id,
        studentId: link.studentId,
        relationship: link.relationship
      }));

    writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
    return getParentStudentLinks();
  }

  function schoolEmailDomain(school = getActiveSchool()) {
    const schoolEmail = String(school?.email || '').trim().toLowerCase();
    if (schoolEmail.includes('@')) return schoolEmail.split('@').pop();

    const website = String(school?.website || '').trim();
    if (website) {
      try {
        return new URL(website.includes('://') ? website : `https://${website}`).hostname.replace(/^www\./, '');
      } catch {
        return website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      }
    }

    return `${school?.id || 'school'}.edugnay.local`;
  }

  function generateSchoolEmail(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role;
    const roleSuffix = {
      [RECORD_VALUES.roles.SCHOOL_ADMIN]: 'adm',
      [RECORD_VALUES.roles.TEACHER]: 'fac',
      [RECORD_VALUES.roles.STUDENT]: 'stud',
      [RECORD_VALUES.roles.PARENT]: 'parents'
    }[role];
    const firstName = String(values.firstName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const lastName = String(values.lastName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!firstName || !lastName || !roleSuffix) return '';

    const domain = schoolEmailDomain();
    const base = `${firstName.charAt(0)}.${lastName}.${roleSuffix}`;
    const existingEmails = new Set(USERS
      .filter(user => user.id !== String(values.userId || ''))
      .map(user => String(user.schoolEmail || '').trim().toLowerCase())
      .filter(Boolean));

    let localPart = base;
    let candidate = `${localPart}@${domain}`;
    let suffix = 2;
    while (existingEmails.has(candidate)) {
      localPart = `${base}${suffix}`;
      candidate = `${localPart}@${domain}`;
      suffix += 1;
    }
    return candidate;
  }

  function createUser(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role || RECORD_VALUES.roles.STUDENT;
    const firstName = String(values.firstName || '').trim();
    const lastName = String(values.lastName || '').trim();
    const displayName = String(values.displayName || values.name || [values.honorific, firstName, lastName].filter(Boolean).join(' ')).trim();
    const isStudent = role === RECORD_VALUES.roles.STUDENT;
    const isStaff = role === RECORD_VALUES.roles.SCHOOL_ADMIN || role === RECORD_VALUES.roles.TEACHER;
    const schoolId = values.schoolId || getActiveSchoolId();
    const lrn = isStudent ? String(values.lrn || '').trim() : null;
    const requestedSchoolEmail = String(values.schoolEmail || '').trim().toLowerCase()
      || String(values.email || '').trim().toLowerCase()
      || generateSchoolEmail({ ...values, role });
    const personalEmail = String(values.personalEmail || '').trim().toLowerCase() || null;

    if (requestedSchoolEmail && USERS.some(user => (
      user.schoolId === schoolId
      && String(user.schoolEmail || '').trim().toLowerCase() === requestedSchoolEmail
    ))) {
      throw new Error('That school email is already assigned to another account.');
    }
    if (personalEmail && USERS.some(user => (
      user.schoolId === schoolId
      && String(user.personalEmail || '').trim().toLowerCase() === personalEmail
    ))) {
      throw new Error('That personal email is already assigned to another account.');
    }

    if (isStudent && !LRN_PATTERN.test(lrn)) {
      throw new Error('LRN must contain exactly 12 digits.');
    }
    if (isStudent && USERS.some(user => (
      user.schoolId === schoolId
      && user.role === RECORD_VALUES.roles.STUDENT
      && String(user.lrn || '').trim() === lrn
    ))) {
      throw new Error('That LRN is already assigned to another student account.');
    }

    const user = {
      id: String(values.studentId || values.id || `${role}-${Date.now()}`),
      schoolId,
      role,
      email: requestedSchoolEmail,
      schoolEmail: requestedSchoolEmail,
      personalEmail,
      status: values.status || RECORD_VALUES.statuses.ACTIVE,
      createdAt: values.createdAt || new Date().toISOString(),
      honorific: isStaff ? values.honorific ?? null : null,
      firstName,
      lastName,
      displayName,
      initials: values.initials || getInitials([firstName, lastName].filter(Boolean).join(' ')),
      employeeNo: isStaff
        ? values.employeeNo ?? null
        : null,
      lrn,
      schoolLevel: isStudent ? values.schoolLevel ?? values.level ?? null : null,
      gradeLevel: isStudent ? values.gradeLevel ?? values.grade ?? null : null,
      strand: isStudent ? values.strand ?? null : null,
      sectionId: isStudent ? values.sectionId ?? null : null
    };

    USERS.push(user);
    saveUsers();
    if (values.profile && typeof values.profile === 'object') updateUserProfile(user.id, values.profile);
    if (role === RECORD_VALUES.roles.PARENT && Array.isArray(values.parentLinks)) {
      setParentStudentLinks(user.id, values.parentLinks);
    }
    return user;
  }

  async function importUsers(accountRecords = []) {
    const allowedRoles = [
      RECORD_VALUES.roles.SCHOOL_ADMIN,
      RECORD_VALUES.roles.TEACHER,
      RECORD_VALUES.roles.STUDENT,
      RECORD_VALUES.roles.PARENT
    ];
    const activeSchoolId = getActiveSchoolId();
    const records = Array.isArray(accountRecords) ? accountRecords : [];

    if (!records.length) throw new Error('There are no accounts ready to import.');

    const existingEmails = new Set(USERS
      .filter(user => user.schoolId === activeSchoolId)
      .map(user => String(user.personalEmail || '').trim().toLowerCase())
      .filter(Boolean));
    const existingEmployeeNumbers = new Set(USERS
      .filter(user => (
        user.schoolId === activeSchoolId
        && [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(user.role)
      ))
      .map(user => String(user.employeeNo || '').trim().toUpperCase())
      .filter(Boolean));
    const existingLrns = new Set(USERS
      .filter(user => user.schoolId === activeSchoolId && user.role === RECORD_VALUES.roles.STUDENT)
      .map(user => String(user.lrn || '').trim())
      .filter(Boolean));
    const importedEmails = new Set();
    const importedEmployeeNumbers = new Set();
    const importedLrns = new Set();

    const normalizedRecords = records.map((record, index) => {
      const rowNumber = index + 1;
      const role = ROLE_ALIASES[String(record?.role || '').trim()] || String(record?.role || '').trim();
      const firstName = String(record?.firstName || '').trim();
      const lastName = String(record?.lastName || '').trim();
      const personalEmail = String(record?.personalEmail || '').trim().toLowerCase();

      if (!allowedRoles.includes(role)) throw new Error(`Import record ${rowNumber} has an invalid role.`);
      if (!firstName || !lastName) throw new Error(`Import record ${rowNumber} needs a first and last name.`);
      if (!/^\S+@\S+\.\S+$/.test(personalEmail)) {
        throw new Error(`Import record ${rowNumber} needs a valid personal email.`);
      }
      if (existingEmails.has(personalEmail) || importedEmails.has(personalEmail)) {
        throw new Error(`Import record ${rowNumber} uses a personal email that is already assigned.`);
      }
      importedEmails.add(personalEmail);

      const normalized = { firstName, lastName, personalEmail, role };
      const isStaff = [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(role);

      if (isStaff) {
        const employeeNo = String(record?.employeeNo || '').trim().toUpperCase();
        if (!employeeNo) throw new Error(`Import record ${rowNumber} needs an employee number.`);
        if (existingEmployeeNumbers.has(employeeNo) || importedEmployeeNumbers.has(employeeNo)) {
          throw new Error(`Import record ${rowNumber} uses an employee number that is already assigned.`);
        }
        importedEmployeeNumbers.add(employeeNo);
        normalized.employeeNo = employeeNo;
      }

      if (role === RECORD_VALUES.roles.STUDENT) {
        const lrn = String(record?.lrn || '').trim();
        if (!LRN_PATTERN.test(lrn)) {
          throw new Error(`Import record ${rowNumber} needs an LRN with exactly 12 digits.`);
        }
        if (existingLrns.has(lrn) || importedLrns.has(lrn)) {
          throw new Error(`Import record ${rowNumber} uses an LRN that is already assigned.`);
        }
        importedLrns.add(lrn);
        normalized.lrn = lrn;
      }

      if (role === RECORD_VALUES.roles.PARENT) {
        const links = Array.isArray(record?.parentLinks) ? record.parentLinks : [];
        if (!links.length) throw new Error(`Import record ${rowNumber} needs at least one linked student.`);

        const linkedStudentIds = new Set();
        normalized.parentLinks = links.map(link => {
          const studentId = String(link?.studentId || '').trim();
          const relationship = String(link?.relationship || '').trim().toLowerCase();
          const student = USERS.find(user => (
            user.id === studentId
            && user.schoolId === activeSchoolId
            && user.role === RECORD_VALUES.roles.STUDENT
          ));

          if (!student) throw new Error(`Import record ${rowNumber} references a student that was not found.`);
          if (!PARENT_RELATIONSHIPS.includes(relationship)) {
            throw new Error(`Import record ${rowNumber} has an invalid parent relationship.`);
          }
          if (linkedStudentIds.has(studentId)) {
            throw new Error(`Import record ${rowNumber} links the same student more than once.`);
          }
          linkedStudentIds.add(studentId);
          return { studentId, relationship };
        });
      }

      return normalized;
    });

    const usedIds = new Set(USERS.map(user => String(user.id)));
    const usedSchoolEmails = new Set(USERS
      .map(user => String(user.schoolEmail || '').trim().toLowerCase())
      .filter(Boolean));
    const createdUsers = [];
    const createdLinks = [];
    let idSeed = Date.now();

    normalizedRecords.forEach(record => {
      let id = `${record.role}-${idSeed++}`;
      while (usedIds.has(id)) id = `${record.role}-${idSeed++}`;
      usedIds.add(id);

      let schoolEmail = generateSchoolEmail({
        firstName: record.firstName,
        lastName: record.lastName,
        role: record.role
      });
      const [localPart, domain] = schoolEmail.split('@');
      let emailSuffix = 2;
      while (usedSchoolEmails.has(schoolEmail)) {
        schoolEmail = `${localPart}${emailSuffix}@${domain}`;
        emailSuffix += 1;
      }
      usedSchoolEmails.add(schoolEmail);

      const isStudent = record.role === RECORD_VALUES.roles.STUDENT;
      const isStaff = [RECORD_VALUES.roles.SCHOOL_ADMIN, RECORD_VALUES.roles.TEACHER].includes(record.role);
      const user = {
        id,
        schoolId: activeSchoolId,
        role: record.role,
        email: schoolEmail,
        schoolEmail,
        personalEmail: record.personalEmail,
        status: RECORD_VALUES.statuses.ACTIVE,
        createdAt: new Date().toISOString(),
        honorific: null,
        firstName: record.firstName,
        lastName: record.lastName,
        displayName: `${record.firstName} ${record.lastName}`.trim(),
        initials: getInitials(`${record.firstName} ${record.lastName}`),
        employeeNo: isStaff ? record.employeeNo : null,
        lrn: isStudent ? record.lrn : null,
        schoolLevel: null,
        gradeLevel: null,
        strand: null,
        sectionId: null
      };

      createdUsers.push(user);
      if (record.role === RECORD_VALUES.roles.PARENT) {
        record.parentLinks.forEach(link => createdLinks.push({
          id: `parent-student-${id}-${link.studentId}`,
          schoolId: activeSchoolId,
          parentId: id,
          studentId: link.studentId,
          relationship: link.relationship
        }));
      }
    });

    const previousUsers = USERS.slice();
    const previousLinks = PARENT_STUDENT_LINKS.slice();
    try {
      USERS.push(...createdUsers);
      PARENT_STUDENT_LINKS.push(...createdLinks);
      saveUsers();
      writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
    } catch (error) {
      USERS.splice(0, USERS.length, ...previousUsers);
      PARENT_STUDENT_LINKS.splice(0, PARENT_STUDENT_LINKS.length, ...previousLinks);
      try {
        saveUsers();
        writeJson(PARENT_STUDENT_LINK_STORAGE_KEY, PARENT_STUDENT_LINKS);
      } catch {
        // Keep the original import error when storage rollback is unavailable.
      }
      throw new Error('The accounts could not be imported.');
    }

    return {
      accounts: createdUsers,
      accountCount: createdUsers.length,
      relationshipCount: createdLinks.length
    };
  }

  function updateUser(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) return null;

    const nextRole = Object.hasOwn(values, 'role')
      ? ROLE_ALIASES[values.role] || values.role
      : user.role;
    const nextLrn = nextRole === RECORD_VALUES.roles.STUDENT
      ? String(Object.hasOwn(values, 'lrn') ? values.lrn : user.lrn || '').trim()
      : null;
    const nextSchoolEmail = Object.hasOwn(values, 'schoolEmail')
      ? String(values.schoolEmail || '').trim().toLowerCase()
      : (Object.hasOwn(values, 'email')
        ? String(values.email || '').trim().toLowerCase()
        : String(user.schoolEmail || '').trim().toLowerCase());
    const nextPersonalEmail = Object.hasOwn(values, 'personalEmail')
      ? String(values.personalEmail || '').trim().toLowerCase()
      : String(user.personalEmail || '').trim().toLowerCase();

    if (nextSchoolEmail && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && String(item.schoolEmail || '').trim().toLowerCase() === nextSchoolEmail
    ))) {
      throw new Error('That school email is already assigned to another account.');
    }
    if (nextPersonalEmail && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && String(item.personalEmail || '').trim().toLowerCase() === nextPersonalEmail
    ))) {
      throw new Error('That personal email is already assigned to another account.');
    }
    const shouldValidateLrn = nextRole === RECORD_VALUES.roles.STUDENT
      && (Object.hasOwn(values, 'lrn') || nextRole !== user.role);

    if (shouldValidateLrn && !LRN_PATTERN.test(nextLrn)) {
      throw new Error('LRN must contain exactly 12 digits.');
    }
    if (shouldValidateLrn && USERS.some(item => (
      item.id !== user.id
      && item.schoolId === user.schoolId
      && item.role === RECORD_VALUES.roles.STUDENT
      && String(item.lrn || '').trim() === nextLrn
    ))) {
      throw new Error('That LRN is already assigned to another student account.');
    }

    const fields = [
      'role', 'email', 'schoolEmail', 'personalEmail', 'status', 'honorific', 'firstName', 'lastName',
      'displayName', 'initials', 'employeeNo', 'lrn', 'schoolLevel',
      'gradeLevel', 'strand', 'sectionId'
    ];
    fields.forEach(field => {
      if (!Object.hasOwn(values, field)) return;
      if (field === 'role') user.role = nextRole;
      else if (field === 'email' || field === 'schoolEmail') {
        user.schoolEmail = nextSchoolEmail;
        user.email = nextSchoolEmail;
      }
      else if (field === 'personalEmail') user.personalEmail = String(values.personalEmail || '').trim().toLowerCase() || null;
      else if (field === 'lrn') user.lrn = nextLrn;
      else user[field] = values[field];
    });

    if (Object.hasOwn(values, 'firstName') || Object.hasOwn(values, 'lastName')) {
      if (!Object.hasOwn(values, 'displayName')) {
        user.displayName = [user.honorific, user.firstName, user.lastName].filter(Boolean).join(' ');
      }
      user.initials = getInitials([user.firstName, user.lastName].filter(Boolean).join(' '));
    }

    const isStudent = user.role === RECORD_VALUES.roles.STUDENT;
    const isStaff = user.role === RECORD_VALUES.roles.SCHOOL_ADMIN || user.role === RECORD_VALUES.roles.TEACHER;
    user.honorific = isStaff ? user.honorific ?? null : null;
    user.employeeNo = isStaff ? user.employeeNo ?? null : null;
    user.lrn = isStudent
      ? (Object.hasOwn(values, 'lrn') ? nextLrn : (user.lrn ?? null))
      : null;
    user.schoolLevel = isStudent ? user.schoolLevel ?? null : null;
    user.gradeLevel = isStudent ? user.gradeLevel ?? null : null;
    user.strand = isStudent ? user.strand ?? null : null;
    user.sectionId = isStudent ? user.sectionId ?? null : null;

    saveUsers();
    if (values.profile && typeof values.profile === 'object') updateUserProfile(user.id, values.profile);
    if (user.role === RECORD_VALUES.roles.PARENT && Array.isArray(values.parentLinks)) {
      setParentStudentLinks(user.id, values.parentLinks);
    }
    return user;
  }

  function getUserProfile(userId) {
    const user = getUserById(userId);
    if (!user) return null;
    const stored = USER_PROFILES.find(profile => profile.userId === user.id);
    return normalizeUserProfile(user.id, stored || {});
  }

  function updateUserProfile(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) return null;

    const index = USER_PROFILES.findIndex(profile => profile.userId === user.id);
    const current = getUserProfile(user.id);
    const next = normalizeUserProfile(user.id, {
      ...current,
      ...values,
      schoolId: user.schoolId,
      updatedAt: new Date().toISOString()
    });

    if (index >= 0) USER_PROFILES[index] = next;
    else USER_PROFILES.push(next);
    saveUserProfiles();
    return next;
  }

  function getMissingProfileFields(userId, values = {}) {
    const user = getUserById(userId);
    const profile = getUserProfile(userId);
    if (!user || !profile) return [];

    const setupRoles = [RECORD_VALUES.roles.STUDENT, RECORD_VALUES.roles.PARENT];
    if (!setupRoles.includes(user.role)) return [];

    const candidateProfile = normalizeUserProfile(user.id, { ...profile, ...values });
    const personalEmail = Object.hasOwn(values, 'personalEmail')
      ? String(values.personalEmail || '').trim()
      : String(user.personalEmail || '').trim();

    const missing = [];
    if (!personalEmail) missing.push('personalEmail');
    if (!candidateProfile.middleName && !candidateProfile.hasNoMiddleName) missing.push('middleName');
    if (user.role === RECORD_VALUES.roles.STUDENT) {
      ['sex', 'birthDate', 'birthPlaceProvince', 'motherTongue', 'indigenousGroup', 'religion', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
        .forEach(field => { if (!candidateProfile[field]) missing.push(field); });
    }
    if (user.role === RECORD_VALUES.roles.PARENT) {
      ['sex', 'religion', 'contactNumber', 'houseStreet', 'barangay', 'cityMunicipality', 'province']
        .forEach(field => { if (!candidateProfile[field]) missing.push(field); });
      const isMother = PARENT_STUDENT_LINKS.some(link => (
        link.parentId === user.id && link.relationship === 'mother'
      ));
      if (isMother && !candidateProfile.maidenLastName && !candidateProfile.hasNoMaidenName) missing.push('maidenLastName');
    }
    return missing;
  }

  function isProfileSetupRequired(userId) {
    const user = getUserById(userId);
    const profile = getUserProfile(userId);
    if (!user || !profile) return false;
    return !profile.profileCompletedAt || getMissingProfileFields(user.id).length > 0;
  }

  async function completeProfileSetup(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) throw new Error('Profile account not found.');

    const missing = getMissingProfileFields(user.id, values);
    if (missing.length) {
      const error = new Error('Please complete all required profile fields.');
      error.fields = missing;
      throw error;
    }

    const personalEmail = String(values.personalEmail || '').trim().toLowerCase();
    updateUser(user.id, { personalEmail });
    return updateUserProfile(user.id, {
      ...values,
      profileCompletedAt: new Date().toISOString()
    });
  }

  function enforceProfileSetup(userId, profilePage) {
    if (!isProfileSetupRequired(userId)) return false;

    const currentPage = window.location.pathname.split('/').pop().toLowerCase();
    const targetPage = String(profilePage || '').split('/').pop().toLowerCase();
    if (!targetPage || currentPage === targetPage) return false;

    window.location.replace(`./${targetPage}?setup=required`);
    return true;
  }

  function deleteUser(userId) {
    const index = USERS.findIndex(user => user.id === String(userId));
    if (index < 0) return null;

    const [user] = USERS.splice(index, 1);
    saveUsers();
    return user;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function getJournals() {
    return JOURNAL_DIRECTORY;
  }

  function getJournalsForStudent(studentId) {
    return JOURNAL_DIRECTORY
      .filter(record => record.studentId === String(studentId))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  }

  function getJournalsForTeacher(teacherId, sectionId = null) {
    return JOURNAL_DIRECTORY.filter(record =>
      record.schoolId === getActiveSchoolId() &&
      record.teacherId === String(teacherId) &&
      (!sectionId || record.sectionId === String(sectionId))
    );
  }

  function saveJournals(records = JOURNAL_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.journals), Array.isArray(records) ? records : []);
  }

  function updateJournalEntry(entryId, values = {}) {
    const entry = JOURNAL_DIRECTORY.find(record =>
      record.id === String(entryId) && record.schoolId === getActiveSchoolId()
    );
    if (!entry) return null;
    Object.assign(entry, values);
    saveJournals();
    return entry;
  }

  function reportWithLabels(record) {
    const student = getUserById(record.studentId);
    const teacher = getUserById(record.teacherId);
    const section = getAssignmentSections(getActiveSchool()).find(item => item.id === record.sectionId);
    const teacherName = teacher?.displayName || '';
    return {
      ...record,
      studentName: student?.displayName || '',
      studentEmail: student?.schoolEmail || '',
      sectionLabel: section ? `${section.grade} - ${section.name}` : '',
      teacherName,
      teacherInitials: record.teacherInitials || getInitials(teacherName),
      generatedAtLabel: formatDateTime(record.generatedAt),
      confirmedAtLabel: record.confirmedAt ? formatDateTime(record.confirmedAt) : ''
    };
  }

  function getReports() {
    return REPORT_DIRECTORY;
  }

  function getReportsForTeacher(teacherId, weekId = null) {
    const advisorySectionIds = getAssignmentSections()
      .filter(section => section.adviserId === String(teacherId))
      .map(section => section.id);

    return REPORT_DIRECTORY
      .filter(record => (
        record.teacherId === String(teacherId) &&
        advisorySectionIds.includes(record.sectionId) &&
        (!weekId || record.weekId === weekId)
      ))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
      .map(reportWithLabels);
  }

  function getReportsForStudent(studentId, confirmedOnly = false) {
    return REPORT_DIRECTORY
      .filter(record => record.studentId === String(studentId) && (!confirmedOnly || record.status === 'confirmed'))
      .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))
      .map(reportWithLabels);
  }

  function saveReports(records = REPORT_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.reports), Array.isArray(records) ? records : []);
  }

  function updateReport(reportId, values = {}) {
    const report = REPORT_DIRECTORY.find(record => record.id === String(reportId));
    if (!report) return null;
    Object.assign(report, values);
    saveReports();
    return report;
  }

  function getHolidays(school = getActiveSchool()) {
    const schoolId = school?.id;
    if (!schoolId) return [];

    const saved = readJson(schoolStorageKey(STORAGE_KEYS.holidays, schoolId), null);
    const legacy = schoolId === 'scc' ? readJson(STORAGE_KEYS.holidays, null) : null;
    const source = Array.isArray(saved)
      ? saved
      : (Array.isArray(legacy) ? legacy : DEFAULT_HOLIDAYS);

    return source
      .map(record => ({ ...record, schoolId: record.schoolId || schoolId }))
      .filter(record => record.schoolId === schoolId);
  }

  function saveHolidays(holidays, school = getActiveSchool()) {
    const schoolId = school?.id;
    if (!schoolId) return;
    const records = Array.isArray(holidays)
      ? holidays.map(record => ({ ...record, schoolId }))
      : [];
    writeJson(schoolStorageKey(STORAGE_KEYS.holidays, schoolId), records);
  }

  function getNoClassDay(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;
    return getHolidays().find(holiday => holiday.date === localDate) || null;
  }

  let panelEmptyIconRenderQueued = false;

  function queuePanelEmptyIconRender() {
    if (panelEmptyIconRenderQueued || !window.lucide?.createIcons) return;
    panelEmptyIconRenderQueued = true;
    const render = () => {
      panelEmptyIconRenderQueued = false;
      window.lucide?.createIcons?.();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(render);
    else Promise.resolve().then(render);
  }

  /* Shared empty-state markup for data panels. Pages can replace the local
     arrays with API responses later without changing their empty-state UI. */
  function renderPanelEmptyState(options = {}) {
    const icon = String(options.icon || 'inbox').replace(/[^a-z0-9-]/gi, '');
    const title = String(options.title || 'Nothing to show yet');
    const text = String(options.text || 'Records will appear here when they are available.');

    queuePanelEmptyIconRender();
    return `<div class="panel-empty-state" role="status"><div class="panel-empty-state-icon" aria-hidden="true"><i data-lucide="${icon}"></i></div><div class="panel-empty-state-title">${escapeHtml(title)}</div><div class="panel-empty-state-text">${escapeHtml(text)}</div></div>`;
  }

  window.EDUGNAY_CONFIG = {
    values: RECORD_VALUES,
    getActiveSchoolId,
    scopeToActiveSchool,
    withActiveSchool,
    grades: GRADE_CATALOG,
    createDivision,
    subjects: SUBJECT_CATALOG,
    parentRelationships: PARENT_RELATIONSHIPS,
    parentStudentLinks: PARENT_STUDENT_LINKS,
    getUsers,
    getUsersByRole,
    getStudents,
    getUserById,
    getUserProfile,
    updateUserProfile,
    getMissingProfileFields,
    isProfileSetupRequired,
    completeProfileSetup,
    enforceProfileSetup,
    getParentStudentLinks,
    createUser,
    importUsers,
    generateSchoolEmail,
    updateUser,
    deleteUser,
    saveUsers,
    setParentStudentLinks,
    academicPeriodTypes: ACADEMIC_PERIOD_TYPES,
    academicPeriodStatuses: ACADEMIC_PERIOD_STATUSES,
    reopenRequestStatuses: REOPEN_REQUEST_STATUSES,
    createAcademicPeriods,
    getAcademicPeriods,
    getCurrentAcademicPeriod,
    getAcademicTermConfig,
    validateAcademicTermConfig,
    saveAcademicTermConfig,
    startAcademicPeriod,
    getAcademicPeriodCloseReadiness,
    closeAcademicPeriod,
    extendAcademicPeriod,
    getAcademicPeriodReminder,
    getReopenRequests,
    getReopenRequestState,
    isReopenRequestActive,
    createReopenRequest,
    approveReopenRequest,
    rejectReopenRequest,
    extendReopenRequest,
    revokeReopenRequest,
    attendanceDefaults: makeAttendanceRules(),
    attendance: ATTENDANCE_DIRECTORY,
    getAttendanceRecords,
    getAttendanceForStudent,
    saveAttendanceRecords,
    upsertAttendanceRecord,
    getSchools,
    saveSchools,
    createSchoolRegistration,
    getSchoolRegistration,
    updateSchool,
    getActiveSchool,
    getSchoolTypeInfo,
    isGradesPageEnabled,
    isNarrativeReportsEnabled,
    getSubjectAssignments,
    saveSubjectAssignments,
    getConfiguredSubjects,
    getJournalSubject,
    isJournalsEnabled,
    getAssignmentSections,
    getSections,
    updateSection,
    getMyTeachingSections,
    getSfTemplates,
    getSfTemplatePreview,
    generateSfForm,
    assignments: ASSIGNMENT_DIRECTORY,
    getAssignments,
    getAssignmentsForSection,
    getAssignmentsForStudent,
    saveAssignments,
    createAssignment,
    updateAssignment,
    getAssignmentSubmissions,
    saveAssignmentSubmissions,
    submitAssignment,
    getAssignmentStatuses,
    saveAssignmentStatuses,
    setAssignmentStatus,
    getAssignmentScores,
    saveAssignmentScores,
    setAssignmentScore,
    learningMaterials: LEARNING_MATERIAL_DIRECTORY,
    getLearningMaterials,
    getLearningMaterialsForSection,
    getLearningMaterialsForStudent,
    saveLearningMaterials,
    createLearningMaterial,
    getUserTodos,
    saveTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    gradeRecords: GRADE_DIRECTORY,
    getGradesForStudent,
    journals: JOURNAL_DIRECTORY,
    getJournals,
    getJournalsForStudent,
    getJournalsForTeacher,
    saveJournals,
    updateJournalEntry,
    reports: REPORT_DIRECTORY,
    getReports,
    getReportsForTeacher,
    getReportsForStudent,
    saveReports,
    updateReport,
    formatDateTime,
    getNotificationReadIds,
    saveNotificationReadIds,
    applyNotificationReadState,
    markNotificationRead,
    markAllNotificationsRead,
    formatDateGroup,
    formatTime,
    formatRelativeTime,
    announcements: ANNOUNCEMENT_DIRECTORY,
    getAnnouncements,
    getAllAnnouncements,
    saveAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    getHolidays,
    saveHolidays,
    getNoClassDay,
    escapeHtml,
    isRecorded,
    getInitials,
    renderPanelEmptyState
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

  function syncInput(state) {
    const selected = getOptionRecords(state).find(option => option.value === state.select.value);
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
  const context = window.EDUGNAY_NOTIFICATION_CONTEXT;
  if (!context) return;
  const items = typeof context.getItems === 'function'
    ? context.getItems()
    : (Array.isArray(context.records) ? context.records : []);
  markAllNotificationsRead(context.storageKey, items);
  if (typeof renderTopbarNotifs === 'function') renderTopbarNotifs();
}

function getProfileControls() {
  return {
    trigger: document.getElementById('tbProfileTrigger'),
    dropdown: document.getElementById('tbProfileDropdown')
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

function toggleDrawer(open) {
  const isOpen = open === undefined
    ? !document.body.classList.contains('drawer-open')
    : open;
  document.body.classList.toggle('drawer-open', isOpen);
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.toggle('open', isOpen);
  refreshSidebarScrollbars();
}

function confirmLogout() {
  // TODO on backend conversion: replace with POST /auth/logout,
  // clear session cookie, then redirect
  try {
    sessionStorage.removeItem(EDUGNAY_SESSION_STORAGE_KEY);
  } catch {
    // Continue to the sign-in page when session storage is unavailable.
  }
  const isGitHubPages = location.hostname.endsWith('github.io');
  const BASE = isGitHubPages ? '/edugnay' : '';

  window.location.href = `${BASE}/index.html`;
}

function applyActiveSchoolToShell() {
  if (document.body?.dataset.platformPortal === 'true') return;

  const config = window.EDUGNAY_CONFIG;
  const school = config.getActiveSchool();
  if (!school) return;
  const typeLabel = config.getSchoolTypeInfo(school.schoolLevels).label;

  document.querySelectorAll('.brand-sub:not([data-platform-brand])').forEach(element => {
    element.textContent = school.shortName;
  });
  document.querySelectorAll('[data-school-name]').forEach(element => {
    element.textContent = school.name;
  });
  /* The body stores the active school type as metadata. Exclude it from
     content replacement so refreshing the context never wipes the page. */
  document.querySelectorAll('[data-school-type]:not(body)').forEach(element => {
    element.textContent = typeLabel;
  });
  document.querySelectorAll('[data-school-year]').forEach(element => {
    element.textContent = school.schoolYear;
  });
  document.querySelectorAll('[data-active-academic-period]').forEach(element => {
    const schoolLevel = element.dataset.schoolLevel || school.activeDivision;
    const activePeriod = config.getCurrentAcademicPeriod(school.id, schoolLevel);
    const activePeriodLabel = activePeriod
      ? `${activePeriod.name} · S.Y. ${school.schoolYear}`
      : `No active grading period · S.Y. ${school.schoolYear}`;
    element.textContent = activePeriodLabel;
  });
  document.querySelectorAll('.topbar-context-copy span, .admin-topbar-context-copy span').forEach(element => {
    element.textContent = `${typeLabel} · ${school.schoolYear}`;
  });
  document.body.dataset.activeSchool = school.id;
  document.body.dataset.schoolType = school.schoolType;
  document.body.dataset.gradesPageEnabled = String(config.isGradesPageEnabled(school));
}

/* Keep the grade portal policy in one place so every student and parent page
   responds to the same school setting. The server should enforce this policy
   again after backend integration; this client guard is for the current
   frontend flow and prevents stale direct links from opening the page. */
function applyGradePortalAccess() {
  if (document.body?.dataset.platformPortal === 'true') return;

  const pageName = location.pathname.split('/').pop().toLowerCase();
  const isStudentOrParentPage = /edugnay-(student|parent)-/.test(pageName);
  if (!isStudentOrParentPage) return;

  const enabled = window.EDUGNAY_CONFIG.isGradesPageEnabled();
  const gradeLinks = document.querySelectorAll(
    'a[href*="edugnay-student-grades.html"], a[href*="edugnay-parent-grades.html"]'
  );

  gradeLinks.forEach(link => {
    link.hidden = !enabled;
    link.classList.toggle('is-grades-page-hidden', !enabled);
    link.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) link.setAttribute('tabindex', '-1');
    else link.removeAttribute('tabindex');
  });

  if (!enabled && /edugnay-(student|parent)-grades\.html$/.test(pageName)) {
    const dashboard = pageName.includes('parent')
      ? 'edugnay-parent-dashboard.html'
      : 'edugnay-student-dashboard.html';
    window.location.replace(dashboard);
  }
}

window.refreshEdUgnayShellContext = function refreshEdUgnayShellContext() {
  applyActiveSchoolToShell();
  applyGradePortalAccess();
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
function initScrollFades() {
  const selector = [
    '.child-switcher',
    '.subject-tab-bar',
    '.profile-tab-bar',
    '.mgmt-tabs',
    '.school-tabs',
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
}

/* Use a custom sidebar thumb so native track and arrow controls never appear. */
const sidebarScrollbarRefreshers = [];

function refreshSidebarScrollbars() {
  sidebarScrollbarRefreshers.forEach(refresh => refresh());
}

function initSidebarScrollbars() {
  const sidebars = Array.from(document.querySelectorAll('.sidebar'));
  if (!sidebars.length) return;

  sidebars.forEach(sidebar => {
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

    sidebarScrollbarRefreshers.push(scheduleUpdate);
    scheduleUpdate();
  });
}

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

document.addEventListener('DOMContentLoaded', async () => {
  applyCurrentDateToGradingBanners();
  applyActiveSchoolToShell();
  applyGradePortalAccess();
  applyPageTitleToTopbar();
  initScrollFades();
  initSidebarScrollbars();
});
