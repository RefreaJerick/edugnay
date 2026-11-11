let teacherApiUser = null;
  let teacherSections = [];
  let teacherSectionsLoading = true;
  let teacherSectionsError = '';
  let teacherShsClasses = [];
  let teacherShsClassesLoading = true;
  let teacherShsClassesError = '';

  function setTeacherProfileLoadState(title = '', message = '', isError = false) {
    const notice = document.getElementById('teacher-profile-load-notice');
    notice.hidden = !message;
    notice.setAttribute('role', isError ? 'alert' : 'status');
    document.getElementById('teacher-profile-load-title').textContent = title;
    document.getElementById('teacher-profile-load-text').textContent = message;
  }

  function renderTeacherProfile(user) {
    if (!user) return;

    const displayName = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ');
    document.querySelectorAll('[name="fullName"]').forEach(input => { input.value = displayName; });
    document.querySelectorAll('[name="schoolEmail"]').forEach(input => { input.value = user.schoolEmail || ''; });
    document.querySelectorAll('.profile-email-value').forEach(element => { element.textContent = user.schoolEmail || ''; });
    document.querySelectorAll('[name="employeeNo"]').forEach(input => { input.value = user.profile?.employeeNumber || ''; });
    document.querySelectorAll('.profile-header-name').forEach(element => { element.textContent = displayName; });
    if (user.id) document.querySelectorAll('.tb-profile-name').forEach(element => { element.textContent = displayName; });
    document.getElementById('contactNumberInput').value = user.profile?.contactNumber || '';
  }

  setTeacherProfileLoadState();

  async function loadTeacherProfile() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const response = await window.EDUGNAY_API.request('/users/me/profile');
      if (response.user.role !== 'teacher') throw new Error('Sign in with a teacher account to view this profile.');
      teacherApiUser = response.user;
      renderTeacherProfile(teacherApiUser);
      setTeacherProfileLoadState();
    } catch (error) {
      console.warn('Unable to load the saved profile.', error.message);
      renderTeacherProfile({ displayName: 'Profile unavailable', schoolEmail: '', profile: {} });
      setTeacherProfileLoadState('Profile unavailable', error.message || 'Your account could not be loaded. Refresh and try again.', true);
    }
  }

  async function loadTeacherSections() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      teacherSections = await window.EDUGNAY_CONFIG.getMyTeachingSections();
    } catch (error) {
      teacherSectionsError = error.message || 'Your assigned sections could not be loaded. Refresh and try again.';
    } finally {
      teacherSectionsLoading = false;
      renderEmploymentDetails();
    }
  }

  async function loadTeacherShsClasses() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const response = await window.EDUGNAY_API.getShsTeachingClasses();
      teacherShsClasses = response.classes || [];
    } catch (error) {
      if (error.status === 403 || error.status === 404) {
        teacherShsClasses = [];
      } else {
        teacherShsClassesError = error.message || 'Your SHS classes could not be loaded. Refresh and try again.';
      }
    } finally {
      teacherShsClassesLoading = false;
      renderEmploymentDetails();
    }
  }

  function renderEmploymentDetails() {
    const sectionsPanel = document.getElementById('teacher-sections-assignments');
    const shsClassesPanel = document.getElementById('teacher-shs-classes-assignments');

    if (sectionsPanel && !teacherSectionsLoading) {
      if (teacherSectionsError) {
        sectionsPanel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'circle-alert', title: 'Sections unavailable', text: teacherSectionsError });
      } else {
        const sections = teacherSections.map(section => [section.grade, section.name].filter(Boolean).join(' - '));
        sectionsPanel.innerHTML = sections.length
          ? `<div class="section-list" role="list" aria-label="Sections handled">${sections.map(section => `<span class="badge badge-blue" role="listitem">${window.EDUGNAY_CONFIG.escapeHtml(section)}</span>`).join('')}</div>`
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'door-open', title: 'No sections assigned', text: 'Sections assigned to this teacher will appear here.' });
      }
    }

    if (shsClassesPanel && !teacherShsClassesLoading) {
      if (teacherShsClassesError) {
        shsClassesPanel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'circle-alert', title: 'SHS classes unavailable', text: teacherShsClassesError });
      } else {
        const classes = teacherShsClasses
          .map(item => [item.gradeName, item.className].filter(Boolean).join(' - '))
          .filter(Boolean);
        shsClassesPanel.innerHTML = classes.length
          ? `<div class="section-list" role="list" aria-label="SHS classes assigned">${classes.map(className => `<span class="badge badge-blue" role="listitem">${window.EDUGNAY_CONFIG.escapeHtml(className)}</span>`).join('')}</div>`
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No SHS classes assigned', text: 'SHS classes assigned to this teacher will appear here.' });
      }
    }

    lucide.createIcons();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    renderEmploymentDetails();
    await Promise.all([loadTeacherProfile(), loadTeacherSections(), loadTeacherShsClasses()]);
    lucide.createIcons();
    window.EDUGNAY_PAGE_LOADING.ready();
  });

  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
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
    try {
      await window.EDUGNAY_API.request('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
      });
      closeModal('changePasswordModal');
      showAppToast('Password updated. You have been signed out on other devices.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your password.', 'error');
    }
    return false;
  }
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { toggleDrawer(false); document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open')); }
  });

  async function submitProfile(event) {
    event.preventDefault();
    if (!teacherApiUser) {
      showAppToast('Your profile is unavailable. Refresh the page before saving.', 'error');
      return false;
    }
    const contactNumber = document.getElementById('contactNumberInput').value.trim();

    try {
      const response = await window.EDUGNAY_API.request('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ contactNumber })
      });
      teacherApiUser = response.user;
      renderTeacherProfile(teacherApiUser);
      showAppToast('Contact number updated.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your profile.', 'error');
    }
    return false;
  }

  function resetProfile() {
    document.getElementById('contactNumberInput').value = teacherApiUser?.profile?.contactNumber || '';
  }

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p0a95c2abd235: function(event) { resetProfile() },
    p0dcd2c4737b7: function(event) { openModal('changePasswordModal') },
    pce5007272174: function(event) { closeModal('changePasswordModal') },
  },
  submit: {
    p3d74c63c8476: function(event) { return submitPasswordChange(event) },
    pea7926a962b7: function(event) { return submitProfile(event) },
  },
});
