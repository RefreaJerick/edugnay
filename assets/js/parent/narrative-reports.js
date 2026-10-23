(() => {
  const api = window.EDUGNAY_API;
  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const state = { children: [], childId: null, reports: [], requestId: 0, returnFocus: null };
  const $ = id => document.getElementById(id);

  function message(text, error = false) {
    const node = $('parent-reports-message');
    node.textContent = text || '';
    node.hidden = !text;
    node.classList.toggle('is-error', error);
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-PH', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(value + 'T00:00:00.000Z'));
  }

  function weekTitle(report) {
    const start = report.weekStartDate;
    const end = report.weekEndDate;
    if (!start || !end) return 'Weekly report';
    const startDate = new Date(start + 'T00:00:00.000Z');
    const endDate = new Date(end + 'T00:00:00.000Z');
    const month = date => new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'UTC' }).format(date);
    if (start.slice(0, 7) === end.slice(0, 7)) {
      return `Week of ${month(startDate)} ${startDate.getUTCDate()} to ${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
    }
    if (start.slice(0, 4) === end.slice(0, 4)) {
      return `Week of ${month(startDate)} ${startDate.getUTCDate()} to ${month(endDate)} ${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
    }
    return `Week of ${formatDate(start)} to ${formatDate(end)}`;
  }

  function releaseDate(value) {
    if (!value) return '';
    const date = formatDate(value.slice(0, 10));
    const time = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(value);
    if (!time) return date;
    const hour = Number(time[1]);
    return `${date}, ${hour % 12 || 12}:${time[2]} ${hour < 12 ? 'AM' : 'PM'}`;
  }

  function releaseMeta(report) {
    const adviser = report.adviserName ? `Released by ${report.adviserName}` : 'Released';
    const date = releaseDate(report.releasedAt);
    return date ? `${adviser} · ${date}` : adviser;
  }

  function parentSummary(report) {
    const summary = String(report.summary ?? '');
    const prefix = summary.match(/^Approved summary for [^:\r\n]+:\s*/i);
    if (!prefix) return summary;
    return summary.slice(prefix[0].length).replace(/\p{L}/u, letter => letter.toLocaleUpperCase());
  }

  function correctionNotice(report) {
    return Number(report.versionNumber) > 1 && report.correctedAt
      ? `<span class="report-correction-notice">Updated on ${escape(formatDate(report.correctedAt.slice(0, 10)))}</span>`
      : '';
  }

  function authorMark(name) {
    if (!name) return '';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    return `<span class="report-author-mark" aria-hidden="true">${escape(initials)}</span>`;
  }

  function actionsMarkup(report) {
    const actions = Array.isArray(report.parentActions) ? report.parentActions : [];
    return actions.length ? `<div class="parent-recommended-actions"><div class="parent-recommended-actions-title"><i data-lucide="list-checks" aria-hidden="true"></i> Recommended actions</div><ul>${actions.map(action => `<li>${escape(action)}</li>`).join('')}</ul></div>` : '';
  }

  function updateUrl(reportId = null) {
    const url = new URL(window.location.href);
    if (state.childId) url.searchParams.set('studentId', state.childId);
    if (reportId) url.searchParams.set('reportId', reportId);
    else url.searchParams.delete('reportId');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  function renderChildren() {
    const switcher = $('parentReportChildSwitcher');
    if (!state.children.length) {
      switcher.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'users', title: 'No linked children', text: 'Children linked to this parent account will appear here.'
      });
      return;
    }
    switcher.innerHTML = state.children.map(child =>
      '<button class="child-card ' + (child.studentId === state.childId ? 'active' : '') +
      '" type="button" data-student-id="' + escape(child.studentId) + '" aria-pressed="' +
      (child.studentId === state.childId) + '">' +
      window.EDUGNAY_AVATAR.html(child, { className: 'child-avatar', role: 'student' }) +
      '<span class="child-info"><span class="child-name">' + escape(child.displayName || 'Student') +
      '</span><span class="child-section">' + escape(child.gradeLevel || 'Unassigned') + ' · ' +
      escape(child.sectionName || 'Unassigned') + '</span></span></button>'
    ).join('');
    window.EDUGNAY_AVATAR?.hydrate?.(switcher);
  }

  function renderReports() {
    if (!state.reports.length) {
      $('parent-reports-content').hidden = true;
      $('parent-reports-empty').hidden = false;
      $('parent-reports-empty').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'notebook-pen', title: 'No reports shared yet',
        text: 'Reports released for this child will appear here.'
      });
      message('');
      window.lucide?.createIcons?.();
      return;
    }
    $('parent-reports-empty').hidden = true;
    $('parent-reports-content').hidden = false;
    const latest = state.reports[0];
    $('latest-report').innerHTML = `<div class="lr-head"><div class="lr-head-left"><span class="lr-icon" aria-hidden="true"><i data-lucide="notebook-pen"></i></span><div><div class="lr-eyebrow">Weekly report</div><h2 class="lr-week" id="latest-report-title">${escape(weekTitle(latest))}</h2></div></div>${correctionNotice(latest)}</div><span class="lr-quote-mark" aria-hidden="true">“</span><p class="lr-text">${escape(parentSummary(latest))}</p>${actionsMarkup(latest)}<div class="lr-foot"><div class="lr-meta">${authorMark(latest.adviserName)}<span>${escape(releaseMeta(latest))}</span></div></div>`;
    renderPastReports();
    message('');
    window.lucide?.createIcons?.();
  }

  function renderPastReports() {
    if (!state.reports.length) return;
    const past = state.reports.slice(1);
    const timeline = $('parent-report-list');
    timeline.classList.toggle('report-timeline-empty', !past.length);
    if (!past.length) {
      timeline.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'history', title: 'No earlier reports', text: 'Earlier released reports will appear here.'
      });
    } else {
      timeline.innerHTML = past.map(report => `<div class="timeline-entry"><span class="timeline-dot" aria-hidden="true"><span class="timeline-dot-inner"></span></span><article class="report-card"><div class="rc-head"><div><h3 class="rc-week-label">${escape(weekTitle(report))}</h3><div class="rc-date-range">${escape(formatDate(report.weekStartDate))} to ${escape(formatDate(report.weekEndDate))}</div>${correctionNotice(report)}</div></div><p class="rc-excerpt">${escape(parentSummary(report))}</p><div class="rc-foot"><span class="rc-foot-left">${authorMark(report.adviserName)}<span>${escape(releaseMeta(report))}</span></span><button class="rc-read-link" type="button" data-report-id="${escape(report.id)}">Read full report <i data-lucide="arrow-right" aria-hidden="true"></i></button></div></article></div>`).join('');
    }
    window.lucide?.createIcons?.();
  }

  function openReport(report, trigger = document.activeElement, syncUrl = true) {
    const child = state.children.find(item => item.studentId === state.childId);
    $('parent-report-modal-sub').textContent = [weekTitle(report), child?.displayName].filter(Boolean).join(' · ');
    $('parent-report-modal-summary').textContent = parentSummary(report);
    $('parent-report-modal-actions').innerHTML = correctionNotice(report) + actionsMarkup(report);
    $('parent-report-modal-meta').innerHTML = authorMark(report.adviserName) + `<span>${escape(releaseMeta(report))}</span>`;
    const modal = $('parent-report-modal');
    state.returnFocus = trigger;
    modal.hidden = false;
    modal.classList.add('open');
    document.body.classList.add('parent-report-dialog-open');
    modal.querySelector('[data-close-report]').focus();
    if (syncUrl) updateUrl(report.id);
    window.lucide?.createIcons?.();
  }

  function closeReport(syncUrl = true) {
    const modal = $('parent-report-modal');
    if (modal.hidden) return;
    modal.classList.remove('open');
    modal.hidden = true;
    document.body.classList.remove('parent-report-dialog-open');
    if (syncUrl) updateUrl();
    const focus = state.returnFocus?.isConnected ? state.returnFocus
      : $('parentReportChildSwitcher').querySelector('.child-card.active');
    state.returnFocus = null;
    focus?.focus?.();
  }

  async function selectChild(childId, reportId = null, syncUrl = false) {
    const child = state.children.find(item => item.studentId === String(childId));
    if (!child) return;
    closeReport(false);
    state.childId = child.studentId;
    const currentRequest = ++state.requestId;
    state.reports = [];
    renderChildren();
    $('parent-reports-content').hidden = true;
    $('parent-reports-empty').hidden = true;
    if (syncUrl) updateUrl();
    message('Loading shared reports…');
    try {
      const response = await api.request('/reports/parent/children/' + encodeURIComponent(child.studentId));
      if (currentRequest !== state.requestId) return;
      state.reports = response.reports || [];
      let linkedReport = null;
      let unavailable = false;
      if (reportId) {
        try {
          const detail = await api.request('/reports/parent/children/' +
            encodeURIComponent(child.studentId) + '/' + encodeURIComponent(reportId));
          if (currentRequest !== state.requestId) return;
          const index = state.reports.findIndex(report => report.id === detail.report.id);
          if (index >= 0) state.reports[index] = detail.report;
          linkedReport = detail.report;
        } catch (error) {
          if (error.status !== 404) throw error;
          unavailable = true;
        }
      }
      renderReports();
      if (linkedReport) openReport(linkedReport, null, false);
      else if (unavailable) {
        updateUrl();
        message('This report is unavailable.', true);
      }
    } catch (error) {
      if (currentRequest !== state.requestId) return;
      $('parent-reports-content').hidden = true;
      message(error.message || 'Shared reports could not be loaded.', true);
    }
  }

  async function init() {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const children = await api.getParentChildren();
      state.children = children.map(child => ({ ...child, studentId: String(child.studentId) }));
      renderChildren();
      if (!state.children.length) {
        message('');
        return;
      }
      const query = new URLSearchParams(window.location.search);
      const requestedChild = state.children.some(child => child.studentId === query.get('studentId'))
        ? query.get('studentId') : state.children[0].studentId;
      await selectChild(requestedChild, query.get('reportId'));
    } catch (error) { message(error.message || 'Linked children could not be loaded.', true); }
  }

  document.addEventListener('DOMContentLoaded', init);
  $('parentReportChildSwitcher').addEventListener('click', event => {
    const button = event.target.closest('[data-student-id]');
    if (button) selectChild(button.dataset.studentId, null, true);
  });
  $('parent-report-list').addEventListener('click', event => {
    const button = event.target.closest('[data-report-id]');
    const report = button && state.reports.find(item => item.id === button.dataset.reportId);
    if (report) openReport(report, button);
  });
  document.querySelectorAll('[data-close-report]').forEach(button => button.addEventListener('click', () => closeReport()));
  $('parent-report-modal').addEventListener('click', event => {
    if (event.target === $('parent-report-modal')) closeReport();
  });
  document.addEventListener('keydown', event => {
    const modal = $('parent-report-modal');
    if (modal.hidden) return;
    if (event.key === 'Escape') { closeReport(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...modal.querySelectorAll('button:not([disabled])')];
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
