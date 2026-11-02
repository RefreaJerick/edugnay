lucide.createIcons();

    let PARENT_CHILDREN = [];
    let PARENT_GRADE_YEARS = [];
    let PARENT_GRADE_PERIODS = [];
    let activeChildId = null;
    let activeAcademicYearId = null;
    let activeAcademicPeriodId = null;
    let childLoadError = '';
    let gradeLoadError = '';
    let gradeLoading = false;
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

    function getActiveChild() {
      return PARENT_CHILDREN.find(child => child.studentId === activeChildId) || null;
    }

    function getSelectedAcademicYear() {
      return PARENT_GRADE_YEARS.find(year => year.id === activeAcademicYearId) || null;
    }

    function getSelectedAcademicPeriod() {
      return PARENT_GRADE_PERIODS.find(period => period.id === activeAcademicPeriodId) || null;
    }

    function selectAcademicYear(yearId) {
      const year = PARENT_GRADE_YEARS.find(item => item.id === String(yearId));
      if (!year) return;
      activeAcademicYearId = year.id;
      PARENT_GRADE_PERIODS = year.periods;
      activeAcademicPeriodId = getDefaultAcademicPeriod(PARENT_GRADE_PERIODS)?.id || null;
      renderGrades();
    }

    function renderAcademicYearSelect() {
      const select = document.getElementById('parentGradeYearSelect');
      select.innerHTML = PARENT_GRADE_YEARS.map(year =>
        '<option value="' + window.EDUGNAY_CONFIG.escapeHtml(year.id) + '">' + window.EDUGNAY_CONFIG.escapeHtml(year.label) + '</option>'
      ).join('');
      select.disabled = gradeLoading || !PARENT_GRADE_YEARS.length || Boolean(gradeLoadError || childLoadError);
      if (activeAcademicYearId) select.value = activeAcademicYearId;
    }

    function renderEmptyState(container, icon, title, text) {
      container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon,
        title,
        text: window.EDUGNAY_CONFIG.escapeHtml(text)
      });
      if (window.lucide) lucide.createIcons();
    }

    function renderChildSwitcher() {
      const switcher = document.getElementById('parentGradeChildSwitcher');
      switcher.removeAttribute('role');
      if (childLoadError) {
        renderEmptyState(switcher, 'circle-alert', 'Children could not be loaded', childLoadError);
        return;
      }
      if (!PARENT_CHILDREN.length) {
        renderEmptyState(switcher, 'users', 'No linked children', 'Children linked to this parent account will appear here.');
        return;
      }

      switcher.innerHTML = PARENT_CHILDREN.map(child => `
        <div class="child-card ${child.studentId === activeChildId ? 'active' : ''}" data-student-id="${window.EDUGNAY_CONFIG.escapeHtml(child.studentId)}" role="button" tabindex="0" aria-pressed="${child.studentId === activeChildId}">
          ${window.EDUGNAY_AVATAR.html(child, { className: 'child-avatar', role: 'student' })}
          <div class="child-info">
            <div class="child-name">${window.EDUGNAY_CONFIG.escapeHtml(child.displayName || 'Student')}</div>
            <div class="child-section">${window.EDUGNAY_CONFIG.escapeHtml(child.gradeLevel || 'Unassigned')} – ${window.EDUGNAY_CONFIG.escapeHtml(child.sectionName || 'Unassigned')}</div>
          </div>
        </div>`).join('');

      switcher.querySelectorAll('[data-student-id]').forEach(card => {
        const selectChild = () => switchChild(card.dataset.studentId);
        card.addEventListener('click', selectChild);
        card.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectChild();
          }
        });
      });
    }

    function updateChildSwitcherState() {
      document.querySelectorAll('#parentGradeChildSwitcher [data-student-id]').forEach(card => {
        const isActive = card.dataset.studentId === activeChildId;
        card.classList.toggle('active', isActive);
        card.setAttribute('aria-pressed', String(isActive));
      });
    }

    async function switchChild(studentId) {
      const child = PARENT_CHILDREN.find(item => item.studentId === String(studentId));
      if (!child || child.studentId === activeChildId) return;
      activeChildId = child.studentId;
      PARENT_GRADE_YEARS = [];
      PARENT_GRADE_PERIODS = [];
      activeAcademicYearId = null;
      activeAcademicPeriodId = null;
      gradeLoadError = '';
      gradeLoading = true;
      updateChildSwitcherState();
      renderGrades();
      await loadParentGradeOverview(child.studentId);
    }

    function renderAcademicPeriodTabs() {
      const tabs = document.getElementById('parentGradeTabs');
      const periods = PARENT_GRADE_PERIODS;
      if (!periods.length) {
        tabs.replaceChildren();
        return;
      }

      tabs.innerHTML = periods.map(period => `
        <button class="grade-tab ${period.id === activeAcademicPeriodId ? 'active' : ''}" type="button" role="tab" aria-selected="${period.id === activeAcademicPeriodId}" ${period.status === 'upcoming' ? `aria-label="${window.EDUGNAY_CONFIG.escapeHtml(period.label + ', not started')}"` : ''} ${period.disabled ? 'aria-disabled="true" disabled' : `data-academic-period-id="${window.EDUGNAY_CONFIG.escapeHtml(period.id)}"`}>
          <span>${window.EDUGNAY_CONFIG.escapeHtml(period.label)}</span>
          ${period.status === 'upcoming' ? '<i class="grade-tab-status-icon" data-lucide="lock" aria-hidden="true"></i>' : ''}
          ${period.status === 'unconfigured' ? '<small class="grade-tab-status">Not configured</small>' : ''}
        </button>`).join('');
      tabs.querySelectorAll('[data-academic-period-id]').forEach(button => button.addEventListener('click', () => {
        activeAcademicPeriodId = button.dataset.academicPeriodId;
        renderGrades();
      }));
      if (window.lucide) lucide.createIcons();
    }

    function formatPublishedDate(value) {
      if (!value) return 'Published result';
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? 'Published result'
        : `Published ${date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}`;
    }

    function renderSubjectGrades(child, period) {
      const subjects = Array.isArray(period?.subjects) ? period.subjects : [];
      const list = document.getElementById('parentGradeSubjectList');
      document.getElementById('parentSubjectGradesSub').textContent = `${child.displayName}'s marks by subject`;

      if (gradeLoadError) {
        renderEmptyState(list, 'circle-alert', 'Grades could not be loaded', gradeLoadError);
        return;
      }
      if (!subjects.length) {
        renderEmptyState(list, 'book-open-check', 'No subjects available', 'Subjects assigned to this student’s section will appear here.');
        return;
      }

      list.innerHTML = subjects.map(subject => {
        const recorded = subject.finalGrade !== null && subject.finalGrade !== undefined
          && Number.isFinite(Number(subject.finalGrade));
        const gradeValue = recorded
          ? Number(subject.finalGrade).toLocaleString('en-PH', { maximumFractionDigits: 2 })
          : '—';
        const gradeStatus = recorded ? formatPublishedDate(subject.publishedAt) : 'Not published';
        const subtitle = subject.electiveClassId && subject.sectionName
          ? `${subject.sectionName} · ${gradeStatus}`
          : gradeStatus;
        return `<article class="grade-subject-row">
          <div class="grade-subject-copy">
            <div class="grade-subject-name">${window.EDUGNAY_CONFIG.escapeHtml(subject.subjectName || 'Subject')}</div>
            <div class="grade-subject-teacher">${window.EDUGNAY_CONFIG.escapeHtml(subtitle || '')}</div>
          </div>
          <div class="grade-subject-score ${window.EDUGNAY_CONFIG.gradeScoreClass(subject)}">
            <div class="grade-score-value">${gradeValue}</div>
          </div>
        </article>`;
      }).join('');
    }

    function renderGrades() {
      const child = getActiveChild();
      const year = getSelectedAcademicYear();
      const period = getSelectedAcademicPeriod();
      const tabs = document.getElementById('parentGradeTabs');
      const list = document.getElementById('parentGradeSubjectList');
      const note = document.getElementById('parentGradesNoteCopy');
      renderAcademicYearSelect();

      if (childLoadError) {
        tabs.replaceChildren();
        renderEmptyState(list, 'circle-alert', 'Grades are unavailable', childLoadError);
        note.textContent = '';
        return;
      }
      if (!child) {
        tabs.replaceChildren();
        renderEmptyState(list, 'book-open-check', 'No grades available', 'Grades will appear here when a child account is linked.');
        note.textContent = '';
        return;
      }
      document.getElementById('parentSubjectGradesSub').textContent = `${child.displayName}'s marks by subject`;
      if (gradeLoading) {
        tabs.innerHTML = '';
        list.innerHTML = '';
        note.textContent = '';
        return;
      }
      list.removeAttribute('role');
      if (gradeLoadError) {
        tabs.replaceChildren();
        document.getElementById('parentSubjectGradesSub').textContent = `${child.displayName}'s marks by subject`;
        renderEmptyState(list, 'circle-alert', 'Grades could not be loaded', gradeLoadError);
        note.textContent = '';
        return;
      }
      if (!year) {
        tabs.replaceChildren();
        renderEmptyState(list, 'calendar', 'No school years available', 'The selected student’s enrolled school years will appear here.');
        note.textContent = '';
        return;
      }
      renderAcademicPeriodTabs();
      if (!PARENT_GRADE_PERIODS.length) {
        renderEmptyState(list, 'calendar', 'No grading periods available', 'The school has not configured grading periods for ' + year.label + '.');
        note.textContent = '';
        return;
      }
      if (!period) {
        renderEmptyState(list, 'calendar', 'No grading period is active yet', 'The grading periods for ' + year.label + ' will be available after the school activates one.');
        note.textContent = '';
        return;
      }

      renderSubjectGrades(child, period);
      const heading = document.createElement('strong');
      heading.textContent = 'Final grade status';
      const detail = ` for ${child.displayName} in ${period.label}, ${year.label}. Subject marks appear here when published.`;
      note.replaceChildren(heading, document.createTextNode(detail));
      if (window.lucide) lucide.createIcons();
    }

    async function loadBackendParentChildren() {
      if (!window.EDUGNAY_API?.isBackendAvailable) {
        childLoadError = 'The grades service is unavailable. Connect to the backend and reload this page.';
        gradeLoadError = childLoadError;
        return;
      }
      try {
        const portal = await window.EDUGNAY_API.getPortalFeatures();
        if (!portal?.features?.gradesEnabled) {
          gradeAccessRedirecting = true;
          window.location.replace('./edugnay-parent-dashboard.html');
          return;
        }
      } catch (error) {
        childLoadError = error.message || 'Grade access could not be confirmed.';
        gradeLoadError = childLoadError;
        return;
      }

      try {
        const children = await window.EDUGNAY_API.getParentChildren();
        PARENT_CHILDREN = children.map(child => ({
          ...child,
          studentId: String(child.studentId),
          sectionId: child.sectionId == null ? null : String(child.sectionId)
        }));
      } catch (error) {
        childLoadError = error.message || 'Linked children could not be loaded.';
        gradeLoadError = childLoadError;
        return;
      }

    }

    async function loadParentGradeOverview(studentId) {
      try {
        const overview = await window.EDUGNAY_API.getFinalGradesOverview(studentId);
        if (activeChildId !== studentId) return;
        PARENT_GRADE_YEARS = window.EDUGNAY_CONFIG.buildFinalGradeYears(overview);
        const year = getDefaultAcademicYear(PARENT_GRADE_YEARS);
        activeAcademicYearId = year?.id || null;
        PARENT_GRADE_PERIODS = year?.periods || [];
        activeAcademicPeriodId = getDefaultAcademicPeriod(PARENT_GRADE_PERIODS)?.id || null;
      } catch (error) {
        if (activeChildId === studentId) gradeLoadError = error.message || 'Grades could not be loaded.';
      } finally {
        if (activeChildId === studentId) {
          gradeLoading = false;
          renderGrades();
        }
      }
    }

    function setInitialSelection() {
      const requestedChildId = new URLSearchParams(window.location.search).get('studentId');
      activeChildId = PARENT_CHILDREN.some(child => child.studentId === requestedChildId)
        ? requestedChildId
        : PARENT_CHILDREN[0]?.studentId || null;
    }

    document.addEventListener('DOMContentLoaded', async () => {
      const switcher = document.getElementById('parentGradeChildSwitcher');
      const gradeTabs = document.getElementById('parentGradeTabs');
      const wideGradeLayout = window.matchMedia('(min-width: 1280px)');
      const updateGradeTabOrientation = () => gradeTabs.setAttribute('aria-orientation', wideGradeLayout.matches ? 'vertical' : 'horizontal');
      updateGradeTabOrientation();
      wideGradeLayout.addEventListener('change', updateGradeTabOrientation);
      document.getElementById('parentGradeYearSelect').addEventListener('change', event => selectAcademicYear(event.target.value));
      switcher.innerHTML = '';
      document.getElementById('parentGradeSubjectList').setAttribute('aria-live', 'polite');
      document.getElementById('parentGradeSubjectList').innerHTML = '';
      await loadBackendParentChildren();
      if (gradeAccessRedirecting) return;
      setInitialSelection();
      renderChildSwitcher();
      if (activeChildId) {
        gradeLoading = true;
        await loadParentGradeOverview(activeChildId);
      }
      renderGrades();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    p2a3347cd2953: function(event) { toggleProfileDropdown(false); confirmLogout(); },
  },
});
