(() => {
  const workspace = document.getElementById('teacher-section-workspace');
  const classId = new URLSearchParams(window.location.search).get('classId');
  if (!workspace || classId === null) return;
  let electiveClass = null;
  let roster = [];
  let studentRoster = [];
  let assignments = [];
  let attendance = null;
  let attendanceRequestId = 0;
  let qrReader = null;
  let qrControls = null;
  let qrStream = null;
  let qrLoop = false;
  let qrSession = null;
  let qrDraftRecords = [];
  let qrScanInFlight = false;
  let assignmentGradeWorkspace = null;
  let assignmentGradeRequest = 0;
  let headerGradeWorkspacePromise = null;
  let assignmentsRequest = 0;
  let materialsRequest = 0;
  const loadedTabs = new Set();
  const pendingTabs = new Map();
  let attendanceDay = '';

  const escapeHtml = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const canEdit = () => Boolean(electiveClass && electiveClass.yearStatus === 'active'
    && electiveClass.classActive && electiveClass.offeringActive && electiveClass.teacherStatus === 'active');
  const canEditAssignmentStatus = assignment => Boolean(canEdit() && electiveClass.activePeriodId
    && String(assignment?.academicPeriodId) === String(electiveClass.activePeriodId));
  const toast = (message, type = 'success') => window.showAppToast?.(message, type);

  function publishedGradeTone(grade, policy) {
    const threshold = Number(policy?.passingGradeThreshold ?? 75);
    if (grade >= threshold) return 'grade-pass';
    return grade >= Math.max(0, threshold - 5) ? 'grade-warn' : 'grade-fail';
  }

  function updateHeaderGradeStatus(workspaceData) {
    if (!electiveClass || String(electiveClass.electiveClassId) !== classId) return;
    const encodedCountNode = document.getElementById('sectionEncodedCount');
    encodedCountNode.hidden = true;
    const term = workspaceData?.term;
    document.getElementById('sectionPeriodName').textContent = term?.name || electiveClass.activePeriodName || 'Grading period unavailable';
    const yearNode = document.querySelector('[data-school-year]');
    if (yearNode) yearNode.textContent = electiveClass.schoolYear || '';
    document.getElementById('sectionPeriodMeta')?.removeAttribute('hidden');
    if (!term) {
      document.getElementById('sectionEncodingStatus').textContent = 'No active grading period';
      return;
    }
    const scope = workspaceData.scope || {};
    if (scope.yearStatus !== 'active' || term.status !== 'active' || !canEdit()) {
      document.getElementById('sectionEncodingStatus').textContent = 'Read only';
      return;
    }
    if (!scope.policy) {
      document.getElementById('sectionEncodingStatus').textContent = 'Grading rules unavailable';
      return;
    }
    const students = workspaceData.students || [];
    const items = workspaceData.items || [];
    const scoreByKey = new Map((workspaceData.scores || []).map(score => [
      `${String(score.studentId)}:${String(score.gradingItemId)}`,
      score.score
    ]));
    const encodedCount = items.length ? students.filter(student => items.every(item => {
      const score = scoreByKey.get(`${String(student.studentId || student.id)}:${String(item.id)}`);
      const value = Number(score);
      return score !== null && score !== undefined && score !== ''
        && Number.isFinite(value) && value >= 0 && value <= Number(item.maxScore);
    })).length : 0;
    document.getElementById('sectionEncodingStatus').textContent = !encodedCount
      ? 'Encoding not started'
      : encodedCount === students.length ? 'Encoding complete' : 'Encoding in progress';
    encodedCountNode.textContent = `${encodedCount} of ${students.length} students encoded`;
    encodedCountNode.hidden = false;
  }

  function loadHeaderGradeWorkspace() {
    if (!headerGradeWorkspacePromise) {
      headerGradeWorkspacePromise = window.EDUGNAY_API.getShsGradeWorkspace({ electiveClassId: classId })
        .then(data => {
          updateHeaderGradeStatus(data);
          return data;
        })
        .catch(error => {
          document.getElementById('sectionEncodingStatus').textContent = 'Grade status unavailable';
          if (!document.getElementById('sectionPeriodName').textContent) {
            document.getElementById('sectionPeriodName').textContent = 'Grading period unavailable';
            document.getElementById('sectionPeriodMeta')?.removeAttribute('hidden');
          }
          throw error;
        });
    }
    return headerGradeWorkspacePromise;
  }

  function unavailable(message) {
    document.getElementById('sectionHeaderName').textContent = 'Class unavailable';
    document.getElementById('sectionSubjectName').textContent = message;
    document.getElementById('sectionStudentCount').textContent = '0';
    window.TeacherClassViews?.renderStudents({
      columns: [{ key: 'number', label: '#' }, { key: 'student', label: 'Student' }, { key: 'lrn', label: 'LRN' }],
      meta: 'Class roster unavailable',
      empty: { icon: 'book-x', title: 'Class unavailable', text: message }
    });
    window.TeacherClassViews?.renderAttendanceRows({ empty: { icon: 'book-x', title: 'Class unavailable', text: message } });
    const attendancePanel = document.querySelector('#content-attendance .attendance-entry-panel');
    if (attendancePanel) setAttendanceActionsUnavailable(attendancePanel);
    const warning = document.getElementById('attLockBanner');
    warning.hidden = false;
    warning.style.display = 'flex';
    warning.querySelector('.publish-info-title').textContent = 'Attendance unavailable';
    warning.querySelector('.publish-info-sub').textContent = message;
    for (const selector of ['#content-assignments .panel-head-actions button', '#content-materials .panel-head-actions button']) {
      const button = document.querySelector(selector);
      if (button) button.hidden = true;
    }
    window.TeacherClassViews?.renderAttendanceHistory({ error: message });
    window.TeacherClassViews?.renderAssignments([], { icon: 'book-x', title: 'Class unavailable', text: message });
    window.TeacherClassViews?.renderMaterials([], { icon: 'book-x', title: 'Class unavailable', text: message });
    window.TeacherClassViews?.renderScoreTable({
      host: document.querySelector('#content-scores .panel'),
      empty: { noItems: { icon: 'book-x', title: 'Class unavailable', text: message } }
    });
    window.EDUGNAY_PAGE_LOADING.ready();
  }

  function renderPage() {
    const gradeNumber = String(electiveClass.gradeName || '').match(/\d+/)?.[0] || '';
    document.getElementById('sectionGradeLabel').textContent = electiveClass.gradeName || 'Elective class';
    document.getElementById('sectionHeaderName').textContent = electiveClass.className;
    document.getElementById('sectionSubjectName').textContent = electiveClass.subjectName;
    document.getElementById('sectionSubjectSelect').hidden = true;
    document.getElementById('sectionStudentCount').textContent = String(Number(electiveClass.enrolledCount || 0));
    document.getElementById('sectionAdviserMeta').hidden = true;
    if (electiveClass.activePeriodName) {
      document.getElementById('sectionPeriodName').textContent = electiveClass.activePeriodName;
      document.getElementById('sectionPeriodMeta').removeAttribute('hidden');
    }
    document.querySelector('[data-school-year]').textContent = electiveClass.schoolYear || '';
    document.getElementById('sectionEncodingStatus').innerHTML = canEdit()
      ? '' : 'Read only';
    document.querySelector('#tab-students .tab-count').textContent = String(electiveClass.enrolledCount || 0);
    document.querySelector('#tab-assignments .tab-count').textContent = '—';
    document.querySelector('#tab-materials .tab-count').textContent = '—';
    document.getElementById('attendancePanelSub').textContent = 'Attendance for this class and date.';
    document.getElementById('scorePanelTitle').textContent = 'Score Recording: ' + electiveClass.subjectName;
    document.getElementById('scoreSectionName').textContent = electiveClass.className;
    document.getElementById('assignmentPanelTitle').textContent = 'Assignments: ' + electiveClass.subjectName;
    document.getElementById('assignmentPanelSub').textContent = 'Assignments for this class.';
    document.querySelector('#content-materials .panel-sub').textContent = `${electiveClass.className} · ${electiveClass.subjectName} · 0 files uploaded`;
    const assignmentButton = document.querySelector('#content-assignments .panel-head-actions button');
    if (assignmentButton) {
      assignmentButton.hidden = !canEdit();
      assignmentButton.onclick = () => {
        document.getElementById('assignSubjectInput').value = electiveClass.subjectName || '';
        document.querySelector('#addAssignmentModal .modal-sub').textContent = 'Create an assignment for ' + electiveClass.className + '.';
        document.getElementById('assignGradingInput').checked = false;
        document.getElementById('assignGradingFields').hidden = true;
        window.openModal('addAssignmentModal');
        void prepareAssignmentGrading(false);
      };
    }
    const assignmentSubmit = document.querySelector('#addAssignmentModal .modal-foot .btn-save');
    if (assignmentSubmit) assignmentSubmit.onclick = createAssignment;
    const uploadButton = document.querySelector('#content-materials .panel-head-actions button');
    if (uploadButton) {
      uploadButton.hidden = !canEdit();
      uploadButton.onclick = () => {
        document.querySelector('#uploadModal .modal-sub').textContent = 'Students in ' + electiveClass.className + ' can access published files.';
        window.openModal('uploadModal');
      };
    }
    document.getElementById('materialUploadSubmit').onclick = uploadMaterial;
    const qrModal = document.getElementById('qrAttendanceModal');
    qrModal.addEventListener('click', event => { if (event.target === qrModal) stopQrCamera(); });
    qrModal.addEventListener('keydown', event => { if (event.key === 'Escape') stopQrCamera(); });
    window.addEventListener('edugnay:teacher-materials-changed', event => {
      if (String(event.detail?.classId) === String(electiveClass.electiveClassId)) void loadTab('materials', { force: true });
    });
    void loadHeaderGradeWorkspace().catch(() => {});
    window.lucide?.createIcons();
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    const activeTab = ['students', 'scores', 'attendance', 'assignments', 'materials'].includes(requestedTab) ? requestedTab : 'students';
    if (activeTab !== 'assignments') void loadAssignments({ countOnly: true });
    if (activeTab !== 'materials') void loadMaterials({ countOnly: true });
    return window.switchTab?.(activeTab);
  }

  async function loadStudents({ preserve = false } = {}) {
    const columns = [
      { key: 'number', label: '#' },
      { key: 'student', label: 'Student' },
      { key: 'schoolEmail', label: 'School Email', render: student => `<span class="student-num">${escapeHtml(student.schoolEmail || '—')}</span>` },
      { key: 'attendanceRate', label: 'Attendance Rate', render: student => `<span class="badge badge-${student.attendanceTone || 'gray'}">${escapeHtml(student.attendanceRate ?? '—')}</span>` },
      { key: 'grade', label: 'Final Grade', periodName: 'Current period', render: student => `<span class="published-grade-value ${student.grade == null ? 'grade-unavailable' : student.gradeTone || ''}">${student.grade == null ? '—' : escapeHtml(student.grade)}</span>` }
    ];
    if (!preserve) window.TeacherClassViews.renderStudents({ columns, loading: true });
    try {
      const data = await window.EDUGNAY_API.getShsElectiveRoster(electiveClass.electiveClassId);
      const students = data.students || [];
      studentRoster = students;
      window.TeacherClassViews.renderStudents({
        students,
        columns,
        meta: `${electiveClass.className} · ${students.length} enrolled ${students.length === 1 ? 'student' : 'students'}`,
        empty: { icon: 'users', title: 'No students enrolled', text: 'Confirmed class placements will appear here.' },
        details: true
      });
      const progressByStudent = new Map(students.map(student => [String(student.id), { ...student, attendanceRate: '—', grade: null }]));
      const errors = new Set();
      const updateStudents = () => window.TeacherClassViews.renderStudents({
        students: students.map(student => progressByStudent.get(String(student.id)) || student),
        columns,
        meta: `${electiveClass.className} · ${students.length} enrolled ${students.length === 1 ? 'student' : 'students'}${errors.size ? ` · ${[...errors].join(' · ')}` : ''}`,
        empty: { icon: 'users', title: 'No students enrolled', text: 'Confirmed class placements will appear here.' },
        details: true
      });
      const attendanceLoad = window.EDUGNAY_API.getShsElectiveAttendanceHistory(electiveClass.electiveClassId).then(history => {
        const sessions = Array.isArray(history.sessions) ? history.sessions : [];
        const attendanceByStudent = new Map();
        sessions.forEach(session => (session.students || []).forEach(record => {
          const id = String(record.id);
          if (!attendanceByStudent.has(id)) attendanceByStudent.set(id, []);
          if (record.attendanceStatus) attendanceByStudent.get(id).push(record.attendanceStatus);
        }));
        progressByStudent.forEach((student, id) => {
          const statuses = attendanceByStudent.get(id) || [];
          if (!statuses.length) return;
          const attended = statuses.filter(status => ['present', 'late', 'excused'].includes(String(status).toLowerCase())).length;
          const rate = Math.round(attended / statuses.length * 100);
          student.attendanceRate = `${rate}%`;
          student.attendanceTone = rate >= 90 ? 'green' : rate >= 75 ? 'orange' : 'red';
        });
        updateStudents();
      }).catch(() => {
        errors.add('Attendance rates unavailable');
        progressByStudent.forEach(student => { student.attendanceRate = 'Unavailable'; });
        updateStudents();
      });
      const gradeLoad = loadHeaderGradeWorkspace().then(workspace => {
        const published = new Map((workspace.published || [])
          .filter(item => item.finalGrade != null)
          .map(item => [String(item.studentId), Number(item.finalGrade)]));
        (workspace.students || []).forEach(student => {
          const row = progressByStudent.get(String(student.studentId || student.id));
          if (row) {
            row.grade = published.get(String(student.studentId || student.id)) ?? null;
            row.gradeTone = row.grade == null ? 'grade-unavailable' : publishedGradeTone(row.grade, workspace.scope?.policy);
          }
        });
        columns[4].periodName = workspace.term?.name || 'Current period';
        updateStudents();
      }).catch(() => {
        errors.add('Final grades unavailable');
        progressByStudent.forEach(student => { student.grade = null; student.gradeTone = 'grade-unavailable'; });
        updateStudents();
      });
      await Promise.allSettled([attendanceLoad, gradeLoad]);
      return true;
    } catch (error) {
      if (!preserve) window.TeacherClassViews.renderStudents({ columns, meta: 'Students unavailable', empty: { icon: 'triangle-alert', title: 'Students unavailable', text: error.message } });
      else toast(error.message || 'Students could not refresh.', 'error');
      return false;
    }
  }

  function invalidateStudentListTab() {
    loadedTabs.delete('students');
  }

  function localToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  }

  async function loadAttendance(date = '', { preserve = false } = {}) {
    const panel = document.querySelector('#content-attendance .attendance-entry-panel');
    if (!panel) return;
    const requestId = ++attendanceRequestId;
    const loadedDate = attendance?.attendanceDate || attendance?.currentDate;
    const keepCurrent = preserve && attendance && (!date || date === loadedDate);
    if (!keepCurrent) {
      attendance = null;
      roster = [];
      setAttendanceActionsUnavailable(panel);
      document.getElementById('attPanelTitle').textContent = 'Attendance';
      document.getElementById('attendancePanelSub').innerHTML = '';
      for (const id of ['countP', 'countA', 'countL', 'countE']) document.getElementById(id).textContent = '—';
      window.TeacherClassViews.renderAttendanceRows({ loading: true });
    }
    try {
      const loaded = await window.EDUGNAY_API.getShsElectiveAttendance(electiveClass.electiveClassId, date);
      if (requestId !== attendanceRequestId) return false;
      attendance = loaded;
      roster = attendance.students || [];
      renderAttendance();
      return true;
    } catch (error) {
      if (requestId !== attendanceRequestId) return false;
      if (!keepCurrent) {
        attendance = null;
        document.getElementById('attendancePanelSub').textContent = 'Attendance unavailable';
        window.TeacherClassViews.renderAttendanceRows({ empty: { icon: 'triangle-alert', title: 'Attendance unavailable', text: error.message } });
        const warning = document.getElementById('attLockBanner');
        warning.hidden = false;
        warning.style.display = 'flex';
        warning.querySelector('.publish-info-title').textContent = 'Attendance unavailable';
        warning.querySelector('.publish-info-sub').textContent = error.message || 'Reload the Attendance tab and try again.';
      } else toast(error.message || 'Attendance could not refresh.', 'error');
      return false;
    }
  }

  function setAttendanceActionsUnavailable(panel) {
    const saveButton = panel.querySelector('.attendance-entry-actions .top-btn.primary');
    const allPresentButton = panel.querySelector('.attendance-entry-actions button[data-page-click="p5026ce80c219"]');
    const qrButton = document.getElementById('qrAttendanceButton');
    for (const button of [saveButton, allPresentButton, qrButton]) {
      if (!button) continue;
      button.disabled = true;
      button.onclick = null;
    }
  }

  async function loadAttendanceHistory({ preserve = false } = {}) {
    if (!preserve) window.TeacherClassViews.renderAttendanceHistory({ loading: true });
    try {
      const result = await window.EDUGNAY_API.getShsElectiveAttendanceHistory(electiveClass.electiveClassId);
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      const dates = [...new Set(sessions.map(session => session.attendanceDate).filter(Boolean))];
      const students = new Map();
      const records = [];
      sessions.forEach(session => (session.students || []).forEach(student => {
        const studentId = String(student.id);
        if (!students.has(studentId)) students.set(studentId, student);
        records.push({ studentId, date: session.attendanceDate, status: student.attendanceStatus });
      }));
      window.TeacherClassViews.renderAttendanceHistory({
        students: [...students.values()], dates, records,
        emptyText: 'Saved attendance records for this class will appear here.'
      });
      return true;
    } catch (error) {
      if (!preserve) window.TeacherClassViews.renderAttendanceHistory({ error: error.message || 'Attendance history could not be loaded.' });
      else toast(error.message || 'Attendance history could not refresh.', 'error');
      return false;
    }
  }

  function renderAttendance() {
    const panel = document.querySelector('#content-attendance .attendance-entry-panel');
    if (!panel) return;
    const date = attendance.attendanceDate || attendance.currentDate || localToday();
    const editable = attendance.canEdit && canEdit();
    const qrToday = date === (attendance.currentDate || localToday());
    const dateInput = document.getElementById('attDate');
    dateInput.value = date;
    dateInput.min = electiveClass.yearStartDate || '';
    dateInput.max = electiveClass.yearEndDate < (attendance.currentDate || localToday()) ? electiveClass.yearEndDate : attendance.currentDate || localToday();
    dateInput.onchange = event => loadAttendance(event.target.value);
    const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('attPanelTitle').textContent = date === (attendance.currentDate || localToday()) ? 'Attendance: Today' : `Attendance: ${dateLabel}`;
    document.getElementById('attendancePanelSub').textContent = `${electiveClass.className} · ${electiveClass.subjectName}`;
    const counts = Object.fromEntries(['present', 'absent', 'late', 'excused'].map(status => [status, roster.filter(student => (student.attendanceStatus || '') === status).length]));
    document.getElementById('countP').textContent = counts.present;
    document.getElementById('countA').textContent = counts.absent;
    document.getElementById('countL').textContent = counts.late;
    document.getElementById('countE').textContent = counts.excused;
    const saveButton = panel.querySelector('.attendance-entry-actions .top-btn.primary');
    const allPresentButton = panel.querySelector('.attendance-entry-actions button[data-page-click="p5026ce80c219"]');
    const qrButton = document.getElementById('qrAttendanceButton');
    saveButton.disabled = !editable || !roster.length;
    saveButton.onclick = saveAttendance;
    if (allPresentButton) {
      allPresentButton.disabled = !editable;
      allPresentButton.onclick = () => {
        panel.querySelectorAll('.att-btn-group').forEach(group => setAtt(group.querySelector('.att-btn.P'), 'P'));
        updateAttCount();
      };
    }
    qrButton.disabled = !editable || !qrToday || !roster.length || attendance.session?.status === 'confirmed';
    qrButton.onclick = () => openQrAttendance();
    const recordsByStudent = Object.fromEntries(roster.map(student => [String(student.id), student]));
    window.TeacherClassViews.renderAttendanceRows({
      students: roster, recordsByStudent, editable,
      empty: { icon: 'users', title: 'No students enrolled', text: 'Confirmed class placements will appear here.' }
    });
    const warning = document.getElementById('attLockBanner');
    const readOnly = !editable;
    const pastLocked = date < (attendance.currentDate || localToday()) && !attendance.canEdit;
    warning.hidden = !readOnly;
    warning.style.display = readOnly ? 'flex' : 'none';
    if (readOnly) {
      warning.querySelector('.publish-info-title').textContent = pastLocked
        ? 'Past attendance is read-only' : 'Attendance is read-only';
      warning.querySelector('.publish-info-sub').textContent = pastLocked
        ? 'To allow changes for this date, ask your school administrator to enable “Allow Teachers to Edit Past Attendance” in System Config.'
        : 'This class is not available for attendance changes.';
    }
    window.lucide?.createIcons();

  }

  async function saveAttendance() {
    if (!attendance || !attendance.canEdit || !canEdit()) return;
    const button = document.querySelector('#content-attendance .attendance-entry-actions .top-btn.primary');
    const date = document.getElementById('attDate').value;
    if (!roster.length || date !== (attendance.attendanceDate || attendance.currentDate)) return;
    const requestId = attendanceRequestId;
    const statusByCode = { P: 'present', A: 'absent', L: 'late', E: 'excused' };
    const records = [...document.querySelectorAll('#attTbody tr[data-student-id]')].map(row => ({
      studentId: row.dataset.studentId,
      status: statusByCode[row.querySelector('.att-btn.selected')?.textContent.trim()] || 'pending',
      remarks: row.querySelector('[data-attendance-remark]').value.trim()
    }));
    if (records.length !== roster.length || records.some(record => record.status === 'pending'))
      return toast('Set an attendance status for every student before saving.', 'error');
    button.disabled = true;
    try {
      const saved = await window.EDUGNAY_API.saveShsElectiveAttendance(electiveClass.electiveClassId, { attendanceDate: date, records });
      if (requestId !== attendanceRequestId) return;
      attendance = saved;
      roster = attendance.students || [];
      renderAttendance();
      invalidateStudentListTab();
      void loadAttendanceHistory({ preserve: true });
      toast('Attendance saved.');
    } catch (error) {
      toast(error.message || 'Attendance could not be saved.', 'error');
      if (requestId === attendanceRequestId) button.disabled = false;
    }
  }

  async function openQrAttendance() {
    if (!attendance) return toast('Attendance is unavailable. Reload the Attendance tab and try again.', 'error');
    const today = attendance.currentDate || localToday();
    if (document.getElementById('attDate').value !== today) await loadAttendance(today);
    if (!attendance) return toast('Attendance could not be loaded for today.', 'error');
    try {
      qrSession = await window.EDUGNAY_API.getShsElectiveQrAttendance(electiveClass.electiveClassId);
      if (qrSession.session?.status === 'confirmed') throw new Error('Today\'s attendance has already been confirmed. Use manual attendance to make corrections.');
      (qrSession.students || []).filter(student => student.isScanned).forEach(student => {
        const row = document.querySelector(`#attTbody tr[data-student-id="${student.id}"]`);
        if (!row || row.dataset.manualChoice) return;
        const button = row.querySelector('.att-btn.P');
        row.querySelectorAll('.att-btn').forEach(item => {
          item.classList.toggle('selected', item === button);
          item.setAttribute('aria-pressed', String(item === button));
        });
      });
      updateAttCount();
      document.getElementById('qrAttendanceSection').textContent = `${electiveClass.className} Â· ${electiveClass.subjectName}`;
      document.getElementById('qrAttendanceDate').textContent = today;
      document.getElementById('qrAttendanceRuleText').textContent = 'Scanned students are marked present. Review or change each student’s status before confirming attendance.';
      document.querySelector('#qrAttendanceModal .modal-sub').textContent = 'Scan and review this class roster.';
      document.getElementById('qrScannerStartButton').onclick = startQrCamera;
      document.getElementById('qrScannerStopButton').onclick = stopQrCamera;
      document.getElementById('qrAttendanceReviewButton').onclick = openQrAttendanceFinalReview;
      document.getElementById('qrAttendanceBackButton').onclick = () => showQrAttendanceReviewMode(false);
      document.getElementById('qrAttendanceApplyButton').onclick = confirmQrAttendance;
      document.querySelectorAll('#qrAttendanceModal .modal-close, #qrAttendanceModal .qr-attendance-close').forEach(button => {
        button.onclick = () => { stopQrCamera(); window.closeModal('qrAttendanceModal'); };
      });
      document.getElementById('qrAttendanceFinalReview').hidden = true;
      document.getElementById('qrAttendanceScanGroups').hidden = false;
      window.TeacherClassViews.setQrAttendanceReviewing(false);
      renderQrWorkspace();
      window.openModal('qrAttendanceModal');
      document.querySelector('#qrAttendanceModal .modal-close')?.focus();
      window.lucide?.createIcons();
    } catch (error) { toast(error.message || 'QR attendance could not be started.', 'error'); }
  }

  function renderQrWorkspace() {
    if (!qrSession) return;
    const students = qrSession.students || [];
    window.TeacherClassViews.renderQrAttendanceScans({
      students,
      scannedIds: students.filter(student => student.isScanned).map(student => student.id)
    });
  }

  function openQrAttendanceFinalReview() {
    if (!qrSession?.session?.id) return toast('Scan at least one student before reviewing attendance.', 'error');
    stopQrCamera();
    const students = qrSession?.students || [];
    qrDraftRecords = students.map(student => ({
      studentId: String(student.id),
      status: (() => {
        const row = document.querySelector(`#attTbody tr[data-student-id="${student.id}"]`);
        const code = row?.dataset.manualChoice;
        return { P: 'present', A: 'absent', L: 'late', E: 'excused' }[code] ||
          (student.isScanned ? 'present' : 'pending');
      })()
    }));
    window.TeacherClassViews.renderQrAttendanceFinalReview({
      students,
      statusByStudent: new Map(qrDraftRecords.map(record => [record.studentId, record.status])),
      progressLabel: (_missing, total) => `${total} students ready to confirm`,
      onChange: (studentId, status) => {
        const record = qrDraftRecords.find(item => item.studentId === String(studentId));
        if (record) record.status = status;
        const row = document.querySelector(`#attTbody tr[data-student-id="${studentId}"]`);
        const code = { present: 'P', absent: 'A', late: 'L', excused: 'E' }[status];
        const button = code && row?.querySelector(`.att-btn.${code}`);
        if (button) setAtt(button, code);
      }
    });
    window.TeacherClassViews.setQrAttendanceReviewing(true);
    document.getElementById('qrAttendanceScanGroups').hidden = true;
    document.getElementById('qrAttendanceFinalReview').hidden = false;
    document.getElementById('qrScannerStartButton').hidden = true;
    document.getElementById('qrScannerStopButton').hidden = true;
    document.getElementById('qrAttendanceReviewButton').hidden = true;
    document.getElementById('qrAttendanceBackButton').hidden = false;
    document.getElementById('qrAttendanceApplyButton').hidden = false;
  }

  function showQrAttendanceReviewMode(reviewing) {
    if (reviewing) return openQrAttendanceFinalReview();
    qrDraftRecords = [];
    window.TeacherClassViews.setQrAttendanceReviewing(false);
    document.getElementById('qrAttendanceScanGroups').hidden = false;
    document.getElementById('qrAttendanceFinalReview').hidden = true;
    document.getElementById('qrScannerStartButton').hidden = false;
    document.getElementById('qrAttendanceReviewButton').hidden = false;
    document.getElementById('qrAttendanceBackButton').hidden = true;
    document.getElementById('qrAttendanceApplyButton').hidden = true;
  }

  async function startQrCamera() {
    const video = document.getElementById('qrScannerVideo');
    if (!video || qrSession?.session?.status === 'confirmed') return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
      qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = qrStream;
      await video.play();
      const status = document.getElementById('qrScannerStatus');
      document.getElementById('qrScannerEmpty').hidden = true;
      document.getElementById('qrScannerStartButton').hidden = true;
      document.getElementById('qrScannerStopButton').hidden = false;
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        qrLoop = true;
        const scanFrame = async () => {
          if (!qrLoop || !video.isConnected) return;
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) await handleScannedQr(codes[0].rawValue);
          } catch { /* Keep scanning while the camera is active. */ }
          if (qrLoop) requestAnimationFrame(scanFrame);
        };
        requestAnimationFrame(scanFrame);
      } else if (window.ZXingBrowser?.BrowserQRCodeReader) {
        qrReader = new window.ZXingBrowser.BrowserQRCodeReader();
        qrControls = await qrReader.decodeFromVideoDevice(undefined, video, (result, error) => {
          if (result?.getText) void handleScannedQr(result.getText());
          if (error && error.name !== 'NotFoundException' && status) status.textContent = 'Camera is active. Hold a QR code steady inside the frame.';
        });
      } else throw new Error('QR scanning is not supported in this browser.');
    } catch (error) {
      const status = document.getElementById('qrScannerStatus');
      if (status) status.textContent = error.message || 'Camera could not be started.';
      stopQrCamera();
    }
  }

  async function handleScannedQr(rawValue) {
    if (qrScanInFlight) return;
    const token = window.EDUGNAY_CONFIG.parseAttendanceQrPayload(rawValue);
    if (!token) return;
    const status = document.getElementById('qrScannerStatus');
    qrScanInFlight = true;
    try {
      let result;
      if (qrSession?.session?.id) {
        result = await window.EDUGNAY_API.scanShsElectiveQrAttendance(qrSession.session.id, token);
      } else {
        qrSession = await window.EDUGNAY_API.startShsElectiveQrAttendance(electiveClass.electiveClassId, token);
        result = qrSession.scanResult;
      }
      if (result.scanned && result.student) {
        const student = qrSession.students.find(item => String(item.id) === String(result.student.id));
        if (student) { student.isScanned = true; student.attendanceStatus = 'present'; }
        const row = document.querySelector(`#attTbody tr[data-student-id="${result.student.id}"]`);
        if (row && !row.dataset.manualChoice) {
          const button = row.querySelector('.att-btn.P');
          row.querySelectorAll('.att-btn').forEach(item => {
            item.classList.toggle('selected', item === button);
            item.setAttribute('aria-pressed', String(item === button));
          });
          updateAttCount();
        }
        if (status) status.textContent = `${result.student.displayName} scanned.`;
        renderQrWorkspace();
      } else if (status) status.textContent = result.duplicate ? 'This learner was already scanned.' : 'QR could not be accepted.';
    } catch (error) { if (status) status.textContent = error.message || 'QR could not be accepted.'; }
    finally { qrScanInFlight = false; }
  }

  async function confirmQrAttendance() {
    if (!qrSession?.session?.id || qrDraftRecords.some(record => record.status === 'pending')) {
      return toast('Scan a student and set a status for every student before confirming.', 'error');
    }
    stopQrCamera();
    const records = qrDraftRecords.map(record => ({
      studentId: record.studentId,
      status: record.status,
      remarks: document.querySelector(`#attTbody tr[data-student-id="${record.studentId}"] [data-attendance-remark]`)?.value.trim() || ''
    }));
    try {
      qrSession = await window.EDUGNAY_API.confirmShsElectiveQrAttendance(qrSession.session.id, records);
      invalidateStudentListTab();
      qrDraftRecords = [];
      toast('QR attendance confirmed.');
      window.closeModal('qrAttendanceModal');
      await loadAttendance(attendance.attendanceDate, { preserve: true });
    } catch (error) { toast(error.message || 'QR attendance could not be confirmed.', 'error'); }
  }

  function stopQrCamera() {
    qrLoop = false;
    qrScanInFlight = false;
    qrControls?.stop?.(); qrControls = null;
    qrStream?.getTracks().forEach(track => track.stop()); qrStream = null;
    try { qrReader?.reset?.(); } catch { /* no-op */ }
    qrReader = null;
    const start = document.getElementById('qrScannerStartButton');
    const stop = document.getElementById('qrScannerStopButton');
    if (start) start.hidden = false;
    if (stop) stop.hidden = true;
  }

  function formatShortDate(value) {
    if (!value) return 'No due date';
    const parsed = new Date(String(value).length === 10 ? value + 'T00:00:00' : value);
    return Number.isNaN(parsed.getTime()) ? 'Due date unavailable'
      : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function loadAssignments({ countOnly = false, preserve = false } = {}) {
    const request = ++assignmentsRequest;
    if (!countOnly && !preserve) window.TeacherClassViews.renderAssignments([], { loading: true, label: 'Loading assignments', rows: 3 });
    try {
      const data = await window.EDUGNAY_API.getAssignments({ electiveClassId: electiveClass.electiveClassId });
      if (request !== assignmentsRequest) return false;
      const loaded = Array.isArray(data) ? data : [];
      document.getElementById('assignmentCount').textContent = String(loaded.length);
      if (countOnly) return true;
      assignments = loaded;
      let counts = null;
      let unavailableCounts = 0;
      try {
        const rosterResult = await window.EDUGNAY_API.getShsElectiveRoster(electiveClass.electiveClassId);
        if (request !== assignmentsRequest) return false;
        const students = rosterResult.students || [];
        const results = await Promise.allSettled(assignments.map(item => window.EDUGNAY_API.getAssignmentSubmissions(item.id)));
        if (request !== assignmentsRequest) return false;
        counts = new Map(results.map((result, index) => {
          if (result.status !== 'fulfilled') { unavailableCounts++; return [String(assignments[index].id), null]; }
          return [String(assignments[index].id), {
            submitted: students.filter(student => result.value.some(record => String(record.studentId) === String(student.id)
              && record.status === 'submitted')).length,
            total: students.length
          }];
        }));
      } catch { unavailableCounts = assignments.length; }
      document.getElementById('assignmentPanelSub').textContent = unavailableCounts
        ? `Some submission counts could not be loaded for ${unavailableCounts} assignment${unavailableCounts === 1 ? '' : 's'}.`
        : 'Assignments can be linked to an assessment in Score Recording.';
      const items = assignments.map(item => {
        const count = counts?.get(String(item.id));
        const actions = [{
          label: item.onlineSubmissionEnabled || !canEditAssignmentStatus(item) ? 'View Status' : 'Update Status',
          icon: item.onlineSubmissionEnabled || !canEditAssignmentStatus(item) ? 'eye' : 'check-square',
          onClick: () => window.TeacherClassViews.openElectiveAssignmentStatus(item.id)
        }];
        if (item.onlineSubmissionEnabled) actions.push({
          label: 'View Submissions', icon: 'inbox', onClick: () => window.TeacherClassViews.openElectiveAssignmentSubmissions(item.id)
        });
        if (canEdit()) actions.push(
          { label: 'Edit Assignment', icon: 'pencil', menu: true, onClick: () => window.openEditAssignmentModal?.(item.id) },
          { label: item.gradingItemId ? 'Delete Assignment & Component' : 'Delete Assignment', icon: 'trash-2', menu: true, danger: true, onClick: () => window.openTeacherDeleteModal?.('assignment', item.id, item.title) }
        );
        return {
          id: item.id,
          title: item.title,
          subjectName: item.subjectName || electiveClass.subjectName,
          dueLabel: formatShortDate(item.dueDate || item.dueAt),
          gradingLabel: `${window.TeacherClassViews.shsAssignmentGradingLabel(item)} · Online submissions ${item.onlineSubmissionEnabled ? 'enabled' : 'disabled'}`,
          submittedCount: count?.submitted ?? null,
          totalCount: count?.total ?? null,
          statusLabel: item.publicationStatus === 'draft' ? 'Draft' : item.publicationStatus === 'published' ? 'Published' : '',
          actions
        };
      });
      window.TeacherClassViews.renderAssignments(items, {
        icon: 'clipboard-check', title: 'No assignments yet', text: 'Assignments created for this class will appear here.'
      });
      return true;
    } catch (error) {
      if (request !== assignmentsRequest) return false;
      if (!preserve) {
        assignments = [];
        document.getElementById('assignmentCount').textContent = '—';
        if (!countOnly) window.TeacherClassViews.renderAssignments([], { icon: 'triangle-alert', title: 'Assignments unavailable', text: error.message });
      } else toast(error.message || 'Assignments could not refresh.', 'error');
      return false;
    }
  }

  async function createAssignment(event) {
    event.preventDefault();
    const button = document.querySelector('#addAssignmentModal .modal-foot .btn-save');
    const title = document.getElementById('assignTitleInput').value.trim();
    const description = document.getElementById('assignInstructionsInput').value.trim();
    const dueDate = document.getElementById('assignDueInput').value;
    if (!title || !dueDate) return toast('Enter an assignment title and due date.', 'error');
    const limitChoice = document.querySelector('input[name="assignResubmissionLimit"]:checked');
    const maxResubmissions = limitChoice?.value ? Number(limitChoice.value) : null;
    let grade;
    try { grade = assignmentGradePayload(false); }
    catch (error) { return toast(error.message, 'error'); }
    button.disabled = true;
    try {
      await window.EDUGNAY_API.createShsElectiveAssignment(electiveClass.electiveClassId, {
        title, description, dueAt: dueDate + 'T23:59:00',
        onlineSubmissionEnabled: document.getElementById('assignOnlineSubmissionInput').checked,
        maxResubmissions,
        status: 'published', grade
      });
      window.closeModal('addAssignmentModal');
      await loadTab('assignments', { force: true });
      const scoresRefreshed = await refreshScoresAfterAssignment();
      toast(scoresRefreshed ? 'Assignment added.' : 'Assignment added, but Score Recording could not refresh.',
        scoresRefreshed ? 'success' : 'info');
    } catch (error) {
      toast(error.message || 'The assignment could not be added.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function prepareAssignmentGrading(edit, assignment = null) {
    const request = ++assignmentGradeRequest;
    const toggle = document.getElementById(edit ? 'editAssignmentGradingInput' : 'assignGradingInput');
    const fields = document.getElementById(edit ? 'editAssignmentGradingFields' : 'assignGradingFields');
    const category = document.getElementById(edit ? 'editAssignmentCategoryInput' : 'assignCategoryInput');
    const partsGroup = document.getElementById(edit ? 'editAssignmentExamPartGroup' : 'assignExamPartGroup');
    const partsSelect = document.getElementById(edit ? 'editAssignmentExamPartInput' : 'assignExamPartInput');
    const maxScore = document.getElementById(edit ? 'editAssignmentMaxScoreInput' : 'assignMaxScoreInput');
    const help = toggle.closest('.school-toggle-row').querySelector('small');
    toggle.closest('.school-toggle-row').hidden = false;
    toggle.disabled = true;
    toggle.checked = Boolean(assignment?.gradingItemId);
    fields.hidden = !toggle.checked;
    help.textContent = 'Checking this class’s grading period…';
    assignmentGradeWorkspace = null;
    try {
      const workspace = await window.EDUGNAY_API.getShsGradeWorkspace({ electiveClassId: electiveClass.electiveClassId });
      if (request !== assignmentGradeRequest) return;
      assignmentGradeWorkspace = workspace;
      const components = workspace.scope?.policy?.components || [];
      const linked = (workspace.items || []).find(item => String(item.id) === String(assignment?.gradingItemId));
      category.innerHTML = components.map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)} (${Number(item.weight) || 0}%)</option>`).join('');
      category.value = linked?.componentCode || components[0]?.code || '';
      const updateParts = () => {
        const component = components.find(item => item.code === category.value);
        const parts = Object.entries(component?.examParts || {});
        partsGroup.hidden = !parts.length;
        partsSelect.innerHTML = parts.map(([code, value]) => `<option value="${escapeHtml(code)}">${escapeHtml(value?.name || code.replaceAll('_', ' '))}</option>`).join('');
        if (linked?.examPartCode) partsSelect.value = linked.examPartCode;
      };
      category.onchange = updateParts;
      updateParts();
      maxScore.value = linked?.maxScore || '';
      const available = canEdit() && workspace.term?.status === 'active' && components.length > 0;
      toggle.disabled = Boolean(linked) || !available;
      help.textContent = linked ? 'Already linked to a score component.'
        : available ? 'Add this assignment as a graded component.'
          : 'Score Recording is unavailable for this class or grading period.';
    } catch (error) {
      if (request !== assignmentGradeRequest) return;
      help.textContent = error.message || 'Score Recording is unavailable.';
    }
  }

  function assignmentGradePayload(edit, assignment = null) {
    const toggle = document.getElementById(edit ? 'editAssignmentGradingInput' : 'assignGradingInput');
    if (!toggle.checked || assignment?.gradingItemId) return null;
    const category = document.getElementById(edit ? 'editAssignmentCategoryInput' : 'assignCategoryInput');
    const partsGroup = document.getElementById(edit ? 'editAssignmentExamPartGroup' : 'assignExamPartGroup');
    const partsSelect = document.getElementById(edit ? 'editAssignmentExamPartInput' : 'assignExamPartInput');
    const maxScore = document.getElementById(edit ? 'editAssignmentMaxScoreInput' : 'assignMaxScoreInput');
    if (!assignmentGradeWorkspace?.term?.id || !category.value || !(Number(maxScore.value) > 0)
      || (!partsGroup.hidden && !partsSelect.value)) throw new Error('Choose a grading category and enter a valid highest possible score.');
    return { academicTermId: assignmentGradeWorkspace.term.id, componentCode: category.value,
      examPartCode: partsGroup.hidden ? null : partsSelect.value, maxScore: maxScore.value };
  }

  async function loadMaterials({ countOnly = false, preserve = false } = {}) {
    const request = ++materialsRequest;
    if (!countOnly && !preserve) window.TeacherClassViews.renderMaterials([], { loading: true, label: 'Loading learning materials', rows: 3 });
    try {
      const data = await window.EDUGNAY_API.getMaterials({ electiveClassId: electiveClass.electiveClassId });
      if (request !== materialsRequest) return false;
      const materials = Array.isArray(data) ? data : [];
      document.querySelector('#tab-materials .tab-count').textContent = String(materials.length);
      if (!countOnly) document.querySelector('#content-materials .panel-sub').textContent =
        `${electiveClass.className} · ${electiveClass.subjectName} · ${materials.length} files uploaded`;
      if (!countOnly) window.TeacherClassViews.renderMaterials(materials.map(item => ({
        ...item, canEdit: canEdit(), canDelete: canEdit()
      })), { icon: 'folder-open', title: 'No learning materials', text: 'Files shared with this class will appear here.' });
      return true;
    } catch (error) {
      if (request !== materialsRequest) return false;
      if (!preserve) {
        if (!countOnly) window.TeacherClassViews.renderMaterials([], { icon: 'triangle-alert', title: 'Materials unavailable', text: error.message });
        document.querySelector('#tab-materials .tab-count').textContent = '—';
      } else toast(error.message || 'Materials could not refresh.', 'error');
      return false;
    }
  }

  async function uploadMaterial(event) {
    event.preventDefault();
    const button = document.getElementById('materialUploadSubmit');
    const file = document.getElementById('fileInput').files?.[0];
    const title = document.getElementById('materialTitleInput').value.trim();
    const status = document.getElementById('materialVisibilityInput').value;
    if (!file || !title) return toast('Choose a file and enter a title.', 'error');
    button.disabled = true;
    try {
      await window.EDUGNAY_API.uploadShsElectiveMaterial(electiveClass.electiveClassId, { title, status, file });
      window.closeModal('uploadModal');
      toast('Learning material uploaded.');
      await loadTab('materials', { force: true });
    } catch (error) {
      toast(error.message || 'The material could not be uploaded.', 'error');
    } finally {
      button.disabled = !document.getElementById('fileInput').files?.length;
    }
  }
  async function loadGrades(academicTermId = '') {
    const panel = document.querySelector('#content-scores .panel');
    if (!panel) return false;
    if (!window.AcademixShsGradebook?.mount) {
      window.TeacherClassViews.renderScoreTable({
        host: panel,
        empty: { noItems: { icon: 'triangle-alert', title: 'Gradebook unavailable', text: 'Reload the page to open Score Recording.' } }
      });
      return false;
    }
    const scope = { electiveClassId: electiveClass.electiveClassId };
    if (academicTermId) scope.academicTermId = academicTermId;
    return window.AcademixShsGradebook.show(panel, scope);
  }

  function loadTab(tab, { force = false } = {}) {
    if (!electiveClass) return Promise.resolve();
    if (tab === 'attendance' && attendanceDay && attendanceDay !== localToday()) force = true;
    if (!force && loadedTabs.has(tab)) return Promise.resolve(true);
    if (!force && pendingTabs.has(tab)) return pendingTabs.get(tab);
    const preserve = loadedTabs.has(tab);
    const loaders = {
      students: () => loadStudents({ preserve }),
      scores: async () => {
        if (force && loadedTabs.has('scores')) {
          const refreshed = await window.AcademixShsGradebook?.refresh?.();
          if (refreshed != null) return refreshed;
        }
        return loadGrades();
      },
      attendance: async () => {
        const date = attendanceDay && attendanceDay !== localToday() ? localToday() : document.getElementById('attDate').value || '';
        const [current, history] = await Promise.all([loadAttendance(date, { preserve }), loadAttendanceHistory({ preserve })]);
        if (current) attendanceDay = localToday();
        return current && history;
      },
      assignments: () => loadAssignments({ preserve }),
      materials: () => loadMaterials({ preserve })
    };
    const pending = Promise.resolve().then(() => loaders[tab]?.()).then(result => {
      if (result === false || (tab === 'scores' && result !== true)) loadedTabs.delete(tab);
      else loadedTabs.add(tab);
      return result;
    }).finally(() => { if (pendingTabs.get(tab) === pending) pendingTabs.delete(tab); });
    pendingTabs.set(tab, pending);
    return pending;
  }

  async function refreshScoresAfterAssignment() {
    try {
      if (pendingTabs.has('scores')) await pendingTabs.get('scores');
      if (!loadedTabs.has('scores')) return true;
      return await loadTab('scores', { force: true }) === true;
    } catch {
      loadedTabs.delete('scores');
      return false;
    }
  }

  window.AcademixElectiveClass = {
    canEdit,
    canEditAssignmentStatus,
    getClass: () => electiveClass,
    getStudent: id => studentRoster.find(student => String(student.id) === String(id)) || null,
    updateHeaderGradeStatus,
    syncShsPublishedGrades: workspace => {
      headerGradeWorkspacePromise = Promise.resolve(workspace);
      invalidateStudentListTab();
    },
    getAssignment: id => assignments.find(item => String(item.id) === String(id)) || null,
    prepareAssignmentGrading,
    assignmentGradePayload,
    loadTab,
    refreshScoresAfterAssignment,
    refresh: tab => loadTab(tab, { force: true }),
    stopCamera: stopQrCamera
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopQrCamera(); });
  window.addEventListener('pagehide', stopQrCamera);

  document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('addScoreComponentButton').disabled = true;
    document.getElementById('publishGradesButton').disabled = true;
    if (!/^\d+$/.test(classId)) return unavailable('Choose a class from My Classes.');
    try {
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'teacher') return unavailable('This teaching workspace is available to the assigned teacher only.');
      const result = await window.EDUGNAY_API.getShsTeachingClasses();
      electiveClass = (result.classes || []).find(item => String(item.electiveClassId) === classId) || null;
      if (!electiveClass) return unavailable('You are not assigned to this elective class, or it is no longer available.');
      await renderPage();
      window.EDUGNAY_PAGE_LOADING.ready();
    } catch (error) {
      unavailable(error.status === 404 ? 'SHS elective teaching is currently closed.' : error.message || 'The class could not be loaded.');
    }
  });
})();
