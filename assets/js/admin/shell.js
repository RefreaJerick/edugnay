/* ══════════════════════════════════════════
   ADMIN SHELL — shared across all admin pages
   Nav, topbar, notif dropdown, profile dropdown
   Notifications and related alerts come from the backend.
   ══════════════════════════════════════════ */

/* ── REOPEN REQUEST DATA (source: grading-period reopen request system) ── */
/* Frontend-only redirect. The backend must also reject access for any
   authenticated school whose platform status is not active. */
function enforceSchoolAccess() {
  const school = window.EDUGNAY_CONFIG.getActiveSchool();
  const statuses = window.EDUGNAY_CONFIG.values.statuses;

  if (school?.platformStatus === statuses.PENDING) {
    window.location.replace('../onboarding/edugnay-registration-pending.html');
    return false;
  }

  if (school && school.platformStatus !== statuses.ACTIVE) {
    window.location.replace('../../index.html');
    return false;
  }

  return true;
}

enforceSchoolAccess();
document.addEventListener('edugnay:school-context-updated', enforceSchoolAccess);
let ADMIN_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
document.addEventListener('edugnay:school-context-updated', () => {
  ADMIN_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
  renderTopbarNotifs();
});
// This in-memory list is refreshed from the grading-period reopen API.
let ADMIN_REOPEN_REQUESTS = [];

function getAdminReopenRequestCache() {
  return ADMIN_REOPEN_REQUESTS;
}

async function refreshAdminReopenRequests() {
  if (!window.EDUGNAY_API?.isBackendAvailable) return;
  try {
    ADMIN_REOPEN_REQUESTS = await window.EDUGNAY_API.getGradingPeriodReopenRequests();
    renderTopbarNotifs();
  } catch (error) {
    console.warn('Grading-period reopen requests could not be loaded.', error.message);
  }
}

function getReopenRequestDetails(request) {
  return {
    teacher: request.teacher || request.teacherName || 'Teacher',
    section: request.section || request.sectionName || 'Section',
    subject: request.subject || request.subjectName || 'Subject'
  };
}

function getReopenPeriodName(request) {
  return request.academicTermName || 'Grading period';
}

/* ── NOTIFICATIONS DATA ──
   Reopen-request notifications are derived from the database-backed request API. */

function getAcademicPeriodNotifications() {
  const school = window.EDUGNAY_CONFIG.getActiveSchool();
  return (school?.schoolLevels || []).map(schoolLevel => {
    const period = window.EDUGNAY_CONFIG.getCurrentAcademicPeriod(ADMIN_SCHOOL_ID, schoolLevel);
    const reminder = window.EDUGNAY_CONFIG.getAcademicPeriodReminder(period);
    if (!period || !reminder) return null;
    const levelLabel = window.EDUGNAY_CONFIG.grades.find(level => level.key === schoolLevel)?.label || schoolLevel;

    return {
      id: `admin-notif-period-${schoolLevel}-${period.id}-${reminder.label}`,
      schoolId: ADMIN_SCHOOL_ID,
      icon: 'calendar-clock',
      tone: reminder.tone === 'danger' ? 'red' : 'gold',
      type: 'Academic terms',
      read: false,
      title: `${levelLabel} ${period.name}: ${reminder.label}`,
      message: 'Review the schedule, close the grading period, or extend its planned end date.',
      link: { page: 'schools', hash: 'academic-terms' },
      createdAt: new Date().toISOString()
    };
  }).filter(Boolean);
}

let NOTIFICATIONS = [];
let BACKEND_COMMUNICATION = false;

/* ── ADMIN ACTIVITY DATA (shared by the dashboard and activity page) ──
   GET /api/school/activity serves the dashboard and full activity page. */


function getAdminNotifItems() {
  const reopenNotifications = getAdminReopenRequestCache()
    .filter(request => request.status === 'pending')
    .map(request => {
      const details = getReopenRequestDetails(request);
      return {
        id: `admin-notif-reopen-${request.id}`,
        schoolId: ADMIN_SCHOOL_ID,
        icon: 'unlock',
        tone: 'gold',
        type: 'Reopen request',
        title: `Reopen requested: ${getReopenPeriodName(request)}`,
        message: `${details.teacher} · ${details.section} · ${details.subject}`,
        read: window.EDUGNAY_API.isSyntheticNotificationRead(`admin-notif-reopen-${request.id}`),
        link: { page: 'system-config', hash: 'reopen-requests' },
        createdAt: request.requestedAt
      };
    });

  if (BACKEND_COMMUNICATION) {
    return [...NOTIFICATIONS, ...reopenNotifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return [...getAcademicPeriodNotifications(), ...NOTIFICATIONS, ...reopenNotifications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const list = document.getElementById('tbNotifList');
  const dot = document.getElementById('tbNotifDot');
  if (!list) return;

  const items = getAdminNotifItems().slice(0, 5);
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  const unreadCount = items.filter(n => !n.read).length;
  if (unreadLabel) {
    unreadLabel.hidden = items.length === 0;
    unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';
  }

  if (!items.length) {
    list.innerHTML = `
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

  list.innerHTML = items.map(n => `
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick='goToTopbarNotif(${JSON.stringify(n.link)}, ${JSON.stringify(n.id)})'>
      <div class="tb-notif-icon ${n.tone}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-head">
          <div class="tb-notif-title">${window.EDUGNAY_CONFIG.escapeHtml(n.title)}</div>
        </div>
        <div class="tb-notif-desc">${window.EDUGNAY_CONFIG.escapeHtml(n.message)}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = items.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? '' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  markCurrentNotificationRead(id).finally(() => navigate(link?.page, link?.hash));
}

function navigate(page, hash) {
  const pages = {
    dashboard: 'edugnay-admin-dashboard.html',
    users: 'edugnay-admin-users.html',
    management: 'edugnay-admin-management.html',
    reports: 'edugnay-admin-reports.html',
    announcements: 'edugnay-admin-announcements.html',
    schools: 'edugnay-admin-schools.html',
    'system-config': 'edugnay-admin-system-config.html'
  };
  const target = pages[page] || 'edugnay-admin-dashboard.html';
  window.location.href = hash ? `${target}#${hash}` : target;
}

window.EDUGNAY_ADMIN = {
  notifications: NOTIFICATIONS,
  getNotifications: getAdminNotifItems,
  refreshReopenRequests: refreshAdminReopenRequests
};

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  getItems: getAdminNotifItems
};

async function loadAdminCommunication() {
  try {
    const data = await window.EDUGNAY_API.loadCommunication('school_admin');
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

window.EDUGNAY_COMMUNICATION_READY = loadAdminCommunication();
document.addEventListener('edugnay:calendar-notices-updated', async () => {
  if (!BACKEND_COMMUNICATION) return;
  await loadAdminCommunication();
  renderTopbarNotifs();
});

/* ── ACTIVE NAV ITEM ON CLICK ── */
document.addEventListener('DOMContentLoaded', async () => {
  try { await window.EDUGNAY_SCHOOL_READY; }
  catch { showAppToast('School information could not be loaded.', 'error'); }
  await Promise.all([window.EDUGNAY_COMMUNICATION_READY, refreshAdminReopenRequests()]);
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      this.classList.add('active');
      toggleDrawer(false);
    });
  });

  renderTopbarNotifs();
});

window.addEventListener('grading-period-reopen-requests-updated', refreshAdminReopenRequests);
