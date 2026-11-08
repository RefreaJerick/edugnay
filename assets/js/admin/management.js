document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeSectionMenus();
  closeSectionAddModal(); closeSectionEditModal(); closeSectionStudentsModal();
  closeSubjectModal(); closeTeacherModal(); closeDepedSubjectReview();
  closeStudentAssignModal(); closeConfirmRemoveModal(); closeImportStudentsModal();
});

/* ══════════════════════════════════════════════
   TOP-LEVEL TAB SWITCHING
══════════════════════════════════════════════ */
const mgmtTitles = {
  sections: 'Sections', subjects: 'Subjects', teachers: 'Assign Teachers', students: 'Assign Students'
};

let managementDataLoading = false;

const MANAGEMENT_LOADING_REGIONS = [
  '#sections-summary-cards', '#sectionCardView', '#sectionTableView tbody',
  '#subjects-summary-cards', '#subjectGradeTabs', '#subjectTableBody',
  '#teacher-summary-cards',
  '#students-summary-cards', '#studentGradeTabs', '#enrolledBody', '#panel-students .sc-list'
];

function renderManagementLoadingState() {
  managementDataLoading = true;
  const feedback = document.getElementById('managementLoadError');
  if (feedback) {
    feedback.hidden = true;
    feedback.innerHTML = '';
  }
  MANAGEMENT_LOADING_REGIONS.forEach(selector => {
    const target = document.querySelector(selector);
    if (target) target.innerHTML = '';
  });
}

function clearManagementLoadingState() {
  MANAGEMENT_LOADING_REGIONS.forEach(selector => {
    const target = document.querySelector(selector);
    if (target) target.innerHTML = '';
  });
}

function showManagementLoadError(error) {
  clearManagementLoadingState();
  const feedback = document.getElementById('managementLoadError');
  if (!feedback) return;
  feedback.innerHTML = `${window.EDUGNAY_CONFIG.renderPanelEmptyState({
    icon: 'triangle-alert',
    title: 'Class management unavailable',
    text: error?.message || 'The class management data could not be loaded. Reload the page to try again.'
  })}<button class="top-btn secondary" type="button" data-page-click="g5a9c210f6c2">Retry</button>`;
  feedback.hidden = false;
  lucide.createIcons();
}

