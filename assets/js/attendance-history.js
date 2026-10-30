(function () {
  function createAttendanceHistory({ hasSelection = true } = {}) {
    const element = id => document.getElementById(id);
    const escape = value => window.EDUGNAY_CONFIG.escapeHtml(value);
    const empty = (icon, title, text) => window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon, title, text });
    const icons = () => window.lucide?.createIcons();
    let records = [];
    let today = '';
    let monthKey = '';
    let selectedDay = null;
    let loading = true;
    let error = '';
    let selected = hasSelection;

    function months() {
      const result = {};
      for (const record of records) {
        if (!(record.subjectId || record.electiveClassId) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) continue;
        const key = record.date.slice(0, 7);
        const day = Number(record.date.slice(8));
        if (!day) continue;
        const month = result[key] || (result[key] = {});
        const entry = month[day] || (month[day] = []);
        entry.push(record);
      }
      return result;
    }

    function renderSummary(month) {
      const strip = element('summary-strip');
      if (!month) {
        const message = loading ? 'Loading attendance...' : error ? 'Attendance is unavailable.'
          : !selected ? 'Select a linked child to view attendance.' : '';
        strip.hidden = !message;
        if (loading) {
          strip.innerHTML = window.EDUGNAY_CONFIG.renderPanelSkeleton({ kind: 'stat-cards', label: 'Loading monthly attendance summary', rows: 3 });
        } else strip.textContent = message;
        return;
      }
      strip.hidden = false;
      const entries = Object.values(month).flat();
      const count = status => entries.filter(record => record.status === status).length;
      strip.innerHTML = [
        ['green', 'check', count('present'), 'Subject sessions present', 'Present'],
        ['orange', 'clock', count('late'), 'Subject sessions late', 'Late'],
        ['red', 'circle-x', count('absent'), 'Subject sessions absent', 'Absent']
      ].map(([tone, icon, total, label, compactLabel]) => `
        <div class="stat-card ${tone}">
          <div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${icon}" style="width:18px;height:18px;"></i></div></div>
          <div class="stat-card-num">${total}</div><div class="stat-card-label"><span class="attendance-stat-label-full">${label}</span><span class="attendance-stat-label-compact">${compactLabel}</span></div><div class="stat-card-sub">Confirmed subject records</div>
        </div>`).join('');
    }

    function renderCalendar(month) {
      const grid = element('cal-grid');
      const prev = element('cal-prev');
      const next = element('cal-next');
      if (!selected || loading || error) {
        element('cal-month-label').textContent = 'Attendance history';
        prev.disabled = true;
        next.disabled = true;
        element('cal-today').disabled = true;
        grid.innerHTML = loading
          ? window.EDUGNAY_CONFIG.renderPanelSkeleton({ kind: 'calendar', label: 'Loading attendance calendar' })
          : empty('calendar', error ? 'Attendance unavailable' : 'No attendance calendar',
            error ? 'Try loading the attendance records again.' : selected ? 'No subject attendance has been recorded.' : 'Attendance dates will appear here when a child account is linked.');
        return;
      }
      const [year, monthNumber] = monthKey.split('-').map(Number);
      element('cal-month-label').textContent = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      prev.disabled = false;
      next.disabled = false;
      element('cal-today').disabled = monthKey === today.slice(0, 7);
      const firstDay = new Date(year, monthNumber - 1, 1).getDay();
      const offset = firstDay === 0 ? 6 : firstDay - 1;
      let cells = '<div class="cal-day empty"></div>'.repeat(offset);
      const entries = month || {};
      for (let day = 1; day <= new Date(year, monthNumber, 0).getDate(); day++) {
        const date = `${monthKey}-${String(day).padStart(2, '0')}`;
        const weekday = new Date(year, monthNumber - 1, day).getDay();
        const weekend = weekday === 0 || weekday === 6;
        const future = date > today;
        const entry = entries[day];
        const status = future ? 'future' : entry ? 'recorded' : weekend ? 'weekend' : '';
        const disabled = future || (weekend && !entry);
        cells += `<button class="cal-day ${status} ${date === today ? 'today' : ''}" ${disabled ? 'disabled' : ''} data-attendance-day="${day}" type="button"><div class="cal-day-num">${day}</div>${entry && !future ? '<div class="cal-day-dot"></div>' : ''}</button>`;
      }
      grid.innerHTML = cells;
    }

    function renderFlagged(month) {
      const list = element('flagged-list');
      if (!month) {
        list.innerHTML = loading
          ? window.EDUGNAY_CONFIG.renderPanelSkeleton({ kind: 'list', label: 'Loading flagged attendance days', rows: 3 })
          : empty('calendar-x', error ? 'Attendance unavailable' : 'No flagged days',
            error ? 'Try loading the attendance records again.' : selected ? 'No subject absences have been recorded for this month.' : 'Absence details will appear here when a child account is linked.');
        return;
      }
      const flagged = Object.keys(month).filter(day => month[day].some(record => record.status === 'absent')).sort((a, b) => Number(a) - Number(b));
      if (!flagged.length) {
        list.innerHTML = empty('calendar-check', 'No absences this month', 'No recorded subject absences for this month.');
        return;
      }
      const [year, monthNumber] = monthKey.split('-').map(Number);
      const monthAbbr = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'short' });
      list.innerHTML = flagged.map(day => `<button class="flag-row" data-attendance-day="${day}" type="button">
        <span class="flag-date-chip"><span class="flag-date-num">${day}</span><span class="flag-date-month">${monthAbbr}</span></span>
        <span class="flag-info"><span class="flag-day-label">${new Date(year, monthNumber - 1, Number(day)).toLocaleDateString('en-US', { weekday: 'long' })}</span><span class="flag-detail">Absent in one or more recorded subjects</span></span>
        <i data-lucide="chevron-right" style="width:15px;height:15px;" class="flag-chevron"></i></button>`).join('');
    }

    function renderDetail(month) {
      const subjects = month?.[selectedDay];
      const [year, monthNumber] = monthKey.split('-').map(Number);
      element('dayDetailModalTitle').textContent = new Date(year, monthNumber - 1, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!subjects?.length) {
        element('day-detail-modal-content').innerHTML = empty('calendar-x', 'No attendance records', 'No subject attendance is available for this day.');
        icons();
        return;
      }
      const badges = {
        present: ['green', 'check', 'Present'], late: ['orange', 'clock', 'Late'],
        pending: ['gray', 'minus', 'Pending'], excused: ['blue', '', 'Excused'], absent: ['red', 'x', 'Absent']
      };
      element('day-detail-modal-content').innerHTML = `<div>${subjects.map(record => {
        const [tone, icon, label] = badges[record.status] || badges.absent;
        const name = record.electiveClassId && record.className
          ? `${record.subjectName || 'Subject'} · ${record.className}` : record.subjectName || 'Subject';
        return `<div class="subject-att-row"><div class="subject-att-name">${escape(name)}</div><span class="badge badge-${tone}">${icon ? `<i data-lucide="${icon}" style="width:8px;height:8px;"></i> ` : ''}${label}</span></div>`;
      }).join('')}</div>`;
      icons();
    }

    function render() {
      const state = element('attendance-load-state');
      state.hidden = loading || !error;
      state.classList.toggle('is-error', Boolean(error));
      state.setAttribute('role', error ? 'alert' : 'status');
      element('attendance-load-message').textContent = error || '';
      element('attendance-retry').hidden = !error;
      const allMonths = months();
      const month = allMonths[monthKey];
      renderSummary(month);
      renderCalendar(month);
      renderFlagged(month);
      icons();
    }

    function closeDetail() { element('dayDetailModal').classList.remove('open'); }
    function selectDay(day) {
      if (!selected || loading || error) return;
      const [year, monthNumber] = monthKey.split('-').map(Number);
      const date = `${monthKey}-${String(day).padStart(2, '0')}`;
      const weekday = new Date(year, monthNumber - 1, day).getDay();
      const entry = months()[monthKey]?.[day];
      if (date > today || ((weekday === 0 || weekday === 6) && !entry)) return;
      const month = months()[monthKey] || {};
      selectedDay = day;
      renderDetail(month);
      element('dayDetailModal').classList.add('open');
    }
    function changeMonth(direction) {
      if (!selected || loading || error || !monthKey) return;
      const [year, monthNumber] = monthKey.split('-').map(Number);
      const next = new Date(Date.UTC(year, monthNumber - 1 + direction, 1));
      monthKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
      selectedDay = null;
      closeDetail();
      render();
    }
    function goToToday() {
      if (!selected || loading || error || !today) return;
      monthKey = today.slice(0, 7);
      selectedDay = null;
      closeDetail();
      render();
    }
    function setRecords(values, currentDate, hasStudent = true) {
      records = values;
      today = currentDate;
      selected = hasStudent;
      loading = false;
      error = '';
      monthKey = currentDate.slice(0, 7);
      selectedDay = null;
      closeDetail();
      render();
    }
    function setLoading() { loading = true; error = ''; records = []; today = ''; monthKey = ''; closeDetail(); render(); }
    function setError(message) { loading = false; error = message; records = []; today = ''; monthKey = ''; closeDetail(); render(); }

    for (const id of ['cal-grid', 'flagged-list']) {
      element(id).addEventListener('click', event => {
        const button = event.target.closest('[data-attendance-day]');
        if (button) selectDay(Number(button.dataset.attendanceDay));
      });
    }
    element('cal-prev').addEventListener('click', () => changeMonth(-1));
    element('cal-next').addEventListener('click', () => changeMonth(1));
    element('cal-today').addEventListener('click', goToToday);
    element('dayDetailModal').addEventListener('click', event => { if (event.target === element('dayDetailModal')) closeDetail(); });
    element('dayDetailModal').querySelector('.modal-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });

    return { setRecords, setLoading, setError, changeMonth, selectDay, closeDetail };
  }

  window.createAttendanceHistory = createAttendanceHistory;
})();
