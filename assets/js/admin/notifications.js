lucide.createIcons();

  let activeNotifFilter = 'all';

  function getNotifItems() {
    return typeof getAdminNotifItems === 'function' ? getAdminNotifItems() : [];
  }

  function setNotifFilter(mode, btn) {
    document.querySelectorAll('.notif-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeNotifFilter = mode;
    renderNotifList();
  }

  async function markAllRead() {
    await markCurrentNotificationsRead();
    renderTopbarNotifs();
    renderNotifList();
  }

  function goToNotif(link, id) {
    markCurrentNotificationRead(id).finally(() => navigate(link?.page, link?.hash));
  }

  function renderNotifList() {
    const container = document.getElementById('notifList');
    const emptyState = document.getElementById('notifEmptyState');

    const all = getNotifItems();
    const filtered = activeNotifFilter === 'unread' ? all.filter(n => !n.read) : all;

    if (!filtered.length) {
      container.innerHTML = '';
      const isUnreadEmpty = activeNotifFilter === 'unread' && all.length;
      emptyState.hidden = false;
      emptyState.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'bell-off',
        title: isUnreadEmpty ? 'No unread notifications' : 'No notifications yet',
        text: isUnreadEmpty ? "You're all caught up." : 'Admin alerts and review requests will appear here as they happen.'
      });
      if (window.lucide) lucide.createIcons();
      return;
    }
    emptyState.hidden = true;
    emptyState.innerHTML = '';

    let html = '';
    let lastGroup = null;

    filtered.forEach(n => {
      const group = formatDateGroup(n.createdAt);
      if (group !== lastGroup) {
        html += `<div class="notif-group-label">${group}</div>`;
        lastGroup = group;
      }
      html += `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notification-id="${window.EDUGNAY_CONFIG.escapeHtml(n.id)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { goToNotif(n.link, n.id); })}">
          <div class="nt-icon ${n.tone}"><i data-lucide="${n.icon}" style="width:15px;height:15px;"></i></div>
          <div class="nt-body">
            <div class="nt-text"><strong>${window.EDUGNAY_CONFIG.escapeHtml(n.title)}</strong></div>
            <div class="nt-desc">${window.EDUGNAY_CONFIG.escapeHtml(n.message)}</div>
            <div class="nt-time">${formatTime(n.createdAt)}</div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    lucide.createIcons();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await window.EDUGNAY_SCHOOL_READY;
      const [notifications] = await Promise.all([
        window.EDUGNAY_COMMUNICATION_RESOURCES?.notifications,
        refreshAdminReopenRequests()
      ]);
      if (!notifications) throw new Error('Notifications could not be loaded.');
      NOTIFICATIONS = notifications;
      if (!window.EDUGNAY_COMMUNICATION) {
        window.EDUGNAY_COMMUNICATION = { backend: true, notifications: NOTIFICATIONS, announcements: [], tasks: [], error: '' };
      } else {
        window.EDUGNAY_COMMUNICATION.notifications = NOTIFICATIONS;
      }
      renderNotifList();
      window.EDUGNAY_PAGE_LOADING.ready();
    } catch (error) {
      window.EDUGNAY_PAGE_LOADING.fail(error.message || 'Notifications could not be loaded.');
    }
  });