function switchMgmtTab(tab, el) {
  document.querySelectorAll('.mgmt-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');

  document.querySelectorAll('.mgmt-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  else document.querySelector('.mgmt-tab[data-tab="' + tab + '"]').classList.add('active');

  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.textContent = 'Class Management · ' + mgmtTitles[tab];
  window.scrollTo({ top: 0, behavior: 'instant' });
}

const tab = localStorage.getItem("managementTab");

if (tab) {
  if (Object.prototype.hasOwnProperty.call(mgmtTitles, tab)) switchMgmtTab(tab);
  localStorage.removeItem("managementTab");
}

/* ══════════════════════════════════════════════
   SECTIONS TAB
══════════════════════════════════════════════ */
function updateSectionFormFields() {
  const levelSelect = document.getElementById('createSchoolLevel');
  const gradeSelect = document.getElementById('createGradeLevel');
  const trackSelect = document.getElementById('createTrack');
  const trackGroup = document.getElementById('createTrackGroup');
  const levels = managementSchoolLevels();
  const requestedLevel = levelSelect?.value;
  const level = levels.includes(requestedLevel)
    ? requestedLevel
    : managementDefaultLevel();
  managementSetOptions(levelSelect, managementSchoolLevels().map(option => ({ value: option, label: managementLevelLabel(option) })), 'Select a school level', level);
  const grades = level ? managementGradeOptions(level) : [];
  const requestedGrade = gradeSelect?.value;
  const grade = grades.find(option => managementGradeKey(option) === managementGradeKey(requestedGrade))
    || grades[0] || '';
  managementSetOptions(gradeSelect, grades.map(option => ({ value: option, label: option })), 'Select a grade level', grade);
  const tracks = level === 'shs' ? managementTrackOptions() : [];
  const requestedTrack = trackSelect?.value;
  const track = tracks.find(option => option.displayName === requestedTrack) || tracks[0] || null;
  if (trackGroup) trackGroup.style.display = level === 'shs' ? '' : 'none';
  managementSetOptions(trackSelect, tracks.map(option => ({ value: option.displayName, label: option.displayName })), 'Select a track', track?.displayName || '');
  if (trackSelect) trackSelect.required = level === 'shs';
  const sub = document.getElementById('sectionAddModalSub');
  if (sub) {
    sub.textContent = !level || !grade
      ? 'Choose a valid school level and grade for this section.'
    : `Set up a ${managementLevelLabel(level)} class section.`;
  }
}

function openSectionAddModal() {
  const form = document.getElementById('createSectionForm');
  form.reset();
  renderTeacherOptions();
  document.getElementById('createSchoolLevel').value = managementDefaultLevel();
  document.getElementById('createCapacity').value = 40;
  updateSectionFormFields('create');
  document.getElementById('sectionAddModalBackdrop').classList.add('open');
}
function closeSectionAddModal() { document.getElementById('sectionAddModalBackdrop').classList.remove('open'); }
document.getElementById('sectionAddModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeSectionAddModal(); });

function teacherAccounts() {
  return MANAGEMENT_API_TEACHERS;
}

function teacherInitials(teacher) {
  return String(teacher?.firstName || teacher?.displayName || '')
    .split(/\s+/)
    .filter(Boolean)
    .concat(String(teacher?.lastName || '').split(/\s+/).filter(Boolean))
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function renderTeacherOptions() {
  const teachers = teacherAccounts();
  const adviserOptions = document.querySelectorAll('#createAdviser, #editAdviser');
  adviserOptions.forEach(select => {
    const selected = select.value;
    select.innerHTML = '';
    select.appendChild(new Option('Select faculty', ''));
    teachers.forEach(teacher => select.appendChild(new Option(teacher.displayName, teacher.id)));
    select.value = teachers.some(teacher => teacher.id === selected) ? selected : '';
  });

  const select = document.getElementById('teacherSelect');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '';
  select.appendChild(new Option('Select a teacher', ''));
  teachers.forEach(teacher => {
    const option = new Option(`${teacher.displayName} \u00b7 ${teacher.schoolEmail}`, teacher.id);
    option.dataset.name = teacher.displayName || '';
    option.dataset.schoolEmail = teacher.schoolEmail || '';
    option.dataset.initials = teacherInitials(teacher);
    select.appendChild(option);
  });
  select.value = teachers.some(teacher => teacher.id === selected) ? selected : '';
  window.syncSearchableSelect?.(select);
}

function normalizeManagementApiTeacher(user) {
  return {
    ...user,
    id: String(user.id),
    role: 'teacher',
    displayName: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    schoolEmail: user.schoolEmail || ''
  };
}

function normalizeManagementApiStudent(user) {
  return {
    ...user,
    id: String(user.id),
    role: 'student',
    displayName: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    schoolEmail: user.schoolEmail || '',
    sectionId: null,
    schoolLevel: '',
    gradeLevel: '',
    strand: ''
  };
}

function managementSubjectTypeForDisplay(subject, gradeFilter = activeSubjectGrade) {
  const isShsView = gradeFilter === 'all'
    ? subject.schoolLevelCode === 'shs' || (!subject.schoolLevelCode && (subject.gradeScopes || []).some(scope => scope.schoolLevelCode === 'shs'))
    : gradeFilter.split(':')[0] === 'shs';
  return isShsView ? subject.type || '' : '';
}

function managementSubjectDescriptor(subject, fallback = '', gradeFilter = activeSubjectGrade) {
  const type = managementSubjectTypeForDisplay(subject, gradeFilter);
  if (type) return `${subject.code || 'Subject'} · ${type}`;
  return subject.code || fallback;
}

function managementApiSubjectRecord(subject) {
  const level = subject.schoolLevelCode || '';
  const grade = subject.gradeLevelName || '';
  const grades = (subject.gradeScopes || []).map(scope => scope.schoolLevelCode === 'shs'
    ? `shs:${managementGradeKey(scope.gradeLevelName)}:${scope.trackId == null ? 'all' : `t${scope.trackId}`}:${scope.strandId == null ? 'all' : `s${scope.strandId}`}`
    : `${scope.schoolLevelCode}:${managementGradeKey(scope.gradeLevelName)}`);
  const placement = (subject.gradeScopes || []).find(scope => scope.schoolLevelCode === 'shs');
  const groupLabels = { core: 'Core subject', academic_elective: 'Academic elective', techpro_elective: 'TechPro elective', work_immersion: 'Work immersion' };
  const hasShsScope = (subject.gradeScopes || []).some(scope => scope.schoolLevelCode === 'shs');
  const isShsSubject = level === 'shs' || hasShsScope;
  return {
    id: subject.id,
    apiId: subject.apiId,
    schoolId: subject.schoolId,
    name: subject.name,
    code: subject.code,
    schoolLevelCode: level,
    schoolLevelName: subject.schoolLevelName || (level ? managementLevelLabel(level) : ''),
    gradeLevelName: grade,
    type: isShsSubject ? groupLabels[subject.shsSubjectType] || 'Needs Strengthened SHS setup' : '',
    isActive: subject.isActive,
    gradeLevelIds: subject.gradeLevelIds || [],
    gradeScopes: subject.gradeScopes || [],
    trackId: placement?.trackId ?? subject.trackId ?? null,
    strandId: placement?.strandId ?? subject.strandId ?? null,
    shsSubjectType: subject.shsSubjectType || null,
    instructionalHours: subject.instructionalHours || null,
    grades: [...new Set(grades.length ? grades : (level && grade ? [`${level}:${managementGradeKey(grade)}`] : []))]
  };
}

async function loadManagementApiData() {
  const [school, structure, academicYears, sectionRecords, subjects, teacherResponse, studentResponse] = await Promise.all([
    window.EDUGNAY_API.getSchoolSettings(),
    window.EDUGNAY_API.getAcademicStructure(),
    window.EDUGNAY_API.getAcademicYears(),
    window.EDUGNAY_API.getSections(),
    window.EDUGNAY_API.getSubjects(),
    window.EDUGNAY_API.getAllUsers({ role: 'teacher', status: 'active' }),
    window.EDUGNAY_API.getAllUsers({ role: 'student', status: 'active' })
  ]);

  MANAGEMENT_API_CONTEXT.school = school;
  MANAGEMENT_API_CONTEXT.structure = Array.isArray(structure) ? structure : [];
  MANAGEMENT_API_CONTEXT.academicYears = Array.isArray(academicYears) ? academicYears : [];
  MANAGEMENT_API_CONTEXT.activeAcademicYear = MANAGEMENT_API_CONTEXT.academicYears.find(year => year.status === 'active') || null;
  window.EDUGNAY_API.setSchoolContext(school);

  const activeYearId = MANAGEMENT_API_CONTEXT.activeAcademicYear?.id;
  const activeSections = (Array.isArray(sectionRecords) ? sectionRecords : [])
    .filter(section => activeYearId && Number(section.academicYearId) === Number(activeYearId))
    .filter(section => section.status === 'active');
  const sectionDetails = await Promise.all(activeSections.map(async section => {
    const [studentsResult, teachersResult] = await Promise.all([
      window.EDUGNAY_API.getSectionStudents(section.id),
      window.EDUGNAY_API.getSectionTeachers(section.id)
    ]);
    return { section, studentsResult, teachersResult };
  }));

  const students = studentResponse.map(normalizeManagementApiStudent);
  const studentsById = new Map(students.map(student => [student.id, student]));
  sectionDetails.forEach(({ section, studentsResult, teachersResult }) => {
    section.teacherAssignments = (teachersResult.teachers || []).map(assignment => ({
      assignmentId: assignment.assignmentId,
      subjectId: assignment.subjectId,
      communicationComponentCode: assignment.communicationComponentCode || null,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      teacherEmail: assignment.teacherEmail,
      subjectCode: assignment.subjectCode,
      subjectName: assignment.subjectName
    }));
    (studentsResult.students || []).forEach(student => {
      const record = studentsById.get(String(student.id));
      if (!record) return;
      record.sectionId = section.id;
      record.schoolLevel = section.level;
      record.gradeLevel = section.grade;
      record.trackId = section.trackId;
      record.track = section.trackName || '';
      record.strandId = section.strandId;
      record.strand = section.strand || '';
    });
  });

  SECTION_RECORDS = activeSections;
  STUDENTS_DATA = students;
  MANAGEMENT_ASSIGNMENT_STUDENTS = students.filter(student => !student.sectionId);
  MANAGEMENT_API_TEACHERS = teacherResponse.map(normalizeManagementApiTeacher);
  const schoolSubjects = (subjects || []).map(managementApiSubjectRecord);
  SUBJECTS_DATA.splice(0, SUBJECTS_DATA.length, ...schoolSubjects.filter(subject => subject.isActive));
  MANAGEMENT_API_CONTEXT.inactiveSubjects = schoolSubjects.filter(subject => !subject.isActive);
  TEACHER_ASSIGNMENTS_DATA.splice(0, TEACHER_ASSIGNMENTS_DATA.length, ...activeSections.map(section => ({
    sectionId: section.id,
    collapsed: managementTeacherCollapseState[section.id] ?? true,
    subjects: section.teacherAssignments || []
  })));
}

async function refreshManagementViews() {
  await loadManagementApiData();
  managementDataLoading = false;
  renderManagementGradeFilters();
  renderTeacherOptions();
  renderManagementSubjectTabs();
  renderManagementTabPills();
  renderSections();
  renderSubjects();
  filterSubjects();
  renderTeacherAssignments();
  renderStudentsTab();
}

function managementApiSectionPayload(sectionData, sectionId = '') {
  if (sectionId) return {
    name: sectionData.name,
    capacity: sectionData.capacity,
    adviserUserId: sectionData.adviserId ? Number(sectionData.adviserId) : null
  };
  const level = MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === sectionData.level);
  const grade = level?.gradeLevels?.find(item => managementGradeKey(item.displayName) === managementGradeKey(sectionData.grade));
  const track = sectionData.level === 'shs'
    ? level?.tracks?.find(item => managementGradeKey(item.displayName) === managementGradeKey(sectionData.track))
    : null;
  const academicYearId = MANAGEMENT_API_CONTEXT.activeAcademicYear?.id;
  if (!academicYearId || !level?.id || !grade?.id || (sectionData.level === 'shs' && !track?.id)) {
    throw new Error('Select an available school year, school level, grade, and track, then try again.');
  }
  return {
    academicYearId: Number(academicYearId),
    schoolLevelId: Number(level.id),
    gradeLevelId: Number(grade.id),
    trackId: track?.id ? Number(track.id) : null,
    strandId: null,
    name: sectionData.name,
    capacity: sectionData.capacity,
    adviserUserId: sectionData.adviserId ? Number(sectionData.adviserId) : null
  };
}

async function saveSectionForm(event, mode) {
  event.preventDefault();
  const form = event.currentTarget;
  const level = mode === 'create' ? form.elements.level?.value || '' : '';
  const grade = mode === 'create' ? form.elements.grade?.value || '' : '';
  const name = String(form.elements.name?.value || '').trim();
  const track = mode === 'create' && level === 'shs' ? String(form.elements.track?.value || '').trim() : '';
  const adviserId = form.elements.adviserId?.value || null;
  const capacity = Number(form.elements.capacity?.value);
  if ((mode === 'create' && (!level || !grade || (level === 'shs' && !track))) || !name || !Number.isFinite(capacity) || capacity <= 0) {
    form.reportValidity();
    return;
  }

  const sectionData = {
    name,
    level,
    grade,
    track,
    strand: null,
    capacity,
    adviserId
  };

  {
    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;
    let saved = false;
    try {
      const sectionId = form.elements.sectionId?.value || '';
      const payload = managementApiSectionPayload(sectionData, sectionId);
      const savedSection = mode === 'edit'
        ? await window.EDUGNAY_API.updateSection(sectionId, payload)
        : await window.EDUGNAY_API.createSection(payload);
      if (!savedSection) throw new Error('The section could not be saved.');
      saved = true;
      if (mode === 'edit') closeSectionEditModal();
      else closeSectionAddModal();
      await refreshManagementViews();
      showAppToast(mode === 'edit' ? 'Section updated.' : 'Section created.');
    } catch (error) {
      showAppToast(saved ? 'Section saved, but the list could not refresh. Reload the page to verify it.' : error?.message || 'The section could not be saved.', saved ? 'info' : 'error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
    return;
  }

}

document.getElementById('createSectionForm').addEventListener('submit', event => saveSectionForm(event, 'create'));
document.getElementById('editSectionForm').addEventListener('submit', event => saveSectionForm(event, 'edit'));

/* ══════════════════════════════════════════════
   DATA ARRAYS
══════════════════════════════════════════════ */
// Sections come from the active school's divisions. The separate array below
// stores only teacher-assignment relationships keyed by sectionId.
const BAR_CLASS_BY_GRADE = { 7: 'bar-blue', 8: 'bar-gold', 9: 'bar-green', 10: 'bar-orange' };
const MANAGEMENT_API_CONTEXT = {
  school: null,
  structure: [],
  shsGradingTypes: [],
  academicYears: [],
  activeAcademicYear: null,
  inactiveSubjects: []
};
let MANAGEMENT_API_TEACHERS = [];
let SECTION_RECORDS = [];

// Subject placement is stored once in shell-common.js. Each row represents
// one subject offered to one grade/strand combination of one school.
const SUBJECTS_DATA = [];

const SUBJECT_AVATAR_CLASSES = {
  mathematics: 'av-blue',
  english: 'av-navy',
  filipino: 'av-green',
  science: 'av-orange',
  'araling-panlipunan': 'av-purple',
  'values-education': 'av-purple',
  esp: 'av-teal',
  tle: 'av-green',
  mapeh: 'av-blue',
  'pe-health': 'av-purple',
  'empowerment-technologies': 'av-blue',
  'practical-research': 'av-orange'
};

const TEACHER_ASSIGNMENTS_DATA = [];

// Keep the management table on the canonical user records. The service
// refreshes this reference after a placement or import mutation.
let STUDENTS_DATA = [];
let MANAGEMENT_ASSIGNMENT_STUDENTS = [];

/* ══════════════════════════════════════════════
   RENDER FUNCTIONS
══════════════════════════════════════════════ */
function renderManagementStatCards(targetId, cards) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = cards.map(card => `
    <div class="stat-card ${card.tone}">
      <div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${card.icon}" style="width:18px;height:18px;"></i></div></div>
      <div class="stat-card-num">${card.value}</div>
      <div class="stat-card-label">${card.label}</div>
      <div class="stat-card-sub">${card.sub}</div>
    </div>`).join('');
}

function updateManagementEmptySlot(container, key, options, show) {
  if (!container) return;
  let slot = container.querySelector(`[data-management-empty="${key}"]`);
  if (!slot) {
    slot = document.createElement('div');
    slot.dataset.managementEmpty = key;
    slot.className = 'panel-empty-slot';
    container.appendChild(slot);
  }
  slot.classList.add('panel-empty-slot');
  slot.hidden = !show;
  slot.innerHTML = show ? window.EDUGNAY_CONFIG.renderPanelEmptyState(options) : '';
}

function closeSectionMenus() {
  document.querySelectorAll('.section-action-menu.open').forEach(menu => menu.classList.remove('open'));
  document.querySelectorAll('.section-menu-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', event => {
  if (!event.target.closest('.section-card-menu')) closeSectionMenus();
});

function renderSections() {
  const records = managementSectionRecords();
  const withAdviser = records.filter(section => section.adviser).length;
  const totalStudents = records.reduce((sum, section) => sum + section.students, 0);
  const levelSummary = managementSchoolLevels().map(managementLevelShortLabel).join(', ');
  renderManagementStatCards('sections-summary-cards', [
    { tone: 'blue', icon: 'door-open', value: records.length, label: 'Total Sections', sub: `Across ${levelSummary}` },
    { tone: 'green', icon: 'graduation-cap', value: totalStudents, label: 'Students', sub: 'Enrolled this school year' },
    { tone: 'gold', icon: 'book-open', value: withAdviser, label: 'With Adviser', sub: `Out of ${records.length} total sections` },
  ]);

  const container = document.getElementById('sectionCardView');
  const groups = managementGradeFilterOptions().map(option => ({
    ...option,
    items: records.filter(section => managementSectionFilterKey(section) === option.value)
  })).filter(group => group.items.length);

  container.innerHTML = groups.map(group => `
    <div class="grade-group" data-grade="${group.value}" data-level="${group.level}">
      <div class="grade-label"><span class="grade-text">${group.label}</span><div class="grade-line"></div><span class="grade-count">${group.items.length} Sections · ${group.items.reduce((sum, section) => sum + section.students, 0)} Students</span></div>
      <div class="sections-grid">
        ${group.items.map(section => `
          <div class="section-card" data-grade="${managementSectionFilterKey(section)}" data-name="${section.name.toLowerCase()}" data-id="${section.id}">
            <div class="card-stripe stripe-${managementSectionTone(section.level, section.gradeValue)}"></div>
            <div class="card-body">
              <div class="card-head section-card-head">
                <div class="section-card-title-row">
                  <div class="section-name">${section.name}</div>
                  <span class="section-grade-badge gb-${managementSectionTone(section.level, section.gradeValue)}" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionPlacement(section))}">${window.EDUGNAY_CONFIG.escapeHtml(section.grade)}</span>
                </div>
                ${section.level === 'shs' && managementSectionCardPath(section)
                  ? `<div class="section-card-path${section.needsCurriculumSetup ? ' is-review' : ''}" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionPlacement(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCardPath(section))}</div>`
                  : ''}
              </div>
              <div class="card-stats">
                <div class="cs-item"><div class="cs-num">${section.students}</div><div class="cs-label">Students</div></div>
                <div class="cs-item"><div class="cs-num">${section.subjects}</div><div class="cs-label">Subjects</div></div>
                <div class="cs-item"><div class="cs-num">${section.capacity}</div><div class="cs-label">Capacity</div></div>
              </div>
              ${section.adviser
                ? `<div class="card-adviser">${window.EDUGNAY_AVATAR.html({
                  id: section.adviserId, name: section.adviser, initials: section.adviserInitials,
                  avatarUrl: section.adviserAvatar?.avatarUrl, role: 'teacher'
                }, { className: 'adviser-av' })}<div><div class="adviser-label">Class Adviser</div><div class="adviser-name">${section.adviser}</div></div></div>`
                : `<div class="no-adviser"><div class="no-adviser-icon"><i data-lucide="alert-circle" style="width:18px;height:18px;"></i></div><div class="no-adviser-text">No adviser assigned yet</div></div>`}
              <div class="card-foot">
                <button class="card-btn view" type="button">View Students</button>
                ${section.adviser ? '' : '<button class="card-btn edit assign-adviser" type="button">Assign Adviser</button>'}
                <div class="section-card-menu">
                  <button class="section-menu-trigger" type="button" aria-label="Section actions" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-vertical" style="width:16px;height:16px;"></i></button>
                  <div class="section-action-menu" role="menu">
                    <button class="section-menu-item section-menu-edit" type="button" role="menuitem"><i data-lucide="pencil" style="width:14px;height:14px;"></i>Edit Section</button>
                    <button class="section-menu-item delete" type="button" role="menuitem"><i data-lucide="trash-2" style="width:14px;height:14px;"></i>Delete Section</button>
                  </div>
                </div>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
  updateManagementEmptySlot(container, 'sections', {
    icon: 'door-open',
    title: 'No sections found',
    text: 'Create a section or adjust the search and grade filters.'
  }, groups.length === 0);

  container.querySelectorAll('.section-card').forEach(card => {
    const assignButton = card.querySelector('.assign-adviser');
    if (assignButton) assignButton.addEventListener('click', () => openSectionEditModal(card));
    card.querySelector('.card-btn.view').addEventListener('click', () => openSectionStudentsModal(card));
    const menuButton = card.querySelector('.section-menu-trigger');
    const menu = card.querySelector('.section-action-menu');
    menuButton.addEventListener('click', event => {
      event.stopPropagation();
      const shouldOpen = !menu.classList.contains('open');
      closeSectionMenus();
      if (!shouldOpen) return;
      menu.classList.add('open');
      menuButton.setAttribute('aria-expanded', 'true');
    });
    card.querySelector('.section-menu-edit').addEventListener('click', () => {
      closeSectionMenus();
      openSectionEditModal(card);
    });
    card.querySelector('.section-menu-item.delete').addEventListener('click', () => {
      closeSectionMenus();
      const section = managementSectionById(card.dataset.id);
      if (section) openSectionDeleteConfirmation(section);
    });
  });

  const tbody = document.querySelector('#sectionTableView tbody');
  tbody.innerHTML = (records.length ? records.map(section => `
    <tr data-id="${section.id}" data-grade="${managementSectionFilterKey(section)}" data-name="${section.name.toLowerCase()}">
      <td><strong>${section.name}</strong></td>
      <td><span class="badge gb-${managementSectionTone(section.level, section.gradeValue)}" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionPlacement(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactPlacement(section))}</span></td>
      <td>${section.adviser || '<span style="color:var(--red);font-weight:600;"><i data-lucide="alert-circle" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>Unassigned</span>'}</td>
      <td>${section.students}</td>
      <td>${section.subjects}</td>
      <td>${section.capacity}</td>
      <td><div class="row-actions"><button class="row-btn view" type="button">View</button><button class="row-btn edit" type="button">${section.adviser ? 'Edit' : 'Assign'}</button><button class="row-btn danger" type="button">Delete</button></div></td>
    </tr>`).join('') : '') + `<tr class="panel-empty-row" hidden><td colspan="7">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'door-open', title: 'No sections found', text: 'Create a section or adjust the filters.' })}</td></tr>`;
  const sectionTableEmpty = tbody.querySelector('.panel-empty-row');
  if (sectionTableEmpty) sectionTableEmpty.hidden = records.length > 0;
  tbody.querySelectorAll('.row-btn.view').forEach(button => button.addEventListener('click', () => openSectionStudentsModal(button.closest('tr'))));
  tbody.querySelectorAll('.row-btn.edit').forEach(button => button.addEventListener('click', () => openSectionEditModal(button.closest('tr'))));
  tbody.querySelectorAll('.row-btn.danger').forEach(button => button.addEventListener('click', () => {
    const section = managementSectionById(button.closest('tr').dataset.id);
    if (section) openSectionDeleteConfirmation(section);
  }));
  lucide.createIcons();
}

function managementSubjectRecords() {
  const sections = managementSectionRecords();
  return SUBJECTS_DATA.map(subject => ({
    ...subject,
    total: sections.filter(section => managementSubjectFilterMatches(
      managementSubjectSectionKey(section),
      subject.grades
    )).length
  }));
}

function renderInactiveSubjects() {
  const panel = document.getElementById('inactiveSubjectsPanel');
  const list = document.getElementById('inactiveSubjectList');
  if (!panel || !list) return;
  const subjects = MANAGEMENT_API_CONTEXT.inactiveSubjects || [];
  panel.hidden = !subjects.length;
  list.innerHTML = subjects.map(subject => {
    const placement = subject.schoolLevelName
      ? `${subject.schoolLevelName} · ${subject.gradeLevelName || 'All grades'}`
      : 'All school levels';
    return `
    <article class="subject-card inactive-subject-card" data-id="${window.EDUGNAY_CONFIG.escapeHtml(subject.id)}">
      <div class="subject-card-content">
        <div class="subj-name">${window.EDUGNAY_CONFIG.escapeHtml(subject.name)}</div>
        <div class="subj-code-text inactive-subject-meta">
          <span>${window.EDUGNAY_CONFIG.escapeHtml(subject.code)}</span>
          <span class="inactive-subject-placement">${window.EDUGNAY_CONFIG.escapeHtml(placement)}</span>
        </div>
      </div>
      <div class="subject-card-actions row-actions"><button class="row-btn edit" type="button" data-restore-subject>Restore</button></div>
    </article>`;
  }).join('');
  list.querySelectorAll('[data-restore-subject]').forEach(button => {
    button.addEventListener('click', async () => {
      const subject = subjects.find(item => item.id === button.closest('.subject-card')?.dataset.id);
      if (!subject || button.disabled) return;
      button.disabled = true;
      try {
        await window.EDUGNAY_API.updateSubject(subject.apiId, { isActive: true });
        await refreshManagementViews();
        showAppToast('Subject restored.');
      } catch (error) {
        showAppToast(error.message || 'The subject could not be restored.', 'error');
        button.disabled = false;
      }
    });
  });
}

function managementFilterMatches(filterValue, keys) {
  if (filterValue === 'all') return true;
  const values = Array.isArray(keys) ? keys : [keys];
  if (managementSchoolLevels().includes(filterValue)) {
    return values.some(key => String(key).startsWith(`${filterValue}:`));
  }
  return values.includes(filterValue);
}

function managementSubjectFilterMatches(filterValue, keys, strand = 'all') {
  if (filterValue === 'all') return true;
  const values = Array.isArray(keys) ? keys : [keys];
  const filterParts = String(filterValue || '').split(':');
  const filterLevel = filterParts[0];
  const filterGrade = filterParts[1] || '';
  const selectedScope = strand !== 'all' ? strand : filterParts.slice(2).join(':');
  const selectedParts = selectedScope.split(':');
  const filterTrack = selectedParts[0] || 'all';
  const filterStrand = selectedParts[1] || 'all';

  return values.some(value => {
    const [level, grade, valueTrack = 'all', valueStrand = 'all'] = String(value || '').split(':');
    if (level !== filterLevel) return false;
    if (filterGrade && grade !== filterGrade) return false;
    if (level === 'shs') {
      if (filterTrack !== 'all' && valueTrack !== 'all' && valueTrack !== filterTrack) return false;
      if (filterStrand !== 'all' && valueStrand !== 'all' && valueStrand !== filterStrand) return false;
    }
    return true;
  });
}

function managementSubjectPlacementKey(record) {
  const level = String(record?.schoolLevel || '');
  const grade = managementGradeKey(record?.gradeLevel);
  if (level === 'shs') return `${level}:${grade}:${record?.trackId ? `t${record.trackId}` : 'all'}:${record?.strandId ? `s${record.strandId}` : 'all'}`;
  return `${level}:${grade}`;
}

function renderSubjectGradeTabs(level) {
  const tabs = document.getElementById('subjectGradeSubTabs');
  if (!tabs) return;
  if (level === 'all') {
    tabs.innerHTML = '';
    tabs.classList.add('is-empty');
    renderSubjectStrandTabs('all');
    window.initScrollFades?.();
    return;
  }

  if (activeSubjectGrade !== level && !activeSubjectGrade.startsWith(`${level}:`)) activeSubjectGrade = level;
  tabs.classList.remove('is-empty');
  const subjects = managementSubjectRecords();
  const levelLabel = managementLevelLabel(level);
  const grades = managementGradeOptions(level);
  subjectTabTitles[level] = { title: `${levelLabel} Subjects` };
  renderSubjectStrandTabs(level);

  tabs.innerHTML = [
    `<div class="filter-tab grade-filter-tab ${activeSubjectGrade === level ? 'active' : ''}" data-grade="${level}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchSubjectGradeTab(String(level), this) })}">All ${levelLabel} <span class="tab-count">${subjects.filter(subject => managementSubjectFilterMatches(level, subject.grades, activeSubjectStrand)).length}</span></div>`,
    ...grades.map(grade => {
      const key = `${level}:${managementGradeKey(grade)}`;
      subjectTabTitles[key] = { title: `${levelLabel} · ${grade} Subjects` };
      const count = subjects.filter(subject => managementSubjectFilterMatches(key, subject.grades, activeSubjectStrand)).length;
      return `<div class="filter-tab grade-filter-tab ${activeSubjectGrade === key ? 'active' : ''}" data-grade="${key}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchSubjectGradeTab(String(key), this) })}">${grade} <span class="tab-count">${count}</span></div>`;
    })
  ].join('');
  window.initScrollFades?.();
}

function renderSubjectStrandTabs(level) {
  const tabs = document.getElementById('subjectStrandSubTabs');
  if (!tabs) return;
  if (level !== 'shs') {
    tabs.innerHTML = '';
    tabs.classList.add('is-empty');
    return;
  }

  const subjects = managementSubjectRecords();
  const gradeFilter = activeSubjectGrade.startsWith('shs') ? activeSubjectGrade : 'shs';
  const strands = managementShsPlacementOptions();
  tabs.classList.remove('is-empty');
  tabs.innerHTML = [
    `<div class="filter-tab grade-filter-tab ${activeSubjectStrand === 'all' ? 'active' : ''}" data-strand="all" data-page-click="gc8d9f45a608a">All tracks <span class="tab-count">${subjects.filter(subject => managementSubjectFilterMatches(gradeFilter, subject.grades)).length}</span></div>`,
    ...strands.map(strand => {
      const key = `t${strand.track.id}:s${strand.strand?.id || 'all'}`;
      const count = subjects.filter(subject => managementSubjectFilterMatches(gradeFilter, subject.grades, key)).length;
      return `<div class="filter-tab grade-filter-tab ${activeSubjectStrand === key ? 'active' : ''}" data-strand="${key}" title="${window.EDUGNAY_CONFIG.escapeHtml(strand.label)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchSubjectStrandTab(String(key)) })}">${window.EDUGNAY_CONFIG.escapeHtml(strand.compactLabel)} <span class="tab-count">${count}</span></div>`;
    })
  ].join('');
}

function renderManagementSubjectTabs() {
  const tabs = document.getElementById('subjectGradeTabs');
  if (!tabs) return;
  const subjects = managementSubjectRecords();
  const levels = managementSchoolLevels();
  const activeDivision = activeSubjectGrade === 'all' ? 'all' : activeSubjectGrade.split(':')[0];
  tabs.classList.add('hierarchical-filter-tabs');
  subjectTabTitles = { all: { title: 'All Subjects' } };
  tabs.innerHTML = `
    <div class="division-filter-tabs subject-scroll-fade-tab-row" id="subjectDivisionTabs" data-scroll-target="school level tabs" role="tablist" aria-label="School levels">
      <button type="button" class="division-filter-tab ${activeDivision === 'all' ? 'active' : ''}" data-division="all" role="tab" aria-selected="${activeDivision === 'all'}" data-page-click="g22c8c74f4238">All School Levels <span class="tab-count">${subjects.length}</span></button>
      ${levels.map(level => {
        subjectTabTitles[level] = { title: `${managementLevelLabel(level)} Subjects` };
        const count = subjects.filter(subject => managementSubjectFilterMatches(level, subject.grades)).length;
        return `<button type="button" class="division-filter-tab ${activeDivision === level ? 'active' : ''}" data-division="${level}" role="tab" aria-selected="${activeDivision === level}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchSubjectDivisionTab(String(level), this) })}">${managementLevelLabel(level)} <span class="tab-count">${count}</span></button>`;
      }).join('')}
    </div>
    <div class="grade-filter-tabs subject-scroll-fade-tab-row is-empty" id="subjectStrandSubTabs" data-scroll-target="SHS track tabs" role="tablist" aria-label="SHS tracks"></div>
    <div class="grade-filter-tabs subject-scroll-fade-tab-row is-empty" id="subjectGradeSubTabs" data-scroll-target="grade level tabs" role="tablist" aria-label="Grade levels"></div>`;
  renderSubjectGradeTabs(activeDivision === 'all' ? 'all' : activeDivision);
  updateSubjectPanelTitle();
}

function getManagementTeacherSlots() {
  return managementSectionRecords().flatMap(teacherAssignmentsForSection);
}

function teacherRecordById(teacherId) {
  if (!teacherId) return null;
  return MANAGEMENT_API_TEACHERS.find(teacher => teacher.id === String(teacherId)) || null;
}

function teacherAssignmentsForSection(section) {
  const sectionKey = managementSubjectSectionKey(section);
  const subjects = managementSubjectRecords().filter(subject => (
    subject.grades.some(key => managementSubjectFilterMatches(sectionKey, [key]))
  ));
  const storedAssignments = Array.isArray(section.teacherAssignments) ? section.teacherAssignments : [];
  return subjects.flatMap(subject => {
    const avClass = SUBJECT_AVATAR_CLASSES[subject.id] || SUBJECT_AVATAR_CLASSES[subject.code] || 'av-blue';
    const communicationSlots = subject.code === 'shs-core-communication'
      && section.level === 'shs' && managementGradeKey(section.grade) === '11' && !section.needsCurriculumSetup;
    if (communicationSlots) {
      const matching = storedAssignments.filter(record => record.subjectId === subject.id);
      const components = [
        ['english', 'Effective Communication'],
        ['filipino', 'Mabisang Komunikasyon']
      ].map(([communicationComponentCode, componentLabel]) => {
        const assignment = matching.find(record => record.communicationComponentCode === communicationComponentCode);
        return {
          subjectId: subject.id,
          name: subject.name,
          code: subject.code,
          componentLabel,
          communicationComponentCode,
          isLegacyCommunication: false,
          avClass,
          teacherId: assignment?.teacherId || null,
          assignmentId: assignment?.assignmentId || assignment?.id || null
        };
      });
      return components;
    }
    const assignment = storedAssignments.find(record => record.subjectId === subject.id
      && !record.communicationComponentCode);
    return [{
      subjectId: subject.id,
      name: subject.name,
      code: subject.code,
      componentLabel: '',
      communicationComponentCode: null,
      isLegacyCommunication: false,
      avClass,
      teacherId: assignment?.teacherId || null,
      assignmentId: assignment?.assignmentId || assignment?.id || null
    }];
  });
}

function getTeacherAssignmentStats() {
  const slots = getManagementTeacherSlots();
  const assigned = slots.filter(subject => subject.teacherId).length;
  return {
    total: slots.length,
    assigned,
    unassigned: slots.length - assigned,
    faculty: new Set(slots.filter(subject => subject.teacherId).map(subject => subject.teacherId)).size,
  };
}

function renderSubjects() {
  const subjectRecords = managementSubjectRecords();
  const reviewDepedButton = document.getElementById('reviewDepedSubjects');
  if (reviewDepedButton) {
    reviewDepedButton.hidden = !managementSchoolLevels().some(level => ['elementary', 'jhs', 'shs'].includes(level));
  }
  const assignmentStats = getTeacherAssignmentStats();
  const subjectSlots = subjectRecords.reduce((total, subject) => total + subject.total, 0);
  renderManagementStatCards('subjects-summary-cards', [
    { tone: 'blue', icon: 'library', value: subjectRecords.length, label: 'Total Subjects', sub: 'Set up for this school' },
    { tone: 'gold', icon: 'layers', value: subjectSlots, label: 'Subject Slots', sub: `${subjectRecords.length} subjects · ${managementSectionRecords().length} sections` },
    { tone: 'green', icon: 'check-circle', value: assignmentStats.assigned, label: 'Slots Assigned', sub: 'Teachers already linked' },
    { tone: 'orange', icon: 'alert-circle', value: assignmentStats.unassigned, label: 'Slots Unassigned', sub: 'Still needs a teacher' },
  ]);
  const subjectGrid = document.getElementById('subjectTableBody');
  subjectGrid.innerHTML = subjectRecords.map(subject => {
    const descriptor = managementSubjectDescriptor(subject);
    return `
    <article class="subject-card" data-grades="${subject.grades.join(',')}" data-name="${subject.name.toLowerCase()}" data-id="${subject.id}">
      <div class="subject-card-content"><div class="subj-name">${subject.name}</div><div class="subj-code-text">${descriptor}</div></div>
      <div class="subject-card-actions row-actions"><button class="row-btn edit" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openSubjectModal(String(subject.id)) })}">Edit</button><button class="row-btn remove">Remove</button></div>
    </article>`;
  }).join('');
  updateManagementEmptySlot(subjectGrid, 'subjects', {
    icon: 'book-open',
    title: 'No subjects found',
    text: 'Add a subject or adjust the search and school-level filters.'
  }, subjectRecords.length === 0);
  subjectGrid.querySelectorAll('.row-btn.remove').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const card = button.closest('.subject-card');
      const subject = subjectRecords.find(record => record.id === card?.dataset.id);
      if (subject) openSubjectRemoveConfirmation(subject);
    });
  });
  renderInactiveSubjects();
  lucide.createIcons();
}

