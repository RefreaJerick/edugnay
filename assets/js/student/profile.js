lucide.createIcons();

/* ── AVATAR UPLOAD ── */
const STUDENT_CONFIG = window.EDUGNAY_CONFIG;
const STUDENT_PROFILE_API_ENABLED = window.EDUGNAY_API?.isBackendAvailable === true;
const escapeProfileHtml = STUDENT_CONFIG.escapeHtml;
let studentSetupRequired = false;
let studentSetupStatus = null;
let studentAttendanceQrDataUrl = '';
let studentApiUser = null;
let studentProfileLoading = STUDENT_PROFILE_API_ENABLED;
let studentClassSection = null;
let studentClassLoading = STUDENT_PROFILE_API_ENABLED;
let studentClassError = STUDENT_PROFILE_API_ENABLED ? '' : 'The school API is unavailable.';
let studentLinkedParents = [];
let studentLinkedParentsLoading = STUDENT_PROFILE_API_ENABLED;
let studentLinkedParentsError = STUDENT_PROFILE_API_ENABLED ? '' : 'The school API is unavailable.';

function setStudentText(id, value, fallback = 'Not provided') {
  const element = document.getElementById(id);
  if (element) element.textContent = value || fallback;
}

function clearStudentField(id) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = '';
}

function setStudentInput(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = id === 'student-birth-date' && value ? String(value).slice(0, 10) : value || '';
}

function renderStudentProfile() {
  const student = studentApiUser;
  if (!student) {
    const profileMessage = 'Profile unavailable';
    if (studentProfileLoading) {
      clearStudentField('student-profile-name');
      clearStudentField('student-profile-lrn');
      clearStudentField('student-profile-school-email');
      clearStudentField('student-record-lrn');
    } else {
      setStudentText('student-profile-name', profileMessage);
      setStudentText('student-profile-lrn', 'Not available');
      setStudentText('student-profile-school-email', 'Not available');
      setStudentText('student-record-lrn', 'Not available');
    }
    if (!document.documentElement.classList.contains('profile-chip-restored')) {
      if (studentProfileLoading) clearStudentField('student-topbar-name');
      else setStudentText('student-topbar-name', profileMessage);
    }
    renderStudentClassContext(null);
    renderStudentLinkedParents('');
    return;
  }

  const savedUser = student;
  const profile = student.profile || {};
  const schoolEmail = savedUser.schoolEmail || '';
  const displayName = savedUser.displayName || [savedUser.firstName, savedUser.lastName].filter(Boolean).join(' ');
  const lrn = profile?.lrn || student.lrn;

  setStudentText('student-profile-name', displayName);
  setStudentText('student-topbar-name', displayName);
  setStudentText('student-profile-lrn', lrn, 'Not available');
  renderStudentClassContext(student);
  setStudentText('student-profile-school-email', schoolEmail);
  setStudentText('student-record-lrn', lrn, 'Not available');

  setStudentInput('student-first-name', savedUser.firstName);
  setStudentInput('student-last-name', savedUser.lastName);
  setStudentInput('student-school-email', schoolEmail);
  setStudentInput('student-personal-email', savedUser.personalEmail);
  setStudentInput('student-middle-name', profile.middleName);
  setStudentInput('student-contact-number', profile.contactNumber);
  setStudentInput('student-sex', profile.sex);
  setStudentInput('student-birth-date', profile.birthDate);
  setStudentInput('student-birthplace', profile.birthPlace || profile.birthPlaceProvince);
  setStudentInput('student-birthplace-region', profile.birthPlaceRegion);
  setStudentInput('student-birth-country', profile.birthCountry);
  setStudentInput('student-mother-tongue', profile.motherTongue);
  setStudentInput('student-indigenous-group', profile.indigenousGroup === 'not_applicable' ? '' : profile.indigenousGroup);
  setStudentInput('student-religion', profile.religion === 'prefer_not_to_provide' ? '' : profile.religion);
  setStudentInput('student-house-street', profile.houseStreet);
  setStudentInput('student-barangay', profile.barangay);
  setStudentInput('student-city', profile.cityMunicipality);
  setStudentInput('student-province', profile.province);

  document.getElementById('student-no-middle-name').checked = profile.hasNoMiddleName;
  document.getElementById('student-no-indigenous-group').checked = profile.indigenousGroup === 'not_applicable';
  document.getElementById('student-no-religion').checked = profile.religion === 'prefer_not_to_provide';
  const personalEmail = document.getElementById('student-personal-email');
  personalEmail.readOnly = STUDENT_PROFILE_API_ENABLED;
  if (STUDENT_PROFILE_API_ENABLED) {
    const personalEmailHint = personalEmail.closest('.form-group')?.querySelector('.form-hint');
    if (personalEmailHint) personalEmailHint.textContent = 'Managed through your school account record.';
  }
  updateStudentProfileChoices();

  renderStudentLinkedParents(student.id);
  renderStudentAttendanceQr(student);
  applyStudentProfileSetupState();
}

