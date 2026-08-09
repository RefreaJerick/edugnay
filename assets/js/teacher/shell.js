/* ══════════════════════════════════════════
   TEACHER SHELL — shared across all teacher pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /teacher/notifications (see notifications page comment)
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const NOTIFICATIONS = [
  {
    id: 5, icon: 'file-text', color: 'orange', tag: 'Report', read: false,
    title: '5 reports awaiting confirmation',
    desc: 'Gr. 7 – St. Matthew narrative reports are ready for your review.',
    link: { page: 'reports' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 1)).toISOString()
  },
  {
    id: 4, icon: 'clipboard-pen', color: 'red', tag: 'Grades', read: false,
    title: 'Grade encoding incomplete',
    desc: '10 students in Gr. 8 – St. Luke still have no Q2 grades.',
    link: { page: 'section', section: '8-luke', tab: 'scores' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 3, icon: 'user-check', color: 'red', tag: 'Attendance', read: false,
    title: 'Attendance not taken',
    desc: "Today's attendance for Gr. 9 – St. Peter has not been logged.",
    link: { page: 'section', section: '9-peter', tab: 'attendance' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 4)).toISOString()
  },
  {
    id: 2, icon: 'megaphone', color: 'gold', tag: 'Announcement', read: true,
    title: 'New announcement',
    desc: 'Q2 grade encoding deadline: June 14.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 1, icon: 'calendar-clock', color: 'blue', tag: 'Event', read: true,
    title: 'Upcoming event',
    desc: 'Foundation Day, June 20. Classes suspended.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 0, icon: 'notebook-pen', color: 'gray', tag: 'Reminder', read: true,
    title: 'Journal window reminder',
    desc: 'Weekly journal entries close Friday, 11:59 PM.',
    link: { page: 'journals' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
];

/* ── READ STATE (localStorage; swap for DB column later) ── */
const TEACHER_READ_STORE_KEY = 'edugnay_teacher_notif_read';

function getReadIds() {
  try { return JSON.parse(localStorage.getItem(TEACHER_READ_STORE_KEY)) || []; }
  catch { return []; }
}
function setReadIds(ids) {
  localStorage.setItem(TEACHER_READ_STORE_KEY, JSON.stringify(ids));
}
function applyReadState() {
  const readIds = getReadIds();
  NOTIFICATIONS.forEach(n => { if (readIds.includes(n.id)) n.read = true; });
}

/* ── TIME HELPERS ── */
function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs < 1) return 'Just now';
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 1) return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
         date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  applyReadState();
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;
  const teacherDashboardPanel = document.querySelector('.teacher-notif-panel');
  const unreadCount = NOTIFICATIONS.filter(n => !n.read).length;
  const unreadLabel = document.querySelector('.teacher-notif-unread-count');
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  const top5 = [...NOTIFICATIONS]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  if (!top5.length) {
    container.innerHTML = `
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

  container.innerHTML = top5.map(n => `
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick='goToTopbarNotif(${JSON.stringify(n.link)}, ${n.id})'>
      <div class="tb-notif-icon ${n.color}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-title">${n.title}</div>
        <div class="tb-notif-desc">${n.desc}</div>
        ${teacherDashboardPanel ? `<div class="teacher-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.created_at)}</span></div>` : `<div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.created_at)}</span></div>`}
      </div>
    </a>
  `).join('');

  const hasUnread = NOTIFICATIONS.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  const ids = getReadIds();
  if (!ids.includes(id)) { ids.push(id); setReadIds(ids); }
  navigate(link.page, link.section, link.tab);
}

function toggleNotifDropdown() {
  document.getElementById('tbNotifPanel').classList.toggle('open');
}

function markAllNotifRead() {
  NOTIFICATIONS.forEach(n => n.read = true);
  setReadIds(NOTIFICATIONS.map(n => n.id));
  renderTopbarNotifs();
}

/* ── PROFILE DROPDOWN ── */
function toggleProfileDropdown() {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  trigger.classList.toggle('open');
  dropdown.classList.toggle('open');
}

/* ── OUTSIDE-CLICK CLOSE (profile + notif) ── */
document.addEventListener('click', (e) => {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  if (trigger && dropdown && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
    trigger.classList.remove('open');
    dropdown.classList.remove('open');
  }

  const notifTrigger = document.getElementById('tbNotifTrigger');
  const notifPanel = document.getElementById('tbNotifPanel');
  if (notifTrigger && notifPanel && !notifTrigger.contains(e.target) && !notifPanel.contains(e.target)) {
    notifPanel.classList.remove('open');
  }
});

/* ── SIDEBAR DRAWER (mobile) ── */
function toggleDrawer(open) {
  const isOpen = open === undefined ? !document.body.classList.contains('drawer-open') : open;
  document.body.classList.toggle('drawer-open', isOpen);
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.toggle('open', isOpen);
}

function toggleGroup(id) {
  document.getElementById(id).classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

/* ── LOGOUT ── */
function openLogoutModal() {
  const trigger = document.getElementById('tbProfileTrigger');
  const dropdown = document.getElementById('tbProfileDropdown');
  if (trigger) trigger.classList.remove('open');
  if (dropdown) dropdown.classList.remove('open');

  document.getElementById('logoutModalBackdrop').classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function closeLogoutModal() {
  document.getElementById('logoutModalBackdrop').classList.remove('open');
}

function confirmLogout() {
  // TODO on backend conversion: replace with POST /auth/logout,
  // clear session cookie, then redirect
  localStorage.clear(); // wipes mock data (reopen requests, read-state, etc.)
  const isGitHubPages = location.hostname.endsWith("github.io");
  const BASE = isGitHubPages ? "/edugnay" : "";

  window.location.href = `${BASE}/index.html`;
}

document.getElementById('logoutModalBackdrop')?.addEventListener('click', function (e) {
  if (e.target === this) closeLogoutModal();
});

/* ── NAVIGATION ── */
function navigate(page, section, tab) {
  if (page === 'dashboard') {
    window.location.href = './edugnay-teacher-dashboard.html';
  } else if (page === 'journals') {
    window.location.href = './edugnay-teacher-journals.html';
  } else if (page === 'section') {
    window.location.href = './edugnay-teacher-sections.html';
  } else if (page === 'reports') {
    window.location.href = './edugnay-teacher-reports.html';
  } else if (page === 'announcements') {
    window.location.href = 'edugnay-teacher-announcements.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-teacher-notifications.html';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleDrawer(false);
});

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', renderTopbarNotifs);
