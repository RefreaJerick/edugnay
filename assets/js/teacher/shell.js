/* ══════════════════════════════════════════
   TEACHER SHELL — shared across all teacher pages
   Nav, topbar, notif dropdown, profile dropdown
   Communication data comes from the backend.
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const TEACHER_PORTAL_ACCESS = {
  schoolId: null,
  teacherId: null,
  subjects: [],
  isAdviser: false,
  advisorySectionIds: []
};

window.EDUGNAY_TEACHER_ACCESS = TEACHER_PORTAL_ACCESS;
let teacherJournalAccess = false;
let journalAccessDenied = false;
let teacherSfTemplatesAccess = false;
const TEACHER_NAV_CACHE_PREFIX = window.EDUGNAY_TEACHER_NAV_CACHE_PREFIX || 'edugnay_teacher_sidebar_v1:';
const TEACHER_NAV_CACHE_POINTER = `${TEACHER_NAV_CACHE_PREFIX}current`;

function getTeacherSchoolId() {
  return String(window.EDUGNAY_CONFIG?.getActiveSchoolId?.()
    || window.EDUGNAY_API_SCHOOL_CONTEXT?.id || '');
}

function getTeacherSidebarCacheKey(schoolId, teacherId) {
  return `${TEACHER_NAV_CACHE_PREFIX}${encodeURIComponent(String(schoolId))}:${encodeURIComponent(String(teacherId))}`;
}

function readTeacherSidebarSnapshot() {
  try {
    const pointer = JSON.parse(sessionStorage.getItem(TEACHER_NAV_CACHE_POINTER) || 'null');
    if (!pointer?.schoolId || !pointer?.teacherId) return null;
    const snapshot = JSON.parse(sessionStorage.getItem(getTeacherSidebarCacheKey(pointer.schoolId, pointer.teacherId)) || 'null');
    if (snapshot?.version !== 1
      || String(snapshot.schoolId) !== String(pointer.schoolId)
      || String(snapshot.teacherId) !== String(pointer.teacherId)
      || !snapshot.access || !Array.isArray(snapshot.sections)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function setTeacherSidebarPrepaintState(snapshot) {
  const classList = document.documentElement?.classList;
  if (!classList) return;
  const access = snapshot?.access || {};
  classList.toggle('teacher-nav-hide-reports', !access.reports);
  classList.toggle('teacher-nav-hide-journals', !access.journals);
  classList.toggle('teacher-nav-hide-sf-templates', !access.sfTemplates);
  classList.toggle('teacher-nav-hide-reports-group', !access.reports && !access.journals && !access.sfTemplates);
}

const INITIAL_TEACHER_SIDEBAR_SNAPSHOT = readTeacherSidebarSnapshot();
setTeacherSidebarPrepaintState(INITIAL_TEACHER_SIDEBAR_SNAPSHOT);

function saveTeacherSidebarSnapshot(snapshot) {
  if (!snapshot?.schoolId || !snapshot?.teacherId) return;
  try {
    sessionStorage.setItem(getTeacherSidebarCacheKey(snapshot.schoolId, snapshot.teacherId), JSON.stringify(snapshot));
    sessionStorage.setItem(TEACHER_NAV_CACHE_POINTER, JSON.stringify({
      schoolId: String(snapshot.schoolId),
      teacherId: String(snapshot.teacherId)
    }));
  } catch {
    // Sidebar rendering continues normally when session storage is unavailable.
  }
}

function clearTeacherSidebarSnapshot() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(TEACHER_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // A storage failure must not prevent sign-out or navigation.
  }
}

function getActiveTeacherSections(sections) {
  return sections.filter(section =>
    (!section.status || section.status === 'active')
    && (!section.academicYearStatus || section.academicYearStatus === 'active')
  ).map(section => ({
    id: String(section.id),
    grade: String(section.grade || section.gradeLevelName || '').trim(),
    name: String(section.name || '').trim()
  }));
}

function toggleGroup(id) {
  const group = document.getElementById(id);
  if (!group) return;
  group.classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

function teacherCanAccess(feature) {
  if (feature === 'journals') return teacherJournalAccess;
  if (feature === 'reports') {
    return TEACHER_PORTAL_ACCESS.isAdviser
      && window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  }
  if (feature === 'sfTemplates') return teacherSfTemplatesAccess;
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

function renderTeacherSectionsNavigation(sections, errorMessage = '') {
  const containers = document.querySelectorAll('[data-teacher-sections-nav]');
  if (!containers.length) return;

  if (!sections?.length) {
    const message = errorMessage || 'No subject sections assigned';
    containers.forEach(container => setTeacherSectionNavMessage(container, message));
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedSectionId = params.get('sectionId');
  const isSectionsPage = window.location.pathname.endsWith('edugnay-teacher-sections.html');
  const activeSectionId = requestedSectionId || (isSectionsPage ? sections[0]?.id : '');

  containers.forEach(container => {
    const links = sections.map(section => {
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
}

function teacherSidebarSnapshotsMatch(first, second) {
  if (!first || !second) return false;
  return JSON.stringify(first) === JSON.stringify(second);
}

function applyTeacherSidebarSnapshot(snapshot, { previousSnapshot = null, sectionsError = '' } = {}) {
  setTeacherSidebarPrepaintState(snapshot);
  if (!previousSnapshot || JSON.stringify(previousSnapshot.sections) !== JSON.stringify(snapshot.sections)) {
    renderTeacherSectionsNavigation(snapshot.sections, sectionsError);
  } else if (sectionsError && !snapshot.sections.length) {
    renderTeacherSectionsNavigation(snapshot.sections, sectionsError);
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
    if (!teacherCanAccess('sfTemplates')) return;
    window.location.href = './edugnay-teacher-sf-templates.html';
  } else if (page === 'announcements') {
    window.location.href = 'edugnay-teacher-announcements.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-teacher-notifications.html';
  }
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
  if (window.lucide) window.lucide.createIcons();

  let cachedSnapshot = INITIAL_TEACHER_SIDEBAR_SNAPSHOT;
  if (cachedSnapshot) applyTeacherSidebarSnapshot(cachedSnapshot);

  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }

  let session = null;
  let activeSections = null;
  let sectionsError = '';
  let advisorySections = null;
  let journalAccessFresh = false;
  if (window.EDUGNAY_API?.isBackendAvailable) {
    try {
      session = await window.EDUGNAY_API.getCurrentUser();
    } catch (error) {
      if (error.status === 401) {
        clearTeacherSidebarSnapshot();
        cachedSnapshot = null;
      }
      showAppToast('Teacher access could not be loaded.', 'error');
    }

    if (session?.role === 'teacher') {
      TEACHER_PORTAL_ACCESS.teacherId = String(session.apiUserId);
      TEACHER_PORTAL_ACCESS.schoolId = String(session.apiSchoolId);

      const [advisoryResult, sectionsResult] = await Promise.allSettled([
        window.EDUGNAY_CONFIG.getMyAdvisorySections(),
        window.EDUGNAY_CONFIG.getMyTeachingSections()
      ]);
      if (advisoryResult.status === 'fulfilled') {
        advisorySections = advisoryResult.value;
        TEACHER_PORTAL_ACCESS.advisorySectionIds = advisorySections.map(section => String(section.id));
        TEACHER_PORTAL_ACCESS.isAdviser = advisorySections.length > 0;
      } else {
        showAppToast('Teacher access could not be loaded.', 'error');
      }
      if (sectionsResult.status === 'fulfilled') {
        activeSections = getActiveTeacherSections(sectionsResult.value);
      } else {
        sectionsError = 'Assigned sections could not be loaded';
      }

      try {
        const sections = await window.EDUGNAY_API.getJournalSections();
        teacherJournalAccess = sections.length > 0;
        if (!teacherJournalAccess) {
          const history = await window.EDUGNAY_API.getJournalHistory();
          teacherJournalAccess = history.prompts.length > 0 || history.entries.length > 0;
        }
        journalAccessFresh = true;
      } catch (error) {
        teacherJournalAccess = false;
        journalAccessDenied = error.status === 403;
      }
    }
  }

  if (session?.role === 'teacher') {
    const liveIdentity = {
      schoolId: String(session.apiSchoolId),
      teacherId: String(session.apiUserId)
    };
    const cachedIdentityMatches = cachedSnapshot
      && cachedSnapshot.schoolId === liveIdentity.schoolId
      && cachedSnapshot.teacherId === liveIdentity.teacherId;
    if (cachedSnapshot && !cachedIdentityMatches) {
      clearTeacherSidebarSnapshot();
      cachedSnapshot = null;
    }

    const activeSchool = window.EDUGNAY_CONFIG?.getActiveSchool?.()
      || window.EDUGNAY_API_SCHOOL_CONTEXT || null;
    const narrativeReportsEnabled = activeSchool
      ? Boolean(activeSchool.narrativeReportsEnabled) : null;
    const sfTemplatesEnabled = activeSchool
      ? Boolean(activeSchool.sfTemplatesEnabled) : null;
    if (sfTemplatesEnabled !== null) teacherSfTemplatesAccess = sfTemplatesEnabled;
    if (activeSchool?.journalsEnabled === false || journalAccessDenied) teacherJournalAccess = false;

    const snapshot = {
      version: 1,
      ...liveIdentity,
      access: {
        reports: narrativeReportsEnabled === false
          ? false
          : advisorySections === null || narrativeReportsEnabled === null
            ? Boolean(cachedIdentityMatches && cachedSnapshot.access.reports)
            : TEACHER_PORTAL_ACCESS.isAdviser,
        journals: activeSchool?.journalsEnabled === false || journalAccessDenied
          ? false
          : journalAccessFresh
            ? teacherJournalAccess
            : Boolean(cachedIdentityMatches && cachedSnapshot.access.journals),
        sfTemplates: sfTemplatesEnabled === null
          ? Boolean(cachedIdentityMatches && cachedSnapshot.access.sfTemplates)
          : sfTemplatesEnabled
      },
      sections: activeSections || (cachedIdentityMatches ? cachedSnapshot.sections : [])
    };
    if (!activeSections && !cachedIdentityMatches) sectionsError = 'Assigned sections could not be loaded';

    if (!teacherSidebarSnapshotsMatch(cachedSnapshot, snapshot)) {
      applyTeacherSidebarSnapshot(snapshot, { previousSnapshot: cachedSnapshot, sectionsError });
    }
    saveTeacherSidebarSnapshot(snapshot);
  } else if (session || (window.EDUGNAY_API?.isBackendAvailable && !cachedSnapshot)) {
    if (session?.role !== 'teacher') clearTeacherSidebarSnapshot();
    teacherJournalAccess = false;
    journalAccessDenied = false;
    teacherSfTemplatesAccess = false;
    TEACHER_PORTAL_ACCESS.isAdviser = false;
    const fallbackSnapshot = {
      version: 1,
      schoolId: getTeacherSchoolId(),
      teacherId: '',
      access: { reports: false, journals: false, sfTemplates: false },
      sections: []
    };
    applyTeacherSidebarSnapshot(fallbackSnapshot, { sectionsError: 'Assigned sections could not be loaded' });
  } else if (!window.EDUGNAY_API?.isBackendAvailable) {
    try {
      activeSections = getActiveTeacherSections(await window.EDUGNAY_CONFIG.getMyTeachingSections());
    } catch {
      sectionsError = 'Assigned sections could not be loaded';
    }
    const localSession = window.EDUGNAY_SESSION || {};
    const localSchool = window.EDUGNAY_CONFIG?.getActiveSchool?.() || null;
    teacherSfTemplatesAccess = Boolean(localSchool?.sfTemplatesEnabled);
    const localSnapshot = {
      version: 1,
      schoolId: String(localSession.schoolId || getTeacherSchoolId() || 'local'),
      teacherId: String(localSession.userId || localSession.id || ''),
      access: { reports: false, journals: false, sfTemplates: teacherSfTemplatesAccess },
      sections: activeSections || (cachedSnapshot?.sections || [])
    };
    if (!teacherSidebarSnapshotsMatch(cachedSnapshot, localSnapshot)) {
      applyTeacherSidebarSnapshot(localSnapshot, { sectionsError });
    }
    saveTeacherSidebarSnapshot(localSnapshot);
  }

  if (guardTeacherPageAccess()) return;
  await window.EDUGNAY_COMMUNICATION_READY;
  renderTopbarNotifs();
});
