(function () {
  const baseUrl = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
  const list = document.getElementById('requestList');
  const statusTabs = document.getElementById('requestStatusTabs');
  let activeRequestStatus = 'pending';
  let busy = false;
  let historyBusy = false;
  let historyReloadRequested = false;
  let historyCursor = null;
  let historyRecords = [];
  let historyTimeZone = 'Asia/Manila';

  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));

  function initials(name) {
    const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2)).toLocaleUpperCase();
  }

  function statusBadge(status, count = 1) {
    const badgeClass = { pending: 'badge-orange', approved: 'badge-green', rejected: 'badge-red', revoked: 'badge-red' }[status] || 'badge-gray';
    const label = String(status || 'unknown');
    const text = count > 1 ? `${count} ${label}` : label.charAt(0).toLocaleUpperCase() + label.slice(1);
    return `<span class="badge ${badgeClass}">${escape(text)}</span>`;
  }

  function emptyState(title, text, icon) {
    return `<div class="panel-empty-state" role="status">
      <span class="panel-empty-state-icon" aria-hidden="true"><i data-lucide="${escape(icon)}"></i></span>
      <p class="panel-empty-state-title">${escape(title)}</p>
      <p class="panel-empty-state-text">${escape(text)}</p>
    </div>`;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}/fetchers${path}`, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'The request could not be completed.');
    return body;
  }

  async function pickupRequest(path) {
    const response = await fetch(`${baseUrl}/pickup${path}`, { credentials: 'include' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Pickup history could not be loaded.');
    return body;
  }

  async function loadHistory(append = false) {
    if (historyBusy) {
      if (!append) historyReloadRequested = true;
      return;
    }
    historyBusy = true;
    const target = document.getElementById('adminPickupHistory');
    const more = document.getElementById('adminPickupMore');
    if (!append) {
      more.hidden = true;
    }
    const params = new URLSearchParams({ limit: '50' });
    const from = document.getElementById('adminPickupFrom').value;
    const to = document.getElementById('adminPickupTo').value;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (append && historyCursor) params.set('cursor', historyCursor);
    try {
      const result = await pickupRequest(`/history?${params}`);
      historyTimeZone = result.timeZone || 'Asia/Manila';
      const records = result.records || [];
      historyRecords = append ? historyRecords.concat(records) : records;
      historyCursor = result.nextCursor;
      target.innerHTML = historyRecords.length ? window.EDUGNAY_PICKUP_HISTORY.render(historyRecords, historyTimeZone)
        : emptyState('No pickup records found for these dates.', 'Completed handovers will appear here.', 'calendar-days');
      document.getElementById('adminPickupCount').textContent = window.EDUGNAY_PICKUP_HISTORY.countLabel(historyRecords.length, Boolean(historyCursor));
      more.hidden = !historyCursor;
      window.EDUGNAY_AVATAR.hydrate(target);
      window.lucide?.createIcons();
    } catch (error) {
      showAppToast(error.message, 'error');
    } finally {
      historyBusy = false;
      if (historyReloadRequested) {
        historyReloadRequested = false;
        historyCursor = null;
        void loadHistory();
      }
    }
  }

  function render(items) {
    const groups = new Map();
    items.forEach(item => {
      if (!groups.has(item.fetcherId)) groups.set(item.fetcherId, []);
      groups.get(item.fetcherId).push(item);
    });
    list.innerHTML = groups.size ? [...groups.values()].map(requests => {
      const fetcher = requests[0];
      const sameStatus = requests.every(item => item.status === fetcher.status);
      return `<article class="fetcher-person panel admin-fetcher-card">
        <div class="fetcher-section-head">
          <div class="fetcher-person-top">
            ${fetcher.photoUrl ? `<img src="${escape(fetcher.photoUrl)}" alt="Photo of ${escape(fetcher.fullName)}">` : `<span class="person-avatar person-avatar--lg" data-avatar-tone="blue" aria-hidden="true">${escape(initials(fetcher.fullName))}</span>`}
            <div><h3>${escape(fetcher.fullName)}</h3><p>${escape(fetcher.relationship)} &middot; ${escape(fetcher.contactNumber)}</p></div>
          </div>
          ${sameStatus ? statusBadge(fetcher.status, requests.length) : `<span class="badge badge-gray">${requests.length} requests</span>`}
        </div>
        ${requests.map(item => `<div class="admin-fetcher-request-row">
          <div class="admin-fetcher-request-info">
            <div class="admin-fetcher-student-line">
              <strong>${escape(item.studentName)}</strong>
              ${sameStatus ? '' : statusBadge(item.status)}
            </div>
            <span>Requested by ${escape(item.parentName)}</span>
          </div>
          ${item.status === 'pending' ? `<div class="fetcher-actions admin-fetcher-request-actions">
            <button type="button" class="top-btn secondary" data-decision="reject" data-id="${item.id}">Reject</button>
            <button type="button" class="top-btn primary" data-decision="approve" data-id="${item.id}">Approve</button>
          </div>` : item.status === 'approved' ? `<div class="fetcher-actions admin-fetcher-request-actions">
            <button type="button" class="row-btn danger" data-decision="revoke" data-id="${item.id}">Revoke</button>
          </div>` : ''}
        </div>`).join('')}
      </article>`;
    }).join('') : emptyState(
      activeRequestStatus === 'all' ? 'No fetcher requests yet.' : `No ${escape(activeRequestStatus)} fetcher requests.`,
      'Requests will appear here when parents register fetchers.',
      'contact-round'
    );
    window.lucide?.createIcons();
  }

  async function load() {
    const data = await request(`/requests?status=${encodeURIComponent(activeRequestStatus)}`);
    render(data.requests || []);
  }

  statusTabs.addEventListener('click', async event => {
    const button = event.target.closest('button[data-status]');
    if (!button || busy || button.dataset.status === activeRequestStatus) return;
    activeRequestStatus = button.dataset.status;
    statusTabs.querySelectorAll('button.school-tab[data-status]').forEach(tab => {
      const isActive = tab === button;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });
    try { await load(); }
    catch (error) { showAppToast(error.message, 'error'); }
  });

  window.initAcademicRangePickers(document.getElementById('adminPickupHistoryPanel'), {
    rowSelector: '.pickup-history-filters', startSelector: '#adminPickupFrom',
    endSelector: '#adminPickupTo', name: 'Pickup history', allowSameDay: true, allowClear: true
  });
  let historyReloadQueued = false;
  ['adminPickupFrom', 'adminPickupTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (historyReloadQueued) return;
      historyReloadQueued = true;
      queueMicrotask(() => { historyReloadQueued = false; historyCursor = null; void loadHistory(); });
    });
  });
  document.getElementById('adminPickupToday').addEventListener('click', () => {
    const date = window.EDUGNAY_PICKUP_HISTORY.today(historyTimeZone);
    ['adminPickupFrom', 'adminPickupTo'].forEach(id => {
      const input = document.getElementById(id);
      input.value = date;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    historyCursor = null;
    void loadHistory();
  });
  document.getElementById('adminPickupMore').addEventListener('click', () => void loadHistory(true));

  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-decision]');
    if (!button || busy) return;
    const decision = button.dataset.decision;
    const id = Number(button.dataset.id);
    const row = button.closest('.admin-fetcher-request-row');
    const student = row?.querySelector('.admin-fetcher-student-line strong')?.textContent || 'this student';
    const fetcher = button.closest('.admin-fetcher-card')?.querySelector('h3')?.textContent || 'this fetcher';
    const labels = { approve: 'Approve', reject: 'Reject', revoke: 'Revoke' };
    if (!labels[decision] || !Number.isInteger(id)) return;
    void window.confirmFetcherAction({
      title: `${labels[decision]} pickup authorization?`,
      subtitle: decision === 'approve' ? 'This fetcher will be authorized for this student.'
        : decision === 'reject' ? 'This request will be rejected.' : 'This fetcher will lose pickup authorization.',
      contextLabel: `${decision === 'approve' ? 'Approving' : decision === 'reject' ? 'Rejecting' : 'Revoking'} for`,
      contextValue: student,
      icon: decision === 'approve' ? 'shield-check' : 'shield-x',
      message: `${fetcher} ${decision === 'approve' ? 'will be allowed to pick up' : decision === 'reject' ? 'will not be approved to pick up' : 'will no longer be allowed to pick up'} ${student}.`,
      confirmLabel: `Yes, ${labels[decision]}`, destructive: decision !== 'approve', trigger: button,
      onConfirm: async () => {
        busy = true;
        button.disabled = true;
        let saved = false;
        try {
          await request(`/authorizations/${id}/${decision}`, { method: 'POST' });
          saved = true;
          await load();
          showAppToast(`Fetcher authorization ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked'}.`);
        } catch (error) {
          showAppToast(saved ? 'Authorization changed, but the list could not refresh. Reload to verify it.' : error.message, saved ? 'info' : 'error');
        } finally { busy = false; button.disabled = false; }
      }
    });
  });

  (async () => {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'school_admin') { window.location.replace('../../index.html'); return; }
      await load();
      await loadHistory();
    } catch (error) { showAppToast(error.message || 'Fetcher requests could not be loaded. Refresh and try again.', 'error'); }
    finally { window.EDUGNAY_PAGE_LOADING?.ready(); }
  })();
})();
