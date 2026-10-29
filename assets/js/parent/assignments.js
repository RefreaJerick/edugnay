(function () {
  const element = id => document.getElementById(id);
  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(value ?? '');
  const empty = (icon, title, text) => window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon, title, text });
  const labels = { pending: 'Pending', submitted: 'Submitted', not_submitted: 'Not submitted' };
  const icons = { pending: 'clock-3', submitted: 'check-circle-2', not_submitted: 'x-circle' };
  const filters = [{ key: 'all', label: 'All' }, ...Object.keys(labels).map(key => ({ key, label: labels[key] }))];
  let children = [];
  let terms = [];
  let assignments = [];
  let history = [];
  let selectedChild = '';
  let selectedYear = '';
  let selectedTerm = '';
  let selectedStatus = 'all';
  let loading = true;
  let error = '';
  let requestId = 0;
  let lastDetailButton = null;

  function formatDate(value) {
    if (!value) return 'No due date';
    const date = String(value).slice(0, 10);
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderChildren() {
    if (loading && !children.length) {
      element('child-switcher').textContent = 'Loading linked children...';
      return;
    }
    if (error && !children.length) {
      element('child-switcher').textContent = '';
      return;
    }
    element('child-switcher').innerHTML = children.length ? children.map(child => `
      <div class="child-card ${String(child.studentId) === selectedChild ? 'active' : ''}" data-student-id="${escape(child.studentId)}" role="button" tabindex="0" aria-pressed="${String(child.studentId) === selectedChild}">
        ${window.EDUGNAY_AVATAR.html(child, { className: 'child-avatar', role: 'student' })}
        <div class="child-info"><div class="child-name">${escape(child.displayName || 'Student')}</div>
        <div class="child-section">${escape(child.gradeLevel || 'Unassigned')} – ${escape(child.sectionName || 'Unassigned')}</div></div>
      </div>`).join('') : empty('users', 'No linked children', 'Children linked to your account will appear here.');
    window.lucide?.createIcons();
  }

  function availableTerms() {
    const child = children.find(item => String(item.studentId) === selectedChild);
    if (!child?.schoolLevelId) return [];
    return terms.filter(term => String(term.schoolLevelId) === String(child.schoolLevelId)).sort((a, b) =>
      String(b.academicYearLabel || '').localeCompare(String(a.academicYearLabel || '')) ||
      Number(a.sequenceNumber || 0) - Number(b.sequenceNumber || 0));
  }

  function isElectiveAssignment(item) {
    return item.scopeType === 'elective' || item.electiveClassId != null;
  }

  function assignmentsForCurrentView() {
    return assignments.filter(item => String(item.academicTermId) === selectedTerm || isElectiveAssignment(item));
  }

  function latestTermInYear(yearTerms) {
    return [...yearTerms]
      .filter(term => term.status !== 'upcoming')
      .sort((a, b) => Number(b.sequenceNumber || 0) - Number(a.sequenceNumber || 0))[0] || null;
  }

  function latestSelectableTerm(available) {
    return [...available]
      .filter(term => term.status !== 'upcoming')
      .sort((a, b) => String(b.academicYearLabel || '').localeCompare(String(a.academicYearLabel || '')) ||
        Number(b.sequenceNumber || 0) - Number(a.sequenceNumber || 0))[0] || null;
  }

  function selectDefaultPeriod() {
    const available = availableTerms();
    const current = available.find(term => String(term.id) === selectedTerm && term.status !== 'upcoming')
      || available.find(term => term.status === 'active')
      || latestSelectableTerm(available);
    selectedYear = current ? String(current.academicYearId) : '';
    selectedTerm = current ? String(current.id) : '';
  }

  function selectPeriod(id) {
    const term = availableTerms().find(item => String(item.id) === String(id));
    if (term?.status === 'upcoming') return;
    selectedTerm = term ? String(term.id) : '';
    if (term) selectedYear = String(term.academicYearId);
  }

  function renderPeriodControls() {
    const available = availableTerms();
    const years = [...new Map(available.map(term => [String(term.academicYearId), term.academicYearLabel])).entries()];
    if (!years.some(([id]) => id === selectedYear)) selectedYear = years[0]?.[0] || '';
    const year = element('assignmentYearFilter');
    year.innerHTML = years.length ? years.map(([id, label]) => `<option value="${escape(id)}">${escape(label || 'School year')}</option>`).join('') : '<option value="">No school years</option>';
    year.value = selectedYear;
    year.disabled = !years.length || loading || Boolean(error);
    const period = element('assignmentPeriodFilter');
    const periods = available.filter(term => String(term.academicYearId) === selectedYear);
    period.innerHTML = periods.length ? periods.map(term => `<option value="${escape(term.id)}"${term.status === 'upcoming' ? ' disabled' : ''}>${escape(term.name)}</option>`).join('') : '<option value="">No grading periods</option>';
    period.value = selectedTerm;
    period.disabled = !periods.length || loading || Boolean(error);
    element('assignmentPeriodTabs').innerHTML = periods.map(term => {
      const active = String(term.id) === selectedTerm;
      const upcoming = term.status === 'upcoming';
      const unavailable = upcoming || loading || Boolean(error);
      const accessibleName = upcoming ? ` aria-label="${escape(term.name)}, not started"` : '';
      return `<button class="grade-tab ${active ? 'active' : ''}" type="button" role="tab"${unavailable ? ' aria-disabled="true" disabled' : ` data-academic-period-id="${escape(term.id)}"`} aria-selected="${active}"${accessibleName}><span>${escape(term.name)}</span>${upcoming ? '<i class="grade-tab-status-icon" data-lucide="lock" aria-hidden="true"></i>' : ''}</button>`;
    }).join('');
    window.lucide?.createIcons();
    const subjects = [...new Set(assignmentsForCurrentView().map(item => item.subjectName).filter(Boolean))].sort();
    const subject = element('assignmentSubjectFilter');
    const previous = subject.value;
    subject.innerHTML = '<option value="all">All subjects</option>' + subjects.map(name => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    subject.value = subjects.includes(previous) ? previous : 'all';
    subject.disabled = !subjects.length || loading || Boolean(error);
    element('assignmentSearch').disabled = loading || Boolean(error) || !selectedChild;
  }

  function renderFilters() {
    const inPeriod = assignmentsForCurrentView();
    element('assignmentFilters').innerHTML = filters.map(filter => {
      const count = filter.key === 'all' ? inPeriod.length : inPeriod.filter(item => item.submissionStatus === filter.key).length;
      return `<button class="filter-tab assignment-filter-tab ${selectedStatus === filter.key ? 'active' : ''}" type="button" data-status="${filter.key}" aria-pressed="${selectedStatus === filter.key}">${filter.label}<span class="assignment-filter-count">${count}</span></button>`;
    }).join('');
  }

  function renderList() {
    const list = element('assignmentList');
    if (loading) { list.innerHTML = empty('loader-circle', 'Loading assignments', 'Please wait while assignments are loaded.'); return; }
    if (error) {
      list.innerHTML = `<div class="parent-assignment-error">${empty('triangle-alert', 'Assignments unavailable', error)}<button class="top-btn secondary" type="button" id="assignmentRetry">Try again</button></div>`;
      element('assignmentRetry').addEventListener('click', loadPage);
      return;
    }
    if (!selectedChild) { list.innerHTML = empty('users', 'No linked children', 'Ask your school to link a student account to yours.'); return; }
    const periodAssignments = assignments.filter(item => !isElectiveAssignment(item) && String(item.academicTermId) === selectedTerm);
    const electiveAssignments = assignments.filter(isElectiveAssignment);
    if (!availableTerms().length && !electiveAssignments.length) { list.innerHTML = empty('calendar-x', 'No grading periods available', 'Grading periods for this student’s school level will appear here when configured.'); return; }
    if (!selectedTerm && !electiveAssignments.length) { list.innerHTML = empty('clipboard-check', 'No assignments yet', 'Published assignments will appear here when a grading period is available.'); return; }
    const inPeriod = periodAssignments.concat(electiveAssignments);
    if (!inPeriod.length) { list.innerHTML = empty('clipboard-check', 'No assignments in this grading period', 'There are no published assignments for this child in the selected period.'); return; }
    const search = element('assignmentSearch').value.trim().toLowerCase();
    const subject = element('assignmentSubjectFilter').value;
    const visible = inPeriod.filter(item =>
      (selectedStatus === 'all' || item.submissionStatus === selectedStatus)
      && (subject === 'all' || item.subjectName === subject)
      && (!search || `${item.title} ${item.subjectName} ${item.teacherName}`.toLowerCase().includes(search)));
    if (!visible.length) {
      list.innerHTML = empty('clipboard-check', 'No assignments found', 'Try another status, subject, or search term.');
      return;
    }
    function renderAssignmentRow(item) {
      const status = labels[item.submissionStatus] || labels.pending;
      const statusKey = labels[item.submissionStatus] ? item.submissionStatus : 'pending';
      const classContext = isElectiveAssignment(item)
        ? `Elective class${item.electiveClassName ? ` · ${escape(item.electiveClassName)}` : ''} · `
        : '';
      return `<article class="assignment-row">
        <div class="assignment-row-content"><h2 class="assignment-row-title">${escape(item.title)}</h2><div class="assignment-row-meta">${classContext}${escape(item.subjectName)} · Due ${escape(formatDate(item.dueDate))} · ${escape(item.teacherName)}</div></div>
        <div class="assignment-online-cell" data-label="Online submission"><span class="assignment-online-status ${item.onlineSubmissionEnabled ? 'available' : 'not-available'}">${item.onlineSubmissionEnabled ? 'Available' : 'Not available'}</span></div>
        <div class="assignment-status-cell" data-label="Status"><span class="assignment-status ${statusKey}"><i data-lucide="${icons[statusKey]}" style="width:12px;height:12px;"></i><span class="assignment-status-label">${status}</span></span></div>
        <div class="assignment-row-actions" data-label="Action"><button class="top-btn secondary parent-assignment-view" type="button" data-assignment-id="${escape(item.id)}" aria-label="View details for ${escape(item.title)}">View details</button></div>
      </article>`;
    }
    const visibleElectives = visible.filter(isElectiveAssignment);
    const visibleSectionAssignments = visible.filter(item => !isElectiveAssignment(item));
    list.innerHTML = visibleSectionAssignments.map(renderAssignmentRow).join('') +
      (visibleElectives.length ? `<div class="assignment-scope-heading">Elective class assignments</div>${visibleElectives.map(renderAssignmentRow).join('')}` : '');
    window.lucide?.createIcons();
  }

  function render() {
    renderChildren();
    renderPeriodControls();
    renderFilters();
    element('assignmentPanelSub').textContent = selectedChild
      ? `Showing assignments for ${children.find(child => String(child.studentId) === selectedChild)?.displayName || 'the selected student'}.`
      : 'Choose a linked student to view assignments.';
    renderList();
    renderHistory();
  }

  function renderHistory() {
    const panel = element('assignmentHistory');
    panel.hidden = loading || Boolean(error) || !history.length;
    if (panel.hidden) { panel.open = false; return; }
    element('assignmentHistoryCount').textContent = String(history.length);
    element('assignmentHistoryList').innerHTML = history.map(item => {
      const status = labels[item.submissionStatus] || labels.pending;
      return `<article class="assignment-row">
        <div class="assignment-row-content"><h2 class="assignment-row-title">${escape(item.title)}</h2><div class="assignment-row-meta">${escape(item.sectionName)} · ${escape(item.academicYearLabel)} · ${escape(item.academicTermName)} · ${escape(item.subjectName)}</div></div>
        <div class="assignment-status-cell" data-label="Status"><span class="assignment-status ${escape(item.submissionStatus)}">${escape(status)}</span></div>
        <div class="assignment-row-actions" data-label="Action"><button class="top-btn secondary parent-assignment-view" type="button" data-history-id="${escape(item.id)}">View details</button></div>
      </article>`;
    }).join('');
  }

  function closeDetail() {
    const modal = element('assignmentDetailModal');
    modal.classList.remove('open');
    modal.hidden = true;
    lastDetailButton?.focus();
    lastDetailButton = null;
  }

  function openDetail(id, button) {
    const item = button?.dataset.historyId
      ? history.find(assignment => String(assignment.id) === id)
      : assignments.find(assignment => String(assignment.id) === id);
    if (!item) return;
    lastDetailButton = button;
    element('assignmentDetailTitle').textContent = item.title || '—';
    element('assignmentDetailSubject').textContent = item.subjectName || '—';
    element('assignmentDetailTeacher').textContent = item.teacherName || '—';
    element('assignmentDetailDueDate').textContent = formatDate(item.dueDate);
    element('assignmentDetailStatus').textContent = labels[item.submissionStatus] || labels.pending;
    element('assignmentDetailSubmittedAt').textContent = item.submittedAt ? String(item.submittedAt).replace('T', ' ') : '—';
    element('assignmentDetailInstructions').textContent = item.description || 'No additional instructions were provided.';
    const modal = element('assignmentDetailModal');
    modal.hidden = false;
    modal.classList.add('open');
    element('assignmentDetailClose').focus();
  }

  async function loadChild(id) {
    const current = ++requestId;
    const childChanged = selectedChild !== id;
    selectedChild = id;
    if (childChanged) {
      selectedYear = '';
      selectedTerm = '';
      selectedStatus = 'all';
    }
    loading = true;
    error = '';
    assignments = [];
    history = [];
    closeDetail();
    render();
    try {
      const response = await window.EDUGNAY_API.getParentChildAssignments(id);
      if (current !== requestId) return;
      if (String(response?.studentId) !== id || !Array.isArray(response.assignments)) throw new Error('The assignment response is incomplete.');
      assignments = response.assignments;
      history = Array.isArray(response.history) ? response.history : [];
      selectDefaultPeriod();
    } catch (cause) {
      if (current !== requestId) return;
      error = cause.message || 'Assignments could not be loaded.';
    } finally {
      if (current === requestId) { loading = false; render(); }
    }
  }

  async function loadPage() {
    const current = ++requestId;
    loading = true;
    error = '';
    render();
    try {
      await window.EDUGNAY_SCHOOL_READY;
      if (!window.EDUGNAY_API?.isBackendAvailable) throw new Error('The school API is required to load assignments.');
      const [linked, schoolTerms] = await Promise.all([window.EDUGNAY_API.getParentChildren(), window.EDUGNAY_API.getAcademicTerms()]);
      if (current !== requestId) return;
      children = linked;
      terms = schoolTerms;
      if (!children.some(child => String(child.studentId) === selectedChild)) selectedChild = String(children[0]?.studentId || '');
      if (selectedChild) return loadChild(selectedChild);
      assignments = [];
      selectedYear = '';
      selectedTerm = '';
    } catch (cause) {
      if (current !== requestId) return;
      error = cause.message || 'Assignments could not be loaded.';
    } finally {
      if (current === requestId) { loading = false; render(); }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const childSwitcher = element('child-switcher');
    childSwitcher.addEventListener('click', event => {
      const card = event.target.closest('[data-student-id]');
      if (card && card.dataset.studentId !== selectedChild) loadChild(card.dataset.studentId);
    });
    childSwitcher.addEventListener('keydown', event => {
      const card = event.target.closest('[data-student-id]');
      if (!card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (card.dataset.studentId !== selectedChild) loadChild(card.dataset.studentId);
    });
    element('assignmentFilters').addEventListener('click', event => {
      const button = event.target.closest('[data-status]');
      if (button) { selectedStatus = button.dataset.status; renderFilters(); renderList(); }
    });
    element('assignmentYearFilter').addEventListener('change', event => {
      selectedYear = event.target.value;
      const yearTerms = availableTerms().filter(term => String(term.academicYearId) === selectedYear);
      selectPeriod(String(yearTerms.find(term => term.status === 'active')?.id || latestTermInYear(yearTerms)?.id || ''));
      renderPeriodControls(); renderFilters(); renderList();
    });
    element('assignmentPeriodFilter').addEventListener('change', event => { selectPeriod(event.target.value); renderPeriodControls(); renderFilters(); renderList(); });
    element('assignmentPeriodTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-academic-period-id]');
      if (!button) return;
      selectPeriod(button.dataset.academicPeriodId);
      renderPeriodControls(); renderFilters(); renderList();
    });
    element('assignmentSubjectFilter').addEventListener('change', renderList);
    element('assignmentSearch').addEventListener('input', renderList);
    element('assignmentList').addEventListener('click', event => {
      const button = event.target.closest('[data-assignment-id]');
      if (button) openDetail(button.dataset.assignmentId, button);
    });
    element('assignmentHistoryList').addEventListener('click', event => {
      const button = event.target.closest('[data-history-id]');
      if (button) openDetail(button.dataset.historyId, button);
    });
    element('assignmentDetailClose').addEventListener('click', closeDetail);
    element('assignmentDetailDone').addEventListener('click', closeDetail);
    element('assignmentDetailModal').addEventListener('click', event => { if (event.target === element('assignmentDetailModal')) closeDetail(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !element('assignmentDetailModal').hidden) closeDetail(); });
    loadPage();
  });
})();
