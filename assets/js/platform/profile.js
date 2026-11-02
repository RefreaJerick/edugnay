const PLATFORM = window.EDUGNAY_PLATFORM;

    const PLATFORM_PROFILE_FIELDS = [
      { label: 'Full Name', getValue: admin => admin.displayName },
      { label: 'Account Email', getValue: admin => admin.schoolEmail },
      { label: 'Role', getValue: admin => admin.role === 'platform_admin' ? 'Platform Administrator' : admin.role }
    ];

    const PLATFORM_ACCOUNT_ACCESS_DETAILS = [
      { label: 'Account status', value: 'Active' },
      { label: 'Access scope', value: 'All registered schools' },
      { label: 'Primary responsibility', value: 'School account review' }
    ];

    function renderPlatformProfile(admin) {
      const displayName = admin.displayName || [admin.firstName, admin.lastName].filter(Boolean).join(' ') || 'Platform Admin';
      document.getElementById('profile-header-name').textContent = displayName;
      document.getElementById('profileEmail').textContent = admin.schoolEmail;
      document.getElementById('platformProfileFields').innerHTML = PLATFORM_PROFILE_FIELDS.length ? PLATFORM_PROFILE_FIELDS.map(field => `
        <div class="form-group">
          <label class="form-label">${escapeHtml(field.label)}</label>
          <input class="form-input" type="text" value="${escapeHtml(field.getValue(admin))}" disabled aria-readonly="true">
        </div>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'user-round', title: 'No profile details', text: 'Platform administrator details will appear here.' });
      document.getElementById('platformAccessDetails').innerHTML = PLATFORM_ACCOUNT_ACCESS_DETAILS.length ? PLATFORM_ACCOUNT_ACCESS_DETAILS.map(detail => `
        <div class="profile-detail-row"><span class="profile-detail-label">${escapeHtml(detail.label)}</span><span class="profile-detail-value">${escapeHtml(detail.label === 'Account status' ? admin.accountStatus || 'Unknown' : detail.value)}</span></div>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'shield-check', title: 'No access details', text: 'Platform access information will appear here.' });
      if (window.lucide) window.lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        const admin = await window.EDUGNAY_API.getCurrentUser();
        if (admin.role !== 'platform_admin') throw new Error('A platform administrator session is required.');
        renderPlatformProfile(admin);
      } catch (error) {
        document.getElementById('platformProfileFields').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Profile unavailable', text: error.message });
        showAppToast(error.message, 'error');
      }
      window.EDUGNAY_PAGE_LOADING.ready();
      await window.EDUGNAY_PLATFORM_COMMUNICATION_READY;
      PLATFORM.renderTopbarNotifs();
    });
