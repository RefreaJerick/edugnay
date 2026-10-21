/* ══════════════════════════════════════════
   PARENT SHELL — shared across all parent pages
   Nav, topbar, notif dropdown, profile dropdown
   Communication data comes from the backend.
   ══════════════════════════════════════════ */

/* ── LINKED CHILDREN DATA ── */
const PARENT_CONFIG = window.EDUGNAY_CONFIG;
const PARENT_BACKEND_MODE = Boolean(window.EDUGNAY_API?.isBackendAvailable);
window.EDUGNAY_PARENT = {
  currentUser: null,
  children: []
};
const PARENT_NAV_CACHE_PREFIX = window.EDUGNAY_PARENT_NAV_CACHE_PREFIX || 'edugnay_parent_sidebar_v1:';
const PARENT_NAV_CACHE_POINTER = `${PARENT_NAV_CACHE_PREFIX}current`;

function parentSidebarIdentity(user) {
  const schoolId = String(user?.apiSchoolId ?? user?.schoolId ?? '');
  const parentId = String(user?.apiUserId ?? user?.userId ?? user?.id ?? '');
  return schoolId && parentId ? { schoolId, parentId } : null;
}

function parentSidebarCacheKey(schoolId, parentId) {
  return `${PARENT_NAV_CACHE_PREFIX}${encodeURIComponent(schoolId)}:${encodeURIComponent(parentId)}`;
}

function readParentSidebarSnapshot() {
  try {
    const pointer = JSON.parse(sessionStorage.getItem(PARENT_NAV_CACHE_POINTER) || 'null');
    if (!pointer?.schoolId || !pointer?.parentId) return null;
    const snapshot = JSON.parse(sessionStorage.getItem(parentSidebarCacheKey(pointer.schoolId, pointer.parentId)) || 'null');
    if (snapshot?.version !== 1 || snapshot.role !== 'parent'
      || String(snapshot.schoolId) !== String(pointer.schoolId)
      || String(snapshot.parentId) !== String(pointer.parentId)
      || typeof snapshot.access?.grades !== 'boolean'
      || typeof snapshot.access?.reports !== 'boolean') return null;
    return snapshot;
  } catch { return null; }
}

function setParentSidebarPrepaintState(snapshot) {
  const classes = document.documentElement?.classList;
  if (!classes) return;
  classes.toggle('parent-nav-hide-grades', !snapshot?.access?.grades);
  classes.toggle('parent-nav-hide-reports', !snapshot?.access?.reports);
}

function saveParentSidebarSnapshot(snapshot) {
  try {
    sessionStorage.setItem(parentSidebarCacheKey(snapshot.schoolId, snapshot.parentId), JSON.stringify(snapshot));
    sessionStorage.setItem(PARENT_NAV_CACHE_POINTER, JSON.stringify({
      schoolId: snapshot.schoolId, parentId: snapshot.parentId
    }));
  } catch { /* Navigation still works when session storage is unavailable. */ }
}

function clearParentSidebarSnapshot() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(PARENT_NAV_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* Continue when session storage is unavailable. */ }
  cachedParentSidebarSnapshot = null;
  setParentSidebarPrepaintState(null);
}

function parentSidebarSnapshotMatchesUser(snapshot, user) {
  const identity = parentSidebarIdentity(user);
  return Boolean(identity && user?.role === 'parent'
    && snapshot?.schoolId === identity.schoolId && snapshot?.parentId === identity.parentId);
}

let cachedParentSidebarSnapshot = readParentSidebarSnapshot();
setParentSidebarPrepaintState(cachedParentSidebarSnapshot);

document.addEventListener('edugnay:current-user-updated', event => {
  const user = event.detail;
  if (cachedParentSidebarSnapshot && !parentSidebarSnapshotMatchesUser(cachedParentSidebarSnapshot, user)) {
    clearParentSidebarSnapshot();
  }
  if (user?.role === 'parent') window.EDUGNAY_PARENT.currentUser = user;
  else window.EDUGNAY_PARENT.currentUser = null;
});

function renderParentIdentity() {
  const parent = window.EDUGNAY_PARENT.currentUser;
  if (!parent && document.documentElement.classList.contains('profile-chip-restored')) return;
  const displayName = parent?.displayName
    || [parent?.firstName, parent?.lastName].filter(Boolean).join(' ')
    || 'Profile unavailable';
  const firstName = parent?.firstName || 'Parent';
  const initials = parent?.initials || PARENT_CONFIG.getInitials(displayName) || '--';

  document.querySelectorAll('[data-parent-name]').forEach(element => {
    element.textContent = displayName;
  });
  document.querySelectorAll('[data-parent-first-name]').forEach(element => {
    element.textContent = firstName;
  });
  document.querySelectorAll('[data-parent-initials]').forEach(element => {
    if (element.classList.contains('tb-avatar')) {
      window.EDUGNAY_AVATAR.render(element, {
        id: parent?.apiUserId || parent?.id,
        name: displayName,
        initials,
        avatarUrl: parent?.avatarUrl,
        role: 'parent'
      });
    } else {
      element.textContent = initials;
    }
  });
}

