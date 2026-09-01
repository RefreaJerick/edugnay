/* ══════════════════════════════════════════
   ADMIN SHELL — shared across all admin pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS and getReopenRequests()
   with data from GET /admin/notifications
   ══════════════════════════════════════════ */

/* ── REOPEN REQUEST DATA (source: quarter reopen request system) ── */
const ADMIN_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
const REOPEN_STORE_KEY = `edugnay_reopen_requests:${ADMIN_SCHOOL_ID}`;
const ADMIN_READ_STORE_KEY = `edugnay_admin_notif_read:${ADMIN_SCHOOL_ID}`;

function getReopenRequests() {
  try {
    return (JSON.parse(localStorage.getItem(REOPEN_STORE_KEY)) || [])
      .filter(record => record.schoolId === ADMIN_SCHOOL_ID);
  }
  catch { return []; }
}

function getReopenRequestDetails(request) {
  const teacher = window.EDUGNAY_CONFIG.getUsers().find(user => user.profileId === request.teacherId);
  const section = window.EDUGNAY_CONFIG.getAssignmentSections().find(item => item.id === request.sectionId);
  const subject = window.EDUGNAY_CONFIG.subjects.find(item => item.id === request.subjectId);
  return {
    teacher: teacher?.displayName || request.teacher || 'Teacher',
    section: section ? `${section.grade} – ${section.name}` : request.section || 'Section',
    subject: subject?.name || request.subject || 'Subject'
  };
}

/* ── NOTIFICATIONS DATA ──
   Replace this local array with the signed-in school admin's notification
   response later. Reopen requests remain local for now and are merged below. */
const NOTIFICATIONS = [
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
  .map(record => ({ ...record, schoolId: 'scc' }))
  .filter(record => record.schoolId === ADMIN_SCHOOL_ID);

/* ── ADMIN ACTIVITY DATA (shared by the dashboard and activity page) ──
   TODO on backend conversion: replace this local array with records from
   GET /admin/activity (scoped to the authenticated school). */
const ADMIN_ACTIVITY = [
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
  .filter(record => record.schoolId === ADMIN_SCHOOL_ID);

function getAdminNotifItems() {
  window.EDUGNAY_CONFIG.applyNotificationReadState(NOTIFICATIONS, ADMIN_READ_STORE_KEY);
  const readIds = window.EDUGNAY_CONFIG.getNotificationReadIds(ADMIN_READ_STORE_KEY);
  const localNotifications = NOTIFICATIONS.map(notification => ({ ...notification }));
  const reopenNotifications = getReopenRequests()
    .filter(r => r.status === 'pending')
    .map(r => {
      const details = getReopenRequestDetails(r);
      return {
        id: `admin-notif-reopen-${r.id}`,
        schoolId: ADMIN_SCHOOL_ID,
        icon: 'unlock',
        tone: 'gold',
        type: 'Reopen request',
        title: `Reopen requested: Q${r.quarter.slice(1)}`,
        message: `${details.teacher} - ${details.section} · ${details.subject}`,
        read: readIds.includes(`admin-notif-reopen-${r.id}`),
        link: { page: 'system-config', hash: 'reopen-requests' },
        createdAt: r.createdAt
      };
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
          <div class="tb-notif-title">${n.title}</div>
        </div>
        <div class="tb-notif-desc">${n.message}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = items.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? '' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  window.EDUGNAY_CONFIG.markNotificationRead(ADMIN_READ_STORE_KEY, id, getAdminNotifItems());
  navigate(link?.page, link?.hash);
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
  activities: ADMIN_ACTIVITY,
  notifications: NOTIFICATIONS,
  getNotifications: getAdminNotifItems,
  notificationStorageKey: ADMIN_READ_STORE_KEY
};

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  storageKey: ADMIN_READ_STORE_KEY,
  getItems: getAdminNotifItems
};

function toggleNavGroup(group) {
  group.classList.toggle('open');
}

function ensureAdminConfigurationNav() {
  const settingsSection = [...document.querySelectorAll('.nav-section')]
    .find(section => section.querySelector('.nav-section-label')?.textContent.trim().toLowerCase() === 'settings');
  if (!settingsSection || settingsSection.dataset.adminConfigNavReady === 'true') return;

  const items = [
    { href: 'edugnay-admin-schools.html', icon: 'building-2', label: 'School Settings' },
    { href: 'edugnay-admin-sf-templates.html', icon: 'file-cog', label: 'SF Templates' },
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
