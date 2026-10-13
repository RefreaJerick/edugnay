/* ══════════════════════════════════════════
   TEACHER SHELL — shared across all teacher pages
   Nav, topbar, notif dropdown, profile dropdown
   Communication data comes from the backend.
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const TEACHER_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
const TEACHER_PORTAL_ACCESS = {
  schoolId: TEACHER_SCHOOL_ID,
  teacherId: null,
  subjects: [],
  isAdviser: false,
  advisorySectionIds: []
};

window.EDUGNAY_TEACHER_ACCESS = TEACHER_PORTAL_ACCESS;
let teacherJournalAccess = false;

function toggleGroup(id) {
  const group = document.getElementById(id);
  if (!group) return;
  group.classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

function teacherCanAccess(feature) {
  if (feature === 'journals') {
    return teacherJournalAccess;
  }
  if (feature === 'reports') {
    return TEACHER_PORTAL_ACCESS.isAdviser
      && window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  }
  return true;
}

let NOTIFICATIONS = [];
let BACKEND_COMMUNICATION = false;

/* ── READ STATE (localStorage; swap for DB column later) ── */

function getTeacherVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || teacherCanAccess(notification.access));
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;
  const teacherDashboardPanel = document.querySelector('.teacher-notif-panel');
  const visibleNotifications = getTeacherVisibleNotifications();
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  const top5 = [...visibleNotifications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  if (!top5.length) {
    container.innerHTML = `
      <div class="tb-notif-empty" id="tbNotifEmpty">
        <div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div>
        <div class="tb-notif-empty-title">${window.EDUGNAY_COMMUNICATION?.error ? 'Notifications unavailable' : 'No notifications yet'}</div>
        <div class="tb-notif-empty-text">${window.EDUGNAY_COMMUNICATION?.error ? 'Please try again when the connection is ready.' : "You're all caught up. New alerts will show up here."}</div>
      </div>
    `;
    if (dot) dot.style.display = 'none';
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = top5.map(n => `
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick='goToTopbarNotif(${JSON.stringify(n.link)}, ${JSON.stringify(n.id)})'>
      <div class="tb-notif-icon ${n.tone}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-title">${window.EDUGNAY_CONFIG.escapeHtml(n.title)}</div>
        <div class="tb-notif-desc">${window.EDUGNAY_CONFIG.escapeHtml(n.message)}</div>
        <div class="${teacherDashboardPanel ? 'teacher-notif-time' : 'tb-notif-time'}"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  markCurrentNotificationRead(id).finally(() => navigate(link.page, link.section, link.tab, link.subjectId));
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  records: NOTIFICATIONS,
  getItems: getTeacherVisibleNotifications
};

async function loadTeacherCommunication() {
  try {
    const data = await window.EDUGNAY_API.loadCommunication('teacher');
    if (!data.backend) return;
    NOTIFICATIONS = data.notifications;
    window.EDUGNAY_COMMUNICATION = data;
    BACKEND_COMMUNICATION = true;
  } catch (error) {
    BACKEND_COMMUNICATION = Boolean(window.EDUGNAY_API?.isBackendAvailable);
    if (BACKEND_COMMUNICATION) NOTIFICATIONS = [];
    window.EDUGNAY_COMMUNICATION = {
      backend: BACKEND_COMMUNICATION,
      notifications: NOTIFICATIONS,
      announcements: [],
      tasks: [],
      error: error?.message || 'School communications could not be loaded.'
    };
  }
}

window.EDUGNAY_COMMUNICATION_READY = loadTeacherCommunication();
document.addEventListener('edugnay:calendar-notices-updated', () => {
  if (BACKEND_COMMUNICATION) void refreshTeacherNotifications();
});

async function refreshTeacherNotifications() {
  if (!BACKEND_COMMUNICATION || !window.EDUGNAY_API?.getNotifications) return;
  try {
    NOTIFICATIONS = [
      ...window.EDUGNAY_API.getTodayCalendarNotifications(),
      ...await window.EDUGNAY_API.getNotifications()
    ];
    if (window.EDUGNAY_COMMUNICATION?.backend) {
      window.EDUGNAY_COMMUNICATION.notifications = NOTIFICATIONS;
    }
    renderTopbarNotifs();
    window.dispatchEvent(new Event('teacher-notifications-updated'));
  } catch {
    // Keep the last loaded notifications if the refresh request fails.
  }
}

window.EDUGNAY_REFRESH_NOTIFICATIONS = refreshTeacherNotifications;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshTeacherNotifications();
});


/* ── ASSIGNED SECTION NAVIGATION ── */
function setTeacherSectionNavMessage(container, message) {
  const status = document.createElement('div');
  status.className = 'teacher-section-nav-message';
  status.setAttribute('role', 'status');
  status.textContent = message;
  container.replaceChildren(status);
}

async function renderTeacherSectionsNavigation() {
  const containers = document.querySelectorAll('[data-teacher-sections-nav]');
  if (!containers.length) return;

  containers.forEach(container => setTeacherSectionNavMessage(container, 'Loading assigned sections…'));

  try {
    if (window.EDUGNAY_API?.isBackendAvailable) {
      const session = await window.EDUGNAY_API.getCurrentUser();
      if (session?.role !== 'teacher') {
        containers.forEach(container => setTeacherSectionNavMessage(container, 'No subject sections assigned'));
        return;
      }
    }

    const sections = await window.EDUGNAY_CONFIG.getMyTeachingSections();
    const activeSections = sections.filter(section =>
      (!section.status || section.status === 'active')
      && (!section.academicYearStatus || section.academicYearStatus === 'active')
    );
    const params = new URLSearchParams(window.location.search);
    const requestedSectionId = params.get('sectionId');
    const isSectionsPage = window.location.pathname.endsWith('edugnay-teacher-sections.html');
    const activeSectionId = requestedSectionId || (isSectionsPage ? activeSections[0]?.id : '');

    if (!activeSections.length) {
      containers.forEach(container => setTeacherSectionNavMessage(container, 'No subject sections assigned'));
      return;
    }

    containers.forEach(container => {
      const links = activeSections.map(section => {
        const link = document.createElement('a');
        const sectionId = String(section.id);
        const grade = String(section.grade || section.gradeLevelName || '').trim();
        const name = String(section.name || '').trim();
        const label = grade && name ? `${grade} – ${name}` : (name || grade || 'Section');
        const target = new URL('./edugnay-teacher-sections.html', window.location.href);

        target.searchParams.set('sectionId', sectionId);
        link.className = `nav-child${sectionId === String(activeSectionId) ? ' active' : ''}`;
        link.href = `${target.pathname}${target.search}`;

        const dot = document.createElement('span');
        dot.className = 'teacher-section-nav-dot';
        dot.setAttribute('aria-hidden', 'true');
        link.append(dot, document.createTextNode(label));
        return link;
      });
      container.replaceChildren(...links);
    });
  } catch (error) {
    containers.forEach(container => setTeacherSectionNavMessage(container, 'Assigned sections could not be loaded'));
  }
}


/* ── NAVIGATION ── */
function navigate(page, section, tab, subjectId) {
  if (page === 'dashboard') {
    window.location.href = './edugnay-teacher-dashboard.html';
  } else if (page === 'journals') {
    if (!teacherCanAccess('journals')) return;
    window.location.href = './edugnay-teacher-journals.html';
  } else if (page === 'section') {
    const params = new URLSearchParams();
    const sectionId = String(section || '');
    if (/^\d+$/.test(sectionId) || /^(jhs|shs|elementary)-/i.test(sectionId)) {
      params.set('sectionId', sectionId);
    }
    if (/^\d+$/.test(String(subjectId || ''))) params.set('subjectId', String(subjectId));
    if (tab) params.set('tab', String(tab));
    const query = params.toString();
    window.location.href = `./edugnay-teacher-sections.html${query ? `?${query}` : ''}`;
  } else if (page === 'reports') {
    if (!teacherCanAccess('reports')) return;
    window.location.href = './edugnay-teacher-reports.html';
  } else if (page === 'sfTemplates') {
    window.location.href = './edugnay-teacher-sf-templates.html';
  } else if (page === 'announcements') {
    window.location.href = 'edugnay-teacher-announcements.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-teacher-notifications.html';
  }
}

function applyTeacherAccess() {
  document.querySelectorAll('[data-teacher-access]').forEach(item => {
    item.hidden = !teacherCanAccess(item.dataset.teacherAccess);
  });

  document.querySelectorAll('#reports-nav').forEach(section => {
    section.hidden = !section.querySelector('[data-teacher-access]:not([hidden])');
  });
}

function guardTeacherPageAccess() {
  const page = window.location.pathname.split('/').pop();
  const restrictedFeature = page === 'edugnay-teacher-journals.html'
    ? 'journals'
    : page === 'edugnay-teacher-reports.html'
      ? 'reports'
      : page === 'edugnay-teacher-sf-templates.html'
        ? 'sfTemplates'
        : '';

  if (restrictedFeature && !teacherCanAccess(restrictedFeature)) {
    window.location.replace('./edugnay-teacher-dashboard.html');
    return true;
  }

  return false;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleDrawer(false);
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', async () => {
  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  const sectionNavigationReady = renderTeacherSectionsNavigation();
  if (window.EDUGNAY_API?.isBackendAvailable) {
    try {
      const [session, advisorySections] = await Promise.all([
        window.EDUGNAY_API.getCurrentUser(),
        window.EDUGNAY_CONFIG.getMyAdvisorySections()
      ]);
      TEACHER_PORTAL_ACCESS.teacherId = String(session.apiUserId);
      TEACHER_PORTAL_ACCESS.schoolId = String(session.apiSchoolId);
      TEACHER_PORTAL_ACCESS.advisorySectionIds = advisorySections.map(section => String(section.id));
      TEACHER_PORTAL_ACCESS.isAdviser = advisorySections.length > 0;
    } catch (error) {
      showAppToast('Teacher access could not be loaded.', 'error');
    }
    try {
      const sections = await window.EDUGNAY_API.getJournalSections();
      teacherJournalAccess = sections.length > 0;
    } catch { teacherJournalAccess = false; }
    if (!teacherJournalAccess) {
      try {
        const history = await window.EDUGNAY_API.getJournalHistory();
        teacherJournalAccess = history.prompts.length > 0 || history.entries.length > 0;
      } catch { teacherJournalAccess = false; }
    }
  }
  if (guardTeacherPageAccess()) return;
  applyTeacherAccess();
  await window.EDUGNAY_COMMUNICATION_READY;
  await sectionNavigationReady;
  renderTopbarNotifs();
});
