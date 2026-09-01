/* ══════════════════════════════════════════
   PARENT SHELL — shared across all parent pages
   Nav, topbar, notif dropdown, profile dropdown
   TODO on backend conversion: replace NOTIFICATIONS with
   data from GET /parent/notifications
   ══════════════════════════════════════════ */

/* ── LINKED CHILDREN DATA ── */
const PARENT_CONFIG = window.EDUGNAY_CONFIG;
const PARENT_SCHOOL_ID = PARENT_CONFIG.getActiveSchoolId();
const PARENT_STUDENTS = PARENT_CONFIG.getStudents();
const PARENT_SECTIONS = PARENT_CONFIG.getAssignmentSections();
const PARENT_USERS = PARENT_CONFIG.getUsers();

// The demo parent uses the shared relationship records for this school.
// Replace this list with GET /parent/children later; the page contracts stay the same.
const PARENT_CHILD_DIRECTORY = PARENT_CONFIG.getParentStudentLinks()
  .filter(link => (link.schoolId || PARENT_SCHOOL_ID) === PARENT_SCHOOL_ID)
  .map(link => {
    const student = PARENT_STUDENTS.find(record => record.id === link.studentId);
    if (!student) return null;

    const section = PARENT_SECTIONS.find(record => record.id === student.sectionId);
    const adviser = PARENT_USERS.find(record => record.profileId === section?.adviserId);
    return {
      studentId: student.id,
      lrn: student.lrn || null,
      name: student.name,
      initials: student.initials,
      schoolLevel: student.schoolLevel || student.level,
      gradeLevel: student.gradeLevel || student.grade,
      sectionId: student.sectionId || null,
      sectionName: section?.name || 'Unassigned',
      adviserId: section?.adviserId || null,
      adviserName: adviser?.displayName || 'Not assigned',
      relationship: 'Parent',
      schoolId: student.schoolId || PARENT_SCHOOL_ID
    };
  })
  .filter(Boolean);

window.EDUGNAY_PARENT = {
  children: PARENT_CHILD_DIRECTORY
};

/* ── NOTIFICATIONS DATA ── */
const NOTIFICATIONS = [
  {
    id: 'parent-notif-report-001', icon: 'sparkles', tone: 'purple', type: 'Report', read: false, access: 'reports',
    title: 'Weekly report sent',
    message: 'Juan\'s weekly report for June 9–14 is now available.',
    link: { page: 'reports' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 1)).toISOString()
  },
  {
    id: 'parent-notif-attendance-001', icon: 'circle-alert', tone: 'red', type: 'Attendance', read: false,
    title: 'Absence recorded',
    message: 'Maya was marked absent today. Contact the adviser if this seems incorrect.',
    link: { page: 'attendance' },
    createdAt: new Date(new Date().setHours(new Date().getHours() - 3)).toISOString()
  },
  {
    id: 'parent-notif-announcement-001', icon: 'megaphone', tone: 'gold', type: 'Announcement', read: true,
    title: 'New announcement',
    message: 'Foundation Day — June 20. Classes suspended.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setHours(8, 0, 0, 0)).toISOString()
  },
  {
    id: 'parent-notif-report-002', icon: 'file-text', tone: 'blue', type: 'Report', read: true, access: 'reports',
    title: 'Narrative report confirmed',
    message: 'Q2 narrative reports are now viewable on your dashboard.',
    link: { page: 'reports' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 3)).toISOString()
  },
  {
    id: 'parent-notif-event-001', icon: 'calendar-clock', tone: 'gray', type: 'Reminder', read: true,
    title: 'Upcoming event',
    message: 'Intramurals sign-up is open at the Student Affairs table.',
    link: { page: 'announcements' },
    createdAt: new Date(new Date().setDate(new Date().getDate() - 5)).toISOString()
  }
]
  .map(record => ({ ...record, schoolId: 'scc' }))
  .filter(record => record.schoolId === PARENT_SCHOOL_ID);

const PARENT_READ_STORE_KEY = `edugnay_parent_notif_read:${PARENT_SCHOOL_ID}`;

function getParentVisibleNotifications() {
  const reportsEnabled = window.EDUGNAY_CONFIG?.isNarrativeReportsEnabled?.() !== false;
  return NOTIFICATIONS.filter(notification => !notification.access || reportsEnabled);
}

/* ── TOPBAR NOTIF DROPDOWN ── */
function renderTopbarNotifs() {
  window.EDUGNAY_CONFIG.applyNotificationReadState(NOTIFICATIONS, PARENT_READ_STORE_KEY);
  const container = document.getElementById('tbNotifList');
  const dot = document.querySelector('.tb-notif-dot');
  if (!container) return;

  const visibleNotifications = getParentVisibleNotifications();
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
  window.EDUGNAY_CONFIG.markNotificationRead(PARENT_READ_STORE_KEY, id, NOTIFICATIONS);
  navigate(link.page);
}

window.EDUGNAY_NOTIFICATION_CONTEXT = {
  storageKey: PARENT_READ_STORE_KEY,
  records: NOTIFICATIONS,
  getItems: getParentVisibleNotifications
};


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
document.addEventListener('DOMContentLoaded', async () => {
  applyParentReportAccess();
  renderTopbarNotifs();
});
