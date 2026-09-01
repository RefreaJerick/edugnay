/*
 * Platform Administrator frontend data.
 * Replace these local records with platform API responses during backend
 * integration. School-specific data remains scoped by schoolId on the server.
 */
(function initializePlatformAdmin() {
  const PLATFORM_ADMIN = {
    id: 'platform-admin-001',
    schoolId: null,
    role: 'platform_admin',
    email: 'platform.admin@academix.local',
    status: 'active',
    createdAt: '2025-01-01T00:00:00.000Z',
    honorific: null,
    firstName: 'Platform',
    lastName: 'Admin',
    displayName: 'Platform Admin',
    initials: 'PA',
    employeeNo: null,
    lrn: null,
    schoolLevel: null,
    gradeLevel: null,
    strand: null,
    sectionId: null
  };

  const PLATFORM_ACTIVITY = [
    {
      id: 'platform-activity-school-ready',
      schoolId: 'scc',
      actor: 'Platform',
      title: "marked St. Columban's College active",
      detail: 'School profile and academic structure are configured.',
      icon: 'circle-check-big',
      tone: 'green',
      createdAt: '2026-08-25T09:20:00.000Z',
      type: 'School account',
      link: { page: 'school-accounts' }
    },
    {
      id: 'platform-activity-account-created',
      schoolId: 'scc',
      actor: 'Platform',
      title: 'created the initial administrator account',
      detail: 'The school administrator can now manage their portal.',
      icon: 'user-plus',
      tone: 'blue',
      createdAt: '2026-08-24T15:45:00.000Z',
      type: 'Access',
      link: { page: 'school-accounts' }
    },
    {
      id: 'platform-activity-template-updated',
      schoolId: 'scc',
      actor: 'Platform',
      title: 'updated an SF template configuration',
      detail: 'A template mapping was saved for review.',
      icon: 'file-cog',
      tone: 'gold',
      createdAt: '2026-08-22T11:10:00.000Z',
      type: 'Configuration',
      link: { page: 'school-accounts' }
    }
  ];

  const PLATFORM_NOTIFICATIONS = [
    {
      id: 'platform-notif-manghi-registration',
      schoolId: null,
      icon: 'building-2',
      tone: 'gold',
      type: 'School account',
      title: 'Manghi school account awaiting review',
      message: 'Mangaldan National High School submitted a new registration.',
      createdAt: '2026-08-30T09:15:00.000Z',
      link: { page: 'school-accounts' },
      read: false
    },
    {
      id: 'platform-notif-school-ready',
      schoolId: null,
      icon: 'building-2',
      tone: 'green',
      type: 'School account',
      title: 'School account ready for review',
      message: "St. Columban's College completed its initial setup.",
      createdAt: '2026-08-25T09:20:00.000Z',
      link: { page: 'school-accounts' },
      read: false
    }
  ];

  /* ── READ STATE (localStorage; replace with a backend read flag later) ── */
  const PLATFORM_READ_STORE_KEY = 'edugnay_platform_notif_read';

  function applyPlatformReadState() {
    window.EDUGNAY_CONFIG.applyNotificationReadState(PLATFORM_NOTIFICATIONS, PLATFORM_READ_STORE_KEY);
  }

  function markPlatformNotificationRead(id) {
    return window.EDUGNAY_CONFIG.markNotificationRead(
      PLATFORM_READ_STORE_KEY,
      id,
      PLATFORM_NOTIFICATIONS
    );
  }

  const PLATFORM_QUICK_ACTIONS = [
    {
      icon: 'building-2',
      title: 'Review School Accounts',
      desc: 'Open registered school records',
      href: 'edugnay-platform-school-accounts.html'
    }
  ];

  function getSchoolRecords() {
    const schools = window.EDUGNAY_CONFIG?.getSchools?.() || [];
    return schools.map(school => ({
      ...school,
      typeLabel: Array.isArray(school.schoolLevels)
        ? (window.EDUGNAY_CONFIG?.getSchoolTypeInfo?.(school.schoolLevels)?.label || school.typeLabel || school.schoolType || 'School')
        : (school.typeLabel || school.schoolType || 'School'),
      status: school.platformStatus || 'active',
      administrator: school.initialAdministrator?.name || 'School administrator',
      administratorEmail: school.initialAdministrator?.email || school.email || ''
    }));
  }

  function getDashboardSummary() {
    const schools = getSchoolRecords();
    return [
      {
        id: 'schools',
        tone: 'blue',
        icon: 'building-2',
        label: 'Registered Schools',
        sub: 'School accounts on the platform',
        value: schools.length
      },
      {
        id: 'active-schools',
        tone: 'green',
        icon: 'circle-check-big',
        label: 'Active Schools',
        sub: 'Available to their school communities',
        value: schools.filter(school => school.status === 'active').length
      },
      {
        id: 'pending-schools',
        tone: 'gold',
        icon: 'clipboard-check',
        label: 'Pending Reviews',
        sub: 'School registrations awaiting action',
        value: schools.filter(school => school.status === 'pending').length
      }
    ];
  }

  function renderTopbarNotifs() {
    applyPlatformReadState();
    const list = document.getElementById('tbNotifList');
    const dot = document.getElementById('tbNotifDot');
    const unreadLabel = document.querySelector('.tb-notif-unread-count');
    if (!list) return;

    const unreadCount = PLATFORM_NOTIFICATIONS.filter(item => !item.read).length;
    if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';
    if (dot) dot.style.display = unreadCount ? '' : 'none';

    list.innerHTML = PLATFORM_NOTIFICATIONS.length
      ? PLATFORM_NOTIFICATIONS.map(item => `
        <a href="#" class="tb-notif-item ${item.read ? '' : 'unread'}" data-platform-notification="${item.id}">
          <div class="tb-notif-icon ${item.tone}" aria-hidden="true"><i data-lucide="${item.icon}" style="width:15px;height:15px;"></i></div>
          <div class="tb-notif-body">
            <div class="tb-notif-head"><div class="tb-notif-title">${item.title}</div></div>
            <div class="tb-notif-desc">${item.message}</div>
            <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(item.createdAt)}</span></div>
          </div>
        </a>`).join('')
      : `<div class="tb-notif-empty" id="tbNotifEmpty"><div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div><div class="tb-notif-empty-title">No notifications yet</div><div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div></div>`;

    list.querySelectorAll('[data-platform-notification]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const notification = PLATFORM_NOTIFICATIONS.find(item => item.id === button.dataset.platformNotification);
        markPlatformNotificationRead(button.dataset.platformNotification);
        navigatePlatform(notification?.link);
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function markAllPlatformNotificationsRead() {
    window.EDUGNAY_CONFIG.markAllNotificationsRead(PLATFORM_READ_STORE_KEY, PLATFORM_NOTIFICATIONS);
    renderTopbarNotifs();
  }

  function navigatePlatform(link) {
    const pages = {
      dashboard: 'edugnay-platform-dashboard.html',
      'school-accounts': 'edugnay-platform-school-accounts.html',
      activity: 'edugnay-platform-activity.html',
      notifications: 'edugnay-platform-notifications.html',
      profile: 'edugnay-platform-profile.html'
    };
    const target = pages[link?.page] || 'edugnay-platform-dashboard.html';
    window.location.href = target;
  }

  window.EDUGNAY_PLATFORM = {
    admin: PLATFORM_ADMIN,
    account: PLATFORM_ADMIN,
    profile: PLATFORM_ADMIN,
    activities: PLATFORM_ACTIVITY,
    notifications: PLATFORM_NOTIFICATIONS,
    markPlatformNotificationRead,
    quickActions: PLATFORM_QUICK_ACTIONS,
    notificationStorageKey: PLATFORM_READ_STORE_KEY,
    getSchoolRecords,
    getDashboardSummary,
    renderTopbarNotifs,
    markAllPlatformNotificationsRead
  };

  window.renderTopbarNotifs = renderTopbarNotifs;
  window.markAllPlatformNotificationsRead = markAllPlatformNotificationsRead;
  window.navigatePlatform = navigatePlatform;
  window.EDUGNAY_NOTIFICATION_CONTEXT = {
    storageKey: PLATFORM_READ_STORE_KEY,
    records: PLATFORM_NOTIFICATIONS,
    getItems: () => PLATFORM_NOTIFICATIONS
  };
})();