const depedSubjectStatusText = {
  'will-add': 'Will be added',
  'already-present': 'Already in subject list',
  inactive: 'Inactive entry left unchanged',
  'review-existing': 'Existing entry needs review'
};

function renderDepedSubjectPreview(preview) {
  const content = document.getElementById('depedSubjectReviewContent');
  const grades = Array.isArray(preview?.grades) ? preview.grades : [];
  if (!grades.length) {
    content.innerHTML = `${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No eligible grades', text: 'Enable and save Grade 2–11 in Academic Structure before adding its DepEd subjects.' })}<div class="deped-subject-empty-action"><a class="top-btn secondary" href="edugnay-admin-schools.html#academic-structure"><i data-lucide="settings-2"></i> Open Academic Structure</a></div><div class="deped-subject-result" id="depedSubjectApplyResult" role="status" hidden></div>`;
    document.getElementById('applyDepedSubjectReview').disabled = true;
    if (window.lucide) lucide.createIcons();
    return;
  }
  content.innerHTML = `<p class="term-modal-message">These are the current defaults for the grades your school has enabled. Existing entries will be left as they are.</p><div class="deped-subject-grade-list">${grades.map(grade => `<section class="deped-subject-grade"><div class="deped-subject-grade-head"><strong>${window.EDUGNAY_CONFIG.escapeHtml(grade.displayName)}</strong><span>${grade.subjects.length} subjects</span></div><ul>${grade.subjects.map(subject => `<li><span>${window.EDUGNAY_CONFIG.escapeHtml(subject.name)}${subject.existingName && subject.existingName !== subject.name ? `<small>Existing: ${window.EDUGNAY_CONFIG.escapeHtml(subject.existingName)}</small>` : ''}</span><span class="deped-subject-status ${window.EDUGNAY_CONFIG.escapeHtml(subject.status)}">${window.EDUGNAY_CONFIG.escapeHtml(depedSubjectStatusText[subject.status] || 'Review')}</span></li>`).join('')}</ul></section>`).join('')}</div><div class="deped-subject-result" id="depedSubjectApplyResult" role="status" hidden></div>`;
  updateDepedSubjectApplyButton();
  if (window.lucide) lucide.createIcons();
}

function updateDepedSubjectApplyButton() {
  const content = document.getElementById('depedSubjectReviewContent');
  document.getElementById('applyDepedSubjectReview').disabled = !content.querySelector('.deped-subject-status.will-add');
}

async function openDepedSubjectReview() {
  const modal = document.getElementById('depedSubjectReviewModal');
  const content = document.getElementById('depedSubjectReviewContent');
  content.innerHTML = '';
  document.getElementById('applyDepedSubjectReview').disabled = true;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  try {
    renderDepedSubjectPreview(await window.EDUGNAY_API.getDepedSubjectPreview());
  } catch (error) {
    content.innerHTML = `<p class="deped-subject-result error" role="alert">${window.EDUGNAY_CONFIG.escapeHtml(error.message || 'The subject defaults could not be loaded.')}</p>`;
  }
  document.getElementById('closeDepedSubjectReview').focus();
}

function closeDepedSubjectReview() {
  const modal = document.getElementById('depedSubjectReviewModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function applyDepedSubjects() {
  const button = document.getElementById('applyDepedSubjectReview');
  const content = document.getElementById('depedSubjectReviewContent');
  button.disabled = true;
  button.textContent = 'Applying...';
  let result;
  try {
    result = await window.EDUGNAY_API.applyDepedSubjectDefaults();
  } catch (error) {
    const status = document.getElementById('depedSubjectApplyResult');
    if (status) {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = error.message || 'The subject defaults could not be applied.';
    } else {
      content.insertAdjacentHTML('afterbegin', `<p class="deped-subject-result error" role="alert">${window.EDUGNAY_CONFIG.escapeHtml(error.message || 'The subject defaults could not be applied.')}</p>`);
    }
    button.textContent = 'Apply DepEd subjects';
    updateDepedSubjectApplyButton();
    return;
  }

  const addedSubjects = Array.isArray(result?.addedSubjects) ? result.addedSubjects : [];
  const successMessage = addedSubjects.length
    ? `${addedSubjects.length} subjects added across ${result.addedGradeScopes} grade assignments. Existing subjects were left unchanged.`
    : 'No new subjects were added. Matching existing entries were left unchanged for review.';
  let refreshMessage = '';
  try {
    await refreshManagementViews();
  } catch {
    refreshMessage = ' The subject list could not refresh; reload the page to verify the changes.';
  }
  try {
    renderDepedSubjectPreview(await window.EDUGNAY_API.getDepedSubjectPreview());
  } catch {
    // The subject changes are saved; keep the current preview visible if it cannot refresh.
  }
  const status = document.getElementById('depedSubjectApplyResult');
  if (status) {
    status.hidden = false;
    status.textContent = successMessage + refreshMessage;
  }
  button.textContent = 'Apply DepEd subjects';
  updateDepedSubjectApplyButton();
}

document.getElementById('reviewDepedSubjects').addEventListener('click', openDepedSubjectReview);
document.getElementById('closeDepedSubjectReview').addEventListener('click', closeDepedSubjectReview);
document.getElementById('cancelDepedSubjectReview').addEventListener('click', closeDepedSubjectReview);
document.getElementById('applyDepedSubjectReview').addEventListener('click', applyDepedSubjects);
document.getElementById('depedSubjectReviewModal').addEventListener('click', event => {
  if (event.target === event.currentTarget) closeDepedSubjectReview();
});

const managementTeacherCollapseState = {};
let teacherTargetSection = null;
let teacherTargetSubjectId = null;
let teacherTargetCommunicationComponentCode = null;
let teacherAssignmentPending = false;

function bindTeacherRemoveButtons(container) {
  container.querySelectorAll('.section-block .row-btn.remove').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const block = button.closest('.section-block');
      const row = button.closest('.subject-row');
      const subjectId = row?.dataset.subjectId || '';
      const assignmentId = row?.dataset.assignmentId || '';
      const subjectName = row?.querySelector('.subj-name')?.textContent.trim() || '';
      const teacherName = row?.querySelector('.teacher-name')?.textContent.trim() || '';
      const sectionName = block?.querySelector('.section-name')?.textContent.trim() || '';
      const section = managementSectionById(block?.dataset.id);
      const gradeLabel = section ? managementSectionBadgeLabel(section) : '';
      if (block && subjectName && teacherName) {
        openTeacherRemoveConfirmation({
          sectionId: block.dataset.id,
          subjectId,
          assignmentId,
          sectionName,
          gradeLabel,
          subjectName,
          teacherName
        });
      }
    });
  });
}

