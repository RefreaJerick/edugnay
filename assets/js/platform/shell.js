/* Shared platform portal behavior. */
(function initializePlatformAdmin() {
  let PLATFORM_API_NOTIFICATIONS = [];

  function getPlatformNotifications() {
    return PLATFORM_API_NOTIFICATIONS;
  }

  async function loadPlatformNotifications() {
    try {
      const communication = await window.EDUGNAY_API.loadCommunication('platform_admin');
      window.EDUGNAY_COMMUNICATION = communication;
      PLATFORM_API_NOTIFICATIONS = communication.notifications || [];
    } catch (error) {
      PLATFORM_API_NOTIFICATIONS = [];
      window.EDUGNAY_COMMUNICATION = {
        backend: Boolean(window.EDUGNAY_API?.isBackendAvailable),
        notifications: [],
        announcements: [],
        tasks: [],
        error: error?.message || 'Platform communications could not be loaded.'
      };
    }
  }

  function markPlatformNotificationRead(id) {
    const apiNotification = PLATFORM_API_NOTIFICATIONS.find(item => String(item.id) === String(id));
    return apiNotification
      ? window.markCurrentNotificationRead(apiNotification.apiId || apiNotification.id)
      : Promise.resolve(null);
  }

  const PLATFORM_QUICK_ACTIONS = [
    {
      icon: 'building-2',
      title: 'Review School Accounts',
      desc: 'Open registered school records',
      href: 'edugnay-platform-school-accounts.html'
    }
  ];

  async function getSchoolRecords() {
    if (window.EDUGNAY_API?.isBackendAvailable) {
      const schools = await window.EDUGNAY_API.getPlatformSchools();
      const schoolTypeLabels = {
        k12: 'K-12 School', elementary: 'Elementary', jhs: 'Junior High School',
        shs: 'Senior High School', 'multi-level': 'Multi-level School'
      };
      return schools.map(school => ({
        ...school,
        id: String(school.id),
        schoolId: school.depedSchoolId || school.schoolCode || '',
        typeLabel: school.typeLabel || schoolTypeLabels[school.schoolType] || 'School',
        platformStatus: school.platformStatus || (school.registrationStatus === 'active'
          ? 'active' : school.registrationStatus === 'pending' ? 'pending' : 'rejected'),
        administrator: school.administrator || 'School administrator',
        administratorSchoolEmail: school.administratorSchoolEmail || ''
      }));
    }

    throw new Error('The platform API is not configured.');
  }

  async function getActivityRecords() {
    if (window.EDUGNAY_API?.isBackendAvailable) {
      return window.EDUGNAY_API.getDashboardActivity('platform');
    }
    throw new Error('The platform API is not configured.');
  }

  function getDashboardSummary(schools = []) {
    const statuses = window.EDUGNAY_CONFIG.values.statuses;
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
        value: schools.filter(school => school.platformStatus === statuses.ACTIVE).length
      },
      {
        id: 'pending-schools',
        tone: 'gold',
        icon: 'clipboard-check',
        label: 'Pending Reviews',
        sub: 'School registrations awaiting action',
        value: schools.filter(school => school.platformStatus === statuses.PENDING).length
      }
    ];
  }

  function renderTopbarNotifs() {
    const notifications = getPlatformNotifications();
    const list = document.getElementById('tbNotifList');
    const dot = document.getElementById('tbNotifDot');
    const unreadLabel = document.querySelector('.tb-notif-unread-count');
    if (!list) return;

    const unreadCount = notifications.filter(item => !item.read).length;
    if (unreadLabel) unreadLabel.textContent = unreadCount ? `${unreadCount} unread` : 'All caught up';
    if (dot) dot.style.display = unreadCount ? '' : 'none';

    list.innerHTML = notifications.length
      ? notifications.map(item => `
        <a href="#" class="tb-notif-item ${item.read ? '' : 'unread'}" data-platform-notification="${window.EDUGNAY_CONFIG.escapeHtml(item.id)}">
          <div class="tb-notif-icon ${window.EDUGNAY_CONFIG.escapeHtml(item.tone)}" aria-hidden="true"><i data-lucide="${window.EDUGNAY_CONFIG.escapeHtml(item.icon)}" style="width:15px;height:15px;"></i></div>
          <div class="tb-notif-body">
            <div class="tb-notif-head"><div class="tb-notif-title">${window.EDUGNAY_CONFIG.escapeHtml(item.title)}</div></div>
            <div class="tb-notif-desc">${window.EDUGNAY_CONFIG.escapeHtml(item.message)}</div>
            <div class="tb-notif-time"><i data-lucide="clock-3" style="width:12px;height:12px;"></i><span>${formatTime(item.createdAt)}</span></div>
          </div>
        </a>`).join('')
      : `<div class="tb-notif-empty" id="tbNotifEmpty"><div class="tb-notif-empty-icon"><i data-lucide="bell-off" style="width:20px;height:20px;"></i></div><div class="tb-notif-empty-title">No notifications yet</div><div class="tb-notif-empty-text">You're all caught up. New alerts will show up here.</div></div>`;

    list.querySelectorAll('[data-platform-notification]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const notification = getPlatformNotifications().find(item => String(item.id) === button.dataset.platformNotification);
        markPlatformNotificationRead(button.dataset.platformNotification).finally(() => {
          navigatePlatform(notification?.link);
        });
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  async function markAllPlatformNotificationsRead() {
    await window.markCurrentNotificationsRead();
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

  window.EDUGNAY_PLATFORM_COMMUNICATION_READY = loadPlatformNotifications();

  window.EDUGNAY_PLATFORM = {
    getNotifications: getPlatformNotifications,
    markPlatformNotificationRead,
    quickActions: PLATFORM_QUICK_ACTIONS,
    getSchoolRecords,
    getActivityRecords,
    getDashboardSummary,
    renderTopbarNotifs,
    markAllPlatformNotificationsRead
  };

  window.renderTopbarNotifs = renderTopbarNotifs;
  window.markAllPlatformNotificationsRead = markAllPlatformNotificationsRead;
  window.navigatePlatform = navigatePlatform;
  window.EDUGNAY_NOTIFICATION_CONTEXT = {
    storageKey: '',
    records: [],
    getItems: getPlatformNotifications
  };
})();
