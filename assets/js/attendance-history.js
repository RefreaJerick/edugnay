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
        if (!record.subjectId || !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) continue;
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
        strip.textContent = loading ? 'Loading attendance...' : error ? 'Attendance is unavailable.'
          : !selected ? 'Select a linked child to view attendance.' : 'No subject attendance has been recorded for this month.';
        return;
      }
      const entries = Object.values(month).flat();
      const count = status => entries.filter(record => record.status === status).length;
      strip.innerHTML = [
        ['green', 'check', 'Recorded', count('present'), 'Subject sessions present', 'Present', 'trend-up'],
        ['orange', 'clock', 'Needs attention', count('late'), 'Subject sessions late', 'Late', 'trend-neu'],
        ['red', 'circle-x', 'Review days', count('absent'), 'Subject sessions absent', 'Absent', 'trend-down']
      ].map(([tone, icon, trend, total, label, compactLabel, trendClass]) => `
        <div class="stat-card ${tone}">
          <div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${icon}" style="width:18px;height:18px;"></i></div><span class="stat-card-trend ${trendClass}">${trend}</span></div>
          <div class="stat-card-num">${total}</div><div class="stat-card-label"><span class="attendance-stat-label-full">${label}</span><span class="attendance-stat-label-compact">${compactLabel}</span></div><div class="stat-card-sub">Confirmed subject records</div>
        </div>`).join('');
    }

    function renderCalendar(allMonths, month) {
      const keys = Object.keys(allMonths).sort();
      const grid = element('cal-grid');
      const prev = element('cal-prev');
      const next = element('cal-next');
      if (!month) {
        element('cal-month-label').textContent = 'Attendance history';
        prev.disabled = true;
        next.disabled = true;
        grid.innerHTML = empty('calendar', loading ? 'Loading attendance' : error ? 'Attendance unavailable' : 'No attendance calendar',
          error ? 'Try loading the attendance records again.' : selected ? 'No subject attendance has been recorded.' : 'Attendance dates will appear here when a child account is linked.');
        return;
      }
      const [year, monthNumber] = monthKey.split('-').map(Number);
      element('cal-month-label').textContent = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      prev.disabled = keys.indexOf(monthKey) === 0;
      next.disabled = keys.indexOf(monthKey) === keys.length - 1;
      const firstDay = new Date(year, monthNumber - 1, 1).getDay();
      const offset = firstDay === 0 ? 6 : firstDay - 1;
      let cells = '<div class="cal-day empty"></div>'.repeat(offset);
      for (let day = 1; day <= new Date(year, monthNumber, 0).getDate(); day++) {
        const date = `${monthKey}-${String(day).padStart(2, '0')}`;
        const weekday = new Date(year, monthNumber - 1, day).getDay();
        const weekend = weekday === 0 || weekday === 6;
        const future = date > today;
        const entry = month[day];
        const status = weekend ? 'weekend' : future ? 'future' : entry ? 'recorded' : '';
        cells += `<button class="cal-day ${status} ${date === today ? 'today' : ''}" ${weekend || future ? 'disabled' : ''} data-attendance-day="${day}" type="button"><div class="cal-day-num">${day}</div>${entry && !future && !weekend ? '<div class="cal-day-dot"></div>' : ''}</button>`;
      }
      grid.innerHTML = cells;
    }

    function renderFlagged(month) {
      const list = element('flagged-list');
      if (!month) {
        list.innerHTML = empty('calendar-x', loading ? 'Loading attendance' : error ? 'Attendance unavailable' : 'No flagged days',
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
      if (!subjects) return;
      const [year, monthNumber] = monthKey.split('-').map(Number);
      element('dayDetailModalTitle').textContent = new Date(year, monthNumber - 1, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const badges = {
        present: ['green', 'check', 'Present'], late: ['orange', 'clock', 'Late'],
        pending: ['gray', 'minus', 'Pending'], excused: ['blue', '', 'Excused'], absent: ['red', 'x', 'Absent']
      };
      element('day-detail-modal-content').innerHTML = `<div class="day-detail-banner present">
        <div class="ddb-icon"><i data-lucide="book-open" style="width:18px;height:18px;"></i></div>
        <div><div class="ddb-title">${subjects.length} subject record${subjects.length === 1 ? '' : 's'}</div><div class="ddb-sub">Only subjects with saved attendance are shown.</div></div>
      </div><div>${subjects.map(record => {
        const [tone, icon, label] = badges[record.status] || badges.absent;
        return `<div class="subject-att-row"><div class="subject-att-name"><span class="subject-dot" style="background:var(--blue-mid);"></span> ${escape(record.subjectName || 'Subject')}</div><span class="badge badge-${tone}">${icon ? `<i data-lucide="${icon}" style="width:8px;height:8px;"></i> ` : ''}${label}</span></div>`;
      }).join('')}</div>`;
      icons();
    }

    function render() {
      const state = element('attendance-load-state');
      state.hidden = !loading && !error;
      state.classList.toggle('is-error', Boolean(error));
      state.setAttribute('role', error ? 'alert' : 'status');
      element('attendance-load-message').textContent = error || 'Loading attendance...';
      element('attendance-retry').hidden = !error;
      const allMonths = months();
      const month = allMonths[monthKey];
      renderSummary(month);
      renderCalendar(allMonths, month);
      renderFlagged(month);
      icons();
    }

    function closeDetail() { element('dayDetailModal').classList.remove('open'); }
    function selectDay(day) {
      const month = months()[monthKey];
      if (!month?.[day]) return;
      selectedDay = day;
      renderDetail(month);
      element('dayDetailModal').classList.add('open');
    }
    function changeMonth(direction) {
      const keys = Object.keys(months()).sort();
      const next = keys[keys.indexOf(monthKey) + direction];
      if (!next) return;
      monthKey = next;
      selectedDay = null;
      render();
    }
    function setRecords(values, currentDate, hasStudent = true) {
      records = values;
      today = currentDate;
      selected = hasStudent;
      loading = false;
      error = '';
      monthKey = Object.keys(months()).sort().at(-1) || currentDate.slice(0, 7);
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
    element('dayDetailModal').addEventListener('click', event => { if (event.target === element('dayDetailModal')) closeDetail(); });
    element('dayDetailModal').querySelector('.modal-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });

    return { setRecords, setLoading, setError, changeMonth, selectDay, closeDetail };
  }

  window.createAttendanceHistory = createAttendanceHistory;
})();
