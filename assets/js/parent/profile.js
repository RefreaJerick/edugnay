lucide.createIcons();

    const escapeProfileHtml = PARENT_CONFIG.escapeHtml;
    let parentSetupRequired = false;
    let parentApiUser = null;
    let parentSetupStatus = null;
    let backendParentChildren = null;
    let parentProfileError = '';

    function setParentText(id, value, fallback = 'Not provided') {
      const element = document.getElementById(id);
      if (element) element.textContent = value || fallback;
    }

    function setParentInput(id, value) {
      const element = document.getElementById(id);
      if (element) element.value = value || '';
    }

    function getParentLinks() {
      return backendParentChildren || [];
    }

    function renderParentProfile() {
      const parent = parentApiUser;
      if (!parent) {
        const loading = !parentProfileError;
        if (loading) {
          document.getElementById('parent-profile-name').innerHTML = '';
          document.getElementById('parent-profile-child-count').innerHTML = '';
          document.getElementById('parent-profile-school-email').innerHTML = '';
          renderLinkedChildren([], 'Loading linked children...');
        } else {
          setParentText('parent-profile-name', 'Profile unavailable');
          setParentText('parent-profile-child-count', 'Profile unavailable');
          setParentText('parent-profile-school-email', 'Not available');
          renderLinkedChildren([], parentProfileError);
        }
        return;
      }

      const savedUser = parent;
      const profile = parent.profile || {};
      const links = getParentLinks();
      const schoolEmail = savedUser.schoolEmail || '';
      const displayName = savedUser.displayName || [savedUser.firstName, savedUser.lastName].filter(Boolean).join(' ');

      setParentText('parent-profile-name', displayName);
      setParentText('parent-profile-child-count', `Parent · ${links.length} linked ${links.length === 1 ? 'child' : 'children'}`);
      setParentText('parent-profile-school-email', schoolEmail);

      setParentInput('parent-first-name', savedUser.firstName);
      setParentInput('parent-last-name', savedUser.lastName);
      setParentInput('parent-school-email', schoolEmail);
      setParentInput('parent-personal-email', savedUser.personalEmail);
      setParentInput('parent-middle-name', profile.middleName);
      setParentInput('parent-contact-number', profile.contactNumber);
      setParentInput('parent-sex', profile.sex);
      setParentInput('parent-religion', profile.religion === 'prefer_not_to_provide' ? '' : profile.religion);
      setParentInput('parent-house-street', profile.houseStreet);
      setParentInput('parent-barangay', profile.barangay);
      setParentInput('parent-city', profile.cityMunicipality);
      setParentInput('parent-province', profile.province);

      const isMother = links.some(link => link.relationship === 'mother');
      const maidenNameGroup = document.getElementById('parent-maiden-name-group');
      const noMaidenName = document.getElementById('parent-no-maiden-name');
      if (maidenNameGroup) maidenNameGroup.hidden = !isMother;
      if (noMaidenName) noMaidenName.checked = isMother && profile.hasNoMaidenName;
      setParentInput('parent-maiden-name', isMother ? profile.maidenLastName : '');
      document.getElementById('parent-no-middle-name').checked = profile.hasNoMiddleName;
      document.getElementById('parent-no-religion').checked = profile.religion === 'prefer_not_to_provide';
      const personalEmail = document.getElementById('parent-personal-email');
      personalEmail.readOnly = true;
      const personalEmailHint = personalEmail.closest('.form-group')?.querySelector('.form-hint');
      if (personalEmailHint) personalEmailHint.textContent = 'Managed through your school account record.';
      updateParentProfileChoices();

      renderLinkedChildren(links);
      applyParentProfileSetupState();
    }

    function updateParentProfileChoices() {
      const middleName = document.getElementById('parent-middle-name');
      const noMiddleName = document.getElementById('parent-no-middle-name');
      const maidenName = document.getElementById('parent-maiden-name');
      const noMaidenName = document.getElementById('parent-no-maiden-name');
      const maidenNameGroup = document.getElementById('parent-maiden-name-group');
      const religion = document.getElementById('parent-religion');
      const noReligion = document.getElementById('parent-no-religion');
      const maidenNameVisible = maidenNameGroup && !maidenNameGroup.hidden;

      middleName.disabled = noMiddleName.checked;
      maidenName.disabled = noMaidenName.checked;
      religion.disabled = noReligion.checked;
      middleName.required = parentFieldRequired('middleName') && !noMiddleName.checked;
      maidenName.required = parentFieldRequired('maidenLastName') && maidenNameVisible && !noMaidenName.checked;
      religion.required = parentFieldRequired('religion') && !noReligion.checked;
      middleName.closest('.form-group')?.classList.toggle('profile-required-field', middleName.required);
      maidenName.closest('.form-group')?.classList.toggle('profile-required-field', maidenName.required);
      religion.closest('.form-group')?.classList.toggle('profile-required-field', religion.required);
    }

    function parentFieldRequired(field) {
      if (!parentSetupRequired) return false;
      return Array.isArray(parentSetupStatus?.missingFields) && parentSetupStatus.missingFields.includes(field);
    }

    function applyParentProfileSetupState() {
      parentSetupRequired = Boolean(parentSetupStatus?.required && !parentSetupStatus.complete);

      document.body.classList.toggle('profile-setup-required', parentSetupRequired);
      document.getElementById('parent-profile-setup-notice').hidden = !parentSetupRequired;
      document.getElementById('parent-profile-discard').hidden = parentSetupRequired;
      document.getElementById('parent-profile-submit-label').textContent = parentSetupRequired
        ? 'Complete setup'
        : 'Save Changes';

      const requiredFields = {
        'parent-personal-email': 'personalEmail',
        'parent-contact-number': 'contactNumber',
        'parent-sex': 'sex',
        'parent-house-street': 'houseStreet',
        'parent-barangay': 'barangay',
        'parent-city': 'cityMunicipality',
        'parent-province': 'province'
      };
      Object.entries(requiredFields).forEach(([id, field]) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.required = parentFieldRequired(field);
        input.closest('.form-group')?.classList.toggle('profile-required-field', input.required);
      });

      document.querySelectorAll('[data-profile-tab]').forEach(tab => {
        const isPersonalTab = tab.dataset.profileTab === 'personal';
        tab.disabled = parentSetupRequired && !isPersonalTab;
        tab.setAttribute('aria-disabled', String(tab.disabled));
      });

      updateParentProfileChoices();
      if (parentSetupRequired) {
        const personalTab = document.querySelector('[data-profile-tab="personal"]');
        if (personalTab) switchTab('personal', personalTab);
      } else if (new URLSearchParams(window.location.search).get('setup') === 'required' && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
      lucide.createIcons();
    }

    function renderLinkedChildren(links = getParentLinks(), statusMessage = '') {
      const list = document.getElementById('linked-children-list');
      if (!list) return;
      if (statusMessage) {
        list.innerHTML = parentProfileError
          ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'circle-alert', title: 'Parent data unavailable', text: escapeProfileHtml(statusMessage) })
          : '';
        lucide.createIcons();
        return;
      }
      if (!links.length) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No linked children', text: 'Children linked to this parent account will appear here.' });
        lucide.createIcons();
        return;
      }
      list.innerHTML = links.map(link => {
        const student = link;
        const relationship = link.relationship
          ? link.relationship.charAt(0).toUpperCase() + link.relationship.slice(1)
          : 'Relationship not set';
        return `<div class="child-record-card">${window.EDUGNAY_AVATAR.html(student, { className: 'child-record-avatar', role: 'student' })}<div class="child-record-info"><div class="child-record-name">${escapeProfileHtml(student.displayName || '')}</div><div class="child-record-section">${escapeProfileHtml(student.gradeLevel || 'Unassigned')} – ${escapeProfileHtml(student.sectionName || 'Unassigned')} · Adviser: ${escapeProfileHtml(student.adviserName || 'Not assigned')}</div><div class="child-record-row"><i data-lucide="badge-check" style="width:12px;height:12px;"></i> LRN ${escapeProfileHtml(student.lrn || 'Not available')}</div></div><div class="child-record-labels"><span class="child-relationship-tag"><i data-lucide="heart-handshake" style="width:9px;height:9px;"></i> ${escapeProfileHtml(relationship)}</span></div></div>`;
      }).join('');
      lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      renderParentProfile();
      await loadParentProfile();
      document.getElementById('parent-no-middle-name').addEventListener('change', updateParentProfileChoices);
      document.getElementById('parent-no-maiden-name').addEventListener('change', function () {
        if (this.checked) document.getElementById('parent-maiden-name').value = '';
        updateParentProfileChoices();
      });
      document.getElementById('parent-no-religion').addEventListener('change', function () {
        if (this.checked) document.getElementById('parent-religion').value = '';
        updateParentProfileChoices();
      });
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    async function loadParentProfile() {
      try {
        await window.EDUGNAY_SCHOOL_READY;
        const [profileResponse, setupResponse, children] = await Promise.all([
          window.EDUGNAY_API.request('/users/me/profile'),
          window.EDUGNAY_API.request('/account-setup/status'),
          window.EDUGNAY_API.getParentChildren()
        ]);
        if (profileResponse.user.role !== 'parent') throw new Error('Sign in with a parent account to view this profile.');
        parentApiUser = profileResponse.user;
        parentSetupStatus = setupResponse.setup || null;
        backendParentChildren = children;
        parentProfileError = '';
        renderParentProfile();
      } catch (error) {
        console.warn('Unable to load the saved profile.', error.message);
        parentProfileError = error.message || 'Profile and linked children could not be loaded.';
        renderParentProfile();
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

    document.getElementById('changePasswordModal').addEventListener('click', function (e) {
      if (e.target === this) closePasswordModal();
    });
    function switchTab(tabKey, btn) {
      if (parentSetupRequired && tabKey !== 'personal') return;
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pane-' + tabKey).classList.add('active');
    }

    async function submitProfile(event) {
      event.preventDefault();
      if (!parentApiUser) {
        alert('Your profile could not be loaded. Refresh the page before saving.');
        return false;
      }
      const wasSetupRequired = parentSetupRequired;

      const personalEmail = document.getElementById('parent-personal-email').value.trim();
      if (personalEmail && !/^\S+@\S+\.\S+$/.test(personalEmail)) {
        alert('Please provide a valid personal email.');
        return false;
      }

      const links = getParentLinks();
      const isMother = links.some(link => link.relationship === 'mother');
      const noMaidenName = document.getElementById('parent-no-maiden-name').checked;
      const noReligion = document.getElementById('parent-no-religion').checked;
      const profileData = {
        middleName: document.getElementById('parent-no-middle-name').checked
          ? null
          : document.getElementById('parent-middle-name').value.trim() || null,
        hasNoMiddleName: document.getElementById('parent-no-middle-name').checked,
        contactNumber: document.getElementById('parent-contact-number').value.trim() || null,
        sex: document.getElementById('parent-sex').value || null,
        religion: noReligion
          ? 'prefer_not_to_provide'
          : document.getElementById('parent-religion').value.trim() || null,
        houseStreet: document.getElementById('parent-house-street').value.trim() || null,
        barangay: document.getElementById('parent-barangay').value.trim() || null,
        cityMunicipality: document.getElementById('parent-city').value.trim() || null,
        province: document.getElementById('parent-province').value.trim() || null,
        maidenLastName: isMother && !noMaidenName
          ? document.getElementById('parent-maiden-name').value.trim() || null
          : null,
        hasNoMaidenName: isMother && noMaidenName
      };

      try {
        const endpoint = wasSetupRequired ? '/account-setup/parent' : '/users/me/profile';
        await window.EDUGNAY_API.request(endpoint, {
          method: 'PATCH',
          body: JSON.stringify(profileData)
        });
        const [profileResponse, setupResponse] = await Promise.all([
          window.EDUGNAY_API.request('/users/me/profile'),
          window.EDUGNAY_API.request('/account-setup/status')
        ]);
        parentApiUser = profileResponse.user;
        parentSetupStatus = setupResponse.setup || null;
        renderParentProfile();
        if (wasSetupRequired && !parentSetupRequired) {
          alert('Profile setup complete.');
          window.location.replace('./edugnay-parent-dashboard.html');
        } else {
          showAppToast('Profile updated.');
        }
      } catch (error) {
        showAppToast(error.message || 'Unable to update profile.', 'error');
      }
      return false;
    }

    function resetForm() {
      renderParentProfile();
    }

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p2cdbe9d32494: function(event) { openPasswordModal() },
    p6ce376468173: function(event) { switchTab('children', this) },
    p8712acd1332a: function(event) { closePasswordModal() },
    pba90ee35c9e2: function(event) { resetForm() },
    pd24600d14cf5: function(event) { switchTab('security', this) },
    ped25fcb51029: function(event) { switchTab('personal', this) },
  },
  submit: {
    p3d74c63c8476: function(event) { return submitPasswordChange(event) },
    pea7926a962b7: function(event) { return submitProfile(event) },
  },
});
