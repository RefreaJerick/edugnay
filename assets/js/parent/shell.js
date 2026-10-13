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

function renderParentIdentity() {
  const parent = window.EDUGNAY_PARENT.currentUser;
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
  markCurrentNotificationRead(id).finally(() => navigate(link.page));
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
  if (page === 'dashboard' || page === 'assignments' || page === 'journal') {
    window.location.href = './edugnay-parent-dashboard.html';
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

function applyParentReportAccess() {
  const enabled = window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  document.querySelectorAll('a[href*="edugnay-parent-reports.html"]').forEach(link => {
    link.hidden = !enabled;
    link.setAttribute('aria-hidden', String(!enabled));
    if (!enabled) link.setAttribute('tabindex', '-1');
    else link.removeAttribute('tabindex');
  });

  document.querySelectorAll('.report-hero, .report-hero-link').forEach(item => {
    item.hidden = !enabled;
  });

  const page = window.location.pathname.split('/').pop().toLowerCase();
  if (!enabled && page === 'edugnay-parent-reports.html') {
    window.location.replace('./edugnay-parent-dashboard.html');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleDrawer(false); }
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', async () => {
  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  await window.EDUGNAY_COMMUNICATION_READY;
  if (PARENT_BACKEND_MODE) {
    if (await window.EDUGNAY_API.enforceProfileSetup('edugnay-parent-profile.html', 'parent')) return;
    try {
      const user = await window.EDUGNAY_API.getCurrentUser();
      if (user?.role !== 'parent') return;
      window.EDUGNAY_PARENT.currentUser = user;
    } catch (error) {
      console.warn('Parent identity could not be loaded.', error.message);
    }
  }
  renderParentIdentity();
  applyParentReportAccess();
  renderTopbarNotifs();
});