function renderStudentClassContext(student) {
  if (studentClassLoading) {
    clearStudentField('student-profile-placement');
    clearStudentField('student-record-placement');
    clearStudentField('student-record-adviser');
    clearStudentField('student-record-school-year');
    return;
  }
  if (studentClassError) {
    setStudentText('student-profile-placement', 'Class placement unavailable');
    setStudentText('student-record-placement', 'Unavailable');
    setStudentText('student-record-adviser', 'Unavailable');
    setStudentText('student-record-school-year', 'Unavailable');
    return;
  }

  const section = studentClassSection;
  const placement = section ? [section.grade, section.name].filter(Boolean).join(' – ') : 'Unassigned';
  setStudentText('student-profile-placement', placement, 'Unassigned');
  setStudentText('student-record-placement', placement, 'Unassigned');
  setStudentText('student-record-adviser', section?.adviserName, 'Not assigned');
  setStudentText('student-record-school-year', section?.academicYear, 'Not available');
}

async function renderStudentAttendanceQr(student) {
  const image = document.getElementById('student-attendance-qr-image');
  const placeholder = document.getElementById('student-attendance-qr-placeholder');
  const downloadButton = document.getElementById('student-attendance-qr-download');
  studentAttendanceQrDataUrl = '';
  image.hidden = true;
  placeholder.hidden = false;
  downloadButton.disabled = true;

  try {
    let token = '';
    const apiStudentId = Number(student?.apiId || student?.id);
    if (STUDENT_PROFILE_API_ENABLED && Number.isInteger(apiStudentId) && apiStudentId > 0) {
      let response = await window.EDUGNAY_API.getStudentQr(apiStudentId);
      if (response?.requiresRegeneration) {
        response = await window.EDUGNAY_API.regenerateStudentQr(apiStudentId);
      }
      token = STUDENT_CONFIG.parseAttendanceQrPayload(response?.qrPayload) || '';
    }
    if (!token) {
      placeholder.innerHTML = '<i data-lucide="qr-code"></i><span>QR code unavailable</span>';
      lucide.createIcons();
      return;
    }
    studentAttendanceQrDataUrl = await STUDENT_CONFIG.generateAttendanceQrDataUrl(token);
    image.src = studentAttendanceQrDataUrl;
    image.hidden = false;
    placeholder.hidden = true;
    downloadButton.disabled = false;
  } catch {
    placeholder.innerHTML = '<i data-lucide="triangle-alert"></i><span>QR code could not be generated</span>';
    lucide.createIcons();
  }
}

