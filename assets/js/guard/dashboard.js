(async function () {
  const welcome = document.getElementById('guardWelcome');
  const errorPanel = document.getElementById('guardError');
  const baseUrl = String(window.EDUGNAY_APP_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
  const video = document.getElementById('guardScannerVideo');
  const cameraPlaceholder = document.getElementById('guardCameraPlaceholder');
  const schoolYearCard = document.getElementById('guardSchoolYearCard');
  const schoolYearLabel = document.getElementById('guardSchoolYear');
  const verified = document.getElementById('guardVerified');
  let code = '';
  let verifiedFetcherName = '';
  let busy = false;
  let stream = null;
  let readerControls = null;
  let scanFrame = null;
  let scanGeneration = 0;
  let cameraReadErrorShown = false;
  let photoUrl = null;
  let verifiedReturnFocus = null;
  let historyBusy = false;
  let historyReloadRequested = false;
  let historyRequestGeneration = 0;
  let historyCursor = null;
  let historyRecords = [];
  let historyTimeZone = 'Asia/Manila';

  function updateSchoolYear(value) {
    const schoolYear = String(value || schoolYearLabel.textContent || '').trim();
    schoolYearLabel.textContent = schoolYear || '—';
    schoolYearCard.hidden = false;
  }

  document.addEventListener('edugnay:school-context-updated', event => {
    const activeSchool = event.detail || window.EDUGNAY_API_SCHOOL_CONTEXT
      || window.EDUGNAY_CONFIG?.getActiveSchool?.();
    updateSchoolYear(activeSchool?.schoolYear);
  });

  async function request(path, body) {
    const response = await fetch(`${baseUrl}/pickup${path}`, { credentials: 'include',
      method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Pickup request failed.');
    return result;
  }

  async function counts() {
    const data = await request('/today');
    document.getElementById('guardPickedCount').textContent = data.pickedUp;
    document.getElementById('guardAwaitingCount').textContent = data.awaiting;
    const activeSchool = window.EDUGNAY_API_SCHOOL_CONTEXT || window.EDUGNAY_CONFIG?.getActiveSchool?.();
    updateSchoolYear(data.schoolYear || activeSchool?.schoolYear);
    const shortName = String(data.shortName || '').trim();
    if (shortName) {
      document.querySelectorAll('.brand-sub:not([data-platform-brand])').forEach(label => {
        label.textContent = shortName;
      });
    }
    return data;
  }

  function renderWeekCalendar() {
    const grid = document.getElementById('weekCalendarGrid');
    const rangeLabel = document.getElementById('weekRangeLabel');
    if (!grid) return;

    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    grid.innerHTML = dayLabels.map((label, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const isToday = date.toDateString() === today.toDateString();
      const classes = ['week-day'];
      if (isToday) classes.push('is-today');
      if (index > 4) classes.push('is-weekend');
      return `<div class="${classes.join(' ')}"${isToday ? ' aria-current="date"' : ''}>
        <span class="week-day-label">${label}</span>
        <span class="week-day-num">${date.getDate()}</span>
      </div>`;
    }).join('');

    if (rangeLabel) {
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const format = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      rangeLabel.textContent = `${format(monday)} – ${format(sunday)}`;
    }
  }

  async function loadHistory(append = false) {
    if (historyBusy) {
      if (!append) {
        historyRequestGeneration += 1;
        historyReloadRequested = true;
      }
      return;
    }
    historyBusy = true;
    const generation = ++historyRequestGeneration;
    const target = document.getElementById('guardPickupHistory');
    const more = document.getElementById('guardPickupMore');
    if (!append) more.hidden = true;
    const params = new URLSearchParams({ limit: '50' });
    const from = document.getElementById('guardPickupFrom').value;
    const to = document.getElementById('guardPickupTo').value;
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (append && historyCursor) params.set('cursor', historyCursor);
    try {
      const result = await request(`/history?${params}`);
      if (generation !== historyRequestGeneration) return;
      historyTimeZone = result.timeZone || 'Asia/Manila';
      const records = result.records || [];
      historyRecords = append ? historyRecords.concat(records) : records;
      if (historyRecords.length) {
        target.innerHTML = window.EDUGNAY_PICKUP_HISTORY.render(historyRecords, historyTimeZone);
      } else {
        target.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'calendar-days',
          title: 'No pickups found for this date',
          text: 'Completed handovers will appear here.'
        });
      }
      historyCursor = result.nextCursor;
      document.getElementById('guardPickupCount').textContent = window.EDUGNAY_PICKUP_HISTORY.countLabel(historyRecords.length, Boolean(historyCursor));
      more.hidden = !historyCursor;
      window.EDUGNAY_AVATAR.hydrate(target);
      window.lucide?.createIcons();
    } catch (error) {
      if (generation === historyRequestGeneration) {
        showAppToast(error.message, 'error');
      }
    } finally {
      historyBusy = false;
      if (historyReloadRequested) {
        historyReloadRequested = false;
        void loadHistory();
      }
    }
  }

  function setCameraPreview(isOn) {
    cameraPlaceholder.hidden = isOn;
  }

  function stopCamera() {
    scanGeneration += 1;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = null;
    readerControls?.stop();
    readerControls = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    setCameraPreview(false);
    document.getElementById('guardStartScan').hidden = false;
    document.getElementById('guardStopScan').hidden = true;
  }

  function clearVerification({ restoreFocus = true } = {}) {
    code = '';
    verifiedFetcherName = '';
    verified.classList.remove('open');
    verified.hidden = true;
    verified.inert = false;
    document.getElementById('guardCodeInput').value = '';
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    document.getElementById('guardFetcherPhoto').removeAttribute('src');
    const returnFocus = verifiedReturnFocus;
    verifiedReturnFocus = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }

  function renderStudents(students) {
    const container = document.getElementById('guardStudents');
    container.replaceChildren();
    for (const student of students) {
      const row = document.createElement('div');
      row.className = 'guard-student';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = student.studentName;
      const section = document.createElement('span');
      section.textContent = student.sectionName || '';
      details.append(name, section);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'top-btn primary';
      button.textContent = student.pickedUp ? 'Picked up today' : 'Confirm handover';
      button.disabled = student.pickedUp;
      button.dataset.studentId = student.studentId;
      button.setAttribute('aria-label', `${student.pickedUp ? 'Picked up' : 'Confirm handover for'} ${student.studentName}`);
      row.append(details, button);
      container.append(row);
    }
  }

  async function verify(value, returnFocus = document.getElementById('guardCodeInput')) {
    if (busy) return;
    busy = true;
    errorPanel.hidden = true;
    try {
      const result = await request('/verify', { code: value });
      const response = await fetch(`${baseUrl}/pickup/photo`, { credentials: 'include', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: value }) });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Fetcher photo is unavailable.');
      }
      const nextPhoto = URL.createObjectURL(await response.blob());
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = nextPhoto;
      code = value;
      verifiedFetcherName = result.fullName;
      verifiedReturnFocus = returnFocus?.isConnected ? returnFocus : document.getElementById('guardCodeInput');
      stopCamera();
      document.getElementById('guardFetcherPhoto').src = photoUrl;
      document.getElementById('guardFetcherName').textContent = result.fullName;
      document.getElementById('guardFetcherRelationship').textContent = result.relationship;
      renderStudents(result.students);
      verified.hidden = false;
      verified.classList.add('open');
      showAppToast('Credential verified. Check the person and student.');
      document.getElementById('guardVerifiedClose').focus();
    } catch (error) {
      clearVerification({ restoreFocus: false });
      showAppToast(error.message, 'error');
    } finally { busy = false; }
  }

  async function startCamera() {
    if (stream || !navigator.mediaDevices?.getUserMedia) {
      if (!stream) showAppToast('Camera access is unavailable on this browser or connection.', 'error');
      return;
    }
    let native = false;
    try {
      native = Boolean(window.BarcodeDetector && (!window.BarcodeDetector.getSupportedFormats
        || (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')));
    } catch { native = false; }
    if (!native && !window.ZXingBrowser?.BrowserQRCodeReader) {
      showAppToast('QR scanning is unavailable in this browser. Use the manual code.', 'info');
      return;
    }
    const generation = ++scanGeneration;
    cameraReadErrorShown = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (generation !== scanGeneration) { stream.getTracks().forEach(track => track.stop()); stream = null; return; }
      video.srcObject = stream;
      video.hidden = false;
      setCameraPreview(true);
      await video.play();
      document.getElementById('guardStartScan').hidden = true;
      document.getElementById('guardStopScan').hidden = false;
      showAppToast('Camera is on. Hold the Fetcher ID QR code in view.', 'info');
      if (native) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const scan = async () => {
          if (!stream || generation !== scanGeneration) return;
          try {
            const results = await detector.detect(video);
            if (results[0]?.rawValue) { stopCamera(); void verify(results[0].rawValue, document.getElementById('guardStartScan')); return; }
          } catch {
            if (!cameraReadErrorShown) {
              cameraReadErrorShown = true;
              showAppToast('The camera could not read the code. Try again or enter it manually.', 'error');
            }
          }
          if (stream && generation === scanGeneration) scanFrame = requestAnimationFrame(scan);
        };
        scanFrame = requestAnimationFrame(scan);
      } else {
        const reader = new window.ZXingBrowser.BrowserQRCodeReader();
        readerControls = await reader.decodeFromStream(stream, video, result => {
          if (result?.getText()) { stopCamera(); void verify(result.getText(), document.getElementById('guardStartScan')); }
        });
        if (generation !== scanGeneration) readerControls?.stop();
      }
    } catch (error) {
      stopCamera();
      showAppToast(error?.name === 'NotAllowedError'
        ? 'Camera permission was not granted.' : 'The camera could not be started.', 'error');
    }
  }

  document.getElementById('guardStartScan').addEventListener('click', startCamera);
  document.getElementById('guardStopScan').addEventListener('click', stopCamera);
  document.getElementById('guardVerifiedClose').addEventListener('click', clearVerification);
  document.getElementById('guardClearVerification').addEventListener('click', clearVerification);
  verified.addEventListener('click', event => {
    if (event.target === verified) clearVerification();
  });
  document.addEventListener('keydown', event => {
    if (verified.hidden) return;
    const otherModalOpen = [...document.querySelectorAll('.dashboard-modal-backdrop.open')]
      .some(backdrop => backdrop !== verified);
    if (otherModalOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearVerification();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...verified.querySelectorAll('button:not(:disabled)')]
      .filter(button => !button.hidden && button.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !verified.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !verified.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, true);
  window.initAcademicRangePickers(document.querySelector('.pickup-history-section'), {
    rowSelector: '.pickup-history-filters', startSelector: '#guardPickupFrom',
    endSelector: '#guardPickupTo', name: 'School pickup history', allowSameDay: true, allowClear: true
  });
  let historyReloadQueued = false;
  ['guardPickupFrom', 'guardPickupTo'].forEach(id => document.getElementById(id).addEventListener('change', () => {
    if (historyReloadQueued) return;
    historyReloadQueued = true;
    queueMicrotask(() => { historyReloadQueued = false; historyCursor = null; void loadHistory(); });
  }));
  document.getElementById('guardPickupToday').addEventListener('click', () => {
    const date = window.EDUGNAY_PICKUP_HISTORY.today(historyTimeZone);
    ['guardPickupFrom', 'guardPickupTo'].forEach(id => {
      const input = document.getElementById(id);
      input.value = date;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    historyCursor = null;
    void loadHistory();
  });
  document.getElementById('guardPickupMore').addEventListener('click', () => void loadHistory(true));
  document.getElementById('guardCodeForm').addEventListener('submit', event => {
    event.preventDefault();
    void verify(document.getElementById('guardCodeInput').value.trim(), event.submitter || document.getElementById('guardCodeInput'));
  });
  document.getElementById('guardStudents').addEventListener('click', async event => {
    const button = event.target.closest('button[data-student-id]');
    if (!button || busy || !code) return;
    const student = button.closest('.guard-student')?.querySelector('strong')?.textContent || 'this student';
    verified.inert = true;
    void window.confirmFetcherAction({
      title: 'Confirm student handover?',
      subtitle: 'This records the pickup and notifies linked parents.',
      contextLabel: 'Handing over', contextValue: student, icon: 'badge-check',
      message: `Confirm that you checked ${verifiedFetcherName || 'the fetcher'} and physically handed ${student} over.`,
      confirmLabel: 'Yes, Confirm handover', trigger: button,
      onConfirm: async () => {
        busy = true;
        button.disabled = true;
        let confirmed = false;
        try {
          await request('/confirm', { code, studentId: Number(button.dataset.studentId) });
          confirmed = true;
          button.textContent = 'Picked up today';
          showAppToast('Physical handover recorded.');
          await counts();
          historyCursor = null;
          await loadHistory();
        } catch (error) {
          showAppToast(confirmed
            ? 'Handover was recorded, but the dashboard could not refresh. Reload to verify it.'
            : error.message, confirmed ? 'info' : 'error');
          if (!confirmed) button.disabled = false;
        } finally { busy = false; }
      }
    }).then(() => {
      verified.inert = false;
      if (verified.hidden) return;
      const nextAction = [...document.querySelectorAll('#guardStudents button[data-student-id]:not(:disabled)')][0];
      (nextAction || document.getElementById('guardVerifiedClose')).focus();
    });
  });
  window.addEventListener('pagehide', () => { stopCamera(); clearVerification({ restoreFocus: false }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else { void counts().catch(() => {}); void loadHistory(); }
  });
  renderWeekCalendar();
  setCameraPreview(false);
  window.lucide?.createIcons();

  try {
    const user = await window.EDUGNAY_API.getCurrentUser();
    if (user?.role !== 'school_guard') {
      window.location.replace('../../index.html');
      return;
    }
    welcome.textContent = `Welcome back, ${user.firstName || user.displayName || 'Guard'}!`;
    try {
      const today = await counts();
      ['guardPickupFrom', 'guardPickupTo'].forEach(id => {
        const input = document.getElementById(id);
        input.value = today.schoolDate;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await loadHistory();
    }
    catch { errorPanel.textContent = 'Today’s pickup counts could not be loaded. Refresh to try again.';
      errorPanel.hidden = false; }
  } catch (error) {
    welcome.textContent = 'Account unavailable';
    errorPanel.textContent = error.status === 401
      ? 'Your session has ended. Sign in again to use this dashboard.'
      : 'Your account could not be loaded. Refresh the page and try again.';
    errorPanel.hidden = false;
  } finally {
    window.EDUGNAY_PAGE_LOADING?.ready();
  }
})();
