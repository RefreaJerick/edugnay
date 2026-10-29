(() => {
  const workspace = document.getElementById('teacher-section-workspace');
  const classId = new URLSearchParams(window.location.search).get('classId');
  if (!workspace || classId === null) return;
  let electiveClass = null;
  let roster = [];
  let studentRoster = [];
  let assignments = [];
  let attendance = null;
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

  const escapeHtml = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
  const canEdit = () => Boolean(electiveClass && electiveClass.yearStatus === 'active'
    && electiveClass.classActive && electiveClass.offeringActive && electiveClass.teacherStatus === 'active');
  const toast = (message, type = 'success') => window.showAppToast?.(message, type);

  function updateHeaderGradeStatus(workspaceData) {
    if (!electiveClass || String(electiveClass.electiveClassId) !== classId) return;
    const term = workspaceData?.term;
    document.getElementById('sectionPeriodName').textContent = term?.name || electiveClass.activePeriodName || 'No active grading period';
    const yearNode = document.querySelector('[data-school-year]');
    if (yearNode) yearNode.textContent = electiveClass.schoolYear || '';
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
    document.getElementById('sectionEncodingStatus').textContent = encodedCount
      ? `${encodedCount} of ${students.length} encoded`
      : 'Encoding not started';
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
    window.TeacherClassViews?.renderAttendanceHistory({ error: message });
    window.TeacherClassViews?.renderAssignments([], { icon: 'book-x', title: 'Class unavailable', text: message });
    window.TeacherClassViews?.renderMaterials([], { icon: 'book-x', title: 'Class unavailable', text: message });
    window.TeacherClassViews?.renderScoreTable({
      host: document.querySelector('#content-scores .panel'),
      empty: { noItems: { icon: 'book-x', title: 'Class unavailable', text: message } }
    });
  }

  function renderPage() {
    const gradeNumber = String(electiveClass.gradeName || '').match(/\d+/)?.[0] || '';
    document.getElementById('sectionGradeBadge').textContent = gradeNumber ? `G${gradeNumber}` : 'SHS';
    document.getElementById('sectionHeaderName').textContent = electiveClass.className;
    document.getElementById('sectionSubjectName').textContent = electiveClass.subjectName;
    document.getElementById('sectionSubjectSelect').hidden = true;
    document.getElementById('sectionStudentCount').textContent = String(Number(electiveClass.enrolledCount || 0));
    document.getElementById('sectionAdviserMeta').innerHTML = `<i data-lucide="user-round" aria-hidden="true"></i>${escapeHtml(electiveClass.teacherName || 'Assigned teacher')}`;
    document.getElementById('sectionPeriodName').textContent = electiveClass.activePeriodName || 'Loading grading period…';
    document.querySelector('[data-school-year]').textContent = electiveClass.schoolYear || '';
    document.getElementById('sectionEncodingStatus').textContent = canEdit() ? 'Loading grade status…' : 'Read only';
    document.querySelector('#tab-students .tab-count').textContent = String(electiveClass.enrolledCount || 0);
    document.querySelector('#tab-assignments .tab-count').textContent = '0';
    document.querySelector('#tab-materials .tab-count').textContent = '0';
    document.getElementById('attendancePanelSub').textContent = 'Attendance for this class and date.';
    document.getElementById('scorePanelTitle').textContent = 'Score Recording: ' + electiveClass.subjectName;
    document.getElementById('scoreSectionName').textContent = electiveClass.className;
    document.getElementById('assignmentPanelTitle').textContent = 'Assignments';
    document.getElementById('assignmentPanelSub').textContent = 'Assignments for this class.';
    document.querySelector('#content-materials .panel-sub').textContent = 'Materials for this class.';
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
      if (String(event.detail?.classId) === String(electiveClass.electiveClassId)) void loadMaterials();
    });
    void loadHeaderGradeWorkspace().catch(() => {});
    window.lucide?.createIcons();
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    window.switchTab?.(['students', 'scores', 'attendance', 'assignments', 'materials'].includes(requestedTab) ? requestedTab : 'students');
  }

  async function loadStudents() {
    const columns = [
      { key: 'number', label: '#' },
      { key: 'student', label: 'Student' },
      { key: 'schoolEmail', label: 'School Email', render: student => `<span class="student-num">${escapeHtml(student.schoolEmail || '—')}</span>` },
      { key: 'attendanceRate', label: 'Attendance Rate', render: student => `<span class="badge badge-${student.attendanceTone || 'gray'}">${escapeHtml(student.attendanceRate ?? '—')}</span>` },
      { key: 'grade', label: 'Final Grade', periodName: 'Current period', render: student => `<span class="published-grade-value ${student.grade == null ? 'grade-unavailable' : student.gradeTone || ''}">${student.grade == null ? '—' : escapeHtml(student.grade)}</span>` }
    ];
    window.TeacherClassViews.renderStudents({ columns, meta: 'Loading class roster...', empty: { icon: 'loader-circle', title: 'Loading students', text: 'The class roster is loading.' } });
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
          if (row) row.grade = published.get(String(student.studentId || student.id)) ?? null;
        });
        columns[4].periodName = workspace.term?.name || 'Current period';
        updateStudents();
      }).catch(() => {
        errors.add('Final grades unavailable');
        progressByStudent.forEach(student => { student.grade = 'Unavailable'; });
        updateStudents();
      });
      await Promise.allSettled([attendanceLoad, gradeLoad]);
    } catch (error) {
      window.TeacherClassViews.renderStudents({ columns, meta: 'Students unavailable', empty: { icon: 'triangle-alert', title: 'Students unavailable', text: error.message } });
    }
  }

  function localToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  }

  async function loadAttendance(date = '') {
    const panel = document.querySelector('#content-attendance .attendance-entry-panel');
    if (!panel) return;
    document.getElementById('attendancePanelSub').textContent = 'Loading class roster...';
    window.TeacherClassViews.renderAttendanceRows({ empty: { icon: 'loader-circle', title: 'Loading attendance', text: 'The class roster is loading.' } });
    try {
      attendance = await window.EDUGNAY_API.getShsElectiveAttendance(electiveClass.electiveClassId, date);
      roster = attendance.students || [];
      renderAttendance();
    } catch (error) {
      attendance = null;
      document.getElementById('attendancePanelSub').textContent = 'Attendance unavailable';
      window.TeacherClassViews.renderAttendanceRows({ empty: { icon: 'triangle-alert', title: 'Attendance unavailable', text: error.message } });
      document.getElementById('qrAttendanceButton').disabled = true;
    }
  }

  async function loadAttendanceHistory() {
    window.TeacherClassViews.renderAttendanceHistory({ loading: true });
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
    } catch (error) {
      window.TeacherClassViews.renderAttendanceHistory({ error: error.message || 'Attendance history could not be loaded.' });
    }
  }

  function renderAttendance() {
    const panel = document.querySelector('#content-attendance .attendance-entry-panel');
    if (!panel) return;
    const date = attendance.attendanceDate || attendance.currentDate || localToday();
    const editable = attendance.canEdit && canEdit();
    const qrDraft = attendance.session?.method === 'qr' && attendance.session?.status === 'draft';
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
    const allPresentButton = panel.querySelector('.attendance-entry-actions button[onclick^="markAll"]');
    const qrButton = document.getElementById('qrAttendanceButton');
    saveButton.disabled = !editable || qrDraft || !roster.length;
    saveButton.onclick = saveAttendance;
    if (allPresentButton) {
      allPresentButton.disabled = !editable;
      allPresentButton.onclick = () => {
        panel.querySelectorAll('.att-btn-group').forEach(group => setAtt(group.querySelector('.att-btn.P'), 'P'));
        updateAttCount();
      };
    }
    qrButton.disabled = !editable || !qrToday || !roster.length;
    qrButton.onclick = () => openQrAttendance();
    const recordsByStudent = Object.fromEntries(roster.map(student => [String(student.id), student]));
    window.TeacherClassViews.renderAttendanceRows({
      students: roster, recordsByStudent, editable,
      empty: { icon: 'users', title: 'No students enrolled', text: 'Confirmed class placements will appear here.' }
    });
    const warning = document.getElementById('attLockBanner');
    warning.hidden = !qrDraft;
    warning.style.display = qrDraft ? '' : 'none';
    warning.querySelector('.publish-info-title').textContent = 'QR attendance in progress';
    warning.querySelector('.publish-info-sub').textContent = 'Confirm the QR session before saving manual attendance.';
    window.lucide?.createIcons();

  }

  async function saveAttendance() {
    const button = document.querySelector('#content-attendance .attendance-entry-actions .top-btn.primary');
    const date = document.getElementById('attDate').value;
    const statusByCode = { P: 'present', A: 'absent', L: 'late', E: 'excused' };
    const records = [...document.querySelectorAll('#attTbody tr[data-student-id]')].map(row => ({
      studentId: row.dataset.studentId,
      status: statusByCode[row.querySelector('.att-btn.selected')?.textContent.trim()] || 'pending',
      remarks: row.querySelector('[data-attendance-remark]').value.trim()
    }));
    if (records.some(record => record.status === 'pending')) return toast('Set an attendance status for every student before saving.', 'error');
    button.disabled = true;
    try {
      attendance = await window.EDUGNAY_API.saveShsElectiveAttendance(electiveClass.electiveClassId, { attendanceDate: date, records });
      roster = attendance.students || [];
      renderAttendance();
      void loadAttendanceHistory();
      toast('Attendance saved.');
    } catch (error) { toast(error.message || 'Attendance could not be saved.', 'error'); button.disabled = false; }
  }

  async function openQrAttendance() {
    if (!attendance) return toast('Attendance is unavailable. Reload the Attendance tab and try again.', 'error');
    const today = attendance.currentDate || localToday();
    if (document.getElementById('attDate').value !== today) await loadAttendance(today);
    if (!attendance) return toast('Attendance could not be loaded for today.', 'error');
    try {
      qrSession = await window.EDUGNAY_API.getShsElectiveQrAttendance(electiveClass.electiveClassId);
      if (!qrSession.session) qrSession = await window.EDUGNAY_API.startShsElectiveQrAttendance(electiveClass.electiveClassId);
      document.getElementById('qrAttendanceSection').textContent = `${electiveClass.className} Â· ${electiveClass.subjectName}`;
      document.getElementById('qrAttendanceDate').textContent = today;
      document.getElementById('qrAttendanceRuleText').textContent = 'Scanned students are marked present. Review the roster before confirming attendance.';
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
    stopQrCamera();
    const students = qrSession?.students || [];
    qrDraftRecords = students.map(student => ({
      studentId: String(student.id),
      status: student.isScanned ? 'present' : 'absent'
    }));
    window.TeacherClassViews.renderQrAttendanceFinalReview({
      students,
      statusByStudent: new Map(qrDraftRecords.map(record => [record.studentId, record.status])),
      progressLabel: (_missing, total) => `${total} students ready to confirm`,
      onChange: (studentId, status) => {
        const record = qrDraftRecords.find(item => item.studentId === String(studentId));
        if (record) record.status = status;
      }
    });
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
    document.getElementById('qrAttendanceScanGroups').hidden = false;
    document.getElementById('qrAttendanceFinalReview').hidden = true;
    document.getElementById('qrScannerStartButton').hidden = false;
    document.getElementById('qrAttendanceReviewButton').hidden = false;
    document.getElementById('qrAttendanceBackButton').hidden = true;
    document.getElementById('qrAttendanceApplyButton').hidden = true;
  }

  async function startQrCamera() {
    const video = document.getElementById('qrScannerVideo');
    if (!video || qrSession?.session?.status !== 'draft') return;
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
    if (!qrSession?.session?.id || qrScanInFlight) return;
    const token = window.EDUGNAY_CONFIG.parseAttendanceQrPayload(rawValue);
    if (!token) return;
    const status = document.getElementById('qrScannerStatus');
    qrScanInFlight = true;
    try {
      const result = await window.EDUGNAY_API.scanShsElectiveQrAttendance(qrSession.session.id, token);
      if (result.scanned && result.student) {
        const student = qrSession.students.find(item => String(item.id) === String(result.student.id));
        if (student) { student.isScanned = true; student.attendanceStatus = 'present'; }
        if (status) status.textContent = `${result.student.displayName} scanned.`;
        renderQrWorkspace();
      } else if (status) status.textContent = result.duplicate ? 'This learner was already scanned.' : 'QR could not be accepted.';
    } catch (error) { if (status) status.textContent = error.message || 'QR could not be accepted.'; }
    finally { qrScanInFlight = false; }
  }

  async function confirmQrAttendance() {
    stopQrCamera();
    const records = qrDraftRecords.map(record => ({
      studentId: record.studentId,
      status: record.status,
      remarks: ''
    }));
    try {
      qrSession = await window.EDUGNAY_API.confirmShsElectiveQrAttendance(qrSession.session.id, records);
      qrDraftRecords = [];
      toast('QR attendance confirmed.');
      window.closeModal('qrAttendanceModal');
      await loadAttendance(attendance.attendanceDate);
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

  async function loadAssignments() {
    window.TeacherClassViews.renderAssignments([], { icon: 'loader-circle', title: 'Loading assignments', text: 'Assignments for this class are loading.' });
    try {
      const data = await window.EDUGNAY_API.getAssignments({ electiveClassId: electiveClass.electiveClassId });
      assignments = Array.isArray(data) ? data : [];
      document.getElementById('assignmentCount').textContent = String(assignments.length);
      const items = assignments.map(item => {
        const actions = [];
        if (item.onlineSubmissionEnabled) actions.push({
          label: 'View Submissions', icon: 'inbox', onClick: () => loadSubmissions(item.id)
        });
        if (canEdit()) actions.push(
          { label: 'Edit Assignment', icon: 'pencil', menu: true, onClick: () => window.openEditAssignmentModal?.(item.id) },
          { label: 'Delete Assignment', icon: 'trash-2', menu: true, danger: true, onClick: () => window.openTeacherDeleteModal?.('assignment', item.id, item.title) }
        );
        return {
          id: item.id,
          title: item.title,
          subjectName: item.subjectName || electiveClass.subjectName,
          dueLabel: formatShortDate(item.dueDate || item.dueAt),
          gradingLabel: item.onlineSubmissionEnabled ? 'Online submissions enabled' : 'Online submissions disabled',
          submittedCount: item.submittedCount ?? item.submissionCount,
          totalCount: item.totalCount,
          statusLabel: item.publicationStatus === 'draft' ? 'Draft' : item.publicationStatus === 'published' ? 'Published' : '',
          actions
        };
      });
      window.TeacherClassViews.renderAssignments(items, {
        icon: 'clipboard-check', title: 'No assignments yet', text: 'Assignments created for this class will appear here.'
      });
    } catch (error) {
      assignments = [];
      document.getElementById('assignmentCount').textContent = '0';
      window.TeacherClassViews.renderAssignments([], { icon: 'triangle-alert', title: 'Assignments unavailable', text: error.message });
    }
  }

  async function createAssignment(event) {
    event.preventDefault();
    const button = document.querySelector('#addAssignmentModal .modal-foot .btn-save');
    const title = document.getElementById('assignTitleInput').value.trim();
    const description = document.getElementById('assignInstructionsInput').value.trim();
    const dueDate = document.getElementById('assignDueInput').value;
    if (!title || !dueDate) return toast('Enter an assignment title and due date.', 'error');
    let grade;
    try { grade = assignmentGradePayload(false); }
    catch (error) { return toast(error.message, 'error'); }
    button.disabled = true;
    try {
      await window.EDUGNAY_API.createShsElectiveAssignment(electiveClass.electiveClassId, {
        title, description, dueAt: dueDate + 'T23:59:00',
        onlineSubmissionEnabled: document.getElementById('assignOnlineSubmissionInput').checked,
        status: 'published', grade
      });
      window.closeModal('addAssignmentModal');
      toast('Assignment added.');
      await loadAssignments();
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

  async function loadSubmissions(assignmentId) {
    const assignment = assignments.find(item => String(item.id) === String(assignmentId));
    const columns = [
      { key: 'studentName', label: 'Student', render: item => escapeHtml(item.studentName || 'Student') },
      { key: 'status', label: 'Status', render: item => escapeHtml(item.status || 'pending') },
      { key: 'submittedAt', label: 'Submitted at', render: item => escapeHtml(item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'Not submitted') },
      { key: 'file', label: 'File', render: item => {
        const fileUrl = item.fileName ? window.EDUGNAY_API.getAssignmentSubmissionDownloadUrl(assignmentId, item.id) : '';
        return fileUrl
          ? '<a class="row-btn view" href="' + escapeHtml(fileUrl) + '" target="_blank" rel="noopener">Download</a>'
          : '<span class="assignment-file-unavailable">No file</span>';
      } }
    ];
    window.TeacherClassViews.renderAssignmentSubmissions({
      subtitle: assignment?.title || 'Submissions for this class assignment', columns, loading: true
    });
    window.openModal('assignmentSubmissionsModal');
    try {
      const submissions = await window.EDUGNAY_API.getAssignmentSubmissions(assignmentId);
      window.TeacherClassViews.renderAssignmentSubmissions({
        subtitle: assignment?.title || 'Submissions for this class assignment',
        columns,
        rows: submissions,
        empty: { title: 'No submissions yet', text: 'Student submissions will appear here.' }
      });
    } catch (error) {
      window.TeacherClassViews.renderAssignmentSubmissions({ columns, error: error.message || 'Submissions could not be loaded.' });
    }
  }

  async function loadMaterials() {
    window.TeacherClassViews.renderMaterials([], { icon: 'loader-circle', title: 'Loading materials', text: 'Materials for this class are loading.' });
    try {
      const data = await window.EDUGNAY_API.getMaterials({ electiveClassId: electiveClass.electiveClassId });
      const materials = Array.isArray(data) ? data : [];
      document.querySelector('#tab-materials .tab-count').textContent = String(materials.length);
      window.TeacherClassViews.renderMaterials(materials.map(item => ({
        ...item, canEdit: canEdit(), canDelete: canEdit()
      })), { icon: 'folder-open', title: 'No learning materials', text: 'Files shared with this class will appear here.' });
    } catch (error) {
      document.querySelector('#tab-materials .tab-count').textContent = '0';
      window.TeacherClassViews.renderMaterials([], { icon: 'triangle-alert', title: 'Materials unavailable', text: error.message });
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
      await loadMaterials();
    } catch (error) {
      toast(error.message || 'The material could not be uploaded.', 'error');
    } finally {
      button.disabled = !document.getElementById('fileInput').files?.length;
    }
  }
  async function loadGrades(academicTermId = '') {
    const panel = document.querySelector('#content-scores .panel');
    if (!panel) return;
    if (!window.AcademixShsGradebook?.mount) {
      window.TeacherClassViews.renderScoreTable({
        host: panel,
        empty: { noItems: { icon: 'triangle-alert', title: 'Gradebook unavailable', text: 'Reload the page to open Score Recording.' } }
      });
      return;
    }
    const scope = { electiveClassId: electiveClass.electiveClassId };
    if (academicTermId) scope.academicTermId = academicTermId;
    await window.AcademixShsGradebook.mount(panel, scope);
  }

  function loadTab(tab) {
    if (!electiveClass) return Promise.resolve();
    const loaders = {
      students: () => loadStudents(),
      scores: () => loadGrades(),
      attendance: async () => { await loadAttendance(document.getElementById('attDate').value || ''); await loadAttendanceHistory(); },
      assignments: () => loadAssignments(),
      materials: () => loadMaterials()
    };
    return loaders[tab]?.();
  }

  window.AcademixElectiveClass = {
    canEdit,
    getClass: () => electiveClass,
    getStudent: id => studentRoster.find(student => String(student.id) === String(id)) || null,
    updateHeaderGradeStatus,
    getAssignment: id => assignments.find(item => String(item.id) === String(id)) || null,
    prepareAssignmentGrading,
    assignmentGradePayload,
    loadTab,
    refresh: loadTab,
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
      renderPage();
    } catch (error) {
      unavailable(error.status === 404 ? 'SHS elective teaching is currently closed.' : error.message || 'The class could not be loaded.');
    }
  });
})();