function downloadStudentAttendanceQr() {
  const student = studentApiUser;
  if (!studentAttendanceQrDataUrl || !student) return;

  const name = `${student.firstName || 'student'}-${student.lastName || 'attendance'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const link = document.createElement('a');
  link.href = studentAttendanceQrDataUrl;
  link.download = `${name}-attendance-qr.png`;
  link.click();
}

function updateStudentProfileChoices() {
  const middleName = document.getElementById('student-middle-name');
  const noMiddleName = document.getElementById('student-no-middle-name');
  const indigenousGroup = document.getElementById('student-indigenous-group');
  const noIndigenousGroup = document.getElementById('student-no-indigenous-group');
  const religion = document.getElementById('student-religion');
  const noReligion = document.getElementById('student-no-religion');

  middleName.disabled = noMiddleName.checked;
  indigenousGroup.disabled = noIndigenousGroup.checked;
  religion.disabled = noReligion.checked;
  middleName.required = studentFieldRequired('middleName') && !noMiddleName.checked;
  indigenousGroup.required = studentFieldRequired('indigenousGroup') && !noIndigenousGroup.checked;
  religion.required = studentFieldRequired('religion') && !noReligion.checked;
  middleName.closest('.form-group')?.classList.toggle('profile-required-field', middleName.required);
  indigenousGroup.closest('.form-group')?.classList.toggle('profile-required-field', indigenousGroup.required);
  religion.closest('.form-group')?.classList.toggle('profile-required-field', religion.required);
}

function studentFieldRequired(field) {
  if (!studentSetupRequired) return false;
  if (STUDENT_PROFILE_API_ENABLED && studentSetupStatus) {
    return Array.isArray(studentSetupStatus.missingFields) && studentSetupStatus.missingFields.includes(field);
  }
  return true;
}

function applyStudentProfileSetupState() {
  studentSetupRequired = Boolean(studentSetupStatus?.required && !studentSetupStatus.complete);

  document.body.classList.toggle('profile-setup-required', studentSetupRequired);
  document.getElementById('student-profile-setup-notice').hidden = !studentSetupRequired;
  document.getElementById('student-profile-discard').hidden = studentSetupRequired;
  document.getElementById('student-profile-submit-label').textContent = studentSetupRequired
    ? 'Complete setup'
    : 'Save Changes';

  const requiredFields = {
    'student-personal-email': 'personalEmail',
    'student-sex': 'sex',
    'student-birth-date': 'birthDate',
    'student-birthplace': 'birthPlace',
    'student-birth-country': 'birthCountry',
    'student-mother-tongue': 'motherTongue',
    'student-house-street': 'houseStreet',
    'student-barangay': 'barangay',
    'student-city': 'cityMunicipality',
    'student-province': 'province'
  };
  Object.entries(requiredFields).forEach(([id, field]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.required = studentFieldRequired(field);
    input.closest('.form-group')?.classList.toggle('profile-required-field', input.required);
  });

  document.querySelectorAll('[data-profile-tab]').forEach(tab => {
    const isPersonalTab = tab.dataset.profileTab === 'personal';
    tab.disabled = studentSetupRequired && !isPersonalTab;
    tab.setAttribute('aria-disabled', String(tab.disabled));
  });

  updateStudentProfileChoices();
  if (studentSetupRequired) {
    const personalTab = document.querySelector('[data-profile-tab="personal"]');
    if (personalTab) switchTab('personal', personalTab);
  } else if (new URLSearchParams(window.location.search).get('setup') === 'required' && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  lucide.createIcons();
}

function renderStudentLinkedParents(studentId) {
  const list = document.getElementById('student-linked-parent-list');
  if (!list) return;

  if (studentLinkedParentsLoading || studentLinkedParentsError) {
    const loading = studentLinkedParentsLoading;
    list.innerHTML = loading
      ? ''
      : STUDENT_CONFIG.renderPanelEmptyState({ icon: 'circle-alert', title: 'Linked parents could not be loaded', text: studentLinkedParentsError });
    lucide.createIcons();
    return;
  }

  const links = studentLinkedParents.map(parent => ({ link: parent, parent }));

  if (!links.length) {
    list.innerHTML = STUDENT_CONFIG.renderPanelEmptyState({
      icon: 'heart-handshake',
      title: 'No linked parent',
      text: 'A parent or guardian linked to your account will appear here.'
    });
    lucide.createIcons();
    return;
  }

  list.innerHTML = links.map(({ link, parent }) => {
    const profile = parent.profile;
    const relationship = link.relationship
      ? link.relationship.charAt(0).toUpperCase() + link.relationship.slice(1)
      : 'Relationship not set';
    return `
      <div class="guardian-card">
        ${window.EDUGNAY_AVATAR.html({ ...parent, id: parent.parentId, role: 'parent' }, { className: 'guardian-avatar' })}
        <div class="guardian-info">
          <div class="guardian-name">${escapeProfileHtml(parent.displayName || '')}</div>
          <div class="guardian-meta-row"><span class="badge badge-blue">${escapeProfileHtml(relationship)}</span></div>
          <div class="guardian-contact-row"><i data-lucide="phone" style="width:12px;height:12px;"></i> ${escapeProfileHtml(parent.contactNumber || profile?.contactNumber || 'Not provided')}</div>
          <div class="guardian-contact-row"><i data-lucide="mail" style="width:12px;height:12px;"></i> ${escapeProfileHtml(parent.personalEmail || 'Not provided')}</div>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

let studentSubjects = [];

function renderStudentSubjects() {
  const list = document.getElementById('student-subject-list');
  if (!list) return;
  if (studentClassLoading) {
    list.innerHTML = '';
  } else if (studentClassError) {
    list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'circle-alert', title: 'Subjects could not be loaded', text: studentClassError });
  } else {
    list.innerHTML = studentSubjects.length ? studentSubjects.map(assignment => {
      const subjectName = assignment.communicationComponentName || assignment.subjectName;
      const teacherName = assignment.teacherName;
      const isAdviser = String(studentClassSection?.adviserId || assignment.adviserId || '') === String(assignment.teacherId || '');
      return `<div class="subject-row"><div class="subject-info"><div class="subject-name">${escapeProfileHtml(subjectName || 'Subject')}</div><div class="subject-teacher">${escapeProfileHtml(teacherName || 'Teacher not assigned')}</div></div>${isAdviser ? '<span class="subject-tag-adviser"><i data-lucide="star" style="width:9px;height:9px;"></i> Adviser</span>' : ''}</div>`;
  }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No subjects assigned', text: 'Your subjects and teachers will appear here.' });
  }
  lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', async () => {
  renderStudentSubjects();
  renderStudentProfile();
  await Promise.all([loadStudentProfile(), loadStudentClassData(), loadStudentLinkedParents()]);
  document.getElementById('student-no-middle-name').addEventListener('change', updateStudentProfileChoices);
  document.getElementById('student-no-indigenous-group').addEventListener('change', function () {
    if (this.checked) document.getElementById('student-indigenous-group').value = '';
    updateStudentProfileChoices();
  });
  document.getElementById('student-no-religion').addEventListener('change', function () {
    if (this.checked) document.getElementById('student-religion').value = '';
    updateStudentProfileChoices();
  });
  window.EDUGNAY_PAGE_LOADING.ready();
});

