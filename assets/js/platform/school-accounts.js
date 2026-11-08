const PLATFORM = window.EDUGNAY_PLATFORM;
    const SCHOOL_STATUS_VALUES = window.EDUGNAY_CONFIG.values.statuses;
    const schoolAccountState = { filter: 'all', query: '', selectedSchoolId: null };
    let schoolAccountRecords = [];
    let pendingSchoolStatusChange = null;
    let schoolStatusChangeInProgress = false;
    let schoolDeleteInProgress = false;
    let schoolAccountRefreshPromise = null;
    let schoolAccountQueuedRefresh = null;
    let schoolAccountPollTimer = null;
    let schoolAccountLastReturnAt = 0;
    let schoolAccountPollingReady = false;
    const SCHOOL_ACCOUNT_FILTERS = [
      { id: 'all', label: 'All schools' },
      { id: 'active', label: 'Active' },
      { id: 'pending', label: 'Pending review' },
      { id: 'rejected', label: 'Rejected' },
      { id: 'suspended', label: 'Suspended' }
    ];

    function schoolStatusLabel(status) {
      return status === SCHOOL_STATUS_VALUES.PENDING
        ? 'Pending review'
        : status.charAt(0).toUpperCase() + status.slice(1);
    }

    function schoolStatusIcon(status) {
      return status === SCHOOL_STATUS_VALUES.ACTIVE
        ? 'circle-check-big'
        : status === SCHOOL_STATUS_VALUES.PENDING
          ? 'clock-3'
          : 'circle-off';
    }

    function schoolLogoMarkup(school, className) {
      const logo = school.logoUrl
        ? `<img src="${escapeHtml(school.logoUrl)}" alt="" data-page-error="g9dff60b1ca61">`
        : '';
      return `<div class="${className}${logo ? ' has-logo' : ''}" aria-hidden="true">${logo}<i data-lucide="building-2" style="width:16px;height:16px;"></i></div>`;
    }

    function getFilteredSchoolAccounts() {
      const query = schoolAccountState.query.trim().toLowerCase();
      return schoolAccountRecords.filter(school => {
        const status = school.platformStatus;
        const matchesFilter = schoolAccountState.filter === 'all' || status === schoolAccountState.filter;
        const searchable = [school.name, school.schoolId, school.administrator, school.administratorSchoolEmail, school.email].join(' ').toLowerCase();
        return matchesFilter && (!query || searchable.includes(query));
      });
    }

    async function refreshSchoolAccounts(force = false) {
      if (schoolAccountRefreshPromise) {
        if (!force) return schoolAccountRefreshPromise;
        if (!schoolAccountQueuedRefresh) {
          schoolAccountQueuedRefresh = schoolAccountRefreshPromise.catch(() => {}).then(() => {
            schoolAccountQueuedRefresh = null;
            return refreshSchoolAccounts();
          });
        }
        return schoolAccountQueuedRefresh;
      }
      document.getElementById('schoolAccountRefresh').disabled = true;
      const request = (async () => {
        try {
          schoolAccountRecords = await PLATFORM.getSchoolRecords();
          renderSchoolAccounts();
          document.getElementById('schoolAccountRefreshError').hidden = true;
        } catch (error) {
          document.getElementById('schoolAccountRefreshError').hidden = false;
          throw error;
        }
      })();
      schoolAccountRefreshPromise = request.finally(() => {
        schoolAccountRefreshPromise = null;
        document.getElementById('schoolAccountRefresh').disabled = false;
      });
      return schoolAccountRefreshPromise;
    }

    function startSchoolAccountPolling() {
      if (document.hidden || schoolAccountPollTimer) return;
      schoolAccountPollTimer = window.setInterval(() => {
        if (!document.hidden) refreshSchoolAccounts().catch(() => {});
      }, 60000);
    }

    function stopSchoolAccountPolling() {
      if (schoolAccountPollTimer) window.clearInterval(schoolAccountPollTimer);
      schoolAccountPollTimer = null;
    }

    function checkSchoolAccountsOnReturn() {
      if (document.hidden || !schoolAccountPollingReady) return;
      startSchoolAccountPolling();
      if (Date.now() - schoolAccountLastReturnAt < 1000) return;
      schoolAccountLastReturnAt = Date.now();
      refreshSchoolAccounts(Boolean(schoolAccountRefreshPromise)).catch(() => {});
    }

    function renderSchoolAccountTabs(schools) {
      const counts = schools.reduce((result, school) => {
        const status = school.platformStatus;
        result.all += 1;
        result[status] += 1;
        return result;
      }, { all: 0, active: 0, pending: 0, rejected: 0, suspended: 0 });

      document.getElementById('schoolAccountTabs').innerHTML = SCHOOL_ACCOUNT_FILTERS.map(filter => `
        <button class="cat-tab ${schoolAccountState.filter === filter.id ? 'active' : ''}" type="button" role="tab" aria-selected="${schoolAccountState.filter === filter.id}" data-school-account-filter="${filter.id}">${filter.label}<span class="tab-count">${counts[filter.id]}</span></button>`).join('');

      document.querySelectorAll('[data-school-account-filter]').forEach(button => {
        button.addEventListener('click', () => {
          schoolAccountState.filter = button.dataset.schoolAccountFilter;
          renderSchoolAccounts();
        });
      });
    }

    function renderSchoolAccounts() {
      const schools = schoolAccountRecords;
      const filtered = getFilteredSchoolAccounts();
      const resultCount = document.getElementById('schoolAccountResultCount');
      const list = document.getElementById('schoolAccountList');

      renderSchoolAccountTabs(schools);
      resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`;

      list.innerHTML = filtered.length ? filtered.map(school => {
        const status = school.platformStatus;
        const type = school.typeLabel || school.schoolType || 'School';
        return `<tr>
          <td><div class="school-account-identity">${schoolLogoMarkup(school, 'school-account-logo')}<div><div class="school-account-name">${escapeHtml(school.name)}</div><div class="school-account-meta">${escapeHtml(type)}</div></div></div></td>
          <td><span class="school-account-mobile-label" aria-hidden="true">Administrator</span><div class="school-account-admin"><strong>${escapeHtml(school.administrator)}</strong><br>${escapeHtml(school.administratorSchoolEmail || 'No administrator email')}</div></td>
          <td><span class="school-account-mobile-label" aria-hidden="true">School ID</span><div class="school-account-id">${escapeHtml(school.schoolId || 'Not set')}</div></td>
          <td><span class="school-account-mobile-label" aria-hidden="true">Status</span><span class="school-account-status ${status}"><i data-lucide="${schoolStatusIcon(status)}" style="width:13px;height:13px;"></i>${schoolStatusLabel(status)}</span></td>
          <td><button class="row-btn edit" type="button" data-review-school="${escapeHtml(school.id)}">Review</button></td>
        </tr>`;
      }).join('') : `<tr class="panel-empty-row"><td colspan="5">${window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: schools.length ? 'search-x' : 'building-2',
        title: schools.length ? 'No matching school accounts' : 'No school accounts yet',
        text: schools.length ? 'Try a different search term or filter.' : 'Registered school accounts will appear here.'
      })}</td></tr>`;

      document.querySelectorAll('[data-review-school]').forEach(button => button.addEventListener('click', () => openSchoolAccountModal(button.dataset.reviewSchool, button)));
      if (window.lucide) window.lucide.createIcons();
    }

    async function openSchoolAccountModal(schoolId, button) {
      const listSchool = schoolAccountRecords.find(item => item.id === schoolId);
      if (!listSchool) return;
      if (button) { button.disabled = true; button.textContent = 'Loading...'; }
      let details;
      try { details = await window.EDUGNAY_API.getPlatformSchool(schoolId); }
      catch (error) { showAppToast(error.message || 'School details could not be loaded.', 'error'); return; }
      finally { if (button) { button.disabled = false; button.textContent = 'Review'; } }
      const school = {
        ...listSchool, ...details.school,
        id: String(details.school.id),
        schoolId: details.school.depedSchoolId || details.school.schoolCode || '',
        schoolYear: details.school.currentSchoolYearLabel,
        platformStatus: details.school.registrationStatus,
        administrator: details.administrators[0]?.displayName || listSchool.administrator,
        administratorSchoolEmail: details.administrators[0]?.schoolEmail || listSchool.administratorSchoolEmail,
        schoolLevels: details.structure.filter(level => level.isEnabled).map(level => level.levelCode),
        gradesPageEnabled: details.features.gradesEnabled,
        narrativeReportsEnabled: details.features.narrativeReportsEnabled,
        journalsEnabled: details.features.journalsEnabled
      };
      schoolAccountState.selectedSchoolId = school.id;
      const status = school.platformStatus;
      const type = school.typeLabel || school.schoolType || 'School';
      const levels = Array.isArray(school.schoolLevels) && school.schoolLevels.length
        ? (window.EDUGNAY_CONFIG.getSchoolTypeInfo?.(school.schoolLevels)?.label || school.schoolLevels.join(' + '))
        : 'Not set';
      const journalSubject = details.journalSubject;
      const administratorLoginStatus = {
        [SCHOOL_STATUS_VALUES.ACTIVE]: { label: 'Active', className: 'active' },
        [SCHOOL_STATUS_VALUES.PENDING]: { label: 'Inactive until approval', className: 'pending' },
        [SCHOOL_STATUS_VALUES.REJECTED]: { label: 'Inactive — registration rejected', className: 'rejected' },
        [SCHOOL_STATUS_VALUES.SUSPENDED]: { label: 'Unavailable while school access is suspended', className: 'suspended' }
      }[status] || { label: 'Unavailable', className: 'suspended' };
      const portalFeatures = [
        { label: 'Grades page', enabled: Boolean(school.gradesPageEnabled) },
        { label: 'AI Reports', enabled: Boolean(school.narrativeReportsEnabled) },
        { label: 'Journals', enabled: Boolean(details.features.journalsEnabled && journalSubject) }
      ];
      const academicTerms = details.structure.filter(level => level.isEnabled).map(level => {
        const count = details.academicTerms.filter(term => term.schoolLevel === level.levelCode).length;
        const periodType = { quarterly: 'Quarterly', trimestral: 'Three-term', semestral: 'Semestral' }[level.gradingPeriodType];
        return {
          level: level.displayName,
          structure: periodType || 'Not set up',
          count
        };
      });

      document.getElementById('schoolAccountModalBody').innerHTML = `
        <div class="account-review-profile">${schoolLogoMarkup(school, 'account-review-logo')}<div><div class="account-review-name">${escapeHtml(school.name)}</div><div class="account-review-type">${escapeHtml(type)}</div></div></div>
        <dl class="account-review-details">
          <div><dt>School ID</dt><dd>${escapeHtml(school.schoolId || 'Not set')}</dd></div>
          <div><dt>Platform access</dt><dd>${schoolStatusLabel(status)}</dd></div>
          <div><dt>Initial administrator</dt><dd>${escapeHtml(school.administrator)}</dd></div>
          <div><dt>Administrator login</dt><dd><span class="account-review-login-email">${escapeHtml(school.administratorSchoolEmail || 'Not set')}</span><span class="account-login-status ${administratorLoginStatus.className}" role="status">${escapeHtml(administratorLoginStatus.label)}</span></dd></div>
          <div><dt>Notification email (delivery address)</dt><dd>${escapeHtml(school.notificationEmail || 'Not set')}</dd></div>
          <div><dt>Submitted</dt><dd>${escapeHtml(school.submittedAt ? window.EDUGNAY_CONFIG.formatDateTime(school.submittedAt) : 'Not available')}</dd></div>
          <div><dt>School levels</dt><dd>${escapeHtml(levels)}</dd></div>
          <div><dt>School email</dt><dd>${escapeHtml(school.email || 'Not set')}</dd></div>
        </dl>
        <section class="account-review-section" aria-labelledby="account-review-terms-title">
          <div class="account-review-section-head">
            <span class="account-review-section-icon" aria-hidden="true"><i data-lucide="calendar-range"></i></span>
            <div>
              <div class="account-review-section-title" id="account-review-terms-title">Academic terms</div>
              <div class="account-review-section-sub">Planned structures for S.Y. ${escapeHtml(school.schoolYear || 'Not set')}.</div>
            </div>
          </div>
          <div class="account-review-feature-list">
            ${academicTerms.length ? academicTerms.map(item => `<div class="account-review-feature-row"><span class="account-review-feature-label">${escapeHtml(item.level)}</span><span class="account-review-feature-value">${escapeHtml(item.structure)} · ${item.count} period${item.count === 1 ? '' : 's'}</span></div>`).join('') : '<div class="account-review-feature-row"><span class="account-review-feature-label">No term configuration submitted</span></div>'}
          </div>
        </section>
        <section class="account-review-section" aria-labelledby="account-review-portal-title">
          <div class="account-review-section-head">
            <span class="account-review-section-icon" aria-hidden="true"><i data-lucide="sliders-horizontal"></i></span>
            <div>
              <div class="account-review-section-title" id="account-review-portal-title">Portal configuration</div>
              <div class="account-review-section-sub">Current feature access for this school.</div>
            </div>
          </div>
          <div class="account-review-feature-list">
            ${portalFeatures.map(feature => `<div class="account-review-feature-row"><span class="account-review-feature-label">${feature.label}</span><span class="account-review-feature-status ${feature.enabled ? 'enabled' : 'disabled'}"><i data-lucide="${feature.enabled ? 'circle-check' : 'circle-off'}" aria-hidden="true"></i>${feature.enabled ? 'Enabled' : 'Disabled'}</span></div>`).join('')}
            <div class="account-review-feature-row"><span class="account-review-feature-label">Journal subject</span><span class="account-review-feature-value">${escapeHtml(journalSubject?.name || 'Not set up')}</span></div>
          </div>
        </section>`;

      const action = status === SCHOOL_STATUS_VALUES.ACTIVE
        ? `<button class="btn btn-save school-account-suspend" type="button" data-school-status="${SCHOOL_STATUS_VALUES.SUSPENDED}">Suspend school</button>`
        : status === SCHOOL_STATUS_VALUES.PENDING
          ? `<button class="btn btn-save school-account-reject" type="button" data-school-action="reject">Reject registration</button><button class="btn btn-save" type="button" data-school-status="${SCHOOL_STATUS_VALUES.ACTIVE}">Approve registration</button>`
          : status === SCHOOL_STATUS_VALUES.SUSPENDED
            ? `<button class="btn btn-save" type="button" data-school-status="${SCHOOL_STATUS_VALUES.ACTIVE}">Reactivate school</button>`
            : '';
      const emailDelivery = details.emailDelivery;
      const deliveryStatusLabel = {
        pending: 'Queued',
        sending: 'Sending',
        sent: 'Email service accepted it — inbox delivery is not confirmed',
        skipped: 'Skipped',
        failed: 'Failed'
      }[emailDelivery?.status] || 'No school account email queued';
      const emailSection = document.createElement('section');
      emailSection.className = 'account-review-section';
      emailSection.innerHTML = '<div class="account-review-section-head"><div><div class="account-review-section-title">Latest school account email</div><div class="account-review-section-sub">The email service accepted it, but we cannot confirm it reached the recipient’s inbox.</div></div></div><div class="account-review-feature-list"></div>';
      if (emailDelivery?.decision) {
        const emailTitles = {
          approved: 'Approval email',
          rejected: 'Rejection email',
          suspended: 'Suspension email',
          reactivated: 'Reactivation email'
        };
        emailSection.querySelector('.account-review-section-title').textContent = emailTitles[emailDelivery.decision] || 'Latest school account email';
      }
      const emailList = emailSection.querySelector('.account-review-feature-list');
      const deliveryRow = document.createElement('div');
      deliveryRow.className = 'account-review-feature-row';
      deliveryRow.innerHTML = '<span class="account-review-feature-label">Delivery status</span><span class="account-review-feature-value"></span>';
      deliveryRow.querySelector('.account-review-feature-value').textContent = deliveryStatusLabel;
      emailList.appendChild(deliveryRow);
      if (emailDelivery) {
        const recipientRow = document.createElement('div');
        recipientRow.className = 'account-review-feature-row';
        recipientRow.innerHTML = '<span class="account-review-feature-label">Email recipient</span><span class="account-review-feature-value"></span>';
        recipientRow.querySelector('.account-review-feature-value').textContent = emailDelivery.recipientEmail || 'Missing or invalid';
        emailList.appendChild(recipientRow);
        if (emailDelivery.smtpMessageId) {
          const referenceRow = document.createElement('div');
          referenceRow.className = 'account-review-feature-row';
          referenceRow.innerHTML = '<span class="account-review-feature-label">Email delivery reference</span><span class="account-review-feature-value"></span>';
          referenceRow.querySelector('.account-review-feature-value').textContent = emailDelivery.smtpMessageId;
          emailList.appendChild(referenceRow);
        }
        const attemptRow = document.createElement('div');
        attemptRow.className = 'account-review-feature-row';
        attemptRow.innerHTML = '<span class="account-review-feature-label">Attempts</span><span class="account-review-feature-value"></span>';
        attemptRow.querySelector('.account-review-feature-value').textContent = String(emailDelivery.attempts || 0);
        emailList.appendChild(attemptRow);
        if (emailDelivery.lastError) {
          const errorRow = document.createElement('div');
          errorRow.className = 'account-review-feature-row';
          errorRow.innerHTML = '<span class="account-review-feature-label">Delivery error details</span><span class="account-review-feature-value"></span>';
          errorRow.querySelector('.account-review-feature-value').textContent = emailDelivery.lastError === 'smtp_outcome_unknown'
            ? 'The delivery result is unclear. Check the sender’s Sent folder before retrying.'
            : emailDelivery.lastError;
          emailList.appendChild(errorRow);
        }
        if (emailDelivery.status === 'failed') {
          const retryButton = document.createElement('button');
          retryButton.className = 'btn btn-cancel';
          retryButton.type = 'button';
          retryButton.textContent = 'Retry email';
          retryButton.addEventListener('click', () => retrySchoolRegistrationEmail(school.id, retryButton));
          emailSection.appendChild(retryButton);
        }
      }
      document.getElementById('schoolAccountModalBody').appendChild(emailSection);
      const canDelete = status === SCHOOL_STATUS_VALUES.REJECTED || status === SCHOOL_STATUS_VALUES.SUSPENDED;
      document.getElementById('schoolAccountModalActions').innerHTML = `${canDelete ? '<button class="btn btn-danger" id="schoolAccountDeleteButton" type="button">Delete school</button>' : ''}${action}`;
      document.getElementById('schoolAccountDeleteButton')?.addEventListener('click', openSchoolDeleteConfirmation);
      const rejectButton = document.querySelector('[data-school-action="reject"]');
      if (rejectButton) rejectButton.addEventListener('click', openSchoolRejectionModal);
      const statusButton = document.querySelector('[data-school-status]');
      if (statusButton) statusButton.addEventListener('click', () => {
        const selectedSchool = schoolAccountRecords.find(item => item.id === schoolAccountState.selectedSchoolId);
        if (!selectedSchool) return;
        const nextStatus = statusButton.dataset.schoolStatus;
        const actionLabel = nextStatus === SCHOOL_STATUS_VALUES.SUSPENDED
          ? 'Suspend'
          : selectedSchool.platformStatus === SCHOOL_STATUS_VALUES.PENDING
            ? 'Approve'
            : 'Reactivate';
        openSchoolStatusConfirmation(selectedSchool, nextStatus, actionLabel);
      });

      const modal = document.getElementById('schoolAccountModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      if (window.lucide) window.lucide.createIcons();
    }

    function openSchoolRejectionModal() {
      const school = schoolAccountRecords.find(item => item.id === schoolAccountState.selectedSchoolId);
      if (!school) return;
      document.getElementById('schoolAccountRejectionName').textContent = school.name;
      document.getElementById('schoolAccountRejectionReason').value = '';
      const modal = document.getElementById('schoolAccountRejectModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('schoolAccountRejectionReason').focus();
      if (window.lucide) window.lucide.createIcons();
    }

    function closeSchoolRejectionModal() {
      const modal = document.getElementById('schoolAccountRejectModal');
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openSchoolStatusConfirmation(school, status, actionLabel) {
      const isSuspending = status === SCHOOL_STATUS_VALUES.SUSPENDED;
      pendingSchoolStatusChange = { schoolId: school.id, status, actionLabel };
      document.getElementById('schoolStatusConfirmTitle').textContent = `${actionLabel} school account?`;
      document.getElementById('schoolStatusConfirmSub').textContent = isSuspending
        ? 'The school will lose access until it is reactivated.'
        : 'This will update the school’s access to Academix.';
      document.getElementById('schoolStatusConfirmName').textContent = school.name;
      document.getElementById('schoolStatusConfirmMessage').textContent = isSuspending
        ? 'Are you sure you want to suspend this school account?'
        : `Are you sure you want to ${actionLabel.toLowerCase()} this school account?`;
      document.getElementById('schoolStatusConfirmContext').classList.toggle('confirm-remove-context', isSuspending);
      const icon = document.getElementById('schoolStatusConfirmIcon');
      icon.classList.toggle('danger', isSuspending);
      icon.innerHTML = `<i data-lucide="${isSuspending ? 'ban' : 'circle-check'}"></i>`;
      const button = document.getElementById('schoolStatusConfirmButton');
      button.textContent = `${actionLabel} school`;
      button.className = `btn ${isSuspending ? 'btn-danger' : 'btn-save'}`;
      const modal = document.getElementById('schoolStatusConfirmModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      if (window.lucide) window.lucide.createIcons();
    }

    function closeSchoolStatusConfirmation() {
      if (schoolStatusChangeInProgress) return;
      const modal = document.getElementById('schoolStatusConfirmModal');
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      pendingSchoolStatusChange = null;
    }

    async function confirmSchoolStatusChange() {
      const change = pendingSchoolStatusChange;
      const button = document.getElementById('schoolStatusConfirmButton');
      if (!change || button.disabled) return;
      schoolStatusChangeInProgress = true;
      button.disabled = true;
      button.textContent = change.actionLabel === 'Suspend'
        ? 'Suspending...'
        : change.actionLabel === 'Approve'
          ? 'Approving...'
          : 'Reactivating...';
      let updated = false;
      try {
        updated = await updateSchoolAccountStatus(change.status, change.schoolId);
      } finally {
        schoolStatusChangeInProgress = false;
        if (updated) closeSchoolStatusConfirmation();
        button.disabled = false;
        if (pendingSchoolStatusChange) button.textContent = `${pendingSchoolStatusChange.actionLabel} school`;
      }
    }

    async function rejectSchoolRegistration() {
      const rejectionReason = document.getElementById('schoolAccountRejectionReason').value.trim();
      const button = document.getElementById('schoolAccountRejectConfirm');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Rejecting...';

      try {
        const updatedSchool = await window.EDUGNAY_API.changePlatformSchool(schoolAccountState.selectedSchoolId, 'reject', rejectionReason);
        if (!updatedSchool) {
          showAppToast('The school record was not found.', 'error');
          return;
        }
        closeSchoolRejectionModal();
        closeSchoolAccountModal();
        try {
          await refreshSchoolAccounts(true);
          showAppToast('School registration rejected.');
        } catch (refreshError) {
          showAppToast('School registration was rejected, but the list could not refresh. Reload the page to verify it.', 'info');
        }
      } catch (error) {
        showAppToast(error.message || 'The school registration could not be rejected.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Reject registration';
      }
    }

    function closeSchoolAccountModal() {
      const modal = document.getElementById('schoolAccountModal');
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      schoolAccountState.selectedSchoolId = null;
    }

    function openSchoolDeleteConfirmation() {
      const school = schoolAccountRecords.find(item => item.id === schoolAccountState.selectedSchoolId);
      if (!school) return;
      document.getElementById('schoolDeleteConfirmName').textContent = school.name;
      const modal = document.getElementById('schoolDeleteConfirmModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('schoolDeleteConfirmButton').focus();
      if (window.lucide) window.lucide.createIcons();
    }

    function closeSchoolDeleteConfirmation() {
      if (schoolDeleteInProgress) return;
      const modal = document.getElementById('schoolDeleteConfirmModal');
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    async function confirmSchoolDeletion() {
      const schoolId = schoolAccountState.selectedSchoolId;
      const button = document.getElementById('schoolDeleteConfirmButton');
      if (!schoolId || schoolDeleteInProgress) return;
      schoolDeleteInProgress = true;
      button.disabled = true;
      button.textContent = 'Deleting...';
      try {
        const result = await window.EDUGNAY_API.deletePlatformSchool(schoolId);
        schoolDeleteInProgress = false;
        closeSchoolDeleteConfirmation();
        closeSchoolAccountModal();
        try {
          await refreshSchoolAccounts(true);
          showAppToast(result.fileCleanupFailed ? 'School deleted. An uploaded image needs cleanup.' : 'School deleted permanently.', result.fileCleanupFailed ? 'info' : undefined);
        } catch (error) {
          showAppToast('School deleted, but the list could not refresh. Reload the page to verify it.', 'info');
        }
      } catch (error) {
        schoolDeleteInProgress = false;
        closeSchoolDeleteConfirmation();
        showAppToast(error.message || 'The school could not be deleted.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Delete school';
      }
    }

    async function retrySchoolRegistrationEmail(schoolId, button) {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Queueing retry...';
      try {
        await window.EDUGNAY_API.retryPlatformSchoolRegistrationEmail(schoolId);
        showAppToast('Email retry queued.');
        await openSchoolAccountModal(schoolId);
      } catch (error) {
        showAppToast(error.message || 'The email could not be retried.', 'error');
        button.disabled = false;
        button.textContent = 'Retry email';
      }
    }

    async function updateSchoolAccountStatus(status, schoolId = schoolAccountState.selectedSchoolId) {
      const school = schoolAccountRecords.find(item => item.id === schoolId);
      if (!school) {
        showAppToast('The school record was not found.', 'error');
        return false;
      }
      const button = document.querySelector('#schoolAccountModalActions [data-school-status]');
      if (button?.disabled) return false;
      if (button) button.disabled = true;

      try {
        const action = status === SCHOOL_STATUS_VALUES.SUSPENDED ? 'suspend'
          : school.platformStatus === SCHOOL_STATUS_VALUES.PENDING ? 'approve' : 'reactivate';
        const updatedSchool = await window.EDUGNAY_API.changePlatformSchool(school.id, action);
        if (!updatedSchool) {
          showAppToast('The school record was not found.', 'error');
          return false;
        }
        closeSchoolAccountModal();
        try {
          await refreshSchoolAccounts(true);
          showAppToast(status === SCHOOL_STATUS_VALUES.ACTIVE ? 'School account activated.' : 'School account updated.');
        } catch (refreshError) {
          showAppToast('School account was updated, but the list could not refresh. Reload the page to verify it.', 'info');
        }
        return true;
      } catch (error) {
        showAppToast(error.message || 'The school account could not be updated.', 'error');
        return false;
      } finally {
        if (button) button.disabled = false;
      }
    }

    document.getElementById('schoolAccountSearch').addEventListener('input', event => {
      schoolAccountState.query = event.target.value;
      renderSchoolAccounts();
    });

    document.getElementById('schoolAccountModal').addEventListener('click', event => {
      if (event.target.id === 'schoolAccountModal') closeSchoolAccountModal();
    });

    document.getElementById('schoolAccountRejectModal').addEventListener('click', event => {
      if (event.target.id === 'schoolAccountRejectModal') closeSchoolRejectionModal();
    });

    document.getElementById('schoolStatusConfirmModal').addEventListener('click', event => {
      if (event.target.id === 'schoolStatusConfirmModal') closeSchoolStatusConfirmation();
    });

    document.getElementById('schoolDeleteConfirmModal').addEventListener('click', event => {
      if (event.target.id === 'schoolDeleteConfirmModal') closeSchoolDeleteConfirmation();
    });

    document.getElementById('schoolAccountRejectConfirm').addEventListener('click', rejectSchoolRegistration);
    document.getElementById('schoolStatusConfirmButton').addEventListener('click', confirmSchoolStatusChange);
    document.getElementById('schoolDeleteConfirmButton').addEventListener('click', confirmSchoolDeletion);
    document.getElementById('schoolAccountRefresh').addEventListener('click', () => refreshSchoolAccounts(true).catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { schoolAccountLastReturnAt = 0; stopSchoolAccountPolling(); }
      else checkSchoolAccountsOnReturn();
    });
    window.addEventListener('focus', checkSchoolAccountsOnReturn);
    window.addEventListener('pagehide', () => { schoolAccountLastReturnAt = 0; stopSchoolAccountPolling(); });
    window.addEventListener('pageshow', checkSchoolAccountsOnReturn);

    document.addEventListener('DOMContentLoaded', async () => {
      try {
        await refreshSchoolAccounts();
      } catch (error) {
        document.getElementById('schoolAccountResultCount').textContent = 'Unavailable';
        document.getElementById('schoolAccountList').innerHTML = `<tr><td colspan="5">${window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'School accounts unavailable', text: error?.message || 'Refresh and try again.' })}</td></tr>`;
        showAppToast(error?.message || 'The school accounts could not be loaded.', 'error');
      }
      if (window.lucide) window.lucide.createIcons();
      window.EDUGNAY_PAGE_LOADING.ready();
      await window.EDUGNAY_PLATFORM_COMMUNICATION_READY;
      PLATFORM.renderTopbarNotifs();
      schoolAccountPollingReady = true;
      schoolAccountLastReturnAt = Date.now();
      startSchoolAccountPolling();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p080362b5f50d: function(event) { closeSchoolAccountModal() },
    p46f01a72d3a7: function(event) { closeSchoolStatusConfirmation() },
    p6c885e79f160: function(event) { closeSchoolDeleteConfirmation() },
    p7ec25364b9e4: function(event) { closeSchoolRejectionModal() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  error: {
    g9dff60b1ca61: function(event) { this.parentElement.classList.remove('has-logo'); this.remove(); },
  },
});