function renderTeacherAssignments() {
  const sections = managementSectionRecords();
  const assignmentStats = getTeacherAssignmentStats();
  renderManagementStatCards('teacher-summary-cards', [
    { tone: 'blue', icon: 'clipboard-list', value: assignmentStats.total, label: 'Total Assignments', sub: 'Across the school’s sections' },
    { tone: 'green', icon: 'check-circle', value: assignmentStats.assigned, label: 'Assigned', sub: 'Subject-section slots filled' },
    { tone: 'orange', icon: 'alert-circle', value: assignmentStats.unassigned, label: 'Unassigned', sub: 'Still needs a teacher' },
    { tone: 'gold', icon: 'book-open', value: assignmentStats.faculty, label: 'Faculty Assigned', sub: 'Unique teachers linked' },
  ]);
  const container = document.getElementById('panel-teachers');
  container.querySelectorAll('.section-block').forEach(element => element.remove());
  container.querySelector('[data-management-empty="teachers"]')?.remove();
  const html = sections.map(section => {
    const sectionSubjects = teacherAssignmentsForSection(section);
    const assignedCount = sectionSubjects.filter(subject => subject.teacherId).length;
    const totalSlots = sectionSubjects.length;
    const subjectCount = new Set(sectionSubjects.map(subject => String(subject.subjectId))).size;
    const full = totalSlots > 0 && assignedCount === totalSlots;
    const pct = totalSlots ? Math.round((assignedCount / totalSlots) * 100) : 0;
      const rows = sectionSubjects.length ? sectionSubjects.map(subject => {
        const teacher = teacherRecordById(subject.teacherId);
        const isCommunicationComponent = Boolean(subject.communicationComponentCode);
        const rowTitle = isCommunicationComponent ? subject.componentLabel : subject.name;
        const rowCode = isCommunicationComponent
          ? `${subject.code} · ${subject.communicationComponentCode}` : subject.code;
        return `
      <div class="subject-row" data-subject-id="${subject.subjectId || ''}" data-assignment-id="${subject.assignmentId || ''}" data-communication-component-code="${subject.communicationComponentCode || ''}">
        <div class="subj-name-wrap"><div><div class="subj-name">${rowTitle}</div><div class="subj-code">${rowCode || ''}</div></div></div>
        ${subject.teacherId ? `
          <div class="teacher-assign">${window.EDUGNAY_AVATAR.html(teacher || {}, { className: 'teacher-av', role: 'teacher' })}<div><div class="teacher-name">${teacher?.displayName || 'Teacher'}</div><div class="teacher-email">${teacher?.schoolEmail || ''}</div></div></div>
          <div class="row-actions"><button class="row-btn change">Change</button><button class="row-btn remove">Remove</button></div>
        ` : `
          <div class="unassigned"><span class="unassigned-text"><i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> No teacher assigned</span></div>
          <div class="row-actions"><button class="row-btn assign">+ Assign</button></div>
        `}
      </div>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No subjects added', text: 'Add subjects to this section to assign their teachers.' });
    const collapsed = managementTeacherCollapseState[section.id] ?? section.collapsed;
    return `
      <div class="section-block${collapsed ? ' collapsed' : ''}" data-grade="${managementSectionFilterKey(section)}" data-level="${section.level}" data-name="${section.name.toLowerCase()}" data-status="${full ? 'complete' : 'incomplete'}" data-id="${section.id}">
        <div class="section-head" data-page-click="g5c6ac1f61c0a">
          <div class="section-head-left"><span class="section-grade-pill gp-${managementSectionTone(section.level, section.gradeValue)}" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionBadgeLabel(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactBadgeLabel(section))}</span><div class="section-name">${section.name}</div></div>
          <div class="section-meta">
            <div class="meta-item"><i data-lucide="library" style="width:16px;height:16px;"></i><strong>${subjectCount}</strong> ${subjectCount === 1 ? 'Subject' : 'Subjects'}</div>
            <div class="meta-item"><i data-lucide="user" style="width:16px;height:16px;"></i>Adviser: <strong${section.adviser ? '' : ' style="color:var(--red)"'}>${section.adviser || 'None'}</strong></div>
            <div class="coverage-bar-wrap"><div class="coverage-bar"><div class="coverage-fill ${full ? 'fill-full' : 'fill-partial'}" style="width:${pct}%"></div></div><span class="coverage-label ${full ? 'label-full' : 'label-partial'}">${assignedCount}/${totalSlots} Assigned</span></div>
            ${full ? '<span class="badge badge-green"><i data-lucide="check" style="width:14px;height:14px;"></i> Complete</span>' : '<span class="badge badge-orange"><i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Incomplete</span>'}
          </div>
          <span class="collapse-arrow"><i data-lucide="chevron-down" style="width:16px;height:16px;"></i></span>
        </div>
        <div class="subject-list">${rows}</div>
      </div>`;
  }).join('');
  container.insertAdjacentHTML('beforeend', html);
  updateManagementEmptySlot(container, 'teachers', {
    icon: 'clipboard-list',
    title: 'No sections found',
    text: 'Create a section before assigning subject teachers.'
  }, sections.length === 0);
  bindTeacherRemoveButtons(container);
  container.querySelectorAll('.section-block .row-btn.change, .section-block .row-btn.assign').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const block = button.closest('.section-block');
    const row = button.closest('.subject-row');
    teacherTargetSection = block.dataset.id;
    teacherTargetSubjectId = row?.dataset.subjectId || '';
    teacherTargetCommunicationComponentCode = row?.dataset.communicationComponentCode || null;
    const subjectName = [row?.querySelector('.subj-name')?.textContent.trim(),
      row?.querySelector('.subj-code')?.textContent.trim()].filter(Boolean).join(' · ');
    const section = managementSectionById(block.dataset.id);
    const placement = section ? managementSectionBadgeLabel(section) : block.querySelector('.section-grade-pill').textContent.trim();
    openTeacherModal(`${placement} · ${block.querySelector('.section-name').textContent.trim()} · ${subjectName}`);
  }));
  filterTeacherBlocks();
  lucide.createIcons();
}

function renderStudentGradeTabs() {
  const tabs = document.getElementById('studentGradeTabs');
  if (!tabs) return;
  const records = managementSectionRecords();
  const assigned = STUDENTS_DATA.filter(student => student.sectionId);
  const unassignedCount = STUDENTS_DATA.length - assigned.length;
  const countFor = key => key === 'unassigned'
    ? unassignedCount
    : key === 'all'
      ? assigned.length
      : assigned.filter(student => {
        const section = managementSectionById(student.sectionId);
        return section && managementFilterMatches(key, [managementSectionFilterKey(section)]);
      }).length;
  const levels = managementSchoolLevels();
  const activeDivision = activeStudentGrade === 'all' || activeStudentGrade === 'unassigned'
    ? activeStudentGrade
    : activeStudentGrade.split(':')[0];
  studentTabTitles = {
    all: { title: 'All Enrolled Students', meta: `Showing ${assigned.length} students across ${records.length} sections` },
    unassigned: { title: 'Unassigned Students', meta: `${unassignedCount} students not yet placed in any section` }
  };
  tabs.classList.add('hierarchical-filter-tabs');
  tabs.innerHTML = `
    <div class="division-filter-tabs" role="tablist" aria-label="School levels">
      <button type="button" class="division-filter-tab ${activeDivision === 'all' ? 'active' : ''}" data-division="all" role="tab" aria-selected="${activeDivision === 'all'}" data-page-click="g6e9ab43db283">All Sections <span class="tab-count">${countFor('all')}</span></button>
      ${levels.map(level => {
        studentTabTitles[level] = { title: `${managementLevelLabel(level)} Students`, meta: `Showing students enrolled across ${managementLevelLabel(level)} grades` };
        return `<button type="button" class="division-filter-tab ${activeDivision === level ? 'active' : ''}" data-division="${level}" role="tab" aria-selected="${activeDivision === level}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchStudentDivisionTab(String(level), this) })}">${managementLevelLabel(level)} <span class="tab-count">${countFor(level)}</span></button>`;
      }).join('')}
      <button type="button" class="division-filter-tab division-filter-warning ${activeDivision === 'unassigned' ? 'active' : ''}" data-division="unassigned" role="tab" aria-selected="${activeDivision === 'unassigned'}" data-page-click="g228fe68d7994">Unassigned <span class="tab-count">${countFor('unassigned')}</span></button>
    </div>
    <div class="grade-filter-tabs is-empty" id="studentGradeSubTabs" role="tablist" aria-label="Grade levels"></div>`;
  renderStudentGradeSubTabs(activeDivision === 'all' || activeDivision === 'unassigned' ? 'all' : activeDivision);
  const initialInfo = studentTabTitles[activeStudentGrade] || studentTabTitles[activeDivision] || studentTabTitles.all;
  document.getElementById('enrolledTitle').textContent = initialInfo.title;
  document.getElementById('enrolledMeta').textContent = initialInfo.meta;
  const banner = document.getElementById('unassignedBannerTitle');
  if (banner) {
    banner.textContent = `${unassignedCount} students are not yet assigned to any section`;
    const bannerContainer = banner.closest('.unassigned-banner');
    if (bannerContainer) bannerContainer.hidden = unassignedCount === 0;
  }
}

function renderStudentGradeSubTabs(level) {
  const tabs = document.getElementById('studentGradeSubTabs');
  if (!tabs) return;
  if (level === 'all' || level === 'unassigned') {
    tabs.innerHTML = '';
    tabs.classList.add('is-empty');
    return;
  }

  if (activeStudentGrade !== level && !activeStudentGrade.startsWith(`${level}:`)) activeStudentGrade = level;
  tabs.classList.remove('is-empty');
  const assigned = STUDENTS_DATA.filter(student => student.sectionId);
  const levelLabel = managementLevelLabel(level);
  const grades = managementGradeOptions(level);
  studentTabTitles[level] = { title: `${levelLabel} Students`, meta: `Showing students enrolled across ${levelLabel} grades` };
  tabs.innerHTML = [
    `<div class="filter-tab grade-filter-tab ${activeStudentGrade === level ? 'active' : ''}" data-grade="${level}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchStudentGradeTab(String(level), this) })}">All ${levelLabel} <span class="tab-count">${assigned.filter(student => { const section = managementSectionById(student.sectionId); return section && managementFilterMatches(level, [managementSectionFilterKey(section)]); }).length}</span></div>`,
    ...grades.map(grade => {
      const key = `${level}:${managementGradeKey(grade)}`;
      studentTabTitles[key] = { title: `${levelLabel} · ${grade} Students`, meta: `Showing students enrolled in ${grade}` };
      const count = assigned.filter(student => {
        const section = managementSectionById(student.sectionId);
        return section && managementSectionFilterKey(section) === key;
      }).length;
      return `<div class="filter-tab grade-filter-tab ${activeStudentGrade === key ? 'active' : ''}" data-grade="${key}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { switchStudentGradeTab(String(key), this) })}">${grade} <span class="tab-count">${count}</span></div>`;
    })
  ].join('');
}

function renderEnrolledTable() {
  const tbody = document.getElementById('enrolledBody');
  tbody.innerHTML = STUDENTS_DATA.map(student => {
    const section = student.sectionId ? managementSectionById(student.sectionId) : null;
    if (section) {
      return `
      <tr data-grade="${managementSectionFilterKey(section)}" data-section="${section.id}" data-assigned="true" data-id="${student.id}">
        <td><div class="user-cell">${window.EDUGNAY_AVATAR.html(student, { className: 'user-av', role: 'student' })}<div><div class="user-name">${student.displayName}</div><div class="user-email">${student.schoolEmail}</div></div></div></td>
        <td><span class="enrolled-section-name">${section.name}</span><div class="table-secondary" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionContext(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactContext(section))}</div></td>
        <td><span class="badge gb-${managementSectionTone(section.level, section.gradeValue)}">${section.grade}</span></td>
        <td><div class="row-actions enrolled-actions"><button class="row-btn move" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openMoveStudentModal(String(student.displayName), String(student.id), String(section.id)) })}">Move</button><button class="row-btn remove" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { removeStudentFromClass(String(student.displayName), String(section.name), String(student.id), String(section.id)) })}">Remove</button></div></td>
      </tr>`;
    }
    return `
      <tr data-grade="unassigned" data-section="none" data-assigned="false" data-id="${student.id}">
        <td><div class="user-cell">${window.EDUGNAY_AVATAR.html(student, { className: 'user-av', role: 'student' })}<div><div class="user-name">${student.displayName}</div><div class="user-email">${student.schoolEmail}</div></div></div></td>
        <td><span class="table-warning">Unassigned</span></td>
        <td><span class="badge badge-gray">Not set</span></td>
        <td><button class="row-btn assign" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openStudentAssignModal(String(student.id)) })}">+ Assign</button></td>
      </tr>`;
  }).join('') + `<tr class="panel-empty-row" hidden><td colspan="4">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No students found', text: 'Try adjusting the search, grade, or section filters.' })}</td></tr>`;
  lucide.createIcons();
}

function renderSectionOverviewCards() {
  const container = document.querySelector('#panel-students .sc-list');
  const records = managementSectionRecords().sort(managementSectionSort);
  container.innerHTML = records.map(section => {
    const pct = section.capacity ? Math.round((section.students / section.capacity) * 100) : 0;
    return `
    <div class="sc-card" data-id="${section.id}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { filterByStudentSection(String(section.id), this) })}">
      <div class="sc-head">
        <div class="sc-info"><div class="sc-section-name">${section.name}</div><div class="sc-grade-text" title="${window.EDUGNAY_CONFIG.escapeHtml(managementSectionPlacement(section))}">${window.EDUGNAY_CONFIG.escapeHtml(managementSectionCompactPlacement(section))}</div></div>
        <div class="sc-count-wrap"><div class="sc-count-num">${section.students}</div><div class="sc-count-label">Students</div></div>
      </div>
      <div class="sc-bar"><div class="sc-fill ${managementSectionBarClass(section.level, section.gradeValue)}" style="width:${Math.min(pct, 100)}%"></div></div>
      <div class="sc-cap-text">${section.students} / ${section.capacity} capacity</div>
    </div>`;
  }).join('');
  updateManagementEmptySlot(container, 'section-overview', {
    icon: 'layout-grid',
    title: 'No sections found',
    text: 'Create a section to see enrollment totals here.'
  }, records.length === 0);
}

function renderStudentsTab() {
  const records = managementSectionRecords();
  const assigned = STUDENTS_DATA.filter(student => student.sectionId).length;
  renderManagementStatCards('students-summary-cards', [
    { tone: 'green', icon: 'graduation-cap', value: STUDENTS_DATA.length, label: 'Total Students', sub: 'Registered in the system' },
    { tone: 'green', icon: 'check-circle', value: assigned, label: 'Assigned', sub: 'Placed in a section' },
    { tone: 'orange', icon: 'alert-triangle', value: STUDENTS_DATA.length - assigned, label: 'Unassigned', sub: 'Still needs a section' },
    { tone: 'blue', icon: 'door-open', value: records.length, label: 'Active Sections', sub: `Across ${managementSchoolLevels().map(managementLevelShortLabel).join(', ')}` },
  ]);
  renderStudentGradeTabs();
  renderEnrolledTable();
  renderSectionOverviewCards();
  applyStudentFilters();
}

