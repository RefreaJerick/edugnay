lucide.createIcons();
    const STUDENT_DASHBOARD_API_ENABLED = window.EDUGNAY_API?.isBackendAvailable === true;
    const dashboardPeriod = document.querySelector('.grading-period-card [data-active-academic-period]');

    let JOURNAL = [];

    function renderStudentJournal() {
      const card = document.getElementById('student-journal-card');
      if (!card) return;
      const journal = JOURNAL[0];
      if (!journal) {
        card.classList.add('is-empty');
        card.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'notebook-pen', title: 'No journal prompt yet', text: 'Your weekly reflection prompt will appear here when it is published.' });
        if (window.lucide) lucide.createIcons();
        return;
      }
      card.classList.remove('is-empty');
      const escape = window.EDUGNAY_CONFIG.escapeHtml;
      const badgeClass = journal.status === 'Submission closed' ? 'badge-gray' : journal.status === 'Late submissions accepted' ? 'badge-gold' : 'badge-green';
      const actionLabel = journal.status === 'Submitted' ? 'View entry' : journal.status === 'Submission closed' ? 'View journal' : 'Write entry';
      card.innerHTML = `<div class="journal-icon-chip"><i data-lucide="notebook-pen" style="width:18px;height:18px;"></i></div><div class="journal-body"><div class="journal-eyebrow" id="weeklyJournalTitle">${escape(journal.subject)} · ${escape(journal.title)}</div><div class="journal-prompt">"${escape(journal.prompt)}"</div><div class="journal-foot"><span class="badge ${badgeClass}"><i data-lucide="circle" style="width:8px;height:8px;"></i> ${escape(journal.status)} · ${escape(journal.due)}</span><a href="edugnay-student-journal.html" class="journal-cta">${actionLabel} <i data-lucide="arrow-right" style="width:12px;height:12px;"></i></a></div></div>`;
      lucide.createIcons();
    }

    async function loadStudentJournalCard() {
      const card = document.getElementById('student-journal-card');
      if (!card) return;
      try {
        const [user, portal] = await Promise.all([
          window.EDUGNAY_API.getCurrentUser(),
          window.EDUGNAY_API.getPortalFeatures()
        ]);
        if (user?.role !== 'student' || !portal.features.journalsEnabled || !portal.journalSubjectEligible) {
          card.closest('.journal-feature')?.setAttribute('hidden', '');
          return;
        }
        const [subjects, prompts, entries] = await Promise.all([
          window.EDUGNAY_API.getJournalSubjects(),
          window.EDUGNAY_API.getJournalPrompts(),
          window.EDUGNAY_API.getJournalEntries()
        ]);
        const prompt = prompts[0];
        if (prompt && subjects.length) {
          const submitted = entries.some(entry => entry.promptId === prompt.id);
          const deadline = new Date(prompt.dueAt);
          const acceptingLate = prompt.allowLate && prompt.status === 'open';
          const canSubmit = prompt.status === 'open' && deadline >= new Date();
          JOURNAL = [{
            subject: prompt.subjectName || subjects[0].name,
            title: "This Week's Journal",
            prompt: prompt.promptText,
            status: submitted ? 'Submitted' : canSubmit ? 'Window open' : acceptingLate ? 'Late submissions accepted' : 'Submission closed',
            due: Number.isNaN(deadline.getTime()) ? 'deadline unavailable' : `due ${deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          }];
        }
      } catch (error) {
        JOURNAL = [];
        card.classList.add('is-empty');
        card.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'triangle-alert', title: 'Journal unavailable', text: error.message || 'Please try again later.' });
        lucide.createIcons();
        return;
      }
      renderStudentJournal();
    }

    const MATERIAL_TYPE_DISPLAY = {
      pdf: { icon: 'file-text', tone: 'gold' },
      pptx: { icon: 'presentation', tone: 'blue' },
      ppt: { icon: 'presentation', tone: 'blue' },
      video: { icon: 'video', tone: 'green' },
      mp4: { icon: 'video', tone: 'green' },
      docx: { icon: 'file-text', tone: 'blue' },
      doc: { icon: 'file-text', tone: 'blue' },
      xls: { icon: 'table', tone: 'green' },
      xlsx: { icon: 'table', tone: 'green' },
      jpg: { icon: 'image', tone: 'gold' },
      png: { icon: 'image', tone: 'gold' }
    };
    let MATERIALS_ERROR = '';
    let MATERIALS_LOADING = true;
    let MATERIALS = [];

    async function loadDashboardMaterials() {
      try {
        const materials = await window.EDUGNAY_API.getMaterials();
        MATERIALS = materials.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
          .slice(0, 3).map(material => {
            const display = MATERIAL_TYPE_DISPLAY[material.type] || MATERIAL_TYPE_DISPLAY.pdf;
            const posted = new Date(material.postedAt);
            return { ...material, subject: material.communicationComponentName || material.subjectName || 'Subject',
              posted: Number.isNaN(posted.getTime()) ? 'Date unavailable'
                : `Posted ${posted.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
              icon: display.icon, tone: display.tone };
          });
        MATERIALS_ERROR = '';
      } catch (error) { MATERIALS = []; MATERIALS_ERROR = error.message || 'Try again after the connection is restored.'; }
      finally { MATERIALS_LOADING = false; }
    }

    let ANNOUNCEMENTS = [];
    let ANNOUNCEMENTS_ERROR = '';
    let ANNOUNCEMENTS_LOADING = true;
    let UPCOMING_ASSIGNMENTS = [];
    let ASSIGNMENTS_LOADING = true;
    let ASSIGNMENTS_ERROR = '';

    const DASHBOARD_ASSIGNMENT_STATUS = {
      pending: { label: 'Pending', icon: 'clock-3' },
      submitted: { label: 'Submitted', icon: 'circle-check' },
      not_submitted: { label: 'Not submitted', icon: 'x-circle' }
    };

    function getAssignmentDateMeta(value) {
      const date = new Date(`${value}T00:00:00`);
      if (Number.isNaN(date.getTime())) {
        return { month: 'Due', day: '--', label: 'Date to be announced' };
      }
      return {
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        day: String(date.getDate()),
        label: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      };
    }

    function renderUpcomingAssignments() {
      const container = document.getElementById('student-upcoming-assignments');
      if (!container) return;

      if (ASSIGNMENTS_LOADING) {
        container.innerHTML = '';
        lucide.createIcons();
        return;
      }
      if (ASSIGNMENTS_ERROR) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Assignments unavailable', text: ASSIGNMENTS_ERROR });
        lucide.createIcons();
        return;
      }

      if (!UPCOMING_ASSIGNMENTS.length) {
        container.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'clipboard-check', title: 'No assignments yet', text: 'Assignments shared by your teachers will appear here.' });
        lucide.createIcons();
        return;
      }

      container.innerHTML = UPCOMING_ASSIGNMENTS.map(item => {
        const status = DASHBOARD_ASSIGNMENT_STATUS[item.status] || DASHBOARD_ASSIGNMENT_STATUS.pending;
        const date = getAssignmentDateMeta(item.dueDate);
        const title = window.EDUGNAY_CONFIG.escapeHtml(item.title);
        const subject = window.EDUGNAY_CONFIG.escapeHtml(item.subject);
        const statusClass = window.EDUGNAY_CONFIG.escapeHtml(item.status);

        return `
          <a class="assignment-preview-row ${statusClass}" href="edugnay-student-assignments.html"
            aria-label="${title}, ${status.label}, due ${window.EDUGNAY_CONFIG.escapeHtml(date.label)}">
            <span class="assignment-preview-date" aria-hidden="true">
              <span class="assignment-preview-month">${window.EDUGNAY_CONFIG.escapeHtml(date.month)}</span>
              <span class="assignment-preview-day">${window.EDUGNAY_CONFIG.escapeHtml(date.day)}</span>
            </span>
            <span class="assignment-preview-copy">
              <span class="assignment-preview-subject">${subject}</span>
              <span class="assignment-preview-title">${title}</span>
            </span>
            <span class="assignment-preview-status ${statusClass}">
              <i data-lucide="${status.icon}" style="width:11px;height:11px;"></i>
              <span class="assignment-preview-status-label">${status.label}</span>
            </span>
            <i data-lucide="chevron-right" class="assignment-preview-arrow" style="width:16px;height:16px;" aria-hidden="true"></i>
          </a>`;
      }).join('');
      lucide.createIcons();
    }

    async function loadDashboardAssignments() {
      ASSIGNMENTS_LOADING = true;
      try {
        const now = new Date();
        const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        const assignments = (await window.EDUGNAY_API.getAssignments())
          .filter(item => item.status === 'published' && item.dueDate && item.dueDate >= today)
          .sort((first, second) => first.dueDate.localeCompare(second.dueDate))
          .slice(0, 3);
        UPCOMING_ASSIGNMENTS = assignments.map(item => ({
          ...item,
          status: item.submissionStatus || 'pending'
        }));
        ASSIGNMENTS_ERROR = '';
      } catch (error) {
        UPCOMING_ASSIGNMENTS = [];
        ASSIGNMENTS_ERROR = error.message || 'Try again after the connection is restored.';
      } finally {
        ASSIGNMENTS_LOADING = false;
      }
    }

    function renderStudentDashboardLists() {
      const toneStyles = {
        blue: 'background:var(--blue-xpale);color:var(--blue-mid);',
        green: 'background:var(--green-pale);color:var(--green-dark);',
        gold: 'background:var(--gold-pale);color:var(--gold-dark);'
      };
      const materials = document.getElementById('student-materials-list');
      if (materials) {
        materials.innerHTML = MATERIALS_LOADING
          ? ''
          : MATERIALS_ERROR
          ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Materials unavailable', text: MATERIALS_ERROR })
          : MATERIALS.length ? MATERIALS.map(item => `
          <div class="material-row" data-page-click="g95ad2b8d5975">
            <div class="material-icon" style="${toneStyles[item.tone]}"><i data-lucide="${item.icon}" style="width:18px;height:18px;"></i></div>
            <div class="material-info"><div class="material-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</div><div class="material-meta">${window.EDUGNAY_CONFIG.escapeHtml(item.communicationComponentName || item.subject)} · ${window.EDUGNAY_CONFIG.escapeHtml(item.posted)}</div></div>
            <i data-lucide="chevron-right" style="width:16px;height:16px;" class="material-chevron"></i>
          </div>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'folder-open', title: 'No learning materials yet', text: 'Materials shared by your teachers will appear here.' });
      }

      const announcements = document.getElementById('student-announcements-list');
      if (announcements) {
        const visibleAnnouncements = ANNOUNCEMENTS.filter(item => !item.access || studentCanAccess(item.access)).slice(0, 3);
        announcements.innerHTML = ANNOUNCEMENTS_LOADING
          ? ''
          : ANNOUNCEMENTS_ERROR
          ? window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'cloud-off', title: 'Announcements unavailable', text: ANNOUNCEMENTS_ERROR })
          : visibleAnnouncements.length ? visibleAnnouncements.map(item => `
          <div class="ann-item" data-page-click="g09d2c92d713e">
            <div class="ann-item-head"><span class="ann-item-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</span><span class="badge ${window.EDUGNAY_CONFIG.escapeHtml(item.tagClass)}">${window.EDUGNAY_CONFIG.escapeHtml(item.tag)}</span></div>
            ${item.imageUrl ? `<img class="ann-item-img" src="${window.EDUGNAY_CONFIG.escapeHtml(item.imageUrl)}" alt="${window.EDUGNAY_CONFIG.escapeHtml(item.title)}" loading="lazy" data-page-error="gbb1bd901180b"/>` : ''}
            <div class="ann-item-body">${window.EDUGNAY_CONFIG.escapeHtml(item.body)}</div>
            <div class="ann-item-meta"><i data-lucide="clock" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.time)}<span>·</span><i data-lucide="user" style="width:11px;height:11px;"></i> ${window.EDUGNAY_CONFIG.escapeHtml(item.author)}</div>
          </div>`).join('') : window.EDUGNAY_CONFIG.renderPanelEmptyState({ icon: 'megaphone', title: 'No announcements yet', text: 'School updates will appear here when they are published.' });
      }
      renderUpcomingAssignments();
      lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      renderWeekCalendar();
      let journalLoad = null;
      if (STUDENT_DASHBOARD_API_ENABLED) {
        document.getElementById('student-upcoming-assignments').innerHTML = '';
        document.getElementById('student-materials-list').innerHTML = '';
        document.getElementById('student-announcements-list').innerHTML = '';
        try {
          await window.EDUGNAY_SCHOOL_READY;
          const session = await window.EDUGNAY_API.getCurrentUser();
          if (session?.role !== 'student') throw new Error('This dashboard requires a student session.');
          const greeting = document.getElementById('greeting-time-label');
          if (greeting) greeting.textContent = `Welcome back, ${session.firstName || 'Student'}!`;
          journalLoad = loadStudentJournalCard();
          const sections = await window.EDUGNAY_API.getSections();
          const currentSection = sections.find(section => section.academicYearStatus === 'active');
          if (dashboardPeriod) {
            dashboardPeriod.dataset.schoolLevel = currentSection?.level || '';
            window.refreshEdUgnayShellContext?.();
          }
        } catch (error) {
          ASSIGNMENTS_ERROR = error.message || 'Your account data could not be loaded.';
          MATERIALS_ERROR = ASSIGNMENTS_ERROR;
          MATERIALS_LOADING = false;
        }
      } else {
        const message = 'The backend is required to load student dashboard data.';
        ASSIGNMENTS_ERROR = message;
        MATERIALS_ERROR = message;
        ANNOUNCEMENTS_ERROR = message;
        ASSIGNMENTS_LOADING = false;
        MATERIALS_LOADING = false;
      }
      if (STUDENT_DASHBOARD_API_ENABLED) {
        try {
          const announcements = window.EDUGNAY_COMMUNICATION_RESOURCES?.announcements;
          if (!announcements) throw new Error('Announcements could not be loaded.');
          ANNOUNCEMENTS = await announcements;
          ANNOUNCEMENTS_ERROR = '';
        } catch (error) {
          ANNOUNCEMENTS = [];
          ANNOUNCEMENTS_ERROR = error.message || 'Announcements could not be loaded.';
        }
      } else {
        ANNOUNCEMENTS_ERROR = 'The backend is required to load announcements.';
      }
      ANNOUNCEMENTS_LOADING = false;
      await Promise.all([
        journalLoad || loadStudentJournalCard(),
        loadDashboardMaterials(),
        loadDashboardAssignments()
      ]);
      renderStudentDashboardLists();
      window.EDUGNAY_PAGE_LOADING.ready();
    });

    <!-- Page JavaScript loads dashboard data for the signed-in student. -->

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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { toggleDrawer(false); toggleProfileDropdown(false); }
    });

window.EDUGNAY_PAGE_EVENTS.bind({
  click: {
    g09d2c92d713e: function(event) { location.href='edugnay-student-announcements.html' },
    g95ad2b8d5975: function(event) { location.href='edugnay-student-materials.html' },
  },
  error: {
    gbb1bd901180b: function(event) { this.style.display='none' },
  },
});
