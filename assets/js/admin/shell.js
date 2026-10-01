/* ══════════════════════════════════════════
   ADMIN SHELL — shared across all admin pages
   Nav, topbar, notif dropdown, profile dropdown
   API notifications are used when the backend is available; local alerts remain
   only as the frontend-only fallback.
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

  if (school?.platformStatus !== statuses.ACTIVE) {
    window.location.replace('../../index.html');
    return false;
  }

  return true;
}

enforceSchoolAccess();
const ADMIN_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
const ADMIN_READ_STORE_KEY = `edugnay_admin_notif_read:${ADMIN_SCHOOL_ID}`;
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
const ADMIN_NO_CLASS_DAY = window.EDUGNAY_CONFIG.getNoClassDay();

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

let NOTIFICATIONS = [
  ...(ADMIN_NO_CLASS_DAY ? [{
    id: `admin-notif-no-class-${ADMIN_NO_CLASS_DAY.date}`,
    schoolId: ADMIN_SCHOOL_ID,
    icon: 'calendar-off',
    tone: 'gold',
    type: 'Calendar',
    read: false,
    title: ADMIN_NO_CLASS_DAY.title || 'No classes today',
    message: ADMIN_NO_CLASS_DAY.detail || 'Classes are suspended today.',
    link: { page: 'announcements' },
    createdAt: `${ADMIN_NO_CLASS_DAY.date}T00:00:00.000Z`
  }] : []),
  {
    id: 'admin-notif-announcement',
    icon: 'megaphone',
    tone: 'gold',
    type: 'Announcement',
    read: true,
    title: 'Announcement published',
    message: 'The Q2 grade encoding deadline was sent to teachers.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 'admin-notif-calendar',
    icon: 'calendar-clock',
    tone: 'gray',
    type: 'Calendar',
    read: true,
    title: 'No-class day configured',
    message: 'Foundation Day has been added to the school calendar.',
    link: { page: 'schools' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  }
]
  .map(record => ({ ...record, schoolId: record.schoolId || 'scc' }))
  .filter(record => record.schoolId === ADMIN_SCHOOL_ID);

let BACKEND_COMMUNICATION = false;

/* ── ADMIN ACTIVITY DATA (shared by the dashboard and activity page) ──
   Historical mock records below are disabled; live data comes from the API.
   GET /api/school/activity serves the dashboard and full activity page. */
