/* ══════════════════════════════════════════
   TEACHER SHELL — shared across all teacher pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /teacher/notifications (see notifications page comment)
   ══════════════════════════════════════════ */

/* ── NOTIFICATIONS DATA ── */
const TEACHER_SCHOOL_ID = window.EDUGNAY_CONFIG.getActiveSchoolId();
// Replace this local object with the signed-in teacher's access payload later.
// Subject IDs match the shared subject catalog so school settings can choose
// any configured journal subject without another name-matching rule.
const TEACHER_PORTAL_ACCESS = {
  schoolId: TEACHER_SCHOOL_ID,
  teacherId: 'teacher-2',
  subjects: ['values-education', 'mathematics', 'science'],
  isAdviser: true
};

window.EDUGNAY_TEACHER_ACCESS = TEACHER_PORTAL_ACCESS;

function toggleGroup(id) {
  const group = document.getElementById(id);
  if (!group) return;
  group.classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

function teacherCanAccess(feature) {
  if (feature === 'journals') {
    const journalSubject = window.EDUGNAY_CONFIG?.getJournalSubject?.();
    return window.EDUGNAY_CONFIG?.isJournalsEnabled?.() !== false
      && Boolean(journalSubject)
      && TEACHER_PORTAL_ACCESS.subjects.includes(journalSubject.id);
  }
  if (feature === 'reports') {
    return TEACHER_PORTAL_ACCESS.isAdviser
      && window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  }
  return true;
}

const NOTIFICATIONS = [
  {
    id: 'teacher-notif-report-001', icon: 'file-text', tone: 'orange', type: 'Report', read: false, access: 'reports',
    title: '5 reports awaiting confirmation',
    message: 'Gr. 7 – St. Matthew narrative reports are ready for your review.',
    link: { page: 'reports' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 1)).toISOString()
  },
  {
    id: 'teacher-notif-grades-001', icon: 'clipboard-pen', tone: 'red', type: 'Grades', read: false,
    title: 'Grade encoding incomplete',
    message: '10 students in Gr. 8 – St. Luke still have no Q2 grades.',
    link: { page: 'section', section: '8-luke', tab: 'scores' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 'teacher-notif-attendance-001', icon: 'user-check', tone: 'red', type: 'Attendance', read: false,
    title: 'Attendance not taken',
    message: "Today's attendance for Gr. 9 – St. Peter has not been logged.",
    link: { page: 'section', section: '9-peter', tab: 'attendance' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 4)).toISOString()
  },
  {
    id: 'teacher-notif-announcement-001', icon: 'megaphone', tone: 'gold', type: 'Announcement', read: true,
    title: 'New announcement',
    message: 'Q2 grade encoding deadline: June 14.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 'teacher-notif-event-001', icon: 'calendar-clock', tone: 'blue', type: 'Event', read: true,
    title: 'Upcoming event',
    message: 'Foundation Day, June 20. Classes suspended.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 'teacher-notif-journal-001', icon: 'notebook-pen', tone: 'gray', type: 'Reminder', read: true, access: 'journals',
    title: 'Journal window reminder',
    message: 'Weekly journal entries close Friday, 11:59 PM.',
    link: { page: 'journals' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
]
  .map(record => ({ ...record, schoolId: 'scc' }))
  .filter(record => record.schoolId === TEACHER_SCHOOL_ID);

/* ── READ STATE (localStorage; swap for DB column later) ── */
const TEACHER_READ_STORE_KEY = `edugnay_teacher_notif_read:${TEACHER_SCHOOL_ID}`;

function getTeacherVisibleNotifications() {
  return NOTIFICATIONS.filter(notification => !notification.access || teacherCanAccess(notification.access));
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  window.EDUGNAY_CONFIG.applyNotificationReadState(NOTIFICATIONS, TEACHER_READ_STORE_KEY);
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;
  const teacherDashboardPanel = document.querySelector('.teacher-notif-panel');
  const visibleNotifications = getTeacherVisibleNotifications();
  const unreadCount = visibleNotifications.filter(n => !n.read).length;
  const unreadLabel = document.querySelector('.teacher-notif-unread-count');
  if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';

  const top5 = [...visibleNotifications]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
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
    <a class="tb-notif-item ${n.read ? '' : 'unread'}" onclick='goToTopbarNotif(${JSON.stringify(n.link)}, ${JSON.stringify(n.id)})'>
      <div class="tb-notif-icon ${n.tone}">
        <i data-lucide="${n.icon}" style="width:15px;height:15px;"></i>
      </div>
      <div class="tb-notif-body">
        <div class="tb-notif-title">${n.title}</div>
        <div class="tb-notif-desc">${n.message}</div>
        <div class="${teacherDashboardPanel ? 'teacher-notif-time' : 'tb-notif-time'}"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatRelativeTime(n.createdAt)}</span></div>
      </div>
    </a>
  `).join('');

  const hasUnread = visibleNotifications.some(n => !n.read);
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
}

function goToTopbarNotif(link, id) {
  window.EDUGNAY_CONFIG.markNotificationRead(TEACHER_READ_STORE_KEY, id, NOTIFICATIONS);
  navigate(link.page, link.section, link.tab);
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  storageKey: TEACHER_READ_STORE_KEY,
  records: NOTIFICATIONS,
  getItems: getTeacherVisibleNotifications
};


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
  document.addEventListener('DOMContentLoaded', async () => {
    applyTeacherAccess();
    renderTopbarNotifs();
  });
}
