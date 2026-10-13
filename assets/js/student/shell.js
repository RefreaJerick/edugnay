/* ══════════════════════════════════════════
   STUDENT SHELL — shared across all student pages
   Nav, topbar, notif dropdown, profile dropdown
   Communication data comes from the backend.
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
window.EDUGNAY_STUDENT = { currentUser: null };
document.addEventListener('edugnay:current-user-updated', event => {
  if (event.detail?.role === 'student') window.EDUGNAY_STUDENT.currentUser = event.detail;
});

let NOTIFICATIONS = [];
let BACKEND_COMMUNICATION = false;
let studentJournalHistoryAvailable = false;


function studentCanAccess(feature) {
  return feature !== 'journals'
    || window.EDUGNAY_CONFIG?.isJournalsEnabled?.() !== false
    || studentJournalHistoryAvailable;
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
  if (!enabled && page === 'edugnay-student-journal.html') {
    window.location.replace('./edugnay-student-dashboard.html');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { toggleDrawer(false); closeEntryModal(); }
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', async () => {
  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  await window.EDUGNAY_COMMUNICATION_READY;
  const backendEnabled = Boolean(window.EDUGNAY_API?.isBackendAvailable);
  if (backendEnabled) {
    if (await window.EDUGNAY_API.enforceProfileSetup('edugnay-student-profile.html', 'student')) return;
    try {
      const portal = await window.EDUGNAY_API.getPortalFeatures();
      window.EDUGNAY_API.setPortalFeatures({ ...portal.features, journalSubjectId: portal.journalSubjectId, journalSubjectName: portal.journalSubjectName });
      try {
        const history = await window.EDUGNAY_API.getJournalHistory();
        studentJournalHistoryAvailable = history.entries.length > 0;
      } catch { studentJournalHistoryAvailable = false; }
    } catch { window.EDUGNAY_API.setPortalFeatures(null); }
  }
  applyStudentJournalAccess();
  renderTopbarNotifs();
});