/* const ADMIN_ACTIVITY = [
  {
    id: 'admin-activity-announcement-001',
    schoolId: 'scc',
    actor: 'Admin',
    title: 'posted an announcement to Teachers',
    detail: '"Q2 Grade Encoding Deadline."',
    icon: 'megaphone',
    tone: 'purple',
    type: 'Announcement',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setHours(10, 20, 0, 0)).toISOString()
  },
  {
    id: 'admin-activity-assignment-001',
    schoolId: 'scc',
    actor: 'Admin',
    title: 'assigned Mr. Paolo Tan',
    detail: 'to Grade 8 – Mathematics.',
    icon: 'user-check',
    tone: 'blue',
    type: 'Assignment',
    link: { page: 'management', tab: 'teachers' },
    createdAt: new Date(new Date().setHours(8, 15, 0, 0)).toISOString()
  },
  {
    id: 'admin-activity-config-001',
    schoolId: 'scc',
    actor: 'System Config',
    title: 'updated',
    detail: 'Q2 grading period activated.',
    icon: 'settings-2',
    tone: 'gold',
    type: 'Config',
    link: { page: 'system-config' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString()
  },
  {
    id: 'admin-activity-alert-001',
    schoolId: 'scc',
    actor: 'Ana Santos',
    title: 'was flagged by the system',
    detail: '4 consecutive absences.',
    icon: 'alert-triangle',
    tone: 'red',
    type: 'Alert',
    link: { page: 'reports' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 'admin-activity-account-001',
    schoolId: 'scc',
    actor: 'Admin',
    title: 'created a new teacher account',
    detail: 'for Ms. Carla Dizon.',
    icon: 'user-plus',
    tone: 'blue',
    type: 'Account',
    link: { page: 'users' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString()
  },
  {
    id: 'admin-activity-announcement-002',
    schoolId: 'scc',
    actor: 'Admin',
    title: 'posted an announcement to All Users',
    detail: '"Foundation Week Schedule."',
    icon: 'megaphone',
    tone: 'purple',
    type: 'Announcement',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 6)).toISOString()
  },
  {
    id: 'admin-activity-alert-002',
    schoolId: 'scc',
    actor: 'Ben Garcia',
    title: 'was flagged by the system',
    detail: 'Failing grade in 2 subjects.',
    icon: 'alert-triangle',
    tone: 'red',
    type: 'Alert',
    link: { page: 'reports' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 9)).toISOString()
  },
  {
    id: 'admin-activity-config-002',
    schoolId: 'scc',
    actor: 'System Config',
    title: 'updated',
    detail: 'Archive policy set to 3 school years.',
    icon: 'settings-2',
    tone: 'gold',
    type: 'Config',
    link: { page: 'system-config' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 12)).toISOString()
  }
]
  .filter(record => record.schoolId === ADMIN_SCHOOL_ID); */

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
        read: false,
        link: { page: 'system-config', hash: 'reopen-requests' },
        createdAt: request.requestedAt
      };
    });

  if (BACKEND_COMMUNICATION) {
    return [...NOTIFICATIONS, ...reopenNotifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const currentNotifications = [...getAcademicPeriodNotifications(), ...NOTIFICATIONS];
  window.EDUGNAY_CONFIG.applyNotificationReadState(currentNotifications, ADMIN_READ_STORE_KEY);
  const readIds = window.EDUGNAY_CONFIG.getNotificationReadIds(ADMIN_READ_STORE_KEY);
  const localNotifications = currentNotifications.map(notification => ({ ...notification }));
  reopenNotifications.forEach(notification => {
    notification.read = readIds.includes(notification.id);
  });

  return [...localNotifications, ...reopenNotifications]
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
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  if (!items.length) {
    list.innerHTML = `
      <div class="tb-notif-empty" id="tbNotifEmpty">
        <div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div>
        <div class="tb-notif-empty-title">No notifications yet</div>
        <div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div>
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
  notificationStorageKey: ADMIN_READ_STORE_KEY,
  refreshReopenRequests: refreshAdminReopenRequests
};

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  storageKey: ADMIN_READ_STORE_KEY,
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

function toggleNavGroup(group) {
  group.classList.toggle('open');
}

function ensureAdminConfigurationNav() {
  const settingsSection = [...document.querySelectorAll('.nav-section')]
    .find(section => section.querySelector('.nav-section-label')?.textContent.trim().toLowerCase() === 'settings');
  if (!settingsSection || settingsSection.dataset.adminConfigNavReady === 'true') return;

  const items = [
    { href: 'edugnay-admin-schools.html', icon: 'building-2', label: 'School Settings' },
    { href: 'edugnay-admin-system-config.html', icon: 'settings', label: 'System Config' },
    { href: 'edugnay-admin-archive.html', icon: 'archive', label: 'Archive Data' }
  ];
  const current = location.pathname.split('/').pop();
  items.forEach(item => {
    const link = settingsSection.querySelector(`a[href="${item.href}"]`)
      || [...settingsSection.querySelectorAll('a.nav-item')]
        .find(candidate => candidate.querySelector('.nav-label')?.textContent.trim() === item.label);

    const normalizedLink = link || document.createElement('a');
    normalizedLink.className = `nav-item ${current === item.href ? 'active' : ''}`;
    normalizedLink.href = item.href;
    normalizedLink.dataset.adminConfigNav = 'true';
    if (!link) {
      normalizedLink.innerHTML = `<div class="nav-icon"><i data-lucide="${item.icon}" style="width:16px;height:16px;"></i></div><span class="nav-label">${item.label}</span>`;
    }
    settingsSection.append(normalizedLink);
  });
  settingsSection.dataset.adminConfigNavReady = 'true';
  if (window.lucide) lucide.createIcons();
}

/* ── ACTIVE NAV ITEM ON CLICK ── */
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([window.EDUGNAY_COMMUNICATION_READY, refreshAdminReopenRequests()]);
  ensureAdminConfigurationNav();
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