async function loadStudentLinkedParents() {
  if (!STUDENT_PROFILE_API_ENABLED) return;

  try {
    studentLinkedParents = await window.EDUGNAY_API.getStudentParents();
  } catch (error) {
    studentLinkedParentsError = error.message || 'Parent links could not be loaded.';
  } finally {
    studentLinkedParentsLoading = false;
    renderStudentLinkedParents(studentApiUser?.id);
  }
}

async function loadStudentProfile() {
  if (!STUDENT_PROFILE_API_ENABLED) return;

  try {
    const [profileResponse, setupResponse] = await Promise.all([
      window.EDUGNAY_API.request('/users/me/profile'),
      window.EDUGNAY_API.request('/account-setup/status')
    ]);
    if (profileResponse.user.role === 'student') {
      studentApiUser = profileResponse.user;
      studentSetupStatus = setupResponse.setup || null;
    }
  } catch (error) {
    console.warn('Unable to load the saved profile.', error.message);
  } finally {
    studentProfileLoading = false;
    renderStudentProfile();
  }
}

async function loadStudentClassData() {
  if (!STUDENT_PROFILE_API_ENABLED) return;

  try {
    const sections = await window.EDUGNAY_API.getSections();
    studentClassSection = sections.find(section => section.status === 'active' && section.academicYearStatus === 'active') || null;
    if (studentClassSection) {
      const response = await window.EDUGNAY_API.getSectionTeachers(studentClassSection.id);
      studentClassSection = response.section || studentClassSection;
      studentSubjects = response.teachers;
    }
  } catch (error) {
    console.warn('Unable to load the student class context.', error.message);
    studentClassError = 'Class information could not be loaded.';
  } finally {
    studentClassLoading = false;
    renderStudentClassContext(studentApiUser);
    renderStudentSubjects();
  }
}

function openPasswordModal() {
  document.getElementById('changePasswordModal').classList.add('open');
}
function closePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('open');
  document.getElementById('passwordForm').reset();
}
async function submitPasswordChange(event) {
  event.preventDefault();
  const currentPass = document.getElementById('currentPasswordInput').value;
  const newPass = document.getElementById('newPasswordInput').value;
  const confirmPass = document.getElementById('confirmPasswordInput').value;
  if (newPass.length < 12) {
    alert('Use a password with at least 12 characters.');
    return false;
  }
  if (newPass !== confirmPass) {
    alert('New password and confirmation do not match.');
    return false;
  }
  if (!STUDENT_PROFILE_API_ENABLED) {
    alert('Password updates require a configured API connection.');
    return false;
  }
  try {
    await window.EDUGNAY_API.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
    });
    closePasswordModal();
    showAppToast('Password updated. You have been signed out on other devices.');
  } catch (error) {
    showAppToast(error.message || 'Unable to update your password.', 'error');
  }
  return false;
}

