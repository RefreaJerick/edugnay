/* ══════════════════════════════════════════
   PARENT SHELL — shared across all parent pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /parent/notifications
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const NOTIFICATIONS = [
  {
    id: 5, icon: 'sparkles', color: 'purple', tag: 'Report', read: false, access: 'reports',
    title: 'Weekly report sent',
    desc: 'Juan\'s weekly report for June 9–14 is now available.',
    link: { page: 'reports' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 1)).toISOString()
  },
  {
    id: 4, icon: 'circle-alert', color: 'red', tag: 'Attendance', read: false,
    title: 'Absence recorded',
    desc: 'Maya was marked absent today. Contact the adviser if this seems incorrect.',
    link: { page: 'attendance' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 2, icon: 'megaphone', color: 'gold', tag: 'Announcement', read: true,
    title: 'New announcement',
    desc: 'Foundation Day — June 20. Classes suspended.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 1, icon: 'file-text', color: 'blue', tag: 'Report', read: true, access: 'reports',
    title: 'Narrative report confirmed',
    desc: 'Q2 narrative reports are now viewable on your dashboard.',
    link: { page: 'reports' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 0, icon: 'calendar-clock', color: 'gray', tag: 'Reminder', read: true,
    title: 'Upcoming event',
    desc: 'Intramurals sign-up is open at the Student Affairs table.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
];

/* ── READ STATE (localStorage; swap for DB column later) ── */
const PARENT_READ_STORE_KEY = 'edugnay_parent_notif_read';

function getReadIds() {
  try { return JSON.parse(localStorage.getItem(PARENT_READ_STORE_KEY)) || []; }
  catch { return []; }
}
function setReadIds(ids) {
  localStorage.setItem(PARENT_READ_STORE_KEY, JSON.stringify(ids));
}
function applyReadState() {
  const readIds = getReadIds();
  NOTIFICATIONS.forEach(n => { if (readIds.includes(n.id)) n.read = true; });
}

function getParentVisibleNotifications() {
  const reportsEnabled = window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  return NOTIFICATIONS.filter(notification => !notification.access || reportsEnabled);
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

  const visibleNotifications = getParentVisibleNotifications();
  const top5 = [...visibleNotifications]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  const unreadLabel = document.querySelector('.tb-notif-unread-count');
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

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
        <div class="tb-notif-head">
          <div class="tb-notif-title">${n.title}</div>
        </div>
        <div class="tb-notif-desc">${n.desc}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.created_at)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  const ids = getReadIds();
  if (!ids.includes(id)) { ids.push(id); setReadIds(ids); }
  navigate(link.page);
}


/* ── NAVIGATION ── */
function navigate(page) {
  if (page === 'dashboard') {
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
document.addEventListener('DOMContentLoaded', () => {
  applyParentReportAccess();
  renderTopbarNotifs();
});
