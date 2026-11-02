lucide.createIcons();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { toggleDrawer(false); }
  });

let activeNotifFilter = 'all';

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

  function getFilteredNotifs() {
    return getStudentVisibleNotifications()
      .filter(n => activeNotifFilter === 'unread' ? !n.read : true)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function goToNotif(link, id) {
    markCurrentNotificationRead(id).finally(() => navigate(link.page));
  }

  function renderNotifList() {
    const container = document.getElementById('notifList');
    const emptyState = document.getElementById('notifEmptyState');
    const filtered = getFilteredNotifs();

    if (!filtered.length) {
      container.innerHTML = '';
      const isUnreadEmpty = activeNotifFilter === 'unread' && getStudentVisibleNotifications().length;
      emptyState.hidden = false;
      emptyState.innerHTML = window.EDUGNAY_CONFIG.renderPanelEmptyState({
        icon: 'bell-off',
        title: isUnreadEmpty ? 'No unread notifications' : 'No notifications yet',
        text: isUnreadEmpty ? "You're all caught up." : "You'll see updates here as they happen."
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
        <div class="notif-item ${n.read ? '' : 'unread'}" data-notification-id="${window.EDUGNAY_CONFIG.escapeHtml(n.id)}" data-page-click="${window.EDUGNAY_PAGE_EVENTS.register('click', function(event) { goToNotif(n.link, n.id) })}">
          <div class="nt-icon ${n.tone}"><i data-lucide="${n.icon}" style="width:15px;height:15px;"></i></div>
          <div class="nt-body">
            <div class="nt-text"><strong>${window.EDUGNAY_CONFIG.escapeHtml(n.title)}</strong></div>
            <div class="nt-desc">${window.EDUGNAY_CONFIG.escapeHtml(n.message)}</div>
            <div class="nt-time">${formatTime(n.createdAt)}</div>
          </div>
          <span class="nt-tag">${n.type}</span>
        </div>
      `;
    });

    container.innerHTML = html;
    lucide.createIcons();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const notifications = await window.EDUGNAY_COMMUNICATION_RESOURCES?.notifications;
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
