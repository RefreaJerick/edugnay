const NOTIFICATION_TRIGGER_LABELS = [
    { code: 'grade_below_threshold', icon: 'trending-down', color: 'var(--red)', background: 'var(--red-pale)', label: 'Grade Falls Below Threshold', description: 'After a final grade is published below the school level passing grade.' },
    { code: 'consecutive_absences', icon: 'calendar-x', color: '#d97706', background: 'var(--orange-pale)', label: 'Consecutive missed class dates', description: 'Notify parents after this many recorded class dates are missed in a row for the same subject.' },
    { code: 'assignment_not_completed', icon: 'clipboard-check', color: '#16a34a', background: 'var(--green-pale)', label: 'Assignment Not Completed', description: 'After this many consecutive due assignments are incomplete.', unit: 'tasks' },
    { code: 'narrative_report_released', icon: 'file-text', color: '#92400e', background: 'var(--gold-pale)', label: 'Narrative Report Released', description: 'Notify linked parents when an adviser releases a weekly report.' },
    { code: 'journal_not_submitted', icon: 'notebook-pen', color: 'var(--gray-500)', background: 'var(--gray-100)', label: 'Journal Not Submitted', description: 'After this many consecutive closed journal prompts are missed.', unit: 'prompts' }
  ];
  let savedNotificationTriggers = null;
  let notificationDraft = null;
  let notificationAbsenceThreshold = 3;

  function renderNotificationTriggers() {
    const list = document.getElementById('notification-trigger-list');
    if (!list || !notificationDraft) return;
    list.innerHTML = NOTIFICATION_TRIGGER_LABELS.map(meta => {
      const setting = notificationDraft.find(item => item.code === meta.code);
      const description = !setting.available && meta.code === 'narrative_report_released'
        ? 'Enable Narrative Reports and wait until report release is enabled for the school.'
        : meta.description;
      return `<div class="trigger-row" data-code="${meta.code}"><div class="trigger-icon" style="background:${meta.background};color:${meta.color};"><i data-lucide="${meta.icon}" style="width:16px;height:16px;"></i></div><div class="trigger-info"><div class="trigger-label">${meta.label}</div><div class="trigger-desc">${description}${meta.code === 'consecutive_absences' ? ` Current count: ${notificationAbsenceThreshold}.` : ''}${setting.available || meta.code === 'narrative_report_released' ? '' : ' Enable its portal feature first.'}</div></div>${meta.unit ? `<div class="trigger-input-wrap"><input class="trigger-input" aria-label="${meta.label} count" type="number" value="${setting.threshold}" min="1" max="20"/><span class="trigger-unit">${meta.unit}</span></div>` : ''}<button class="toggle ${setting.enabled ? 'on' : ''}" type="button" role="switch" aria-label="${meta.label}" aria-checked="${setting.enabled}" ${setting.available ? '' : 'disabled'}></button></div>`;
    }).join('');
    lucide.createIcons();
  }

  async function loadNotificationTriggers() {
    try {
      const response = await window.EDUGNAY_API.getParentNotificationTriggers();
      notificationAbsenceThreshold = Number(response.absenceThreshold) || 3;
      savedNotificationTriggers = response.triggers;
      notificationDraft = structuredClone(savedNotificationTriggers);
      renderNotificationTriggers();
      document.getElementById('saveNotificationTriggers').disabled = false;
      document.getElementById('discardNotificationTriggers').disabled = false;
    } catch (error) {
      document.getElementById('notification-trigger-list').textContent = error.message || 'Notification settings could not be loaded.';
      showAppToast(error.message || 'Notification settings could not be loaded.', 'error');
    }
  }

  document.getElementById('notification-trigger-list').addEventListener('click', event => {
    const toggle = event.target.closest('button.toggle');
    if (!toggle || !notificationDraft) return;
    const setting = notificationDraft.find(item => item.code === toggle.closest('[data-code]').dataset.code);
    setting.enabled = !setting.enabled;
    toggle.classList.toggle('on', setting.enabled);
    toggle.setAttribute('aria-checked', String(setting.enabled));
  });

  document.getElementById('discardNotificationTriggers').addEventListener('click', () => {
    notificationDraft = structuredClone(savedNotificationTriggers);
    renderNotificationTriggers();
  });

  document.getElementById('saveNotificationTriggers').addEventListener('click', async () => {
    const button = document.getElementById('saveNotificationTriggers');
    for (const input of document.querySelectorAll('#notification-trigger-list .trigger-input')) {
      const setting = notificationDraft.find(item => item.code === input.closest('[data-code]').dataset.code);
      setting.threshold = Number(input.value);
      if (!Number.isInteger(setting.threshold) || setting.threshold < 1 || setting.threshold > 20) {
        showAppToast('Enter a count from 1 to 20.', 'error');
        input.focus();
        return;
      }
    }
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const values = notificationDraft.map(({ code, enabled, threshold }) => ({ code, enabled, threshold }));
      const response = await window.EDUGNAY_API.updateParentNotificationTriggers(values);
      savedNotificationTriggers = response.triggers;
      notificationDraft = structuredClone(savedNotificationTriggers);
      renderNotificationTriggers();
      showAppToast('Parent notification settings saved.', 'success');
    } catch (error) {
      showAppToast(error.message || 'Notification settings could not be saved.', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="save" style="width:13px;height:13px;"></i> Save Changes';
      lucide.createIcons();
    }
  });

  // Config nav highlight on click
  document.querySelectorAll('.config-nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
      // e.preventDefault();

      // active state
      document.querySelectorAll('.config-nav-item').forEach(i => i.classList.remove('active'));
      this.classList.add('active');

      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;

      const topbar = document.querySelector('.topbar');
      const configNav = document.querySelector('.config-nav');
      const topbarBottom = topbar.getBoundingClientRect().bottom;
      const topbarOffset = topbarBottom > 0 ? topbarBottom : 0;
      const navHeight = configNav ? configNav.offsetHeight : 0;

      const offset = Math.max(0, target.getBoundingClientRect().top + window.scrollY - topbarOffset - navHeight - 16);
      window.scrollTo({ top: offset, behavior: 'smooth' });

      history.replaceState(null, '', window.location.pathname);
    });
  });

  let reopenFilter = 'pending';
  let activeReopenRequestId = null;
  let reopenListTimer = null;
  let reopenRequests = [];
  let reopenRequestLoadError = '';

  async function loadReopenRequests() {
    try {
      reopenRequests = await window.EDUGNAY_API.getGradingPeriodReopenRequests();
      reopenRequestLoadError = '';
    } catch (error) {
      reopenRequests = [];
      reopenRequestLoadError = error.message || 'Reopen requests could not be loaded.';
    }
    renderReopenRequests();
  }

  function formatReopenDate(value) {
    return value ? window.EDUGNAY_CONFIG.formatDateTime(value) : 'Not set';
  }

  function toDateTimeInput(value) {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function reopenDetailsHtml(request) {
    const details = getReopenRequestDetails(request);
    return `<strong>${window.EDUGNAY_CONFIG.escapeHtml(getReopenPeriodName(request))}</strong><span>${window.EDUGNAY_CONFIG.escapeHtml(details.teacher)} · ${window.EDUGNAY_CONFIG.escapeHtml(details.section)} · ${window.EDUGNAY_CONFIG.escapeHtml(details.subject)}</span>`;
  }

  function setReopenFilter(filter) {
    reopenFilter = filter;
    document.querySelectorAll('[data-reopen-filter]').forEach(button => {
      const selected = button.dataset.reopenFilter === filter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    renderReopenRequests();
  }

  function renderReopenRequests() {
    const listEl = document.getElementById('reopenRequestList');
    const navBadge = document.getElementById('reopenNavBadge');
    const dot = document.getElementById('tbNotifDot');
    const requests = reopenRequests;
    const pending = requests.filter(request => request.status === 'pending');
    const active = requests.filter(request => request.status === 'approved');
    const history = requests.filter(request => request.status !== 'pending' && request.status !== 'approved');
    const visible = (reopenFilter === 'active' ? active : reopenFilter === 'history' ? history : pending)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

    clearTimeout(reopenListTimer);
    reopenListTimer = null;
    if (active.length) {
      const nextExpiration = Math.min(...active.map(request => new Date(request.expiresAt).getTime()));
      reopenListTimer = setTimeout(loadReopenRequests, Math.min(nextExpiration - Date.now() + 50, 2147483647));
    }

    if (navBadge) { navBadge.style.display = pending.length ? '' : 'none'; navBadge.textContent = pending.length; }
    if (dot) dot.style.display = pending.length ? '' : 'none';

    if (reopenRequestLoadError) {
      listEl.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'circle-alert', title: 'Requests could not be loaded', text: reopenRequestLoadError
      });
      return;
    }

    if (!visible.length) {
      const emptyStates = {
        pending: { icon: 'unlock', title: 'No pending reopen requests', text: 'New requests to reopen locked grading periods will appear here.' },
        active: { icon: 'clock', title: 'No active temporary access', text: 'Approved requests remain here until their editing deadline.' },
        history: { icon: 'history', title: 'No reopen request history', text: 'Expired, rejected, and revoked requests will appear here.' }
      };
      listEl.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState(emptyStates[reopenFilter]);
      return;
    }

    const statusLabels = { approved: 'Active', expired: 'Expired', rejected: 'Rejected', revoked: 'Revoked' };
    const statusClasses = { approved: 'badge-green', expired: 'badge-gray', rejected: 'badge-red', revoked: 'badge-red' };
    listEl.innerHTML = visible.map(request => {
      const details = getReopenRequestDetails(request);
      const state = request.status;
      const statusBadge = reopenFilter === 'pending'
        ? ''
        : `<span class="badge ${statusClasses[state] || 'badge-gray'}">${statusLabels[state] || state}</span>`;
      const deadline = state === 'approved' || state === 'expired'
        ? `<div class="reopen-request-deadline"><i data-lucide="clock"></i>${state === 'approved' ? 'Editable until' : 'Expired'} ${window.EDUGNAY_CONFIG.escapeHtml(formatReopenDate(request.expiresAt))}</div>`
        : '';
      const note = request.status === 'revoked'
        ? request.revokeReason
        : request.extensionReason || request.adminNote;
      const actions = reopenFilter === 'pending'
        ? `<div class="reopen-request-actions"><button class="top-btn secondary reopen-reject-btn" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openRejectReopenModal(String(request.id)) })}"><i data-lucide="x"></i> Reject</button><button class="top-btn primary" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openApproveReopenModal(String(request.id)) })}"><i data-lucide="check"></i> Approve</button></div>`
        : reopenFilter === 'active'
          ? `<div class="reopen-request-actions"><button class="top-btn secondary" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openExtendReopenModal(String(request.id)) })}"><i data-lucide="calendar-plus"></i> Extend</button><button class="top-btn secondary reopen-reject-btn" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openRevokeReopenModal(String(request.id)) })}"><i data-lucide="lock"></i> Revoke</button></div>`
          : '';
      return `<div class="reopen-request-row">
        <div class="reopen-request-icon"><i data-lucide="${state === 'approved' ? 'unlock' : state === 'pending' ? 'clock' : 'history'}"></i></div>
        <div class="reopen-request-content">
          <div class="reopen-request-title"><span>${window.EDUGNAY_CONFIG.escapeHtml(getReopenPeriodName(request))} · ${window.EDUGNAY_CONFIG.escapeHtml(details.section)} · ${window.EDUGNAY_CONFIG.escapeHtml(details.subject)}</span>${statusBadge}</div>
          <div class="reopen-request-meta">Requested by ${window.EDUGNAY_CONFIG.escapeHtml(details.teacher)} · ${window.EDUGNAY_CONFIG.escapeHtml(formatReopenDate(request.requestedAt))}</div>
          <div class="reopen-request-reason">${window.EDUGNAY_CONFIG.escapeHtml(request.reason)}</div>
          ${deadline}
          ${note ? `<div class="reopen-request-note"><strong>${request.status === 'revoked' ? 'Revocation reason:' : 'Admin note:'}</strong> ${window.EDUGNAY_CONFIG.escapeHtml(note)}</div>` : ''}
        </div>
        ${actions}
      </div>`;
    }).join('');
    lucide.createIcons();
  }

  function getReopenRequestById(id) {
    return reopenRequests.find(request => request.id === String(id));
  }

  function showReopenModal(id, requestId) {
    activeReopenRequestId = String(requestId);
    document.getElementById(id).classList.add('open');
    lucide.createIcons();
  }

  function closeReopenModal(id) {
    document.getElementById(id).classList.remove('open');
    activeReopenRequestId = null;
  }

  function setReopenModalError(id, message = '') {
    const error = document.getElementById(id);
    error.textContent = message;
    error.hidden = !message;
  }

  function openApproveReopenModal(id) {
    const request = getReopenRequestById(id);
    if (!request) return;
    const input = document.getElementById('approveReopenExpiresAt');
    input.min = toDateTimeInput(Date.now() + 60000);
    input.value = toDateTimeInput(Date.now() + 86400000);
    document.getElementById('approveReopenDetails').innerHTML = reopenDetailsHtml(request);
    document.getElementById('approveReopenNote').value = '';
    setReopenModalError('approveReopenError');
    showReopenModal('approveReopenModal', id);
  }

  function openRejectReopenModal(id) {
    const request = getReopenRequestById(id);
    if (!request) return;
    document.getElementById('rejectReopenDetails').innerHTML = reopenDetailsHtml(request);
    document.getElementById('rejectReopenNote').value = '';
    setReopenModalError('rejectReopenError');
    showReopenModal('rejectReopenModal', id);
  }

  function openExtendReopenModal(id) {
    const request = getReopenRequestById(id);
    if (!request) return;
    const currentExpiration = new Date(request.expiresAt).getTime();
    const input = document.getElementById('extendReopenExpiresAt');
    input.min = toDateTimeInput(currentExpiration + 60000);
    input.value = toDateTimeInput(currentExpiration + 86400000);
    document.getElementById('extendCurrentExpiration').textContent = formatReopenDate(request.expiresAt);
    document.getElementById('extendReopenReason').value = '';
    setReopenModalError('extendReopenError');
    showReopenModal('extendReopenModal', id);
  }

  function openRevokeReopenModal(id) {
    const request = getReopenRequestById(id);
    if (!request) return;
    document.getElementById('revokeReopenDetails').innerHTML = reopenDetailsHtml(request);
    document.getElementById('revokeReopenReason').value = '';
    setReopenModalError('revokeReopenError');
    showReopenModal('revokeReopenModal', id);
  }

  async function finishReopenAction(modalId) {
    closeReopenModal(modalId);
    await loadReopenRequests();
    renderTopbarNotifs();
    window.dispatchEvent(new Event('grading-period-reopen-requests-updated'));
    return !reopenRequestLoadError;
  }

  async function submitReopenApproval() {
    try {
      await window.EDUGNAY_API.decideGradingPeriodReopenRequest(activeReopenRequestId, 'approve', {
        expiresAt: document.getElementById('approveReopenExpiresAt').value,
        adminNote: document.getElementById('approveReopenNote').value
      });
      const refreshed = await finishReopenAction('approveReopenModal');
      showAppToast(refreshed ? 'Reopen request approved.' : 'Reopen request approved, but the list could not refresh.', refreshed ? 'success' : 'info');
    } catch (error) {
      setReopenModalError('approveReopenError', error.message);
    }
  }

  async function submitReopenRejection() {
    try {
      await window.EDUGNAY_API.decideGradingPeriodReopenRequest(activeReopenRequestId, 'reject', {
        adminNote: document.getElementById('rejectReopenNote').value
      });
      const refreshed = await finishReopenAction('rejectReopenModal');
      showAppToast(refreshed ? 'Reopen request rejected.' : 'Reopen request rejected, but the list could not refresh.', refreshed ? 'success' : 'info');
    } catch (error) {
      setReopenModalError('rejectReopenError', error.message);
    }
  }

  async function submitReopenExtension() {
    try {
      await window.EDUGNAY_API.decideGradingPeriodReopenRequest(activeReopenRequestId, 'extend', {
        expiresAt: document.getElementById('extendReopenExpiresAt').value,
        reason: document.getElementById('extendReopenReason').value
      });
      const refreshed = await finishReopenAction('extendReopenModal');
      showAppToast(refreshed ? 'Reopen access extended.' : 'Reopen access extended, but the list could not refresh.', refreshed ? 'success' : 'info');
    } catch (error) {
      setReopenModalError('extendReopenError', error.message);
    }
  }

  async function submitReopenRevocation() {
    try {
      await window.EDUGNAY_API.decideGradingPeriodReopenRequest(activeReopenRequestId, 'revoke', {
        reason: document.getElementById('revokeReopenReason').value
      });
      const refreshed = await finishReopenAction('revokeReopenModal');
      showAppToast(refreshed ? 'Reopen access revoked.' : 'Reopen access revoked, but the list could not refresh.', refreshed ? 'success' : 'info');
    } catch (error) {
      setReopenModalError('revokeReopenError', error.message);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadNotificationTriggers();
    await loadReopenRequests();
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', event => {
        if (event.target === backdrop) closeReopenModal(backdrop.id);
      });
    });
    lucide.createIcons();
    window.EDUGNAY_PAGE_LOADING.ready();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void loadReopenRequests();
  });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p16820d0aaf5b: function(event) { closeReopenModal('revokeReopenModal') },
    p89494902013c: function(event) { closeReopenModal('approveReopenModal') },
    p9e79d01780af: function(event) { submitReopenRejection() },
    paf1e70f3af05: function(event) { submitReopenApproval() },
    pb503ac7aea7d: function(event) { closeReopenModal('rejectReopenModal') },
    pba91e5d0cac6: function(event) { submitReopenExtension() },
    pbcbc0be7c8a4: function(event) { setReopenFilter('history') },
    pdc8e1a3ed93f: function(event) { setReopenFilter('active') },
    pe36dccaa5284: function(event) { submitReopenRevocation() },
    pe8e81deb8d05: function(event) { setReopenFilter('pending') },
    pf570948409c3: function(event) { closeReopenModal('extendReopenModal') },
  },
});
