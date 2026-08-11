/* Shared shell behavior for every portal role. */

function toggleNotifDropdown() {
  const panel = document.getElementById('tbNotifPanel');
  if (panel) panel.classList.toggle('open');
}

function markAllNotifRead() {
  const adminItems = typeof getAdminNotifItems === 'function' ? getAdminNotifItems() : [];
  const roleItems = typeof NOTIFICATIONS !== 'undefined' && Array.isArray(NOTIFICATIONS)
    ? NOTIFICATIONS
    : [];
  const items = adminItems.length ? adminItems : roleItems;

  if (typeof NOTIFICATIONS !== 'undefined' && Array.isArray(NOTIFICATIONS)) {
    NOTIFICATIONS.forEach(item => { item.read = true; });
  }
  if (typeof setReadIds === 'function') setReadIds(items.map(item => item.id));
  if (typeof renderTopbarNotifs === 'function') renderTopbarNotifs();
}

function getProfileControls() {
  return {
    trigger: document.getElementById('tbProfileTrigger') || document.getElementById('profileTrigger'),
    dropdown: document.getElementById('tbProfileDropdown') || document.getElementById('profileDropdown')
  };
}

function toggleProfileDropdown(forceState) {
  const { trigger, dropdown } = getProfileControls();
  if (!trigger || !dropdown) return;
  const isOpen = forceState === undefined
    ? !dropdown.classList.contains('open')
    : forceState;
  dropdown.classList.toggle('open', isOpen);
  trigger.classList.toggle('open', isOpen);
  trigger.setAttribute('aria-expanded', String(isOpen));
}

function toggleProfileMenu(forceState) {
  toggleProfileDropdown(forceState);
}

function closeProfileMenu() {
  toggleProfileDropdown(false);
}

function toggleDrawer(open) {
  const isOpen = open === undefined
    ? !document.body.classList.contains('drawer-open')
    : open;
  document.body.classList.toggle('drawer-open', isOpen);
  const overlay = document.getElementById('overlay') || document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.toggle('open', isOpen);
}

function toggleGroup(id) {
  const group = document.getElementById(id);
  if (!group) return;
  group.classList.toggle('open');
  if (window.lucide) lucide.createIcons();
}

function confirmLogout() {
  // TODO on backend conversion: replace with POST /auth/logout,
  // clear session cookie, then redirect
  localStorage.clear(); // wipes mock data (reopen requests, read-state, etc.)
  const isGitHubPages = location.hostname.endsWith('github.io');
  const BASE = isGitHubPages ? '/edugnay' : '';

  window.location.href = `${BASE}/index.html`;
}

function applyPageTitleToTopbar() {
  const source = document.querySelector('.page-overview-title')
    || document.querySelector('.nav-item.active .nav-label')
    || document.querySelector('.nav-group-toggle.active > span');
  const title = source?.textContent.trim();
  if (!title) return;

  document.querySelectorAll('.topbar-context, .admin-topbar-context').forEach(context => {
    const value = context.querySelector('strong');
    if (value) value.textContent = title;
    context.setAttribute('aria-label', `${title} page`);
  });
}

/* Initialize the shared right-edge fade for every horizontally scrollable tab bar. */
window.initScrollFades = function initScrollFades() {
  const selector = [
    '.child-switcher',
    '.subject-tab-bar',
    '.profile-tab-bar',
    '.mgmt-tabs',
    '.filter-tabs',
    '.tab-bar',
    '.cat-tabs',
    '.att-history-tabs',
    '.grade-tabs',
    '.mini-tab-bar',
    '.section-tab-bar'
  ].join(', ');

  document.querySelectorAll(selector).forEach(element => {
    if (element.dataset.scrollFadeReady === 'true') return;
    element.dataset.scrollFadeReady = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'scroll-fade-wrap';
    if (!element.classList.contains('child-switcher')) {
      wrapper.classList.add('tabs-fade', 'light-tabs-fade');
    }

    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);

    const updateFade = () => {
      const hasMore = element.scrollWidth - element.clientWidth - element.scrollLeft > 4;
      wrapper.classList.toggle('has-more-right', hasMore);
    };

    updateFade();
    element.addEventListener('scroll', updateFade, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(updateFade).observe(element);
    } else {
      window.addEventListener('resize', updateFade);
    }
  });
};

document.addEventListener('click', event => {
  const { trigger, dropdown } = getProfileControls();
  if (trigger && dropdown && !trigger.contains(event.target) && !dropdown.contains(event.target)) {
    toggleProfileDropdown(false);
  }

  const notifTrigger = document.getElementById('tbNotifTrigger');
  const notifPanel = document.getElementById('tbNotifPanel');
  if (notifTrigger && notifPanel && !notifTrigger.contains(event.target) && !notifPanel.contains(event.target)) {
    notifPanel.classList.remove('open');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  applyPageTitleToTopbar();
  window.initScrollFades();
});
