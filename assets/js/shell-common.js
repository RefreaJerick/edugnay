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
    accounts: 'edugnay_accounts',
    students: 'edugnay_students',
    adminProfiles: 'edugnay_admin_profiles',
    teacherProfiles: 'edugnay_teacher_profiles',
    studentProfiles: 'edugnay_student_profiles',
    parentProfiles: 'edugnay_parent_profiles',
    parentStudentLinks: 'edugnay_parent_student_links',
    assignments: 'edugnay_assignments',
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
    const teacher = USER_DIRECTORY.find(item => item.profileId === record.teacherId);
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
    const student = STUDENT_DIRECTORY.find(record => record.id === String(studentId));
    if (!student) return [];
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

  function gradeWithLabels(record) {
    const subject = SUBJECT_CATALOG.find(item => item.id === record.subjectId);
    const teacher = USER_DIRECTORY.find(item => item.profileId === record.teacherId);
    return {
      ...record,
      name: subject?.name || record.subjectName || '',
      teacher: teacher?.displayName || record.teacherName || ''
    };
  }

  function getGradesForStudent(studentId, schoolYear = null) {
    const student = STUDENT_DIRECTORY.find(record => record.id === String(studentId));
    if (!student) return [];

    const periodLabels = PERIOD_CATALOG[student.level] || PERIOD_CATALOG.jhs;
    const periods = periodLabels.map((label, index) => ({
      id: student.level === 'shs' ? `semester-${index + 1}` : `q${index + 1}`,
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
      image: record.imageUrl || record.image || null
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

  // Shared non-student accounts.
  const CORE_ACCOUNT_DIRECTORY = [
    { id: '1', schoolId: 'scc', email: 'admin.adm@stcolumban.edu.ph', role: RECORD_VALUES.roles.SCHOOL_ADMIN, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2025-01-06T00:00:00.000Z' },
    { id: '2', schoolId: 'scc', email: 'm.reyes.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    { id: '3', schoolId: 'scc', email: 'p.tan.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2025-05-20T00:00:00.000Z' },
    { id: '11', schoolId: 'scc', email: 'c.dizon.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    { id: '12', schoolId: 'scc', email: 'r.santos.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    { id: '13', schoolId: 'scc', email: 'j.mendez.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    { id: '14', schoolId: 'scc', email: 'a.garcia.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    { id: '7', schoolId: 'scc', email: 'r.lim.parents@stcolumban.edu.ph', role: RECORD_VALUES.roles.PARENT, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-05T00:00:00.000Z' },
    { id: '8', schoolId: 'scc', email: 'e.cruz.parents@stcolumban.edu.ph', role: RECORD_VALUES.roles.PARENT, status: RECORD_VALUES.statuses.INACTIVE, createdAt: '2025-05-24T00:00:00.000Z' },
    { id: '9', schoolId: 'scc', email: 'l.villanueva.fac@stcolumban.edu.ph', role: RECORD_VALUES.roles.TEACHER, status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' }
  ];

  const CORE_PROFILE_DIRECTORY = [
    { id: 'admin-1', accountId: '1', role: RECORD_VALUES.roles.SCHOOL_ADMIN, honorific: null, firstName: 'Sr.', lastName: 'Admin', displayName: 'Sr. Admin', employeeNo: 'ADM-2016-0001' },
    { id: 'teacher-2', accountId: '2', role: RECORD_VALUES.roles.TEACHER, honorific: 'Ms.', firstName: 'Maria', lastName: 'Reyes', displayName: 'Ms. Maria Reyes', employeeNo: 'FAC-2019-0042' },
    { id: 'teacher-3', accountId: '3', role: RECORD_VALUES.roles.TEACHER, honorific: 'Mr.', firstName: 'Paolo', lastName: 'Tan', displayName: 'Mr. Paolo Tan', employeeNo: 'FAC-2021-0017' },
    { id: 'teacher-carla-dizon', accountId: '11', role: RECORD_VALUES.roles.TEACHER, honorific: 'Ms.', firstName: 'Carla', lastName: 'Dizon', displayName: 'Ms. Carla Dizon', employeeNo: 'FAC-2020-0028' },
    { id: 'teacher-rico-santos', accountId: '12', role: RECORD_VALUES.roles.TEACHER, honorific: 'Mr.', firstName: 'Rico', lastName: 'Santos', displayName: 'Mr. Rico Santos', employeeNo: 'FAC-2019-0064' },
    { id: 'teacher-jana-mendez', accountId: '13', role: RECORD_VALUES.roles.TEACHER, honorific: 'Ms.', firstName: 'Jana', lastName: 'Mendez', displayName: 'Ms. Jana Mendez', employeeNo: 'FAC-2022-0013' },
    { id: 'teacher-ana-garcia', accountId: '14', role: RECORD_VALUES.roles.TEACHER, honorific: 'Ms.', firstName: 'Ana', lastName: 'Garcia', displayName: 'Ms. Ana Garcia', employeeNo: 'FAC-2021-0049' },
    { id: 'parent-7', accountId: '7', role: RECORD_VALUES.roles.PARENT, honorific: null, firstName: 'Rosa', lastName: 'Lim', displayName: 'Rosa Lim' },
    { id: 'parent-8', accountId: '8', role: RECORD_VALUES.roles.PARENT, honorific: null, firstName: 'Elena', lastName: 'Cruz', displayName: 'Elena Cruz' },
    { id: 'teacher-9', accountId: '9', role: RECORD_VALUES.roles.TEACHER, honorific: 'Ms.', firstName: 'Lara', lastName: 'Villanueva', displayName: 'Ms. Lara Villanueva', employeeNo: 'FAC-2018-0031' }
  ].map(profile => ({ ...profile, schoolId: 'scc' }));

  // Shared K-12 student collection. Replace this local array with the
  // school's student API response while keeping its record shape unchanged.
  const DEFAULT_STUDENT_DIRECTORY = [
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
  ].map(record => ({ ...record, schoolId: 'scc' }));

  const ACTIVE_SCHOOL_ID = getActiveSchoolId();

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

  // Shared published/draft announcement records for every school portal.
  // Portal pages read this collection with an audience key; Admin can read
  // all records, including drafts, for management.
  const DEFAULT_ANNOUNCEMENT_DIRECTORY = [
    {
      id: 'ANN-001', schoolId: 'scc', title: 'Q2 Grade Encoding Deadline: June 14',
      body: 'All subject teachers are required to complete encoding of Q2 grades no later than <strong>June 14, 2025</strong>. Please coordinate with your section adviser for any discrepancies before the deadline.',
      priority: 'high', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-14T08:00:00+08:00',
      status: 'published', pinned: true, icon: 'alert-triangle', iconClass: 'icon-high', tag: 'Urgent', read: false, seenCount: 284,
      imageUrl: '../../assets/uploads/announcements/ChatGPT Image Jun 13, 2026, 10_21_57 PM.png'
    },
    {
      id: 'ANN-002', schoolId: 'scc', title: 'Journal Submission Window: This Friday',
      body: 'The weekly journal submission window will open this <strong>Friday, June 7</strong>. Please remind your students to submit their entries before 11:59 PM. Late submissions will not be accepted for this week.',
      priority: 'normal', audience: ['teachers'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-06-13T15:00:00+08:00',
      status: 'published', icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: false, access: 'journals', seenCount: 24
    },
    {
      id: 'ANN-003', schoolId: 'scc', title: 'Foundation Day: June 20, 2025',
      body: 'St. Columban\'s College will celebrate its <strong>Foundation Day on June 20, 2025</strong>. Classes will be suspended for the day. All students are encouraged to participate in the school activities.',
      priority: 'event', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-30T10:00:00+08:00',
      status: 'published', icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 312
    },
    {
      id: 'ANN-004', schoolId: 'scc', title: 'Q2 Narrative Reports Now Available',
      body: 'Q2 narrative reports have been confirmed by section teachers and are now available to view in the portal. Please review the summaries for your assigned sections or linked children.',
      priority: 'normal', audience: ['teachers', 'parents'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-28T09:00:00+08:00',
      status: 'published', icon: 'file-text', iconClass: 'icon-normal', tag: 'Normal', read: true, access: 'reports', seenCount: 198
    },
    {
      id: 'ANN-005', schoolId: 'scc', title: 'Weekly Journal is Now Open for Submission',
      body: 'This week\'s journal submission is now open. Please write about your week, your experiences, feelings, and anything you want to share. Submissions close <strong>Friday at 11:59 PM</strong>.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-24T07:00:00+08:00',
      status: 'published', icon: 'pencil', iconClass: 'icon-normal', tag: 'Normal', read: true, access: 'journals', seenCount: 253
    },
    {
      id: 'ANN-006', schoolId: 'scc', title: 'End of Quarter Reminder: Q2 Closing',
      body: 'This announcement is saved as a draft and is not yet visible to any users. Click Edit to review and publish it.',
      priority: 'low', audience: ['all'], authorId: 'admin-1', authorName: 'Sr. Admin', createdAt: '2025-05-22T16:30:00+08:00',
      status: 'draft', icon: 'file-edit', iconClass: 'icon-low', tag: 'Draft', read: true, seenCount: 0
    },
    {
      id: 'ANN-007', schoolId: 'scc', title: 'Intramurals Sign-up Open',
      body: 'Visit the Student Affairs table during recess this week to join a sports team for the upcoming intramurals. Sign-ups close <strong>Friday</strong>.',
      priority: 'event', audience: ['students'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-12T13:30:00+08:00',
      status: 'published', icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: false, seenCount: 0
    },
    {
      id: 'ANN-008', schoolId: 'scc', title: 'Library Resources Updated',
      body: 'New reference materials are now available in the student library corner.',
      priority: 'normal', audience: ['students'], authorId: 'admin-1', authorName: 'Library', createdAt: '2025-06-10T10:00:00+08:00',
      status: 'published', icon: 'book-open', iconClass: 'icon-normal', tag: 'Normal', read: true, seenCount: 0
    },
    {
      id: 'ANN-009', schoolId: 'scc', title: 'Parent-Teacher Conference Schedule',
      body: 'Parent-Teacher Conferences for Q2 are scheduled for <strong>June 27, 2025</strong>, 8:00 AM to 4:00 PM. Please coordinate with your child\'s adviser for a specific time slot.',
      priority: 'event', audience: ['parents'], authorId: 'admin-1', authorName: 'Admin', createdAt: '2025-06-11T09:00:00+08:00',
      status: 'published', icon: 'calendar', iconClass: 'icon-event', tag: 'Event', read: true, seenCount: 0
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
      status: record.status || 'published'
    }));

  // Shared final grade records for Student and Parent portals. Each row uses
  // stable IDs so the local source can later be replaced by a grades API.
  const DEFAULT_GRADE_DIRECTORY = [
    { id: 'grade-jd-004-q1-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', teacherName: 'Ms. Maria Reyes', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 89, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: null, teacherName: 'Mr. Paolo Santos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 87, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: null, teacherName: 'Mrs. Liza Ramos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 88, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-filipino', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: null, teacherName: 'Mr. Andres Cruz', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-jd-004-q1-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', teacherName: 'Ms. Maria Reyes', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-jd-004-q1-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: null, teacherName: 'Mrs. Carmen Reyes', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 87, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q1-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: null, teacherName: 'Mr. Jun Bautista', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 89, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-mathematics', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mathematics', teacherId: 'teacher-2', teacherName: 'Ms. Maria Reyes', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92.5, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-english', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'english', teacherId: null, teacherName: 'Mr. Paolo Santos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-science', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'science', teacherId: null, teacherName: 'Mrs. Liza Ramos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 88.5, remark: 'Very Satisfactory' },
    { id: 'grade-jd-004-q2-filipino', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'filipino', teacherId: null, teacherName: 'Mr. Andres Cruz', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-values-education', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'values-education', teacherId: 'teacher-2', teacherName: 'Ms. Maria Reyes', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 94, remark: 'Outstanding' },
    { id: 'grade-jd-004-q2-araling-panlipunan', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'araling-panlipunan', teacherId: null, teacherName: 'Mrs. Carmen Reyes', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-jd-004-q2-mapeh', schoolId: 'scc', studentId: 'jd-004', sectionId: 'jhs-grade8-luke', subjectId: 'mapeh', teacherId: null, teacherName: 'Mr. Jun Bautista', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: null, remark: 'Pending release' },
    { id: 'grade-mt-012-q1-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: null, teacherName: 'Mrs. Joy Fernandez', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q1-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: null, teacherName: 'Mrs. Joy Fernandez', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 88, remark: 'Very Satisfactory' },
    { id: 'grade-mt-012-q1-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: null, teacherName: 'Mr. Noel Garcia', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q1-filipino', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'filipino', teacherId: null, teacherName: 'Ms. Ana Ramos', schoolYear: '2025-2026', academicPeriodId: 'q1', academicPeriodLabel: 'Quarter 1', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-mathematics', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'mathematics', teacherId: null, teacherName: 'Mrs. Joy Fernandez', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 92, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-english', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'english', teacherId: null, teacherName: 'Mrs. Joy Fernandez', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 90, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-science', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'science', teacherId: null, teacherName: 'Mr. Noel Garcia', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 91, remark: 'Outstanding' },
    { id: 'grade-mt-012-q2-filipino', schoolId: 'scc', studentId: 'mt-012', sectionId: 'jhs-grade7-matthew', subjectId: 'filipino', teacherId: null, teacherName: 'Ms. Ana Ramos', schoolYear: '2025-2026', academicPeriodId: 'q2', academicPeriodLabel: 'Quarter 2', academicPeriodStatus: 'final', score: 93, remark: 'Outstanding' }
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

  const savedStudents = readJson(
    schoolStorageKey(STORAGE_KEYS.students, ACTIVE_SCHOOL_ID),
    ACTIVE_SCHOOL_ID === 'scc' ? readJson(STORAGE_KEYS.students, null) : null
  );
  const STUDENT_SEED_DIRECTORY = Array.isArray(savedStudents)
    ? savedStudents
    : clone(scopeToActiveSchool(DEFAULT_STUDENT_DIRECTORY, ACTIVE_SCHOOL_ID));

  // Legacy saved learner records may contain a section label. Convert it once
  // to the same sectionId used by new frontend records and future API data.
  const assignmentSections = getAssignmentSections(getActiveSchool());
  STUDENT_SEED_DIRECTORY.forEach(student => {
    student.id = String(student.id);
    student.schoolId = ACTIVE_SCHOOL_ID;
    student.grade ||= null;
    student.strand ||= null;
    if (!student.sectionId && student.section && !/^unassigned$/i.test(student.section)) {
      const section = assignmentSections.find(record => `${record.grade} / ${record.name}` === student.section);
      student.sectionId = section?.id || null;
    }
    student.sectionId ||= null;
    delete student.section;
  });

  const STUDENT_ACCOUNT_OVERRIDES = {
    'j.delacruz.stud@stcolumban.edu.ph': { id: '4', status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    'a.santos.stud@stcolumban.edu.ph': { id: '5', status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2025-05-26T00:00:00.000Z' },
    'b.garcia.stud@stcolumban.edu.ph': { id: '6', status: RECORD_VALUES.statuses.INACTIVE, createdAt: '2024-06-03T00:00:00.000Z' },
    'c.mendoza.stud@stcolumban.edu.ph': { id: '10', status: RECORD_VALUES.statuses.ACTIVE, createdAt: '2024-06-03T00:00:00.000Z' }
  };

  function splitAccountName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') };
  }

  function formatAccountGrade(value) {
    const grade = String(value || '').trim();
    return grade && !/^unassigned$/i.test(grade) ? grade : null;
  }

  // Every person who can use the portal has one account. Student accounts are
  // built from the shared learner directory so the Users page, Dashboard, and
  // Class Management all begin with the same source of truth.
  const DEFAULT_ACCOUNT_DIRECTORY = [
    ...scopeToActiveSchool(CORE_ACCOUNT_DIRECTORY, ACTIVE_SCHOOL_ID),
    ...STUDENT_SEED_DIRECTORY.map(student => {
      const override = STUDENT_ACCOUNT_OVERRIDES[student.email] || {};
      return {
        id: override.id || `student-${student.id}`,
        schoolId: ACTIVE_SCHOOL_ID,
        email: student.email,
        role: RECORD_VALUES.roles.STUDENT,
        status: override.status || RECORD_VALUES.statuses.ACTIVE,
        createdAt: override.createdAt || '2025-06-10T00:00:00.000Z'
      };
    })
  ];

  const LEGACY_ACCOUNT_ROLES = {
    admin: RECORD_VALUES.roles.SCHOOL_ADMIN,
    fac: RECORD_VALUES.roles.TEACHER,
    stud: RECORD_VALUES.roles.STUDENT,
    par: RECORD_VALUES.roles.PARENT
  };
  const savedAccounts = readJson(
    schoolStorageKey(STORAGE_KEYS.accounts, ACTIVE_SCHOOL_ID),
    ACTIVE_SCHOOL_ID === 'scc' ? readJson(STORAGE_KEYS.accounts, null) : null
  );
  const sourceUsers = Array.isArray(savedAccounts)
    ? [
      ...savedAccounts,
      ...DEFAULT_ACCOUNT_DIRECTORY.filter(defaultAccount => (
        defaultAccount.role === RECORD_VALUES.roles.TEACHER
        && !savedAccounts.some(account => String(account.id) === String(defaultAccount.id))
      ))
    ]
    : clone(DEFAULT_ACCOUNT_DIRECTORY);

  // Accounts contain login and access fields only. Role-specific information
  // lives in the profile collections below.
  const ACCOUNT_DIRECTORY = sourceUsers.map(record => ({
    id: String(record.id),
    schoolId: ACTIVE_SCHOOL_ID,
    email: record.email || '',
    role: LEGACY_ACCOUNT_ROLES[record.role] || record.role,
    status: record.status || RECORD_VALUES.statuses.ACTIVE,
    createdAt: record.createdAt || (record.dateAdded ? new Date(record.dateAdded).toISOString() : null)
  }));

  function storedProfiles(key, defaults) {
    const saved = readJson(schoolStorageKey(key, ACTIVE_SCHOOL_ID), null);
    if (!Array.isArray(saved)) return defaults;
    return [
      ...saved,
      ...defaults.filter(profile => !saved.some(item => String(item.accountId) === String(profile.accountId)))
    ];
  }

  const defaultAdminProfiles = ACCOUNT_DIRECTORY
    .filter(account => account.role === RECORD_VALUES.roles.SCHOOL_ADMIN)
    .map(account => {
      const seed = CORE_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id) || {};
      const source = { ...seed, ...(sourceUsers.find(record => String(record.id) === account.id) || {}) };
      return { id: seed.id || `admin-${account.id}`, schoolId: ACTIVE_SCHOOL_ID, accountId: account.id, honorific: source.honorific || null, firstName: source.firstName || '', lastName: source.lastName || '', displayName: source.displayName || [source.honorific, source.firstName, source.lastName].filter(Boolean).join(' '), employeeNo: source.employeeNo || null };
    });
  const defaultTeacherProfiles = ACCOUNT_DIRECTORY
    .filter(account => account.role === RECORD_VALUES.roles.TEACHER)
    .map(account => {
      const seed = CORE_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id) || {};
      const source = { ...seed, ...(sourceUsers.find(record => String(record.id) === account.id) || {}) };
      return { id: seed.id || `teacher-${account.id}`, schoolId: ACTIVE_SCHOOL_ID, accountId: account.id, honorific: source.honorific || null, firstName: source.firstName || '', lastName: source.lastName || '', displayName: source.displayName || [source.honorific, source.firstName, source.lastName].filter(Boolean).join(' '), employeeNo: source.employeeNo || null };
    });
  const defaultParentProfiles = ACCOUNT_DIRECTORY
    .filter(account => account.role === RECORD_VALUES.roles.PARENT)
    .map(account => {
      const seed = CORE_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id) || {};
      const source = { ...seed, ...(sourceUsers.find(record => String(record.id) === account.id) || {}) };
      return { id: seed.id || `parent-${account.id}`, schoolId: ACTIVE_SCHOOL_ID, accountId: account.id, honorific: source.honorific || null, firstName: source.firstName || '', lastName: source.lastName || '', displayName: source.displayName || [source.honorific, source.firstName, source.lastName].filter(Boolean).join(' ') };
    });
  const defaultStudentProfiles = STUDENT_SEED_DIRECTORY.map(student => {
    const account = ACCOUNT_DIRECTORY.find(record => record.email === student.email);
    const names = splitAccountName(student.name);
    return {
      id: String(student.id),
      schoolId: ACTIVE_SCHOOL_ID,
      accountId: account?.id || null,
      honorific: null,
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: student.name,
      initials: student.initials || getInitials(student.name),
      lrn: sourceUsers.find(record => String(record.id) === account?.id)?.lrn || null,
      schoolLevel: student.level || null,
      gradeLevel: formatAccountGrade(student.grade),
      strand: student.strand || null,
      sectionId: student.sectionId || null
    };
  });

  const ADMIN_PROFILE_DIRECTORY = storedProfiles(STORAGE_KEYS.adminProfiles, defaultAdminProfiles);
  const TEACHER_PROFILE_DIRECTORY = storedProfiles(STORAGE_KEYS.teacherProfiles, defaultTeacherProfiles);
  const STUDENT_PROFILE_DIRECTORY = storedProfiles(STORAGE_KEYS.studentProfiles, defaultStudentProfiles);
  const PARENT_PROFILE_DIRECTORY = storedProfiles(STORAGE_KEYS.parentProfiles, defaultParentProfiles);

  const legacyStudentIds = { 'STU-J-LIM': 'jd-004', 'STU-M-CRUZ': 'mt-012' };
  const legacyParentStudentLinks = sourceUsers
    .filter(record => (LEGACY_ACCOUNT_ROLES[record.role] || record.role) === RECORD_VALUES.roles.PARENT)
    .flatMap(record => {
      const parent = PARENT_PROFILE_DIRECTORY.find(profile => profile.accountId === String(record.id));
      return (record.linkedStudents || []).map(link => {
        const studentId = legacyStudentIds[link.studentId || link.id] || String(link.studentId || link.id);
        return { id: `parent-student-${parent?.id}-${studentId}`, schoolId: ACTIVE_SCHOOL_ID, parentId: parent?.id || null, studentId };
      });
    });
  const defaultParentStudentLinks = legacyParentStudentLinks.length ? legacyParentStudentLinks : [
    { id: 'parent-student-parent-7-jd-004', schoolId: ACTIVE_SCHOOL_ID, parentId: 'parent-7', studentId: 'jd-004' },
    { id: 'parent-student-parent-8-mt-012', schoolId: ACTIVE_SCHOOL_ID, parentId: 'parent-8', studentId: 'mt-012' }
  ].filter(link => PARENT_PROFILE_DIRECTORY.some(parent => parent.id === link.parentId));
  const PARENT_STUDENT_LINKS = storedProfiles(STORAGE_KEYS.parentStudentLinks, defaultParentStudentLinks);

  const USER_DIRECTORY = [];
  const STUDENT_DIRECTORY = [];

  function profileForAccount(account) {
    if (account.role === RECORD_VALUES.roles.SCHOOL_ADMIN) return ADMIN_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id);
    if (account.role === RECORD_VALUES.roles.TEACHER) return TEACHER_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id);
    if (account.role === RECORD_VALUES.roles.STUDENT) return STUDENT_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id);
    if (account.role === RECORD_VALUES.roles.PARENT) return PARENT_PROFILE_DIRECTORY.find(profile => profile.accountId === account.id);
    return null;
  }

  function refreshUserDirectories() {
    const sections = getAssignmentSections(getActiveSchool());
    const students = STUDENT_PROFILE_DIRECTORY.map(profile => {
      const account = ACCOUNT_DIRECTORY.find(record => record.id === profile.accountId);
      const section = sections.find(record => record.id === profile.sectionId);
      return {
        id: profile.id,
        studentId: profile.id,
        accountId: profile.accountId,
        schoolId: profile.schoolId,
        name: profile.displayName,
        displayName: profile.displayName,
        email: account?.email || '',
        initials: profile.initials,
        level: profile.schoolLevel,
        schoolLevel: profile.schoolLevel,
        grade: profile.gradeLevel,
        gradeLevel: profile.gradeLevel,
        strand: profile.strand,
        sectionId: profile.sectionId,
        section: section ? `${section.grade} / ${section.name}` : null,
        lrn: profile.lrn
      };
    });
    STUDENT_DIRECTORY.splice(0, STUDENT_DIRECTORY.length, ...students);

    const users = ACCOUNT_DIRECTORY.map(account => {
      const profile = profileForAccount(account) || {};
      const student = STUDENT_DIRECTORY.find(record => record.accountId === account.id);
      const parentLinks = account.role === RECORD_VALUES.roles.PARENT
        ? PARENT_STUDENT_LINKS.filter(link => link.parentId === profile.id)
        : [];
      return {
        ...account,
        accountId: account.id,
        profileId: profile.id || null,
        honorific: profile.honorific || null,
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        displayName: profile.displayName || account.email,
        employeeNo: profile.employeeNo || null,
        studentId: student?.id || null,
        lrn: student?.lrn || null,
        sectionId: student?.sectionId || null,
        section: student?.section || null,
        gradeLevel: student?.gradeLevel || null,
        linkedStudents: parentLinks.map(link => {
          const linked = STUDENT_DIRECTORY.find(record => record.id === link.studentId);
          return { studentId: link.studentId, name: linked?.name || 'Student', section: linked?.section || null, gradeLevel: linked?.gradeLevel || null };
        })
      };
    });
    USER_DIRECTORY.splice(0, USER_DIRECTORY.length, ...users);
  }

  function profileDirectory(role) {
    if (role === RECORD_VALUES.roles.SCHOOL_ADMIN) return ADMIN_PROFILE_DIRECTORY;
    if (role === RECORD_VALUES.roles.TEACHER) return TEACHER_PROFILE_DIRECTORY;
    if (role === RECORD_VALUES.roles.STUDENT) return STUDENT_PROFILE_DIRECTORY;
    if (role === RECORD_VALUES.roles.PARENT) return PARENT_PROFILE_DIRECTORY;
    return null;
  }

  function removeUserProfile(accountId, role) {
    const directory = profileDirectory(role);
    if (!directory) return;
    const index = directory.findIndex(profile => profile.accountId === String(accountId));
    if (index >= 0) {
      const [profile] = directory.splice(index, 1);
      if (role === RECORD_VALUES.roles.PARENT) {
        for (let linkIndex = PARENT_STUDENT_LINKS.length - 1; linkIndex >= 0; linkIndex -= 1) {
          if (PARENT_STUDENT_LINKS[linkIndex].parentId === profile.id) PARENT_STUDENT_LINKS.splice(linkIndex, 1);
        }
      }
      if (role === RECORD_VALUES.roles.STUDENT) {
        for (let linkIndex = PARENT_STUDENT_LINKS.length - 1; linkIndex >= 0; linkIndex -= 1) {
          if (PARENT_STUDENT_LINKS[linkIndex].studentId === profile.id) PARENT_STUDENT_LINKS.splice(linkIndex, 1);
        }
      }
    }
    refreshUserDirectories();
  }

  function upsertUserProfile(account, values = {}) {
    if (!account) return null;
    if (account.role === RECORD_VALUES.roles.STUDENT) return upsertStudentProfile(account, values);
    const directory = profileDirectory(account.role);
    if (!directory) return null;
    const index = directory.findIndex(profile => profile.accountId === account.id);
    const current = index >= 0 ? directory[index] : {};
    const firstName = values.firstName ?? current.firstName ?? '';
    const lastName = values.lastName ?? current.lastName ?? '';
    const honorific = values.honorific ?? current.honorific ?? null;
    const profilePrefix = account.role === RECORD_VALUES.roles.SCHOOL_ADMIN ? 'admin' : account.role;
    const profile = {
      ...current,
      id: current.id || `${profilePrefix}-${account.id}`,
      schoolId: account.schoolId,
      accountId: account.id,
      honorific,
      firstName,
      lastName,
      displayName: values.displayName || [honorific, firstName, lastName].filter(Boolean).join(' ')
    };
    if (account.role === RECORD_VALUES.roles.SCHOOL_ADMIN || account.role === RECORD_VALUES.roles.TEACHER) {
      profile.employeeNo = values.employeeNo ?? current.employeeNo ?? null;
    }
    if (index >= 0) directory[index] = profile;
    else directory.push(profile);
    refreshUserDirectories();
    return profile;
  }

  function upsertStudentProfile(account, values = {}) {
    if (!account || account.role !== RECORD_VALUES.roles.STUDENT) return null;
    const index = STUDENT_PROFILE_DIRECTORY.findIndex(profile => profile.accountId === account.id);
    const current = index >= 0 ? STUDENT_PROFILE_DIRECTORY[index] : {};
    const firstName = values.firstName ?? current.firstName ?? '';
    const lastName = values.lastName ?? current.lastName ?? '';
    const displayName = values.displayName || values.name || current.displayName || [firstName, lastName].filter(Boolean).join(' ');
    const profile = {
      ...current,
      id: current.id || values.studentId || `student-${account.id}`,
      schoolId: account.schoolId,
      accountId: account.id,
      honorific: null,
      firstName,
      lastName,
      displayName,
      initials: values.initials || current.initials || getInitials(displayName),
      lrn: values.lrn ?? current.lrn ?? null,
      schoolLevel: values.schoolLevel ?? values.level ?? current.schoolLevel ?? null,
      gradeLevel: formatAccountGrade(values.gradeLevel ?? values.grade ?? current.gradeLevel),
      strand: values.strand ?? current.strand ?? null,
      sectionId: Object.hasOwn(values, 'sectionId') ? values.sectionId : current.sectionId ?? null
    };
    if (index >= 0) STUDENT_PROFILE_DIRECTORY[index] = profile;
    else STUDENT_PROFILE_DIRECTORY.push(profile);
    refreshUserDirectories();
    return profile;
  }

  function removeStudentProfile(account) {
    if (!account) return;
    removeUserProfile(account.id, RECORD_VALUES.roles.STUDENT);
  }

  function setParentStudentLinks(parentAccountId, studentIds = []) {
    const parent = PARENT_PROFILE_DIRECTORY.find(profile => profile.accountId === String(parentAccountId));
    if (!parent) return;
    for (let index = PARENT_STUDENT_LINKS.length - 1; index >= 0; index -= 1) {
      if (PARENT_STUDENT_LINKS[index].parentId === parent.id) PARENT_STUDENT_LINKS.splice(index, 1);
    }
    studentIds
      .map(String)
      .filter(studentId => STUDENT_PROFILE_DIRECTORY.some(student => student.id === studentId))
      .forEach(studentId => PARENT_STUDENT_LINKS.push({
        id: `parent-student-${parent.id}-${studentId}`,
        schoolId: ACTIVE_SCHOOL_ID,
        parentId: parent.id,
        studentId
      }));
    refreshUserDirectories();
  }

  function updateStudentPlacement(studentId, values = {}) {
    const profile = STUDENT_PROFILE_DIRECTORY.find(record => record.id === String(studentId));
    if (!profile) return null;
    profile.schoolLevel = values.schoolLevel ?? values.level ?? profile.schoolLevel;
    profile.gradeLevel = formatAccountGrade(values.gradeLevel ?? values.grade ?? profile.gradeLevel);
    profile.strand = values.strand ?? profile.strand;
    if (Object.hasOwn(values, 'sectionId')) profile.sectionId = values.sectionId;
    refreshUserDirectories();
    return STUDENT_DIRECTORY.find(record => record.id === profile.id) || null;
  }

  // Persist authentication, profiles, and relationships separately. Each
  // collection can later map directly to its own API endpoint and table.
  function saveAccounts() {
    writeJson(schoolStorageKey(STORAGE_KEYS.accounts), ACCOUNT_DIRECTORY);
    writeJson(schoolStorageKey(STORAGE_KEYS.adminProfiles), ADMIN_PROFILE_DIRECTORY);
    writeJson(schoolStorageKey(STORAGE_KEYS.teacherProfiles), TEACHER_PROFILE_DIRECTORY);
    writeJson(schoolStorageKey(STORAGE_KEYS.studentProfiles), STUDENT_PROFILE_DIRECTORY);
    writeJson(schoolStorageKey(STORAGE_KEYS.parentProfiles), PARENT_PROFILE_DIRECTORY);
    writeJson(schoolStorageKey(STORAGE_KEYS.parentStudentLinks), PARENT_STUDENT_LINKS);
  }

  // Small frontend data-service layer. Pages read and change account data
  // through these functions so the local arrays can later be replaced with
  // API calls without changing each page's rendering code.
  function getAccounts() {
    return ACCOUNT_DIRECTORY;
  }

  function getUsers() {
    return USER_DIRECTORY;
  }

  function getStudents() {
    return STUDENT_DIRECTORY;
  }

  function getProfiles(role) {
    return profileDirectory(role) || [];
  }

  function getParentStudentLinks() {
    return PARENT_STUDENT_LINKS;
  }

  function createAccount(values = {}) {
    const account = {
      id: String(values.id || `local-${Date.now()}`),
      schoolId: values.schoolId || getActiveSchoolId(),
      email: String(values.email || '').trim(),
      role: LEGACY_ACCOUNT_ROLES[values.role] || values.role || RECORD_VALUES.roles.STUDENT,
      status: values.status || RECORD_VALUES.statuses.ACTIVE,
      createdAt: values.createdAt || new Date().toISOString()
    };
    ACCOUNT_DIRECTORY.push(account);
    refreshUserDirectories();
    return account;
  }

  // Create an account and its role-specific profile through one path. Pages
  // can pass the same fields whether the record came from a form or CSV.
  function createUserAccount(values = {}) {
    const role = LEGACY_ACCOUNT_ROLES[values.role] || values.role || RECORD_VALUES.roles.STUDENT;
    const firstName = String(values.firstName || '').trim();
    const lastName = String(values.lastName || '').trim();
    const account = createAccount({
      id: values.id,
      schoolId: values.schoolId,
      email: values.email,
      role,
      status: values.status,
      createdAt: values.createdAt
    });
    const profileValues = {
      firstName,
      lastName,
      displayName: values.displayName || [firstName, lastName].filter(Boolean).join(' '),
      employeeNo: values.employeeNo ?? null,
      lrn: values.lrn ?? null,
      schoolLevel: values.schoolLevel ?? values.level ?? null,
      gradeLevel: values.gradeLevel ?? values.grade ?? null,
      strand: values.strand ?? null,
      sectionId: values.sectionId ?? null,
      studentId: values.studentId
    };

    if (role === RECORD_VALUES.roles.STUDENT) upsertStudentProfile(account, profileValues);
    else upsertUserProfile(account, profileValues);
    if (role === RECORD_VALUES.roles.PARENT) setParentStudentLinks(account.id, values.linkedStudentIds || []);
    return account;
  }

  function updateAccount(accountId, values = {}) {
    const account = ACCOUNT_DIRECTORY.find(record => record.id === String(accountId));
    if (!account) return null;

    if (values.email !== undefined) account.email = String(values.email || '').trim();
    if (values.role !== undefined) account.role = LEGACY_ACCOUNT_ROLES[values.role] || values.role;
    if (values.status !== undefined) account.status = values.status;

    refreshUserDirectories();
    return account;
  }

  function setAccountStatus(accountId, status) {
    return updateAccount(accountId, { status });
  }

  function deleteAccount(accountId) {
    const index = ACCOUNT_DIRECTORY.findIndex(record => record.id === String(accountId));
    if (index < 0) return null;

    const [account] = ACCOUNT_DIRECTORY.splice(index, 1);
    removeUserProfile(account.id, account.role);
    return account;
  }

  refreshUserDirectories();

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
    const student = STUDENT_DIRECTORY.find(item => item.id === String(record.studentId));
    const teacher = USER_DIRECTORY.find(item => item.profileId === record.teacherId);
    const section = getAssignmentSections(getActiveSchool()).find(item => item.id === record.sectionId);
    const teacherName = record.teacherName || teacher?.displayName || '';
    return {
      ...record,
      studentName: record.studentName || student?.name || '',
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
    accounts: ACCOUNT_DIRECTORY,
    users: USER_DIRECTORY,
    adminProfiles: ADMIN_PROFILE_DIRECTORY,
    teacherProfiles: TEACHER_PROFILE_DIRECTORY,
    studentProfiles: STUDENT_PROFILE_DIRECTORY,
    parentProfiles: PARENT_PROFILE_DIRECTORY,
    parentStudentLinks: PARENT_STUDENT_LINKS,
    students: STUDENT_DIRECTORY,
    getAccounts,
    getUsers,
    getStudents,
    getProfiles,
    getParentStudentLinks,
    createAccount,
    createUserAccount,
    updateAccount,
    setAccountStatus,
    deleteAccount,
    saveAccounts,
    upsertUserProfile,
    removeUserProfile,
    upsertStudentProfile,
    removeStudentProfile,
    setParentStudentLinks,
    refreshUserDirectories,
    updateStudentPlacement,
    periods: PERIOD_CATALOG,
    attendanceDefaults: makeAttendanceRules(),
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
