lucide.createIcons();

    const BACKEND_ASSIGNMENTS_ENABLED = Boolean(window.EDUGNAY_API?.isBackendAvailable);
    let STUDENT_ID = null;
    let ASSIGNMENTS = [];
    let ASSIGNMENT_HISTORY = [];
    let STUDENT_SUBMISSIONS = [];
    let ASSIGNMENT_PERIODS = [];
    let selectedAssignmentYearId = '';
    let selectedAssignmentPeriodId = '';
    let backendAssignmentsLoading = BACKEND_ASSIGNMENTS_ENABLED;
    let backendAssignmentsError = '';

    function latestSelectableAssignmentPeriod(periods) {
      return periods.filter(function (term) { return term.status !== 'upcoming'; })
        .slice()
        .sort(function (first, second) {
          return String(second.academicYearLabel).localeCompare(String(first.academicYearLabel)) ||
            Number(second.sequenceNumber || 0) - Number(first.sequenceNumber || 0);
        })[0] || null;
    }

    function setAssignmentPeriods(terms) {
      const termById = new Map(terms.map(function (term) { return [String(term.id), term]; }));
      const assignedTerms = ASSIGNMENTS.map(function (assignment) {
        return termById.get(String(assignment.academicPeriodId));
      }).filter(Boolean);
      const levels = new Set(assignedTerms.map(function (term) { return String(term.schoolLevelId); }));
      const years = new Set(assignedTerms.map(function (term) { return String(term.academicYearId); }));
      ASSIGNMENT_PERIODS = terms.filter(function (term) {
        return levels.has(String(term.schoolLevelId)) &&
          (years.has(String(term.academicYearId)) || term.status === 'active');
      }).sort(function (first, second) {
        return String(second.academicYearLabel).localeCompare(String(first.academicYearLabel)) ||
          Number(first.sequenceNumber) - Number(second.sequenceNumber);
      });
      if (!ASSIGNMENT_PERIODS.some(function (term) {
        return String(term.id) === selectedAssignmentPeriodId && term.status !== 'upcoming';
      })) {
        const current = ASSIGNMENT_PERIODS.find(function (term) { return term.status === 'active'; }) ||
          latestSelectableAssignmentPeriod(ASSIGNMENT_PERIODS);
        selectedAssignmentPeriodId = current ? String(current.id) : '';
      }
      const selected = ASSIGNMENT_PERIODS.find(function (term) { return String(term.id) === selectedAssignmentPeriodId; });
      selectedAssignmentYearId = selected ? String(selected.academicYearId) : '';
    }

    function renderPeriodFilter() {
      const yearSelect = document.getElementById('assignmentYearFilter');
      const years = Array.from(new Map(ASSIGNMENT_PERIODS.map(function (term) {
        return [String(term.academicYearId), term.academicYearLabel];
      })).entries());
      if (!years.some(function (year) { return year[0] === selectedAssignmentYearId; })) {
        selectedAssignmentYearId = years[0]?.[0] || '';
      }
      yearSelect.innerHTML = years.length
        ? years.map(function (year) { return '<option value="' + escapeHtml(year[0]) + '">' + escapeHtml(year[1] || 'School year') + '</option>'; }).join('')
        : '<option value="">No school years</option>';
      yearSelect.value = selectedAssignmentYearId;
      yearSelect.disabled = !years.length || Boolean(backendAssignmentsError);
      const periods = ASSIGNMENT_PERIODS.filter(function (term) { return String(term.academicYearId) === selectedAssignmentYearId; });
      const select = document.getElementById('assignmentPeriodFilter');
      select.innerHTML = periods.length
        ? periods.map(function (term) {
            return '<option value="' + escapeHtml(String(term.id)) + '"' +
              (term.status === 'upcoming' ? ' disabled' : '') + '>' + escapeHtml(term.name) + '</option>';
          }).join('')
        : '<option value="">No grading periods</option>';
      select.disabled = !periods.length || Boolean(backendAssignmentsError);
      select.value = selectedAssignmentPeriodId;
      document.getElementById('assignmentPeriodTabs').innerHTML = periods.map(function (term) {
        const active = String(term.id) === selectedAssignmentPeriodId;
        const upcoming = term.status === 'upcoming';
        const unavailable = upcoming || Boolean(backendAssignmentsError);
        const accessibleName = upcoming ? ' aria-label="' + escapeHtml(term.name + ', not started') + '"' : '';
        const periodAction = unavailable ? ' aria-disabled="true" disabled' : ' data-academic-period-id="' + escapeHtml(String(term.id)) + '"';
        return '<button class="grade-tab' + (active ? ' active' : '') + '" type="button" role="tab"' + periodAction +
          ' aria-selected="' + active + '"' + accessibleName + '>' +
          '<span>' + escapeHtml(term.name) + '</span>' + (upcoming ? '<i class="grade-tab-status-icon" data-lucide="lock" aria-hidden="true"></i>' : '') + '</button>';
      }).join('');
      window.lucide?.createIcons();
    }

    function selectAssignmentPeriod(id) {
      const term = ASSIGNMENT_PERIODS.find(function (item) { return String(item.id) === String(id); });
      if (term && term.status === 'upcoming') return;
      selectedAssignmentPeriodId = term ? String(term.id) : '';
      if (term) selectedAssignmentYearId = String(term.academicYearId);
    }

    function selectAssignmentYear(yearId) {
      selectedAssignmentYearId = String(yearId || '');
      const periods = ASSIGNMENT_PERIODS.filter(function (term) { return String(term.academicYearId) === selectedAssignmentYearId; });
      const selected = periods.find(function (term) { return term.status === 'active'; }) ||
        latestSelectableAssignmentPeriod(periods);
      selectedAssignmentPeriodId = selected ? String(selected.id) : '';
    }

    function getAssignmentsInSelectedPeriod() {
      return ASSIGNMENTS.filter(function (assignment) {
        return String(assignment.academicPeriodId) === selectedAssignmentPeriodId;
      });
    }

    function isElectiveAssignment(assignment) {
      return assignment.scopeType === 'elective' || assignment.electiveClassId != null;
    }

    function getAssignmentsForCurrentView() {
      return getAssignmentsInSelectedPeriod();
    }

    function assignmentSubjectKey(item) {
      return isElectiveAssignment(item) ? 'elective:' + String(item.electiveClassId)
        : 'subject:' + String(item.subjectId) + ':' + String(item.communicationComponentCode || '');
    }

    async function loadBackendAssignments() {
      try {
        if (!BACKEND_ASSIGNMENTS_ENABLED) throw new Error('Assignments aren’t available right now. Refresh and try again.');
        await window.EDUGNAY_SCHOOL_READY;
        const session = await window.EDUGNAY_API.getCurrentUser();
        if (session?.role !== 'student') throw new Error('Sign in with a student account to view assignments.');
        STUDENT_ID = String(session.apiUserId || session.userId);
        if (!STUDENT_ID || STUDENT_ID === 'undefined') throw new Error('Your student account could not be identified.');
        const [assignments, terms, historyResponse] = await Promise.all([
          window.EDUGNAY_API.getAssignments(),
          window.EDUGNAY_API.getAcademicTerms(),
          window.EDUGNAY_API.getAssignmentHistory()
        ]);
        ASSIGNMENT_HISTORY = Array.isArray(historyResponse) ? historyResponse : [];
        const submissions = (await Promise.all(assignments.map(function (assignment) {
          return window.EDUGNAY_API.getAssignmentSubmissions(assignment.id);
        }))).flat();
        const todayDate = new Date();
        const today = [todayDate.getFullYear(), String(todayDate.getMonth() + 1).padStart(2, '0'), String(todayDate.getDate()).padStart(2, '0')].join('-');
        STUDENT_SUBMISSIONS = submissions.filter(function (record) {
          return String(record.studentId) === STUDENT_ID;
        });
        ASSIGNMENTS = assignments.map(function (assignment) {
          const submission = STUDENT_SUBMISSIONS.find(function (record) {
            return String(record.assignmentId) === String(assignment.id);
          });
          const submitted = submission?.status === 'submitted' && submission.fileName;
          const pastDue = assignment.dueDate && assignment.dueDate < today;
          return { ...assignment, status: assignment.submissionStatus || (submitted ? 'submitted' : pastDue ? 'not_submitted' : 'pending') };
        });
        setAssignmentPeriods(terms);
        backendAssignmentsError = '';
        return true;
      } catch (error) {
        console.warn('Unable to load student assignments.', error.message);
        backendAssignmentsError = 'Assignments could not be loaded. Please refresh and try again.';
        ASSIGNMENTS = [];
        ASSIGNMENT_HISTORY = [];
        STUDENT_SUBMISSIONS = [];
        ASSIGNMENT_PERIODS = [];
        selectedAssignmentPeriodId = '';
        return false;
      } finally {
        backendAssignmentsLoading = false;
      }
    }

    const ASSIGNMENT_FILTERS = [
      { key: 'all', label: 'All' },
      { key: 'pending', label: 'Pending' },
      { key: 'submitted', label: 'Submitted' },
      { key: 'not_submitted', label: 'Not submitted' }
    ];

    const STATUS_META = {
      pending: { label: 'Pending', icon: 'clock-3' },
      submitted: { label: 'Submitted', icon: 'check-circle-2' },
      not_submitted: { label: 'Not submitted', icon: 'x-circle' }
    };

    let currentFilter = 'all';

    function formatDate(isoDate) {
      return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    }

    function getStatusCount(status) {
      return getAssignmentsForCurrentView().filter(function (item) { return item.status === status; }).length;
    }

    function renderFilterTabs() {
      const filters = document.getElementById('assignmentFilters');
      filters.innerHTML = ASSIGNMENT_FILTERS.map(function (filter) {
        const count = filter.key === 'all' ? getAssignmentsForCurrentView().length : getStatusCount(filter.key);
        return '<button class="filter-tab assignment-filter-tab' + (currentFilter === filter.key ? ' active' : '') + '" type="button" data-filter-key="' + filter.key + '" data-page-click="g9d3c2dd25d9a">' +
          escapeHtml(filter.label) + '<span class="assignment-filter-count">' + count + '</span></button>';
      }).join('');
      lucide.createIcons();
    }

    function setAssignmentFilter(filter) {
      currentFilter = filter;
      renderFilterTabs();
      renderAssignments();
    }

    function getVisibleAssignments() {
      const search = document.getElementById('assignmentSearch').value.trim().toLowerCase();
      const subject = document.getElementById('assignmentSubjectFilter').value;
      return getAssignmentsForCurrentView().filter(function (item) {
        const matchesFilter = currentFilter === 'all' || item.status === currentFilter;
        const matchesSubject = subject === 'all' || assignmentSubjectKey(item) === subject;
        const matchesSearch = !search || (item.title + ' ' + item.subject + ' ' + item.teacher).toLowerCase().includes(search);
        return matchesFilter && matchesSubject && matchesSearch;
      });
    }

    function renderAssignments() {
      renderAssignmentHistory();
      const list = document.getElementById('assignmentList');
      if (BACKEND_ASSIGNMENTS_ENABLED && backendAssignmentsLoading) {
        list.innerHTML = '';
        lucide.createIcons();
        return;
      }
      if (BACKEND_ASSIGNMENTS_ENABLED && backendAssignmentsError) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Assignments unavailable', text: backendAssignmentsError });
        lucide.createIcons();
        return;
      }
      const visible = getVisibleAssignments();

      if (!visible.length) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'clipboard-check',
          title: 'No assignments found',
          text: selectedAssignmentPeriodId || ASSIGNMENTS.length ? 'Try another status, subject, or search term.' : 'Assignments will appear when a grading period is available.'
        });
        if (window.lucide) lucide.createIcons();
        return;
      }

      function renderAssignmentRow(item) {
        const status = STATUS_META[item.status];
        const onlineLabel = item.onlineSubmissionEnabled ? 'Available' : 'Not available';
        const onlineClass = item.onlineSubmissionEnabled ? 'available' : 'not-available';
        const hasOnlineSubmission = STUDENT_SUBMISSIONS.some(function (record) {
          return record.assignmentId === item.id;
        });
        const readOnlyElective = isElectiveAssignment(item) && item.electiveMembershipActive === false;
        const submissionAction = readOnlyElective
          ? hasOnlineSubmission ? '<button class="top-btn secondary assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">View submission</button>'
            : '<span class="assignment-action-muted">Enrollment ended</span>'
          : item.onlineSubmissionEnabled
          ? '<button class="top-btn assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">' +
              '<i data-lucide="file-up" style="width:13px;height:13px;"></i> ' + (hasOnlineSubmission ? 'Replace file' : 'Submit work') + '</button>'
          : '<span class="assignment-action-muted">Submit in class</span>';
        const assignmentScope = [
          isElectiveAssignment(item) ? 'Elective class' + (item.className ? ' · ' + item.className : '') : '',
          item.communicationComponentName || ''
        ].filter(Boolean).join(' · ');
        const subjectName = item.communicationComponentName || item.subjectName || item.subject;
        return '<article class="assignment-row assignment-details-trigger" data-assignment-id="' + escapeHtml(item.id) + '" tabindex="0" role="button" aria-label="View details for ' + escapeHtml(item.title) + '">' +
          '<div class="assignment-row-content">' +
            '<h2 class="assignment-row-title">' + escapeHtml(item.title) + '</h2>' +
            '<div class="assignment-row-meta">' + escapeHtml(subjectName) + ' · Due ' + formatDate(item.dueDate) + ' · ' + escapeHtml(item.teacher) + (assignmentScope ? ' · ' + escapeHtml(assignmentScope) : '') + '</div>' +
          '</div>' +
          '<div class="assignment-online-cell" data-label="Online submission">' +
            '<span class="assignment-online-status ' + onlineClass + '">' + onlineLabel + '</span>' +
          '</div>' +
          '<div class="assignment-status-cell" data-label="Status">' +
            '<span class="assignment-status ' + item.status + '" aria-label="' + escapeHtml(status.label) + '" title="' + escapeHtml(status.label) + '"><i data-lucide="' + status.icon + '" style="width:12px;height:12px;"></i><span class="assignment-status-label">' + escapeHtml(status.label) + '</span></span>' +
          '</div>' +
          '<div class="assignment-row-actions" data-label="Action">' +
            submissionAction +
          '</div>' +
        '</article>';
      }
      const electiveRows = visible.filter(isElectiveAssignment);
      const sectionRows = visible.filter(function (item) { return !isElectiveAssignment(item); });
      list.innerHTML = sectionRows.map(renderAssignmentRow).join('') +
        (electiveRows.length ? '<div class="assignment-scope-heading">Elective class assignments</div>' + electiveRows.map(renderAssignmentRow).join('') : '');
      lucide.createIcons();
    }

    function renderAssignmentHistory() {
      const panel = document.getElementById('assignmentHistory');
      panel.hidden = backendAssignmentsLoading || Boolean(backendAssignmentsError) || !ASSIGNMENT_HISTORY.length;
      if (panel.hidden) { panel.open = false; return; }
      document.getElementById('assignmentHistoryCount').textContent = String(ASSIGNMENT_HISTORY.length);
      document.getElementById('assignmentHistoryList').innerHTML = ASSIGNMENT_HISTORY.map(function (item) {
        const status = STATUS_META[item.submissionStatus] || STATUS_META.pending;
        return '<article class="assignment-row"><div class="assignment-row-content"><h2 class="assignment-row-title">' + escapeHtml(item.title) + '</h2>' +
          '<div class="assignment-row-meta">' + escapeHtml(item.sectionName) + ' · ' + escapeHtml(item.academicYearLabel) + ' · ' + escapeHtml(item.academicTermName) + ' · ' + escapeHtml(item.communicationComponentName || item.subjectName) + '</div></div>' +
          '<div class="assignment-status-cell" data-label="Status"><span class="assignment-status ' + escapeHtml(item.submissionStatus) + '">' + escapeHtml(status.label) + '</span></div>' +
          '<div class="assignment-row-actions" data-label="Action"><button class="top-btn secondary" type="button" data-history-id="' + escapeHtml(item.id) + '">View details</button></div></article>';
      }).join('');
    }

    function openAssignmentHistoryDetail(id) {
      const item = ASSIGNMENT_HISTORY.find(function (row) { return String(row.id) === String(id); });
      if (!item) return;
      activeSubmissionAssignmentId = null;
      document.getElementById('submissionModalTitle').textContent = 'Previous section work';
      document.getElementById('submissionModalSub').textContent = item.sectionName + ' · ' + item.academicTermName + ' · Read only';
      document.getElementById('assignmentDetailTitle').textContent = item.title || '—';
      document.getElementById('assignmentDetailSubject').textContent = item.communicationComponentName || item.subjectName || '—';
      document.getElementById('assignmentDetailTeacher').textContent = item.teacherName || '—';
      document.getElementById('assignmentDetailDueDate').textContent = item.dueDate ? formatDate(item.dueDate) : 'No due date';
      document.getElementById('assignmentDetailInstructions').textContent = item.description || 'No additional instructions were provided.';
      document.getElementById('assignmentOnlineNotice').textContent = (STATUS_META[item.submissionStatus] || STATUS_META.pending).label;
      document.getElementById('assignmentSubmissionForm').hidden = true;
      document.getElementById('assignmentSubmissionSubmit').hidden = true;
      const link = document.getElementById('assignmentHistoryDownload');
      link.hidden = !item.fileAvailable;
      if (item.fileAvailable) link.href = window.EDUGNAY_API.getHistoricalSubmissionUrl(item.id);
      const modal = document.getElementById('assignmentSubmissionModal');
      modal.hidden = false;
      modal.classList.add('open');
    }

    function populateSubjectFilter() {
      const subjects = new Map();
      getAssignmentsForCurrentView().forEach(function (item) {
        const key = assignmentSubjectKey(item);
        if (!subjects.has(key)) {
          const label = isElectiveAssignment(item)
            ? [item.subjectName || item.subject, item.className].filter(Boolean).join(' · ')
            : item.communicationComponentName || item.subjectName || item.subject;
          subjects.set(key, label || 'Subject');
        }
      });
      document.getElementById('assignmentSubjectFilter').innerHTML =
        '<option value="all">All subjects</option>' +
        Array.from(subjects.entries()).map(function ([key, label]) {
          return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label) + '</option>';
        }).join('');
    }

    let activeSubmissionAssignmentId = null;

    function openAssignmentSubmissionModal(assignmentId) {
      const assignment = ASSIGNMENTS.find(function (item) {
        return item.id === String(assignmentId);
      });
      if (!assignment) return;

      activeSubmissionAssignmentId = assignment.id;
      const ownSubmission = STUDENT_SUBMISSIONS.find(function (record) {
        return record.assignmentId === assignment.id;
      });
      const hasOnlineSubmission = Boolean(ownSubmission);
      const readOnlyElective = isElectiveAssignment(assignment) && assignment.electiveMembershipActive === false;
      const submissionDownload = document.getElementById('assignmentHistoryDownload');
      submissionDownload.hidden = !(isElectiveAssignment(assignment) && ownSubmission?.fileUrl);
      submissionDownload.href = submissionDownload.hidden ? '' : ownSubmission.fileUrl;
      document.getElementById('submissionModalTitle').textContent = readOnlyElective
        ? 'Elective submission details'
        : assignment.onlineSubmissionEnabled
        ? hasOnlineSubmission ? 'Replace submission' : 'Submit assignment'
        : 'Assignment details';
      document.getElementById('submissionModalSub').textContent = readOnlyElective
        ? 'Your earlier submission remains available. New work can no longer be submitted for this class.'
        : assignment.onlineSubmissionEnabled
        ? 'Review the details and upload your work.'
        : 'Review the assignment details and instructions.';
      document.getElementById('assignmentDetailTitle').textContent = assignment.title || '—';
      document.getElementById('assignmentDetailSubject').textContent = assignment.subject || '—';
      document.getElementById('assignmentDetailTeacher').textContent = assignment.teacher || '—';
      document.getElementById('assignmentDetailDueDate').textContent = assignment.dueDate
        ? formatDate(assignment.dueDate)
        : '—';
      document.getElementById('assignmentDetailInstructions').textContent = assignment.instructions ||
        "No additional instructions were provided.";

      const submissionForm = document.getElementById('assignmentSubmissionForm');
      const submitButton = document.getElementById('assignmentSubmissionSubmit');
      const canSubmitOnline = assignment.onlineSubmissionEnabled === true && !readOnlyElective;
      submissionForm.hidden = !canSubmitOnline;
      submitButton.hidden = !canSubmitOnline;
      submitButton.innerHTML = '<i data-lucide="send" style="width:13px;height:13px;"></i> ' +
        (hasOnlineSubmission ? 'Replace file' : 'Submit work');
      const onlineNotice = document.getElementById('assignmentOnlineNotice');
      onlineNotice.textContent = readOnlyElective
        ? hasOnlineSubmission ? 'Enrollment ended · previous submission available' : 'Enrollment ended'
        : canSubmitOnline
        ? 'Online submission available'
        : 'Submit in class';
      onlineNotice.classList.toggle('is-available', canSubmitOnline);
      onlineNotice.classList.toggle('is-classroom', !canSubmitOnline);

      const fileInput = document.getElementById('assignmentSubmissionFile');
      fileInput.value = '';
      document.getElementById('assignmentSubmissionFileHint').textContent = 'PDF, Word, PowerPoint, or Excel.';
      document.getElementById('assignmentSubmissionFileHint').style.color = '';

      const modal = document.getElementById('assignmentSubmissionModal');
      modal.hidden = false;
      modal.classList.add('open');
      lucide.createIcons();
    }

    function closeAssignmentSubmissionModal() {
      const modal = document.getElementById('assignmentSubmissionModal');
      modal.classList.remove('open');
      modal.hidden = true;
      activeSubmissionAssignmentId = null;
    }

    function validateAssignmentSubmission() {
      const fileInput = document.getElementById('assignmentSubmissionFile');
      const hint = document.getElementById('assignmentSubmissionFileHint');
      const file = fileInput.files[0];
      const supportedTypes = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];
      const extension = file?.name.split('.').pop().toLowerCase();

      if (!file) {
        hint.textContent = 'Choose a file before submitting.';
        hint.style.color = 'var(--red)';
        fileInput.focus();
        return false;
      }
      if (!supportedTypes.includes(extension)) {
        hint.textContent = 'Choose a supported file type.';
        hint.style.color = 'var(--red)';
        fileInput.focus();
        return false;
      }

      hint.textContent = 'PDF, Word, PowerPoint, or Excel.';
      hint.style.color = '';
      return true;
    }

    async function submitStudentAssignment() {
      if (!activeSubmissionAssignmentId || !validateAssignmentSubmission()) return;

      const button = document.getElementById('assignmentSubmissionSubmit');
      if (button.disabled) return;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Submitting...';
      const file = document.getElementById('assignmentSubmissionFile').files[0];
      try {
        if (!BACKEND_ASSIGNMENTS_ENABLED) throw new Error('Assignments can’t be submitted right now. Refresh and try again.');
        await window.EDUGNAY_API.submitAssignment(activeSubmissionAssignmentId, file);
        const refreshed = await loadBackendAssignments();
        showAppToast(refreshed ? 'Assignment submitted.' : 'Your work was submitted, but the assignment list could not refresh. Reload the page to confirm.', refreshed ? 'success' : 'info');
      } catch (error) {
        showAppToast(error.message || 'The assignment could not be submitted.', 'error');
        return;
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      closeAssignmentSubmissionModal();
      renderPeriodFilter();
      populateSubjectFilter();
      renderFilterTabs();
      renderAssignments();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      document.getElementById('assignmentHistoryList').addEventListener('click', function (event) {
        const button = event.target.closest('[data-history-id]');
        if (button) openAssignmentHistoryDetail(button.dataset.historyId);
      });
      await loadBackendAssignments();
      renderPeriodFilter();
      populateSubjectFilter();
      renderFilterTabs();
      renderAssignments();

      document.getElementById('assignmentYearFilter').addEventListener('change', function () {
        selectAssignmentYear(this.value);
        renderPeriodFilter();
        populateSubjectFilter();
        renderFilterTabs();
        renderAssignments();
      });

      document.getElementById('assignmentPeriodFilter').addEventListener('change', function () {
        selectAssignmentPeriod(this.value);
        renderPeriodFilter();
        populateSubjectFilter();
        renderFilterTabs();
        renderAssignments();
      });

      document.getElementById('assignmentPeriodTabs').addEventListener('click', function (event) {
        const button = event.target.closest('[data-academic-period-id]');
        if (!button) return;
        selectAssignmentPeriod(button.dataset.academicPeriodId);
        renderPeriodFilter();
        populateSubjectFilter();
        renderFilterTabs();
        renderAssignments();
      });

      document.addEventListener('click', function (event) {
        const action = event.target.closest('.assignment-submit-action');
        if (action) {
          openAssignmentSubmissionModal(action.dataset.assignmentId);
          return;
        }

        const row = event.target.closest('.assignment-details-trigger');
        if (row) openAssignmentSubmissionModal(row.dataset.assignmentId);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        const row = event.target.closest('.assignment-details-trigger');
        if (!row || event.target.closest('button')) return;
        event.preventDefault();
        openAssignmentSubmissionModal(row.dataset.assignmentId);
      });
      document.getElementById('assignmentSubmissionClose').addEventListener('click', closeAssignmentSubmissionModal);
      document.getElementById('assignmentSubmissionCancel').addEventListener('click', closeAssignmentSubmissionModal);
      document.getElementById('assignmentSubmissionFile').addEventListener('change', validateAssignmentSubmission);
      document.getElementById('assignmentSubmissionSubmit').addEventListener('click', submitStudentAssignment);
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  change: {
    pb252376709c2: function(event) { renderAssignments() },
  },
  input: {
    p0e5ed3857546: function(event) { renderAssignments() },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g9d3c2dd25d9a: function(event) { setAssignmentFilter(this.dataset.filterKey) },
  },
});
