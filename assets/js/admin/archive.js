let archiveCandidates = [];
  let selectedArchiveCandidate = null;
  let currentConfirmCandidate = null;
  let archiveActionPending = false;
  let currentViewedArchiveId = null;
  let archiveExportPending = false;
  let viewArchiveRequest = 0;

  function escapeArchiveHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function formatArchiveCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatArchivePercent(value, unavailableLabel = 'Not available') {
    return value === null || value === undefined || !Number.isFinite(Number(value))
      ? unavailableLabel
      : `${Number(value)}%`;
  }

  function formatArchiveDate(value) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
  }

  function showArchivePageMessage(message) {
    const element = document.getElementById('archivePageMessage');
    if (!element) return;
    element.textContent = message || '';
    element.style.display = message ? 'block' : 'none';
    element.setAttribute('role', 'alert');
  }

  function renderArchiveSummary(summary = {}) {
    const grid = document.getElementById('archive-summary-cards');
    const years = Array.isArray(summary.archivedYearsList) ? summary.archivedYearsList : [];
    if (!grid) return;
    const cards = [
      { tone: 'blue', icon: 'archive', value: formatArchiveCount(summary.archivedYears), label: 'Archived Years', sub: years.length ? `S.Y. ${years[years.length - 1]} to ${years[0]}` : 'No archived years' },
      { tone: 'gold', icon: 'users', value: formatArchiveCount(summary.students), label: 'Archived Students', sub: 'Across archived school years' },
      { tone: 'green', icon: 'door-open', value: formatArchiveCount(summary.sections), label: 'Archived Sections', sub: 'Across archived school years' },
      { tone: 'gray', icon: 'trending-up', value: formatArchivePercent(summary.averagePassRate, '—'), label: 'Avg Pass Rate', sub: 'Based on published final grades' }
    ];
    grid.innerHTML = cards.map(card => `<div class="stat-card ${card.tone}"><div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${card.icon}" style="width:18px;height:18px;"></i></div></div><div class="stat-card-num">${escapeArchiveHtml(card.value)}</div><div class="stat-card-label">${card.label}</div><div class="stat-card-sub">${escapeArchiveHtml(card.sub)}</div></div>`).join('');
  }

  function renderArchivePeriodRows(periods = []) {
    if (!periods.length) return '<div class="quarter-date">No grading-period records.</div>';
    return periods.map(period => {
      const rate = period.passRate === null || period.passRate === undefined ? null : Math.max(0, Math.min(100, Number(period.passRate)));
      const width = Number.isFinite(rate) ? rate : 0;
      return `<div class="quarter-row"><span class="quarter-label">${escapeArchiveHtml(period.label)}</span><div class="quarter-bar-wrap"><div class="quarter-bar"><div class="quarter-fill" style="width:${width}%;"></div></div><span class="quarter-pass">${escapeArchiveHtml(formatArchivePercent(rate))}</span></div><span class="quarter-date">${escapeArchiveHtml(period.period)}</span></div>`;
    }).join('');
  }

  function renderArchiveYears(years = []) {
    const list = document.getElementById('archive-year-list');
    if (!list) return;
    if (!years.length) {
      list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'archive', title: 'No archived school years', text: 'Archived records will appear here after a school year is archived.' });
      return;
    }
    list.innerHTML = years.map((year, index) => `
      <div class="archive-year-card ${index ? 'collapsed' : ''}" data-year="${Number(year.id)}">
        <div class="ayc-head" data-page-click="g0a2eca9145b1"><div class="ayc-icon"><i data-lucide="archive" style="width:18px;height:18px;"></i></div><div class="ayc-info"><div class="ayc-title">S.Y. ${escapeArchiveHtml(year.label)}</div><div class="ayc-meta">Archived on ${escapeArchiveHtml(formatArchiveDate(year.archivedAt))} · By ${escapeArchiveHtml(year.archivedBy || 'Unavailable')}</div></div><div class="ayc-right">${index === 0 ? '<span class="badge badge-blue">Latest</span>' : ''}${index === years.length - 1 ? '<span class="badge badge-gray">Oldest</span>' : ''}<span class="badge badge-green"><i data-lucide="check-circle" style="width:10px;height:10px;"></i> Complete</span><div class="collapse-arrow"><i data-lucide="chevron-down" style="width:14px;height:14px;"></i></div></div></div>
        <div class="ayc-body"><div class="ayc-stats"><div class="ayc-stat"><div class="ayc-stat-num">${formatArchiveCount(year.students)}</div><div class="ayc-stat-label">Students</div></div><div class="ayc-stat"><div class="ayc-stat-num">${formatArchiveCount(year.sections)}</div><div class="ayc-stat-label">Sections</div></div><div class="ayc-stat"><div class="ayc-stat-num">${formatArchiveCount(year.teachers)}</div><div class="ayc-stat-label">Teachers</div></div></div><div class="ayc-quarters"><div class="ayc-quarters-title">Grading-period Pass Rates</div><div class="quarter-rows">${renderArchivePeriodRows(year.academicPeriods || [])}</div></div><div class="ayc-footer"><div class="ayc-footer-info"><i data-lucide="lock" style="width:11px;height:11px;"></i> Read-only · No changes allowed</div><div class="ayc-footer-actions"><button class="footer-btn export" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { exportArchivePdf(Number(year.id), this) })}"><i data-lucide="download" style="width:11px;height:11px;"></i> Export PDF</button><button class="footer-btn view" type="button" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { openViewModal((Number(year.id))) })}"><i data-lucide="eye" style="width:11px;height:11px;"></i> View Data</button></div></div></div>
      </div>`).join('');
  }

  function renderArchiveChecklist(candidate = null) {
    const list = document.getElementById('archive-checklist');
    if (!list) return;
    if (!candidate) { list.innerHTML = ''; return; }
    const checks = [
      [candidate.yearClosed, 'School year is closed'],
      [candidate.hasTermsForEachLevel, 'Grading periods exist for every enabled school level'],
      [candidate.allTermsClosed, 'All grading periods are closed']
    ];
    list.innerHTML = checks.map(([complete, label]) => `<div class="check-item ${complete ? 'done' : 'warn'}"><div class="check-icon-wrap"><i data-lucide="${complete ? 'check' : 'circle-alert'}" style="width:12px;height:12px;"></i></div><span class="check-text">${label}</span></div>`).join('');
    if (window.lucide) window.lucide.createIcons();
  }

  function setArchiveToggle(isOn) {
    const toggle = document.getElementById('archiveToggle');
    if (!toggle) return;
    toggle.classList.toggle('on', Boolean(isOn));
    toggle.setAttribute('aria-checked', String(Boolean(isOn)));
    updateArchiveControls();
  }

  function updateArchiveControls() {
    const button = document.getElementById('archiveNowBtn');
    const enabled = Boolean(selectedArchiveCandidate?.canArchive && document.getElementById('archiveToggle')?.classList.contains('on') && !archiveActionPending);
    if (button) {
      button.disabled = !enabled;
      button.classList.toggle('enabled', enabled);
      button.classList.toggle('disabled', !enabled);
    }
  }

  async function loadArchiveData(options = {}) {
    try {
      const response = await window.EDUGNAY_API.getArchive();
      const archivedYears = response.archivedYears || [];
      renderArchiveSummary({ ...response.summary, archivedYearsList: archivedYears.map(year => year.label) });
      renderArchiveYears(archivedYears);
      archiveCandidates = response.archiveCandidates || [];
      const select = document.getElementById('archiveYearSelect');
      select.disabled = false;
      select.innerHTML = '<option value="">Select a closed school year</option>' + archiveCandidates.map(year => `<option value="${Number(year.id)}">S.Y. ${escapeArchiveHtml(year.label)}${year.canArchive ? '' : ' — not ready'}</option>`).join('');
      if (!archiveCandidates.length) select.innerHTML = '<option value="">No closed school years available</option>';
      selectedArchiveCandidate = null;
      select.value = '';
      archiveYearChanged();
      document.getElementById('archive-list-subtitle').textContent = `${archivedYears.length} archived school year${archivedYears.length === 1 ? '' : 's'} · Records are read-only.`;
      showArchivePageMessage('');
      if (window.lucide) window.lucide.createIcons();
    } catch (error) {
      if (!options.keepMessage) {
        const select = document.getElementById('archiveYearSelect');
        select.disabled = true;
        select.innerHTML = '<option value="">Archive data could not be loaded</option>';
      }
      if (!options.keepMessage) showArchivePageMessage(error.message || 'Could not load archive data.');
      throw error;
    }
  }

  function archiveYearChanged() {
    const yearId = Number(document.getElementById('archiveYearSelect').value);
    selectedArchiveCandidate = archiveCandidates.find(year => Number(year.id) === yearId) || null;
    setArchiveToggle(false);
    const summary = document.getElementById('archiveYearSummary');
    const readinessText = document.getElementById('archiveReadinessText');
    if (!selectedArchiveCandidate) {
      summary.value = 'Select a closed school year to view its saved records.';
      readinessText.textContent = 'Choose a closed school year to check its grading periods.';
      renderArchiveChecklist();
    } else {
      const year = selectedArchiveCandidate;
      summary.value = `${year.termCount} grading period${year.termCount === 1 ? '' : 's'} · ${year.unfinishedTerms} still open`;
      readinessText.textContent = year.canArchive ? 'This school year meets the archive requirements.' : year.message;
      renderArchiveChecklist(year);
    }
    updateArchiveControls();
  }

  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.addEventListener('click', event => { if (event.target === modal && !archiveActionPending) modal.classList.remove('open'); });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !archiveActionPending) document.querySelectorAll('.modal-backdrop.open').forEach(modal => modal.classList.remove('open'));
    if (event.target.id === 'archiveToggle' && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      toggleArchive();
    }
  });

  function toggleCard(head) { head.closest('.archive-year-card')?.classList.toggle('collapsed'); }

  async function openViewModal(yearId) {
    const requestId = ++viewArchiveRequest;
    const errorBox = document.getElementById('viewArchiveError');
    currentViewedArchiveId = null;
    document.getElementById('viewArchiveExportButton').disabled = true;
    errorBox.textContent = '';
    errorBox.style.display = 'none';
    document.getElementById('viewModalTitle').textContent = 'Archived school year';
    document.getElementById('viewSectionsBody').innerHTML = '';
    document.getElementById('viewQuartersBody').innerHTML = '';
    openModal('viewModal');
    try {
      const response = await window.EDUGNAY_API.getArchivedYear(yearId);
      if (requestId !== viewArchiveRequest) return;
      const archive = response.archive;
      currentViewedArchiveId = Number(archive.id);
      document.getElementById('viewArchiveExportButton').disabled = archiveExportPending;
      document.getElementById('viewModalTitle').textContent = `S.Y. ${archive.label}: Archive`;
      document.getElementById('viewStatStudents').textContent = formatArchiveCount(archive.students);
      document.getElementById('viewStatTeachers').textContent = formatArchiveCount(archive.teachers);
      document.getElementById('viewStatSections').textContent = formatArchiveCount(archive.sections);
      document.getElementById('viewStatPassRate').textContent = formatArchivePercent(archive.passRate);
      document.getElementById('viewStatAttendance').textContent = formatArchivePercent(archive.attendanceRate);
      const sections = archive.sectionsTable || [];
      document.getElementById('viewSectionsBody').innerHTML = sections.length ? sections.map(section => `<tr><td>${escapeArchiveHtml(section.name)}</td><td>${escapeArchiveHtml(section.grade)}</td><td>${formatArchiveCount(section.students)}</td><td>${escapeArchiveHtml(formatArchivePercent(section.passRate))}</td></tr>`).join('') : '<tr><td colspan="4">No section records.</td></tr>';
      const periods = archive.academicPeriods || [];
      document.getElementById('viewQuartersBody').innerHTML = periods.length ? periods.map(period => `<tr><td>${escapeArchiveHtml(period.label)}</td><td>${escapeArchiveHtml(period.period)}</td><td>${escapeArchiveHtml(formatArchivePercent(period.passRate))}</td></tr>`).join('') : '<tr><td colspan="3">No grading-period records.</td></tr>';
      if (window.lucide) window.lucide.createIcons();
    } catch (error) {
      if (requestId !== viewArchiveRequest) return;
      errorBox.textContent = error.message || 'Could not load this archived school year.';
      errorBox.style.display = 'block';
    }
  }

  async function exportArchivePdf(yearId, button) {
    if (archiveExportPending || !Number.isSafeInteger(Number(yearId)) || Number(yearId) < 1) return;
    archiveExportPending = true;
    if (button) button.disabled = true;
    const errorBox = document.getElementById('viewArchiveError');
    if (button?.id === 'viewArchiveExportButton') {
      errorBox.textContent = '';
      errorBox.style.display = 'none';
    }
    try {
      const file = await window.EDUGNAY_API.requestFile(`/archive/academic-years/${Number(yearId)}/export.pdf`);
      const url = URL.createObjectURL(new Blob([file.buffer], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName || `school-year-archive-${Number(yearId)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const message = error.message || 'The archive PDF could not be downloaded.';
      if (button?.id === 'viewArchiveExportButton') {
        errorBox.textContent = message;
        errorBox.style.display = 'block';
      } else {
        showAppToast(message, 'error');
      }
    } finally {
      archiveExportPending = false;
      if (button) button.disabled = false;
      document.getElementById('viewArchiveExportButton').disabled = !currentViewedArchiveId;
    }
  }

  function openConfirmModal() {
    if (!selectedArchiveCandidate?.canArchive || !document.getElementById('archiveToggle').classList.contains('on')) return;
    currentConfirmCandidate = selectedArchiveCandidate;
    const phrase = `ARCHIVE ${currentConfirmCandidate.label}`;
    document.getElementById('confirmYearLabel').textContent = `S.Y. ${currentConfirmCandidate.label}`;
    document.getElementById('confirmRequiredText').textContent = phrase;
    document.getElementById('confirmInput').placeholder = phrase;
    document.getElementById('confirmInput').value = '';
    document.getElementById('archiveError').textContent = '';
    document.getElementById('archiveError').style.display = 'none';
    checkConfirmInput();
    openModal('confirmModal');
  }

  function checkConfirmInput() {
    const input = document.getElementById('confirmInput');
    const button = document.getElementById('confirmArchiveBtn');
    const phrase = currentConfirmCandidate ? `ARCHIVE ${currentConfirmCandidate.label}` : '';
    button.disabled = archiveActionPending || !phrase || input.value.trim() !== phrase;
  }

  async function finalizeArchive() {
    if (!currentConfirmCandidate || archiveActionPending) return;
    checkConfirmInput();
    const button = document.getElementById('confirmArchiveBtn');
    if (button.disabled) return;
    archiveActionPending = true;
    button.disabled = true;
    button.textContent = 'Archiving…';
    document.getElementById('confirmInput').disabled = true;
    document.getElementById('archiveError').style.display = 'none';
    updateArchiveControls();
    try {
      const result = await window.EDUGNAY_API.archiveAcademicYear(currentConfirmCandidate.id);
      closeModal('confirmModal');
      setArchiveToggle(false);
      showAppToast(result.message || 'School year archived successfully.');
      currentConfirmCandidate = null;
      try {
        await loadArchiveData({ keepMessage: true });
      } catch {
        showAppToast(`${result.message || 'School year archived successfully.'} Reload the page to refresh the archive list.`, 'info');
      }
    } catch (error) {
      const errorBox = document.getElementById('archiveError');
      errorBox.textContent = error.message || 'The school year could not be archived.';
      errorBox.style.display = 'block';
    } finally {
      archiveActionPending = false;
      button.innerHTML = '<i data-lucide="archive" style="width:13px;height:13px;"></i> Yes, Archive Now';
      document.getElementById('confirmInput').disabled = false;
      checkConfirmInput();
      updateArchiveControls();
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function toggleArchive() {
    if (!selectedArchiveCandidate?.canArchive || archiveActionPending) return;
    setArchiveToggle(!document.getElementById('archiveToggle').classList.contains('on'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadArchiveData().catch(() => {}).finally(() => window.EDUGNAY_PAGE_LOADING.ready());
    if (window.lucide) window.lucide.createIcons();
  });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pfd904b33f16d: function(event) { archiveYearChanged() },
  },
  click: {
    p7f0e398ceb90: function(event) { finalizeArchive() },
    p9641ec64fb46: function(event) { toggleArchive() },
    pa5aab93fb529: function(event) { closeModal('viewModal') },
    p_archive_export: function(event) { exportArchivePdf(currentViewedArchiveId, this) },
    pa990e6d2fd54: function(event) { closeModal('confirmModal') },
    pd55546e4bf69: function(event) { openConfirmModal() },
  },
  input: {
    p9cd68f303e81: function(event) { checkConfirmInput() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g0a2eca9145b1: function(event) { toggleCard(this) },
  },
});
