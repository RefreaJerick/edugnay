/* Shared shell behavior for every portal role. */

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
    parentStudentLinks: 'edugnay_parent_student_links',
    attendance: 'edugnay_attendance',
    assignments: 'edugnay_assignments',
    materials: 'edugnay_learning_materials',
    announcements: 'edugnay_announcements',
    grades: 'edugnay_grades',
    journals: 'edugnay_journals',
    reports: 'edugnay_reports'
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
      INACTIVE: 'inactive',
      PENDING: 'pending',
      SUSPENDED: 'suspended'
    }
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
    { id: 'values-education', name: 'Values Education', code: 'VE', levels: ['elementary', 'jhs', 'shs'] },
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

    return {
      key: level,
      label: catalog?.label || level,
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
      platformStatus: RECORD_VALUES.statuses.ACTIVE,
      submittedAt: null,
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
        jhs: createDivision('jhs', {
          academicPeriod: 'Quarter 2',
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
          academicPeriod: '1st Semester',
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
        email: 'admin.adm@stcolumban.edu.ph'
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
      platformStatus: RECORD_VALUES.statuses.PENDING,
      submittedAt: '2026-08-30T09:00:00.000Z',
      gradesPageEnabled: true,
      narrativeReportsEnabled: true,
      journalsEnabled: true,
      journalSubjectId: 'values-education',
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
        email: null
      }
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
  ].map(record => ({ ...record, schoolId: 'scc' }));

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

  function getSchools() {
    const saved = readJson(STORAGE_KEYS.schools, null);
    return Array.isArray(saved) && saved.length ? saved : clone(DEFAULT_SCHOOLS);
  }

  function saveSchools(schools) {
    writeJson(STORAGE_KEYS.schools, schools);
  }

  function getActiveSchool() {
    const schools = getSchools();
    const activeId = localStorage.getItem(STORAGE_KEYS.activeSchool) || schools[0]?.id;
    return schools.find(school => school.id === activeId) || schools[0];
  }

  function setActiveSchool(schoolId) {
    localStorage.setItem(STORAGE_KEYS.activeSchool, schoolId);
  }

  function getActiveSchoolId() {
    return getActiveSchool()?.id || null;
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

  function getConfiguredSubjects(school = getActiveSchool()) {
    const ids = new Set();
    Object.values(school?.divisions || {}).forEach(division => {
      if (Array.isArray(division?.subjects)) division.subjects.forEach(id => ids.add(id));
    });
    return SUBJECT_CATALOG.filter(subject => ids.has(subject.id));
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

  function assignmentWithLabels(record, studentId = null) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = getUserById(record.teacherId);
    const completion = Array.isArray(record.completion) ? record.completion : [];
    const completed = studentId == null
      ? null
      : completion.find(item => String(item.studentId) === String(studentId));
    return {
      ...record,
      subject: subject?.name || '',
      subjectName: subject?.name || '',
      teacher: teacher?.displayName || '',
      status: completed ? 'completed' : 'pending',
      completedAt: completed?.completedAt || null
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
    const assignment = {
      id: String(values.id || `assignment-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      sectionId: values.sectionId || null,
      subjectId: values.subjectId || null,
      teacherId: values.teacherId || null,
      title: String(values.title || '').trim(),
      assignedDate: values.assignedDate || values.dueDate || null,
      dueDate: values.dueDate || null,
      completion: Array.isArray(values.completion) ? values.completion : []
    };
    ASSIGNMENT_DIRECTORY.push(assignment);
    saveAssignments();
    return assignment;
  }

  function setAssignmentCompletion(assignmentId, studentId, completed) {
    const assignment = ASSIGNMENT_DIRECTORY.find(record => record.id === String(assignmentId));
    if (!assignment) return null;
    assignment.completion = Array.isArray(assignment.completion) ? assignment.completion : [];
    assignment.completion = assignment.completion.filter(item => String(item.studentId) !== String(studentId));
    if (completed) assignment.completion.push({ studentId: String(studentId), completedAt: new Date().toISOString() });
    saveAssignments();
    return assignment;
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

    const periodLabels = PERIOD_CATALOG[student.schoolLevel] || PERIOD_CATALOG.jhs;
    const periods = periodLabels.map((label, index) => ({
      id: student.schoolLevel === 'shs' ? `semester-${index + 1}` : `q${index + 1}`,
      label,
      status: 'not-started',
      subjects: []
    }));

    GRADE_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId())
      .filter(record => record.studentId === student.id)
      .filter(record => !schoolYear || record.schoolYear === schoolYear)
      .forEach(record => {
        const period = periods.find(item => item.id === record.academicPeriodId);
        if (!period) return;
        period.label = record.academicPeriodLabel || period.label;
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
      seen: record.seenCount ? `Seen by ${record.seenCount} users` : (record.status === 'draft' ? 'Not yet published' : 'Not yet viewed'),
      image: record.imageUrl || null
    };
  }

  function getAnnouncements(audience) {
    const key = String(audience || '').toLowerCase();
    return ANNOUNCEMENT_DIRECTORY
      .filter(record => record.schoolId === getActiveSchoolId() && record.status !== 'draft')
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
    { id: "cm-001", schoolId: "scc", role: "student", email: "c.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Carlo", lastName: "Mendoza", displayName: "Carlo Mendoza", initials: "CM", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "lr-002", schoolId: "scc", role: "student", email: "l.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liza", lastName: "Reyes", displayName: "Liza Reyes", initials: "LR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "rc-003", schoolId: "scc", role: "student", email: "r.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rico", lastName: "Cruz", displayName: "Rico Cruz", initials: "RC", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "jd-004", schoolId: "scc", role: "student", email: "j.delacruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Juan", lastName: "Dela Cruz", displayName: "Juan Dela Cruz", initials: "JC", employeeNo: null, lrn: "100-201-0001", schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "et-005", schoolId: "scc", role: "student", email: "e.tan.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ella", lastName: "Tan", displayName: "Ella Tan", initials: "ET", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ml-006", schoolId: "scc", role: "student", email: "m.lopez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maria", lastName: "Lopez", displayName: "Maria Lopez", initials: "ML", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "bg-007", schoolId: "scc", role: "student", email: "b.garcia.stud@stcolumban.edu.ph", status: "inactive", createdAt: "2024-06-03T00:00:00.000Z", honorific: null, firstName: "Ben", lastName: "Garcia", displayName: "Ben Garcia", initials: "BG", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "as-008", schoolId: "scc", role: "student", email: "a.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-05-26T00:00:00.000Z", honorific: null, firstName: "Ana", lastName: "Santos", displayName: "Ana Santos", initials: "AS", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ks-009", schoolId: "scc", role: "student", email: "k.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Karl", lastName: "Santiago", displayName: "Karl Santiago", initials: "KS", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "pn-010", schoolId: "scc", role: "student", email: "p.nieves.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paula", lastName: "Nieves", displayName: "Paula Nieves", initials: "PN", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "do-011", schoolId: "scc", role: "student", email: "d.ocampo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Dan", lastName: "Ocampo", displayName: "Dan Ocampo", initials: "DO", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: null, strand: null, sectionId: null },
    { id: "mt-012", schoolId: "scc", role: "student", email: "m.torres.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Maya", lastName: "Torres", displayName: "Maya Torres", initials: "MT", employeeNo: null, lrn: "100-201-0002", schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "sc-013", schoolId: "scc", role: "student", email: "s.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Sofia", lastName: "Cruz", displayName: "Sofia Cruz", initials: "SC", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "gb-014", schoolId: "scc", role: "student", email: "g.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Gabriel", lastName: "Bautista", displayName: "Gabriel Bautista", initials: "GB", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "na-015", schoolId: "scc", role: "student", email: "n.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nicole", lastName: "Aquino", displayName: "Nicole Aquino", initials: "NA", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-matthew" },
    { id: "pr-016", schoolId: "scc", role: "student", email: "p.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Paolo", lastName: "Rivera", displayName: "Paolo Rivera", initials: "PR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "av-017", schoolId: "scc", role: "student", email: "a.villanueva.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Aira", lastName: "Villanueva", displayName: "Aira Villanueva", initials: "AV", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "ld-018", schoolId: "scc", role: "student", email: "l.dizon.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lucas", lastName: "Dizon", displayName: "Lucas Dizon", initials: "LD", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "br-019", schoolId: "scc", role: "student", email: "b.ramos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Beatrice", lastName: "Ramos", displayName: "Beatrice Ramos", initials: "BR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 7", strand: null, sectionId: "jhs-grade7-mark" },
    { id: "mg-020", schoolId: "scc", role: "student", email: "m.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Miguel", lastName: "Garcia", displayName: "Miguel Garcia", initials: "MG", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ac-021", schoolId: "scc", role: "student", email: "a.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Andrea", lastName: "Castillo", displayName: "Andrea Castillo", initials: "AC", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "eb-022", schoolId: "scc", role: "student", email: "e.bernardo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Bernardo", displayName: "Ethan Bernardo", initials: "EB", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "ch-023", schoolId: "scc", role: "student", email: "c.hernandez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Hernandez", displayName: "Chloe Hernandez", initials: "CH", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-luke" },
    { id: "nr-024", schoolId: "scc", role: "student", email: "n.reyes.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Nathan", lastName: "Reyes", displayName: "Nathan Reyes", initials: "NR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "is-025", schoolId: "scc", role: "student", email: "i.santos.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Isabella", lastName: "Santos", displayName: "Isabella Santos", initials: "IS", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "lm-026", schoolId: "scc", role: "student", email: "l.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Liam", lastName: "Mercado", displayName: "Liam Mercado", initials: "LM", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "gr-027", schoolId: "scc", role: "student", email: "g.rivera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Grace", lastName: "Rivera", displayName: "Grace Rivera", initials: "GR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 8", strand: null, sectionId: "jhs-grade8-john" },
    { id: "ds-028", schoolId: "scc", role: "student", email: "d.salazar.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Salazar", displayName: "Daniel Salazar", initials: "DS", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "cb-029", schoolId: "scc", role: "student", email: "c.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Camille", lastName: "Bautista", displayName: "Camille Bautista", initials: "CB", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "jr-030", schoolId: "scc", role: "student", email: "j.ramos2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Joshua", lastName: "Ramos", displayName: "Joshua Ramos", initials: "JR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "rr-031", schoolId: "scc", role: "student", email: "r.robles.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Reina", lastName: "Robles", displayName: "Reina Robles", initials: "RR", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-peter" },
    { id: "mp-032", schoolId: "scc", role: "student", email: "m.perez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Marcus", lastName: "Perez", displayName: "Marcus Perez", initials: "MP", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "al-033", schoolId: "scc", role: "student", email: "a.lim.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Alyssa", lastName: "Lim", displayName: "Alyssa Lim", initials: "AL", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "ad-034", schoolId: "scc", role: "student", email: "a.domingo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Adrian", lastName: "Domingo", displayName: "Adrian Domingo", initials: "AD", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "td-035", schoolId: "scc", role: "student", email: "t.david.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Trisha", lastName: "David", displayName: "Trisha David", initials: "TD", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 9", strand: null, sectionId: "jhs-grade9-paul" },
    { id: "vp-036", schoolId: "scc", role: "student", email: "v.padilla.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Vincent", lastName: "Padilla", displayName: "Vincent Padilla", initials: "VP", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "hc-037", schoolId: "scc", role: "student", email: "h.cruz.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Helena", lastName: "Cruz", displayName: "Helena Cruz", initials: "HC", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "sa-038", schoolId: "scc", role: "student", email: "s.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Samuel", lastName: "Aquino", displayName: "Samuel Aquino", initials: "SA", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "pm-039", schoolId: "scc", role: "student", email: "p.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Patricia", lastName: "Mendoza", displayName: "Patricia Mendoza", initials: "PM", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-james" },
    { id: "ov-040", schoolId: "scc", role: "student", email: "o.valdez.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Oliver", lastName: "Valdez", displayName: "Oliver Valdez", initials: "OV", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "bb-041", schoolId: "scc", role: "student", email: "b.bautista.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bianca", lastName: "Bautista", displayName: "Bianca Bautista", initials: "BB", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "mm-042", schoolId: "scc", role: "student", email: "m.morales.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Matteo", lastName: "Morales", displayName: "Matteo Morales", initials: "MM", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "cc-043", schoolId: "scc", role: "student", email: "c.castillo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Clarisse", lastName: "Castillo", displayName: "Clarisse Castillo", initials: "CC", employeeNo: null, lrn: null, schoolLevel: "jhs", gradeLevel: "Grade 10", strand: null, sectionId: "jhs-grade10-thomas" },
    { id: "em-044", schoolId: "scc", role: "student", email: "e.manalo.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Elijah", lastName: "Manalo", displayName: "Elijah Manalo", initials: "EM", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "rs-045", schoolId: "scc", role: "student", email: "r.soriano.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rina", lastName: "Soriano", displayName: "Rina Soriano", initials: "RS", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 4", strand: null, sectionId: "elem-grade4-luke" },
    { id: "ja-046", schoolId: "scc", role: "student", email: "j.aquino.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Janelle", lastName: "Aquino", displayName: "Janelle Aquino", initials: "JA", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "cp-047", schoolId: "scc", role: "student", email: "c.pascual.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Caleb", lastName: "Pascual", displayName: "Caleb Pascual", initials: "CP", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 5", strand: null, sectionId: "elem-grade5-mark" },
    { id: "ls-048", schoolId: "scc", role: "student", email: "l.santiago.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lara", lastName: "Santiago", displayName: "Lara Santiago", initials: "LS", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "km-049", schoolId: "scc", role: "student", email: "k.mendoza.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Kyle", lastName: "Mendoza", displayName: "Kyle Mendoza", initials: "KM", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 11", strand: "STEM", sectionId: "shs-grade11-stem-a" },
    { id: "hc-050", schoolId: "scc", role: "student", email: "h.cabrera.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Hannah", lastName: "Cabrera", displayName: "Hannah Cabrera", initials: "HC", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "dv-051", schoolId: "scc", role: "student", email: "d.villarama.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Diego", lastName: "Villarama", displayName: "Diego Villarama", initials: "DV", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 11", strand: "HUMSS", sectionId: "shs-grade11-humss-a" },
    { id: "ab-052", schoolId: "scc", role: "student", email: "a.bautista2.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Amara", lastName: "Bautista", displayName: "Amara Bautista", initials: "AB", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "rg-053", schoolId: "scc", role: "student", email: "r.garcia.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Rafael", lastName: "Garcia", displayName: "Rafael Garcia", initials: "RG", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 12", strand: "ABM", sectionId: "shs-grade12-abm-a" },
    { id: "tm-054", schoolId: "scc", role: "student", email: "t.mercado.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Talia", lastName: "Mercado", displayName: "Talia Mercado", initials: "TM", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "jn-055", schoolId: "scc", role: "student", email: "j.navarro.stud@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Jonas", lastName: "Navarro", displayName: "Jonas Navarro", initials: "JN", employeeNo: null, lrn: null, schoolLevel: "shs", gradeLevel: "Grade 12", strand: "TVL", sectionId: "shs-grade12-tvl-a" },
    { id: "ar-056", schoolId: "scc", role: "student", email: "a.ramos.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Arielle", lastName: "Ramos", displayName: "Arielle Ramos", initials: "AR", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "dm-057", schoolId: "scc", role: "student", email: "d.morales.kinder@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Daniel", lastName: "Morales", displayName: "Daniel Morales", initials: "DM", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Kindergarten", strand: null, sectionId: null },
    { id: "cv-058", schoolId: "scc", role: "student", email: "c.villanueva.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Chloe", lastName: "Villanueva", displayName: "Chloe Villanueva", initials: "CV", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "er-059", schoolId: "scc", role: "student", email: "e.reyes.g1@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ethan", lastName: "Reyes", displayName: "Ethan Reyes", initials: "ER", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 1", strand: null, sectionId: null },
    { id: "bs-060", schoolId: "scc", role: "student", email: "b.santos.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Bea", lastName: "Santos", displayName: "Bea Santos", initials: "BS", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "lc-061", schoolId: "scc", role: "student", email: "l.cruz.g2@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Lorenzo", lastName: "Cruz", displayName: "Lorenzo Cruz", initials: "LC", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 2", strand: null, sectionId: null },
    { id: "fg-062", schoolId: "scc", role: "student", email: "f.garcia.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Faith", lastName: "Garcia", displayName: "Faith Garcia", initials: "FG", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "nb-063", schoolId: "scc", role: "student", email: "n.bautista.g3@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Noah", lastName: "Bautista", displayName: "Noah Bautista", initials: "NB", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 3", strand: null, sectionId: null },
    { id: "im-064", schoolId: "scc", role: "student", email: "i.mercado.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Ivy", lastName: "Mercado", displayName: "Ivy Mercado", initials: "IM", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
    { id: "mf-065", schoolId: "scc", role: "student", email: "m.flores.g6@stcolumban.edu.ph", status: "active", createdAt: "2025-06-10T00:00:00.000Z", honorific: null, firstName: "Mateo", lastName: "Flores", displayName: "Mateo Flores", initials: "MF", employeeNo: null, lrn: null, schoolLevel: "elementary", gradeLevel: "Grade 6", strand: null, sectionId: null },
  ];

  const ACTIVE_SCHOOL_ID = getActiveSchoolId();

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
    { id: 'attendance-jd-004-2025-06-13-filipino', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', date: '2025-06-13', status: 'pending', remark: null },
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
  // Completion is an array of plain objects so it can be saved as JSON and
  // replaced by an assignments API response later.
  const DEFAULT_ASSIGNMENT_DIRECTORY = [
    {
      id: 'assignment-001', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Seatwork 1: Kindness and Respect', assignedDate: '2025-06-09', dueDate: '2025-06-09',
      completion: [
        { studentId: 'cm-001', completedAt: '2025-06-09' },
        { studentId: 'lr-002', completedAt: '2025-06-09' },
        { studentId: 'sc-013', completedAt: '2025-06-09' },
        { studentId: 'gb-014', completedAt: '2025-06-09' }
      ]
    },
    {
      id: 'assignment-002', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Quiz 1 Review: Core Values', assignedDate: '2025-06-11', dueDate: '2025-06-11',
      completion: [{ studentId: 'lr-002', completedAt: '2025-06-11' }]
    },
    {
      id: 'assignment-003', schoolId: 'scc', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Activity 1: Good Citizenship', assignedDate: '2025-06-13', dueDate: '2025-06-13',
      completion: [
        { studentId: 'cm-001', completedAt: '2025-06-13' },
        { studentId: 'lr-002', completedAt: '2025-06-13' },
        { studentId: 'sc-013', completedAt: '2025-06-13' }
      ]
    },
    {
      id: 'assignment-004', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Seatwork 1: Kindness and Respect', assignedDate: '2025-06-09', dueDate: '2025-06-09',
      completion: [{ studentId: 'jd-004', completedAt: '2025-06-09' }]
    },
    {
      id: 'assignment-005', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Quiz 1 Review: Core Values', assignedDate: '2025-06-11', dueDate: '2025-06-11', completion: []
    },
    {
      id: 'assignment-006', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2',
      title: 'Activity 1: Good Citizenship', assignedDate: '2025-06-13', dueDate: '2025-06-13',
      completion: [{ studentId: 'jd-004', completedAt: '2025-06-13' }]
    },
    {
      id: 'assignment-007', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-3',
      title: 'Linear Equations Practice', assignedDate: '2025-06-12', dueDate: '2025-06-12', completion: []
    },
    {
      id: 'assignment-008', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-2',
      title: 'Reading Response: Short Stories', assignedDate: '2025-06-10', dueDate: '2025-06-10', completion: []
    }
  ];
  const savedAssignments = readJson(schoolStorageKey(STORAGE_KEYS.assignments, ACTIVE_SCHOOL_ID), null);
  const assignmentSeed = Array.isArray(savedAssignments)
    ? savedAssignments
    : clone(scopeToActiveSchool(DEFAULT_ASSIGNMENT_DIRECTORY, ACTIVE_SCHOOL_ID));
  const ASSIGNMENT_DIRECTORY = assignmentSeed
    .filter(record => (record.schoolId || ACTIVE_SCHOOL_ID) === ACTIVE_SCHOOL_ID)
    .map(record => ({
      ...record,
      schoolId: record.schoolId || ACTIVE_SCHOOL_ID,
      completion: Array.isArray(record.completion) ? record.completion : []
    }));

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
    { id: 'material-filipino-001', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: 'teacher-3', title: 'Aralin 1: Pagbasa', type: 'pdf', academicPeriodId: 'q1', postedAt: '2025-06-09T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-filipino-002', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: 'teacher-3', title: 'Gawaing Pagsulat', type: 'docx', academicPeriodId: 'q1', postedAt: '2025-06-11T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
    { id: 'material-filipino-003', schoolId: 'scc', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: 'teacher-3', title: 'Presentasyon: Tula', type: 'pptx', academicPeriodId: 'q2', postedAt: '2025-06-13T00:00:00+08:00', fileSize: null, status: 'published', visibleToStudents: true, views: 0 },
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
    { id: 'grade-jd-004-q1-filipino', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: 'teacher-carla-dizon', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-jd-004-q1-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-jd-004-q1-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: 'teacher-3', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 87, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: 'teacher-jana-mendez', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 89, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92.5, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 88.5, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-filipino', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: 'teacher-carla-dizon', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 94, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: 'teacher-3', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-jd-004-q2-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: 'teacher-jana-mendez', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-mt-012-q1-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q1-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 88, remark: 'Very Satisfactory' },
    { id: 'grade-mt-012-q1-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q1-filipino', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'filipino', teacherId: 'teacher-carla-dizon', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: 'teacher-2', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: 'teacher-9', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: 'teacher-rico-santos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-filipino', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'filipino', teacherId: 'teacher-carla-dizon', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 93, remark: 'Outstanding' }
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
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 40,
      entryText: 'This week I had a hard time understanding how to solve equations with variables on both sides. At first I kept making errors moving terms to the other side. I asked my seatmate for help and we practiced a few examples together during break, and it finally clicked after the third try. I felt proud when I got the seatwork right on my own.',
      submittedAt: '2025-06-13T13:00:00+08:00'
    },
    {
      id: 'journal-lr-002-2025-w23', schoolId: 'scc', studentId: 'lr-002', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 45,
      entryText: 'I struggled with staying focused during our long discussion about rational expressions. I kept losing track of the steps. I tried writing each step down as the teacher explained and that helped a lot. By the end of class I felt more confident about the topic.',
      submittedAt: '2025-06-13T14:00:00+08:00'
    },
    {
      id: 'journal-mt-012-2025-w23', schoolId: 'scc', studentId: 'mt-012', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-sc-013-2025-w23', schoolId: 'scc', studentId: 'sc-013', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: true, reviewed: false, score: null,
      entryText: 'The challenge I faced was finishing my activity on time. I tend to overthink each problem and I run out of time. This week I tried setting a time limit for each item, and I managed to finish before the bell. I will keep practicing this.',
      submittedAt: '2025-06-14T09:00:00+08:00'
    },
    {
      id: 'journal-gb-014-2025-w23', schoolId: 'scc', studentId: 'gb-014', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-na-015-2025-w23', schoolId: 'scc', studentId: 'na-015', teacherId: 'teacher-2', sectionId: 'jhs-grade7-matthew', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a challenge you faced this week in class and how you handled it.', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: true, late: false, reviewed: true, score: 50,
      entryText: 'I found the quiz on linear inequalities confusing because of the direction of the inequality when you divide by a negative. I reviewed my notes after class and now I understand when to flip the sign and when not to.',
      submittedAt: '2025-06-13T15:00:00+08:00'
    },
    {
      id: 'journal-jd-004-2025-w23', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      weekId: '2025-W23', week: 'Week 3', dateRange: 'June 9 to 14, 2025',
      prompt: 'Describe a moment this week when you helped a classmate or a classmate helped you. What did you learn from that experience?', isCurrent: true, isOpen: true, minWords: 50, dueLabel: 'due Friday',
      submitted: false, late: false, reviewed: false, score: null, entryText: '', submittedAt: null
    },
    {
      id: 'journal-jd-004-2025-w22', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      weekId: '2025-W22', week: 'Week 2', dateRange: 'June 2 to 7, 2025',
      prompt: 'Talk about a challenge you faced this week and how you tried to overcome it.', isCurrent: false, isOpen: false, minWords: 50, dueLabel: '',
      submitted: true, late: false, reviewed: true, score: 50,
      entryText: 'I found the quiz on linear inequalities confusing because of the direction of the inequality sign. At first I kept flipping it the wrong way whenever I multiplied or divided by a negative number. Instead of giving up, I asked Ms. Reyes to explain it again after class, and I also practiced with extra problems from the textbook. By the end of the week I felt a lot more confident, and I even helped my seatmate understand the same concept during our group activity.',
      submittedAt: '2025-06-06T21:42:00+08:00'
    },
    {
      id: 'journal-jd-004-2025-w21', schoolId: 'scc', studentId: 'jd-004', teacherId: 'teacher-2', sectionId: 'jhs-grade8-luke', subjectId: 'values-education',
      weekId: '2025-W21', week: 'Week 1', dateRange: 'May 26 to 31, 2025',
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
      id: 'report-jd-004-2025-w23', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'confirmed', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '4/4', missing: [] }, journalEntryCount: 1,
      text: 'Juan had a strong week across all his subjects. He attended all sessions and completed all 4 tracked assignments on time. His journal entry reflected positively on his progress in Algebra and noted enjoyment in group activities. No concerns to report this week. Keep up the encouragement at home!',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: '2025-06-14T08:02:00+08:00'
    },
    {
      id: 'report-et-005-2025-w23', schoolId: 'scc', studentId: 'et-005', sectionId: 'jhs-grade8-john', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: false,
      attendance: { total: '30/30', absences: [] }, assignments: { total: '3/4', missing: ['Technology and Livelihood Education'] }, journalEntryCount: 1,
      text: 'Ella had a solid week overall. She attended every session and completed 3 of 4 assignments, with one pending. Her journal reflection showed good self-awareness about time management. A gentle reminder about the missing task would be helpful.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-ml-006-2025-w23', schoolId: 'scc', studentId: 'ml-006', sectionId: 'jhs-grade9-peter', teacherId: 'teacher-2',
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
      id: 'report-bg-007-2025-w23', schoolId: 'scc', studentId: 'bg-007', sectionId: 'jhs-grade9-peter', teacherId: 'teacher-2',
      weekId: '2025-W23', weekLabel: 'Week of June 9 to 14, 2025', dateRange: 'Jun 9 to Jun 14', status: 'pending', atRisk: true,
      attendance: { total: '26/30', absences: [{ subject: 'Mathematics', day: 'Wed' }, { subject: 'Science', day: 'Wed' }, { subject: 'English', day: 'Wed' }] },
      assignments: { total: '2/4', missing: ['Mathematics', 'English'] }, journalEntryCount: 1,
      text: 'Ben is flagged as at-risk this week. He was absent in several subjects on Wednesday and completed only 2 of 4 assignments, continuing a pattern from prior weeks. His journal described feeling overwhelmed. We recommend a supportive conversation at home about pacing.',
      generatedAt: '2025-06-14T08:02:00+08:00', confirmedAt: null
    },
    {
      id: 'report-as-008-2025-w23', schoolId: 'scc', studentId: 'as-008', sectionId: 'jhs-grade10-james', teacherId: 'teacher-2',
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
      id: 'report-jd-004-2025-w22', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-2',
      weekId: '2025-W22', weekLabel: 'Week of June 2 to 7, 2025', dateRange: 'Jun 2 to Jun 7', status: 'confirmed', atRisk: true,
      attendance: { total: '28/30', absences: [{ subject: 'All subjects', day: 'Tue' }, { subject: 'All subjects', day: 'Thu' }] }, assignments: { total: '2/4', missing: ['Science', 'Filipino'] }, journalEntryCount: 1,
      text: 'Juan is flagged as at-risk this week. He was absent on Tuesday and Thursday and completed only 2 of 4 assignments. We recommend a check-in at home regarding his recent attendance and a brief conversation about any challenges he may be facing.',
      generatedAt: '2025-06-07T07:45:00+08:00', confirmedAt: '2025-06-07T07:45:00+08:00'
    },
    {
      id: 'report-jd-004-2025-w21', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', teacherId: 'teacher-2',
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

  const savedUsers = readJson(schoolStorageKey(STORAGE_KEYS.users, ACTIVE_SCHOOL_ID), null);
  const USERS = Array.isArray(savedUsers) && savedUsers.length
    ? savedUsers
    : clone(DEFAULT_USERS.filter(user => user.schoolId === ACTIVE_SCHOOL_ID));
  const USER_STORAGE_KEY = schoolStorageKey(STORAGE_KEYS.users, ACTIVE_SCHOOL_ID);

  const DEFAULT_PARENT_STUDENT_LINKS = [
    { id: 'parent-student-parent-7-jd-004', schoolId: 'scc', parentId: 'parent-7', studentId: 'jd-004' },
    { id: 'parent-student-parent-8-mt-012', schoolId: 'scc', parentId: 'parent-8', studentId: 'mt-012' }
  ];
  const savedParentStudentLinks = readJson(
    schoolStorageKey(STORAGE_KEYS.parentStudentLinks, ACTIVE_SCHOOL_ID),
    null
  );
  const PARENT_STUDENT_LINKS = Array.isArray(savedParentStudentLinks)
    ? savedParentStudentLinks
    : clone(DEFAULT_PARENT_STUDENT_LINKS);

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

  function setParentStudentLinks(parentId, studentIds = []) {
    const parent = getUserById(parentId);
    if (!parent || parent.role !== RECORD_VALUES.roles.PARENT) return [];

    for (let index = PARENT_STUDENT_LINKS.length - 1; index >= 0; index -= 1) {
      if (PARENT_STUDENT_LINKS[index].parentId === parent.id) PARENT_STUDENT_LINKS.splice(index, 1);
    }

    studentIds
      .map(String)
      .filter(studentId => USERS.some(user => user.id === studentId && user.role === RECORD_VALUES.roles.STUDENT))
      .forEach(studentId => PARENT_STUDENT_LINKS.push({
        id: `parent-student-${parent.id}-${studentId}`,
        schoolId: getActiveSchoolId(),
        parentId: parent.id,
        studentId
      }));

    writeJson(schoolStorageKey(STORAGE_KEYS.parentStudentLinks), PARENT_STUDENT_LINKS);
    return getParentStudentLinks();
  }

  function createUser(values = {}) {
    const role = ROLE_ALIASES[values.role] || values.role || RECORD_VALUES.roles.STUDENT;
    const firstName = String(values.firstName || '').trim();
    const lastName = String(values.lastName || '').trim();
    const displayName = String(values.displayName || values.name || [values.honorific, firstName, lastName].filter(Boolean).join(' ')).trim();
    const isStudent = role === RECORD_VALUES.roles.STUDENT;
    const isStaff = role === RECORD_VALUES.roles.SCHOOL_ADMIN || role === RECORD_VALUES.roles.TEACHER;
    const user = {
      id: String(values.studentId || values.id || `${role}-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      role,
      email: String(values.email || '').trim(),
      status: values.status || RECORD_VALUES.statuses.ACTIVE,
      createdAt: values.createdAt || new Date().toISOString(),
      honorific: isStaff ? values.honorific ?? null : null,
      firstName,
      lastName,
      displayName,
      initials: values.initials || getInitials(displayName),
      employeeNo: isStaff
        ? values.employeeNo ?? null
        : null,
      lrn: isStudent ? values.lrn ?? null : null,
      schoolLevel: isStudent ? values.schoolLevel ?? values.level ?? null : null,
      gradeLevel: isStudent ? values.gradeLevel ?? values.grade ?? null : null,
      strand: isStudent ? values.strand ?? null : null,
      sectionId: isStudent ? values.sectionId ?? null : null
    };

    USERS.push(user);
    saveUsers();
    return user;
  }

  function updateUser(userId, values = {}) {
    const user = getUserById(userId);
    if (!user) return null;

    const fields = [
      'role', 'email', 'status', 'honorific', 'firstName', 'lastName',
      'displayName', 'initials', 'employeeNo', 'lrn', 'schoolLevel',
      'gradeLevel', 'strand', 'sectionId'
    ];
    fields.forEach(field => {
      if (!Object.hasOwn(values, field)) return;
      if (field === 'role') user.role = ROLE_ALIASES[values.role] || values.role;
      else if (field === 'email') user.email = String(values.email || '').trim();
      else user[field] = values[field];
    });

    const isStudent = user.role === RECORD_VALUES.roles.STUDENT;
    const isStaff = user.role === RECORD_VALUES.roles.SCHOOL_ADMIN || user.role === RECORD_VALUES.roles.TEACHER;
    user.honorific = isStaff ? user.honorific ?? null : null;
    user.employeeNo = isStaff ? user.employeeNo ?? null : null;
    user.lrn = isStudent ? user.lrn ?? null : null;
    user.schoolLevel = isStudent ? user.schoolLevel ?? null : null;
    user.gradeLevel = isStudent ? user.gradeLevel ?? null : null;
    user.strand = isStudent ? user.strand ?? null : null;
    user.sectionId = isStudent ? user.sectionId ?? null : null;

    saveUsers();
    return user;
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
      record.teacherId === String(teacherId) &&
      (!sectionId || record.sectionId === String(sectionId))
    );
  }

  function saveJournals(records = JOURNAL_DIRECTORY) {
    writeJson(schoolStorageKey(STORAGE_KEYS.journals), Array.isArray(records) ? records : []);
  }

  function updateJournalEntry(entryId, values = {}) {
    const entry = JOURNAL_DIRECTORY.find(record => record.id === String(entryId));
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
    return REPORT_DIRECTORY
      .filter(record => record.teacherId === String(teacherId) && (!weekId || record.weekId === weekId))
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
    parentStudentLinks: PARENT_STUDENT_LINKS,
    getUsers,
    getUsersByRole,
    getStudents,
    getUserById,
    getParentStudentLinks,
    createUser,
    updateUser,
    deleteUser,
    saveUsers,
    setParentStudentLinks,
    periods: PERIOD_CATALOG,
    attendanceDefaults: makeAttendanceRules(),
    attendance: ATTENDANCE_DIRECTORY,
    getAttendanceRecords,
    getAttendanceForStudent,
    saveAttendanceRecords,
    upsertAttendanceRecord,
    getSchools,
    saveSchools,
    getActiveSchool,
    setActiveSchool,
    getSchoolTypeInfo,
    isGradesPageEnabled,
    isNarrativeReportsEnabled,
    getConfiguredSubjects,
    getJournalSubject,
    isJournalsEnabled,
    getAssignmentSections,
    assignments: ASSIGNMENT_DIRECTORY,
    getAssignments,
    getAssignmentsForSection,
    getAssignmentsForStudent,
    saveAssignments,
    createAssignment,
    setAssignmentCompletion,
    learningMaterials: LEARNING_MATERIAL_DIRECTORY,
    getLearningMaterials,
    getLearningMaterialsForSection,
    getLearningMaterialsForStudent,
    saveLearningMaterials,
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
  localStorage.clear(); // wipes mock data (reopen requests, read-state, etc.)
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

function renderNoClassNotice() {
  if (document.body?.dataset.platformPortal === 'true') return;
  const pageName = location.pathname.split('/').pop().toLowerCase();
  if (!/(dashboard|notifications)\.html$/.test(pageName)) return;

  const main = document.querySelector('.main');
  if (!main || main.querySelector('[data-system-day-banner]')) return;

  const noClassDay = window.EDUGNAY_CONFIG.getNoClassDay();
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
  applyGradePortalAccess();
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
function initScrollFades() {
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
  applyActiveSchoolToShell();
  applyGradePortalAccess();
  renderNoClassNotice();
  applyPageTitleToTopbar();
  initScrollFades();
  initSidebarScrollbars();
});
