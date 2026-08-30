/* ══════════════════════════════════════════
   STUDENT SHELL — shared across all student pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /student/notifications
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const NOTIFICATIONS = [
  {
    id: 4, icon: 'folder-open', color: 'blue', tag: 'Materials', read: false,
    title: 'New learning material posted',
    desc: '"Solving for X — Video Lesson" was added to Mathematics.',
    link: { page: 'materials' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 3, icon: 'notebook-pen', color: 'purple', tag: 'Journal', read: false, access: 'journals',
    title: 'Journal window closing soon',
    desc: 'Submit your weekly reflection before Friday, 11:59 PM.',
    link: { page: 'journal' },
    created_at: new Date(new Date().setHours(new Date().getHours() - 4)).toISOString()
  },
  {
    id: 2, icon: 'megaphone', color: 'gold', tag: 'Announcement', read: true,
    title: 'New announcement',
    desc: 'Foundation Day — June 20. Classes suspended.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 1, icon: 'calendar-clock', color: 'blue', tag: 'Event', read: true,
    title: 'Upcoming event',
    desc: 'Intramurals sign-up is open at the Student Affairs table.',
    link: { page: 'announcements' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 0, icon: 'notebook-pen', color: 'gray', tag: 'Reminder', read: true, access: 'journals',
    title: 'Journal window reminder',
    desc: 'Weekly journal entries close Friday, 11:59 PM.',
    link: { page: 'journal' },
    created_at: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
];

/* ── READ STATE (localStorage; swap for DB column later) ── */
const STUDENT_READ_STORE_KEY = 'edugnay_student_notif_read';

function getReadIds() {
  try { return JSON.parse(localStorage.getItem(STUDENT_READ_STORE_KEY)) || []; }
  catch { return []; }
}
function setReadIds(ids) {
  localStorage.setItem(STUDENT_READ_STORE_KEY, JSON.stringify(ids));
}
function applyReadState() {
  const readIds = getReadIds();
  NOTIFICATIONS.forEach(n => { if (readIds.includes(n.id)) n.read = true; });
}

function studentCanAccess(feature) {
  return feature !== 'journals'
    || window.EDUGNAY_CONFIG?.isJournalsEnabled?.() !== false;
}

function getStudentVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || studentCanAccess(notification.access));
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

  const visibleNotifications = getStudentVisibleNotifications();
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
document.addEventListener('DOMContentLoaded', () => {
  applyStudentJournalAccess();
  renderTopbarNotifs();
});
