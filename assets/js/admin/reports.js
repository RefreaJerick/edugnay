let gradeSummaryError = '';
    let attendanceSummaryError = '';
    let reportsLoading = true;
    let schoolReleaseHistoryRequest = 0;
    const escapeReleaseText = value => window.EDUGNAY_CONFIG.escapeHtml(String(value ?? ''));
    const formatReleaseDate = value => {
      const date = String(value ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${date}T00:00:00Z`));
    };
    document.getElementById('school-release-list').innerHTML = '';
    document.getElementById('school-release-detail').innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'mouse-pointer-click', title: 'Select a report', text: 'Choose a released report to view its versions and correction history.' });
    window.lucide?.createIcons?.();

    async function loadSchoolReleaseHistory() {
      const list = document.getElementById('school-release-list');
      try {
        const data = await window.EDUGNAY_API.request('/reports/weekly-release-history');
        list.innerHTML = data.reports.length ? data.reports.map(report => `
          <button type="button" class="school-release-item" aria-pressed="false" data-release-report-id="${escapeReleaseText(report.reportId)}">
            <strong>${escapeReleaseText(report.learnerName)}</strong>
            <span class="school-release-item-meta"><span>${escapeReleaseText(report.sectionName)}</span><span>Week of ${escapeReleaseText(formatReleaseDate(report.weekStartDate))}</span><span>Version ${escapeReleaseText(report.latestVersion)}</span></span>
          </button>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'files', title: 'No released reports yet', text: 'Released weekly reports will appear here.' });
        window.lucide?.createIcons?.();
      } catch (error) {
        list.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Report history unavailable', text: 'Released reports could not be loaded.' });
        window.lucide?.createIcons?.();
      }
    }

    async function showSchoolReleaseHistory(reportId) {
      const detail = document.getElementById('school-release-detail');
      const requestId = ++schoolReleaseHistoryRequest;
      document.querySelectorAll('#school-release-list [data-release-report-id]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.releaseReportId === String(reportId)));
      });
      detail.innerHTML = '';
      window.lucide?.createIcons?.();
      try {
        const history = await window.EDUGNAY_API.request(`/reports/weekly-drafts/${encodeURIComponent(reportId)}/history`);
        if (requestId !== schoolReleaseHistoryRequest) return;
        detail.innerHTML = history.releases.length ? `${history.releases.map((version, index) => `
          <article class="school-release-version">
            <header class="school-release-version-head">
              <h3>Version ${escapeReleaseText(version.versionNumber)}${index === 0 ? '<span class="school-release-current">Current parent version</span>' : ''}</h3>
              <div class="school-release-meta"><span>Released ${escapeReleaseText(formatReleaseDate(version.releasedAt))}</span><span>By ${escapeReleaseText(version.adviserName || 'Adviser')}</span></div>
            </header>
            <section class="school-release-summary"><h4>Parent summary</h4><p>${escapeReleaseText(version.summary)}</p></section>
            ${version.parentActions.length ? `<section class="school-release-actions"><h4><i data-lucide="list-checks" aria-hidden="true"></i> Recommended actions</h4><ul>${version.parentActions.map(action => `<li>${escapeReleaseText(action)}</li>`).join('')}</ul></section>` : ''}
          </article>`).join('')}${history.reopens.length ? `<section class="school-release-corrections"><h3><i data-lucide="file-clock" aria-hidden="true"></i> Correction history</h3>${history.reopens.map(item => `
          <article class="school-release-correction"><p>${escapeReleaseText(item.reason)}</p><div class="school-release-meta"><span>Recorded ${escapeReleaseText(formatReleaseDate(item.reopenedAt))}</span><span>By ${escapeReleaseText(item.adviserName || 'Adviser')}</span></div></article>`).join('')}</section>` : ''}`
          : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'files', title: 'No released versions', text: 'This report has no saved release versions.' });
        window.lucide?.createIcons?.();
      } catch (error) {
        if (requestId !== schoolReleaseHistoryRequest) return;
        detail.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Report history unavailable', text: 'Released versions and correction history could not be loaded.' });
        window.lucide?.createIcons?.();
      }
    }

    document.getElementById('school-release-list').addEventListener('click', event => {
      const button = event.target.closest('[data-release-report-id]');
      if (button) showSchoolReleaseHistory(button.dataset.releaseReportId);
    });
    const REPORTS_DATA = {
      academicYear: null,
      subjectPerformance: [],
      gradeOutcome: null,
      attendanceByGrade: [],
      attendanceBreakdown: [],
      attendanceRate: null,
      attendanceRecordCount: 0,
      absenceTriggers: [],
      flaggedStudents: []
    };

    const REPORTS_TONE_COLORS = { high: 'var(--green)', mid: 'var(--blue-mid)', low: 'var(--orange)' };
    const FLAGGED_STUDENTS_PREVIEW = new URLSearchParams(window.location.search).get('previewFlags') === '1';
    const SAMPLE_FLAGGED_STUDENTS = [
      { studentId: 'preview-1', name: 'Sample Student One', initials: 'S1', sectionId: 'preview-9a', sectionName: 'St. Paul', grade: 'Grade 9', reasons: [
        { type: 'absence', count: 4, threshold: 4 },
        { type: 'grade', subject: 'Math', grade: 72, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-2', name: 'Sample Student Two', initials: 'S2', sectionId: 'preview-7', sectionName: 'St. Matthew', grade: 'Grade 7', reasons: [
        { type: 'grade', subject: 'Science', grade: 70, threshold: 75, term: 'Term 1' },
        { type: 'grade', subject: 'Math', grade: 73, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-3', name: 'Sample Student Three', initials: 'S3', sectionId: 'preview-10', sectionName: 'St. James', grade: 'Grade 10', reasons: [
        { type: 'absence', count: 6, threshold: 5 },
        { type: 'grade', subject: 'English', grade: 74, threshold: 75, term: 'Term 1' }
      ] },
      { studentId: 'preview-4', name: 'Sample Student Four', initials: 'S4', sectionId: 'preview-9b', sectionName: 'St. Peter', grade: 'Grade 9', reasons: [
        { type: 'absence', count: 3, threshold: 3 },
        { type: 'consecutive', count: 3, threshold: 3, subject: 'Math' }
      ] }
    ];

    function buildReportSummary(data = REPORTS_DATA) {
      const outcome = data.gradeOutcome;
      const passingRate = reportsLoading ? '' : gradeSummaryError ? 'Unavailable' : outcome?.total ? `${Math.round((outcome.passing / outcome.total) * 100)}%` : '—';
      const attendanceRate = reportsLoading ? '' : attendanceSummaryError ? 'Unavailable' : data.attendanceRate == null ? '—' : `${data.attendanceRate}%`;
      return [
        { tone: 'green', icon: 'check-circle', value: passingRate, label: 'Published grades meeting threshold', sub: reportsLoading ? '' : outcome ? `${outcome.passing} of ${outcome.total} published subject marks met the school’s passing requirement` : 'No published subject grades for this school year' },
        { tone: 'blue', icon: 'user-check', value: attendanceRate, label: 'Subject attendance rate', sub: reportsLoading ? '' : attendanceSummaryError ? 'Attendance summary is unavailable' : `${Number(data.attendanceRecordCount) || 0} confirmed subject records` }
      ];
    }

    function renderReportSummary(data = REPORTS_DATA) {
      document.getElementById('report-stat-grid').innerHTML = buildReportSummary(data).map(card => {
        const value = reportsLoading ? '' : window.EDUGNAY_CONFIG.escapeHtml(card.value);
        const sub = reportsLoading ? '' : window.EDUGNAY_CONFIG.escapeHtml(card.sub);
        return `<div class="stat-card ${window.EDUGNAY_CONFIG.escapeHtml(card.tone)}"><div class="stat-card-top"><div class="stat-card-icon"><i data-lucide="${window.EDUGNAY_CONFIG.escapeHtml(card.icon)}" style="width:18px;height:18px;"></i></div></div><div class="stat-card-num">${value}</div><div class="stat-card-label">${window.EDUGNAY_CONFIG.escapeHtml(card.label)}</div><div class="stat-card-sub">${sub}</div></div>`;
      }).join('');
    }

    function renderSubjectPerformance(data = REPORTS_DATA) {
      const chart = document.getElementById('subject-performance-chart');
      if (gradeSummaryError) {
        chart.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Grade report unavailable', text: 'Published grade data could not be loaded.' });
        return;
      }
      if (reportsLoading) {
        chart.innerHTML = '';
        return;
      }
      const groups = Array.isArray(data.subjectPerformance) ? data.subjectPerformance : [];
      const populatedGroups = groups.filter(group => Array.isArray(group.rows) && group.rows.length);
      chart.innerHTML = populatedGroups.length
        ? populatedGroups.map(group => `<div class="bar-group"><div class="bar-group-label">${window.EDUGNAY_CONFIG.escapeHtml(group.grade)}</div>${group.rows.map((row, index) => `<div class="bar-row tier-${window.EDUGNAY_CONFIG.escapeHtml(row.tone)}"><span class="bar-rank">${index + 1}</span><span class="bar-label">${window.EDUGNAY_CONFIG.escapeHtml(row.subject)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(row.score) || 0))}%;background:${REPORTS_TONE_COLORS[row.tone] || 'var(--blue-mid)'};"></div></div><span class="bar-val">${Number(row.score)}</span></div>`).join('')}</div>`).join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'bar-chart-3', title: 'No subject performance data', text: 'Published subject averages will appear here when grades are available.' });
    }

    function renderGradeOutcome(data = REPORTS_DATA) {
      const donut = document.getElementById('grade-outcome-donut');
      const distributionElement = document.getElementById('grade-distribution');
      if (gradeSummaryError) {
        const empty = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Grade report unavailable', text: 'Published grade data could not be loaded.' });
        donut.innerHTML = empty;
        distributionElement.innerHTML = empty;
        return;
      }
      if (reportsLoading) {
        donut.innerHTML = '';
        distributionElement.innerHTML = '';
        return;
      }
      const outcome = data.gradeOutcome || {};
      const distribution = Array.isArray(outcome.distribution) ? outcome.distribution : [];
      if (!Number(outcome.total)) {
        donut.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'pie-chart', title: 'No grade outcomes yet', text: 'Published grade outcomes will appear here when marks are available.' });
        distributionElement.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'bar-chart-3', title: 'No grade distribution', text: 'Grade bands will appear here when published marks are available.' });
        return;
      }
      const circumference = 251.2;
      const passRate = Math.round((outcome.passing / outcome.total) * 100);
      const passStroke = (outcome.passing / outcome.total * circumference).toFixed(1);
      const failStroke = (outcome.failing / outcome.total * circumference).toFixed(1);
      donut.innerHTML = `<div class="donut"><svg viewBox="0 0 100 100" width="126" height="126" aria-label="${passRate}% met threshold"><circle class="donut-bg" cx="50" cy="50" r="40"/><circle class="donut-seg" cx="50" cy="50" r="40" stroke="var(--green)" stroke-dasharray="${passStroke} ${circumference}"/><circle class="donut-seg" cx="50" cy="50" r="40" stroke="var(--red)" stroke-dasharray="${failStroke} ${circumference}" stroke-dashoffset="-${passStroke}"/></svg><div class="donut-label"><div class="donut-num">${passRate}%</div><div class="donut-sub">Met threshold</div></div></div><div class="donut-legend"><div class="legend-item"><div class="legend-dot" style="background:var(--green);"></div><span class="legend-label">Met school-level threshold</span><span class="legend-val">${Number(outcome.passing)}</span></div><div class="legend-item"><div class="legend-dot" style="background:var(--red);"></div><span class="legend-label">Below school-level threshold</span><span class="legend-val">${Number(outcome.failing)}</span></div><div class="legend-total"><div class="legend-item"><div class="legend-dot" style="background:var(--blue-mid);"></div><span class="legend-label">Published subject marks</span><span class="legend-val">${Number(outcome.total)}</span></div></div></div>`;
      const distributionColors = ['var(--green)', 'var(--blue-mid)', 'var(--orange)', 'var(--red)'];
      distributionElement.innerHTML = distribution.length
        ? `<div class="distribution-title">Published grade distribution</div>${distribution.map((row, index) => `<div class="bar-row"><span class="bar-label">${window.EDUGNAY_CONFIG.escapeHtml(row.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(row.percent) || 0))}%;background:${distributionColors[index] || 'var(--blue-mid)'};"></div></div><span class="bar-val">${Number(row.value) || 0}</span></div>`).join('')}`
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'bar-chart-3', title: 'No grade distribution', text: 'Grade bands will appear here when published marks are available.' });
    }

    function renderAttendance(data = REPORTS_DATA) {
      const chart = document.getElementById('attendance-rate-chart');
      const donut = document.getElementById('attendance-breakdown-donut');
      const triggersElement = document.getElementById('absence-triggers');
      if (attendanceSummaryError) {
        [chart, donut, triggersElement].forEach(element => { element.textContent = 'Attendance data could not be loaded.'; });
        return;
      }
      if (reportsLoading) {
        chart.innerHTML = '';
        donut.innerHTML = '';
        triggersElement.innerHTML = '';
        return;
      }
      const byGrade = Array.isArray(data.attendanceByGrade) ? data.attendanceByGrade : [];
      const breakdown = Array.isArray(data.attendanceBreakdown) ? data.attendanceBreakdown : [];
      const triggers = Array.isArray(data.absenceTriggers) ? data.absenceTriggers : [];
      const populatedGrades = byGrade.filter(group => Array.isArray(group.rows) && group.rows.length);
      chart.innerHTML = populatedGrades.length
        ? populatedGrades.map(group => `<div class="bar-group"><div class="bar-group-label">${window.EDUGNAY_CONFIG.escapeHtml(group.grade)}</div>${group.rows.map(row => `<div class="bar-row"><span class="bar-label">${window.EDUGNAY_CONFIG.escapeHtml(row.section)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(row.rate) || 0))}%;background:${row.rate >= 90 ? 'var(--green)' : 'var(--orange)'};"></div></div><span class="bar-val">${Number(row.rate) || 0}%</span></div>`).join('')}</div>`).join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'calendar-check', title: 'No attendance data', text: 'Confirmed subject attendance will appear here when records are available.' });
      if (!breakdown.length) {
        donut.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'pie-chart', title: 'No attendance breakdown', text: 'Present, late, and absent totals will appear here when confirmed records are available.' });
      } else {
        const colors = { Present: 'var(--green)', Absent: 'var(--red)', Late: 'var(--orange)', Excused: 'var(--blue-mid)' };
        const circumference = 251.2;
        let offset = 0;
        const segments = breakdown.map(row => {
          const length = Number(row.value) / 100 * circumference;
          const color = colors[row.label] || 'var(--blue-mid)';
          const html = `<circle class="donut-seg" cx="50" cy="50" r="40" stroke="${color}" stroke-dasharray="${length.toFixed(1)} ${circumference}" stroke-dashoffset="-${offset.toFixed(1)}"/>`;
          offset += length;
          return html;
        }).join('');
        const present = breakdown.find(row => row.label === 'Present') || breakdown[0];
        donut.innerHTML = `<div class="donut"><svg viewBox="0 0 100 100" width="126" height="126"><circle class="donut-bg" cx="50" cy="50" r="40"/>${segments}</svg><div class="donut-label"><div class="donut-num">${Number(present.value) || 0}%</div><div class="donut-sub">Present</div></div></div><div class="donut-legend">${breakdown.map(row => `<div class="legend-item"><div class="legend-dot" style="background:${colors[row.label] || 'var(--blue-mid)'};"></div><span class="legend-label">${window.EDUGNAY_CONFIG.escapeHtml(row.label)}</span><span class="legend-val">${Number(row.value) || 0}%</span></div>`).join('')}</div>`;
      }
      triggersElement.innerHTML = triggers.length
        ? `<div class="distribution-title">Attendance indicators</div><div class="trigger-list">${triggers.map(row => `<div class="trigger-row ${window.EDUGNAY_CONFIG.escapeHtml(row.tone)}"><span>${window.EDUGNAY_CONFIG.escapeHtml(row.label)}</span><strong>${Number(row.value) || 0}</strong></div>`).join('')}</div>`
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'No attendance indicators', text: 'No confirmed attendance records are available.' });
    }

    function renderFlaggedStudents(data = REPORTS_DATA) {
      const panel = document.getElementById('report-flagged-students');
      if (attendanceSummaryError && !FLAGGED_STUDENTS_PREVIEW) {
        panel.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Student indicators unavailable', text: attendanceSummaryError });
        return;
      }
      if (reportsLoading && !FLAGGED_STUDENTS_PREVIEW) {
        panel.innerHTML = '';
        return;
      }
      const flagged = FLAGGED_STUDENTS_PREVIEW ? SAMPLE_FLAGGED_STUDENTS
        : Array.isArray(data.flaggedStudents) ? data.flaggedStudents : [];
      const escape = window.EDUGNAY_CONFIG.escapeHtml;
      panel.innerHTML = flagged.length ? flagged.map(student => `
        <div class="flag-card"><div class="flag-card-top">
          <div class="flag-av" style="background:var(--blue-mid)">${escape(student.initials || '?')}</div>
          <div class="flag-info"><div class="flag-name">${escape(student.name)}</div>
            <div class="flag-detail">${escape(student.grade)} · ${escape(student.sectionName)}</div></div></div>
          <div class="flag-reason-row">${student.reasons.map(reason => `<span class="badge badge-${['grade', 'low_scores'].includes(reason.type) ? 'gold' : 'red'}"><i data-lucide="${['grade', 'low_scores'].includes(reason.type) ? 'trending-down' : 'calendar-days'}" aria-hidden="true"></i> ${escape(reason.type === 'grade'
            ? `${reason.subject}: ${reason.grade}`
                : reason.type === 'low_scores' ? `${reason.subject}: 3 low scores this report week`
                : reason.type === 'consecutive' ? `${reason.count} missed ${reason.subject} meeting dates in a row`
                  : `${reason.count} dates with a recorded ${reason.includesExcused ? 'subject absence (including excused)' : 'unexcused subject absence'}`)}</span>`).join('')}</div>
        </div>`).join('')
        : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'user-round-check', title: 'No flagged students', text: 'No students currently meet the attendance or academic criteria.' });
    }

    function renderReportPanels(data = REPORTS_DATA) {
      renderReportSummary(data);
      renderSubjectPerformance(data);
      renderGradeOutcome(data);
      renderAttendance(data);
      renderFlaggedStudents(data);
    }

    function updateReportPeriodLabel(label) {
      const cleanLabel = String(label || '').replace(/^S\.Y\.\s*/i, '');
      const display = cleanLabel ? `S.Y. ${cleanLabel} · All published terms` : 'Selected school year';
      document.querySelectorAll('[data-report-period-label]').forEach(element => { element.textContent = display; });
    }

    async function loadSchoolYearReports(yearId) {
      reportsLoading = true;
      gradeSummaryError = '';
      attendanceSummaryError = '';
      Object.assign(REPORTS_DATA, {
        academicYear: null, subjectPerformance: [], gradeOutcome: null,
        attendanceByGrade: [], attendanceBreakdown: [], attendanceRate: null,
        attendanceRecordCount: 0, absenceTriggers: [], flaggedStudents: []
      });
      renderReportPanels();

      const [gradesResult, attendanceResult] = await Promise.allSettled([
        window.EDUGNAY_API.getSchoolGradeSummary(yearId),
        window.EDUGNAY_API.getSchoolAttendanceSummary(yearId)
      ]);
      const selector = document.getElementById('reportSchoolYear');
      if (selector.value !== String(yearId)) return;
      reportsLoading = false;

      if (gradesResult.status === 'fulfilled') {
        Object.assign(REPORTS_DATA, gradesResult.value);
        updateReportPeriodLabel(gradesResult.value.academicYear?.label || selector.selectedOptions[0]?.textContent);
      } else {
        gradeSummaryError = 'Published grade data could not be loaded.';
      }
      if (attendanceResult.status === 'fulfilled') {
        Object.assign(REPORTS_DATA, attendanceResult.value);
      } else {
        attendanceSummaryError = 'Confirmed subject attendance could not be loaded.';
      }
      renderReportPanels();
      if (window.lucide) window.lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      const selector = document.getElementById('reportSchoolYear');
      renderReportPanels();

      if (!window.EDUGNAY_API?.isBackendAvailable) {
        selector.replaceChildren(new Option('Reports aren’t available right now.', ''));
        reportsLoading = false;
        gradeSummaryError = 'Published grade data could not be loaded.';
        attendanceSummaryError = 'Confirmed subject attendance could not be loaded.';
        renderReportPanels();
        document.getElementById('school-release-list').textContent = 'Reports aren’t available right now. Refresh and try again.';
        window.EDUGNAY_PAGE_LOADING.ready();
        return;
      }

      loadSchoolReleaseHistory();

      try {
        const years = await window.EDUGNAY_API.getAcademicYears();
        if (!years.length) {
          selector.replaceChildren(new Option('No school years are set up yet', ''));
          selector.disabled = true;
          reportsLoading = false;
          updateReportPeriodLabel('');
          renderReportPanels();
          window.EDUGNAY_PAGE_LOADING.ready();
          return;
        }

        selector.replaceChildren(...years.map(year => new Option(`S.Y. ${year.label}`, String(year.id))));
        const activeYear = years.find(year => year.status === 'active') || years[0];
        selector.value = String(activeYear.id);
        selector.disabled = false;
        selector.addEventListener('change', () => loadSchoolYearReports(selector.value));
        await loadSchoolYearReports(selector.value);
      } catch (error) {
        selector.replaceChildren(new Option('School years unavailable', ''));
        selector.disabled = true;
        reportsLoading = false;
        gradeSummaryError = 'Published grade data could not be loaded.';
        attendanceSummaryError = 'Confirmed subject attendance could not be loaded.';
        renderReportPanels();
        console.warn('School reports could not be initialized.', error.message);
      }
      if (window.lucide) window.lucide.createIcons();
      window.EDUGNAY_PAGE_LOADING.ready();
    });
