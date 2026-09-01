/* ══════════════════════════════════════════
   STUDENT SHELL — shared across all student pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /student/notifications
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const STUDENT_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
const NOTIFICATIONS = [
  {
    id: 'student-notif-materials-001', icon: 'folder-open', tone: 'blue', type: 'Materials', read: false,
    title: 'New learning material posted',
    message: '"Solving for X — Video Lesson" was added to Mathematics.',
    link: { page: 'materials' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 'student-notif-journal-001', icon: 'notebook-pen', tone: 'purple', type: 'Journal', read: false, access: 'journals',
    title: 'Journal window closing soon',
    message: 'Submit your weekly reflection before Friday, 11:59 PM.',
    link: { page: 'journal' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 4)).toISOString()
  },
  {
    id: 'student-notif-announcement-001', icon: 'megaphone', tone: 'gold', type: 'Announcement', read: true,
    title: 'New announcement',
    message: 'Foundation Day — June 20. Classes suspended.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 'student-notif-event-001', icon: 'calendar-clock', tone: 'blue', type: 'Event', read: true,
    title: 'Upcoming event',
    message: 'Intramurals sign-up is open at the Student Affairs table.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 'student-notif-journal-002', icon: 'notebook-pen', tone: 'gray', type: 'Reminder', read: true, access: 'journals',
    title: 'Journal window reminder',
    message: 'Weekly journal entries close Friday, 11:59 PM.',
    link: { page: 'journal' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
]
  .map(record => ({ ...record, schoolId: 'scc' }))
  .filter(record => record.schoolId === STUDENT_SCHOOL_ID);

const STUDENT_READ_STORE_KEY = `edugnay_student_notif_read:${STUDENT_SCHOOL_ID}`;

function studentCanAccess(feature) {
  return feature !== 'journals'
    || window.EDUGNAY_CONFIG?.isJournalsEnabled?.() !== false;
}

function getStudentVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || studentCanAccess(notification.access));
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  window.EDUGNAY_CONFIG.applyNotificationReadState(NOTIFICATIONS, STUDENT_READ_STORE_KEY);
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
        <div class="tb-notif-empty-title">No notifications yet</div>
        <div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div>
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
          <div class="tb-notif-title">${n.title}</div>
        </div>
        <div class="tb-notif-desc">${n.message}</div>
        <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  window.EDUGNAY_CONFIG.markNotificationRead(STUDENT_READ_STORE_KEY, id, NOTIFICATIONS);
  navigate(link.page);
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  storageKey: STUDENT_READ_STORE_KEY,
  records: NOTIFICATIONS,
  getItems: getStudentVisibleNotifications
};


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
  applyStudentJournalAccess();
  renderTopbarNotifs();
});
