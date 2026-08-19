/* ══════════════════════════════════════════
   TEACHER SHELL — shared across all teacher pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /teacher/notifications (see notifications page comment)
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
// Replace this local object with the signed-in teacher's access payload later.
const TEACHER_PORTAL_ACCESS = {
  subjects: ['Values Education', 'Math', 'Science'],
  isAdviser: true
};

window.EDUGNAY_TEACHER_ACCESS = TEACHER_PORTAL_ACCESS;

function teacherCanAccess(feature) {
  if (feature === 'journals') return TEACHER_PORTAL_ACCESS.subjects.includes('Values Education');
  if (feature === 'reports') return TEACHER_PORTAL_ACCESS.isAdviser;
  return true;
}

const NOTIFICATIONS = [
  {
    id: 5, icon: 'file-text', color: 'orange', tag: 'Report', read: false, access: 'reports',
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
    id: 0, icon: 'notebook-pen', color: 'gray', tag: 'Reminder', read: true, access: 'journals',
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

function getTeacherVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || teacherCanAccess(notification.access));
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
  const visibleNotifications = getTeacherVisibleNotifications();
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  const unreadLabel = document.querySelector('.teacher-notif-unread-count');
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  const top5 = [...visibleNotifications]
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

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  const ids = getReadIds();
  if (!ids.includes(id)) { ids.push(id); setReadIds(ids); }
  navigate(link.page, link.section, link.tab);
}


/* ── NAVIGATION ── */
function navigate(page, section, tab) {
  if (page === 'dashboard') {
    window.location.href = './edugnay-teacher-dashboard.html';
  } else if (page === 'journals') {
    if (!teacherCanAccess('journals')) return;
    window.location.href = './edugnay-teacher-journals.html';
  } else if (page === 'section') {
    window.location.href = './edugnay-teacher-sections.html';
  } else if (page === 'reports') {
    if (!teacherCanAccess('reports')) return;
    window.location.href = './edugnay-teacher-reports.html';
  } else if (page === 'announcements') {
    window.location.href = 'edugnay-teacher-announcements.html';
  } else if (page === 'notifications') {
    window.location.href = './edugnay-teacher-notifications.html';
  }
}

function applyTeacherAccess() {
  document.querySelectorAll('[data-teacher-access]').forEach(item => {
    item.hidden = !teacherCanAccess(item.dataset.teacherAccess);
  });

  document.querySelectorAll('#reports-nav').forEach(section => {
    section.hidden = !section.querySelector('[data-teacher-access]:not([hidden])');
  });
}

function guardTeacherPageAccess() {
  const page = window.location.pathname.split('/').pop();
  const restrictedFeature = page === 'edugnay-teacher-journals.html'
    ? 'journals'
    : page === 'edugnay-teacher-reports.html'
      ? 'reports'
      : '';

  if (restrictedFeature && !teacherCanAccess(restrictedFeature)) {
    window.location.replace('./edugnay-teacher-dashboard.html');
    return true;
  }

  return false;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleDrawer(false);
});

/* ── INIT ── */
if (!guardTeacherPageAccess()) {
  document.addEventListener('DOMContentLoaded', () => {
    applyTeacherAccess();
    renderTopbarNotifs();
  });
}
