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

    function setAssignmentPeriods(terms, sections = []) {
      const termById = new Map(terms.map(function (term) { return [String(term.id), term]; }));
      const assignedTerms = ASSIGNMENTS.map(function (assignment) {
        return termById.get(String(assignment.academicPeriodId));
      }).filter(Boolean);
      const availableYears = new Set(assignedTerms.map(function (term) {
        return String(term.academicYearId) + ':' + String(term.schoolLevelId);
      }));
      sections.filter(function (section) {
        return section.status === 'active' && section.academicYearStatus === 'active';
      }).forEach(function (section) {
        availableYears.add(String(section.academicYearId) + ':' + String(section.schoolLevelId));
      });
      ASSIGNMENT_PERIODS = terms.filter(function (term) {
        return availableYears.has(String(term.academicYearId) + ':' + String(term.schoolLevelId));
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
        : '<option value="">' + (backendAssignmentsError ? 'School years unavailable' : 'No school years') + '</option>';
      yearSelect.value = selectedAssignmentYearId;
      yearSelect.disabled = !years.length || Boolean(backendAssignmentsError);
      const periods = ASSIGNMENT_PERIODS.filter(function (term) { return String(term.academicYearId) === selectedAssignmentYearId; });
      const select = document.getElementById('assignmentPeriodFilter');
      select.innerHTML = periods.length
        ? periods.map(function (term) {
            return '<option value="' + escapeHtml(String(term.id)) + '"' +
              (term.status === 'upcoming' ? ' disabled' : '') + '>' + escapeHtml(term.name) + '</option>';
          }).join('')
        : '<option value="">' + (backendAssignmentsError ? 'Grading periods unavailable' : 'No grading periods') + '</option>';
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
        const [assignments, terms, sections, historyResponse] = await Promise.all([
          window.EDUGNAY_API.getAssignments(),
          window.EDUGNAY_API.getAcademicTerms(),
          window.EDUGNAY_API.getSections(),
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
          const submitted = ['submitted', 'late'].includes(submission?.status) && submission.fileName;
          const pastDue = assignment.dueDate && assignment.dueDate < today;
          return { ...assignment, status: assignment.submissionStatus || (submitted ? submission.status : pastDue ? 'not_submitted' : 'pending') };
        });
        setAssignmentPeriods(terms, sections);
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
      { key: 'late', label: 'Late' },
      { key: 'not_submitted', label: 'Not submitted' }
    ];

    const STATUS_META = {
      pending: { label: 'Pending', icon: 'clock-3' },
      submitted: { label: 'Submitted', icon: 'check-circle-2' },
      late: { label: 'Late', icon: 'clock-alert' },
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

    function replacementLimitReached(assignment, submission) {
      return Boolean(submission?.fileName) && assignment.maxResubmissions != null
        && Number(submission.resubmissionCount || 0) >= assignment.maxResubmissions;
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
        const inPeriod = getAssignmentsInSelectedPeriod();
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'clipboard-check',
          title: !selectedAssignmentPeriodId ? 'No grading periods available'
            : inPeriod.length ? 'No assignments found' : 'No assignments in this grading period',
          text: !selectedAssignmentPeriodId ? 'Grading periods for your enrolled section will appear here when available.'
            : inPeriod.length ? 'Try another status, subject, or search term.'
              : 'No assignments have been posted for this period yet.'
        });
        if (window.lucide) lucide.createIcons();
        return;
      }

      function renderAssignmentRow(item) {
        const status = STATUS_META[item.status];
        const pastDue = item.dueDate && item.dueDate < (item.schoolCurrentDate || new Date().toLocaleDateString('en-CA'));
        const onlineAvailable = item.onlineSubmissionEnabled && (!pastDue || item.allowLateSubmissions)
          && (!pastDue || !item.academicTermStatus || item.academicTermStatus === 'active');
        const onlineLabel = onlineAvailable ? 'Available' : 'Not available';
        const onlineClass = onlineAvailable ? 'available' : 'not-available';
        const ownSubmission = ownSubmissionFor(item.id);
        const hasOnlineSubmission = Boolean(ownSubmission?.fileName);
        const limitReached = replacementLimitReached(item, ownSubmission);
        const readOnlyElective = isElectiveAssignment(item) && item.electiveMembershipActive === false;
        const submissionAction = readOnlyElective
          ? hasOnlineSubmission ? '<button class="top-btn secondary assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">View submission</button>'
            : '<span class="assignment-action-muted">Enrollment ended</span>'
          : onlineAvailable
          ? limitReached
            ? '<button class="top-btn secondary assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">View submission</button>'
            : '<button class="top-btn assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">' +
                '<i data-lucide="file-up" style="width:13px;height:13px;"></i> ' + (hasOnlineSubmission ? 'Replace file' : 'Submit work') + '</button>'
          : item.onlineSubmissionEnabled
            ? hasOnlineSubmission
              ? '<button class="top-btn secondary assignment-submit-action" type="button" data-assignment-id="' + escapeHtml(item.id) + '">View submission</button>'
              : '<span class="assignment-action-muted">Deadline passed</span>'
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
          '<div class="assignment-status-cell" data-label="Status"><span class="assignment-status ' + escapeHtml(item.submissionStatus) + '"><i data-lucide="' + status.icon + '" aria-hidden="true" style="width:12px;height:12px;"></i><span class="assignment-status-label">' + escapeHtml(status.label) + '</span></span></div>' +
          '<div class="assignment-row-actions" data-label="Action"><button class="top-btn secondary" type="button" data-history-id="' + escapeHtml(item.id) + '">View details</button></div></article>';
      }).join('');
      window.lucide?.createIcons();
    }

    function showAssignmentScore(item) {
      const row = document.getElementById('assignmentScoreRow');
      row.hidden = item.onlineSubmissionEnabled !== true || !item.gradingItemId || !(Number(item.maxScore) > 0);
      if (row.hidden) return;
      const value = document.getElementById('assignmentScoreValue');
      value.classList.toggle('is-pending', item.studentScore == null);
      value.textContent = item.studentScore == null
        ? 'Not graded yet' : `${Number(item.studentScore)} / ${Number(item.maxScore)}`;
    }

    function showAssignmentDueBadge(item) {
      const badge = document.getElementById('assignmentDueBadge');
      const due = item.dueDate;
      const today = item.schoolCurrentDate;
      badge.hidden = true;
      if (!due || !today) return;
      const days = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
      const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow'
        : days < 0 && !['submitted', 'late'].includes(item.submissionStatus) && !['submitted', 'late'].includes(item.status) ? 'Overdue' : '';
      if (!label) return;
      badge.textContent = label;
      badge.classList.toggle('is-overdue', label === 'Overdue');
      badge.hidden = false;
    }

    function assignmentFileType(name) {
      const ext = String(name || '').split('.').pop().toLowerCase();
      return ({ pdf: 'PDF document', doc: 'Word document', docx: 'Word document',
        ppt: 'PowerPoint file', pptx: 'PowerPoint file', xls: 'Excel file', xlsx: 'Excel file' })[ext] || 'Submitted file';
    }

    function openAssignmentHistoryDetail(id) {
      const item = ASSIGNMENT_HISTORY.find(function (row) { return String(row.id) === String(id); });
      if (!item) return;
      activeSubmissionAssignmentId = null;
      document.getElementById('submissionModalTitle').textContent = 'Previous section work';
      document.getElementById('submissionModalSub').textContent = [item.title, item.communicationComponentName || item.subjectName].filter(Boolean).join(' · ');
      document.getElementById('assignmentDetailTeacher').textContent = item.teacherName || '—';
      document.getElementById('assignmentDetailDueDate').textContent = item.dueDate ? formatDate(item.dueDate) : 'No due date';
      showAssignmentDueBadge(item);
      document.getElementById('assignmentDetailInstructions').textContent = item.description || 'No additional instructions were provided.';
      document.getElementById('assignmentOnlineNotice').textContent = (STATUS_META[item.submissionStatus] || STATUS_META.pending).label;
      showAssignmentScore(item);
      document.getElementById('assignmentSubmissionForm').hidden = true;
      document.getElementById('assignmentSubmissionSubmit').hidden = true;
      document.getElementById('assignmentSubmittedFile').hidden = true;
      document.getElementById('assignmentSubmittedFileLabel').textContent = 'Submitted file';
      document.getElementById('assignmentSubmissionCancel').textContent = 'Close';
      document.getElementById('assignmentReplacementNotice').hidden = true;
      const link = document.getElementById('assignmentHistoryDownload');
      link.hidden = !item.fileAvailable;
      document.getElementById('assignmentSubmittedFileView').hidden = true;
      document.getElementById('assignmentSubmittedFileDownload').hidden = true;
      if (item.fileAvailable) {
        document.getElementById('assignmentSubmittedFile').hidden = false;
        document.getElementById('assignmentSubmittedFileName').textContent = item.fileName || 'Submitted file';
        document.getElementById('assignmentSubmittedFileType').textContent = assignmentFileType(item.fileName);
        document.getElementById('assignmentSubmittedFileActions').hidden = false;
      }
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
    let selectedAssignmentFile = null;

    function ownSubmissionFor(assignmentId) {
      return STUDENT_SUBMISSIONS.find(function (record) {
        return record.assignmentId === String(assignmentId);
      });
    }

    function openAssignmentSubmissionModal(assignmentId) {
      const assignment = ASSIGNMENTS.find(function (item) {
        return item.id === String(assignmentId);
      });
      if (!assignment) return;

      activeSubmissionAssignmentId = assignment.id;
      const ownSubmission = ownSubmissionFor(assignment.id);
      const hasOnlineSubmission = Boolean(ownSubmission?.fileName);
      const limitReached = replacementLimitReached(assignment, ownSubmission);
      const readOnlyElective = isElectiveAssignment(assignment) && assignment.electiveMembershipActive === false;
      const downloadUrl = ownSubmission?.fileUrl
        ? window.EDUGNAY_API.getAssignmentSubmissionDownloadUrl(assignment.id, ownSubmission.id) : null;
      document.getElementById('assignmentSubmittedFile').hidden = !ownSubmission?.fileName;
      document.getElementById('assignmentSubmittedFileLabel').textContent = 'Current submission';
      document.getElementById('assignmentSubmittedFileName').textContent = ownSubmission?.fileName || '';
      document.getElementById('assignmentSubmittedFileType').textContent = assignmentFileType(ownSubmission?.fileName);
      document.getElementById('assignmentSubmittedFileActions').hidden = !downloadUrl;
      document.getElementById('assignmentSubmittedFileView').href = downloadUrl
        ? window.EDUGNAY_API.getAssignmentSubmissionPreviewUrl(assignment.id, ownSubmission.id) : '';
      const submittedFileDownload = document.getElementById('assignmentSubmittedFileDownload');
      submittedFileDownload.href = downloadUrl || '';
      document.getElementById('assignmentSubmittedFileView').hidden = false;
      submittedFileDownload.hidden = false;
      const submissionDownload = document.getElementById('assignmentHistoryDownload');
      submissionDownload.hidden = true;
      submissionDownload.removeAttribute('href');
      document.getElementById('submissionModalTitle').textContent = readOnlyElective
        ? 'Elective submission details'
        : limitReached ? 'Submission details'
        : assignment.onlineSubmissionEnabled
        ? hasOnlineSubmission ? 'Replace submission' : 'Submit assignment'
        : 'Assignment details';
      document.getElementById('submissionModalSub').textContent = [assignment.title, assignment.subject].filter(Boolean).join(' · ');
      document.getElementById('assignmentDetailTeacher').textContent = assignment.teacher || '—';
      document.getElementById('assignmentDetailDueDate').textContent = assignment.dueDate
        ? formatDate(assignment.dueDate)
        : '—';
      showAssignmentDueBadge(assignment);
      document.getElementById('assignmentDetailInstructions').textContent = assignment.instructions ||
        "No additional instructions were provided.";
      showAssignmentScore(assignment);

      const submissionForm = document.getElementById('assignmentSubmissionForm');
      const submitButton = document.getElementById('assignmentSubmissionSubmit');
      const today = assignment.schoolCurrentDate || new Date().toLocaleDateString('en-CA');
      const pastDue = assignment.dueDate && assignment.dueDate < today;
      const canSubmitOnline = assignment.onlineSubmissionEnabled === true && (!pastDue || assignment.allowLateSubmissions)
        && (!pastDue || !assignment.academicTermStatus || assignment.academicTermStatus === 'active')
        && !readOnlyElective && !limitReached;
      submissionForm.hidden = !canSubmitOnline;
      submitButton.hidden = !canSubmitOnline;
      document.getElementById('assignmentSubmissionCancel').textContent = canSubmitOnline ? 'Cancel' : 'Close';
      submitButton.innerHTML = '<i data-lucide="send" style="width:13px;height:13px;"></i> ' +
        (hasOnlineSubmission ? 'Replace file' : 'Submit work');
      const onlineNotice = document.getElementById('assignmentOnlineNotice');
      onlineNotice.textContent = readOnlyElective
        ? hasOnlineSubmission ? 'Enrollment ended · previous submission available' : 'Enrollment ended'
        : limitReached ? 'Replacement limit reached'
        : pastDue && !assignment.allowLateSubmissions ? 'Submission deadline passed'
        : canSubmitOnline
        ? 'Online submission available'
        : 'Submit in class';
      onlineNotice.classList.toggle('is-available', canSubmitOnline);
      onlineNotice.classList.toggle('is-classroom', !canSubmitOnline);
      const replacementNotice = document.getElementById('assignmentReplacementNotice');
      replacementNotice.hidden = !assignment.onlineSubmissionEnabled || readOnlyElective || limitReached;
      if (!replacementNotice.hidden) {
        const remaining = Math.max(0, assignment.maxResubmissions - Number(ownSubmission?.resubmissionCount || 0));
        replacementNotice.classList.toggle('is-warning', hasOnlineSubmission && remaining === 1);
        replacementNotice.textContent = assignment.maxResubmissions == null
          ? 'File replacements are unlimited.'
          : !hasOnlineSubmission
            ? assignment.maxResubmissions === 0
              ? 'You cannot replace the file after your first upload.'
              : `After your first upload, you can replace the file ${remaining} ${remaining === 1 ? 'time' : 'times'}.`
            : remaining === 1 ? '1 replacement remaining. Make sure this is the right file before replacing it.'
              : `${remaining} replacements remaining.`;
      }

      const fileInput = document.getElementById('assignmentSubmissionFile');
      fileInput.value = '';
      selectedAssignmentFile = null;
      document.getElementById('assignmentDropzoneText').textContent = 'Choose a file or drag it here';
      document.getElementById('assignmentSubmissionFileHint').textContent = 'PDF, Word, PowerPoint, or Excel · up to 10 MB';
      document.getElementById('assignmentSubmissionFileHint').style.color = '';
      document.getElementById('assignmentDropzone').classList.remove('is-invalid', 'is-dragging');
      submitButton.disabled = true;

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
      selectedAssignmentFile = null;
    }

    function validateAssignmentSubmission() {
      const hint = document.getElementById('assignmentSubmissionFileHint');
      const zone = document.getElementById('assignmentDropzone');
      const button = document.getElementById('assignmentSubmissionSubmit');
      const file = selectedAssignmentFile;
      const supportedTypes = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];
      const extension = file?.name.split('.').pop().toLowerCase();
      const error = !file ? 'Choose a file before submitting.'
        : !supportedTypes.includes(extension) ? 'Choose a supported file type.'
        : file.size > 10 * 1024 * 1024 ? 'Choose a file smaller than 10 MB.' : '';
      button.disabled = Boolean(error);
      zone.classList.toggle('is-invalid', Boolean(error && file));
      document.getElementById('assignmentDropzoneText').textContent = file
        ? file.name : 'Choose a file or drag it here';
      hint.textContent = error || 'PDF, Word, PowerPoint, or Excel · up to 10 MB';
      hint.style.color = error ? 'var(--red)' : '';
      return !error;
    }

    function handleAssignmentDrop(event) {
      event.preventDefault();
      const dropzone = document.getElementById('assignmentDropzone');
      dropzone.classList.remove('is-dragging');
      const files = event.dataTransfer?.files;
      if (files?.length !== 1) {
        selectedAssignmentFile = null;
        document.getElementById('assignmentDropzoneText').textContent = 'Choose a file or drag it here';
        document.getElementById('assignmentSubmissionSubmit').disabled = true;
        document.getElementById('assignmentSubmissionFileHint').textContent = 'Drop one file at a time.';
        dropzone.classList.add('is-invalid');
        return;
      }
      selectedAssignmentFile = files[0];
      validateAssignmentSubmission();
    }

    async function submitStudentAssignment() {
      if (!activeSubmissionAssignmentId || !validateAssignmentSubmission()) return;

      const button = document.getElementById('assignmentSubmissionSubmit');
      if (button.disabled) return;
      const originalLabel = button.innerHTML;
      button.disabled = true;
      button.textContent = 'Submitting...';
      const file = selectedAssignmentFile;
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
        button.innerHTML = originalLabel;
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
      const fileInput = document.getElementById('assignmentSubmissionFile');
      const dropzone = document.getElementById('assignmentDropzone');
      fileInput.addEventListener('change', () => { selectedAssignmentFile = fileInput.files[0] || null; validateAssignmentSubmission(); });
      dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('is-dragging'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
      dropzone.addEventListener('drop', handleAssignmentDrop);
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
