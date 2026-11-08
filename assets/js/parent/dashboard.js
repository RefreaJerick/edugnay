const PARENT_DASHBOARD_API_ENABLED = window.EDUGNAY_API?.isBackendAvailable === true;
    let DASHBOARD_ANNOUNCEMENTS = [];
    let DASHBOARD_ANNOUNCEMENTS_ERROR = '';
    let DASHBOARD_ANNOUNCEMENTS_LOADING = PARENT_DASHBOARD_API_ENABLED;

    function renderDashboardAnnouncements() {
      const list = document.getElementById('parent-dashboard-announcements');
      if (!list) return;
      const visibleAnnouncements = DASHBOARD_ANNOUNCEMENTS.filter(item => !item.access || window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false).slice(0, 3);
      list.innerHTML = DASHBOARD_ANNOUNCEMENTS_LOADING
        ? ''
        : DASHBOARD_ANNOUNCEMENTS_ERROR
        ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Announcements unavailable', text: DASHBOARD_ANNOUNCEMENTS_ERROR })
        : visibleAnnouncements.length ? visibleAnnouncements.map(item => `
        <div class="ann-item" data-page-click="g7c45b38b8b60">
          <div class="ann-item-head"><span class="ann-item-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</span><span class="badge ${window.EDUGNAY_CONFIG.escapeHtml(item.tagClass)}">${window.EDUGNAY_CONFIG.escapeHtml(item.tag)}</span></div>
          ${item.imageUrl ? `<img class="ann-item-img" src="${window.EDUGNAY_CONFIG.escapeHtml(item.imageUrl)}" alt="${window.EDUGNAY_CONFIG.escapeHtml(item.title)}" loading="lazy" data-page-error="gbb1bd901180b"/>` : ''}
          <div class="ann-item-body">${window.EDUGNAY_CONFIG.escapeHtml(item.body)}</div>
          <div class="ann-item-meta"><i data-lucide="clock" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.time)}<span>·</span><i data-lucide="user" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.author)}</div>
        </div>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'megaphone', title: 'No announcements yet', text: 'School updates will appear here when they are published.' });
      lucide.createIcons();
    }

    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'].map((key, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return { key, label: key[0].toUpperCase() + key.slice(1), date: date.getDate(),
        isoDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` };
    });

    const PARENT_CHILDREN = [];
    let PARENT_CHILDREN_LOADING = true;
    let PARENT_CHILDREN_ERROR = '';
    let backendAttendanceRecords = [];
    let backendCurrentDate = '';
    let attendanceLoadError = '';
    let assignmentsRequestId = 0;

    const ATTENDANCE_SUBJECT_META = {
      mathematics: { name: 'Mathematics', color: 'var(--blue-mid)' },
      english: { name: 'English', color: 'var(--purple)' },
      science: { name: 'Science', color: 'var(--green)' },
      filipino: { name: 'Filipino', color: 'var(--gold)' }
    };

    function getDashboardAttendance(studentId, date) {
      const records = backendAttendanceRecords.filter(record => record.studentId === studentId && record.date === date);
      if (!records.length) return null;

      const subjects = records.filter(record => record.subjectId || record.electiveClassId).map(record => {
        const componentName = record.communicationComponentName || '';
        const subject = ATTENDANCE_SUBJECT_META[record.subjectId] || { name: componentName || record.subjectName || 'Subject', color: 'var(--blue-mid)' };
        const name = record.electiveClassId && record.className
          ? `${record.subjectName || 'Subject'} · ${record.className}` : componentName || record.subjectName || subject.name;
        return { name, status: record.status, color: subject.color };
      });
      return { subjects };
    }

    const CHILD_DASHBOARD_RECORDS = PARENT_CHILDREN.map(child => ({
      studentId: child.studentId,
      attendance: Object.fromEntries(DAYS.map(day => [
        day.key,
        getDashboardAttendance(child.studentId, day.isoDate)
      ]))
    }));

    let currentChild = PARENT_CHILDREN[0]?.studentId || null;
    let currentDay = DAYS[Math.min((today.getDay() + 6) % 7, 4)].key;

    function getCurrentChild() {
      const link = PARENT_CHILDREN.find(child => child.studentId === currentChild);
      return link?.profile || null;
    }

    function getCurrentDashboardRecord() {
      return CHILD_DASHBOARD_RECORDS.find(record => record.studentId === currentChild);
    }

    function renderChildSwitcher() {
      const switcher = document.getElementById('child-switcher');
      if (!switcher) return;
      switcher.innerHTML = PARENT_CHILDREN_LOADING
        ? ''
        : PARENT_CHILDREN_ERROR
        ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Children unavailable', text: PARENT_CHILDREN_ERROR })
        : PARENT_CHILDREN.length ? PARENT_CHILDREN.map(link => {
        const student = link.profile;
        if (!student) return '';
        const sectionLabel = `${student.gradeLevel || 'Unassigned'} – ${student.sectionName || 'Unassigned'}`;
        return `<div class="child-card ${student.id === currentChild ? 'active' : ''}" data-child="${window.EDUGNAY_CONFIG.escapeHtml(student.id)}" role="button" tabindex="0">${window.EDUGNAY_AVATAR.html(student, { className: 'child-avatar', role: 'student' })}<div class="child-info"><div class="child-name">${window.EDUGNAY_CONFIG.escapeHtml(student.displayName)}</div><div class="child-section">${window.EDUGNAY_CONFIG.escapeHtml(sectionLabel)}</div></div></div>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'users', title: 'No linked children', text: 'Children linked to this parent account will appear here.' });
      switcher.querySelectorAll('.child-card').forEach(card => {
        const selectChild = () => switchChild(card.dataset.child, card);
        card.addEventListener('click', selectChild);
        card.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectChild();
          }
        });
      });
      if (window.lucide) lucide.createIcons();
    }

    let reportRequestVersion = 0;
    async function updateChildContext() {
      const child = getCurrentChild();
      const hero = document.querySelector('.report-hero');
      const reportContent = document.getElementById('report-hero-content');
      const reportTitle = document.getElementById('report-status-title');
      const reportDescription = reportContent?.querySelector('.report-hero-description');
      const reportLink = document.getElementById('report-hero-link');
      const reportError = document.getElementById('report-hero-error');
      const clearReportHero = () => {
        if (!hero || !reportContent || !reportTitle || !reportDescription || !reportLink) return;
        hero.dataset.currentReportAvailable = 'false';
        hero.hidden = true;
        hero.setAttribute('aria-busy', 'false');
        reportContent.hidden = true;
        reportTitle.textContent = '';
        reportDescription.textContent = '';
        reportLink.dataset.reportAvailable = 'false';
        reportLink.hidden = true;
        reportLink.removeAttribute('href');
        if (reportError) {
          reportError.textContent = '';
          reportError.hidden = true;
        }
      };
      const showReportError = () => {
        clearReportHero();
        if (!reportError) return;
        reportError.textContent = 'Weekly report could not be loaded. Try again later.';
        reportError.hidden = false;
      };
      const requestVersion = ++reportRequestVersion;
      clearReportHero();
      if (!child) {
        return;
      }
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        showReportError();
        return;
      }
      hero?.setAttribute('aria-busy', 'true');
      try {
        const response = await window.EDUGNAY_API.request('/reports/parent/children/' + encodeURIComponent(child.id));
        if (requestVersion !== reportRequestVersion) return;
        const currentWeek = response.currentReportWeek;
        const report = response.reports?.find(item => currentWeek?.startDate && currentWeek?.endDate
          && item.weekStartDate === currentWeek.startDate && item.weekEndDate === currentWeek.endDate);
        if (!report) {
          hero?.setAttribute('aria-busy', 'false');
          return;
        }
        const start = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          .format(new Date(report.weekStartDate + 'T00:00:00.000Z'));
        const end = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          .format(new Date(report.weekEndDate + 'T00:00:00.000Z'));
        if (!hero || !reportContent || !reportTitle || !reportDescription || !reportLink) return;
        hero.dataset.currentReportAvailable = 'true';
        hero.hidden = hero.dataset.reportsEnabled === 'false';
        hero.setAttribute('aria-busy', 'false');
        reportContent.hidden = false;
        reportTitle.textContent = 'Week of ' + start + ' – ' + end;
        reportDescription.textContent = 'A weekly progress report is available for ' + child.displayName + '.';
        const query = new URLSearchParams({ studentId: child.id, reportId: report.id });
        reportLink.href = 'edugnay-parent-reports.html?' + query.toString();
        reportLink.dataset.reportAvailable = 'true';
        reportLink.hidden = hero.hidden;
        window.lucide?.createIcons?.();
      } catch {
        if (requestVersion !== reportRequestVersion) return;
        showReportError();
      }
    }

    function switchChild(childKey, el) {
      currentChild = childKey;
      document.querySelectorAll('.child-card').forEach(c => c.classList.remove('active'));
      el.classList.add('active');

      updateChildContext();
      renderDayStrip();
      renderAttendanceDetail();
      renderAssignmentsDetail();
    }

    function renderDayStrip() {
      const strip = document.getElementById('day-strip');
      const data = getCurrentDashboardRecord();
      if (!data) {
        strip.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'calendar', title: 'No child schedule', text: 'A child schedule will appear here when a child account is linked.' });
        lucide.createIcons();
        return;
      }

      strip.innerHTML = DAYS.map(d => {
        return `
      <button class="day-pill ${d.key === currentDay ? 'active' : ''}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { selectDay(String(d.key), this) })}">
        <div class="day-pill-label">${d.label}</div>
        <div class="day-pill-date">${d.date}</div>
      </button>`;
      }).join('');
    }

    function selectDay(dayKey, btn) {
      currentDay = dayKey;
      document.querySelectorAll('.day-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      renderAttendanceDetail();
      renderAssignmentsDetail();
    }

    function renderAttendanceDetail() {
      const container = document.getElementById('attendance-detail');
      if (PARENT_CHILDREN_ERROR) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Children unavailable', text: PARENT_CHILDREN_ERROR });
        lucide.createIcons();
        return;
      }
      if (attendanceLoadError) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Attendance could not be loaded', text: 'Refresh and try again.' });
        lucide.createIcons();
        return;
      }
      const child = getCurrentChild();
      const data = getCurrentDashboardRecord();
      if (!child || !data) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'calendar-check', title: 'No attendance data', text: 'Attendance will appear here when a child account is linked.' });
        lucide.createIcons();
        return;
      }
      const att = data.attendance?.[currentDay];

      if (!att) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'calendar-check', title: 'No attendance recorded', text: 'Attendance for this day has not been entered yet.' });
        lucide.createIcons();
        return;
      }

      const subjects = Array.isArray(att.subjects) ? att.subjects : [];

      container.innerHTML = `
    <div>
      ${subjects.length ? subjects.map(s => {
        const badge = s.status === 'present'
          ? '<span class="badge badge-green"><i data-lucide="check" style="width:8px;height:8px;"></i> Present</span>'
          : s.status === 'late'
            ? '<span class="badge badge-orange"><i data-lucide="clock" style="width:8px;height:8px;"></i> Late</span>'
            : s.status === 'excused'
              ? '<span class="badge badge-blue">Excused</span>'
              : '<span class="badge badge-red"><i data-lucide="x" style="width:8px;height:8px;"></i> Absent</span>';
        return `
          <div class="subject-att-row">
            <div class="subject-att-name"><span class="subject-dot" style="background:${s.color};"></span> ${window.EDUGNAY_CONFIG.escapeHtml(s.name)}</div>
            ${badge}
          </div>`;
      }).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'book-open', title: 'No subject details', text: 'Subject attendance details have not been recorded.' })}
    </div>`;
      lucide.createIcons();
    }

    async function getParentAssignments(studentId, dayKey) {
      const day = DAYS.find(item => item.key === dayKey);
      if (!day) return [];
      return window.EDUGNAY_API.getParentAssignmentActivity(studentId, day.isoDate);
    }

    async function renderAssignmentsDetail() {
      const container = document.getElementById('assignments-detail');
      const requestId = ++assignmentsRequestId;
      const selectedChild = currentChild;
      const selectedDay = currentDay;
      if (PARENT_CHILDREN_ERROR) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Children unavailable', text: PARENT_CHILDREN_ERROR });
        lucide.createIcons();
        return;
      }
      if (!selectedChild) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'clipboard-check', title: 'No assignment data', text: 'Assignments will appear here when a child account is linked.' });
        lucide.createIcons();
        return;
      }

      container.innerHTML = '';
      lucide.createIcons();

      let tasks;
      try {
        tasks = await getParentAssignments(selectedChild, selectedDay);
      } catch {
        if (requestId !== assignmentsRequestId || selectedChild !== currentChild || selectedDay !== currentDay) return;
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Assignments could not be loaded', text: 'Refresh and try again.' });
        lucide.createIcons();
        return;
      }
      if (requestId !== assignmentsRequestId || selectedChild !== currentChild || selectedDay !== currentDay) return;

      if (tasks.length === 0) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'clipboard-check', title: 'No active assignments',
          text: 'No published assignments are active on this day.'
        });
        lucide.createIcons();
        return;
      }

      container.innerHTML = `
    <div>
      ${tasks.map(t => {
        const status = t.status;
        const visual = ({
          submitted: { bg: 'var(--green-pale)', color: '#16a34a', icon: 'check', badge: '<span class="badge badge-green">Submitted</span>' },
          pending: { bg: 'var(--orange-pale)', color: '#d97706', icon: 'clock', badge: '<span class="badge badge-orange">Pending</span>' },
          not_submitted: { bg: 'var(--red-pale)', color: 'var(--red)', icon: 'x', badge: '<span class="badge badge-red">Not submitted</span>' }
        })[status] || { bg: 'var(--orange-pale)', color: '#d97706', icon: 'clock', badge: '<span class="badge badge-orange">Pending</span>' };

        const dueLabel = new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return `
          <div class="assignment-row">
            <div class="assignment-icon" style="background:${visual.bg};color:${visual.color};">
              <i data-lucide="${visual.icon}" style="width:15px;height:15px;"></i>
            </div>
            <div class="assignment-info">
              <div class="assignment-subject">${window.EDUGNAY_CONFIG.escapeHtml(t.subject || '')}</div>
              <div class="assignment-task">${window.EDUGNAY_CONFIG.escapeHtml(t.task || '')} · Due ${window.EDUGNAY_CONFIG.escapeHtml(dueLabel)}</div>
            </div>
            ${visual.badge}
          </div>`;
      }).join('')}
    </div>`;
      lucide.createIcons();
    }

    function switchMiniTab(tabKey, btn) {
      document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mini-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pane-' + tabKey).classList.add('active');
      if (tabKey === 'assignments') renderAssignmentsDetail();
    }

    function renderWeekCalendar() {
      const grid = document.getElementById('weekCalendarGrid');
      const rangeLabel = document.getElementById('weekRangeLabel');
      if (!grid) return;

      const today = new Date();
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let html = '';

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const isToday = d.toDateString() === today.toDateString();
        html += `
      <div class="week-day${isToday ? ' is-today' : ''}${i > 4 ? ' is-weekend' : ''}"${isToday ? ' aria-current="date"' : ''}>
        <span class="week-day-label">${dayLabels[i]}</span>
        <span class="week-day-num">${d.getDate()}</span>
      </div>`;
      }

      grid.innerHTML = html;

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (rangeLabel) {
        rangeLabel.textContent = `${fmt(monday)} – ${fmt(sunday)}`;
        rangeLabel.dataset.currentDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        rangeLabel.parentElement.dataset.currentDate = rangeLabel.dataset.currentDate;
      }
    }

    /* Load linked children and their current-week attendance and assignments. */
    document.addEventListener('DOMContentLoaded', async () => {
      if (window.EDUGNAY_API?.isBackendAvailable) {
        renderChildSwitcher();
        renderDashboardAnnouncements();
        document.getElementById('attendance-detail').innerHTML = '';
        document.getElementById('assignments-detail').innerHTML = '';
      } else {
        PARENT_CHILDREN_LOADING = false;
        PARENT_CHILDREN_ERROR = 'Linked students couldn’t be loaded. Refresh and try again.';
        attendanceLoadError = 'Attendance couldn’t be loaded. Refresh and try again.';
      }
      if (window.EDUGNAY_API?.isBackendAvailable) {
        try {
          await window.EDUGNAY_SCHOOL_READY;
          const session = await window.EDUGNAY_API.getCurrentUser();
          if (session?.role !== 'parent') throw new Error('This dashboard requires a parent session.');
          const children = await window.EDUGNAY_API.getParentChildren();
          PARENT_CHILDREN.splice(0, PARENT_CHILDREN.length, ...children.map(child => ({
            studentId: child.studentId,
            profile: { ...child, id: child.studentId }
          })));
          PARENT_CHILDREN_LOADING = false;
          PARENT_CHILDREN_ERROR = '';
          try {
            const attendance = await window.EDUGNAY_API.getParentAttendance();
            backendAttendanceRecords = attendance.records || [];
            backendCurrentDate = attendance.currentDate || '';
          } catch (error) {
            attendanceLoadError = error?.message || 'Attendance could not be loaded.';
            backendAttendanceRecords = [];
          }
          const [year, month, day] = backendCurrentDate.split('-').map(Number);
          const today = year && month && day ? new Date(year, month - 1, day) : new Date();
          const monday = new Date(today);
          monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
          DAYS.splice(0, DAYS.length, ...['mon', 'tue', 'wed', 'thu', 'fri'].map((key, index) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + index);
            return { key, label: key[0].toUpperCase() + key.slice(1), date: date.getDate(),
              isoDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` };
          }));
          currentDay = DAYS[Math.min((today.getDay() + 6) % 7, 4)].key;
          currentChild = PARENT_CHILDREN[0]?.studentId || null;
          CHILD_DASHBOARD_RECORDS.splice(0, CHILD_DASHBOARD_RECORDS.length, ...PARENT_CHILDREN.map(child => ({
            studentId: child.studentId,
            attendance: Object.fromEntries(DAYS.map(day => [day.key, getDashboardAttendance(child.studentId, day.isoDate)]))
          })));
        } catch (error) {
          PARENT_CHILDREN_LOADING = false;
          PARENT_CHILDREN_ERROR = error?.message || 'Linked children could not be loaded.';
          backendAttendanceRecords = [];
          PARENT_CHILDREN.splice(0);
          CHILD_DASHBOARD_RECORDS.splice(0);
          currentChild = null;
        }
      }
      if (PARENT_DASHBOARD_API_ENABLED) {
        try {
          const announcements = window.EDUGNAY_COMMUNICATION_RESOURCES?.announcements;
          if (!announcements) throw new Error('Announcements could not be loaded.');
          DASHBOARD_ANNOUNCEMENTS = await announcements;
          DASHBOARD_ANNOUNCEMENTS_ERROR = '';
        } catch (error) {
          DASHBOARD_ANNOUNCEMENTS = [];
          DASHBOARD_ANNOUNCEMENTS_ERROR = error.message || 'Announcements could not be loaded.';
        }
      } else {
        DASHBOARD_ANNOUNCEMENTS_ERROR = 'Announcements couldn’t be loaded. Refresh and try again.';
      }
      DASHBOARD_ANNOUNCEMENTS_LOADING = false;
      renderDashboardAnnouncements();
      renderChildSwitcher();
      updateChildContext();
      renderDayStrip();
      renderAttendanceDetail();
      renderAssignmentsDetail();
      renderWeekCalendar();
      lucide.createIcons();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p816aa38a63d4: function(event) { switchMiniTab('assignments', this) },
    pb27ee5caa0fd: function(event) { switchMiniTab('attendance', this) },
  },
});

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g7c45b38b8b60: function(event) { location.href='edugnay-parent-announcements.html' },
  },
  error: {
    gbb1bd901180b: function(event) { this.style.display='none' },
  },
});