function closeSectionEditModal() { document.getElementById('sectionEditModalBackdrop').classList.remove('open'); }
document.getElementById('sectionEditModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeSectionEditModal(); });

function closeSectionStudentsModal() {
  if (studentRemovalPending) return;
  document.getElementById('sectionStudentsModalBackdrop').classList.remove('open');
}
document.getElementById('sectionStudentsModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeSectionStudentsModal(); });

function managementSectionById(id) {
  return managementSectionRecords().find(section => section.id === id) || null;
}

function openSectionEditModal(card) {
  const section = managementSectionById(card.dataset.id);
  if (!section) return;
  renderTeacherOptions();
  document.getElementById('editSectionName').value = section.name;
  document.getElementById('editCapacity').value = section.capacity;
  document.getElementById('editAdviser').value = section.adviserId || '';
  document.getElementById('editSectionId').value = section.id;
  document.getElementById('editAcademicYear').textContent = section.academicYear || 'Not set';
  document.getElementById('editSchoolLevel').textContent = managementLevelLabel(section.level);
  document.getElementById('editGradeLevel').textContent = section.grade || 'Not set';
  document.getElementById('editStrand').textContent = section.trackName
    ? `${section.needsCurriculumSetup ? 'Needs Strengthened SHS setup' : section.trackName || ''}`
    : 'Not applicable';
  document.getElementById('editStrandGroup').hidden = !section.trackName;
  document.getElementById('sectionEditModalSub').textContent = `Update a ${managementLevelLabel(section.level)} class section. Academic placement cannot be changed.`;
  document.getElementById('sectionEditModalBackdrop').classList.add('open');
}

function openSectionDeleteConfirmation(section) {
  const placement = managementSectionPlacement(section);
  openConfirmRemoveModal({
    type: 'section',
    id: section.id,
    targetId: section.id,
    sectionId: section.id,
    name: section.name,
    context: placement,
    contextLabel: 'Section placement',
    title: `Delete section: ${section.name}`,
    sub: 'This permanently removes an empty section.',
    icon: 'door-closed',
    submitLabel: 'Delete Section',
    messageParts: [
      { text: 'This section can only be deleted when it has no students, teachers, announcements, or saved records. Existing history is preserved if deletion is blocked.' }
    ]
  });
}

function renderSectionStudentsModal(sectionId, open = false) {
  const section = managementSectionById(sectionId);
  if (!section) return;
  const assigned = STUDENTS_DATA.filter(student => student.sectionId === section.id);
  document.getElementById('sectionStudentsModalTitle').textContent = `${section.name}: Students`;
  document.getElementById('sectionStudentsModalSub').textContent = `${managementSectionPlacement(section)} · ${section.students} enrolled`;
  const tbody = document.getElementById('sectionStudentsTableBody');
  tbody.innerHTML = assigned.length
    ? assigned.map((student, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><strong>${student.displayName}</strong></td>
          <td>${student.schoolEmail || ''}</td>
          <td>${student.id ? `<button class="row-btn remove" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { removeStudentFromClass(String(student.displayName), String(section.name), String(student.id), String(section.id)) })}">Remove</button>` : '<span class="table-muted">—</span>'}</td>
        </tr>`).join('')
    : `<tr class="panel-empty-row"><td colspan="4">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No students enrolled', text: 'Students assigned to this section will appear here.' })}</td></tr>`;
  if (open) document.getElementById('sectionStudentsModalBackdrop').classList.add('open');
}

function openSectionStudentsModal(card) {
  const section = managementSectionById(card.dataset.id);
  if (!section) return;
  renderSectionStudentsModal(section.id, true);
}

function setSectionView(view) {
  const cardView  = document.getElementById('sectionCardView');
  const tableView = document.getElementById('sectionTableView');
  document.getElementById('cardViewBtn').classList.toggle('active', view === 'card');
  document.getElementById('tableViewBtn').classList.toggle('active', view === 'table');
  cardView.style.display  = view === 'card' ? '' : 'none';
  tableView.style.display = view === 'table' ? '' : 'none';
}

function filterSections() {
  if (managementDataLoading) return;
  const search = document.getElementById('sectionSearchInput').value.toLowerCase();
  const grade  = document.getElementById('sectionGradeFilter').value;
  let visibleCards = 0;
  document.querySelectorAll('#sectionCardView .grade-group').forEach(group => {
    const matchGrade = grade === 'all' || group.dataset.grade === grade;
    let anyVisible = false;
    group.querySelectorAll('.section-card').forEach(card => {
      const show = matchGrade && card.dataset.name.includes(search);
      card.style.display = show ? '' : 'none';
      if (show) {
        anyVisible = true;
        visibleCards += 1;
      }
    });
    group.style.display = anyVisible ? '' : 'none';
  });
  const tableRows = document.querySelectorAll('#sectionTableView tbody tr:not(.panel-empty-row)');
  let visibleRows = 0;
  tableRows.forEach(row => {
    const matchGrade = grade === 'all' || row.dataset.grade === grade;
    const matchSearch = row.dataset.name.includes(search);
    const visible = matchGrade && matchSearch;
    row.style.display = visible ? '' : 'none';
    if (visible) visibleRows += 1;
  });
  updateManagementEmptySlot(document.getElementById('sectionCardView'), 'sections', {
    icon: 'door-open',
    title: 'No sections found',
    text: 'Try adjusting the search or grade filter.'
  }, visibleCards === 0);
  const tableBody = document.querySelector('#sectionTableView tbody');
  const tableEmptyRow = tableBody?.querySelector('.panel-empty-row');
  if (tableEmptyRow) tableEmptyRow.hidden = visibleRows > 0;
  lucide.createIcons();
}

/* ══════════════════════════════════════════════
   SUBJECTS TAB
══════════════════════════════════════════════ */
const subjectModalState = { subject: null, contextValue: 'all', contextStrand: 'all' };

function getSubjectModalContext(value = activeSubjectGrade, strandValue = activeSubjectStrand) {
  const levels = managementSchoolLevels();
  const selected = value || 'all';
  const placement = selected === 'shs' || selected.startsWith('shs:')
    ? managementShsPlacementByKey(strandValue)
    : null;
  const allGrades = levels.flatMap(level => (MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === level)?.gradeLevels || [])
    .filter(grade => grade.isEnabled !== false)
    .map(grade => ({ ...grade, levelCode: level })));
  if (selected === 'all') return { mode: 'all', key: 'all', level: null, grade: null, label: 'All School Levels', gradeOptions: allGrades, placement };
  if (levels.includes(selected)) {
    const level = MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === selected);
    return { mode: 'division', key: selected, level: selected, grade: null, label: managementLevelLabel(selected),
      gradeOptions: (level?.gradeLevels || []).filter(grade => grade.isEnabled !== false).map(grade => ({ ...grade, levelCode: selected })), placement };
  }
  const [levelCode, gradeKey] = selected.split(':');
  const level = MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === levelCode);
  const grade = level?.gradeLevels?.find(item => managementGradeKey(item.displayName) === gradeKey);
  if (grade) return { mode: 'grade', key: selected, level: levelCode, grade: gradeKey,
    label: `${managementLevelLabel(levelCode)} / ${grade.displayName}`,
    gradeOptions: [{ ...grade, levelCode }], placement };
  return getSubjectModalContext('all', 'all');
}

function renderSubjectGradeChecks(contextValue = activeSubjectGrade, subject = null) {
  const target = document.getElementById('subjectGradeChecks');
  const contextInput = document.getElementById('subjectModalContext');
  if (!target) return;
  const context = getSubjectModalContext(contextValue, subjectModalState.contextStrand);
  if (contextInput) contextInput.value = context.key;
  const existingGradeIds = new Set((subject?.gradeLevelIds || []).map(Number));
  const chosenGradeIds = context.gradeOptions.map(grade => Number(grade.id));
  const prefill = subject ? existingGradeIds : new Set(chosenGradeIds);
  const groupedGrades = new Map();
  context.gradeOptions.forEach(grade => {
    if (!groupedGrades.has(grade.levelCode)) groupedGrades.set(grade.levelCode, []);
    groupedGrades.get(grade.levelCode).push(grade);
  });
  target.innerHTML = [...groupedGrades].map(([levelCode, grades]) => `
    <div class="grade-check-group" role="group" aria-labelledby="subject-grade-group-${levelCode}">
      <div class="grade-check-group-title" id="subject-grade-group-${levelCode}">${managementLevelLabel(levelCode)}</div>
      <div class="grade-check-grid">${grades.map(grade => {
        const checked = prefill.has(Number(grade.id));
        return `<label class="grade-check-item"><input type="checkbox" name="gradeLevelIds" value="${Number(grade.id)}" data-level-code="${grade.levelCode}" data-grade-code="${grade.gradeCode}" ${checked ? 'checked' : ''} data-page-change="g9914d313cdd7"><span>${grade.displayName}</span></label>`;
      }).join('')}</div>
    </div>`).join('') || '<small class="form-help">Configure a school level and grade before adding a subject.</small>';
  updateSubjectShsFields();
}

function updateSubjectShsFields() {
  const selectedGrades = [...document.querySelectorAll('#subjectGradeChecks input[name="gradeLevelIds"]:checked')];
  const containsShs = selectedGrades.some(input => input.dataset.levelCode === 'shs');
  const panel = document.getElementById('subjectShsFields');
  const groupSelect = document.getElementById('subjectShsGroup');
  const trackSelect = document.getElementById('subjectShsTrack');
  const hoursSelect = document.getElementById('subjectShsHours');
  if (!panel || !groupSelect || !trackSelect || !hoursSelect) return;
  panel.hidden = !containsShs;
  if (!containsShs) {
    groupSelect.value = '';
    trackSelect.value = '';
    hoursSelect.value = '';
    return;
  }
  const gradeCodes = selectedGrades.filter(input => input.dataset.levelCode === 'shs').map(input => input.dataset.gradeCode);
  const types = gradeCodes.every(code => code === 'grade-11')
    ? [{ value: 'core', label: 'Core subject' }] : [];
  managementSetOptions(groupSelect, types, 'Select a subject type', groupSelect.value);
  const group = groupSelect.value;
  let tracks = managementTrackOptions();
  if (group === 'academic_elective') tracks = tracks.filter(item => item.trackCode === 'academic');
  else if (group === 'techpro_elective' || group === 'work_immersion') tracks = tracks.filter(item => item.trackCode === 'techpro');
  managementSetOptions(trackSelect, [
    { value: '', label: group === 'core' ? 'Shared across all tracks' : 'Select a track' },
    ...tracks.map(item => ({ value: String(item.id), label: item.displayName }))
  ], '', trackSelect.value);
  trackSelect.disabled = group === 'core';
  let allowedHours = { core: [160], academic_elective: [80, 160, 320], techpro_elective: [320], work_immersion: [320, 640] }[group] || [];
  if (group === 'academic_elective' && gradeCodes.includes('grade-11')) allowedHours = [80];
  managementSetOptions(hoursSelect, allowedHours.map(hours => ({ value: String(hours), label: `${hours} hours` })), 'Select hours', hoursSelect.value);
}

function openSubjectModal(subjectKey) {
  const form = document.getElementById('createSubjectForm');
  const records = managementSubjectRecords();
  const subject = subjectKey
    ? records.find(record => record.id === subjectKey || record.name === subjectKey)
    : null;
  if (subject?.type === 'Needs Strengthened SHS setup') {
    showAppToast('This subject uses the earlier SHS setup. Clear the SHS test data before editing it.', 'error');
    return;
  }
  const contextValue = activeSubjectGrade || 'all';
  const contextStrand = activeSubjectStrand || 'all';
  const context = getSubjectModalContext(contextValue, contextStrand);
  subjectModalState.subject = subject || null;
  subjectModalState.contextValue = contextValue;
  subjectModalState.contextStrand = contextStrand;

  form.reset();
  form.action = subject ? `/subjects/update/${encodeURIComponent(subject.id)}` : '/subjects/create';
  form.dataset.mode = subject ? 'edit' : 'create';
  document.getElementById('subjectModalTitle').textContent = subject ? 'Edit Subject' : 'Add New Subject';
  document.getElementById('subjectModalSubjectId').value = subject?.id || '';
  form.elements.subjectName.value = subject?.name || '';
  form.elements.subjectCode.value = subject?.code || '';
  renderSubjectGradeChecks(contextValue, subject);
  updateSubjectShsFields();
  const subjectGroup = document.getElementById('subjectShsGroup');
  const subjectTrack = document.getElementById('subjectShsTrack');
  const subjectHours = document.getElementById('subjectShsHours');
  if (subjectGroup) subjectGroup.value = subject?.shsSubjectType || '';
  updateSubjectShsFields();
  if (subjectTrack) subjectTrack.value = subject?.trackId == null ? String(context.placement?.track?.id || '') : String(subject.trackId);
  updateSubjectShsFields();
  if (subjectHours) subjectHours.value = subject?.instructionalHours ? String(subject.instructionalHours) : '';
  document.querySelector('#subjectModalBackdrop .btn-save').textContent = subject ? 'Save Changes' : 'Save Subject';
  document.getElementById('subjectModalBackdrop').classList.add('open');
  lucide.createIcons();
}

function closeSubjectModal() {
  document.getElementById('subjectModalBackdrop').classList.remove('open');
}

document.getElementById('subjectModalBackdrop').addEventListener('click', function(e) {
  if (e.target === this) closeSubjectModal();
});

document.getElementById('createSubjectForm').addEventListener('submit', async function(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = String(form.elements.subjectName.value || '').trim();
  const code = String(form.elements.subjectCode.value || '').trim();
  if (!name || !code) {
    form.reportValidity();
    return;
  }

  const context = getSubjectModalContext(subjectModalState.contextValue, subjectModalState.contextStrand);
  const existing = subjectModalState.subject;
  const visibleGradeIds = new Set(context.gradeOptions.map(grade => Number(grade.id)));
  const checkedGradeIds = [...form.querySelectorAll('input[name="gradeLevelIds"]:checked')].map(input => Number(input.value));
  const preservedGradeIds = existing && context.mode !== 'all'
    ? (existing.gradeLevelIds || []).filter(id => !visibleGradeIds.has(Number(id))).map(Number)
    : [];
  const gradeLevelIds = [...new Set([...preservedGradeIds, ...checkedGradeIds])];
  if (!gradeLevelIds.length) {
    showAppToast('Select at least one grade level for this subject.', 'error');
    return;
  }
  const gradeRows = gradeLevelIds.map(id => MANAGEMENT_API_CONTEXT.structure.flatMap(level =>
    (level.gradeLevels || []).filter(grade => Number(grade.id) === Number(id)).map(grade => ({ ...grade, levelCode: level.levelCode, schoolLevelId: level.id }))
  )[0]).filter(Boolean);
  if (gradeRows.length !== gradeLevelIds.length) {
    showAppToast('Choose grade levels enabled for this school.', 'error');
    return;
  }
  const levelIds = [...new Set(gradeRows.map(grade => Number(grade.schoolLevelId)))];
  const shsSelected = gradeRows.some(grade => grade.levelCode === 'shs');
  const shsSubjectType = shsSelected ? document.getElementById('subjectShsGroup').value || null : null;
  const instructionalHours = shsSelected ? Number(document.getElementById('subjectShsHours').value) || null : null;
  const trackId = shsSelected && shsSubjectType !== 'core' ? Number(document.getElementById('subjectShsTrack').value) || null : null;
  if (shsSelected && (!shsSubjectType || !instructionalHours)) {
    showAppToast('Choose the SHS subject type and instructional hours before saving.', 'error');
    return;
  }
  if (shsSubjectType && shsSubjectType !== 'core' && !trackId) {
    showAppToast('Choose the track for this SHS subject.', 'error');
    return;
  }
  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;
  let saved = false;
  try {
    const payload = {
      subjectCode: code,
      name,
      schoolLevelId: levelIds.length === 1 ? levelIds[0] : null,
      gradeLevelIds,
      trackId,
      strandId: null,
      shsSubjectType,
      instructionalHours
    };
    if (existing?.apiId) await window.EDUGNAY_API.updateSubject(existing.apiId, payload);
    else await window.EDUGNAY_API.createSubject(payload);
    saved = true;
    closeSubjectModal();
    await refreshManagementViews();
    showAppToast(existing?.apiId ? 'Subject updated.' : 'Subject created.');
  } catch (error) {
    showAppToast(saved ? 'Subject saved, but the list could not refresh. Reload the page to verify it.' : error?.message || 'The subject could not be saved.', saved ? 'info' : 'error');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

let activeSubjectGrade = 'all';
let activeSubjectStrand = 'all';
let subjectTabTitles = { all: { title: 'All Subjects' } };

function updateSubjectPanelTitle() {
  const title = document.getElementById('subjectPanelTitle');
  if (!title) return;
  const info = subjectTabTitles[activeSubjectGrade] || subjectTabTitles.all;
  const placement = activeSubjectGrade.startsWith('shs') && activeSubjectStrand !== 'all'
    ? managementShsPlacementByKey(activeSubjectStrand)
    : null;
  title.textContent = placement ? `${info.title.replace(/ Subjects$/, '')} / ${placement.compactLabel} Subjects` : info.title;
  const fullTitle = placement ? `${info.title.replace(/ Subjects$/, '')} / ${placement.label} Subjects` : '';
  if (fullTitle && fullTitle !== title.textContent) title.setAttribute('title', fullTitle);
  else title.removeAttribute('title');
}

function switchSubjectGradeTab(grade, el) {
  activeSubjectGrade = grade;
  const level = grade === 'all' ? 'all' : (managementSchoolLevels().includes(grade) ? grade : grade.split(':')[0]);
  if (level !== 'shs') activeSubjectStrand = 'all';
  document.querySelectorAll('#subjectGradeTabs .division-filter-tab, #subjectGradeTabs .grade-filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`#subjectGradeTabs .division-filter-tab[data-division="${level}"]`)?.classList.add('active');
  renderSubjectGradeTabs(level);
  (el || document.querySelector(`#subjectGradeTabs .grade-filter-tab[data-grade="${grade}"]`))?.classList.add('active');
  updateSubjectPanelTitle();
  filterSubjects();
}

function switchSubjectDivisionTab(level, el) {
  activeSubjectGrade = level;
  activeSubjectStrand = 'all';
  document.querySelectorAll('#subjectGradeTabs .division-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.division === level);
    tab.setAttribute('aria-selected', String(tab.dataset.division === level));
  });
  renderSubjectGradeTabs(level);
  updateSubjectPanelTitle();
  filterSubjects();
}

function switchSubjectStrandTab(strand) {
  activeSubjectStrand = strand || 'all';
  if (!activeSubjectGrade.startsWith('shs')) activeSubjectGrade = 'shs';
  document.querySelectorAll('#subjectGradeTabs .division-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.division === 'shs');
    tab.setAttribute('aria-selected', String(tab.dataset.division === 'shs'));
  });
  renderSubjectGradeTabs('shs');
  document.querySelector(`#subjectStrandSubTabs .grade-filter-tab[data-strand="${activeSubjectStrand}"]`)?.classList.add('active');
  updateSubjectPanelTitle();
  filterSubjects();
}

function filterSubjects() {
  if (managementDataLoading) return;
  const search = document.getElementById('subjectSearchInput').value.toLowerCase();
  let visible = 0;
  document.querySelectorAll('#subjectTableBody .subject-card').forEach(row => {
    const matchSearch = row.dataset.name.includes(search);
    const matchGrade = managementSubjectFilterMatches(
      activeSubjectGrade,
      row.dataset.grades.split(',').filter(Boolean),
      activeSubjectStrand
    );
    const show = matchSearch && matchGrade;
    row.style.display = show ? '' : 'none';
    if (show) visible += 1;
  });
  updateManagementEmptySlot(document.getElementById('subjectTableBody'), 'subjects', {
    icon: 'book-open',
    title: 'No subjects found',
    text: 'Try adjusting the search or school-level filters.'
  }, visible === 0);
  lucide.createIcons();
}

/* ══════════════════════════════════════════════
   ASSIGN TEACHERS TAB
══════════════════════════════════════════════ */
function toggleTeacherSection(head) {
  const block = head.closest('.section-block');
  block.classList.toggle('collapsed');
  managementTeacherCollapseState[block.dataset.id] = block.classList.contains('collapsed');
}

function openTeacherModal(context) {
  if (teacherAssignmentPending) return;
  const ctx = context || 'Choose a teacher for assignment';
  renderTeacherOptions();
  document.getElementById('teacherCtxVal').textContent = ctx;
  document.getElementById('teacherAssignmentSectionId').value = teacherTargetSection || '';
  document.getElementById('teacherAssignmentSubjectId').value = teacherTargetSubjectId || '';
  document.getElementById('teacherAssignmentCommunicationComponentCode').value = teacherTargetCommunicationComponentCode || '';
  document.getElementById('teacherModalBackdrop').classList.add('open');
  document.getElementById('teacherPreview').classList.remove('visible');
  const select = document.getElementById('teacherSelect');
  select.disabled = false;
  select.value = '';
  window.syncSearchableSelect?.(select);
  const submitButton = document.getElementById('teacherAssignmentSubmit');
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.textContent = 'Save Assignment';
  }
}
function closeTeacherModal() {
  if (teacherAssignmentPending) return;
  document.getElementById('teacherModalBackdrop').classList.remove('open');
}
document.getElementById('teacherModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeTeacherModal(); });

function previewTeacher(select) {
  const preview = document.getElementById('teacherPreview');
  if (!select.value) {
    preview.classList.remove('visible');
    window.syncSearchableSelect?.(document.getElementById('teacherSelect'));
    return;
  }
  const option = select.selectedOptions[0];
  const name = option.dataset.name;
  const schoolEmail = option.dataset.schoolEmail;
  window.EDUGNAY_AVATAR.render(document.getElementById('tpAv'), teacherRecordById(select.value)
    || { id: select.value, name, initials: option.dataset.initials, role: 'teacher' });
  document.getElementById('tpName').textContent = name;
  document.getElementById('tpDetail').textContent = schoolEmail;
  preview.classList.add('visible');
  window.syncSearchableSelect?.(document.getElementById('teacherSelect'));
}

document.getElementById('assignTeacherForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (teacherAssignmentPending) return;
  const sectionId = document.getElementById('teacherAssignmentSectionId').value;
  const subjectId = document.getElementById('teacherAssignmentSubjectId').value;
  const communicationComponentCode = document.getElementById('teacherAssignmentCommunicationComponentCode').value || null;
  const teacherId = document.getElementById('teacherSelect').value || null;
  if (!sectionId || !subjectId || !teacherId) {
    alert('Choose a faculty member first.');
    return;
  }

  const section = managementSectionById(sectionId);
  const currentAssignment = section?.teacherAssignments?.find(item => item.subjectId === subjectId
    && (item.communicationComponentCode || null) === communicationComponentCode);
  const submitButton = document.getElementById('teacherAssignmentSubmit') || event.submitter;
  const teacherSelect = document.getElementById('teacherSelect');
  const originalLabel = submitButton?.textContent || 'Save Assignment';
  teacherAssignmentPending = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Assigning…';
  }
  teacherSelect.disabled = true;
  window.syncSearchableSelect?.(teacherSelect);

  let saved = false;
  try {
    if (currentAssignment?.teacherId === teacherId) {
      await refreshManagementViews();
      teacherAssignmentPending = false;
      closeTeacherModal();
      return;
    }
    if (currentAssignment?.assignmentId) {
      await window.EDUGNAY_API.updateTeacherAssignment(sectionId, currentAssignment.assignmentId, teacherId);
    } else {
      await window.EDUGNAY_API.assignTeacher(sectionId, teacherId, subjectId, communicationComponentCode);
    }
    saved = true;
    await refreshManagementViews();
    teacherAssignmentPending = false;
    closeTeacherModal();
    showAppToast('Teacher assignment saved.');
  } catch (error) {
    if (saved) {
      teacherAssignmentPending = false;
      closeTeacherModal();
    }
    showAppToast(saved ? 'Teacher assignment saved, but the list could not refresh. Reload the page to verify it.' : error?.message || 'The teacher assignment could not be saved.', saved ? 'info' : 'error');
  } finally {
    teacherAssignmentPending = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
    teacherSelect.disabled = false;
    window.syncSearchableSelect?.(teacherSelect);
  }
});

function filterTeacherBlocks() {
  if (managementDataLoading) return;
  const search = document.getElementById('teacherSearchInput').value.toLowerCase();
  const grade  = document.getElementById('teacherGradeFilter').value;
  const status = document.getElementById('teacherStatusFilter').value;
  let visible = 0;
  document.querySelectorAll('#panel-teachers .section-block').forEach(block => {
    const matchSearch = block.dataset.name.includes(search);
    const matchGrade  = grade === 'all' || block.dataset.grade === grade;
    const matchStatus = status === 'all' || block.dataset.status === status;
    const show = matchSearch && matchGrade && matchStatus;
    block.style.display = show ? '' : 'none';
    if (show) visible += 1;
  });
  updateManagementEmptySlot(document.getElementById('panel-teachers'), 'teachers', {
    icon: 'clipboard-list',
    title: 'No matching sections',
    text: 'Try adjusting the search, grade, or assignment status filter.'
  }, visible === 0);
  lucide.createIcons();
}

/* ══════════════════════════════════════════════
   ASSIGN STUDENTS TAB
══════════════════════════════════════════════ */
const managementAssignState = { student: null, level: '', grade: '', track: '', strand: '', section: '' };
let managementStudentPicker;
const managementMoveState = { student: null, level: '', grade: '', track: '', strand: '', section: '', excludedSection: '' };

function managementGradeKey(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.replace(/^grade\s*/, '');
}

function managementStrandKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function managementLevelLabel(level) {
  return MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === level)?.displayName || level;
}

