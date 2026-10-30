/* ══════════════════════════════════════════
   STUDENT SHELL — shared across all student pages
   Nav, topbar, notif dropdown, profile dropdown
   Communication data comes from the backend.
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
window.EDUGNAY_STUDENT = { currentUser: null };
let NOTIFICATIONS = [];
let BACKEND_COMMUNICATION = false;
let studentSidebarAccessReady = false;
const STUDENT_NAV_CACHE_PREFIX = window.EDUGNAY_STUDENT_NAV_CACHE_PREFIX || 'edugnay_student_sidebar_v1:';
const STUDENT_NAV_CACHE_POINTER = `${STUDENT_NAV_CACHE_PREFIX}current`;

function getStudentSidebarIdentity(session) {
  const schoolId = String(session?.apiSchoolId ?? session?.schoolId ?? '');
  const studentId = String(session?.apiUserId ?? session?.userId ?? session?.id ?? '');
  return schoolId && studentId ? { schoolId, studentId } : null;
}

function getStudentSidebarCacheKey(schoolId, studentId) {
  return `${STUDENT_NAV_CACHE_PREFIX}${encodeURIComponent(String(schoolId))}:${encodeURIComponent(String(studentId))}`;
}

function readStudentSidebarSnapshot() {
  try {
    const pointer = JSON.parse(sessionStorage.getItem(STUDENT_NAV_CACHE_POINTER) || 'null');
    if (!pointer?.schoolId || !pointer?.studentId) return null;
    const snapshot = JSON.parse(sessionStorage.getItem(getStudentSidebarCacheKey(pointer.schoolId, pointer.studentId)) || 'null');
    if (snapshot?.version !== 1
      || snapshot.role !== 'student'
      || String(snapshot.schoolId) !== String(pointer.schoolId)
      || String(snapshot.studentId) !== String(pointer.studentId)
      || typeof snapshot.access?.grades !== 'boolean'
      || typeof snapshot.access?.journals !== 'boolean') return null;
    return snapshot;
  } catch {
    return null;
  }
}

function setStudentSidebarPrepaintState(snapshot, confirmed = false) {
  const classList = document.documentElement?.classList;
  if (!classList) return;
  classList.toggle('student-nav-hide-grades', !snapshot?.access?.grades);
  classList.toggle('student-nav-hide-journals', !confirmed || !snapshot?.access?.journals);
  classList.toggle('student-nav-hide-electives', snapshot?.access?.electives !== true);
}

function saveStudentSidebarSnapshot(snapshot) {
  if (!snapshot?.schoolId || !snapshot?.studentId) return;
  try {
    sessionStorage.setItem(getStudentSidebarCacheKey(snapshot.schoolId, snapshot.studentId), JSON.stringify(snapshot));
    sessionStorage.setItem(STUDENT_NAV_CACHE_POINTER, JSON.stringify({
      schoolId: String(snapshot.schoolId),
      studentId: String(snapshot.studentId)
    }));
  } catch {
    // Sidebar rendering continues normally when session storage is unavailable.
  }
}

function clearStudentSidebarSnapshot() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(STUDENT_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // A storage failure must not prevent sign-out or navigation.
  }
}

function studentSidebarSnapshotMatchesIdentity(snapshot, session) {
  const identity = getStudentSidebarIdentity(session);
  return Boolean(identity && snapshot?.role === 'student'
    && String(snapshot.schoolId) === identity.schoolId
    && String(snapshot.studentId) === identity.studentId);
}

let cachedStudentSidebarSnapshot = readStudentSidebarSnapshot();
setStudentSidebarPrepaintState(cachedStudentSidebarSnapshot);

document.addEventListener('edugnay:current-user-updated', event => {
  if (event.detail?.role !== 'student') {
    clearStudentSidebarSnapshot();
    cachedStudentSidebarSnapshot = null;
    setStudentSidebarPrepaintState(null);
    return;
  }

  window.EDUGNAY_STUDENT.currentUser = event.detail;
  if (cachedStudentSidebarSnapshot && !studentSidebarSnapshotMatchesIdentity(cachedStudentSidebarSnapshot, event.detail)) {
    clearStudentSidebarSnapshot();
    cachedStudentSidebarSnapshot = null;
    studentSidebarAccessReady = false;
    setStudentSidebarPrepaintState(null);
  }
  if (studentSidebarAccessReady) applyStudentJournalAccess();
  renderTopbarNotifs();
});


function studentCanAccess(feature) {
  if (feature !== 'journals') return true;
  return window.EDUGNAY_CONFIG?.isJournalsEnabled?.() === true;
}

function getStudentVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || studentCanAccess(notification.access));
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;

  const visibleNotifications = getStudentVisibleNotifications();
  const top5 = [...visibleNotifications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  if (unreadLabel) {
    unreadLabel.hidden = top5.length === 0;
    unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';
  }

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
        <div class="tb-notif-head">
          <div class="tb-notif-title">${window.EDUGNAY_CONFIG.escapeHtml(n.title)}</div>
        </div>
        <div class="tb-notif-desc">${window.EDUGNAY_CONFIG.escapeHtml(n.message)}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  markCurrentNotificationRead(id).finally(() => navigate(link.page));
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  records: NOTIFICATIONS,
  getItems: getStudentVisibleNotifications
};

async function loadStudentCommunication() {
  try {
    const data = await window.EDUGNAY_API.loadCommunication('student');
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

window.EDUGNAY_COMMUNICATION_READY = loadStudentCommunication();
document.addEventListener('edugnay:calendar-notices-updated', async () => {
  if (!BACKEND_COMMUNICATION) return;
  await loadStudentCommunication();
  renderTopbarNotifs();
});


/* ── NAVIGATION ── */
function navigate(page) {
  if (page === 'dashboard') {
    window.location.href = './edugnay-student-dashboard.html';
  } else if (page === 'grades') {
    if (window.EDUGNAY_CONFIG?.isGradesPageEnabled?.() === false) {
      window.location.href = './edugnay-student-dashboard.html';
      return;
    }
    window.location.href = './edugnay-student-grades.html';
  } else if (page === 'materials') {
    window.location.href = './edugnay-student-materials.html';
  } else if (page === 'attendance') {
    if (window.EDUGNAY_CONFIG?.isAttendanceEnabled?.() === false) return;
    window.location.href = './edugnay-student-attendance.html';
  } else if (page === 'journal') {
    if (!studentCanAccess('journals')) return;
    window.location.href = './edugnay-student-journal.html';
  } else if (page === 'announcements') {
    window.location.href = './edugnay-student-announcements.html';
  } else if (page === 'profile') {
    window.location.href = './edugnay-student-profile.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-student-notifications.html';
  }
}

