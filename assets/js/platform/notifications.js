const PLATFORM = window.EDUGNAY_PLATFORM;
    let activeNotifFilter = 'all';

    function getPlatformNotifications() {
      return PLATFORM.getNotifications();
    }

    function setNotifFilter(mode, button) {
      document.querySelectorAll('#notifTypeFilters .notif-filter-btn').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      activeNotifFilter = mode;
      renderNotifList();
    }

    async function markRead(id) {
      await PLATFORM.markPlatformNotificationRead(id);
      PLATFORM.renderTopbarNotifs();
      renderNotifList();
    }

    async function openNotification(id) {
      const notification = getPlatformNotifications().find(item => String(item.id) === String(id));
      await markRead(id);
      if (notification?.link) window.navigatePlatform(notification.link);
    }

    async function markAllRead() {
      await PLATFORM.markAllPlatformNotificationsRead();
      renderNotifList();
    }

    function renderNotifList() {
      const container = document.getElementById('notifList');
      const emptyState = document.getElementById('notifEmptyState');
      const all = getPlatformNotifications().slice().sort((first, second) => {
        return new Date(second.createdAt) - new Date(first.createdAt);
      });
      const filtered = activeNotifFilter === 'unread' ? all.filter(notification => !notification.read) : all;

      if (!filtered.length) {
        container.innerHTML = '';
        emptyState.hidden = false;
        const noUnread = activeNotifFilter === 'unread' && all.length;
        emptyState.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
          icon: 'bell-off',
          title: window.EDUGNAY_COMMUNICATION?.error ? 'Notifications unavailable' : noUnread ? 'No unread notifications' : 'No notifications yet',
          text: window.EDUGNAY_COMMUNICATION?.error || (noUnread ? "You're all caught up." : 'School account updates will appear here.')
        });
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      emptyState.hidden = true;
      emptyState.innerHTML = '';
      let lastGroup = '';
      container.innerHTML = filtered.map(notification => {
        const group = formatDateGroup(notification.createdAt);
        const groupHtml = group !== lastGroup ? `<div class="notif-group-label">${escapeHtml(group)}</div>` : '';
        lastGroup = group;
        return `${groupHtml}
          <div class="notif-item ${notification.read ? '' : 'unread'}" role="button" tabindex="0" data-platform-notification="${escapeHtml(notification.id)}" data-notification-id="${escapeHtml(notification.id)}">
            <div class="nt-icon ${escapeHtml(notification.tone || 'blue')}"><i data-lucide="${escapeHtml(notification.icon || 'bell')}" style="width:15px;height:15px;"></i></div>
            <div class="nt-body">
              <div class="nt-text"><strong>${escapeHtml(notification.title || 'Platform notification')}</strong></div>
              <div class="nt-desc">${escapeHtml(notification.message || '')}</div>
              <div class="nt-time">${escapeHtml(formatTime(notification.createdAt))}</div>
            </div>
          </div>`;
      }).join('');

      container.querySelectorAll('[data-platform-notification]').forEach(item => {
        const activate = () => openNotification(item.dataset.platformNotification);
        item.addEventListener('click', activate);
        item.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        });
      });
      if (window.lucide) window.lucide.createIcons();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      await window.EDUGNAY_PLATFORM_COMMUNICATION_READY;
      PLATFORM.renderTopbarNotifs();
      renderNotifList();
      if (window.lucide) window.lucide.createIcons();
      window.EDUGNAY_PAGE_LOADING.ready();
    });
