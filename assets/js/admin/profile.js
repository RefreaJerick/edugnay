let adminApiUser = null;

  function setAdminProfileLoadState(title = '', message = '', isError = false) {
    const notice = document.getElementById('admin-profile-load-notice');
    notice.hidden = !message;
    notice.setAttribute('role', isError ? 'alert' : 'status');
    document.getElementById('admin-profile-load-title').textContent = title;
    document.getElementById('admin-profile-load-text').textContent = message;
  }

  function renderAdminProfile(user) {
    if (!user) return;

    const displayName = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ');
    document.querySelectorAll('[name="fullName"]').forEach(input => { input.value = displayName; });
    document.querySelectorAll('[name="schoolEmail"]').forEach(input => { input.value = user.schoolEmail || ''; });
    document.querySelectorAll('.profile-email-value').forEach(element => { element.textContent = user.schoolEmail || ''; });
    document.getElementById('adminEmployeeNoInput').value = user.profile?.employeeNumber || '';
    document.getElementById('contactNumberInput').value = user.profile?.contactNumber || '';
    document.querySelectorAll('.profile-header-name').forEach(element => { element.textContent = displayName; });
    if (user.id) document.querySelectorAll('.tb-profile-name').forEach(element => { element.textContent = displayName; });
  }

  setAdminProfileLoadState();

  async function loadAdminProfile() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const response = await window.EDUGNAY_API.request('/users/me/profile');
      if (response.user.role !== 'school_admin') throw new Error('Sign in with a school administrator account to view this profile.');
      adminApiUser = response.user;
      renderAdminProfile(adminApiUser);
      renderAdminAccessDetails(adminApiUser);
      setAdminProfileLoadState();
    } catch (error) {
      console.warn('Unable to load the saved profile.', error.message);
      renderAdminProfile({ displayName: 'Profile unavailable', schoolEmail: '', profile: {} });
      renderAdminAccessDetails();
      setAdminProfileLoadState('Profile unavailable', error.message || 'Your account could not be loaded from the school database. Refresh when the connection is restored.', true);
    }
  }

  function openModal() { document.getElementById('changePasswordModal').classList.add('open'); }
  function closeModal() {
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
    try {
      await window.EDUGNAY_API.request('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
      });
      closeModal();
      showAppToast('Password updated. You have been signed out on other devices.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your password.', 'error');
    }
    return false;
  }
  document.getElementById('changePasswordModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  async function submitProfile(event) {
    event.preventDefault();
    if (!adminApiUser) {
      showAppToast('Your profile is unavailable. Refresh the page before saving.', 'error');
      return false;
    }
    const contactNumber = document.getElementById('contactNumberInput').value.trim();

    try {
      const response = await window.EDUGNAY_API.request('/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ contactNumber })
      });
      adminApiUser = response.user;
      renderAdminProfile(adminApiUser);
      showAppToast('Contact info updated.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your profile.', 'error');
    }
    return false;
  }

  function renderAdminAccessDetails(apiUser = null) {
    const panel = document.getElementById('admin-access-details');
    if (!panel) return;
    const schoolAdmin = apiUser;
    const accountStatus = schoolAdmin?.accountStatus || schoolAdmin?.status;
    const role = schoolAdmin?.role === 'school_admin' ? 'School Administrator' : schoolAdmin?.role;
    const details = [
      { label: 'Account status', value: accountStatus ? accountStatus.charAt(0).toUpperCase() + accountStatus.slice(1) : 'Unavailable' },
      { label: 'Access scope', value: schoolAdmin?.schoolId ? 'Current school only' : 'Unavailable' },
      { label: 'Role', value: role || 'Unavailable' }
    ];
    panel.innerHTML = details.map(detail => `
      <div class="profile-detail-row">
        <span class="profile-detail-label">${escapeHtml(detail.label)}</span>
        <span class="profile-detail-value">${escapeHtml(detail.value)}</span>
      </div>`).join('');
  }

  function resetProfile() {
    document.getElementById('contactNumberInput').value = adminApiUser?.profile?.contactNumber || '';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    renderAdminAccessDetails();
    await loadAdminProfile();
    lucide.createIcons();
    window.EDUGNAY_PAGE_LOADING.ready();
  });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p089ea8a8218e: function(event) { closeModal() },
    p0a95c2abd235: function(event) { resetProfile() },
    pa2375f240a9b: function(event) { openModal() },
  },
  submit: {
    p3d74c63c8476: function(event) { return submitPasswordChange(event) },
    pea7926a962b7: function(event) { return submitProfile(event) },
  },
});