/* ── NOTIFICATIONS DATA ── */
let NOTIFICATIONS = [];
let BACKEND_COMMUNICATION = false;


function getParentVisibleNotifications() {
  const reportsEnabled = window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  return NOTIFICATIONS.filter(notification => !notification.access || reportsEnabled);
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;

  const visibleNotifications = getParentVisibleNotifications();
  const top5 = [...visibleNotifications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

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
  markCurrentNotificationRead(id).finally(() => {
    if (link.page === 'reports' && /^\d+$/.test(String(link.studentId || ''))) {
      const query = new URLSearchParams({ studentId: String(link.studentId) });
      if (/^\d+$/.test(String(link.reportId || ''))) query.set('reportId', String(link.reportId));
      window.location.href = './edugnay-parent-reports.html?' + query.toString();
      return;
    }
    navigate(link.page);
  });
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  records: NOTIFICATIONS,
  getItems: getParentVisibleNotifications
};

async function loadParentCommunication() {
  try {
    const data = await window.EDUGNAY_API.loadCommunication('parent');
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

window.EDUGNAY_COMMUNICATION_READY = loadParentCommunication();
document.addEventListener('edugnay:calendar-notices-updated', async () => {
  if (!BACKEND_COMMUNICATION) return;
  await loadParentCommunication();
  renderTopbarNotifs();
});


/* ── NAVIGATION ── */
function navigate(page) {
  if (page === 'dashboard' || page === 'journal') {
    window.location.href = './edugnay-parent-dashboard.html';
  } else if (page === 'assignments') {
    window.location.href = './edugnay-parent-assignments.html';
  } else if (page === 'grades') {
    if (window.EDUGNAY_CONFIG?.isGradesPageEnabled?.() === false) {
      window.location.href = './edugnay-parent-dashboard.html';
      return;
    }
    window.location.href = './edugnay-parent-grades.html';
  } else if (page === 'reports') {
    if (window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() === false) {
      window.location.href = './edugnay-parent-dashboard.html';
      return;
    }
    window.location.href = './edugnay-parent-reports.html';
  } else if (page === 'attendance') {
    window.location.href = './edugnay-parent-attendance.html';
  } else if (page === 'announcements') {
    window.location.href = './edugnay-parent-announcements.html';
  } else if (page === 'profile') {
    window.location.href = './edugnay-parent-profile.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-parent-notifications.html';
  }
}

function applyParentReportAccess(enabled) {
  document.querySelectorAll('.report-hero, .report-hero-link').forEach(item => {
    item.hidden = !enabled;
  });
}

function applyParentSidebarAccess(snapshot, verified = false) {
  setParentSidebarPrepaintState(snapshot);
  applyParentReportAccess(Boolean(snapshot?.access?.reports));
  if (!verified) return;
  const page = window.location.pathname.split('/').pop().toLowerCase();
  if ((!snapshot.access.grades && page === 'edugnay-parent-grades.html')
    || (!snapshot.access.reports && page === 'edugnay-parent-reports.html')) {
    window.location.replace('./edugnay-parent-dashboard.html');
  }
}

function refreshParentSidebarAccess() {
  const user = window.EDUGNAY_PARENT.currentUser;
  const identity = parentSidebarIdentity(user);
  const school = PARENT_CONFIG?.getActiveSchool?.();
  if (school?.id && identity && String(school.id) !== identity.schoolId) {
    clearParentSidebarSnapshot();
    return;
  }
  if (!identity || user?.role !== 'parent' || !school?.id
    || String(school.id) !== identity.schoolId) return;
  const snapshot = {
    version: 1, role: 'parent', ...identity,
    access: {
      grades: PARENT_CONFIG.isGradesPageEnabled(),
      reports: PARENT_CONFIG.isNarrativeReportsEnabled()
    }
  };
  cachedParentSidebarSnapshot = snapshot;
  saveParentSidebarSnapshot(snapshot);
  applyParentSidebarAccess(snapshot, true);
}

document.addEventListener('edugnay:school-context-updated', () => {
  if (window.EDUGNAY_PARENT.currentUser) refreshParentSidebarAccess();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleDrawer(false); }
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', async () => {
  applyParentSidebarAccess(cachedParentSidebarSnapshot);
  let schoolReady = false;
  try { await window.EDUGNAY_SCHOOL_READY; schoolReady = true; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  if (PARENT_BACKEND_MODE) {
    if (await window.EDUGNAY_API.enforceProfileSetup('edugnay-parent-profile.html', 'parent')) return;
    try {
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'parent') {
        clearParentSidebarSnapshot();
        return;
      }
      window.EDUGNAY_PARENT.currentUser = user;
    } catch (error) {
      if (error.status === 401) clearParentSidebarSnapshot();
      console.warn('Parent identity could not be loaded.', error.message);
    }
  }
  renderParentIdentity();
  if (schoolReady && window.EDUGNAY_PARENT.currentUser) refreshParentSidebarAccess();
  await window.EDUGNAY_COMMUNICATION_READY;
  renderTopbarNotifs();
});