function managementLevelShortLabel(level) {
  return ({ elementary: 'Elementary', jhs: 'JHS', shs: 'SHS' }[level]) || managementLevelLabel(level);
}

function managementSchoolLevels() {
  return MANAGEMENT_API_CONTEXT.structure.filter(level => level.isEnabled !== false).map(level => level.levelCode);
}

function managementDefaultLevel() {
  return managementSchoolLevels()[0] || '';
}

function managementDivision(level) {
  const apiLevel = MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === level);
  return {
    enabledGrades: (apiLevel?.gradeLevels || []).filter(item => item.isEnabled !== false).map(item => item.displayName),
    strands: (apiLevel?.tracks || []).filter(item => item.isEnabled !== false).map(item => item.displayName)
  };
}

function managementSectionStudentCount(sectionId) {
  const records = Array.isArray(STUDENTS_DATA) ? STUDENTS_DATA : [];
  return records.filter(student => student.sectionId === sectionId).length;
}

function managementSectionRecords() {
  return SECTION_RECORDS.map(section => {
    const teacherSection = TEACHER_ASSIGNMENTS_DATA.find(item => item.sectionId === section.id);
    const sectionSubjectIds = new Set(SUBJECTS_DATA
        .filter(subject => managementSubjectFilterMatches(managementSubjectSectionKey(section), subject.grades))
        .map(subject => subject.id));
    const subjects = sectionSubjectIds.size;
    const students = managementSectionStudentCount(section.id);
    const adviserId = section.adviserId || null;
    const adviserProfile = teacherRecordById(adviserId);
    const adviser = section.adviserName || adviserProfile?.displayName || null;
    return {
      ...section,
      gradeValue: managementGradeKey(section.grade),
      enrolled: students,
      students,
      subjects,
      adviserId,
      adviser,
      adviserInitials: adviserProfile
        ? `${adviserProfile.firstName?.[0] || ''}${adviserProfile.lastName?.[0] || ''}`.toUpperCase()
        : section.adviserInitials || '',
      teacherAssignments: section.teacherAssignments || [],
      collapsed: managementTeacherCollapseState[section.id] ?? teacherSection?.collapsed ?? true
    };
  });
}

function managementGradeFilterOptions() {
  return managementSchoolLevels().flatMap(level => managementGradeOptions(level).map(grade => ({
    value: `${level}:${managementGradeKey(grade)}`,
    level,
    grade,
    label: `${managementLevelLabel(level)} · ${grade}`
  })));
}

function managementSectionFilterKey(section) {
  return `${section.level}:${managementGradeKey(section.grade)}`;
}

function managementSubjectSectionKey(section) {
  const level = String(section?.level || '');
  const grade = managementGradeKey(section?.grade);
  if (level === 'shs') return `${level}:${grade}:${section.trackId ? `t${section.trackId}` : 'all'}:${section.strandId ? `s${section.strandId}` : 'all'}`;
  return `${level}:${grade}`;
}

function managementSectionTone(level, grade = '') {
  if (level === 'jhs') return grade || 'jhs';
  return level || 'default';
}

function managementSectionBarClass(level, grade = '') {
  if (level === 'jhs') return BAR_CLASS_BY_GRADE[grade] || 'bar-jhs';
  if (level === 'shs') return 'bar-shs';
  if (level === 'elementary') return 'bar-elementary';
  return 'bar-blue';
}

function managementSectionSort(a, b) {
  const levelOrder = { elementary: 0, jhs: 1, shs: 2 };
  const levelDifference = (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99);
  if (levelDifference) return levelDifference;

  const gradeValue = section => Number.parseInt(section.gradeValue, 10) || 99;
  const gradeDifference = gradeValue(a) - gradeValue(b);
  if (gradeDifference) return gradeDifference;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function managementSectionBadgeLabel(section) {
  const path = managementSectionPath(section);
  return `${section.grade}${path ? ` · ${path}` : ''}`;
}

function managementShsCompactPath(trackCodeValue, trackName, strandCodeValue, strandName, needsCurriculumSetup = false) {
  if (needsCurriculumSetup) return 'Needs Strengthened SHS setup';
  return { academic: 'Academic', techpro: 'TechPro' }[trackCodeValue] || trackName || '';
}

function managementSectionCardPath(section) {
  return managementShsCompactPath(section.trackCode, section.trackName, section.strandCode, section.strandName, section.needsCurriculumSetup);
}

function managementSectionCompactBadgeLabel(section) {
  const path = managementSectionCardPath(section);
  return `${section.grade}${path ? ` · ${path}` : ''}`;
}

function managementSectionPlacement(section) {
  return [managementLevelLabel(section.level), section.grade, managementSectionPath(section)].filter(Boolean).join(' · ');
}

function managementSectionCompactPlacement(section) {
  return [managementLevelLabel(section.level), section.grade, managementSectionCardPath(section)].filter(Boolean).join(' · ');
}

function managementSectionContext(section) {
  return [managementLevelLabel(section.level), managementSectionPath(section)].filter(Boolean).join(' · ');
}

function managementSectionCompactContext(section) {
  return [managementLevelLabel(section.level), managementSectionCardPath(section)].filter(Boolean).join(' · ');
}

function renderManagementGradeFilters() {
  const options = managementGradeFilterOptions();
  ['sectionGradeFilter', 'teacherGradeFilter'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="all">All School Levels</option>';
    options.forEach(optionData => select.appendChild(new Option(optionData.label, optionData.value)));
  });
}

function renderManagementTabPills() {
  const teacherPill = document.getElementById('teacherTabPill');
  const studentPill = document.getElementById('studentTabPill');
  if (teacherPill) teacherPill.textContent = `${getTeacherAssignmentStats().unassigned} open`;
  if (studentPill) studentPill.textContent = `${STUDENTS_DATA.filter(student => !student.sectionId).length} open`;
}

function managementSetOptions(select, options, placeholder, selectedValue) {
  if (!select) return;
  select.innerHTML = '';
  if (placeholder) select.appendChild(new Option(placeholder, ''));
  options.forEach(optionData => {
    const option = new Option(optionData.label, optionData.value);
    option.disabled = Boolean(optionData.disabled);
    select.appendChild(option);
  });
  select.value = options.some(option => option.value === selectedValue) ? selectedValue : '';
  window.syncSearchableSelect?.(select);
}

function managementGradeOptions(level) {
  return (MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === level)?.gradeLevels || [])
    .filter(item => item.isEnabled !== false)
    .map(item => item.displayName);
}

function managementTrackOptions() {
  return (MANAGEMENT_API_CONTEXT.structure.find(item => item.levelCode === 'shs')?.tracks || [])
    .filter(item => item.isEnabled !== false);
}

function managementStrandOptions(trackId) {
  const track = managementTrackOptions().find(item => String(item.id) === String(trackId)
    || managementGradeKey(item.displayName) === managementGradeKey(trackId));
  return [];
}

function managementTrackByName(value) {
  return managementTrackOptions().find(item => managementGradeKey(item.displayName) === managementGradeKey(value)) || null;
}

function managementSectionPath(section) {
  return section.needsCurriculumSetup ? 'Needs Strengthened SHS setup' : (section.trackName || '');
}

function managementStrandRequired(track) {
  return false;
}

function managementShsPlacementOptions() {
  return managementTrackOptions().flatMap(track => [{
      key: `${track.id}:all`,
      label: track.displayName,
      compactLabel: managementShsCompactPath(track.trackCode, track.displayName),
      track,
      strand: null
    }]);
}

function managementShsPlacementByKey(key) {
  const [trackPart, strandPart] = String(key || '').split(':');
  const trackId = trackPart.startsWith('t') ? trackPart.slice(1) : trackPart;
  const strandId = strandPart?.startsWith('s') ? strandPart.slice(1) : strandPart;
  return managementShsPlacementOptions().find(option => String(option.track.id) === trackId
    && String(option.strand?.id || 'all') === String(strandId || 'all')) || null;
}

function managementSectionLabel(section) {
  const path = managementSectionPath(section);
  return `${section.grade}${path ? ` · ${path}` : ''} · ${section.name} (${section.students}/${section.capacity})`;
}

function managementStudentMeta(studentId) {
  return STUDENTS_DATA.find(student => student.id === String(studentId)) || null;
}

function managementRenderStudentOptions(selectedId = '') {
  managementStudentPicker.setStudents(MANAGEMENT_ASSIGNMENT_STUDENTS, selectedId);
}

function managementRenderFields(state, ids, excludeSection = '', locked = false) {
  const levelSelect = document.getElementById(ids.level);
  const gradeSelect = document.getElementById(ids.grade);
  const trackSelect = document.getElementById(ids.track);
  const strandSelect = document.getElementById(ids.strand);
  const sectionSelect = document.getElementById(ids.section);
  const level = state.level;
  state.level = level;
  managementSetOptions(levelSelect, managementSchoolLevels().map(item => ({ value: item, label: managementLevelLabel(item) })), 'Select a school level', level);
  if (levelSelect) {
    levelSelect.disabled = !state.student || locked;
  }

  const grades = managementGradeOptions(level);
  const grade = grades.find(item => managementGradeKey(item) === managementGradeKey(state.grade)) || '';
  state.grade = grade;
  managementSetOptions(gradeSelect, grades.map(item => ({ value: item, label: item })), 'Select a grade level', grade);
  if (gradeSelect) gradeSelect.disabled = !state.student || !level || locked;

  const tracks = level === 'shs' ? managementTrackOptions() : [];
  const track = tracks.find(item => String(item.id) === String(state.track)) || null;
  state.track = track ? String(track.id) : '';
  const trackGroup = document.getElementById(ids.trackGroup);
  if (trackGroup) trackGroup.style.display = level === 'shs' ? '' : 'none';
  managementSetOptions(trackSelect, tracks.map(item => ({ value: String(item.id), label: item.displayName })), 'Select an SHS track', state.track);
  if (trackSelect) {
    trackSelect.disabled = !state.student || !grade || locked;
    trackSelect.required = level === 'shs';
  }
  const strands = track ? managementStrandOptions(track.id) : [];
  const strand = strands.find(item => String(item.id) === String(state.strand)) || null;
  state.strand = strand ? String(strand.id) : '';
  const requiresStrand = managementStrandRequired(track);
  const strandGroup = document.getElementById(ids.strandGroup);
  if (strandGroup) strandGroup.style.display = requiresStrand ? '' : 'none';
  managementSetOptions(strandSelect, strands.map(item => ({ value: String(item.id), label: item.displayName })), 'Select a strand', state.strand);
  if (strandSelect) {
    strandSelect.disabled = !state.student || !grade || !requiresStrand || locked;
    strandSelect.required = requiresStrand;
  }

  const hiddenValues = {
    [ids.levelValue]: state.level,
    [ids.gradeValue]: state.grade,
    [ids.trackValue]: state.track,
    [ids.strandValue]: state.strand
  };
  Object.entries(hiddenValues).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = value || '';
    input.disabled = !state.student;
  });

  const gradeKey = managementGradeKey(state.grade);
  const sectionOptions = managementSectionRecords().filter(section => {
    if (!level || !grade || (level === 'shs' && (!track || (requiresStrand && !state.strand)))) return false;
    if (section.level !== level || managementGradeKey(section.grade) !== gradeKey) return false;
    if (level === 'shs' && section.trackId !== state.track) return false;
    if (requiresStrand && section.strandId !== state.strand) return false;
    if (section.needsCurriculumSetup) return false;
    if (excludeSection && (section.id === excludeSection || section.name.toLowerCase() === String(excludeSection).toLowerCase())) return false;
    return true;
  }).map(section => ({
    value: section.id,
    label: managementSectionLabel(section),
    disabled: section.students + (locked ? 1 : (managementStudentPicker?.getSelectedIds().length || 1)) > section.capacity
  }));
  if (!sectionOptions.length) sectionOptions.push({ value: '', label: level && grade && (level !== 'shs' || track) ? 'No matching active sections' : 'Choose a level, grade, and track first', disabled: true });
  managementSetOptions(sectionSelect, sectionOptions, 'Select a section', state.section);
  state.section = sectionSelect?.value || '';
}

function updateManagementAssignmentContext() {
  const section = managementSectionRecords().find(item => item.id === document.getElementById('studentSectionSelect')?.value);
  managementAssignState.section = section?.id || '';
  const context = document.getElementById('studentCtxVal');
  if (!context) return;
  const student = managementAssignState.student;
  const track = managementTrackOptions().find(item => String(item.id) === managementAssignState.track);
  const strand = managementStrandOptions(managementAssignState.track).find(item => String(item.id) === managementAssignState.strand);
  const placement = [managementLevelLabel(managementAssignState.level), managementAssignState.grade, track?.displayName, strand?.displayName].filter(Boolean).join(' · ');
  context.textContent = section ? `${student?.displayName || 'Student not selected'} · ${placement} · ${section.name}` : `${student?.displayName || 'Select a student'} · ${placement}`;
}

function updateManagementMoveContext() {
  const sections = managementSectionRecords();
  const section = sections.find(item => item.id === document.getElementById('moveSectionSelect')?.value);
  const sourceSection = sections.find(item => String(item.id) === String(managementMoveState.student?.sectionId));
  managementMoveState.section = section?.id || '';
  const context = document.getElementById('moveCtxVal');
  if (!context) return;
  const track = managementTrackOptions().find(item => String(item.id) === managementMoveState.track);
  const strand = managementStrandOptions(managementMoveState.track).find(item => String(item.id) === managementMoveState.strand);
  const placement = [managementLevelLabel(managementMoveState.level), managementMoveState.grade, track?.displayName, strand?.displayName].filter(Boolean).join(' · ');
  const currentPlacement = sourceSection
    ? `Currently in ${[sourceSection.grade, managementSectionPath(sourceSection), sourceSection.name].filter(Boolean).join(' · ')}`
    : 'Current section details unavailable';
  context.textContent = section ? `${placement} · ${section.name}` : currentPlacement;
}

function updateManagementAssignmentFields(changed = '') {
  if (changed === 'level') {
    managementAssignState.level = document.getElementById('studentSchoolLevel').value;
    managementAssignState.grade = '';
    managementAssignState.track = '';
    managementAssignState.strand = '';
  } else if (changed === 'grade') {
    managementAssignState.grade = document.getElementById('studentGradeLevel').value;
    managementAssignState.track = '';
    managementAssignState.strand = '';
  } else if (changed === 'track') {
    managementAssignState.track = document.getElementById('studentTrack').value;
    managementAssignState.strand = '';
  } else if (changed === 'strand') {
    managementAssignState.strand = document.getElementById('studentStrand').value;
  }
  if (changed) managementAssignState.section = '';
  managementRenderFields(managementAssignState, { level: 'studentSchoolLevel', grade: 'studentGradeLevel', track: 'studentTrack', trackGroup: 'studentTrackGroup', strand: 'studentStrand', strandGroup: 'studentStrandGroup', section: 'studentSectionSelect', levelValue: 'studentSchoolLevelValue', gradeValue: 'studentGradeLevelValue', trackValue: 'studentTrackValue', strandValue: 'studentStrandValue' });
  updateManagementAssignmentContext();
}

function updateManagementMoveFields(changed = '') {
  if (changed === 'track') {
    managementMoveState.track = document.getElementById('moveTrack').value;
    managementMoveState.strand = '';
    managementMoveState.section = '';
  } else if (changed === 'strand') {
    managementMoveState.strand = document.getElementById('moveStrand').value;
    managementMoveState.section = '';
  }
  managementRenderFields(managementMoveState, { level: 'moveSchoolLevel', grade: 'moveGradeLevel', track: 'moveTrack', trackGroup: 'moveTrackGroup', strand: 'moveStrand', strandGroup: 'moveStrandGroup', section: 'moveSectionSelect', levelValue: 'moveSchoolLevelValue', gradeValue: 'moveGradeLevelValue', trackValue: 'moveTrackValue', strandValue: 'moveStrandValue' }, managementMoveState.excludedSection, true);
  updateManagementMoveContext();
}

function handleManagementStudentChange(studentIds) {
  const student = studentIds.length ? managementStudentMeta(studentIds[0]) : null;
  if (!managementAssignState.student || !student) {
    managementAssignState.level = student?.schoolLevel || '';
    managementAssignState.grade = student?.gradeLevel || '';
    managementAssignState.track = student?.trackId || '';
    managementAssignState.strand = student?.strandId || '';
  }
  managementAssignState.student = student;
  updateManagementAssignmentFields();
}

let studentAssignmentPending = false;

