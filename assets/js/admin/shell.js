/* ══════════════════════════════════════════
   ADMIN SHELL — shared across all admin pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS and getReopenRequests()
   with data from GET /admin/notifications
   ══════════════════════════════════════════ */

/* ── REOPEN REQUEST DATA (source: quarter reopen request system) ── */
const REOPEN_STORE_KEY = 'edugnay_reopen_requests';
const ADMIN_READ_STORE_KEY = 'edugnay_admin_notif_read';

function getReopenRequests() {
  try { return JSON.parse(localStorage.getItem(REOPEN_STORE_KEY)) || []; }
  catch { return []; }
}

function getReadIds() {
  try { return JSON.parse(localStorage.getItem(ADMIN_READ_STORE_KEY)) || []; }
  catch { return []; }
}
function setReadIds(ids) {
  localStorage.setItem(ADMIN_READ_STORE_KEY, JSON.stringify(ids));
}

/* ── NOTIFICATIONS DATA ──
   Replace this local array with the signed-in school admin's notification
   response later. Reopen requests remain local for now and are merged below. */
const NOTIFICATIONS = [
  {
    id: 'admin-notif-announcement',
    icon: 'megaphone',
    color: 'gold',
    tag: 'Announcement',
    read: true,
    title: 'Announcement published',
    desc: 'The Q2 grade encoding deadline was sent to teachers.',
    link: 'edugnay-admin-announcements.html',
    created_at: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 'admin-notif-calendar',
    icon: 'calendar-clock',
    color: 'gray',
    tag: 'Calendar',
    read: true,
    title: 'No-class day configured',
    desc: 'Foundation Day has been added to the school calendar.',
    link: 'edugnay-admin-schools.html',
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  }
];

function applyReadState() {
  const readIds = getReadIds();
  NOTIFICATIONS.forEach(notification => {
    if (readIds.includes(notification.id)) notification.read = true;
  });
}

/* ── ADMIN ACTIVITY DATA (shared by the dashboard and activity page) ──
   TODO on backend conversion: replace this local array with records from
   GET /admin/activity (scoped to the authenticated school). */
const ADMIN_ACTIVITY = [
  {
    id: 4,
    actor: 'Admin',
    action: 'posted an announcement to Teachers: "Q2 Grade Encoding Deadline."',
    icon: 'megaphone',
    color: 'purple',
    tag: 'Announcement',
    created_at: new Date(new Date().setHours(10, 20, 0, 0)).toISOString()
  },
  {
    id: 3,
    actor: 'Admin',
    action: 'assigned Mr. Paolo Tan to Grade 8 – Mathematics.',
    icon: 'user-check',
    color: 'blue',
    tag: 'Assignment',
    created_at: new Date(new Date().setHours(8, 15, 0, 0)).toISOString()
  },
  {
    id: 2,
    actor: 'System Config',
    action: 'updated: Q2 grading period activated.',
    icon: 'settings-2',
    color: 'gold',
    tag: 'Config',
    created_at: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString()
  },
  {
    id: 1,
    actor: 'Ana Santos',
    action: 'flagged by system: 4 consecutive absences.',
    icon: 'alert-triangle',
    color: 'red',
    tag: 'Alert',
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 5,
    actor: 'Admin',
    action: 'created a new teacher account for Ms. Carla Dizon.',
    icon: 'user-plus',
    color: 'blue',
    tag: 'Assignment',
    created_at: new Date(new Date().setDate(new Date().getDate() - 4)).toISOString()
  },
  {
    id: 6,
    actor: 'Admin',
    action: 'posted an announcement to All Users: "Foundation Week Schedule."',
    icon: 'megaphone',
    color: 'purple',
    tag: 'Announcement',
    created_at: new Date(new Date().setDate(new Date().getDate() - 6)).toISOString()
  },
  {
    id: 7,
    actor: 'Ben Garcia',
    action: 'flagged by system: failing grade in 2 subjects.',
    icon: 'alert-triangle',
    color: 'red',
    tag: 'Alert',
    created_at: new Date(new Date().setDate(new Date().getDate() - 9)).toISOString()
  },
  {
    id: 8,
    actor: 'System Config',
    action: 'updated: archive policy set to 3 school years.',
    icon: 'settings-2',
    color: 'gold',
    tag: 'Config',
    created_at: new Date(new Date().setDate(new Date().getDate() - 12)).toISOString()
  }
];

function getAdminNotifItems() {
  applyReadState();
  const readIds = getReadIds();
  const localNotifications = NOTIFICATIONS.map(notification => ({ ...notification }));
  const reopenNotifications = getReopenRequests()
    .filter(r => r.status === 'pending')
    .map(r => ({
      id: r.createdAt,
      icon: 'unlock',
      color: 'gold',
      title: `Reopen requested: Q${r.quarter.slice(1)}`,
      desc: `${r.teacher} - ${r.section} · ${r.subject}`,
      read: readIds.includes(r.createdAt),
      link: 'edugnay-admin-system-config.html#reopen-requests',
      created_at: r.createdAt
    }));

  return [...localNotifications, ...reopenNotifications]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/* ── TIME HELPERS (shared: topbar notifs + activity feed) ── */
function formatDateGroup(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  const list = document.getElementById('tbNotifList');
  const empty = document.getElementById('tbNotifEmpty');
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
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick="goToTopbarNotif('${n.link}', '${n.id}')">
      <div class="tb-notif-icon ${n.color}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-head">
          <div class="tb-notif-title">${n.title}</div>
        </div>
        <div class="tb-notif-desc">${n.desc}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(n.created_at)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = items.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? '' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  const ids = getReadIds();
  if (!ids.includes(id)) { ids.push(id); setReadIds(ids); }
  window.location.href = link;
}

window.EDUGNAY_ADMIN = {
  activities: ADMIN_ACTIVITY,
  notifications: NOTIFICATIONS,
  getNotifications: getAdminNotifItems
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
document.addEventListener('DOMContentLoaded', () => {
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
