(() => {
  let guardUser = null;
  let profileBusy = false;
  let passwordBusy = false;

  const profileForm = document.getElementById('guardProfileForm');
  const passwordForm = document.getElementById('guardPasswordForm');
  const passwordModal = document.getElementById('guardPasswordModal');
  const passwordTrigger = document.querySelector('[data-page-click="guardProfilePasswordOpen"]');

  function showProfileError(message) {
    const notice = document.getElementById('guard-profile-load-notice');
    document.getElementById('guard-profile-load-error').textContent = message;
    notice.hidden = false;
  }

  function renderProfile(user) {
    const displayName = user.displayName || [user.firstName, user.lastName].filter(Boolean).join(' ');
    document.getElementById('guard-profile-name').textContent = displayName;
    document.getElementById('guard-profile-email').textContent = user.schoolEmail || '';
    document.querySelector('.tb-profile-name').textContent = displayName;
    document.getElementById('guardProfileFullName').value = displayName;
    document.getElementById('guardProfileEmail').value = user.schoolEmail || '';
    document.getElementById('guardProfileEmployeeNo').value = user.profile?.employeeNumber || '';
    document.getElementById('guardProfileContact').value = user.profile?.contactNumber || '';
    const status = user.accountStatus || user.status || 'active';
    document.getElementById('guardAccountStatus').textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }

  async function loadProfile() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const response = await window.EDUGNAY_API.request('/users/me/profile');
      if (response.user?.role !== 'school_guard') {
        window.location.replace('../../index.html');
        return;
      }
      guardUser = response.user;
      renderProfile(guardUser);
    } catch (error) {
      showProfileError(error.message || 'Your account could not be loaded. Refresh and try again.');
      showAppToast(error.message || 'Unable to load your profile.', 'error');
    } finally {
      window.EDUGNAY_PAGE_LOADING?.ready();
    }
  }

  function resetProfile() {
    document.getElementById('guardProfileContact').value = guardUser?.profile?.contactNumber || '';
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (profileBusy) return false;
    if (!guardUser) {
      showAppToast('Your profile is unavailable. Refresh the page before saving.', 'error');
      return false;
    }
    const contactNumber = document.getElementById('guardProfileContact').value.trim();
    if (contactNumber === String(guardUser.profile?.contactNumber || '').trim()) {
      showAppToast('There are no changes to save.', 'info');
      return false;
    }

    profileBusy = true;
    const submit = profileForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const response = await window.EDUGNAY_API.request('/users/me/profile', {
        method: 'PATCH', body: JSON.stringify({ contactNumber })
      });
      guardUser = response.user;
      renderProfile(guardUser);
      showAppToast('Contact info updated.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your profile.', 'error');
    } finally {
      profileBusy = false;
      submit.disabled = false;
    }
    return false;
  }

  function openPasswordModal() {
    if (passwordBusy) return;
    passwordModal.classList.add('open');
    passwordModal.setAttribute('aria-hidden', 'false');
    document.getElementById('guardCurrentPassword').focus();
  }

  function resetPasswordModal() {
    passwordModal.classList.remove('open');
    passwordModal.setAttribute('aria-hidden', 'true');
    passwordForm.reset();
    passwordTrigger?.focus();
  }

  function closePasswordModal() {
    if (passwordBusy || !passwordModal.classList.contains('open')) return;
    resetPasswordModal();
  }

  async function savePassword(event) {
    event.preventDefault();
    if (passwordBusy) return false;
    const currentPassword = document.getElementById('guardCurrentPassword').value;
    const newPassword = document.getElementById('guardNewPassword').value;
    const confirmPassword = document.getElementById('guardConfirmPassword').value;
    if (newPassword.length < 12) {
      showAppToast('Use a password with at least 12 characters.', 'error');
      return false;
    }
    if (newPassword !== confirmPassword) {
      showAppToast('New password and confirmation do not match.', 'error');
      return false;
    }

    passwordBusy = true;
    const submit = passwordForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await window.EDUGNAY_API.request('/auth/change-password', {
        method: 'POST', body: JSON.stringify({ currentPassword, newPassword })
      });
      resetPasswordModal();
      showAppToast('Password updated. You have been signed out on other devices.');
    } catch (error) {
      showAppToast(error.message || 'Unable to update your password.', 'error');
    } finally {
      passwordBusy = false;
      submit.disabled = false;
    }
    return false;
  }

  passwordModal.addEventListener('click', event => {
    if (event.target === passwordModal) closePasswordModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && passwordModal.classList.contains('open')) closePasswordModal();
  });

  document.addEventListener('DOMContentLoaded', loadProfile, { once: true });
  window.EDUGNAY_PAGE_EVENTS.bind({
    click: {
      guardProfileDiscard: resetProfile,
      guardProfilePasswordOpen: openPasswordModal,
      guardProfilePasswordClose: closePasswordModal
    },
    submit: {
      guardProfileSave: saveProfile,
      guardProfilePasswordSave: savePassword
    }
  });
})();