function openStudentAssignModal(studentId = '') {
  const matchedStudent = managementStudentMeta(studentId);
  document.getElementById('studentModalTitle').textContent = 'Assign Students';
  document.getElementById('studentModalSub').textContent = 'Choose students and one class placement.';
  managementAssignState.student = null;
  managementAssignState.level = '';
  managementAssignState.grade = '';
  managementAssignState.track = '';
  managementAssignState.strand = '';
  managementAssignState.section = '';
  managementRenderStudentOptions(matchedStudent?.id || '');

  document.getElementById('assignStudentForm').style.display = '';
  document.getElementById('moveStudentForm').style.display = 'none';
  document.getElementById('studentModalSubmitBtn').setAttribute('form', 'assignStudentForm');
  document.getElementById('studentModalSubmitBtn').textContent = 'Save Assignment';

  updateManagementAssignmentFields();

  document.getElementById('studentAssignModalBackdrop').classList.add('open', 'is-assigning');
}
function closeStudentAssignModal() {
  if (studentAssignmentPending) return;
  document.getElementById('studentAssignModalBackdrop').classList.remove('open');
}
document.getElementById('studentAssignModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeStudentAssignModal(); });

function openMoveStudentModal(studentName, studentId, currentSection) {
  const student = managementStudentMeta(studentId);
  if (!student) return;
  document.getElementById('studentModalTitle').textContent = `Move: ${student.displayName || studentName}`;
  document.getElementById('studentModalSub').textContent = 'Choose a new class placement.';
  document.getElementById('moveStudentId').value = studentId;

  managementMoveState.student = student;
  managementMoveState.level = student.schoolLevel || 'jhs';
  managementMoveState.grade = student.gradeLevel || '';
  managementMoveState.track = student.trackId || '';
  managementMoveState.strand = student.strandId || '';
  managementMoveState.section = '';
  managementMoveState.excludedSection = currentSection || '';

  document.getElementById('assignStudentForm').style.display = 'none';
  document.getElementById('moveStudentForm').style.display = '';
  document.getElementById('studentModalSubmitBtn').setAttribute('form', 'moveStudentForm');
  document.getElementById('studentModalSubmitBtn').textContent = 'Save Move';
  updateManagementMoveFields();

  document.getElementById('studentAssignModalBackdrop').classList.remove('is-assigning');
  document.getElementById('studentAssignModalBackdrop').classList.add('open');
}

let pendingRemoveRequest = null;
let studentRemovalPending = false;
let teacherRemovalPending = false;

function setConfirmRemoveIcons(iconName) {
  ['confirmRemoveHeaderIcon', 'confirmRemoveContextIcon'].forEach(id => {
    const current = document.getElementById(id);
    if (!current || !current.parentElement) return;
    current.parentElement.innerHTML = `<i id="${id}" data-lucide="${iconName}" aria-hidden="true"></i>`;
  });
  lucide.createIcons();
}

function setConfirmRemoveMessage(parts = []) {
  const target = document.getElementById('confirmRemoveMessage');
  if (!target) return;
  target.replaceChildren();
  parts.forEach(part => {
    const node = document.createElement(part.strong ? 'strong' : 'span');
    node.textContent = part.text;
    target.appendChild(node);
  });
}

function openConfirmRemoveModal(config) {
  pendingRemoveRequest = { ...config };
  const form = document.getElementById('removeStudentForm');
  const type = config.type || 'record';
  const targetId = config.targetId || config.id || '';

  document.getElementById('confirmRemoveTitle').textContent = config.title || `Remove: ${config.name || 'record'}`;
  document.getElementById('confirmRemoveSub').textContent = config.sub || 'Review this change before continuing.';
  document.getElementById('confirmRemoveLabel').textContent = config.label || 'Removing';
  document.getElementById('confirmRemoveName').textContent = config.name || 'Selected record';
  document.getElementById('confirmRemoveType').value = type;
  document.getElementById('confirmRemoveTargetId').value = targetId;
  document.getElementById('removeStudentId').value = type === 'student' ? config.id || '' : '';
  form.action = config.action || '/records/remove';
  form.dataset.removeType = type;
  form.dataset.targetId = targetId;

  const context = config.context || '';
  const contextValue = document.getElementById('confirmRemoveName');
  if (context && config.contextLabel) {
    document.getElementById('confirmRemoveLabel').textContent = config.contextLabel;
    contextValue.textContent = context;
  }
  setConfirmRemoveIcons(config.icon || 'trash-2');
  setConfirmRemoveMessage(config.messageParts || [{ text: 'This action cannot be undone.' }]);
  document.getElementById('confirmRemoveSubmit').textContent = config.submitLabel || 'Yes, Remove';
  document.getElementById('confirmRemoveModalBackdrop').classList.add('open');
}

function openTeacherRemoveConfirmation({ sectionId, assignmentId, subjectId, sectionName, gradeLabel, subjectName, teacherName }) {
  const placement = [gradeLabel, sectionName].filter(Boolean).join(' · ');
  openConfirmRemoveModal({
    type: 'teacher',
    id: `${sectionId}|${subjectId}`,
    targetId: `${sectionId}|${subjectId}`,
    sectionId,
    assignmentId,
    subjectId,
    subjectName,
    name: teacherName,
    context: `${subjectName}${placement ? ` · ${placement}` : ''}`,
    contextLabel: 'Unassigning from',
    title: `Remove: ${teacherName}`,
    sub: 'This will clear the current teacher assignment.',
    label: 'Unassigning from',
    icon: 'user-minus',
    action: '/assignments/remove',
    submitLabel: 'Yes, Unassign',
    messageParts: [
      { text: 'This will unassign ' },
      { text: teacherName, strong: true },
      { text: ' from ' },
      { text: subjectName, strong: true },
      ...(placement ? [{ text: ' in ' }, { text: placement, strong: true }] : []),
      { text: '. The subject slot will remain available.' }
    ]
  });
}

function openSubjectRemoveConfirmation(subject) {
  if (!subject) return;
  const scope = getSubjectModalContext(activeSubjectGrade, activeSubjectStrand);
  const removingAll = scope.mode === 'all';
  const scopeLabel = removingAll ? 'all enabled grade levels and strands' : scope.label;
  openConfirmRemoveModal({
    type: 'subject',
    id: subject.id,
    targetId: subject.id,
    contextValue: activeSubjectGrade,
    contextStrand: activeSubjectStrand,
    name: subject.name,
    context: managementSubjectDescriptor(subject, 'Subject details'),
    contextLabel: 'Subject',
    title: `Remove: ${subject.name}`,
    sub: 'Remove this subject from the selected grade or strand.',
    label: 'Subject',
    icon: 'book-minus',
    action: '/subjects/remove',
    messageParts: [
      { text: `Remove this subject from ${scopeLabel}? If school records use it, it will be deactivated and those records will stay available; otherwise, it will be permanently deleted.` }
    ]
  });
}

function removeStudentFromClass(studentName, section, studentId, sectionId) {
  openConfirmRemoveModal({
    type: 'student',
    id: studentId,
    targetId: studentId,
    sectionId,
    name: studentName,
    context: section,
    title: `Remove: ${studentName}`,
    sub: 'The student can be assigned to a section again.',
    label: 'Removing',
    icon: 'user-minus',
    action: '/assignments/students/remove',
    submitLabel: 'Yes, Remove',
    messageParts: [
      { text: 'This will remove ' },
      { text: studentName, strong: true },
      { text: ' from ' },
      { text: section || 'this section', strong: true },
      { text: '. They will appear as unassigned. Their attendance, grades, and submitted work stay saved.' }
    ]
  });
}

function setStudentRemovalPendingState(request, pending) {
  const removeButtons = [...document.querySelectorAll('#sectionStudentsTableBody .row-btn.remove')];
  if (pending) request.removeButtonStates = new Map(removeButtons.map(button => [button, button.disabled]));
  removeButtons.forEach(button => {
    button.disabled = pending ? true : request.removeButtonStates?.get(button) || false;
  });
  const submitButton = document.getElementById('confirmRemoveSubmit');
  if (submitButton) {
    submitButton.disabled = pending;
    submitButton.textContent = pending ? 'Removing…' : request.submitLabel || 'Yes, Remove';
  }
  if (!pending) delete request.removeButtonStates;
}

function setTeacherRemovalPendingState(request, pending) {
  const removeButtons = [...document.querySelectorAll('#panel-teachers .section-block .row-btn.remove')];
  if (pending) request.removeButtonStates = new Map(removeButtons.map(button => [button, button.disabled]));
  removeButtons.forEach(button => {
    button.disabled = pending ? true : request.removeButtonStates?.get(button) || false;
  });
  const submitButton = document.getElementById('confirmRemoveSubmit');
  if (submitButton) {
    submitButton.disabled = pending;
    submitButton.textContent = pending ? 'Removing…' : request.submitLabel || 'Yes, Unassign';
  }
  if (!pending) delete request.removeButtonStates;
}

function updateTeacherAssignmentAfterRemoval(request) {
  const section = SECTION_RECORDS.find(record => String(record.id) === String(request.sectionId));
  if (!section) throw new Error('The teacher assignment was removed, but its section could not be updated. Reload the page to verify it.');
  const assignments = Array.isArray(section.teacherAssignments) ? section.teacherAssignments : [];
  const assignmentIndex = assignments.findIndex(record => String(record.assignmentId ?? record.id) === String(request.assignmentId));
  if (assignmentIndex === -1) throw new Error('The teacher assignment was removed, but the list could not be updated. Reload the page to verify it.');

  assignments.splice(assignmentIndex, 1);
  section.teacherAssignments = assignments;
  const teacherSection = TEACHER_ASSIGNMENTS_DATA.find(record => String(record.sectionId) === String(section.id));
  if (teacherSection) teacherSection.subjects = assignments;

  renderManagementTabPills();
  renderSubjects();
  filterSubjects();
  renderTeacherAssignments();
}

async function removeTeacherAssignmentInPlace(request) {
  if (teacherRemovalPending) return;

  teacherRemovalPending = true;
  setTeacherRemovalPendingState(request, true);
  let removed = false;
  try {
    await window.EDUGNAY_API.removeTeacherAssignment(request.sectionId, request.assignmentId);
    removed = true;
    updateTeacherAssignmentAfterRemoval(request);
    closeConfirmRemoveModal(true);
    showAppToast('Teacher assignment removed.');
  } catch (error) {
    if (removed) {
      closeConfirmRemoveModal(true);
      showAppToast('Teacher assignment removed, but the list could not update. Reload the page to verify it.', 'info');
    } else {
      showAppToast(error?.message || 'The teacher assignment could not be removed.', 'error');
    }
  } finally {
    teacherRemovalPending = false;
    setTeacherRemovalPendingState(request, false);
  }
}

async function removeStudentFromSection(request, student) {
  if (studentRemovalPending) return;
  const sectionId = request.sectionId || student.sectionId;
  if (!sectionId) {
    showAppToast('This student is not assigned to a section.', 'error');
    return;
  }

  studentRemovalPending = true;
  setStudentRemovalPendingState(request, true);
  try {
    await window.EDUGNAY_API.withdrawStudent(sectionId, student.id);
    student.sectionId = null;
    student.schoolLevel = '';
    student.gradeLevel = '';
    student.trackId = null;
    student.track = '';
    student.strandId = null;
    student.strand = '';
    MANAGEMENT_ASSIGNMENT_STUDENTS = STUDENTS_DATA.filter(record => !record.sectionId);
    closeConfirmRemoveModal(true);

    try {
      renderSectionStudentsModal(sectionId);
      renderManagementTabPills();
      renderSections();
      filterSections();
      renderStudentsTab();
      showAppToast('Student removed from section.');
    } catch (error) {
      showAppToast('Student removed, but the lists could not update. Reload the page to verify it.', 'info');
    }
  } catch (error) {
    showAppToast(error?.message || 'The student could not be removed from the section.', 'error');
  } finally {
    studentRemovalPending = false;
    setStudentRemovalPendingState(request, false);
  }
}

function closeConfirmRemoveModal(force = false) {
  if ((studentRemovalPending || teacherRemovalPending) && !force) return;
  document.getElementById('confirmRemoveModalBackdrop').classList.remove('open');
  pendingRemoveRequest = null;
}
document.getElementById('confirmRemoveModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeConfirmRemoveModal(); });

document.getElementById('assignStudentForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  if (studentAssignmentPending) return;
  const studentIds = managementStudentPicker.getSelectedIds();
  const section = managementSectionById(document.getElementById('studentSectionSelect').value);
  const track = managementTrackOptions().find(item => String(item.id) === managementAssignState.track);
  const requiresStrand = managementStrandRequired(track);
  if (!studentIds.length || !section || !managementAssignState.level || !managementAssignState.grade
    || (managementAssignState.level === 'shs' && !track)
    || (requiresStrand && !managementAssignState.strand)) {
    showAppToast('Choose students, school level, grade, track, strand where required, and matching section first.', 'error');
    return;
  }
  if (section.level !== managementAssignState.level || managementGradeKey(section.grade) !== managementGradeKey(managementAssignState.grade)
    || (section.level === 'shs' && section.trackId !== managementAssignState.track)
    || (requiresStrand && section.strandId !== managementAssignState.strand)
    || section.needsCurriculumSetup) {
    showAppToast('The selected section does not match the chosen grade, track, or strand.', 'error');
    return;
  }

  const submitButton = document.getElementById('studentModalSubmitBtn');
  const originalLabel = submitButton?.textContent || 'Save Assignment';
  studentAssignmentPending = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Assigning…';
  }
  let saved = false;
  try {
    managementStudentPicker.setDisabled(true);
    await window.EDUGNAY_API.enrollStudentsBulk(section.id, studentIds);
    saved = true;
    await refreshManagementViews();
    studentAssignmentPending = false;
    closeStudentAssignModal();
    showAppToast(`${studentIds.length} student${studentIds.length === 1 ? '' : 's'} assigned to section.`);
  } catch (error) {
    if (saved) {
      studentAssignmentPending = false;
      closeStudentAssignModal();
    }
    showAppToast(saved ? 'Student assignment saved, but the list could not refresh. Reload the page to verify it.' : error?.message || 'That student could not be updated.', saved ? 'info' : 'error');
  } finally {
    studentAssignmentPending = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
    managementStudentPicker.setDisabled(false);
  }
});

let pendingMovePreview = null;

function closeMoveConfirmModal() {
  document.getElementById('moveConfirmModalBackdrop').classList.remove('open');
  pendingMovePreview = null;
}
document.getElementById('moveConfirmModalBackdrop').addEventListener('click', function (event) {
  if (event.target === this) closeMoveConfirmModal();
});

document.getElementById('moveStudentForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const studentId = document.getElementById('moveStudentId').value;
  const section = managementSectionById(document.getElementById('moveSectionSelect').value);
  if (!studentId || !section) { alert('Choose a new section first.'); return; }
  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;
  try {
    const student = managementStudentMeta(studentId);
    if (!student?.sectionId) throw new Error('The current section is unavailable. Reload and try again.');
    const preview = await window.EDUGNAY_API.previewStudentMove(student.sectionId, studentId, section.id);
    pendingMovePreview = { studentId, sourceSectionId: student.sectionId, targetSectionId: section.id, preview };
    document.getElementById('moveConfirmContext').textContent = `${preview.studentName} · ${preview.source.name} → ${preview.target.name}`;
    document.getElementById('moveConfirmImpact').textContent = preview.priorScoreCount
      ? `${preview.priorScoreCount} score${preview.priorScoreCount === 1 ? '' : 's'} from the current grading period need the receiving teacher’s review.${preview.publishedGradeCount ? ` ${preview.publishedGradeCount} published grade${preview.publishedGradeCount === 1 ? '' : 's'} will remain final.` : ''}`
      : preview.publishedGradeCount
        ? `${preview.publishedGradeCount} published grade${preview.publishedGradeCount === 1 ? '' : 's'} will remain final for this period.`
        : 'No scores or published grades were found in the current grading period.';
    document.getElementById('moveConfirmModalBackdrop').classList.add('open');
    document.getElementById('moveConfirmSubmit').focus();
  } catch (error) {
    showAppToast(error?.message || 'The move could not be reviewed.', 'error');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

document.getElementById('moveConfirmSubmit').addEventListener('click', async function () {
  const request = pendingMovePreview;
  if (!request) return;
  this.disabled = true;
  let saved = false;
  try {
    await window.EDUGNAY_API.moveStudent(request.sourceSectionId, request.studentId, request.targetSectionId);
    saved = true;
    closeMoveConfirmModal();
    closeStudentAssignModal();
    await refreshManagementViews();
    showAppToast('Student moved. Previous records remain saved.');
  } catch (error) {
    if (saved) {
      closeMoveConfirmModal();
      showAppToast('Student moved, but the list could not refresh. Reload to verify the placement.', 'info');
    } else {
      showAppToast(error?.message || 'The student could not be moved.', 'error');
    }
  } finally { this.disabled = false; }
});

document.getElementById('removeStudentForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const type = this.dataset.removeType || document.getElementById('confirmRemoveType').value || 'student';
  const targetId = this.dataset.targetId || document.getElementById('confirmRemoveTargetId').value;

  if (type === 'teacher') {
    const request = pendingRemoveRequest || {};
    await removeTeacherAssignmentInPlace(request);
    return;
  }

  if (type === 'section') {
    const submitButton = event.submitter;
    const originalLabel = submitButton?.textContent || 'Delete Section';
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Deleting…'; }
    let deleted = false;
    try {
      await window.EDUGNAY_API.deleteSection(targetId);
      deleted = true;
      closeConfirmRemoveModal();
      await refreshManagementViews();
      showAppToast('Section deleted.');
    } catch (error) {
      showAppToast(deleted ? 'Section deleted, but the list could not refresh.' : error.message || 'The section could not be deleted.', deleted ? 'info' : 'error');
    } finally {
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalLabel; }
    }
    return;
  }

  if (type === 'subject') {
    {
      const submitButton = event.submitter;
      const originalLabel = submitButton?.textContent || 'Yes, Remove';
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Removing…'; }
      let removed = false;
      try {
        const result = await window.EDUGNAY_API.deleteSubject(targetId);
        removed = true;
        closeConfirmRemoveModal();
        await refreshManagementViews();
        showAppToast(result.deleted ? 'Subject permanently deleted.' : 'Subject deactivated; linked records were preserved.', result.deleted ? 'success' : 'info');
      } catch (error) {
        showAppToast(removed ? 'Subject removed, but the list could not refresh.' : error.message || 'The subject could not be removed.', removed ? 'info' : 'error');
      } finally {
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalLabel; }
      }
      return;
    }
  }

  const studentId = document.getElementById('removeStudentId').value || targetId;
  const student = managementStudentMeta(studentId);
  if (!student) { closeConfirmRemoveModal(); return; }
  await removeStudentFromSection(pendingRemoveRequest || {}, student);

});

