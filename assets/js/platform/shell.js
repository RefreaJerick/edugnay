/*
 * Platform Administrator frontend data.
 * Replace these local records with platform API responses during backend
 * integration. School-specific data remains scoped by schoolId on the server.
 */
(function initializePlatformAdmin() {
  const PLATFORM_ADMIN = {
    id: 'platform-admin-001',
    name: 'Platform Admin',
    email: 'platform.admin@edugnay.local',
    role: 'Platform Administrator',
    initials: 'PA'
  };

  const PLATFORM_ACTIVITY = [
    {
      id: 'activity-school-ready',
      icon: 'circle-check-big',
      tone: 'green',
      title: "St. Columban's College is active",
      detail: 'School profile and academic structure are configured.',
      createdAt: '2026-08-25T09:20:00',
      type: 'School account'
    },
    {
      id: 'activity-account-created',
      icon: 'user-plus',
      tone: 'blue',
      title: 'Initial administrator account created',
      detail: 'The school administrator can now manage their portal.',
      createdAt: '2026-08-24T15:45:00',
      type: 'Access'
    },
    {
      id: 'activity-template-updated',
      icon: 'file-cog',
      tone: 'gold',
      title: 'SF template configuration updated',
      detail: 'A template mapping was saved for review.',
      createdAt: '2026-08-22T11:10:00',
      type: 'Configuration'
    }
  ];

  const PLATFORM_NOTIFICATIONS = [
    {
      id: 'platform-notif-manghi-registration',
      icon: 'building-2',
      color: 'gold',
      title: 'Manghi school account awaiting review',
      desc: 'Mangaldan National High School submitted a new registration.',
      createdAt: '2026-08-30T09:15:00',
      time: '9:15 AM',
      link: 'edugnay-platform-school-accounts.html',
      read: false
    },
    {
      id: 'platform-notif-school-ready',
      icon: 'building-2',
      color: 'green',
      title: 'School account ready for review',
      desc: "St. Columban's College completed its initial setup.",
      time: '9:20 AM',
      read: false
    }
  ];

  /* ── READ STATE (localStorage; replace with a backend read flag later) ── */
  const PLATFORM_READ_STORE_KEY = 'edugnay_platform_notif_read';

  function getPlatformReadIds() {
    try { return JSON.parse(localStorage.getItem(PLATFORM_READ_STORE_KEY)) || []; }
    catch { return []; }
  }

  function setPlatformReadIds(ids) {
    localStorage.setItem(PLATFORM_READ_STORE_KEY, JSON.stringify(ids));
  }

  function applyPlatformReadState() {
    const readIds = getPlatformReadIds();
    PLATFORM_NOTIFICATIONS.forEach(notification => {
      if (readIds.includes(notification.id)) notification.read = true;
    });
  }

  function markPlatformNotificationRead(id) {
    const readIds = getPlatformReadIds();
    if (!readIds.includes(id)) {
      readIds.push(id);
      setPlatformReadIds(readIds);
    }
    const notification = PLATFORM_NOTIFICATIONS.find(item => item.id === id);
    if (notification) notification.read = true;
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
        <a href="edugnay-platform-school-accounts.html" class="tb-notif-item ${item.read ? '' : 'unread'}" data-platform-notification="${item.id}">
          <div class="tb-notif-icon ${item.color}" aria-hidden="true"><i data-lucide="${item.icon}" style="width:15px;height:15px;"></i></div>
          <div class="tb-notif-body">
            <div class="tb-notif-head"><div class="tb-notif-title">${item.title}</div></div>
            <div class="tb-notif-desc">${item.desc}</div>
            <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${item.time}</span></div>
          </div>
        </a>`).join('')
      : `<div class="tb-notif-empty" id="tbNotifEmpty"><div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div><div class="tb-notif-empty-title">No notifications yet</div><div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div></div>`;

    list.querySelectorAll('[data-platform-notification]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        markPlatformNotificationRead(button.dataset.platformNotification);
        renderTopbarNotifs();
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function markAllPlatformNotificationsRead() {
    setPlatformReadIds(PLATFORM_NOTIFICATIONS.map(notification => notification.id));
    PLATFORM_NOTIFICATIONS.forEach(item => { item.read = true; });
    renderTopbarNotifs();
  }

  window.EDUGNAY_PLATFORM = {
    admin: PLATFORM_ADMIN,
    activities: PLATFORM_ACTIVITY,
    notifications: PLATFORM_NOTIFICATIONS,
    markPlatformNotificationRead,
    quickActions: PLATFORM_QUICK_ACTIONS,
    getSchoolRecords,
    getDashboardSummary,
    renderTopbarNotifs,
    markAllPlatformNotificationsRead
  };

  window.renderTopbarNotifs = renderTopbarNotifs;
  window.markAllPlatformNotificationsRead = markAllPlatformNotificationsRead;
})();