function applyStudentJournalAccess() {
  const enabled = studentCanAccess('journals');
  document.querySelectorAll(
    'a[href*="edugnay-student-journal.html"], [data-student-access="journals"], .journal-feature'
  ).forEach(item => {
    item.hidden = !enabled;
    if (!enabled) item.setAttribute('aria-hidden', 'true');
    else item.removeAttribute('aria-hidden');
  });

  const page = window.location.pathname.split('/').pop().toLowerCase();
  if (!enabled && studentSidebarAccessReady && page === 'edugnay-student-journal.html') {
    window.location.replace('./edugnay-student-dashboard.html');
  }
}

function applyStudentGradesAccess(enabled) {
  document.querySelectorAll('a[href*="edugnay-student-grades.html"]').forEach(link => {
    link.hidden = !enabled;
    link.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) link.setAttribute('tabindex', '-1');
    else link.removeAttribute('tabindex');
  });
}

function applyStudentAttendanceAccess() {
  const enabled = window.EDUGNAY_CONFIG?.isAttendanceEnabled?.() !== false;
  document.querySelectorAll('a[href*="edugnay-student-attendance.html"]').forEach(link => {
    link.hidden = !enabled;
    link.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) link.setAttribute('tabindex', '-1');
    else link.removeAttribute('tabindex');
  });
  if (!enabled && window.location.pathname.endsWith('/edugnay-student-attendance.html')) {
    window.location.replace('./edugnay-student-dashboard.html');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleDrawer(false); if (typeof closeEntryModal === 'function') closeEntryModal(); }
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', async () => {
  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  await window.EDUGNAY_COMMUNICATION_READY;
  const backendEnabled = Boolean(window.EDUGNAY_API?.isBackendAvailable);
  let portalElectivesEligible = false;
  let portalElectivesIdentity = null;
  if (backendEnabled) {
    if (await window.EDUGNAY_API.enforceProfileSetup('edugnay-student-profile.html', 'student')) return;

    let session = window.EDUGNAY_STUDENT.currentUser;
    if (!session && window.EDUGNAY_API.getCurrentUser) {
      try {
        session = await window.EDUGNAY_API.getCurrentUser();
        if (session?.role === 'student') window.EDUGNAY_STUDENT.currentUser = session;
      } catch (error) {
        if (error?.status === 401) {
          clearStudentSidebarSnapshot();
          cachedStudentSidebarSnapshot = null;
          setStudentSidebarPrepaintState(null);
          return;
        }
      }
    }

    if (session?.role === 'student' && cachedStudentSidebarSnapshot
      && !studentSidebarSnapshotMatchesIdentity(cachedStudentSidebarSnapshot, session)) {
      clearStudentSidebarSnapshot();
      cachedStudentSidebarSnapshot = null;
      setStudentSidebarPrepaintState(null);
    } else if (session && session.role !== 'student') {
      clearStudentSidebarSnapshot();
      cachedStudentSidebarSnapshot = null;
      setStudentSidebarPrepaintState(null);
    }

    try {
      const portal = await window.EDUGNAY_API.getPortalFeatures();
      portalElectivesEligible = session?.role === 'student' && portal.electivesEligible === true;
      portalElectivesIdentity = getStudentSidebarIdentity(session);
      window.EDUGNAY_API.setPortalFeatures({ ...portal.features, journalSubjectId: portal.journalSubjectId,
        journalSubjectName: portal.journalSubjectName, journalSubjectEligible: portal.journalSubjectEligible });
    } catch {
      window.EDUGNAY_API.setPortalFeatures(null);
    }
  }

  const session = window.EDUGNAY_STUDENT.currentUser;
  const identity = getStudentSidebarIdentity(session);
  const freshAccess = {
    grades: window.EDUGNAY_CONFIG?.isGradesPageEnabled?.() !== false,
    journals: studentCanAccess('journals'),
    electives: Boolean(portalElectivesEligible && identity
      && portalElectivesIdentity?.schoolId === identity.schoolId
      && portalElectivesIdentity?.studentId === identity.studentId)
  };
  const freshSnapshot = identity && session?.role === 'student' ? {
    version: 1,
    role: 'student',
    ...identity,
    access: freshAccess
  } : null;
  setStudentSidebarPrepaintState({ access: freshAccess }, true);
  applyStudentGradesAccess(freshAccess.grades);
  if (freshSnapshot) {
    saveStudentSidebarSnapshot(freshSnapshot);
    cachedStudentSidebarSnapshot = freshSnapshot;
  }
  studentSidebarAccessReady = true;
  applyStudentJournalAccess();
  applyStudentAttendanceAccess();
  renderTopbarNotifs();
});