function openImportStudentsModal() {
  document.getElementById('importStudentsForm').reset();
  document.getElementById('csvPreviewWrap').style.display = 'none';
  document.getElementById('importSchoolLevel').value = managementDefaultLevel();
  updateImportGradeOptions();
  document.getElementById('fileUploadName').textContent = 'No file selected';
  document.getElementById('fileUploadName').classList.remove('has-file');
  document.getElementById('importStudentsModalBackdrop').classList.add('open');
}
function closeImportStudentsModal() { document.getElementById('importStudentsModalBackdrop').classList.remove('open'); }
document.getElementById('importStudentsModalBackdrop').addEventListener('click', function(e) { if (e.target === this) closeImportStudentsModal(); });

function updateImportGradeOptions() {
  const levelSelect = document.getElementById('importSchoolLevel');
  const levels = managementSchoolLevels();
  const requestedLevel = levelSelect?.value || managementDefaultLevel();
  const level = levels.includes(requestedLevel) ? requestedLevel : levels[0] || '';
  managementSetOptions(levelSelect, levels.map(option => ({ value: option, label: managementLevelLabel(option) })), 'Select a school level', level);
  const gradeSelect = document.getElementById('importGrade');
  const currentGrade = gradeSelect?.value || '';
  const grades = managementGradeOptions(level);
  const grade = grades.find(option => managementGradeKey(option) === managementGradeKey(currentGrade)) || grades[0] || '';
  managementSetOptions(gradeSelect, grades.map(option => ({ value: option, label: option })), 'Select a grade level', grade);
  const trackSelect = document.getElementById('importTrack');
  const trackGroup = document.getElementById('importTrackGroup');
  const tracks = level === 'shs' ? managementTrackOptions() : [];
  const track = tracks.find(item => String(item.id) === trackSelect?.value) || tracks[0] || null;
  if (trackGroup) trackGroup.style.display = level === 'shs' ? '' : 'none';
  managementSetOptions(trackSelect, tracks.map(item => ({ value: String(item.id), label: item.displayName })), 'Select a track', track ? String(track.id) : '');
  if (trackSelect) trackSelect.required = level === 'shs';
  const strandSelect = document.getElementById('importStrand');
  const strandRow = document.getElementById('importStrandRow');
  const strandGroup = document.getElementById('importStrandGroup');
  const strands = track ? managementStrandOptions(track.id) : [];
  const strand = strands.find(item => String(item.id) === strandSelect?.value) || strands[0] || null;
  const requiresStrand = managementStrandRequired(track);
  if (strandRow) strandRow.style.display = level === 'shs' ? 'grid' : 'none';
  if (strandGroup) strandGroup.style.display = requiresStrand ? '' : 'none';
  managementSetOptions(strandSelect, strands.map(option => ({ value: String(option.id), label: option.displayName })), 'Select a strand', strand ? String(strand.id) : '');
  if (strandSelect) strandSelect.required = requiresStrand;
}

function selectImportGrade(value) {
  const gradeSelect = document.getElementById('importGrade');
  if (gradeSelect) gradeSelect.value = value;
}

function previewCSV(input) {
  const file = input.files[0];
  const nameEl = document.getElementById('fileUploadName');
  if (!file) { nameEl.textContent = 'No file selected'; nameEl.classList.remove('has-file'); return; }
  nameEl.textContent = file.name;
  nameEl.classList.add('has-file');

  const reader = new FileReader();
  reader.onload = function(e) {
    const lines = e.target.result.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return;
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1, 6).map(l => l.split(',').map(c => c.trim()));

    document.getElementById('csvPreviewHead').innerHTML =
      '<tr>' + headers.map(h => `<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--gray-200);">${h}</th>`).join('') + '</tr>';
    document.getElementById('csvPreviewBody').innerHTML =
      rows.map(r => '<tr>' + r.map(c => `<td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);">${c}</td>`).join('') + '</tr>').join('');
    document.getElementById('csvPreviewCount').textContent = `Showing ${rows.length} of ${lines.length - 1} rows`;
    document.getElementById('csvPreviewWrap').style.display = '';
  };
  reader.readAsText(file);
}

/* ── IMPORT & AUTO-SORT SUBMIT (mirrors importUsersForm on the users page) ── */
async function createImportedStudentAccount(record, level, grade, strand, section) {
  const firstName = String(record.firstName || '').trim();
  const lastName = String(record.lastName || '').trim();
  const schoolEmail = String(record.schoolEmail || '').trim().toLowerCase();
  {
    const existing = STUDENTS_DATA.find(item => String(item.schoolEmail || '').toLowerCase() === schoolEmail);
    let user = existing;
    if (user) {
      const updated = await window.EDUGNAY_API.updateUser(user.id, { firstName, lastName, schoolEmail, lrn: String(record.lrn || '').trim() });
      user = updated.user;
    } else {
      const created = await window.EDUGNAY_API.createUser({ role: 'student', firstName, lastName, schoolEmail, lrn: String(record.lrn || '').trim() });
      user = created.user;
    }
    await window.EDUGNAY_API.enrollStudent(section.id, user.id);
    return user;
  }
}

document.getElementById('importStudentsForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const level = document.getElementById('importSchoolLevel').value;
  const grade = document.getElementById('importGrade').value;
  const trackId = document.getElementById('importTrack').value;
  const strand = document.getElementById('importStrand').value;
  const track = managementTrackOptions().find(item => String(item.id) === trackId);
  const requiresStrand = managementStrandRequired(track);
  const fileInput = document.getElementById('csvFileInput');
  const file = fileInput.files[0];

  if (!level || !grade || (level === 'shs' && !trackId) || (requiresStrand && !strand)) { alert('Please select a school level, grade, and SHS track or strand where required.'); return; }
  if (!file) { alert('Please choose a CSV file.'); return; }

  const reader = new FileReader();
  reader.onload = async function (ev) {
    const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim().length);
    if (lines.length < 2) { alert('CSV appears to be empty.'); return; }

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));

    const records = rows.map(cols => {
      const record = {};
      headers.forEach((h, i) => record[h] = cols[i] || '');
      return record;
    });

    const users = STUDENTS_DATA;
    const importedLrns = new Set();
    const importedEmails = new Set();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const lrn = String(record.lrn || '').trim();
      const schoolEmail = String(record.schoolEmail || '').trim().toLowerCase();
      const existingUser = schoolEmail
        ? users.find(user => String(user.schoolEmail || '').toLowerCase() === schoolEmail)
        : null;
      const lrnOwner = users.find(user => user.role === 'student' && String(user.lrn || '').trim() === lrn);

      if (!schoolEmail) {
        alert(`Row ${index + 2}: School email is required.`);
        return;
      }

      if (!/^\d{12}$/.test(lrn)) {
        alert(`Row ${index + 2}: LRN must contain exactly 12 digits.`);
        return;
      }
      if (importedLrns.has(lrn) || (lrnOwner && lrnOwner.id !== existingUser?.id)) {
        alert(`Row ${index + 2}: That LRN is already assigned to another student account.`);
        return;
      }
      if (schoolEmail && importedEmails.has(schoolEmail)) {
        alert(`Row ${index + 2}: That school email appears more than once in this file.`);
        return;
      }

      record.lrn = lrn;
      record.schoolEmail = schoolEmail;
      importedLrns.add(lrn);
      if (schoolEmail) importedEmails.add(schoolEmail);
    }

    // Highest averages get seated first, then distributed round-robin
    // across this grade's sections so no single section overfills first.
    records.sort((a, b) => (parseFloat(b.average) || 0) - (parseFloat(a.average) || 0));

    const gradeSections = managementSectionRecords().filter(section => section.level === level && managementGradeKey(section.grade) === managementGradeKey(grade)
      && (level !== 'shs' || section.trackId === trackId)
      && (!requiresStrand || section.strandId === strand)
      && !section.needsCurriculumSetup);
    if (!gradeSections.length) { alert('No sections found for this placement.'); return; }

    let sectionIdx = 0;
    let placed = 0;

    let importError = null;
    for (const record of records) {
      // skip sections that are already full
      let attempts = 0;
      while (gradeSections[sectionIdx].students >= gradeSections[sectionIdx].capacity && attempts < gradeSections.length) {
        sectionIdx = (sectionIdx + 1) % gradeSections.length;
        attempts++;
      }
      if (attempts >= gradeSections.length) break; // all sections full, student stays unplaced

      const targetSection = gradeSections[sectionIdx];
      try {
        await createImportedStudentAccount(record, level, grade, strand, targetSection);
      } catch (error) {
        importError = error;
        break;
      }

      targetSection.students++;
      placed++;
      sectionIdx = (sectionIdx + 1) % gradeSections.length;
    }

    await refreshManagementViews();
    closeImportStudentsModal();
    alert(importError
      ? `${placed} of ${records.length} student(s) were imported before the error: ${importError.message}`
      : `${placed} of ${records.length} student(s) auto-sorted into ${managementLevelLabel(level)} ${grade} sections.`);

  };
  reader.readAsText(file);
});

let activeStudentGrade   = 'all';
let activeStudentSection = null;

let studentTabTitles = {
  all: { title: 'All Enrolled Students', meta: 'Showing students across all sections' },
  unassigned: { title: 'Unassigned Students', meta: 'Students not yet placed in any section' },
};

function switchStudentGradeTab(grade, el) {
  activeStudentGrade   = grade;
  activeStudentSection = null;

  const level = grade === 'all' || grade === 'unassigned'
    ? grade
    : (managementSchoolLevels().includes(grade) ? grade : grade.split(':')[0]);
  document.querySelectorAll('#studentGradeTabs .division-filter-tab, #studentGradeTabs .grade-filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sc-card').forEach(c => c.classList.remove('selected'));

  document.querySelector(`#studentGradeTabs .division-filter-tab[data-division="${level}"]`)?.classList.add('active');
  renderStudentGradeSubTabs(level);
  (el || document.querySelector(`#studentGradeTabs .grade-filter-tab[data-grade="${grade}"]`))?.classList.add('active');

  const info = studentTabTitles[grade] || studentTabTitles.all;
  document.getElementById('enrolledTitle').textContent = info.title;
  document.getElementById('enrolledMeta').textContent  = info.meta;
  applyStudentFilters();
}

function switchStudentDivisionTab(level, el) {
  activeStudentGrade = level;
  activeStudentSection = null;
  document.querySelectorAll('#studentGradeTabs .division-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.division === level);
    tab.setAttribute('aria-selected', String(tab.dataset.division === level));
  });
  document.querySelectorAll('.sc-card').forEach(card => card.classList.remove('selected'));
  renderStudentGradeSubTabs(level);
  const info = studentTabTitles[level] || studentTabTitles.all;
  document.getElementById('enrolledTitle').textContent = info.title;
  document.getElementById('enrolledMeta').textContent = info.meta;
  applyStudentFilters();
}

function filterByStudentSection(section, card) {
  activeStudentSection = activeStudentSection === section ? null : section;
  document.querySelectorAll('.sc-card').forEach(c => c.classList.remove('selected'));
  if (activeStudentSection) card.classList.add('selected');

  const sectionRecord = managementSectionById(section);
  document.getElementById('enrolledTitle').textContent = activeStudentSection
    ? `Students in ${sectionRecord?.name || section}`
    : (studentTabTitles[activeStudentGrade]?.title || 'All Students');

  applyStudentFilters();
}

function filterStudentsList() { applyStudentFilters(); }

function applyStudentFilters() {
  if (managementDataLoading) return;
  const search = document.getElementById('studentSearchInput').value.toLowerCase();
  let visible = 0;
  document.querySelectorAll('#enrolledBody tr:not(.panel-empty-row)').forEach(row => {
    const name  = row.querySelector('.user-name')?.textContent.toLowerCase() || '';
    const email = row.querySelector('.user-email')?.textContent.toLowerCase() || '';
    const matchSearch  = name.includes(search) || email.includes(search);
    const matchGrade   = managementFilterMatches(activeStudentGrade, [row.dataset.grade]);
    const matchSection = !activeStudentSection || row.dataset.section === activeStudentSection;
    const show = matchSearch && matchGrade && matchSection;
    row.style.display = show ? '' : 'none';
    if (show) visible += 1;
  });
  const emptyRow = document.querySelector('#enrolledBody .panel-empty-row');
  if (emptyRow) emptyRow.hidden = visible > 0;
  lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', async () => {
  managementStudentPicker = window.createStudentMultiSelect(document.getElementById('managementStudentPicker'), handleManagementStudentChange);
  renderManagementLoadingState();
  try {
    await window.EDUGNAY_SCHOOL_READY;
    updateSectionFormFields('create');
    updateImportGradeOptions();
    await refreshManagementViews();
  } catch (error) {
    showManagementLoadError(error);
  }
  window.initSearchableSelect?.(document.getElementById('teacherSelect'), {
    placeholder: 'Select a teacher',
    searchPlaceholder: 'Search teachers...',
    emptyText: 'No matching teachers',
    ariaLabel: 'Faculty member'
  });
  lucide.createIcons();
  window.EDUGNAY_PAGE_LOADING.ready();
});

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    p00d12a63031d: function(event) { updateManagementAssignmentFields('strand') },
    p14ab24f20e72: function(event) { previewTeacher(this) },
    p1c4523cacec2: function(event) { updateManagementAssignmentFields('track') },
    p4c80dd168b55: function(event) { updateImportGradeOptions() },
    p6687e9537cb3: function(event) { updateManagementAssignmentFields('grade') },
    p6d6830e5d9a6: function(event) { updateManagementAssignmentFields('level') },
    p89ae277910af: function(event) { filterTeacherBlocks() },
    p95f522eb8abb: function(event) { updateManagementAssignmentContext() },
    p9914d313cdd7: function(event) { updateSubjectShsFields() },
    pa54c25592849: function(event) { updateSectionFormFields('create') },
    pbbc4dd07b0a1: function(event) { updateManagementMoveFields('track') },
    pd5dc2b0e69e0: function(event) { previewCSV(this) },
    pdc0dc7ae47a2: function(event) { filterSections() },
    pe5039f913d89: function(event) { selectImportGrade(this.value) },
    pee82f9d7923a: function(event) { updateManagementMoveFields('strand') },
    pf77aad0b0237: function(event) { updateManagementMoveContext() },
  },
  click: {
    p104d763fb19f: function(event) { closeSectionAddModal() },
    p1a0385c98765: function(event) { closeStudentAssignModal() },
    p1f2503babb1e: function(event) { closeImportStudentsModal() },
    p2a2410f95a1e: function(event) { switchStudentGradeTab('unassigned', null) },
    p327607e8aaf5: function(event) { openStudentAssignModal() },
    p3e0caa483472: function(event) { switchMgmtTab('sections', this) },
    p3f50fc860b08: function(event) { closeTeacherModal() },
    p4a49ac32633d: function(event) { closeSectionEditModal() },
    p4d427d1389d0: function(event) { closeConfirmRemoveModal() },
    p4fcc33f5bdfd: function(event) { closeMoveConfirmModal() },
    p54e7ddb1dc32: function(event) { openSubjectModal() },
    p5c33f72788de: function(event) { setSectionView('card') },
    p738248dc3b1d: function(event) { openSectionAddModal() },
    p87319e366b9c: function(event) { switchMgmtTab('subjects', this) },
    p8dc53892dd44: function(event) { switchMgmtTab('students', this) },
    pa41ba0a60d37: function(event) { closeSubjectModal() },
    pab856521776b: function(event) { switchMgmtTab('teachers', this) },
    pb2bb82330b78: function(event) { document.getElementById('csvFileInput').click() },
    pca06ba85cf78: function(event) { closeSectionStudentsModal() },
    pe8b4c9eda421: function(event) { setSectionView('table') },
    pf08d514c12bf: function(event) { openImportStudentsModal() },
    g5a9c210f6c2: function(event) { event.preventDefault(); window.location.reload(); },
  },
  input: {
    p304c9724768a: function(event) { filterTeacherBlocks() },
    p30c062267fb3: function(event) { filterSubjects() },
    pd6b1f36e7663: function(event) { filterSections() },
    pf6b78f62f7c6: function(event) { filterStudentsList() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    g9914d313cdd7: function(event) { updateSubjectShsFields() },
  },
  click: {
    g228fe68d7994: function(event) { switchStudentGradeTab('unassigned', this) },
    g22c8c74f4238: function(event) { switchSubjectDivisionTab('all', this) },
    g5c6ac1f61c0a: function(event) { toggleTeacherSection(this) },
    g6e9ab43db283: function(event) { switchStudentDivisionTab('all', this) },
    gc8d9f45a608a: function(event) { switchSubjectStrandTab('all') },
  },
});
