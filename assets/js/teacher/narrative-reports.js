(() => {
  const api = window.EDUGNAY_API;
  const $ = id => document.getElementById(id);
  const escape = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const state = { sections: [], evidence: null, reports: [], settings: null,
    generationEnabled: false, generationSwitchEnabled: false, aiEvidenceApproved: false, reportsEnabled: false,
    releaseEnabled: false, selectedReportId: null, busy: false, regenerateConfirmOpen: false, modalReturnFocus: new Map() };

  function addDays(date, count) {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + count);
    return value.toISOString().slice(0, 10);
  }

  function weekday(date) {
    return new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
  }

  function schoolToday() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${date.year}-${date.month}-${date.day}`;
  }

  function weekOptions(settings, section, today = schoolToday()) {
    const anchor = section.academicYearEndDate && section.academicYearEndDate < today
      ? [addDays(section.academicYearEndDate, 7), today].sort()[0] : today;
    const first = addDays(anchor, -((weekday(anchor) - settings.weekStartDay + 7) % 7));
    const span = (settings.weekEndDay - settings.weekStartDay + 7) % 7;
    return Array.from({ length: 13 }, (_, index) => {
      const startDate = addDays(first, -7 * index);
      return { startDate, endDate: addDays(startDate, span) };
    }).filter(week => week.startDate <= today &&
      (!section.academicYearStartDate || section.academicYearStartDate <= today) &&
      (!section.academicYearStartDate || week.endDate >= section.academicYearStartDate) &&
      (!section.academicYearEndDate || week.startDate <= section.academicYearEndDate));
  }

  function populateWeeks() {
    const section = state.sections.find(item => item.id === $('report-section').value);
    const weeks = section ? weekOptions(state.settings, section) : [];
    const today = schoolToday();
    $('report-week').innerHTML = weeks.map(option => `<option value="${option.startDate}">${escape(formatDate(option.startDate))}–${escape(formatDate(option.endDate))}${option.endDate >= today ? ' · In progress' : ''}</option>`).join('');
    $('report-week').disabled = !weeks.length;
    if (!weeks.length) {
      $('report-week-notice').hidden = true;
      state.evidence = null;
      state.reports = [];
      $('week-caption').textContent = 'No report week available.';
      renderCounts();
      renderEmptyState('calendar-days', 'No report week available', 'No report week is available for this academic year.');
      setGenerationButtonState(true, 'No report week is available for generation.');
    }
  }

  function setGenerationButtonState(disabled, reason = '') {
    const button = $('open-generation');
    button.disabled = disabled;
    button.title = reason;
    button.setAttribute('aria-label', reason ? `Generate Reports unavailable: ${reason}` : 'Generate Reports');
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
  }

  function setMessage(id, value, error = false) {
    const node = $(id);
    node.textContent = value || '';
    node.hidden = !value;
    node.classList.toggle('is-error', error);
  }

  function renderEmptyState(icon, title, text) {
    $('reports-grid').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon, title, text });
    setMessage('reports-message', '');
    window.lucide?.createIcons?.();
  }

  function openModal(id) {
    const modal = $(id);
    if (!modal.classList.contains('open')) state.modalReturnFocus.set(id, document.activeElement);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('report-modal-open');
    modal.querySelector('button, input, textarea')?.focus();
  }

  function closeModal(id, force = false) {
    if (state.busy && !force) return;
    const modal = $(id);
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-backdrop.open')) document.body.classList.remove('report-modal-open');
    if (id === 'review-modal') state.selectedReportId = null;
    const returnFocus = state.modalReturnFocus.get(id);
    state.modalReturnFocus.delete(id);
    if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();
    else $('report-section').focus();
  }

  function reportFor(studentId) {
    return state.reports.find(report => report.studentId === studentId);
  }

  function studentInitials(student) {
    return student.initials || student.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  }

  function candidateReasonText(reason) {
    if (reason.type === 'absence') {
      const kind = reason.includesExcused ? 'recorded subject absence, including excused' : 'recorded unexcused subject absence';
      return `${reason.count} dates with a ${kind} (threshold: ${reason.threshold}).`;
    }
    if (reason.type === 'consecutive') {
      return `${reason.count} consecutive missed ${reason.subject || 'subject'} meeting dates (threshold: ${reason.threshold}).`;
    }
    if (reason.type === 'grade') {
      return `Published ${reason.subject} grade ${reason.grade}${reason.term ? ` in ${reason.term}` : ''} (passing threshold: ${reason.threshold}).`;
    }
    if (reason.type === 'low_scores') return `${reason.subject}: three scored activities below 75% this report week.`;
    return '';
  }

  function renderCounts() {
    const reports = state.reports;
    $('count-total').textContent = reports.length;
    $('count-drafts').textContent = reports.filter(report => report.status === 'draft').length;
    $('count-confirmed').textContent = reports.filter(report => report.status === 'confirmed').length;
    $('count-follow-up').textContent = reports.filter(report => report.status === 'confirmed' && report.isAtRisk).length;
  }

  function renderCards() {
    if (!state.evidence) return;
    const students = state.evidence.students || [];
    if (!students.length) {
      renderEmptyState('users-round', 'No learners in this section', 'Learners enrolled in this section will appear here.');
      return;
    }
    const search = $('report-search').value.trim().toLowerCase();
    const filter = $('report-status').value;
    const visible = students.filter(student => {
      const report = reportFor(student.id);
      return student.displayName.toLowerCase().includes(search) &&
        (filter === 'all' || filter === 'missing' && !report || report?.status === filter);
    });
    $('reports-grid').innerHTML = visible.map(student => {
      const report = reportFor(student.id);
      const status = report?.pendingCorrection
        ? report.status === 'confirmed' ? 'Correction confirmed · not sent' : 'Correction draft'
        : report?.releasedAt ? 'Released to parents'
          : report?.status === 'confirmed' ? 'Confirmed · not sent' : report ? 'Needs review' : 'No draft';
      const statusTone = report?.pendingCorrection ? report.status === 'confirmed' ? 'gold' : 'orange'
        : report?.releasedAt ? 'green' : report?.status === 'confirmed' ? 'gold' : report ? 'orange' : 'gray';
      const summary = report ? report.editedSummary || report.generatedSummary : 'A weekly draft has not been generated for this learner.';
      const initials = studentInitials(student);
      const avatar = window.EDUGNAY_AVATAR?.html?.(student, { role: 'student', size: 'compact', className: 'report-card-avatar' })
        || `<span class="person-avatar person-avatar--compact report-card-avatar" data-avatar-tone="green" aria-hidden="true">${escape(initials)}</span>`;
      const hasAttendanceRecords = Number(student.attendance.recordedSessions) > 0;
      const absences = Number(student.attendance.absent) || 0;
      const attendance = hasAttendanceRecords
        ? `${absences} absence${absences === 1 ? '' : 's'} · ${student.attendance.recordedSessions} recorded sessions`
        : 'No confirmed attendance records';
      const assignmentTotal = Number(student.assignments.total) || 0;
      const assignmentMetric = assignmentTotal
        ? `<strong class="rc-metric-val">${escape(student.assignments.submitted)}/${escape(assignmentTotal)}</strong><div class="rc-metric-label">Assignments</div>`
        : '<strong class="rc-metric-val">—</strong><div class="rc-metric-label">Assignments</div><div class="rc-metric-detail">No assignments due</div>';
      const journalApplicable = state.evidence.section.journalApplicable === true;
      return `<article class="report-card${report?.isAtRisk ? ' at-risk' : ''}">
        <div class="report-card-head">${avatar}<div class="report-card-identity"><strong class="report-card-name">${escape(student.displayName)}</strong><span class="report-card-meta">${escape(state.evidence.section.gradeLevel)} · ${escape(state.evidence.section.name)}</span></div>${report?.isAtRisk ? '<span class="at-risk-flag">Adviser follow-up</span>' : ''}</div>
        <div class="report-card-metrics${journalApplicable ? '' : ' without-journal'}"><div class="rc-metric wide${hasAttendanceRecords ? ' has-records' : ''}"><strong class="rc-metric-val">${hasAttendanceRecords ? escape(absences) : '—'}</strong><span class="rc-metric-label"> Absences</span><div class="rc-metric-detail">${escape(attendance)}</div></div>
          <div class="rc-metric">${assignmentMetric}</div>
          ${journalApplicable ? `<div class="rc-metric"><strong class="rc-metric-val">${escape(student.journal.entries.length)}</strong><div class="rc-metric-label">Journal</div></div>` : ''}</div>
        <div class="report-card-excerpt"><div class="excerpt-label"><i data-lucide="sparkles"></i> Report summary</div><p class="excerpt-text${report ? '' : ' pending'}">${escape(summary)}</p></div>
        <div class="report-card-foot"><span class="badge badge-${statusTone} report-card-status">${escape(status)}</span>${report ? `<button class="btn-sm ghost report-card-review" type="button" data-review-id="${escape(report.id)}"><i data-lucide="eye" aria-hidden="true"></i> Review</button>` : ''}</div></article>`;
    }).join('');
    window.EDUGNAY_AVATAR?.hydrate?.($('reports-grid'));
    if (!visible.length) {
      renderEmptyState('user-round-search', 'No matching learners', 'Try changing your search or status filter.');
      return;
    }
    setMessage('reports-message', '');
    window.lucide?.createIcons?.();
  }

  async function loadWeek() {
    const sectionId = $('report-section').value;
    const startDate = $('report-week').value;
    if (!sectionId || !startDate) return;
    $('report-week-notice').hidden = true;
    state.evidence = null;
    state.reports = [];
    $('reports-grid').innerHTML = '';
    setGenerationButtonState(true, 'Loading the selected week.');
    $('week-caption').textContent = 'Loading selected week…';
    renderCounts();
    setMessage('reports-message', 'Loading weekly evidence and drafts…');
    try {
      const query = `sectionId=${encodeURIComponent(sectionId)}&startDate=${encodeURIComponent(startDate)}`;
      const [evidence, drafts] = await Promise.all([
        api.request(`/reports/weekly-evidence?${query}`), api.request(`/reports/weekly-drafts?${query}`)
      ]);
      if ($('report-section').value !== sectionId || $('report-week').value !== startDate) return;
      state.evidence = evidence;
      state.reports = drafts.reports || [];
      const label = `${formatDate(evidence.reportWeek.startDate)}–${formatDate(evidence.reportWeek.endDate)}`;
      $('pipeline-context').textContent = `${evidence.section.gradeLevel} · ${evidence.section.name} · Across all subjects`;
      const inProgress = evidence.reportWeek.endDate >= schoolToday();
      const notice = $('report-week-notice');
      notice.hidden = false;
      notice.querySelector('span').textContent = inProgress
        ? 'This report week is still in progress. A report generated now uses records available so far. For a more complete report, generate it after the week ends.'
        : 'This report week has ended. Review the reports below before confirming or releasing them to parents.';
      $('week-caption').textContent = inProgress
        ? `${label} · In progress · Evidence through ${formatDate(evidence.reportWeek.dataThroughDate)}`
        : label;
      renderCounts();
      renderCards();
      updateGenerationControl();
    } catch (error) {
      setMessage('reports-message', error.message || 'Weekly reports could not be loaded.', true);
      setGenerationButtonState(true, 'Weekly report data could not be loaded.');
    }
  }

  function generationCandidates() {
    return (state.evidence?.students || []).filter(student => !reportFor(student.id));
  }

  function updateGenerationControl() {
    const candidates = generationCandidates();
    const hasLearners = Boolean(state.evidence?.students?.length);
    const blockers = [
      !state.reportsEnabled && 'Narrative Reports are off',
      !state.aiEvidenceApproved && 'school AI approval is missing',
      !state.generationSwitchEnabled && 'the server has paused AI generation'
    ].filter(Boolean);
    const reason = !state.evidence
      ? ''
      : !state.generationEnabled
        ? `AI generation is paused: ${blockers.join('; ')}.`
        : !hasLearners
          ? 'No learners are available for this section and week.'
          : !candidates.length
            ? 'Every learner already has a draft or confirmed report.'
            : '';
    setGenerationButtonState(!state.evidence || !state.generationEnabled || !hasLearners || !candidates.length, reason);
  }

  function showGeneration() {
    const candidates = generationCandidates();
    if (state.busy || !state.generationEnabled || !candidates.length) return;
    $('gen-subtitle').textContent = `${state.evidence.section.gradeLevel} · ${state.evidence.section.name} · ${candidates.length} learner${candidates.length === 1 ? '' : 's'} without drafts`;
    $('gen-count').textContent = `${candidates.length} learners`;
    const list = $('gen-students');
    list.replaceChildren();
    for (const student of candidates) {
      const row = document.createElement('div');
      row.className = 'gen-student-note-row';
      const head = document.createElement('div');
      head.className = 'gen-student-note-head';
      const identity = document.createElement('div');
      identity.className = 'gen-student-note-copy';
      const name = document.createElement('strong');
      name.className = 'gen-student-note-name';
      name.textContent = student.displayName;
      const grade = document.createElement('span');
      grade.className = 'gen-student-note-grade';
      grade.textContent = state.evidence.section.gradeLevel;
      identity.append(name, grade);
      const optional = document.createElement('span');
      optional.textContent = 'Optional';
      head.append(identity, optional);
      const note = document.createElement('textarea');
      note.className = 'teacher-note-input';
      note.placeholder = 'Add a relevant classroom observation…';
      note.maxLength = 1000;
      note.dataset.studentId = student.id;
      note.setAttribute('aria-label', `Optional teacher note for ${student.displayName}`);
      const meta = document.createElement('div');
      meta.className = 'gen-student-note-meta';
      const visibility = document.createElement('span');
      visibility.textContent = 'Visible to teachers only';
      const counter = document.createElement('span');
      counter.textContent = '0/1000';
      note.addEventListener('input', () => { counter.textContent = `${note.value.length}/1000`; });
      meta.append(visibility, counter);
      row.append(head, note, meta);
      list.append(row);
    }
    setGenerationLoading(false);
    setMessage('gen-message', !state.generationEnabled
      ? 'Live AI generation is disabled. No learner data will be sent to OpenAI until the school enables it.'
      : !candidates.length ? 'Every learner already has a draft or confirmed report.' : '');
    openModal('gen-modal');
  }

  function setGenerationLoading(loading) {
    const modal = $('gen-modal');
    const dialog = modal.querySelector('[role="dialog"]');
    modal.classList.toggle('is-generating', loading);
    $('gen-progress').hidden = !loading;
    if (!loading) $('gen-progress-detail').textContent = '';
    $('start-generation-label').textContent = loading ? 'Generating...' : 'Start Generation';
    $('start-generation').disabled = loading || !state.generationEnabled || !generationCandidates().length;
    $('start-generation').setAttribute('aria-busy', String(loading));
    $('gen-close').disabled = loading;
    $('gen-students').querySelectorAll('textarea').forEach(note => { note.disabled = loading; });
    dialog.setAttribute('aria-labelledby', loading ? 'gen-loading-title' : 'gen-title');
    dialog.setAttribute('aria-busy', String(loading));
    if (loading) dialog.focus();
  }

  async function generate() {
    if (state.busy || !state.generationEnabled) return;
    const candidates = generationCandidates();
    if (!candidates.length) return;
    const notes = Object.fromEntries([...$('gen-students').querySelectorAll('textarea')].map(node => [node.dataset.studentId, node.value]));
    state.busy = true;
    setGenerationLoading(true);
    setMessage('gen-message', '');
    let generated = 0;
    const failed = [];
    try {
      for (let index = 0; index < candidates.length; index += 5) {
        const batch = candidates.slice(index, index + 5);
        $('gen-progress-detail').textContent = batch.length === 1
          ? `Processing learner ${index + 1} of ${candidates.length}.`
          : `Processing learners ${index + 1}–${index + batch.length} of ${candidates.length}.`;
        try {
          const result = await api.request('/reports/weekly-drafts/generate', {
            method: 'POST', body: JSON.stringify({
              sectionId: state.evidence.section.id, startDate: state.evidence.reportWeek.startDate,
              studentIds: batch.map(student => Number(student.id)),
              notesByStudent: Object.fromEntries(batch.map(student => [student.id, notes[student.id] || '']))
            })
          });
          generated += result.progress.generated;
          result.results.filter(item => item.status !== 'generated').forEach(item => failed.push(`${batch.find(student => student.id === item.studentId)?.displayName || 'Learner'}: ${item.message || item.reason || item.status}`));
        } catch (error) {
          batch.forEach(student => failed.push(`${student.displayName}: ${error.message || 'Generation failed'}`));
          if (error.status === 503) break;
        }
      }
      await loadWeek();
      setMessage('gen-message', `${generated} draft${generated === 1 ? '' : 's'} generated.${failed.length ? ` ${failed.length} could not be generated: ${failed.join('; ')}` : ' Review each draft before confirmation.'}`, Boolean(failed.length));
      if (generated) showAppToast(`${generated} draft${generated === 1 ? '' : 's'} generated.${failed.length ? ' Some learners could not be generated.' : ''}`);
    } catch (error) {
      setMessage('gen-message', error.message || 'Report generation could not be completed.', true);
    } finally {
      state.busy = false;
      setGenerationLoading(false);
      const focusTarget = $('start-generation').disabled ? $('gen-close') : $('start-generation');
      focusTarget.focus();
    }
  }

  function appendAction(value = '', disabled = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'recommended-action-row';
    const textarea = document.createElement('textarea');
    textarea.className = 'recommended-action-input';
    textarea.maxLength = 300;
    textarea.value = value;
    textarea.disabled = disabled;
    textarea.setAttribute('aria-label', 'Recommended action for parent');
    const remove = document.createElement('button');
    remove.className = 'recommended-action-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove action');
    remove.disabled = disabled;
    remove.addEventListener('click', () => { wrapper.remove(); updateAddAction(); });
    wrapper.append(textarea, remove);
    $('review-actions').append(wrapper);
    updateAddAction();
  }

  function updateAddAction() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    $('add-action').disabled = report?.status !== 'draft' || $('review-actions').children.length >= 3;
  }

  function updateRegenerateButton() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    $('regenerate-report').disabled = !report || report.status !== 'draft' || Boolean(report.releasedAt) ||
      !state.generationEnabled || state.busy || state.regenerateConfirmOpen;
  }

  function setRegenerateConfirmation(open) {
    state.regenerateConfirmOpen = open;
    $('regenerate-confirmation').hidden = !open;
    $('regenerate-report').setAttribute('aria-expanded', String(open));
    updateRegenerateButton();
  }

  function openRegenerateConfirmation() {
    if ($('regenerate-report').disabled) return;
    setRegenerateConfirmation(true);
    $('keep-current-draft').focus();
  }

  function cancelRegenerateConfirmation() {
    setRegenerateConfirmation(false);
    $('regenerate-report').focus();
  }

  function showReview(reportId) {
    const report = state.reports.find(item => item.id === reportId);
    const student = state.evidence?.students.find(item => item.id === report?.studentId);
    if (!report || !student) return;
    state.selectedReportId = reportId;
    const editable = report.status === 'draft';
    $('review-title').textContent = student.displayName;
    const initials = studentInitials(student);
    if (window.EDUGNAY_AVATAR?.render) {
      window.EDUGNAY_AVATAR.render($('review-avatar'), {
        id: student.id, name: student.displayName, initials, avatarUrl: student.avatarUrl, role: 'student'
      }, { size: 'compact' });
    } else {
      $('review-avatar').textContent = initials;
    }
    $('review-subtitle').textContent = `${state.evidence.section.gradeLevel} · ${state.evidence.section.name} · ${formatDate(report.reportWeekStartDate)}–${formatDate(report.reportWeekEndDate)}`;
    const attendance = student.attendance;
    const assignments = student.assignments;
    const scoreCount = student.academicScores?.length || 0;
    const journalApplicable = state.evidence.section.journalApplicable === true;
    const sources = [
      { key: 'attendance', icon: 'user-round-check', label: 'Attendance', value: attendance.recordedSessions ? `${attendance.present}/${attendance.recordedSessions} present · ${attendance.absent} absent` : 'No confirmed records', detail: attendance.recordedSessions ? `${attendance.recordedSessions} recorded sessions across subjects` : 'Missing records are not treated as absences.' },
      { key: 'assignments', icon: 'clipboard-check', label: 'Assignment completion', value: assignments.total ? `${assignments.submitted}/${assignments.total} submitted` : 'No assignments due', detail: assignments.total ? 'Published assignments due in the selected week' : 'Across all subjects for this week' },
      { key: 'academic', icon: 'chart-no-axes-column', label: 'Academic records', value: [student.academicRecords.length && `${student.academicRecords.length} published record(s)`, scoreCount && `${scoreCount} scored activities`].filter(Boolean).join(' · ') || 'No academic records', detail: student.academicScoresOmitted ? `${student.academicScoresOmitted} more scored activities not included; review before confirming.` : 'Recorded during the selected week' }
    ];
    if (journalApplicable) sources.push({ key: 'journal', icon: 'notebook-pen', label: 'Journal · Values Education', value: `${student.journal.entries.length} relevant submission(s)`, detail: 'Reflection text is treated as untrusted input.' });
    $('review-evidence').classList.toggle('without-journal', !journalApplicable);
    $('review-evidence').innerHTML = sources.map(source => `<div class="data-source-card ds-${source.key}"><span class="ds-icon" aria-hidden="true"><i data-lucide="${source.icon}"></i></span><div class="ds-content"><strong class="ds-val">${escape(source.value)}</strong><div class="ds-detail">${escape(source.detail)}</div><div class="ds-label">${escape(source.label)}</div></div></div>`).join('');
    window.lucide?.createIcons?.();
    $('review-note').textContent = report.teacherNote || 'No teacher note provided.';
    $('review-summary').value = report.editedSummary || report.generatedSummary;
    $('review-summary').disabled = !editable;
    $('review-actions').replaceChildren();
    report.parentActions.forEach(action => appendAction(action, !editable));
    const lowScores = (student.candidateReasons || []).filter(reason => reason.type === 'low_scores');
    $('follow-up-section').hidden = !report.followUpSuggestion && !lowScores.length;
    $('follow-up-text').textContent = report.followUpSuggestion || 'No AI follow-up suggestion was provided. Review the recorded reasons below.';
    $('follow-up-help').hidden = !report.followUpSuggestion;
    $('follow-up-choices').hidden = !report.followUpSuggestion;
    const reasons = (student.candidateReasons || []).map(reason => ({ reason, text: candidateReasonText(reason) })).filter(item => item.text);
    $('follow-up-evidence-heading').textContent = `Recorded reasons for ${formatDate(report.reportWeekStartDate)}–${formatDate(report.reportWeekEndDate)}`;
    $('follow-up-reasons').replaceChildren(...reasons.map(({ reason, text: value }) => {
      const item = document.createElement('li');
      item.textContent = value;
      if (reason.type === 'low_scores') {
        const scores = document.createElement('ul');
        scores.className = 'follow-up-scores';
        reason.scores.forEach(score => {
          const detail = document.createElement('li');
          detail.textContent = `${score.title} · ${formatDate(score.date)} · ${score.score}/${score.maxScore}`;
          scores.append(detail);
        });
        item.append(scores);
      }
      return item;
    }));
    document.querySelectorAll('input[name="follow-up-decision"]').forEach(input => {
      input.checked = report.status === 'confirmed' && input.value === (report.isAtRisk ? 'accept' : 'dismiss');
      input.disabled = !editable;
    });
    $('save-review').hidden = !editable;
    $('confirm-review').hidden = !editable;
    setRegenerateConfirmation(false);
    const historySection = $('report-history-section');
    const historyContent = $('report-history-content');
    const historyToggle = $('report-history');
    historySection.hidden = !report.releasedAt;
    historyContent.hidden = true;
    historyContent.replaceChildren();
    historyContent.dataset.loaded = 'false';
    historyToggle.textContent = 'Show versions';
    historyToggle.setAttribute('aria-expanded', 'false');
    historyToggle.disabled = false;
    historyToggle.removeAttribute('aria-busy');
    $('reopen-report').hidden = report.status !== 'confirmed' || Boolean(report.pendingCorrection);
    $('report-reopen-section').hidden = true;
    $('report-reopen-reason').value = '';
    $('release-report').hidden = editable || Boolean(report.releasedAt && !report.pendingCorrection) || !state.releaseEnabled;
    $('release-report').disabled = state.busy;
    $('review-release-note').textContent = editable
      ? report.pendingCorrection
        ? 'Parents still see the last released version while you edit this correction.'
        : 'Confirmation holds this report; it does not send it to parents.'
      : report.pendingCorrection
        ? 'Correction confirmed. Release it to update the parent report.'
        : report.releasedAt ? 'Released to linked parents.' : 'Confirmed and held. Parents cannot view it yet.';
    setMessage('review-message', '');
    openModal('review-modal');
  }

  function reviewPayload() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    const actions = [...$('review-actions').querySelectorAll('textarea')].map(node => node.value.trim());
    if (actions.some(action => !action)) throw new Error('Remove empty actions or enter their text.');
    return {
      summary: $('review-summary').value,
      parentActions: actions,
      teacherNote: report.teacherNote || ''
    };
  }

  async function saveReview(confirm = false) {
    if (state.busy) return;
    const id = state.selectedReportId;
    if (!id) return;
    setRegenerateConfirmation(false);
    state.busy = true;
    $('save-review').disabled = true;
    $('confirm-review').disabled = true;
    updateRegenerateButton();
    try {
      const body = reviewPayload();
      const report = state.reports.find(item => item.id === id);
      const followUpDecision = report.followUpSuggestion
        ? document.querySelector('input[name="follow-up-decision"]:checked')?.value || null : null;
      if (confirm && report.followUpSuggestion && !followUpDecision) {
        throw new Error('Accept or dismiss the internal follow-up suggestion before confirming.');
      }
      await api.request(`/reports/weekly-drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (confirm) await api.request(`/reports/weekly-drafts/${encodeURIComponent(id)}/confirm`, {
        method: 'POST', body: JSON.stringify({ followUpDecision })
      });
      await loadWeek();
      if (confirm) closeModal('review-modal', true);
      else showReview(id);
      showAppToast(confirm
        ? report.pendingCorrection ? 'Correction confirmed. Not sent to parents.' : 'Report confirmed. Not sent to parents.'
        : 'Draft saved.');
    } catch (error) { setMessage('review-message', error.message || 'The report could not be saved.', true); }
    finally { state.busy = false; $('save-review').disabled = false; $('confirm-review').disabled = false; updateRegenerateButton(); }
  }

  async function regenerate() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    if (!report || report.status !== 'draft' || report.releasedAt || !state.generationEnabled || state.busy ||
      !state.regenerateConfirmOpen) return;
    state.busy = true;
    setRegenerateConfirmation(false);
    $('review-modal').querySelector('[role="dialog"]').focus();
    $('regenerate-report-label').textContent = 'Regenerating...';
    $('regenerate-report').setAttribute('aria-busy', 'true');
    try {
      const result = await api.request('/reports/weekly-drafts/generate', { method: 'POST', body: JSON.stringify({
        sectionId: state.evidence.section.id, startDate: state.evidence.reportWeek.startDate,
        studentIds: [Number(report.studentId)], regenerateDrafts: true
      }) });
      if (result.results[0]?.status !== 'generated') throw new Error(result.results[0]?.message || 'The draft was not regenerated.');
      await loadWeek();
      showReview(report.id);
      showAppToast('Draft regenerated.');
    } catch (error) { setMessage('review-message', error.message || 'Regeneration failed.', true); }
    finally {
      state.busy = false;
      $('regenerate-report-label').textContent = 'Regenerate draft';
      $('regenerate-report').removeAttribute('aria-busy');
      updateRegenerateButton();
    }
  }

  async function releaseReport() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    if (!report || report.status !== 'confirmed' || report.releasedAt && !report.pendingCorrection ||
      !state.releaseEnabled || state.busy) return;
    state.busy = true;
    $('release-report').disabled = true;
    updateRegenerateButton();
    try {
      await api.request(`/reports/weekly-drafts/${encodeURIComponent(report.id)}/release`, { method: 'POST' });
      await loadWeek();
      showReview(report.id);
      showAppToast(report.pendingCorrection ? 'Correction released to parents.' : 'Report released to parents.');
    } catch (error) { setMessage('review-message', error.message || 'The report could not be released.', true); }
    finally { state.busy = false; $('release-report').disabled = false; updateRegenerateButton(); }
  }

  async function submitReopen() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    const reason = $('report-reopen-reason').value.trim();
    if (!report || state.busy) return;
    if (!reason) {
      setMessage('review-message', 'Enter a reason for reopening this report.', true);
      $('report-reopen-reason').focus();
      return;
    }
    state.busy = true;
    $('submit-reopen').disabled = true;
    updateRegenerateButton();
    try {
      await api.request(`/reports/weekly-drafts/${encodeURIComponent(report.id)}/reopen`, {
        method: 'POST', body: JSON.stringify({ reason })
      });
      await loadWeek();
      showReview(report.id);
      showAppToast('Report reopened for correction.');
    } catch (error) {
      setMessage('review-message', error.message || 'The report could not be reopened.', true);
    } finally {
      state.busy = false;
      $('submit-reopen').disabled = false;
      updateRegenerateButton();
    }
  }

  async function showReleaseHistory() {
    const report = state.reports.find(item => item.id === state.selectedReportId);
    if (!report?.releasedAt || state.busy) return;
    const historyContent = $('report-history-content');
    const historyToggle = $('report-history');
    if (!historyContent.hidden) {
      historyContent.hidden = true;
      historyToggle.textContent = 'Show versions';
      historyToggle.setAttribute('aria-expanded', 'false');
      return;
    }
    if (historyContent.dataset.loaded !== 'true') {
      historyToggle.disabled = true;
      historyToggle.setAttribute('aria-busy', 'true');
      setMessage('review-message', '');
      try {
        const history = await api.request(`/reports/weekly-drafts/${encodeURIComponent(report.id)}/history`);
        if (state.selectedReportId !== report.id) return;
        historyContent.innerHTML = `<div class="report-history-releases">${history.releases.map((item, index) =>
          `<article class="report-history-entry">
            <header class="report-history-entry-head">
              <h4 class="report-history-version">Version ${escape(item.versionNumber)}${index === 0 ? '<span class="report-history-current">Current parent version</span>' : ''}</h4>
              <div class="report-history-meta"><span>Released ${escape(formatDate(item.releasedAt.slice(0, 10)))}</span><span>By ${escape(item.adviserName || 'Adviser')}</span></div>
            </header>
            <div class="report-history-summary"><div class="report-history-label">Parent summary</div><p>${escape(item.summary)}</p></div>
            ${item.parentActions.length ? `<section class="report-history-actions"><h4><i data-lucide="list-checks" aria-hidden="true"></i> Recommended actions</h4><ul>${item.parentActions.map(action => `<li>${escape(action)}</li>`).join('')}</ul></section>` : ''}
          </article>`
        ).join('')}</div>${history.reopens.length
          ? `<section class="report-history-corrections"><h4><i data-lucide="file-clock" aria-hidden="true"></i> Correction history</h4>${history.reopens.map(item =>
            `<article class="report-history-correction"><p>${escape(item.reason)}</p><div class="report-history-meta"><span>Recorded ${escape(formatDate(item.reopenedAt.slice(0, 10)))}</span><span>By ${escape(item.adviserName || 'Adviser')}</span></div></article>`
          ).join('')}</section>` : ''}`;
        historyContent.dataset.loaded = 'true';
        window.lucide?.createIcons?.();
      } catch (error) {
        if (state.selectedReportId === report.id) {
          historyContent.hidden = true;
          historyToggle.textContent = 'Show versions';
          historyToggle.setAttribute('aria-expanded', 'false');
          setMessage('review-message', error.message || 'Release history could not be loaded.', true);
        }
        return;
      } finally {
        if (state.selectedReportId === report.id) {
          historyToggle.disabled = false;
          historyToggle.removeAttribute('aria-busy');
        }
      }
    }
    if (state.selectedReportId !== report.id) return;
    historyContent.hidden = false;
    historyToggle.textContent = 'Hide versions';
    historyToggle.setAttribute('aria-expanded', 'true');
    historyContent.scrollIntoView?.({ block: 'nearest' });
  }

  async function init() {
    try {
      const [session, sections, week] = await Promise.all([
        api.getCurrentUser(), api.getSections(), api.request('/reports/weekly-settings')
      ]);
      state.settings = week.settings;
      state.generationEnabled = Boolean(week.generationEnabled);
      state.generationSwitchEnabled = Boolean(week.generationSwitchEnabled);
      state.aiEvidenceApproved = Boolean(week.aiEvidenceApproved);
      state.reportsEnabled = Boolean(week.reportsEnabled);
      state.releaseEnabled = Boolean(week.releaseEnabled);
      const blockers = [
        !state.reportsEnabled && 'Reports off',
        !state.aiEvidenceApproved && 'school approval missing',
        !state.generationSwitchEnabled && 'server paused'
      ].filter(Boolean);
      $('generation-state').textContent = state.generationEnabled ? 'AI generation available' : `AI generation paused: ${blockers.join('; ')}`;
      $('generation-state').classList.toggle('is-enabled', state.generationEnabled);
      $('generation-state').classList.toggle('is-paused', !state.generationEnabled);
      state.sections = sections.filter(section => String(section.adviserUserId) === String(session.apiUserId) &&
        section.status === 'active' && section.academicYearStatus === 'active');
      $('report-section').innerHTML = state.sections.map(section => `<option value="${escape(section.id)}">${escape(section.gradeLevelName || section.gradeLevel || '')} · ${escape(section.name)}</option>`).join('');
      if (!state.sections.length) {
        state.evidence = null;
        state.reports = [];
        $('week-caption').textContent = 'No advisory section selected.';
        renderCounts();
        renderEmptyState('door-open', 'No advisory section assigned', 'An active advisory section must be assigned before weekly reports can be viewed.');
        setGenerationButtonState(true, 'No active advisory section is available for report generation.');
        $('pipeline-context').textContent = 'No active advisory section';
        return;
      }
      populateWeeks();
      await loadWeek();
    } catch (error) { setMessage('reports-message', error.message || 'Narrative Reports could not be loaded.', true); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('report-section').addEventListener('change', () => { populateWeeks(); loadWeek(); });
    $('report-week').addEventListener('change', loadWeek);
    $('report-search').addEventListener('input', renderCards);
    $('report-status').addEventListener('change', renderCards);
    $('open-generation').addEventListener('click', showGeneration);
    $('start-generation').addEventListener('click', generate);
    $('reports-grid').addEventListener('click', event => {
      const button = event.target.closest('[data-review-id]');
      if (button) showReview(button.dataset.reviewId);
    });
    $('add-action').addEventListener('click', () => appendAction());
    $('save-review').addEventListener('click', () => saveReview(false));
    $('confirm-review').addEventListener('click', () => saveReview(true));
    $('regenerate-report').addEventListener('click', openRegenerateConfirmation);
    $('keep-current-draft').addEventListener('click', cancelRegenerateConfirmation);
    $('confirm-regenerate').addEventListener('click', regenerate);
    $('release-report').addEventListener('click', releaseReport);
    $('reopen-report').addEventListener('click', () => {
      $('report-reopen-section').hidden = false;
      $('report-reopen-reason').focus();
    });
    $('cancel-reopen').addEventListener('click', () => { $('report-reopen-section').hidden = true; });
    $('submit-reopen').addEventListener('click', submitReopen);
    $('report-history').addEventListener('click', showReleaseHistory);
    document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop').id)));
    document.querySelectorAll('.modal-backdrop').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal && !state.busy) closeModal(modal.id); }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !state.busy) {
        if (state.regenerateConfirmOpen) cancelRegenerateConfirmation();
        else document.querySelectorAll('.modal-backdrop.open').forEach(modal => closeModal(modal.id));
      }
      if (event.key !== 'Tab') return;
      const backdrop = document.querySelector('.modal-backdrop.open');
      const dialog = backdrop?.querySelector('[role="dialog"]');
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hidden && element.getClientRects().length);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
    init();
  });
})();