document.getElementById('changePasswordModal').addEventListener('click', function(e) {
  if (e.target === this) closePasswordModal();
});
function switchTab(tabKey, btn) {
  if (studentSetupRequired && tabKey !== 'personal') return;
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pane-' + tabKey).classList.add('active');
}

async function submitProfile(event) {
  event.preventDefault();
  const student = studentApiUser;
  if (!student) return false;
  const wasSetupRequired = studentSetupRequired;

  const personalEmail = document.getElementById('student-personal-email').value.trim();
  const birthDate = document.getElementById('student-birth-date').value;
  if (personalEmail && !/^\S+@\S+\.\S+$/.test(personalEmail)) {
    alert('Please provide a valid personal email.');
    return false;
  }
  if (birthDate && new Date(`${birthDate}T00:00:00`) > new Date()) {
    alert('Birth date cannot be in the future.');
    return false;
  }

  const profileData = {
    middleName: document.getElementById('student-no-middle-name').checked
      ? null
      : document.getElementById('student-middle-name').value.trim() || null,
    hasNoMiddleName: document.getElementById('student-no-middle-name').checked,
    contactNumber: document.getElementById('student-contact-number').value.trim() || null,
    sex: document.getElementById('student-sex').value || null,
    birthDate: birthDate || null,
    birthPlace: document.getElementById('student-birthplace').value.trim() || null,
    birthPlaceRegion: document.getElementById('student-birthplace-region').value.trim() || null,
    birthCountry: document.getElementById('student-birth-country').value.trim() || null,
    motherTongue: document.getElementById('student-mother-tongue').value.trim() || null,
    indigenousGroup: document.getElementById('student-no-indigenous-group').checked
      ? 'not_applicable'
      : document.getElementById('student-indigenous-group').value.trim() || null,
    religion: document.getElementById('student-no-religion').checked
      ? 'prefer_not_to_provide'
      : document.getElementById('student-religion').value.trim() || null,
    houseStreet: document.getElementById('student-house-street').value.trim() || null,
    barangay: document.getElementById('student-barangay').value.trim() || null,
    cityMunicipality: document.getElementById('student-city').value.trim() || null,
    province: document.getElementById('student-province').value.trim() || null
  };

  try {
    if (!STUDENT_PROFILE_API_ENABLED) throw new Error('Profile updates require a configured API connection.');
    const endpoint = wasSetupRequired ? '/account-setup/student' : '/users/me/profile';
    await window.EDUGNAY_API.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(profileData)
    });
    const [profileResponse, setupResponse] = await Promise.all([
      window.EDUGNAY_API.request('/users/me/profile'),
      window.EDUGNAY_API.request('/account-setup/status')
    ]);
    studentApiUser = profileResponse.user;
    studentSetupStatus = setupResponse.setup || null;
    renderStudentProfile();
    if (wasSetupRequired && !studentSetupRequired) {
      alert('Profile setup complete.');
      window.location.replace('./edugnay-student-dashboard.html');
    } else {
      showAppToast('Profile updated.');
    }
  } catch (error) {
    showAppToast(error.message || 'Unable to update profile.', 'error');
  }
  return false;
}

function resetForm() {
  renderStudentProfile();
}

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p2cdbe9d32494: function(event) { openPasswordModal() },
    p3293a35b9e2b: function(event) { downloadStudentAttendanceQr() },
    p8712acd1332a: function(event) { closePasswordModal() },
    p8a32d272a311: function(event) { switchTab('guardian', this) },
    pba90ee35c9e2: function(event) { resetForm() },
    pcda83b378119: function(event) { switchTab('academic', this) },
    pd24600d14cf5: function(event) { switchTab('security', this) },
    ped25fcb51029: function(event) { switchTab('personal', this) },
  },
  submit: {
    p3d74c63c8476: function(event) { return submitPasswordChange(event) },
    pea7926a962b7: function(event) { return submitProfile(event) },
  },
});
