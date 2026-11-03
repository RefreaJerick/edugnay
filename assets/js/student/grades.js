lucide.createIcons();

    let STUDENT_GRADE_YEARS = [];
    let STUDENT_GRADE_PERIODS = [];
    let activeAcademicYearId = null;
    let activeAcademicPeriodId = null;
    let gradeLoading = true;
    let gradeLoadError = '';
    let gradeAccessDenied = false;
    let gradeAccessRedirecting = false;

    function getDefaultAcademicYear(years) {
      return years.find(year => year.status === 'active') || years[0] || null;
    }
    function getDefaultAcademicPeriod(periods) {
      return periods.find(period => period.status === 'active')
        || [...periods].reverse().find(period => period.status === 'closed')
        || periods.find(period => period.status === 'history')
        || null;
    }

    function getSelectedAcademicYear() {
      return STUDENT_GRADE_YEARS.find(year => year.id === activeAcademicYearId) || null;
    }

    function getSelectedAcademicPeriod() {
      return STUDENT_GRADE_PERIODS.find(record => record.id === activeAcademicPeriodId) || null;
    }

    function selectAcademicYear(yearId) {
      const year = STUDENT_GRADE_YEARS.find(item => item.id === String(yearId));
      if (!year) return;
      activeAcademicYearId = year.id;
      STUDENT_GRADE_PERIODS = year.periods;
      activeAcademicPeriodId = getDefaultAcademicPeriod(STUDENT_GRADE_PERIODS)?.id || null;
      renderGrades();
    }

    function renderAcademicYearSelect() {
      const select = document.getElementById('gradeYearSelect');
      select.innerHTML = STUDENT_GRADE_YEARS.map(year =>
        '<option value="' + escapeHtml(year.id) + '">' + escapeHtml(year.label) + '</option>'
      ).join('');
      select.disabled = gradeLoading || !STUDENT_GRADE_YEARS.length || Boolean(gradeLoadError);
      if (activeAcademicYearId) select.value = activeAcademicYearId;
    }

    function renderAcademicPeriodTabs() {
      const tabs = document.getElementById('gradeTabs');
      tabs.innerHTML = STUDENT_GRADE_PERIODS.map(record => {
        const isActive = record.id === activeAcademicPeriodId;
        const isUpcoming = record.status === 'upcoming';
        const stateLabel = record.status === 'unconfigured' ? 'Not configured' : '';
        return '<button class="grade-tab ' + (isActive ? 'active' : '') + '" type="button" role="tab" aria-selected="' + isActive + '"' +
          (isUpcoming ? ' aria-label="' + escapeHtml(record.label + ', not started') + '"' : '') +
          (record.disabled ? ' aria-disabled="true" disabled' : ' data-academic-period-id="' + escapeHtml(record.id) + '"') + '>' +
          '<span>' + escapeHtml(record.label) + '</span>' +
          (isUpcoming ? '<i class="grade-tab-status-icon" data-lucide="lock" aria-hidden="true"></i>' : '') +
          (stateLabel ? '<small class="grade-tab-status">' + stateLabel + '</small>' : '') +
        '</button>';
      }).join('');
      tabs.querySelectorAll('[data-academic-period-id]').forEach(button => button.addEventListener('click', function () {
        activeAcademicPeriodId = this.dataset.academicPeriodId;
        renderGrades();
      }));
      if (window.lucide) lucide.createIcons();
    }

    function formatPublishedInfo(subject) {
      const details = [];
      if (subject.sectionName) details.push(subject.sectionName);
      if (subject.publishedAt) {
        const date = new Date(subject.publishedAt);
        if (!Number.isNaN(date.getTime())) {
          details.push('Published ' + date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }));
        }
      }
      return details.join(' · ') || 'Published result';
    }

    function renderEmptyState(container, icon, title, text) {
      container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon,
        title,
        text: escapeHtml(text)
      });
      if (window.lucide) lucide.createIcons();
    }

    function renderSubjectGrades(record) {
      const subjects = Array.isArray(record.subjects) ? record.subjects : [];
      const list = document.getElementById('gradeSubjectList');

      if (!subjects.length) {
        renderEmptyState(list, 'book-open-check', 'No subjects available', 'Subjects assigned for this school year will appear here.');
        return;
      }

      list.innerHTML = subjects.map(subject => {
        const recorded = subject.finalGrade !== null && subject.finalGrade !== undefined && Number.isFinite(Number(subject.finalGrade));
        const communicationComponents = subject.communicationComponentGrades || {};
        const isCommunicationSubject = subject.subjectCode === 'shs-core-communication';
        const componentRows = isCommunicationSubject ? [
          ['Effective Communication', communicationComponents.english?.finalGrade],
          ['Mabisang Komunikasyon', communicationComponents.filipino?.finalGrade]
        ] : [];
        const subtitle = recorded
          ? formatPublishedInfo(subject)
          : subject.electiveClassId && subject.sectionName
            ? subject.sectionName + ' · Not published'
            : 'Not published';
        return '<article class="grade-subject-row' + (isCommunicationSubject ? ' grade-subject-row-communication' : '') + '">' +
          '<div class="grade-subject-copy">' +
            '<div class="grade-subject-name">' + escapeHtml(subject.subjectName || 'Subject') + '</div>' +
            '<div class="grade-subject-teacher">' + escapeHtml(subtitle) + '</div>' +
            (componentRows.length ? '<div class="grade-communication-components">' + componentRows.map(([name, grade]) =>
              '<div class="grade-communication-component"><span>' + escapeHtml(name) + '</span><strong>' +
              (grade !== undefined ? escapeHtml(Number(grade).toFixed(1)) : 'Not published') + '</strong></div>'
            ).join('') + '</div>' : '') +
          '</div>' +
          '<div class="grade-subject-score ' + window.EDUGNAY_CONFIG.gradeScoreClass(subject) + '">' +
            '<div class="grade-score-value">' + (recorded ? Number(subject.finalGrade).toFixed(1) : '—') + '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    function renderGrades() {
      const record = getSelectedAcademicPeriod();
      const tabs = document.getElementById('gradeTabs');
      const list = document.getElementById('gradeSubjectList');
      const note = document.getElementById('gradesNoteCopy');
      renderAcademicYearSelect();

      if (gradeLoadError) {
        tabs.replaceChildren();
        renderEmptyState(list, 'circle-alert', 'Grades could not be loaded', gradeLoadError);
        note.textContent = '';
        return;
      }
      if (gradeAccessDenied) {
        tabs.replaceChildren();
        renderEmptyState(list, 'lock-keyhole', 'Student access required', 'Sign in with a student account to view this page.');
        note.textContent = '';
        return;
      }
      const year = getSelectedAcademicYear();
      if (!year) {
        tabs.replaceChildren();
        renderEmptyState(list, 'calendar', 'No school years available', 'Your enrolled school years will appear here.');
        note.textContent = '';
        return;
      }
      renderAcademicPeriodTabs();
      if (!STUDENT_GRADE_PERIODS.length) {
        renderEmptyState(list, 'calendar', 'No grading periods available', 'The school has not configured grading periods for this school year.');
        note.textContent = '';
        return;
      }
      if (!record) {
        renderEmptyState(
          list,
          'calendar',
          'No grading period is active yet',
          'The grading periods for ' + year.label + ' will be available after the school activates one.'
        );
        note.textContent = 'Grading periods will appear here when they are configured.';
        return;
      }
      renderSubjectGrades(record);
      const heading = document.createElement('strong');
      heading.textContent = 'Final grade status.';
      const detail = ' Subject marks for ' + record.label + ' in ' + year.label + ' appear here when published.';
      note.replaceChildren(heading, document.createTextNode(detail));
      lucide.createIcons();
    }

    async function loadStudentGradesFromApi() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        throw new Error('The grades service is unavailable. Connect to the backend and reload this page.');
      }
      const session = await window.EDUGNAY_API.getCurrentUser();
      if (session?.role !== 'student') {
        gradeAccessDenied = true;
        return;
      }

      const portal = await window.EDUGNAY_API.getPortalFeatures();
      if (!portal?.features || !Object.hasOwn(portal.features, 'gradesEnabled')) {
        throw new Error('Grade access could not be confirmed.');
      }
      if (!portal.features.gradesEnabled) {
        gradeAccessRedirecting = true;
        window.location.replace('./edugnay-student-dashboard.html');
        return;
      }

      const overview = await window.EDUGNAY_API.getFinalGradesOverview();
      STUDENT_GRADE_YEARS = window.EDUGNAY_CONFIG.buildFinalGradeYears(overview);
      const year = getDefaultAcademicYear(STUDENT_GRADE_YEARS);
      activeAcademicYearId = year?.id || null;
      STUDENT_GRADE_PERIODS = year?.periods || [];
      activeAcademicPeriodId = getDefaultAcademicPeriod(STUDENT_GRADE_PERIODS)?.id || null;
    }

    document.addEventListener('DOMContentLoaded', async () => {
      const list = document.getElementById('gradeSubjectList');
      const gradeTabs = document.getElementById('gradeTabs');
      const wideGradeLayout = window.matchMedia('(min-width: 1280px)');
      const updateGradeTabOrientation = () => gradeTabs.setAttribute('aria-orientation', wideGradeLayout.matches ? 'vertical' : 'horizontal');
      updateGradeTabOrientation();
      wideGradeLayout.addEventListener('change', updateGradeTabOrientation);
      document.getElementById('gradeYearSelect').addEventListener('change', event => selectAcademicYear(event.target.value));
      list.innerHTML = '';

      try {
        await loadStudentGradesFromApi();
      } catch (error) {
        gradeLoadError = error.message || 'Published grades could not be loaded.';
      }
      gradeLoading = false;
      if (gradeAccessRedirecting) return;

      list.removeAttribute('role');
      renderGrades();
      window.EDUGNAY_PAGE_LOADING.ready();
    });
